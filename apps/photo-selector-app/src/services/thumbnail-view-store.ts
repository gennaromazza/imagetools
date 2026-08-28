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
const thumbnailViewListeners = new Map<string, Set<() => void>>();

function areThumbnailViewsEqual(
  left: ThumbnailViewState | undefined,
  right: ThumbnailViewState,
): boolean {
  return left?.thumbnailUrl === right.thumbnailUrl
    && left?.width === right.width
    && left?.height === right.height
    && left?.orientation === right.orientation
    && left?.aspectRatio === right.aspectRatio
    && left?.sourceFileKey === right.sourceFileKey;
}

function notifyThumbnailViewListeners(id: string): void {
  const listeners = thumbnailViewListeners.get(id);
  if (!listeners) return;
  for (const listener of Array.from(listeners)) {
    listener();
  }
}

export function getThumbnailView(id: string): ThumbnailViewState | undefined {
  return thumbnailViews.get(id);
}

export function getThumbnailViewEntries(): IterableIterator<[string, ThumbnailViewState]> {
  return thumbnailViews.entries();
}

export function subscribeThumbnailView(id: string, listener: () => void): () => void {
  let listeners = thumbnailViewListeners.get(id);
  if (!listeners) {
    listeners = new Set();
    thumbnailViewListeners.set(id, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) {
      thumbnailViewListeners.delete(id);
    }
  };
}

export function applyThumbnailViews(updates: Iterable<[string, ThumbnailViewState]>): void {
  for (const [id, view] of updates) {
    if (areThumbnailViewsEqual(thumbnailViews.get(id), view)) {
      continue;
    }
    thumbnailViews.set(id, view);
    notifyThumbnailViewListeners(id);
  }
}

export function removeThumbnailViews(ids: Iterable<string>): void {
  for (const id of ids) {
    if (thumbnailViews.delete(id)) {
      notifyThumbnailViewListeners(id);
    }
  }
}

export function clearThumbnailViews(): void {
  const ids = Array.from(thumbnailViews.keys());
  thumbnailViews.clear();
  ids.forEach(notifyThumbnailViewListeners);
}
