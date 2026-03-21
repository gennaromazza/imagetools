import type { ImageAsset, ImageOrientation, PickStatus } from "@photo-tools/shared-types";

/**
 * Output standardizzato della selezione foto.
 * Pensato per essere consumato dal Wedding Workflow Orchestrator
 * o da altri tool della suite (auto-layout, image-party-frame, ecc.).
 */
export interface SelectionResult {
  projectId: string;
  projectName: string;
  selectedAssets: ImageAsset[];
  rejectedAssetIds: string[];
  totalImported: number;
  selectionDate: string;
  metadata: {
    ratingDistribution: Record<number, number>;
    pickStatusCounts: Record<PickStatus | "unmarked", number>;
    orientationCounts: Record<ImageOrientation, number>;
  };
}

export function buildSelectionResult(
  projectId: string,
  projectName: string,
  allAssets: ImageAsset[],
  activeAssetIds: string[]
): SelectionResult {
  const activeSet = new Set(activeAssetIds);
  const selectedAssets = allAssets.filter((a) => activeSet.has(a.id));
  const rejectedAssetIds = allAssets
    .filter((a) => !activeSet.has(a.id))
    .map((a) => a.id);

  const ratingDistribution: Record<number, number> = {};
  const pickStatusCounts: Record<string, number> = { picked: 0, rejected: 0, unmarked: 0 };
  const orientationCounts: Record<string, number> = { vertical: 0, horizontal: 0, square: 0 };

  for (const asset of selectedAssets) {
    const rating = Math.max(0, Math.min(5, Math.round(asset.rating ?? 0)));
    ratingDistribution[rating] = (ratingDistribution[rating] ?? 0) + 1;

    const status = asset.pickStatus ?? "unmarked";
    pickStatusCounts[status] = (pickStatusCounts[status] ?? 0) + 1;

    orientationCounts[asset.orientation] = (orientationCounts[asset.orientation] ?? 0) + 1;
  }

  return {
    projectId,
    projectName,
    selectedAssets,
    rejectedAssetIds,
    totalImported: allAssets.length,
    selectionDate: new Date().toISOString(),
    metadata: {
      ratingDistribution,
      pickStatusCounts: pickStatusCounts as SelectionResult["metadata"]["pickStatusCounts"],
      orientationCounts: orientationCounts as SelectionResult["metadata"]["orientationCounts"],
    },
  };
}
