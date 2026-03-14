import { assignImagesToTemplate, selectBestTemplate } from "@photo-tools/layout-engine";
import type {
  AutoLayoutResult,
  ChangePageTemplateRequest,
  ClearSlotAssignmentRequest,
  CreatePageRequest,
  GeneratedPageLayout,
  LayoutAssignment,
  LayoutMove,
  LayoutTemplate,
  PlaceImageInSlotRequest,
  RemovePageRequest,
  UpdateSlotAssignmentRequest
} from "@photo-tools/shared-types";
import { buildAutoLayoutResult, cloneAssignments, normalizePages, syncPageImageIds } from "./result-state";

function clonePages(result: AutoLayoutResult): GeneratedPageLayout[] {
  return result.pages.map((page) =>
    syncPageImageIds({
      ...page,
      assignments: cloneAssignments(page.assignments)
    })
  );
}

function findTemplate(templates: LayoutTemplate[], templateId: string): LayoutTemplate {
  const template = templates.find((item) => item.id === templateId);

  if (!template) {
    throw new Error(`Template sconosciuto: ${templateId}`);
  }

  return template;
}

function collectAssignedImageIds(page: GeneratedPageLayout): string[] {
  return page.assignments
    .slice()
    .sort((left, right) => {
      const leftSlot = page.slotDefinitions.find((slot) => slot.id === left.slotId);
      const rightSlot = page.slotDefinitions.find((slot) => slot.id === right.slotId);

      return (rightSlot?.priority ?? 0) - (leftSlot?.priority ?? 0);
    })
    .map((assignment) => assignment.imageId);
}

function finalize(result: AutoLayoutResult, pages: GeneratedPageLayout[]): AutoLayoutResult {
  return buildAutoLayoutResult(result.request, normalizePages(pages), result.availableTemplates);
}

function findAssignment(
  pages: GeneratedPageLayout[],
  imageId: string
): { page: GeneratedPageLayout; assignment: LayoutAssignment } | null {
  for (const page of pages) {
    const assignment = page.assignments.find((item) => item.imageId === imageId);

    if (assignment) {
      return { page, assignment };
    }
  }

  return null;
}

export function moveImageBetweenSlots(
  result: AutoLayoutResult,
  move: LayoutMove
): AutoLayoutResult {
  const pages = clonePages(result);
  const sourcePage = pages.find((page) => page.id === move.sourcePageId);
  const targetPage = pages.find((page) => page.id === move.targetPageId);

  if (!sourcePage || !targetPage) {
    return result;
  }

  const sourceAssignment = sourcePage.assignments.find((assignment) => assignment.slotId === move.sourceSlotId);
  const targetAssignment = targetPage.assignments.find((assignment) => assignment.slotId === move.targetSlotId);

  if (!sourceAssignment) {
    return result;
  }

  if (sourceAssignment.locked || targetAssignment?.locked) {
    return result;
  }

  if (sourcePage.id === targetPage.id) {
    sourceAssignment.slotId = move.targetSlotId;

    if (targetAssignment) {
      targetAssignment.slotId = move.sourceSlotId;
    }
  } else if (targetAssignment) {
    sourcePage.assignments = sourcePage.assignments.map((assignment) =>
      assignment === sourceAssignment
        ? { ...targetAssignment, slotId: move.sourceSlotId }
        : assignment
    );
    targetPage.assignments = targetPage.assignments.map((assignment) =>
      assignment === targetAssignment
        ? { ...sourceAssignment, slotId: move.targetSlotId }
        : assignment
    );
  } else {
    sourcePage.assignments = sourcePage.assignments.filter(
      (assignment) => assignment !== sourceAssignment
    );
    targetPage.assignments.push({
      ...sourceAssignment,
      slotId: move.targetSlotId
    });
  }

  return finalize(result, pages);
}

export function placeImageInSlot(
  result: AutoLayoutResult,
  request: PlaceImageInSlotRequest
): AutoLayoutResult {
  const pages = clonePages(result);
  const targetPage = pages.find((page) => page.id === request.targetPageId);

  if (!targetPage) {
    return result;
  }

  const slot = targetPage.slotDefinitions.find((item) => item.id === request.targetSlotId);
  const targetAssignment = targetPage.assignments.find((assignment) => assignment.slotId === request.targetSlotId);

  if (!slot || targetAssignment?.locked) {
    return result;
  }

  const existingPlacement = findAssignment(pages, request.imageId);
  if (existingPlacement?.assignment.locked) {
    return result;
  }

  if (existingPlacement) {
    existingPlacement.page.assignments = existingPlacement.page.assignments.filter(
      (assignment) => assignment.imageId !== request.imageId
    );
  }

  targetPage.assignments = targetPage.assignments.filter(
    (assignment) => assignment.slotId !== request.targetSlotId
  );

  targetPage.assignments.push({
    slotId: request.targetSlotId,
    imageId: request.imageId,
    fitMode: result.request.fitMode,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    locked: false
  });

  return finalize(result, pages);
}

export function clearSlotAssignment(
  result: AutoLayoutResult,
  request: ClearSlotAssignmentRequest
): AutoLayoutResult {
  const pages = clonePages(result).map((page) =>
    page.id === request.pageId
      ? {
          ...page,
          assignments: page.assignments.filter(
            (assignment) => assignment.slotId !== request.slotId || assignment.locked
          )
        }
      : page
  );

  return finalize(result, pages);
}

export function updateSlotAssignment(
  result: AutoLayoutResult,
  request: UpdateSlotAssignmentRequest
): AutoLayoutResult {
  const pages = clonePages(result).map((page) =>
    page.id === request.pageId
      ? {
          ...page,
          assignments: page.assignments.map((assignment) =>
            assignment.slotId === request.slotId
              ? { ...assignment, ...request.changes }
              : assignment
          )
        }
      : page
  );

  return finalize(result, pages);
}

export function changePageTemplate(
  result: AutoLayoutResult,
  request: ChangePageTemplateRequest
): AutoLayoutResult {
  const page = result.pages.find((item) => item.id === request.pageId);

  if (!page) {
    return result;
  }

  const template = findTemplate(result.availableTemplates, request.templateId);
  const currentImageIds = page.imageIds.length > 0 ? page.imageIds : collectAssignedImageIds(page);
  const assets = currentImageIds
    .map((imageId) => result.request.assets.find((asset) => asset.id === imageId))
    .filter(Boolean) as typeof result.request.assets;
  const previousAssignments = new Map(page.assignments.map((assignment) => [assignment.imageId, assignment]));
  const assignments = assignImagesToTemplate(assets, template, result.request.fitMode).map((assignment) => ({
    ...(previousAssignments.get(assignment.imageId)
      ? {
          fitMode: previousAssignments.get(assignment.imageId)?.fitMode,
          zoom: previousAssignments.get(assignment.imageId)?.zoom,
          offsetX: previousAssignments.get(assignment.imageId)?.offsetX,
          offsetY: previousAssignments.get(assignment.imageId)?.offsetY,
          rotation: previousAssignments.get(assignment.imageId)?.rotation,
          locked: previousAssignments.get(assignment.imageId)?.locked
        }
      : {}),
    ...assignment
  }));

  const pages = clonePages(result).map((item) =>
    item.id === request.pageId
      ? syncPageImageIds({
          ...item,
          templateId: template.id,
          templateLabel: template.label,
          slotDefinitions: template.slots,
          assignments,
          warnings:
            assignments.length < assets.length
              ? ["Alcune immagini non possono essere inserite nel template selezionato."]
              : []
        })
      : item
  );

  return finalize(result, pages);
}

export function createPage(
  result: AutoLayoutResult,
  request: CreatePageRequest = {}
): AutoLayoutResult {
  const imageIds = request.imageIds?.length
    ? request.imageIds
    : result.unassignedAssets.slice(0, 4).map((asset) => asset.id);

  if (imageIds.length === 0) {
    return result;
  }

  const assets = result.request.assets.filter((asset) => imageIds.includes(asset.id));
  if (assets.length === 0) {
    return result;
  }

  const template = request.templateId
    ? findTemplate(result.availableTemplates, request.templateId)
    : selectBestTemplate(assets, result.availableTemplates, result.request.sheet);
  const assignments = assignImagesToTemplate(assets, template, result.request.fitMode);
  const highestPageNumber = result.pages.reduce((highest, page) => Math.max(highest, page.pageNumber), 0);
  const nextPageId = `page-${highestPageNumber + 1}`;
  const pages = [
    ...clonePages(result),
    {
      id: nextPageId,
      pageNumber: highestPageNumber + 1,
      sheetSpec: result.request.sheet,
      templateId: template.id,
      templateLabel: template.label,
      slotDefinitions: template.slots,
      assignments,
      imageIds: assignments.map((assignment) => assignment.imageId),
      warnings:
        assignments.length < assets.length
          ? ["Alcune immagini non possono essere inserite nel template selezionato."]
          : []
    }
  ];

  return finalize(result, pages);
}

export function removePage(
  result: AutoLayoutResult,
  request: RemovePageRequest
): AutoLayoutResult {
  const pages = clonePages(result).filter((page) => page.id !== request.pageId);

  return finalize(result, pages);
}
