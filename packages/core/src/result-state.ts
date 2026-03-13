import type {
  AutoLayoutRequest,
  AutoLayoutResult,
  AutoLayoutSummary,
  GeneratedPageLayout,
  ImageAsset,
  LayoutAssignment,
  LayoutTemplate,
  OutputSettings,
  RenderJob
} from "@photo-tools/shared-types";

function countOrientation(assets: ImageAsset[], orientation: ImageAsset["orientation"]): number {
  return assets.filter((asset) => asset.orientation === orientation).length;
}

function buildRenderQueue(output: OutputSettings, pageCount: number): RenderJob[] {
  return Array.from({ length: pageCount }, (_, index) => ({
    pageId: `page-${index + 1}`,
    outputPath: `${output.folderPath}/${output.fileNamePattern.replace("{index}", String(index + 1))}.${output.format}`,
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

export function normalizePages(pages: GeneratedPageLayout[]): GeneratedPageLayout[] {
  return pages.map((page, index) => ({
    ...syncPageImageIds({
      ...page,
      pageNumber: index + 1
    })
  }));
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
    renderQueue: buildRenderQueue(request.output, normalizedPages.length)
  };
}
