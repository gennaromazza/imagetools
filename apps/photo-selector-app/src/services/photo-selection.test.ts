import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findLassoHitIds,
  pickSelectionAnchor,
  resolveClassificationTargetIds,
  resolveLassoSelection,
  shouldSelectAllVisible,
  type LassoRect,
} from "./photo-selection.js";

// Griglia 3 colonne, card 100x100 senza spazi: a=(0,0) b=(100,0) c=(200,0) d=(0,100) ...
function gridRects(ids: string[], columns = 3): Map<string, LassoRect> {
  const rects = new Map<string, LassoRect>();
  ids.forEach((id, index) => {
    const left = (index % columns) * 100;
    const top = Math.floor(index / columns) * 100;
    rects.set(id, { left, top, right: left + 100, bottom: top + 100 });
  });
  return rects;
}

const ids = ["a", "b", "c", "d", "e", "f"];

describe("lasso", () => {
  it("restringere il rettangolo toglie le foto che non tocca più", () => {
    const rects = gridRects(ids);
    const wide = findLassoHitIds(rects, { left: 10, top: 10, right: 290, bottom: 190 });
    assert.deepEqual([...wide].sort(), ids);
    const narrow = findLassoHitIds(rects, { left: 10, top: 10, right: 90, bottom: 90 });
    assert.deepEqual([...narrow], ["a"]);
  });

  it("senza modificatori sostituisce la selezione, anche se non tocca nulla", () => {
    assert.deepEqual(resolveLassoSelection(["x", "y"], new Set(["a"]), false), ["a"]);
    assert.deepEqual(resolveLassoSelection(["x", "y"], new Set(), false), []);
  });

  it("con Maiusc o Ctrl aggiunge senza duplicare", () => {
    assert.deepEqual(resolveLassoSelection(["x", "a"], new Set(["a", "b"]), true), ["x", "a", "b"]);
  });
});

describe("Ctrl+A", () => {
  it("seleziona le foto visibili, poi le deseleziona quando lo sono già tutte", () => {
    assert.equal(shouldSelectAllVisible(ids, new Set()), true);
    assert.equal(shouldSelectAllVisible(ids, new Set(["a", "b"])), true);
    assert.equal(shouldSelectAllVisible(ids, new Set(ids)), false);
    assert.equal(shouldSelectAllVisible(ids, new Set([...ids, "nascosta"])), false);
  });

  it("non considera «tutte selezionate» una griglia vuota", () => {
    assert.equal(shouldSelectAllVisible([], new Set(["a"])), true);
  });
});

describe("focus dopo lasso o Ctrl+A", () => {
  it("tiene il focus se la foto è nella nuova selezione, altrimenti la prima visibile selezionata", () => {
    assert.equal(pickSelectionAnchor(new Set(["b", "c"]), ids, "c"), "c");
    assert.equal(pickSelectionAnchor(new Set(["b", "c"]), ids, "a"), "b");
    assert.equal(pickSelectionAnchor(new Set(["b", "c"]), ids, null), "b");
    assert.equal(pickSelectionAnchor(new Set(), ids, "a"), null);
  });
});

describe("destinatari delle scorciatoie di classificazione", () => {
  it("con più foto selezionate vale la selezione, anche se il focus è fuori", () => {
    assert.deepEqual(resolveClassificationTargetIds(["a", "b", "c"], "f"), ["a", "b", "c"]);
    assert.deepEqual(resolveClassificationTargetIds(["a", "b", "c"], null), ["a", "b", "c"]);
  });

  it("con una sola foto selezionata vale la foto col focus (frecce + tasto)", () => {
    assert.deepEqual(resolveClassificationTargetIds(["a"], "b"), ["b"]);
    assert.deepEqual(resolveClassificationTargetIds([], "b"), ["b"]);
  });

  it("senza focus usa la selezione, senza niente non fa nulla", () => {
    assert.deepEqual(resolveClassificationTargetIds(["a"], null), ["a"]);
    assert.deepEqual(resolveClassificationTargetIds([], null), []);
  });
});
