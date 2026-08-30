import assert from "node:assert/strict";
import test from "node:test";

import {
  getCoverCropMetrics,
  normalizeCropTransform,
  pixelsToNormalizedOffset,
} from "./cropGeometry";

test("crop offsets stay proportional across preview and output dimensions", () => {
  const crop = normalizeCropTransform({ offsetX: 0.5, offsetY: -0.25, zoom: 125 });
  const preview = getCoverCropMetrics(
    { width: 6000, height: 4000 },
    { width: 450, height: 300 },
    crop
  );
  const output = getCoverCropMetrics(
    { width: 6000, height: 4000 },
    { width: 1800, height: 1200 },
    crop
  );

  assert.ok(preview);
  assert.ok(output);
  assert.equal(output.translationX / preview.translationX, 4);
  assert.equal(output.translationY / preview.translationY, 4);
});

test("cover crop never accepts zoom below 100 or pan outside its bounds", () => {
  const crop = normalizeCropTransform({ offsetX: 4, offsetY: -3, zoom: 20 });

  assert.deepEqual(crop, { offsetX: 1, offsetY: -1, zoom: 100 });
});

test("legacy viewport pixels can be migrated to normalized offsets", () => {
  assert.equal(pixelsToNormalizedOffset(45, 90), 0.5);
  assert.equal(pixelsToNormalizedOffset(-180, 90), -1);
  assert.equal(pixelsToNormalizedOffset(20, 0), 0);
});
