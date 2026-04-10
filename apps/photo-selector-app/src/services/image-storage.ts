import type { ImageAsset } from "@photo-tools/shared-types";

const projectAssetStore = new Map<string, Map<string, ImageAsset>>();

function cloneAsset(asset: ImageAsset): ImageAsset {
  return {
    ...asset,
    customLabels: asset.customLabels ? [...asset.customLabels] : [],
  };
}

export async function saveImageAssets(
  projectId: string,
  _files: File[],
  imageAssets: ImageAsset[],
): Promise<void> {
  const next = new Map<string, ImageAsset>();
  for (const asset of imageAssets) {
    next.set(asset.id, cloneAsset(asset));
  }
  projectAssetStore.set(projectId, next);
}

export async function loadImageAssets(projectId: string): Promise<Map<string, ImageAsset>> {
  const stored = projectAssetStore.get(projectId);
  if (!stored) {
    return new Map();
  }

  return new Map(Array.from(stored.entries()).map(([id, asset]) => [id, cloneAsset(asset)]));
}

export async function deleteProjectImages(projectId: string): Promise<void> {
  projectAssetStore.delete(projectId);
}

export async function hasProjectImages(projectId: string): Promise<boolean> {
  const stored = projectAssetStore.get(projectId);
  return Boolean(stored && stored.size > 0);
}
