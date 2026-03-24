import { useEffect } from "react";
import type { ImageAsset, PickStatus } from "@photo-tools/shared-types";
import {
  COLOR_LABEL_NAMES,
  COLOR_LABELS,
  formatAssetStars,
  getAssetColorLabel,
  getAssetPickStatus,
  getAssetRating,
  PICK_STATUS_LABELS,
} from "../services/photo-classification";

interface CompareModalProps {
  photos: ImageAsset[];
  onClose: () => void;
  onUpdatePhoto: (id: string, changes: Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">>) => void;
}

export function CompareModal({ photos, onClose, onUpdatePhoto }: CompareModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cols = photos.length <= 2 ? "1fr 1fr" : photos.length === 3 ? "1fr 1fr 1fr" : "1fr 1fr 1fr 1fr";

  return (
    <div className="compare-modal__overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="compare-modal" role="dialog" aria-label="Confronta foto">
        <div className="compare-modal__header">
          <span className="compare-modal__title">Confronta ({photos.length} foto)</span>
          <button type="button" className="icon-button" onClick={onClose} title="Chiudi (Esc)">
            ✕
          </button>
        </div>

        <div className="compare-modal__grid" style={{ gridTemplateColumns: cols }}>
          {photos.map((photo) => {
            const previewUrl = photo.previewUrl ?? photo.thumbnailUrl ?? photo.sourceUrl;
            const rating = getAssetRating(photo);
            const pickStatus = getAssetPickStatus(photo);
            const colorLabel = getAssetColorLabel(photo);

            return (
              <div key={photo.id} className="compare-modal__cell">
                <div className="compare-modal__image-wrap">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={photo.fileName}
                      className="compare-modal__image"
                    />
                  ) : (
                    <div className="compare-modal__placeholder">
                      <span>Anteprima non disponibile</span>
                    </div>
                  )}
                </div>

                <div className="compare-modal__meta">
                  <span className="compare-modal__filename" title={photo.fileName}>
                    {photo.fileName}
                  </span>
                  {photo.width > 0 && (
                    <span className="compare-modal__dims">
                      {Math.round(photo.width)}×{Math.round(photo.height)}
                    </span>
                  )}
                </div>

                <div className="compare-modal__controls" onClick={(e) => e.stopPropagation()}>
                  <div className="compare-modal__stars">
                    {[1, 2, 3, 4, 5].map((v) => (
                      <button
                        key={v}
                        type="button"
                        className={`photo-card__star${v <= rating ? " photo-card__star--active" : ""}`}
                        onClick={() => onUpdatePhoto(photo.id, { rating: v })}
                        title={`${v} stelle`}
                      >
                        ★
                      </button>
                    ))}
                    {rating > 0 && (
                      <span className="compare-modal__rating-label">{formatAssetStars(photo)}</span>
                    )}
                  </div>

                  <div className="compare-modal__pills">
                    {(["picked", "rejected", "unmarked"] as PickStatus[]).map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={`photo-card__pill${pickStatus === value ? " photo-card__pill--active" : ""}`}
                        onClick={() => onUpdatePhoto(photo.id, { pickStatus: value })}
                      >
                        {PICK_STATUS_LABELS[value]}
                      </button>
                    ))}
                  </div>

                  <div className="compare-modal__dots">
                    <button
                      type="button"
                      className="ghost-button ghost-button--small"
                      onClick={() => onUpdatePhoto(photo.id, { colorLabel: null })}
                      title="Nessun colore"
                    >
                      ✕
                    </button>
                    {COLOR_LABELS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={`asset-color-dot asset-color-dot--${value}${colorLabel === value ? " asset-color-dot--selected" : ""}`}
                        onClick={() =>
                          onUpdatePhoto(photo.id, { colorLabel: colorLabel === value ? null : value })
                        }
                        title={COLOR_LABEL_NAMES[value]}
                      />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
