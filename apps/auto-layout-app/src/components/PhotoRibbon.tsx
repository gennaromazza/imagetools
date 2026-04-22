import { memo, useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import type { ColorLabel, ImageAsset, PickStatus } from "@photo-tools/shared-types";
import { preloadImageUrls } from "../image-cache";
import { PhotoClassificationHelpButton } from "./PhotoClassificationHelpButton";
import { PhotoColorContextMenu } from "./PhotoColorContextMenu";
import {
  COLOR_LABEL_NAMES,
  COLOR_LABELS,
  DEFAULT_PHOTO_FILTERS,
  formatAssetStars,
  getAssetPickStatus,
  getAssetRating,
  matchesPhotoFilters,
  PICK_STATUS_LABELS,
  resolvePhotoClassificationShortcut
} from "../photo-classification";

interface RibbonUsage {
  pageNumber: number;
}

interface RibbonDragState {
  imageId: string;
}

interface PhotoRibbonProps {
  assets: ImageAsset[];
  assetFilter: "all" | "unused" | "used";
  usageByAssetId: Map<string, RibbonUsage>;
  dragState: RibbonDragState | null;
  variant?: "horizontal" | "vertical";
  onAssetFilterChange: (filter: "all" | "unused" | "used") => void;
  onDragAssetStart: (imageId: string) => void;
  onDragEnd: () => void;
  onAssetDoubleClick?: (imageId: string) => void;
  onAssetsMetadataChange?: (
    changesById: Map<string, Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">>>
  ) => void;
}

const ITEM_WIDTH = 120;
const OVERSCAN_ITEMS = 4;

function PhotoRibbonContent({
  assets,
  assetFilter,
  usageByAssetId,
  dragState,
  variant = "horizontal",
  onAssetFilterChange,
  onDragAssetStart,
  onDragEnd,
  onAssetDoubleClick,
  onAssetsMetadataChange
}: PhotoRibbonProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [visibleItems, setVisibleItems] = useState(8);
  const [pickFilter, setPickFilter] = useState<"all" | PickStatus>(DEFAULT_PHOTO_FILTERS.pickStatus);
  const [ratingFilter, setRatingFilter] = useState(DEFAULT_PHOTO_FILTERS.ratingFilter);
  const [colorFilter, setColorFilter] = useState<"all" | ColorLabel>(DEFAULT_PHOTO_FILTERS.colorLabel);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [contextMenuState, setContextMenuState] = useState<{
    assetId: string;
    x: number;
    y: number;
  } | null>(null);

  const hasActiveFilters =
    pickFilter !== "all" || ratingFilter !== "any" || colorFilter !== "all";

  const resetFilters = useCallback(() => {
    setPickFilter("all");
    setRatingFilter("any");
    setColorFilter("all");
  }, []);

  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset] as const)), [assets]);

  const filteredAssets = useMemo(
    () =>
      assets.filter((asset) => {
        const isUsed = usageByAssetId.has(asset.id);
        const matchesUsage =
          assetFilter === "all" ||
          (assetFilter === "used" && isUsed) ||
          (assetFilter === "unused" && !isUsed);

        return (
          matchesUsage &&
          matchesPhotoFilters(asset, {
            pickStatus: pickFilter,
            ratingFilter,
            colorLabel: colorFilter
          })
        );
      }),
    [assets, usageByAssetId, assetFilter, pickFilter, ratingFilter, colorFilter]
  );

  const firstVisibleIndex = Math.max(0, Math.floor(scrollLeft / ITEM_WIDTH));
  const startIndex = Math.max(0, firstVisibleIndex - OVERSCAN_ITEMS);
  const endIndex = Math.min(startIndex + visibleItems + OVERSCAN_ITEMS * 2, filteredAssets.length);

  const updateAssetMetadata = useCallback(
    (
      assetId: string,
      changes: Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">>
    ) => {
      if (!onAssetsMetadataChange) {
        return;
      }

      onAssetsMetadataChange(new Map([[assetId, changes]]));
    },
    [onAssetsMetadataChange]
  );

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const nextScrollLeft = event.currentTarget.scrollLeft;

    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
    }

    scrollFrameRef.current = requestAnimationFrame(() => {
      setScrollLeft(nextScrollLeft);
      scrollFrameRef.current = null;
    });
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const syncVisibleItems = () => {
      setVisibleItems(Math.max(4, Math.ceil(container.clientWidth / ITEM_WIDTH) + 1));
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        container.scrollBy({ left: -ITEM_WIDTH, behavior: "smooth" });
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        container.scrollBy({ left: ITEM_WIDTH, behavior: "smooth" });
      }
    };

    syncVisibleItems();
    container.addEventListener("keydown", handleKeyDown);
    const resizeObserver = new ResizeObserver(syncVisibleItems);
    resizeObserver.observe(container);

    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      resizeObserver.disconnect();
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

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

  const visibleAssets =
    variant === "vertical" ? filteredAssets : filteredAssets.slice(startIndex, endIndex);
  const visibleRangeStart = filteredAssets.length === 0 ? 0 : variant === "horizontal" ? firstVisibleIndex + 1 : 1;
  const visibleRangeEnd = filteredAssets.length === 0
    ? 0
    : variant === "horizontal"
      ? Math.min(firstVisibleIndex + visibleItems, filteredAssets.length)
      : filteredAssets.length;
  const visibleCount =
    filteredAssets.length === 0
      ? 0
      : variant === "horizontal"
        ? Math.max(0, visibleRangeEnd - visibleRangeStart + 1)
        : filteredAssets.length;
  const ribbonStatusLabel =
    filteredAssets.length === 0
      ? "Nessuna foto visibile"
      : variant === "horizontal" && filteredAssets.length > visibleCount
        ? `${visibleRangeStart}-${visibleRangeEnd} di ${filteredAssets.length} foto`
        : `${filteredAssets.length} foto visibili`;
  const ribbonHint =
    filteredAssets.length === 0
      ? "Modifica i filtri o cambia raccolta per vedere altre foto."
      : hasActiveFilters
        ? "Filtri attivi: puoi azzerarli per tornare all'intera libreria."
        : variant === "vertical"
          ? "Scorri la libreria per vedere tutte le foto disponibili."
          : "Usa rotella o frecce per scorrere la libreria.";

  return (
    <div
      className={
        variant === "vertical"
          ? "layout-photo-ribbon layout-photo-ribbon--vertical"
          : "layout-photo-ribbon"
      }
    >
      <div className="ribbon-header-compact">
        <div className="ribbon-header-compact__top">
          <span className="ribbon-header-compact__title">Libreria foto</span>
          <span className="ribbon-header-compact__count">
            {usageByAssetId.size} usate / {assets.length - usageByAssetId.size} libere
          </span>
          <PhotoClassificationHelpButton
            className="ribbon-header-compact__help"
            title="Scorciatoie libreria foto"
          />
        </div>
        <div className="ribbon-header-compact__segments">
          {([
            ["all", "Tutte"],
            ["unused", "Non usate"],
            ["used", "Usate"]
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={assetFilter === value ? "segment segment--active" : "segment"}
              onClick={() => onAssetFilterChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="ribbon-filters-collapsible">
        <button
          type="button"
          className={`ribbon-filters-collapsible__toggle ${hasActiveFilters ? "ribbon-filters-collapsible__toggle--active" : ""}`}
          onClick={() => setFiltersOpen((prev) => !prev)}
        >
          <span>
            Filtri avanzati{" "}
            {hasActiveFilters
              ? `(${[
                  pickFilter !== "all" ? 1 : 0,
                  ratingFilter !== "any" ? 1 : 0,
                  colorFilter !== "all" ? 1 : 0
                ].reduce((sum, value) => sum + value, 0)})`
              : ""}
          </span>
          <span className="ribbon-filters-collapsible__arrow">{filtersOpen ? "^" : "v"}</span>
        </button>
        {filtersOpen && (
          <div className="ribbon-filters-collapsible__body">
            {hasActiveFilters ? (
              <button
                type="button"
                className="layout-photo-ribbon__reset"
                onClick={resetFilters}
                title="Azzera tutti i filtri"
              >
                X Azzera
              </button>
            ) : null}

            <select
              className={
                pickFilter !== "all"
                  ? "layout-photo-ribbon__select layout-photo-ribbon__select--active"
                  : "layout-photo-ribbon__select"
              }
              value={pickFilter}
              onChange={(event) => setPickFilter(event.target.value as "all" | PickStatus)}
              aria-label="Filtra per stato"
            >
              <option value="all">Tutti gli stati</option>
              <option value="picked">Solo pick</option>
              <option value="rejected">Solo scartate</option>
              <option value="unmarked">Solo neutre</option>
            </select>

            <select
              className={
                ratingFilter !== "any"
                  ? "layout-photo-ribbon__select layout-photo-ribbon__select--active"
                  : "layout-photo-ribbon__select"
              }
              value={ratingFilter}
              onChange={(event) => setRatingFilter(event.target.value)}
              aria-label="Filtra per stelle"
            >
              <option value="any">Tutte le stelle</option>
              <optgroup label="Minimo">
                <option value="1+">1+ stelle</option>
                <option value="2+">2+ stelle</option>
                <option value="3+">3+ stelle</option>
                <option value="4+">4+ stelle</option>
              </optgroup>
              <optgroup label="Esattamente">
                <option value="0">Senza stelle</option>
                <option value="1">Solo 1 stella</option>
                <option value="2">Solo 2 stelle</option>
                <option value="3">Solo 3 stelle</option>
                <option value="4">Solo 4 stelle</option>
                <option value="5">Solo 5 stelle</option>
              </optgroup>
            </select>

            <div className="layout-photo-ribbon__color-filter" aria-label="Filtra per colore">
              <button
                type="button"
                className={
                  colorFilter === "all"
                    ? "layout-photo-ribbon__color-chip layout-photo-ribbon__color-chip--all layout-photo-ribbon__color-chip--active"
                    : "layout-photo-ribbon__color-chip layout-photo-ribbon__color-chip--all"
                }
                onClick={() => setColorFilter("all")}
              >
                Tutti
              </button>
              {COLOR_LABELS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={
                    colorFilter === value
                      ? `layout-photo-ribbon__color-chip layout-photo-ribbon__color-chip--${value} layout-photo-ribbon__color-chip--active`
                      : `layout-photo-ribbon__color-chip layout-photo-ribbon__color-chip--${value}`
                  }
                  onClick={() => setColorFilter(value)}
                  title={COLOR_LABEL_NAMES[value]}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="layout-photo-ribbon__track-wrapper">
        <div
          ref={scrollContainerRef}
          className={
            variant === "vertical"
              ? "layout-photo-ribbon__track layout-photo-ribbon__track--vertical"
              : "layout-photo-ribbon__track"
          }
          onScroll={variant === "vertical" ? undefined : handleScroll}
          role="region"
          aria-label={
            variant === "vertical"
              ? "Libreria foto verticale"
              : "Nastro fotografico - usa frecce per scorrere"
          }
          tabIndex={0}
        >
          {variant === "horizontal" && startIndex > 0 ? (
            <div style={{ width: startIndex * ITEM_WIDTH, flexShrink: 0 }} />
          ) : null}

          {visibleAssets.map((asset) => {
            const usage = usageByAssetId.get(asset.id);
            const isActive = dragState?.imageId === asset.id;
            const rating = getAssetRating(asset);
            const pickStatus = getAssetPickStatus(asset);
            const isUsed = Boolean(usage);
            const displayFileName = asset.fileName ?? "Senza nome";

            return (
              <button
                key={asset.id}
                type="button"
                draggable
                data-preview-asset-id={asset.id}
                className={[
                  "ribbon-photo",
                  variant === "vertical" ? "ribbon-photo--vertical" : "",
                  isActive ? "ribbon-photo--dragging" : "",
                  isUsed ? "ribbon-photo--used" : "",
                  asset.colorLabel ? `ribbon-photo--label-${asset.colorLabel}` : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/plain", asset.id);
                  event.dataTransfer.effectAllowed = "move";
                  onDragAssetStart(asset.id);
                }}
                onDragEnd={onDragEnd}
                onContextMenu={(event) => {
                  if (!onAssetsMetadataChange) {
                    return;
                  }
                  event.preventDefault();
                  setContextMenuState({
                    assetId: asset.id,
                    x: event.clientX,
                    y: event.clientY
                  });
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && onAssetDoubleClick) {
                    event.preventDefault();
                    onAssetDoubleClick(asset.id);
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
                    updateAssetMetadata(asset.id, shortcutChanges);
                  }
                }}
                onMouseEnter={() => {
                  const url = asset.previewUrl ?? asset.thumbnailUrl;
                  if (url) preloadImageUrls([url]);
                }}
                onDoubleClick={() => onAssetDoubleClick?.(asset.id)}
              >
                {asset.thumbnailUrl ?? asset.previewUrl ? (
                  <img
                    src={asset.thumbnailUrl ?? asset.previewUrl}
                    alt={displayFileName}
                    className="ribbon-photo__image"
                    loading="lazy"
                  />
                ) : (
                  <div className="ribbon-photo__placeholder">{displayFileName}</div>
                )}
                {isUsed ? <span className="ribbon-photo__usage-overlay">Usata</span> : null}
                <div className="ribbon-photo__badges">
                  <span className={`asset-pick-badge asset-pick-badge--${pickStatus}`}>
                    {PICK_STATUS_LABELS[pickStatus]}
                  </span>
                  {asset.colorLabel ? (
                    <span className={`asset-color-dot asset-color-dot--${asset.colorLabel}`} />
                  ) : null}
                  {usage ? (
                    <span className="ribbon-photo__usage-chip">{`F.${usage.pageNumber}`}</span>
                  ) : null}
                </div>
                <div className="ribbon-photo__meta">
                  <strong>
                    {variant === "vertical"
                      ? displayFileName
                      : displayFileName.substring(0, 14)}
                  </strong>
                  {variant === "vertical" ? (
                    <span>
                      {usage ? `Foglio ${usage.pageNumber}` : "Disponibile"}
                      {rating > 0 ? ` / ${formatAssetStars(asset)}` : ""}
                    </span>
                  ) : (
                    <>
                      <span>{usage ? `Foglio ${usage.pageNumber}` : "Disponibile"}</span>
                      {rating > 0 ? <small>{formatAssetStars(asset)}</small> : null}
                    </>
                  )}
                </div>
              </button>
            );
          })}

          {variant === "horizontal" && endIndex < filteredAssets.length ? (
            <div
              style={{ width: (filteredAssets.length - endIndex) * ITEM_WIDTH, flexShrink: 0 }}
            />
          ) : null}
        </div>
      </div>

      <div className="layout-photo-ribbon__hint">
        <small>{ribbonStatusLabel}</small>
        <small>{ribbonHint}</small>
      </div>

      {contextMenuState ? (
        <PhotoColorContextMenu
          x={contextMenuState.x}
          y={contextMenuState.y}
          selectedColor={assetById.get(contextMenuState.assetId)?.colorLabel ?? null}
          onSelect={(colorLabel) => {
            updateAssetMetadata(contextMenuState.assetId, { colorLabel });
            setContextMenuState(null);
          }}
        />
      ) : null}
    </div>
  );
}

export const PhotoRibbon = memo(PhotoRibbonContent);
PhotoRibbon.displayName = "PhotoRibbon";
