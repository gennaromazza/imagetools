import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PhotoClassificationHelpButton } from "./PhotoClassificationHelpButton";
import { PhotoQuickPreviewModal } from "./PhotoQuickPreviewModal";
import { PhotoSearchBar } from "./PhotoSearchBar";
import { PhotoCard } from "./PhotoCard";
import { PhotoSelectionContextMenu } from "./PhotoSelectionContextMenu";
import { CompareModal } from "./CompareModal";
import { createOnDemandPreviewAsync, getSubfolder, extractSubfolders, copyAssetsToFolder, moveAssetsToFolder, saveAssetAs, getAssetRelativePath, detectChangedAssetsOnDisk } from "../services/folder-access";
import { COLOR_LABEL_NAMES, COLOR_LABELS, DEFAULT_PHOTO_FILTERS, getAssetColorLabel, getAssetPickStatus, getAssetRating, matchesPhotoFilters, } from "../services/photo-classification";
import { loadPhotoSelectorPreferences, savePhotoSelectorPreferences, } from "../services/photo-selector-preferences";
const INITIAL_RENDER_BATCH = 180;
const RENDER_BATCH_STEP = 180;
const RENDER_THRESHOLD_PX = 900;
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
function formatBytes(totalBytes) {
    if (totalBytes <= 0) {
        return "0 B";
    }
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = totalBytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    const decimals = value >= 10 || unitIndex === 0 ? 0 : 1;
    return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}
export function PhotoSelector({ photos, selectedIds, onSelectionChange, onPhotosChange, onVisibleIdsChange, onUndo, onRedo, canUndo = false, canRedo = false, desktopThumbnailCacheInfo = null, isDesktopThumbnailCacheBusy = false, onChooseDesktopThumbnailCacheDirectory, onSetDesktopThumbnailCacheDirectory, onResetDesktopThumbnailCacheDirectory, onClearDesktopThumbnailCache, }) {
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
    const [isBatchToolsOpen, setIsBatchToolsOpen] = useState(false);
    const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);
    const [isCompareOpen, setIsCompareOpen] = useState(false);
    const [cardSize, setCardSize] = useState(() => {
        const saved = localStorage.getItem("ps-card-size");
        return saved ? Math.max(100, Math.min(320, Number(saved))) : 160;
    });
    const [rootFolderPath, setRootFolderPath] = useState(() => localStorage.getItem("ps-root-folder-path") ?? "");
    const [preferredEditorPath, setPreferredEditorPath] = useState(() => localStorage.getItem("ps-preferred-editor-path") ?? "");
    const [desktopThumbnailCachePathInput, setDesktopThumbnailCachePathInput] = useState("");
    const setPreferredEditorPathPersisted = useCallback((value) => {
        setPreferredEditorPath(value);
        localStorage.setItem("ps-preferred-editor-path", value);
    }, []);
    const [previewAssetId, setPreviewAssetId] = useState(null);
    const [contextMenuState, setContextMenuState] = useState(null);
    const [focusedPhotoId, setFocusedPhotoId] = useState(null);
    const lastClickedIdRef = useRef(null);
    const gridRef = useRef(null);
    const dragOriginRef = useRef(null);
    const [dragRect, setDragRect] = useState(null);
    const [renderCount, setRenderCount] = useState(INITIAL_RENDER_BATCH);
    const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
    const photosRef = useRef(photos);
    useEffect(() => {
        photosRef.current = photos;
    }, [photos]);
    useEffect(() => {
        setDesktopThumbnailCachePathInput(desktopThumbnailCacheInfo?.currentPath ?? "");
    }, [desktopThumbnailCacheInfo?.currentPath]);
    const activeFilterCount = useMemo(() => [
        pickFilter !== "all",
        ratingFilter !== "any",
        colorFilter !== "all",
        folderFilter !== "all",
        seriesFilter !== "all",
        timeClusterFilter !== "all",
        searchQuery !== "",
    ].filter(Boolean).length, [pickFilter, ratingFilter, colorFilter, folderFilter, seriesFilter, timeClusterFilter, searchQuery]);
    const selectionStats = useMemo(() => {
        if (selectedIds.length === 0)
            return null;
        const sel = photos.filter((p) => selectedSet.has(p.id));
        return {
            picked: sel.filter((p) => getAssetPickStatus(p) === "picked").length,
            rejected: sel.filter((p) => getAssetPickStatus(p) === "rejected").length,
            highRating: sel.filter((p) => getAssetRating(p) >= 3).length,
        };
    }, [selectedIds, photos, selectedSet]);
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
    const renderedPhotos = useMemo(() => visiblePhotos.slice(0, renderCount), [renderCount, visiblePhotos]);
    // Search in all photos so preview doesn't close when filters change
    const previewAsset = previewAssetId
        ? (photos.find((p) => p.id === previewAssetId) ?? null)
        : null;
    useEffect(() => {
        // When context menu opens, cancel any active lasso drag to prevent
        // pointer capture from routing events away from the menu.
        if (contextMenuState) {
            dragOriginRef.current = null;
            setDragRect(null);
        }
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
            if (nextIndex >= renderCount) {
                setRenderCount((current) => Math.max(current, nextIndex + RENDER_BATCH_STEP));
            }
            setFocusedPhotoId(next.id);
            requestAnimationFrame(() => {
                const el = grid?.querySelector(`[data-preview-asset-id="${next.id}"]`);
                if (el) {
                    el.focus();
                    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
                }
            });
        }
    }, [contextMenuState, focusedPhotoId, previewAssetId, renderCount, visiblePhotos]);
    useEffect(() => {
        window.addEventListener("keydown", handleWindowKeyDown);
        return () => window.removeEventListener("keydown", handleWindowKeyDown);
    }, [handleWindowKeyDown]);
    useEffect(() => {
        setRenderCount(INITIAL_RENDER_BATCH);
        visibleIdsRef.current.clear();
        onVisibleIdsChange?.(new Set());
    }, [
        colorFilter,
        folderFilter,
        onVisibleIdsChange,
        pickFilter,
        ratingFilter,
        searchQuery,
        seriesFilter,
        sortBy,
        timeClusterFilter,
        visiblePhotos.length,
    ]);
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
        if (previewUrlRef.current &&
            previewUrlRef.current.id === previewAsset.id &&
            previewUrlRef.current.sourceFileKey === previewAsset.sourceFileKey) {
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
                previewUrlRef.current = { id: previewAsset.id, url, sourceFileKey: previewAsset.sourceFileKey };
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
        if (previewUrlRef.current &&
            previewUrlRef.current.id === previewAsset.id &&
            previewUrlRef.current.sourceFileKey === previewAsset.sourceFileKey) {
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
    const photoStats = useMemo(() => {
        const ratingCounts = new Map();
        const pickCounts = new Map();
        const colorCounts = new Map();
        for (const photo of photos) {
            const r = getAssetRating(photo);
            ratingCounts.set(r, (ratingCounts.get(r) ?? 0) + 1);
            const ps = getAssetPickStatus(photo);
            pickCounts.set(ps, (pickCounts.get(ps) ?? 0) + 1);
            const cl = getAssetColorLabel(photo);
            if (cl)
                colorCounts.set(cl, (colorCounts.get(cl) ?? 0) + 1);
        }
        return { ratingCounts, pickCounts, colorCounts };
    }, [photos]);
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
    const scrolledInitialRef = useRef(false);
    useEffect(() => {
        if (scrolledInitialRef.current || selectedIds.length === 0 || visiblePhotos.length === 0)
            return;
        scrolledInitialRef.current = true;
        const firstId = selectedIds.find((id) => visiblePhotos.some((p) => p.id === id));
        if (!firstId)
            return;
        const timer = setTimeout(() => {
            const el = gridRef.current?.querySelector(`[data-preview-asset-id="${firstId}"]`);
            el?.scrollIntoView({ block: "center", behavior: "smooth" });
        }, 200);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visiblePhotos.length]);
    useEffect(() => {
        localStorage.setItem("ps-card-size", String(cardSize));
    }, [cardSize]);
    const handleUndoClick = useCallback(() => {
        onUndo?.();
        pushTimelineEntry("Annullata ultima modifica");
    }, [onUndo, pushTimelineEntry]);
    const handleRedoClick = useCallback(() => {
        onRedo?.();
        pushTimelineEntry("Ripristinata modifica annullata");
    }, [onRedo, pushTimelineEntry]);
    // ── File operation handlers ──────────────────────────────────────────
    const handleCopyFiles = useCallback(async (ids) => {
        const result = await copyAssetsToFolder(ids);
        if (result === "ok")
            pushTimelineEntry(`${ids.length === 1 ? "1 file" : `${ids.length} file`} copiato/i in cartella`);
        else if (result === "unsupported")
            alert("Operazione non supportata da questo browser. Usa Chrome/Edge con accesso cartella nativo.");
        else if (result === "error")
            alert("Errore durante la copia. Alcuni file potrebbero non essere stati copiati.");
    }, [pushTimelineEntry]);
    const handleMoveFiles = useCallback(async (ids) => {
        const { result, movedIds } = await moveAssetsToFolder(ids);
        if (result === "cancelled")
            return;
        if (result === "unsupported") {
            alert("Spostamento non supportato in questa modalita/browser. Per spostare fisicamente i file apri la cartella con accesso nativo (Chrome/Edge). ");
            return;
        }
        if (movedIds.length > 0 && onPhotosChange) {
            const movedSet = new Set(movedIds);
            onPhotosChange(photos.filter((p) => !movedSet.has(p.id)));
            onSelectionChange(selectedIds.filter((id) => !movedSet.has(id)));
            pushTimelineEntry(`${movedIds.length === 1 ? "1 file" : `${movedIds.length} file`} spostato/i in cartella`);
        }
        if (result === "error")
            alert("Spostamento parziale/non riuscito: alcuni file non sono stati mossi. Le foto restano in griglia se la rimozione dal percorso originale non e riuscita.");
    }, [onPhotosChange, onSelectionChange, photos, pushTimelineEntry, selectedIds]);
    const handleSaveAs = useCallback(async (ids) => {
        for (const id of ids) {
            const result = await saveAssetAs(id);
            if (result === "error") {
                alert("Errore durante il salvataggio del file.");
                break;
            }
            if (result === "cancelled")
                break;
        }
    }, []);
    const handleCopyPath = useCallback((ids, root) => {
        const paths = ids
            .map((id) => getAssetRelativePath(id))
            .filter(Boolean)
            .map((rel) => root ? `${root.replace(/[\\/]+$/, "")}/${rel}` : rel);
        if (paths.length === 0)
            return;
        void navigator.clipboard.writeText(paths.join("\n"));
        pushTimelineEntry(`Percorso copiato negli appunti`);
    }, [pushTimelineEntry]);
    const handleOpenWithEditor = useCallback((ids) => {
        if (!rootFolderPath.trim()) {
            alert("Imposta prima la Cartella radice in Impostazioni > Editor esterno.");
            return;
        }
        const editorFromStorage = localStorage.getItem("ps-preferred-editor-path") ?? "";
        const editor = (preferredEditorPath.trim() || editorFromStorage.trim()).replace(/\//g, "\\");
        const hasAbsoluteEditorPath = /^[a-zA-Z]:\\/.test(editor) && /\.(exe|bat|cmd)$/i.test(editor);
        if (!hasAbsoluteEditorPath) {
            alert("Nessun editor associato valido. Imposta il percorso completo dell'editor (es. C:\\Program Files\\Adobe\\...\\Photoshop.exe).");
            return;
        }
        const root = rootFolderPath.trim().replace(/[\\/]+$/, "");
        const absolutePaths = ids
            .map((id) => getAssetRelativePath(id))
            .filter((value) => Boolean(value))
            .map((relative) => `${root}/${relative}`.replace(/\//g, "\\"));
        if (absolutePaths.length === 0) {
            alert("Nessun percorso disponibile per le foto selezionate.");
            return;
        }
        const escapeForBatch = (value) => value.replace(/"/g, '""');
        const lines = [
            "@echo off",
            "setlocal",
            "",
            "REM Script generato da Photo Tools - Apri con editor",
        ];
        lines.push(`set "EDITOR=${escapeForBatch(editor)}"`);
        lines.push("if not exist \"%EDITOR%\" (");
        lines.push("  echo Editor non trovato: %EDITOR%");
        lines.push("  echo Controlla il percorso in Impostazioni > Editor esterno");
        lines.push("  pause");
        lines.push("  exit /b 1");
        lines.push(")");
        lines.push("");
        for (const filePath of absolutePaths) {
            lines.push(`start "" "%EDITOR%" "${escapeForBatch(filePath)}"`);
        }
        lines.push("");
        lines.push("exit /b 0");
        const content = lines.join("\r\n");
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const fileName = `open-with-editor-${stamp}.bat`;
        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        void navigator.clipboard.writeText(absolutePaths.join("\n"));
        pushTimelineEntry(`${absolutePaths.length === 1 ? "1 foto" : `${absolutePaths.length} foto`} pronta/e per apri con editor (BAT scaricato)`);
        alert(`Ho scaricato ${fileName}. Eseguilo per aprire ${absolutePaths.length} foto in editor.`);
    }, [preferredEditorPath, pushTimelineEntry, rootFolderPath]);
    // Detect external edits (Photoshop overwrite) and refresh in-app previews automatically.
    useEffect(() => {
        if (!onPhotosChange)
            return;
        let disposed = false;
        let running = false;
        const run = async () => {
            if (running)
                return;
            const targets = Array.from(new Set([
                ...selectedIds,
                ...(previewAssetId ? [previewAssetId] : []),
            ]));
            if (targets.length === 0)
                return;
            running = true;
            try {
                const changes = await detectChangedAssetsOnDisk(targets);
                if (disposed || changes.length === 0)
                    return;
                const byId = new Map(changes.map((change) => [change.id, change]));
                const next = photosRef.current.map((asset) => {
                    const change = byId.get(asset.id);
                    if (!change)
                        return asset;
                    return {
                        ...asset,
                        sourceFileKey: change.sourceFileKey,
                        thumbnailUrl: change.thumbnailUrl ?? asset.thumbnailUrl,
                        previewUrl: change.previewUrl ?? asset.previewUrl,
                        sourceUrl: change.sourceUrl ?? asset.sourceUrl,
                        width: change.width ?? asset.width,
                        height: change.height ?? asset.height,
                        orientation: change.orientation ?? asset.orientation,
                        aspectRatio: change.aspectRatio ?? asset.aspectRatio,
                    };
                });
                onPhotosChange(next);
                if (changes.length > 0) {
                    pushTimelineEntry(`${changes.length === 1 ? "1 foto aggiornata" : `${changes.length} foto aggiornate`} dopo modifica esterna`);
                }
            }
            finally {
                running = false;
            }
        };
        const timer = window.setInterval(() => {
            void run();
        }, 2000);
        return () => {
            disposed = true;
            window.clearInterval(timer);
        };
    }, [onPhotosChange, previewAssetId, pushTimelineEntry, selectedIds]);
    const editorPathStatus = useMemo(() => {
        const value = preferredEditorPath.trim();
        if (!value) {
            return { kind: "empty", text: "Non configurato" };
        }
        const hasDir = /[\\/]/.test(value);
        const isExecutable = /\.(exe|bat|cmd)$/i.test(value);
        if (hasDir && isExecutable) {
            return { kind: "ok", text: "Formato percorso OK" };
        }
        return { kind: "warn", text: "Percorso incompleto o formato non valido" };
    }, [preferredEditorPath]);
    const desktopThumbnailCacheStatus = useMemo(() => {
        if (!desktopThumbnailCacheInfo) {
            return null;
        }
        return {
            kind: desktopThumbnailCacheInfo.usesCustomPath ? "ok" : "empty",
            text: desktopThumbnailCacheInfo.usesCustomPath
                ? "Percorso personalizzato attivo"
                : "Percorso predefinito attivo",
        };
    }, [desktopThumbnailCacheInfo]);
    const handleBrowsePreferredEditor = useCallback(() => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".exe,.bat,.cmd,application/x-msdownload";
        input.style.display = "none";
        input.onchange = () => {
            const selected = input.files?.[0];
            if (!selected) {
                if (input.parentNode) {
                    input.parentNode.removeChild(input);
                }
                return;
            }
            const current = preferredEditorPath.trim();
            const sep = Math.max(current.lastIndexOf("\\"), current.lastIndexOf("/"));
            if (sep >= 0) {
                const nextPath = `${current.slice(0, sep + 1)}${selected.name}`;
                setPreferredEditorPathPersisted(nextPath);
            }
            if (sep < 0) {
                alert("Selezionato file: " + selected.name + "\n\nIl browser non puo leggere il percorso assoluto. Usa uno dei preset Photoshop qui sotto o incolla il percorso completo (es. C:\\Program Files\\Adobe\\...\\Photoshop.exe).");
            }
            if (input.parentNode) {
                input.parentNode.removeChild(input);
            }
        };
        document.body.appendChild(input);
        input.click();
    }, [preferredEditorPath, setPreferredEditorPathPersisted]);
    const handleApplyDesktopThumbnailCachePath = useCallback(() => {
        const nextPath = desktopThumbnailCachePathInput.trim();
        if (!nextPath || !onSetDesktopThumbnailCacheDirectory) {
            return;
        }
        void onSetDesktopThumbnailCacheDirectory(nextPath);
    }, [desktopThumbnailCachePathInput, onSetDesktopThumbnailCacheDirectory]);
    return (_jsxs("div", { className: "photo-selector", children: [_jsxs("div", { className: "photo-selector__filter-bar", children: [hasActiveFilters && (_jsx("div", { className: "selector-filters__reset", children: _jsxs("button", { type: "button", className: "ghost-button ghost-button--small", onClick: resetFilters, title: `${activeFilterCount} filtro/i attivo/i`, children: ["\u2715 Azzera", activeFilterCount > 0 && (_jsx("span", { className: "photo-selector__filter-count-badge", children: activeFilterCount }))] }) })), subfolders.length > 1 && (_jsxs("label", { className: "field", children: [_jsx("span", { children: "Cartella" }), _jsxs("select", { className: folderFilter !== "all" ? "field__select--active" : undefined, value: folderFilter, onChange: (event) => setFolderFilter(event.target.value), children: [_jsxs("option", { value: "all", children: ["Tutte (", photos.length, ")"] }), subfolders.map(({ folder, count }) => (_jsxs("option", { value: folder, children: [folder === "" ? "Root" : folder, " (", count, ")"] }, folder)))] })] })), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Stato" }), _jsxs("select", { className: pickFilter !== "all" ? "field__select--active" : undefined, value: pickFilter, onChange: (event) => setPickFilter(event.target.value), children: [_jsx("option", { value: "all", children: "Tutti" }), _jsx("option", { value: "picked", children: "Pick" }), _jsx("option", { value: "rejected", children: "Scartate" }), _jsx("option", { value: "unmarked", children: "Neutre" })] })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Stelle" }), _jsxs("select", { className: ratingFilter !== "any" ? "field__select--active" : undefined, value: ratingFilter, onChange: (event) => setRatingFilter(event.target.value), children: [_jsx("option", { value: "any", children: "Tutte" }), _jsxs("optgroup", { label: "Minimo", children: [_jsx("option", { value: "1+", children: "\u2605 1+" }), _jsx("option", { value: "2+", children: "\u2605\u2605 2+" }), _jsx("option", { value: "3+", children: "\u2605\u2605\u2605 3+" }), _jsx("option", { value: "4+", children: "\u2605\u2605\u2605\u2605 4+" })] }), _jsxs("optgroup", { label: "Esattamente", children: [_jsx("option", { value: "0", children: "Senza stelle" }), _jsx("option", { value: "1", children: "\u2605 1" }), _jsx("option", { value: "2", children: "\u2605\u2605 2" }), _jsx("option", { value: "3", children: "\u2605\u2605\u2605 3" }), _jsx("option", { value: "4", children: "\u2605\u2605\u2605\u2605 4" }), _jsx("option", { value: "5", children: "\u2605\u2605\u2605\u2605\u2605 5" })] })] })] }), _jsxs("div", { className: "field photo-selector__color-filter", children: [_jsx("span", { children: "Colore" }), _jsxs("div", { className: "photo-selector__color-filter-dots", children: [_jsx("button", { type: "button", className: `photo-selector__color-all-btn${colorFilter === "all" ? " photo-selector__color-all-btn--active" : ""}`, onClick: () => setColorFilter("all"), title: "Tutti i colori", children: "\u2715" }), COLOR_LABELS.map((value) => (_jsx("button", { type: "button", className: `asset-color-dot asset-color-dot--${value}${colorFilter === value ? " asset-color-dot--selected" : ""}`, onClick: () => setColorFilter(colorFilter === value ? "all" : value), title: customColorNames[value] }, value)))] })] }), seriesGroups.length > 1 && (_jsxs("label", { className: "field", children: [_jsx("span", { children: "Serie" }), _jsxs("select", { className: seriesFilter !== "all" ? "field__select--active" : undefined, value: seriesFilter, onChange: (event) => setSeriesFilter(event.target.value), children: [_jsx("option", { value: "all", children: "Tutte" }), seriesGroups.map(({ key, count }) => (_jsxs("option", { value: key, children: [key, " (", count, ")"] }, key)))] })] })), timeClusters.length > 1 && (_jsxs("label", { className: "field", children: [_jsx("span", { children: "Fascia oraria" }), _jsxs("select", { className: timeClusterFilter !== "all" ? "field__select--active" : undefined, value: timeClusterFilter, onChange: (event) => setTimeClusterFilter(event.target.value), children: [_jsx("option", { value: "all", children: "Tutte" }), timeClusters.map(({ key, count }) => (_jsxs("option", { value: key, children: [key, " (", count, ")"] }, key)))] })] })), filterPresets.length > 0 && (_jsxs("div", { className: "photo-selector__preset-chips", children: [_jsx("span", { className: "photo-selector__filter-bar-label", children: "Preset" }), filterPresets.map((preset) => (_jsx("button", { className: "photo-selector__preset-apply", onClick: () => applyPreset(preset), children: preset.name }, preset.id)))] }))] }), _jsxs("div", { className: "photo-selector__controls", children: [_jsxs("div", { className: "photo-selector__action-inline", children: [_jsxs("div", { className: "photo-selector__undo-group", children: [_jsx("button", { type: "button", className: "icon-button", onClick: handleUndoClick, disabled: !canUndo, title: "Annulla", children: "\u21A9" }), _jsx("button", { type: "button", className: "icon-button", onClick: handleRedoClick, disabled: !canRedo, title: "Ripeti", children: "\u21AA" })] }), _jsx("div", { className: "photo-selector__toolbar-divider" }), _jsx("button", { type: "button", className: `checkbox-button photo-selector__toolbar-control ${allSelected ? "checkbox-button--checked" : someSelected ? "checkbox-button--indeterminate" : ""}`, onClick: () => toggleAll(!allSelected), children: allSelected ? "Deseleziona tutto" : "Seleziona tutto" }), _jsx("div", { className: "photo-selector__toolbar-divider" }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: selectVisible, title: "Seleziona le foto visibili", children: "Visibili" }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: activatePickedOnly, title: "Seleziona solo le foto Pick", children: "Solo pick" }), selectedIds.length >= 2 && selectedIds.length <= 4 && (_jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => setIsCompareOpen(true), title: `Confronta ${selectedIds.length} foto selezionate`, children: "Confronta" }))] }), _jsx("div", { className: "photo-selector__action-inline photo-selector__toolbar-search", children: _jsx(PhotoSearchBar, { value: searchQuery, onChange: setSearchQuery, resultCount: visiblePhotos.length, totalCount: photos.length }) }), _jsxs("div", { className: "photo-selector__action-inline", children: [_jsxs("label", { className: "photo-selector__zoom-label", title: "Dimensione card", children: [_jsx("span", { children: "\uD83D\uDD0E" }), _jsx("input", { type: "range", className: "photo-selector__zoom-slider", min: 100, max: 320, step: 10, value: cardSize, onChange: (e) => setCardSize(Number(e.target.value)), "aria-label": "Dimensione card" })] }), _jsx("div", { className: "photo-selector__toolbar-divider" }), _jsxs("select", { className: "photo-selector__sort photo-selector__toolbar-control", value: sortBy, onChange: (event) => setSortBy(event.target.value), children: [_jsx("option", { value: "name", children: "AZ \u2191 Nome" }), _jsx("option", { value: "orientation", children: "Orientamento" }), _jsx("option", { value: "rating", children: "Valutazione" })] }), _jsx("button", { type: "button", className: `icon-button${isSettingsPanelOpen ? " icon-button--active" : ""}`, onClick: () => setIsSettingsPanelOpen((v) => !v), title: "Impostazioni workspace", children: "\u2699" }), _jsx(PhotoClassificationHelpButton, {})] })] }), photos.length > 0 && (_jsxs("div", { className: "photo-selector__quick-stats", children: [[1, 2, 3, 4, 5].map((r) => {
                        const count = photoStats.ratingCounts.get(r) ?? 0;
                        if (count === 0)
                            return null;
                        const isActive = ratingFilter === String(r);
                        return (_jsxs("button", { type: "button", className: `photo-selector__qs-chip photo-selector__qs-chip--star${isActive ? " photo-selector__qs-chip--active" : ""}`, onClick: () => setRatingFilter(isActive ? "any" : String(r)), title: `${r} stelle — ${count} foto`, children: ["★".repeat(r), _jsx("span", { className: "photo-selector__qs-count", children: count })] }, r));
                    }), ["picked", "rejected"].map((ps) => {
                        const count = photoStats.pickCounts.get(ps) ?? 0;
                        if (count === 0)
                            return null;
                        const isActive = pickFilter === ps;
                        return (_jsxs("button", { type: "button", className: `photo-selector__qs-chip photo-selector__qs-chip--${ps}${isActive ? " photo-selector__qs-chip--active" : ""}`, onClick: () => setPickFilter(isActive ? "all" : ps), title: ps === "picked" ? `Pick — ${count} foto` : `Scartate — ${count} foto`, children: [ps === "picked" ? "✓" : "✕", _jsx("span", { className: "photo-selector__qs-count", children: count })] }, ps));
                    }), COLOR_LABELS.map((cl) => {
                        const count = photoStats.colorCounts.get(cl) ?? 0;
                        if (count === 0)
                            return null;
                        const isActive = colorFilter === cl;
                        return (_jsxs("button", { type: "button", className: `photo-selector__qs-chip photo-selector__qs-chip--color-${cl}${isActive ? " photo-selector__qs-chip--active" : ""}`, onClick: () => setColorFilter(isActive ? "all" : cl), title: `${customColorNames[cl]} — ${count} foto`, children: [_jsx("span", { className: `asset-color-dot asset-color-dot--${cl}`, style: { width: "8px", height: "8px", minWidth: "8px" } }), _jsx("span", { className: "photo-selector__qs-count", children: count })] }, cl));
                    })] })), _jsxs("div", { ref: gridRef, className: "photo-selector__grid", style: { "--ps-card-min": `${cardSize}px` }, role: "listbox", onPointerDown: (e) => {
                    // Never start a lasso drag while the context menu is open
                    if (contextMenuState)
                        return;
                    // Only start drag on the grid background (not on photo cards)
                    if (e.target.closest(".photo-card"))
                        return;
                    if (e.button !== 0)
                        return;
                    dragOriginRef.current = { x: e.clientX, y: e.clientY };
                    setDragRect(null);
                    e.currentTarget.setPointerCapture(e.pointerId);
                }, onPointerMove: (e) => {
                    if (!dragOriginRef.current)
                        return;
                    const ox = dragOriginRef.current.x;
                    const oy = dragOriginRef.current.y;
                    const cx = e.clientX;
                    const cy = e.clientY;
                    const threshold = 6;
                    if (Math.abs(cx - ox) < threshold && Math.abs(cy - oy) < threshold)
                        return;
                    setDragRect({
                        left: Math.min(ox, cx),
                        top: Math.min(oy, cy),
                        width: Math.abs(cx - ox),
                        height: Math.abs(cy - oy),
                    });
                }, onPointerUp: (e) => {
                    if (!dragOriginRef.current)
                        return;
                    const origin = dragOriginRef.current;
                    dragOriginRef.current = null;
                    if (!dragRect) {
                        setDragRect(null);
                        return;
                    }
                    const selRect = {
                        left: dragRect.left,
                        top: dragRect.top,
                        right: dragRect.left + dragRect.width,
                        bottom: dragRect.top + dragRect.height,
                    };
                    setDragRect(null);
                    const grid = gridRef.current;
                    if (!grid)
                        return;
                    const cards = grid.querySelectorAll("[data-preview-asset-id]");
                    const newIds = [];
                    for (let i = 0; i < cards.length; i++) {
                        const cr = cards[i].getBoundingClientRect();
                        const overlaps = cr.left < selRect.right &&
                            cr.right > selRect.left &&
                            cr.top < selRect.bottom &&
                            cr.bottom > selRect.top;
                        if (overlaps) {
                            const id = cards[i].dataset.previewAssetId;
                            if (id)
                                newIds.push(id);
                        }
                    }
                    if (newIds.length > 0) {
                        const base = e.shiftKey ? new Set(selectedIds) : new Set();
                        for (const id of newIds)
                            base.add(id);
                        onSelectionChange(Array.from(base));
                        pushTimelineEntry(`Selezionate ${newIds.length} foto con lasso`);
                    }
                }, onScroll: (event) => {
                    const target = event.currentTarget;
                    const remaining = target.scrollHeight - target.scrollTop - target.clientHeight;
                    if (remaining <= RENDER_THRESHOLD_PX && renderCount < visiblePhotos.length) {
                        setRenderCount((current) => Math.min(visiblePhotos.length, current + RENDER_BATCH_STEP));
                    }
                }, children: [visiblePhotos.length === 0 ? (_jsx("div", { className: "photo-selector__empty", children: _jsx("p", { children: "Nessuna foto trovata." }) })) : (renderedPhotos.map((photo) => (_jsx(PhotoCard, { photo: photo, isSelected: selectedSet.has(photo.id), onToggle: togglePhoto, onUpdatePhoto: handleUpdatePhoto, onFocus: handleFocus, onPreview: handlePreview, onContextMenu: handleContextMenu, editable: !!onPhotosChange }, photo.id)))), renderedPhotos.length < visiblePhotos.length ? (_jsxs("div", { className: "photo-selector__render-more", children: [_jsxs("span", { children: ["Mostrate ", renderedPhotos.length, " di ", visiblePhotos.length, " foto"] }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => setRenderCount((current) => Math.min(visiblePhotos.length, current + RENDER_BATCH_STEP)), children: "Carica altre" })] })) : null, dragRect && (_jsx("div", { className: "photo-selector__drag-rect", style: {
                            position: "fixed",
                            left: dragRect.left,
                            top: dragRect.top,
                            width: dragRect.width,
                            height: dragRect.height,
                        } }))] }), _jsxs("footer", { className: "photo-selector__bottom-bar", children: [_jsxs("div", { className: "photo-selector__stats", children: [_jsxs("span", { className: "photo-selector__count", children: [photos.length, " elementi \u2014 ", selectedIds.length, " selezionati", hasActiveFilters ? ` (${visiblePhotos.length} filtrati)` : ""] }), selectionStats && (_jsxs("div", { className: "photo-selector__stat-chips", children: [selectionStats.picked > 0 && (_jsxs("span", { className: "photo-selector__stat-chip photo-selector__stat-chip--pick", children: ["Pick ", selectionStats.picked] })), selectionStats.rejected > 0 && (_jsxs("span", { className: "photo-selector__stat-chip photo-selector__stat-chip--reject", children: ["Scart. ", selectionStats.rejected] })), selectionStats.highRating > 0 && (_jsxs("span", { className: "photo-selector__stat-chip photo-selector__stat-chip--star", children: ["\u26053+ ", selectionStats.highRating] }))] }))] }), timelineEntries.length > 0 && (canUndo ? (_jsxs("button", { type: "button", className: "photo-selector__timeline-status photo-selector__timeline-undo-btn", onClick: handleUndoClick, title: "Clicca per annullare", children: ["\u21A9 ", timelineEntries[0].label] })) : (_jsx("div", { className: "photo-selector__timeline-status", children: timelineEntries[0].label }))), _jsx("div", { className: "photo-selector__footer-actions", children: selectedIds.length > 0 && (_jsx("button", { className: "ghost-button ghost-button--small", onClick: () => setIsBatchToolsOpen(!isBatchToolsOpen), children: isBatchToolsOpen ? "Chiudi Batch" : "Apri Batch" })) })] }), isBatchToolsOpen && selectedIds.length > 0 && (_jsx("section", { className: "photo-selector__selection-bar photo-selector__batch-panel", children: _jsxs("div", { className: "photo-selector__selection-tools", children: [_jsxs("div", { className: "photo-selector__selection-group", "aria-label": "Valutazione", children: [_jsx("span", { className: "photo-selector__selection-label", children: "Stelle" }), _jsxs("div", { className: "photo-selector__selection-stars", children: [[1, 2, 3, 4, 5].map((value) => (_jsx("button", { type: "button", className: "photo-selector__batch-star", onClick: () => applyBatchChanges(selectedIds, { rating: value }), children: Array.from({ length: value }, () => "★").join("") }, value))), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => applyBatchChanges(selectedIds, { rating: 0 }), children: "Azzera" })] })] }), _jsxs("div", { className: "photo-selector__selection-group", "aria-label": "Stato", children: [_jsx("span", { className: "photo-selector__selection-label", children: "Stato" }), _jsxs("div", { className: "photo-selector__selection-pills", children: [["picked", "rejected", "unmarked"].map((value) => (_jsx("button", { type: "button", className: "photo-selector__batch-pill", onClick: () => applyBatchChanges(selectedIds, { pickStatus: value }), children: value === "picked" ? "Pick" : value === "rejected" ? "Scartata" : "Neutra" }, value))), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: excludeRejected, title: "Rimuovi dalla selezione le foto scartate", children: "\u2212 Escludi scartate" })] })] }), _jsxs("div", { className: "photo-selector__selection-group", "aria-label": "Etichette colore", children: [_jsx("span", { className: "photo-selector__selection-label", children: "Etichette" }), _jsxs("div", { className: "photo-selector__selection-colors", children: [_jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => applyBatchChanges(selectedIds, { colorLabel: null }), children: "Nessuna" }), COLOR_LABELS.map((value) => (_jsx("button", { type: "button", className: `asset-color-dot asset-color-dot--${value}`, onClick: () => applyBatchChanges(selectedIds, { colorLabel: value }) }, value)))] })] })] }) })), _jsx(PhotoQuickPreviewModal, { asset: previewAssetWithUrl, assets: visiblePhotos, onClose: () => setPreviewAssetId(null), onSelectAsset: setPreviewAssetId, onUpdateAsset: (assetId, changes) => updatePhoto(assetId, changes) }), isSettingsPanelOpen && (_jsxs("aside", { className: "photo-selector__settings-flyout", "aria-label": "Impostazioni workspace", children: [_jsxs("div", { className: "photo-selector__settings-header", children: [_jsx("span", { children: "Impostazioni" }), _jsx("button", { type: "button", className: "icon-button", onClick: () => setIsSettingsPanelOpen(false), title: "Chiudi", children: "\u2715" })] }), _jsxs("div", { className: "photo-selector__settings-section", children: [_jsx("h4", { className: "photo-selector__settings-section-title", children: "Nomi etichette colore" }), COLOR_LABELS.map((label) => (_jsxs("label", { className: "photo-selector__settings-color-row", children: [_jsx("span", { className: `asset-color-dot asset-color-dot--${label}` }), _jsx("input", { type: "text", className: "photo-selector__settings-color-input", value: customColorNames[label], onChange: (e) => handleColorNameChange(label, e.target.value), placeholder: COLOR_LABEL_NAMES[label] })] }, label)))] }), _jsxs("div", { className: "photo-selector__settings-section", children: [_jsxs("h4", { className: "photo-selector__settings-section-title", children: ["Editor esterno", _jsx("button", { type: "button", className: "photo-selector__settings-info-btn", title: "Imposta il percorso assoluto della cartella radice sul tuo PC (es. C:\\Foto\\Matrimonio). Questo permette di copiare il percorso completo di un file per aprirlo in Photoshop o qualsiasi altro editor esterno.", children: "?" })] }), _jsxs("label", { className: "photo-selector__settings-color-row", children: [_jsx("span", { style: { fontSize: "0.7rem", color: "var(--text-muted)", minWidth: 90 }, children: "Cartella radice" }), _jsx("input", { type: "text", className: "photo-selector__settings-color-input", value: rootFolderPath, onChange: (e) => {
                                            const val = e.target.value;
                                            setRootFolderPath(val);
                                            localStorage.setItem("ps-root-folder-path", val);
                                        }, placeholder: "C:\\Utenti\\Foto\\Matrimonio", spellCheck: false })] }), _jsxs("label", { className: "photo-selector__settings-color-row", children: [_jsx("span", { style: { fontSize: "0.7rem", color: "var(--text-muted)", minWidth: 90 }, children: "Editor" }), _jsx("div", { className: "photo-selector__settings-input-with-button", children: _jsx("input", { type: "text", className: "photo-selector__settings-color-input", value: preferredEditorPath, onChange: (e) => setPreferredEditorPathPersisted(e.target.value), placeholder: "C:\\\\Program Files\\\\Adobe\\\\Adobe Photoshop 2025\\\\Photoshop.exe", spellCheck: false }) })] }), _jsx("div", { className: "photo-selector__settings-browse-row", children: _jsx("button", { type: "button", className: "photo-selector__settings-browse-prominent", onClick: () => void handleBrowsePreferredEditor(), title: "Seleziona l'eseguibile dell'editor (Photoshop.exe, ecc.)", children: "\uD83D\uDCC2 Sfoglia editor..." }) }), _jsxs("div", { className: "photo-selector__settings-preset-row photo-selector__settings-editor-presets", children: [_jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => setPreferredEditorPathPersisted("C:\\Program Files\\Adobe\\Adobe Photoshop 2025\\Photoshop.exe"), title: "Imposta percorso Photoshop 2025", children: "Photoshop 2025" }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => setPreferredEditorPathPersisted("C:\\Program Files\\Adobe\\Adobe Photoshop 2024\\Photoshop.exe"), title: "Imposta percorso Photoshop 2024", children: "Photoshop 2024" }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => setPreferredEditorPathPersisted("C:\\Program Files\\Adobe\\Adobe Photoshop 2023\\Photoshop.exe"), title: "Imposta percorso Photoshop 2023", children: "Photoshop 2023" })] }), _jsx("p", { className: `photo-selector__settings-path-status photo-selector__settings-path-status--${editorPathStatus.kind}`, children: editorPathStatus.text }), _jsx("p", { className: "photo-selector__settings-empty", style: { marginTop: "0.3rem" }, children: "Usato per \"Apri con editor\" e \"Copia percorso\" nel menu contestuale." })] }), desktopThumbnailCacheInfo ? (_jsxs("div", { className: "photo-selector__settings-section", children: [_jsxs("h4", { className: "photo-selector__settings-section-title", children: ["Cache thumbnail desktop", _jsx("button", { type: "button", className: "photo-selector__settings-info-btn", title: "Le anteprime vengono salvate su disco dal layer desktop Windows. Il percorso predefinito e' locale e veloce, ma puoi spostarlo dove preferisci.", children: "?" })] }), _jsxs("label", { className: "photo-selector__settings-color-row", children: [_jsx("span", { style: { fontSize: "0.7rem", color: "var(--text-muted)", minWidth: 90 }, children: "Percorso" }), _jsx("div", { className: "photo-selector__settings-input-with-button", children: _jsx("input", { type: "text", className: "photo-selector__settings-color-input", value: desktopThumbnailCachePathInput, onChange: (e) => setDesktopThumbnailCachePathInput(e.target.value), placeholder: desktopThumbnailCacheInfo.defaultPath, spellCheck: false, disabled: isDesktopThumbnailCacheBusy }) })] }), _jsxs("div", { className: "photo-selector__settings-preset-row", children: [_jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: handleApplyDesktopThumbnailCachePath, disabled: isDesktopThumbnailCacheBusy || !desktopThumbnailCachePathInput.trim(), children: "Applica" }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => void onChooseDesktopThumbnailCacheDirectory?.(), disabled: isDesktopThumbnailCacheBusy || !onChooseDesktopThumbnailCacheDirectory, children: "Sfoglia..." }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => void onResetDesktopThumbnailCacheDirectory?.(), disabled: isDesktopThumbnailCacheBusy || !onResetDesktopThumbnailCacheDirectory, children: "Default" }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => void onClearDesktopThumbnailCache?.(), disabled: isDesktopThumbnailCacheBusy || !onClearDesktopThumbnailCache, children: "Svuota cache" })] }), desktopThumbnailCacheStatus ? (_jsx("p", { className: `photo-selector__settings-path-status photo-selector__settings-path-status--${desktopThumbnailCacheStatus.kind}`, children: desktopThumbnailCacheStatus.text })) : null, _jsxs("p", { className: "photo-selector__settings-empty", style: { marginTop: "0.3rem" }, children: [desktopThumbnailCacheInfo.entryCount, " anteprime, ", formatBytes(desktopThumbnailCacheInfo.totalBytes), " su disco."] }), _jsxs("p", { className: "photo-selector__settings-empty", style: { marginTop: "0.3rem" }, children: ["Percorso predefinito: ", desktopThumbnailCacheInfo.defaultPath] })] })) : null, _jsxs("div", { className: "photo-selector__settings-section", children: [_jsxs("h4", { className: "photo-selector__settings-section-title", children: ["Preset filtri", _jsx("button", { type: "button", className: "photo-selector__settings-info-btn", title: "Un preset salva la combinazione attuale di filtri (stelle, stato, colore, cartella...) con un nome. Utile per richiamare in un click un insieme di filtri che usi spesso \u2014 es. 'Migliori Pick' = Pick + 4 stelle + verde.", children: "?" })] }), _jsxs("div", { className: "photo-selector__settings-preset-row", children: [_jsx("input", { type: "text", className: "photo-selector__settings-color-input", value: newPresetName, onChange: (e) => setNewPresetName(e.target.value), placeholder: "Nome preset\u2026", onKeyDown: (e) => e.key === "Enter" && handleSavePreset() }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: handleSavePreset, disabled: !newPresetName.trim(), children: "Salva" })] }), filterPresets.length === 0 && (_jsx("p", { className: "photo-selector__settings-empty", children: "Nessun preset salvato." })), filterPresets.map((preset) => (_jsxs("div", { className: "photo-selector__settings-preset-item", children: [_jsx("button", { type: "button", className: "ghost-button ghost-button--small photo-selector__settings-preset-name", onClick: () => applyPreset(preset), children: preset.name }), _jsx("button", { type: "button", className: "icon-button icon-button--danger", onClick: () => removePreset(preset.id), title: "Elimina preset", children: "\u2715" })] }, preset.id)))] })] })), contextMenuState && (_jsx("div", { className: "photo-selector__context-backdrop", onClick: () => setContextMenuState(null), onContextMenu: (e) => e.preventDefault() })), contextMenuState ? (_jsx(PhotoSelectionContextMenu, { x: contextMenuState.x, y: contextMenuState.y, targetCount: contextMenuState.targetIds.length, colorLabelNames: customColorNames, hasFileAccess: "showDirectoryPicker" in window, rootFolderPath: rootFolderPath || undefined, targetPath: contextMenuState.targetIds.length === 1 ? (getAssetRelativePath(contextMenuState.targetIds[0]) ?? undefined) : undefined, onApplyRating: (rating) => {
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
                }, onToggleSelection: () => {
                    if (contextMenuState.targetIds.length === 1) {
                        togglePhoto(contextMenuState.targetIds[0]);
                    }
                    else {
                        invertVisibleSelection();
                    }
                    setContextMenuState(null);
                }, onOpenPreview: () => {
                    if (contextMenuState.targetIds.length > 0) {
                        handlePreview(contextMenuState.targetIds[0]);
                    }
                    setContextMenuState(null);
                }, onCopyFiles: () => {
                    const ids = [...contextMenuState.targetIds];
                    setContextMenuState(null);
                    void handleCopyFiles(ids);
                }, onMoveFiles: () => {
                    const ids = [...contextMenuState.targetIds];
                    setContextMenuState(null);
                    void handleMoveFiles(ids);
                }, onSaveAs: () => {
                    const ids = [...contextMenuState.targetIds];
                    setContextMenuState(null);
                    void handleSaveAs(ids);
                }, onCopyPath: () => {
                    handleCopyPath(contextMenuState.targetIds, rootFolderPath);
                    setContextMenuState(null);
                }, onOpenWithEditor: () => {
                    const ids = [...contextMenuState.targetIds];
                    setContextMenuState(null);
                    handleOpenWithEditor(ids);
                } })) : null, isCompareOpen && selectedIds.length >= 2 && (_jsx(CompareModal, { photos: photos.filter((p) => selectedSet.has(p.id)).slice(0, 4), onClose: () => setIsCompareOpen(false), onUpdatePhoto: (id, changes) => updatePhoto(id, changes) }))] }));
}
//# sourceMappingURL=PhotoSelector.js.map