import { memo } from "react";
import type { ImageAsset, LayoutAssignment, LayoutSlot } from "@photo-tools/shared-types";

interface ImageSlotPreviewProps {
  asset?: ImageAsset;
  assignment?: LayoutAssignment;
  label: string;
  slot?: LayoutSlot;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function ImageSlotPreviewComponent({ asset, assignment, label, slot }: ImageSlotPreviewProps) {
  if (!asset || !assignment || !asset.previewUrl) {
    return <div className="slot-empty">Trascina qui una foto</div>;
  }

  const imageAspect = asset.aspectRatio > 0 ? asset.aspectRatio : 1;
  const slotAspect = slot && slot.height > 0 ? slot.width / slot.height : imageAspect;
  const cropLeft = clamp(assignment.cropLeft ?? 0, 0, 1);
  const cropTop = clamp(assignment.cropTop ?? 0, 0, 1);
  const cropWidth = clamp(assignment.cropWidth ?? 1, 0.05, 1);
  const cropHeight = clamp(assignment.cropHeight ?? 1, 0.05, 1);

  const cropAspect = (imageAspect * cropWidth) / Math.max(cropHeight, 0.001);
  const fitMode = assignment.fitMode;

  let frameWidth = 100;
  let frameHeight = 100;

  if (fitMode === "fit") {
    if (cropAspect > slotAspect) {
      frameHeight = (slotAspect / cropAspect) * 100;
    } else {
      frameWidth = (cropAspect / slotAspect) * 100;
    }
  } else {
    if (cropAspect > slotAspect) {
      frameWidth = (cropAspect / slotAspect) * 100;
    } else {
      frameHeight = (slotAspect / cropAspect) * 100;
    }
  }

  frameWidth *= Math.max(0.4, assignment.zoom);
  frameHeight *= Math.max(0.4, assignment.zoom);

  const overflowX = Math.max(0, frameWidth - 100);
  const overflowY = Math.max(0, frameHeight - 100);
  const offsetXPercent = (assignment.offsetX / 100) * (overflowX / 2);
  const offsetYPercent = (assignment.offsetY / 100) * (overflowY / 2);

  const frameStyle = {
    width: `${frameWidth}%`,
    height: `${frameHeight}%`,
    left: `calc(50% + ${offsetXPercent}%)`,
    top: `calc(50% + ${offsetYPercent}%)`,
    transform: `translate(-50%, -50%) rotate(${assignment.rotation}deg)`
  };

  const imageStyle = {
    width: `${100 / cropWidth}%`,
    height: `${100 / cropHeight}%`,
    left: `${(-cropLeft / cropWidth) * 100}%`,
    top: `${(-cropTop / cropHeight) * 100}%`
  };

  return (
    <div className="slot-media">
      <div className="slot-media__viewport">
        <div className="slot-media__frame" style={frameStyle}>
          <img
            src={asset.previewUrl}
            alt={asset.fileName}
            loading="lazy"
            draggable={false}
            className="slot-media__image"
            style={imageStyle}
          />
        </div>
      </div>
      <div className="slot-media__meta">
        <span>{label}</span>
        <small>{assignment.fitMode}</small>
      </div>
    </div>
  );
}

export const ImageSlotPreview = memo(ImageSlotPreviewComponent);
