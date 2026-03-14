import { useDeferredValue, useMemo, useState } from "react";
import type { ImageAsset } from "@photo-tools/shared-types";

interface ProjectPhotoSelectorModalProps {
  assets: ImageAsset[];
  activeAssetIds: string[];
  onClose: () => void;
  onApply: (nextIds: string[]) => void;
}

export function ProjectPhotoSelectorModal({
  assets,
  activeAssetIds,
  onClose,
  onApply
}: ProjectPhotoSelectorModalProps) {
  const [localSelection, setLocalSelection] = useState<string[]>(activeAssetIds);
  const [quickSelectCount, setQuickSelectCount] = useState<number>(Math.min(activeAssetIds.length || assets.length, assets.length));
  const deferredAssets = useDeferredValue(assets);
  const selectionSet = useMemo(() => new Set(localSelection), [localSelection]);

  function toggleAsset(imageId: string) {
    setLocalSelection((current) =>
      current.includes(imageId)
        ? current.filter((id) => id !== imageId)
        : [...current, imageId]
    );
  }

  function applyQuickSelection() {
    const nextIds = deferredAssets.slice(0, Math.max(0, Math.min(quickSelectCount, deferredAssets.length))).map((asset) => asset.id);
    setLocalSelection(nextIds);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel modal-panel--wide" onClick={(event) => event.stopPropagation()}>
        <div className="modal-panel__header">
          <div>
            <strong>Selezione foto del progetto</strong>
            <p>
              Carica piu immagini e decidi quali entrano davvero nel piano layout. Quelle non attive
              restano fuori dai fogli ma rimangono disponibili come scelta.
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Chiudi
          </button>
        </div>

        <div className="modal-toolbar">
          <div className="button-row">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setLocalSelection(deferredAssets.map((asset) => asset.id))}
            >
              Seleziona tutte
            </button>
            <button type="button" className="ghost-button" onClick={() => setLocalSelection([])}>
              Svuota selezione
            </button>
          </div>

          <div className="modal-toolbar__quick">
            <label className="field">
              <span>Usa le prime N foto</span>
              <input
                type="number"
                min="0"
                max={deferredAssets.length}
                value={quickSelectCount}
                onChange={(event) => setQuickSelectCount(Number(event.target.value))}
              />
            </label>
            <button type="button" className="secondary-button" onClick={applyQuickSelection}>
              Applica
            </button>
          </div>
        </div>

        <div className="modal-status">
          <span>{deferredAssets.length} foto caricate</span>
          <span>{localSelection.length} foto attive per il layout</span>
          <span>{deferredAssets.length - localSelection.length} restano come scelta</span>
        </div>

        <div className="modal-photo-grid">
          {deferredAssets.map((asset) => {
            const isSelected = selectionSet.has(asset.id);

            return (
              <button
                key={asset.id}
                type="button"
                className={isSelected ? "modal-photo-card modal-photo-card--active" : "modal-photo-card"}
                onClick={() => toggleAsset(asset.id)}
              >
                {asset.previewUrl ? (
                  <img src={asset.previewUrl} alt={asset.fileName} className="modal-photo-card__image" />
                ) : (
                  <div className="modal-photo-card__placeholder">{asset.fileName}</div>
                )}
                <div className="modal-photo-card__meta">
                  <strong>{asset.fileName}</strong>
                  <span>{isSelected ? "Inclusa nel progetto" : "Solo nel catalogo caricato"}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="modal-panel__footer">
          <button type="button" className="ghost-button" onClick={onClose}>
            Annulla
          </button>
          <button type="button" className="primary-button" onClick={() => onApply(localSelection)}>
            Usa {localSelection.length} foto nel progetto
          </button>
        </div>
      </div>
    </div>
  );
}
