export interface PreviewSurfaceSize {
  width: number;
  height: number;
}

export function fitPreviewSurface(
  availableWidth: number,
  availableHeight: number,
  aspectRatio: number,
  maxWidth = 760,
): PreviewSurfaceSize {
  const safeWidth = Number.isFinite(availableWidth) ? Math.max(0, availableWidth) : 0;
  const safeHeight = Number.isFinite(availableHeight) ? Math.max(0, availableHeight) : 0;
  const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const safeMaxWidth = Number.isFinite(maxWidth) ? Math.max(0, maxWidth) : safeWidth;

  const width = Math.min(safeWidth, safeMaxWidth, safeHeight * safeAspectRatio);
  return {
    width,
    height: width / safeAspectRatio,
  };
}
