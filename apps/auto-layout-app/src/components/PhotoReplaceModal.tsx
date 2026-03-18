import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { ColorLabel, ImageAsset, PickStatus } from "@photo-tools/shared-types";
import { PhotoQuickPreviewModal } from "./PhotoQuickPreviewModal";
import {
  COLOR_LABEL_NAMES,
  COLOR_LABELS,
  formatAssetStars,
  getAssetColorLabel,
  getAssetPickStatus,
  getAssetRating,
  PICK_STATUS_LABELS
} from "../photo-classification";

interface AssetUsage {
  pageId: string;
  pageNumber: number;
  slotId: string;
}

type PickFilter = "all" | PickStatus;
type UsageFilter = "all" | "used" | "unused";
type ColorFilter = "all" | ColorLabel;
type SortMode = "name" | "rating" | "usage";

interface PhotoReplaceModalProps {
  assets: ImageAsset[];
  activeAssetIds: string[];
  usageByAssetId: Map<string, AssetUsage>;
  currentImageId?: string;
  title: string;
  onChoose: (imageId: string) => void;
  onClose: () => void;
  onAssetsMetadataChange?: (
    changesById: Map<string, Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">>>
  ) => void;
}

export function PhotoReplaceModal({
  assets,
  activeAssetIds,
  usageByAssetId,
  currentImageId,
  title,
  onChoose,
  onClose,
  onAssetsMetadataChange
}: PhotoReplaceModalProps) {
  const [localAssets, setLocalAssets] = useState<ImageAsset[]>(assets);
  const [searchQuery, setSearchQuery] = useState("");
  const [pickFilter, setPickFilter] = useState<PickFilter>("all");
  const [usageFilter, setUsageFilter] = useState<UsageFilter>("all");
  const [colorFilter, setColorFilter] = useState<ColorFilter>("all");
  const [minimumRating, setMinimumRating] = useState(0);
  const [sortBy, setSortBy] = useState<SortMode>("usage");
  const [focusedAssetId, setFocusedAssetId] = useState<string | null>(currentImageId ?? assets[0]?.id ?? null);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const deferredAssets = useDeferredValue(localAssets);
  const activeAssetSet = useMemo(() => new Set(activeAssetIds), [activeAssetIds]);

  useEffect(() => {
    setLocalAssets(assets);
    setFocusedAssetId((current) => current ?? currentImageId ?? assets[0]?.id ?? null);
  }, [assets, currentImageId]);

  const currentUsage = useMemo(() => usageByAssetId.get(currentImageId ?? ""), [currentImageId, usageByAssetId]);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  function updateAsset(imageId: string, changes: Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">>) {
    setLocalAssets((current) =>
      current.map((asset) => (asset.id === imageId ? { ...asset, ...changes } : asset))
    );
    onAssetsMetadataChange?.(new Map([[imageId, changes]]));
  }

  const visibleAssets = useMemo(() => {
    const filtered = deferredAssets.filter((asset) => {
      const usage = usageByAssetId.has(asset.id);
      const matchesSearch =
        normalizedSearchQuery.length === 0 ||
        asset.fileName.toLowerCase().includes(normalizedSearchQuery);

      if (!matchesSearch) {
        return false;
      }

      if (pickFilter !== "all" && getAssetPickStatus(asset) !== pickFilter) {
        return false;
      }

      if (usageFilter === "used" && !usage) {
        return false;
      }

      if (usageFilter === "unused" && usage) {
        return false;
      }

      if (colorFilter !== "all" && getAssetColorLabel(asset) !== colorFilter) {
        return false;
      }

      if (getAssetRating(asset) < minimumRating) {
        return false;
      }

      return true;
    });

    filtered.sort((left, right) => {
      if (sortBy === "rating") {
        return getAssetRating(right) - getAssetRating(left) || left.fileName.localeCompare(right.fileName);
      }

      if (sortBy === "usage") {
        const leftUsed = usageByAssetId.has(left.id) ? 1 : 0;
        const rightUsed = usageByAssetId.has(right.id) ? 1 : 0;
        return rightUsed - leftUsed || left.fileName.localeCompare(right.fileName);
      }

      return left.fileName.localeCompare(right.fileName);
    });

    return filtered;
  }, [colorFilter, deferredAssets, minimumRating, normalizedSearchQuery, pickFilter, sortBy, usageByAssetId, usageFilter]);

  const focusedAsset =
    (focusedAssetId ? localAssets.find((asset) => asset.id === focusedAssetId) : null) ??
    visibleAssets[0] ??
    null;
  const previewAsset = previewAssetId ? localAssets.find((asset) => asset.id === previewAssetId) ?? null : null;

  return (
    <>
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-panel modal-panel--wide" onClick={(event) => event.stopPropagation()}>
          <div className="modal-panel__header">
            <div>
              <strong>{title}</strong>
              <p>
                Rivedi il catalogo, filtra per stelle o colori e scegli la foto da usare nello slot selezionato.
              </p>
            </div>
            <button type="button" className="ghost-button" onClick={onClose}>
              Chiudi
            </button>
          </div>

          <div className="modal-status modal-status--selector">
            <span>{deferredAssets.length} foto nel catalogo</span>
            <span>{visibleAssets.length} visibili con i filtri</span>
            <span>{activeAssetIds.length} attive nel progetto</span>
            {currentUsage ? <span>Foto corrente: foglio {currentUsage.pageNumber}, slot {currentUsage.slotId}</span> : null}
          </div>

          <div className="modal-toolbar modal-toolbar--selector">
            <label className="field modal-toolbar__search">
              <span>Cerca foto</span>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Cerca per nome file"
              />
            </label>

            <div className="modal-toolbar__quick modal-toolbar__quick--selector">
              <label className="field">
                <span>Ordina</span>
                <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortMode)}>
                  <option value="usage">Prima gia usate</option>
                  <option value="rating">Prima le migliori</option>
                  <option value="name">Nome file</option>
                </select>
              </label>
            </div>
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

          <p className="selector-shortcuts">
            Spazio apre l’anteprima. Tasti rapidi: `1-5` stelle, `P/X/U` stato, `6` rosso, `7` giallo, `8` verde, `9` blu, `V` viola.
          </p>

          <div className="modal-photo-grid modal-photo-grid--selector">
            {visibleAssets.map((asset) => {
              const previewUrl = asset.thumbnailUrl ?? asset.previewUrl ?? asset.sourceUrl;
              const usage = usageByAssetId.get(asset.id);
              const pickStatus = getAssetPickStatus(asset);
              const rating = getAssetRating(asset);
              const colorLabel = getAssetColorLabel(asset);
              const isFocused = focusedAsset?.id === asset.id;
              const isCurrent = currentImageId === asset.id;
              const isActive = activeAssetSet.has(asset.id);

              return (
                <button
                  key={asset.id}
                  type="button"
                  className={[
                    "modal-photo-card",
                    isFocused ? "modal-photo-card--active" : "",
                    isCurrent ? "modal-photo-card--current" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setFocusedAssetId(asset.id)}
                  onDoubleClick={() => onChoose(asset.id)}
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
                      <span className={`asset-pick-badge asset-pick-badge--${pickStatus}`}>
                        {PICK_STATUS_LABELS[pickStatus]}
                      </span>
                      {colorLabel ? (
                        <span
                          className={`asset-color-dot asset-color-dot--${colorLabel} asset-color-dot--selected`}
                          title={COLOR_LABEL_NAMES[colorLabel]}
                        />
                      ) : null}
                    </div>

                    {rating > 0 ? <span className="modal-photo-card__stars">{formatAssetStars(asset)}</span> : null}
                  </div>

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
                          title={`${value} stelle`}
                        >
                          ★
                        </button>
                      ))}
                    </div>

                    <div className="modal-photo-card__tiny-actions">
                      {(["picked", "rejected", "unmarked"] as PickStatus[]).map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={pickStatus === value ? "quick-preview__pill quick-preview__pill--active" : "quick-preview__pill"}
                          onClick={(event) => {
                            event.stopPropagation();
                            updateAsset(asset.id, { pickStatus: value });
                          }}
                          title={PICK_STATUS_LABELS[value]}
                        >
                          {PICK_STATUS_LABELS[value]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="modal-photo-card__footer">
                    <div className="modal-photo-card__color-actions">
                      {COLOR_LABELS.map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={
                            colorLabel === value
                              ? `quick-preview__color-chip quick-preview__color-chip--${value} quick-preview__color-chip--selected`
                              : `quick-preview__color-chip quick-preview__color-chip--${value}`
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            updateAsset(asset.id, { colorLabel: value });
                          }}
                          title={COLOR_LABEL_NAMES[value]}
                        />
                      ))}
                      <button
                        type="button"
                        className="quick-preview__color-chip quick-preview__color-chip--clear"
                        onClick={(event) => {
                          event.stopPropagation();
                          updateAsset(asset.id, { colorLabel: null });
                        }}
                        title="Rimuovi etichetta colore"
                      >
                        ×
                      </button>
                    </div>

                    <div className="modal-photo-card__tiny-actions">
                      <button
                        type="button"
                        className="ghost-button quick-preview__tiny-action"
                        onClick={(event) => {
                          event.stopPropagation();
                          setPreviewAssetId(asset.id);
                        }}
                      >
                        Preview
                      </button>
                      <button
                        type="button"
                        className="secondary-button quick-preview__tiny-action"
                        onClick={(event) => {
                          event.stopPropagation();
                          onChoose(asset.id);
                        }}
                      >
                        Usa foto
                      </button>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="modal-panel__footer">
            <div className="helper-copy">
              {focusedAsset ? `Foto attiva: ${focusedAsset.fileName}` : "Nessuna foto selezionata"}
            </div>
            <div className="button-row">
              <button type="button" className="ghost-button" onClick={onClose}>
                Annulla
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => focusedAsset && onChoose(focusedAsset.id)}
                disabled={!focusedAsset}
              >
                Usa la foto selezionata
              </button>
            </div>
          </div>
        </div>
      </div>

      {previewAsset ? (
        <PhotoQuickPreviewModal
          asset={previewAsset}
          assets={visibleAssets}
          usageByAssetId={usageByAssetId}
          onClose={() => setPreviewAssetId(null)}
          onSelectAsset={(assetId) => setPreviewAssetId(assetId)}
          onUpdateAsset={(assetId, changes) => updateAsset(assetId, changes)}
        />
      ) : null}
    </>
  );
}
