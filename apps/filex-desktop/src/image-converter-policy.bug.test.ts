import assert from "node:assert/strict";
import test from "node:test";
import type { ImageConverterJobConfig, ImageConverterPreset } from "@photo-tools/desktop-contracts";
import {
  isInsideImageConverterOutput,
  resolveImageConverterMaxLongEdge,
  resolveImageConverterTargetMaxBytes,
} from "./image-converter-policy.js";

const preset: ImageConverterPreset = {
  id: "web-quality",
  name: "Web",
  description: "Test",
  maxLongEdge: 2048,
  format: "jpg",
  quality: 85,
};

function config(maxLongEdge: number | null, targetMaxBytesMb: number | null): ImageConverterJobConfig {
  return { inputPaths: ["D:/Foto"], presetId: preset.id, overrides: { maxLongEdge, targetMaxBytesMb, openOutputWhenDone: false } };
}

test("bug hunt: override non finiti o fuori limite ricadono su valori sicuri", () => {
  assert.equal(resolveImageConverterMaxLongEdge(config(Number.NaN, null), preset), 2048);
  assert.equal(resolveImageConverterMaxLongEdge(config(199, null), preset), 2048);
  assert.equal(resolveImageConverterMaxLongEdge(config(12001, null), preset), 2048);
  assert.equal(resolveImageConverterTargetMaxBytes(config(null, Number.POSITIVE_INFINITY)), null);
  assert.equal(resolveImageConverterTargetMaxBytes(config(null, -1)), null);
  assert.equal(resolveImageConverterTargetMaxBytes(config(null, 500)), 200 * 1024 * 1024);
});

test("bug hunt: riconosce output generati con separatori Windows, macOS e misti", () => {
  for (const pathValue of [
    "D:\\Foto\\Image Converter Output\\web-quality",
    "/Volumes/Foto/Image Converter Output/web-quality",
    "D:\\Foto/Image Converter Output\\web-quality",
  ]) assert.equal(isInsideImageConverterOutput(pathValue), true, pathValue);
  assert.equal(isInsideImageConverterOutput("D:/Foto/Image Converter Output Backup"), false);
});
