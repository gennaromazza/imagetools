export const MIN_CROP_ZOOM = 100;
export const MAX_CROP_ZOOM = 300;

export type CropTransform = {
  /** Horizontal pan as a fraction of the maximum available cover-crop overflow. */
  offsetX: number;
  /** Vertical pan as a fraction of the maximum available cover-crop overflow. */
  offsetY: number;
  /** Cover zoom percentage. Values below 100 would expose empty canvas. */
  zoom: number;
};

export type CropMetrics = {
  renderedWidth: number;
  renderedHeight: number;
  maxOffsetX: number;
  maxOffsetY: number;
  translationX: number;
  translationY: number;
};

export type CropDimensions = {
  width: number;
  height: number;
};

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function clampNormalizedOffset(value: unknown): number {
  return Math.max(-1, Math.min(1, finiteOr(value, 0)));
}

export function clampCropZoom(value: unknown): number {
  return Math.max(MIN_CROP_ZOOM, Math.min(MAX_CROP_ZOOM, finiteOr(value, MIN_CROP_ZOOM)));
}

export function normalizeCropTransform(
  crop: Partial<CropTransform> | null | undefined
): CropTransform {
  return {
    offsetX: clampNormalizedOffset(crop?.offsetX),
    offsetY: clampNormalizedOffset(crop?.offsetY),
    zoom: clampCropZoom(crop?.zoom),
  };
}

export function getCoverCropMetrics(
  source: CropDimensions,
  viewport: CropDimensions,
  crop: Partial<CropTransform>
): CropMetrics | null {
  if (
    !Number.isFinite(source.width) ||
    !Number.isFinite(source.height) ||
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    source.width <= 0 ||
    source.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return null;
  }

  const normalizedCrop = normalizeCropTransform(crop);
  const coverScale = Math.max(viewport.width / source.width, viewport.height / source.height);
  const scale = coverScale * (normalizedCrop.zoom / 100);
  const renderedWidth = source.width * scale;
  const renderedHeight = source.height * scale;
  const maxOffsetX = Math.max(0, (renderedWidth - viewport.width) / 2);
  const maxOffsetY = Math.max(0, (renderedHeight - viewport.height) / 2);

  return {
    renderedWidth,
    renderedHeight,
    maxOffsetX,
    maxOffsetY,
    translationX: normalizedCrop.offsetX * maxOffsetX,
    translationY: normalizedCrop.offsetY * maxOffsetY,
  };
}

export function pixelsToNormalizedOffset(pixels: number, maxOffset: number): number {
  if (!Number.isFinite(maxOffset) || maxOffset <= 0) {
    return 0;
  }

  return clampNormalizedOffset(pixels / maxOffset);
}

export function normalizedOffsetToPixels(offset: number, maxOffset: number): number {
  if (!Number.isFinite(maxOffset) || maxOffset <= 0) {
    return 0;
  }

  return clampNormalizedOffset(offset) * maxOffset;
}
