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
export declare function buildSelectionResult(projectId: string, projectName: string, allAssets: ImageAsset[], activeAssetIds: string[]): SelectionResult;
