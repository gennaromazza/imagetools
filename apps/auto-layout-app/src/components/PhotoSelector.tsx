import { useEffect, useMemo, useState } from "react";
import type { ColorLabel, ImageAsset, PickStatus } from "@photo-tools/shared-types";
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

interface PhotoSelectorProps {
  photos: ImageAsset[];
  selectedIds: string[];
  onSelectionChange: (selectedIds: string[]) => void;
  onPhotosChange?: (photos: ImageAsset[]) => void;
}

type SortMode = "name" | "orientation" | "rating";
type PickFilter = "all" | PickStatus;
type ColorFilter = "all" | ColorLabel;

export function PhotoSelector({
  photos,
  selectedIds,
  onSelectionChange,
  onPhotosChange
}: PhotoSelectorProps) {
  const [sortBy, setSortBy] = useState<SortMode>("name");
  const [pickFilter, setPickFilter] = useState<PickFilter>(DEFAULT_PHOTO_FILTERS.pickStatus);
  const [minimumRating, setMinimumRating] = useState(DEFAULT_PHOTO_FILTERS.minimumRating);
  const [colorFilter, setColorFilter] = useState<ColorFilter>(DEFAULT_PHOTO_FILTERS.colorLabel);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const [contextMenuState, setContextMenuState] = useState<{
    assetId: string;
    x: number;
    y: number;
  } | null>(null);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const visiblePhotos = useMemo(() => {
    const filtered = photos.filter((photo) =>
      matchesPhotoFilters(photo, {
        pickStatus: pickFilter,
        minimumRating,
        colorLabel: colorFilter
      })
    );

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
  }, [colorFilter, minimumRating, photos, pickFilter, sortBy]);

  const previewAsset = previewAssetId
    ? visiblePhotos.find((photo) => photo.id === previewAssetId) ?? null
    : null;

  useEffect(() => {
    if (!contextMenuState) {
      return;
    }

    const closeMenu = () => setContextMenuState(null);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("mousedown", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [contextMenuState]);

  function togglePhoto(id: string) {
    const nextSelection = new Set(selectedSet);

    if (nextSelection.has(id)) {
      nextSelection.delete(id);
    } else {
      nextSelection.add(id);
    }

    onSelectionChange(Array.from(nextSelection));
  }

  function toggleAll(selectAll: boolean) {
    onSelectionChange(selectAll ? photos.map((photo) => photo.id) : []);
  }

  function updatePhoto(
    id: string,
    changes: Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">>
  ) {
    if (!onPhotosChange) {
      return;
    }

    onPhotosChange(photos.map((photo) => (photo.id === id ? { ...photo, ...changes } : photo)));
  }

  function applyKeyboardShortcut(
    photo: ImageAsset,
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

    updatePhoto(photo.id, shortcutChanges);
    return true;
  }

  const allSelected = photos.length > 0 && selectedIds.length === photos.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < photos.length;

  return (
    <>
      <div className="photo-selector">
        <div className="photo-selector__controls">
          <div className="photo-selector__stats">
            <span className="photo-selector__count">
              {selectedIds.length} di {photos.length} foto selezionate
            </span>
            <span className="photo-selector__count">
              {visiblePhotos.length} visibili con i filtri
            </span>
          </div>

          <div className="photo-selector__actions">
            <PhotoClassificationHelpButton title="Scorciatoie selezione iniziale" />
            <button
              type="button"
              className={`checkbox-button ${
                allSelected
                  ? "checkbox-button--checked"
                  : someSelected
                    ? "checkbox-button--indeterminate"
                    : ""
              }`}
              onClick={() => toggleAll(!allSelected)}
              aria-label={allSelected ? "Deseleziona tutte" : "Seleziona tutte"}
            >
              {allSelected ? "Tutte" : someSelected ? "Alcune" : "Nessuna"}
            </button>

            <select
              className="photo-selector__sort"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as SortMode)}
              aria-label="Ordina foto per"
            >
              <option value="name">Ordina per nome</option>
              <option value="orientation">Ordina per orientamento</option>
              <option value="rating">Ordina per stelle</option>
            </select>
          </div>
        </div>

        <div className="photo-selector__filters">
          <select
            className="photo-selector__sort"
            value={pickFilter}
            onChange={(event) => setPickFilter(event.target.value as PickFilter)}
          >
            <option value="all">Tutti gli stati</option>
            <option value="picked">Solo pick</option>
            <option value="rejected">Solo scartate</option>
            <option value="unmarked">Solo neutre</option>
          </select>

          <select
            className="photo-selector__sort"
            value={minimumRating}
            onChange={(event) => setMinimumRating(Number(event.target.value))}
          >
            <option value={0}>Tutte le stelle</option>
            <option value={1}>1+ stelle</option>
            <option value={2}>2+ stelle</option>
            <option value={3}>3+ stelle</option>
            <option value={4}>4+ stelle</option>
            <option value={5}>5 stelle</option>
          </select>

          <select
            className="photo-selector__sort"
            value={colorFilter}
            onChange={(event) => setColorFilter(event.target.value as ColorFilter)}
          >
            <option value="all">Tutti i colori</option>
            {COLOR_LABELS.map((value) => (
              <option key={value} value={value}>
                {COLOR_LABEL_NAMES[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="photo-selector__grid">
          {visiblePhotos.length === 0 ? (
            <div className="photo-selector__empty">
              <p>Nessuna foto disponibile con i filtri attuali.</p>
            </div>
          ) : (
            visiblePhotos.map((photo) => {
              const isSelected = selectedSet.has(photo.id);
              const previewUrl = photo.thumbnailUrl ?? photo.previewUrl ?? photo.sourceUrl;
              const aspectRatio =
                photo.width > 0 && photo.height > 0
                  ? `${photo.width} / ${photo.height}`
                  : undefined;
              const rating = getAssetRating(photo);
              const pickStatus = getAssetPickStatus(photo);
              const colorLabel = getAssetColorLabel(photo);

              return (
                <div
                  key={photo.id}
                  className={`photo-card ${isSelected ? "photo-card--selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`${photo.fileName}${isSelected ? ", selezionata" : ""}`}
                  data-preview-asset-id={photo.id}
                  onClick={() => togglePhoto(photo.id)}
                  onDoubleClick={() => setPreviewAssetId(photo.id)}
                  onContextMenu={(event) => {
                    if (!onPhotosChange) {
                      return;
                    }

                    event.preventDefault();
                    setContextMenuState({
                      assetId: photo.id,
                      x: event.clientX,
                      y: event.clientY
                    });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      togglePhoto(photo.id);
                      return;
                    }

                    if (event.key === " ") {
                      event.preventDefault();
                      setPreviewAssetId(photo.id);
                      return;
                    }

                    if (
                      applyKeyboardShortcut(photo, {
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
                  <div
                    className="photo-card__image-wrapper"
                    style={aspectRatio ? { aspectRatio } : undefined}
                  >
                    {previewUrl ? (
                      <img
                        src={previewUrl}
                        alt={photo.fileName}
                        className="photo-card__image"
                        loading="lazy"
                      />
                    ) : (
                      <div className="photo-card__image photo-card__image--placeholder">
                        {photo.fileName}
                      </div>
                    )}
                    <div className="photo-card__top-badges">
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
                    <div className="photo-card__overlay">
                      <div
                        className={`photo-card__checkbox ${
                          isSelected ? "photo-card__checkbox--checked" : ""
                        }`}
                      >
                        {isSelected ? "OK" : ""}
                      </div>
                    </div>
                    {rating > 0 ? <div className="photo-card__stars">{formatAssetStars(photo)}</div> : null}
                  </div>

                  <div className="photo-card__info">
                    <div className="photo-card__name" title={photo.fileName}>
                      {photo.fileName}
                    </div>
                    <div className="photo-card__meta">
                      <span>{photo.orientation}</span>
                      <span className="photo-card__dimensions">
                        {Math.round(photo.width)}x{Math.round(photo.height)}
                      </span>
                    </div>
                  </div>

                  <div className="photo-card__toolbar" onClick={(event) => event.stopPropagation()}>
                    <div className="photo-card__tiny-actions">
                      {[1, 2, 3, 4, 5].map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={
                            value <= rating
                              ? "modal-photo-card__tiny-star modal-photo-card__tiny-star--active"
                              : "modal-photo-card__tiny-star"
                          }
                          onClick={() => updatePhoto(photo.id, { rating: value })}
                          title={`${value} stella${value > 1 ? "e" : ""} | tasto ${value}`}
                        >
                          *
                        </button>
                      ))}
                    </div>

                    <div className="photo-card__toolbar-row">
                      {(["picked", "rejected", "unmarked"] as PickStatus[]).map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={
                            pickStatus === value
                              ? "quick-preview__pill quick-preview__pill--active"
                              : "quick-preview__pill"
                          }
                          onClick={() => updatePhoto(photo.id, { pickStatus: value })}
                          title={
                            value === "picked"
                              ? "Segna come pick | tasto P"
                              : value === "rejected"
                                ? "Segna come scartata | tasto X"
                                : "Torna neutra | tasto U"
                          }
                        >
                          {PICK_STATUS_LABELS[value]}
                        </button>
                      ))}
                    </div>

                    <div className="photo-card__toolbar-row">
                      {COLOR_LABELS.map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={
                            colorLabel === value
                              ? `asset-color-dot asset-color-dot--${value} asset-color-dot--selected`
                              : `asset-color-dot asset-color-dot--${value}`
                          }
                          onClick={() =>
                            updatePhoto(photo.id, {
                              colorLabel: colorLabel === value ? null : value
                            })
                          }
                          title={`${COLOR_LABEL_NAMES[value]} | ${getColorShortcutHint(value)}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="photo-selector__footer">
          <p className="photo-selector__hint">
            Usa Info per tutte le scorciatoie. Tasto destro o Ctrl/Cmd + 6/7/8/9/V per i colori,
            1-5 per le stelle, P/X/U per lo stato e Spazio per la preview grande.
          </p>
        </div>
      </div>

      <PhotoQuickPreviewModal
        asset={previewAsset}
        assets={visiblePhotos}
        onClose={() => setPreviewAssetId(null)}
        onSelectAsset={setPreviewAssetId}
        onUpdateAsset={(assetId, changes) => updatePhoto(assetId, changes)}
      />

      {contextMenuState ? (
        <PhotoColorContextMenu
          x={contextMenuState.x}
          y={contextMenuState.y}
          selectedColor={
            photos.find((photo) => photo.id === contextMenuState.assetId)?.colorLabel ?? null
          }
          title="Etichetta colore"
          onSelect={(colorLabel) => {
            updatePhoto(contextMenuState.assetId, { colorLabel });
            setContextMenuState(null);
          }}
        />
      ) : null}
    </>
  );
}
