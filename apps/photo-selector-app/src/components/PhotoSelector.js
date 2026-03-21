import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PhotoClassificationHelpButton } from "./PhotoClassificationHelpButton";
import { PhotoQuickPreviewModal } from "./PhotoQuickPreviewModal";
import { PhotoSearchBar } from "./PhotoSearchBar";
import { PhotoCard } from "./PhotoCard";
import { PhotoSelectionContextMenu } from "./PhotoSelectionContextMenu";
import { createOnDemandPreviewAsync, getSubfolder, extractSubfolders } from "../services/folder-access";
import { COLOR_LABEL_NAMES, COLOR_LABELS, DEFAULT_PHOTO_FILTERS, getAssetRating, matchesPhotoFilters, } from "../services/photo-classification";
import { loadPhotoSelectorPreferences, savePhotoSelectorPreferences, } from "../services/photo-selector-preferences";
function describeMetadataChanges(changes, targetCount) {
    const subject = targetCount === 1 ? "1 foto" : `${targetCount} foto`;
    if (changes.rating !== undefined) {
        return changes.rating > 0
            ? `${subject}: assegnate ${changes.rating} stelle`
            : `${subject}: stelle azzerate`;
    }
    if (changes.pickStatus !== undefined) {
        return `${subject}: stato ${changes.pickStatus === "picked" ? "Pick" : changes.pickStatus === "rejected" ? "Scartata" : "Neutra"}`;
    }
    if (changes.colorLabel !== undefined) {
        return `${subject}: etichetta ${changes.colorLabel ? COLOR_LABEL_NAMES[changes.colorLabel] : "rimossa"}`;
    }
    return `${subject}: metadati aggiornati`;
}
function getSeriesKey(photo) {
    const stem = photo.fileName.replace(/\.[^.]+$/, "");
    const normalized = stem.replace(/[_\-\s]*\d+$/, "").trim();
    return normalized || stem;
}
function getTimeClusterKey(photo) {
    const timestampRaw = photo.sourceFileKey?.split("::").at(-1);
    const timestamp = timestampRaw ? Number(timestampRaw) : NaN;
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
        return "orario-non-disponibile";
    }
    const date = new Date(timestamp);
    const bucketMinutes = Math.floor(date.getMinutes() / 5) * 5;
    const bucket = new Date(date);
    bucket.setMinutes(bucketMinutes, 0, 0);
    const day = bucket.toLocaleDateString("it-IT");
    const time = bucket.toLocaleTimeString("it-IT", {
        hour: "2-digit",
        minute: "2-digit",
    });
    return `${day} ${time}`;
}
export function PhotoSelector({ photos, selectedIds, onSelectionChange, onPhotosChange, onVisibleIdsChange, onUndo, onRedo, canUndo = false, canRedo = false, }) {
    const [sortBy, setSortBy] = useState("name");
    const [pickFilter, setPickFilter] = useState(DEFAULT_PHOTO_FILTERS.pickStatus);
    const [ratingFilter, setRatingFilter] = useState(DEFAULT_PHOTO_FILTERS.ratingFilter);
    const [colorFilter, setColorFilter] = useState(DEFAULT_PHOTO_FILTERS.colorLabel);
    const [folderFilter, setFolderFilter] = useState("all");
    const [seriesFilter, setSeriesFilter] = useState("all");
    const [timeClusterFilter, setTimeClusterFilter] = useState("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [customColorNames, setCustomColorNames] = useState(() => ({ ...COLOR_LABEL_NAMES }));
    const [filterPresets, setFilterPresets] = useState([]);
    const [newPresetName, setNewPresetName] = useState("");
    const [timelineEntries, setTimelineEntries] = useState([]);
    const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
    const [isBatchToolsOpen, setIsBatchToolsOpen] = useState(false);
    const [previewAssetId, setPreviewAssetId] = useState(null);
    const [contextMenuState, setContextMenuState] = useState(null);
    const [focusedPhotoId, setFocusedPhotoId] = useState(null);
    const lastClickedIdRef = useRef(null);
    const gridRef = useRef(null);
    const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
    const hasActiveFilters = pickFilter !== "all" ||
        ratingFilter !== "any" ||
        colorFilter !== "all" ||
        folderFilter !== "all" ||
        seriesFilter !== "all" ||
        timeClusterFilter !== "all" ||
        searchQuery !== "";
    const pushTimelineEntry = useCallback((label) => {
        setTimelineEntries((current) => [
            { id: `timeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, label },
            ...current,
        ].slice(0, 5));
    }, []);
    useEffect(() => {
        const preferences = loadPhotoSelectorPreferences();
        setCustomColorNames(preferences.colorNames);
        setFilterPresets(preferences.filterPresets);
    }, []);
    const applyPhotoChanges = useCallback((id, changes) => {
        if (!onPhotosChange)
            return;
        let changed = false;
        const nextPhotos = photos.map((photo) => {
            if (photo.id !== id) {
                return photo;
            }
            const nextRating = changes.rating ?? photo.rating;
            const nextPickStatus = changes.pickStatus ?? photo.pickStatus;
            const nextColorLabel = changes.colorLabel !== undefined ? changes.colorLabel : photo.colorLabel;
            if (nextRating === photo.rating &&
                nextPickStatus === photo.pickStatus &&
                nextColorLabel === photo.colorLabel) {
                return photo;
            }
            changed = true;
            return {
                ...photo,
                ...changes
            };
        });
        if (changed) {
            onPhotosChange(nextPhotos);
            pushTimelineEntry(describeMetadataChanges(changes, 1));
        }
    }, [onPhotosChange, photos, pushTimelineEntry]);
    function resetFilters() {
        setPickFilter("all");
        setRatingFilter("any");
        setColorFilter("all");
        setFolderFilter("all");
        setSeriesFilter("all");
        setTimeClusterFilter("all");
        setSearchQuery("");
    }
    const persistPreferences = useCallback((nextColorNames, nextFilterPresets) => {
        savePhotoSelectorPreferences({
            colorNames: nextColorNames,
            filterPresets: nextFilterPresets,
        });
    }, []);
    const handleColorNameChange = useCallback((label, value) => {
        setCustomColorNames((current) => {
            const next = {
                ...current,
                [label]: value.trim() || COLOR_LABEL_NAMES[label],
            };
            persistPreferences(next, filterPresets);
            return next;
        });
    }, [filterPresets, persistPreferences]);
    const handleSavePreset = useCallback(() => {
        const trimmedName = newPresetName.trim();
        if (!trimmedName) {
            return;
        }
        const nextPreset = {
            id: `preset-${Date.now()}`,
            name: trimmedName,
            filters: {
                pickStatus: pickFilter,
                ratingFilter,
                colorLabel: colorFilter,
                folderFilter,
                seriesFilter,
                timeClusterFilter,
                searchQuery,
            },
        };
        setFilterPresets((current) => {
            const next = [nextPreset, ...current].slice(0, 12);
            persistPreferences(customColorNames, next);
            return next;
        });
        setNewPresetName("");
    }, [colorFilter, customColorNames, folderFilter, newPresetName, persistPreferences, pickFilter, ratingFilter, searchQuery, seriesFilter, timeClusterFilter]);
    const applyPreset = useCallback((preset) => {
        setPickFilter(preset.filters.pickStatus);
        setRatingFilter(preset.filters.ratingFilter);
        setColorFilter(preset.filters.colorLabel);
        setFolderFilter(preset.filters.folderFilter ?? "all");
        setSeriesFilter(preset.filters.seriesFilter ?? "all");
        setTimeClusterFilter(preset.filters.timeClusterFilter ?? "all");
        setSearchQuery(preset.filters.searchQuery ?? "");
    }, []);
    const removePreset = useCallback((presetId) => {
        setFilterPresets((current) => {
            const next = current.filter((preset) => preset.id !== presetId);
            persistPreferences(customColorNames, next);
            return next;
        });
    }, [customColorNames, persistPreferences]);
    // Extract unique subfolders for the folder filter dropdown
    const subfolders = useMemo(() => extractSubfolders(photos), [photos]);
    const seriesGroups = useMemo(() => {
        const counts = new Map();
        for (const photo of photos) {
            const key = getSeriesKey(photo);
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return Array.from(counts.entries())
            .map(([key, count]) => ({ key, count }))
            .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
    }, [photos]);
    const timeClusters = useMemo(() => {
        const counts = new Map();
        for (const photo of photos) {
            const key = getTimeClusterKey(photo);
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return Array.from(counts.entries())
            .map(([key, count]) => ({ key, count }))
            .sort((left, right) => left.key.localeCompare(right.key));
    }, [photos]);
    const visiblePhotos = useMemo(() => {
        const lowerSearch = searchQuery.toLowerCase();
        const filtered = photos.filter((photo) => {
            if (!matchesPhotoFilters(photo, {
                pickStatus: pickFilter,
                ratingFilter,
                colorLabel: colorFilter
            }))
                return false;
            if (folderFilter !== "all" && getSubfolder(photo.path) !== folderFilter)
                return false;
            if (seriesFilter !== "all" && getSeriesKey(photo) !== seriesFilter)
                return false;
            if (timeClusterFilter !== "all" && getTimeClusterKey(photo) !== timeClusterFilter)
                return false;
            if (lowerSearch && !photo.fileName.toLowerCase().includes(lowerSearch))
                return false;
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
    }, [colorFilter, folderFilter, photos, pickFilter, ratingFilter, searchQuery, seriesFilter, sortBy, timeClusterFilter]);
    // Search in all photos so preview doesn't close when filters change
    const previewAsset = previewAssetId
        ? (photos.find((p) => p.id === previewAssetId) ?? null)
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
    // Consolidated keyboard handler: Escape chain + arrow navigation
    const handleWindowKeyDown = useCallback((event) => {
        // Context menu open: only handle Escape
        if (contextMenuState) {
            if (event.key === "Escape") {
                event.preventDefault();
                setContextMenuState(null);
            }
            return;
        }
        // Quick preview open: let it handle keys
        if (previewAssetId)
            return;
        // Arrow navigation within grid
        const arrowKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
        if (!arrowKeys.includes(event.key))
            return;
        const target = event.target;
        if (target.closest("select, input, textarea"))
            return;
        event.preventDefault();
        if (visiblePhotos.length === 0)
            return;
        const currentIndex = focusedPhotoId
            ? visiblePhotos.findIndex((p) => p.id === focusedPhotoId)
            : -1;
        const grid = gridRef.current;
        let cols = 4;
        if (grid) {
            const firstCard = grid.querySelector(".photo-card");
            if (firstCard && firstCard.offsetWidth > 0) {
                cols = Math.max(1, Math.floor(grid.clientWidth / firstCard.offsetWidth));
            }
        }
        let nextIndex;
        if (currentIndex < 0) {
            nextIndex = 0;
        }
        else if (event.key === "ArrowRight") {
            nextIndex = Math.min(visiblePhotos.length - 1, currentIndex + 1);
        }
        else if (event.key === "ArrowLeft") {
            nextIndex = Math.max(0, currentIndex - 1);
        }
        else if (event.key === "ArrowDown") {
            nextIndex = Math.min(visiblePhotos.length - 1, currentIndex + cols);
        }
        else {
            nextIndex = Math.max(0, currentIndex - cols);
        }
        if (nextIndex !== currentIndex || currentIndex < 0) {
            const next = visiblePhotos[nextIndex];
            setFocusedPhotoId(next.id);
            const el = grid?.querySelector(`[data-preview-asset-id="${next.id}"]`);
            if (el) {
                el.focus();
                el.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }
        }
    }, [contextMenuState, focusedPhotoId, previewAssetId, visiblePhotos]);
    useEffect(() => {
        window.addEventListener("keydown", handleWindowKeyDown);
        return () => window.removeEventListener("keydown", handleWindowKeyDown);
    }, [handleWindowKeyDown]);
    function togglePhoto(id, event) {
        const nextSelection = new Set(selectedSet);
        // Shift+click range selection
        if (event?.shiftKey && lastClickedIdRef.current) {
            const lastIdx = visiblePhotos.findIndex((p) => p.id === lastClickedIdRef.current);
            const curIdx = visiblePhotos.findIndex((p) => p.id === id);
            if (lastIdx >= 0 && curIdx >= 0) {
                const [from, to] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
                for (let i = from; i <= to; i++) {
                    nextSelection.add(visiblePhotos[i].id);
                }
                lastClickedIdRef.current = id;
                onSelectionChange(Array.from(nextSelection));
                return;
            }
        }
        if (nextSelection.has(id)) {
            nextSelection.delete(id);
        }
        else {
            nextSelection.add(id);
        }
        lastClickedIdRef.current = id;
        onSelectionChange(Array.from(nextSelection));
    }
    function toggleAll(selectAll) {
        if (selectAll) {
            const idsToSelect = hasActiveFilters
                ? visiblePhotos.map((p) => p.id)
                : photos.map((p) => p.id);
            onSelectionChange(idsToSelect);
            pushTimelineEntry(hasActiveFilters
                ? `Selezionate ${idsToSelect.length} foto visibili con i filtri attivi`
                : `Selezionate tutte le ${idsToSelect.length} foto`);
        }
        else {
            onSelectionChange([]);
            pushTimelineEntry("Deselezionate tutte le foto");
        }
    }
    function updatePhoto(id, changes) {
        applyPhotoChanges(id, changes);
    }
    const applyBatchChanges = useCallback((targetIds, changes) => {
        if (!onPhotosChange || targetIds.length === 0) {
            return;
        }
        const idSet = new Set(targetIds);
        let changed = false;
        const nextPhotos = photos.map((photo) => {
            if (!idSet.has(photo.id)) {
                return photo;
            }
            const nextRating = changes.rating ?? photo.rating;
            const nextPickStatus = changes.pickStatus ?? photo.pickStatus;
            const nextColorLabel = changes.colorLabel !== undefined ? changes.colorLabel : photo.colorLabel;
            if (nextRating === photo.rating &&
                nextPickStatus === photo.pickStatus &&
                nextColorLabel === photo.colorLabel) {
                return photo;
            }
            changed = true;
            return {
                ...photo,
                ...changes,
            };
        });
        if (changed) {
            onPhotosChange(nextPhotos);
            pushTimelineEntry(describeMetadataChanges(changes, targetIds.length));
        }
    }, [onPhotosChange, photos, pushTimelineEntry]);
    const clearSelection = useCallback(() => {
        onSelectionChange([]);
        pushTimelineEntry("Selezione svuotata");
    }, [onSelectionChange, pushTimelineEntry]);
    const invertVisibleSelection = useCallback(() => {
        const visibleIdSet = new Set(visiblePhotos.map((photo) => photo.id));
        const nextSelection = new Set(selectedIds.filter((id) => !visibleIdSet.has(id)));
        for (const photo of visiblePhotos) {
            if (!selectedSet.has(photo.id)) {
                nextSelection.add(photo.id);
            }
        }
        onSelectionChange(Array.from(nextSelection));
        pushTimelineEntry("Selezione visibile invertita");
    }, [onSelectionChange, pushTimelineEntry, selectedIds, selectedSet, visiblePhotos]);
    // ── Stable callbacks for PhotoCard (identity doesn't matter due to custom memo) ──
    const handleFocus = useCallback((id) => {
        setFocusedPhotoId(id);
    }, []);
    const handlePreview = useCallback((id) => {
        setPreviewAssetId(id);
    }, []);
    const handleContextMenu = useCallback((id, x, y) => {
        if (!onPhotosChange)
            return;
        const targetIds = selectedSet.has(id) ? selectedIds : [id];
        setContextMenuState({ x, y, targetIds });
    }, [onPhotosChange, selectedIds, selectedSet]);
    const handleUpdatePhoto = useCallback((id, changes) => {
        applyPhotoChanges(id, changes);
    }, [applyPhotoChanges]);
    // ── IntersectionObserver for viewport tracking (pipeline priority) ──
    const observerRef = useRef(null);
    const visibleIdsRef = useRef(new Set());
    useEffect(() => {
        const grid = gridRef.current;
        if (!grid || !onVisibleIdsChange)
            return;
        const observer = new IntersectionObserver((entries) => {
            let changed = false;
            for (const entry of entries) {
                const el = entry.target;
                const id = el.dataset.previewAssetId;
                if (!id)
                    continue;
                if (entry.isIntersecting) {
                    if (!visibleIdsRef.current.has(id)) {
                        visibleIdsRef.current.add(id);
                        changed = true;
                    }
                }
                else {
                    if (visibleIdsRef.current.has(id)) {
                        visibleIdsRef.current.delete(id);
                        changed = true;
                    }
                }
            }
            if (changed)
                onVisibleIdsChange(new Set(visibleIdsRef.current));
        }, { root: grid, rootMargin: "200px 0px" });
        observerRef.current = observer;
        // Observe all cards currently in the grid
        const cards = grid.querySelectorAll("[data-preview-asset-id]");
        for (let i = 0; i < cards.length; i++) {
            observer.observe(cards[i]);
        }
        // Auto-observe new cards added to the grid via MutationObserver
        const mutation = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (let i = 0; i < m.addedNodes.length; i++) {
                    const node = m.addedNodes[i];
                    if (node instanceof HTMLElement && node.dataset.previewAssetId) {
                        observer.observe(node);
                    }
                }
            }
        });
        mutation.observe(grid, { childList: true });
        return () => {
            observer.disconnect();
            mutation.disconnect();
        };
    }, [onVisibleIdsChange]);
    // ── On-demand preview URL for QuickPreviewModal ──
    // Key insight: the URL must be stable for a given asset ID so the browser
    // can finish decoding large JPEGs without being interrupted by thumbnail
    // batch updates that change the asset object reference every ~120 ms.
    const previewUrlRef = useRef(null);
    const [asyncPreviewUrl, setAsyncPreviewUrl] = useState(null);
    useEffect(() => {
        if (!previewAsset) {
            if (previewUrlRef.current) {
                previewUrlRef.current = null;
            }
            setAsyncPreviewUrl(null);
            return;
        }
        if (previewUrlRef.current && previewUrlRef.current.id === previewAsset.id) {
            return;
        }
        let active = true;
        if (previewUrlRef.current) {
            previewUrlRef.current = null;
            setAsyncPreviewUrl(null);
        }
        createOnDemandPreviewAsync(previewAsset.id, 0).then((url) => {
            if (!active)
                return;
            if (url) {
                previewUrlRef.current = { id: previewAsset.id, url };
                setAsyncPreviewUrl(url);
            }
        });
        return () => {
            active = false;
        };
    }, [previewAsset]);
    // Preload nearby assets in high quality to make arrow/space navigation instant.
    useEffect(() => {
        if (!previewAssetId || visiblePhotos.length === 0)
            return;
        const currentIndex = visiblePhotos.findIndex((p) => p.id === previewAssetId);
        if (currentIndex < 0)
            return;
        const idsToWarm = [];
        for (let delta = 1; delta <= 5; delta++) {
            const prev = visiblePhotos[currentIndex - delta];
            const next = visiblePhotos[currentIndex + delta];
            if (prev)
                idsToWarm.push(prev.id);
            if (next)
                idsToWarm.push(next.id);
        }
        if (idsToWarm.length === 0)
            return;
        void Promise.all(idsToWarm.map((id, index) => createOnDemandPreviewAsync(id, index < 4 ? 1 : 2).catch(() => null)));
    }, [previewAssetId, visiblePhotos]);
    const previewAssetWithUrl = useMemo(() => {
        if (!previewAsset)
            return null;
        if (previewAsset.previewUrl || previewAsset.sourceUrl)
            return previewAsset;
        if (previewUrlRef.current && previewUrlRef.current.id === previewAsset.id) {
            return {
                ...previewAsset,
                previewUrl: previewUrlRef.current.url,
                sourceUrl: previewUrlRef.current.url,
            };
        }
        return previewAsset; // Until async finishes, use what we have (thumbnailUrl usually)
    }, [previewAsset, asyncPreviewUrl]);
    const allSelected = photos.length > 0 && selectedIds.length === photos.length;
    const someSelected = selectedIds.length > 0 && selectedIds.length < photos.length;
    const visibleSelectedCount = useMemo(() => visiblePhotos.filter((photo) => selectedSet.has(photo.id)).length, [selectedSet, visiblePhotos]);
    function selectVisible() {
        onSelectionChange(visiblePhotos.map((photo) => photo.id));
        pushTimelineEntry(`Selezionate ${visiblePhotos.length} foto visibili`);
    }
    function addVisibleToSelection() {
        const nextSelection = new Set(selectedIds);
        for (const photo of visiblePhotos) {
            nextSelection.add(photo.id);
        }
        onSelectionChange(Array.from(nextSelection));
        pushTimelineEntry(`Aggiunte ${visiblePhotos.length} foto visibili alla selezione`);
    }
    function removeVisibleFromSelection() {
        const visibleIds = new Set(visiblePhotos.map((photo) => photo.id));
        onSelectionChange(selectedIds.filter((id) => !visibleIds.has(id)));
        pushTimelineEntry("Rimosse dalla selezione le foto visibili");
    }
    function activatePickedOnly() {
        onSelectionChange(photos.filter((photo) => photo.pickStatus === "picked").map((photo) => photo.id));
        pushTimelineEntry("Selezionate solo le foto Pick");
    }
    function excludeRejected() {
        onSelectionChange(selectedIds.filter((id) => {
            const photo = photos.find((asset) => asset.id === id);
            return photo?.pickStatus !== "rejected";
        }));
        pushTimelineEntry("Escluse dalla selezione le scartate");
    }
    function selectByMinimumRating(minRating) {
        onSelectionChange(photos.filter((photo) => getAssetRating(photo) >= minRating).map((photo) => photo.id));
        pushTimelineEntry(`Selezionate le foto con almeno ${minRating} stelle`);
    }
    const handleUndoClick = useCallback(() => {
        onUndo?.();
        pushTimelineEntry("Annullata ultima modifica");
    }, [onUndo, pushTimelineEntry]);
    const handleRedoClick = useCallback(() => {
        onRedo?.();
        pushTimelineEntry("Ripristinata modifica annullata");
    }, [onRedo, pushTimelineEntry]);
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "photo-selector", children: [_jsxs("div", { className: "photo-selector__controls", children: [_jsx("div", { className: "photo-selector__stats", children: _jsxs("span", { className: "photo-selector__count", "aria-live": "polite", children: [selectedIds.length, " di ", photos.length, " foto selezionate", hasActiveFilters ? ` — ${visiblePhotos.length} visibili con i filtri` : ""] }) }), _jsxs("div", { className: "photo-selector__actions", children: [(onUndo || onRedo) ? (_jsxs("div", { className: "photo-selector__action-cluster", children: [_jsx("span", { className: "photo-selector__action-cluster-label", children: "Cronologia" }), _jsxs("div", { className: "photo-selector__undo-group", children: [_jsx("button", { type: "button", className: "icon-button", onClick: handleUndoClick, disabled: !canUndo, title: "Annulla (Ctrl+Z)", "aria-label": "Annulla", children: "\u21A9" }), _jsx("button", { type: "button", className: "icon-button", onClick: handleRedoClick, disabled: !canRedo, title: "Ripeti (Ctrl+Shift+Z)", "aria-label": "Ripeti", children: "\u21AA" })] })] })) : null, _jsxs("div", { className: "photo-selector__action-cluster", children: [_jsx("span", { className: "photo-selector__action-cluster-label", children: "Ricerca" }), _jsxs("div", { className: "photo-selector__action-inline", children: [_jsx(PhotoSearchBar, { value: searchQuery, onChange: setSearchQuery, resultCount: visiblePhotos.length, totalCount: photos.length }), _jsx(PhotoClassificationHelpButton, { title: "Scorciatoie selezione iniziale" })] })] }), _jsxs("div", { className: "photo-selector__action-cluster", children: [_jsx("span", { className: "photo-selector__action-cluster-label", children: "Catalogo" }), _jsxs("div", { className: "photo-selector__action-inline", children: [_jsx("button", { type: "button", className: `checkbox-button ${allSelected
                                                            ? "checkbox-button--checked"
                                                            : someSelected
                                                                ? "checkbox-button--indeterminate"
                                                                : ""}`, onClick: () => toggleAll(!allSelected), "aria-label": allSelected ? "Deseleziona tutte" : "Seleziona tutte", title: hasActiveFilters ? "Seleziona solo le foto visibili con i filtri attivi" : "Seleziona tutte", children: allSelected ? "Tutte" : someSelected ? "Alcune" : "Nessuna" }), _jsxs("select", { className: "photo-selector__sort", value: sortBy, onChange: (event) => setSortBy(event.target.value), "aria-label": "Ordina foto per", children: [_jsx("option", { value: "name", children: "Ordina per nome" }), _jsx("option", { value: "orientation", children: "Ordina per orientamento" }), _jsx("option", { value: "rating", children: "Ordina per stelle" })] })] })] })] })] }), _jsxs("div", { className: "photo-selector__filters", children: [hasActiveFilters ? (_jsx("button", { type: "button", className: "photo-selector__reset-filters", onClick: resetFilters, title: "Azzera tutti i filtri", children: "\u2715 Azzera filtri" })) : null, subfolders.length > 1 ? (_jsxs("select", { className: folderFilter !== "all" ? "photo-selector__sort photo-selector__sort--active photo-selector__sort--folder" : "photo-selector__sort photo-selector__sort--folder", value: folderFilter, onChange: (event) => setFolderFilter(event.target.value), "aria-label": "Filtra per cartella", children: [_jsxs("option", { value: "all", children: ["\uD83D\uDCC1 Tutte le cartelle (", photos.length, ")"] }), subfolders.map(({ folder, count }) => (_jsxs("option", { value: folder, children: [folder === "" ? "📄 Root" : `📂 ${folder}`, " (", count, ")"] }, folder)))] })) : null, _jsxs("select", { className: pickFilter !== "all" ? "photo-selector__sort photo-selector__sort--active" : "photo-selector__sort", value: pickFilter, onChange: (event) => setPickFilter(event.target.value), children: [_jsx("option", { value: "all", children: "Tutti gli stati" }), _jsx("option", { value: "picked", children: "Solo pick" }), _jsx("option", { value: "rejected", children: "Solo scartate" }), _jsx("option", { value: "unmarked", children: "Solo neutre" })] }), _jsxs("select", { className: ratingFilter !== "any" ? "photo-selector__sort photo-selector__sort--active" : "photo-selector__sort", value: ratingFilter, onChange: (event) => setRatingFilter(event.target.value), children: [_jsx("option", { value: "any", children: "Tutte le stelle" }), _jsxs("optgroup", { label: "Minimo", children: [_jsx("option", { value: "1+", children: "\u2605 1 o pi\u00F9" }), _jsx("option", { value: "2+", children: "\u2605\u2605 2 o pi\u00F9" }), _jsx("option", { value: "3+", children: "\u2605\u2605\u2605 3 o pi\u00F9" }), _jsx("option", { value: "4+", children: "\u2605\u2605\u2605\u2605 4 o pi\u00F9" })] }), _jsxs("optgroup", { label: "Esattamente", children: [_jsx("option", { value: "0", children: "Senza stelle" }), _jsx("option", { value: "1", children: "\u2605 Solo 1" }), _jsx("option", { value: "2", children: "\u2605\u2605 Solo 2" }), _jsx("option", { value: "3", children: "\u2605\u2605\u2605 Solo 3" }), _jsx("option", { value: "4", children: "\u2605\u2605\u2605\u2605 Solo 4" }), _jsx("option", { value: "5", children: "\u2605\u2605\u2605\u2605\u2605 Solo 5" })] })] }), _jsxs("select", { className: colorFilter !== "all" ? "photo-selector__sort photo-selector__sort--active" : "photo-selector__sort", value: colorFilter, onChange: (event) => setColorFilter(event.target.value), children: [_jsx("option", { value: "all", children: "Tutti i colori" }), COLOR_LABELS.map((value) => (_jsx("option", { value: value, children: customColorNames[value] }, value)))] }), seriesGroups.length > 1 ? (_jsxs("select", { className: seriesFilter !== "all" ? "photo-selector__sort photo-selector__sort--active" : "photo-selector__sort", value: seriesFilter, onChange: (event) => setSeriesFilter(event.target.value), "aria-label": "Filtra per serie di scatto", children: [_jsx("option", { value: "all", children: "Tutte le serie" }), seriesGroups.map(({ key, count }) => (_jsxs("option", { value: key, children: [key, " (", count, ")"] }, key)))] })) : null, timeClusters.length > 1 ? (_jsxs("select", { className: timeClusterFilter !== "all" ? "photo-selector__sort photo-selector__sort--active" : "photo-selector__sort", value: timeClusterFilter, onChange: (event) => setTimeClusterFilter(event.target.value), "aria-label": "Filtra per fascia oraria", children: [_jsx("option", { value: "all", children: "Tutte le fasce orarie" }), timeClusters.map(({ key, count }) => (_jsxs("option", { value: key, children: [key === "orario-non-disponibile" ? "Orario non disponibile" : key, " (", count, ")"] }, key)))] })) : null] }), _jsxs("section", { className: "photo-selector__collapsible-shell", children: [_jsxs("div", { className: "photo-selector__collapsible-header", children: [_jsxs("div", { className: "photo-selector__collapsible-copy", children: [_jsx("span", { className: "photo-selector__workspace-label", children: "Workspace avanzato" }), _jsx("span", { className: "photo-selector__collapsible-summary", children: "Preset filtri e nomi personalizzati etichette." })] }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => setIsWorkspaceOpen((current) => !current), children: isWorkspaceOpen ? "Nascondi" : "Mostra" })] }), _jsxs("div", { className: "photo-selector__workspace-panel", hidden: !isWorkspaceOpen, children: [_jsxs("div", { className: "photo-selector__workspace-group", children: [_jsx("span", { className: "photo-selector__workspace-label", children: "Preset filtri" }), _jsxs("div", { className: "photo-selector__preset-form", children: [_jsx("input", { className: "photo-selector__preset-input", value: newPresetName, onChange: (event) => setNewPresetName(event.target.value), placeholder: "Nome preset, ad esempio Cerimonia 3+" }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: handleSavePreset, disabled: !newPresetName.trim(), children: "Salva preset" })] }), _jsx("div", { className: "photo-selector__preset-list", children: filterPresets.length === 0 ? (_jsx("span", { className: "photo-selector__workspace-empty", children: "Nessun preset salvato." })) : (filterPresets.map((preset) => (_jsxs("div", { className: "photo-selector__preset-chip", children: [_jsx("button", { type: "button", className: "photo-selector__preset-apply", onClick: () => applyPreset(preset), children: preset.name }), _jsx("button", { type: "button", className: "photo-selector__preset-remove", "aria-label": `Rimuovi preset ${preset.name}`, onClick: () => removePreset(preset.id), children: "\u00D7" })] }, preset.id)))) })] }), _jsxs("div", { className: "photo-selector__workspace-group", children: [_jsx("span", { className: "photo-selector__workspace-label", children: "Nomi etichette colore" }), _jsx("div", { className: "photo-selector__label-grid", children: COLOR_LABELS.map((value) => (_jsxs("label", { className: "photo-selector__label-editor", children: [_jsx("span", { className: "photo-selector__label-chip", children: _jsx("span", { className: `asset-color-dot asset-color-dot--${value}` }) }), _jsx("input", { value: customColorNames[value], onChange: (event) => handleColorNameChange(value, event.target.value), "aria-label": `Nome personalizzato etichetta ${COLOR_LABEL_NAMES[value]}` })] }, value))) })] })] })] }), _jsxs("div", { className: "photo-selector__quick-actions-shell", children: [_jsx("span", { className: "photo-selector__workspace-label", children: "Azioni rapide" }), _jsxs("div", { className: "photo-selector__quick-actions", children: [_jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: selectVisible, disabled: visiblePhotos.length === 0, children: "Seleziona visibili" }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: addVisibleToSelection, disabled: visiblePhotos.length === 0, children: "Aggiungi visibili" }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: removeVisibleFromSelection, disabled: visibleSelectedCount === 0, children: "Togli visibili" }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: activatePickedOnly, disabled: photos.length === 0, children: "Solo pick" }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: excludeRejected, disabled: selectedIds.length === 0, children: "Escludi scartate" }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => selectByMinimumRating(3), disabled: photos.length === 0, children: "3+ stelle" }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => selectByMinimumRating(5), disabled: photos.length === 0, children: "Solo 5 stelle" }), _jsxs("span", { className: "photo-selector__quick-summary", children: [visibleSelectedCount, "/", visiblePhotos.length, " visibili attive"] })] })] }), timelineEntries.length > 0 ? (_jsxs("div", { className: "photo-selector__timeline", "aria-label": "Cronologia azioni recenti", children: [_jsx("span", { className: "photo-selector__timeline-label", children: "Ultime azioni" }), _jsx("div", { className: "photo-selector__timeline-list", children: timelineEntries.map((entry) => (_jsx("span", { className: "photo-selector__timeline-item", children: entry.label }, entry.id))) })] })) : null, selectedIds.length > 0 ? (_jsxs("section", { className: "photo-selector__selection-bar", "aria-label": "Azioni rapide per la selezione corrente", children: [_jsxs("div", { className: "photo-selector__collapsible-header", children: [_jsxs("div", { className: "photo-selector__selection-copy", children: [_jsx("span", { className: "photo-selector__selection-count", children: selectedIds.length === 1
                                                    ? "1 foto selezionata"
                                                    : `${selectedIds.length} foto selezionate` }), _jsx("span", { className: "photo-selector__selection-meta", children: "Batch rapido su stelle, stato, colore e gestione selezione." })] }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => setIsBatchToolsOpen((current) => !current), children: isBatchToolsOpen ? "Chiudi strumenti batch" : "Apri strumenti batch" })] }), _jsxs("div", { className: "photo-selector__selection-tools", hidden: !isBatchToolsOpen, children: [_jsxs("div", { className: "photo-selector__selection-group", "aria-label": "Valutazione", children: [_jsx("span", { className: "photo-selector__selection-label", children: "Stelle" }), _jsxs("div", { className: "photo-selector__selection-stars", children: [[1, 2, 3, 4, 5].map((value) => (_jsx("button", { type: "button", className: "photo-selector__batch-star", onClick: () => applyBatchChanges(selectedIds, { rating: value }), title: `Assegna ${value} stella${value > 1 ? "e" : ""}`, children: Array.from({ length: value }, () => "★").join("") }, value))), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => applyBatchChanges(selectedIds, { rating: 0 }), children: "Azzera" })] })] }), _jsxs("div", { className: "photo-selector__selection-group", "aria-label": "Stato", children: [_jsx("span", { className: "photo-selector__selection-label", children: "Stato" }), _jsx("div", { className: "photo-selector__selection-pills", children: ["picked", "rejected", "unmarked"].map((value) => (_jsx("button", { type: "button", className: "photo-selector__batch-pill", onClick: () => applyBatchChanges(selectedIds, { pickStatus: value }), children: value === "picked" ? "Pick" : value === "rejected" ? "Scartata" : "Neutra" }, value))) })] }), _jsxs("div", { className: "photo-selector__selection-group", "aria-label": "Etichette colore", children: [_jsx("span", { className: "photo-selector__selection-label", children: "Etichette" }), _jsxs("div", { className: "photo-selector__selection-colors", children: [_jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => applyBatchChanges(selectedIds, { colorLabel: null }), children: "Nessuna" }), COLOR_LABELS.map((value) => (_jsx("button", { type: "button", className: `asset-color-dot asset-color-dot--${value}`, title: customColorNames[value], onClick: () => applyBatchChanges(selectedIds, { colorLabel: value }) }, value)))] })] }), _jsxs("div", { className: "photo-selector__selection-group", "aria-label": "Gestione selezione", children: [_jsx("span", { className: "photo-selector__selection-label", children: "Selezione" }), _jsxs("div", { className: "photo-selector__selection-actions", children: [_jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: invertVisibleSelection, children: "Inverti visibili" }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: clearSelection, children: "Deseleziona" })] })] })] })] })) : null, _jsx("div", { ref: gridRef, className: "photo-selector__grid", role: "listbox", "aria-label": "Griglia foto selezionabili", "aria-multiselectable": "true", children: visiblePhotos.length === 0 ? (_jsx("div", { className: "photo-selector__empty", children: _jsx("p", { children: "Nessuna foto disponibile con i filtri attuali." }) })) : (visiblePhotos.map((photo) => (_jsx(PhotoCard, { photo: photo, isSelected: selectedSet.has(photo.id), onToggle: togglePhoto, onUpdatePhoto: handleUpdatePhoto, onFocus: handleFocus, onPreview: handlePreview, onContextMenu: handleContextMenu, editable: !!onPhotosChange }, photo.id)))) }), _jsxs("div", { className: "photo-selector__footer", children: [_jsx("p", { className: "photo-selector__hint", children: "Shift+click per selezionare un intervallo. Ctrl+Z / Ctrl+Shift+Z per annulla/ripeti. Tasto destro o Ctrl/Cmd + 6/7/8/9/V per i colori, 1-5 stelle, P/X/U stato, Spazio preview." }), _jsx("span", { className: "sr-only", "aria-live": "polite", children: selectedIds.length === 1 ? "Una foto selezionata" : `${selectedIds.length} foto selezionate` })] })] }), _jsx(PhotoQuickPreviewModal, { asset: previewAssetWithUrl, assets: visiblePhotos, onClose: () => setPreviewAssetId(null), onSelectAsset: setPreviewAssetId, onUpdateAsset: (assetId, changes) => updatePhoto(assetId, changes) }), contextMenuState ? (_jsx(PhotoSelectionContextMenu, { x: contextMenuState.x, y: contextMenuState.y, targetCount: contextMenuState.targetIds.length, colorLabelNames: customColorNames, onApplyRating: (rating) => {
                    applyBatchChanges(contextMenuState.targetIds, { rating });
                    setContextMenuState(null);
                }, onApplyPickStatus: (pickStatus) => {
                    applyBatchChanges(contextMenuState.targetIds, { pickStatus });
                    setContextMenuState(null);
                }, onApplyColor: (colorLabel) => {
                    applyBatchChanges(contextMenuState.targetIds, { colorLabel });
                    setContextMenuState(null);
                }, onInvertVisible: () => {
                    invertVisibleSelection();
                    setContextMenuState(null);
                }, onClearSelection: () => {
                    clearSelection();
                    setContextMenuState(null);
                } })) : null] }));
}
//# sourceMappingURL=PhotoSelector.js.map