import type {
  AutoLayoutRequest,
  GeneratedPageLayout,
  ImageAsset,
  LayoutTemplate,
  PageSide
} from "@photo-tools/shared-types";
import { DEFAULT_LAYOUT_TEMPLATES } from "./default-templates.js";
import { groupAssetsForSheets } from "./group-assets";
import { assignImagesToTemplate } from "./slot-assignment";
import { selectBestTemplate } from "./select-template";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolvePageSide(index: number, totalPages: number): PageSide {
  if (totalPages <= 1) {
    return "single";
  }

  return index % 2 === 0 ? "left" : "right";
}

function resolveSpreadId(index: number, totalPages: number, pageSide: PageSide): string | undefined {
  if (totalPages <= 1 || pageSide === "single") {
    return undefined;
  }

  return `spread-${Math.floor(index / 2) + 1}`;
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

function buildRecentTemplates(
  pages: GeneratedPageLayout[],
  templates: LayoutTemplate[],
  index: number
): LayoutTemplate[] {
  return pages
    .slice(Math.max(0, index - 2), index)
    .map((page) => templates.find((template) => template.id === page.templateId))
    .filter((template): template is LayoutTemplate => Boolean(template));
}

function resolveFixedTemplateForPage(
  fixedTemplate: LayoutTemplate | null,
  pageSide: PageSide,
  templates: LayoutTemplate[],
  photoCount: number
): LayoutTemplate | null {
  if (!fixedTemplate || photoCount < fixedTemplate.minPhotos || photoCount > fixedTemplate.maxPhotos) {
    return null;
  }

  if (!fixedTemplate.supportsPageSide || !fixedTemplate.variantGroupId) {
    return fixedTemplate;
  }

  const sideCompatibleTemplate = templates.find((template) => {
    if (
      template.variantGroupId !== fixedTemplate.variantGroupId ||
      photoCount < template.minPhotos ||
      photoCount > template.maxPhotos
    ) {
      return false;
    }

    const role = template.variantRole ?? "base";

    if (pageSide === "single") {
      return !template.supportsPageSide || role === "base";
    }

    if (pageSide === "left") {
      return role === "mirror-left" || role === "companion-left";
    }

    return role === "mirror-right" || role === "companion-right";
  });

  return sideCompatibleTemplate ?? fixedTemplate;
}

function buildPageLayout(
  group: ImageAsset[],
  index: number,
  totalPages: number,
  request: AutoLayoutRequest,
  templates: LayoutTemplate[],
  existingPages: GeneratedPageLayout[],
  fixedTemplate: LayoutTemplate | null
): GeneratedPageLayout {
  const pageSide = resolvePageSide(index, totalPages);
  const spreadTemplate =
    pageSide === "right"
      ? templates.find((template) => template.id === existingPages[index - 1]?.templateId) ?? null
      : null;
  const recentTemplates = buildRecentTemplates(existingPages, templates, index);
  const fixedTemplateForPage = resolveFixedTemplateForPage(fixedTemplate, pageSide, templates, group.length);
  const template = fixedTemplateForPage
    ? fixedTemplateForPage
    : selectBestTemplate(group, templates, request.sheet, {
        pageSide,
        spreadTemplate,
        recentTemplates
      });
  const assignments = assignImagesToTemplate(group, template, request.fitMode, request.cropStrategy, request.sheet);

  const warnings: string[] = [];
  if (assignments.length < group.length) {
    const unassignedCount = group.length - assignments.length;
    const slotCount = template.slots.length;
    warnings.push(
      `${unassignedCount} foto non ${unassignedCount === 1 ? "e stata" : "sono state"} inserite. ` +
      `Template ha ${assignments.length}/${slotCount} slot utilizzati. Considera un layout piu grande.`
    );
  }

  return {
    id: `page-${index + 1}`,
    pageNumber: index + 1,
    pageSide,
    spreadId: resolveSpreadId(index, totalPages, pageSide),
    sheetSpec: request.sheet,
    templateId: template.id,
    templateLabel: template.label,
    slotDefinitions: template.slots,
    assignments,
    imageIds: group.map((asset) => asset.id),
    warnings
  };
}

export function generatePageLayouts(
  request: AutoLayoutRequest
): {
  pages: GeneratedPageLayout[];
  targetPhotosPerSheet: number;
  templates: LayoutTemplate[];
} {
  const templates =
    request.templates && request.templates.length > 0 ? request.templates : DEFAULT_LAYOUT_TEMPLATES;
  const targetPhotosPerSheet = resolveTargetPhotosPerSheet(request, templates);
  const groups = groupAssetsForSheets(request.assets, targetPhotosPerSheet);
  const residualGroupsTargetSize = Math.min(targetPhotosPerSheet, 20);
  const totalProjectedPages = groups.length;
  const fixedTemplate =
    !request.allowTemplateVariation && groups[0]
      ? selectBestTemplate(groups[0], templates, request.sheet, {
          pageSide: resolvePageSide(0, totalProjectedPages)
        })
      : null;

  const pages = groups.reduce<GeneratedPageLayout[]>((collection, group, index) => {
    collection.push(buildPageLayout(group, index, totalProjectedPages, request, templates, collection, fixedTemplate));
    return collection;
  }, []);

  const assignedImageIds = new Set(
    pages.flatMap((page) => page.assignments.map((assignment) => assignment.imageId))
  );
  const residualAssets = request.assets.filter((asset) => !assignedImageIds.has(asset.id));
  const residualGroups = groupAssetsForSheets(residualAssets, residualGroupsTargetSize);
  const totalPages = pages.length + residualGroups.length;

  residualGroups.forEach((group) => {
    pages.push(buildPageLayout(group, pages.length, totalPages, request, templates, pages, null));
  });

  return {
    pages,
    targetPhotosPerSheet,
    templates
  };
}
