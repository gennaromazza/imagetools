import { useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import type { ColorLabel, ImageAsset, PickStatus } from "@photo-tools/shared-types";
import {
  COLOR_LABEL_NAMES,
  COLOR_LABELS,
  formatAssetStars,
  getAssetColorLabel,
  getAssetPickStatus,
  getAssetRating,
  PICK_STATUS_LABELS
} from "../photo-classification";

interface PhotoQuickPreviewModalProps {
  asset: ImageAsset | null;
  assets?: ImageAsset[];
  usageByAssetId?: Map<string, { pageNumber: number; pageId?: string; slotId?: string }>;
  pages?: Array<{ id: string; pageNumber: number; templateLabel?: string }>;
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

  const currentIndex = useMemo(
    () => (asset ? assets.findIndex((item) => item.id === asset.id) : -1),
    [asset, assets]
  );
  const previousAsset = currentIndex > 0 ? assets[currentIndex - 1] : null;
  const nextAsset = currentIndex >= 0 && currentIndex < assets.length - 1 ? assets[currentIndex + 1] : null;
  const previewStrip = useMemo(() => {
    if (!asset || assets.length === 0 || currentIndex < 0) {
      return [];
    }

    return assets.slice(Math.max(0, currentIndex - 4), Math.min(assets.length, currentIndex + 5));
  }, [asset, assets, currentIndex]);

  const handleNavigate = useCallback(
    (direction: "previous" | "next") => {
      if (!onSelectAsset || currentIndex < 0) {
        return;
      }

      const targetIndex = direction === "previous" ? currentIndex - 1 : currentIndex + 1;
      const targetAsset = assets[targetIndex];
      if (targetAsset) {
        onSelectAsset(targetAsset.id);
      }
    },
    [assets, currentIndex, onSelectAsset]
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

  const activePage = useMemo(
    () => pages.find((page) => page.id === activePageId) ?? null,
    [activePageId, pages]
  );

  const handleAddToPage = useCallback(
    (pageId: string) => {
      if (!asset || !onAddToPage) {
        return;
      }

      onAddToPage(pageId, asset.id);
    },
    [asset, onAddToPage]
  );

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
      const normalizedKey = event.key.toLowerCase();

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
        onAddToPage(activePage.id, asset.id);
        return;
      }

      if (!onUpdateAsset) {
        return;
      }

      if (/^[0-5]$/.test(event.key)) {
        event.preventDefault();
        updateRating(Number(event.key));
        return;
      }

      if (normalizedKey === "p") {
        event.preventDefault();
        updatePickStatus("picked");
        return;
      }

      if (normalizedKey === "x") {
        event.preventDefault();
        updatePickStatus("rejected");
        return;
      }

      if (normalizedKey === "u") {
        event.preventDefault();
        updatePickStatus("unmarked");
        return;
      }

      if (event.code === "Digit6") {
        event.preventDefault();
        updateColorLabel("red");
        return;
      }

      if (event.code === "Digit7") {
        event.preventDefault();
        updateColorLabel("yellow");
        return;
      }

      if (event.code === "Digit8") {
        event.preventDefault();
        updateColorLabel("green");
        return;
      }

      if (event.code === "Digit9") {
        event.preventDefault();
        updateColorLabel("blue");
        return;
      }

      if (normalizedKey === "v") {
        event.preventDefault();
        updateColorLabel("purple");
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePage, asset, handleNavigate, onAddToPage, onClose, onUpdateAsset, updateColorLabel, updatePickStatus, updateRating]);

  if (!asset) {
    return null;
  }

  const previewUrl = asset.sourceUrl ?? asset.previewUrl ?? asset.thumbnailUrl;
  const usage = usageByAssetId?.get(asset.id);
  const rating = getAssetRating(asset);
  const pickStatus = getAssetPickStatus(asset);
  const colorLabel = getAssetColorLabel(asset);
  const previewContent = (
    <div className="quick-preview" onClick={onClose} role="dialog" aria-modal="true" aria-label="Anteprima foto a schermo intero">
      <div className="quick-preview__chrome">
        <div className="quick-preview__title">
          <strong>{asset.fileName}</strong>
          <span>
            {asset.width} x {asset.height} · {orientationLabels[asset.orientation]}
            {usage ? ` · Foglio ${usage.pageNumber}` : " · Non ancora usata nel layout"}
          </span>
        </div>

        <div className="quick-preview__actions">
          <span className="quick-preview__stars">{formatAssetStars(asset)}</span>
          <button type="button" className="ghost-button quick-preview__action" onClick={toggleNativeFullscreen}>
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
                className={value <= rating ? "quick-preview__star quick-preview__star--active" : "quick-preview__star"}
                onClick={() => updateRating(value)}
              >
                ★
              </button>
            ))}
            <button type="button" className="ghost-button quick-preview__tiny-action" onClick={() => updateRating(0)}>
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
                className={pickStatus === value ? "quick-preview__pill quick-preview__pill--active" : "quick-preview__pill"}
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
              className={colorLabel === null ? "quick-preview__color-chip quick-preview__color-chip--clear quick-preview__color-chip--selected" : "quick-preview__color-chip quick-preview__color-chip--clear"}
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
                title={COLOR_LABEL_NAMES[value]}
              />
            ))}
          </div>
        </div>
      </div>

      {pages.length > 0 && onAddToPage ? (
        <div className="quick-preview__assign-bar" onClick={(event) => event.stopPropagation()}>
          <div className="quick-preview__assign-copy">
            <strong>Aggiungi direttamente al layout</strong>
            <span>
              {activePage
                ? `Invio aggiunge al foglio attivo ${activePage.pageNumber}.`
                : "Scegli un foglio qui sotto per aggiungere subito la foto."}
            </span>
          </div>
          <div className="quick-preview__assign-actions">
            {activePage ? (
              <button
                type="button"
                className="secondary-button quick-preview__assign-button quick-preview__assign-button--active"
                onClick={() => handleAddToPage(activePage.id)}
              >
                {`Aggiungi al foglio attivo ${activePage.pageNumber}`}
              </button>
            ) : null}
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
          <div className="quick-preview__page-strip">
            {pages.map((page) => {
              const isActivePage = page.id === activePageId;
              return (
                <button
                  key={page.id}
                  type="button"
                  className={
                    isActivePage
                      ? "quick-preview__page-chip quick-preview__page-chip--active"
                      : "quick-preview__page-chip"
                  }
                  onClick={() => handleAddToPage(page.id)}
                  title={page.templateLabel ? page.templateLabel : `Foglio ${page.pageNumber}`}
                >
                  <strong>{`Foglio ${page.pageNumber}`}</strong>
                  <span>{isActivePage ? "Attivo" : "Aggiungi qui"}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="quick-preview__stage" ref={stageRef} onClick={(event) => event.stopPropagation()}>
        {previousAsset ? (
          <button type="button" className="quick-preview__nav quick-preview__nav--prev" onClick={() => handleNavigate("previous")}>
            ‹
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
          <button type="button" className="quick-preview__nav quick-preview__nav--next" onClick={() => handleNavigate("next")}>
            ›
          </button>
        ) : null}
      </div>

      {previewStrip.length > 0 ? (
        <div className="quick-preview__strip" onClick={(event) => event.stopPropagation()}>
          {previewStrip.map((item) => {
            const itemPreview = item.thumbnailUrl ?? item.previewUrl ?? item.sourceUrl;
            const isActive = item.id === asset.id;

            return (
              <button
                key={item.id}
                type="button"
                className={isActive ? "quick-preview__thumb quick-preview__thumb--active" : "quick-preview__thumb"}
                onClick={() => onSelectAsset?.(item.id)}
              >
                {itemPreview ? <img src={itemPreview} alt={item.fileName} className="quick-preview__thumb-image" /> : item.fileName}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );

  if (typeof document === "undefined") {
    return previewContent;
  }

  return createPortal(previewContent, document.body);
}
