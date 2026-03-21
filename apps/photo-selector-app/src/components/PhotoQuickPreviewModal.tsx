import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ColorLabel, ImageAsset, PickStatus } from "@photo-tools/shared-types";
import { preloadImageUrls } from "../services/image-cache";
import { createOnDemandPreviewAsync, isRawFile } from "../services/folder-access";
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
} from "../services/photo-classification";

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
type PreviewFeedback = {
  kind: "star" | "pill" | "dot";
  label: string;
  token: number;
};

const orientationLabels: Record<ImageAsset["orientation"], string> = {
  horizontal: "Orizzontale",
  vertical: "Verticale",
  square: "Quadrata"
};

const MIN_RAW_PREVIEW_DIMENSION = 900;

function shouldLoadRawPreview(asset: ImageAsset): boolean {
  if (!isRawFile(asset.fileName)) {
    return false;
  }

  if (!asset.previewUrl) {
    return true;
  }

  return Math.min(asset.width, asset.height) > 0 &&
    Math.min(asset.width, asset.height) < MIN_RAW_PREVIEW_DIMENSION;
}

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
  const assignFeedbackTimeoutRef = useRef<number | null>(null);
  const classificationFeedbackTimeoutRef = useRef<number | null>(null);
  const classificationFeedbackTokenRef = useRef(0);
  const [filterPickStatus, setFilterPickStatus] = useState<PickStatusFilter>(DEFAULT_PHOTO_FILTERS.pickStatus);
  const [filterRating, setFilterRating] = useState(DEFAULT_PHOTO_FILTERS.ratingFilter);
  const [filterColorLabel, setFilterColorLabel] = useState<ColorFilter>(DEFAULT_PHOTO_FILTERS.colorLabel);
  const [assignFeedbackPageNumber, setAssignFeedbackPageNumber] = useState<number | null>(null);
  const [resolvedPreviewUrl, setResolvedPreviewUrl] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareAssetId, setCompareAssetId] = useState<string | null>(null);
  const [resolvedComparePreviewUrl, setResolvedComparePreviewUrl] = useState<string | null>(null);
  const [classificationFeedback, setClassificationFeedback] = useState<PreviewFeedback | null>(null);

  const usage = asset ? usageByAssetId?.get(asset.id) : undefined;
  const activePage = useMemo(
    () => pages.find((page) => page.id === activePageId) ?? null,
    [activePageId, pages]
  );

  const hasActiveFilters =
    filterPickStatus !== "all" || filterRating !== "any" || filterColorLabel !== "all";

  const filteredAssets = useMemo(
    () =>
      assets.filter((item) =>
        matchesPhotoFilters(item, {
          pickStatus: filterPickStatus,
          ratingFilter: filterRating,
          colorLabel: filterColorLabel
        })
      ),
    [assets, filterColorLabel, filterRating, filterPickStatus]
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
  const compareAsset = compareAssetId
    ? navigationAssets.find((item) => item.id === compareAssetId && item.id !== asset?.id) ?? null
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

  const announceClassificationFeedback = useCallback((
    changes: Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">>
  ) => {
    let label: string | null = null;
    let kind: PreviewFeedback["kind"] | null = null;

    if (changes.rating !== undefined) {
      kind = "star";
      label = changes.rating > 0 ? `Valutazione: ${"★".repeat(changes.rating)}` : "Valutazione rimossa";
    } else if (changes.pickStatus !== undefined) {
      kind = "pill";
      label = `Stato: ${PICK_STATUS_LABELS[changes.pickStatus]}`;
    } else if (changes.colorLabel !== undefined) {
      kind = "dot";
      label = changes.colorLabel ? `Colore: ${COLOR_LABEL_NAMES[changes.colorLabel]}` : "Colore rimosso";
    }

    if (!label || !kind) {
      return;
    }

    classificationFeedbackTokenRef.current += 1;
    const nextFeedback = {
      kind,
      label,
      token: classificationFeedbackTokenRef.current
    } satisfies PreviewFeedback;

    setClassificationFeedback(nextFeedback);

    if (classificationFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(classificationFeedbackTimeoutRef.current);
    }

    classificationFeedbackTimeoutRef.current = window.setTimeout(() => {
      setClassificationFeedback((current) =>
        current?.token === nextFeedback.token ? null : current
      );
      classificationFeedbackTimeoutRef.current = null;
    }, 1200);
  }, []);

  const updateRating = useCallback(
    (rating: number) => {
      if (asset && onUpdateAsset) {
        const changes = { rating } satisfies Partial<Pick<ImageAsset, "rating">>;
        onUpdateAsset(asset.id, changes);
        announceClassificationFeedback(changes);
      }
    },
    [announceClassificationFeedback, asset, onUpdateAsset]
  );

  const updatePickStatus = useCallback(
    (pickStatus: PickStatus) => {
      if (asset && onUpdateAsset) {
        const changes = { pickStatus } satisfies Partial<Pick<ImageAsset, "pickStatus">>;
        onUpdateAsset(asset.id, changes);
        announceClassificationFeedback(changes);
      }
    },
    [announceClassificationFeedback, asset, onUpdateAsset]
  );

  const updateColorLabel = useCallback(
    (colorLabel: ColorLabel | null) => {
      if (asset && onUpdateAsset) {
        const changes = { colorLabel } satisfies Partial<Pick<ImageAsset, "colorLabel">>;
        onUpdateAsset(asset.id, changes);
        announceClassificationFeedback(changes);
      }
    },
    [announceClassificationFeedback, asset, onUpdateAsset]
  );

  const activePageCanAccept = Boolean(
    activePage &&
      (!(activePage.isAtCapacity ?? false) || usage?.pageId === activePage.id)
  );
  const showAssignSuccess = activePage?.pageNumber === assignFeedbackPageNumber;

  const handleAssignToActivePage = useCallback(() => {
    if (!asset || !activePage || !activePageCanAccept || !onAddToPage) {
      return;
    }

    onAddToPage(activePage.id, asset.id);
    setAssignFeedbackPageNumber(activePage.pageNumber);
    if (assignFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(assignFeedbackTimeoutRef.current);
    }
    assignFeedbackTimeoutRef.current = window.setTimeout(() => {
      setAssignFeedbackPageNumber((current) => (current === activePage.pageNumber ? null : current));
      assignFeedbackTimeoutRef.current = null;
    }, 1800);
  }, [activePage, activePageCanAccept, asset, onAddToPage]);

  useEffect(() => {
    setAssignFeedbackPageNumber(null);
  }, [asset?.id]);

  // Preload adjacent assets so navigation feels instant
  useEffect(() => {
    if (currentIndex < 0) return;
    const toPreload: string[] = [];
    for (const delta of [-2, -1, 1, 2]) {
      const a = navigationAssets[currentIndex + delta];
      if (!a) continue;
      if (a.previewUrl) toPreload.push(a.previewUrl);
      if (a.thumbnailUrl) toPreload.push(a.thumbnailUrl);
    }
    preloadImageUrls(toPreload);
  }, [currentIndex, navigationAssets]);

  useEffect(() => {
    if (!asset) {
      return;
    }

    void createOnDemandPreviewAsync(asset.id, 0).catch(() => null);
  }, [asset?.id]);

  useEffect(() => {
    if (currentIndex < 0) {
      return;
    }

    const rawIdsToWarm: Array<{ id: string; priority: number }> = [];
    for (let delta = 1; delta <= 6; delta += 1) {
      const previous = navigationAssets[currentIndex - delta];
      const next = navigationAssets[currentIndex + delta];

      if (previous) {
        rawIdsToWarm.push({ id: previous.id, priority: delta <= 2 ? 1 : 2 });
      }
      if (next) {
        rawIdsToWarm.push({ id: next.id, priority: delta <= 2 ? 1 : 2 });
      }
    }

    if (rawIdsToWarm.length === 0) {
      return;
    }

    void Promise.all(
      rawIdsToWarm.map(({ id, priority }) =>
        createOnDemandPreviewAsync(id, priority).catch(() => null)
      )
    );
  }, [currentIndex, navigationAssets]);

  useEffect(() => {
    return () => {
      if (assignFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(assignFeedbackTimeoutRef.current);
      }
      if (classificationFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(classificationFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setClassificationFeedback(null);
    if (classificationFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(classificationFeedbackTimeoutRef.current);
      classificationFeedbackTimeoutRef.current = null;
    }
  }, [asset?.id]);

  useEffect(() => {
    if (!asset) {
      setResolvedPreviewUrl(null);
      return;
    }

    if (!shouldLoadRawPreview(asset)) {
      setResolvedPreviewUrl(null);
      return;
    }

    let active = true;
    setResolvedPreviewUrl(null);

    createOnDemandPreviewAsync(asset.id)
      .then((url) => {
        if (active && url) {
          setResolvedPreviewUrl(url);
        }
      })
      .catch(() => {
        if (active) {
          setResolvedPreviewUrl(null);
        }
      });

    return () => {
      active = false;
    };
  }, [asset]);

  useEffect(() => {
    if (!compareMode) {
      setCompareAssetId(null);
      setResolvedComparePreviewUrl(null);
      return;
    }

    const fallbackCompareId = nextAsset?.id ?? previousAsset?.id ?? null;
    if (!fallbackCompareId) {
      setCompareAssetId(null);
      return;
    }

    if (compareAssetId === asset?.id || !compareAssetId) {
      setCompareAssetId(fallbackCompareId);
    }
  }, [asset?.id, compareAssetId, compareMode, nextAsset?.id, previousAsset?.id]);

  useEffect(() => {
    if (!compareAsset) {
      setResolvedComparePreviewUrl(null);
      return;
    }

    if (!shouldLoadRawPreview(compareAsset)) {
      setResolvedComparePreviewUrl(null);
      return;
    }

    let active = true;
    setResolvedComparePreviewUrl(null);

    createOnDemandPreviewAsync(compareAsset.id)
      .then((url) => {
        if (active && url) {
          setResolvedComparePreviewUrl(url);
        }
      })
      .catch(() => {
        if (active) {
          setResolvedComparePreviewUrl(null);
        }
      });

    return () => {
      active = false;
    };
  }, [compareAsset]);

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

      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        handleNavigate("previous");
        return;
      }

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        handleNavigate("next");
        return;
      }

      if (event.key === "Enter" && activePage && activePageCanAccept && onAddToPage) {
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          target.closest("input, textarea, select, button, [contenteditable='true']") !== null
        ) {
          return;
        }
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
        announceClassificationFeedback(shortcutChanges);
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
    onUpdateAsset,
    announceClassificationFeedback
  ]);

  if (!asset) {
    return null;
  }

  const previewUrl =
    resolvedPreviewUrl ?? asset.previewUrl ?? asset.sourceUrl ?? asset.thumbnailUrl;
  const comparePreviewUrl = compareAsset
    ? resolvedComparePreviewUrl ?? compareAsset.previewUrl ?? compareAsset.sourceUrl ?? compareAsset.thumbnailUrl
    : null;
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
      {/* ── SIDEBAR SINISTRA: filtri + thumbnail verticali ── */}
      {assets.length > 1 ? (
        <div className="quick-preview__sidebar" onClick={(event) => event.stopPropagation()}>
          <div className="quick-preview__sidebar-filters">
            <div className="quick-preview__filter-summary">
              {hasActiveFilters
                ? `${filteredAssets.length} di ${assets.length} foto`
                : `${assets.length} foto`}
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
                  value={filterRating}
                  onChange={(event) => setFilterRating(event.target.value)}
                >
                  <option value="any">Tutte</option>
                  <optgroup label="Minimo">
                    <option value="1+">★ 1+</option>
                    <option value="2+">★★ 2+</option>
                    <option value="3+">★★★ 3+</option>
                    <option value="4+">★★★★ 4+</option>
                  </optgroup>
                  <optgroup label="Esatto">
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
                Tutti
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
                    aria-current={isActive ? "true" : undefined}
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
        </div>
      ) : null}

      {/* ── AREA PRINCIPALE DESTRA: chrome + meta + foto + assign ── */}
      <div className="quick-preview__main" onClick={(event) => event.stopPropagation()}>
        <div className="quick-preview__chrome">
          <div className="quick-preview__title">
            <strong>{asset.fileName}</strong>
            <span>
              {asset.width} x {asset.height} | {orientationLabels[asset.orientation]}
              {usage ? ` | Foglio ${usage.pageNumber}` : " | Non ancora usata nel layout"}
            </span>
            {asset.xmpHasEdits ? (
              <span className="quick-preview__xmp-badge" title="Metadati XMP rilevati">
                XMP Edit: {asset.xmpEditInfo ?? "Sviluppo rilevato"}
              </span>
            ) : null}
          </div>

          <div className="quick-preview__actions">
            <span className="quick-preview__stars">{formatAssetStars(asset)}</span>
            {classificationFeedback ? (
              <span
                key={classificationFeedback.token}
                className={`quick-preview__feedback quick-preview__feedback--${classificationFeedback.kind}`}
                aria-live="polite"
              >
                {classificationFeedback.label}
              </span>
            ) : null}
            <PhotoClassificationHelpButton title="Scorciatoie preview foto" />
            <button
              type="button"
              className={
                compareMode
                  ? "ghost-button quick-preview__action quick-preview__action--active"
                  : "ghost-button quick-preview__action"
              }
              onClick={() => setCompareMode((current) => !current)}
              disabled={!nextAsset && !previousAsset}
            >
              {compareMode ? "Chiudi confronto" : "Confronta"}
            </button>
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

        <div className="quick-preview__meta-bar">
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
                  ★
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

        <div
          className={
            compareMode && compareAsset
              ? "quick-preview__stage quick-preview__stage--compare"
              : "quick-preview__stage"
          }
          ref={stageRef}
        >
          {previousAsset ? (
            <button
              type="button"
              className="quick-preview__nav quick-preview__nav--prev"
              onClick={() => handleNavigate("previous")}
            >
              {"<"}
            </button>
          ) : null}

          {compareMode && compareAsset ? (
            <div className="quick-preview__compare-grid">
              <div className="quick-preview__compare-panel">
                <span className="quick-preview__compare-label">Corrente</span>
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={asset.fileName}
                    className="quick-preview__image quick-preview__image--compare"
                    draggable={false}
                    onDoubleClick={toggleNativeFullscreen}
                  />
                ) : (
                  <div className="quick-preview__placeholder">{asset.fileName}</div>
                )}
              </div>
              <div className="quick-preview__compare-panel">
                <span className="quick-preview__compare-label">{compareAsset.fileName}</span>
                {comparePreviewUrl ? (
                  <img
                    src={comparePreviewUrl}
                    alt={compareAsset.fileName}
                    className="quick-preview__image quick-preview__image--compare"
                    draggable={false}
                    onDoubleClick={toggleNativeFullscreen}
                  />
                ) : (
                  <div className="quick-preview__placeholder">{compareAsset.fileName}</div>
                )}
              </div>
            </div>
          ) : previewUrl ? (
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

        {navigationAssets.length > 1 ? (
          <div className="quick-preview__dock">
            <div className="quick-preview__dock-copy">
              <strong>
                Foto {currentIndex + 1} di {navigationAssets.length}
              </strong>
              <span>
                {previousAsset ? `Prec: ${previousAsset.fileName}` : "Inizio serie"} ·{" "}
                {nextAsset ? `Succ: ${nextAsset.fileName}` : "Fine serie"}
              </span>
            </div>
            <div className="quick-preview__dock-strip">
              {previewStrip.map((item) => {
                const itemPreview = item.thumbnailUrl ?? item.previewUrl ?? item.sourceUrl;
                const isActive = item.id === asset.id;

                return (
                  <button
                    key={`dock-${item.id}`}
                    type="button"
                    className={
                      isActive
                        ? "quick-preview__dock-thumb quick-preview__dock-thumb--active"
                        : "quick-preview__dock-thumb"
                    }
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => onSelectAsset?.(item.id)}
                    title={item.fileName}
                  >
                    {itemPreview ? (
                      <img
                        src={itemPreview}
                        alt={item.fileName}
                        className="quick-preview__dock-image"
                      />
                    ) : (
                      <span className="quick-preview__dock-fallback">{item.fileName}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {pages.length > 0 && onAddToPage ? (
          <div
            className={
              showAssignSuccess
                ? "quick-preview__assign-bar quick-preview__assign-bar--success"
                : "quick-preview__assign-bar"
            }
          >
            <div className="quick-preview__assign-copy">
              <strong>
                {activePage
                  ? `Foglio attivo ${activePage.pageNumber}`
                  : "Nessun foglio attivo"}
              </strong>
              <span>
                {activePage
                  ? activePageCanAccept
                    ? usage?.pageId === activePage.id
                      ? "La foto è già in questo foglio. Premi Invio per riorganizzarlo."
                      : "Premi Invio per aggiungere questa foto al foglio attivo."
                    : "Il foglio attivo è pieno. Seleziona un altro foglio nello studio."
                  : "Seleziona un foglio nello studio per usare l'aggiunta rapida."}
              </span>
              {showAssignSuccess ? (
                <span className="quick-preview__assign-success" aria-live="polite">
                  Foto aggiunta al foglio attivo {assignFeedbackPageNumber}.
                </span>
              ) : null}
            </div>

            <div className="quick-preview__assign-actions">
              <button
                type="button"
                className={
                  showAssignSuccess
                    ? "secondary-button quick-preview__assign-button quick-preview__assign-button--active quick-preview__assign-button--success"
                    : "secondary-button quick-preview__assign-button quick-preview__assign-button--active"
                }
                onClick={handleAssignToActivePage}
                disabled={!activePage || !activePageCanAccept}
              >
                {!activePage
                  ? "Nessun foglio attivo"
                  : usage?.pageId === activePage.id
                  ? `Riorganizza foglio ${activePage.pageNumber}`
                  : `Aggiungi al foglio ${activePage.pageNumber}`}
              </button>

              {usage?.pageId && onJumpToPage && usage.pageId !== activePage?.id ? (
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
