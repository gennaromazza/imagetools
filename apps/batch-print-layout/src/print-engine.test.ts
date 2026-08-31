import { describe, expect, it } from "vitest";
import {
  calculateGridLayout,
  createDefaultCrop,
  getCenteredPagePositions,
  getPhotoContentRectCm,
  getPreviewRenderDpi,
  getRenderSafetyError,
  mmToPx,
  paginateAssets,
  PHOTO_PRESETS,
  type PhotoAsset,
} from "./print-engine";
import { buildPageFileName, sanitizeFileNamePrefix } from "./render-export";

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
  it("exposes the supported instant photo formats", () => {
    expect(PHOTO_PRESETS.map((preset) => preset.presetId)).toEqual([
      "polaroid-integral",
      "polaroid-round-frame",
      "polaroid-go",
      "instax-mini",
      "instax-square",
      "instax-wide",
      "polaroid-hi-print-2x3",
      "polaroid-hi-print-3x3",
      "polaroid-hi-print-4x6",
    ]);
  });

  it("converts millimetres to output pixels using the selected DPI", () => {
    expect(mmToPx(25.4, 300)).toBe(300);
  });

  it("configures the Polaroid Go preset with its real white frame", () => {
    const preset = PHOTO_PRESETS.find((item) => item.presetId === "polaroid-go");
    expect(preset).toMatchObject({
      widthCm: 5.39,
      heightCm: 6.66,
      frameStyle: "polaroid-go",
      description: expect.stringContaining("53,9 × 66,6 mm"),
    });
  });

  it("crops Polaroid Go photos to the 47 x 46 mm image window", () => {
    const crop = createDefaultCrop({
      id: "go-photo",
      fileName: "go.jpg",
      sourceUrl: "",
      previewUrl: "",
      width: 3000,
      height: 2000,
    }, { widthCm: 5.39, heightCm: 6.66, dpi: 300, frameStyle: "polaroid-go" }, "cover");

    expect(crop.cropWidth / crop.cropHeight).toBeCloseTo((4.7 / 4.6) / (3000 / 2000), 5);
  });

  it("returns one canonical Polaroid Go image rectangle", () => {
    expect(getPhotoContentRectCm({
      widthCm: 5.39,
      heightCm: 6.66,
      dpi: 300,
      frameStyle: "polaroid-go",
    })).toEqual({ x: 0.345, y: 0.32, width: 4.7, height: 4.6 });
  });

  it("keeps the physical sheet dimensions and every slot inside the sheet", () => {
    const layout = calculateGridLayout(
      { widthCm: 8, heightCm: 3, dpi: 300 },
      { presetId: "15x20", label: "15x20 cm", widthCm: 15, heightCm: 20, marginMm: 10, gapMm: 2 },
    );

    expect(layout.sheetWidthCm).toBe(20);
    expect(layout.sheetHeightCm).toBe(15);
    for (const position of layout.positions) {
      expect(position.x).toBeGreaterThanOrEqual(0);
      expect(position.y).toBeGreaterThanOrEqual(0);
      expect(position.x + layout.photoWidthPx).toBeLessThanOrEqual(layout.sheetWidthPx);
      expect(position.y + layout.photoHeightPx).toBeLessThanOrEqual(layout.sheetHeightPx);
    }
  });

  it("fits two 6x7 cm photos on a 10x15 cm sheet", () => {
    const layout = calculateGridLayout(
      { widthCm: 6, heightCm: 7, dpi: 300 },
      { presetId: "10x15", label: "10x15 cm", widthCm: 10, heightCm: 15, marginMm: 3, gapMm: 1 },
    );

    expect(layout.photosPerSheet).toBe(2);
  });

  it("keeps landscape photos unrotated when that already maximizes yield", () => {
    const layout = calculateGridLayout(
      { widthCm: 10, heightCm: 5, dpi: 300 },
      { presetId: "test", label: "test", widthCm: 10, heightCm: 15, marginMm: 0, gapMm: 0 },
    );

    expect(layout.photosPerSheet).toBe(3);
    expect(layout.photoRotated).toBe(false);
  });

  it("uses orientation strategy to increase yield on the sheet", () => {
    const layout = calculateGridLayout(
      { widthCm: 5, heightCm: 10, dpi: 300 },
      { presetId: "test", label: "test", widthCm: 10, heightCm: 15, marginMm: 0, gapMm: 0 },
    );

    expect(layout.photosPerSheet).toBe(3);
    expect(layout.photoRotated || layout.sheetLandscape).toBe(true);
  });

  it("creates 74 sheets for 148 photos when two fit per sheet", () => {
    const layout = calculateGridLayout(
      { widthCm: 6, heightCm: 7, dpi: 300 },
      { presetId: "10x15", label: "10x15 cm", widthCm: 10, heightCm: 15, marginMm: 3, gapMm: 1 },
    );
    const pages = paginateAssets(fakeAssets(148), layout);

    expect(pages).toHaveLength(74);
    expect(pages.at(-1)?.slots).toHaveLength(2);
  });

  it("does not duplicate photos on the last partial sheet", () => {
    const layout = calculateGridLayout(
      { widthCm: 6, heightCm: 7, dpi: 300 },
      { presetId: "10x15", label: "10x15 cm", widthCm: 10, heightCm: 15, marginMm: 3, gapMm: 1 },
    );
    const pages = paginateAssets(fakeAssets(149), layout);

    expect(pages).toHaveLength(75);
    expect(pages.at(-1)?.slots).toHaveLength(1);
    expect(new Set(pages.flatMap((page) => page.slots.map((slot) => slot.assetId))).size).toBe(149);
  });

  it("centres a single photo on the last partial sheet", () => {
    const layout = calculateGridLayout(
      { widthCm: 5.39, heightCm: 6.66, dpi: 300, frameStyle: "polaroid-go" },
      { presetId: "15x20", label: "15x20 cm", widthCm: 15, heightCm: 20, marginMm: 3, gapMm: 1 },
    );
    const [position] = getCenteredPagePositions(layout, 1);

    expect(position.x + layout.photoWidthPx / 2).toBeCloseTo(layout.sheetWidthPx / 2, 5);
    expect(position.y + layout.photoHeightPx / 2).toBeCloseTo(layout.sheetHeightPx / 2, 5);
  });

  it("uses a balanced centred grid for four photos on a 3x2 layout", () => {
    const layout = calculateGridLayout(
      { widthCm: 5.39, heightCm: 6.66, dpi: 300, frameStyle: "polaroid-go" },
      { presetId: "15x20", label: "15x20 cm", widthCm: 15, heightCm: 20, marginMm: 3, gapMm: 1 },
    );
    const positions = getCenteredPagePositions(layout, 4);
    const distinctColumns = new Set(positions.map((position) => position.x.toFixed(3)));
    const distinctRows = new Set(positions.map((position) => position.y.toFixed(3)));

    expect(positions).toHaveLength(4);
    expect(distinctColumns.size).toBe(2);
    expect(distinctRows.size).toBe(2);
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
    const effectiveRotatedAspect = (crop.cropHeight * 2000) / (crop.cropWidth * 3000);
    expect(effectiveRotatedAspect).toBeCloseTo(15 / 20, 5);
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

  it("ricalcola il crop sugli assi originali quando la rotazione è imposta", () => {
    const asset = {
      id: "asset-landscape-manual",
      fileName: "landscape.jpg",
      sourceUrl: "",
      previewUrl: "",
      width: 3000,
      height: 2000,
    };
    const printSpec = { widthCm: 3.5, heightCm: 4.5, dpi: 300 };
    const crop = createDefaultCrop(asset, printSpec, "cover", false, 90);

    expect(crop.rotation).toBe(90);
    const effectiveRotatedAspect = (crop.cropHeight * asset.height) / (crop.cropWidth * asset.width);
    expect(effectiveRotatedAspect).toBeCloseTo(printSpec.widthCm / printSpec.heightCm, 5);
  });

  it("returns a safe empty layout for invalid numeric input", () => {
    const layout = calculateGridLayout(
      { widthCm: Number.NaN, heightCm: -5, dpi: Number.POSITIVE_INFINITY },
      { presetId: "bad", label: "bad", widthCm: 15, heightCm: 20, marginMm: -2, gapMm: Number.NaN },
    );

    expect(layout.photosPerSheet).toBe(0);
    expect(Number.isFinite(layout.sheetWidthPx)).toBe(true);
    expect(Number.isFinite(layout.sheetHeightPx)).toBe(true);
  });

  it("caps preview rendering independently from print DPI", () => {
    const layout = calculateGridLayout(
      { widthCm: 5.39, heightCm: 6.66, dpi: 600 },
      { presetId: "15x20", label: "15x20 cm", widthCm: 15, heightCm: 20, marginMm: 3, gapMm: 1 },
    );
    const previewDpi = getPreviewRenderDpi(layout, 600, 1200);

    expect(previewDpi).toBeLessThan(600);
    expect(Math.max(layout.sheetWidthCm, layout.sheetHeightCm) / 2.54 * previewDpi).toBeLessThanOrEqual(1200.5);
  });

  it("rejects render allocations above the safe canvas budget", () => {
    const layout = calculateGridLayout(
      { widthCm: 5, heightCm: 5, dpi: 600 },
      { presetId: "huge", label: "huge", widthCm: 120, heightCm: 120, marginMm: 0, gapMm: 0 },
    );
    expect(getRenderSafetyError(layout, 600)).toMatch(/limite|supera/i);
  });

  it("sanitizes hostile and reserved Windows export names", () => {
    expect(sanitizeFileNamePrefix(" ../CON:<foto>?* ")).toBe("-CON-foto-");
    expect(sanitizeFileNamePrefix("CON")).toBe("batch-print");
    expect(buildPageFileName("album/clienti", 2, ".JPG")).toBe("album-clienti-002.jpg");
  });
});
