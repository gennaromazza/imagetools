import { describe, expect, it } from "vitest";
import { calculateGridLayout, createDefaultCrop, paginateAssets, type PhotoAsset } from "./print-engine";

function fakeAssets(count: number): PhotoAsset[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `asset-${index + 1}`,
    fileName: `foto-${index + 1}.jpg`,
    sourceUrl: "",
    previewUrl: "",
    width: 2400,
    height: 2800,
  }));
}

describe("batch print layout engine", () => {
  it("fits two 6x7 cm photos on a 10x15 cm sheet", () => {
    const layout = calculateGridLayout(
      { widthCm: 6, heightCm: 7, dpi: 300 },
      { presetId: "10x15", label: "10x15 cm", widthCm: 10, heightCm: 15, marginCm: 0.3, gapCm: 0.1 },
    );

    expect(layout.photosPerSheet).toBe(2);
  });

  it("keeps landscape photos unrotated when that already maximizes yield", () => {
    const layout = calculateGridLayout(
      { widthCm: 10, heightCm: 5, dpi: 300 },
      { presetId: "test", label: "test", widthCm: 10, heightCm: 15, marginCm: 0, gapCm: 0 },
    );

    expect(layout.photosPerSheet).toBe(3);
    expect(layout.photoRotated).toBe(false);
  });

  it("uses orientation strategy to increase yield on the sheet", () => {
    const layout = calculateGridLayout(
      { widthCm: 5, heightCm: 10, dpi: 300 },
      { presetId: "test", label: "test", widthCm: 10, heightCm: 15, marginCm: 0, gapCm: 0 },
    );

    expect(layout.photosPerSheet).toBe(3);
    expect(layout.photoRotated || layout.sheetLandscape).toBe(true);
  });

  it("creates 74 sheets for 148 photos when two fit per sheet", () => {
    const layout = calculateGridLayout(
      { widthCm: 6, heightCm: 7, dpi: 300 },
      { presetId: "10x15", label: "10x15 cm", widthCm: 10, heightCm: 15, marginCm: 0.3, gapCm: 0.1 },
    );
    const pages = paginateAssets(fakeAssets(148), layout);

    expect(pages).toHaveLength(74);
    expect(pages.at(-1)?.slots).toHaveLength(2);
  });

  it("does not duplicate photos on the last partial sheet", () => {
    const layout = calculateGridLayout(
      { widthCm: 6, heightCm: 7, dpi: 300 },
      { presetId: "10x15", label: "10x15 cm", widthCm: 10, heightCm: 15, marginCm: 0.3, gapCm: 0.1 },
    );
    const pages = paginateAssets(fakeAssets(149), layout);

    expect(pages).toHaveLength(75);
    expect(pages.at(-1)?.slots).toHaveLength(1);
    expect(new Set(pages.flatMap((page) => page.slots.map((slot) => slot.assetId))).size).toBe(149);
  });

  it("keeps the full source image as default crop in contain mode", () => {
    const crop = createDefaultCrop({
      id: "asset-wide",
      fileName: "wide.jpg",
      sourceUrl: "",
      previewUrl: "",
      width: 3000,
      height: 1500,
    }, { widthCm: 6, heightCm: 7, dpi: 300 }, "contain");

    expect(crop.cropLeft).toBe(0);
    expect(crop.cropTop).toBe(0);
    expect(crop.cropWidth).toBe(1);
    expect(crop.cropHeight).toBe(1);
  });

  it("pre-crops wide source images in cover mode", () => {
    const crop = createDefaultCrop({
      id: "asset-wide",
      fileName: "wide.jpg",
      sourceUrl: "",
      previewUrl: "",
      width: 3000,
      height: 1500,
    }, { widthCm: 6, heightCm: 7, dpi: 300 }, "cover");

    expect(crop.cropWidth).toBeLessThan(1);
    expect(crop.cropHeight).toBe(1);
  });

  it("handles zero-sized source dimensions without invalid crop values", () => {
    const crop = createDefaultCrop({
      id: "asset-broken",
      fileName: "broken.jpg",
      sourceUrl: "",
      previewUrl: "",
      width: 0,
      height: 0,
    }, { widthCm: 6, heightCm: 7, dpi: 300 }, "cover");

    expect(Number.isFinite(crop.cropLeft)).toBe(true);
    expect(Number.isFinite(crop.cropTop)).toBe(true);
    expect(crop.cropWidth).toBeGreaterThan(0);
    expect(crop.cropHeight).toBeGreaterThan(0);
  });

  it("auto-rotates the default crop when source and print orientations differ", () => {
    const crop = createDefaultCrop({
      id: "asset-landscape",
      fileName: "landscape.jpg",
      sourceUrl: "",
      previewUrl: "",
      width: 3000,
      height: 2000,
    }, { widthCm: 15, heightCm: 20, dpi: 300 }, "cover", true);

    expect(crop.rotation).toBe(90);
  });

  it("does not auto-rotate when source and print orientations match", () => {
    const crop = createDefaultCrop({
      id: "asset-portrait",
      fileName: "portrait.jpg",
      sourceUrl: "",
      previewUrl: "",
      width: 2000,
      height: 3000,
    }, { widthCm: 15, heightCm: 20, dpi: 300 }, "cover", true);

    expect(crop.rotation).toBe(0);
  });
});
