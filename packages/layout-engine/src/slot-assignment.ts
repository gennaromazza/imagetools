import type {
  FitMode,
  ImageAsset,
  LayoutAssignment,
  LayoutSlot,
  LayoutTemplate
} from "@photo-tools/shared-types";

function scoreAssetForSlot(asset: ImageAsset, slot: LayoutSlot): number {
  const orientationMatch =
    slot.expectedOrientation === "any"
      ? 10
      : slot.expectedOrientation === asset.orientation
        ? 40
        : asset.orientation === "square"
          ? 20
          : 0;

  const slotAspectRatio = slot.width / slot.height;
  const aspectDistance = Math.abs(slotAspectRatio - asset.aspectRatio);
  const aspectScore = Math.max(0, 30 - aspectDistance * 25);

  return orientationMatch + aspectScore + slot.priority * 0.1;
}

function pickBestAsset(slot: LayoutSlot, remainingAssets: ImageAsset[]): ImageAsset | undefined {
  const scored = remainingAssets
    .map((asset) => ({ asset, score: scoreAssetForSlot(asset, slot) }))
    .sort((left, right) => right.score - left.score);

  return scored[0]?.asset;
}

export function assignImagesToTemplate(
  assets: ImageAsset[],
  template: LayoutTemplate,
  fitMode: FitMode
): LayoutAssignment[] {
  const sortedSlots = [...template.slots].sort((left, right) => right.priority - left.priority);
  const remainingAssets = [...assets];
  const assignments: LayoutAssignment[] = [];

  for (const slot of sortedSlots) {
    const asset = pickBestAsset(slot, remainingAssets);

    if (!asset) {
      continue;
    }

    assignments.push({
      slotId: slot.id,
      imageId: asset.id,
      fitMode,
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      locked: false
    });

    const assetIndex = remainingAssets.findIndex((item) => item.id === asset.id);
    remainingAssets.splice(assetIndex, 1);
  }

  return assignments;
}

