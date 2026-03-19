import type {
  CropStrategy,
  FitMode,
  ImageAsset,
  LayoutAssignment,
  LayoutSlot,
  LayoutTemplate
} from "@photo-tools/shared-types";

function normalizedAspectDistance(left: number, right: number): number {
  const safeLeft = Math.max(left, 0.01);
  const safeRight = Math.max(right, 0.01);
  return Math.abs(Math.log(safeLeft / safeRight));
}

export function buildInitialCropForSlot(
  asset: ImageAsset,
  slot: LayoutSlot,
  cropStrategy: CropStrategy = "balanced",
  fitMode: FitMode = "fill"
): {
  cropLeft: number;
  cropTop: number;
  cropWidth: number;
  cropHeight: number;
} {
  // When using "fit" mode, preserve the original image's aspect ratio
  // by showing the full image (no cropping). The rendering layer will
  // handle letterboxing to fit the image within the slot.
  if (fitMode === "fit") {
    return {
      cropLeft: 0,
      cropTop: 0,
      cropWidth: 1,
      cropHeight: 1
    };
  }

  // For "fill" and "crop" modes, crop to match the slot's aspect ratio
  const imageAspect = Math.max(asset.aspectRatio, 0.01);
  const slotAspect = Math.max(slot.width / Math.max(slot.height, 0.001), 0.01);

  if (imageAspect > slotAspect) {
    const cropWidth = Math.min(1, slotAspect / imageAspect);
    const cropLeft = (1 - cropWidth) / 2;

    return {
      cropLeft,
      cropTop: 0,
      cropWidth,
      cropHeight: 1
    };
  }

  const cropHeight = Math.min(1, imageAspect / slotAspect);
  const centeredTop = (1 - cropHeight) / 2;
  const portraitBiasFactor =
    cropStrategy === "portraitSafe"
      ? 0.42
      : cropStrategy === "landscapeSafe"
        ? 0.78
        : 0.6;
  const portraitBiasTop =
    asset.orientation === "vertical" && slot.expectedOrientation === "vertical"
      ? centeredTop * portraitBiasFactor
      : centeredTop;

  return {
    cropLeft: 0,
    cropTop: Math.max(0, Math.min(1 - cropHeight, portraitBiasTop)),
    cropWidth: 1,
    cropHeight
  };
}

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
  const aspectDistance = normalizedAspectDistance(slotAspectRatio, asset.aspectRatio);
  const aspectScore = Math.max(0, 42 - aspectDistance * 30);

  // Rating bonus: prioritize higher-rated photos
  // Rating ranges from 0-5, converting to 0-30 points (6 points per star)
  const ratingBonus = (asset.rating ?? 0) * 6;

  // Slot priority: increased from 0.08 to 0.3 to make premium slots genuinely premium
  // Priority typically ranges 1-120, so this contributes 0.3-36 points
  const priorityBonus = slot.priority * 0.3;

  return orientationMatch + aspectScore + ratingBonus + priorityBonus;
}

function pickBestAsset(slot: LayoutSlot, remainingAssets: ImageAsset[]): ImageAsset | undefined {
  const scored = remainingAssets
    .map((asset) => ({ asset, score: scoreAssetForSlot(asset, slot) }))
    .sort((left, right) => right.score - left.score);

  return scored[0]?.asset;
}

function optimizeByPairSwaps(
  assignments: LayoutAssignment[],
  slotById: Map<string, LayoutSlot>,
  assetById: Map<string, ImageAsset>
): LayoutAssignment[] {
  const optimized = assignments.map((assignment) => ({ ...assignment }));
  if (optimized.length < 2) {
    return optimized;
  }

  const maxPasses = Math.min(optimized.length * 2, 24);

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let improved = false;

    for (let leftIndex = 0; leftIndex < optimized.length - 1; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < optimized.length; rightIndex += 1) {
        const left = optimized[leftIndex];
        const right = optimized[rightIndex];
        const leftSlot = slotById.get(left.slotId);
        const rightSlot = slotById.get(right.slotId);
        const leftAsset = assetById.get(left.imageId);
        const rightAsset = assetById.get(right.imageId);

        if (!leftSlot || !rightSlot || !leftAsset || !rightAsset) {
          continue;
        }

        const currentScore =
          scoreAssetForSlot(leftAsset, leftSlot) + scoreAssetForSlot(rightAsset, rightSlot);
        const swappedScore =
          scoreAssetForSlot(rightAsset, leftSlot) + scoreAssetForSlot(leftAsset, rightSlot);

        if (swappedScore <= currentScore + 0.2) {
          continue;
        }

        optimized[leftIndex] = { ...left, imageId: right.imageId };
        optimized[rightIndex] = { ...right, imageId: left.imageId };
        improved = true;
      }
    }

    if (!improved) {
      break;
    }
  }

  return optimized;
}

export function assignImagesToTemplate(
  assets: ImageAsset[],
  template: LayoutTemplate,
  fitMode: FitMode,
  cropStrategy: CropStrategy = "balanced"
): LayoutAssignment[] {
  const sortedSlots = [...template.slots].sort((left, right) => right.priority - left.priority);
  const remainingAssets = [...assets];
  const assignments: LayoutAssignment[] = [];

  for (const slot of sortedSlots) {
    const asset = pickBestAsset(slot, remainingAssets);

    if (!asset) {
      continue;
    }

    const initialCrop = buildInitialCropForSlot(asset, slot, cropStrategy, fitMode);

    assignments.push({
      slotId: slot.id,
      imageId: asset.id,
      fitMode,
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      locked: false,
      cropLeft: initialCrop.cropLeft,
      cropTop: initialCrop.cropTop,
      cropWidth: initialCrop.cropWidth,
      cropHeight: initialCrop.cropHeight
    });

    const assetIndex = remainingAssets.findIndex((item) => item.id === asset.id);
    remainingAssets.splice(assetIndex, 1);
  }

  const slotById = new Map(sortedSlots.map((slot) => [slot.id, slot]));
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));

  return optimizeByPairSwaps(assignments, slotById, assetById);
}

