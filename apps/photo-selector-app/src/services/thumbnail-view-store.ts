import type { ImageAsset } from "@photo-tools/shared-types";

/**
 * Runtime thumbnail views are kept outside the React asset array so that
 * frequent preview updates do not force the whole virtualized grid to render.
 */
export type ThumbnailViewState = Pick<
  ImageAsset,
  "thumbnailUrl" | "width" | "height" | "orientation" | "aspectRatio" | "sourceFileKey"
>;

const thumbnailViews = new Map<string, ThumbnailViewState>();

export function getThumbnailView(id: string): ThumbnailViewState | undefined {
  return thumbnailViews.get(id);
}

export function getThumbnailViewEntries(): IterableIterator<[string, ThumbnailViewState]> {
  return thumbnailViews.entries();
}

export function applyThumbnailViews(updates: Iterable<[string, ThumbnailViewState]>): void {
  for (const [id, view] of updates) {
    thumbnailViews.set(id, view);
  }
}

export function removeThumbnailViews(ids: Iterable<string>): void {
  for (const id of ids) {
    thumbnailViews.delete(id);
  }
}

export function clearThumbnailViews(): void {
  thumbnailViews.clear();
}
