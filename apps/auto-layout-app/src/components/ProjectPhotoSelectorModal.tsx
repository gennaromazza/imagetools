import { createPortal } from "react-dom";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { ColorLabel, ImageAsset, PickStatus } from "@photo-tools/shared-types";
import { preloadImageUrls } from "../image-cache";
import { PhotoClassificationHelpButton } from "./PhotoClassificationHelpButton";
import { PhotoColorContextMenu } from "./PhotoColorContextMenu";
import { PhotoQuickPreviewModal } from "./PhotoQuickPreviewModal";
import {
  COLOR_LABEL_NAMES,
  COLOR_LABELS,
  DEFAULT_PHOTO_FILTERS,
  formatAssetStars,
  getAssetColorLabel,
  getAssetPickStatus,
  getAssetRating,
  getColorShortcutHint,
  matchesPhotoFilters,
  PICK_STATUS_LABELS,
  resolvePhotoClassificationShortcut
} from "../photo-classification";

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
  const [quickSelectCount, setQuickSelectCount] = useState<number>(
    Math.min(activeAssetIds.length || assets.length, assets.length)
  );
  const [sortBy, setSortBy] = useState<SortMode>("name");
  const [pickFilter, setPickFilter] = useState<PickFilter>(DEFAULT_PHOTO_FILTERS.pickStatus);
  const [usageFilter, setUsageFilter] = useState<UsageFilter>("all");
  const [colorFilter, setColorFilter] = useState<ColorFilter>(DEFAULT_PHOTO_FILTERS.colorLabel);
  const [ratingFilter, setRatingFilter] = useState(DEFAULT_PHOTO_FILTERS.ratingFilter);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const [contextMenuState, setContextMenuState] = useState<{
    assetId: string;
    x: number;
    y: number;
  } | null>(null);
  const [focusedAssetId, setFocusedAssetId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const deferredAssets = useDeferredValue(localAssets);
  const selectionSet = useMemo(() => new Set(localSelection), [localSelection]);

  // Derived state
  const hasActiveFilters =
    pickFilter !== "all" || ratingFilter !== "any" || colorFilter !== "all" || usageFilter !== "all";

  function resetFilters() {
    setPickFilter("all");
    setRatingFilter("any");
    setColorFilter("all");
    setUsageFilter("all");
  }

  const visibleAssets = useMemo(() => {
    const filtered = deferredAssets.filter((asset) => {
      if (
        !matchesPhotoFilters(asset, {
          pickStatus: pickFilter,
          ratingFilter,
          colorLabel: colorFilter
        })
      ) {
        return false;
      }

      const assetUsage = usageByAssetId.has(asset.id);
      if (usageFilter === "used" && !assetUsage) {
        return false;
      }

      if (usageFilter === "unused" && assetUsage) {
        return false;
      }

      return true;
    });

    filtered.sort((left, right) => {
      if (sortBy === "rating") {
        return (
          getAssetRating(right) - getAssetRating(left) ||
          left.fileName.localeCompare(right.fileName)
        );
      }

      if (sortBy === "orientation") {
        return (
          left.orientation.localeCompare(right.orientation) ||
          left.fileName.localeCompare(right.fileName)
        );
      }

      return left.fileName.localeCompare(right.fileName);
    });

    return filtered;
  }, [colorFilter, deferredAssets, ratingFilter, pickFilter, sortBy, usageByAssetId, usageFilter]);

  const previewAsset = previewAssetId
    ? localAssets.find((asset) => asset.id === previewAssetId) ?? null
    : null;

  useEffect(() => {
    if (!contextMenuState) {
      return;
    }

    const closeMenu = () => setContextMenuState(null);

    window.addEventListener("mousedown", closeMenu);
    window.addEventListener("scroll", closeMenu, true);

    return () => {
      window.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [contextMenuState]);

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

  function updateAsset(
    imageId: string,
    changes: Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">>
  ) {
    setLocalAssets((current) =>
      current.map((asset) => (asset.id === imageId ? { ...asset, ...changes } : asset))
    );
  }

  function applyKeyboardShortcut(
    asset: ImageAsset,
    input: {
      key: string;
      code?: string;
      ctrlKey: boolean;
      metaKey: boolean;
    }
  ) {
    const shortcutChanges = resolvePhotoClassificationShortcut(input);
    if (!shortcutChanges) {
      return false;
    }

    updateAsset(asset.id, shortcutChanges);
    return true;
  }

  function selectVisibleAssets() {
    setLocalSelection(visibleAssets.map((asset) => asset.id));
  }

  function activatePickedAssets() {
    setLocalSelection(
      localAssets
        .filter((asset) => getAssetPickStatus(asset) === "picked")
        .map((asset) => asset.id)
    );
  }

  function excludeRejectedAssets() {
    setLocalSelection(
      localAssets
        .filter((asset) => getAssetPickStatus(asset) !== "rejected")
        .map((asset) => asset.id)
    );
  }

  // Consolidated keyboard handler: Escape priority chain + arrow navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Priority 1: context menu open → Escape closes it, nothing else
      if (contextMenuState) {
        if (event.key === "Escape") {
          event.preventDefault();
          setContextMenuState(null);
        }
        return;
      }

      // Priority 2: quick-preview open → let PhotoQuickPreviewModal handle keys
      if (previewAssetId) {
        return;
      }

      // Priority 3: Escape closes selector
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      // Priority 4: Arrow keys navigate the grid
      const arrowKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
      if (!arrowKeys.includes(event.key)) {
        return;
      }

      // Don't steal arrows from form controls
      const target = event.target as HTMLElement;
      if (target.closest("select, input, textarea")) {
        return;
      }

      event.preventDefault();

      if (visibleAssets.length === 0) {
        return;
      }

      const currentIndex = focusedAssetId
        ? visibleAssets.findIndex((a) => a.id === focusedAssetId)
        : -1;

      // Detect column count from actual DOM dimensions
      const grid = gridRef.current;
      let cols = 4;
      if (grid) {
        const firstCard = grid.querySelector<HTMLElement>(".modal-photo-card");
        if (firstCard && firstCard.offsetWidth > 0) {
          cols = Math.max(1, Math.floor(grid.clientWidth / firstCard.offsetWidth));
        }
      }

      let nextIndex: number;
      if (currentIndex < 0) {
        nextIndex = 0;
      } else if (event.key === "ArrowRight") {
        nextIndex = Math.min(visibleAssets.length - 1, currentIndex + 1);
      } else if (event.key === "ArrowLeft") {
        nextIndex = Math.max(0, currentIndex - 1);
      } else if (event.key === "ArrowDown") {
        nextIndex = Math.min(visibleAssets.length - 1, currentIndex + cols);
      } else {
        // ArrowUp
        nextIndex = Math.max(0, currentIndex - cols);
      }

      if (nextIndex !== currentIndex || currentIndex < 0) {
        const nextAsset = visibleAssets[nextIndex];
        setFocusedAssetId(nextAsset.id);
        const button = grid?.querySelector<HTMLElement>(
          `[data-preview-asset-id="${nextAsset.id}"]`
        );
        if (button) {
          button.focus();
          button.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [contextMenuState, focusedAssetId, onClose, previewAssetId, visibleAssets]);

  const modalContent = (
    <>
      <div className="modal-panel modal-panel--wide" onClick={(event) => event.stopPropagation()}>
        <div className="modal-panel__header">
          <div>
            <strong>Selezione foto del progetto</strong>
            <p>
              Rivedi le foto a schermo grande, assegna stelle e colori e scegli quali entrano
              davvero nel layout.
            </p>
          </div>
          <div className="button-row">
            <PhotoClassificationHelpButton title="Scorciatoie selezione progetto" />
            <button type="button" className="ghost-button" onClick={onClose}>
              Chiudi
            </button>
          </div>
        </div>

          <div className="modal-toolbar modal-toolbar--selector">
            <div className="button-row">
              <button
                type="button"
                className="ghost-button"
                onClick={() => setLocalSelection(
                  hasActiveFilters
                    ? visibleAssets.map((asset) => asset.id)
                    : deferredAssets.map((asset) => asset.id)
                )}
                title={hasActiveFilters ? "Attiva solo le foto visibili con i filtri" : "Seleziona tutte le foto"}
              >
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
              <button
                type="button"
                className="ghost-button"
                onClick={() => setLocalSelection([])}
              >
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
            {hasActiveFilters ? (
              <div className="selector-filters__reset">
                <button
                  type="button"
                  className="ghost-button ghost-button--small"
                  onClick={resetFilters}
                >
                  ✕ Azzera filtri
                </button>
              </div>
            ) : null}

            <label className="field">
              <span>Stato</span>
              <select
                className={pickFilter !== "all" ? "field__select field__select--active" : undefined}
                value={pickFilter}
                onChange={(event) => setPickFilter(event.target.value as PickFilter)}>
                <option value="all">Tutti</option>
                <option value="picked">Pick</option>
                <option value="rejected">Scartate</option>
                <option value="unmarked">Neutre</option>
              </select>
            </label>

            <label className="field">
              <span>Uso nel layout</span>
              <select
                className={usageFilter !== "all" ? "field__select field__select--active" : undefined}
                value={usageFilter}
                onChange={(event) => setUsageFilter(event.target.value as UsageFilter)}>
                <option value="all">Tutte</option>
                <option value="used">Gia usate</option>
                <option value="unused">Ancora libere</option>
              </select>
            </label>

            <label className="field">
              <span>Colore</span>
              <select
                className={colorFilter !== "all" ? "field__select field__select--active" : undefined}
                value={colorFilter}
                onChange={(event) => setColorFilter(event.target.value as ColorFilter)}>
                <option value="all">Tutti</option>
                {COLOR_LABELS.map((value) => (
                  <option key={value} value={value}>
                    {COLOR_LABEL_NAMES[value]}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Stelle</span>
              <select
                className={ratingFilter !== "any" ? "field__select field__select--active" : undefined}
                value={ratingFilter}
                onChange={(event) => setRatingFilter(event.target.value)}>
                <option value="any">Tutte le stelle</option>
                <optgroup label="Minimo">
                  <option value="1+">★ 1 o più</option>
                  <option value="2+">★★ 2 o più</option>
                  <option value="3+">★★★ 3 o più</option>
                  <option value="4+">★★★★ 4 o più</option>
                </optgroup>
                <optgroup label="Esattamente">
                  <option value="0">Senza stelle</option>
                  <option value="1">★ Solo 1</option>
                  <option value="2">★★ Solo 2</option>
                  <option value="3">★★★ Solo 3</option>
                  <option value="4">★★★★ Solo 4</option>
                  <option value="5">★★★★★ Solo 5</option>
                </optgroup>
              </select>
            </label>
          </div>

          <div ref={gridRef} className="modal-photo-grid modal-photo-grid--selector">
            {visibleAssets.map((asset) => {
              const isSelected = selectionSet.has(asset.id);
              const previewUrl = asset.thumbnailUrl ?? asset.previewUrl ?? asset.sourceUrl;
              const usage = usageByAssetId.get(asset.id);
              const pickStatus = getAssetPickStatus(asset);
              const rating = getAssetRating(asset);
              const colorLabel = getAssetColorLabel(asset);

              return (
                <button
                  key={asset.id}
                  type="button"
                  data-preview-asset-id={asset.id}
                  className={isSelected ? "modal-photo-card modal-photo-card--active" : "modal-photo-card"}
                  onClick={() => toggleAsset(asset.id)}
                  onFocus={() => setFocusedAssetId(asset.id)}
                  onMouseEnter={() => {
                    if (asset.previewUrl) preloadImageUrls([asset.previewUrl]);
                  }}
                  onDoubleClick={() => setPreviewAssetId(asset.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenuState({
                      assetId: asset.id,
                      x: event.clientX,
                      y: event.clientY
                    });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === " ") {
                      event.preventDefault();
                      setPreviewAssetId(asset.id);
                      return;
                    }

                    if (
                      applyKeyboardShortcut(asset, {
                        key: event.key,
                        code: event.code,
                        ctrlKey: event.ctrlKey,
                        metaKey: event.metaKey
                      })
                    ) {
                      event.preventDefault();
                    }
                  }}
                >
                  <div className="modal-photo-card__image-shell">
                    {previewUrl ? (
                      <img
                        src={previewUrl}
                        alt={asset.fileName}
                        className="modal-photo-card__image"
                        loading="lazy"
                      />
                    ) : (
                      <div className="modal-photo-card__placeholder">{asset.fileName}</div>
                    )}

                    <div className="modal-photo-card__top-badges">
                      <span className={`asset-pick-badge asset-pick-badge--${pickStatus}`}>
                        {PICK_STATUS_LABELS[pickStatus]}
                      </span>
                      {colorLabel ? (
                        <span
                          className={`asset-color-dot asset-color-dot--${colorLabel}`}
                          title={COLOR_LABEL_NAMES[colorLabel]}
                        />
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
                          className={
                            value <= rating
                              ? "modal-photo-card__tiny-star modal-photo-card__tiny-star--active"
                              : "modal-photo-card__tiny-star"
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            updateAsset(asset.id, { rating: value });
                          }}
                          title={`${value} stella${value > 1 ? "e" : ""} | tasto ${value}`}
                        >
                          *
                        </button>
                      ))}
                    </div>

                    <div className="modal-photo-card__color-actions">
                      {COLOR_LABELS.map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={
                            colorLabel === value
                              ? `asset-color-dot asset-color-dot--${value} asset-color-dot--selected`
                              : `asset-color-dot asset-color-dot--${value}`
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            updateAsset(asset.id, {
                              colorLabel: colorLabel === value ? null : value
                            });
                          }}
                          title={`${COLOR_LABEL_NAMES[value]} | ${getColorShortcutHint(value)}`}
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
              Usa Info per tutte le scorciatoie. Spazio apre la preview, 1-5 assegna stelle,
              P/X/U cambia stato e Ctrl/Cmd + 6/7/8/9/V assegna i colori.
            </p>
            <div className="button-row">
              <button type="button" className="ghost-button" onClick={onClose}>
                Annulla
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => onApply(localSelection, localAssets)}
              >
                Usa {localSelection.length} foto nel progetto
              </button>
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

      {contextMenuState ? (
        <PhotoColorContextMenu
          x={contextMenuState.x}
          y={contextMenuState.y}
          selectedColor={
            localAssets.find((asset) => asset.id === contextMenuState.assetId)?.colorLabel ?? null
          }
          title="Etichetta colore"
          onSelect={(colorLabel) => {
            updateAsset(contextMenuState.assetId, { colorLabel });
            setContextMenuState(null);
          }}
        />
      ) : null}
    </>
  );

  return createPortal(
    <div className="modal-fullscreen-backdrop" onClick={onClose}>
      {modalContent}
    </div>,
    document.body
  );
}
