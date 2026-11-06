import assert from "node:assert/strict";
import test from "node:test";
import { resolvePhotoClassificationShortcut, toggleOffPickShortcut } from "./photo-classification";

const press = (key: string) => resolvePhotoClassificationShortcut({ key })!;

test("P su una foto già selezionata toglie lo stato; X su una già scartata anche", () => {
  assert.equal(toggleOffPickShortcut(press("p"), ["picked"]).pickStatus, "unmarked");
  assert.equal(toggleOffPickShortcut(press("x"), ["rejected"]).pickStatus, "unmarked");
});

test("P su una foto senza stato o con l'altro stato lo imposta", () => {
  assert.equal(toggleOffPickShortcut(press("p"), ["unmarked"]).pickStatus, "picked");
  assert.equal(toggleOffPickShortcut(press("p"), [undefined]).pickStatus, "picked");
  assert.equal(toggleOffPickShortcut(press("p"), ["rejected"]).pickStatus, "picked");
  assert.equal(toggleOffPickShortcut(press("x"), ["picked"]).pickStatus, "rejected");
});

test("con più foto lo stato si toglie solo se ce l'hanno tutte", () => {
  assert.equal(toggleOffPickShortcut(press("p"), ["picked", "picked"]).pickStatus, "unmarked");
  assert.equal(toggleOffPickShortcut(press("p"), ["picked", "unmarked"]).pickStatus, "picked");
});

test("U, stelle e colori non cambiano; senza foto non cambia nulla", () => {
  assert.equal(toggleOffPickShortcut(press("u"), ["picked"]).pickStatus, "unmarked");
  assert.deepEqual(toggleOffPickShortcut(press("3"), ["picked"]), { rating: 3 });
  assert.deepEqual(toggleOffPickShortcut(press("p"), []), { pickStatus: "picked" });
});
