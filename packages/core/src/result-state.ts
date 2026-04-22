import type {
  AutoLayoutRequest,
  AutoLayoutResult,
  AutoLayoutSummary,
  GeneratedPageLayout,
  ImageAsset,
  LayoutAssignment,
  LayoutTemplate,
  PageSide,
  OutputSettings,
  RenderJob
} from "@photo-tools/shared-types";

function countOrientation(assets: ImageAsset[], orientation: ImageAsset["orientation"]): number {
  return assets.filter((asset) => asset.orientation === orientation).length;
}

function buildRenderQueue(output: OutputSettings, pages: GeneratedPageLayout[]): RenderJob[] {
  return pages.map((page) => ({
    pageId: page.id,
    outputPath: `${output.folderPath}/${output.fileNamePattern.replace("{index}", String(page.pageNumber))}.${output.format}`,
    format: output.format
  }));
}

export function cloneAssignments(assignments: LayoutAssignment[]): LayoutAssignment[] {
  return assignments.map((assignment) => ({ ...assignment }));
}

export function syncPageImageIds(page: GeneratedPageLayout): GeneratedPageLayout {
  return {
    ...page,
    imageIds: page.assignments.map((assignment) => assignment.imageId)
  };
}

function resolvePageSide(index: number, totalPages: number, existingSide?: GeneratedPageLayout["pageSide"]): PageSide {
  if (existingSide === "left" || existingSide === "right") {
    return existingSide;
  }

  if (totalPages <= 1) {
    return "single";
  }

  return index % 2 === 0 ? "left" : "right";
}

function resolveSpreadId(
  index: number,
  totalPages: number,
  pageSide: PageSide,
  existingSpreadId?: string
): string | undefined {
  if (existingSpreadId) {
    return existingSpreadId;
  }

  if (totalPages <= 1 || pageSide === "single") {
    return undefined;
  }

  return `spread-${Math.floor(index / 2) + 1}`;
}

export function normalizePages(pages: GeneratedPageLayout[]): GeneratedPageLayout[] {
  const totalPages = pages.length;

  return pages.map((page, index) => {
    const pageSide = resolvePageSide(index, totalPages, page.pageSide);
    return {
      ...syncPageImageIds({
        ...page,
        pageNumber: index + 1,
        pageSide,
        spreadId: resolveSpreadId(index, totalPages, pageSide, page.spreadId)
      })
    };
  });
}

export function buildAutoLayoutResult(
  request: AutoLayoutRequest,
  pages: GeneratedPageLayout[],
  availableTemplates: LayoutTemplate[]
): AutoLayoutResult {
  const normalizedPages = normalizePages(pages);
  const assignedImageIds = new Set(
    normalizedPages.flatMap((page) => page.assignments.map((assignment) => assignment.imageId))
  );
  const unassignedAssets = request.assets.filter((asset) => !assignedImageIds.has(asset.id));

  const summary: AutoLayoutSummary = {
    totalImages: request.assets.length,
    targetPhotosPerSheet: normalizedPages.reduce(
      (highest, page) => Math.max(highest, page.assignments.length),
      0
    ),
    generatedSheetCount: normalizedPages.length,
    residualImages: unassignedAssets.length,
    estimatedOutputFiles: normalizedPages.length,
    verticalCount: countOrientation(request.assets, "vertical"),
    horizontalCount: countOrientation(request.assets, "horizontal"),
    squareCount: countOrientation(request.assets, "square")
  };

  const warnings = normalizedPages.flatMap((page) => page.warnings);

  return {
    request,
    pages: normalizedPages,
    summary,
    availableTemplates,
    unassignedAssets,
    warnings,
    renderQueue: buildRenderQueue(request.output, normalizedPages)
  };
}
