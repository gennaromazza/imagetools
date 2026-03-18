import { memo, useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import type { ColorLabel, ImageAsset, PickStatus } from "@photo-tools/shared-types";
import { COLOR_LABELS, formatAssetStars, getAssetPickStatus, getAssetRating, PICK_STATUS_LABELS } from "../photo-classification";

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
  onAssetDoubleClick
}: PhotoRibbonProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [visibleItems, setVisibleItems] = useState(8);
  const [pickFilter, setPickFilter] = useState<"all" | PickStatus>("all");
  const [minimumRating, setMinimumRating] = useState(0);
  const [colorFilter, setColorFilter] = useState<"all" | ColorLabel>("all");

  const filteredAssets = useMemo(
    () =>
      assets.filter((asset) => {
        if (pickFilter !== "all" && getAssetPickStatus(asset) !== pickFilter) {
          return false;
        }

        if (colorFilter !== "all" && asset.colorLabel !== colorFilter) {
          return false;
        }

        return getAssetRating(asset) >= minimumRating;
      }),
    [assets, colorFilter, minimumRating, pickFilter]
  );

  const startIndex = Math.max(0, Math.floor(scrollLeft / ITEM_WIDTH) - 1);
  const endIndex = Math.min(startIndex + visibleItems + OVERSCAN_ITEMS, filteredAssets.length);

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

  const visibleAssets = variant === "vertical" ? filteredAssets : filteredAssets.slice(startIndex, endIndex);

  return (
    <div className={variant === "vertical" ? "layout-photo-ribbon layout-photo-ribbon--vertical" : "layout-photo-ribbon"}>
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
      </div>

      <div className="layout-photo-ribbon__filters">
        <select
          className="layout-photo-ribbon__select"
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
          className="layout-photo-ribbon__select"
          value={minimumRating}
          onChange={(event) => setMinimumRating(Number(event.target.value))}
          aria-label="Filtra per stelle minime"
        >
          <option value={0}>Tutte le stelle</option>
          <option value={1}>1+ stelle</option>
          <option value={2}>2+ stelle</option>
          <option value={3}>3+ stelle</option>
          <option value={4}>4+ stelle</option>
          <option value={5}>5 stelle</option>
        </select>

        <div className="layout-photo-ribbon__color-filter" aria-label="Filtra per colore">
          <button
            type="button"
            className={colorFilter === "all" ? "layout-photo-ribbon__color-chip layout-photo-ribbon__color-chip--all layout-photo-ribbon__color-chip--active" : "layout-photo-ribbon__color-chip layout-photo-ribbon__color-chip--all"}
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
              title={value}
            />
          ))}
        </div>
      </div>

      <div className="layout-photo-ribbon__track-wrapper">
        <div
          ref={scrollContainerRef}
          className={variant === "vertical" ? "layout-photo-ribbon__track layout-photo-ribbon__track--vertical" : "layout-photo-ribbon__track"}
          onScroll={variant === "vertical" ? undefined : handleScroll}
          role="region"
          aria-label={variant === "vertical" ? "Libreria foto verticale" : "Nastro fotografico - usa frecce per scorrere"}
          tabIndex={0}
        >
          {variant === "horizontal" && startIndex > 0 ? <div style={{ width: startIndex * ITEM_WIDTH, flexShrink: 0 }} /> : null}

          {visibleAssets.map((asset) => {
            const usage = usageByAssetId.get(asset.id);
            const isActive = dragState?.imageId === asset.id;
            const rating = getAssetRating(asset);
            const pickStatus = getAssetPickStatus(asset);

            return (
              <button
                key={asset.id}
                type="button"
                draggable
                data-preview-asset-id={asset.id}
                className={
                  variant === "vertical"
                    ? isActive
                      ? `ribbon-photo ribbon-photo--vertical ribbon-photo--dragging${asset.colorLabel ? ` ribbon-photo--label-${asset.colorLabel}` : ""}`
                      : `ribbon-photo ribbon-photo--vertical${asset.colorLabel ? ` ribbon-photo--label-${asset.colorLabel}` : ""}`
                    : isActive
                      ? `ribbon-photo ribbon-photo--dragging${asset.colorLabel ? ` ribbon-photo--label-${asset.colorLabel}` : ""}`
                      : `ribbon-photo${asset.colorLabel ? ` ribbon-photo--label-${asset.colorLabel}` : ""}`
                }
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/plain", asset.id);
                  onDragAssetStart(asset.id);
                }}
                onDragEnd={onDragEnd}
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
                <div className="ribbon-photo__badges">
                  <span className={`asset-pick-badge asset-pick-badge--${pickStatus}`}>{PICK_STATUS_LABELS[pickStatus]}</span>
                  {asset.colorLabel ? <span className={`asset-color-dot asset-color-dot--${asset.colorLabel}`} /> : null}
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
            <div style={{ width: (filteredAssets.length - endIndex) * ITEM_WIDTH, flexShrink: 0 }} />
          ) : null}
        </div>
      </div>

      <div className="layout-photo-ribbon__hint">
        <small>
          {variant === "vertical"
            ? `${filteredAssets.length} foto visibili · Trascina a destra per assegnare | Doppio click per lo slot selezionato`
            : `${filteredAssets.length} foto visibili · Usa frecce sx/dx per scorrere | Doppio click per assegnare allo slot selezionato`}
        </small>
      </div>
    </div>
  );
}

export const PhotoRibbon = memo(PhotoRibbonContent);
PhotoRibbon.displayName = "PhotoRibbon";
