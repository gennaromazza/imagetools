export type ExportFormat = "jpg" | "png" | "pdf" | "tif";
export type PhotoFitMode = "cover" | "contain";

export interface PhotoAsset {
  id: string;
  fileName: string;
  relativePath?: string;
  absolutePath?: string;
  size?: number;
  lastModified?: number;
  sourceUrl: string;
  previewUrl: string;
  width: number;
  height: number;
}

export interface PhotoPrintSpec {
  widthCm: number;
  heightCm: number;
  dpi: number;
}

export interface PrintSheetSpec {
  presetId: string;
  label: string;
  widthCm: number;
  heightCm: number;
  marginCm: number;
  gapCm: number;
}

export interface LogoOverlaySpec {
  enabled: boolean;
  imageUrl: string | null;
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
  scalePct: number;
  opacity: number;
  marginPct: number;
}

export interface ImageAdjustmentSpec {
  blackAndWhiteEnabled: boolean;
  fitMode: PhotoFitMode;
  autoRotateBySourceOrientation: boolean;
}

export interface BatchCropState {
  assetId: string;
  cropLeft: number;
  cropTop: number;
  cropWidth: number;
  cropHeight: number;
  rotation: number;
  reviewed: boolean;
}

export interface GridLayout {
  cols: number;
  rows: number;
  photosPerSheet: number;
  sheetWidthPx: number;
  sheetHeightPx: number;
  photoWidthPx: number;
  photoHeightPx: number;
  marginPx: number;
  gapPx: number;
  photoRotated: boolean;
  sheetLandscape: boolean;
  positions: Array<{ x: number; y: number }>;
}

export interface BatchPrintPage {
  pageNumber: number;
  slots: Array<{ assetId: string; x: number; y: number; width: number; height: number }>;
}

export const SHEET_PRESETS: PrintSheetSpec[] = [
  { presetId: "10x15", label: "10x15 cm", widthCm: 10, heightCm: 15, marginCm: 0.3, gapCm: 0.1 },
  { presetId: "13x18", label: "13x18 cm", widthCm: 13, heightCm: 18, marginCm: 0.3, gapCm: 0.1 },
  { presetId: "15x20", label: "15x20 cm", widthCm: 15, heightCm: 20, marginCm: 0.3, gapCm: 0.1 },
  { presetId: "20x30", label: "20x30 cm", widthCm: 20, heightCm: 30, marginCm: 0.4, gapCm: 0.15 },
  { presetId: "a4", label: "A4", widthCm: 21, heightCm: 29.7, marginCm: 0.5, gapCm: 0.15 },
  { presetId: "custom", label: "Personalizzato", widthCm: 10, heightCm: 15, marginCm: 0.3, gapCm: 0.1 },
];

export function cmToPx(cm: number, dpi: number): number {
  return Math.round((cm / 2.54) * dpi);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const GRID_ROUNDING_TOLERANCE_PX = 1;

function countSlots(usableSize: number, itemSize: number, gapPx: number): number {
  if (usableSize <= 0 || itemSize <= 0) {
    return 0;
  }
  return Math.max(0, Math.floor((usableSize + gapPx + GRID_ROUNDING_TOLERANCE_PX) / (itemSize + gapPx)));
}

function buildCandidate(
  sheetWidthPx: number,
  sheetHeightPx: number,
  photoWidthPx: number,
  photoHeightPx: number,
  marginPx: number,
  gapPx: number,
  photoRotated: boolean,
  sheetLandscape: boolean,
): GridLayout {
  const usableWidth = sheetWidthPx - marginPx * 2;
  const usableHeight = sheetHeightPx - marginPx * 2;
  const cols = countSlots(usableWidth, photoWidthPx, gapPx);
  const rows = countSlots(usableHeight, photoHeightPx, gapPx);
  const usedWidth = cols > 0 ? cols * photoWidthPx + Math.max(0, cols - 1) * gapPx : 0;
  const usedHeight = rows > 0 ? rows * photoHeightPx + Math.max(0, rows - 1) * gapPx : 0;
  const startX = marginPx + Math.max(0, usableWidth - usedWidth) / 2;
  const startY = marginPx + Math.max(0, usableHeight - usedHeight) / 2;
  const positions: GridLayout["positions"] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      positions.push({
        x: startX + col * (photoWidthPx + gapPx),
        y: startY + row * (photoHeightPx + gapPx),
      });
    }
  }

  return {
    cols,
    rows,
    photosPerSheet: cols * rows,
    sheetWidthPx,
    sheetHeightPx,
    photoWidthPx,
    photoHeightPx,
    marginPx,
    gapPx,
    photoRotated,
    sheetLandscape,
    positions,
  };
}

function outerSlackScore(layout: GridLayout): number {
  const usedWidth = layout.cols > 0
    ? layout.cols * layout.photoWidthPx + Math.max(0, layout.cols - 1) * layout.gapPx
    : 0;
  const usedHeight = layout.rows > 0
    ? layout.rows * layout.photoHeightPx + Math.max(0, layout.rows - 1) * layout.gapPx
    : 0;
  const usableWidth = layout.sheetWidthPx - layout.marginPx * 2;
  const usableHeight = layout.sheetHeightPx - layout.marginPx * 2;
  return Math.min(Math.max(0, usableWidth - usedWidth), Math.max(0, usableHeight - usedHeight));
}

function isBetterLayout(current: GridLayout, best: GridLayout): boolean {
  if (current.photosPerSheet !== best.photosPerSheet) {
    return current.photosPerSheet > best.photosPerSheet;
  }
  if (current.photoRotated !== best.photoRotated) {
    return !current.photoRotated;
  }

  const currentSlack = outerSlackScore(current);
  const bestSlack = outerSlackScore(best);
  if (currentSlack !== bestSlack) {
    return currentSlack > bestSlack;
  }

  if (current.sheetLandscape !== best.sheetLandscape) {
    return !current.sheetLandscape;
  }

  return false;
}

export function calculateGridLayout(photo: PhotoPrintSpec, sheet: PrintSheetSpec): GridLayout {
  const photoWidthPx = cmToPx(photo.widthCm, photo.dpi);
  const photoHeightPx = cmToPx(photo.heightCm, photo.dpi);
  const portraitSheetWidthPx = cmToPx(sheet.widthCm, photo.dpi);
  const portraitSheetHeightPx = cmToPx(sheet.heightCm, photo.dpi);
  const marginPx = cmToPx(sheet.marginCm, photo.dpi);
  const gapPx = cmToPx(sheet.gapCm, photo.dpi);

  const candidates = [
    buildCandidate(portraitSheetWidthPx, portraitSheetHeightPx, photoWidthPx, photoHeightPx, marginPx, gapPx, false, false),
    buildCandidate(portraitSheetWidthPx, portraitSheetHeightPx, photoHeightPx, photoWidthPx, marginPx, gapPx, true, false),
    buildCandidate(portraitSheetHeightPx, portraitSheetWidthPx, photoWidthPx, photoHeightPx, marginPx, gapPx, false, true),
    buildCandidate(portraitSheetHeightPx, portraitSheetWidthPx, photoHeightPx, photoWidthPx, marginPx, gapPx, true, true),
  ];

  return candidates.reduce((best, current) => (isBetterLayout(current, best) ? current : best));
}

function shouldAutoRotateSource(asset: PhotoAsset, printSpec: PhotoPrintSpec, autoRotateBySourceOrientation: boolean): boolean {
  if (!autoRotateBySourceOrientation) {
    return false;
  }

  const sourceLandscape = Math.max(asset.width, 1) > Math.max(asset.height, 1);
  const targetLandscape = Math.max(printSpec.widthCm, 0.001) > Math.max(printSpec.heightCm, 0.001);
  return sourceLandscape !== targetLandscape;
}

export function createDefaultCrop(
  asset: PhotoAsset,
  printSpec: PhotoPrintSpec,
  fitMode: PhotoFitMode = "cover",
  autoRotateBySourceOrientation = false,
): BatchCropState {
  const rotation = shouldAutoRotateSource(asset, printSpec, autoRotateBySourceOrientation) ? 90 : 0;

  if (fitMode === "contain") {
    return {
      assetId: asset.id,
      cropLeft: 0,
      cropTop: 0,
      cropWidth: 1,
      cropHeight: 1,
      rotation,
      reviewed: false,
    };
  }

  const targetAspect = Math.max(printSpec.widthCm, 0.001) / Math.max(printSpec.heightCm, 0.001);
  const sourceWidth = rotation !== 0 ? Math.max(asset.height, 1) : Math.max(asset.width, 1);
  const sourceHeight = rotation !== 0 ? Math.max(asset.width, 1) : Math.max(asset.height, 1);
  const sourceAspect = sourceWidth / sourceHeight;

  if (sourceAspect > targetAspect) {
    const cropWidth = clamp(targetAspect / sourceAspect, 0.02, 1);
    return {
      assetId: asset.id,
      cropLeft: (1 - cropWidth) / 2,
      cropTop: 0,
      cropWidth,
      cropHeight: 1,
      rotation,
      reviewed: false,
    };
  }

  const cropHeight = clamp(sourceAspect / targetAspect, 0.02, 1);
  return {
    assetId: asset.id,
    cropLeft: 0,
    cropTop: (1 - cropHeight) / 2,
    cropWidth: 1,
    cropHeight,
    rotation,
    reviewed: false,
  };
}

export function normalizeCrop(crop: BatchCropState): BatchCropState {
  const cropWidth = clamp(crop.cropWidth, 0.02, 1);
  const cropHeight = clamp(crop.cropHeight, 0.02, 1);
  return {
    ...crop,
    cropWidth,
    cropHeight,
    cropLeft: clamp(crop.cropLeft, 0, 1 - cropWidth),
    cropTop: clamp(crop.cropTop, 0, 1 - cropHeight),
  };
}

export function paginateAssets(assets: PhotoAsset[], layout: GridLayout): BatchPrintPage[] {
  if (layout.photosPerSheet <= 0) {
    return [];
  }

  const pages: BatchPrintPage[] = [];
  for (let index = 0; index < assets.length; index += layout.photosPerSheet) {
    const pageAssets = assets.slice(index, index + layout.photosPerSheet);
    pages.push({
      pageNumber: pages.length + 1,
      slots: pageAssets.map((asset, slotIndex) => {
        const position = layout.positions[slotIndex];
        return {
          assetId: asset.id,
          x: position.x,
          y: position.y,
          width: layout.photoWidthPx,
          height: layout.photoHeightPx,
        };
      }),
    });
  }

  return pages;
}
