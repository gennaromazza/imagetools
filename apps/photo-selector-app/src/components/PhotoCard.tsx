import { memo, useEffect, useRef, useState, type DragEvent } from "react";
import type { ColorLabel, ImageAsset, PickStatus } from "@photo-tools/shared-types";
import { preloadImageUrls } from "../services/image-cache";
import { notePhotoCardRender } from "../services/performance-utils";
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
import type { CustomLabelShortcut, CustomLabelTone } from "../services/photo-selector-preferences";

interface PhotoCardProps {
  photo: ImageAsset;
  isSelected: boolean;
  onToggle: (id: string, event?: React.MouseEvent) => void;
  onUpdatePhoto: (
    id: string,
    changes: Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel" | "customLabels">>
  ) => void;
  onFocus: (id: string) => void;
  onPreview: (id: string) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  onExternalDragStart?: (id: string, event: DragEvent<HTMLDivElement>) => void;
  canExternalDrag?: boolean;
  customLabelColors?: Record<string, CustomLabelTone>;
  customLabelShortcuts?: Record<string, CustomLabelShortcut | null>;
  disableNonEssentialUi?: boolean;
  batchPulseToken?: number;
  batchPulseKind?: "dot" | "label" | null;
  editable: boolean;
}

type CardFeedback = {
  kind: "star" | "pill" | "dot" | "label";
  label: string;
  token: number;
  value?: number | ColorLabel | PickStatus | null;
  labels?: string[];
};

function areLabelArraysEqual(left: string[] | undefined, right: string[] | undefined): boolean {
  const safeLeft = left ?? [];
  const safeRight = right ?? [];
  if (safeLeft.length !== safeRight.length) {
    return false;
  }

  for (let index = 0; index < safeLeft.length; index += 1) {
    if (safeLeft[index] !== safeRight[index]) {
      return false;
    }
  }

  return true;
}

export const PhotoCard = memo(
  function PhotoCard({
    photo,
    isSelected,
    onToggle,
    onUpdatePhoto,
    onFocus,
    onPreview,
    onContextMenu,
    onExternalDragStart,
    canExternalDrag = false,
    customLabelColors = {},
    customLabelShortcuts = {},
    disableNonEssentialUi = false,
    batchPulseToken = 0,
    batchPulseKind = null,
    editable,
  }: PhotoCardProps) {
    notePhotoCardRender(photo.id);

    const previewUrl = photo.thumbnailUrl ?? photo.previewUrl ?? photo.sourceUrl;
    const rating = getAssetRating(photo);
    const pickStatus = getAssetPickStatus(photo);
    const colorLabel = getAssetColorLabel(photo);
    const customLabels = photo.customLabels ?? [];
    const raw = isRawFile(photo.fileName);

    const prevClassRef = useRef({ rating, pickStatus, colorLabel, customLabels });
    const cardRef = useRef<HTMLDivElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const feedbackTimeoutRef = useRef<number | null>(null);
    const feedbackTokenRef = useRef(0);
    const [feedback, setFeedback] = useState<CardFeedback | null>(null);
    const batchPulseTimeoutRef = useRef<number | null>(null);
    const lastBatchPulseTokenRef = useRef(0);
    const [activeBatchPulseKind, setActiveBatchPulseKind] = useState<"dot" | "label" | null>(null);
    const [isToolbarVisible, setIsToolbarVisible] = useState(isSelected);

    useEffect(() => {
      const prev = prevClassRef.current;
      let nextFeedback: CardFeedback | null = null;

      if (disableNonEssentialUi) {
        prevClassRef.current = { rating, pickStatus, colorLabel, customLabels };
        if (feedbackTimeoutRef.current !== null) {
          window.clearTimeout(feedbackTimeoutRef.current);
          feedbackTimeoutRef.current = null;
        }
        setFeedback((current) => (current ? null : current));
        return;
      }

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
      } else if (!areLabelArraysEqual(prev.customLabels, customLabels)) {
        const addedLabels = customLabels.filter((label) => !prev.customLabels.includes(label));
        const removedLabels = prev.customLabels.filter((label) => !customLabels.includes(label));
        const affectedLabels = addedLabels.length > 0 ? addedLabels : removedLabels;

        feedbackTokenRef.current += 1;
        nextFeedback = {
          kind: "label",
          label: addedLabels.length > 0
            ? `Label: ${addedLabels.join(", ")}`
            : removedLabels.length > 0
              ? `Label rimossa: ${removedLabels.join(", ")}`
              : "Label aggiornata",
          token: feedbackTokenRef.current,
          labels: affectedLabels,
        };
      }

      prevClassRef.current = { rating, pickStatus, colorLabel, customLabels };

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
    }, [colorLabel, customLabels, disableNonEssentialUi, pickStatus, rating]);

    useEffect(() => {
      if (!batchPulseToken || batchPulseToken === lastBatchPulseTokenRef.current) {
        return;
      }

      lastBatchPulseTokenRef.current = batchPulseToken;
      setActiveBatchPulseKind(batchPulseKind);

      if (wrapperRef.current) {
        const el = wrapperRef.current;
        el.classList.remove("photo-card__image-wrapper--batch-pulse");
        el.classList.remove("photo-card__image-wrapper--batch-pulse-lite");
        void el.offsetWidth;
        el.classList.add(
          disableNonEssentialUi
            ? "photo-card__image-wrapper--batch-pulse-lite"
            : "photo-card__image-wrapper--batch-pulse",
        );
      }

      if (batchPulseTimeoutRef.current !== null) {
        window.clearTimeout(batchPulseTimeoutRef.current);
      }

      batchPulseTimeoutRef.current = window.setTimeout(() => {
        setActiveBatchPulseKind((current) => (
          current === batchPulseKind ? null : current
        ));
        batchPulseTimeoutRef.current = null;
      }, 1200);
    }, [batchPulseKind, batchPulseToken, disableNonEssentialUi]);

    useEffect(() => {
      if (isSelected) {
        setIsToolbarVisible(true);
      }
    }, [isSelected]);

    useEffect(() => {
      if (!disableNonEssentialUi) {
        return;
      }

      if (!isSelected) {
        setIsToolbarVisible(false);
      }
    }, [disableNonEssentialUi, isSelected]);

    useEffect(() => {
      return () => {
        if (feedbackTimeoutRef.current !== null) {
          window.clearTimeout(feedbackTimeoutRef.current);
        }
        if (batchPulseTimeoutRef.current !== null) {
          window.clearTimeout(batchPulseTimeoutRef.current);
        }
      };
    }, []);

    const orientationIcon =
      photo.orientation === "vertical" ? "↕" : photo.orientation === "square" ? "◻" : "↔";
    return (
      <div
        className={`photo-card ${isSelected ? "photo-card--selected" : ""} ${colorLabel ? `photo-card--color-${colorLabel}` : (customLabels.length > 0 ? `photo-card--custom-${customLabelColors[customLabels[0]] ?? "sand"}` : "")}${disableNonEssentialUi ? " photo-card--scroll-lite" : ""}`}
        role="option"
        tabIndex={0}
        aria-selected={isSelected}
        aria-label={`${photo.fileName}${isSelected ? ", selezionata" : ", non selezionata"}`}
        aria-keyshortcuts="Enter Space 1 2 3 4 5 P X U"
        ref={cardRef}
        data-preview-asset-id={photo.id}
        draggable={canExternalDrag}
        onClick={(event) => onToggle(photo.id, event)}
        onDragStart={(event) => {
          if (!canExternalDrag || !onExternalDragStart) {
            event.preventDefault();
            return;
          }
          onExternalDragStart(photo.id, event);
        }}
        onFocus={() => {
          setIsToolbarVisible(true);
          onFocus(photo.id);
        }}
        onMouseEnter={() => {
          if (disableNonEssentialUi) {
            return;
          }
          if (photo.previewUrl) preloadImageUrls([photo.previewUrl]);
        }}
        onMouseLeave={() => {
          if (!isSelected) {
            setIsToolbarVisible(false);
          }
        }}
        onBlur={(event) => {
          const nextTarget = event.relatedTarget;
          if (cardRef.current?.contains(nextTarget as Node | null)) {
            return;
          }
          if (!isSelected) {
            setIsToolbarVisible(false);
          }
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
          {customLabels.length > 0 ? (
            <div className="photo-card__labels" title={customLabels.join(", ")}>
              {customLabels.slice(0, 2).map((label) => (
                <span
                  key={label}
                  className={[
                    "photo-card__label-chip",
                    `photo-card__label-chip--${customLabelColors[label] ?? "sand"}`,
                    feedback?.kind === "label" && feedback.labels?.includes(label)
                      ? "photo-card__label-chip--flash"
                      : "",
                    activeBatchPulseKind === "label"
                      ? "photo-card__label-chip--batch-pulse"
                      : "",
                  ].join(" ").trim()}
                  title={customLabelShortcuts[label] ? `${label} · tasto ${customLabelShortcuts[label]}` : label}
                >
                  {customLabelShortcuts[label] ? `${label} · ${customLabelShortcuts[label]}` : label}
                </span>
              ))}
              {customLabels.length > 2 ? (
                <span className="photo-card__label-chip photo-card__label-chip--more">
                  +{customLabels.length - 2}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {editable && isToolbarVisible ? (
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
    prev.isSelected === next.isSelected &&
    prev.editable === next.editable &&
    prev.disableNonEssentialUi === next.disableNonEssentialUi &&
    prev.batchPulseToken === next.batchPulseToken &&
    prev.batchPulseKind === next.batchPulseKind &&
    prev.photo.id === next.photo.id &&
    prev.photo.fileName === next.photo.fileName &&
    prev.photo.thumbnailUrl === next.photo.thumbnailUrl &&
    prev.photo.previewUrl === next.photo.previewUrl &&
    prev.photo.sourceUrl === next.photo.sourceUrl &&
    prev.photo.width === next.photo.width &&
    prev.photo.height === next.photo.height &&
    prev.photo.orientation === next.photo.orientation &&
    areLabelArraysEqual(prev.photo.customLabels, next.photo.customLabels) &&
    getAssetRating(prev.photo) === getAssetRating(next.photo) &&
    getAssetPickStatus(prev.photo) === getAssetPickStatus(next.photo) &&
    getAssetColorLabel(prev.photo) === getAssetColorLabel(next.photo) &&
    prev.customLabelColors === next.customLabelColors &&
    prev.customLabelShortcuts === next.customLabelShortcuts
);
