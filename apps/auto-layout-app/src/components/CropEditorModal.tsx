import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ImageAsset, LayoutAssignment, LayoutSlot } from "@photo-tools/shared-types";

interface CropEditorModalProps {
  asset: ImageAsset;
  assignment: LayoutAssignment;
  slot: LayoutSlot;
  onClose: () => void;
  onApply: (
    changes: Partial<
      Pick<
        LayoutAssignment,
        "fitMode" | "zoom" | "offsetX" | "offsetY" | "cropLeft" | "cropTop" | "cropWidth" | "cropHeight"
      >
    >
  ) => void;
}

type CropRect = { left: number; top: number; width: number; height: number };
type CropAction = "move" | "nw" | "ne" | "sw" | "se";
type AspectPreset = "free" | "slot" | "1:1" | "3:4" | "4:5" | "2:3" | "16:9";

const MIN_CROP_SIZE = 0.08;

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
    return {
      left: clamp(assignment.cropLeft, 0, 0.95),
      top: clamp(assignment.cropTop, 0, 0.95),
      width: clamp(assignment.cropWidth, MIN_CROP_SIZE, 1),
      height: clamp(assignment.cropHeight, MIN_CROP_SIZE, 1)
    };
  }

  const imageAspect = asset.aspectRatio > 0 ? asset.aspectRatio : 1;
  const slotAspect = slot.width / Math.max(slot.height, 0.001);

  if (imageAspect > slotAspect) {
    const width = clamp(slotAspect / imageAspect, MIN_CROP_SIZE, 1);
    return { left: (1 - width) / 2, top: 0, width, height: 1 };
  }

  const height = clamp(imageAspect / slotAspect, MIN_CROP_SIZE, 1);
  return { left: 0, top: (1 - height) / 2, width: 1, height };
}

function normalizeRect(rect: CropRect): CropRect {
  const width = clamp(rect.width, MIN_CROP_SIZE, 1);
  const height = clamp(rect.height, MIN_CROP_SIZE, 1);
  const left = clamp(rect.left, 0, 1 - width);
  const top = clamp(rect.top, 0, 1 - height);
  return { left, top, width, height };
}

function fitRectToAspect(rect: CropRect, aspect: number | null): CropRect {
  if (!aspect) {
    return normalizeRect(rect);
  }

  let width = rect.width;
  let height = width / aspect;

  if (height > rect.height) {
    height = rect.height;
    width = height * aspect;
  }

  return normalizeRect({
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height
  });
}

export function CropEditorModal({ asset, assignment, slot, onClose, onApply }: CropEditorModalProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageRect, setStageRect] = useState<DOMRect | null>(null);
  const [aspectPreset, setAspectPreset] = useState<AspectPreset>("slot");
  const [cropRect, setCropRect] = useState<CropRect>(() => getInitialCropRect(assignment, asset, slot));
  const dragStateRef = useRef<{
    action: CropAction;
    pointerId: number;
    startX: number;
    startY: number;
    initialRect: CropRect;
  } | null>(null);

  const imageAspect = asset.aspectRatio > 0 ? asset.aspectRatio : 1;
  const stageSize = useMemo(() => ({ width: 720, height: 500 }), []);
  const displayedImageRect = useMemo(() => {
    const stageAspect = stageSize.width / stageSize.height;
    if (imageAspect > stageAspect) {
      const height = stageSize.width / imageAspect;
      return { left: 0, top: (stageSize.height - height) / 2, width: stageSize.width, height };
    }
    const width = stageSize.height * imageAspect;
    return { left: (stageSize.width - width) / 2, top: 0, width, height: stageSize.height };
  }, [imageAspect, stageSize.height, stageSize.width]);

  useEffect(() => {
    const updateRect = () => {
      if (!stageRef.current) {
        return;
      }
      setStageRect(stageRef.current.getBoundingClientRect());
    };

    updateRect();
    window.addEventListener("resize", updateRect);
    return () => window.removeEventListener("resize", updateRect);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const currentAspect = getAspectRatio(aspectPreset, slot);

  const cropBoxStyle = {
    left: `${displayedImageRect.left + cropRect.left * displayedImageRect.width}px`,
    top: `${displayedImageRect.top + cropRect.top * displayedImageRect.height}px`,
    width: `${cropRect.width * displayedImageRect.width}px`,
    height: `${cropRect.height * displayedImageRect.height}px`
  };

  const startAction = (action: CropAction) => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragStateRef.current = {
      action,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initialRect: cropRect
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onStagePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId || !stageRect) {
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
        const lockedHeight = lockedWidth / currentAspect;
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

  const clearDrag = (event?: React.PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current && event && dragStateRef.current.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
  };

  const applyCrop = () => {
    onApply({
      fitMode: "crop",
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      cropLeft: cropRect.left,
      cropTop: cropRect.top,
      cropWidth: cropRect.width,
      cropHeight: cropRect.height
    });
    onClose();
  };

  return createPortal(
    <div className="modal-backdrop crop-editor-backdrop" onClick={onClose}>
      <div className="modal-card crop-editor-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-card__header">
          <div>
            <strong>Ritaglia foto</strong>
            <p>{asset.fileName}</p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Chiudi
          </button>
        </div>

        <div className="crop-editor-toolbar">
          {(["free", "slot", "1:1", "3:4", "4:5", "2:3", "16:9"] as AspectPreset[]).map((preset) => (
            <button
              key={preset}
              type="button"
              className={aspectPreset === preset ? "chip chip--active" : "chip"}
              onClick={() => {
                setAspectPreset(preset);
                setCropRect((current) => fitRectToAspect(current, getAspectRatio(preset, slot)));
              }}
            >
              {preset === "free" ? "Libero" : preset === "slot" ? "Slot" : preset}
            </button>
          ))}
          <button
            type="button"
            className="ghost-button"
            onClick={() => setCropRect(getInitialCropRect({ ...assignment, cropLeft: 0, cropTop: 0, cropWidth: 1, cropHeight: 1 }, asset, slot))}
          >
            Reset
          </button>
        </div>

        <div
          ref={stageRef}
          className="crop-editor-stage"
          style={{ width: `${stageSize.width}px`, height: `${stageSize.height}px` }}
          onPointerMove={onStagePointerMove}
          onPointerUp={clearDrag}
          onPointerCancel={clearDrag}
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
          <div className="crop-editor-stage__crop-box" style={cropBoxStyle} onPointerDown={startAction("move")}>
            {(["nw", "ne", "sw", "se"] as CropAction[]).map((handle) => (
              <span
                key={handle}
                className={`crop-editor-stage__handle crop-editor-stage__handle--${handle}`}
                onPointerDown={startAction(handle)}
              />
            ))}
          </div>
        </div>

        <div className="modal-card__actions">
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
