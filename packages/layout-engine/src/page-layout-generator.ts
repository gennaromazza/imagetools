import type {
  AutoLayoutRequest,
  GeneratedPageLayout,
  LayoutTemplate
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

export function generatePageLayouts(
  request: AutoLayoutRequest
): {
  pages: GeneratedPageLayout[];
  targetPhotosPerSheet: number;
  templates: LayoutTemplate[];
} {
  const templates = request.templates ?? DEFAULT_LAYOUT_TEMPLATES;
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
    const assignments = assignImagesToTemplate(group, template, request.fitMode, request.cropStrategy);

    return {
      id: `page-${index + 1}`,
      pageNumber: index + 1,
      sheetSpec: request.sheet,
      templateId: template.id,
      templateLabel: template.label,
      slotDefinitions: template.slots,
      assignments,
      imageIds: group.map((asset) => asset.id),
      warnings:
        assignments.length < group.length
          ? ["Alcune immagini non possono essere inserite nel template selezionato."]
          : []
    };
  });

  return {
    pages,
    targetPhotosPerSheet,
    templates
  };
}
