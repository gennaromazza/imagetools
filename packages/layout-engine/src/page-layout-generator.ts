import type {
  AutoLayoutRequest,
  GeneratedPageLayout,
  LayoutTemplate,
  ImageAsset,
} from "@photo-tools/shared-types";
import { DEFAULT_LAYOUT_TEMPLATES } from "./default-templates.js";
import { groupAssetsForSheets } from "./group-assets";
import { assignImagesToTemplate } from "./slot-assignment";
import { selectBestTemplate } from "./select-template";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function resolveTargetPhotosPerSheet(
  request: AutoLayoutRequest,
  templates: LayoutTemplate[]
): number {
  const maxTemplateCapacity = templates.reduce(
    (highest, template) => Math.max(highest, template.maxPhotos),
    1
  );

  if (request.planningMode === "desiredSheetCount" && request.desiredSheetCount) {
    return clamp(
      Math.ceil(request.assets.length / request.desiredSheetCount),
      1,
      maxTemplateCapacity
    );
  }

  if (request.maxPhotosPerSheet) {
    return clamp(request.maxPhotosPerSheet, 1, maxTemplateCapacity);
  }

  return clamp(2, 1, maxTemplateCapacity);
}

function createBonusPages(
  residualAssets: ImageAsset[],
  targetPhotosPerSheet: number,
  request: AutoLayoutRequest,
  templates: LayoutTemplate[],
  startingPageNumber: number
): GeneratedPageLayout[] {
  if (residualAssets.length === 0) {
    return [];
  }

  const bonusPages: GeneratedPageLayout[] = [];
  const groups = groupAssetsForSheets(residualAssets, Math.min(targetPhotosPerSheet, 20));

  groups.forEach((group, index) => {
    const template = selectBestTemplate(group, templates, request.sheet);
    const assignments = assignImagesToTemplate(group, template, request.fitMode, request.cropStrategy, request.sheet);

    const warnings: string[] = [];
    if (assignments.length < group.length) {
      const unassignedCount = group.length - assignments.length;
      const slotCount = template.slots.length;
      warnings.push(
        `${unassignedCount} ${unassignedCount === 1 ? "foto" : "foto"} non ${unassignedCount === 1 ? "è stata" : "sono state"} inserite. ` +
        `Template ha ${assignments.length}/${slotCount} slot utilizzati. Considera un layout più grande.`
      );
    }

    bonusPages.push({
      id: `page-${startingPageNumber + index}`,
      pageNumber: startingPageNumber + index,
      sheetSpec: request.sheet,
      templateId: template.id,
      templateLabel: template.label,
      slotDefinitions: template.slots,
      assignments,
      imageIds: group.map((asset) => asset.id),
      warnings
    });
  });

  return bonusPages;
}

export function generatePageLayouts(
  request: AutoLayoutRequest
): {
  pages: GeneratedPageLayout[];
  targetPhotosPerSheet: number;
  templates: LayoutTemplate[];
} {
  const templates = request.templates && request.templates.length > 0 ? request.templates : DEFAULT_LAYOUT_TEMPLATES;
  const targetPhotosPerSheet = resolveTargetPhotosPerSheet(request, templates);
  const groups = groupAssetsForSheets(request.assets, targetPhotosPerSheet);
  const fixedTemplate = !request.allowTemplateVariation && groups[0]
    ? selectBestTemplate(groups[0], templates, request.sheet)
    : null;

  const pages = groups.map((group, index) => {
    const template =
      fixedTemplate && group.length >= fixedTemplate.minPhotos && group.length <= fixedTemplate.maxPhotos
        ? fixedTemplate
        : selectBestTemplate(group, templates, request.sheet);
    const assignments = assignImagesToTemplate(group, template, request.fitMode, request.cropStrategy, request.sheet);

    const warnings: string[] = [];
    if (assignments.length < group.length) {
      const unassignedCount = group.length - assignments.length;
      const slotCount = template.slots.length;
      const assignedCount = assignments.length;
      warnings.push(
        `${unassignedCount} ${unassignedCount === 1 ? "foto" : "foto"} non ${unassignedCount === 1 ? "è stata" : "sono state"} inserite. ` +
        `Template ha ${assignedCount}/${slotCount} slot utilizzati. Considera un layout più grande.`
      );
    }

    return {
      id: `page-${index + 1}`,
      pageNumber: index + 1,
      sheetSpec: request.sheet,
      templateId: template.id,
      templateLabel: template.label,
      slotDefinitions: template.slots,
      assignments,
      imageIds: group.map((asset) => asset.id),
      warnings
    };
  });

  // Collect residual images that couldn't be assigned
  const assignedImageIds = new Set(pages.flatMap((page) => page.assignments.map((a) => a.imageId)));
  const residualAssets = request.assets.filter((asset) => !assignedImageIds.has(asset.id));

  // Create bonus pages for residual images
  const bonusPages = createBonusPages(
    residualAssets,
    targetPhotosPerSheet,
    request,
    templates,
    pages.length + 1
  );

  return {
    pages: [...pages, ...bonusPages],
    targetPhotosPerSheet,
    templates
  };
}
