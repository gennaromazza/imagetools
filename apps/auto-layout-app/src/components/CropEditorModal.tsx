import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { ImageAsset, LayoutAssignment, LayoutSlot, LayoutTemplate } from "@photo-tools/shared-types";
import "./CropEditorModal.css";

interface CropEditorModalProps {
  asset: ImageAsset;
  assignment: LayoutAssignment;
  slot: LayoutSlot;
  availableTemplates?: LayoutTemplate[];
  onClose: () => void;
  onApply: (
    changes: Partial<
      Pick<
        LayoutAssignment,
        "fitMode" | "zoom" | "offsetX" | "offsetY" | "rotation" | "cropLeft" | "cropTop" | "cropWidth" | "cropHeight"
      >
    >
  ) => void;
}

type CropRect = { left: number; top: number; width: number; height: number };
type CropAction = "move" | "nw" | "ne" | "sw" | "se";
type AspectPreset = "free" | "slot" | "1:1" | "3:4" | "4:5" | "2:3" | "16:9";
type LayoutCompatibility = {
  hasTemplateContext: boolean;
  hasAnyCompatibleTemplate: boolean;
  compatibleTemplateCount: number;
  currentSlotCompatible: boolean;
  closestTemplateLabel: string | null;
  closestSlotId: string | null;
};

const MIN_CROP_SIZE = 0.08;
const LAYOUT_COMPATIBILITY_TOLERANCE = 0.22;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getAspectRatio(preset: AspectPreset, slot: LayoutSlot): number | null {
  switch (preset) {
    case "1:1":
      return 1;
    case "3:4":
      return 3 / 4;
    case "4:5":
      return 4 / 5;
    case "2:3":
      return 2 / 3;
    case "16:9":
      return 16 / 9;
    case "slot":
      return slot.width / Math.max(slot.height, 0.001);
    default:
      return null;
  }
}

function getInitialCropRect(assignment: LayoutAssignment, asset: ImageAsset, slot: LayoutSlot): CropRect {
  if (
    typeof assignment.cropLeft === "number" &&
    typeof assignment.cropTop === "number" &&
    typeof assignment.cropWidth === "number" &&
    typeof assignment.cropHeight === "number"
  ) {
    return normalizeRect({
      left: assignment.cropLeft,
      top: assignment.cropTop,
      width: assignment.cropWidth,
      height: assignment.cropHeight
    });
  }

  return getDefaultCropRect(asset, slot);
}

function getDefaultCropRect(asset: ImageAsset, slot: LayoutSlot): CropRect {
  const imageAspect = asset.aspectRatio > 0 ? asset.aspectRatio : 1;
  const slotAspect = slot.width / Math.max(slot.height, 0.001);

  if (imageAspect > slotAspect) {
    const width = clamp(slotAspect / imageAspect, MIN_CROP_SIZE, 1);
    return normalizeRect({ left: (1 - width) / 2, top: 0, width, height: 1 });
  }

  const height = clamp(imageAspect / slotAspect, MIN_CROP_SIZE, 1);
  return normalizeRect({ left: 0, top: (1 - height) / 2, width: 1, height });
}

function normalizeRect(rect: CropRect): CropRect {
  const width = clamp(rect.width, MIN_CROP_SIZE, 1);
  const height = clamp(rect.height, MIN_CROP_SIZE, 1);
  const left = clamp(rect.left, 0, 1 - width);
  const top = clamp(rect.top, 0, 1 - height);
  return { left, top, width, height };
}

function getEffectiveCropAspect(rect: CropRect, imageAspect: number): number {
  return (imageAspect * rect.width) / Math.max(rect.height, 0.0001);
}

function isQuarterTurn(rotation: number): boolean {
  return Math.abs(normalizeRotation(rotation)) % 180 === 90;
}

function getOutputCropAspect(rect: CropRect, imageAspect: number, rotation: number): number {
  const baseAspect = getEffectiveCropAspect(rect, imageAspect);
  return isQuarterTurn(rotation) ? 1 / Math.max(baseAspect, 0.0001) : baseAspect;
}

function isAspectClose(left: number, right: number, tolerance = 0.035): boolean {
  return Math.abs(Math.log(left / Math.max(right, 0.0001))) <= tolerance;
}

function shouldPreserveOutputAspect(
  assignment: LayoutAssignment,
  cropRect: CropRect,
  imageAspect: number,
  slot: LayoutSlot
): boolean {
  if (assignment.fitMode === "fit") {
    return true;
  }

  const cropAspect = getEffectiveCropAspect(cropRect, imageAspect);
  const slotAspect = slot.width / Math.max(slot.height, 0.0001);
  return !isAspectClose(cropAspect, slotAspect);
}

function fitRectToAspect(rect: CropRect, aspect: number | null, imageAspect: number): CropRect {
  if (!aspect) {
    return normalizeRect(rect);
  }

  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const targetArea = Math.max(MIN_CROP_SIZE * MIN_CROP_SIZE, rect.width * rect.height);
  let width = Math.sqrt((targetArea * aspect) / Math.max(imageAspect, 0.0001));
  let height = targetArea / Math.max(width, MIN_CROP_SIZE);

  const maxWidthFromCenter = Math.max(MIN_CROP_SIZE, Math.min(centerX, 1 - centerX) * 2);
  const maxHeightFromCenter = Math.max(MIN_CROP_SIZE, Math.min(centerY, 1 - centerY) * 2);

  if (width > maxWidthFromCenter) {
    width = maxWidthFromCenter;
    height = (imageAspect * width) / aspect;
  }

  if (height > maxHeightFromCenter) {
    height = maxHeightFromCenter;
    width = (aspect * height) / Math.max(imageAspect, 0.0001);
  }

  return normalizeRect({
    left: centerX - width / 2,
    top: centerY - height / 2,
    width,
    height
  });
}

function detectAspectPreset(rect: CropRect, slot: LayoutSlot, imageAspect: number): AspectPreset {
  const ratio = getEffectiveCropAspect(rect, imageAspect);
  const candidates: Array<{ preset: AspectPreset; ratio: number }> = [
    { preset: "slot", ratio: slot.width / Math.max(slot.height, 0.001) },
    { preset: "1:1", ratio: 1 },
    { preset: "3:4", ratio: 3 / 4 },
    { preset: "4:5", ratio: 4 / 5 },
    { preset: "2:3", ratio: 2 / 3 },
    { preset: "16:9", ratio: 16 / 9 }
  ];

  const tolerance = 0.035;
  const match = candidates
    .map((candidate) => ({
      preset: candidate.preset,
      distance: Math.abs(Math.log(ratio / Math.max(candidate.ratio, 0.0001)))
    }))
    .sort((left, right) => left.distance - right.distance)[0];

  if (!match || match.distance > tolerance) {
    return "free";
  }

  return match.preset;
}

function normalizeRotation(value: number): number {
  const rounded = Math.round(value);
  const wrapped = ((rounded % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

function getLayoutCompatibility(
  templates: LayoutTemplate[] | undefined,
  cropAspect: number,
  currentSlot: LayoutSlot
): LayoutCompatibility {
  const safeAspect = Math.max(cropAspect, 0.0001);
  const currentSlotAspect = currentSlot.width / Math.max(currentSlot.height, 0.0001);
  const currentSlotCompatible = isAspectClose(safeAspect, currentSlotAspect, LAYOUT_COMPATIBILITY_TOLERANCE);

  if (!templates || templates.length === 0) {
    return {
      hasTemplateContext: false,
      hasAnyCompatibleTemplate: false,
      compatibleTemplateCount: 0,
      currentSlotCompatible,
      closestTemplateLabel: null,
      closestSlotId: null
    };
  }

  let compatibleTemplateCount = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  let closestTemplateLabel: string | null = null;
  let closestSlotId: string | null = null;

  for (const template of templates) {
    let templateCompatible = false;

    for (const templateSlot of template.slots) {
      const slotAspect = templateSlot.width / Math.max(templateSlot.height, 0.0001);
      const distance = Math.abs(Math.log(safeAspect / Math.max(slotAspect, 0.0001)));

      if (distance < closestDistance) {
        closestDistance = distance;
        closestTemplateLabel = template.label;
        closestSlotId = templateSlot.id;
      }

      if (distance <= LAYOUT_COMPATIBILITY_TOLERANCE) {
        templateCompatible = true;
      }
    }

    if (templateCompatible) {
      compatibleTemplateCount += 1;
    }
  }

  return {
    hasTemplateContext: true,
    hasAnyCompatibleTemplate: compatibleTemplateCount > 0,
    compatibleTemplateCount,
    currentSlotCompatible,
    closestTemplateLabel,
    closestSlotId
  };
}

function parseAspectRatioInput(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) {
    return null;
  }

  const ratioMatch = normalized.match(/^([0-9]+(?:\.[0-9]+)?)\s*[:/]\s*([0-9]+(?:\.[0-9]+)?)$/);
  if (ratioMatch) {
    const width = Number(ratioMatch[1]);
    const height = Number(ratioMatch[2]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return width / height;
    }
    return null;
  }

  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }

  return null;
}

function formatAspectRatioInput(ratio: number): string {
  let bestNumerator = 1;
  let bestDenominator = 1;
  let bestError = Number.POSITIVE_INFINITY;

  for (let denominator = 1; denominator <= 20; denominator += 1) {
    for (let numerator = 1; numerator <= 20; numerator += 1) {
      const candidate = numerator / denominator;
      const error = Math.abs(candidate - ratio);
      if (error < bestError) {
        bestError = error;
        bestNumerator = numerator;
        bestDenominator = denominator;
      }
    }
  }

  if (bestError < 0.015) {
    return `${bestNumerator}:${bestDenominator}`;
  }

  return ratio.toFixed(3).replace(/\.0+$|0+$/g, "");
}

export function CropEditorModal({ asset, assignment, slot, availableTemplates, onClose, onApply }: CropEditorModalProps) {
  const imageAspect = asset.aspectRatio > 0 ? asset.aspectRatio : 1;
  const initialCrop = useMemo(
    () => getInitialCropRect(assignment, asset, slot),
    [
      assignment.cropLeft,
      assignment.cropTop,
      assignment.cropWidth,
      assignment.cropHeight,
      asset.id,
      asset.aspectRatio,
      slot.id,
      slot.width,
      slot.height
    ]
  );
  const stageRef = useRef<HTMLDivElement | null>(null);
  const lastSyncedStateRef = useRef<string>("");
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [aspectPreset, setAspectPreset] = useState<AspectPreset>("slot");
  const [cropRect, setCropRect] = useState<CropRect>(initialCrop);
  const [draftRotation, setDraftRotation] = useState<number>(() => normalizeRotation(assignment.rotation ?? 0));
  const [isDragging, setIsDragging] = useState(false);
  const [isCropBoxFocused, setIsCropBoxFocused] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const dragStateRef = useRef<{
    action: CropAction;
    pointerId: number;
    startX: number;
    startY: number;
    initialRect: CropRect;
  } | null>(null);
  const currentAspect = getAspectRatio(aspectPreset, slot);
  const slotAspect = slot.width / Math.max(slot.height, 0.0001);
  const assignmentStateKey = [
    assignment.cropLeft ?? "",
    assignment.cropTop ?? "",
    assignment.cropWidth ?? "",
    assignment.cropHeight ?? "",
    assignment.fitMode,
    assignment.rotation ?? 0,
    asset.id,
    asset.aspectRatio,
    slot.id,
    slot.width,
    slot.height
  ].join("|");
  const stageVisualAspect = useMemo(() => clamp(imageAspect, 0.78, 1.95), [imageAspect]);
  const cropOutputAspect = useMemo(
    () => getOutputCropAspect(cropRect, imageAspect, draftRotation),
    [cropRect, draftRotation, imageAspect]
  );
  const layoutCompatibility = useMemo(
    () => getLayoutCompatibility(availableTemplates, cropOutputAspect, slot),
    [availableTemplates, cropOutputAspect, slot]
  );
  const cropRatioLabel = useMemo(() => formatAspectRatioInput(cropOutputAspect), [cropOutputAspect]);
  const slotRatioLabel = useMemo(() => formatAspectRatioInput(slotAspect), [slotAspect]);
  const displayedImageRect = useMemo(() => {
    const safeWidth = Math.max(1, stageSize.width);
    const safeHeight = Math.max(1, stageSize.height);
    const stageAspect = safeWidth / safeHeight;

    if (imageAspect > stageAspect) {
      const height = safeWidth / imageAspect;
      return { left: 0, top: (safeHeight - height) / 2, width: safeWidth, height };
    }
    const width = safeHeight * imageAspect;
    return { left: (safeWidth - width) / 2, top: 0, width, height: safeHeight };
  }, [imageAspect, stageSize.height, stageSize.width]);

  useEffect(() => {
    if (lastSyncedStateRef.current === assignmentStateKey) {
      return;
    }

    lastSyncedStateRef.current = assignmentStateKey;
    setCropRect(initialCrop);
    setAspectPreset("slot");
    setDraftRotation(normalizeRotation(assignment.rotation ?? 0));
    setIsDragging(false);
  }, [assignment.fitMode, assignment.rotation, assignmentStateKey, imageAspect, initialCrop, slot]);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setStageSize({
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height)
      });
    };

    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (
        !dragState ||
        event.pointerId !== dragState.pointerId ||
        displayedImageRect.width <= 0 ||
        displayedImageRect.height <= 0
      ) {
        return;
      }

          const dx = (event.clientX - dragState.startX) / displayedImageRect.width;
          const dy = (event.clientY - dragState.startY) / displayedImageRect.height;
      const next = { ...dragState.initialRect };

      switch (dragState.action) {
        case "move":
          next.left += dx;
          next.top += dy;
          break;
        case "nw":
          next.left += dx;
          next.top += dy;
          next.width -= dx;
          next.height -= dy;
          break;
        case "ne":
          next.top += dy;
          next.width += dx;
          next.height -= dy;
          break;
        case "sw":
          next.left += dx;
          next.width -= dx;
          next.height += dy;
          break;
        case "se":
          next.width += dx;
          next.height += dy;
          break;
      }

      let normalized = normalizeRect(next);

      if (currentAspect) {
        if (dragState.action === "move") {
          normalized = normalizeRect(normalized);
        } else {
          const lockedWidth = normalized.width;
              const lockedHeight = (imageAspect * lockedWidth) / currentAspect;
          normalized = normalizeRect({
            left: normalized.left,
            top:
              dragState.action === "sw" || dragState.action === "se"
                ? normalized.top
                : dragState.initialRect.top + dragState.initialRect.height - lockedHeight,
            width: lockedWidth,
            height: lockedHeight
          });
        }
      }

      setCropRect(normalized);
    };

    const stopDrag = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      dragStateRef.current = null;
      setIsDragging(false);
    };

    if (!isDragging) {
      return;
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
    };
  }, [currentAspect, displayedImageRect.height, displayedImageRect.width, imageAspect, isDragging]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.target instanceof HTMLElement) {
        const tagName = event.target.tagName.toLowerCase();
        if (tagName === "input" || tagName === "textarea" || tagName === "select") {
          return;
        }
      }

      if (
        !isCropBoxFocused ||
        (event.key !== "ArrowUp" &&
          event.key !== "ArrowDown" &&
          event.key !== "ArrowLeft" &&
          event.key !== "ArrowRight")
      ) {
        return;
      }

      event.preventDefault();
      const stepPx = event.shiftKey ? 10 : 1;
      const stepX = stepPx / Math.max(displayedImageRect.width, 1);
      const stepY = stepPx / Math.max(displayedImageRect.height, 1);

      setCropRect((current) => {
        let nextLeft = current.left;
        let nextTop = current.top;

        if (event.key === "ArrowLeft") nextLeft -= stepX;
        if (event.key === "ArrowRight") nextLeft += stepX;
        if (event.key === "ArrowUp") nextTop -= stepY;
        if (event.key === "ArrowDown") nextTop += stepY;

        return normalizeRect({
          ...current,
          left: nextLeft,
          top: nextTop
        });
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [displayedImageRect.height, displayedImageRect.width, isCropBoxFocused, onClose]);

  const cropBoxStyle = {
    left: `${displayedImageRect.left + cropRect.left * displayedImageRect.width}px`,
    top: `${displayedImageRect.top + cropRect.top * displayedImageRect.height}px`,
    width: `${cropRect.width * displayedImageRect.width}px`,
    height: `${cropRect.height * displayedImageRect.height}px`
  };

  const startAction = (action: CropAction) => (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsCropBoxFocused(true);
    dragStateRef.current = {
      action,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initialRect: cropRect
    };
    setIsDragging(true);
  };

  const applyCrop = () => {
    const normalizedCrop = normalizeRect(cropRect);

    onApply({
      fitMode: "crop",
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      rotation: draftRotation,
      cropLeft: normalizedCrop.left,
      cropTop: normalizedCrop.top,
      cropWidth: normalizedCrop.width,
      cropHeight: normalizedCrop.height
    });
    onClose();
  };

  const stageStyle: CSSProperties = {
    ["--crop-stage-aspect" as string]: String(stageVisualAspect)
  };
  const slotOverlayStyle = useMemo(() => {
    const cropPxLeft = displayedImageRect.left + cropRect.left * displayedImageRect.width;
    const cropPxTop = displayedImageRect.top + cropRect.top * displayedImageRect.height;
    const cropPxW = cropRect.width * displayedImageRect.width;
    const cropPxH = cropRect.height * displayedImageRect.height;
    const cx = cropPxLeft + cropPxW / 2;
    const cy = cropPxTop + cropPxH / 2;
    const cropVis = cropPxW / Math.max(cropPxH, 1);
    let sw: number;
    let sh: number;
    if (cropVis > slotAspect) {
      sh = cropPxH;
      sw = cropPxH * slotAspect;
    } else {
      sw = cropPxW;
      sh = cropPxW / Math.max(slotAspect, 0.001);
    }
    return {
      left: `${cx - sw / 2}px`,
      top: `${cy - sh / 2}px`,
      width: `${sw}px`,
      height: `${sh}px`,
    };
  }, [cropRect, displayedImageRect, slotAspect]);

  const previewStatus = null;

  return createPortal(
    <div className="modal-backdrop crop-editor-backdrop" onClick={onClose}>
      <div className="modal-panel modal-panel--wide crop-editor-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-panel__header crop-editor-modal__header">
          <div className="crop-editor-modal__title-block">
            <strong>Ritaglia foto</strong>
            <p>{asset.fileName}</p>
            <div className="crop-editor-modal__meta">
              <span className="crop-editor-modal__meta-chip">Crop {cropRatioLabel}</span>
              <span className="crop-editor-modal__meta-chip">Slot {slotRatioLabel}</span>
              <span className="crop-editor-modal__meta-chip">Modo vincolato allo slot</span>
            </div>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Chiudi
          </button>
        </div>

        <div className="crop-editor-modal__body">
        <div className="crop-controls">
          <div className="crop-toolbar">
            <button
              type="button"
              className={advancedOpen ? "crop-toolbar__toggle-btn crop-toolbar__toggle-btn--active" : "crop-toolbar__toggle-btn"}
              onClick={() => setAdvancedOpen((v) => !v)}
            >
              Avanzate {advancedOpen ? "▴" : "▾"}
            </button>
          </div>

          {advancedOpen ? (
            <div className="crop-advanced">
              <div className="crop-advanced__field">
                <label className="crop-advanced__label">Vincoli</label>
                <div className="crop-advanced__ratio-row">
                  <span className="crop-advanced__input">Il crop resta agganciato al ratio dello slot {slotRatioLabel}.</span>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      const defaultRect = getDefaultCropRect(asset, slot);
                      setCropRect(defaultRect);
                      setAspectPreset("slot");
                    }}
                  >
                    Reset
                  </button>
                </div>
              </div>

              <div className="crop-advanced__field">
                <label className="crop-advanced__label">Rotazione fine</label>
                <div className="crop-advanced__rotation-row">
                  <input
                    type="range"
                    min="-180"
                    max="180"
                    step="1"
                    value={draftRotation}
                    className="crop-advanced__slider"
                    onChange={(event) => setDraftRotation(normalizeRotation(Number(event.target.value)))}
                  />
                  <input
                    type="number"
                    min="-180"
                    max="180"
                    step="1"
                    inputMode="numeric"
                    className="crop-advanced__input crop-advanced__input--narrow"
                    value={draftRotation}
                    onChange={(event) => setDraftRotation(normalizeRotation(Number(event.target.value)))}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <section className="crop-editor-stage-panel">
          <div className="crop-editor-stage-panel__bar">
            <div className="crop-editor-stage-panel__header">
              <strong>Area di ritaglio</strong>
              <span>Trascina il riquadro o i quattro angoli.</span>
            </div>
            <div className="crop-editor-stage-panel__quick-rotate" role="group" aria-label="Rotazione rapida">
              <button type="button" className="ghost-button" onClick={() => setDraftRotation((c) => normalizeRotation(c - 90))} title="-90°">-90°</button>
              <span className="crop-editor-stage-panel__deg">{draftRotation}°</span>
              <button type="button" className="ghost-button" onClick={() => setDraftRotation((c) => normalizeRotation(c + 90))} title="+90°">+90°</button>
            </div>
          </div>
          <div
            ref={stageRef}
            className="crop-editor-stage"
            style={stageStyle}
            onPointerDown={() => setIsCropBoxFocused(false)}
          >
            <img src={asset.previewUrl} alt={asset.fileName} className="crop-editor-stage__image" />
            <div
              className="crop-editor-stage__image-frame"
              style={{
                left: `${displayedImageRect.left}px`,
                top: `${displayedImageRect.top}px`,
                width: `${displayedImageRect.width}px`,
                height: `${displayedImageRect.height}px`
              }}
            />
            <div
              className="crop-editor-stage__slot-overlay"
              style={slotOverlayStyle}
              aria-hidden="true"
            >
              <span className="crop-editor-stage__overlay-label">Slot</span>
            </div>
            <div
              className="crop-editor-stage__crop-box"
              style={cropBoxStyle}
              onPointerDown={startAction("move")}
              role="button"
              tabIndex={0}
              aria-label="Area di crop selezionata"
              onFocus={() => setIsCropBoxFocused(true)}
            >
              <span className="crop-editor-stage__overlay-label crop-editor-stage__overlay-label--crop">Crop</span>
              <div
                className={
                  isDragging
                    ? "crop-editor-stage__thirds crop-editor-stage__thirds--active"
                    : "crop-editor-stage__thirds"
                }
                aria-hidden="true"
              >
                <span className="crop-editor-stage__thirds-line crop-editor-stage__thirds-line--v1" />
                <span className="crop-editor-stage__thirds-line crop-editor-stage__thirds-line--v2" />
                <span className="crop-editor-stage__thirds-line crop-editor-stage__thirds-line--h1" />
                <span className="crop-editor-stage__thirds-line crop-editor-stage__thirds-line--h2" />
              </div>
              {(["nw", "ne", "sw", "se"] as CropAction[]).map((handle) => (
                <button
                  key={handle}
                  type="button"
                  className={`crop-editor-stage__handle crop-editor-stage__handle--${handle}`}
                  onPointerDown={startAction(handle)}
                  aria-label={
                    handle === "nw"
                      ? "Ridimensiona angolo nord-ovest"
                      : handle === "ne"
                        ? "Ridimensiona angolo nord-est"
                        : handle === "sw"
                          ? "Ridimensiona angolo sud-ovest"
                          : "Ridimensiona angolo sud-est"
                  }
                />
              ))}
            </div>
          </div>
          <div className="crop-editor-stage-panel__legend">
            <span className="crop-editor-stage-panel__legend-item crop-editor-stage-panel__legend-item--crop" />
            <span>Crop {cropRatioLabel}</span>
            <span className="crop-editor-stage-panel__legend-item crop-editor-stage-panel__legend-item--slot" />
            <span>Slot {slotRatioLabel}</span>
          </div>
        </section>
        {previewStatus ? (
          <div className={`crop-editor-status crop-editor-status--${previewStatus.tone}`}>
            <strong>{previewStatus.title}</strong>
            <span> — {previewStatus.message}</span>
          </div>
        ) : null}
        </div>

        <div className="modal-panel__footer crop-editor-modal__actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Annulla
          </button>
          <button type="button" className="primary-button" onClick={applyCrop}>
            Applica crop
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
