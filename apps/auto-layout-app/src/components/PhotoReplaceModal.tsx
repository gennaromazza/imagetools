import { useDeferredValue, useMemo } from "react";
import type { ImageAsset } from "@photo-tools/shared-types";

interface AssetUsage {
  pageId: string;
  pageNumber: number;
  slotId: string;
}

interface PhotoReplaceModalProps {
  assets: ImageAsset[];
  activeAssetIds: string[];
  usageByAssetId: Map<string, AssetUsage>;
  currentImageId?: string;
  title: string;
  onChoose: (imageId: string) => void;
  onClose: () => void;
}

export function PhotoReplaceModal({
  assets,
  activeAssetIds,
  usageByAssetId,
  currentImageId,
  title,
  onChoose,
  onClose
}: PhotoReplaceModalProps) {
  const deferredAssets = useDeferredValue(assets);
  const currentUsage = useMemo(() => usageByAssetId.get(currentImageId ?? ""), [currentImageId, usageByAssetId]);
  const activeAssetSet = useMemo(() => new Set(activeAssetIds), [activeAssetIds]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel modal-panel--wide" onClick={(event) => event.stopPropagation()}>
        <div className="modal-panel__header">
          <div>
            <strong>{title}</strong>
            <p>
              Scegli una foto dal catalogo caricato. Se la foto non e' ancora attiva nel progetto verra'
              aggiunta automaticamente, e se e' gia' usata in un altro foglio verra' spostata nello slot selezionato.
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Chiudi
          </button>
        </div>

        <div className="modal-status">
          <span>{deferredAssets.length} foto nel catalogo</span>
          <span>{activeAssetIds.length} attive nel progetto</span>
          {currentUsage ? <span>Foto corrente: foglio {currentUsage.pageNumber}, slot {currentUsage.slotId}</span> : null}
        </div>

        <div className="modal-photo-grid">
          {deferredAssets.map((asset) => {
            const usage = usageByAssetId.get(asset.id);
            const isCurrent = currentImageId === asset.id;
            const isActive = activeAssetSet.has(asset.id);

            return (
              <button
                key={asset.id}
                type="button"
                className={isCurrent ? "modal-photo-card modal-photo-card--active" : "modal-photo-card"}
                onClick={() => onChoose(asset.id)}
              >
                {asset.previewUrl ? (
                  <img src={asset.previewUrl} alt={asset.fileName} className="modal-photo-card__image" />
                ) : (
                  <div className="modal-photo-card__placeholder">{asset.fileName}</div>
                )}
                <div className="modal-photo-card__meta">
                  <strong>{asset.fileName}</strong>
                  <span>
                    {usage
                      ? `Usata nel foglio ${usage.pageNumber}`
                      : isActive
                        ? "Disponibile nel progetto"
                        : "Solo nel catalogo caricato"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="modal-panel__footer">
          <button type="button" className="ghost-button" onClick={onClose}>
            Annulla
          </button>
        </div>
      </div>
    </div>
  );
}
