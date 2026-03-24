import { memo } from "react";
import type { GeneratedPageLayout, ImageAsset, LayoutAssignment, LayoutSlot } from "@photo-tools/shared-types";
import { getAssignmentViewportGeometry } from "../utils/assignment-rendering";
import { getEffectiveSlotAspectRatio } from "../utils/slot-geometry";

interface ImageSlotPreviewProps {
  asset?: ImageAsset;
  assignment?: LayoutAssignment;
  label: string;
  slot?: LayoutSlot;
  sheetSpec?: GeneratedPageLayout["sheetSpec"];
  slotCount?: number;
  showMeta?: boolean;
}

function ImageSlotPreviewComponent({ asset, assignment, label, slot, sheetSpec, slotCount, showMeta = true }: ImageSlotPreviewProps) {
  const imageUrl = asset?.previewUrl ?? asset?.thumbnailUrl ?? asset?.sourceUrl;

  if (!asset || !assignment || !imageUrl) {
    return <div className="slot-empty">Trascina qui una foto</div>;
  }

  const imageAspect = asset.aspectRatio > 0 ? asset.aspectRatio : 1;
  const slotAspect = slot ? getEffectiveSlotAspectRatio(slot, sheetSpec, slotCount) : imageAspect;
  const geometry = getAssignmentViewportGeometry(assignment, imageAspect, slotAspect);

  const frameStyle = {
    width: `${geometry.frameWidthPercent}%`,
    height: `${geometry.frameHeightPercent}%`,
    left: `calc(50% + ${geometry.offsetXPercent}%)`,
    top: `calc(50% + ${geometry.offsetYPercent}%)`,
    transform: `translate(-50%, -50%) rotate(${assignment.rotation}deg)`
  };

  const imageStyle = {
    width: `${geometry.imageWidthPercent}%`,
    height: `${geometry.imageHeightPercent}%`,
    left: `${geometry.imageLeftPercent}%`,
    top: `${geometry.imageTopPercent}%`
  };

  return (
    <div className="slot-media">
      <div className="slot-media__viewport">
        <div className="slot-media__frame" style={frameStyle}>
          <img
            src={imageUrl}
            alt={asset.fileName}
            loading="lazy"
            draggable={false}
            className="slot-media__image"
            style={imageStyle}
          />
        </div>
      </div>
      {showMeta ? (
        <div className="slot-media__meta">
          <span>{label}</span>
          <small>{assignment.fitMode}</small>
        </div>
      ) : null}
    </div>
  );
}

export const ImageSlotPreview = memo(ImageSlotPreviewComponent);
