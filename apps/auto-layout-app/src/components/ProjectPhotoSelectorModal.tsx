import { useDeferredValue, useMemo, useState } from "react";
import type { ColorLabel, ImageAsset, PickStatus } from "@photo-tools/shared-types";
import { PhotoQuickPreviewModal } from "./PhotoQuickPreviewModal";
import { COLOR_LABEL_NAMES, COLOR_LABELS, formatAssetStars, getAssetPickStatus, getAssetRating, PICK_STATUS_LABELS } from "../photo-classification";

interface UsageInfo {
  pageNumber: number;
  pageId?: string;
  slotId?: string;
}

interface ProjectPhotoSelectorModalProps {
  assets: ImageAsset[];
  activeAssetIds: string[];
  usageByAssetId: Map<string, UsageInfo>;
  onClose: () => void;
  onApply: (nextIds: string[], nextAssets: ImageAsset[]) => void;
}

type SortMode = "name" | "orientation" | "rating";
type PickFilter = "all" | PickStatus;
type UsageFilter = "all" | "used" | "unused";
type ColorFilter = "all" | ColorLabel;

export function ProjectPhotoSelectorModal({
  assets,
  activeAssetIds,
  usageByAssetId,
  onClose,
  onApply
}: ProjectPhotoSelectorModalProps) {
  const [localAssets, setLocalAssets] = useState<ImageAsset[]>(assets);
  const [localSelection, setLocalSelection] = useState<string[]>(activeAssetIds);
  const [quickSelectCount, setQuickSelectCount] = useState<number>(Math.min(activeAssetIds.length || assets.length, assets.length));
  const [sortBy, setSortBy] = useState<SortMode>("name");
  const [pickFilter, setPickFilter] = useState<PickFilter>("all");
  const [usageFilter, setUsageFilter] = useState<UsageFilter>("all");
  const [colorFilter, setColorFilter] = useState<ColorFilter>("all");
  const [minimumRating, setMinimumRating] = useState<number>(0);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const deferredAssets = useDeferredValue(localAssets);
  const selectionSet = useMemo(() => new Set(localSelection), [localSelection]);

  const visibleAssets = useMemo(() => {
    const filtered = deferredAssets.filter((asset) => {
      const assetPickStatus = getAssetPickStatus(asset);
      const assetRating = getAssetRating(asset);
      const assetUsage = usageByAssetId.has(asset.id);

      if (pickFilter !== "all" && assetPickStatus !== pickFilter) {
        return false;
      }

      if (usageFilter === "used" && !assetUsage) {
        return false;
      }

      if (usageFilter === "unused" && assetUsage) {
        return false;
      }

      if (colorFilter !== "all" && asset.colorLabel !== colorFilter) {
        return false;
      }

      if (assetRating < minimumRating) {
        return false;
      }

      return true;
    });

    filtered.sort((left, right) => {
      if (sortBy === "rating") {
        return getAssetRating(right) - getAssetRating(left) || left.fileName.localeCompare(right.fileName);
      }

      if (sortBy === "orientation") {
        return left.orientation.localeCompare(right.orientation) || left.fileName.localeCompare(right.fileName);
      }

      return left.fileName.localeCompare(right.fileName);
    });

    return filtered;
  }, [colorFilter, deferredAssets, minimumRating, pickFilter, sortBy, usageByAssetId, usageFilter]);

  const previewAsset = previewAssetId ? localAssets.find((asset) => asset.id === previewAssetId) ?? null : null;

  function toggleAsset(imageId: string) {
    setLocalSelection((current) =>
      current.includes(imageId) ? current.filter((id) => id !== imageId) : [...current, imageId]
    );
  }

  function applyQuickSelection() {
    const nextIds = deferredAssets
      .slice(0, Math.max(0, Math.min(quickSelectCount, deferredAssets.length)))
      .map((asset) => asset.id);
    setLocalSelection(nextIds);
  }

  function updateAsset(imageId: string, changes: Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">>) {
    setLocalAssets((current) =>
      current.map((asset) => (asset.id === imageId ? { ...asset, ...changes } : asset))
    );
  }

  function selectVisibleAssets() {
    setLocalSelection(visibleAssets.map((asset) => asset.id));
  }

  function activatePickedAssets() {
    setLocalSelection(localAssets.filter((asset) => getAssetPickStatus(asset) === "picked").map((asset) => asset.id));
  }

  function excludeRejectedAssets() {
    setLocalSelection(localAssets.filter((asset) => getAssetPickStatus(asset) !== "rejected").map((asset) => asset.id));
  }

  return (
    <>
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-panel modal-panel--wide" onClick={(event) => event.stopPropagation()}>
          <div className="modal-panel__header">
            <div>
              <strong>Selezione foto del progetto</strong>
              <p>
                Rivedi le foto a pieno schermo, assegna stelle e colori, poi decidi quali entrano davvero nel layout.
              </p>
            </div>
            <button type="button" className="ghost-button" onClick={onClose}>
              Chiudi
            </button>
          </div>

          <div className="modal-toolbar modal-toolbar--selector">
            <div className="button-row">
              <button type="button" className="ghost-button" onClick={() => setLocalSelection(deferredAssets.map((asset) => asset.id))}>
                Seleziona tutte
              </button>
              <button type="button" className="ghost-button" onClick={selectVisibleAssets}>
                Attiva filtrate
              </button>
              <button type="button" className="ghost-button" onClick={activatePickedAssets}>
                Solo pick
              </button>
              <button type="button" className="ghost-button" onClick={excludeRejectedAssets}>
                Escludi scartate
              </button>
              <button type="button" className="ghost-button" onClick={() => setLocalSelection([])}>
                Svuota selezione
              </button>
            </div>

            <div className="modal-toolbar__quick modal-toolbar__quick--selector">
              <label className="field">
                <span>Ordina</span>
                <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortMode)}>
                  <option value="name">Nome</option>
                  <option value="orientation">Orientamento</option>
                  <option value="rating">Stelle</option>
                </select>
              </label>
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

          <div className="modal-status modal-status--selector">
            <span>{deferredAssets.length} foto nel catalogo</span>
            <span>{localSelection.length} attive per il layout</span>
            <span>{visibleAssets.length} visibili con i filtri</span>
          </div>

          <div className="selector-filters">
            <label className="field">
              <span>Stato</span>
              <select value={pickFilter} onChange={(event) => setPickFilter(event.target.value as PickFilter)}>
                <option value="all">Tutti</option>
                <option value="picked">Pick</option>
                <option value="rejected">Scartate</option>
                <option value="unmarked">Neutre</option>
              </select>
            </label>

            <label className="field">
              <span>Uso nel layout</span>
              <select value={usageFilter} onChange={(event) => setUsageFilter(event.target.value as UsageFilter)}>
                <option value="all">Tutte</option>
                <option value="used">Gia usate</option>
                <option value="unused">Ancora libere</option>
              </select>
            </label>

            <label className="field">
              <span>Colore</span>
              <select value={colorFilter} onChange={(event) => setColorFilter(event.target.value as ColorFilter)}>
                <option value="all">Tutti</option>
                {COLOR_LABELS.map((value) => (
                  <option key={value} value={value}>
                    {COLOR_LABEL_NAMES[value]}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Minimo stelle</span>
              <select value={minimumRating} onChange={(event) => setMinimumRating(Number(event.target.value))}>
                {[0, 1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>
                    {value === 0 ? "Nessun minimo" : `${value}+`}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="modal-photo-grid modal-photo-grid--selector">
            {visibleAssets.map((asset) => {
              const isSelected = selectionSet.has(asset.id);
              const previewUrl = asset.thumbnailUrl ?? asset.previewUrl ?? asset.sourceUrl;
              const usage = usageByAssetId.get(asset.id);
              const pickStatus = getAssetPickStatus(asset);
              const rating = getAssetRating(asset);

              return (
                <button
                  key={asset.id}
                  type="button"
                  data-preview-asset-id={asset.id}
                  className={isSelected ? "modal-photo-card modal-photo-card--active" : "modal-photo-card"}
                  onClick={() => toggleAsset(asset.id)}
                  onDoubleClick={() => setPreviewAssetId(asset.id)}
                  onKeyDown={(event) => {
                    if (event.key === " ") {
                      event.preventDefault();
                      setPreviewAssetId(asset.id);
                    }
                  }}
                >
                  <div className="modal-photo-card__image-shell">
                    {previewUrl ? (
                      <img src={previewUrl} alt={asset.fileName} className="modal-photo-card__image" loading="lazy" />
                    ) : (
                      <div className="modal-photo-card__placeholder">{asset.fileName}</div>
                    )}

                    <div className="modal-photo-card__top-badges">
                      <span className={`asset-pick-badge asset-pick-badge--${pickStatus}`}>{PICK_STATUS_LABELS[pickStatus]}</span>
                      {asset.colorLabel ? (
                        <span className={`asset-color-dot asset-color-dot--${asset.colorLabel}`} title={COLOR_LABEL_NAMES[asset.colorLabel]} />
                      ) : null}
                    </div>

                    {rating > 0 ? <div className="modal-photo-card__stars">{formatAssetStars(asset)}</div> : null}
                  </div>

                  <div className="modal-photo-card__meta">
                    <strong>{asset.fileName}</strong>
                    <span>{usage ? `Usata nel foglio ${usage.pageNumber}` : "Non ancora usata nel layout"}</span>
                    <span>{isSelected ? "Attiva per il layout" : "Esclusa dal layout"}</span>
                  </div>

                  <div className="modal-photo-card__footer">
                    <div className="modal-photo-card__tiny-actions">
                      {[1, 2, 3, 4, 5].map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={value <= rating ? "modal-photo-card__tiny-star modal-photo-card__tiny-star--active" : "modal-photo-card__tiny-star"}
                          onClick={(event) => {
                            event.stopPropagation();
                            updateAsset(asset.id, { rating: value });
                          }}
                        >
                          ★
                        </button>
                      ))}
                    </div>

                    <div className="modal-photo-card__color-actions">
                      {COLOR_LABELS.map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={
                            asset.colorLabel === value
                              ? `asset-color-dot asset-color-dot--${value} asset-color-dot--selected`
                              : `asset-color-dot asset-color-dot--${value}`
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            updateAsset(asset.id, { colorLabel: asset.colorLabel === value ? null : value });
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="modal-panel__footer">
            <p className="selector-shortcuts">
              `Spazio` anteprima · `1-5` stelle · `P/X/U` stato · `6-9` colori · doppio click fullscreen
            </p>
            <div className="button-row">
              <button type="button" className="ghost-button" onClick={onClose}>
                Annulla
              </button>
              <button type="button" className="primary-button" onClick={() => onApply(localSelection, localAssets)}>
                Usa {localSelection.length} foto nel progetto
              </button>
            </div>
          </div>
        </div>
      </div>

      <PhotoQuickPreviewModal
        asset={previewAsset}
        assets={visibleAssets}
        usageByAssetId={usageByAssetId}
        onClose={() => setPreviewAssetId(null)}
        onSelectAsset={setPreviewAssetId}
        onUpdateAsset={updateAsset}
      />
    </>
  );
}
