import type { ImageAsset, ImageRotation } from "@photo-tools/shared-types";

export type RotationDirection = "left" | "right";

export function normalizeImageRotation(value: unknown): ImageRotation {
  const numericValue = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const normalized = ((Math.round(numericValue / 90) * 90) % 360 + 360) % 360;
  return normalized as ImageRotation;
}

export function getAssetRotation(asset: Pick<ImageAsset, "rotationDegrees">): ImageRotation {
  return normalizeImageRotation(asset.rotationDegrees);
}

export function rotateImage(
  currentRotation: unknown,
  direction: RotationDirection = "right",
): ImageRotation {
  const delta = direction === "left" ? -90 : 90;
  return normalizeImageRotation(normalizeImageRotation(currentRotation) + delta);
}

export function isQuarterTurn(rotation: unknown): boolean {
  const normalized = normalizeImageRotation(rotation);
  return normalized === 90 || normalized === 270;
}

export function getRotatedContentFitScale(
  containerWidth: number,
  containerHeight: number,
  contentWidth: number,
  contentHeight: number,
  rotation: unknown,
): number {
  if (
    !isQuarterTurn(rotation)
    || containerWidth <= 0
    || containerHeight <= 0
    || contentWidth <= 0
    || contentHeight <= 0
  ) {
    return 1;
  }

  const originalFit = Math.min(containerWidth / contentWidth, containerHeight / contentHeight);
  const rotatedFit = Math.min(containerWidth / contentHeight, containerHeight / contentWidth);
  return rotatedFit / originalFit;
}
