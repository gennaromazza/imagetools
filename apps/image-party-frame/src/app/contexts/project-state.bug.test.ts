import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProjectState } from "./ProjectContext.js";

test("bug hunt: il conteggio immagini viene ricostruito e non usa dati salvati obsoleti", () => {
  const normalized = normalizeProjectState({
    images: [
      { id: "v", path: "v.jpg", orientation: "vertical", approval: "pending", crop: { x: 0, y: 0, zoom: 100 } },
      { id: "h", path: "h.jpg", orientation: "horizontal", approval: "approved", crop: { x: 0, y: 0, zoom: 100 } },
    ],
    imageCount: { total: 999, vertical: 999, horizontal: 0 },
  });
  assert.deepEqual(normalized.imageCount, { total: 2, vertical: 1, horizontal: 1 });
});

test("bug hunt: valori crop non finiti non contaminano il progetto", () => {
  const normalized = normalizeProjectState({
    images: [{
      id: "broken",
      path: "broken.jpg",
      orientation: "vertical",
      approval: "pending",
      crop: { x: Number.NaN, y: Number.POSITIVE_INFINITY, zoom: -1 },
    }],
  });
  assert.deepEqual(normalized.images[0]?.crop, { x: 0, y: 0, zoom: 100 });
});
