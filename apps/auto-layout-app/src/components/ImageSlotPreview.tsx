import type { ImageAsset, LayoutAssignment } from "@photo-tools/shared-types";

interface ImageSlotPreviewProps {
  asset?: ImageAsset;
  assignment?: LayoutAssignment;
  label: string;
}

export function ImageSlotPreview({ asset, assignment, label }: ImageSlotPreviewProps) {
  if (!asset || !assignment || !asset.previewUrl) {
    return <div className="slot-empty">Trascina qui una foto</div>;
  }

  const imageFit = assignment.fitMode === "fit" ? "contain" : "cover";

  return (
    <div className="slot-media">
      <img
        src={asset.previewUrl}
        alt={asset.fileName}
        draggable={false}
        style={{
          objectFit: imageFit,
          transform: `translate(${assignment.offsetX}%, ${assignment.offsetY}%) scale(${Math.max(0.4, assignment.zoom)}) rotate(${assignment.rotation}deg)`
        }}
      />
      <div className="slot-media__meta">
        <span>{label}</span>
        <small>{assignment.fitMode}</small>
      </div>
    </div>
  );
}
