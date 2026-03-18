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
import type {
  AutoLayoutResult,
  GeneratedPageLayout,
  ImageAsset,
  LayoutAssignment,
  LayoutMove,
  LayoutTemplate
} from "@photo-tools/shared-types";
import { AssignmentInspector } from "./AssignmentInspector";
import { ImageSlotPreview } from "./ImageSlotPreview";
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

type ResizePane = "left" | "right";

const LAYOUT_STRIP_ITEM_WIDTH = 206;
const LAYOUT_STRIP_OVERSCAN = 3;

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
  onContextMenu?: (event: MouseEvent, page: GeneratedPageLayout) => void;
  onPageSheetPresetChange: (pageId: string, presetId: string) => void;
  onPageSheetFieldChange: (
    pageId: string,
    field: "widthCm" | "heightCm" | "marginCm" | "gapCm" | "dpi",
    value: number
  ) => void;
  onUpdateSlotAssignment: (
    pageId: string,
    slotId: string,
    changes: Partial<Pick<LayoutAssignment, "fitMode" | "zoom" | "offsetX" | "offsetY" | "rotation" | "locked">>
  ) => void;
  zoom: number;
}

interface CommitOnBlurNumberFieldProps {
  label: string;
  value: number;
  min?: string;
  step?: string;
  className?: string;
  onCommit: (value: number) => void;
}

function getTemplateOptions(templates: LayoutTemplate[], photoCount: number): LayoutTemplate[] {
  return templates.filter(
    (template) => photoCount >= template.minPhotos && photoCount <= template.maxPhotos
  );
}

function getSheetAspectRatio(page: GeneratedPageLayout): string {
  const width = Math.max(page.sheetSpec.widthCm, 0.1);
  const height = Math.max(page.sheetSpec.heightCm, 0.1);
  return String(width / height);
}

function formatMeasurement(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function formatAspectRatioLabel(page: GeneratedPageLayout): string {
  return `${formatMeasurement(page.sheetSpec.widthCm)}:${formatMeasurement(page.sheetSpec.heightCm)}`;
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

function buildAssignmentsBySlotId(page: GeneratedPageLayout): Map<string, LayoutAssignment> {
  return new Map(page.assignments.map((assignment) => [assignment.slotId, assignment] as const));
}

function resolveDropSlotId(
  page: GeneratedPageLayout,
  assignmentsBySlotId: Map<string, LayoutAssignment>,
  clientX: number,
  clientY: number,
  previewRect: DOMRect
): string | null {
  if (previewRect.width <= 0 || previewRect.height <= 0) {
    return page.slotDefinitions.find((slot) => !assignmentsBySlotId.has(slot.id))?.id ?? page.slotDefinitions[0]?.id ?? null;
  }

  const relativeX = (clientX - previewRect.left) / previewRect.width;
  const relativeY = (clientY - previewRect.top) / previewRect.height;
  const emptySlots = page.slotDefinitions.filter((slot) => !assignmentsBySlotId.has(slot.id));
  const directSlot = emptySlots.find((slot) => {
    const rect = getSlotDisplayRect(page, slot);
    return (
      relativeX >= rect.left &&
      relativeX <= rect.left + rect.width &&
      relativeY >= rect.top &&
      relativeY <= rect.top + rect.height
    );
  });

  if (directSlot) {
    return directSlot.id;
  }

  const candidateSlots = emptySlots;
  if (candidateSlots.length === 0) {
    return null;
  }

  const nearestSlot = candidateSlots.reduce<GeneratedPageLayout["slotDefinitions"][number] | null>((bestSlot, slot) => {
    const rect = getSlotDisplayRect(page, slot);
    const slotCenterX = rect.left + rect.width / 2;
    const slotCenterY = rect.top + rect.height / 2;
    const bestRect = bestSlot ? getSlotDisplayRect(page, bestSlot) : null;
    const bestCenterX = bestRect ? bestRect.left + bestRect.width / 2 : 0;
    const bestCenterY = bestRect ? bestRect.top + bestRect.height / 2 : 0;
    const slotDistance = Math.hypot(relativeX - slotCenterX, relativeY - slotCenterY);
    const bestDistance = bestSlot ? Math.hypot(relativeX - bestCenterX, relativeY - bestCenterY) : Number.POSITIVE_INFINITY;
    return slotDistance < bestDistance ? slot : bestSlot;
  }, null);

  return nearestSlot?.id ?? null;
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

function CommitOnBlurNumberField({
  label,
  value,
  min = "1",
  step = "0.1",
  className,
  onCommit
}: CommitOnBlurNumberFieldProps) {
  const [draftValue, setDraftValue] = useState(() => formatMeasurement(value));

  useEffect(() => {
    setDraftValue(formatMeasurement(value));
  }, [value]);

  const commitDraft = useCallback(() => {
    const parsed = Number(draftValue);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDraftValue(formatMeasurement(value));
      return;
    }

    if (parsed !== value) {
      onCommit(parsed);
      return;
    }

    setDraftValue(formatMeasurement(value));
  }, [draftValue, onCommit, value]);

  return (
    <label className={className ? `field ${className}` : "field"}>
      <span>{label}</span>
      <input
        type="number"
        min={min}
        step={step}
        value={draftValue}
        onChange={(event) => setDraftValue(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }

          if (event.key === "Escape") {
            setDraftValue(formatMeasurement(value));
            event.preventDefault();
          }
        }}
      />
    </label>
  );
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

interface SheetSurfaceProps {
  page: GeneratedPageLayout;
  assetsById: Map<string, ImageAsset>;
  selectedSlotKey: string | null;
  dragState: DragState | null;
  onSelectPage: (pageId: string, slotId?: string) => void;
  onStartSlotDrag: (pageId: string, slotId: string, imageId: string) => void;
  onDragEnd: () => void;
  onDrop: (move: LayoutMove) => void;
  onAssetDropped: (pageId: string, slotId: string, imageId: string) => void;
  onAddToPage: (pageId: string, imageId: string) => void;
  onClearSlot: (pageId: string, slotId: string) => void;
  onOpenPicker: (pageId: string, pageNumber: number, slotId: string, currentImageId?: string) => void;
  onContextMenu?: (event: MouseEvent, page: GeneratedPageLayout) => void;
  onUpdateSlotAssignment: (
    pageId: string,
    slotId: string,
    changes: Partial<Pick<LayoutAssignment, "fitMode" | "zoom" | "offsetX" | "offsetY" | "rotation" | "locked">>
  ) => void;
  size: "hero" | "thumb";
}

const SheetSurface = memo(function SheetSurface({
  page,
  assetsById,
  selectedSlotKey,
  dragState,
  onSelectPage,
  onStartSlotDrag,
  onDragEnd,
  onDrop,
  onAssetDropped,
  onAddToPage,
  onClearSlot,
  onOpenPicker,
  onContextMenu,
  onUpdateSlotAssignment,
  size
}: SheetSurfaceProps) {
  const interactive = size === "hero";
  const assignmentsBySlotId = useMemo(() => buildAssignmentsBySlotId(page), [page]);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [dragIntentLabel, setDragIntentLabel] = useState<string | null>(null);
  const panStateRef = useRef<{
    pointerId: number;
    slotId: string;
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
    width: number;
    height: number;
    moved: boolean;
  } | null>(null);
  const panFrameRef = useRef<number | null>(null);
  const pendingPanRef = useRef<{ slotId: string; offsetX: number; offsetY: number } | null>(null);

  useEffect(() => {
    return () => {
      if (panFrameRef.current !== null) {
        cancelAnimationFrame(panFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!dragState) {
      setDragIntentLabel(null);
    }
  }, [dragState]);

  const flushPanUpdate = useCallback(() => {
    if (pendingPanRef.current) {
      onUpdateSlotAssignment(page.id, pendingPanRef.current.slotId, {
        offsetX: pendingPanRef.current.offsetX,
        offsetY: pendingPanRef.current.offsetY
      });
      pendingPanRef.current = null;
    }

    panFrameRef.current = null;
  }, [onUpdateSlotAssignment, page.id]);

  const schedulePanUpdate = useCallback(
    (slotId: string, offsetX: number, offsetY: number) => {
      pendingPanRef.current = { slotId, offsetX, offsetY };

      if (panFrameRef.current === null) {
        panFrameRef.current = requestAnimationFrame(flushPanUpdate);
      }
    },
    [flushPanUpdate]
  );

  return (
    <div
      ref={previewRef}
      className={[
        size === "hero" ? "sheet-preview sheet-preview--hero" : "sheet-preview sheet-preview--thumb",
        interactive && dragState ? "sheet-preview--drag-over" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ aspectRatio: getSheetAspectRatio(page) }}
      onDragOver={
        interactive
          ? (event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDragIntentLabel("Scegli uno slot oppure usa la zona tratteggiata per riadattare il foglio");
            }
          : undefined
      }
	      onDrop={
	        interactive
	          ? (event) => {
	              event.preventDefault();
                setDragIntentLabel(null);
	            }
	          : undefined
	      }
      onDragLeave={
        interactive
          ? (event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setDragIntentLabel(null);
              }
            }
          : undefined
      }
      onContextMenu={
        interactive && onContextMenu
          ? (event) => {
              event.preventDefault();
              onContextMenu(event, page);
            }
          : undefined
      }
    >
      {page.slotDefinitions.map((slot) => {
        const assignment = assignmentsBySlotId.get(slot.id);
        const asset = assignment ? assetsById.get(assignment.imageId) : undefined;
        const isSelected = selectedSlotKey === `${page.id}:${slot.id}`;
        const isDragging =
          dragState?.kind === "slot" &&
          dragState.sourcePageId === page.id &&
          dragState.sourceSlotId === slot.id;
        const canReposition = Boolean(interactive && assignment);
        const isDropTarget =
          Boolean(dragState) &&
          !(dragState?.kind === "slot" && dragState.sourcePageId === page.id && dragState.sourceSlotId === slot.id);

        return (
          <div
            key={slot.id}
            className={[
              "sheet-slot",
              isSelected ? "sheet-slot--selected" : "",
              isDragging ? "sheet-slot--dragging" : "",
              isDropTarget ? "sheet-slot--drag-target" : "",
              assignment ? "" : "sheet-slot--empty"
            ]
              .filter(Boolean)
              .join(" ")}
            style={(() => {
              const slotRect = getSlotDisplayRect(page, slot);
              return {
                left: `${slotRect.left * 100}%`,
                top: `${slotRect.top * 100}%`,
                width: `${slotRect.width * 100}%`,
                height: `${slotRect.height * 100}%`
              };
            })()}
            onClick={interactive ? () => onSelectPage(page.id, slot.id) : undefined}
            onDragOver={
              interactive
                ? (event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    if (!dragState) {
                      return;
                    }

                    if (dragState.kind === "slot" && dragState.sourcePageId && dragState.sourceSlotId) {
                      setDragIntentLabel(
                        assignment
                          ? "Rilascia per spostare o scambiare la foto in questo slot"
                          : "Rilascia per spostare la foto in questo slot"
                      );
                      return;
                    }

                    setDragIntentLabel(
                      assignment
                        ? "Rilascia per sostituire la foto in questo slot"
                        : "Rilascia per inserire la foto in questo slot"
                    );
                  }
                : undefined
            }
            onDrop={
              interactive
                ? (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!dragState) {
                      return;
                    }

                    if (dragState.kind === "slot" && dragState.sourcePageId && dragState.sourceSlotId) {
                      onDrop({
                        sourcePageId: dragState.sourcePageId,
                        sourceSlotId: dragState.sourceSlotId,
                        targetPageId: page.id,
                        targetSlotId: slot.id
                      });
                      return;
                    }

                    onAssetDropped(page.id, slot.id, dragState.imageId);
                    setDragIntentLabel(null);
                  }
                : undefined
            }
            onDragLeave={
              interactive
                ? (event) => {
                    event.stopPropagation();
                    setDragIntentLabel("Scegli uno slot oppure usa la zona tratteggiata per riadattare il foglio");
                  }
                : undefined
            }
          >
            {interactive ? (
              <>
                <button
                  type="button"
                  data-preview-asset-id={assignment?.imageId}
                  className={canReposition ? "slot-asset slot-asset--repositionable" : "slot-asset"}
                  draggable={false}
                  onWheel={(event) => {
                    if (!assignment || !interactive) {
                      return;
                    }

                    if (!(event.ctrlKey || event.metaKey)) {
                      return;
                    }

                    event.preventDefault();
                    const nextZoom = Math.max(0.7, Math.min(2.2, assignment.zoom + (event.deltaY > 0 ? -0.08 : 0.08)));
                    onUpdateSlotAssignment(page.id, slot.id, { zoom: nextZoom });
                  }}
                  onDoubleClick={(event) => {
                    if (!assignment || !interactive) {
                      return;
                    }

                    event.preventDefault();
                    onUpdateSlotAssignment(page.id, slot.id, {
                      zoom: 1,
                      offsetX: 0,
                      offsetY: 0,
                      rotation: 0
                    });
                  }}
                  onPointerDown={(event) => {
                    if (!assignment || !canReposition || event.button !== 0) {
                      return;
                    }

                    const rect = event.currentTarget.getBoundingClientRect();
                    panStateRef.current = {
                      pointerId: event.pointerId,
                      slotId: slot.id,
                      startX: event.clientX,
                      startY: event.clientY,
                      startOffsetX: assignment.offsetX,
                      startOffsetY: assignment.offsetY,
                      width: rect.width,
                      height: rect.height,
                      moved: false
                    };

                    onSelectPage(page.id, slot.id);
                    event.currentTarget.setPointerCapture(event.pointerId);
                    event.preventDefault();
                  }}
                  onPointerMove={(event) => {
                    const panState = panStateRef.current;
                    if (!panState || panState.pointerId !== event.pointerId) {
                      return;
                    }

                    const deltaX = event.clientX - panState.startX;
                    const deltaY = event.clientY - panState.startY;

                    if (!panState.moved && Math.abs(deltaX) + Math.abs(deltaY) < 3) {
                      return;
                    }

                    panState.moved = true;

                    const nextOffsetX = Math.max(
                      -100,
                      Math.min(100, panState.startOffsetX + (deltaX / Math.max(panState.width, 1)) * 60)
                    );
                    const nextOffsetY = Math.max(
                      -100,
                      Math.min(100, panState.startOffsetY + (deltaY / Math.max(panState.height, 1)) * 60)
                    );

                    schedulePanUpdate(slot.id, nextOffsetX, nextOffsetY);
                  }}
                  onPointerUp={(event) => {
                    if (!panStateRef.current || panStateRef.current.pointerId !== event.pointerId) {
                      return;
                    }

                    flushPanUpdate();
                    panStateRef.current = null;
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }}
                  onPointerCancel={() => {
                    flushPanUpdate();
                    panStateRef.current = null;
                  }}
                >
                  <ImageSlotPreview
                    asset={asset}
                    assignment={assignment}
                    label={assignment ? asset?.fileName ?? assignment.imageId : slot.id}
                  />
                </button>
                {assignment ? (
                  <div className="slot-quick-toolbar" onClick={(event) => event.stopPropagation()}>
                    {([
                      ["fit", "Adatta"],
                      ["fill", "Riempi"],
                      ["crop", "Crop"]
                    ] as const).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        className={
                          assignment.fitMode === mode
                            ? "slot-quick-toolbar__button slot-quick-toolbar__button--active"
                            : "slot-quick-toolbar__button"
                        }
                        onClick={() => onUpdateSlotAssignment(page.id, slot.id, { fitMode: mode })}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="slot-quick-toolbar__button"
                      onClick={() =>
                        onUpdateSlotAssignment(page.id, slot.id, {
                          zoom: Math.max(0.7, assignment.zoom - 0.1)
                        })
                      }
                      aria-label="Riduci zoom"
                    >
                      -
                    </button>
                    <button
                      type="button"
                      className="slot-quick-toolbar__button"
                      onClick={() =>
                        onUpdateSlotAssignment(page.id, slot.id, {
                          zoom: Math.min(2.2, assignment.zoom + 0.1)
                        })
                      }
                      aria-label="Aumenta zoom"
                    >
                      +
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="slot-action slot-action--replace"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenPicker(page.id, page.pageNumber, slot.id, assignment?.imageId);
                  }}
                  aria-label={
                    assignment
                      ? `Sostituisci foto nello slot ${slot.id}`
                      : `Scegli una foto per lo slot ${slot.id}`
                  }
                >
                  Foto
                </button>
                {assignment ? (
                  <button
                    type="button"
                    className="slot-action slot-action--drag"
                    draggable
                    onClick={(event) => event.stopPropagation()}
                    onDragStart={(event) => {
                      event.stopPropagation();
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", assignment.imageId);
                      onStartSlotDrag(page.id, slot.id, assignment.imageId);
                    }}
                    onDragEnd={(event) => {
                      event.stopPropagation();
                      onDragEnd();
                    }}
                    aria-label={`Sposta foto dallo slot ${slot.id}`}
                    title="Trascina per spostare o sostituire in un altro foglio"
                  >
                    Sposta
                  </button>
                ) : null}
                {assignment ? (
                  <button
                    type="button"
                    className="slot-action slot-action--remove"
                    onClick={(event) => {
                      event.stopPropagation();
                      onClearSlot(page.id, slot.id);
                    }}
                    aria-label={`Rimuovi foto dallo slot ${slot.id}`}
                  >
                    x
                  </button>
                ) : null}
              </>
            ) : (
              <div className="slot-asset slot-asset--thumb">
                <ImageSlotPreview
                  asset={asset}
                  assignment={assignment}
                  label={assignment ? asset?.fileName ?? assignment.imageId : slot.id}
                />
              </div>
            )}
          </div>
        );
      })}
      {interactive && dragState ? (
        <div
          className={
            dragState.kind === "slot"
              ? "sheet-add-target sheet-add-target--slot-drag"
              : "sheet-add-target"
          }
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            setDragIntentLabel(
              dragState.kind === "slot"
                ? "Rilascia per spostare questa foto qui e riadattare il layout del foglio"
                : "Rilascia per aggiungere la foto e ricalcolare il layout del foglio"
            );
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onAddToPage(page.id, dragState.imageId);
            setDragIntentLabel(null);
          }}
          onDragLeave={(event) => {
            event.stopPropagation();
            setDragIntentLabel("Scegli uno slot oppure usa la zona tratteggiata per riadattare il foglio");
          }}
        >
          <strong>Riadatta questo foglio</strong>
          <span>
            {dragState.kind === "slot"
              ? "Rilascia qui per spostare questa foto in questo foglio e aggiornare il layout."
              : "Rilascia qui per aggiungere la foto a questo foglio e ricalcolare l'impaginazione."}
          </span>
        </div>
      ) : null}
      {interactive && dragState && dragIntentLabel ? (
        <div className="sheet-drag-intent" aria-live="polite">
          {dragIntentLabel}
        </div>
      ) : null}
    </div>
  );
});

function renderSheetThumbnail(page: GeneratedPageLayout, isActive: boolean) {
  const assignmentsBySlotId = buildAssignmentsBySlotId(page);

  return (
    <div
      className={isActive ? "sheet-thumbnail sheet-thumbnail--active" : "sheet-thumbnail"}
      style={{ aspectRatio: getSheetAspectRatio(page) }}
      aria-hidden="true"
    >
      {page.slotDefinitions.map((slot) => {
        const hasAssignment = assignmentsBySlotId.has(slot.id);

        return (
          <span
            key={slot.id}
            className={hasAssignment ? "sheet-thumbnail__slot sheet-thumbnail__slot--filled" : "sheet-thumbnail__slot"}
            style={{
              left: `${slot.x * 100}%`,
              top: `${slot.y * 100}%`,
              width: `${slot.width * 100}%`,
              height: `${slot.height * 100}%`
            }}
          />
        );
      })}
    </div>
  );
}

const SheetThumbnailCard = memo(function SheetThumbnailCard({
  page,
  isActive,
  onSelect
}: {
  page: GeneratedPageLayout;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={isActive ? "layout-strip__item layout-strip__item--active" : "layout-strip__item"}
      onClick={onSelect}
    >
      <div className="layout-strip__thumb">
        {renderSheetThumbnail(page, isActive)}
      </div>
      <strong>Foglio {page.pageNumber}</strong>
      <span>{page.templateLabel}</span>
    </button>
  );
});

function renderEmptySheetPlaceholder(label: string) {
  return (
    <div className="sheet-preview sheet-preview--hero sheet-preview--placeholder">
      <div className="sheet-preview__placeholder-copy">
        <strong>{label}</strong>
        <span>Seleziona un altro foglio oppure crea nuove pagine dalle foto non usate.</span>
      </div>
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
  onContextMenu,
  onPageSheetPresetChange,
  onPageSheetFieldChange,
  onUpdateSlotAssignment,
  zoom
}: LayoutPreviewBoardProps) {
  const [isTemplateChooserOpen, setIsTemplateChooserOpen] = useState(false);
  const [isLayoutStripExpanded, setIsLayoutStripExpanded] = useState(false);
  const [templateApplyScope, setTemplateApplyScope] = useState<"single" | "visible">("single");
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");
  const [pageSectionFilter, setPageSectionFilter] = useState<PageSectionFilter>("all");
  const [replaceTarget, setReplaceTarget] = useState<ReplaceTarget | null>(null);
  const [leftRailWidth, setLeftRailWidth] = useState(260);
  const [inspectorWidth, setInspectorWidth] = useState(320);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(false);
  const [layoutStripScrollLeft, setLayoutStripScrollLeft] = useState(0);
  const [layoutStripViewportWidth, setLayoutStripViewportWidth] = useState(0);
  const [dragChipTargetPageId, setDragChipTargetPageId] = useState<string | null>(null);
  const layoutStripRef = useRef<HTMLDivElement>(null);
  const layoutStripFrameRef = useRef<number | null>(null);
  const resizeStateRef = useRef<{ pane: ResizePane; startX: number; startWidth: number } | null>(null);
  const activePage = result.pages.find((page) => page.id === selectedPageId) ?? result.pages[0] ?? null;
  const activeIndex = activePage ? result.pages.findIndex((page) => page.id === activePage.id) : 0;
  const spreadStartIndex = activeIndex <= 0 ? 0 : activeIndex % 2 === 0 ? activeIndex : activeIndex - 1;
  const spreadPages = result.pages.slice(spreadStartIndex, spreadStartIndex + 2);
  const leftPage = spreadPages[0] ?? null;
  const rightPage = spreadPages[1] ?? null;
  const previousPage = activeIndex > 0 ? result.pages[activeIndex - 1] ?? null : null;
  const nextPage = activeIndex >= 0 ? result.pages[activeIndex + 1] ?? null : null;
  const compatibleTemplates = useMemo(
    () =>
      activePage
        ? getTemplateOptions(result.availableTemplates, Math.max(activePage.imageIds.length, 1))
        : [],
    [activePage, result.availableTemplates]
  );
  
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
  const activeAspectRatio = activePage ? formatAspectRatioLabel(activePage) : null;
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
  const virtualizedStripStartIndex = useMemo(
    () => Math.max(0, Math.floor(layoutStripScrollLeft / LAYOUT_STRIP_ITEM_WIDTH) - 1),
    [layoutStripScrollLeft]
  );
  const visibleStripItems = useMemo(
    () => Math.max(1, Math.ceil(layoutStripViewportWidth / LAYOUT_STRIP_ITEM_WIDTH) + LAYOUT_STRIP_OVERSCAN),
    [layoutStripViewportWidth]
  );
  const virtualizedStripEndIndex = useMemo(
    () => Math.min(deferredPages.length, virtualizedStripStartIndex + visibleStripItems),
    [deferredPages.length, visibleStripItems, virtualizedStripStartIndex]
  );
  const visibleStripPages = useMemo(
    () => deferredPages.slice(virtualizedStripStartIndex, virtualizedStripEndIndex),
    [deferredPages, virtualizedStripEndIndex, virtualizedStripStartIndex]
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
        startWidth: pane === "left" ? leftRailWidth : inspectorWidth
      };
      if (typeof document !== "undefined") {
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }
      if (pane === "right" && isInspectorCollapsed) {
        setIsInspectorCollapsed(false);
      }
    },
    [inspectorWidth, isInspectorCollapsed, leftRailWidth]
  );

  const handleTemplateSelect = useCallback(
    (templateId: string) => {
      if (activePage) {
        if (templateApplyScope === "visible") {
          onApplyTemplateToPages(deferredPages.map((page) => page.id), templateId);
        } else {
          onTemplateChange(activePage.id, templateId);
        }
        setIsTemplateChooserOpen(false);
      }
    },
    [activePage, deferredPages, onApplyTemplateToPages, onTemplateChange, templateApplyScope]
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

  const handleJumpToPage = useCallback(
    (page: GeneratedPageLayout) => {
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
    [onSelectPage]
  );

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const autoScrollVelocityRef = useRef(0);
  const autoScrollTargetRef = useRef<HTMLElement | Window | null>(null);
  const dragPageJumpTimeoutRef = useRef<number | null>(null);
  const dragPageJumpTargetIdRef = useRef<string | null>(null);

  const clearDragPageJump = useCallback(() => {
    if (dragPageJumpTimeoutRef.current !== null) {
      window.clearTimeout(dragPageJumpTimeoutRef.current);
      dragPageJumpTimeoutRef.current = null;
    }
    dragPageJumpTargetIdRef.current = null;
    setDragChipTargetPageId(null);
  }, []);

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
      setDragChipTargetPageId(null);
      clearDragPageJump();
    }
  }, [clearDragPageJump, dragState]);

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
    setIsTemplateChooserOpen(false);
    setReplaceTarget(null);
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
    const stripElement = layoutStripRef.current;

    if (!stripElement) {
      return;
    }

    const updateViewport = () => {
      setLayoutStripViewportWidth(stripElement.clientWidth);
    };

    updateViewport();
    const resizeObserver = new ResizeObserver(updateViewport);
    resizeObserver.observe(stripElement);

    return () => {
      resizeObserver.disconnect();
      if (layoutStripFrameRef.current !== null) {
        cancelAnimationFrame(layoutStripFrameRef.current);
      }
    };
  }, [isLayoutStripExpanded]);

  useEffect(() => {
    const preloadPages = result.pages.slice(Math.max(0, activeIndex - 1), Math.min(result.pages.length, activeIndex + 2));
    const preloadUrls = preloadPages.flatMap((page) =>
      page.assignments
        .map((assignment) => assetsById.get(assignment.imageId)?.previewUrl ?? assetsById.get(assignment.imageId)?.thumbnailUrl)
        .filter((url): url is string => Boolean(url))
    );

    preloadImageUrls(preloadUrls);
  }, [activeIndex, assetsById, result.pages]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;

      if (!resizeState) {
        return;
      }

      const deltaX = event.clientX - resizeState.startX;

      if (resizeState.pane === "left") {
        setLeftRailWidth(clampValue(resizeState.startWidth + deltaX, 220, 420));
        return;
      }

      setInspectorWidth(clampValue(resizeState.startWidth - deltaX, 240, 420));
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

  const pagesForStudio = deferredPages.length > 0 ? deferredPages : result.pages;
  const workspaceStyle = {
    "--layout-rail-width": `${leftRailWidth}px`,
    "--layout-inspector-width": isInspectorCollapsed ? "0px" : `${inspectorWidth}px`
  } as CSSProperties;

  return (
    <div className="layout-studio">
      <div className="sheet-toolbar">
        <div className="sheet-toolbar__summary">
          <span className="sheet-toolbar__eyebrow">Foglio attivo</span>
          <strong>
            {activePage.sheetSpec.label} · {formatMeasurement(activePage.sheetSpec.widthCm)} x{" "}
            {formatMeasurement(activePage.sheetSpec.heightCm)} cm
          </strong>
          <span>{pagesForStudio.length} fogli visibili | aspect ratio {activeAspectRatio} | template {activePage.templateLabel}</span>
        </div>

        <div className="sheet-toolbar__actions">
          <button
            type="button"
            className={dragState ? "secondary-button layout-studio__new-page-button layout-studio__new-page-button--drag" : "secondary-button layout-studio__new-page-button"}
            onClick={onCreatePageFromUnused}
            onDragOver={(event) => {
              if (!dragState) {
                return;
              }
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              if (!dragState) {
                return;
              }
              event.preventDefault();
              onCreatePageWithImage(dragState.imageId);
            }}
          >
            {dragState ? "Rilascia per creare un nuovo foglio" : "Nuovo foglio"}
          </button>
          <button
            type="button"
            className={
              isTemplateChooserOpen
                ? "secondary-button layout-studio__template-button layout-studio__template-button--active"
                : "secondary-button layout-studio__template-button"
            }
            onClick={handleTemplateChooserToggle}
          >
            Template
          </button>
        </div>
      </div>

      <div className="layout-studio__workspace" style={workspaceStyle}>
        <aside className="layout-studio__rail">
          <div className="layout-studio__rail-panel">
            <span className="layout-studio__rail-eyebrow">Libreria foto</span>
            <PhotoRibbon
              assets={deferredAssets}
              assetFilter={assetFilter}
              usageByAssetId={usageByAssetId}
              dragState={dragState}
              variant="vertical"
              onAssetFilterChange={handleAssetFilterChange}
              onDragAssetStart={onDragAssetStart}
              onDragEnd={onDragEnd}
              onAssetDoubleClick={
                selectedSlot
                  ? (imageId) => onAssetDropped(activePage.id, selectedSlot.id, imageId)
                  : undefined
              }
            />
          </div>

          <div className="layout-studio__rail-panel">
            <span className="layout-studio__rail-eyebrow">Azioni rapide</span>
            <button
              type="button"
              className={dragState ? "secondary-button layout-studio__new-page-button layout-studio__new-page-button--drag" : "secondary-button layout-studio__new-page-button"}
              onClick={onCreatePageFromUnused}
              onDragOver={(event) => {
                if (!dragState) {
                  return;
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                if (!dragState) {
                  return;
                }
                event.preventDefault();
                onCreatePageWithImage(dragState.imageId);
              }}
            >
              {dragState ? "Rilascia per creare un nuovo foglio" : "Nuovo foglio"}
            </button>

            <div
              className={dragState ? "inspector-dropzone inspector-dropzone--active" : "inspector-dropzone"}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => onDropToUnused()}
            >
              <strong>Area rimozione</strong>
              <span>
                {dragState
                  ? "Rilascia qui per togliere la foto dal layout"
                  : activePage.warnings[0] ?? "Trascina qui una foto per riportarla tra le non usate."}
              </span>
            </div>
          </div>
        </aside>

        <div
          className="layout-studio__splitter layout-studio__splitter--left"
          role="separator"
          aria-orientation="vertical"
          aria-label="Ridimensiona libreria foto"
          onPointerDown={handlePaneResizeStart("left")}
        />

        <div className="layout-studio__main">
          <div className="layout-studio__subbar">
            <div className="layout-studio__subbar-group">
              <span className="layout-studio__rail-eyebrow">Filtri fogli</span>
              <div className="layout-studio__subbar-filters">
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
            </div>

            <div className="layout-studio__subbar-group">
              <span className="layout-studio__rail-eyebrow">Scorri fogli</span>
              <div className="layout-studio__subbar-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => previousPage && handleJumpToPage(previousPage)}
                  disabled={!previousPage}
                >
                  Foglio precedente
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => nextPage && handleJumpToPage(nextPage)}
                  disabled={!nextPage}
                >
                  Foglio successivo
                </button>
              </div>
            </div>

            <div className="layout-studio__subbar-pages" role="tablist" aria-label="Indice fogli compatto">
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
                      "layout-studio__subbar-chip",
                      isActive ? "layout-studio__subbar-chip--active" : "",
                      isDragTarget ? "layout-studio__subbar-chip--drop-target" : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => handleJumpToPage(page)}
                    onDragOver={
                      dragState
                        ? (event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                            setDragChipTargetPageId(page.id);
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
                    title={
                      dragState
                        ? `Trascina qui per andare al foglio ${page.pageNumber} e rilasciare la foto`
                        : `Vai al foglio ${page.pageNumber}`
                    }
                  >
                    {dragState && isDragTarget ? `Rilascia su foglio ${page.pageNumber}` : `Foglio ${page.pageNumber}`}
                  </button>
                );
              })}
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

              <div className="template-drawer__grid">
                {compatibleTemplates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className={
                      template.id === activePage.templateId
                        ? "template-card template-card--active"
                        : "template-card"
                    }
                    onClick={() => handleTemplateSelect(template.id)}
                  >
                    {renderTemplateMiniMap(template)}
                    <strong>{template.label}</strong>
                    <span>{template.description}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

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

                  return (
                    <section
                      key={page.id}
                      id={`layout-page-${page.id}`}
                      className={isActive ? "layout-studio__page-card layout-studio__page-card--active" : "layout-studio__page-card"}
                    >
                      <div className="layout-studio__page-card-header">
                        <div>
                          <span className="layout-studio__rail-eyebrow">Foglio {page.pageNumber}</span>
                          <strong>{page.templateLabel}</strong>
                          <p>
                            {page.assignments.length} foto · {page.sheetSpec.label} · gap {page.sheetSpec.gapCm.toFixed(1)} cm
                          </p>
                        </div>
                        <div className="layout-studio__page-card-actions">
                          <button
                            type="button"
                            className={isActive ? "secondary-button" : "ghost-button"}
                            onClick={() => handleJumpToPage(page)}
                          >
                            {isActive ? "Foglio attivo" : "Vai al foglio"}
                          </button>
                        </div>
                      </div>

                      <SheetSurface
                        page={page}
                        assetsById={assetsById}
                        selectedSlotKey={selectedSlotKey}
                        dragState={dragState}
                        onSelectPage={onSelectPage}
                        onStartSlotDrag={onStartSlotDrag}
                        onDragEnd={onDragEnd}
                        onDrop={onDrop}
                        onAssetDropped={onAssetDropped}
                        onAddToPage={onAddToPage}
                        onClearSlot={onClearSlot}
                        onOpenPicker={handleReplaceTargetOpen}
                        onContextMenu={onContextMenu}
                        onUpdateSlotAssignment={onUpdateSlotAssignment}
                        size="hero"
                      />
                    </section>
                  );
                })}
              </div>
            </div>
          </div>

          {dragState ? (
            <div className="layout-studio__drag-dock">
              {previousPage ? (
                <button
                  type="button"
                  className="ghost-button layout-studio__drag-dock-button layout-studio__drag-dock-button--jump"
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    scheduleDragPageJump(previousPage);
                  }}
                  onDragLeave={clearDragPageJump}
                  onDrop={(event) => {
                    event.preventDefault();
                    clearDragPageJump();
                  }}
                >
                  Tieni qui per andare al foglio {previousPage.pageNumber}
                </button>
              ) : null}

              {nextPage ? (
                <button
                  type="button"
                  className="ghost-button layout-studio__drag-dock-button layout-studio__drag-dock-button--jump"
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    scheduleDragPageJump(nextPage);
                  }}
                  onDragLeave={clearDragPageJump}
                  onDrop={(event) => {
                    event.preventDefault();
                    clearDragPageJump();
                  }}
                >
                  Tieni qui per andare al foglio {nextPage.pageNumber}
                </button>
              ) : null}

              <button
                type="button"
                className="secondary-button layout-studio__drag-dock-button"
                onClick={() => onCreatePageWithImage(dragState.imageId)}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  clearDragPageJump();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  clearDragPageJump();
                  onCreatePageWithImage(dragState.imageId);
                }}
              >
                {dragState.kind === "slot"
                  ? "Rilascia o clicca qui per creare un nuovo foglio"
                  : "Rilascia qui per creare un nuovo foglio"}
              </button>

              <div
                className="inspector-dropzone inspector-dropzone--active layout-studio__drag-dock-dropzone"
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  clearDragPageJump();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  clearDragPageJump();
                  onDropToUnused();
                }}
              >
                <strong>Rimuovi dal layout</strong>
                <span>Rilascia qui per riportare la foto tra le non usate.</span>
              </div>
            </div>
          ) : null}

        </div>

        <div
          className={
            isInspectorCollapsed
              ? "layout-studio__splitter layout-studio__splitter--right layout-studio__splitter--collapsed"
              : "layout-studio__splitter layout-studio__splitter--right"
          }
          role="separator"
          aria-orientation="vertical"
          aria-label="Ridimensiona pannello destro"
          onPointerDown={handlePaneResizeStart("right")}
        >
          <button
            type="button"
            className="layout-studio__splitter-toggle"
            onClick={(event) => {
              event.stopPropagation();
              setIsInspectorCollapsed((current) => !current);
            }}
          >
            {isInspectorCollapsed ? "Mostra pannello" : "Nascondi pannello"}
          </button>
        </div>

        <aside
          className={
            isInspectorCollapsed
              ? "layout-studio__inspector layout-studio__inspector--collapsed"
              : "layout-studio__inspector"
          }
        >
          <div className="layout-studio__inspector-header">
            <span className="layout-studio__rail-eyebrow">Inspector</span>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setIsInspectorCollapsed(true)}
            >
              Nascondi
            </button>
          </div>
          <div className="inspector-panel inspector-panel--metrics">
            <div className="inspector-metric">
              <small>Foglio</small>
              <strong>{activePage.pageNumber}</strong>
            </div>
            <div className="inspector-metric">
              <small>Foto</small>
              <strong>{activePage.assignments.length}</strong>
            </div>
            <div className="inspector-metric">
              <small>Slot</small>
              <strong>{activePage.slotDefinitions.length}</strong>
            </div>
            <div className="inspector-metric">
              <small>DPI</small>
              <strong>{activePage.sheetSpec.dpi}</strong>
            </div>
          </div>

          <div className="inspector-panel">
            <span className="inspector-panel__eyebrow">Formato foglio</span>
            <div className="inspector-sheet-settings">
              <label className="field inspector-field">
                <span>Preset</span>
                <select
                  value={activePage.sheetSpec.presetId}
                  onChange={(event) => onPageSheetPresetChange(activePage.id, event.target.value)}
                >
                  {SHEET_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>

	              <div className="inline-grid inline-grid--2">
	                <CommitOnBlurNumberField
	                  label="Larghezza"
	                  className="inspector-field"
                  value={activePage.sheetSpec.widthCm}
                  onCommit={(value) => onPageSheetFieldChange(activePage.id, "widthCm", value)}
                />

                <CommitOnBlurNumberField
                  label="Altezza"
                  className="inspector-field"
                  value={activePage.sheetSpec.heightCm}
	                  onCommit={(value) => onPageSheetFieldChange(activePage.id, "heightCm", value)}
	                />
	              </div>

              <div className="inline-grid inline-grid--3">
                <CommitOnBlurNumberField
                  label="Margine"
                  className="inspector-field"
                  min="0"
                  step="0.1"
                  value={activePage.sheetSpec.marginCm}
                  onCommit={(value) => onPageSheetFieldChange(activePage.id, "marginCm", value)}
                />

                <CommitOnBlurNumberField
                  label="Gap"
                  className="inspector-field"
                  min="0"
                  step="0.1"
                  value={activePage.sheetSpec.gapCm}
                  onCommit={(value) => onPageSheetFieldChange(activePage.id, "gapCm", value)}
                />

                <CommitOnBlurNumberField
                  label="DPI"
                  className="inspector-field"
                  min="72"
                  step="50"
                  value={activePage.sheetSpec.dpi}
                  onCommit={(value) => onPageSheetFieldChange(activePage.id, "dpi", value)}
                />
              </div>

	              <div className="inspector-sheet-settings__ratio">
	                Aspect ratio {activeAspectRatio} · margine {activePage.sheetSpec.marginCm.toFixed(1)} cm · gap{" "}
                  {activePage.sheetSpec.gapCm.toFixed(1)} cm
	              </div>

              <div className="sheet-toolbar__presets inspector-sheet-settings__presets">
                {(["13x18", "15x20", "20x15", "20x30", "30x20", "a4"] as const).map((presetId) => {
                  const preset = SHEET_PRESETS.find((item) => item.id === presetId);
                  if (!preset) {
                    return null;
                  }

                  const isActive = activePage.sheetSpec.presetId === preset.id;

                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={isActive ? "sheet-toolbar__chip sheet-toolbar__chip--active" : "sheet-toolbar__chip"}
                      onClick={() => onPageSheetPresetChange(activePage.id, preset.id)}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="inspector-panel">
            <span className="inspector-panel__eyebrow">Slot selezionato</span>
            <AssignmentInspector
              pageLabel={`Foglio ${activePage.pageNumber}`}
              slot={selectedSlot}
              assignment={selectedAssignment}
              asset={selectedAsset}
              onChange={(changes) => {
                if (!selectedSlot) {
                  return;
                }

                onUpdateSlotAssignment(activePage.id, selectedSlot.id, changes);
              }}
              onClear={() => {
                if (!selectedSlot) {
                  return;
                }

                onClearSlot(activePage.id, selectedSlot.id);
              }}
            />
          </div>

          <div className="inspector-panel">
            <span className="inspector-panel__eyebrow">Azioni foglio</span>
            <div className="inspector-actions">
              <button type="button" className="ghost-button" onClick={() => onRemovePage(activePage.id)}>
                Elimina foglio
              </button>
            </div>
          </div>
        </aside>
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
        />
      ) : null}
    </div>
  );
}
