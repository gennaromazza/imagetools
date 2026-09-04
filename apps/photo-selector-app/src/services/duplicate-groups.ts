import type { ImageAsset } from "@photo-tools/shared-types";

export interface LikelyDuplicateGroup {
  key: string;
  assetIds: string[];
  fileNames: string[];
  size: number;
  width: number;
  height: number;
}

type DuplicateCandidate = Pick<ImageAsset, "id" | "fileName" | "size" | "width" | "height">;

/**
 * Raggruppa i probabili duplicati esatti senza hashing: stesso peso in byte
 * e stesse dimensioni in pixel. Euristica veloce e onesta (niente falsi
 * negativi costosi): due file diversi con stesso peso e stesse dimensioni
 * sono quasi sempre la stessa foto copiata.
 */
export function findLikelyDuplicateGroups(
  assets: readonly DuplicateCandidate[],
): LikelyDuplicateGroup[] {
  const byKey = new Map<string, DuplicateCandidate[]>();
  for (const asset of assets) {
    const size = asset.size ?? 0;
    if (size <= 0 || asset.width <= 0 || asset.height <= 0) {
      continue;
    }
    const key = `${size}:${asset.width}x${asset.height}`;
    const list = byKey.get(key);
    if (list) {
      list.push(asset);
    } else {
      byKey.set(key, [asset]);
    }
  }

  const groups: LikelyDuplicateGroup[] = [];
  for (const [key, list] of byKey) {
    if (list.length < 2) {
      continue;
    }
    const first = list[0]!;
    groups.push({
      key,
      assetIds: list.map((item) => item.id),
      fileNames: list.map((item) => item.fileName),
      size: first.size ?? 0,
      width: first.width,
      height: first.height,
    });
  }
  groups.sort((left, right) => right.assetIds.length - left.assetIds.length || left.key.localeCompare(right.key));
  return groups;
}
