import type { ImageAsset, LayoutTemplate, SheetSpec } from "@photo-tools/shared-types";

function getDominantOrientation(assets: ImageAsset[]): "portrait-heavy" | "landscape-heavy" | "mixed" {
  const verticalCount = assets.filter((asset) => asset.orientation === "vertical").length;
  const horizontalCount = assets.filter((asset) => asset.orientation === "horizontal").length;

  if (verticalCount > horizontalCount) {
    return "portrait-heavy";
  }

  if (horizontalCount > verticalCount) {
    return "landscape-heavy";
  }

  return "mixed";
}

function scoreTemplate(
  template: LayoutTemplate,
  assets: ImageAsset[],
  sheet: SheetSpec
): number {
  if (assets.length < template.minPhotos || assets.length > template.maxPhotos) {
    return Number.NEGATIVE_INFINITY;
  }

  const dominantOrientation = getDominantOrientation(assets);
  const sheetOrientation = sheet.heightCm >= sheet.widthCm ? "portrait" : "landscape";
  const exactFitBonus = template.maxPhotos === assets.length ? 50 : 0;
  const affinityBonus =
    template.affinity === "any"
      ? 10
      : template.affinity === dominantOrientation
        ? 40
        : dominantOrientation === "mixed" && template.affinity === "mixed"
          ? 35
          : 0;
  const sheetBonus =
    template.targetSheetOrientation === "any" || template.targetSheetOrientation === sheetOrientation
      ? 20
      : 0;
  const slotOrientationBonus = template.slots.reduce((total, slot, index) => {
    const image = assets[index];

    if (!image) {
      return total;
    }

    if (slot.expectedOrientation === "any") {
      return total + 10;
    }

    if (slot.expectedOrientation === image.orientation) {
      return total + 25;
    }

    if (image.orientation === "square") {
      return total + 10;
    }

    return total;
  }, 0);

  return exactFitBonus + affinityBonus + sheetBonus + slotOrientationBonus;
}

export function selectBestTemplate(
  assets: ImageAsset[],
  templates: LayoutTemplate[],
  sheet: SheetSpec
): LayoutTemplate {
  const scoredTemplates = templates
    .map((template) => ({ template, score: scoreTemplate(template, assets, sheet) }))
    .sort((left, right) => right.score - left.score);

  return scoredTemplates[0].template;
}

