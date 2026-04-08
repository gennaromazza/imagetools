import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { PhotoClassificationHelpButton } from "./PhotoClassificationHelpButton";
import { PhotoQuickPreviewModal } from "./PhotoQuickPreviewModal";
import { PhotoSearchBar } from "./PhotoSearchBar";
import { PhotoCard } from "./PhotoCard";
import { PhotoSelectionContextMenu } from "./PhotoSelectionContextMenu";
import { CompareModal } from "./CompareModal";
import { createOnDemandPreviewAsync, getCachedOnDemandPreviewUrl, getSubfolder, extractSubfolders, copyAssetsToFolder, moveAssetsToFolder, saveAssetAs, getAssetRelativePath, getAssetAbsolutePath, getAssetAbsolutePaths, detectChangedAssetsOnDisk, warmOnDemandPreviewCache, } from "../services/folder-access";
import { COLOR_LABEL_NAMES, COLOR_LABELS, DEFAULT_PHOTO_FILTERS, getAssetColorLabel, getAssetPickStatus, getAssetRating, matchesPhotoFilters, } from "../services/photo-classification";
import { CUSTOM_LABEL_SHORTCUT_OPTIONS, DEFAULT_CUSTOM_LABEL_TONE, normalizeCustomLabelColors, hydratePhotoSelectorPreferences, normalizeCustomLabelName, normalizeCustomLabelsCatalog, normalizeCustomLabelShortcut, normalizeCustomLabelShortcuts, savePhotoSelectorPreferences, } from "../services/photo-selector-preferences";
import { buildPhotoSortSignature, loadCachedPhotoSortOrder, hydratePhotoSortCache, saveCachedPhotoSortOrder, } from "../services/photo-sort-cache";
import { logDesktopEvent } from "../services/desktop-store";
const CUSTOM_LABEL_TONES = ["sand", "rose", "green", "blue", "purple", "slate"];
const GRID_GAP_PX = 12;
const CARD_STAGE_HEIGHT_RATIO = 0.75;
const QUICK_PREVIEW_FIT_MAX_DIMENSION = 2048;
const CARD_CHROME_HEIGHT_PX = 64;
const VIRTUAL_OVERSCAN_ROWS_IDLE = 4;
const VIRTUAL_OVERSCAN_ROWS_FAST = 10;
const FAST_SCROLL_COOLDOWN_MS = 120;
const ROOT_FOLDER_OVERRIDE_KEY = "ps-root-folder-path-override";
const LEGACY_ROOT_FOLDER_KEY = "ps-root-folder-path";
const KNOWN_EDITOR_PRESET_PATHS = [
    "C:\\Program Files\\Adobe\\Adobe Photoshop 2026\\Photoshop.exe",
    "C:\\Program Files\\Adobe\\Adobe Photoshop 2025\\Photoshop.exe",
    "C:\\Program Files\\Adobe\\Adobe Photoshop 2024\\Photoshop.exe",
    "C:\\Program Files\\Adobe\\Adobe Photoshop 2023\\Photoshop.exe",
];
function sanitizeEditorExecutablePath(value) {
    const normalized = value.trim().replace(/^"+|"+$/g, "");
    return /^[a-zA-Z]:/.test(normalized) ? normalized.replace(/\//g, "\\") : normalized;
}
function isValidDesktopEditorPath(value) {
    const normalized = sanitizeEditorExecutablePath(value);
    if (!normalized) {
        return false;
    }
    if (/^[a-zA-Z]:\\/.test(normalized)) {
        return /\.(exe|bat|cmd)$/i.test(normalized);
    }
    if (normalized.startsWith("/")) {
        return /\.app$/i.test(normalized) || /\/[^/]+$/.test(normalized);
    }
    return false;
}
function normalizeAssetCustomLabels(values) {
    return normalizeCustomLabelsCatalog(values);
}
function areStringArraysEqual(left, right) {
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
function areOrderedIdsEqual(left, right) {
    if (left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) {
            return false;
        }
    }
    return true;
}
function resolvePhotoCreatedAt(photo) {
    if (typeof photo.createdAt === "number" && Number.isFinite(photo.createdAt) && photo.createdAt > 0) {
        return Math.round(photo.createdAt);
    }
    const timestampRaw = photo.sourceFileKey?.split("::").at(-1);
    const parsedTimestamp = timestampRaw ? Number(timestampRaw) : NaN;
    if (Number.isFinite(parsedTimestamp) && parsedTimestamp > 0) {
        return Math.round(parsedTimestamp);
    }
    return 0;
}
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
    if (changes.customLabels !== undefined) {
        return changes.customLabels.length > 0
            ? `${subject}: etichette ${changes.customLabels.join(", ")}`
            : `${subject}: etichette personalizzate rimosse`;
    }
    return `${subject}: metadati aggiornati`;
}
function getSeriesKey(photo) {
    const stem = photo.fileName.replace(/\.[^.]+$/, "");
    const normalized = stem.replace(/[_\-\s]*\d+$/, "").trim();
    return normalized || stem;
}
function getTimeClusterKey(photo) {
    const timestamp = resolvePhotoCreatedAt(photo);
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
function formatMilliseconds(value) {
    if (value === null || !Number.isFinite(value)) {
        return "n/d";
    }
    return `${value} ms`;
}
function formatVolumeSummary(recommendation) {
    const currentVolume = recommendation?.currentVolume;
    const recommendedVolume = recommendation?.recommendedVolume;
    const current = currentVolume
        ? `${currentVolume.mountPath} · ${formatBytes(currentVolume.freeBytes)} liberi su ${formatBytes(currentVolume.totalBytes)}`
        : "Volume attuale non disponibile";
    const recommended = recommendedVolume && recommendation?.recommendedPath
        ? `${recommendation.recommendedPath} · ${formatBytes(recommendedVolume.freeBytes)} liberi su ${formatBytes(recommendedVolume.totalBytes)}`
        : null;
    return { current, recommended };
}
export function PhotoSelector({ photos, metadataVersion, sourceFolderPath = "", selectedIds, onSelectionChange, onPhotosChange, onVisibleIdsChange, onPriorityIdsChange, onPreviewPriorityIdsChange, onBackgroundPreviewOrderChange, onScrollLiteActiveMsChange, onUndo, onRedo, canUndo = false, canRedo = false, isThumbnailLoading = false, thumbnailProfile = "ultra-fast", sortCacheEnabled = true, performanceSnapshot = null, onThumbnailProfileChange, onSortCacheEnabledChange, desktopThumbnailCacheInfo = null, desktopCacheLocationRecommendation = null, isDesktopThumbnailCacheBusy = false, isDesktopCacheRecommendationModalOpen = false, onChooseDesktopThumbnailCacheDirectory, onSetDesktopThumbnailCacheDirectory, onUseRecommendedDesktopThumbnailCacheDirectory, onResetDesktopThumbnailCacheDirectory, onClearDesktopThumbnailCache, onSnoozeDesktopCacheRecommendation, onDismissDesktopCacheRecommendation, }) {
    const [sortBy, setSortBy] = useState("name");
    const [pickFilter, setPickFilter] = useState(DEFAULT_PHOTO_FILTERS.pickStatus);
    const [ratingFilter, setRatingFilter] = useState(DEFAULT_PHOTO_FILTERS.ratingFilter);
    const [colorFilter, setColorFilter] = useState(DEFAULT_PHOTO_FILTERS.colorLabel);
    const [customLabelFilter, setCustomLabelFilter] = useState("all");
    const [folderFilter, setFolderFilter] = useState("all");
    const [seriesFilter, setSeriesFilter] = useState("all");
    const [timeClusterFilter, setTimeClusterFilter] = useState("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [customColorNames, setCustomColorNames] = useState(() => ({ ...COLOR_LABEL_NAMES }));
    const [customLabelsCatalog, setCustomLabelsCatalog] = useState([]);
    const [customLabelColors, setCustomLabelColors] = useState({});
    const [customLabelShortcuts, setCustomLabelShortcuts] = useState({});
    const [filterPresets, setFilterPresets] = useState([]);
    const [selectedThumbnailProfile, setSelectedThumbnailProfile] = useState(thumbnailProfile);
    const [isSortCacheEnabled, setIsSortCacheEnabled] = useState(sortCacheEnabled);
    const [newPresetName, setNewPresetName] = useState("");
    const [newCustomLabelName, setNewCustomLabelName] = useState("");
    const [newCustomLabelTone, setNewCustomLabelTone] = useState(DEFAULT_CUSTOM_LABEL_TONE);
    const [newCustomLabelShortcut, setNewCustomLabelShortcut] = useState(null);
    const [newBatchCustomLabelName, setNewBatchCustomLabelName] = useState("");
    const [newBatchCustomLabelTone, setNewBatchCustomLabelTone] = useState(DEFAULT_CUSTOM_LABEL_TONE);
    const [newBatchCustomLabelShortcut, setNewBatchCustomLabelShortcut] = useState(null);
    const [timelineEntries, setTimelineEntries] = useState([]);
    const [isBatchToolsOpen, setIsBatchToolsOpen] = useState(false);
    const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);
    const [isCompareOpen, setIsCompareOpen] = useState(false);
    const [cardSize, setCardSize] = useState(160);
    const [rootFolderPathOverride, setRootFolderPathOverride] = useState("");
    const [preferredEditorPath, setPreferredEditorPath] = useState("");
    const [preferencesHydrated, setPreferencesHydrated] = useState(false);
    const [sortCacheHydrationToken, setSortCacheHydrationToken] = useState(0);
    const [desktopDragOutCheck, setDesktopDragOutCheck] = useState(null);
    const [installedEditorCandidates, setInstalledEditorCandidates] = useState([]);
    const [desktopThumbnailCachePathInput, setDesktopThumbnailCachePathInput] = useState("");
    const setPreferredEditorPathPersisted = useCallback((value) => {
        const normalized = sanitizeEditorExecutablePath(value);
        setPreferredEditorPath(normalized);
        if (preferencesHydrated) {
            savePhotoSelectorPreferences({ preferredEditorPath: normalized });
        }
        void logDesktopEvent({
            channel: "editor",
            level: "info",
            message: "Percorso editor aggiornato",
            details: normalized || "vuoto",
        });
    }, [preferencesHydrated]);
    const setRootFolderPathOverridePersisted = useCallback((value) => {
        setRootFolderPathOverride(value);
        if (preferencesHydrated) {
            savePhotoSelectorPreferences({
                rootFolderPathOverride: value.trim() ? value : "",
            });
        }
    }, [preferencesHydrated]);
    const [previewAssetId, setPreviewAssetId] = useState(null);
    const [contextMenuState, setContextMenuState] = useState(null);
    const [focusedPhotoId, setFocusedPhotoId] = useState(null);
    const [previewStartsZoomed, setPreviewStartsZoomed] = useState(false);
    const lastPreviewAssetIdRef = useRef(null);
    const pendingPreviewRestoreIdRef = useRef(null);
    const lastClickedIdRef = useRef(null);
    const gridRef = useRef(null);
    const desktopDragImageRef = useRef(null);
    const fastScrollCooldownTimerRef = useRef(null);
    const fastScrollStartedAtRef = useRef(null);
    const accumulatedFastScrollMsRef = useRef(0);
    const lastVisibleIdsRef = useRef([]);
    const pendingVisibleIdsRef = useRef(null);
    const visibleIdsDispatchRafRef = useRef(null);
    const lastBackgroundPreviewOrderSignatureRef = useRef("");
    const frozenDynamicSortOrderRef = useRef(null);
    const batchPulseTokenRef = useRef(0);
    const batchPulseClearTimerRef = useRef(null);
    const dragOriginRef = useRef(null);
    const [dragRect, setDragRect] = useState(null);
    const [gridViewport, setGridViewport] = useState({ width: 0, height: 720 });
    const [isFastScrollActive, setIsFastScrollActive] = useState(false);
    const [batchPulseState, setBatchPulseState] = useState(null);
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const effectiveRootFolderPath = useMemo(() => rootFolderPathOverride.trim() || sourceFolderPath.trim(), [rootFolderPathOverride, sourceFolderPath]);
    const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
    const metadataPhotos = useMemo(() => photos, [metadataVersion, photos.length]);
    const metadataAssetById = useMemo(() => new Map(metadataPhotos.map((photo) => [photo.id, photo])), [metadataPhotos]);
    const assetById = useMemo(() => new Map(photos.map((photo) => [photo.id, photo])), [photos]);
    const photosRef = useRef(photos);
    useEffect(() => {
        photosRef.current = photos;
    }, [photos]);
    useEffect(() => {
        return () => {
            if (batchPulseClearTimerRef.current !== null) {
                window.clearTimeout(batchPulseClearTimerRef.current);
                batchPulseClearTimerRef.current = null;
            }
            if (visibleIdsDispatchRafRef.current !== null) {
                window.cancelAnimationFrame(visibleIdsDispatchRafRef.current);
                visibleIdsDispatchRafRef.current = null;
            }
            pendingVisibleIdsRef.current = null;
        };
    }, []);
    useEffect(() => {
        setDesktopThumbnailCachePathInput(desktopThumbnailCacheInfo?.currentPath ?? "");
    }, [desktopThumbnailCacheInfo?.currentPath]);
    const activeFilterCount = useMemo(() => [
        pickFilter !== "all",
        ratingFilter !== "any",
        colorFilter !== "all",
        customLabelFilter !== "all",
        folderFilter !== "all",
        seriesFilter !== "all",
        timeClusterFilter !== "all",
        searchQuery !== "",
    ].filter(Boolean).length, [pickFilter, ratingFilter, colorFilter, customLabelFilter, folderFilter, seriesFilter, timeClusterFilter, searchQuery]);
    const selectionStats = useMemo(() => {
        if (selectedIds.length === 0)
            return null;
        const sel = selectedIds
            .map((photoId) => metadataAssetById.get(photoId))
            .filter((photo) => !!photo);
        return {
            picked: sel.filter((p) => getAssetPickStatus(p) === "picked").length,
            rejected: sel.filter((p) => getAssetPickStatus(p) === "rejected").length,
            highRating: sel.filter((p) => getAssetRating(p) >= 3).length,
        };
    }, [metadataAssetById, selectedIds]);
    const hasActiveFilters = pickFilter !== "all" ||
        ratingFilter !== "any" ||
        colorFilter !== "all" ||
        customLabelFilter !== "all" ||
        folderFilter !== "all" ||
        seriesFilter !== "all" ||
        timeClusterFilter !== "all" ||
        searchQuery !== "";
    const customLabelByShortcut = useMemo(() => {
        const entries = Object.entries(customLabelShortcuts)
            .filter((entry) => Boolean(entry[1]));
        return new Map(entries.map(([label, shortcut]) => [shortcut, label]));
    }, [customLabelShortcuts]);
    const pushTimelineEntry = useCallback((label) => {
        setTimelineEntries((current) => [
            { id: `timeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, label },
            ...current,
        ].slice(0, 5));
    }, []);
    const triggerBatchPulse = useCallback((targetIds, kind) => {
        if (targetIds.length === 0) {
            return;
        }
        const uniqueIds = Array.from(new Set(targetIds));
        if (uniqueIds.length === 0) {
            return;
        }
        batchPulseTokenRef.current += 1;
        const token = batchPulseTokenRef.current;
        setBatchPulseState({
            token,
            kind,
            ids: new Set(uniqueIds),
        });
        if (batchPulseClearTimerRef.current !== null) {
            window.clearTimeout(batchPulseClearTimerRef.current);
        }
        batchPulseClearTimerRef.current = window.setTimeout(() => {
            setBatchPulseState((current) => (current?.token === token ? null : current));
            batchPulseClearTimerRef.current = null;
        }, 1200);
    }, []);
    useEffect(() => {
        let active = true;
        void hydratePhotoSelectorPreferences().then((preferences) => {
            if (!active) {
                return;
            }
            setCustomColorNames(preferences.colorNames);
            setFilterPresets(preferences.filterPresets);
            setCustomLabelsCatalog(preferences.customLabelsCatalog);
            setCustomLabelColors(preferences.customLabelColors);
            setCustomLabelShortcuts(preferences.customLabelShortcuts);
            setSelectedThumbnailProfile(preferences.thumbnailProfile);
            setIsSortCacheEnabled(preferences.sortCacheEnabled);
            setCardSize(preferences.cardSize);
            setRootFolderPathOverride(preferences.rootFolderPathOverride);
            setPreferredEditorPath(sanitizeEditorExecutablePath(preferences.preferredEditorPath));
            setPreferencesHydrated(true);
        }).catch(() => {
            if (active) {
                setPreferencesHydrated(true);
            }
        });
        return () => {
            active = false;
        };
    }, []);
    useEffect(() => {
        let active = true;
        if (!sourceFolderPath || !isSortCacheEnabled) {
            setSortCacheHydrationToken((current) => current + 1);
            return;
        }
        void hydratePhotoSortCache(sourceFolderPath).then(() => {
            if (active) {
                setSortCacheHydrationToken((current) => current + 1);
            }
        }).catch(() => {
            if (active) {
                setSortCacheHydrationToken((current) => current + 1);
            }
        });
        return () => {
            active = false;
        };
    }, [isSortCacheEnabled, sourceFolderPath]);
    useEffect(() => {
        setSelectedThumbnailProfile(thumbnailProfile);
    }, [thumbnailProfile]);
    useEffect(() => {
        setIsSortCacheEnabled(sortCacheEnabled);
    }, [sortCacheEnabled]);
    useEffect(() => {
        if (!preferencesHydrated) {
            return;
        }
        savePhotoSelectorPreferences({
            cardSize,
        });
    }, [cardSize, preferencesHydrated]);
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
            const nextCustomLabels = changes.customLabels !== undefined
                ? normalizeAssetCustomLabels(changes.customLabels)
                : normalizeAssetCustomLabels(photo.customLabels);
            if (nextRating === photo.rating &&
                nextPickStatus === photo.pickStatus &&
                nextColorLabel === photo.colorLabel &&
                areStringArraysEqual(nextCustomLabels, normalizeAssetCustomLabels(photo.customLabels))) {
                return photo;
            }
            changed = true;
            return {
                ...photo,
                ...changes,
                customLabels: nextCustomLabels,
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
        setCustomLabelFilter("all");
        setFolderFilter("all");
        setSeriesFilter("all");
        setTimeClusterFilter("all");
        setSearchQuery("");
    }
    const persistPreferences = useCallback((nextColorNames, nextFilterPresets, nextCustomLabelsCatalog, nextCustomLabelColors, nextCustomLabelShortcuts, nextThumbnailProfile = selectedThumbnailProfile, nextSortCacheEnabled = isSortCacheEnabled) => {
        savePhotoSelectorPreferences({
            colorNames: nextColorNames,
            filterPresets: nextFilterPresets,
            customLabelsCatalog: nextCustomLabelsCatalog,
            customLabelColors: nextCustomLabelColors,
            customLabelShortcuts: nextCustomLabelShortcuts,
            thumbnailProfile: nextThumbnailProfile,
            sortCacheEnabled: nextSortCacheEnabled,
        });
    }, [isSortCacheEnabled, selectedThumbnailProfile]);
    const handleColorNameChange = useCallback((label, value) => {
        setCustomColorNames((current) => {
            const next = {
                ...current,
                [label]: value.trim() || COLOR_LABEL_NAMES[label],
            };
            persistPreferences(next, filterPresets, customLabelsCatalog, customLabelColors, customLabelShortcuts);
            return next;
        });
    }, [customLabelsCatalog, filterPresets, persistPreferences]);
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
                customLabelFilter,
                folderFilter,
                seriesFilter,
                timeClusterFilter,
                searchQuery,
            },
        };
        setFilterPresets((current) => {
            const next = [nextPreset, ...current].slice(0, 12);
            persistPreferences(customColorNames, next, customLabelsCatalog, customLabelColors, customLabelShortcuts);
            return next;
        });
        setNewPresetName("");
    }, [colorFilter, customColorNames, customLabelFilter, customLabelsCatalog, folderFilter, newPresetName, persistPreferences, pickFilter, ratingFilter, searchQuery, seriesFilter, timeClusterFilter]);
    const applyPreset = useCallback((preset) => {
        setPickFilter(preset.filters.pickStatus);
        setRatingFilter(preset.filters.ratingFilter);
        setColorFilter(preset.filters.colorLabel);
        setCustomLabelFilter(preset.filters.customLabelFilter ?? "all");
        setFolderFilter(preset.filters.folderFilter ?? "all");
        setSeriesFilter(preset.filters.seriesFilter ?? "all");
        setTimeClusterFilter(preset.filters.timeClusterFilter ?? "all");
        setSearchQuery(preset.filters.searchQuery ?? "");
    }, []);
    const removePreset = useCallback((presetId) => {
        setFilterPresets((current) => {
            const next = current.filter((preset) => preset.id !== presetId);
            persistPreferences(customColorNames, next, customLabelsCatalog, customLabelColors, customLabelShortcuts);
            return next;
        });
    }, [customColorNames, customLabelsCatalog, persistPreferences]);
    const persistCustomLabelsCatalog = useCallback((nextCatalog) => {
        const normalized = normalizeCustomLabelsCatalog(nextCatalog);
        setCustomLabelsCatalog(normalized);
        const nextShortcuts = normalizeCustomLabelShortcuts(normalized, customLabelShortcuts);
        setCustomLabelShortcuts(nextShortcuts);
        persistPreferences(customColorNames, filterPresets, normalized, normalizeCustomLabelColors(normalized, customLabelColors), nextShortcuts);
        return normalized;
    }, [customColorNames, customLabelColors, customLabelShortcuts, filterPresets, persistPreferences]);
    const resolveCustomLabelTone = useCallback((label) => {
        const match = Object.entries(customLabelColors).find(([key]) => key.toLocaleLowerCase() === label.toLocaleLowerCase());
        return match?.[1] ?? DEFAULT_CUSTOM_LABEL_TONE;
    }, [customLabelColors]);
    const resolveCustomLabelShortcut = useCallback((label) => {
        const match = Object.entries(customLabelShortcuts).find(([key]) => key.toLocaleLowerCase() === label.toLocaleLowerCase());
        return match?.[1] ?? null;
    }, [customLabelShortcuts]);
    const handleCustomLabelToneChange = useCallback((label, tone) => {
        setCustomLabelColors((current) => {
            const next = normalizeCustomLabelColors(customLabelsCatalog, {
                ...current,
                [label]: tone,
            });
            persistPreferences(customColorNames, filterPresets, customLabelsCatalog, next, customLabelShortcuts);
            return next;
        });
    }, [customColorNames, customLabelShortcuts, customLabelsCatalog, filterPresets, persistPreferences]);
    const handleCustomLabelShortcutChange = useCallback((label, shortcut) => {
        setCustomLabelShortcuts((current) => {
            const nextEntries = Object.fromEntries(Object.entries(current).map(([currentLabel, currentShortcut]) => {
                if (currentLabel !== label && currentShortcut === shortcut && shortcut !== null) {
                    return [currentLabel, null];
                }
                return [currentLabel, currentShortcut];
            }));
            const next = normalizeCustomLabelShortcuts(customLabelsCatalog, {
                ...nextEntries,
                [label]: shortcut,
            });
            persistPreferences(customColorNames, filterPresets, customLabelsCatalog, customLabelColors, next);
            return next;
        });
    }, [customColorNames, customLabelColors, customLabelsCatalog, filterPresets, persistPreferences]);
    const findCatalogCustomLabel = useCallback((label) => {
        const match = customLabelsCatalog.find((existingLabel) => existingLabel.toLocaleLowerCase() === label.toLocaleLowerCase());
        return match ?? null;
    }, [customLabelsCatalog]);
    const handleThumbnailProfileChange = useCallback((nextProfile) => {
        setSelectedThumbnailProfile(nextProfile);
        savePhotoSelectorPreferences({
            thumbnailProfile: nextProfile,
        });
        onThumbnailProfileChange?.(nextProfile);
        pushTimelineEntry(nextProfile === "ultra-fast"
            ? "Profilo anteprime: Ultra Fast"
            : nextProfile === "fast"
                ? "Profilo anteprime: Fast contact sheet"
                : "Profilo anteprime: Bilanciato");
    }, [onThumbnailProfileChange, pushTimelineEntry]);
    const handleSortCacheEnabledChange = useCallback((nextEnabled) => {
        setIsSortCacheEnabled(nextEnabled);
        savePhotoSelectorPreferences({
            sortCacheEnabled: nextEnabled,
        });
        onSortCacheEnabledChange?.(nextEnabled);
        pushTimelineEntry(nextEnabled ? "Sort cache attivata" : "Sort cache disattivata");
    }, [onSortCacheEnabledChange, pushTimelineEntry]);
    const updateCustomLabelsForIds = useCallback((targetIds, updater, timelineLabel) => {
        if (!onPhotosChange || targetIds.length === 0) {
            return;
        }
        const idSet = new Set(targetIds);
        let changed = false;
        const changedIds = [];
        const nextPhotos = photos.map((photo) => {
            if (!idSet.has(photo.id)) {
                return photo;
            }
            const currentLabels = normalizeAssetCustomLabels(photo.customLabels);
            const nextLabels = normalizeAssetCustomLabels(updater(currentLabels, photo));
            if (areStringArraysEqual(currentLabels, nextLabels)) {
                return photo;
            }
            changed = true;
            changedIds.push(photo.id);
            return {
                ...photo,
                customLabels: nextLabels,
            };
        });
        if (changed) {
            onPhotosChange(nextPhotos);
            pushTimelineEntry(timelineLabel);
            triggerBatchPulse(changedIds, "label");
        }
    }, [onPhotosChange, photos, pushTimelineEntry, triggerBatchPulse]);
    const assignCustomLabelToSelection = useCallback((label) => {
        if (selectedIds.length === 0) {
            return;
        }
        updateCustomLabelsForIds(selectedIds, (currentLabels) => (currentLabels.some((currentLabel) => currentLabel.toLocaleLowerCase() === label.toLocaleLowerCase())
            ? currentLabels
            : [...currentLabels, label]), `${selectedIds.length === 1 ? "1 foto" : `${selectedIds.length} foto`}: aggiunta etichetta ${label}`);
    }, [selectedIds, updateCustomLabelsForIds]);
    const toggleCustomLabelForIds = useCallback((targetIds, label) => {
        if (targetIds.length === 0) {
            return;
        }
        const allHaveLabel = targetIds.every((id) => {
            const asset = assetById.get(id);
            return normalizeAssetCustomLabels(asset?.customLabels).some((currentLabel) => currentLabel.toLocaleLowerCase() === label.toLocaleLowerCase());
        });
        updateCustomLabelsForIds(targetIds, (currentLabels) => allHaveLabel
            ? currentLabels.filter((currentLabel) => currentLabel.toLocaleLowerCase() !== label.toLocaleLowerCase())
            : [...currentLabels, label], allHaveLabel
            ? `${targetIds.length === 1 ? "1 foto" : `${targetIds.length} foto`}: rimossa etichetta ${label}`
            : `${targetIds.length === 1 ? "1 foto" : `${targetIds.length} foto`}: aggiunta etichetta ${label}`);
    }, [assetById, updateCustomLabelsForIds]);
    const handleAddCustomLabelToCatalog = useCallback((rawLabel, options) => {
        const requestedLabel = normalizeCustomLabelName(rawLabel);
        if (!requestedLabel) {
            return;
        }
        const assignToSelection = options?.assignToSelection ?? false;
        const requestedTone = options?.tone ?? DEFAULT_CUSTOM_LABEL_TONE;
        const requestedShortcut = options?.shortcut ?? null;
        const existingLabel = findCatalogCustomLabel(requestedLabel);
        const canonicalLabel = existingLabel ?? requestedLabel;
        const nextCatalog = existingLabel
            ? customLabelsCatalog
            : persistCustomLabelsCatalog([...customLabelsCatalog, requestedLabel]);
        if (existingLabel) {
            handleCustomLabelToneChange(canonicalLabel, requestedTone);
            handleCustomLabelShortcutChange(canonicalLabel, requestedShortcut);
        }
        else {
            setCustomLabelColors((current) => {
                const nextColors = normalizeCustomLabelColors(nextCatalog, {
                    ...current,
                    [canonicalLabel]: current[canonicalLabel] ?? requestedTone,
                });
                return nextColors;
            });
            setCustomLabelShortcuts((current) => {
                const next = normalizeCustomLabelShortcuts(nextCatalog, {
                    ...Object.fromEntries(Object.entries(current).map(([label, currentShortcut]) => {
                        if (label !== canonicalLabel && currentShortcut === requestedShortcut && requestedShortcut !== null) {
                            return [label, null];
                        }
                        return [label, currentShortcut];
                    })),
                    [canonicalLabel]: requestedShortcut,
                });
                persistPreferences(customColorNames, filterPresets, nextCatalog, normalizeCustomLabelColors(nextCatalog, {
                    ...customLabelColors,
                    [canonicalLabel]: requestedTone,
                }), next);
                return next;
            });
        }
        if (assignToSelection && selectedIds.length > 0) {
            assignCustomLabelToSelection(canonicalLabel);
        }
        else if (!existingLabel) {
            pushTimelineEntry(`Nuova etichetta disponibile: ${canonicalLabel}`);
        }
    }, [
        assignCustomLabelToSelection,
        customColorNames,
        customLabelColors,
        customLabelShortcuts,
        customLabelsCatalog,
        filterPresets,
        findCatalogCustomLabel,
        handleCustomLabelShortcutChange,
        handleCustomLabelToneChange,
        persistCustomLabelsCatalog,
        persistPreferences,
        pushTimelineEntry,
        selectedIds.length,
    ]);
    const handleRenameCustomLabel = useCallback((previousLabel, nextRawLabel) => {
        const nextLabel = normalizeCustomLabelName(nextRawLabel);
        if (!nextLabel || nextLabel === previousLabel) {
            return;
        }
        const nextCatalog = customLabelsCatalog.map((label) => (label === previousLabel ? nextLabel : label));
        persistCustomLabelsCatalog(nextCatalog);
        setCustomLabelColors((current) => {
            const previousTone = resolveCustomLabelTone(previousLabel);
            const withoutPrevious = Object.fromEntries(Object.entries(current).filter(([label]) => label !== previousLabel));
            const nextColors = normalizeCustomLabelColors(nextCatalog, {
                ...withoutPrevious,
                [nextLabel]: previousTone,
            });
            persistPreferences(customColorNames, filterPresets, nextCatalog, nextColors, normalizeCustomLabelShortcuts(nextCatalog, {
                ...customLabelShortcuts,
                [nextLabel]: resolveCustomLabelShortcut(previousLabel),
            }));
            return nextColors;
        });
        setCustomLabelShortcuts((current) => {
            const previousShortcut = resolveCustomLabelShortcut(previousLabel);
            const withoutPrevious = Object.fromEntries(Object.entries(current).filter(([label]) => label !== previousLabel));
            return normalizeCustomLabelShortcuts(nextCatalog, {
                ...withoutPrevious,
                [nextLabel]: previousShortcut,
            });
        });
        updateCustomLabelsForIds(photos.map((photo) => photo.id), (currentLabels) => currentLabels.map((label) => (label === previousLabel ? nextLabel : label)), `Etichetta rinominata: ${previousLabel} -> ${nextLabel}`);
    }, [customColorNames, customLabelShortcuts, customLabelsCatalog, filterPresets, persistCustomLabelsCatalog, photos, resolveCustomLabelShortcut, resolveCustomLabelTone, updateCustomLabelsForIds]);
    const handleRemoveCustomLabel = useCallback((labelToRemove) => {
        const nextCatalog = customLabelsCatalog.filter((label) => label !== labelToRemove);
        persistCustomLabelsCatalog(nextCatalog);
        setCustomLabelColors((current) => {
            const nextColors = normalizeCustomLabelColors(nextCatalog, Object.fromEntries(Object.entries(current).filter(([label]) => label !== labelToRemove)));
            persistPreferences(customColorNames, filterPresets, nextCatalog, nextColors, normalizeCustomLabelShortcuts(nextCatalog, customLabelShortcuts));
            return nextColors;
        });
        setCustomLabelShortcuts((current) => normalizeCustomLabelShortcuts(nextCatalog, Object.fromEntries(Object.entries(current).filter(([label]) => label !== labelToRemove))));
        updateCustomLabelsForIds(photos.map((photo) => photo.id), (currentLabels) => currentLabels.filter((label) => label !== labelToRemove), `Etichetta rimossa: ${labelToRemove}`);
    }, [customColorNames, customLabelShortcuts, customLabelsCatalog, filterPresets, persistCustomLabelsCatalog, photos, persistPreferences, updateCustomLabelsForIds]);
    // Extract unique subfolders for the folder filter dropdown
    const subfolders = useMemo(() => extractSubfolders(metadataPhotos), [metadataPhotos]);
    const seriesGroups = useMemo(() => {
        const counts = new Map();
        for (const photo of metadataPhotos) {
            const key = getSeriesKey(photo);
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return Array.from(counts.entries())
            .map(([key, count]) => ({ key, count }))
            .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
    }, [metadataPhotos]);
    const timeClusters = useMemo(() => {
        const counts = new Map();
        for (const photo of metadataPhotos) {
            const key = getTimeClusterKey(photo);
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return Array.from(counts.entries())
            .map(([key, count]) => ({ key, count }))
            .sort((left, right) => left.key.localeCompare(right.key));
    }, [metadataPhotos]);
    const customLabelFilterOptions = useMemo(() => {
        const counts = new Map();
        for (const photo of metadataPhotos) {
            for (const label of normalizeAssetCustomLabels(photo.customLabels)) {
                counts.set(label, (counts.get(label) ?? 0) + 1);
            }
        }
        return customLabelsCatalog
            .map((label) => ({ label, count: counts.get(label) ?? 0 }))
            .filter(({ count }) => count > 0);
    }, [customLabelsCatalog, metadataPhotos]);
    const sortedPhotoIds = useMemo(() => {
        const isDynamicSort = sortBy === "orientation" || sortBy === "rating";
        const signature = buildPhotoSortSignature(metadataPhotos, sortBy);
        const knownIds = new Set(metadataPhotos.map((photo) => photo.id));
        if (isDynamicSort && isThumbnailLoading) {
            const frozen = frozenDynamicSortOrderRef.current;
            if (frozen &&
                frozen.sortBy === sortBy &&
                frozen.ids.length === metadataPhotos.length &&
                frozen.ids.every((photoId) => knownIds.has(photoId))) {
                return frozen.ids;
            }
        }
        if (sourceFolderPath && isSortCacheEnabled) {
            const cachedIds = loadCachedPhotoSortOrder(sourceFolderPath, sortBy, signature);
            if (cachedIds &&
                cachedIds.length === metadataPhotos.length &&
                cachedIds.every((photoId) => knownIds.has(photoId))) {
                if (isDynamicSort && isThumbnailLoading) {
                    frozenDynamicSortOrderRef.current = {
                        sortBy,
                        signature,
                        ids: cachedIds,
                    };
                }
                else if (!isThumbnailLoading && frozenDynamicSortOrderRef.current?.sortBy === sortBy) {
                    frozenDynamicSortOrderRef.current = null;
                }
                return cachedIds;
            }
        }
        const orderedIds = metadataPhotos
            .slice()
            .sort((left, right) => {
            if (sortBy === "rating") {
                return (getAssetRating(right) - getAssetRating(left) ||
                    left.fileName.localeCompare(right.fileName));
            }
            if (sortBy === "orientation") {
                return (left.orientation.localeCompare(right.orientation) ||
                    left.fileName.localeCompare(right.fileName));
            }
            if (sortBy === "createdAt") {
                return (resolvePhotoCreatedAt(right) - resolvePhotoCreatedAt(left) ||
                    left.fileName.localeCompare(right.fileName));
            }
            return left.fileName.localeCompare(right.fileName);
        })
            .map((photo) => photo.id);
        if (isDynamicSort && isThumbnailLoading) {
            frozenDynamicSortOrderRef.current = {
                sortBy,
                signature,
                ids: orderedIds,
            };
        }
        else if (!isThumbnailLoading && frozenDynamicSortOrderRef.current?.sortBy === sortBy) {
            frozenDynamicSortOrderRef.current = null;
        }
        if (sourceFolderPath && isSortCacheEnabled) {
            saveCachedPhotoSortOrder(sourceFolderPath, sortBy, signature, orderedIds);
        }
        return orderedIds;
    }, [isSortCacheEnabled, isThumbnailLoading, metadataPhotos, sortBy, sortCacheHydrationToken, sourceFolderPath]);
    const visiblePhotoIds = useMemo(() => {
        const lowerSearch = deferredSearchQuery.toLowerCase();
        const filteredIds = [];
        for (const photoId of sortedPhotoIds) {
            const photo = metadataAssetById.get(photoId);
            if (!photo) {
                continue;
            }
            if (!matchesPhotoFilters(photo, {
                pickStatus: pickFilter,
                ratingFilter,
                colorLabel: colorFilter,
            })) {
                continue;
            }
            if (customLabelFilter !== "all"
                && !normalizeAssetCustomLabels(photo.customLabels).some((label) => label.toLocaleLowerCase() === customLabelFilter.toLocaleLowerCase())) {
                continue;
            }
            if (folderFilter !== "all" && getSubfolder(photo.path) !== folderFilter) {
                continue;
            }
            if (seriesFilter !== "all" && getSeriesKey(photo) !== seriesFilter) {
                continue;
            }
            if (timeClusterFilter !== "all" && getTimeClusterKey(photo) !== timeClusterFilter) {
                continue;
            }
            if (lowerSearch && !photo.fileName.toLowerCase().includes(lowerSearch)) {
                continue;
            }
            filteredIds.push(photo.id);
        }
        return filteredIds;
    }, [
        colorFilter,
        customLabelFilter,
        deferredSearchQuery,
        folderFilter,
        metadataAssetById,
        pickFilter,
        ratingFilter,
        seriesFilter,
        sortedPhotoIds,
        timeClusterFilter,
    ]);
    const getVisiblePhotoAtIndex = useCallback((index) => {
        const id = visiblePhotoIds[index];
        if (!id) {
            return null;
        }
        return assetById.get(id) ?? null;
    }, [assetById, visiblePhotoIds]);
    const visiblePhotoIndexById = useMemo(() => new Map(visiblePhotoIds.map((photoId, index) => [photoId, index])), [visiblePhotoIds]);
    const visiblePhotoIdSet = useMemo(() => new Set(visiblePhotoIds), [visiblePhotoIds]);
    const gridColumnCount = useMemo(() => {
        const width = gridViewport.width || cardSize;
        return Math.max(1, Math.floor((width + GRID_GAP_PX) / (cardSize + GRID_GAP_PX)));
    }, [cardSize, gridViewport.width]);
    const gridColumnWidth = useMemo(() => {
        const width = gridViewport.width || cardSize;
        return Math.max(cardSize, Math.floor((width - GRID_GAP_PX * Math.max(0, gridColumnCount - 1)) / gridColumnCount));
    }, [cardSize, gridColumnCount, gridViewport.width]);
    const cardStageHeight = useMemo(() => Math.max(96, Math.round(gridColumnWidth * CARD_STAGE_HEIGHT_RATIO)), [gridColumnWidth]);
    const gridRowHeight = useMemo(() => cardStageHeight + CARD_CHROME_HEIGHT_PX + GRID_GAP_PX, [cardStageHeight]);
    const totalVirtualRows = useMemo(() => Math.max(1, Math.ceil(visiblePhotoIds.length / gridColumnCount)), [gridColumnCount, visiblePhotoIds.length]);
    const rowVirtualizer = useVirtualizer({
        count: totalVirtualRows,
        getScrollElement: () => gridRef.current,
        estimateSize: () => gridRowHeight,
        overscan: isFastScrollActive ? VIRTUAL_OVERSCAN_ROWS_FAST : VIRTUAL_OVERSCAN_ROWS_IDLE,
    });
    const virtualRows = rowVirtualizer.getVirtualItems();
    const renderedPhotoIds = useMemo(() => {
        const ids = [];
        for (const row of virtualRows) {
            const rowStart = row.index * gridColumnCount;
            const rowEnd = Math.min(visiblePhotoIds.length, rowStart + gridColumnCount);
            for (let index = rowStart; index < rowEnd; index += 1) {
                const id = visiblePhotoIds[index];
                if (id) {
                    ids.push(id);
                }
            }
        }
        return ids;
    }, [gridColumnCount, virtualRows, visiblePhotoIds]);
    const renderedPhotos = useMemo(() => renderedPhotoIds
        .map((photoId) => assetById.get(photoId))
        .filter((photo) => Boolean(photo)), [assetById, renderedPhotoIds]);
    const topSpacerHeight = virtualRows[0]?.start ?? 0;
    const bottomSpacerHeight = Math.max(0, rowVirtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0));
    useEffect(() => {
        rowVirtualizer.measure();
    }, [gridColumnCount, gridRowHeight, rowVirtualizer, totalVirtualRows]);
    // Search in all photos so preview doesn't close when filters change
    const previewAsset = previewAssetId ? (assetById.get(previewAssetId) ?? null) : null;
    const previewPriorityIds = useMemo(() => {
        const anchorId = previewAssetId ?? focusedPhotoId;
        if (!anchorId) {
            return [];
        }
        const currentIndex = visiblePhotoIndexById.get(anchorId);
        if (currentIndex === undefined) {
            return [anchorId];
        }
        const ids = [];
        const previousId = visiblePhotoIds[currentIndex - 1];
        const currentId = visiblePhotoIds[currentIndex];
        const nextId = visiblePhotoIds[currentIndex + 1];
        if (previousId) {
            ids.push(previousId);
        }
        if (currentId) {
            ids.push(currentId);
        }
        if (nextId) {
            ids.push(nextId);
        }
        return ids;
    }, [focusedPhotoId, previewAssetId, visiblePhotoIds, visiblePhotoIndexById]);
    const gridResetSignature = useMemo(() => [
        sourceFolderPath,
        sortBy,
        pickFilter,
        ratingFilter,
        colorFilter,
        customLabelFilter,
        folderFilter,
        seriesFilter,
        timeClusterFilter,
        deferredSearchQuery,
    ].join("||"), [
        colorFilter,
        customLabelFilter,
        deferredSearchQuery,
        folderFilter,
        pickFilter,
        ratingFilter,
        seriesFilter,
        sortBy,
        sourceFolderPath,
        timeClusterFilter,
    ]);
    const openPreview = useCallback((photoId, startZoomed = false) => {
        setFocusedPhotoId(photoId);
        setPreviewStartsZoomed(startZoomed);
        setPreviewAssetId(photoId);
    }, []);
    const closePreview = useCallback(() => {
        pendingPreviewRestoreIdRef.current = previewAssetId ?? lastPreviewAssetIdRef.current;
        setPreviewAssetId(null);
        setPreviewStartsZoomed(false);
    }, [previewAssetId]);
    const flushFastScrollAccumulatedMs = useCallback((emitUpdate = true) => {
        if (fastScrollStartedAtRef.current !== null) {
            const now = typeof performance !== "undefined" ? performance.now() : Date.now();
            accumulatedFastScrollMsRef.current += Math.max(0, now - fastScrollStartedAtRef.current);
            fastScrollStartedAtRef.current = null;
        }
        if (emitUpdate) {
            onScrollLiteActiveMsChange?.(accumulatedFastScrollMsRef.current);
        }
    }, [onScrollLiteActiveMsChange]);
    const handleGridScroll = useCallback(() => {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        if (fastScrollStartedAtRef.current === null) {
            fastScrollStartedAtRef.current = now;
        }
        setIsFastScrollActive(true);
        if (fastScrollCooldownTimerRef.current !== null) {
            window.clearTimeout(fastScrollCooldownTimerRef.current);
        }
        fastScrollCooldownTimerRef.current = window.setTimeout(() => {
            fastScrollCooldownTimerRef.current = null;
            setIsFastScrollActive(false);
            flushFastScrollAccumulatedMs(true);
        }, FAST_SCROLL_COOLDOWN_MS);
    }, [flushFastScrollAccumulatedMs]);
    useEffect(() => {
        const grid = gridRef.current;
        if (!grid) {
            return;
        }
        const syncGridViewport = () => {
            setGridViewport((current) => {
                const width = grid.clientWidth;
                const height = grid.clientHeight;
                if (current.width === width && current.height === height) {
                    return current;
                }
                return { width, height };
            });
        };
        syncGridViewport();
        const resizeObserver = new ResizeObserver(syncGridViewport);
        resizeObserver.observe(grid);
        window.addEventListener("resize", syncGridViewport);
        return () => {
            resizeObserver.disconnect();
            window.removeEventListener("resize", syncGridViewport);
        };
    }, []);
    useEffect(() => {
        return () => {
            if (fastScrollCooldownTimerRef.current !== null) {
                window.clearTimeout(fastScrollCooldownTimerRef.current);
                fastScrollCooldownTimerRef.current = null;
            }
            flushFastScrollAccumulatedMs(true);
        };
    }, [flushFastScrollAccumulatedMs]);
    useEffect(() => {
        if (!onVisibleIdsChange) {
            return;
        }
        const ids = renderedPhotoIds;
        if (areOrderedIdsEqual(lastVisibleIdsRef.current, ids)) {
            return;
        }
        pendingVisibleIdsRef.current = ids;
        if (visibleIdsDispatchRafRef.current !== null) {
            return;
        }
        visibleIdsDispatchRafRef.current = window.requestAnimationFrame(() => {
            visibleIdsDispatchRafRef.current = null;
            const pendingIds = pendingVisibleIdsRef.current;
            if (!pendingIds || !onVisibleIdsChange) {
                return;
            }
            pendingVisibleIdsRef.current = null;
            if (areOrderedIdsEqual(lastVisibleIdsRef.current, pendingIds)) {
                return;
            }
            lastVisibleIdsRef.current = pendingIds.slice();
            onVisibleIdsChange(new Set(pendingIds));
        });
    }, [onVisibleIdsChange, renderedPhotoIds]);
    useEffect(() => {
        if (!onPriorityIdsChange) {
            return;
        }
        const ids = new Set();
        if (hasActiveFilters) {
            for (const id of visiblePhotoIds.slice(0, 240)) {
                ids.add(id);
            }
        }
        for (const id of previewPriorityIds) {
            ids.add(id);
        }
        onPriorityIdsChange(ids);
    }, [hasActiveFilters, onPriorityIdsChange, previewPriorityIds, visiblePhotoIds]);
    useEffect(() => {
        if (!onPreviewPriorityIdsChange) {
            return;
        }
        onPreviewPriorityIdsChange(new Set(previewPriorityIds));
    }, [onPreviewPriorityIdsChange, previewPriorityIds]);
    useEffect(() => {
        if (!onBackgroundPreviewOrderChange) {
            return;
        }
        const orderedIds = visiblePhotoIds.slice(0, 360);
        const signature = orderedIds.join("|");
        if (signature === lastBackgroundPreviewOrderSignatureRef.current) {
            return;
        }
        lastBackgroundPreviewOrderSignatureRef.current = signature;
        onBackgroundPreviewOrderChange(orderedIds);
    }, [onBackgroundPreviewOrderChange, visiblePhotoIds]);
    const scrollPhotoIntoView = useCallback((photoId, behavior = "smooth") => {
        const grid = gridRef.current;
        const itemIndex = visiblePhotoIndexById.get(photoId);
        if (!grid || itemIndex === undefined) {
            return;
        }
        const rowIndex = Math.floor(itemIndex / gridColumnCount);
        const rowTop = rowIndex * gridRowHeight;
        const rowBottom = rowTop + gridRowHeight;
        const viewportTop = grid.scrollTop;
        const viewportBottom = viewportTop + grid.clientHeight;
        if (rowTop < viewportTop) {
            grid.scrollTo({ top: rowTop, behavior });
        }
        else if (rowBottom > viewportBottom) {
            grid.scrollTo({ top: Math.max(0, rowBottom - grid.clientHeight), behavior });
        }
    }, [gridColumnCount, gridRowHeight, visiblePhotoIndexById]);
    useEffect(() => {
        if (!previewAssetId) {
            return;
        }
        setFocusedPhotoId(previewAssetId);
        scrollPhotoIntoView(previewAssetId, "auto");
    }, [previewAssetId, scrollPhotoIntoView]);
    useEffect(() => {
        if (previewAssetId) {
            lastPreviewAssetIdRef.current = previewAssetId;
            setFocusedPhotoId(previewAssetId);
            return;
        }
        const restoreId = pendingPreviewRestoreIdRef.current;
        if (!restoreId) {
            return;
        }
        pendingPreviewRestoreIdRef.current = null;
        setFocusedPhotoId(restoreId);
        scrollPhotoIntoView(restoreId, "auto");
        let rafA = 0;
        let rafB = 0;
        rafA = window.requestAnimationFrame(() => {
            rafB = window.requestAnimationFrame(() => {
                const grid = gridRef.current;
                const card = grid?.querySelector(`[data-preview-asset-id="${restoreId}"]`);
                card?.focus();
            });
        });
        return () => {
            window.cancelAnimationFrame(rafA);
            window.cancelAnimationFrame(rafB);
        };
    }, [previewAssetId, scrollPhotoIntoView]);
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
        const target = event.target;
        if (target.closest("select, input, textarea"))
            return;
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
            const normalizedKey = event.key.toLowerCase();
            if (normalizedKey === "a") {
                event.preventDefault();
                toggleAll(true);
                return;
            }
        }
        if (!event.ctrlKey && !event.metaKey && !event.altKey) {
            const shortcutLabel = customLabelByShortcut.get(event.key.toUpperCase());
            if (shortcutLabel) {
                const targetIds = selectedIds.length > 0
                    ? selectedIds
                    : focusedPhotoId
                        ? [focusedPhotoId]
                        : [];
                if (targetIds.length > 0) {
                    event.preventDefault();
                    toggleCustomLabelForIds(targetIds, shortcutLabel);
                    return;
                }
            }
        }
        if ((event.key === "z" || event.key === "Z") &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey) {
            const targetPhotoId = focusedPhotoId ?? selectedIds[0] ?? visiblePhotoIds[0] ?? null;
            if (!targetPhotoId) {
                return;
            }
            event.preventDefault();
            openPreview(targetPhotoId, true);
            return;
        }
        // Arrow navigation within grid
        const arrowKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
        if (!arrowKeys.includes(event.key))
            return;
        event.preventDefault();
        if (visiblePhotoIds.length === 0)
            return;
        const currentIndex = focusedPhotoId
            ? (visiblePhotoIndexById.get(focusedPhotoId) ?? -1)
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
            nextIndex = Math.min(visiblePhotoIds.length - 1, currentIndex + 1);
        }
        else if (event.key === "ArrowLeft") {
            nextIndex = Math.max(0, currentIndex - 1);
        }
        else if (event.key === "ArrowDown") {
            nextIndex = Math.min(visiblePhotoIds.length - 1, currentIndex + cols);
        }
        else {
            nextIndex = Math.max(0, currentIndex - cols);
        }
        if (nextIndex !== currentIndex || currentIndex < 0) {
            const nextId = visiblePhotoIds[nextIndex];
            if (!nextId) {
                return;
            }
            setFocusedPhotoId(nextId);
            scrollPhotoIntoView(nextId);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    const el = grid?.querySelector(`[data-preview-asset-id="${nextId}"]`);
                    if (el) {
                        el.focus();
                    }
                });
            });
        }
    }, [
        contextMenuState,
        focusedPhotoId,
        hasActiveFilters,
        onSelectionChange,
        openPreview,
        photos,
        previewAssetId,
        pushTimelineEntry,
        scrollPhotoIntoView,
        selectedIds,
        toggleCustomLabelForIds,
        visiblePhotoIds,
        visiblePhotoIndexById,
        customLabelByShortcut,
    ]);
    useEffect(() => {
        window.addEventListener("keydown", handleWindowKeyDown);
        return () => window.removeEventListener("keydown", handleWindowKeyDown);
    }, [handleWindowKeyDown]);
    useEffect(() => {
        const grid = gridRef.current;
        if (grid) {
            grid.scrollTo({ top: 0 });
        }
        rowVirtualizer.scrollToOffset(0, { align: "start" });
        lastVisibleIdsRef.current = [];
        pendingVisibleIdsRef.current = null;
        if (visibleIdsDispatchRafRef.current !== null) {
            window.cancelAnimationFrame(visibleIdsDispatchRafRef.current);
            visibleIdsDispatchRafRef.current = null;
        }
        onVisibleIdsChange?.(new Set());
        onPriorityIdsChange?.(hasActiveFilters ? new Set(visiblePhotoIds.slice(0, 240)) : new Set());
        onPreviewPriorityIdsChange?.(new Set());
    }, [
        gridResetSignature,
        hasActiveFilters,
        onPriorityIdsChange,
        onPreviewPriorityIdsChange,
        onVisibleIdsChange,
        rowVirtualizer,
        visiblePhotoIds,
    ]);
    function togglePhoto(id, event) {
        const nextSelection = new Set(selectedSet);
        setFocusedPhotoId(id);
        // Shift+click range selection
        if (event?.shiftKey && lastClickedIdRef.current) {
            const lastIdx = visiblePhotoIndexById.get(lastClickedIdRef.current) ?? -1;
            const curIdx = visiblePhotoIndexById.get(id) ?? -1;
            if (lastIdx >= 0 && curIdx >= 0) {
                const [from, to] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
                for (let i = from; i <= to; i++) {
                    const rangeId = visiblePhotoIds[i];
                    if (rangeId) {
                        nextSelection.add(rangeId);
                    }
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
                ? visiblePhotoIds
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
        const changedIds = [];
        const nextPhotos = photos.map((photo) => {
            if (!idSet.has(photo.id)) {
                return photo;
            }
            const nextRating = changes.rating ?? photo.rating;
            const nextPickStatus = changes.pickStatus ?? photo.pickStatus;
            const nextColorLabel = changes.colorLabel !== undefined ? changes.colorLabel : photo.colorLabel;
            const currentCustomLabels = normalizeAssetCustomLabels(photo.customLabels);
            const nextCustomLabels = changes.customLabels !== undefined
                ? normalizeAssetCustomLabels(changes.customLabels)
                : currentCustomLabels;
            if (nextRating === photo.rating &&
                nextPickStatus === photo.pickStatus &&
                nextColorLabel === photo.colorLabel &&
                areStringArraysEqual(currentCustomLabels, nextCustomLabels)) {
                return photo;
            }
            changed = true;
            changedIds.push(photo.id);
            return {
                ...photo,
                ...changes,
                customLabels: nextCustomLabels,
            };
        });
        if (changed) {
            onPhotosChange(nextPhotos);
            pushTimelineEntry(describeMetadataChanges(changes, targetIds.length));
            if (changes.colorLabel !== undefined) {
                triggerBatchPulse(changedIds, "dot");
            }
            if (changes.customLabels !== undefined) {
                triggerBatchPulse(changedIds, "label");
            }
        }
    }, [onPhotosChange, photos, pushTimelineEntry, triggerBatchPulse]);
    const selectedCustomLabelCounts = useMemo(() => {
        const counts = new Map();
        for (const selectedId of selectedIds) {
            const asset = assetById.get(selectedId);
            if (!asset) {
                continue;
            }
            for (const label of normalizeAssetCustomLabels(asset.customLabels)) {
                counts.set(label, (counts.get(label) ?? 0) + 1);
            }
        }
        return counts;
    }, [assetById, selectedIds]);
    const handleToggleBatchCustomLabel = useCallback((label) => {
        const activeCount = selectedCustomLabelCounts.get(label) ?? 0;
        const shouldRemove = selectedIds.length > 0 && activeCount === selectedIds.length;
        updateCustomLabelsForIds(selectedIds, (currentLabels) => shouldRemove
            ? currentLabels.filter((currentLabel) => currentLabel !== label)
            : [...currentLabels, label], shouldRemove
            ? `${selectedIds.length === 1 ? "1 foto" : `${selectedIds.length} foto`}: rimossa etichetta ${label}`
            : `${selectedIds.length === 1 ? "1 foto" : `${selectedIds.length} foto`}: aggiunta etichetta ${label}`);
    }, [selectedCustomLabelCounts, selectedIds, updateCustomLabelsForIds]);
    const handleClearBatchCustomLabels = useCallback(() => {
        updateCustomLabelsForIds(selectedIds, () => [], `${selectedIds.length === 1 ? "1 foto" : `${selectedIds.length} foto`}: etichette personalizzate azzerate`);
    }, [selectedIds, updateCustomLabelsForIds]);
    const selectedAbsolutePaths = useMemo(() => getAssetAbsolutePaths(selectedIds), [selectedIds]);
    const selectedAbsolutePathsSignature = useMemo(() => selectedAbsolutePaths.join("\n"), [selectedAbsolutePaths]);
    useEffect(() => {
        let active = true;
        if (typeof window === "undefined" ||
            typeof window.filexDesktop?.canStartDragOut !== "function") {
            setDesktopDragOutCheck(null);
            return;
        }
        if (selectedAbsolutePaths.length === 0) {
            setDesktopDragOutCheck({
                ok: false,
                requestedCount: selectedIds.length,
                validCount: 0,
                allowedCount: 0,
                reason: "empty-selection",
                message: "Nessun file selezionato per il drag esterno.",
            });
            return;
        }
        void window.filexDesktop.canStartDragOut(selectedAbsolutePaths).then((result) => {
            if (!active) {
                return;
            }
            setDesktopDragOutCheck(result);
        }).catch(() => {
            if (!active) {
                return;
            }
            setDesktopDragOutCheck({
                ok: false,
                requestedCount: selectedIds.length,
                validCount: selectedAbsolutePaths.length,
                allowedCount: 0,
                reason: "invalid-paths",
                message: "Impossibile validare il drag esterno in questa sessione.",
            });
        });
        return () => {
            active = false;
        };
    }, [selectedAbsolutePaths, selectedAbsolutePathsSignature, selectedIds.length]);
    const canStartDesktopDragOut = Boolean(desktopDragOutCheck?.ok
        && typeof window !== "undefined"
        && typeof window.filexDesktop?.startDragOut === "function");
    const desktopDragOutMessage = desktopDragOutCheck?.message
        ?? "Drag esterno disponibile nella versione desktop con cartella aperta in modalita nativa.";
    const applyDesktopDragImage = useCallback((event) => {
        const dataTransfer = event.dataTransfer;
        if (!dataTransfer || typeof document === "undefined") {
            return;
        }
        if (!desktopDragImageRef.current) {
            const canvas = document.createElement("canvas");
            canvas.width = 1;
            canvas.height = 1;
            desktopDragImageRef.current = canvas;
        }
        dataTransfer.setDragImage(desktopDragImageRef.current, 0, 0);
    }, []);
    const handleSelectionDragStart = useCallback((event) => {
        if (!canStartDesktopDragOut) {
            event.preventDefault();
            pushTimelineEntry(desktopDragOutMessage);
            return;
        }
        event.dataTransfer.effectAllowed = "copy";
        applyDesktopDragImage(event);
        event.dataTransfer.setData("text/plain", selectedAbsolutePaths.length === 1
            ? selectedAbsolutePaths[0]
            : `${selectedAbsolutePaths.length} file selezionati`);
        window.filexDesktop.startDragOut(selectedAbsolutePaths);
    }, [applyDesktopDragImage, canStartDesktopDragOut, desktopDragOutMessage, pushTimelineEntry, selectedAbsolutePaths]);
    const handleCardExternalDragStart = useCallback((photoId, event) => {
        const draggingSelection = selectedSet.has(photoId);
        const targetPaths = draggingSelection
            ? getAssetAbsolutePaths(selectedIds)
            : getAssetAbsolutePaths([photoId]);
        if (targetPaths.length === 0
            || typeof window.filexDesktop?.startDragOut !== "function"
            || (draggingSelection && (!desktopDragOutCheck?.ok || targetPaths.length !== selectedIds.length))) {
            event.preventDefault();
            return;
        }
        event.dataTransfer.effectAllowed = "copy";
        applyDesktopDragImage(event);
        event.dataTransfer.setData("text/plain", targetPaths.length === 1 ? targetPaths[0] : `${targetPaths.length} file selezionati`);
        window.filexDesktop.startDragOut(targetPaths);
    }, [applyDesktopDragImage, desktopDragOutCheck?.ok, selectedIds, selectedSet]);
    const clearSelection = useCallback(() => {
        onSelectionChange([]);
        pushTimelineEntry("Selezione svuotata");
    }, [onSelectionChange, pushTimelineEntry]);
    const invertVisibleSelection = useCallback(() => {
        const nextSelection = new Set(selectedIds.filter((id) => !visiblePhotoIdSet.has(id)));
        for (const photoId of visiblePhotoIds) {
            if (!selectedSet.has(photoId)) {
                nextSelection.add(photoId);
            }
        }
        onSelectionChange(Array.from(nextSelection));
        pushTimelineEntry("Selezione visibile invertita");
    }, [onSelectionChange, pushTimelineEntry, selectedIds, selectedSet, visiblePhotoIdSet, visiblePhotoIds]);
    // ── Stable callbacks for PhotoCard (identity doesn't matter due to custom memo) ──
    const handleFocus = useCallback((id) => {
        setFocusedPhotoId(id);
    }, []);
    const handlePreview = useCallback((id) => {
        openPreview(id, false);
    }, [openPreview]);
    const handlePreviewAssetSelection = useCallback((assetId) => {
        lastPreviewAssetIdRef.current = assetId;
        setFocusedPhotoId(assetId);
        setPreviewAssetId(assetId);
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
        const cachedPreviewUrl = getCachedOnDemandPreviewUrl(previewAsset.id, {
            maxDimension: QUICK_PREVIEW_FIT_MAX_DIMENSION,
        });
        if (previewUrlRef.current) {
            previewUrlRef.current = null;
            setAsyncPreviewUrl(null);
        }
        if (cachedPreviewUrl) {
            previewUrlRef.current = {
                id: previewAsset.id,
                url: cachedPreviewUrl,
                sourceFileKey: previewAsset.sourceFileKey,
            };
            setAsyncPreviewUrl(cachedPreviewUrl);
        }
        createOnDemandPreviewAsync(previewAsset.id, 0, {
            maxDimension: QUICK_PREVIEW_FIT_MAX_DIMENSION,
        }).then((url) => {
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
    // Keep preview warmup light here. The modal performs the heavier adjacent warmup.
    useEffect(() => {
        if (!previewAssetId || visiblePhotoIds.length === 0)
            return;
        const currentIndex = visiblePhotoIndexById.get(previewAssetId) ?? -1;
        if (currentIndex < 0)
            return;
        const idsToWarm = [];
        for (let delta = 1; delta <= 1; delta++) {
            const prevId = visiblePhotoIds[currentIndex - delta];
            const nextId = visiblePhotoIds[currentIndex + delta];
            const prev = prevId ? assetById.get(prevId) ?? null : null;
            const next = nextId ? assetById.get(nextId) ?? null : null;
            if (prev && (!prev.previewUrl || !prev.sourceUrl))
                idsToWarm.push(prev.id);
            if (next && (!next.previewUrl || !next.sourceUrl))
                idsToWarm.push(next.id);
        }
        if (idsToWarm.length === 0)
            return;
        void Promise.all(idsToWarm.map((id, index) => warmOnDemandPreviewCache(id, index < 4 ? 1 : 2, {
            maxDimension: QUICK_PREVIEW_FIT_MAX_DIMENSION,
        }).catch(() => null)));
    }, [assetById, previewAssetId, visiblePhotoIds, visiblePhotoIndexById]);
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
    const visiblePreviewAssets = useMemo(() => {
        if (!previewAssetId) {
            return [];
        }
        return visiblePhotoIds
            .map((photoId) => assetById.get(photoId))
            .filter((photo) => Boolean(photo));
    }, [assetById, previewAssetId, visiblePhotoIds]);
    const allSelected = photos.length > 0 && selectedIds.length === photos.length;
    const someSelected = selectedIds.length > 0 && selectedIds.length < photos.length;
    const visibleSelectedCount = useMemo(() => visiblePhotoIds.filter((photoId) => selectedSet.has(photoId)).length, [selectedSet, visiblePhotoIds]);
    const photoStats = useMemo(() => {
        const ratingCounts = new Map();
        const pickCounts = new Map();
        const colorCounts = new Map();
        for (const photo of metadataPhotos) {
            const r = getAssetRating(photo);
            ratingCounts.set(r, (ratingCounts.get(r) ?? 0) + 1);
            const ps = getAssetPickStatus(photo);
            pickCounts.set(ps, (pickCounts.get(ps) ?? 0) + 1);
            const cl = getAssetColorLabel(photo);
            if (cl)
                colorCounts.set(cl, (colorCounts.get(cl) ?? 0) + 1);
        }
        return { ratingCounts, pickCounts, colorCounts };
    }, [metadataPhotos]);
    function selectVisible() {
        onSelectionChange(visiblePhotoIds);
        pushTimelineEntry(`Selezionate ${visiblePhotoIds.length} foto visibili`);
    }
    function addVisibleToSelection() {
        const nextSelection = new Set(selectedIds);
        for (const photoId of visiblePhotoIds) {
            nextSelection.add(photoId);
        }
        onSelectionChange(Array.from(nextSelection));
        pushTimelineEntry(`Aggiunte ${visiblePhotoIds.length} foto visibili alla selezione`);
    }
    function removeVisibleFromSelection() {
        onSelectionChange(selectedIds.filter((id) => !visiblePhotoIdSet.has(id)));
        pushTimelineEntry("Rimosse dalla selezione le foto visibili");
    }
    function activatePickedOnly() {
        onSelectionChange(photos.filter((photo) => photo.pickStatus === "picked").map((photo) => photo.id));
        pushTimelineEntry("Selezionate solo le foto Pick");
    }
    function excludeRejected() {
        onSelectionChange(selectedIds.filter((id) => {
            const photo = assetById.get(id);
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
        if (scrolledInitialRef.current || selectedIds.length === 0 || visiblePhotoIds.length === 0)
            return;
        scrolledInitialRef.current = true;
        const firstId = selectedIds.find((id) => visiblePhotoIdSet.has(id));
        if (!firstId)
            return;
        const timer = setTimeout(() => {
            scrollPhotoIntoView(firstId, "smooth");
        }, 200);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visiblePhotoIds.length]);
    useEffect(() => {
        if (typeof window === "undefined" ||
            typeof window.filexDesktop?.getInstalledEditorCandidates !== "function") {
            return;
        }
        let active = true;
        void window.filexDesktop.getInstalledEditorCandidates().then((candidates) => {
            if (!active || !Array.isArray(candidates)) {
                return;
            }
            setInstalledEditorCandidates(candidates);
            const currentPath = sanitizeEditorExecutablePath(preferredEditorPath);
            if (currentPath && candidates.some((candidate) => sanitizeEditorExecutablePath(candidate.path) === currentPath)) {
                return;
            }
            const shouldAutoReplaceKnownPreset = !currentPath || KNOWN_EDITOR_PRESET_PATHS.includes(currentPath);
            if (shouldAutoReplaceKnownPreset && candidates.length > 0) {
                setPreferredEditorPathPersisted(candidates[0].path);
            }
        }).catch(() => {
            if (active) {
                setInstalledEditorCandidates([]);
            }
        });
        return () => {
            active = false;
        };
    }, [preferredEditorPath, setPreferredEditorPathPersisted]);
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
        const absolutePaths = getAssetAbsolutePaths(ids);
        const paths = absolutePaths.length === ids.length
            ? absolutePaths
            : ids
                .map((id) => getAssetRelativePath(id))
                .filter(Boolean)
                .map((rel) => root ? `${root.replace(/[\\/]+$/, "")}/${rel}` : rel);
        if (paths.length === 0)
            return;
        void navigator.clipboard.writeText(paths.join("\n"));
        pushTimelineEntry(`Percorso copiato negli appunti`);
    }, [pushTimelineEntry]);
    const handleOpenWithEditor = useCallback((ids) => {
        const editor = sanitizeEditorExecutablePath(preferredEditorPath);
        if (!isValidDesktopEditorPath(editor)) {
            alert("Nessun editor associato valido. Imposta il percorso completo dell'editor (es. C:\\Program Files\\Adobe\\...\\Photoshop.exe).");
            return;
        }
        const directAbsolutePaths = getAssetAbsolutePaths(ids);
        const absolutePaths = directAbsolutePaths.length === ids.length
            ? directAbsolutePaths.map((value) => value.replace(/\//g, "\\"))
            : ids
                .map((id) => getAssetRelativePath(id))
                .filter((value) => Boolean(value))
                .map((relative) => {
                const root = effectiveRootFolderPath.trim().replace(/[\\/]+$/, "");
                return `${root}/${relative}`.replace(/\//g, "\\");
            });
        if (absolutePaths.length === 0) {
            alert("Nessun percorso disponibile per le foto selezionate.");
            return;
        }
        if (typeof window !== "undefined" &&
            typeof window.filexDesktop?.sendToEditor === "function") {
            void window.filexDesktop.sendToEditor(editor, absolutePaths).then((result) => {
                if (!result?.ok) {
                    const fallbackMessage = result?.status === "invalid-editor"
                        ? "Editor non trovato o percorso non valido."
                        : result?.status === "partial"
                            ? "Solo una parte della selezione ha percorsi validi per l'editor."
                            : result?.status === "timeout"
                                ? "L'editor non ha risposto in tempo."
                                : "Impossibile aprire l'editor esterno.";
                    alert(result?.error ?? fallbackMessage);
                    void logDesktopEvent({
                        channel: "editor",
                        level: "warn",
                        message: "Invio a editor non riuscito",
                        details: JSON.stringify({
                            requestedCount: result?.requestedCount ?? absolutePaths.length,
                            launchedCount: result?.launchedCount ?? 0,
                            status: result?.status ?? "launch-failed",
                        }),
                    });
                    return;
                }
                pushTimelineEntry(`${absolutePaths.length === 1 ? "1 foto" : `${absolutePaths.length} foto`} aperta/e nell'editor`);
                void logDesktopEvent({
                    channel: "editor",
                    level: "info",
                    message: "Invio a editor completato",
                    details: JSON.stringify({
                        requestedCount: result.requestedCount,
                        launchedCount: result.launchedCount,
                        status: result.status,
                    }),
                });
            });
            return;
        }
        if (!effectiveRootFolderPath.trim()) {
            alert("Imposta prima la Cartella radice in Impostazioni > Editor esterno.");
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
    }, [effectiveRootFolderPath, preferredEditorPath, pushTimelineEntry]);
    // Detect external edits (Photoshop overwrite) and refresh in-app previews automatically.
    useEffect(() => {
        if (!onPhotosChange)
            return;
        let disposed = false;
        let running = false;
        const run = async () => {
            if (running)
                return;
            if (typeof document !== "undefined" && document.hidden)
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
        }, 4000);
        return () => {
            disposed = true;
            window.clearInterval(timer);
        };
    }, [onPhotosChange, previewAssetId, pushTimelineEntry, selectedIds]);
    const editorPathStatus = useMemo(() => {
        const value = sanitizeEditorExecutablePath(preferredEditorPath);
        if (!value) {
            return { kind: "empty", text: "Non configurato" };
        }
        if (isValidDesktopEditorPath(value)) {
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
    const cacheLocationSummary = useMemo(() => formatVolumeSummary(desktopCacheLocationRecommendation), [desktopCacheLocationRecommendation]);
    const canUseRecommendedCacheLocation = useMemo(() => {
        const recommendedPath = desktopCacheLocationRecommendation?.recommendedPath;
        if (!recommendedPath || !desktopThumbnailCacheInfo?.currentPath) {
            return false;
        }
        return recommendedPath.trim().length > 0
            && recommendedPath.trim().toLowerCase() !== desktopThumbnailCacheInfo.currentPath.trim().toLowerCase();
    }, [desktopCacheLocationRecommendation?.recommendedPath, desktopThumbnailCacheInfo?.currentPath]);
    const desktopCacheRecommendationStatus = useMemo(() => {
        if (!desktopCacheLocationRecommendation) {
            return null;
        }
        if (desktopCacheLocationRecommendation.shouldPrompt) {
            return {
                kind: "warn",
                text: "C: è stretto: conviene spostare la cache pesante su un disco più capiente.",
            };
        }
        switch (desktopCacheLocationRecommendation.reason) {
            case "already-custom":
                return {
                    kind: "ok",
                    text: "La cache è già fuori dal disco di sistema.",
                };
            case "dismissed":
                return {
                    kind: "empty",
                    text: "Suggerimento automatico disattivato.",
                };
            case "no-suitable-volume":
                return {
                    kind: "empty",
                    text: "Nessun altro disco capiente trovato per una migrazione consigliata.",
                };
            default:
                return {
                    kind: "ok",
                    text: "Configurazione cache attuale già adatta.",
                };
        }
    }, [desktopCacheLocationRecommendation]);
    const handleBrowsePreferredEditor = useCallback(() => {
        if (typeof window !== "undefined" &&
            typeof window.filexDesktop?.chooseEditorExecutable === "function") {
            void window.filexDesktop.chooseEditorExecutable(preferredEditorPath).then((selectedPath) => {
                if (selectedPath) {
                    setPreferredEditorPathPersisted(selectedPath);
                }
            });
            return;
        }
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
    return (_jsxs("div", { className: "photo-selector", children: [_jsxs("div", { className: "photo-selector__filter-bar", children: [hasActiveFilters && (_jsx("div", { className: "selector-filters__reset", children: _jsxs("button", { type: "button", className: "ghost-button ghost-button--small", onClick: resetFilters, title: `${activeFilterCount} filtro/i attivo/i`, children: ["\u2715 Azzera", activeFilterCount > 0 && (_jsx("span", { className: "photo-selector__filter-count-badge", children: activeFilterCount }))] }) })), subfolders.length > 1 && (_jsxs("label", { className: "field", children: [_jsx("span", { children: "Cartella" }), _jsxs("select", { className: folderFilter !== "all" ? "field__select--active" : undefined, value: folderFilter, onChange: (event) => setFolderFilter(event.target.value), children: [_jsxs("option", { value: "all", children: ["Tutte (", photos.length, ")"] }), subfolders.map(({ folder, count }) => (_jsxs("option", { value: folder, children: [folder === "" ? "Root" : folder, " (", count, ")"] }, folder)))] })] })), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Stato" }), _jsxs("select", { className: pickFilter !== "all" ? "field__select--active" : undefined, value: pickFilter, onChange: (event) => setPickFilter(event.target.value), children: [_jsx("option", { value: "all", children: "Tutti" }), _jsx("option", { value: "picked", children: "Pick" }), _jsx("option", { value: "rejected", children: "Scartate" }), _jsx("option", { value: "unmarked", children: "Neutre" })] })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Stelle" }), _jsxs("select", { className: ratingFilter !== "any" ? "field__select--active" : undefined, value: ratingFilter, onChange: (event) => setRatingFilter(event.target.value), children: [_jsx("option", { value: "any", children: "Tutte" }), _jsxs("optgroup", { label: "Minimo", children: [_jsx("option", { value: "1+", children: "\u2605 1+" }), _jsx("option", { value: "2+", children: "\u2605\u2605 2+" }), _jsx("option", { value: "3+", children: "\u2605\u2605\u2605 3+" }), _jsx("option", { value: "4+", children: "\u2605\u2605\u2605\u2605 4+" })] }), _jsxs("optgroup", { label: "Esattamente", children: [_jsx("option", { value: "0", children: "Senza stelle" }), _jsx("option", { value: "1", children: "\u2605 1" }), _jsx("option", { value: "2", children: "\u2605\u2605 2" }), _jsx("option", { value: "3", children: "\u2605\u2605\u2605 3" }), _jsx("option", { value: "4", children: "\u2605\u2605\u2605\u2605 4" }), _jsx("option", { value: "5", children: "\u2605\u2605\u2605\u2605\u2605 5" })] })] })] }), _jsxs("div", { className: "field photo-selector__color-filter", children: [_jsx("span", { children: "Colore" }), _jsxs("div", { className: "photo-selector__color-filter-dots", children: [_jsx("button", { type: "button", className: `photo-selector__color-all-btn${colorFilter === "all" ? " photo-selector__color-all-btn--active" : ""}`, onClick: () => setColorFilter("all"), title: "Tutti i colori", children: "\u2715" }), COLOR_LABELS.map((value) => (_jsx("button", { type: "button", className: `asset-color-dot asset-color-dot--${value}${colorFilter === value ? " asset-color-dot--selected" : ""}`, onClick: () => setColorFilter(colorFilter === value ? "all" : value), title: customColorNames[value] }, value)))] })] }), customLabelFilterOptions.length > 0 && (_jsxs("label", { className: "field", children: [_jsx("span", { children: "Label custom" }), _jsxs("select", { className: customLabelFilter !== "all" ? "field__select--active" : undefined, value: customLabelFilter, onChange: (event) => setCustomLabelFilter(event.target.value), children: [_jsx("option", { value: "all", children: "Tutte" }), customLabelFilterOptions.map(({ label, count }) => (_jsxs("option", { value: label, children: [label, " (", count, ")"] }, label)))] })] })), seriesGroups.length > 1 && (_jsxs("label", { className: "field", children: [_jsx("span", { children: "Serie" }), _jsxs("select", { className: seriesFilter !== "all" ? "field__select--active" : undefined, value: seriesFilter, onChange: (event) => setSeriesFilter(event.target.value), children: [_jsx("option", { value: "all", children: "Tutte" }), seriesGroups.map(({ key, count }) => (_jsxs("option", { value: key, children: [key, " (", count, ")"] }, key)))] })] })), timeClusters.length > 1 && (_jsxs("label", { className: "field", children: [_jsx("span", { children: "Fascia oraria" }), _jsxs("select", { className: timeClusterFilter !== "all" ? "field__select--active" : undefined, value: timeClusterFilter, onChange: (event) => setTimeClusterFilter(event.target.value), children: [_jsx("option", { value: "all", children: "Tutte" }), timeClusters.map(({ key, count }) => (_jsxs("option", { value: key, children: [key, " (", count, ")"] }, key)))] })] })), filterPresets.length > 0 && (_jsxs("div", { className: "photo-selector__preset-chips", children: [_jsx("span", { className: "photo-selector__filter-bar-label", children: "Preset" }), filterPresets.map((preset) => (_jsx("button", { className: "photo-selector__preset-apply", onClick: () => applyPreset(preset), children: preset.name }, preset.id)))] }))] }), _jsxs("div", { className: "photo-selector__controls", children: [_jsxs("div", { className: "photo-selector__action-inline", children: [_jsxs("div", { className: "photo-selector__undo-group", children: [_jsx("button", { type: "button", className: "icon-button", onClick: handleUndoClick, disabled: !canUndo, title: "Annulla", children: "\u21A9" }), _jsx("button", { type: "button", className: "icon-button", onClick: handleRedoClick, disabled: !canRedo, title: "Ripeti", children: "\u21AA" })] }), _jsx("div", { className: "photo-selector__toolbar-divider" }), _jsx("button", { type: "button", className: `checkbox-button photo-selector__toolbar-control ${allSelected ? "checkbox-button--checked" : someSelected ? "checkbox-button--indeterminate" : ""}`, onClick: () => toggleAll(!allSelected), children: allSelected ? "Deseleziona tutto" : "Seleziona tutto" }), _jsx("div", { className: "photo-selector__toolbar-divider" }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: selectVisible, title: "Seleziona le foto visibili", children: "Visibili" }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: activatePickedOnly, title: "Seleziona solo le foto Pick", children: "Solo pick" }), selectedIds.length >= 2 && selectedIds.length <= 4 && (_jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => setIsCompareOpen(true), title: `Confronta ${selectedIds.length} foto selezionate`, children: "Confronta" }))] }), _jsx("div", { className: "photo-selector__action-inline photo-selector__toolbar-search", children: _jsx(PhotoSearchBar, { value: searchQuery, onChange: setSearchQuery, resultCount: visiblePhotoIds.length, totalCount: photos.length }) }), _jsxs("div", { className: "photo-selector__action-inline", children: [_jsxs("label", { className: "photo-selector__zoom-label", title: "Dimensione card", children: [_jsx("span", { children: "\uD83D\uDD0E" }), _jsx("input", { type: "range", className: "photo-selector__zoom-slider", min: 100, max: 320, step: 10, value: cardSize, onChange: (e) => setCardSize(Number(e.target.value)), "aria-label": "Dimensione card" })] }), _jsx("div", { className: "photo-selector__toolbar-divider" }), _jsxs("select", { className: "photo-selector__sort photo-selector__toolbar-control", value: sortBy, onChange: (event) => setSortBy(event.target.value), children: [_jsx("option", { value: "name", children: "AZ \u2191 Nome" }), _jsx("option", { value: "createdAt", children: "Data creazione \u2193" }), _jsx("option", { value: "orientation", children: "Orientamento" }), _jsx("option", { value: "rating", children: "Valutazione" })] }), _jsx("button", { type: "button", className: `icon-button${isSettingsPanelOpen ? " icon-button--active" : ""}`, onClick: () => setIsSettingsPanelOpen((v) => !v), title: "Impostazioni workspace", children: "\u2699" }), _jsx(PhotoClassificationHelpButton, {})] })] }), photos.length > 0 && (_jsxs("div", { className: "photo-selector__quick-stats", children: [[1, 2, 3, 4, 5].map((r) => {
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
                    })] })), _jsxs("div", { ref: gridRef, className: "photo-selector__grid", style: {
                    "--ps-card-min": `${cardSize}px`,
                    "--ps-card-stage-height": `${cardStageHeight}px`,
                }, role: "listbox", onPointerDown: (e) => {
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
                }, onScroll: handleGridScroll, children: [visiblePhotoIds.length === 0 ? (_jsx("div", { className: "photo-selector__empty", children: _jsx("p", { children: "Nessuna foto trovata." }) })) : (_jsxs(_Fragment, { children: [topSpacerHeight > 0 ? (_jsx("div", { className: "photo-selector__virtual-spacer", style: { height: topSpacerHeight }, "aria-hidden": "true" })) : null, renderedPhotos.map((photo) => (_jsx(PhotoCard, { photo: photo, isSelected: selectedSet.has(photo.id), onToggle: togglePhoto, onUpdatePhoto: handleUpdatePhoto, onFocus: handleFocus, onPreview: handlePreview, onContextMenu: handleContextMenu, onExternalDragStart: handleCardExternalDragStart, customLabelColors: customLabelColors, customLabelShortcuts: customLabelShortcuts, canExternalDrag: typeof window !== "undefined"
                                    && typeof window.filexDesktop?.startDragOut === "function"
                                    && (selectedSet.has(photo.id)
                                        ? canStartDesktopDragOut
                                        : Boolean(getAssetAbsolutePath(photo.id))), disableNonEssentialUi: isFastScrollActive, batchPulseToken: batchPulseState?.ids.has(photo.id) ? batchPulseState.token : 0, batchPulseKind: batchPulseState?.ids.has(photo.id) ? batchPulseState.kind : null, editable: !!onPhotosChange }, photo.id))), bottomSpacerHeight > 0 ? (_jsx("div", { className: "photo-selector__virtual-spacer", style: { height: bottomSpacerHeight }, "aria-hidden": "true" })) : null] })), dragRect && (_jsx("div", { className: "photo-selector__drag-rect", style: {
                            position: "fixed",
                            left: dragRect.left,
                            top: dragRect.top,
                            width: dragRect.width,
                            height: dragRect.height,
                        } }))] }), _jsxs("footer", { className: "photo-selector__bottom-bar", children: [_jsxs("div", { className: "photo-selector__stats", children: [_jsxs("span", { className: "photo-selector__count", children: [photos.length, " elementi \u2014 ", selectedIds.length, " selezionati", hasActiveFilters ? ` (${visiblePhotoIds.length} filtrati)` : ""] }), selectionStats && (_jsxs("div", { className: "photo-selector__stat-chips", children: [selectionStats.picked > 0 && (_jsxs("span", { className: "photo-selector__stat-chip photo-selector__stat-chip--pick", children: ["Pick ", selectionStats.picked] })), selectionStats.rejected > 0 && (_jsxs("span", { className: "photo-selector__stat-chip photo-selector__stat-chip--reject", children: ["Scart. ", selectionStats.rejected] })), selectionStats.highRating > 0 && (_jsxs("span", { className: "photo-selector__stat-chip photo-selector__stat-chip--star", children: ["\u26053+ ", selectionStats.highRating] }))] }))] }), timelineEntries.length > 0 && (canUndo ? (_jsxs("button", { type: "button", className: "photo-selector__timeline-status photo-selector__timeline-undo-btn", onClick: handleUndoClick, title: "Clicca per annullare", children: ["\u21A9 ", timelineEntries[0].label] })) : (_jsx("div", { className: "photo-selector__timeline-status", children: timelineEntries[0].label }))), _jsxs("div", { className: "photo-selector__footer-actions", children: [selectedIds.length > 0 && (_jsxs("button", { type: "button", className: `ghost-button ghost-button--small${canStartDesktopDragOut ? " photo-selector__dragout-button" : ""}`, draggable: canStartDesktopDragOut, onDragStart: handleSelectionDragStart, title: canStartDesktopDragOut
                                    ? "Trascina la selezione direttamente dentro Auto Layout, Photoshop o un'altra app desktop."
                                    : "Drag esterno disponibile nella versione desktop con cartella aperta in modalità nativa.", disabled: !canStartDesktopDragOut, children: ["Trascina fuori (", selectedIds.length, ")"] })), selectedIds.length > 0 && (_jsx("button", { className: "ghost-button ghost-button--small", onClick: () => setIsBatchToolsOpen(!isBatchToolsOpen), children: isBatchToolsOpen ? "Chiudi Batch" : "Apri Batch" }))] })] }), isBatchToolsOpen && selectedIds.length > 0 && (_jsx("section", { className: "photo-selector__selection-bar photo-selector__batch-panel", children: _jsxs("div", { className: "photo-selector__selection-tools", children: [_jsxs("div", { className: "photo-selector__selection-group", "aria-label": "Valutazione", children: [_jsx("span", { className: "photo-selector__selection-label", children: "Stelle" }), _jsxs("div", { className: "photo-selector__selection-stars", children: [[1, 2, 3, 4, 5].map((value) => (_jsx("button", { type: "button", className: "photo-selector__batch-star", onClick: () => applyBatchChanges(selectedIds, { rating: value }), children: Array.from({ length: value }, () => "★").join("") }, value))), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => applyBatchChanges(selectedIds, { rating: 0 }), children: "Azzera" })] })] }), _jsxs("div", { className: "photo-selector__selection-group", "aria-label": "Stato", children: [_jsx("span", { className: "photo-selector__selection-label", children: "Stato" }), _jsxs("div", { className: "photo-selector__selection-pills", children: [["picked", "rejected", "unmarked"].map((value) => (_jsx("button", { type: "button", className: "photo-selector__batch-pill", onClick: () => applyBatchChanges(selectedIds, { pickStatus: value }), children: value === "picked" ? "Pick" : value === "rejected" ? "Scartata" : "Neutra" }, value))), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: excludeRejected, title: "Rimuovi dalla selezione le foto scartate", children: "\u2212 Escludi scartate" })] })] }), _jsxs("div", { className: "photo-selector__selection-group", "aria-label": "Etichette colore", children: [_jsx("span", { className: "photo-selector__selection-label", children: "Etichette" }), _jsxs("div", { className: "photo-selector__selection-colors", children: [_jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => applyBatchChanges(selectedIds, { colorLabel: null }), children: "Nessuna" }), COLOR_LABELS.map((value) => (_jsx("button", { type: "button", className: `asset-color-dot asset-color-dot--${value}`, onClick: () => applyBatchChanges(selectedIds, { colorLabel: value }) }, value)))] })] }), _jsxs("div", { className: "photo-selector__selection-group", "aria-label": "Etichette personalizzate", children: [_jsx("span", { className: "photo-selector__selection-label", children: "Label custom" }), _jsxs("div", { className: "photo-selector__selection-pills photo-selector__selection-pills--wrap", children: [_jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: handleClearBatchCustomLabels, children: "Azzera" }), customLabelsCatalog.map((label) => {
                                            const activeCount = selectedCustomLabelCounts.get(label) ?? 0;
                                            const isActive = selectedIds.length > 0 && activeCount === selectedIds.length;
                                            const isPartial = activeCount > 0 && activeCount < selectedIds.length;
                                            const tone = resolveCustomLabelTone(label);
                                            return (_jsx("button", { type: "button", className: [
                                                    "photo-selector__batch-pill",
                                                    "photo-selector__batch-pill--label",
                                                    `photo-selector__batch-pill--${tone}`,
                                                    isActive ? "photo-selector__batch-pill--active" : "",
                                                    isPartial ? "photo-selector__batch-pill--partial" : "",
                                                ].filter(Boolean).join(" "), onClick: () => handleToggleBatchCustomLabel(label), title: isActive ? `Rimuovi ${label} dalla selezione` : `Assegna ${label} alla selezione`, children: label }, label));
                                        })] }), _jsxs("div", { className: "photo-selector__label-create-row", children: [_jsx("input", { type: "text", className: "photo-selector__settings-color-input", value: newBatchCustomLabelName, onChange: (event) => setNewBatchCustomLabelName(event.target.value), onKeyDown: (event) => {
                                                if (event.key === "Enter") {
                                                    event.preventDefault();
                                                    handleAddCustomLabelToCatalog(newBatchCustomLabelName, {
                                                        assignToSelection: true,
                                                        tone: newBatchCustomLabelTone,
                                                        shortcut: newBatchCustomLabelShortcut,
                                                    });
                                                    setNewBatchCustomLabelName("");
                                                    setNewBatchCustomLabelTone(DEFAULT_CUSTOM_LABEL_TONE);
                                                    setNewBatchCustomLabelShortcut(null);
                                                }
                                            }, placeholder: "Nuova etichetta, es. Album sposi" }), _jsx("select", { className: "photo-selector__settings-color-input", value: newBatchCustomLabelTone, onChange: (event) => setNewBatchCustomLabelTone(event.target.value), title: "Colore etichetta", children: CUSTOM_LABEL_TONES.map((tone) => (_jsx("option", { value: tone, children: `Colore ${tone}` }, tone))) }), _jsxs("select", { className: "photo-selector__settings-color-input", value: newBatchCustomLabelShortcut ?? "", onChange: (event) => setNewBatchCustomLabelShortcut(normalizeCustomLabelShortcut(event.target.value)), title: "Tasto rapido", children: [_jsx("option", { value: "", children: "Nessun tasto" }), CUSTOM_LABEL_SHORTCUT_OPTIONS.map((shortcut) => (_jsx("option", { value: shortcut, children: `Tasto ${shortcut}` }, shortcut)))] }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => {
                                                handleAddCustomLabelToCatalog(newBatchCustomLabelName, {
                                                    assignToSelection: true,
                                                    tone: newBatchCustomLabelTone,
                                                    shortcut: newBatchCustomLabelShortcut,
                                                });
                                                setNewBatchCustomLabelName("");
                                                setNewBatchCustomLabelTone(DEFAULT_CUSTOM_LABEL_TONE);
                                                setNewBatchCustomLabelShortcut(null);
                                            }, disabled: !newBatchCustomLabelName.trim(), children: "Aggiungi e assegna" })] })] })] }) })), _jsx(PhotoQuickPreviewModal, { asset: previewAssetWithUrl, assets: visiblePreviewAssets, thumbnailProfile: selectedThumbnailProfile, startZoomed: previewStartsZoomed, customLabelsCatalog: customLabelsCatalog, customLabelColors: customLabelColors, customLabelShortcuts: customLabelShortcuts, onClose: closePreview, onSelectAsset: handlePreviewAssetSelection, onUpdateAsset: (assetId, changes) => updatePhoto(assetId, changes) }), isSettingsPanelOpen && (_jsxs("aside", { className: "photo-selector__settings-flyout", "aria-label": "Impostazioni workspace", children: [_jsxs("div", { className: "photo-selector__settings-header", children: [_jsx("span", { children: "Impostazioni" }), _jsx("button", { type: "button", className: "icon-button", onClick: () => setIsSettingsPanelOpen(false), title: "Chiudi", children: "\u2715" })] }), _jsxs("div", { className: "photo-selector__settings-section", children: [_jsx("h4", { className: "photo-selector__settings-section-title", children: "Nomi etichette colore" }), COLOR_LABELS.map((label) => (_jsxs("label", { className: "photo-selector__settings-color-row", children: [_jsx("span", { className: `asset-color-dot asset-color-dot--${label}` }), _jsx("input", { type: "text", className: "photo-selector__settings-color-input", value: customColorNames[label], onChange: (e) => handleColorNameChange(label, e.target.value), placeholder: COLOR_LABEL_NAMES[label] })] }, label)))] }), _jsxs("div", { className: "photo-selector__settings-section", children: [_jsx("h4", { className: "photo-selector__settings-section-title", children: "Etichette personalizzate" }), _jsx("p", { className: "photo-selector__settings-empty", children: "Crea etichette tipo \"Album sposi\", \"Trailer\", \"Dettagli sala\". Ora puoi scegliere subito colore e tasto rapido, assegnarle alla selezione e ritrovarle sia in UI sia nei sidecar XMP." }), _jsx("div", { className: "photo-selector__label-grid", children: customLabelsCatalog.map((label) => (_jsxs("div", { className: "photo-selector__label-editor", children: [_jsx("span", { className: `photo-selector__label-chip photo-selector__label-chip--${resolveCustomLabelTone(label)}`, children: "Tag" }), _jsx("input", { type: "text", defaultValue: label, onBlur: (event) => {
                                                const nextValue = normalizeCustomLabelName(event.target.value);
                                                if (!nextValue) {
                                                    event.currentTarget.value = label;
                                                    return;
                                                }
                                                handleRenameCustomLabel(label, nextValue);
                                                event.currentTarget.value = nextValue;
                                            }, onKeyDown: (event) => {
                                                if (event.key === "Enter") {
                                                    event.preventDefault();
                                                    event.currentTarget.blur();
                                                }
                                            } }), _jsx("div", { className: "photo-selector__label-tone-picker", "aria-label": `Colore ${label}`, children: CUSTOM_LABEL_TONES.map((tone) => (_jsx("button", { type: "button", className: resolveCustomLabelTone(label) === tone
                                                    ? `photo-selector__label-tone photo-selector__label-tone--${tone} photo-selector__label-tone--active`
                                                    : `photo-selector__label-tone photo-selector__label-tone--${tone}`, onClick: () => handleCustomLabelToneChange(label, tone), title: `Usa colore ${tone} per ${label}` }, `${label}-${tone}`))) }), _jsxs("select", { className: "photo-selector__settings-color-input", value: resolveCustomLabelShortcut(label) ?? "", onChange: (event) => handleCustomLabelShortcutChange(label, normalizeCustomLabelShortcut(event.target.value)), title: `Scorciatoia ${label}`, children: [_jsx("option", { value: "", children: "Nessun tasto" }), CUSTOM_LABEL_SHORTCUT_OPTIONS.map((shortcut) => (_jsx("option", { value: shortcut, children: `Tasto ${shortcut}` }, `${label}-${shortcut}`)))] }), selectedIds.length > 0 ? (_jsx("button", { type: "button", className: "ghost-button ghost-button--small", title: `Assegna ${label} alle foto selezionate${resolveCustomLabelShortcut(label) ? ` · ${resolveCustomLabelShortcut(label)}` : ""}`, onClick: () => assignCustomLabelToSelection(label), children: resolveCustomLabelShortcut(label) ? `Assegna · ${resolveCustomLabelShortcut(label)}` : "Assegna" })) : null, _jsx("button", { type: "button", className: "icon-button icon-button--danger", title: `Rimuovi ${label}`, onClick: () => handleRemoveCustomLabel(label), children: "\u2715" })] }, label))) }), _jsxs("div", { className: "photo-selector__settings-preset-row", children: [_jsx("input", { type: "text", className: "photo-selector__settings-color-input", value: newCustomLabelName, onChange: (event) => setNewCustomLabelName(event.target.value), onKeyDown: (event) => {
                                            if (event.key === "Enter") {
                                                event.preventDefault();
                                                handleAddCustomLabelToCatalog(newCustomLabelName, {
                                                    tone: newCustomLabelTone,
                                                    shortcut: newCustomLabelShortcut,
                                                });
                                                setNewCustomLabelName("");
                                                setNewCustomLabelTone(DEFAULT_CUSTOM_LABEL_TONE);
                                                setNewCustomLabelShortcut(null);
                                            }
                                        }, placeholder: "Nuova etichetta workflow" }), _jsx("select", { className: "photo-selector__settings-color-input", value: newCustomLabelTone, onChange: (event) => setNewCustomLabelTone(event.target.value), title: "Colore etichetta", children: CUSTOM_LABEL_TONES.map((tone) => (_jsx("option", { value: tone, children: `Colore ${tone}` }, `new-${tone}`))) }), _jsxs("select", { className: "photo-selector__settings-color-input", value: newCustomLabelShortcut ?? "", onChange: (event) => setNewCustomLabelShortcut(normalizeCustomLabelShortcut(event.target.value)), title: "Tasto rapido", children: [_jsx("option", { value: "", children: "Nessun tasto" }), CUSTOM_LABEL_SHORTCUT_OPTIONS.map((shortcut) => (_jsx("option", { value: shortcut, children: `Tasto ${shortcut}` }, `new-shortcut-${shortcut}`)))] }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => {
                                            handleAddCustomLabelToCatalog(newCustomLabelName, {
                                                tone: newCustomLabelTone,
                                                shortcut: newCustomLabelShortcut,
                                            });
                                            setNewCustomLabelName("");
                                            setNewCustomLabelTone(DEFAULT_CUSTOM_LABEL_TONE);
                                            setNewCustomLabelShortcut(null);
                                        }, disabled: !newCustomLabelName.trim(), children: "Aggiungi" }), selectedIds.length > 0 ? (_jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => {
                                            handleAddCustomLabelToCatalog(newCustomLabelName, {
                                                assignToSelection: true,
                                                tone: newCustomLabelTone,
                                                shortcut: newCustomLabelShortcut,
                                            });
                                            setNewCustomLabelName("");
                                            setNewCustomLabelTone(DEFAULT_CUSTOM_LABEL_TONE);
                                            setNewCustomLabelShortcut(null);
                                        }, disabled: !newCustomLabelName.trim(), children: "Aggiungi e assegna" })) : null] })] }), _jsxs("div", { className: "photo-selector__settings-section", children: [_jsxs("h4", { className: "photo-selector__settings-section-title", children: ["Editor esterno", _jsx("button", { type: "button", className: "photo-selector__settings-info-btn", title: "Imposta il percorso assoluto della cartella radice sul tuo PC (es. C:\\Foto\\Matrimonio). Questo permette di copiare il percorso completo di un file per aprirlo in Photoshop o qualsiasi altro editor esterno.", children: "?" })] }), _jsxs("label", { className: "photo-selector__settings-color-row", children: [_jsx("span", { style: { fontSize: "0.7rem", color: "var(--text-muted)", minWidth: 90 }, children: "Cartella radice" }), _jsx("input", { type: "text", className: "photo-selector__settings-color-input", value: effectiveRootFolderPath, onChange: (e) => {
                                            setRootFolderPathOverridePersisted(e.target.value);
                                        }, placeholder: sourceFolderPath || "C:\\Utenti\\Foto\\Matrimonio", spellCheck: false })] }), _jsx("div", { className: "photo-selector__settings-preset-row", children: _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => setRootFolderPathOverridePersisted(""), disabled: !rootFolderPathOverride.trim(), title: "Torna a usare automaticamente la cartella aperta", children: "Usa cartella aperta" }) }), _jsxs("label", { className: "photo-selector__settings-color-row", children: [_jsx("span", { style: { fontSize: "0.7rem", color: "var(--text-muted)", minWidth: 90 }, children: "Editor" }), _jsx("div", { className: "photo-selector__settings-input-with-button", children: _jsx("input", { type: "text", className: "photo-selector__settings-color-input", value: preferredEditorPath, onChange: (e) => setPreferredEditorPathPersisted(e.target.value), placeholder: installedEditorCandidates[0]?.path ?? "C:\\Program Files\\Adobe\\Adobe Photoshop 2026\\Photoshop.exe", spellCheck: false }) })] }), _jsx("div", { className: "photo-selector__settings-browse-row", children: _jsx("button", { type: "button", className: "photo-selector__settings-browse-prominent", onClick: () => void handleBrowsePreferredEditor(), title: "Seleziona l'eseguibile dell'editor (Photoshop.exe, ecc.)", children: "\uD83D\uDCC2 Sfoglia editor..." }) }), _jsx("div", { className: "photo-selector__settings-preset-row photo-selector__settings-editor-presets", children: (installedEditorCandidates.length > 0 ? installedEditorCandidates : KNOWN_EDITOR_PRESET_PATHS.map((path) => ({
                                    path,
                                    label: path.match(/Adobe Photoshop \d{4}/i)?.[0]?.replace(/^Adobe\s+/i, "") ?? "Photoshop",
                                }))).map((candidate) => (_jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => setPreferredEditorPathPersisted(candidate.path), title: `Imposta percorso ${candidate.label}`, children: candidate.label }, candidate.path))) }), _jsx("p", { className: `photo-selector__settings-path-status photo-selector__settings-path-status--${editorPathStatus.kind}`, children: editorPathStatus.text }), installedEditorCandidates.length > 0 ? (_jsxs("p", { className: "photo-selector__settings-empty", style: { marginTop: "0.3rem" }, children: ["Editor rilevato: ", installedEditorCandidates[0].path] })) : null, _jsx("p", { className: "photo-selector__settings-empty", style: { marginTop: "0.3rem" }, children: rootFolderPathOverride.trim()
                                    ? `Override manuale attivo. Cartella aperta: ${sourceFolderPath || "n/d"}`
                                    : sourceFolderPath
                                        ? `Auto dalla cartella aperta: ${sourceFolderPath}`
                                        : "Si auto-compila quando apri una cartella in modalità desktop." }), _jsx("p", { className: "photo-selector__settings-empty", style: { marginTop: "0.3rem" }, children: "Usato per \"Apri con editor\" e \"Copia percorso\" nel menu contestuale." })] }), _jsxs("div", { className: "photo-selector__settings-section", children: [_jsxs("h4", { className: "photo-selector__settings-section-title", children: ["Prestazioni", _jsx("button", { type: "button", className: "photo-selector__settings-info-btn", title: "Ultra Fast privilegia al massimo la reattivita' e alleggerisce anche la quick preview. Fast contact sheet mantiene un po' piu' dettaglio. Bilanciato punta di piu' alla pulizia visiva. Il profilo si applica subito ai task attivi e alla quick preview; riaprire la cartella rigenera tutta la cache con il nuovo profilo.", children: "?" })] }), _jsxs("label", { className: "photo-selector__settings-color-row", children: [_jsx("span", { style: { fontSize: "0.7rem", color: "var(--text-muted)", minWidth: 90 }, children: "Anteprime" }), _jsxs("select", { className: "photo-selector__settings-color-input", value: selectedThumbnailProfile, onChange: (event) => handleThumbnailProfileChange(event.target.value === "balanced"
                                            ? "balanced"
                                            : event.target.value === "fast"
                                                ? "fast"
                                                : "ultra-fast"), children: [_jsx("option", { value: "ultra-fast", children: "Ultra Fast" }), _jsx("option", { value: "balanced", children: "Bilanciato" }), _jsx("option", { value: "fast", children: "Fast contact sheet" })] })] }), _jsxs("label", { className: "photo-selector__settings-color-row", style: { alignItems: "center" }, children: [_jsx("span", { style: { fontSize: "0.7rem", color: "var(--text-muted)", minWidth: 90 }, children: "Sort cache" }), _jsx("input", { type: "checkbox", checked: isSortCacheEnabled, onChange: (event) => handleSortCacheEnabledChange(event.target.checked) })] }), _jsxs("p", { className: "photo-selector__settings-empty", style: { marginTop: "0.3rem" }, children: ["Profilo attivo: ", selectedThumbnailProfile === "ultra-fast"
                                        ? "Ultra Fast"
                                        : selectedThumbnailProfile === "fast"
                                            ? "Fast contact sheet"
                                            : "Bilanciato", ".", selectedThumbnailProfile !== thumbnailProfile ? " Aggiorno subito task attivi e quick preview; riaprire la cartella rigenera tutta la cache col nuovo profilo." : ""] }), performanceSnapshot ? (_jsxs(_Fragment, { children: [_jsxs("p", { className: "photo-selector__settings-empty", style: { marginTop: "0.3rem" }, children: ["Primo thumbnail: ", formatMilliseconds(performanceSnapshot.folderOpenToFirstThumbnailMs), " | Griglia completa: ", formatMilliseconds(performanceSnapshot.folderOpenToGridCompleteMs)] }), _jsxs("p", { className: "photo-selector__settings-empty", style: { marginTop: "0.3rem" }, children: ["Cache colpite: ", performanceSnapshot.cachedThumbnailCount, "/", performanceSnapshot.totalThumbnailCount, " | Letture disco: ", formatBytes(performanceSnapshot.bytesRead)] }), _jsxs("p", { className: "photo-selector__settings-empty", style: { marginTop: "0.3rem" }, children: ["RAW: ", formatBytes(performanceSnapshot.rawBytesRead), " | Standard: ", formatBytes(performanceSnapshot.standardBytesRead)] })] })) : null] }), desktopThumbnailCacheInfo ? (_jsxs("div", { className: "photo-selector__settings-section", children: [_jsxs("h4", { className: "photo-selector__settings-section-title", children: ["Cache thumbnail desktop", _jsx("button", { type: "button", className: "photo-selector__settings-info-btn", title: "Spostiamo solo le cache pesanti gestite da Selezione Foto. AppData, Temp e cache Chromium di sistema restano nei percorsi di Windows.", children: "?" })] }), _jsx("p", { className: "photo-selector__settings-empty", style: { marginTop: "0.1rem" }, children: "Spostiamo le cache pesanti gestite da Selezione Foto, non i percorsi di sistema di Windows." }), _jsxs("label", { className: "photo-selector__settings-color-row", children: [_jsx("span", { style: { fontSize: "0.7rem", color: "var(--text-muted)", minWidth: 90 }, children: "Percorso" }), _jsx("div", { className: "photo-selector__settings-input-with-button", children: _jsx("input", { type: "text", className: "photo-selector__settings-color-input", value: desktopThumbnailCachePathInput, onChange: (e) => setDesktopThumbnailCachePathInput(e.target.value), placeholder: desktopThumbnailCacheInfo.defaultPath, spellCheck: false, disabled: isDesktopThumbnailCacheBusy }) })] }), _jsxs("div", { className: "photo-selector__settings-preset-row", children: [_jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: handleApplyDesktopThumbnailCachePath, disabled: isDesktopThumbnailCacheBusy || !desktopThumbnailCachePathInput.trim(), children: "Applica" }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => void onChooseDesktopThumbnailCacheDirectory?.(), disabled: isDesktopThumbnailCacheBusy || !onChooseDesktopThumbnailCacheDirectory, children: "Sfoglia..." }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => void onResetDesktopThumbnailCacheDirectory?.(), disabled: isDesktopThumbnailCacheBusy || !onResetDesktopThumbnailCacheDirectory, children: "Default" }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => void onUseRecommendedDesktopThumbnailCacheDirectory?.(), disabled: isDesktopThumbnailCacheBusy
                                            || !onUseRecommendedDesktopThumbnailCacheDirectory
                                            || !canUseRecommendedCacheLocation, children: "Usa percorso consigliato" }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => void onClearDesktopThumbnailCache?.(), disabled: isDesktopThumbnailCacheBusy || !onClearDesktopThumbnailCache, children: "Svuota cache" })] }), desktopThumbnailCacheStatus ? (_jsx("p", { className: `photo-selector__settings-path-status photo-selector__settings-path-status--${desktopThumbnailCacheStatus.kind}`, children: desktopThumbnailCacheStatus.text })) : null, desktopCacheRecommendationStatus ? (_jsx("p", { className: `photo-selector__settings-path-status photo-selector__settings-path-status--${desktopCacheRecommendationStatus.kind}`, children: desktopCacheRecommendationStatus.text })) : null, _jsxs("p", { className: "photo-selector__settings-empty", style: { marginTop: "0.3rem" }, children: [desktopThumbnailCacheInfo.entryCount, " anteprime, ", formatBytes(desktopThumbnailCacheInfo.totalBytes), " su disco."] }), typeof desktopThumbnailCacheInfo.rawRenderCacheHit === "number" ? (_jsxs("p", { className: "photo-selector__settings-empty", style: { marginTop: "0.3rem" }, children: ["RAW render cache hit (sessione): ", desktopThumbnailCacheInfo.rawRenderCacheHit] })) : null, (desktopThumbnailCacheInfo.effectiveThumbnailRamMaxBytes
                                || desktopThumbnailCacheInfo.effectiveRenderedPreviewMaxBytes
                                || desktopThumbnailCacheInfo.effectivePreviewSourceMaxBytes) ? (_jsxs("p", { className: "photo-selector__settings-empty", style: { marginTop: "0.3rem" }, children: ["Limiti auto cache RAM:", desktopThumbnailCacheInfo.effectiveThumbnailRamMaxBytes
                                        ? ` Thumb ${desktopThumbnailCacheInfo.effectiveThumbnailRamMaxEntries ?? "?"} / ${formatBytes(desktopThumbnailCacheInfo.effectiveThumbnailRamMaxBytes)}`
                                        : "", desktopThumbnailCacheInfo.effectiveRenderedPreviewMaxBytes
                                        ? ` · Render ${desktopThumbnailCacheInfo.effectiveRenderedPreviewMaxEntries ?? "?"} / ${formatBytes(desktopThumbnailCacheInfo.effectiveRenderedPreviewMaxBytes)}`
                                        : "", desktopThumbnailCacheInfo.effectivePreviewSourceMaxBytes
                                        ? ` · Source ${desktopThumbnailCacheInfo.effectivePreviewSourceMaxEntries ?? "?"} / ${formatBytes(desktopThumbnailCacheInfo.effectivePreviewSourceMaxBytes)}`
                                        : ""] })) : null, _jsxs("p", { className: "photo-selector__settings-empty", style: { marginTop: "0.3rem" }, children: ["Percorso predefinito: ", desktopThumbnailCacheInfo.defaultPath] }), _jsxs("p", { className: "photo-selector__settings-empty", style: { marginTop: "0.3rem" }, children: ["Drive attuale: ", cacheLocationSummary.current] }), cacheLocationSummary.recommended ? (_jsxs("p", { className: "photo-selector__settings-empty", style: { marginTop: "0.3rem" }, children: ["Percorso consigliato: ", cacheLocationSummary.recommended] })) : null] })) : null, _jsxs("div", { className: "photo-selector__settings-section", children: [_jsxs("h4", { className: "photo-selector__settings-section-title", children: ["Preset filtri", _jsx("button", { type: "button", className: "photo-selector__settings-info-btn", title: "Un preset salva la combinazione attuale di filtri (stelle, stato, colore, cartella...) con un nome. Utile per richiamare in un click un insieme di filtri che usi spesso \u2014 es. 'Migliori Pick' = Pick + 4 stelle + verde.", children: "?" })] }), _jsxs("div", { className: "photo-selector__settings-preset-row", children: [_jsx("input", { type: "text", className: "photo-selector__settings-color-input", value: newPresetName, onChange: (e) => setNewPresetName(e.target.value), placeholder: "Nome preset\u2026", onKeyDown: (e) => e.key === "Enter" && handleSavePreset() }), _jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: handleSavePreset, disabled: !newPresetName.trim(), children: "Salva" })] }), filterPresets.length === 0 && (_jsx("p", { className: "photo-selector__settings-empty", children: "Nessun preset salvato." })), filterPresets.map((preset) => (_jsxs("div", { className: "photo-selector__settings-preset-item", children: [_jsx("button", { type: "button", className: "ghost-button ghost-button--small photo-selector__settings-preset-name", onClick: () => applyPreset(preset), children: preset.name }), _jsx("button", { type: "button", className: "icon-button icon-button--danger", onClick: () => removePreset(preset.id), title: "Elimina preset", children: "\u2715" })] }, preset.id)))] })] })), isDesktopCacheRecommendationModalOpen && desktopCacheLocationRecommendation?.recommendedPath ? (_jsx("div", { className: "modal-backdrop", role: "presentation", children: _jsxs("section", { className: "modal-panel photo-selector__cache-recommendation-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "cache-recommendation-title", children: [_jsx("div", { className: "modal-panel__header", children: _jsxs("div", { children: [_jsx("strong", { id: "cache-recommendation-title", children: "Spazio disco e cache" }), _jsx("p", { children: "C: ha poco spazio libero. Possiamo spostare le cache pesanti gestite da Selezione Foto su un disco pi\u00F9 capiente." })] }) }), _jsxs("div", { className: "modal-panel__body", children: [_jsxs("div", { className: "photo-selector__cache-recommendation-grid", children: [_jsxs("div", { className: "photo-selector__cache-recommendation-card", children: [_jsx("span", { className: "photo-selector__cache-recommendation-label", children: "Percorso attuale" }), _jsx("strong", { children: desktopCacheLocationRecommendation.currentPath }), _jsx("p", { children: cacheLocationSummary.current })] }), _jsxs("div", { className: "photo-selector__cache-recommendation-card", children: [_jsx("span", { className: "photo-selector__cache-recommendation-label", children: "Percorso consigliato" }), _jsx("strong", { children: desktopCacheLocationRecommendation.recommendedPath }), _jsx("p", { children: cacheLocationSummary.recommended ?? "Disco consigliato non disponibile" })] })] }), _jsx("p", { className: "photo-selector__settings-empty", children: "Copiamo thumbnail e quick preview gi\u00E0 create, poi passiamo al nuovo percorso e liberiamo quello vecchio se tutto va bene." })] }), _jsxs("div", { className: "modal-panel__footer", children: [_jsx("button", { type: "button", className: "ghost-button", onClick: () => void onSnoozeDesktopCacheRecommendation?.(), disabled: isDesktopThumbnailCacheBusy || !onSnoozeDesktopCacheRecommendation, children: "Pi\u00F9 tardi" }), _jsxs("div", { className: "photo-selector__cache-recommendation-actions", children: [_jsx("button", { type: "button", className: "ghost-button", onClick: () => void onDismissDesktopCacheRecommendation?.(), disabled: isDesktopThumbnailCacheBusy || !onDismissDesktopCacheRecommendation, children: "Non mostrare pi\u00F9" }), _jsx("button", { type: "button", className: "secondary-button", onClick: () => void onUseRecommendedDesktopThumbnailCacheDirectory?.(), disabled: isDesktopThumbnailCacheBusy || !onUseRecommendedDesktopThumbnailCacheDirectory, children: "Sposta ora" })] })] })] }) })) : null, contextMenuState && (_jsx("div", { className: "photo-selector__context-backdrop", onClick: () => setContextMenuState(null), onContextMenu: (e) => e.preventDefault() })), contextMenuState ? (_jsx(PhotoSelectionContextMenu, { x: contextMenuState.x, y: contextMenuState.y, targetCount: contextMenuState.targetIds.length, colorLabelNames: customColorNames, hasFileAccess: Boolean(window.filexDesktop?.sendToEditor) || "showDirectoryPicker" in window, rootFolderPath: effectiveRootFolderPath || undefined, targetPath: contextMenuState.targetIds.length === 1 ? (getAssetRelativePath(contextMenuState.targetIds[0]) ?? undefined) : undefined, onApplyRating: (rating) => {
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
                    handleCopyPath(contextMenuState.targetIds, effectiveRootFolderPath);
                    setContextMenuState(null);
                }, onOpenWithEditor: () => {
                    const ids = [...contextMenuState.targetIds];
                    setContextMenuState(null);
                    handleOpenWithEditor(ids);
                } })) : null, isCompareOpen && selectedIds.length >= 2 && (_jsx(CompareModal, { photos: photos.filter((p) => selectedSet.has(p.id)).slice(0, 4), onClose: () => setIsCompareOpen(false), onUpdatePhoto: (id, changes) => updatePhoto(id, changes) }))] }));
}
//# sourceMappingURL=PhotoSelector.js.map