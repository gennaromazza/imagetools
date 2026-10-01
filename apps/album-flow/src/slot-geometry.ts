import type { FitMode, GeneratedPageLayout, LayoutAssignment, LayoutSlot, SheetSpec } from "@photo-tools/shared-types";

/** Rettangolo in millimetri, origine nell'angolo in alto a sinistra della pagina (abbondanza esclusa). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CropRect {
  cropLeft: number;
  cropTop: number;
  cropWidth: number;
  cropHeight: number;
}

export const MAX_CROP_ZOOM = 6;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function pageSizeMm(sheet: Pick<SheetSpec, "widthCm" | "heightCm">): { width: number; height: number } {
  return { width: sheet.widthCm * 10, height: sheet.heightCm * 10 };
}

/**
 * Rettangolo di uno slot. Gli slot dei template sono frazioni dell'area utile (pagina meno i margini);
 * quando la pagina ha più slot, ciascuno è rimpicciolito di metà interspazio per lato, come fa il motore di layout.
 */
export function slotRectMm(
  page: Pick<GeneratedPageLayout, "sheetSpec" | "slotDefinitions">,
  slot: Pick<LayoutSlot, "x" | "y" | "width" | "height">,
): Rect {
  const { width, height } = pageSizeMm(page.sheetSpec);
  const margin = Math.max(0, page.sheetSpec.marginCm ?? 0) * 10;
  const contentW = Math.max(0, width - margin * 2);
  const contentH = Math.max(0, height - margin * 2);
  let rect: Rect = {
    x: margin + slot.x * contentW,
    y: margin + slot.y * contentH,
    w: slot.width * contentW,
    h: slot.height * contentH,
  };
  if (page.slotDefinitions.length > 1 && (page.sheetSpec.gapCm ?? 0) > 0) {
    const insetX = Math.min((page.sheetSpec.gapCm * 10) / 2, rect.w / 3);
    const insetY = Math.min((page.sheetSpec.gapCm * 10) / 2, rect.h / 3);
    rect = { x: rect.x + insetX, y: rect.y + insetY, w: rect.w - insetX * 2, h: rect.h - insetY * 2 };
  }
  return rect;
}

export function assertFiniteRect(rect: Rect): Rect {
  if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) || rect.w <= 0 || rect.h <= 0) {
    throw new Error("Geometria slot non valida.");
  }
  return rect;
}

/** Ritaglio centrato che riempie lo slot (zoom 1). */
export function baseCrop(imageAspect: number, slotAspect: number): CropRect {
  const image = Math.max(imageAspect, 0.01);
  const slot = Math.max(slotAspect, 0.01);
  if (image > slot) {
    const cropWidth = slot / image;
    return { cropLeft: (1 - cropWidth) / 2, cropTop: 0, cropWidth, cropHeight: 1 };
  }
  const cropHeight = image / slot;
  return { cropLeft: 0, cropTop: (1 - cropHeight) / 2, cropWidth: 1, cropHeight };
}

/** Ritaglio per un livello di zoom e un centro normalizzato (0-1) nell'immagine; resta sempre dentro l'immagine. */
export function cropForView(imageAspect: number, slotAspect: number, zoom: number, centerX: number, centerY: number): CropRect {
  const base = baseCrop(imageAspect, slotAspect);
  const z = clamp(Number.isFinite(zoom) ? zoom : 1, 1, MAX_CROP_ZOOM);
  const cropWidth = base.cropWidth / z;
  const cropHeight = base.cropHeight / z;
  return {
    cropLeft: clamp(centerX - cropWidth / 2, 0, 1 - cropWidth),
    cropTop: clamp(centerY - cropHeight / 2, 0, 1 - cropHeight),
    cropWidth,
    cropHeight,
  };
}

export function cropCenter(crop: CropRect): { x: number; y: number } {
  return { x: crop.cropLeft + crop.cropWidth / 2, y: crop.cropTop + crop.cropHeight / 2 };
}

/**
 * Ritaglio effettivo di un'assegnazione: intero per "fit"; altrimenti deriva da zoom e centro salvati,
 * ricalcolati sull'aspetto reale dello slot così l'immagine non si deforma mai.
 */
export function effectiveCrop(
  assignment: Pick<LayoutAssignment, "fitMode" | "zoom" | "cropLeft" | "cropTop" | "cropWidth" | "cropHeight">,
  imageAspect: number,
  slotAspect: number,
): CropRect {
  if (assignment.fitMode === "fit") return { cropLeft: 0, cropTop: 0, cropWidth: 1, cropHeight: 1 };
  const { cropLeft, cropTop, cropWidth, cropHeight } = assignment;
  const stored = [cropLeft, cropTop, cropWidth, cropHeight].every((value) => typeof value === "number" && Number.isFinite(value));
  const centerX = stored ? (cropLeft as number) + (cropWidth as number) / 2 : 0.5;
  const centerY = stored ? (cropTop as number) + (cropHeight as number) / 2 : 0.5;
  return cropForView(imageAspect, slotAspect, assignment.zoom || 1, centerX, centerY);
}

/** Posizione dell'immagine intera rispetto allo slot, in millimetri (può sporgere: va ritagliata dallo slot). */
export function imageRectInSlot(slotRect: Rect, crop: CropRect, fitMode: FitMode, imageAspect: number): Rect {
  if (fitMode === "fit") {
    const aspect = Math.max(imageAspect, 0.01);
    const slotAspect = slotRect.w / slotRect.h;
    const w = aspect > slotAspect ? slotRect.w : slotRect.h * aspect;
    const h = aspect > slotAspect ? slotRect.w / aspect : slotRect.h;
    return { x: slotRect.x + (slotRect.w - w) / 2, y: slotRect.y + (slotRect.h - h) / 2, w, h };
  }
  const w = slotRect.w / crop.cropWidth;
  const h = slotRect.h / crop.cropHeight;
  return { x: slotRect.x - crop.cropLeft * w, y: slotRect.y - crop.cropTop * h, w, h };
}

/** Zoom percepito (1 = riempie lo slot) ricavato dal ritaglio corrente. */
export function zoomOfCrop(crop: CropRect, imageAspect: number, slotAspect: number): number {
  const base = baseCrop(imageAspect, slotAspect);
  return clamp(base.cropWidth / Math.max(crop.cropWidth, 1e-6), 1, MAX_CROP_ZOOM);
}

/** Risoluzione effettiva in dpi di una foto nello slot (pixel dell'originale visibili / pollici dello slot). */
export function effectiveDpi(assetWidthPx: number, assetHeightPx: number, crop: CropRect, slotRect: Rect): number {
  if (!assetWidthPx || !assetHeightPx) return Infinity;
  const visiblePx = assetWidthPx * crop.cropWidth;
  const slotInches = slotRect.w / 25.4;
  return slotInches > 0 ? visiblePx / slotInches : Infinity;
}
