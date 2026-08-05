import type { DesktopCloudPhotoState } from "@photo-tools/desktop-contracts";
import type { ImageAsset } from "@photo-tools/shared-types";

export function normalizeCloudPath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+|\/+$/g, "")
    .toLocaleLowerCase();
}

type UniqueAssetIndex = Map<string, ImageAsset | null>;

function addUnique(index: UniqueAssetIndex, key: string | undefined, asset: ImageAsset): void {
  if (!key) {
    return;
  }
  if (index.has(key)) {
    index.set(key, null);
    return;
  }
  index.set(key, asset);
}

export interface CloudProjectMappingResult {
  stateByAssetId: Map<string, DesktopCloudPhotoState>;
  unmatchedCount: number;
  ambiguousCount: number;
}

/**
 * Maps a Drive manifest to local assets without ever guessing between duplicate
 * file names. Exact relative paths win, then stable source keys, and only a
 * unique name+size pair is accepted as a last resort.
 */
export function mapCloudProjectToAssets(
  localAssets: ImageAsset[],
  cloudAssets: DesktopCloudPhotoState[],
): CloudProjectMappingResult {
  const byPath: UniqueAssetIndex = new Map();
  const bySourceKey: UniqueAssetIndex = new Map();
  const byNameAndSize: UniqueAssetIndex = new Map();

  for (const asset of localAssets) {
    addUnique(byPath, normalizeCloudPath(asset.path), asset);
    addUnique(bySourceKey, asset.sourceFileKey, asset);
    addUnique(byNameAndSize, `${asset.fileName.toLocaleLowerCase()}::${asset.size ?? ""}`, asset);
  }

  const claimedAssetIds = new Set<string>();
  const stateByAssetId = new Map<string, DesktopCloudPhotoState>();
  let unmatchedCount = 0;
  let ambiguousCount = 0;

  for (const cloudAsset of cloudAssets) {
    const candidates = [
      byPath.get(normalizeCloudPath(cloudAsset.relativePath)),
      cloudAsset.sourceFileKey ? bySourceKey.get(cloudAsset.sourceFileKey) : undefined,
      byNameAndSize.get(`${cloudAsset.fileName.toLocaleLowerCase()}::${cloudAsset.size ?? ""}`),
    ];
    const match = candidates.find((candidate): candidate is ImageAsset => Boolean(candidate));
    if (!match) {
      const hasAmbiguousCandidate = candidates.some((candidate) => candidate === null);
      if (hasAmbiguousCandidate) {
        ambiguousCount += 1;
      } else {
        unmatchedCount += 1;
      }
      continue;
    }
    if (claimedAssetIds.has(match.id)) {
      ambiguousCount += 1;
      continue;
    }
    claimedAssetIds.add(match.id);
    stateByAssetId.set(match.id, cloudAsset);
  }

  return { stateByAssetId, unmatchedCount, ambiguousCount };
}
