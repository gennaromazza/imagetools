import { useState } from "react";
import type { ImageAsset } from "@photo-tools/shared-types";

type AssetFilter = "all" | "unused" | "used";

interface AssetUsage {
  pageId: string;
  pageNumber: number;
  slotId: string;
}

interface AssetWorkbenchProps {
  assets: ImageAsset[];
  usageByAssetId: Map<string, AssetUsage>;
  dragImageId: string | null;
  onDragAssetStart: (imageId: string) => void;
  onDragEnd: () => void;
  onDropToUnused: () => void;
}

function matchesFilter(filter: AssetFilter, used: boolean): boolean {
  if (filter === "unused") {
    return !used;
  }

  if (filter === "used") {
    return used;
  }

  return true;
}

export function AssetWorkbench({
  assets,
  usageByAssetId,
  dragImageId,
  onDragAssetStart,
  onDragEnd,
  onDropToUnused
}: AssetWorkbenchProps) {
  const [filter, setFilter] = useState<AssetFilter>("all");

  const visibleAssets = assets.filter((asset) => matchesFilter(filter, usageByAssetId.has(asset.id)));
  const usedCount = usageByAssetId.size;
  const unusedCount = assets.length - usedCount;

  return (
    <div className="stack">
      <div className="asset-toolbar">
        <div className="segmented-control">
          {([
            ["all", "Tutte"],
            ["unused", "Non usate"],
            ["used", "Gia' nei fogli"]
          ] as [AssetFilter, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filter === value ? "segment segment--active" : "segment"}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="helper-inline">{usedCount} usate · {unusedCount} libere</span>
      </div>

      <div
        className={dragImageId ? "unused-dropzone unused-dropzone--active" : "unused-dropzone"}
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => onDropToUnused()}
      >
        Rilascia qui per togliere una foto dal foglio e riportarla tra le non usate
      </div>

      <div className="asset-grid">
        {visibleAssets.map((asset) => {
          const usage = usageByAssetId.get(asset.id);
          const isActive = dragImageId === asset.id;

          return (
            <button
              key={asset.id}
              type="button"
              draggable
              className={isActive ? "asset-card asset-card--dragging" : "asset-card"}
              onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", asset.id);
                onDragAssetStart(asset.id);
              }}
              onDragEnd={onDragEnd}
            >
              {asset.previewUrl ? (
                <img src={asset.previewUrl} alt={asset.fileName} className="asset-card__image" />
              ) : (
                <div className="asset-card__placeholder">{asset.fileName}</div>
              )}
              <div className="asset-card__meta">
                <strong>{asset.fileName}</strong>
                <span>{usage ? `Foglio ${usage.pageNumber}` : "Non assegnata"}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
