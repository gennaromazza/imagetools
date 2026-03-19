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

  const hasActiveFilters =
    pickFilter !== "all" || ratingFilter !== "any" || colorFilter !== "all";

  function resetFilters() {
    setPickFilter("all");
    setRatingFilter("any");
    setColorFilter("all");
  }
  const [contextMenuState, setContextMenuState] = useState<{
    assetId: string;
    x: number;
    y: number;
  } | null>(null);

  const filteredAssets = useMemo(
    () =>
      assets.filter((asset) =>
        matchesPhotoFilters(asset, {
          pickStatus: pickFilter,
          ratingFilter,
          colorLabel: colorFilter
        })
      ),
    [assets, colorFilter, ratingFilter, pickFilter]
  );

  const startIndex = Math.max(0, Math.floor(scrollLeft / ITEM_WIDTH) - 1);
  const endIndex = Math.min(startIndex + visibleItems + OVERSCAN_ITEMS, filteredAssets.length);

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

  return (
    <div
      className={
        variant === "vertical"
          ? "layout-photo-ribbon layout-photo-ribbon--vertical"
          : "layout-photo-ribbon"
      }
    >
      <div className="layout-photo-ribbon__header">
        <div className="segmented-control">
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
        <span className="helper-inline">
          {usageByAssetId.size} usate | {assets.length - usageByAssetId.size} libere
        </span>
        <PhotoClassificationHelpButton
          className="layout-photo-ribbon__help"
          title="Scorciatoie libreria foto"
        />
      </div>

      <div className="layout-photo-ribbon__filters">
        {hasActiveFilters ? (
          <button
            type="button"
            className="layout-photo-ribbon__reset"
            onClick={resetFilters}
            title="Azzera tutti i filtri"
          >
            ✕ Azzera
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
            <option value="1+">★ 1+ stelle</option>
            <option value="2+">★★ 2+ stelle</option>
            <option value="3+">★★★ 3+ stelle</option>
            <option value="4+">★★★★ 4+ stelle</option>
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
                    alt={asset.fileName}
                    className="ribbon-photo__image"
                    loading="lazy"
                  />
                ) : (
                  <div className="ribbon-photo__placeholder">{asset.fileName}</div>
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
                    <span className="ribbon-photo__usage-chip">{`Foglio ${usage.pageNumber}`}</span>
                  ) : null}
                </div>
                <div className="ribbon-photo__meta">
                  <strong>{asset.fileName?.substring(0, 12)}</strong>
                  <span>{usage ? `Foglio ${usage.pageNumber}` : "Disponibile"}</span>
                  {rating > 0 ? <small>{formatAssetStars(asset)}</small> : null}
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
        <small>
          {variant === "vertical"
            ? `${filteredAssets.length} foto visibili | Doppio click assegna allo slot | Ctrl/Cmd + 6/7/8/9/V imposta il colore`
            : `${filteredAssets.length} foto visibili | Usa frecce sx/dx per scorrere | Ctrl/Cmd + 6/7/8/9/V imposta il colore`}
        </small>
      </div>

      {contextMenuState ? (
        <PhotoColorContextMenu
          x={contextMenuState.x}
          y={contextMenuState.y}
          selectedColor={
            assets.find((asset) => asset.id === contextMenuState.assetId)?.colorLabel ?? null
          }
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
