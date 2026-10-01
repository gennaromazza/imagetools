import { test } from "node:test";
import assert from "node:assert/strict";
import { baseCrop, cropForView, effectiveCrop, effectiveDpi, imageRectInSlot, slotRectMm } from "./slot-geometry";
const TEST_SHEET = { presetId: "album-default", label: "Album 30 × 30", widthCm: 30, heightCm: 30, dpi: 300, marginCm: 1.5, gapCm: 0.35, bleedCm: 0.3, backgroundColor: "#f7f3ed" };

const page = (slots: number) => ({
  sheetSpec: { ...TEST_SHEET },
  slotDefinitions: Array.from({ length: slots }, (_, i) => ({ id: String(i), x: 0, y: 0, width: 1, height: 1, expectedOrientation: "any" as const, priority: 1 })),
});

test("lo slot segue margini e interspazio", () => {
  const single = slotRectMm(page(1), { x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(single, { x: 15, y: 15, w: 270, h: 270 });
  const multi = slotRectMm(page(2), { x: 0, y: 0, width: 0.5, height: 1 });
  assert.ok(Math.abs(multi.x - (15 + 1.75)) < 1e-9 && Math.abs(multi.w - (135 - 3.5)) < 1e-9);
});
test("il ritaglio base riempie lo slot senza deformare", () => {
  for (const [image, slot] of [[1.5, 1], [0.67, 1], [1, 1], [1.5, 2.5]] as const) {
    const crop = baseCrop(image, slot);
    const visibleAspect = image * (crop.cropWidth / crop.cropHeight);
    assert.ok(Math.abs(visibleAspect - slot) < 1e-9, `${image} in ${slot}`);
  }
});
test("zoom e centro vengono limitati ai bordi dell'immagine", () => {
  const crop = cropForView(1.5, 1, 4, 5, -5);
  assert.ok(crop.cropLeft + crop.cropWidth <= 1 + 1e-9 && crop.cropTop >= 0);
  assert.ok(Math.abs(cropForView(1.5, 1, 4, 0.5, 0.5).cropWidth * 4 - baseCrop(1.5, 1).cropWidth) < 1e-9);
  assert.equal(cropForView(1.5, 1, 100, 0.5, 0.5).cropWidth, baseCrop(1.5, 1).cropWidth / 6);
});
test("il ritaglio salvato viene ricalcolato sull'aspetto reale dello slot", () => {
  const stored = { fitMode: "fill" as const, zoom: 1, cropLeft: 0, cropTop: 0, cropWidth: 1, cropHeight: 1 };
  const crop = effectiveCrop(stored, 1.5, 1);
  assert.ok(Math.abs(1.5 * (crop.cropWidth / crop.cropHeight) - 1) < 1e-9);
  assert.deepEqual(effectiveCrop({ ...stored, fitMode: "fit" }, 1.5, 1), { cropLeft: 0, cropTop: 0, cropWidth: 1, cropHeight: 1 });
});
test("immagine posizionata nello slot: fit centra, fill copre", () => {
  const slot = { x: 10, y: 10, w: 100, h: 100 };
  const fit = imageRectInSlot(slot, baseCrop(2, 1), "fit", 2);
  assert.deepEqual(fit, { x: 10, y: 35, w: 100, h: 50 });
  const fill = imageRectInSlot(slot, baseCrop(2, 1), "fill", 2);
  assert.ok(fill.w >= slot.w && fill.h >= slot.h - 1e-9);
  assert.ok(Math.abs(fill.w / fill.h - 2) < 1e-9);
});
test("risoluzione effettiva in dpi", () => {
  const full = { cropLeft: 0, cropTop: 0, cropWidth: 1, cropHeight: 1 };
  assert.equal(Math.round(effectiveDpi(3000, 2000, full, { x: 0, y: 0, w: 254, h: 100 })), 300);
  assert.equal(effectiveDpi(0, 0, full, { x: 0, y: 0, w: 10, h: 10 }), Infinity);
});
