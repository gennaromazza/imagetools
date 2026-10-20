import assert from "node:assert/strict";
import test from "node:test";
import {
  assignGamepadButton,
  createGamepadInterpreter,
  DEFAULT_GAMEPAD_MAPPING,
  findNewlyPressedButton,
  GAMEPAD_BUTTON,
  gamepadButtonName,
  normalizeGamepadMapping,
  stepRating,
  type GamepadSnapshot,
} from "./gamepad-controls";

function snapshot(pressed: number[] = [], axes: number[] = [0, 0, 0, 0]): GamepadSnapshot {
  const buttons = Array.from({ length: 24 },(_, index) => (pressed.includes(index) ? 1 : 0));
  return { buttons, axes };
}

const grid = { previewOpen: false };
const preview = { previewOpen: true };

test("un pulsante tenuto premuto classifica una sola volta", () => {
  const pad = createGamepadInterpreter();
  assert.deepEqual(pad.update(snapshot([GAMEPAD_BUTTON.a]), grid, 0), [{ type: "key", key: "p", code: "KeyP" }]);
  assert.deepEqual(pad.update(snapshot([GAMEPAD_BUTTON.a]), grid, 500), []);
  assert.deepEqual(pad.update(snapshot(), grid, 600), []);
  assert.equal(pad.update(snapshot([GAMEPAD_BUTTON.a]), grid, 700).length, 1);
});

test("croce e levetta sinistra ripetono la freccia dopo l'attesa iniziale", () => {
  const pad = createGamepadInterpreter();
  const right = snapshot([GAMEPAD_BUTTON.dpadRight]);
  assert.deepEqual(pad.update(right, grid, 0), [{ type: "key", key: "ArrowRight", code: "ArrowRight", repeat: false }]);
  assert.deepEqual(pad.update(right, grid, 200), []);
  assert.deepEqual(pad.update(right, grid, 400), [{ type: "key", key: "ArrowRight", code: "ArrowRight", repeat: true }]);
  assert.deepEqual(pad.update(right, grid, 450), []);
  assert.equal(pad.update(right, grid, 530).length, 1);

  const stick = createGamepadInterpreter();
  assert.deepEqual(stick.update(snapshot([], [0.1, 0.9, 0, 0]), grid, 0), [
    { type: "key", key: "ArrowDown", code: "ArrowDown", repeat: false },
  ]);
  assert.deepEqual(stick.update(snapshot([], [0.2, 0.3, 0, 0]), grid, 10), [], "dentro la zona morta");
});

test("la levetta destra sposta la foto solo in anteprima", () => {
  const pad = createGamepadInterpreter();
  const pushLeft = snapshot([], [0, 0, -1, 0]);
  assert.deepEqual(pad.update(pushLeft, grid, 0), []);
  assert.deepEqual(pad.update(pushLeft, preview, 10), [
    { type: "key", key: "ArrowLeft", code: "ArrowLeft", altKey: true, repeat: false },
  ]);
});

test("B chiude solo l'anteprima, Start la apre o la chiude", () => {
  const pad = createGamepadInterpreter();
  assert.deepEqual(pad.update(snapshot([GAMEPAD_BUTTON.b]), grid, 0), []);
  pad.update(snapshot(), grid, 10);
  assert.deepEqual(pad.update(snapshot([GAMEPAD_BUTTON.b]), preview, 20), [{ type: "key", key: "Escape", code: "Escape" }]);
  assert.deepEqual(pad.update(snapshot([GAMEPAD_BUTTON.start]), grid, 30), [{ type: "togglePreview" }]);
});

test("LB/RB cambiano le stelle restando tra 0 e 5", () => {
  const pad = createGamepadInterpreter();
  assert.deepEqual(pad.update(snapshot([GAMEPAD_BUTTON.rb]), grid, 0), [{ type: "ratingStep", delta: 1 }]);
  assert.equal(stepRating(undefined, 1), 1);
  assert.equal(stepRating(5, 1), 5);
  assert.equal(stepRating(0, -1), 0);
  assert.equal(stepRating(3, -1), 2);
});

test("un comando riassegnato risponde al nuovo pulsante e non più al vecchio", () => {
  const mapping = assignGamepadButton({ ...DEFAULT_GAMEPAD_MAPPING }, "pick", GAMEPAD_BUTTON.y);
  assert.equal(mapping.pick, GAMEPAD_BUTTON.y);
  assert.equal(mapping.zoom, null, "Y era dello zoom: ora lo zoom resta senza pulsante");

  const pad = createGamepadInterpreter();
  const context = { previewOpen: false, mapping };
  assert.deepEqual(pad.update(snapshot([GAMEPAD_BUTTON.a]), context, 0), []);
  pad.update(snapshot(), context, 10);
  assert.deepEqual(pad.update(snapshot([GAMEPAD_BUTTON.y]), context, 20), [{ type: "key", key: "p", code: "KeyP" }]);
});

test("i comandi di spostamento riassegnati ripetono come la croce", () => {
  const mapping = assignGamepadButton({ ...DEFAULT_GAMEPAD_MAPPING }, "moveRight", 20);
  const pad = createGamepadInterpreter();
  const context = { previewOpen: false, mapping };
  const held = snapshot([20]);
  assert.equal(pad.update(held, context, 0).length, 1);
  assert.equal(pad.update(held, context, 400).length, 1);
  assert.deepEqual(pad.update(snapshot([GAMEPAD_BUTTON.dpadRight]), context, 600), [], "la croce destra non è più assegnata");
});

test("la mappatura salvata viene ripulita da valori non validi o duplicati", () => {
  assert.deepEqual(normalizeGamepadMapping(null), DEFAULT_GAMEPAD_MAPPING);
  const restored = normalizeGamepadMapping({ pick: 3, zoom: 3, reject: "x", neutral: -1, closePreview: null });
  assert.equal(restored.pick, 3);
  assert.equal(restored.zoom, null, "un pulsante non può comandare due azioni");
  assert.equal(restored.reject, DEFAULT_GAMEPAD_MAPPING.reject);
  assert.equal(restored.neutral, DEFAULT_GAMEPAD_MAPPING.neutral);
  assert.equal(restored.closePreview, null);
});

test("in mappatura conta solo il pulsante appena premuto", () => {
  assert.equal(findNewlyPressedButton(snapshot([GAMEPAD_BUTTON.a]), snapshot([GAMEPAD_BUTTON.a])), null);
  assert.equal(findNewlyPressedButton(snapshot([GAMEPAD_BUTTON.a]), snapshot([GAMEPAD_BUTTON.a, 18])), 18);
  assert.equal(gamepadButtonName(18), "Pulsante 19");
  assert.equal(gamepadButtonName(0, false), "Pulsante 1");
  assert.equal(gamepadButtonName(0), "A");
});

test("i grilletti analogici scorrono le foto oltre la soglia", () => {
  const pad = createGamepadInterpreter();
  const half = snapshot();
  (half.buttons as number[])[GAMEPAD_BUTTON.rt] = 0.3;
  assert.deepEqual(pad.update(half, grid, 0), []);
  (half.buttons as number[])[GAMEPAD_BUTTON.rt] = 0.8;
  assert.deepEqual(pad.update(half, grid, 10), [{ type: "key", key: "ArrowRight", code: "ArrowRight", repeat: false }]);
});
