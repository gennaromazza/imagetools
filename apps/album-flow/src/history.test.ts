import { test } from "node:test";
import assert from "node:assert/strict";
import { HISTORY_LIMIT, canRedo, canUndo, createHistory, pushHistory, redo, resetHistory, undo } from "./history";

test("annulla e ripeti percorrono gli stati in ordine", () => {
  let h = createHistory(0);
  h = pushHistory(h, 1); h = pushHistory(h, 2);
  assert.equal(h.present, 2);
  h = undo(h); assert.equal(h.present, 1);
  h = undo(h); assert.equal(h.present, 0);
  assert.equal(canUndo(h), false);
  assert.equal(undo(h), h);
  h = redo(h); assert.equal(h.present, 1);
  assert.equal(canRedo(h), true);
});
test("una nuova modifica dopo annulla cancella il ramo ripetibile", () => {
  let h = pushHistory(pushHistory(createHistory("a"), "b"), "c");
  h = undo(h); h = pushHistory(h, "x");
  assert.equal(canRedo(h), false);
  assert.deepEqual(h.past, ["a", "b"]);
});
test("stato identico non crea passi e la cronologia è limitata", () => {
  const h = createHistory({ a: 1 });
  assert.equal(pushHistory(h, h.present), h);
  let big = createHistory(0);
  for (let i = 1; i <= HISTORY_LIMIT + 50; i += 1) big = pushHistory(big, i);
  assert.equal(big.past.length, HISTORY_LIMIT);
  assert.equal(resetHistory(big, 7).past.length, 0);
});
