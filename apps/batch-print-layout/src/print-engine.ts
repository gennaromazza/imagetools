export type ExportFormat = "jpg" | "png" | "pdf" | "tif";
export type PhotoFitMode = "cover" | "contain";
export type PhotoFrameStyle = "none" | "polaroid-go";

export interface PhysicalRectCm {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const POLAROID_GO_GEOMETRY_CM = {
  outerWidth: 5.39,
  outerHeight: 6.66,
  imageWidth: 4.7,
  imageHeight: 4.6,
  imageX: 0.345,
  // La fonte ufficiale pubblica formato e area immagine, non l'offset.
  // Questo valore resta quindi un parametro esplicito del preset.
  imageY: 0.32,
} as const;

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
  frameStyle?: PhotoFrameStyle;
}

export interface PrintSheetSpec {
  presetId: string;
  label: string;
  widthCm: number;
  heightCm: number;
  marginMm: number;
  gapMm: number;
}

export interface PhotoPreset {
  presetId: string;
  label: string;
  widthCm: number;
  heightCm: number;
  description: string;
  frameStyle?: PhotoFrameStyle;
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
  /** Regolazioni percentuali non distruttive. Zero mantiene i pixel originali. */
  brightness?: number;
  contrast?: number;
  fitMode: PhotoFitMode;
  autoRotateBySourceOrientation: boolean;
  borderEnabled: boolean;
  borderWidthPx: number;
  borderColor: string;
}

export interface PrintFinishingSpec {
  cutGuidesEnabled: boolean;
  cutGuideColor: string;
  cutGuideWidthMm: number;
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
  sheetWidthCm: number;
  sheetHeightCm: number;
  photoWidthPx: number;
  photoHeightPx: number;
  marginPx: number;
  gapPx: number;
  outerMarginLeftPx: number;
  outerMarginRightPx: number;
  outerMarginTopPx: number;
  outerMarginBottomPx: number;
  photoRotated: boolean;
  sheetLandscape: boolean;
  positions: Array<{ x: number; y: number }>;
}

export interface BatchPrintPage {
  pageNumber: number;
  slots: Array<{ assetId: string; x: number; y: number; width: number; height: number }>;
}

export const SHEET_PRESETS: PrintSheetSpec[] = [
  { presetId: "10x15", label: "10x15 cm", widthCm: 10, heightCm: 15, marginMm: 3, gapMm: 1 },
  { presetId: "13x18", label: "13x18 cm", widthCm: 13, heightCm: 18, marginMm: 3, gapMm: 1 },
  { presetId: "15x20", label: "15x20 cm", widthCm: 15, heightCm: 20, marginMm: 3, gapMm: 1 },
  { presetId: "20x30", label: "20x30 cm", widthCm: 20, heightCm: 30, marginMm: 4, gapMm: 1.5 },
  { presetId: "a4", label: "A4", widthCm: 21, heightCm: 29.7, marginMm: 5, gapMm: 1.5 },
  { presetId: "a3", label: "A3", widthCm: 29.7, heightCm: 42, marginMm: 5, gapMm: 2 },
  { presetId: "letter", label: "Letter", widthCm: 21.59, heightCm: 27.94, marginMm: 5, gapMm: 1.5 },
  { presetId: "custom", label: "Personalizzato", widthCm: 10, heightCm: 15, marginMm: 3, gapMm: 1 },
];

export const PHOTO_PRESETS: PhotoPreset[] = [
  {
    presetId: "polaroid-integral",
    label: "Polaroid classica (SX-70 / 600 / i-Type / I-2 / Now / Now+ / OneStep+)",
    widthCm: 8.85,
    heightCm: 10.75,
    description: "Ingombro esterno 107,5 × 88,5 mm. La cornice interna non è applicata automaticamente perché il posizionamento non è ancora verificato nel preset.",
  },
  {
    presetId: "polaroid-round-frame",
    label: "Polaroid Round Frame",
    widthCm: 8.85,
    heightCm: 10.75,
    description: "Ingombro esterno della Polaroid classica. Il ritaglio circolare non è applicato automaticamente.",
  },
  {
    presetId: "polaroid-go",
    label: "Polaroid Go",
    widthCm: 5.39,
    heightCm: 6.66,
    description: "Formato totale 53,9 × 66,6 mm; area immagine 47 × 46 mm con cornice bianca Polaroid Go.",
    frameStyle: "polaroid-go",
  },
  {
    presetId: "instax-mini",
    label: "Fujifilm Instax Mini",
    widthCm: 5.4,
    heightCm: 8.6,
    description: "Ingombro pellicola 86 × 54 mm; cornice interna non applicata automaticamente.",
  },
  {
    presetId: "instax-square",
    label: "Fujifilm Instax SQUARE",
    widthCm: 7.2,
    heightCm: 8.6,
    description: "Ingombro pellicola 86 × 72 mm; cornice interna non applicata automaticamente.",
  },
  {
    presetId: "instax-wide",
    label: "Fujifilm Instax WIDE",
    widthCm: 10.8,
    heightCm: 8.6,
    description: "Ingombro pellicola 108 × 86 mm; cornice interna non applicata automaticamente.",
  },
  {
    presetId: "polaroid-hi-print-2x3",
    label: "Polaroid Hi-Print 2x3",
    widthCm: 5.4,
    heightCm: 8.6,
    description: "Carta adesiva 54 x 86 mm.",
  },
  {
    presetId: "polaroid-hi-print-3x3",
    label: "Polaroid Hi-Print 3x3",
    widthCm: 7.62,
    heightCm: 7.62,
    description: "Carta quadrata 76,2 x 76,2 mm.",
  },
  {
    presetId: "polaroid-hi-print-4x6",
    label: "Polaroid Hi-Print 4x6",
    widthCm: 10,
    heightCm: 14.8,
    description: "Carta 100 x 148 mm.",
  },
];

export function cmToPx(cm: number, dpi: number): number {
  if (!Number.isFinite(cm) || !Number.isFinite(dpi) || cm <= 0 || dpi <= 0) {
    return 0;
  }
  return Math.round((cm / 2.54) * dpi);
}

export function mmToPx(mm: number, dpi: number): number {
  if (!Number.isFinite(mm) || !Number.isFinite(dpi) || mm < 0 || dpi <= 0) {
    return 0;
  }
  return Math.round((mm / 25.4) * dpi);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const GRID_ROUNDING_TOLERANCE_PX = 1;

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function getPhotoContentRectCm(printSpec: PhotoPrintSpec): PhysicalRectCm {
  if (printSpec.frameStyle === "polaroid-go") {
    return {
      x: POLAROID_GO_GEOMETRY_CM.imageX,
      y: POLAROID_GO_GEOMETRY_CM.imageY,
      width: POLAROID_GO_GEOMETRY_CM.imageWidth,
      height: POLAROID_GO_GEOMETRY_CM.imageHeight,
    };
  }

  return {
    x: 0,
    y: 0,
    width: finiteNonNegative(printSpec.widthCm),
    height: finiteNonNegative(printSpec.heightCm),
  };
}

export function estimateSheetRgbaBytes(layout: GridLayout, renderDpi: number): number {
  if (!Number.isFinite(renderDpi) || renderDpi <= 0 || layout.sheetWidthCm <= 0 || layout.sheetHeightCm <= 0) {
    return 0;
  }
  return cmToPx(layout.sheetWidthCm, renderDpi) * cmToPx(layout.sheetHeightCm, renderDpi) * 4;
}

export const MAX_RENDER_RGBA_BYTES = 512 * 1024 * 1024;
export const MAX_RENDER_CANVAS_EDGE = 32767;

export function getRenderSafetyError(layout: GridLayout, renderDpi: number): string | null {
  const width = cmToPx(layout.sheetWidthCm, renderDpi);
  const height = cmToPx(layout.sheetHeightCm, renderDpi);
  if (width <= 0 || height <= 0) {
    return "Dimensioni del foglio o DPI non validi.";
  }
  if (width > MAX_RENDER_CANVAS_EDGE || height > MAX_RENDER_CANVAS_EDGE) {
    return `Il foglio richiede ${width}×${height} px e supera il limite di ${MAX_RENDER_CANVAS_EDGE} px per lato.`;
  }
  const rgbaBytes = estimateSheetRgbaBytes(layout, renderDpi);
  if (rgbaBytes > MAX_RENDER_RGBA_BYTES) {
    const requiredMb = Math.ceil(rgbaBytes / (1024 * 1024));
    const limitMb = Math.floor(MAX_RENDER_RGBA_BYTES / (1024 * 1024));
    return `Il foglio richiede circa ${requiredMb} MB per il solo canvas, oltre il limite sicuro di ${limitMb} MB.`;
  }
  return null;
}

export function getPreviewRenderDpi(layout: GridLayout, printDpi: number, maxLongEdgePx = 1400): number {
  const longEdge = Math.max(layout.sheetWidthPx, layout.sheetHeightPx, 1);
  const scale = Math.min(1, Math.max(1, maxLongEdgePx) / longEdge);
  return Math.max(36, Math.min(printDpi, printDpi * scale));
}

function countSlots(usableSize: number, itemSize: number, gapPx: number): number {
  if (usableSize <= 0 || itemSize <= 0) {
    return 0;
  }
  return Math.max(0, Math.floor((usableSize + gapPx + GRID_ROUNDING_TOLERANCE_PX) / (itemSize + gapPx)));
}

function buildCandidate(
  sheetWidthPx: number,
  sheetHeightPx: number,
  sheetWidthCm: number,
  sheetHeightCm: number,
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
    sheetWidthCm,
    sheetHeightCm,
    photoWidthPx,
    photoHeightPx,
    marginPx,
    gapPx,
    outerMarginLeftPx: startX,
    outerMarginRightPx: Math.max(0, sheetWidthPx - (startX + usedWidth)),
    outerMarginTopPx: startY,
    outerMarginBottomPx: Math.max(0, sheetHeightPx - (startY + usedHeight)),
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
  const dpi = Number.isFinite(photo.dpi) && photo.dpi > 0 ? photo.dpi : 0;
  const photoWidthPx = cmToPx(photo.widthCm, dpi);
  const photoHeightPx = cmToPx(photo.heightCm, dpi);
  const portraitSheetWidthPx = cmToPx(sheet.widthCm, dpi);
  const portraitSheetHeightPx = cmToPx(sheet.heightCm, dpi);
  const marginPx = mmToPx(finiteNonNegative(sheet.marginMm), dpi);
  const gapPx = mmToPx(finiteNonNegative(sheet.gapMm), dpi);

  const candidates = [
    buildCandidate(portraitSheetWidthPx, portraitSheetHeightPx, sheet.widthCm, sheet.heightCm, photoWidthPx, photoHeightPx, marginPx, gapPx, false, false),
    buildCandidate(portraitSheetWidthPx, portraitSheetHeightPx, sheet.widthCm, sheet.heightCm, photoHeightPx, photoWidthPx, marginPx, gapPx, true, false),
    buildCandidate(portraitSheetHeightPx, portraitSheetWidthPx, sheet.heightCm, sheet.widthCm, photoWidthPx, photoHeightPx, marginPx, gapPx, false, true),
    buildCandidate(portraitSheetHeightPx, portraitSheetWidthPx, sheet.heightCm, sheet.widthCm, photoHeightPx, photoWidthPx, marginPx, gapPx, true, true),
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
  rotationOverride?: number,
): BatchCropState {
  const rotation = Number.isFinite(rotationOverride)
    ? ((rotationOverride! % 360) + 360) % 360
    : shouldAutoRotateSource(asset, printSpec, autoRotateBySourceOrientation) ? 90 : 0;

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

  const contentRect = getPhotoContentRectCm(printSpec);
  const targetWidthCm = contentRect.width;
  const targetHeightCm = contentRect.height;
  const targetAspect = Math.max(targetWidthCm, 0.001) / Math.max(targetHeightCm, 0.001);
  const quarterTurn = Math.abs(rotation) % 180 === 90;
  const sourceWidth = quarterTurn ? Math.max(asset.height, 1) : Math.max(asset.width, 1);
  const sourceHeight = quarterTurn ? Math.max(asset.width, 1) : Math.max(asset.height, 1);
  const sourceAspect = sourceWidth / sourceHeight;

  let logicalCropWidth = 1;
  let logicalCropHeight = 1;

  if (sourceAspect > targetAspect) {
    logicalCropWidth = clamp(targetAspect / sourceAspect, 0.02, 1);
  } else {
    logicalCropHeight = clamp(sourceAspect / targetAspect, 0.02, 1);
  }

  // Il crop e' memorizzato sempre sugli assi originali del file. Dopo una
  // rotazione di 90/270 gradi, larghezza e altezza logiche vanno scambiate.
  const cropWidth = quarterTurn ? logicalCropHeight : logicalCropWidth;
  const cropHeight = quarterTurn ? logicalCropWidth : logicalCropHeight;
  return {
    assetId: asset.id,
    cropLeft: (1 - cropWidth) / 2,
    cropTop: (1 - cropHeight) / 2,
    cropWidth,
    cropHeight,
    rotation,
    reviewed: false,
  };
}

export function normalizeCrop(crop: BatchCropState): BatchCropState {
  const cropWidth = clamp(Number.isFinite(crop.cropWidth) ? crop.cropWidth : 1, 0.02, 1);
  const cropHeight = clamp(Number.isFinite(crop.cropHeight) ? crop.cropHeight : 1, 0.02, 1);
  const cropLeft = Number.isFinite(crop.cropLeft) ? crop.cropLeft : (1 - cropWidth) / 2;
  const cropTop = Number.isFinite(crop.cropTop) ? crop.cropTop : (1 - cropHeight) / 2;
  return {
    ...crop,
    cropWidth,
    cropHeight,
    cropLeft: clamp(cropLeft, 0, 1 - cropWidth),
    cropTop: clamp(cropTop, 0, 1 - cropHeight),
    rotation: Number.isFinite(crop.rotation) ? crop.rotation : 0,
  };
}

export function getCenteredPagePositions(layout: GridLayout, itemCount: number): GridLayout["positions"] {
  const count = Math.max(0, Math.min(Math.floor(itemCount), layout.photosPerSheet));
  if (count === 0) return [];
  if (count === layout.photosPerSheet) return layout.positions.slice(0, count);

  let bestColumns = 1;
  let bestRows = count;
  let bestScore = Number.POSITIVE_INFINITY;
  const sheetAspect = layout.sheetWidthPx / Math.max(1, layout.sheetHeightPx);

  for (let columns = 1; columns <= Math.min(layout.cols, count); columns += 1) {
    const rows = Math.ceil(count / columns);
    if (rows > layout.rows) continue;
    const emptySlots = columns * rows - count;
    const blockWidth = columns * layout.photoWidthPx + Math.max(0, columns - 1) * layout.gapPx;
    const blockHeight = rows * layout.photoHeightPx + Math.max(0, rows - 1) * layout.gapPx;
    const blockAspect = blockWidth / Math.max(1, blockHeight);
    const aspectPenalty = Math.abs(Math.log(Math.max(0.001, blockAspect / Math.max(0.001, sheetAspect))));
    const score = emptySlots * 100 + aspectPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestColumns = columns;
      bestRows = rows;
    }
  }

  const blockHeight = bestRows * layout.photoHeightPx + Math.max(0, bestRows - 1) * layout.gapPx;
  const startY = (layout.sheetHeightPx - blockHeight) / 2;
  const positions: GridLayout["positions"] = [];

  for (let row = 0; row < bestRows; row += 1) {
    const remaining = count - positions.length;
    const itemsInRow = Math.min(bestColumns, remaining);
    const rowWidth = itemsInRow * layout.photoWidthPx + Math.max(0, itemsInRow - 1) * layout.gapPx;
    const startX = (layout.sheetWidthPx - rowWidth) / 2;
    for (let column = 0; column < itemsInRow; column += 1) {
      positions.push({
        x: startX + column * (layout.photoWidthPx + layout.gapPx),
        y: startY + row * (layout.photoHeightPx + layout.gapPx),
      });
    }
  }

  return positions;
}

export function paginateAssets(assets: PhotoAsset[], layout: GridLayout): BatchPrintPage[] {
  if (layout.photosPerSheet <= 0) {
    return [];
  }

  const pages: BatchPrintPage[] = [];
  for (let index = 0; index < assets.length; index += layout.photosPerSheet) {
    const pageAssets = assets.slice(index, index + layout.photosPerSheet);
    const pagePositions = getCenteredPagePositions(layout, pageAssets.length);
    pages.push({
      pageNumber: pages.length + 1,
      slots: pageAssets.map((asset, slotIndex) => {
        const position = pagePositions[slotIndex];
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
