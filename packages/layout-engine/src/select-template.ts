import type {
  ImageAsset,
  LayoutTemplate,
  PageSide,
  SheetSpec,
  TemplateVariantRole
} from "@photo-tools/shared-types";

export interface SelectTemplateOptions {
  pageSide?: PageSide;
  spreadTemplate?: LayoutTemplate | null;
  recentTemplates?: LayoutTemplate[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizedAspectDistance(left: number, right: number): number {
  const safeLeft = Math.max(left, 0.01);
  const safeRight = Math.max(right, 0.01);
  return Math.abs(Math.log(safeLeft / safeRight));
}

function getSlotAspectRatio(templateSlot: LayoutTemplate["slots"][number], sheet: SheetSpec): number {
  const sheetAspect = Math.max(sheet.widthCm, 0.1) / Math.max(sheet.heightCm, 0.1);
  return Math.max((templateSlot.width * sheetAspect) / Math.max(templateSlot.height, 0.001), 0.01);
}

function estimateCropLoss(slotAspect: number, imageAspect: number): number {
  const safeSlot = Math.max(slotAspect, 0.01);
  const safeImage = Math.max(imageAspect, 0.01);

  if (safeImage > safeSlot) {
    return 1 - safeSlot / safeImage;
  }

  return 1 - safeImage / safeSlot;
}

function isDenseGeneratedGrid(template: LayoutTemplate): boolean {
  return /^grid-\d+-balanced$/.test(template.id) && template.maxPhotos >= 5;
}

function getExpectedRolesForSide(pageSide: PageSide): TemplateVariantRole[] {
  if (pageSide === "left") {
    return ["mirror-left", "companion-left", "base"];
  }

  if (pageSide === "right") {
    return ["mirror-right", "companion-right", "base"];
  }

  return ["base"];
}

function getSideCompatibilityScore(template: LayoutTemplate, pageSide: PageSide): number {
  if (pageSide === "single") {
    return template.supportsPageSide ? 8 : 12;
  }

  if (!template.supportsPageSide) {
    return -4;
  }

  const [preferredRole, secondaryRole, fallbackRole] = getExpectedRolesForSide(pageSide);
  const role = template.variantRole ?? "base";

  if (role === preferredRole) {
    return 26;
  }

  if (role === secondaryRole) {
    return 22;
  }

  if (role === fallbackRole) {
    return 10;
  }

  return -18;
}

function areSpreadRolesComplementary(
  leftRole: TemplateVariantRole,
  rightRole: TemplateVariantRole
): boolean {
  return (
    (leftRole === "mirror-left" && rightRole === "mirror-right") ||
    (leftRole === "companion-left" && rightRole === "companion-right")
  );
}

function getSpreadPairScore(template: LayoutTemplate, spreadTemplate: LayoutTemplate | null | undefined): number {
  if (!spreadTemplate) {
    return 0;
  }

  if (!template.variantGroupId || !spreadTemplate.variantGroupId) {
    return template.id === spreadTemplate.id ? -10 : 0;
  }

  if (template.variantGroupId !== spreadTemplate.variantGroupId) {
    return -6;
  }

  const currentRole = template.variantRole ?? "base";
  const partnerRole = spreadTemplate.variantRole ?? "base";

  if (areSpreadRolesComplementary(partnerRole, currentRole)) {
    return 34;
  }

  if (currentRole === "base" || partnerRole === "base") {
    return 14;
  }

  if (currentRole === partnerRole) {
    return -18;
  }

  return 8;
}

function getRecentReusePenalty(template: LayoutTemplate, recentTemplates: LayoutTemplate[] | undefined): number {
  if (!recentTemplates || recentTemplates.length === 0) {
    return 0;
  }

  return recentTemplates.reduce((penalty, recentTemplate, index) => {
    const weight = Math.max(1, recentTemplates.length - index);

    if (recentTemplate.id === template.id) {
      return penalty + 16 * weight;
    }

    if (
      recentTemplate.variantGroupId &&
      template.variantGroupId &&
      recentTemplate.variantGroupId === template.variantGroupId
    ) {
      return penalty + 8 * weight;
    }

    return penalty;
  }, 0);
}

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
  sheet: SheetSpec,
  templates: LayoutTemplate[],
  options: SelectTemplateOptions
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

  let verticalAssets = assets.filter((asset) => asset.orientation === "vertical").length;
  let horizontalAssets = assets.filter((asset) => asset.orientation === "horizontal").length;
  let squareAssets = assets.filter((asset) => asset.orientation === "square").length;

  const orientationBonus = template.slots.reduce((score, slot) => {
    if (slot.expectedOrientation === "any") {
      return score + 8;
    }

    if (slot.expectedOrientation === "vertical") {
      if (verticalAssets > 0) {
        verticalAssets -= 1;
        return score + 28;
      }

      if (squareAssets > 0) {
        squareAssets -= 1;
        return score + 15;
      }

      return score - 10;
    }

    if (horizontalAssets > 0) {
      horizontalAssets -= 1;
      return score + 28;
    }

    if (squareAssets > 0) {
      squareAssets -= 1;
      return score + 15;
    }

    return score - 10;
  }, 0);

  const sortedSlotRatios = template.slots
    .map((slot) => getSlotAspectRatio(slot, sheet))
    .sort((left, right) => left - right);
  const sortedAssetRatios = assets
    .map((asset) => Math.max(asset.aspectRatio, 0.01))
    .sort((left, right) => left - right);
  const ratioPairs = Math.min(sortedSlotRatios.length, sortedAssetRatios.length);
  let ratioDistance = 0;
  for (let index = 0; index < ratioPairs; index += 1) {
    ratioDistance += normalizedAspectDistance(sortedSlotRatios[index], sortedAssetRatios[index]);
  }
  const meanDistance = ratioPairs > 0 ? ratioDistance / ratioPairs : 0;
  const aspectBonus = clamp(72 - meanDistance * 48, -24, 72);

  let cropLossTotal = 0;
  for (let index = 0; index < ratioPairs; index += 1) {
    cropLossTotal += estimateCropLoss(sortedSlotRatios[index], sortedAssetRatios[index]);
  }
  const meanCropLoss = ratioPairs > 0 ? cropLossTotal / ratioPairs : 0;
  const cropPenalty = meanCropLoss * 70;

  const hasEditorialAlternative = templates.some(
    (candidate) =>
      candidate.id !== template.id &&
      assets.length >= candidate.minPhotos &&
      assets.length <= candidate.maxPhotos &&
      !isDenseGeneratedGrid(candidate)
  );
  const denseGridPenalty = isDenseGeneratedGrid(template) && hasEditorialAlternative ? 22 : 0;
  const sideCompatibilityScore = options.pageSide ? getSideCompatibilityScore(template, options.pageSide) : 0;
  const spreadPairScore = getSpreadPairScore(template, options.spreadTemplate);
  const recentReusePenalty = getRecentReusePenalty(template, options.recentTemplates);

  return (
    exactFitBonus +
    affinityBonus +
    sheetBonus +
    orientationBonus +
    aspectBonus +
    sideCompatibilityScore +
    spreadPairScore -
    cropPenalty -
    denseGridPenalty -
    recentReusePenalty
  );
}

export function selectBestTemplate(
  assets: ImageAsset[],
  templates: LayoutTemplate[],
  sheet: SheetSpec,
  options: SelectTemplateOptions = {}
): LayoutTemplate {
  const scoredTemplates = templates
    .map((template) => ({ template, score: scoreTemplate(template, assets, sheet, templates, options) }))
    .sort((left, right) => right.score - left.score);

  return scoredTemplates[0].template;
}
