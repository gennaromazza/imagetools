import { memo, type CSSProperties } from "react";
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
  emptyState?: "default" | "selected" | "drag-target";
}

function safePercent(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function ImageSlotPreviewComponent({
  asset,
  assignment,
  label,
  slot,
  sheetSpec,
  slotCount,
  showMeta = true,
  emptyState = "default"
}: ImageSlotPreviewProps) {
  const imageUrl = asset?.previewUrl ?? asset?.thumbnailUrl ?? asset?.sourceUrl;

  if (!asset || !assignment || !imageUrl) {
    const emptyTitle =
      emptyState === "drag-target" ? "Rilascia qui" : emptyState === "selected" ? "Slot vuoto" : "Aggiungi foto";
    const emptyHint =
      emptyState === "drag-target"
        ? "Aggiungi o sostituisci in questo riquadro."
        : emptyState === "selected"
          ? "Trascina una foto dalla libreria oppure fai doppio clic su una foto per usarla qui."
          : "Trascina qui una foto.";

    return (
      <div
        className={[
          "slot-empty",
          emptyState === "selected" ? "slot-empty--selected" : "",
          emptyState === "drag-target" ? "slot-empty--drag-target" : ""
        ].filter(Boolean).join(" ")}
      >
        <strong className="slot-empty__title">{emptyTitle}</strong>
        <span className="slot-empty__hint">{emptyHint}</span>
      </div>
    );
  }

  const rawAspect = Number(asset.aspectRatio);
  const imageAspect = Number.isFinite(rawAspect) && rawAspect > 0 ? rawAspect : 1;
  const slotAspect = slot ? getEffectiveSlotAspectRatio(slot, sheetSpec, slotCount) : imageAspect;
  const geometry = getAssignmentViewportGeometry(assignment, imageAspect, slotAspect);
  const rotation = Number.isFinite(assignment.rotation) ? assignment.rotation : 0;

  const frameStyle: CSSProperties = {
    width: `${safePercent(geometry.frameWidthPercent, 100)}%`,
    height: `${safePercent(geometry.frameHeightPercent, 100)}%`,
    left: `calc(50% + ${safePercent(geometry.offsetXPercent, 0)}%)`,
    top: `calc(50% + ${safePercent(geometry.offsetYPercent, 0)}%)`,
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`
  };

  const imageStyle: CSSProperties = {
    width: `${safePercent(geometry.imageWidthPercent, 100)}%`,
    height: `${safePercent(geometry.imageHeightPercent, 100)}%`,
    left: `${safePercent(geometry.imageLeftPercent, 0)}%`,
    top: `${safePercent(geometry.imageTopPercent, 0)}%`
  };

  return (
    <div className="slot-media">
      <div className="slot-media__viewport">
        <div className="slot-media__frame" style={frameStyle}>
          <img
            src={imageUrl}
            alt={asset.fileName || label || "Foto"}
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
