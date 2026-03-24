/**
 * SheetSurface — renders one page's photo slots with pure drag-and-drop interactions.
 *
 * Interactions:
 *  - Click slot → selects slot (shows controls in AssignmentInspector rail)
 *  - Drag ribbon photo → assign to slot
 *  - Drag slot photo → swap/move to another slot (same or cross-page)
 *  - Double-click slot photo → open photo window
 *  - Alt + scroll → zoom the photo within the slot
 *  - Pointer drag (no Alt, no DnD) → pan the photo within the slot
 *  - Minimal "×" badge visible on hover / selected → clear the slot
 *  - Keyboard Del/Backspace → handled in App.tsx for selected slot
 *
 * No slot-quick-toolbar. All per-slot controls (fitMode, zoom, offset) live in AssignmentInspector.
 */

import { memo, useMemo, useRef, useState, useEffect, useCallback, type CSSProperties, type MouseEvent } from "react";
import type {
  GeneratedPageLayout,
  ImageAsset,
  LayoutAssignment,
  LayoutMove,
} from "@photo-tools/shared-types";
import { ImageSlotPreview } from "./ImageSlotPreview";

// ─────────────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────────────

export interface DragState {
  kind: "asset" | "slot";
  imageId: string;
  sourcePageId?: string;
  sourceSlotId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure utility functions (also exported for use in LayoutPreviewBoard)
// ─────────────────────────────────────────────────────────────────────────────

export function buildAssignmentsBySlotId(page: GeneratedPageLayout): Map<string, LayoutAssignment> {
  return new Map(page.assignments.map((a) => [a.slotId, a] as const));
}

export function getSheetPreviewStyle(page: GeneratedPageLayout): CSSProperties {
  const backgroundImage = page.sheetSpec.backgroundImageUrl?.trim();
  return {
    aspectRatio: String(
      Math.max(page.sheetSpec.widthCm, 0.1) / Math.max(page.sheetSpec.heightCm, 0.1)
    ),
    backgroundColor: page.sheetSpec.backgroundColor ?? "#ffffff",
    backgroundImage: backgroundImage ? `url("${backgroundImage}")` : undefined,
    backgroundSize: backgroundImage ? "cover" : undefined,
    backgroundPosition: backgroundImage ? "center" : undefined,
  };
}

export function getSlotDisplayRect(
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

export function renderGuideLines(page: GeneratedPageLayout) {
  if (!page.sheetSpec.showRulers) return null;

  const verticalGuides = normalizeGuides(page.sheetSpec.verticalGuidesCm, page.sheetSpec.widthCm);
  const horizontalGuides = normalizeGuides(page.sheetSpec.horizontalGuidesCm, page.sheetSpec.heightCm);

  if (verticalGuides.length === 0 && horizontalGuides.length === 0) return null;

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

function normalizeGuides(values: number[] | undefined, maxCm: number): number[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .filter((v) => Number.isFinite(v) && v > 0 && v < maxCm)
        .map((v) => Number(v.toFixed(3)))
    )
  ).sort((a, b) => a - b);
}

// ─────────────────────────────────────────────────────────────────────────────
// SheetSurface component props
// ─────────────────────────────────────────────────────────────────────────────

interface SheetSurfaceProps {
  page: GeneratedPageLayout;
  assetsById: Map<string, ImageAsset>;
  selectedSlotKey: string | null;
  recentlyAddedSlotKey?: string | null;
  dragState: DragState | null;
  onSelectPage: (pageId: string, slotId?: string) => void;
  onStartSlotDrag: (pageId: string, slotId: string, imageId: string) => void;
  onDragEnd: () => void;
  onDrop: (move: LayoutMove) => void;
  onAssetDropped: (pageId: string, slotId: string, imageId: string) => void;
  onAddToPage: (pageId: string, imageId: string) => void;
  onClearSlot: (pageId: string, slotId: string) => void;
  onOpenPhotoWindow: (pageId: string, slotId: string) => void;
  onContextMenu?: (event: MouseEvent, page: GeneratedPageLayout) => void;
  onUpdateSlotAssignment: (
    pageId: string,
    slotId: string,
    changes: Partial<
      Pick<
        LayoutAssignment,
        | "fitMode"
        | "zoom"
        | "offsetX"
        | "offsetY"
        | "rotation"
        | "locked"
        | "cropLeft"
        | "cropTop"
        | "cropWidth"
        | "cropHeight"
      >
    >
  ) => void;
  size: "hero" | "thumb";
}

// ─────────────────────────────────────────────────────────────────────────────
// SheetSurface
// ─────────────────────────────────────────────────────────────────────────────

export const SheetSurface = memo(function SheetSurface({
  page,
  assetsById,
  selectedSlotKey,
  recentlyAddedSlotKey,
  dragState,
  onSelectPage,
  onStartSlotDrag,
  onDragEnd,
  onDrop,
  onAssetDropped,
  onAddToPage,
  onClearSlot,
  onOpenPhotoWindow,
  onContextMenu,
  onUpdateSlotAssignment,
  size,
}: SheetSurfaceProps) {
  const interactive = size === "hero";
  const assignmentsBySlotId = useMemo(() => buildAssignmentsBySlotId(page), [page]);
  const previewRef = useRef<HTMLDivElement | null>(null);

  // Drag intent label — contextual hint shown as an overlay during drag
  const [dragIntentLabel, setDragIntentLabel] = useState<string | null>(null);
  const dragIntentLabelRef = useRef<string | null>(null);
  const [hoveredDropSlotId, setHoveredDropSlotId] = useState<string | null>(null);
  const [isCanvasAddTarget, setIsCanvasAddTarget] = useState(false);

  const setStableDragIntentLabel = useCallback((next: string | null) => {
    if (dragIntentLabelRef.current === next) return;
    dragIntentLabelRef.current = next;
    setDragIntentLabel(next);
  }, []);

  useEffect(() => {
    if (!dragState) {
      dragIntentLabelRef.current = null;
      setDragIntentLabel(null);
      setHoveredDropSlotId(null);
      setIsCanvasAddTarget(false);
    }
  }, [dragState]);

  // ── In-slot pan via pointer capture ────────────────────────────────────────
  const panStateRef = useRef<{
    pointerId: number;
    slotId: string;
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
    width: number;
    height: number;
    sensitivityX: number;
    sensitivityY: number;
    moved: boolean;
  } | null>(null);
  const panFrameRef = useRef<number | null>(null);
  const pendingPanRef = useRef<{ slotId: string; offsetX: number; offsetY: number } | null>(null);

  useEffect(() => {
    return () => {
      if (panFrameRef.current !== null) cancelAnimationFrame(panFrameRef.current);
    };
  }, []);

  const flushPanUpdate = useCallback(() => {
    if (pendingPanRef.current) {
      onUpdateSlotAssignment(page.id, pendingPanRef.current.slotId, {
        offsetX: pendingPanRef.current.offsetX,
        offsetY: pendingPanRef.current.offsetY,
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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      ref={previewRef}
      className={[
        size === "hero" ? "sheet-preview sheet-preview--hero" : "sheet-preview sheet-preview--thumb",
        interactive && dragState ? "sheet-preview--drag-over" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={getSheetPreviewStyle(page)}
      onDragOver={
        interactive
          ? (event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              const target = event.target as HTMLElement | null;
              const overSlot = Boolean(target?.closest(".sheet-slot"));
              setIsCanvasAddTarget(!overSlot);
              setStableDragIntentLabel(
                overSlot
                  ? "Scegli uno slot (vuoto = aggiungi, pieno = sostituisci/scambia) oppure parcheggia la foto per spostarla su un altro foglio."
                  : "Rilascia nello spazio bianco per aggiungere la foto a questo foglio e aggiornare il template se serve."
              );
            }
          : undefined
      }
      onDrop={
        interactive
          ? (event) => {
              event.preventDefault();
              const target = event.target as HTMLElement | null;
              const overSlot = Boolean(target?.closest(".sheet-slot"));
              if (dragState && !overSlot) {
                onAddToPage(page.id, dragState.imageId);
              }
              setStableDragIntentLabel(null);
              setHoveredDropSlotId(null);
              setIsCanvasAddTarget(false);
            }
          : undefined
      }
      onDragLeave={
        interactive
          ? (event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setStableDragIntentLabel(null);
                setIsCanvasAddTarget(false);
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
      {renderGuideLines(page)}

      {interactive && dragState && isCanvasAddTarget ? (
        <div className="sheet-preview__add-indicator" aria-hidden="true">
          <span className="sheet-preview__add-indicator-icon">+</span>
          <span className="sheet-preview__add-indicator-label">Aggiungi al foglio</span>
        </div>
      ) : null}

      {page.slotDefinitions.map((slot) => {
        const assignment = assignmentsBySlotId.get(slot.id);
        const asset = assignment ? assetsById.get(assignment.imageId) : undefined;
        const isLocked = Boolean(assignment?.locked);
        const isSelected = selectedSlotKey === `${page.id}:${slot.id}`;
        const isRecentlyAdded = recentlyAddedSlotKey === `${page.id}:${slot.id}`;
        const isDragging =
          dragState?.kind === "slot" &&
          dragState.sourcePageId === page.id &&
          dragState.sourceSlotId === slot.id;
        const canReposition = Boolean(interactive && assignment);
        const canDragAssignment = Boolean(interactive && assignment && !assignment.locked);
        const isDropTarget =
          Boolean(dragState) &&
          !isLocked &&
          !(
            dragState?.kind === "slot" &&
            dragState.sourcePageId === page.id &&
            dragState.sourceSlotId === slot.id
          );

        return (
          <div
            key={slot.id}
            className={[
              "sheet-slot",
              isSelected ? "sheet-slot--selected" : "",
              isRecentlyAdded ? "sheet-slot--recently-added" : "",
              isDragging ? "sheet-slot--dragging" : "",
              isDropTarget ? "sheet-slot--drag-target" : "",
              assignment ? "" : "sheet-slot--empty",
            ]
              .filter(Boolean)
              .join(" ")}
            style={(() => {
              const slotRect = getSlotDisplayRect(page, slot);
              const borderWidthPx = Math.max(0, (page.sheetSpec.photoBorderWidthCm ?? 0) * (size === "hero" ? 14 : 7));
              return {
                left: `${slotRect.left * 100}%`,
                top: `${slotRect.top * 100}%`,
                width: `${slotRect.width * 100}%`,
                height: `${slotRect.height * 100}%`,
                ["--slot-border-width" as string]: `${borderWidthPx}px`,
                ["--slot-border-color" as string]: page.sheetSpec.photoBorderColor ?? "#ffffff",
              };
            })()}
            onClick={interactive ? () => onSelectPage(page.id, slot.id) : undefined}
            onDragOver={
              interactive
                ? (event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    if (!dragState) return;
                    if (hoveredDropSlotId !== slot.id) {
                      setHoveredDropSlotId(slot.id);
                    }

                    if (isLocked) {
                      setStableDragIntentLabel("Slot bloccato: sbloccalo per sostituire o scambiare la foto.");
                      return;
                    }

                    if (dragState.kind === "slot" && dragState.sourcePageId && dragState.sourceSlotId) {
                      setStableDragIntentLabel(
                        assignment
                          ? "Rilascia per scambiare le due foto"
                          : "Rilascia per spostare la foto in questo slot"
                      );
                      return;
                    }

                    setStableDragIntentLabel(
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
                    if (!dragState) return;
                    setHoveredDropSlotId(null);
                    if (isLocked) {
                      setStableDragIntentLabel("Slot bloccato: sbloccalo per sostituire o scambiare la foto.");
                      return;
                    }

                    if (dragState.kind === "slot" && dragState.sourcePageId && dragState.sourceSlotId) {
                      // Always precision: swap if both occupied, move if target is empty
                      onDrop({
                        sourcePageId: dragState.sourcePageId,
                        sourceSlotId: dragState.sourceSlotId,
                        targetPageId: page.id,
                        targetSlotId: slot.id,
                      });
                      setStableDragIntentLabel(null);
                      return;
                    }

                    onAssetDropped(page.id, slot.id, dragState.imageId);
                    setStableDragIntentLabel(null);
                  }
                : undefined
            }
            onDragLeave={
              interactive
                ? (event) => {
                    event.stopPropagation();
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setHoveredDropSlotId((current) => (current === slot.id ? null : current));
                    }
                    setStableDragIntentLabel(
                      "Scegli uno slot (vuoto = aggiungi, pieno = sostituisci/scambia) oppure parcheggia la foto per spostarla su un altro foglio."
                    );
                  }
                : undefined
            }
          >
            {interactive && dragState && hoveredDropSlotId === slot.id && isDropTarget ? (
              <div
                className={[
                  "sheet-slot__drop-indicator",
                  assignment
                    ? dragState.kind === "slot"
                      ? "sheet-slot__drop-indicator--swap"
                      : "sheet-slot__drop-indicator--replace"
                    : "sheet-slot__drop-indicator--add"
                ].join(" ")}
                aria-hidden="true"
              >
                {assignment
                  ? dragState.kind === "slot"
                    ? "⇄"
                    : "⟲"
                  : "+"}
              </div>
            ) : null}

            {interactive ? (
              <>
                {/* ── Draggable photo button ──────────────────────────────── */}
                <button
                  type="button"
                  data-preview-asset-id={assignment?.imageId}
                  className={canReposition ? "slot-asset slot-asset--repositionable" : "slot-asset"}
                  draggable={canDragAssignment}
                  title={
                    assignment
                      ? assignment.locked
                        ? "Slot bloccato: sbloccalo per spostare o sostituire la foto."
                        : "Trascina per spostare. Doppio clic per aprire la finestra foto. Alt+scroll per zoom."
                      : "Trascina qui una foto dalla ribbon di sinistra per assegnarla."
                  }
                  onClick={() => {
                    onSelectPage(page.id, slot.id);
                  }}
                  onDragStart={(event) => {
                    if (!assignment) { event.preventDefault(); return; }
                    if (assignment.locked) { event.preventDefault(); return; }
                    if (event.altKey) { event.preventDefault(); return; }
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", assignment.imageId);
                      setTimeout(() => {
                        onStartSlotDrag(page.id, slot.id, assignment.imageId);
                        setStableDragIntentLabel(
                          "Trascina la foto su uno slot (vuoto = sposta, pieno = scambia) oppure parcheggiala per spostarla su un altro foglio."
                        );
                      }, 0);
                  }}
                  onDragEnd={(event) => {
                    event.stopPropagation();
                    onDragEnd();
                  }}
                  onWheel={(event) => {
                    if (!assignment || !interactive || !event.altKey) return;
                    event.preventDefault();
                    const nextZoom = Math.max(0.7, Math.min(2.2, assignment.zoom + (event.deltaY > 0 ? -0.08 : 0.08)));
                    onUpdateSlotAssignment(page.id, slot.id, { zoom: nextZoom });
                  }}
                  onDoubleClick={(event) => {
                    if (!assignment || !interactive) return;
                    event.preventDefault();
                    onSelectPage(page.id, slot.id);
                    onOpenPhotoWindow(page.id, slot.id);
                  }}
                  onPointerDown={(event) => {
                    if (event.button === 0) {
                      onSelectPage(page.id, slot.id);
                    }

                    if (!assignment || !canReposition || event.button !== 0) return;

                    // Start pan capture for non-DnD repositioning
                    const rect = event.currentTarget.getBoundingClientRect();
                    const slotRect = getSlotDisplayRect(page, slot);
                    const slotPxWidth = Math.max(rect.width, 220);
                    const slotPxHeight = Math.max(rect.height, 220);
                    const zoomFactor = Math.max(0.4, assignment.zoom);
                    const sensitivityX = (100 / slotPxWidth) * 200 * (1 / zoomFactor);
                    const sensitivityY = (100 / slotPxHeight) * 200 * (1 / zoomFactor) * (slotRect.height / Math.max(slotRect.width, 0.01));

                    panStateRef.current = {
                      pointerId: event.pointerId,
                      slotId: slot.id,
                      startX: event.clientX,
                      startY: event.clientY,
                      startOffsetX: assignment.offsetX,
                      startOffsetY: assignment.offsetY,
                      width: rect.width,
                      height: rect.height,
                      sensitivityX,
                      sensitivityY,
                      moved: false,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    const panState = panStateRef.current;
                    if (!panState || panState.pointerId !== event.pointerId) return;

                    const deltaX = event.clientX - panState.startX;
                    const deltaY = event.clientY - panState.startY;
                    if (!panState.moved && Math.abs(deltaX) + Math.abs(deltaY) < 3) return;
                    panState.moved = true;

                    const effectiveWidth = Math.max(panState.width, 220);
                    const effectiveHeight = Math.max(panState.height, 220);
                    const nextOffsetX = Math.max(
                      -100,
                      Math.min(100, panState.startOffsetX + (deltaX / effectiveWidth) * panState.sensitivityX)
                    );
                    const nextOffsetY = Math.max(
                      -100,
                      Math.min(100, panState.startOffsetY + (deltaY / effectiveHeight) * panState.sensitivityY)
                    );
                    schedulePanUpdate(slot.id, nextOffsetX, nextOffsetY);
                  }}
                  onPointerUp={(event) => {
                    if (!panStateRef.current || panStateRef.current.pointerId !== event.pointerId) return;
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
                    label={assignment ? (asset?.fileName ?? assignment.imageId) : slot.id}
                    slot={slot}
                    sheetSpec={page.sheetSpec}
                    slotCount={page.slotDefinitions.length}
                  />
                </button>

                {/* ── Minimal clear badge — only shown on hover/selected ── */}
                {assignment ? (
                  <button
                    type="button"
                    className="slot-clear-badge"
                    disabled={assignment.locked}
                    onClick={(event) => {
                      event.stopPropagation();
                      onClearSlot(page.id, slot.id);
                    }}
                    aria-label="Rimuovi foto dallo slot"
                    title={assignment.locked ? "Sblocca lo slot per rimuovere la foto" : "Rimuovi foto (o tasto Canc)"}
                  >
                    ×
                  </button>
                ) : null}
              </>
            ) : (
              <div className="slot-asset slot-asset--thumb">
                <ImageSlotPreview
                  asset={asset}
                  assignment={assignment}
                  label={assignment ? (asset?.fileName ?? assignment.imageId) : slot.id}
                  slot={slot}
                  sheetSpec={page.sheetSpec}
                  slotCount={page.slotDefinitions.length}
                />
              </div>
            )}
          </div>
        );
      })}

      {/* ── Drag intent label overlay ─────────────────────────────────────── */}
      {interactive && dragState && dragIntentLabel ? (
        <div className="sheet-drag-intent" aria-live="polite">
          {dragIntentLabel}
        </div>
      ) : null}
    </div>
  );
});
