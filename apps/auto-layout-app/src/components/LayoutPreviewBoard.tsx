import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { SHEET_PRESETS } from "@photo-tools/presets";
import { selectBestTemplate } from "@photo-tools/layout-engine";
import type {
  AutoLayoutResult,
  RulerUnit,
  GeneratedPageLayout,
  ImageAsset,
  LayoutAssignment,
  LayoutMove,
  LayoutTemplate
} from "@photo-tools/shared-types";
import { ConfirmModal } from "./ConfirmModal";
import { PageSettingsPanel } from "./PageSettingsPanel";
import { CropEditorModal } from "./CropEditorModal";
import { useStudio } from "./StudioContext";
import { SheetSurface, buildAssignmentsBySlotId } from "./SheetSurface";
import { preloadImageUrls } from "../image-cache";
import { PhotoReplaceModal } from "./PhotoReplaceModal";
import { PhotoRibbon } from "./PhotoRibbon";

type AssetFilter = "all" | "unused" | "used";
type PageSectionFilter = "all" | "opening" | "middle" | "finale";

interface DragState {
  kind: "asset" | "slot";
  imageId: string;
  sourcePageId?: string;
  sourceSlotId?: string;
}

interface AssetUsage {
  pageId: string;
  pageNumber: number;
  slotId: string;
}

interface ReplaceTarget {
  pageId: string;
  pageNumber: number;
  slotId: string;
  currentImageId?: string;
}

type ResizePane = "left";
type PageHeaderPanel = "background" | "border";

interface LayoutPreviewBoardProps {
  result: AutoLayoutResult;
  assets: ImageAsset[];
  availableAssetsForPicker: ImageAsset[];
  activeAssetIds: string[];
  assetsById: Map<string, ImageAsset>;
  usageByAssetId: Map<string, AssetUsage>;
  selectedPageId: string | null;
  selectedSlotKey: string | null;
  dragState: DragState | null;
  stagedImageIds: string[];
  isTransferTrayPinned: boolean;
  onToggleTransferTrayPinned: () => void;
  onStageImage: (imageId: string) => void;
  onUnstageImage: (imageId: string) => void;
  onClearStagedImages: () => void;
  onSelectPage: (pageId: string, slotId?: string) => void;
  onStartSlotDrag: (pageId: string, slotId: string, imageId: string) => void;
  onDragAssetStart: (imageId: string) => void;
  onDragEnd: () => void;
  onDrop: (move: LayoutMove) => void;
  onAssetDropped: (pageId: string, slotId: string, imageId: string) => void;
  onAddToPage: (pageId: string, imageId: string) => void;
  onDropToUnused: () => void;
  onClearSlot: (pageId: string, slotId: string) => void;
  onTemplateChange: (pageId: string, templateId: string) => void;
  onApplyTemplateToPages: (pageIds: string[], templateId: string) => void;
  onCreatePageFromUnused: () => void;
  onCreatePageWithImage: (imageId: string) => void;
  onRemovePage: (pageId: string) => void;
  onRebalancePage: (pageId: string) => void;
  onContextMenu?: (event: MouseEvent, page: GeneratedPageLayout) => void;
  onPageSheetPresetChange: (pageId: string, presetId: string) => void;
  onPageSheetFieldChange: (
    pageId: string,
    field: "widthCm" | "heightCm" | "marginCm" | "gapCm" | "dpi" | "photoBorderWidthCm",
    value: number
  ) => void;
  onPageSheetStyleChange: (
    pageId: string,
    changes: {
      backgroundColor?: string;
      backgroundImageUrl?: string;
      photoBorderColor?: string;
      photoBorderWidthCm?: number;
      showRulers?: boolean;
      rulerUnit?: RulerUnit;
      verticalGuidesCm?: number[];
      horizontalGuidesCm?: number[];
    },
    activity?: string
  ) => void;
  recentlyRebalancedPageId?: string | null;
  recentlyAddedPageId?: string | null;
  recentlyAddedSlotKey?: string | null;
  onAssetsMetadataChange?: (
    changesById: Map<string, Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">>>
  ) => void;
  zoom: number;
  zoomMode: "manual" | "fit";
  onZoomResolved: (zoom: number) => void;
}

interface PreservedCropInfo {
  assignmentId: string;
  aspect: number;
}

interface TemplateCropCompatibility {
  matchedCount: number;
  totalCount: number;
  fullyCompatible: boolean;
  meanDistance: number;
}

interface PageCropGuidance {
  preservedCount: number;
  fullyCompatibleTemplateCount: number;
  currentTemplateCompatible: boolean;
  recommendedTemplateCompatible: boolean;
  recommendedTemplateId: string | null;
  tone: "ok" | "warning" | "critical" | null;
  title: string | null;
  detail: string | null;
}

const PRESERVED_CROP_TEMPLATE_TOLERANCE = 0.22;

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.isContentEditable ||
      target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']")
  );
}

function getTemplateOptions(templates: LayoutTemplate[], photoCount: number): LayoutTemplate[] {
  return templates.filter(
    (template) => photoCount >= template.minPhotos && photoCount <= template.maxPhotos
  );
}

function normalizedAspectDistance(left: number, right: number): number {
  return Math.abs(Math.log(Math.max(left, 0.0001) / Math.max(right, 0.0001)));
}

function normalizeRotation(value: number): number {
  const rounded = Math.round(value);
  const wrapped = ((rounded % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

function getPreservedCropAspect(asset: ImageAsset, assignment: LayoutAssignment): number {
  const cropWidth = Math.min(1, Math.max(0.05, assignment.cropWidth ?? 1));
  const cropHeight = Math.min(1, Math.max(0.05, assignment.cropHeight ?? 1));
  let aspect = Math.max(asset.aspectRatio, 0.01) * (cropWidth / cropHeight);
  if (Math.abs(normalizeRotation(assignment.rotation ?? 0)) % 180 === 90) {
    aspect = 1 / Math.max(aspect, 0.01);
  }
  return Math.max(aspect, 0.01);
}

function collectPreservedCropInfo(
  page: GeneratedPageLayout,
  assetsById: Map<string, ImageAsset>
): PreservedCropInfo[] {
  return page.assignments
    .filter((assignment) => assignment.fitMode === "fit")
    .map((assignment) => {
      const asset = assetsById.get(assignment.imageId);
      if (!asset) {
        return null;
      }

      return {
        assignmentId: assignment.imageId,
        aspect: getPreservedCropAspect(asset, assignment)
      };
    })
    .filter((item): item is PreservedCropInfo => Boolean(item));
}

function evaluateTemplateCropCompatibility(
  template: LayoutTemplate,
  preservedCrops: PreservedCropInfo[]
): TemplateCropCompatibility {
  if (preservedCrops.length === 0) {
    return {
      matchedCount: 0,
      totalCount: 0,
      fullyCompatible: true,
      meanDistance: 0
    };
  }

  let matchedCount = 0;
  let distanceTotal = 0;

  for (const crop of preservedCrops) {
    const bestDistance = template.slots.reduce((best, slot) => {
      const slotAspect = slot.width / Math.max(slot.height, 0.0001);
      return Math.min(best, normalizedAspectDistance(crop.aspect, slotAspect));
    }, Number.POSITIVE_INFINITY);

    distanceTotal += bestDistance;
    if (bestDistance <= PRESERVED_CROP_TEMPLATE_TOLERANCE) {
      matchedCount += 1;
    }
  }

  return {
    matchedCount,
    totalCount: preservedCrops.length,
    fullyCompatible: matchedCount === preservedCrops.length,
    meanDistance: distanceTotal / preservedCrops.length
  };
}

function buildPageCropGuidance(
  preservedCrops: PreservedCropInfo[],
  templates: LayoutTemplate[],
  currentTemplateId: string,
  recommendedTemplateId: string | null
): PageCropGuidance {
  if (preservedCrops.length === 0) {
    return {
      preservedCount: 0,
      fullyCompatibleTemplateCount: 0,
      currentTemplateCompatible: true,
      recommendedTemplateCompatible: true,
      recommendedTemplateId,
      tone: null,
      title: null,
      detail: null
    };
  }

  const compatibilityByTemplateId = new Map(
    templates.map((template) => [template.id, evaluateTemplateCropCompatibility(template, preservedCrops)])
  );
  const fullyCompatibleTemplateCount = Array.from(compatibilityByTemplateId.values()).filter(
    (compatibility) => compatibility.fullyCompatible
  ).length;
  const currentTemplateCompatible = compatibilityByTemplateId.get(currentTemplateId)?.fullyCompatible ?? false;
  const recommendedTemplateCompatible = recommendedTemplateId
    ? compatibilityByTemplateId.get(recommendedTemplateId)?.fullyCompatible ?? false
    : false;

  if (currentTemplateCompatible) {
    return {
      preservedCount: preservedCrops.length,
      fullyCompatibleTemplateCount,
      currentTemplateCompatible,
      recommendedTemplateCompatible,
      recommendedTemplateId,
      tone: "ok",
      title: preservedCrops.length === 1 ? "Crop preservato compatibile" : "Crop preservati compatibili",
      detail:
        fullyCompatibleTemplateCount === 1
          ? "Il template attuale e l'unico che valorizza bene questo crop preservato."
          : `Il template attuale valorizza bene questi crop preservati. Template compatibili: ${fullyCompatibleTemplateCount}.`
    };
  }

  if (fullyCompatibleTemplateCount > 0) {
    return {
      preservedCount: preservedCrops.length,
      fullyCompatibleTemplateCount,
      currentTemplateCompatible,
      recommendedTemplateCompatible,
      recommendedTemplateId,
      tone: "warning",
      title: "Crop preservato da riallineare",
      detail: recommendedTemplateCompatible
        ? "Il template consigliato valorizza meglio i crop preservati di questo foglio."
        : `Esistono ${fullyCompatibleTemplateCount} template piu adatti ai crop preservati di questo foglio.`
    };
  }

  return {
    preservedCount: preservedCrops.length,
    fullyCompatibleTemplateCount,
    currentTemplateCompatible,
    recommendedTemplateCompatible,
    recommendedTemplateId,
    tone: "critical",
    title: "Nessun template ideale",
    detail: "I crop preservati restano validi, ma nessun template disponibile li valorizza davvero bene."
  };
}

function getSheetAspectRatio(page: GeneratedPageLayout): string {
  const width = Math.max(page.sheetSpec.widthCm, 0.1);
  const height = Math.max(page.sheetSpec.heightCm, 0.1);
  return String(width / height);
}

function formatMeasurement(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function getSheetPreviewStyle(page: GeneratedPageLayout): CSSProperties {
  const backgroundImage = page.sheetSpec.backgroundImageUrl?.trim();
  return {
    aspectRatio: getSheetAspectRatio(page),
    backgroundColor: page.sheetSpec.backgroundColor ?? "#ffffff",
    backgroundImage: backgroundImage ? `url("${backgroundImage}")` : undefined,
    backgroundSize: backgroundImage ? "cover" : undefined,
    backgroundPosition: backgroundImage ? "center" : undefined
  };
}

function normalizeGuides(values: number[] | undefined, maxCm: number): number[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .filter((value) => Number.isFinite(value) && value > 0 && value < maxCm)
        .map((value) => Number(value.toFixed(3)))
    )
  ).sort((left, right) => left - right);
}

function cmToPixels(cm: number, dpi: number): number {
  return (cm / 2.54) * dpi;
}

function buildRulerTicks(page: GeneratedPageLayout, axis: "horizontal" | "vertical"): Array<{ position: number; label?: string; major: boolean }> {
  const sizeCm = axis === "horizontal" ? page.sheetSpec.widthCm : page.sheetSpec.heightCm;
  const sizePx = cmToPixels(sizeCm, page.sheetSpec.dpi);
  const unit = page.sheetSpec.rulerUnit ?? "cm";
  const majorStep = unit === "px" ? 100 : 1;
  const minorStep = unit === "px" ? 50 : 0.5;
  const totalUnits = unit === "px" ? sizePx : sizeCm;
  const ticks: Array<{ position: number; label?: string; major: boolean }> = [];

  for (let value = 0; value <= totalUnits + 0.001; value += minorStep) {
    const rounded = Number(value.toFixed(3));
    const position = totalUnits <= 0 ? 0 : rounded / totalUnits;
    const major = Math.abs((rounded / majorStep) - Math.round(rounded / majorStep)) < 0.001;
    ticks.push({
      position: Math.min(1, Math.max(0, position)),
      label: major ? `${Math.round(rounded)}` : undefined,
      major
    });
  }

  return ticks;
}

function guideCmFromPointer(event: MouseEvent<HTMLDivElement>, page: GeneratedPageLayout, axis: "horizontal" | "vertical"): number {
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = axis === "horizontal"
    ? (event.clientX - rect.left) / Math.max(rect.width, 1)
    : (event.clientY - rect.top) / Math.max(rect.height, 1);
  const maxCm = axis === "horizontal" ? page.sheetSpec.widthCm : page.sheetSpec.heightCm;
  return Number((Math.min(1, Math.max(0, ratio)) * maxCm).toFixed(3));
}

function renderGuideLines(page: GeneratedPageLayout) {
  if (!page.sheetSpec.showRulers) {
    return null;
  }

  const verticalGuides = normalizeGuides(page.sheetSpec.verticalGuidesCm, page.sheetSpec.widthCm);
  const horizontalGuides = normalizeGuides(page.sheetSpec.horizontalGuidesCm, page.sheetSpec.heightCm);

  if (verticalGuides.length === 0 && horizontalGuides.length === 0) {
    return null;
  }

  return (
    <div className="sheet-guide-layer" aria-hidden="true">
      {verticalGuides.map((guideCm) => (
        <span
          key={`v-${guideCm}`}
          className="sheet-guide sheet-guide--vertical"
          style={{ left: `${(guideCm / Math.max(page.sheetSpec.widthCm, 0.1)) * 100}%` }}
        />
      ))}
      {horizontalGuides.map((guideCm) => (
        <span
          key={`h-${guideCm}`}
          className="sheet-guide sheet-guide--horizontal"
          style={{ top: `${(guideCm / Math.max(page.sheetSpec.heightCm, 0.1)) * 100}%` }}
        />
      ))}
    </div>
  );
}
function getSlotDisplayRect(
  page: GeneratedPageLayout,
  slot: GeneratedPageLayout["slotDefinitions"][number]
): { left: number; top: number; width: number; height: number } {
  const sheetWidth = Math.max(page.sheetSpec.widthCm, 0.1);
  const sheetHeight = Math.max(page.sheetSpec.heightCm, 0.1);
  const marginX = Math.min(0.3, Math.max(0, page.sheetSpec.marginCm / sheetWidth));
  const marginY = Math.min(0.3, Math.max(0, page.sheetSpec.marginCm / sheetHeight));
  const contentWidth = Math.max(0.1, 1 - marginX * 2);
  const contentHeight = Math.max(0.1, 1 - marginY * 2);

  let left = marginX + slot.x * contentWidth;
  let top = marginY + slot.y * contentHeight;
  let width = slot.width * contentWidth;
  let height = slot.height * contentHeight;

  if (page.slotDefinitions.length > 1 && page.sheetSpec.gapCm > 0) {
    const insetX = Math.min((page.sheetSpec.gapCm / sheetWidth) / 2, width / 3);
    const insetY = Math.min((page.sheetSpec.gapCm / sheetHeight) / 2, height / 3);
    left += insetX;
    top += insetY;
    width = Math.max(0.01, width - insetX * 2);
    height = Math.max(0.01, height - insetY * 2);
  }

  return { left, top, width, height };
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function findVerticalScrollContainer(element: HTMLElement | null): HTMLElement | Window {
  let current = element?.parentElement ?? null;

  while (current) {
    const styles = window.getComputedStyle(current);
    const overflowY = styles.overflowY;
    const canScroll =
      (overflowY === "auto" || overflowY === "scroll") && current.scrollHeight > current.clientHeight;

    if (canScroll) {
      return current;
    }

    current = current.parentElement;
  }

  return window;
}

function renderTemplateMiniMap(template: LayoutTemplate) {
  return (
    <div className="template-card__map">
      {template.slots.map((slot) => (
        <span
          key={slot.id}
          className="template-card__slot"
          style={{
            left: `${slot.x * 100}%`,
            top: `${slot.y * 100}%`,
            width: `${slot.width * 100}%`,
            height: `${slot.height * 100}%`
          }}
        />
      ))}
    </div>
  );
}

interface TemplateChangeConfirmation {
  templateId: string;
  applyScope: "single" | "visible";
}

function renderSlotMiniMap(slots: LayoutTemplate["slots"]) {
  return (
    <div className="template-card__map">
      {slots.map((slot) => (
        <span
          key={slot.id}
          className="template-card__slot"
          style={{
            left: `${slot.x * 100}%`,
            top: `${slot.y * 100}%`,
            width: `${slot.width * 100}%`,
            height: `${slot.height * 100}%`
          }}
        />
      ))}
    </div>
  );
}

function getTemplateDensity(slots: LayoutTemplate["slots"]): number {
  return slots.reduce((total, slot) => total + slot.width * slot.height, 0);
}

function describeTemplateDensity(
  currentSlots: LayoutTemplate["slots"],
  previewSlots: LayoutTemplate["slots"] | null
): string {
  if (!previewSlots) {
    return "Nessuna comparazione disponibile";
  }

  const currentDensity = getTemplateDensity(currentSlots);
  const previewDensity = getTemplateDensity(previewSlots);
  const difference = previewDensity - currentDensity;

  if (Math.abs(difference) < 0.04) {
    return "Densita simile";
  }

  return difference < 0 ? "Layout piu arioso" : "Layout piu compatto";
}

function getLargestSlot(slots: LayoutTemplate["slots"]) {
  return [...slots].sort((left, right) => right.width * right.height - left.width * left.height)[0] ?? null;
}

function requiresTemplateChangeConfirmation(
  currentSlots: LayoutTemplate["slots"],
  nextSlots: LayoutTemplate["slots"]
): boolean {
  const currentLargest = getLargestSlot(currentSlots);
  const nextLargest = getLargestSlot(nextSlots);

  if (!currentLargest || !nextLargest) {
    return false;
  }

  const currentArea = currentLargest.width * currentLargest.height;
  const nextArea = nextLargest.width * nextLargest.height;
  const areaDelta = Math.abs(nextArea - currentArea);
  const orientationChanged = currentLargest.expectedOrientation !== nextLargest.expectedOrientation;

  return areaDelta >= 0.12 || orientationChanged;
}

function SheetWithRulers({
  page,
  children,
  onPageSheetStyleChange
}: {
  page: GeneratedPageLayout;
  children: import("react").ReactNode;
  onPageSheetStyleChange: LayoutPreviewBoardProps["onPageSheetStyleChange"];
}) {
  const showRulers = page.sheetSpec.showRulers ?? false;
  const horizontalTicks = useMemo(() => buildRulerTicks(page, "horizontal"), [page]);
  const verticalTicks = useMemo(() => buildRulerTicks(page, "vertical"), [page]);

  const addGuideFromRuler = useCallback((axis: "horizontal" | "vertical", event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const nextGuideCm = guideCmFromPointer(event, page, axis);
    const field = axis === "horizontal" ? "verticalGuidesCm" : "horizontalGuidesCm";
    const maxCm = axis === "horizontal" ? page.sheetSpec.widthCm : page.sheetSpec.heightCm;
    const nextGuides = normalizeGuides([...(page.sheetSpec[field] ?? []), nextGuideCm], maxCm);
    onPageSheetStyleChange(
      page.id,
      { [field]: nextGuides },
      `${axis === "horizontal" ? "Guida verticale" : "Guida orizzontale"} aggiunta al foglio ${page.pageNumber}.`
    );
  }, [onPageSheetStyleChange, page]);

  if (!showRulers) {
    return <>{children}</>;
  }

  return (
    <div className="sheet-ruler-frame">
      <div className="sheet-ruler-corner" aria-hidden="true" />
      <div className="sheet-ruler sheet-ruler--top" onClick={(event) => addGuideFromRuler("horizontal", event)}>
        {horizontalTicks.map((tick) => (
          <span
            key={`top-${tick.position}-${tick.label ?? "minor"}`}
            className={tick.major ? "sheet-ruler__tick sheet-ruler__tick--major" : "sheet-ruler__tick"}
            style={{ left: `${tick.position * 100}%` }}
          >
            {tick.label ? <small>{tick.label}</small> : null}
          </span>
        ))}
      </div>
      <div className="sheet-ruler sheet-ruler--left" onClick={(event) => addGuideFromRuler("vertical", event)}>
        {verticalTicks.map((tick) => (
          <span
            key={`left-${tick.position}-${tick.label ?? "minor"}`}
            className={tick.major ? "sheet-ruler__tick sheet-ruler__tick--major" : "sheet-ruler__tick"}
            style={{ top: `${tick.position * 100}%` }}
          >
            {tick.label ? <small>{tick.label}</small> : null}
          </span>
        ))}
      </div>
      <div className="sheet-ruler-frame__surface">{children}</div>
    </div>
  );
}

export function LayoutPreviewBoard({
  result,
  assets,
  availableAssetsForPicker,
  activeAssetIds,
  assetsById,
  usageByAssetId,
  selectedPageId,
  selectedSlotKey,
  dragState,
  stagedImageIds,
  isTransferTrayPinned,
  onToggleTransferTrayPinned,
  onStageImage,
  onUnstageImage,
  onClearStagedImages,
  onSelectPage,
  onStartSlotDrag,
  onDragAssetStart,
  onDragEnd,
  onDrop,
  onAssetDropped,
  onAddToPage,
  onDropToUnused,
  onClearSlot,
  onTemplateChange,
  onApplyTemplateToPages,
  onCreatePageFromUnused,
  onCreatePageWithImage,
  onRemovePage,
  onRebalancePage,
  onContextMenu,
  onPageSheetPresetChange,
  onPageSheetFieldChange,
  onPageSheetStyleChange,
  recentlyRebalancedPageId,
  recentlyAddedPageId,
  recentlyAddedSlotKey,
  onAssetsMetadataChange,
  zoom,
  zoomMode,
  onZoomResolved
}: LayoutPreviewBoardProps) {
  const [isTemplateChooserOpen, setIsTemplateChooserOpen] = useState(false);
  const [templateApplyScope, setTemplateApplyScope] = useState<"single" | "visible">("single");
  const [templatePreviewId, setTemplatePreviewId] = useState<string | null>(null);
  const [pendingTemplateChange, setPendingTemplateChange] = useState<TemplateChangeConfirmation | null>(null);
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");
  const [pageSectionFilter, setPageSectionFilter] = useState<PageSectionFilter>("all");
  const [replaceTarget, setReplaceTarget] = useState<ReplaceTarget | null>(null);
  
  const { cropTarget, onOpenCropEditor: handleCropTargetOpen, onCloseCropEditor: handleCropTargetClose, onUpdateSlotAssignment } = useStudio();

  const [leftRailWidth, setLeftRailWidth] = useState(236);
  const [isPageSettingsOpen, setIsPageSettingsOpen] = useState(false);
  const [openPageHeaderPanel, setOpenPageHeaderPanel] = useState<{ pageId: string; panel: PageHeaderPanel } | null>(null);
  const [dragChipTargetPageId, setDragChipTargetPageId] = useState<string | null>(null);
  const [isTransferTrayOpen, setIsTransferTrayOpen] = useState(true);
  const [trayPosition, setTrayPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragChipTargetPageIdRef = useRef<string | null>(null);
  const resizeStateRef = useRef<{ pane: ResizePane; startX: number; startWidth: number } | null>(null);
  const trayRef = useRef<HTMLDivElement | null>(null);
  const trayRailRef = useRef<HTMLDivElement | null>(null);
  const trayDragStateRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const activePage = result.pages.find((page) => page.id === selectedPageId) ?? result.pages[0] ?? null;
  const activeIndex = activePage ? result.pages.findIndex((page) => page.id === activePage.id) : 0;
  const previousPage = activeIndex > 0 ? result.pages[activeIndex - 1] ?? null : null;
  const nextPage = activeIndex >= 0 ? result.pages[activeIndex + 1] ?? null : null;
  const compatibleTemplates = useMemo(
    () =>
      activePage
        ? getTemplateOptions(result.availableTemplates, Math.max(activePage.imageIds.length, 1))
        : [],
    [activePage, result.availableTemplates]
  );
  const availableAssetsById = useMemo(
    () => new Map(availableAssetsForPicker.map((asset) => [asset.id, asset] as const)),
    [availableAssetsForPicker]
  );
  const previewTemplate = useMemo(() => {
    if (templatePreviewId) {
      return compatibleTemplates.find((template) => template.id === templatePreviewId) ?? null;
    }

    if (activePage) {
      return (
        compatibleTemplates.find((template) => template.id !== activePage.templateId) ??
        compatibleTemplates.find((template) => template.id === activePage.templateId) ??
        null
      );
    }

    return null;
  }, [activePage, compatibleTemplates, templatePreviewId]);
  const recommendedTemplateId = useMemo(() => {
    if (!activePage || compatibleTemplates.length === 0) {
      return null;
    }

    const currentAssets = activePage.imageIds
      .map((imageId) => assetsById.get(imageId))
      .filter((asset): asset is ImageAsset => Boolean(asset));

    if (currentAssets.length === 0) {
      return null;
    }

    return selectBestTemplate(currentAssets, compatibleTemplates, activePage.sheetSpec).id;
  }, [activePage, assetsById, compatibleTemplates]);
  const templatesByPageId = useMemo(() => {
    const map = new Map<string, LayoutTemplate[]>();

    for (const page of result.pages) {
      map.set(page.id, getTemplateOptions(result.availableTemplates, Math.max(page.imageIds.length, 1)));
    }

    return map;
  }, [result.availableTemplates, result.pages]);
  const recommendedTemplateByPageId = useMemo(() => {
    const map = new Map<string, string>();

    for (const page of result.pages) {
      const pageTemplates = templatesByPageId.get(page.id) ?? [];
      if (pageTemplates.length === 0) {
        continue;
      }

      const currentAssets = page.imageIds
        .map((imageId) => assetsById.get(imageId))
        .filter((asset): asset is ImageAsset => Boolean(asset));

      if (currentAssets.length === 0) {
        continue;
      }

      map.set(page.id, selectBestTemplate(currentAssets, pageTemplates, page.sheetSpec).id);
    }

    return map;
  }, [assetsById, result.pages, templatesByPageId]);
  const pageCropGuidanceByPageId = useMemo(() => {
    const map = new Map<string, PageCropGuidance>();

    for (const page of result.pages) {
      const preservedCrops = collectPreservedCropInfo(page, assetsById);
      map.set(
        page.id,
        buildPageCropGuidance(
          preservedCrops,
          templatesByPageId.get(page.id) ?? [],
          page.templateId,
          recommendedTemplateByPageId.get(page.id) ?? null
        )
      );
    }

    return map;
  }, [assetsById, recommendedTemplateByPageId, result.pages, templatesByPageId]);
  
  const filteredAssets = useMemo(
    () =>
      assets.filter((asset) => {
        const isUsed = usageByAssetId.has(asset.id);
        if (assetFilter === "unused") {
          return !isUsed;
        }
        if (assetFilter === "used") {
          return isUsed;
        }
        return true;
      }),
    [assets, assetFilter, usageByAssetId]
  );
  
  const sectionedPages = useMemo(
    () =>
      result.pages.filter((page, index, pages) => {
        if (pageSectionFilter === "all") {
          return true;
        }

        const third = Math.max(1, Math.ceil(pages.length / 3));

        if (pageSectionFilter === "opening") {
          return index < third;
        }

        if (pageSectionFilter === "middle") {
          return index >= third && index < third * 2;
        }

        return index >= third * 2;
      }),
    [result.pages, pageSectionFilter]
  );
  const deferredAssets = useDeferredValue(filteredAssets);
  const deferredPages = useDeferredValue(sectionedPages);
  const activeAssignmentsBySlotId = useMemo(
    () => (activePage ? buildAssignmentsBySlotId(activePage) : new Map<string, LayoutAssignment>()),
    [activePage]
  );
  const selectedSlotId = selectedSlotKey?.split(":")[1] ?? null;
  const selectedSlot =
    selectedSlotId && activePage?.id === selectedPageId
      ? activePage.slotDefinitions.find((slot) => slot.id === selectedSlotId)
      : undefined;
  const selectedAssignment = selectedSlot ? activeAssignmentsBySlotId.get(selectedSlot.id) : undefined;
  const selectedAsset = selectedAssignment ? assetsById.get(selectedAssignment.imageId) : undefined;
  const cropPage = cropTarget ? result.pages.find((page) => page.id === cropTarget.pageId) : null;
  const cropSlot = cropTarget && cropPage ? cropPage.slotDefinitions.find((slot) => slot.id === cropTarget.slotId) : undefined;
  const cropAssignment = cropTarget && cropPage ? buildAssignmentsBySlotId(cropPage).get(cropTarget.slotId) : undefined;
  const cropAsset = cropAssignment ? assetsById.get(cropAssignment.imageId) : undefined;
  const activePageCropGuidance = activePage ? pageCropGuidanceByPageId.get(activePage.id) ?? null : null;
  const previewTemplateCropCompatibility = useMemo(
    () =>
      activePage && previewTemplate
        ? evaluateTemplateCropCompatibility( previewTemplate, collectPreservedCropInfo(activePage, assetsById))
        : null,
    [activePage, assetsById, previewTemplate]
  );
  // Memoized callbacks to reduce re-renders
  const handleReplaceTargetOpen = useCallback(
    (pageId: string, pageNumber: number, slotId: string, currentImageId?: string) => {
      window.setTimeout(() => {
        setReplaceTarget({ pageId, pageNumber, slotId, currentImageId });
      }, 0);
    },
    []
  );

  const handleReplaceTargetClose = useCallback(() => {
    setReplaceTarget(null);
  }, []);

  const handlePageBackgroundUpload = useCallback(
    (page: GeneratedPageLayout, event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      const input = event.currentTarget;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== "string") {
          return;
        }

        onPageSheetStyleChange(
          page.id,
          { backgroundImageUrl: reader.result },
          `Sfondo immagine assegnato al foglio ${page.pageNumber}.`
        );
      };
      reader.readAsDataURL(file);
      input.value = "";
    },
    [onPageSheetStyleChange]
  );

  const adjustPageBorderWidth = useCallback(
    (page: GeneratedPageLayout, delta: number) => {
      const nextValue = Math.max(0, Number(((page.sheetSpec.photoBorderWidthCm ?? 0) + delta).toFixed(2)));
      onPageSheetFieldChange(page.id, "photoBorderWidthCm", nextValue);
    },
    [onPageSheetFieldChange]
  );
  const handleAssetFilterChange = useCallback((filter: AssetFilter) => {
    setAssetFilter(filter);
  }, []);

  const handlePageSectionFilterChange = useCallback((filter: PageSectionFilter) => {
    setPageSectionFilter(filter);
  }, []);

  const handleTemplateChooserToggle = useCallback(() => {
    setIsTemplateChooserOpen((current) => !current);
  }, []);

  const stopPaneResize = useCallback(() => {
    resizeStateRef.current = null;
    if (typeof document !== "undefined") {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
  }, []);

  const handlePaneResizeStart = useCallback(
    (pane: ResizePane) => (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      resizeStateRef.current = {
        pane,
        startX: event.clientX,
        startWidth: leftRailWidth
      };
      if (typeof document !== "undefined") {
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }
    },
    [leftRailWidth]
  );

  const handleTemplateSelect = useCallback(
    (templateId: string) => {
      if (activePage) {
        const selectedTemplate = compatibleTemplates.find((template) => template.id === templateId);
        const shouldConfirm =
          Boolean(selectedTemplate) &&
          templateId !== activePage.templateId &&
          requiresTemplateChangeConfirmation(activePage.slotDefinitions, selectedTemplate?.slots ?? []);

        if (shouldConfirm) {
          setPendingTemplateChange({ templateId, applyScope: templateApplyScope });
          return;
        }

        if (templateApplyScope === "visible") {
          onApplyTemplateToPages(deferredPages.map((page) => page.id), templateId);
        } else {
          onTemplateChange(activePage.id, templateId);
        }
        setIsTemplateChooserOpen(false);
      }
    },
    [activePage, compatibleTemplates, deferredPages, onApplyTemplateToPages, onTemplateChange, templateApplyScope]
  );

  const handleReplaceAsset = useCallback(
    (imageId: string) => {
      if (replaceTarget) {
        onAssetDropped(replaceTarget.pageId, replaceTarget.slotId, imageId);
        onSelectPage(replaceTarget.pageId, replaceTarget.slotId);
        setReplaceTarget(null);
      }
    },
    [replaceTarget, onAssetDropped, onSelectPage]
  );
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const autoScrollVelocityRef = useRef(0);
  const autoScrollTargetRef = useRef<HTMLElement | Window | null>(null);
  const dragPageJumpTimeoutRef = useRef<number | null>(null);
  const dragPageJumpTargetIdRef = useRef<string | null>(null);
  const manualPageSelectionRef = useRef<{ pageId: string; expiresAt: number } | null>(null);

  const clearDragPageJump = useCallback(() => {
    if (dragPageJumpTimeoutRef.current !== null) {
      window.clearTimeout(dragPageJumpTimeoutRef.current);
      dragPageJumpTimeoutRef.current = null;
    }
    dragPageJumpTargetIdRef.current = null;
    if (dragChipTargetPageIdRef.current !== null) {
      dragChipTargetPageIdRef.current = null;
      setDragChipTargetPageId(null);
    }
  }, []);

  const setStableDragChipTargetPageId = useCallback((pageId: string | null) => {
    if (dragChipTargetPageIdRef.current === pageId) {
      return;
    }

    dragChipTargetPageIdRef.current = pageId;
    setDragChipTargetPageId(pageId);
  }, []);

  const setManualPageSelectionLock = useCallback((pageId: string, durationMs = 1200) => {
    manualPageSelectionRef.current = {
      pageId,
      expiresAt: Date.now() + durationMs
    };
  }, []);

  const clearManualPageSelectionLock = useCallback((pageId?: string) => {
    if (!manualPageSelectionRef.current) {
      return;
    }

    if (!pageId || manualPageSelectionRef.current.pageId === pageId) {
      manualPageSelectionRef.current = null;
    }
  }, []);

  const handleJumpToPage = useCallback(
    (page: GeneratedPageLayout) => {
      setManualPageSelectionLock(page.id);
      onSelectPage(page.id, page.slotDefinitions[0]?.id);

      if (typeof document !== "undefined") {
        requestAnimationFrame(() => {
          document.getElementById(`layout-page-${page.id}`)?.scrollIntoView({
            behavior: "smooth",
            block: "center"
          });
        });
      }
    },
    [onSelectPage, setManualPageSelectionLock]
  );


  const handleOpenPageSettingsForPage = useCallback(
    (page: GeneratedPageLayout) => {
      setIsPageSettingsOpen(true);
      handleJumpToPage(page);
    },
    [handleJumpToPage]
  );

  const handleTogglePageHeaderPanel = useCallback((pageId: string, panel: PageHeaderPanel) => {
    setOpenPageHeaderPanel((current) =>
      current?.pageId === pageId && current.panel === panel ? null : { pageId, panel }
    );
  }, []);

  useEffect(() => {
    if (!openPageHeaderPanel) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(".page-context-header__appearance") ||
        target?.closest(".page-context-header__style-popover")
      ) {
        return;
      }

      setOpenPageHeaderPanel(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenPageHeaderPanel(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openPageHeaderPanel]);

  const handleSelectPageFromCard = useCallback(
    (event: MouseEvent<HTMLElement>, page: GeneratedPageLayout) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "button, input, select, textarea, label, .sheet-slot, .slot-quick-toolbar, .sheet-ruler, .sheet-ruler-corner, .layout-studio__page-rearrange-banner, .layout-studio__page-header-dropzone, .sheet-add-target"
        )
      ) {
        return;
      }

      setManualPageSelectionLock(page.id, 800);
      onSelectPage(page.id, page.slotDefinitions[0]?.id);
    },
    [onSelectPage, setManualPageSelectionLock]
  );

  const scheduleDragPageJump = useCallback(
    (page: GeneratedPageLayout | null) => {
      if (!dragState || !page) {
        clearDragPageJump();
        return;
      }

      if (dragPageJumpTargetIdRef.current === page.id && dragPageJumpTimeoutRef.current !== null) {
        return;
      }

      clearDragPageJump();
      dragPageJumpTargetIdRef.current = page.id;

      dragPageJumpTimeoutRef.current = window.setTimeout(() => {
        handleJumpToPage(page);
        dragPageJumpTargetIdRef.current = page.id;
        dragPageJumpTimeoutRef.current = null;
      }, 220);
    },
    [clearDragPageJump, dragState, handleJumpToPage]
  );

  const stopAutoScroll = useCallback(() => {
    autoScrollVelocityRef.current = 0;
    autoScrollTargetRef.current = null;

    if (autoScrollFrameRef.current !== null) {
      cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!dragState) {
      setStableDragChipTargetPageId(null);
      clearDragPageJump();
    }
  }, [clearDragPageJump, dragState, setStableDragChipTargetPageId]);

  const runAutoScroll = useCallback(() => {
    const target = autoScrollTargetRef.current;
    const velocity = autoScrollVelocityRef.current;

    if (!target || velocity === 0) {
      autoScrollFrameRef.current = null;
      return;
    }

    if (target === window) {
      window.scrollBy({ top: velocity });
    } else if (target instanceof HTMLElement) {
      target.scrollTop += velocity;
    }

    autoScrollFrameRef.current = requestAnimationFrame(runAutoScroll);
  }, []);

  const handleCanvasDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!dragState) {
        stopAutoScroll();
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) {
        stopAutoScroll();
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const threshold = Math.min(96, rect.height * 0.16);
      const distanceFromTop = event.clientY - rect.top;
      const distanceFromBottom = rect.bottom - event.clientY;
      let nextVelocity = 0;

      if (distanceFromTop < threshold) {
        nextVelocity = -Math.ceil(((threshold - distanceFromTop) / threshold) * 18);
      } else if (distanceFromBottom < threshold) {
        nextVelocity = Math.ceil(((threshold - distanceFromBottom) / threshold) * 18);
      }

      if (nextVelocity === 0) {
        stopAutoScroll();
        return;
      }

      autoScrollVelocityRef.current = nextVelocity;
      autoScrollTargetRef.current = findVerticalScrollContainer(canvas);

      if (autoScrollFrameRef.current === null) {
        autoScrollFrameRef.current = requestAnimationFrame(runAutoScroll);
      }
    },
    [dragState, runAutoScroll, stopAutoScroll]
  );

  useEffect(() => {
    if (zoomMode !== "fit" || typeof window === "undefined") {
      return;
    }

    const computeFitZoom = () => {
      const canvasElement = canvasRef.current;
      const pageElement = document.getElementById(`layout-page-${activePage.id}`);
      if (!canvasElement || !pageElement) {
        return;
      }

      const canvasRect = canvasElement.getBoundingClientRect();
      const availableWidth = Math.max(canvasRect.width - 32, 320);
      const availableHeight = Math.max(window.innerHeight - canvasRect.top - 40, 320);
      const widthZoom = availableWidth / Math.max(pageElement.offsetWidth, 1);
      const heightZoom = availableHeight / Math.max(pageElement.offsetHeight, 1);
      const nextZoom = Math.max(0.5, Math.min(1, Math.min(widthZoom, heightZoom)));

      onZoomResolved(Number(nextZoom.toFixed(2)));
    };

    computeFitZoom();
    window.addEventListener("resize", computeFitZoom);

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => computeFitZoom())
        : null;

    if (resizeObserver) {
      if (canvasRef.current) {
        resizeObserver.observe(canvasRef.current);
      }

      const pageElement = document.getElementById(`layout-page-${activePage.id}`);
      if (pageElement) {
        resizeObserver.observe(pageElement);
      }
    }

    return () => {
      window.removeEventListener("resize", computeFitZoom);
      resizeObserver?.disconnect();
    };
  }, [activePage.id, leftRailWidth, onZoomResolved, zoomMode]);

  useEffect(() => {
    const trayRailElement = trayRailRef.current;
    if (!trayRailElement) {
      return;
    }

    const clampTrayPosition = (x: number, y: number) => {
      const trayWidth = trayRef.current?.offsetWidth ?? 400;
      const maxLeftTravel = Math.max(0, trayRailElement.clientWidth - trayWidth - 12);
      const maxY = 28;

      return {
        x: Math.min(0, Math.max(-maxLeftTravel, x)),
        y: Math.min(Math.max(0, y), maxY)
      };
    };

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = trayDragStateRef.current;
      if (!dragState) {
        return;
      }

      setTrayPosition(
        clampTrayPosition(
          dragState.originX + (event.clientX - dragState.startX),
          dragState.originY + (event.clientY - dragState.startY)
        )
      );
    };

    const handlePointerUp = () => {
      const trayWidth = trayRef.current?.offsetWidth ?? 400;
      const maxLeftTravel = Math.max(0, trayRailElement.clientWidth - trayWidth - 12);
      const snapThreshold = Math.min(88, Math.max(44, maxLeftTravel * 0.28));

      setTrayPosition((current) => {
        const snappedX =
          maxLeftTravel <= 0
            ? 0
            : Math.abs(current.x) <= snapThreshold
              ? 0
              : Math.abs(current.x + maxLeftTravel) <= snapThreshold
                ? -maxLeftTravel
                : current.x;

        return clampTrayPosition(snappedX, current.y);
      });
      trayDragStateRef.current = null;
    };

    const handleResize = () => {
      setTrayPosition((current) => clampTrayPosition(current.x, current.y));
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    setIsTemplateChooserOpen(false);
    setReplaceTarget(null);
    setTemplatePreviewId(null);
    setPendingTemplateChange(null);
  }, [activePage?.id]);

  useEffect(() => {
    if (!dragState) {
      stopAutoScroll();
      clearDragPageJump();
    }

    return () => {
      stopAutoScroll();
      clearDragPageJump();
    };
  }, [clearDragPageJump, dragState, stopAutoScroll]);

  useEffect(() => {
    const preloadPages = result.pages.slice(Math.max(0, activeIndex - 1), Math.min(result.pages.length, activeIndex + 2));
    const preloadUrls = preloadPages.flatMap((page) =>
      page.assignments
        .map((assignment) => assetsById.get(assignment.imageId)?.previewUrl ?? assetsById.get(assignment.imageId)?.thumbnailUrl)
        .filter((url): url is string => Boolean(url))
    );

    preloadImageUrls(preloadUrls);
  }, [activeIndex, assetsById, result.pages]);

  const pagesForStudio = deferredPages.length > 0 ? deferredPages : result.pages;

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement || pagesForStudio.length === 0 || dragState) {
      return;
    }

    const ratioByPageId = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        let shouldUpdate = false;

        for (const entry of entries) {
          const pageId = (entry.target as HTMLElement).dataset.pageId;
          if (!pageId) {
            continue;
          }

          ratioByPageId.set(pageId, entry.isIntersecting ? entry.intersectionRatio : 0);
          shouldUpdate = true;
        }

        if (!shouldUpdate) {
          return;
        }

        let bestPageId: string | null = null;
        let bestRatio = 0;

        for (const page of pagesForStudio) {
          const ratio = ratioByPageId.get(page.id) ?? 0;
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestPageId = page.id;
          }
        }

        if (!bestPageId || bestPageId === activePage?.id || bestRatio < 0.42) {
          return;
        }

        const manualSelection = manualPageSelectionRef.current;
        if (manualSelection) {
          if (Date.now() < manualSelection.expiresAt) {
            if (bestPageId === manualSelection.pageId && bestRatio >= 0.55) {
              clearManualPageSelectionLock(bestPageId);
            }
            return;
          }

          clearManualPageSelectionLock();
        }

        const nextPage = pagesForStudio.find((page) => page.id === bestPageId);
        if (!nextPage) {
          return;
        }

        onSelectPage(nextPage.id, nextPage.slotDefinitions[0]?.id);
      },
      {
        root: canvasElement,
        threshold: [0.2, 0.35, 0.5, 0.65, 0.8]
      }
    );

    const pageElements = canvasElement.querySelectorAll<HTMLElement>("[data-page-id]");
    pageElements.forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
    };
  }, [activePage?.id, clearManualPageSelectionLock, dragState, onSelectPage, pagesForStudio]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;

      if (!resizeState) {
        return;
      }

      const deltaX = event.clientX - resizeState.startX;

      if (resizeState.pane === "left") {
        setLeftRailWidth(clampValue(resizeState.startWidth + deltaX, 220, 420));
      }
    };

    const handlePointerUp = () => {
      stopPaneResize();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      stopPaneResize();
    };
  }, [stopPaneResize]);

  if (!activePage) {
    return <p className="helper-copy">Non ci sono ancora fogli da mostrare.</p>;
  }
  const workspaceStyle = {
    "--layout-rail-width": `${leftRailWidth}px`,
    "--layout-inspector-width": "clamp(272px, 22vw, 320px)"
  } as CSSProperties;

  return (
    <div className="layout-studio">
      <div className="layout-studio__context-bar">
        <div className="layout-studio__context-bar-info">
          <span className="layout-studio__context-bar-label">Foglio {activePage.pageNumber}</span>
          <span className="layout-studio__context-bar-meta">
            {activePage.sheetSpec.label} · {formatMeasurement(activePage.sheetSpec.widthCm)}×{formatMeasurement(activePage.sheetSpec.heightCm)} cm · {activePage.templateLabel}
          </span>
        </div>

        <div className="layout-studio__context-bar-actions">
          <button
            type="button"
            className={`secondary-button secondary-button--compact ${isPageSettingsOpen ? "is-active" : ""}`}
            onClick={() => setIsPageSettingsOpen((current) => !current)}
          >
            Foglio
          </button>
          <button
            type="button"
            className="secondary-button secondary-button--compact"
            onClick={onCreatePageFromUnused}
          >
            Nuovo foglio
          </button>
          <button
            type="button"
            className={`secondary-button secondary-button--compact ${isTemplateChooserOpen ? "is-active" : ""}`}
            onClick={handleTemplateChooserToggle}
          >
            Template
          </button>
        </div>
      </div>

      <div className="layout-studio__workspace" style={workspaceStyle}>
        <aside className="layout-studio__sidebar">
          <PhotoRibbon
            assets={deferredAssets}
            assetFilter={assetFilter}
            usageByAssetId={usageByAssetId}
            dragState={dragState}
            variant="vertical"
            onAssetFilterChange={handleAssetFilterChange}
            onDragAssetStart={onDragAssetStart}
            onDragEnd={onDragEnd}
            onAssetsMetadataChange={onAssetsMetadataChange}
              onAssetDoubleClick={
                selectedSlot
                  ? (imageId) => onAssetDropped(activePage.id, selectedSlot.id, imageId)
                  : undefined
              }
            />
        </aside>

        <div
          className="layout-studio__splitter layout-studio__splitter--left"
          role="separator"
          aria-orientation="vertical"
          aria-label="Ridimensiona libreria foto"
          onPointerDown={handlePaneResizeStart("left")}
        />

        <div className="layout-studio__main">
          <div className="layout-studio__unified-nav">
            <div className="layout-studio__unified-nav-filters">
              {([
                ["all", "Tutti"],
                ["opening", "Apertura"],
                ["middle", "Centro"],
                ["finale", "Finale"]
              ] as [PageSectionFilter, string][]).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={pageSectionFilter === value ? "segment segment--active" : "segment"}
                  onClick={() => handlePageSectionFilterChange(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="layout-studio__unified-nav-controls">
              <button
                type="button"
                className="icon-button"
                onClick={() => previousPage && handleJumpToPage(previousPage)}
                disabled={!previousPage}
                title="Foglio precedente"
              >
                ←
              </button>
              <div className="layout-studio__unified-nav-tabs" role="tablist">
                {pagesForStudio.map((page) => {
                  const isActive = page.id === activePage.id;
                  const isDragTarget = dragChipTargetPageId === page.id;

                  return (
                    <button
                      key={page.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      className={[
                        "layout-studio__tab",
                        isActive ? "layout-studio__tab--active" : "",
                        isDragTarget ? "layout-studio__tab--drop-target" : ""
                      ].filter(Boolean).join(" ")}
                      onClick={() => handleJumpToPage(page)}
                      onDragOver={
                        dragState
                          ? (event) => {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                              setStableDragChipTargetPageId(page.id);
                              scheduleDragPageJump(page);
                            }
                          : undefined
                      }
                      onDragLeave={
                        dragState
                          ? (event) => {
                              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                                clearDragPageJump();
                              }
                            }
                          : undefined
                      }
                      onDrop={
                        dragState
                          ? (event) => {
                              event.preventDefault();
                              stopAutoScroll();
                              clearDragPageJump();
                              handleJumpToPage(page);
                              onAddToPage(page.id, dragState.imageId);
                            }
                          : undefined
                      }
                    >
                      {page.pageNumber}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => nextPage && handleJumpToPage(nextPage)}
                disabled={!nextPage}
                title="Foglio successivo"
              >
                →
              </button>
            </div>
          </div>

          {isTemplateChooserOpen ? (
            <div className="template-drawer">
              <div className="template-drawer__header">
                <div>
                  <strong>Template compatibili</strong>
                  <p>Scegli in un click la struttura migliore per il foglio attivo.</p>
                </div>
                <div className="template-drawer__actions">
                  <div className="segmented-control">
                    <button
                      type="button"
                      className={templateApplyScope === "single" ? "segment segment--active" : "segment"}
                      onClick={() => setTemplateApplyScope("single")}
                    >
                      Solo questo foglio
                    </button>
                    <button
                      type="button"
                      className={templateApplyScope === "visible" ? "segment segment--active" : "segment"}
                      onClick={() => setTemplateApplyScope("visible")}
                    >
                      Tutti i fogli visibili
                    </button>
                  </div>
                  <button type="button" className="ghost-button" onClick={handleTemplateChooserToggle}>
                    Chiudi
                  </button>
                </div>
              </div>

              {activePageCropGuidance?.tone ? (
                <div className={`template-drawer__notice template-drawer__notice--${activePageCropGuidance.tone}`}>
                  <strong>{activePageCropGuidance.title}</strong>
                  <span>{activePageCropGuidance.detail}</span>
                </div>
              ) : null}

              {activePage ? (
                <div className="template-drawer__compare">
                  <div className="template-drawer__compare-card">
                    <span className="layout-studio__rail-eyebrow">Attuale</span>
                    {renderSlotMiniMap(activePage.slotDefinitions)}
                    <strong>{activePage.templateLabel}</strong>
                    <span>{activePage.assignments.length} foto sul foglio corrente</span>
                    {activePageCropGuidance?.tone ? (
                      <span className={`template-drawer__crop-badge template-drawer__crop-badge--${activePageCropGuidance.tone}`}>
                        {activePageCropGuidance.preservedCount} crop preservat{activePageCropGuidance.preservedCount === 1 ? "o" : "i"}
                      </span>
                    ) : null}
                  </div>

                  <div className="template-drawer__compare-arrow" aria-hidden="true">
                    →
                  </div>

                  <div className="template-drawer__compare-card template-drawer__compare-card--preview">
                    <span className="layout-studio__rail-eyebrow">Anteprima</span>
                    {previewTemplate ? (
                      renderTemplateMiniMap(previewTemplate)
                    ) : (
                      <div className="template-drawer__compare-empty">Nessuna anteprima disponibile</div>
                    )}
                    <strong>{previewTemplate?.label ?? activePage.templateLabel}</strong>
                    <span>
                      {previewTemplate?.id === activePage.templateId
                        ? "Stessa struttura attuale"
                        : "Selezionalo per vedere questo foglio riorganizzato con un layout alternativo"}
                    </span>
                    {previewTemplate && previewTemplate.id === recommendedTemplateId ? (
                      <span className="template-drawer__recommend-badge">Consigliato</span>
                    ) : null}
                    {previewTemplateCropCompatibility && previewTemplateCropCompatibility.totalCount > 0 ? (
                      <span
                        className={
                          previewTemplateCropCompatibility.fullyCompatible
                            ? "template-drawer__crop-badge template-drawer__crop-badge--ok"
                            : "template-drawer__crop-badge template-drawer__crop-badge--warning"
                        }
                      >
                        Crop preservati {previewTemplateCropCompatibility.matchedCount}/{previewTemplateCropCompatibility.totalCount}
                      </span>
                    ) : null}
                    <span className="template-drawer__density-badge">
                      {describeTemplateDensity(activePage.slotDefinitions, previewTemplate?.slots ?? null)}
                    </span>
                  </div>
                </div>
              ) : null}

              <div className="template-drawer__grid">
                {compatibleTemplates.map((template) => {
                  const templateCropCompatibility = evaluateTemplateCropCompatibility(
                    template,
                    collectPreservedCropInfo(activePage, assetsById)
                  );

                  return (
                    <button
                      key={template.id}
                      type="button"
                      className={[
                        "template-card",
                        template.id === activePage.templateId ? "template-card--active" : "",
                        template.id === recommendedTemplateId ? "template-card--recommended" : "",
                        templateCropCompatibility.totalCount > 0 && !templateCropCompatibility.fullyCompatible
                          ? "template-card--crop-warning"
                          : ""
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onMouseEnter={() => setTemplatePreviewId(template.id)}
                      onFocus={() => setTemplatePreviewId(template.id)}
                      onClick={() => handleTemplateSelect(template.id)}
                    >
                      {renderTemplateMiniMap(template)}
                      <strong>{template.label}</strong>
                      <span>{template.description}</span>
                      {template.id === recommendedTemplateId ? (
                        <span className="template-drawer__recommend-badge">Consigliato</span>
                      ) : null}
                      {templateCropCompatibility.totalCount > 0 ? (
                        <span
                          className={
                            templateCropCompatibility.fullyCompatible
                              ? "template-drawer__crop-badge template-drawer__crop-badge--ok"
                              : templateCropCompatibility.matchedCount > 0
                                ? "template-drawer__crop-badge template-drawer__crop-badge--warning"
                                : "template-drawer__crop-badge template-drawer__crop-badge--critical"
                          }
                        >
                          Crop preservati {templateCropCompatibility.matchedCount}/{templateCropCompatibility.totalCount}
                        </span>
                      ) : null}
                      <span className="template-drawer__density-badge">
                        {describeTemplateDensity(activePage.slotDefinitions, template.slots)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <PageSettingsPanel
            activePage={activePage}
            isOpen={isPageSettingsOpen}
            onClose={() => setIsPageSettingsOpen(false)}
            onPageSheetPresetChange={onPageSheetPresetChange}
            onPageSheetFieldChange={onPageSheetFieldChange}
            onPageSheetStyleChange={onPageSheetStyleChange}
            onRebalancePage={onRebalancePage}
            onRemovePage={onRemovePage}
          />

          <div
            ref={trayRailRef}
            className={
              isTransferTrayOpen
                ? "layout-studio__transfer-tray layout-studio__transfer-tray--open"
                : "layout-studio__transfer-tray layout-studio__transfer-tray--closed"
            }
            aria-label="Parcheggio spostamenti"
          >
            {isTransferTrayOpen ? (
              <div
                ref={trayRef}
                className="transfer-tray"
                style={{ transform: `translate3d(${trayPosition.x}px, ${trayPosition.y}px, 0)` }}
              >
                <div
                  className="transfer-tray__header"
                  onPointerDown={(event) => {
                    const target = event.target as HTMLElement | null;
                    if (target?.closest("button")) {
                      return;
                    }

                    trayDragStateRef.current = {
                      startX: event.clientX,
                      startY: event.clientY,
                      originX: trayPosition.x,
                      originY: trayPosition.y
                    };
                  }}
                >
                  <strong>Parcheggio</strong>
                  <span className="transfer-tray__meta">
                    {stagedImageIds.length > 0
                      ? `${stagedImageIds.length} foto pronte${isTransferTrayPinned ? " - pin attivo" : ""}`
                      : "Trascina qui una foto per spostarla"}
                  </span>
                  <button
                    type="button"
                    className="ghost-button transfer-tray__close"
                    onClick={() => setIsTransferTrayOpen(false)}
                    title="Chiudi parcheggio"
                    aria-label="Chiudi parcheggio"
                  >
                    ×
                  </button>
                  <button
                    type="button"
                    className={
                      isTransferTrayPinned
                        ? "ghost-button transfer-tray__pin transfer-tray__pin--active"
                        : "ghost-button transfer-tray__pin"
                    }
                    onClick={onToggleTransferTrayPinned}
                    aria-pressed={isTransferTrayPinned}
                    title={
                      isTransferTrayPinned
                        ? "Pin attivo: le foto restano nel parcheggio anche dopo il drop"
                        : "Attiva il pin per mantenere le foto nel parcheggio dopo il drop"
                    }
                  >
                    Pin
                  </button>
                  {stagedImageIds.length > 0 ? (
                    <button
                      type="button"
                      className="ghost-button transfer-tray__clear"
                      onClick={onClearStagedImages}
                      title="Svuota il parcheggio"
                    >
                      Svuota
                    </button>
                  ) : null}
                </div>

                <div
                  className={[
                    "transfer-tray__dropzone",
                    dragState ? "transfer-tray__dropzone--active" : ""
                  ].filter(Boolean).join(" ")}
                  onDragOver={(event) => {
                    if (!dragState) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    if (!dragState) return;
                    event.preventDefault();
                    event.stopPropagation();
                    onStageImage(dragState.imageId);
                  }}
                >
                  {stagedImageIds.length === 0 ? (
                    <span className="transfer-tray__empty">
                      Rilascia qui una foto. Poi vai al foglio giusto e trascinala nello slot (vuoto = aggiungi, pieno = sostituisci/scambia).
                    </span>
                  ) : (
                    <div className="transfer-tray__items" role="list" aria-label="Foto parcheggiate">
                      {stagedImageIds.map((imageId) => {
                        const asset = availableAssetsById.get(imageId) ?? assetsById.get(imageId) ?? null;
                        const usage = usageByAssetId.get(imageId);
                        const previewUrl = asset?.thumbnailUrl ?? asset?.previewUrl ?? null;
                        const label = usage ? `F.${usage.pageNumber}` : "Libera";
                        const title = asset?.fileName ? `${asset.fileName} (${label})` : `${imageId} (${label})`;

                        return (
                          <div key={imageId} className="transfer-tray__item" role="listitem">
                            <button
                              type="button"
                              className="transfer-tray__item-btn"
                              draggable
                              title={title}
                              onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData("text/plain", imageId);
                                setTimeout(() => onDragAssetStart(imageId), 0);
                              }}
                              onDragEnd={onDragEnd}
                            >
                              {previewUrl ? (
                                <img
                                  src={previewUrl}
                                  alt={asset?.fileName ?? imageId}
                                  className="transfer-tray__item-image"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="transfer-tray__item-placeholder">
                                  {(asset?.fileName ?? imageId).slice(0, 10)}
                                </div>
                              )}
                              <span className="transfer-tray__item-badge">{label}</span>
                            </button>

                            <button
                              type="button"
                              className="transfer-tray__item-remove"
                              onClick={(event) => {
                                event.stopPropagation();
                                onUnstageImage(imageId);
                              }}
                              aria-label="Rimuovi dal parcheggio"
                              title="Rimuovi dal parcheggio"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="ghost-button transfer-tray-launcher"
                onClick={() => setIsTransferTrayOpen(true)}
                title="Apri parcheggio"
                aria-label={
                  stagedImageIds.length > 0
                    ? `Apri parcheggio con ${stagedImageIds.length} foto`
                    : "Apri parcheggio"
                }
              >
                <span className="transfer-tray-launcher__icon" aria-hidden="true">
                  ⤴
                </span>
                <span className="transfer-tray-launcher__label">Parcheggio</span>
                {stagedImageIds.length > 0 ? (
                  <span className="transfer-tray-launcher__count" aria-hidden="true">
                    {stagedImageIds.length}
                  </span>
                ) : null}
              </button>
            )}
          </div>

          <div
            ref={canvasRef}
            className="layout-studio__canvas layout-studio__canvas--vertical"
            onDragOver={handleCanvasDragOver}
            onDragEnd={stopAutoScroll}
            onDrop={stopAutoScroll}
          >
            <div
              className="layout-studio__canvas-zoom"
              style={{ transform: `scale(${zoom})`, transformOrigin: "center top" }}
            >
              <div className="layout-studio__page-column">
                {pagesForStudio.map((page) => {
                  const isActive = page.id === activePage.id;
                  const showRebalancedBadge = recentlyRebalancedPageId === page.id;
                  const showAddedBadge = recentlyAddedPageId === page.id;
                  const pageCropGuidance = pageCropGuidanceByPageId.get(page.id) ?? null;

                  return (
                    <section
                      key={page.id}
                      data-page-id={page.id}
                      id={`layout-page-${page.id}`}
                      className={[
                        "layout-studio__page-card",
                        isActive ? "layout-studio__page-card--active" : "",
                        showAddedBadge ? "layout-studio__page-card--recently-added" : ""
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={(event) => handleSelectPageFromCard(event, page)}
                    >
                      <div className="page-context-header">
                        <div className="page-context-header__identity">
                          <span className="page-context-header__page-number">Foglio {page.pageNumber}</span>
                          <strong className="page-context-header__template-name">{page.templateLabel}</strong>
                          <span className="page-context-header__meta">
                            {page.assignments.length} foto · {page.sheetSpec.label} · gap {page.sheetSpec.gapCm.toFixed(1)} cm
                          </span>
                          {pageCropGuidance?.tone ? (
                            <span className={`page-context-header__crop-badge page-context-header__crop-badge--${pageCropGuidance.tone}`}>
                              {pageCropGuidance.title}
                            </span>
                          ) : null}
                          {showAddedBadge ? (
                            <span
                              className="layout-studio__page-feedback layout-studio__page-feedback--added"
                              aria-live="polite"
                            >
                              Foto aggiunta
                            </span>
                          ) : showRebalancedBadge ? (
                            <span className="layout-studio__page-feedback" aria-live="polite">
                              Foglio riorganizzato
                            </span>
                          ) : null}
                        </div>

                        <div className="page-context-header__layout-actions">
                          <select
                            className="page-context-header__template-select"
                            value={page.templateId}
                            onChange={(event) => onTemplateChange(page.id, event.target.value)}
                            title="Cambia template con un click"
                          >
                            {(templatesByPageId.get(page.id) ?? []).map((template) => (
                              <option key={template.id} value={template.id}>
                                {template.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="page-context-header__action-btn"
                            onClick={() => {
                              const recommendedTemplate = recommendedTemplateByPageId.get(page.id);
                              if (recommendedTemplate) {
                                onTemplateChange(page.id, recommendedTemplate);
                              }
                            }}
                            title="Applica il template consigliato"
                          >
                            Auto
                          </button>
                          <button
                            type="button"
                            className="page-context-header__action-btn"
                            onClick={() => onRebalancePage(page.id)}
                            title="Ricalcola il layout con impostazioni correnti"
                          >
                            Refresh
                          </button>
                        </div>

                        <div className="page-context-header__right">
                          <div
                            className="page-context-header__appearance"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <button
                              type="button"
                              className={
                                openPageHeaderPanel?.pageId === page.id && openPageHeaderPanel.panel === "background"
                                  ? "page-context-header__style-toggle page-context-header__style-toggle--active"
                                  : "page-context-header__style-toggle"
                              }
                              onClick={() => handleTogglePageHeaderPanel(page.id, "background")}
                              title={`Apri i controlli sfondo del foglio ${page.pageNumber}`}
                            >
                              <span className="page-context-header__style-toggle-label">Sfondo</span>
                              <span
                                className="page-context-header__style-swatch"
                                style={{ backgroundColor: page.sheetSpec.backgroundColor ?? "#ffffff" }}
                                aria-hidden="true"
                              />
                              {page.sheetSpec.backgroundImageUrl ? (
                                <span className="page-context-header__style-pill">Img</span>
                              ) : null}
                            </button>

                            <button
                              type="button"
                              className={
                                openPageHeaderPanel?.pageId === page.id && openPageHeaderPanel.panel === "border"
                                  ? "page-context-header__style-toggle page-context-header__style-toggle--active"
                                  : "page-context-header__style-toggle"
                              }
                              onClick={() => handleTogglePageHeaderPanel(page.id, "border")}
                              title={`Apri i controlli bordo del foglio ${page.pageNumber}`}
                            >
                              <span className="page-context-header__style-toggle-label">Bordi</span>
                              <span
                                className="page-context-header__style-swatch"
                                style={{ backgroundColor: page.sheetSpec.photoBorderColor ?? "#ffffff" }}
                                aria-hidden="true"
                              />
                              <span className="page-context-header__style-pill">
                                {(page.sheetSpec.photoBorderWidthCm ?? 0).toFixed(2)} cm
                              </span>
                            </button>

                            <button
                              type="button"
                              className={
                                page.sheetSpec.showRulers
                                  ? "page-context-header__style-toggle page-context-header__style-toggle--active"
                                  : "page-context-header__style-toggle"
                              }
                              onClick={() =>
                                onPageSheetStyleChange(
                                  page.id,
                                  { showRulers: !(page.sheetSpec.showRulers ?? false) },
                                  `Righelli ${(page.sheetSpec.showRulers ?? false) ? "nascosti" : "attivati"} sul foglio ${page.pageNumber}.`
                                )
                              }
                              title={`Attiva o disattiva i righelli del foglio ${page.pageNumber}`}
                            >
                              <span className="page-context-header__style-toggle-label">Righelli</span>
                              <span className="page-context-header__style-pill">
                                {page.sheetSpec.showRulers ? (page.sheetSpec.rulerUnit ?? "cm").toUpperCase() : "Off"}
                              </span>
                            </button>
                          </div>
                          {openPageHeaderPanel?.pageId === page.id ? (
                            <div
                              className="page-context-header__style-popover"
                              onClick={(event) => event.stopPropagation()}
                            >
                              {openPageHeaderPanel.panel === "background" ? (
                                <div className="page-context-header__style-group">
                                  <span className="page-context-header__style-label">Sfondo</span>
                                  <label
                                    className="layout-studio__page-color-chip"
                                    title={`Colore di sfondo del foglio ${page.pageNumber}`}
                                  >
                                    <input
                                      type="color"
                                      value={page.sheetSpec.backgroundColor ?? "#ffffff"}
                                      onChange={(event) =>
                                        onPageSheetStyleChange(
                                          page.id,
                                          { backgroundColor: event.target.value },
                                          `Colore di sfondo aggiornato per il foglio ${page.pageNumber}.`
                                        )
                                      }
                                    />
                                  </label>
                                  <label
                                    className={
                                      page.sheetSpec.backgroundImageUrl
                                        ? "layout-studio__page-style-button layout-studio__page-style-button--active"
                                        : "layout-studio__page-style-button"
                                    }
                                    title={`Carica un'immagine di sfondo per il foglio ${page.pageNumber}`}
                                  >
                                    Img
                                    <input
                                      type="file"
                                      accept="image/*"
                                      hidden
                                      onChange={(event) => handlePageBackgroundUpload(page, event)}
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    className="layout-studio__page-style-button"
                                    disabled={!page.sheetSpec.backgroundImageUrl}
                                    onClick={() =>
                                      onPageSheetStyleChange(
                                        page.id,
                                        { backgroundImageUrl: "" },
                                        `Sfondo immagine rimosso dal foglio ${page.pageNumber}.`
                                      )
                                    }
                                    title={`Rimuovi l'immagine di sfondo dal foglio ${page.pageNumber}`}
                                  >
                                    ×
                                  </button>
                                </div>
                              ) : (
                                <div className="page-context-header__style-group">
                                  <span className="page-context-header__style-label">Bordi</span>
                                  <label
                                    className="layout-studio__page-color-chip"
                                    title={`Colore bordo foto del foglio ${page.pageNumber}`}
                                  >
                                    <input
                                      type="color"
                                      value={page.sheetSpec.photoBorderColor ?? "#ffffff"}
                                      onChange={(event) =>
                                        onPageSheetStyleChange(
                                          page.id,
                                          { photoBorderColor: event.target.value },
                                          `Colore bordo foto aggiornato per il foglio ${page.pageNumber}.`
                                        )
                                      }
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    className="layout-studio__page-style-button"
                                    onClick={() => adjustPageBorderWidth(page, -0.05)}
                                    title="Riduci spessore bordo"
                                  >
                                    −
                                  </button>
                                  <span className="page-context-header__border-value">
                                    {(page.sheetSpec.photoBorderWidthCm ?? 0).toFixed(2)} cm
                                  </span>
                                  <button
                                    type="button"
                                    className="layout-studio__page-style-button"
                                    onClick={() => adjustPageBorderWidth(page, 0.05)}
                                    title="Aumenta spessore bordo"
                                  >
                                    +
                                  </button>
                                </div>
                              )}
                            </div>
                          ) : null}
                          <div className="page-context-header__state">
                            <button
                              type="button"
                              className="page-context-header__action-btn"
                              onClick={() => handleOpenPageSettingsForPage(page)}
                              title="Apri le impostazioni del foglio corrente"
                            >
                              Foglio
                            </button>
                            {isActive ? (
                              <span className="page-context-header__status-chip page-context-header__status-chip--active">
                                Attivo
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div
                        className="layout-studio__page-content"
                      >
                        <div className="layout-studio__page-sheet">
                          <SheetWithRulers page={page} onPageSheetStyleChange={onPageSheetStyleChange}>
                            <SheetSurface
                              page={page}
                              assetsById={assetsById}
                              selectedSlotKey={selectedSlotKey}
                              recentlyAddedSlotKey={recentlyAddedSlotKey}
                              dragState={dragState}
                              onSelectPage={onSelectPage}
                              onStartSlotDrag={onStartSlotDrag}
                              onDragEnd={onDragEnd}
                              onDrop={onDrop}
                              onAssetDropped={onAssetDropped}
                              onAddToPage={onAddToPage}
                              onClearSlot={onClearSlot}
                              onOpenCropEditor={handleCropTargetOpen}
                              onContextMenu={onContextMenu}
                              size="hero"
                            />
                          </SheetWithRulers>
                        </div>
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

      </div>

      {replaceTarget ? (
        <PhotoReplaceModal
          assets={availableAssetsForPicker}
          activeAssetIds={activeAssetIds}
          usageByAssetId={usageByAssetId}
          currentImageId={replaceTarget.currentImageId}
          title={`Scegli la foto per foglio ${replaceTarget.pageNumber}, slot ${replaceTarget.slotId}`}
          onClose={handleReplaceTargetClose}
          onChoose={handleReplaceAsset}
          onAssetsMetadataChange={onAssetsMetadataChange}
        />
      ) : null}

      {cropTarget && cropPage && cropSlot && cropAssignment && cropAsset ? (
        <CropEditorModal
          asset={cropAsset}
          assignment={cropAssignment}
          slot={cropSlot}
          availableTemplates={templatesByPageId.get(cropPage.id) ?? []}
          onClose={handleCropTargetClose}
          onApply={(changes) => { onUpdateSlotAssignment(cropPage.id, cropSlot.id, changes); }}
        />
      ) : null}

      {pendingTemplateChange && activePage ? (
        <ConfirmModal
          title="Confermare il cambio template?"
          description={
            pendingTemplateChange.applyScope === "visible"
              ? `Il nuovo template puo cambiare in modo sensibile la gerarchia visiva del foglio attivo e degli altri fogli visibili.`
              : "Il nuovo template puo cambiare in modo sensibile la gerarchia visiva del foglio corrente."
          }
          confirmText="Applica template"
          cancelText="Mantieni attuale"
          isDangerous={false}
          onConfirm={() => {
            if (pendingTemplateChange.applyScope === "visible") {
              onApplyTemplateToPages(deferredPages.map((page) => page.id), pendingTemplateChange.templateId);
            } else {
              onTemplateChange(activePage.id, pendingTemplateChange.templateId);
            }
            setIsTemplateChooserOpen(false);
          }}
          onCancel={() => setPendingTemplateChange(null)}
        >
          <p className="helper-copy">
            Usa questa conferma quando vuoi procedere comunque con un layout che sposta l'enfasi delle foto rispetto alla struttura attuale.
          </p>
        </ConfirmModal>
      ) : null}
    </div>
  );
}



























