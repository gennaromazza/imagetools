const projectAssetStore = new Map();
function cloneAsset(asset) {
    return {
        ...asset,
        customLabels: asset.customLabels ? [...asset.customLabels] : [],
    };
}
export async function saveImageAssets(projectId, _files, imageAssets) {
    const next = new Map();
    for (const asset of imageAssets) {
        next.set(asset.id, cloneAsset(asset));
    }
    projectAssetStore.set(projectId, next);
}
export async function loadImageAssets(projectId) {
    const stored = projectAssetStore.get(projectId);
    if (!stored) {
        return new Map();
    }
    return new Map(Array.from(stored.entries()).map(([id, asset]) => [id, cloneAsset(asset)]));
}
export async function deleteProjectImages(projectId) {
    projectAssetStore.delete(projectId);
}
export async function hasProjectImages(projectId) {
    const stored = projectAssetStore.get(projectId);
    return Boolean(stored && stored.size > 0);
}
//# sourceMappingURL=image-storage.js.map