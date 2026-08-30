import assert from "node:assert/strict";
import test from "node:test";
import { fitPreviewSurface } from "./workspaceLayout";

test("a vertical PartyFrame preview fits the available height without clipping", () => {
  const result = fitPreviewSurface(900, 600, 2 / 3);

  assert.deepEqual(result, { width: 400, height: 600 });
});

test("a horizontal preview respects the width cap and preserves its aspect ratio", () => {
  const result = fitPreviewSurface(1200, 900, 3 / 2, 760);

  assert.equal(result.width, 760);
  assert.equal(result.height, 760 / 1.5);
});

test("invalid measurements never produce an overflowing or non-finite surface", () => {
  assert.deepEqual(fitPreviewSurface(Number.NaN, 500, Number.NaN), { width: 0, height: 0 });
  assert.deepEqual(fitPreviewSurface(500, -20, 2 / 3), { width: 0, height: 0 });
});
