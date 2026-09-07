import assert from "node:assert/strict";
import test from "node:test";
import { dragOverlayRect, moveTextBox } from "./overlayGeometry";

test("full-width text remains movable by reducing unused line space at the canvas edge", () => {
  const origin = { x: 0, y: 138, width: 1181, height: 57 };
  assert.deepEqual(moveTextBox(origin, 100, 20, { width: 1181, height: 1772 }), { x: 100, y: 158, width: 1081 });
  assert.deepEqual(moveTextBox(origin, -100, -200, { width: 1181, height: 1772 }), { x: 0, y: 0, width: 1181 });
});

test("pointer movement uses the initial box and does not accumulate intermediate deltas", () => {
  const origin = { x: 100, y: 50, width: 160, height: 80 };
  const bounds = { width: 1000, height: 800 };
  assert.equal(dragOverlayRect(origin, "move", 10, 0, bounds).x, 110);
  assert.equal(dragOverlayRect(origin, "move", 20, 0, bounds).x, 120);
  assert.deepEqual(dragOverlayRect(origin, "move", -500, 1000, bounds), { x: 0, y: 720, width: 160, height: 80 });
});
test("logo resize preserves proportions and stays within the canvas", () => {
  assert.deepEqual(dragOverlayRect({ x: 100, y: 100, width: 160, height: 80 }, "resize", 160, 80, { width: 1000, height: 800 }, true),
    { x: 100, y: 100, width: 320, height: 160 });
  const edge = dragOverlayRect({ x: 100, y: 100, width: 160, height: 80 }, "resize", 2000, 0, { width: 400, height: 200 }, true);
  assert.equal(edge.width / edge.height, 2);
  assert.ok(edge.x + edge.width <= 400 && edge.y + edge.height <= 200);
});
