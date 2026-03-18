import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ColorLabel, ImageAsset, PickStatus } from "@photo-tools/shared-types";
import { PhotoClassificationHelpButton } from "./PhotoClassificationHelpButton";
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

interface PreviewPageTarget {
  id: string;
  pageNumber: number;
  templateLabel?: string;
  photoCount?: number;
  capacity?: number;
  isAtCapacity?: boolean;
}

interface PhotoQuickPreviewModalProps {
  asset: ImageAsset | null;
  assets?: ImageAsset[];
  usageByAssetId?: Map<string, { pageNumber: number; pageId?: string; slotId?: string }>;
  pages?: PreviewPageTarget[];
  activePageId?: string | null;
  onClose: () => void;
  onSelectAsset?: (assetId: string) => void;
  onAddToPage?: (pageId: string, assetId: string) => void;
  onJumpToPage?: (pageId: string) => void;
  onUpdateAsset?: (
    assetId: string,
    changes: Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">>
  ) => void;
}

type PickStatusFilter = PickStatus | "all";
type ColorFilter = ColorLabel | "all";

const orientationLabels: Record<ImageAsset["orientation"], string> = {
  horizontal: "Orizzontale",
  vertical: "Verticale",
  square: "Quadrata"
};

export function PhotoQuickPreviewModal({
  asset,
  assets = [],
  usageByAssetId,
  pages = [],
  activePageId,
  onClose,
  onSelectAsset,
  onAddToPage,
  onJumpToPage,
  onUpdateAsset
}: PhotoQuickPreviewModalProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [filterPickStatus, setFilterPickStatus] = useState<PickStatusFilter>(DEFAULT_PHOTO_FILTERS.pickStatus);
  const [filterMinRating, setFilterMinRating] = useState(DEFAULT_PHOTO_FILTERS.minimumRating);
  const [filterColorLabel, setFilterColorLabel] = useState<ColorFilter>(DEFAULT_PHOTO_FILTERS.colorLabel);

  const usage = asset ? usageByAssetId?.get(asset.id) : undefined;
  const activePage = useMemo(
    () => pages.find((page) => page.id === activePageId) ?? null,
    [activePageId, pages]
  );

  const hasActiveFilters =
    filterPickStatus !== "all" || filterMinRating > 0 || filterColorLabel !== "all";

  const filteredAssets = useMemo(
    () =>
      assets.filter((item) =>
        matchesPhotoFilters(item, {
          pickStatus: filterPickStatus,
          minimumRating: filterMinRating,
          colorLabel: filterColorLabel
        })
      ),
    [assets, filterColorLabel, filterMinRating, filterPickStatus]
  );

  useEffect(() => {
    if (!asset || !onSelectAsset || !hasActiveFilters) {
      return;
    }

    const assetIsVisible = filteredAssets.some((item) => item.id === asset.id);
    if (!assetIsVisible && filteredAssets.length > 0) {
      onSelectAsset(filteredAssets[0].id);
    }
  }, [asset, filteredAssets, hasActiveFilters, onSelectAsset]);

  const navigationAssets = hasActiveFilters ? filteredAssets : assets;
  const currentIndex = useMemo(
    () => (asset ? navigationAssets.findIndex((item) => item.id === asset.id) : -1),
    [asset, navigationAssets]
  );
  const previousAsset = currentIndex > 0 ? navigationAssets[currentIndex - 1] : null;
  const nextAsset =
    currentIndex >= 0 && currentIndex < navigationAssets.length - 1
      ? navigationAssets[currentIndex + 1]
      : null;

  const previewStrip = useMemo(() => {
    if (navigationAssets.length === 0) {
      return [];
    }

    if (currentIndex < 0) {
      return navigationAssets.slice(0, 9);
    }

    return navigationAssets.slice(
      Math.max(0, currentIndex - 4),
      Math.min(navigationAssets.length, currentIndex + 5)
    );
  }, [currentIndex, navigationAssets]);

  const handleNavigate = useCallback(
    (direction: "previous" | "next") => {
      if (!onSelectAsset || currentIndex < 0) {
        return;
      }

      const targetIndex = direction === "previous" ? currentIndex - 1 : currentIndex + 1;
      const targetAsset = navigationAssets[targetIndex];
      if (targetAsset) {
        onSelectAsset(targetAsset.id);
      }
    },
    [currentIndex, navigationAssets, onSelectAsset]
  );

  const updateRating = useCallback(
    (rating: number) => {
      if (asset && onUpdateAsset) {
        onUpdateAsset(asset.id, { rating });
      }
    },
    [asset, onUpdateAsset]
  );

  const updatePickStatus = useCallback(
    (pickStatus: PickStatus) => {
      if (asset && onUpdateAsset) {
        onUpdateAsset(asset.id, { pickStatus });
      }
    },
    [asset, onUpdateAsset]
  );

  const updateColorLabel = useCallback(
    (colorLabel: ColorLabel | null) => {
      if (asset && onUpdateAsset) {
        onUpdateAsset(asset.id, { colorLabel });
      }
    },
    [asset, onUpdateAsset]
  );

  const activePageCanAccept = Boolean(
    activePage &&
      (!(activePage.isAtCapacity ?? false) || usage?.pageId === activePage.id)
  );

  const handleAssignToActivePage = useCallback(() => {
    if (!asset || !activePage || !activePageCanAccept || !onAddToPage) {
      return;
    }

    onAddToPage(activePage.id, asset.id);
  }, [activePage, activePageCanAccept, asset, onAddToPage]);

  const toggleNativeFullscreen = useCallback(async () => {
    const element = stageRef.current;
    if (!element) {
      return;
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }

    await element.requestFullscreen();
  }, []);

  useEffect(() => {
    if (!asset) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        handleNavigate("previous");
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        handleNavigate("next");
        return;
      }

      if (event.key === "Enter" && activePage && onAddToPage) {
        event.preventDefault();
        handleAssignToActivePage();
        return;
      }

      if (!onUpdateAsset) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.closest("input, textarea, select, [contenteditable='true']") !== null ||
          target.isContentEditable)
      ) {
        return;
      }

      const shortcutChanges = resolvePhotoClassificationShortcut({
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey
      });

      if (shortcutChanges) {
        event.preventDefault();
        onUpdateAsset(asset.id, shortcutChanges);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activePage,
    asset,
    handleAssignToActivePage,
    handleNavigate,
    onAddToPage,
    onClose,
    onUpdateAsset
  ]);

  if (!asset) {
    return null;
  }

  const previewUrl = asset.sourceUrl ?? asset.previewUrl ?? asset.thumbnailUrl;
  const rating = getAssetRating(asset);
  const pickStatus = getAssetPickStatus(asset);
  const colorLabel = getAssetColorLabel(asset);

  const previewContent = (
    <div
      className="quick-preview"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Anteprima foto a schermo intero"
    >
      <div className="quick-preview__chrome">
        <div className="quick-preview__title">
          <strong>{asset.fileName}</strong>
          <span>
            {asset.width} x {asset.height} | {orientationLabels[asset.orientation]}
            {usage ? ` | Foglio ${usage.pageNumber}` : " | Non ancora usata nel layout"}
          </span>
        </div>

        <div className="quick-preview__actions">
          <span className="quick-preview__stars">{formatAssetStars(asset)}</span>
          <PhotoClassificationHelpButton title="Scorciatoie preview foto" />
          <button
            type="button"
            className="ghost-button quick-preview__action"
            onClick={toggleNativeFullscreen}
          >
            Fullscreen
          </button>
          <button type="button" className="ghost-button quick-preview__action" onClick={onClose}>
            Chiudi
          </button>
        </div>
      </div>

      <div className="quick-preview__meta-bar" onClick={(event) => event.stopPropagation()}>
        <div className="quick-preview__meta-group">
          <span className="quick-preview__meta-label">Stelle</span>
          <div className="quick-preview__stars-editor">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                className={
                  value <= rating
                    ? "quick-preview__star quick-preview__star--active"
                    : "quick-preview__star"
                }
                onClick={() => updateRating(value)}
              >
                *
              </button>
            ))}
            <button
              type="button"
              className="ghost-button quick-preview__tiny-action"
              onClick={() => updateRating(0)}
            >
              Azzera
            </button>
          </div>
        </div>

        <div className="quick-preview__meta-group">
          <span className="quick-preview__meta-label">Stato</span>
          <div className="quick-preview__pill-row">
            {(["picked", "rejected", "unmarked"] as PickStatus[]).map((value) => (
              <button
                key={value}
                type="button"
                className={
                  pickStatus === value
                    ? "quick-preview__pill quick-preview__pill--active"
                    : "quick-preview__pill"
                }
                onClick={() => updatePickStatus(value)}
              >
                {PICK_STATUS_LABELS[value]}
              </button>
            ))}
          </div>
        </div>

        <div className="quick-preview__meta-group">
          <span className="quick-preview__meta-label">Colore</span>
          <div className="quick-preview__color-row">
            <button
              type="button"
              className={
                colorLabel === null
                  ? "quick-preview__color-chip quick-preview__color-chip--clear quick-preview__color-chip--selected"
                  : "quick-preview__color-chip quick-preview__color-chip--clear"
              }
              onClick={() => updateColorLabel(null)}
            >
              Nessuno
            </button>
            {COLOR_LABELS.map((value) => (
              <button
                key={value}
                type="button"
                className={
                  colorLabel === value
                    ? `quick-preview__color-chip quick-preview__color-chip--${value} quick-preview__color-chip--selected`
                    : `quick-preview__color-chip quick-preview__color-chip--${value}`
                }
                onClick={() => updateColorLabel(value)}
                title={`${COLOR_LABEL_NAMES[value]} | ${getColorShortcutHint(value)}`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="quick-preview__stage" ref={stageRef} onClick={(event) => event.stopPropagation()}>
        {previousAsset ? (
          <button
            type="button"
            className="quick-preview__nav quick-preview__nav--prev"
            onClick={() => handleNavigate("previous")}
          >
            {"<"}
          </button>
        ) : null}

        {previewUrl ? (
          <img
            src={previewUrl}
            alt={asset.fileName}
            className="quick-preview__image"
            draggable={false}
            onDoubleClick={toggleNativeFullscreen}
          />
        ) : (
          <div className="quick-preview__placeholder">{asset.fileName}</div>
        )}

        {nextAsset ? (
          <button
            type="button"
            className="quick-preview__nav quick-preview__nav--next"
            onClick={() => handleNavigate("next")}
          >
            {">"}
          </button>
        ) : null}
      </div>

      <div className="quick-preview__footer" onClick={(event) => event.stopPropagation()}>
        {assets.length > 1 ? (
          <div className="quick-preview__filter-bar">
            <div className="quick-preview__filter-summary">
              {hasActiveFilters
                ? `${filteredAssets.length} foto corrispondono ai filtri`
                : `${assets.length} foto nel set corrente`}
            </div>
            <div className="quick-preview__filter-controls">
              <label className="quick-preview__filter-field">
                <span>Stato</span>
                <select
                  className="quick-preview__filter-select"
                  value={filterPickStatus}
                  onChange={(event) =>
                    setFilterPickStatus(event.target.value as PickStatusFilter)
                  }
                >
                  <option value="all">Tutti</option>
                  <option value="picked">Pick</option>
                  <option value="rejected">Scartate</option>
                  <option value="unmarked">Neutre</option>
                </select>
              </label>

              <label className="quick-preview__filter-field">
                <span>Stelle</span>
                <select
                  className="quick-preview__filter-select"
                  value={String(filterMinRating)}
                  onChange={(event) => setFilterMinRating(Number(event.target.value))}
                >
                  <option value="0">Tutte</option>
                  <option value="1">1+ stella</option>
                  <option value="2">2+ stelle</option>
                  <option value="3">3+ stelle</option>
                  <option value="4">4+ stelle</option>
                  <option value="5">5 stelle</option>
                </select>
              </label>
            </div>
            <div className="quick-preview__filter-colors">
              <button
                type="button"
                className={
                  filterColorLabel === "all"
                    ? "quick-preview__color-chip quick-preview__color-chip--clear quick-preview__color-chip--selected"
                    : "quick-preview__color-chip quick-preview__color-chip--clear"
                }
                onClick={() => setFilterColorLabel("all")}
              >
                Tutti i colori
              </button>
              {COLOR_LABELS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={
                    filterColorLabel === value
                      ? `quick-preview__color-chip quick-preview__color-chip--${value} quick-preview__color-chip--selected`
                      : `quick-preview__color-chip quick-preview__color-chip--${value}`
                  }
                  onClick={() => setFilterColorLabel(value)}
                  title={COLOR_LABEL_NAMES[value]}
                />
              ))}
            </div>
          </div>
        ) : null}

        {previewStrip.length > 0 ? (
          <div className="quick-preview__strip">
            {previewStrip.map((item) => {
              const itemPreview = item.thumbnailUrl ?? item.previewUrl ?? item.sourceUrl;
              const isActive = item.id === asset.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  className={
                    isActive
                      ? "quick-preview__thumb quick-preview__thumb--active"
                      : "quick-preview__thumb"
                  }
                  onClick={() => onSelectAsset?.(item.id)}
                >
                  {itemPreview ? (
                    <img
                      src={itemPreview}
                      alt={item.fileName}
                      className="quick-preview__thumb-image"
                    />
                  ) : (
                    item.fileName
                  )}
                </button>
              );
            })}
          </div>
        ) : hasActiveFilters ? (
          <div className="quick-preview__empty-filter">
            Nessuna foto corrisponde ai filtri attivi.
          </div>
        ) : null}

        {pages.length > 0 && onAddToPage ? (
          <div className="quick-preview__assign-bar">
            <div className="quick-preview__assign-copy">
              <strong>
                {activePage
                  ? `Foglio attivo ${activePage.pageNumber}`
                  : "Nessun foglio attivo"}
              </strong>
              <span>
                {activePage
                  ? activePageCanAccept
                    ? "Premi Invio per aggiungere questa foto al foglio attivo."
                    : "Il foglio attivo e' pieno. Torna nello studio e crea o seleziona un altro foglio."
                  : "Seleziona prima un foglio nello studio per usare l'aggiunta rapida da questa preview."}
              </span>
            </div>

            <div className="quick-preview__assign-actions">
              <button
                type="button"
                className="secondary-button quick-preview__assign-button quick-preview__assign-button--active"
                onClick={handleAssignToActivePage}
                disabled={!activePage || !activePageCanAccept}
              >
                {activePage
                  ? `Aggiungi al foglio attivo ${activePage.pageNumber}`
                  : "Nessun foglio attivo"}
              </button>

              {usage?.pageId && onJumpToPage ? (
                <button
                  type="button"
                  className="ghost-button quick-preview__assign-button"
                  onClick={() => onJumpToPage(usage.pageId!)}
                >
                  {`Vai al foglio ${usage.pageNumber}`}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return previewContent;
  }

  return createPortal(previewContent, document.body);
}
