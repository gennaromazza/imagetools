import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo, useEffect, useRef, useState } from "react";
import { preloadImageUrls } from "../services/image-cache";
import { notePhotoCardRender } from "../services/performance-utils";
import { COLOR_LABEL_NAMES, COLOR_LABELS, formatAssetStars, getAssetColorLabel, getAssetPickStatus, getAssetRating, getColorShortcutHint, PICK_STATUS_LABELS, resolvePhotoClassificationShortcut, } from "../services/photo-classification";
import { isRawFile } from "../services/folder-access";
function areLabelArraysEqual(left, right) {
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
export const PhotoCard = memo(function PhotoCard({ photo, isSelected, onToggle, onUpdatePhoto, onAfterShortcutClassification, onFocus, onPreview, onContextMenu, onExternalDragStart, canExternalDrag = false, customLabelColors = {}, customLabelShortcuts = {}, disableNonEssentialUi = false, batchPulseToken = 0, batchPulseKind = null, editable, }) {
    notePhotoCardRender(photo.id);
    const previewUrl = photo.thumbnailUrl ?? photo.previewUrl ?? photo.sourceUrl;
    const rating = getAssetRating(photo);
    const pickStatus = getAssetPickStatus(photo);
    const colorLabel = getAssetColorLabel(photo);
    const customLabels = photo.customLabels ?? [];
    const raw = isRawFile(photo.fileName);
    const prevClassRef = useRef({ rating, pickStatus, colorLabel, customLabels });
    const cardRef = useRef(null);
    const wrapperRef = useRef(null);
    const feedbackTimeoutRef = useRef(null);
    const feedbackTokenRef = useRef(0);
    const [feedback, setFeedback] = useState(null);
    const batchPulseTimeoutRef = useRef(null);
    const lastBatchPulseTokenRef = useRef(0);
    const [activeBatchPulseKind, setActiveBatchPulseKind] = useState(null);
    const [isToolbarVisible, setIsToolbarVisible] = useState(isSelected);
    useEffect(() => {
        const prev = prevClassRef.current;
        let nextFeedback = null;
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
        }
        else if (prev.pickStatus !== pickStatus) {
            feedbackTokenRef.current += 1;
            nextFeedback = {
                kind: "pill",
                label: `Stato: ${PICK_STATUS_LABELS[pickStatus]}`,
                token: feedbackTokenRef.current,
                value: pickStatus,
            };
        }
        else if (prev.colorLabel !== colorLabel) {
            feedbackTokenRef.current += 1;
            nextFeedback = {
                kind: "dot",
                label: colorLabel ? `Colore: ${COLOR_LABEL_NAMES[colorLabel]}` : "Colore rimosso",
                token: feedbackTokenRef.current,
                value: colorLabel,
            };
        }
        else if (!areLabelArraysEqual(prev.customLabels, customLabels)) {
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
            el.classList.add(disableNonEssentialUi
                ? "photo-card__image-wrapper--batch-pulse-lite"
                : "photo-card__image-wrapper--batch-pulse");
        }
        if (batchPulseTimeoutRef.current !== null) {
            window.clearTimeout(batchPulseTimeoutRef.current);
        }
        batchPulseTimeoutRef.current = window.setTimeout(() => {
            setActiveBatchPulseKind((current) => (current === batchPulseKind ? null : current));
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
    const orientationIcon = photo.orientation === "vertical" ? "↕" : photo.orientation === "square" ? "◻" : "↔";
    return (_jsxs("div", { className: `photo-card ${isSelected ? "photo-card--selected" : ""} ${colorLabel ? `photo-card--color-${colorLabel}` : (customLabels.length > 0 ? `photo-card--custom-${customLabelColors[customLabels[0]] ?? "sand"}` : "")}${disableNonEssentialUi ? " photo-card--scroll-lite" : ""}`, role: "option", tabIndex: 0, "aria-selected": isSelected, "aria-label": `${photo.fileName}${isSelected ? ", selezionata" : ", non selezionata"}`, "aria-keyshortcuts": "Enter Space 1 2 3 4 5 P X U", ref: cardRef, "data-preview-asset-id": photo.id, draggable: canExternalDrag, onClick: (event) => onToggle(photo.id, event), onDragStart: (event) => {
            if (!canExternalDrag || !onExternalDragStart) {
                event.preventDefault();
                return;
            }
            onExternalDragStart(photo.id, event);
        }, onFocus: () => {
            setIsToolbarVisible(true);
            onFocus(photo.id);
        }, onMouseEnter: () => {
            if (disableNonEssentialUi) {
                return;
            }
            if (photo.previewUrl)
                preloadImageUrls([photo.previewUrl]);
        }, onMouseLeave: () => {
            if (!isSelected) {
                setIsToolbarVisible(false);
            }
        }, onBlur: (event) => {
            const nextTarget = event.relatedTarget;
            if (cardRef.current?.contains(nextTarget)) {
                return;
            }
            if (!isSelected) {
                setIsToolbarVisible(false);
            }
        }, onDoubleClick: () => onPreview(photo.id), onContextMenu: (event) => {
            if (!editable)
                return;
            event.preventDefault();
            onContextMenu(photo.id, event.clientX, event.clientY);
        }, onKeyDown: (event) => {
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
                    onAfterShortcutClassification?.(photo.id);
                }
            }
        }, children: [_jsxs("div", { ref: wrapperRef, className: "photo-card__image-wrapper", children: [previewUrl ? (_jsx("img", { src: previewUrl, alt: photo.fileName, className: "photo-card__image", loading: "lazy", decoding: "async" })) : (_jsx("div", { className: `photo-card__image photo-card__image--placeholder${raw ? " photo-card__image--placeholder-raw" : ""}`, children: _jsx("span", { className: "photo-card__placeholder-icon", children: raw ? "📷" : orientationIcon }) })), _jsxs("div", { className: "photo-card__top-badges", children: [_jsx("span", { className: `asset-pick-badge asset-pick-badge--${pickStatus}`, children: PICK_STATUS_LABELS[pickStatus] }), colorLabel ? (_jsx("span", { className: `asset-color-dot asset-color-dot--${colorLabel}`, title: COLOR_LABEL_NAMES[colorLabel] })) : (_jsx("span", { className: "photo-card__empty-color", children: "Nessun colore" }))] }), _jsx("div", { className: "photo-card__select-badge", children: _jsx("div", { className: `photo-card__check ${isSelected ? "photo-card__check--active" : ""}`, children: isSelected ? "✓" : "" }) }), raw ? (_jsx("span", { className: "asset-pick-badge asset-raw-badge photo-card__raw-badge", children: "RAW" })) : null, _jsx("div", { className: feedback?.kind === "star"
                            ? "photo-card__stars photo-card__stars--feedback"
                            : "photo-card__stars", children: rating > 0 ? formatAssetStars(photo) : "Senza stelle" }), feedback ? (_jsx("div", { className: `photo-card__feedback photo-card__feedback--${feedback.kind}`, children: feedback.label }, feedback.token)) : null] }), _jsxs("div", { className: "photo-card__info", children: [_jsx("div", { className: "photo-card__name", title: photo.fileName, children: photo.fileName }), _jsxs("div", { className: "photo-card__meta", children: [_jsx("span", { className: "photo-card__orientation-icon", title: photo.orientation, children: orientationIcon }), photo.width > 0 ? (_jsxs("span", { className: "photo-card__dimensions", children: [Math.round(photo.width), "\u00D7", Math.round(photo.height)] })) : null] }), customLabels.length > 0 ? (_jsxs("div", { className: "photo-card__labels", title: customLabels.join(", "), children: [customLabels.slice(0, 2).map((label) => (_jsx("span", { className: [
                                    "photo-card__label-chip",
                                    `photo-card__label-chip--${customLabelColors[label] ?? "sand"}`,
                                    feedback?.kind === "label" && feedback.labels?.includes(label)
                                        ? "photo-card__label-chip--flash"
                                        : "",
                                    activeBatchPulseKind === "label"
                                        ? "photo-card__label-chip--batch-pulse"
                                        : "",
                                ].join(" ").trim(), title: customLabelShortcuts[label] ? `${label} · tasto ${customLabelShortcuts[label]}` : label, children: customLabelShortcuts[label] ? `${label} · ${customLabelShortcuts[label]}` : label }, label))), customLabels.length > 2 ? (_jsxs("span", { className: "photo-card__label-chip photo-card__label-chip--more", children: ["+", customLabels.length - 2] })) : null] })) : null] }), editable && isToolbarVisible ? (_jsxs("div", { className: "photo-card__toolbar", onClick: (event) => event.stopPropagation(), children: [_jsx("div", { className: "photo-card__tiny-actions", children: [1, 2, 3, 4, 5].map((value) => (_jsx("button", { type: "button", className: [
                                "photo-card__star",
                                value <= rating ? "photo-card__star--active" : "",
                                feedback?.kind === "star" && feedback.value === value
                                    ? "photo-card__star--flash"
                                    : "",
                            ].join(" "), onClick: () => onUpdatePhoto(photo.id, { rating: value }), title: `${value} stella${value > 1 ? "e" : ""} | tasto ${value}`, children: "\u2605" }, value))) }), _jsx("div", { className: "photo-card__toolbar-row", children: ["picked", "rejected", "unmarked"].map((value) => (_jsx("button", { type: "button", className: [
                                "photo-card__pill",
                                pickStatus === value ? "photo-card__pill--active" : "",
                                feedback?.kind === "pill" && feedback.value === value
                                    ? "photo-card__pill--flash"
                                    : "",
                            ].join(" "), onClick: () => onUpdatePhoto(photo.id, { pickStatus: value }), title: value === "picked"
                                ? "Pick | P"
                                : value === "rejected"
                                    ? "Scarta | X"
                                    : "Neutra | U", children: PICK_STATUS_LABELS[value] }, value))) }), _jsx("div", { className: "photo-card__toolbar-row", children: COLOR_LABELS.map((value) => (_jsx("button", { type: "button", className: [
                                "asset-color-dot",
                                `asset-color-dot--${value}`,
                                colorLabel === value ? "asset-color-dot--selected" : "",
                                feedback?.kind === "dot" && feedback.value === value
                                    ? "asset-color-dot--flash"
                                    : "",
                            ].join(" "), onClick: () => onUpdatePhoto(photo.id, {
                                colorLabel: colorLabel === value ? null : value,
                            }), title: `${COLOR_LABEL_NAMES[value]} | ${getColorShortcutHint(value)}` }, value))) })] })) : null] }));
}, (prev, next) => prev.isSelected === next.isSelected &&
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
    prev.customLabelShortcuts === next.customLabelShortcuts);
//# sourceMappingURL=PhotoCard.js.map