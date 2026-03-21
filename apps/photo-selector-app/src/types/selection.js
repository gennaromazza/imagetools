export function buildSelectionResult(projectId, projectName, allAssets, activeAssetIds) {
    const activeSet = new Set(activeAssetIds);
    const selectedAssets = allAssets.filter((a) => activeSet.has(a.id));
    const rejectedAssetIds = allAssets
        .filter((a) => !activeSet.has(a.id))
        .map((a) => a.id);
    const ratingDistribution = {};
    const pickStatusCounts = { picked: 0, rejected: 0, unmarked: 0 };
    const orientationCounts = { vertical: 0, horizontal: 0, square: 0 };
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
            pickStatusCounts: pickStatusCounts,
            orientationCounts: orientationCounts,
        },
    };
}
//# sourceMappingURL=selection.js.map