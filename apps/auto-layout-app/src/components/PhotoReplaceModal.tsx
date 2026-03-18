import { useDeferredValue, useMemo, useState } from "react";
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
  const [searchQuery, setSearchQuery] = useState("");
  const deferredAssets = useDeferredValue(assets);
  const currentUsage = useMemo(() => usageByAssetId.get(currentImageId ?? ""), [currentImageId, usageByAssetId]);
  const activeAssetSet = useMemo(() => new Set(activeAssetIds), [activeAssetIds]);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const matchesSearch = useMemo(
    () => (asset: ImageAsset) =>
      normalizedSearchQuery.length === 0 ||
      asset.fileName.toLowerCase().includes(normalizedSearchQuery),
    [normalizedSearchQuery]
  );
  const unusedAssets = useMemo(
    () => deferredAssets.filter((asset) => !usageByAssetId.has(asset.id) && matchesSearch(asset)),
    [deferredAssets, matchesSearch, usageByAssetId]
  );
  const usedAssets = useMemo(
    () => deferredAssets.filter((asset) => usageByAssetId.has(asset.id) && matchesSearch(asset)),
    [deferredAssets, matchesSearch, usageByAssetId]
  );

  function renderAssetCard(asset: ImageAsset) {
    const usage = usageByAssetId.get(asset.id);
    const isCurrent = currentImageId === asset.id;
    const isActive = activeAssetSet.has(asset.id);

    return (
      <button
        key={asset.id}
        type="button"
        data-preview-asset-id={asset.id}
        className={isCurrent ? "modal-photo-card modal-photo-card--active" : "modal-photo-card"}
        onClick={() => onChoose(asset.id)}
      >
        {asset.thumbnailUrl ?? asset.previewUrl ? (
          <img
            src={asset.thumbnailUrl ?? asset.previewUrl}
            alt={asset.fileName}
            className="modal-photo-card__image"
            loading="lazy"
          />
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
  }

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

        <div className="modal-toolbar">
          <label className="field modal-toolbar__search">
            <span>Cerca foto</span>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Cerca per nome file"
            />
          </label>
        </div>

        <div className="modal-panel__body modal-panel__body--scroll">
          <div className="modal-photo-sections">
            <section className="modal-photo-section">
              <div className="modal-photo-section__header">
                <strong>Foto non usate</strong>
                <span>{unusedAssets.length}</span>
              </div>
              {unusedAssets.length > 0 ? (
                <div className="modal-photo-grid">
                  {unusedAssets.map((asset) => renderAssetCard(asset))}
                </div>
              ) : (
                <p className="helper-copy">Non ci sono foto libere in questo momento.</p>
              )}
            </section>

            <section className="modal-photo-section">
              <div className="modal-photo-section__header">
                <strong>Foto gia usate</strong>
                <span>{usedAssets.length}</span>
              </div>
              {usedAssets.length > 0 ? (
                <div className="modal-photo-grid">
                  {usedAssets.map((asset) => renderAssetCard(asset))}
                </div>
              ) : (
                <p className="helper-copy">Nessuna foto e' gia stata usata in altri fogli.</p>
              )}
            </section>
          </div>
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
