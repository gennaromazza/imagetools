export type ExportFormat = "jpg" | "png" | "pdf" | "tif";
export type PhotoFitMode = "cover" | "contain";
export type SheetOrientation = "auto" | "portrait" | "landscape";
export type PhotoFrameStyle = "none" | "polaroid-go" | "polaroid-classic" | "instax-mini" | "instax-square" | "instax-wide";

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

export interface FrameGeometryCm {
  outerWidth: number;
  outerHeight: number;
  imageX: number;
  imageY: number;
  imageWidth: number;
  imageHeight: number;
}

/**
 * Cornice delle pellicole istantanee: l'immagine sta in alto e il bordo basso è più ampio.
 * Ingombro esterno e area immagine vengono dalle schede ufficiali dei produttori;
 * la distanza dal bordo superiore (imageY) non è pubblicata ed è una stima ragionevole,
 * esattamente come per Polaroid Go. L'immagine è centrata in orizzontale.
 */
export const FRAME_GEOMETRY_CM: Record<Exclude<PhotoFrameStyle, "none">, FrameGeometryCm> = {
  "polaroid-go": { ...POLAROID_GO_GEOMETRY_CM },
  "polaroid-classic": { outerWidth: 8.85, outerHeight: 10.75, imageWidth: 7.9, imageHeight: 7.9, imageX: 0.475, imageY: 0.6 },
  "instax-mini": { outerWidth: 5.4, outerHeight: 8.6, imageWidth: 4.6, imageHeight: 6.2, imageX: 0.4, imageY: 0.5 },
  "instax-square": { outerWidth: 7.2, outerHeight: 8.6, imageWidth: 6.2, imageHeight: 6.2, imageX: 0.5, imageY: 0.5 },
  "instax-wide": { outerWidth: 10.8, outerHeight: 8.6, imageWidth: 9.9, imageHeight: 6.2, imageX: 0.45, imageY: 0.5 },
};

export function getFrameGeometry(frameStyle: PhotoFrameStyle | undefined): FrameGeometryCm | null {
  return frameStyle && frameStyle !== "none" ? FRAME_GEOMETRY_CM[frameStyle] : null;
}

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
  /** Orientamento del foglio: "auto" sceglie quello che contiene più foto. Se assente equivale a "auto". */
  orientation?: SheetOrientation;
}

export interface PhotoPreset {
  presetId: string;
  label: string;
  widthCm: number;
  heightCm: number;
  description: string;
  frameStyle?: PhotoFrameStyle;
  /** Il formato è anche un supporto reale (carta adesiva): si può usare come foglio, una foto per foglio. */
  media?: boolean;
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
    description: "Pellicola 88,5 × 107,5 mm con area immagine 79 × 79 mm: foto in alto e bordo inferiore ampio, come la vera Polaroid. La distanza dal bordo superiore è una stima.",
    frameStyle: "polaroid-classic",
  },
  {
    presetId: "polaroid-round-frame",
    label: "Polaroid Round Frame",
    widthCm: 8.85,
    heightCm: 10.75,
    description: "Stessa pellicola della Polaroid classica (foto in alto, bordo inferiore ampio). La finestra circolare non è riprodotta: l'immagine resta quadrata.",
    frameStyle: "polaroid-classic",
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
    description: "Pellicola 54 × 86 mm con area immagine 46 × 62 mm e bordo inferiore ampio. La distanza dal bordo superiore è una stima.",
    frameStyle: "instax-mini",
  },
  {
    presetId: "instax-square",
    label: "Fujifilm Instax SQUARE",
    widthCm: 7.2,
    heightCm: 8.6,
    description: "Pellicola 72 × 86 mm con area immagine 62 × 62 mm e bordo inferiore ampio. La distanza dal bordo superiore è una stima.",
    frameStyle: "instax-square",
  },
  {
    presetId: "instax-wide",
    label: "Fujifilm Instax WIDE",
    widthCm: 10.8,
    heightCm: 8.6,
    description: "Pellicola 108 × 86 mm con area immagine 99 × 62 mm e bordo inferiore ampio. La distanza dal bordo superiore è una stima.",
    frameStyle: "instax-wide",
  },
  {
    presetId: "polaroid-hi-print-2x3",
    label: "Polaroid Hi-Print 2x3",
    widthCm: 5.4,
    heightCm: 8.6,
    description: "Carta adesiva 54 x 86 mm.",
    media: true,
  },
  {
    presetId: "polaroid-hi-print-3x3",
    label: "Polaroid Hi-Print 3x3",
    widthCm: 7.62,
    heightCm: 7.62,
    description: "Carta quadrata 76,2 x 76,2 mm.",
    media: true,
  },
  {
    presetId: "polaroid-hi-print-4x6",
    label: "Polaroid Hi-Print 4x6",
    widthCm: 10,
    heightCm: 14.8,
    description: "Carta 100 x 148 mm.",
    media: true,
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
  const frame = getFrameGeometry(printSpec.frameStyle);
  if (frame) {
    return { x: frame.imageX, y: frame.imageY, width: frame.imageWidth, height: frame.imageHeight };
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

  const orientation = sheet.orientation ?? "auto";
  const allowed = candidates.filter((candidate) => {
    if (orientation === "portrait") return candidate.sheetWidthCm <= candidate.sheetHeightCm;
    if (orientation === "landscape") return candidate.sheetWidthCm >= candidate.sheetHeightCm;
    return true;
  });

  return allowed.reduce((best, current) => (isBetterLayout(current, best) ? current : best));
}

export function photoFitsSheet(photo: PhotoPrintSpec, sheet: PrintSheetSpec): boolean {
  return calculateGridLayout(photo, sheet).photosPerSheet > 0;
}

/**
 * Riduce proporzionalmente la foto finché entra nel foglio (margini inclusi).
 * Restituisce la misura invariata se già compatibile.
 */
export function shrinkPhotoToFitSheet<T extends PhotoPrintSpec>(photo: T, sheet: PrintSheetSpec): T {
  if (photoFitsSheet(photo, sheet)) return photo;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step += 1) {
    const mid = (low + high) / 2;
    const candidate = { ...photo, widthCm: photo.widthCm * mid, heightCm: photo.heightCm * mid };
    if (photoFitsSheet(candidate, sheet)) low = mid;
    else high = mid;
  }
  const floor2 = (value: number) => Math.max(0.1, Math.floor(value * low * 100) / 100);
  return { ...photo, widthCm: floor2(photo.widthCm), heightCm: floor2(photo.heightCm) };
}

export interface PhotoCountAspect {
  id: string;
  label: string;
  /** larghezza / altezza; null = la foto riempie tutta la cella disponibile. */
  ratio: number | null;
}

export const PHOTO_COUNT_ASPECTS: PhotoCountAspect[] = [
  { id: "free", label: "Libero (riempie lo spazio)", ratio: null },
  { id: "3:2", label: "3:2 (foto classica)", ratio: 3 / 2 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "5:4", label: "5:4", ratio: 5 / 4 },
  { id: "1:1", label: "1:1 (quadrata)", ratio: 1 },
];

export interface PhotoCountResult {
  widthCm: number;
  heightCm: number;
  cols: number;
  rows: number;
}

/**
 * Misura più grande possibile per far stare esattamente `count` foto su ogni
 * foglio, rispettando orientamento, margini e distanza impostati.
 */
/** Rapporto massimo lato lungo/corto accettato per le foto con proporzioni libere. */
const FREE_MAX_CELL_ASPECT = 2;

export function calculatePhotoSizeForCount(
  sheet: PrintSheetSpec,
  count: number,
  ratio: number | null,
): PhotoCountResult | null {
  const total = Math.floor(count);
  if (!Number.isFinite(total) || total < 1 || total > 200) return null;
  const orientation = sheet.orientation ?? "auto";
  const margin = finiteNonNegative(sheet.marginMm) / 10;
  const gap = finiteNonNegative(sheet.gapMm) / 10;
  const sheets: Array<[number, number]> = [];
  const portrait: [number, number] = [Math.min(sheet.widthCm, sheet.heightCm), Math.max(sheet.widthCm, sheet.heightCm)];
  if (orientation !== "landscape") sheets.push(portrait);
  if (orientation !== "portrait") sheets.push([portrait[1], portrait[0]]);

  // Con proporzioni libere l'area massima premia strisce (es. 6 foto 21×5 cm): si preferiscono
  // celle con rapporto lato lungo/corto fino a 2, e solo se non esistono si accetta altro.
  let best: PhotoCountResult | null = null;
  let bestArea = 0;
  let bestReasonable: PhotoCountResult | null = null;
  let bestReasonableArea = 0;
  for (const [width, height] of sheets) {
    const usableWidth = width - margin * 2;
    const usableHeight = height - margin * 2;
    for (let cols = 1; cols <= total; cols += 1) {
      // Ammette celle vuote (es. 5 foto in 2x3) purché nessuna riga o colonna resti vuota.
      const rows = Math.ceil(total / cols);
      const empty = cols * rows - total;
      if (empty >= cols || empty >= rows) continue;
      const cellWidth = (usableWidth - (cols - 1) * gap) / cols;
      const cellHeight = (usableHeight - (rows - 1) * gap) / rows;
      if (cellWidth <= 0 || cellHeight <= 0) continue;
      const shapes: Array<[number, number]> = [];
      if (ratio === null) {
        shapes.push([cellWidth, cellHeight]);
      } else {
        for (const r of [ratio, 1 / ratio]) {
          const w = Math.min(cellWidth, cellHeight * r);
          shapes.push([w, w / r]);
        }
      }
      for (const [w, h] of shapes) {
        const area = w * h;
        if (area > bestArea + 1e-9) {
          bestArea = area;
          best = { widthCm: w, heightCm: h, cols, rows };
        }
        const aspect = Math.max(w, h) / Math.max(0.001, Math.min(w, h));
        if (ratio !== null || aspect <= FREE_MAX_CELL_ASPECT) {
          if (area > bestReasonableArea + 1e-9) {
            bestReasonableArea = area;
            bestReasonable = { widthCm: w, heightCm: h, cols, rows };
          }
        }
      }
    }
  }
  best = bestReasonable ?? best;
  if (!best) return null;

  // Arrotonda per difetto al centesimo di cm e verifica con il motore reale
  // (tolleranze di pixel incluse) che ci stiano davvero `count` foto.
  let widthCm = Math.floor(best.widthCm * 100) / 100;
  let heightCm = Math.floor(best.heightCm * 100) / 100;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const layout = calculateGridLayout({ widthCm, heightCm, dpi: 300 }, sheet);
    if (layout.photosPerSheet >= total) break;
    widthCm = Math.max(0.1, Math.round((widthCm - 0.01) * 100) / 100);
    heightCm = Math.max(0.1, Math.round((heightCm - 0.01) * 100) / 100);
  }
  return { ...best, widthCm, heightCm };
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

export function paginateAssets(assets: PhotoAsset[], layout: GridLayout, maxPerPage?: number): BatchPrintPage[] {
  if (layout.photosPerSheet <= 0) {
    return [];
  }

  const perPage = maxPerPage && maxPerPage > 0
    ? Math.min(Math.floor(maxPerPage), layout.photosPerSheet)
    : layout.photosPerSheet;
  const pages: BatchPrintPage[] = [];
  for (let index = 0; index < assets.length; index += perPage) {
    const pageAssets = assets.slice(index, index + perPage);
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
