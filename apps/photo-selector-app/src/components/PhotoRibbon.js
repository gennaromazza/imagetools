import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { preloadImageUrls } from "../services/image-cache";
import { PhotoClassificationHelpButton } from "./PhotoClassificationHelpButton";
import { PhotoColorContextMenu } from "./PhotoColorContextMenu";
import { COLOR_LABEL_NAMES, COLOR_LABELS, DEFAULT_PHOTO_FILTERS, formatAssetStars, getAssetPickStatus, getAssetRating, matchesPhotoFilters, PICK_STATUS_LABELS, resolvePhotoClassificationShortcut } from "../services/photo-classification";
const ITEM_WIDTH = 120;
const OVERSCAN_ITEMS = 4;
function PhotoRibbonContent({ assets, assetFilter, usageByAssetId, dragState, variant = "horizontal", onAssetFilterChange, onDragAssetStart, onDragEnd, onAssetDoubleClick, onAssetsMetadataChange }) {
    const scrollContainerRef = useRef(null);
    const scrollFrameRef = useRef(null);
    const [scrollLeft, setScrollLeft] = useState(0);
    const [visibleItems, setVisibleItems] = useState(8);
    const [pickFilter, setPickFilter] = useState(DEFAULT_PHOTO_FILTERS.pickStatus);
    const [ratingFilter, setRatingFilter] = useState(DEFAULT_PHOTO_FILTERS.ratingFilter);
    const [colorFilter, setColorFilter] = useState(DEFAULT_PHOTO_FILTERS.colorLabel);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const hasActiveFilters = pickFilter !== "all" || ratingFilter !== "any" || colorFilter !== "all";
    function resetFilters() {
        setPickFilter("all");
        setRatingFilter("any");
        setColorFilter("all");
    }
    const [contextMenuState, setContextMenuState] = useState(null);
    const filteredAssets = useMemo(() => assets.filter((asset) => matchesPhotoFilters(asset, {
        pickStatus: pickFilter,
        ratingFilter,
        colorLabel: colorFilter
    })), [assets, colorFilter, ratingFilter, pickFilter]);
    const startIndex = Math.max(0, Math.floor(scrollLeft / ITEM_WIDTH) - 1);
    const endIndex = Math.min(startIndex + visibleItems + OVERSCAN_ITEMS, filteredAssets.length);
    const updateAssetMetadata = useCallback((assetId, changes) => {
        if (!onAssetsMetadataChange) {
            return;
        }
        onAssetsMetadataChange(new Map([[assetId, changes]]));
    }, [onAssetsMetadataChange]);
    const handleScroll = useCallback((event) => {
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
        const handleKeyDown = (event) => {
            if (event.key === "ArrowLeft") {
                event.preventDefault();
                container.scrollBy({ left: -ITEM_WIDTH, behavior: "smooth" });
            }
            else if (event.key === "ArrowRight") {
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
        const handleEscape = (event) => {
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
    const visibleAssets = variant === "vertical" ? filteredAssets : filteredAssets.slice(startIndex, endIndex);
    return (_jsxs("div", { className: variant === "vertical"
            ? "layout-photo-ribbon layout-photo-ribbon--vertical"
            : "layout-photo-ribbon", children: [_jsxs("div", { className: "ribbon-header-compact", children: [_jsxs("div", { className: "ribbon-header-compact__top", children: [_jsx("span", { className: "ribbon-header-compact__title", children: "Libreria foto" }), _jsxs("span", { className: "ribbon-header-compact__count", children: [usageByAssetId.size, " usate \u00B7 ", assets.length - usageByAssetId.size, " libere"] }), _jsx(PhotoClassificationHelpButton, { className: "ribbon-header-compact__help", title: "Scorciatoie libreria foto" })] }), _jsx("div", { className: "ribbon-header-compact__segments", children: [
                            ["all", "Tutte"],
                            ["unused", "Non usate"],
                            ["used", "Usate"]
                        ].map(([value, label]) => (_jsx("button", { type: "button", className: assetFilter === value ? "segment segment--active" : "segment", onClick: () => onAssetFilterChange(value), children: label }, value))) })] }), _jsxs("div", { className: "ribbon-filters-collapsible", children: [_jsxs("button", { type: "button", className: `ribbon-filters-collapsible__toggle ${hasActiveFilters ? "ribbon-filters-collapsible__toggle--active" : ""}`, onClick: () => setFiltersOpen((prev) => !prev), children: [_jsxs("span", { children: ["Filtri avanzati ", hasActiveFilters ? `(${[pickFilter !== "all" ? 1 : 0, ratingFilter !== "any" ? 1 : 0, colorFilter !== "all" ? 1 : 0].reduce((a, b) => a + b, 0)})` : ""] }), _jsx("span", { className: "ribbon-filters-collapsible__arrow", children: filtersOpen ? "▴" : "▾" })] }), filtersOpen && (_jsxs("div", { className: "ribbon-filters-collapsible__body", children: [hasActiveFilters ? (_jsx("button", { type: "button", className: "layout-photo-ribbon__reset", onClick: resetFilters, title: "Azzera tutti i filtri", children: "\u2715 Azzera" })) : null, _jsxs("select", { className: pickFilter !== "all"
                                    ? "layout-photo-ribbon__select layout-photo-ribbon__select--active"
                                    : "layout-photo-ribbon__select", value: pickFilter, onChange: (event) => setPickFilter(event.target.value), "aria-label": "Filtra per stato", children: [_jsx("option", { value: "all", children: "Tutti gli stati" }), _jsx("option", { value: "picked", children: "Solo pick" }), _jsx("option", { value: "rejected", children: "Solo scartate" }), _jsx("option", { value: "unmarked", children: "Solo neutre" })] }), _jsxs("select", { className: ratingFilter !== "any"
                                    ? "layout-photo-ribbon__select layout-photo-ribbon__select--active"
                                    : "layout-photo-ribbon__select", value: ratingFilter, onChange: (event) => setRatingFilter(event.target.value), "aria-label": "Filtra per stelle", children: [_jsx("option", { value: "any", children: "Tutte le stelle" }), _jsxs("optgroup", { label: "Minimo", children: [_jsx("option", { value: "1+", children: "\u2605 1+ stelle" }), _jsx("option", { value: "2+", children: "\u2605\u2605 2+ stelle" }), _jsx("option", { value: "3+", children: "\u2605\u2605\u2605 3+ stelle" }), _jsx("option", { value: "4+", children: "\u2605\u2605\u2605\u2605 4+ stelle" })] }), _jsxs("optgroup", { label: "Esattamente", children: [_jsx("option", { value: "0", children: "Senza stelle" }), _jsx("option", { value: "1", children: "\u2605 Solo 1" }), _jsx("option", { value: "2", children: "\u2605\u2605 Solo 2" }), _jsx("option", { value: "3", children: "\u2605\u2605\u2605 Solo 3" }), _jsx("option", { value: "4", children: "\u2605\u2605\u2605\u2605 Solo 4" }), _jsx("option", { value: "5", children: "\u2605\u2605\u2605\u2605\u2605 Solo 5" })] })] }), _jsxs("div", { className: "layout-photo-ribbon__color-filter", "aria-label": "Filtra per colore", children: [_jsx("button", { type: "button", className: colorFilter === "all"
                                            ? "layout-photo-ribbon__color-chip layout-photo-ribbon__color-chip--all layout-photo-ribbon__color-chip--active"
                                            : "layout-photo-ribbon__color-chip layout-photo-ribbon__color-chip--all", onClick: () => setColorFilter("all"), children: "Tutti" }), COLOR_LABELS.map((value) => (_jsx("button", { type: "button", className: colorFilter === value
                                            ? `layout-photo-ribbon__color-chip layout-photo-ribbon__color-chip--${value} layout-photo-ribbon__color-chip--active`
                                            : `layout-photo-ribbon__color-chip layout-photo-ribbon__color-chip--${value}`, onClick: () => setColorFilter(value), title: COLOR_LABEL_NAMES[value] }, value)))] })] }))] }), _jsx("div", { className: "layout-photo-ribbon__track-wrapper", children: _jsxs("div", { ref: scrollContainerRef, className: variant === "vertical"
                        ? "layout-photo-ribbon__track layout-photo-ribbon__track--vertical"
                        : "layout-photo-ribbon__track", onScroll: variant === "vertical" ? undefined : handleScroll, role: "region", "aria-label": variant === "vertical"
                        ? "Libreria foto verticale"
                        : "Nastro fotografico - usa frecce per scorrere", tabIndex: 0, children: [variant === "horizontal" && startIndex > 0 ? (_jsx("div", { style: { width: startIndex * ITEM_WIDTH, flexShrink: 0 } })) : null, visibleAssets.map((asset) => {
                            const usage = usageByAssetId.get(asset.id);
                            const isActive = dragState?.imageId === asset.id;
                            const rating = getAssetRating(asset);
                            const pickStatus = getAssetPickStatus(asset);
                            const isUsed = Boolean(usage);
                            return (_jsxs("button", { type: "button", draggable: true, "data-preview-asset-id": asset.id, className: [
                                    "ribbon-photo",
                                    variant === "vertical" ? "ribbon-photo--vertical" : "",
                                    isActive ? "ribbon-photo--dragging" : "",
                                    isUsed ? "ribbon-photo--used" : "",
                                    asset.colorLabel ? `ribbon-photo--label-${asset.colorLabel}` : ""
                                ]
                                    .filter(Boolean)
                                    .join(" "), onDragStart: (event) => {
                                    event.dataTransfer.setData("text/plain", asset.id);
                                    setTimeout(() => onDragAssetStart(asset.id), 0);
                                }, onDragEnd: onDragEnd, onContextMenu: (event) => {
                                    if (!onAssetsMetadataChange) {
                                        return;
                                    }
                                    event.preventDefault();
                                    setContextMenuState({
                                        assetId: asset.id,
                                        x: event.clientX,
                                        y: event.clientY
                                    });
                                }, onKeyDown: (event) => {
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
                                }, onMouseEnter: () => {
                                    const url = asset.previewUrl ?? asset.thumbnailUrl;
                                    if (url)
                                        preloadImageUrls([url]);
                                }, onDoubleClick: () => onAssetDoubleClick?.(asset.id), children: [asset.thumbnailUrl ?? asset.previewUrl ? (_jsx("img", { src: asset.thumbnailUrl ?? asset.previewUrl, alt: asset.fileName, className: "ribbon-photo__image", loading: "lazy" })) : (_jsx("div", { className: "ribbon-photo__placeholder", children: asset.fileName })), isUsed ? _jsx("span", { className: "ribbon-photo__usage-overlay", children: "Usata" }) : null, _jsxs("div", { className: "ribbon-photo__badges", children: [_jsx("span", { className: `asset-pick-badge asset-pick-badge--${pickStatus}`, children: PICK_STATUS_LABELS[pickStatus] }), asset.colorLabel ? (_jsx("span", { className: `asset-color-dot asset-color-dot--${asset.colorLabel}` })) : null, usage ? (_jsx("span", { className: "ribbon-photo__usage-chip", children: `F.${usage.pageNumber}` })) : null] }), _jsxs("div", { className: "ribbon-photo__meta", children: [_jsx("strong", { children: asset.fileName?.substring(0, 14) }), variant === "vertical" ? (_jsxs("span", { children: [usage ? `Foglio ${usage.pageNumber}` : "Disponibile", rating > 0 ? ` · ${formatAssetStars(asset)}` : ""] })) : (_jsxs(_Fragment, { children: [_jsx("span", { children: usage ? `Foglio ${usage.pageNumber}` : "Disponibile" }), rating > 0 ? _jsx("small", { children: formatAssetStars(asset) }) : null] }))] })] }, asset.id));
                        }), variant === "horizontal" && endIndex < filteredAssets.length ? (_jsx("div", { style: { width: (filteredAssets.length - endIndex) * ITEM_WIDTH, flexShrink: 0 } })) : null] }) }), _jsx("div", { className: "layout-photo-ribbon__hint", children: _jsxs("small", { children: [filteredAssets.length, " foto visibili"] }) }), contextMenuState ? (_jsx(PhotoColorContextMenu, { x: contextMenuState.x, y: contextMenuState.y, selectedColor: assets.find((asset) => asset.id === contextMenuState.assetId)?.colorLabel ?? null, onSelect: (colorLabel) => {
                    updateAssetMetadata(contextMenuState.assetId, { colorLabel });
                    setContextMenuState(null);
                } })) : null] }));
}
export const PhotoRibbon = memo(PhotoRibbonContent);
PhotoRibbon.displayName = "PhotoRibbon";
//# sourceMappingURL=PhotoRibbon.js.map