import type { BatchCropState } from "@photo-tools/batch-print-layout/print-engine";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function orthogonalRotation(value: number): 0 | 90 | 180 | 270 {
  const normalized = ((value % 360) + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) return normalized;
  return 0;
}

export function displayedCropPosition(crop: BatchCropState): { horizontal: number; vertical: number } {
  const sourceX = crop.cropLeft + crop.cropWidth / 2;
  const sourceY = crop.cropTop + crop.cropHeight / 2;
  switch (orthogonalRotation(crop.rotation)) {
    case 90: return { horizontal: 1 - sourceY, vertical: sourceX };
    case 180: return { horizontal: 1 - sourceX, vertical: 1 - sourceY };
    case 270: return { horizontal: sourceY, vertical: 1 - sourceX };
    default: return { horizontal: sourceX, vertical: sourceY };
  }
}

export function moveCropInDisplayedAxes(
  crop: BatchCropState,
  axis: "horizontal" | "vertical",
  value: number,
): Pick<BatchCropState, "cropLeft" | "cropTop"> {
  const displayed = displayedCropPosition(crop);
  const horizontal = axis === "horizontal" ? clamp(value, 0, 1) : displayed.horizontal;
  const vertical = axis === "vertical" ? clamp(value, 0, 1) : displayed.vertical;
  let sourceX = horizontal;
  let sourceY = vertical;
  switch (orthogonalRotation(crop.rotation)) {
    case 90:
      sourceX = vertical;
      sourceY = 1 - horizontal;
      break;
    case 180:
      sourceX = 1 - horizontal;
      sourceY = 1 - vertical;
      break;
    case 270:
      sourceX = 1 - vertical;
      sourceY = horizontal;
      break;
  }
  return {
    cropLeft: clamp(sourceX - crop.cropWidth / 2, 0, 1 - crop.cropWidth),
    cropTop: clamp(sourceY - crop.cropHeight / 2, 0, 1 - crop.cropHeight),
  };
}
