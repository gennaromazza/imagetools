import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { createPortal } from "react-dom";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { preloadImageUrls } from "../services/image-cache";
import { PhotoClassificationHelpButton } from "./PhotoClassificationHelpButton";
import { PhotoColorContextMenu } from "./PhotoColorContextMenu";
import { PhotoQuickPreviewModal } from "./PhotoQuickPreviewModal";
import { COLOR_LABEL_NAMES, COLOR_LABELS, DEFAULT_PHOTO_FILTERS, formatAssetStars, getAssetColorLabel, getAssetPickStatus, getAssetRating, getColorShortcutHint, matchesPhotoFilters, PICK_STATUS_LABELS, resolvePhotoClassificationShortcut } from "../services/photo-classification";
export function ProjectPhotoSelectorModal({ assets, activeAssetIds, usageByAssetId, onClose, onApply }) {
    const [localAssets, setLocalAssets] = useState(assets);
    const [localSelection, setLocalSelection] = useState(activeAssetIds);
    const [quickSelectCount, setQuickSelectCount] = useState(Math.min(activeAssetIds.length || assets.length, assets.length));
    const [sortBy, setSortBy] = useState("name");
    const [pickFilter, setPickFilter] = useState(DEFAULT_PHOTO_FILTERS.pickStatus);
    const [usageFilter, setUsageFilter] = useState("all");
    const [colorFilter, setColorFilter] = useState(DEFAULT_PHOTO_FILTERS.colorLabel);
    const [ratingFilter, setRatingFilter] = useState(DEFAULT_PHOTO_FILTERS.ratingFilter);
    const [previewAssetId, setPreviewAssetId] = useState(null);
    const [contextMenuState, setContextMenuState] = useState(null);
    const [focusedAssetId, setFocusedAssetId] = useState(null);
    const gridRef = useRef(null);
    const deferredAssets = useDeferredValue(localAssets);
    const selectionSet = useMemo(() => new Set(localSelection), [localSelection]);
    // Derived state
    const hasActiveFilters = pickFilter !== "all" || ratingFilter !== "any" || colorFilter !== "all" || usageFilter !== "all";
    function resetFilters() {
        setPickFilter("all");
        setRatingFilter("any");
        setColorFilter("all");
        setUsageFilter("all");
    }
    const visibleAssets = useMemo(() => {
        const filtered = deferredAssets.filter((asset) => {
            if (!matchesPhotoFilters(asset, {
                pickStatus: pickFilter,
                ratingFilter,
                colorLabel: colorFilter
            })) {
                return false;
            }
            const assetUsage = usageByAssetId.has(asset.id);
            if (usageFilter === "used" && !assetUsage) {
                return false;
            }
            if (usageFilter === "unused" && assetUsage) {
                return false;
            }
            return true;
        });
        filtered.sort((left, right) => {
            if (sortBy === "rating") {
                return (getAssetRating(right) - getAssetRating(left) ||
                    left.fileName.localeCompare(right.fileName));
            }
            if (sortBy === "orientation") {
                return (left.orientation.localeCompare(right.orientation) ||
                    left.fileName.localeCompare(right.fileName));
            }
            return left.fileName.localeCompare(right.fileName);
        });
        return filtered;
    }, [colorFilter, deferredAssets, ratingFilter, pickFilter, sortBy, usageByAssetId, usageFilter]);
    const previewAsset = previewAssetId
        ? localAssets.find((asset) => asset.id === previewAssetId) ?? null
        : null;
    useEffect(() => {
        if (!contextMenuState) {
            return;
        }
        const closeMenu = () => setContextMenuState(null);
        window.addEventListener("mousedown", closeMenu);
        window.addEventListener("scroll", closeMenu, true);
        return () => {
            window.removeEventListener("mousedown", closeMenu);
            window.removeEventListener("scroll", closeMenu, true);
        };
    }, [contextMenuState]);
    function toggleAsset(imageId) {
        setLocalSelection((current) => current.includes(imageId) ? current.filter((id) => id !== imageId) : [...current, imageId]);
    }
    function applyQuickSelection() {
        const nextIds = deferredAssets
            .slice(0, Math.max(0, Math.min(quickSelectCount, deferredAssets.length)))
            .map((asset) => asset.id);
        setLocalSelection(nextIds);
    }
    function updateAsset(imageId, changes) {
        setLocalAssets((current) => current.map((asset) => (asset.id === imageId ? { ...asset, ...changes } : asset)));
    }
    function applyKeyboardShortcut(asset, input) {
        const shortcutChanges = resolvePhotoClassificationShortcut(input);
        if (!shortcutChanges) {
            return false;
        }
        updateAsset(asset.id, shortcutChanges);
        return true;
    }
    function selectVisibleAssets() {
        setLocalSelection(visibleAssets.map((asset) => asset.id));
    }
    function activatePickedAssets() {
        setLocalSelection(localAssets
            .filter((asset) => getAssetPickStatus(asset) === "picked")
            .map((asset) => asset.id));
    }
    function excludeRejectedAssets() {
        setLocalSelection(localAssets
            .filter((asset) => getAssetPickStatus(asset) !== "rejected")
            .map((asset) => asset.id));
    }
    // Consolidated keyboard handler: Escape priority chain + arrow navigation
    useEffect(() => {
        const handleKeyDown = (event) => {
            // Priority 1: context menu open → Escape closes it, nothing else
            if (contextMenuState) {
                if (event.key === "Escape") {
                    event.preventDefault();
                    setContextMenuState(null);
                }
                return;
            }
            // Priority 2: quick-preview open → let PhotoQuickPreviewModal handle keys
            if (previewAssetId) {
                return;
            }
            // Priority 3: Escape closes selector
            if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
            }
            // Priority 4: Arrow keys navigate the grid
            const arrowKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
            if (!arrowKeys.includes(event.key)) {
                return;
            }
            // Don't steal arrows from form controls
            const target = event.target;
            if (target.closest("select, input, textarea")) {
                return;
            }
            event.preventDefault();
            if (visibleAssets.length === 0) {
                return;
            }
            const currentIndex = focusedAssetId
                ? visibleAssets.findIndex((a) => a.id === focusedAssetId)
                : -1;
            // Detect column count from actual DOM dimensions
            const grid = gridRef.current;
            let cols = 4;
            if (grid) {
                const firstCard = grid.querySelector(".modal-photo-card");
                if (firstCard && firstCard.offsetWidth > 0) {
                    cols = Math.max(1, Math.floor(grid.clientWidth / firstCard.offsetWidth));
                }
            }
            let nextIndex;
            if (currentIndex < 0) {
                nextIndex = 0;
            }
            else if (event.key === "ArrowRight") {
                nextIndex = Math.min(visibleAssets.length - 1, currentIndex + 1);
            }
            else if (event.key === "ArrowLeft") {
                nextIndex = Math.max(0, currentIndex - 1);
            }
            else if (event.key === "ArrowDown") {
                nextIndex = Math.min(visibleAssets.length - 1, currentIndex + cols);
            }
            else {
                // ArrowUp
                nextIndex = Math.max(0, currentIndex - cols);
            }
            if (nextIndex !== currentIndex || currentIndex < 0) {
                const nextAsset = visibleAssets[nextIndex];
                setFocusedAssetId(nextAsset.id);
                const button = grid?.querySelector(`[data-preview-asset-id="${nextAsset.id}"]`);
                if (button) {
                    button.focus();
                    button.scrollIntoView({ block: "nearest", behavior: "smooth" });
                }
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [contextMenuState, focusedAssetId, onClose, previewAssetId, visibleAssets]);
    const modalContent = (_jsxs(_Fragment, { children: [_jsxs("div", { className: "modal-panel modal-panel--wide", onClick: (event) => event.stopPropagation(), children: [_jsxs("div", { className: "modal-panel__header", children: [_jsxs("div", { children: [_jsx("strong", { children: "Selezione foto del progetto" }), _jsx("p", { children: "Rivedi le foto a schermo grande, assegna stelle e colori e scegli quali entrano davvero nel layout." })] }), _jsxs("div", { className: "button-row", children: [_jsx(PhotoClassificationHelpButton, { title: "Scorciatoie selezione progetto" }), _jsx("button", { type: "button", className: "ghost-button", onClick: onClose, children: "Chiudi" })] })] }), _jsxs("div", { className: "modal-toolbar modal-toolbar--selector", children: [_jsxs("div", { className: "button-row", children: [_jsx("button", { type: "button", className: "ghost-button", onClick: () => setLocalSelection(hasActiveFilters
                                            ? visibleAssets.map((asset) => asset.id)
                                            : deferredAssets.map((asset) => asset.id)), title: hasActiveFilters ? "Attiva solo le foto visibili con i filtri" : "Seleziona tutte le foto", children: "Seleziona tutte" }), _jsx("button", { type: "button", className: "ghost-button", onClick: selectVisibleAssets, children: "Attiva filtrate" }), _jsx("button", { type: "button", className: "ghost-button", onClick: activatePickedAssets, children: "Solo pick" }), _jsx("button", { type: "button", className: "ghost-button", onClick: excludeRejectedAssets, children: "Escludi scartate" }), _jsx("button", { type: "button", className: "ghost-button", onClick: () => setLocalSelection([]), children: "Svuota selezione" })] }), _jsxs("div", { className: "modal-toolbar__quick modal-toolbar__quick--selector", children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Ordina" }), _jsxs("select", { value: sortBy, onChange: (event) => setSortBy(event.target.value), children: [_jsx("option", { value: "name", children: "Nome" }), _jsx("option", { value: "orientation", children: "Orientamento" }), _jsx("option", { value: "rating", children: "Stelle" })] })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Usa le prime N foto" }), _jsx("input", { type: "number", min: "0", max: deferredAssets.length, value: quickSelectCount, onChange: (event) => setQuickSelectCount(Number(event.target.value)) })] }), _jsx("button", { type: "button", className: "secondary-button", onClick: applyQuickSelection, children: "Applica" })] })] }), _jsxs("div", { className: "modal-status modal-status--selector", children: [_jsxs("span", { children: [deferredAssets.length, " foto nel catalogo"] }), _jsxs("span", { children: [localSelection.length, " attive per il layout"] }), _jsxs("span", { children: [visibleAssets.length, " visibili con i filtri"] })] }), _jsxs("div", { className: "selector-filters", children: [hasActiveFilters ? (_jsx("div", { className: "selector-filters__reset", children: _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: resetFilters, children: "\u2715 Azzera filtri" }) })) : null, _jsxs("label", { className: "field", children: [_jsx("span", { children: "Stato" }), _jsxs("select", { className: pickFilter !== "all" ? "field__select field__select--active" : undefined, value: pickFilter, onChange: (event) => setPickFilter(event.target.value), children: [_jsx("option", { value: "all", children: "Tutti" }), _jsx("option", { value: "picked", children: "Pick" }), _jsx("option", { value: "rejected", children: "Scartate" }), _jsx("option", { value: "unmarked", children: "Neutre" })] })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Uso nel layout" }), _jsxs("select", { className: usageFilter !== "all" ? "field__select field__select--active" : undefined, value: usageFilter, onChange: (event) => setUsageFilter(event.target.value), children: [_jsx("option", { value: "all", children: "Tutte" }), _jsx("option", { value: "used", children: "Gia usate" }), _jsx("option", { value: "unused", children: "Ancora libere" })] })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Colore" }), _jsxs("select", { className: colorFilter !== "all" ? "field__select field__select--active" : undefined, value: colorFilter, onChange: (event) => setColorFilter(event.target.value), children: [_jsx("option", { value: "all", children: "Tutti" }), COLOR_LABELS.map((value) => (_jsx("option", { value: value, children: COLOR_LABEL_NAMES[value] }, value)))] })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Stelle" }), _jsxs("select", { className: ratingFilter !== "any" ? "field__select field__select--active" : undefined, value: ratingFilter, onChange: (event) => setRatingFilter(event.target.value), children: [_jsx("option", { value: "any", children: "Tutte le stelle" }), _jsxs("optgroup", { label: "Minimo", children: [_jsx("option", { value: "1+", children: "\u2605 1 o pi\u00F9" }), _jsx("option", { value: "2+", children: "\u2605\u2605 2 o pi\u00F9" }), _jsx("option", { value: "3+", children: "\u2605\u2605\u2605 3 o pi\u00F9" }), _jsx("option", { value: "4+", children: "\u2605\u2605\u2605\u2605 4 o pi\u00F9" })] }), _jsxs("optgroup", { label: "Esattamente", children: [_jsx("option", { value: "0", children: "Senza stelle" }), _jsx("option", { value: "1", children: "\u2605 Solo 1" }), _jsx("option", { value: "2", children: "\u2605\u2605 Solo 2" }), _jsx("option", { value: "3", children: "\u2605\u2605\u2605 Solo 3" }), _jsx("option", { value: "4", children: "\u2605\u2605\u2605\u2605 Solo 4" }), _jsx("option", { value: "5", children: "\u2605\u2605\u2605\u2605\u2605 Solo 5" })] })] })] })] }), _jsx("div", { ref: gridRef, className: "modal-photo-grid modal-photo-grid--selector", children: visibleAssets.map((asset) => {
                            const isSelected = selectionSet.has(asset.id);
                            const previewUrl = asset.thumbnailUrl ?? asset.previewUrl ?? asset.sourceUrl;
                            const usage = usageByAssetId.get(asset.id);
                            const pickStatus = getAssetPickStatus(asset);
                            const rating = getAssetRating(asset);
                            const colorLabel = getAssetColorLabel(asset);
                            return (_jsxs("button", { type: "button", "data-preview-asset-id": asset.id, className: isSelected ? "modal-photo-card modal-photo-card--active" : "modal-photo-card", onClick: () => toggleAsset(asset.id), onFocus: () => setFocusedAssetId(asset.id), onMouseEnter: () => {
                                    if (asset.previewUrl)
                                        preloadImageUrls([asset.previewUrl]);
                                }, onDoubleClick: () => setPreviewAssetId(asset.id), onContextMenu: (event) => {
                                    event.preventDefault();
                                    setContextMenuState({
                                        assetId: asset.id,
                                        x: event.clientX,
                                        y: event.clientY
                                    });
                                }, onKeyDown: (event) => {
                                    if (event.key === " ") {
                                        event.preventDefault();
                                        setPreviewAssetId(asset.id);
                                        return;
                                    }
                                    if (applyKeyboardShortcut(asset, {
                                        key: event.key,
                                        code: event.code,
                                        ctrlKey: event.ctrlKey,
                                        metaKey: event.metaKey
                                    })) {
                                        event.preventDefault();
                                    }
                                }, children: [_jsxs("div", { className: "modal-photo-card__image-shell", children: [previewUrl ? (_jsx("img", { src: previewUrl, alt: asset.fileName, className: "modal-photo-card__image", loading: "lazy" })) : (_jsx("div", { className: "modal-photo-card__placeholder", children: asset.fileName })), _jsxs("div", { className: "modal-photo-card__top-badges", children: [_jsx("span", { className: `asset-pick-badge asset-pick-badge--${pickStatus}`, children: PICK_STATUS_LABELS[pickStatus] }), colorLabel ? (_jsx("span", { className: `asset-color-dot asset-color-dot--${colorLabel}`, title: COLOR_LABEL_NAMES[colorLabel] })) : null] }), rating > 0 ? _jsx("div", { className: "modal-photo-card__stars", children: formatAssetStars(asset) }) : null] }), _jsxs("div", { className: "modal-photo-card__meta", children: [_jsx("strong", { children: asset.fileName }), _jsx("span", { children: usage ? `Usata nel foglio ${usage.pageNumber}` : "Non ancora usata nel layout" }), _jsx("span", { children: isSelected ? "Attiva per il layout" : "Esclusa dal layout" })] }), _jsxs("div", { className: "modal-photo-card__footer", children: [_jsx("div", { className: "modal-photo-card__tiny-actions", children: [1, 2, 3, 4, 5].map((value) => (_jsx("button", { type: "button", className: value <= rating
                                                        ? "modal-photo-card__tiny-star modal-photo-card__tiny-star--active"
                                                        : "modal-photo-card__tiny-star", onClick: (event) => {
                                                        event.stopPropagation();
                                                        updateAsset(asset.id, { rating: value });
                                                    }, title: `${value} stella${value > 1 ? "e" : ""} | tasto ${value}`, children: "\u2605" }, value))) }), _jsx("div", { className: "modal-photo-card__color-actions", children: COLOR_LABELS.map((value) => (_jsx("button", { type: "button", className: colorLabel === value
                                                        ? `asset-color-dot asset-color-dot--${value} asset-color-dot--selected`
                                                        : `asset-color-dot asset-color-dot--${value}`, onClick: (event) => {
                                                        event.stopPropagation();
                                                        updateAsset(asset.id, {
                                                            colorLabel: colorLabel === value ? null : value
                                                        });
                                                    }, title: `${COLOR_LABEL_NAMES[value]} | ${getColorShortcutHint(value)}` }, value))) })] })] }, asset.id));
                        }) }), _jsxs("div", { className: "modal-panel__footer", children: [_jsx("p", { className: "selector-shortcuts", children: "Usa Info per tutte le scorciatoie. Spazio apre la preview, 1-5 assegna stelle, P/X/U cambia stato e Ctrl/Cmd + 6/7/8/9/V assegna i colori." }), _jsxs("div", { className: "button-row", children: [_jsx("button", { type: "button", className: "ghost-button", onClick: onClose, children: "Annulla" }), _jsxs("button", { type: "button", className: "primary-button", onClick: () => onApply(localSelection, localAssets), children: ["Usa ", localSelection.length, " foto nel progetto"] })] })] })] }), _jsx(PhotoQuickPreviewModal, { asset: previewAsset, assets: visibleAssets, usageByAssetId: usageByAssetId, onClose: () => setPreviewAssetId(null), onSelectAsset: setPreviewAssetId, onUpdateAsset: updateAsset }), contextMenuState ? (_jsx(PhotoColorContextMenu, { x: contextMenuState.x, y: contextMenuState.y, selectedColor: localAssets.find((asset) => asset.id === contextMenuState.assetId)?.colorLabel ?? null, title: "Etichetta colore", onSelect: (colorLabel) => {
                    updateAsset(contextMenuState.assetId, { colorLabel });
                    setContextMenuState(null);
                } })) : null] }));
    return createPortal(_jsx("div", { className: "modal-fullscreen-backdrop", onClick: onClose, children: modalContent }), document.body);
}
//# sourceMappingURL=ProjectPhotoSelectorModal.js.map