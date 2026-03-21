import { memo, useEffect, useRef, useState } from "react";
import type { ColorLabel, ImageAsset, PickStatus } from "@photo-tools/shared-types";
import { preloadImageUrls } from "../services/image-cache";
import {
  COLOR_LABEL_NAMES,
  COLOR_LABELS,
  formatAssetStars,
  getAssetColorLabel,
  getAssetPickStatus,
  getAssetRating,
  getColorShortcutHint,
  PICK_STATUS_LABELS,
  resolvePhotoClassificationShortcut,
} from "../services/photo-classification";
import { isRawFile } from "../services/folder-access";

interface PhotoCardProps {
  photo: ImageAsset;
  isSelected: boolean;
  onToggle: (id: string, event?: React.MouseEvent) => void;
  onUpdatePhoto: (
    id: string,
    changes: Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">>
  ) => void;
  onFocus: (id: string) => void;
  onPreview: (id: string) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  editable: boolean;
}

type CardFeedback = {
  kind: "star" | "pill" | "dot";
  label: string;
  token: number;
  value?: number | ColorLabel | PickStatus | null;
};

export const PhotoCard = memo(
  function PhotoCard({
    photo,
    isSelected,
    onToggle,
    onUpdatePhoto,
    onFocus,
    onPreview,
    onContextMenu,
    editable,
  }: PhotoCardProps) {
    const previewUrl = photo.thumbnailUrl ?? photo.previewUrl ?? photo.sourceUrl;
    const aspectRatio =
      photo.width > 0 && photo.height > 0 ? `${photo.width} / ${photo.height}` : undefined;
    const rating = getAssetRating(photo);
    const pickStatus = getAssetPickStatus(photo);
    const colorLabel = getAssetColorLabel(photo);
    const raw = isRawFile(photo.fileName);

    const prevClassRef = useRef({ rating, pickStatus, colorLabel });
    const wrapperRef = useRef<HTMLDivElement>(null);
    const feedbackTimeoutRef = useRef<number | null>(null);
    const feedbackTokenRef = useRef(0);
    const [feedback, setFeedback] = useState<CardFeedback | null>(null);

    useEffect(() => {
      const prev = prevClassRef.current;
      let nextFeedback: CardFeedback | null = null;

      if (prev.rating !== rating) {
        feedbackTokenRef.current += 1;
        nextFeedback = {
          kind: "star",
          label: rating > 0 ? `${"★".repeat(rating)} assegnate` : "Stelle azzerate",
          token: feedbackTokenRef.current,
          value: rating,
        };
      } else if (prev.pickStatus !== pickStatus) {
        feedbackTokenRef.current += 1;
        nextFeedback = {
          kind: "pill",
          label: `Stato: ${PICK_STATUS_LABELS[pickStatus]}`,
          token: feedbackTokenRef.current,
          value: pickStatus,
        };
      } else if (prev.colorLabel !== colorLabel) {
        feedbackTokenRef.current += 1;
        nextFeedback = {
          kind: "dot",
          label: colorLabel ? `Colore: ${COLOR_LABEL_NAMES[colorLabel]}` : "Colore rimosso",
          token: feedbackTokenRef.current,
          value: colorLabel,
        };
      }

      prevClassRef.current = { rating, pickStatus, colorLabel };

      if (feedbackTimeoutRef.current !== null) {
        window.clearTimeout(feedbackTimeoutRef.current);
        feedbackTimeoutRef.current = null;
      }

      if (!nextFeedback) {
        return;
      }

      setFeedback(nextFeedback);

      if (wrapperRef.current) {
        const el = wrapperRef.current;
        el.classList.remove("photo-card__image-wrapper--flash");
        void el.offsetWidth;
        el.classList.add("photo-card__image-wrapper--flash");
      }

      feedbackTimeoutRef.current = window.setTimeout(() => {
        setFeedback((current) => (current?.token === nextFeedback?.token ? null : current));
        feedbackTimeoutRef.current = null;
      }, 950);
    }, [colorLabel, pickStatus, rating]);

    useEffect(() => {
      return () => {
        if (feedbackTimeoutRef.current !== null) {
          window.clearTimeout(feedbackTimeoutRef.current);
        }
      };
    }, []);

    const orientationIcon =
      photo.orientation === "vertical" ? "↕" : photo.orientation === "square" ? "◻" : "↔";
    return (
      <div
        className={`photo-card ${isSelected ? "photo-card--selected" : ""}`}
        role="option"
        tabIndex={0}
        aria-selected={isSelected}
        aria-label={`${photo.fileName}${isSelected ? ", selezionata" : ", non selezionata"}`}
        aria-keyshortcuts="Enter Space 1 2 3 4 5 P X U"
        data-preview-asset-id={photo.id}
        onClick={(event) => onToggle(photo.id, event)}
        onFocus={() => onFocus(photo.id)}
        onMouseEnter={() => {
          if (photo.previewUrl) preloadImageUrls([photo.previewUrl]);
        }}
        onDoubleClick={() => onPreview(photo.id)}
        onContextMenu={(event) => {
          if (!editable) return;
          event.preventDefault();
          onContextMenu(photo.id, event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onToggle(photo.id);
            return;
          }
          if (event.key === " ") {
            event.preventDefault();
            onPreview(photo.id);
            return;
          }
          if (editable) {
            const changes = resolvePhotoClassificationShortcut({
              key: event.key,
              code: event.code,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
            });
            if (changes) {
              event.preventDefault();
              onUpdatePhoto(photo.id, changes);
            }
          }
        }}
      >
        <div
          ref={wrapperRef}
          className="photo-card__image-wrapper"
          style={aspectRatio ? { aspectRatio } : undefined}
        >
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={photo.fileName}
              className="photo-card__image"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div
              className={`photo-card__image photo-card__image--placeholder${
                raw ? " photo-card__image--placeholder-raw" : ""
              }`}
            >
              <span className="photo-card__placeholder-icon">{raw ? "📷" : orientationIcon}</span>
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
            ) : (
              <span className="photo-card__empty-color">Nessun colore</span>
            )}
          </div>

          <div className="photo-card__select-badge">
            <div
              className={`photo-card__check ${isSelected ? "photo-card__check--active" : ""}`}
            >
              {isSelected ? "✓" : ""}
            </div>
          </div>

          {raw ? (
            <span className="asset-pick-badge asset-raw-badge photo-card__raw-badge">RAW</span>
          ) : null}

          <div
            className={
              feedback?.kind === "star"
                ? "photo-card__stars photo-card__stars--feedback"
                : "photo-card__stars"
            }
          >
            {rating > 0 ? formatAssetStars(photo) : "Senza stelle"}
          </div>

          {feedback ? (
            <div
              key={feedback.token}
              className={`photo-card__feedback photo-card__feedback--${feedback.kind}`}
            >
              {feedback.label}
            </div>
          ) : null}
        </div>

        <div className="photo-card__info">
          <div className="photo-card__name" title={photo.fileName}>
            {photo.fileName}
          </div>
          <div className="photo-card__meta">
            <span className="photo-card__orientation-icon" title={photo.orientation}>
              {orientationIcon}
            </span>
            {photo.width > 0 ? (
              <span className="photo-card__dimensions">
                {Math.round(photo.width)}×{Math.round(photo.height)}
              </span>
            ) : null}
          </div>
        </div>

        {editable ? (
          <div className="photo-card__toolbar" onClick={(event) => event.stopPropagation()}>
            <div className="photo-card__tiny-actions">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={[
                    "photo-card__star",
                    value <= rating ? "photo-card__star--active" : "",
                    feedback?.kind === "star" && feedback.value === value
                      ? "photo-card__star--flash"
                      : "",
                  ].join(" ")}
                  onClick={() => onUpdatePhoto(photo.id, { rating: value })}
                  title={`${value} stella${value > 1 ? "e" : ""} | tasto ${value}`}
                >
                  ★
                </button>
              ))}
            </div>

            <div className="photo-card__toolbar-row">
              {(["picked", "rejected", "unmarked"] as PickStatus[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={[
                    "photo-card__pill",
                    pickStatus === value ? "photo-card__pill--active" : "",
                    feedback?.kind === "pill" && feedback.value === value
                      ? "photo-card__pill--flash"
                      : "",
                  ].join(" ")}
                  onClick={() => onUpdatePhoto(photo.id, { pickStatus: value })}
                  title={
                    value === "picked"
                      ? "Pick | P"
                      : value === "rejected"
                        ? "Scarta | X"
                        : "Neutra | U"
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
                  className={[
                    "asset-color-dot",
                    `asset-color-dot--${value}`,
                    colorLabel === value ? "asset-color-dot--selected" : "",
                    feedback?.kind === "dot" && feedback.value === value
                      ? "asset-color-dot--flash"
                      : "",
                  ].join(" ")}
                  onClick={() =>
                    onUpdatePhoto(photo.id, {
                      colorLabel: colorLabel === value ? null : value,
                    })
                  }
                  title={`${COLOR_LABEL_NAMES[value]} | ${getColorShortcutHint(value)}`}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  },
  (prev, next) =>
    prev.photo === next.photo &&
    prev.isSelected === next.isSelected &&
    prev.editable === next.editable
);
