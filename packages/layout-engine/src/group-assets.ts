import type { ImageAsset, ImageOrientation } from "@photo-tools/shared-types";

interface OrientationBuckets {
  vertical: ImageAsset[];
  horizontal: ImageAsset[];
  square: ImageAsset[];
}

function buildBuckets(assets: ImageAsset[]): OrientationBuckets {
  return assets.reduce<OrientationBuckets>(
    (buckets, asset) => {
      buckets[asset.orientation].push(asset);
      return buckets;
    },
    { vertical: [], horizontal: [], square: [] }
  );
}

function pickFromBucket(
  buckets: OrientationBuckets,
  orientation: ImageOrientation
): ImageAsset | undefined {
  return buckets[orientation].shift();
}

function pickFromLargestBucket(buckets: OrientationBuckets): ImageAsset | undefined {
  const ordered = (Object.entries(buckets) as [ImageOrientation, ImageAsset[]][])
    .sort((left, right) => right[1].length - left[1].length)
    .map(([orientation]) => orientation);

  for (const orientation of ordered) {
    const asset = pickFromBucket(buckets, orientation);
    if (asset) {
      return asset;
    }
  }

  return undefined;
}

function takeBalancedGroup(
  buckets: OrientationBuckets,
  size: number
): ImageAsset[] {
  const group: ImageAsset[] = [];

  while (group.length < size) {
    const asset = pickFromLargestBucket(buckets);
    if (!asset) {
      break;
    }

    group.push(asset);
  }

  return group;
}

export function groupAssetsForSheets(
  assets: ImageAsset[],
  targetPhotosPerSheet: number
): ImageAsset[][] {
  const buckets = buildBuckets(assets);
  const groups: ImageAsset[][] = [];

  while (
    buckets.vertical.length > 0 ||
    buckets.horizontal.length > 0 ||
    buckets.square.length > 0
  ) {
    if (targetPhotosPerSheet === 1) {
      groups.push(takeBalancedGroup(buckets, 1));
      continue;
    }

    if (targetPhotosPerSheet === 2) {
      if (buckets.vertical.length >= 2) {
        groups.push([pickFromBucket(buckets, "vertical"), pickFromBucket(buckets, "vertical")].filter(Boolean) as ImageAsset[]);
        continue;
      }

      if (buckets.horizontal.length >= 2) {
        groups.push([pickFromBucket(buckets, "horizontal"), pickFromBucket(buckets, "horizontal")].filter(Boolean) as ImageAsset[]);
        continue;
      }

      groups.push(takeBalancedGroup(buckets, 2));
      continue;
    }

    if (targetPhotosPerSheet === 3) {
      if (buckets.vertical.length >= 1 && buckets.horizontal.length >= 2) {
        groups.push([
          pickFromBucket(buckets, "vertical"),
          pickFromBucket(buckets, "horizontal"),
          pickFromBucket(buckets, "horizontal")
        ].filter(Boolean) as ImageAsset[]);
        continue;
      }

      if (buckets.horizontal.length >= 1 && buckets.vertical.length >= 2) {
        groups.push([
          pickFromBucket(buckets, "horizontal"),
          pickFromBucket(buckets, "vertical"),
          pickFromBucket(buckets, "vertical")
        ].filter(Boolean) as ImageAsset[]);
        continue;
      }

      groups.push(takeBalancedGroup(buckets, 3));
      continue;
    }

    groups.push(takeBalancedGroup(buckets, targetPhotosPerSheet));
  }

  return groups.filter((group) => group.length > 0);
}

