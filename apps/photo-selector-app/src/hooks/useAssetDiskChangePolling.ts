import { useEffect } from "react";
import type { ImageAsset } from "@photo-tools/shared-types";
import { detectChangedAssetsOnDisk, type AssetDiskChange } from "../services/folder-access";

interface UseAssetDiskChangePollingOptions {
  photos: ImageAsset[];
  observedIds: string[];
  onPhotosChange?: (photos: ImageAsset[]) => void;
  onDetectedChanges?: (changes: AssetDiskChange[]) => void;
  intervalMs?: number;
}

export function useAssetDiskChangePolling({
  photos,
  observedIds,
  onPhotosChange,
  onDetectedChanges,
  intervalMs = 4000,
}: UseAssetDiskChangePollingOptions): void {
  useEffect(() => {
    if (!onPhotosChange) {
      return;
    }

    let disposed = false;
    let running = false;

    const run = async () => {
      if (running || disposed) {
        return;
      }
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }

      const targets = Array.from(new Set(observedIds)).filter((id) => id.trim().length > 0);
      if (targets.length === 0) {
        return;
      }

      running = true;
      try {
        const changes = await detectChangedAssetsOnDisk(targets);
        if (disposed || changes.length === 0) {
          return;
        }

        const byId = new Map(changes.map((change) => [change.id, change]));
        const next = photos.map((asset) => {
          const change = byId.get(asset.id);
          if (!change) {
            return asset;
          }

          return {
            ...asset,
            sourceFileKey: change.sourceFileKey,
            thumbnailUrl: change.thumbnailUrl ?? asset.thumbnailUrl,
            previewUrl: change.previewUrl ?? asset.previewUrl,
            sourceUrl: change.sourceUrl ?? asset.sourceUrl,
            width: change.width ?? asset.width,
            height: change.height ?? asset.height,
            orientation: change.orientation ?? asset.orientation,
            aspectRatio: change.aspectRatio ?? asset.aspectRatio,
          };
        });

        onPhotosChange(next);
        onDetectedChanges?.(changes);
      } finally {
        running = false;
      }
    };

    const timer = window.setInterval(() => {
      void run();
    }, intervalMs);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [intervalMs, observedIds, onDetectedChanges, onPhotosChange, photos]);
}
