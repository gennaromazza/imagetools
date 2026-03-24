import { assignImagesToTemplate, buildInitialCropForSlot, selectBestTemplate } from "@photo-tools/layout-engine";
import type {
  AutoLayoutResult,
  ChangePageTemplateRequest,
  ClearSlotAssignmentRequest,
  CreatePageRequest,
  GeneratedPageLayout,
  ImageAsset,
  LayoutAssignment,
  LayoutSlot,
  LayoutMove,
  LayoutTemplate,
  PlaceImageInSlotRequest,
  RemovePageRequest,
  UpdatePageSheetSpecRequest,
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

function withPreservedAssignmentState(
  assignment: LayoutAssignment,
  previous?: LayoutAssignment
): LayoutAssignment {
  if (!previous) {
    return {
      ...assignment,
      cropLeft: assignment.cropLeft ?? 0,
      cropTop: assignment.cropTop ?? 0,
      cropWidth: assignment.cropWidth ?? 1,
      cropHeight: assignment.cropHeight ?? 1
    };
  }

  const preserveFraming = previous.fitMode === "crop" || previous.fitMode === "fit";

  return {
    ...assignment,
    fitMode: previous.fitMode,
    zoom: previous.zoom,
    offsetX: previous.offsetX,
    offsetY: previous.offsetY,
    rotation: previous.rotation,
    locked: previous.locked,
    cropLeft: preserveFraming ? previous.cropLeft ?? 0 : assignment.cropLeft ?? 0,
    cropTop: preserveFraming ? previous.cropTop ?? 0 : assignment.cropTop ?? 0,
    cropWidth: preserveFraming ? previous.cropWidth ?? 1 : assignment.cropWidth ?? 1,
    cropHeight: preserveFraming ? previous.cropHeight ?? 1 : assignment.cropHeight ?? 1
  };
}

function normalizeRotation(value: number): number {
  const rounded = Math.round(value);
  const wrapped = ((rounded % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getSlotAspectRatio(
  slot: LayoutSlot,
  sheetSpec?: GeneratedPageLayout["sheetSpec"],
  slotCount = 1
): number {
  if (!sheetSpec) {
    return slot.width / Math.max(slot.height, 0.001);
  }

  let width = slot.width * sheetSpec.widthCm;
  let height = slot.height * sheetSpec.heightCm;

  if (slotCount > 1 && sheetSpec.gapCm > 0) {
    const insetX = Math.min(sheetSpec.gapCm / 2, width / 3);
    const insetY = Math.min(sheetSpec.gapCm / 2, height / 3);
    width = Math.max(0.001, width - insetX * 2);
    height = Math.max(0.001, height - insetY * 2);
  }

  return width / Math.max(height, 0.001);
}

function normalizeCropRect(assignment: LayoutAssignment) {
  const width = clamp(assignment.cropWidth ?? 1, 0.05, 1);
  const height = clamp(assignment.cropHeight ?? 1, 0.05, 1);

  return {
    left: clamp(assignment.cropLeft ?? 0, 0, 1 - width),
    top: clamp(assignment.cropTop ?? 0, 0, 1 - height),
    width,
    height
  };
}

function getRotatedBoundingAspect(aspect: number, rotation: number): number {
  const radians = (Math.abs(normalizeRotation(rotation)) * Math.PI) / 180;
  const width = Math.max(aspect, 0.001);
  const height = 1;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const rotatedWidth = width * cos + height * sin;
  const rotatedHeight = width * sin + height * cos;
  return rotatedWidth / Math.max(rotatedHeight, 0.001);
}

function getSlotConstrainedCropAspect(
  slot: LayoutSlot,
  rotation: number,
  sheetSpec?: GeneratedPageLayout["sheetSpec"],
  slotCount = 1
): number {
  const slotAspect = getSlotAspectRatio(slot, sheetSpec, slotCount);
  const normalizedRotation = Math.abs(normalizeRotation(rotation)) % 180;

  if (normalizedRotation < 0.001) {
    return slotAspect;
  }

  if (Math.abs(normalizedRotation - 90) < 0.001) {
    return 1 / Math.max(slotAspect, 0.001);
  }

  if (Math.abs(normalizedRotation - 45) < 0.5 || Math.abs(normalizedRotation - 135) < 0.5) {
    return slotAspect;
  }

  let low = 0.05;
  let high = 20;
  let bestAspect = slotAspect;
  let bestDistance = Number.POSITIVE_INFINITY;
  const lowOutput = getRotatedBoundingAspect(low, normalizedRotation);
  const highOutput = getRotatedBoundingAspect(high, normalizedRotation);
  const increasing = highOutput >= lowOutput;

  for (let step = 0; step < 40; step += 1) {
    const mid = (low + high) / 2;
    const output = getRotatedBoundingAspect(mid, normalizedRotation);
    const distance = Math.abs(Math.log(output / Math.max(slotAspect, 0.001)));

    if (distance < bestDistance) {
      bestDistance = distance;
      bestAspect = mid;
    }

    if (increasing ? output < slotAspect : output > slotAspect) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return bestAspect;
}

function fitCropRectToAspect(
  rect: ReturnType<typeof normalizeCropRect>,
  targetAspect: number,
  imageAspect: number
) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const targetArea = Math.max(0.05 * 0.05, rect.width * rect.height);
  let width = Math.sqrt((targetArea * targetAspect) / Math.max(imageAspect, 0.0001));
  let height = targetArea / Math.max(width, 0.05);
  const maxWidthFromCenter = Math.max(0.05, Math.min(centerX, 1 - centerX) * 2);
  const maxHeightFromCenter = Math.max(0.05, Math.min(centerY, 1 - centerY) * 2);

  if (width > maxWidthFromCenter) {
    width = maxWidthFromCenter;
    height = (imageAspect * width) / Math.max(targetAspect, 0.0001);
  }

  if (height > maxHeightFromCenter) {
    height = maxHeightFromCenter;
    width = (targetAspect * height) / Math.max(imageAspect, 0.0001);
  }

  return {
    left: clamp(centerX - width / 2, 0, 1 - width),
    top: clamp(centerY - height / 2, 0, 1 - height),
    width: clamp(width, 0.05, 1),
    height: clamp(height, 0.05, 1)
  };
}

function isAspectClose(left: number, right: number, tolerance = 0.05) {
  return Math.abs(Math.log(left / Math.max(right, 0.0001))) <= tolerance;
}

function normalizeManualCropForSlot(
  assignment: LayoutAssignment,
  asset: ImageAsset | undefined,
  slot: LayoutSlot | undefined,
  sheetSpec?: GeneratedPageLayout["sheetSpec"],
  slotCount = 1
): LayoutAssignment {
  if (!asset || !slot || assignment.fitMode !== "crop") {
    return assignment;
  }

  const rect = normalizeCropRect(assignment);
  const imageAspect = asset.aspectRatio > 0 ? asset.aspectRatio : 1;
  const slotAspect = getSlotAspectRatio(slot, sheetSpec, slotCount);
  const outputAspect = getRotatedBoundingAspect(
    Math.max(imageAspect * (rect.width / Math.max(rect.height, 0.0001)), 0.0001),
    assignment.rotation ?? 0
  );

  if (isAspectClose(outputAspect, slotAspect)) {
    return {
      ...assignment,
      cropLeft: rect.left,
      cropTop: rect.top,
      cropWidth: rect.width,
      cropHeight: rect.height
    };
  }

  const adjustedRect = fitCropRectToAspect(
    rect,
    getSlotConstrainedCropAspect(slot, assignment.rotation ?? 0, sheetSpec, slotCount),
    imageAspect
  );

  return {
    ...assignment,
    cropLeft: adjustedRect.left,
    cropTop: adjustedRect.top,
    cropWidth: adjustedRect.width,
    cropHeight: adjustedRect.height
  };
}

function getEffectiveAssignmentAspect(asset: ImageAsset, assignment: LayoutAssignment): number {
  const cropWidth = Math.min(1, Math.max(0.05, assignment.cropWidth ?? 1));
  const cropHeight = Math.min(1, Math.max(0.05, assignment.cropHeight ?? 1));
  let aspect = Math.max(0.01, asset.aspectRatio) * (cropWidth / cropHeight);
  const normalizedRotation = Math.abs(normalizeRotation(assignment.rotation ?? 0));

  if (normalizedRotation >= 45 && normalizedRotation <= 135) {
    aspect = 1 / Math.max(aspect, 0.01);
  }

  return Math.max(aspect, 0.01);
}

function getOrientationFromAspect(aspect: number): ImageAsset["orientation"] {
  if (aspect > 1.08) {
    return "horizontal";
  }

  if (aspect < 0.92) {
    return "vertical";
  }

  return "square";
}

function toLayoutAwareAsset(asset: ImageAsset, previous?: LayoutAssignment): ImageAsset {
  if (!previous || (previous.fitMode !== "fit" && previous.fitMode !== "crop")) {
    return asset;
  }

  const aspectRatio = getEffectiveAssignmentAspect(asset, previous);

  return {
    ...asset,
    aspectRatio,
    orientation: getOrientationFromAspect(aspectRatio)
  };
}

function collectAssetsForLayout(
  result: AutoLayoutResult,
  imageIds: string[],
  previousAssignments?: Map<string, LayoutAssignment>
): ImageAsset[] {
  return imageIds
    .map((imageId) => result.request.assets.find((asset) => asset.id === imageId))
    .filter((asset): asset is ImageAsset => Boolean(asset))
    .map((asset) => toLayoutAwareAsset(asset, previousAssignments?.get(asset.id)));
}

function reflowAssignmentForSlot(
  assignment: LayoutAssignment,
  asset: ImageAsset | undefined,
  slot: LayoutSlot | undefined,
  cropStrategy: AutoLayoutResult["request"]["cropStrategy"],
  sheetSpec?: GeneratedPageLayout["sheetSpec"],
  slotCount = 1
): LayoutAssignment {
  if (!asset || !slot || assignment.fitMode === "fit") {
    return assignment;
  }

  if (assignment.fitMode === "crop") {
    return normalizeManualCropForSlot(assignment, asset, slot, sheetSpec, slotCount);
  }

  const initialCrop = buildInitialCropForSlot(
    asset,
    slot,
    cropStrategy,
    assignment.fitMode,
    sheetSpec,
    slotCount
  );

  return {
    ...assignment,
    cropLeft: initialCrop.cropLeft,
    cropTop: initialCrop.cropTop,
    cropWidth: initialCrop.cropWidth,
    cropHeight: initialCrop.cropHeight
  };
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
    const targetSlot = targetPage.slotDefinitions.find((slot) => slot.id === move.targetSlotId);
    const sourceSlot = sourcePage.slotDefinitions.find((slot) => slot.id === move.sourceSlotId);
    const sourceAsset = result.request.assets.find((asset) => asset.id === sourceAssignment.imageId);
    sourceAssignment.slotId = move.targetSlotId;
    Object.assign(
      sourceAssignment,
      reflowAssignmentForSlot(
        sourceAssignment,
        sourceAsset,
        targetSlot,
        result.request.cropStrategy,
        targetPage.sheetSpec,
        targetPage.slotDefinitions.length
      )
    );

    if (targetAssignment) {
      targetAssignment.slotId = move.sourceSlotId;
      const targetAsset = result.request.assets.find((asset) => asset.id === targetAssignment.imageId);
      Object.assign(
        targetAssignment,
        reflowAssignmentForSlot(
          targetAssignment,
          targetAsset,
          sourceSlot,
          result.request.cropStrategy,
          sourcePage.sheetSpec,
          sourcePage.slotDefinitions.length
        )
      );
    }
  } else if (targetAssignment) {
    const sourceSlot = sourcePage.slotDefinitions.find((slot) => slot.id === move.sourceSlotId);
    const targetSlot = targetPage.slotDefinitions.find((slot) => slot.id === move.targetSlotId);
    const sourceAsset = result.request.assets.find((asset) => asset.id === sourceAssignment.imageId);
    const targetAsset = result.request.assets.find((asset) => asset.id === targetAssignment.imageId);
    sourcePage.assignments = sourcePage.assignments.map((assignment) =>
      assignment === sourceAssignment
        ? reflowAssignmentForSlot(
            { ...targetAssignment, slotId: move.sourceSlotId },
            targetAsset,
            sourceSlot,
            result.request.cropStrategy,
            sourcePage.sheetSpec,
            sourcePage.slotDefinitions.length
          )
        : assignment
    );
    targetPage.assignments = targetPage.assignments.map((assignment) =>
      assignment === targetAssignment
        ? reflowAssignmentForSlot(
            { ...sourceAssignment, slotId: move.targetSlotId },
            sourceAsset,
            targetSlot,
            result.request.cropStrategy,
            targetPage.sheetSpec,
            targetPage.slotDefinitions.length
          )
        : assignment
    );
  } else {
    const targetSlot = targetPage.slotDefinitions.find((slot) => slot.id === move.targetSlotId);
    const sourceAsset = result.request.assets.find((asset) => asset.id === sourceAssignment.imageId);
    sourcePage.assignments = sourcePage.assignments.filter(
      (assignment) => assignment !== sourceAssignment
    );
    targetPage.assignments.push(
      reflowAssignmentForSlot(
        {
          ...sourceAssignment,
          slotId: move.targetSlotId
        },
        sourceAsset,
        targetSlot,
        result.request.cropStrategy,
        targetPage.sheetSpec,
        targetPage.slotDefinitions.length
      )
    );
  }

  return finalize(result, pages);
}

export function rebalancePagesForAssignedImages(
  result: AutoLayoutResult,
  pageIds: string[]
): AutoLayoutResult {
  const uniquePageIds = Array.from(new Set(pageIds));
  if (uniquePageIds.length === 0) {
    return result;
  }

  const pages = clonePages(result);

  for (const pageId of uniquePageIds) {
    const page = pages.find((item) => item.id === pageId);
    if (!page) {
      continue;
    }

    const imageIds = collectAssignedImageIds(page);
    if (imageIds.length === 0) {
      page.assignments = [];
      page.imageIds = [];
      page.warnings = [];
      continue;
    }

    const previousAssignments = new Map(page.assignments.map((assignment) => [assignment.imageId, assignment]));
    const assets = collectAssetsForLayout(result, imageIds, previousAssignments);

    if (assets.length === 0) {
      continue;
    }

    const nextTemplate = selectBestTemplate(assets, result.availableTemplates, page.sheetSpec);
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const assignments = assignImagesToTemplate(assets, nextTemplate, result.request.fitMode, result.request.cropStrategy, page.sheetSpec).map((assignment) =>
      normalizeManualCropForSlot(
        withPreservedAssignmentState(assignment, previousAssignments.get(assignment.imageId)),
        assetById.get(assignment.imageId),
        nextTemplate.slots.find((slot) => slot.id === assignment.slotId),
        page.sheetSpec,
        nextTemplate.slots.length
      )
    );

    const nextPage = syncPageImageIds({
      ...page,
      templateId: nextTemplate.id,
      templateLabel: nextTemplate.label,
      slotDefinitions: nextTemplate.slots,
      assignments,
      warnings: (() => {
        if (assignments.length >= assets.length) return [];
        const unassignedCount = assets.length - assignments.length;
        const slotCount = nextTemplate.slots.length;
        return [
          `${unassignedCount} ${unassignedCount === 1 ? "foto" : "foto"} non ${unassignedCount === 1 ? "è stata" : "sono state"} inserite. ` +
          `Template ha ${assignments.length}/${slotCount} slot utilizzati. Considera un layout più grande.`
        ];
      })()
    });

    Object.assign(page, nextPage);
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
    ...buildInitialCropForSlot(
      result.request.assets.find((asset) => asset.id === request.imageId) ?? {
        aspectRatio: 1,
        orientation: "square"
      } as ImageAsset,
      slot,
      result.request.cropStrategy,
      result.request.fitMode,
      targetPage.sheetSpec,
      targetPage.slotDefinitions.length
    ),
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

export function addImageToPage(
  result: AutoLayoutResult,
  request: { pageId: string; imageId: string }
): AutoLayoutResult {
  const pages = clonePages(result);
  const targetPage = pages.find((page) => page.id === request.pageId);

  if (!targetPage) {
    return result;
  }

  const existingPlacement = findAssignment(pages, request.imageId);
  if (existingPlacement?.assignment.locked) {
    return result;
  }

  if (existingPlacement?.page.id === targetPage.id) {
    return rearrangePageImages(result, {
      pageId: request.pageId,
      preferredImageId: request.imageId
    });
  }

  if (existingPlacement) {
    existingPlacement.page.assignments = existingPlacement.page.assignments.filter(
      (assignment) => assignment.imageId !== request.imageId
    );
  }

  const nextImageIds = [...collectAssignedImageIds(targetPage), request.imageId];
  const previousAssignments = new Map(targetPage.assignments.map((assignment) => [assignment.imageId, assignment]));
  const assets = collectAssetsForLayout(result, nextImageIds, previousAssignments);

  if (assets.length === 0) {
    return result;
  }

  const compatibleTemplates = result.availableTemplates.filter(
    (template) => assets.length >= template.minPhotos && assets.length <= template.maxPhotos
  );

  if (compatibleTemplates.length === 0) {
    return result;
  }

  const nextTemplate = selectBestTemplate(assets, compatibleTemplates, targetPage.sheetSpec);
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const assignments = assignImagesToTemplate(assets, nextTemplate, result.request.fitMode, result.request.cropStrategy, targetPage.sheetSpec).map((assignment) =>
    normalizeManualCropForSlot(
      withPreservedAssignmentState(assignment, previousAssignments.get(assignment.imageId)),
      assetById.get(assignment.imageId),
      nextTemplate.slots.find((slot) => slot.id === assignment.slotId),
      targetPage.sheetSpec,
      nextTemplate.slots.length
    )
  );

  const nextPage = syncPageImageIds({
    ...targetPage,
    templateId: nextTemplate.id,
    templateLabel: nextTemplate.label,
    slotDefinitions: nextTemplate.slots,
    assignments,
    warnings: (() => {
      if (assignments.length >= assets.length) return [];
      const unassignedCount = assets.length - assignments.length;
      const slotCount = nextTemplate.slots.length;
      return [
        `${unassignedCount} ${unassignedCount === 1 ? "foto" : "foto"} non ${unassignedCount === 1 ? "è stata" : "sono state"} inserite. ` +
        `Template ha ${assignments.length}/${slotCount} slot utilizzati. Scegli un layout più grande o crea un nuovo foglio.`
      ];
    })()
  });

  Object.assign(targetPage, nextPage);
  return finalize(result, pages);
}

export function rearrangePageImages(
  result: AutoLayoutResult,
  request: { pageId: string; preferredImageId?: string }
): AutoLayoutResult {
  const pages = clonePages(result);
  const targetPage = pages.find((page) => page.id === request.pageId);

  if (!targetPage) {
    return result;
  }

  const imageIds = collectAssignedImageIds(targetPage);
  if (imageIds.length === 0) {
    return result;
  }

  const preferredImageId = request.preferredImageId;
  const prioritizedImageIds =
    preferredImageId && imageIds.includes(preferredImageId)
      ? [preferredImageId, ...imageIds.filter((imageId) => imageId !== preferredImageId)]
      : imageIds;

  const previousAssignments = new Map(targetPage.assignments.map((assignment) => [assignment.imageId, assignment]));
  const assets = collectAssetsForLayout(result, prioritizedImageIds, previousAssignments);

  if (assets.length === 0) {
    return result;
  }

  const compatibleTemplates = result.availableTemplates.filter(
    (template) => assets.length >= template.minPhotos && assets.length <= template.maxPhotos
  );
  if (compatibleTemplates.length === 0) {
    return result;
  }
  const alternativeTemplates = compatibleTemplates.filter((template) => template.id !== targetPage.templateId);
  const nextTemplate =
    alternativeTemplates.length > 0
      ? selectBestTemplate(assets, alternativeTemplates, targetPage.sheetSpec)
      : selectBestTemplate(assets, compatibleTemplates, targetPage.sheetSpec);
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const assignments = assignImagesToTemplate(assets, nextTemplate, result.request.fitMode, result.request.cropStrategy, targetPage.sheetSpec).map((assignment) =>
    normalizeManualCropForSlot(
      withPreservedAssignmentState(assignment, previousAssignments.get(assignment.imageId)),
      assetById.get(assignment.imageId),
      nextTemplate.slots.find((slot) => slot.id === assignment.slotId),
      targetPage.sheetSpec,
      nextTemplate.slots.length
    )
  );

  const nextPage = syncPageImageIds({
    ...targetPage,
    templateId: nextTemplate.id,
    templateLabel: nextTemplate.label,
    slotDefinitions: nextTemplate.slots,
    assignments,
    warnings: (() => {
      if (assignments.length >= assets.length) return [];
      const unassignedCount = assets.length - assignments.length;
      const slotCount = nextTemplate.slots.length;
      return [
        `${unassignedCount} ${unassignedCount === 1 ? "foto" : "foto"} non ${unassignedCount === 1 ? "è stata" : "sono state"} inserite. ` +
        `Template ha ${assignments.length}/${slotCount} slot utilizzati. Scegli un layout più grande o crea un nuovo foglio.`
      ];
    })()
  });

  Object.assign(targetPage, nextPage);
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
          assignments: page.assignments.map((assignment) => {
            if (assignment.slotId !== request.slotId) {
              return assignment;
            }

            const slot = page.slotDefinitions.find((item) => item.id === request.slotId);
            const asset = result.request.assets.find((item) => item.id === assignment.imageId);
            const nextAssignment = { ...assignment, ...request.changes };

            return normalizeManualCropForSlot(
              nextAssignment,
              asset,
              slot,
              page.sheetSpec,
              page.slotDefinitions.length
            );
          })
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
  const previousAssignments = new Map(page.assignments.map((assignment) => [assignment.imageId, assignment]));
  const assets = collectAssetsForLayout(result, currentImageIds, previousAssignments);
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const assignments = assignImagesToTemplate(assets, template, result.request.fitMode, result.request.cropStrategy, page.sheetSpec).map((assignment) =>
    normalizeManualCropForSlot(
      withPreservedAssignmentState(assignment, previousAssignments.get(assignment.imageId)),
      assetById.get(assignment.imageId),
      template.slots.find((slot) => slot.id === assignment.slotId),
      page.sheetSpec,
      template.slots.length
    )
  );

  const pages = clonePages(result).map((item) =>
    item.id === request.pageId
      ? syncPageImageIds({
          ...item,
          templateId: template.id,
          templateLabel: template.label,
          slotDefinitions: template.slots,
          assignments,
          warnings: (() => {
            if (assignments.length >= assets.length) return [];
            const unassignedCount = assets.length - assignments.length;
            const slotCount = template.slots.length;
            return [
              `${unassignedCount} ${unassignedCount === 1 ? "foto" : "foto"} non ${unassignedCount === 1 ? "è stata" : "sono state"} inserite. ` +
              `Template ha ${assignments.length}/${slotCount} slot utilizzati. Prova un layout più grande.`
            ];
          })()
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
  const assignments = assignImagesToTemplate(assets, template, result.request.fitMode, result.request.cropStrategy, result.request.sheet).map((assignment) =>
    withPreservedAssignmentState(assignment)
  );
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
      warnings: (() => {
        if (assignments.length >= assets.length) return [];
        const unassignedCount = assets.length - assignments.length;
        const slotCount = template.slots.length;
        return [
          `${unassignedCount} ${unassignedCount === 1 ? "foto" : "foto"} non ${unassignedCount === 1 ? "è stata" : "sono state"} inserite. ` +
          `Template ha ${assignments.length}/${slotCount} slot utilizzati. Prova un layout più grande o aggiungine un altro.`
        ];
      })()
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

export function updatePageSheetSpec(
  result: AutoLayoutResult,
  request: UpdatePageSheetSpecRequest
): AutoLayoutResult {
  const pages = clonePages(result).map((page) =>
    page.id === request.pageId
      ? {
          ...page,
          sheetSpec: {
            ...page.sheetSpec,
            ...request.changes
          }
        }
      : page
  );

  return finalize(result, pages);
}
