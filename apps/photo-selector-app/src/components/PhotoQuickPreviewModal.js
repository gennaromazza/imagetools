import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { preloadImageUrls } from "../services/image-cache";
import { createOnDemandPreviewAsync, isRawFile, saveAssetAs } from "../services/folder-access";
import { PhotoClassificationHelpButton } from "./PhotoClassificationHelpButton";
import { COLOR_LABEL_NAMES, COLOR_LABELS, DEFAULT_PHOTO_FILTERS, formatAssetStars, getAssetColorLabel, getAssetPickStatus, getAssetRating, getColorShortcutHint, matchesPhotoFilters, PICK_STATUS_LABELS, resolvePhotoClassificationShortcut } from "../services/photo-classification";
const orientationLabels = {
    horizontal: "Orizzontale",
    vertical: "Verticale",
    square: "Quadrata"
};
const MIN_RAW_PREVIEW_DIMENSION = 900;
function shouldLoadRawPreview(asset) {
    if (!isRawFile(asset.fileName)) {
        return false;
    }
    if (!asset.previewUrl) {
        return true;
    }
    return Math.min(asset.width, asset.height) > 0 &&
        Math.min(asset.width, asset.height) < MIN_RAW_PREVIEW_DIMENSION;
}
export function PhotoQuickPreviewModal({ asset, assets = [], usageByAssetId, pages = [], activePageId, onClose, onSelectAsset, onAddToPage, onJumpToPage, onUpdateAsset }) {
    const stageRef = useRef(null);
    const assignFeedbackTimeoutRef = useRef(null);
    const classificationFeedbackTimeoutRef = useRef(null);
    const classificationFeedbackTokenRef = useRef(0);
    const [filterPickStatus, setFilterPickStatus] = useState(DEFAULT_PHOTO_FILTERS.pickStatus);
    const [filterRating, setFilterRating] = useState(DEFAULT_PHOTO_FILTERS.ratingFilter);
    const [filterColorLabel, setFilterColorLabel] = useState(DEFAULT_PHOTO_FILTERS.colorLabel);
    const [assignFeedbackPageNumber, setAssignFeedbackPageNumber] = useState(null);
    const [resolvedPreviewUrl, setResolvedPreviewUrl] = useState(null);
    const [compareMode, setCompareMode] = useState(false);
    const [compareAssetId, setCompareAssetId] = useState(null);
    const [resolvedComparePreviewUrl, setResolvedComparePreviewUrl] = useState(null);
    const [classificationFeedback, setClassificationFeedback] = useState(null);
    const usage = asset ? usageByAssetId?.get(asset.id) : undefined;
    const activePage = useMemo(() => pages.find((page) => page.id === activePageId) ?? null, [activePageId, pages]);
    const hasActiveFilters = filterPickStatus !== "all" || filterRating !== "any" || filterColorLabel !== "all";
    const filteredAssets = useMemo(() => assets.filter((item) => matchesPhotoFilters(item, {
        pickStatus: filterPickStatus,
        ratingFilter: filterRating,
        colorLabel: filterColorLabel
    })), [assets, filterColorLabel, filterRating, filterPickStatus]);
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
    const currentIndex = useMemo(() => (asset ? navigationAssets.findIndex((item) => item.id === asset.id) : -1), [asset, navigationAssets]);
    const previousAsset = currentIndex > 0 ? navigationAssets[currentIndex - 1] : null;
    const nextAsset = currentIndex >= 0 && currentIndex < navigationAssets.length - 1
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
        return navigationAssets.slice(Math.max(0, currentIndex - 4), Math.min(navigationAssets.length, currentIndex + 5));
    }, [currentIndex, navigationAssets]);
    const handleNavigate = useCallback((direction) => {
        if (!onSelectAsset || currentIndex < 0) {
            return;
        }
        const targetIndex = direction === "previous" ? currentIndex - 1 : currentIndex + 1;
        const targetAsset = navigationAssets[targetIndex];
        if (targetAsset) {
            onSelectAsset(targetAsset.id);
        }
    }, [currentIndex, navigationAssets, onSelectAsset]);
    const announceClassificationFeedback = useCallback((changes) => {
        let label = null;
        let kind = null;
        if (changes.rating !== undefined) {
            kind = "star";
            label = changes.rating > 0 ? `Valutazione: ${"★".repeat(changes.rating)}` : "Valutazione rimossa";
        }
        else if (changes.pickStatus !== undefined) {
            kind = "pill";
            label = `Stato: ${PICK_STATUS_LABELS[changes.pickStatus]}`;
        }
        else if (changes.colorLabel !== undefined) {
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
        };
        setClassificationFeedback(nextFeedback);
        if (classificationFeedbackTimeoutRef.current !== null) {
            window.clearTimeout(classificationFeedbackTimeoutRef.current);
        }
        classificationFeedbackTimeoutRef.current = window.setTimeout(() => {
            setClassificationFeedback((current) => current?.token === nextFeedback.token ? null : current);
            classificationFeedbackTimeoutRef.current = null;
        }, 1200);
    }, []);
    const updateRating = useCallback((rating) => {
        if (asset && onUpdateAsset) {
            const changes = { rating };
            onUpdateAsset(asset.id, changes);
            announceClassificationFeedback(changes);
        }
    }, [announceClassificationFeedback, asset, onUpdateAsset]);
    const updatePickStatus = useCallback((pickStatus) => {
        if (asset && onUpdateAsset) {
            const changes = { pickStatus };
            onUpdateAsset(asset.id, changes);
            announceClassificationFeedback(changes);
        }
    }, [announceClassificationFeedback, asset, onUpdateAsset]);
    const updateColorLabel = useCallback((colorLabel) => {
        if (asset && onUpdateAsset) {
            const changes = { colorLabel };
            onUpdateAsset(asset.id, changes);
            announceClassificationFeedback(changes);
        }
    }, [announceClassificationFeedback, asset, onUpdateAsset]);
    const activePageCanAccept = Boolean(activePage &&
        (!(activePage.isAtCapacity ?? false) || usage?.pageId === activePage.id));
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
        if (currentIndex < 0)
            return;
        const toPreload = [];
        for (const delta of [-2, -1, 1, 2]) {
            const a = navigationAssets[currentIndex + delta];
            if (!a)
                continue;
            if (a.previewUrl)
                toPreload.push(a.previewUrl);
            if (a.thumbnailUrl)
                toPreload.push(a.thumbnailUrl);
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
        const rawIdsToWarm = [];
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
        void Promise.all(rawIdsToWarm.map(({ id, priority }) => createOnDemandPreviewAsync(id, priority).catch(() => null)));
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
        const handleKeyDown = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
            }
            if (event.key === "f" || event.key === "F") {
                event.preventDefault();
                void toggleNativeFullscreen();
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
                if (target instanceof HTMLElement &&
                    target.closest("input, textarea, select, button, [contenteditable='true']") !== null) {
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
            if (target instanceof HTMLElement &&
                (target.closest("input, textarea, select, [contenteditable='true']") !== null ||
                    target.isContentEditable)) {
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
    const previewUrl = resolvedPreviewUrl ?? asset.previewUrl ?? asset.sourceUrl ?? asset.thumbnailUrl;
    const comparePreviewUrl = compareAsset
        ? resolvedComparePreviewUrl ?? compareAsset.previewUrl ?? compareAsset.sourceUrl ?? compareAsset.thumbnailUrl
        : null;
    const rating = getAssetRating(asset);
    const pickStatus = getAssetPickStatus(asset);
    const colorLabel = getAssetColorLabel(asset);
    const previewContent = (_jsxs("div", { className: "quick-preview", onClick: onClose, role: "dialog", "aria-modal": "true", "aria-label": "Anteprima foto a schermo intero", children: [assets.length > 1 ? (_jsxs("div", { className: "quick-preview__sidebar", onClick: (event) => event.stopPropagation(), children: [_jsxs("div", { className: "quick-preview__sidebar-filters", children: [_jsx("div", { className: "quick-preview__filter-summary", children: hasActiveFilters
                                    ? `${filteredAssets.length} di ${assets.length} foto`
                                    : `${assets.length} foto` }), _jsxs("div", { className: "quick-preview__filter-controls", children: [_jsxs("label", { className: "quick-preview__filter-field", children: [_jsx("span", { children: "Stato" }), _jsxs("select", { className: "quick-preview__filter-select", value: filterPickStatus, onChange: (event) => setFilterPickStatus(event.target.value), children: [_jsx("option", { value: "all", children: "Tutti" }), _jsx("option", { value: "picked", children: "Pick" }), _jsx("option", { value: "rejected", children: "Scartate" }), _jsx("option", { value: "unmarked", children: "Neutre" })] })] }), _jsxs("label", { className: "quick-preview__filter-field", children: [_jsx("span", { children: "Stelle" }), _jsxs("select", { className: "quick-preview__filter-select", value: filterRating, onChange: (event) => setFilterRating(event.target.value), children: [_jsx("option", { value: "any", children: "Tutte" }), _jsxs("optgroup", { label: "Minimo", children: [_jsx("option", { value: "1+", children: "\u2605 1+" }), _jsx("option", { value: "2+", children: "\u2605\u2605 2+" }), _jsx("option", { value: "3+", children: "\u2605\u2605\u2605 3+" }), _jsx("option", { value: "4+", children: "\u2605\u2605\u2605\u2605 4+" })] }), _jsxs("optgroup", { label: "Esatto", children: [_jsx("option", { value: "0", children: "Senza stelle" }), _jsx("option", { value: "1", children: "\u2605 Solo 1" }), _jsx("option", { value: "2", children: "\u2605\u2605 Solo 2" }), _jsx("option", { value: "3", children: "\u2605\u2605\u2605 Solo 3" }), _jsx("option", { value: "4", children: "\u2605\u2605\u2605\u2605 Solo 4" }), _jsx("option", { value: "5", children: "\u2605\u2605\u2605\u2605\u2605 Solo 5" })] })] })] })] }), _jsxs("div", { className: "quick-preview__filter-colors", children: [_jsx("button", { type: "button", className: filterColorLabel === "all"
                                            ? "quick-preview__color-chip quick-preview__color-chip--clear quick-preview__color-chip--selected"
                                            : "quick-preview__color-chip quick-preview__color-chip--clear", onClick: () => setFilterColorLabel("all"), children: "Tutti" }), COLOR_LABELS.map((value) => (_jsx("button", { type: "button", className: filterColorLabel === value
                                            ? `quick-preview__color-chip quick-preview__color-chip--${value} quick-preview__color-chip--selected`
                                            : `quick-preview__color-chip quick-preview__color-chip--${value}`, onClick: () => setFilterColorLabel(value), title: COLOR_LABEL_NAMES[value] }, value)))] })] }), previewStrip.length > 0 ? (_jsx("div", { className: "quick-preview__strip", children: previewStrip.map((item) => {
                            const itemPreview = item.thumbnailUrl ?? item.previewUrl ?? item.sourceUrl;
                            const isActive = item.id === asset.id;
                            return (_jsx("button", { type: "button", className: isActive
                                    ? "quick-preview__thumb quick-preview__thumb--active"
                                    : "quick-preview__thumb", "aria-current": isActive ? "true" : undefined, onClick: () => onSelectAsset?.(item.id), children: itemPreview ? (_jsx("img", { src: itemPreview, alt: item.fileName, className: "quick-preview__thumb-image" })) : (item.fileName) }, item.id));
                        }) })) : hasActiveFilters ? (_jsx("div", { className: "quick-preview__empty-filter", children: "Nessuna foto corrisponde ai filtri attivi." })) : null] })) : null, _jsxs("div", { className: "quick-preview__main", onClick: (event) => event.stopPropagation(), children: [_jsxs("div", { className: "quick-preview__chrome", children: [_jsxs("div", { className: "quick-preview__title", children: [_jsx("strong", { children: asset.fileName }), _jsxs("span", { children: [asset.width, " x ", asset.height, " | ", orientationLabels[asset.orientation], asset.width > 0 && asset.height > 0
                                                ? ` | ${((asset.width * asset.height) / 1_000_000).toFixed(1)} MP`
                                                : "", usage ? ` | Foglio ${usage.pageNumber}` : " | Non ancora usata nel layout"] }), asset.xmpHasEdits ? (_jsxs("span", { className: "quick-preview__xmp-badge", title: "Metadati XMP rilevati", children: ["XMP Edit: ", asset.xmpEditInfo ?? "Sviluppo rilevato"] })) : null] }), _jsxs("div", { className: "quick-preview__actions", children: [_jsx("span", { className: "quick-preview__stars", children: formatAssetStars(asset) }), classificationFeedback ? (_jsx("span", { className: `quick-preview__feedback quick-preview__feedback--${classificationFeedback.kind}`, "aria-live": "polite", children: classificationFeedback.label }, classificationFeedback.token)) : null, _jsx(PhotoClassificationHelpButton, { title: "Scorciatoie preview foto" }), _jsx("button", { type: "button", className: compareMode
                                            ? "ghost-button quick-preview__action quick-preview__action--active"
                                            : "ghost-button quick-preview__action", onClick: () => setCompareMode((current) => !current), disabled: !nextAsset && !previousAsset, children: compareMode ? "Chiudi confronto" : "Confronta" }), _jsx("button", { type: "button", className: "ghost-button quick-preview__action", onClick: toggleNativeFullscreen, children: "Fullscreen" }), _jsx("button", { type: "button", className: "ghost-button quick-preview__action", onClick: () => void saveAssetAs(asset.id), title: "Salva una copia del file in una posizione a scelta per aprirlo in un editor esterno (Photoshop, Lightroom, ecc.)", children: "Salva copia" }), _jsx("button", { type: "button", className: "ghost-button quick-preview__action", onClick: onClose, children: "Chiudi" })] })] }), _jsxs("div", { className: "quick-preview__meta-bar", children: [_jsxs("div", { className: "quick-preview__meta-group", children: [_jsx("span", { className: "quick-preview__meta-label", children: "Stelle" }), _jsxs("div", { className: "quick-preview__stars-editor", children: [[1, 2, 3, 4, 5].map((value) => (_jsx("button", { type: "button", className: value <= rating
                                                    ? "quick-preview__star quick-preview__star--active"
                                                    : "quick-preview__star", onClick: () => updateRating(value), children: "\u2605" }, value))), _jsx("button", { type: "button", className: "ghost-button quick-preview__tiny-action", onClick: () => updateRating(0), children: "Azzera" })] })] }), _jsxs("div", { className: "quick-preview__meta-group", children: [_jsx("span", { className: "quick-preview__meta-label", children: "Stato" }), _jsx("div", { className: "quick-preview__pill-row", children: ["picked", "rejected", "unmarked"].map((value) => (_jsx("button", { type: "button", className: pickStatus === value
                                                ? "quick-preview__pill quick-preview__pill--active"
                                                : "quick-preview__pill", onClick: () => updatePickStatus(value), children: PICK_STATUS_LABELS[value] }, value))) })] }), _jsxs("div", { className: "quick-preview__meta-group", children: [_jsx("span", { className: "quick-preview__meta-label", children: "Colore" }), _jsxs("div", { className: "quick-preview__color-row", children: [_jsx("button", { type: "button", className: colorLabel === null
                                                    ? "quick-preview__color-chip quick-preview__color-chip--clear quick-preview__color-chip--selected"
                                                    : "quick-preview__color-chip quick-preview__color-chip--clear", onClick: () => updateColorLabel(null), children: "Nessuno" }), COLOR_LABELS.map((value) => (_jsx("button", { type: "button", className: colorLabel === value
                                                    ? `quick-preview__color-chip quick-preview__color-chip--${value} quick-preview__color-chip--selected`
                                                    : `quick-preview__color-chip quick-preview__color-chip--${value}`, onClick: () => updateColorLabel(value), title: `${COLOR_LABEL_NAMES[value]} | ${getColorShortcutHint(value)}` }, value)))] })] })] }), _jsxs("div", { className: compareMode && compareAsset
                            ? "quick-preview__stage quick-preview__stage--compare"
                            : "quick-preview__stage", ref: stageRef, children: [previousAsset ? (_jsx("button", { type: "button", className: "quick-preview__nav quick-preview__nav--prev", onClick: () => handleNavigate("previous"), children: "<" })) : null, compareMode && compareAsset ? (_jsxs("div", { className: "quick-preview__compare-grid", children: [_jsxs("div", { className: "quick-preview__compare-panel", children: [_jsx("span", { className: "quick-preview__compare-label", children: "Corrente" }), previewUrl ? (_jsx("img", { src: previewUrl, alt: asset.fileName, className: "quick-preview__image quick-preview__image--compare", draggable: false, onDoubleClick: toggleNativeFullscreen })) : (_jsx("div", { className: "quick-preview__placeholder", children: asset.fileName }))] }), _jsxs("div", { className: "quick-preview__compare-panel", children: [_jsx("span", { className: "quick-preview__compare-label", children: compareAsset.fileName }), comparePreviewUrl ? (_jsx("img", { src: comparePreviewUrl, alt: compareAsset.fileName, className: "quick-preview__image quick-preview__image--compare", draggable: false, onDoubleClick: toggleNativeFullscreen })) : (_jsx("div", { className: "quick-preview__placeholder", children: compareAsset.fileName }))] })] })) : previewUrl ? (_jsx("img", { src: previewUrl, alt: asset.fileName, className: "quick-preview__image", draggable: false, onDoubleClick: toggleNativeFullscreen })) : (_jsx("div", { className: "quick-preview__placeholder", children: asset.fileName })), nextAsset ? (_jsx("button", { type: "button", className: "quick-preview__nav quick-preview__nav--next", onClick: () => handleNavigate("next"), children: ">" })) : null] }), navigationAssets.length > 1 ? (_jsxs("div", { className: "quick-preview__dock", children: [_jsxs("div", { className: "quick-preview__dock-copy", children: [_jsxs("strong", { children: ["Foto ", currentIndex + 1, " di ", navigationAssets.length] }), _jsxs("span", { children: [previousAsset ? `Prec: ${previousAsset.fileName}` : "Inizio serie", " \u00B7", " ", nextAsset ? `Succ: ${nextAsset.fileName}` : "Fine serie"] })] }), _jsx("div", { className: "quick-preview__dock-strip", children: previewStrip.map((item) => {
                                    const itemPreview = item.thumbnailUrl ?? item.previewUrl ?? item.sourceUrl;
                                    const isActive = item.id === asset.id;
                                    return (_jsx("button", { type: "button", className: isActive
                                            ? "quick-preview__dock-thumb quick-preview__dock-thumb--active"
                                            : "quick-preview__dock-thumb", "aria-current": isActive ? "true" : undefined, onClick: () => onSelectAsset?.(item.id), title: item.fileName, children: itemPreview ? (_jsx("img", { src: itemPreview, alt: item.fileName, className: "quick-preview__dock-image" })) : (_jsx("span", { className: "quick-preview__dock-fallback", children: item.fileName })) }, `dock-${item.id}`));
                                }) })] })) : null, pages.length > 0 && onAddToPage ? (_jsxs("div", { className: showAssignSuccess
                            ? "quick-preview__assign-bar quick-preview__assign-bar--success"
                            : "quick-preview__assign-bar", children: [_jsxs("div", { className: "quick-preview__assign-copy", children: [_jsx("strong", { children: activePage
                                            ? `Foglio attivo ${activePage.pageNumber}`
                                            : "Nessun foglio attivo" }), _jsx("span", { children: activePage
                                            ? activePageCanAccept
                                                ? usage?.pageId === activePage.id
                                                    ? "La foto è già in questo foglio. Premi Invio per riorganizzarlo."
                                                    : "Premi Invio per aggiungere questa foto al foglio attivo."
                                                : "Il foglio attivo è pieno. Seleziona un altro foglio nello studio."
                                            : "Seleziona un foglio nello studio per usare l'aggiunta rapida." }), showAssignSuccess ? (_jsxs("span", { className: "quick-preview__assign-success", "aria-live": "polite", children: ["Foto aggiunta al foglio attivo ", assignFeedbackPageNumber, "."] })) : null] }), _jsxs("div", { className: "quick-preview__assign-actions", children: [_jsx("button", { type: "button", className: showAssignSuccess
                                            ? "secondary-button quick-preview__assign-button quick-preview__assign-button--active quick-preview__assign-button--success"
                                            : "secondary-button quick-preview__assign-button quick-preview__assign-button--active", onClick: handleAssignToActivePage, disabled: !activePage || !activePageCanAccept, children: !activePage
                                            ? "Nessun foglio attivo"
                                            : usage?.pageId === activePage.id
                                                ? `Riorganizza foglio ${activePage.pageNumber}`
                                                : `Aggiungi al foglio ${activePage.pageNumber}` }), usage?.pageId && onJumpToPage && usage.pageId !== activePage?.id ? (_jsx("button", { type: "button", className: "ghost-button quick-preview__assign-button", onClick: () => onJumpToPage(usage.pageId), children: `Vai al foglio ${usage.pageNumber}` })) : null] })] })) : null] })] }));
    if (typeof document === "undefined") {
        return previewContent;
    }
    return createPortal(previewContent, document.body);
}
//# sourceMappingURL=PhotoQuickPreviewModal.js.map