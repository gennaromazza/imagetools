import { useCallback, useSyncExternalStore } from "react";
import {
  getThumbnailView,
  subscribeThumbnailView,
  type ThumbnailViewState,
} from "./thumbnail-view-store";

export function useThumbnailView(id: string | null | undefined): ThumbnailViewState | undefined {
  const subscribe = useCallback((listener: () => void) => (
    id ? subscribeThumbnailView(id, listener) : () => {}
  ), [id]);
  const getSnapshot = useCallback(() => (id ? getThumbnailView(id) : undefined), [id]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
