import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSpreadSvg } from "./spread-renderer";
import type { GeneratedPageLayout } from "@photo-tools/shared-types";

const page: GeneratedPageLayout = {
  id: "page", pageNumber: 1, pageSide: "single", templateId: "test", templateLabel: "Test",
  imageIds: [], warnings: [], sheetSpec: { presetId: "test", label: "Test", widthCm: 30, heightCm: 20, dpi: 300, marginCm: 0, gapCm: 0, bleedCm: .3 },
  slotDefinitions: [{ id: "slot", x: .25, y: .5, width: .5, height: .25, expectedOrientation: "any", priority: 1 }],
  assignments: [{ slotId: "slot", imageId: 'a"<&', fitMode: "fit", zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, locked: false }],
};
test("coordinate normalizzate convertite in millimetri e attributi XML protetti", () => {
  const svg = renderSpreadSvg(page);
  assert.ok(svg.includes('x="75" y="100" width="150" height="50"'));
  assert.ok(svg.includes('data-image-id="a&quot;&lt;&amp;"'));
  assert.ok(svg.includes('viewBox="-3 -3 306 206"'));
  assert.ok(svg.includes('data-safe-area="true"'));
});
test("non esporta silenziosamente slot mancanti o geometrie non finite", () => {
  assert.throws(() => renderSpreadSvg({ ...page, slotDefinitions: [] }), /Slot mancante/);
  assert.throws(() => renderSpreadSvg({ ...page, sheetSpec: { ...page.sheetSpec, widthCm: NaN } }), /Dimensioni/);
  assert.throws(() => renderSpreadSvg({ ...page, slotDefinitions: [{ ...page.slotDefinitions[0], width: Infinity }] }), /Geometria/);
});
test("renderer genera SVG con dimensioni, slot e asset", () => {
  const svg = renderSpreadSvg({ pageNumber: 1, id: "p", pageSide: "single", templateId: "t", templateLabel: "Test", imageIds: ["a"], warnings: [], sheetSpec: { widthCm: 30, heightCm: 20, dpi: 300, marginCm: 1, gapCm: .2, presetId: "x", label: "x" }, slotDefinitions: [{ id: "s", x: 0, y: 0, width: .5, height: 1, expectedOrientation: "any", priority: 1 }], assignments: [{ slotId: "s", imageId: "a", fitMode: "fit", zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, locked: false }] });
  assert.match(svg, /viewBox="0 0 300 200"/);
  assert.match(svg, /data-image-id="a"/);
});
