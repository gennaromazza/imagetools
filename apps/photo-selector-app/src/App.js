import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { revokeImageAssetUrls, } from "./services/browser-image-assets";
import { getDesktopRuntimeInfo } from "./services/desktop-runtime";
import { chooseDesktopThumbnailCacheDirectory, clearDesktopThumbnailCache, dismissDesktopCacheLocationRecommendation, getDesktopCacheLocationRecommendation, getDesktopThumbnailCacheInfo, migrateDesktopThumbnailCacheDirectory, resetDesktopThumbnailCacheDirectory, setDesktopThumbnailCacheDirectory, } from "./services/desktop-thumbnail-cache";
import { loadImageAssets } from "./services/image-storage";
import { clearImageCache } from "./services/image-cache";
import { buildPlaceholderAssets, addRecentFolder, buildSourceFileKey, buildSourceFileKeyFromStats, getFileForAsset, hasNativeFolderAccess, isRawFile, readSidecarXmp, warmOnDemandPreviewCache, writeSidecarXmp, } from "./services/folder-access";
import { parseXmpState, upsertXmpState } from "./services/xmp-sidecar";
import { ThumbnailPipeline, } from "./services/thumbnail-pipeline";
import { cacheThumbnailBatch, loadCachedThumbnails } from "./services/thumbnail-cache";
import { beginReactBatchMetric, cancelReactBatchMetric, finishReactBatchMetric, getPerfByteReadStats, perfTime, perfTimeEnd, resetPerfByteReadStats, } from "./services/performance-utils";
import { loadPhotoSelectorPreferences, } from "./services/photo-selector-preferences";
import { PreviewWarmupPipeline } from "./services/preview-warmup-pipeline";
import { useUndoRedo } from "./hooks/useUndoRedo";
import { buildSelectionResult } from "./types/selection";
import { useToast } from "./components/ToastProvider";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { DismissibleBanner } from "./components/DismissibleBanner";
import { FolderBrowser } from "./components/FolderBrowser";
import { ImportProgressModal } from "./components/ImportProgressModal";
import { PhotoSelector } from "./components/PhotoSelector";
import { ProjectPhotoSelectorModal } from "./components/ProjectPhotoSelectorModal";
import { SelectionSummary } from "./components/SelectionSummary";
// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════
const PROJECT_ID = "photo-selector-default";
const STORAGE_KEY = "photo-selector-state";
const THUMBNAIL_BOOTSTRAP_COUNT = 64;
const XMP_IMPORT_CONCURRENCY = 16;
const XMP_IMPORT_START_DELAY_MS = 0;
const BACKGROUND_THUMBNAIL_ENQUEUE_DELAY_MS = 120;
const BACKGROUND_WARMUP_START_DELAY_MS = 480;
const BACKGROUND_WARMUP_CACHE_CHUNK_SIZE = 144;
const BACKGROUND_WARMUP_PIPELINE_CHUNK_SIZE = 64;
const RAW_PREVIEW_BOOTSTRAP_COUNT = 192;
const RAW_PREVIEW_FILTER_WARM_COUNT = 72;
const RAW_PREVIEW_WARMUP_START_DELAY_MS = 180;
const QUICK_PREVIEW_PRIORITY_WARM_COUNT = 3;
const PERF_FOLDER_OPEN_TO_FIRST_THUMBNAIL_VISIBLE = "[PERF] folder-open → first-thumbnail-visible";
const PERF_FIRST_THUMBNAIL_TO_GRID_COMPLETE = "[PERF] first-thumbnail → grid-complete";
const PERF_XMP_IMPORT = "[PERF] xmp-import start → xmp-import complete";
function getThumbnailPipelineOptions(profile) {
    if (profile === "ultra-fast") {
        return {
            maxDimension: 192,
            quality: 0.5,
            minimumPreviewShortSide: 480,
        };
    }
    if (profile === "fast") {
        return {
            maxDimension: 256,
            quality: 0.62,
            minimumPreviewShortSide: 640,
        };
    }
    return {
        maxDimension: 320,
        quality: 0.72,
        minimumPreviewShortSide: 800,
    };
}
function getQuickPreviewFitMaxDimension(profile) {
    if (profile === "ultra-fast") {
        return 1280;
    }
    if (profile === "fast") {
        return 1600;
    }
    return 2048;
}
function afterNextPaint(run) {
    if (typeof window === "undefined") {
        run();
        return;
    }
    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(run);
    });
}
async function mapWithConcurrency(items, concurrency, worker) {
    const safeConcurrency = Math.max(1, concurrency);
    const results = new Array(items.length);
    let cursor = 0;
    async function run() {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await worker(items[index], index);
        }
    }
    await Promise.all(Array.from({ length: Math.min(safeConcurrency, items.length) }, () => run()));
    return results;
}
function loadPersistedState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return null;
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function savePersistedState(state) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
    catch {
        // Ignore storage errors
    }
}
function detectOrientation(w, h) {
    if (w === h)
        return "square";
    return h > w ? "vertical" : "horizontal";
}
function formatSyncTimestamp(timestamp) {
    if (!timestamp) {
        return "In attesa";
    }
    return new Date(timestamp).toLocaleTimeString("it-IT", {
        hour: "2-digit",
        minute: "2-digit",
    });
}
function formatFolderDiagnosticsSource(source) {
    switch (source) {
        case "desktop-native":
            return "Desktop Windows";
        case "browser-native":
            return "Browser picker";
        case "file-input":
            return "Fallback input";
        default:
            return source;
    }
}
function areSetsEqual(left, right) {
    if (left.size !== right.size) {
        return false;
    }
    for (const value of left) {
        if (!right.has(value)) {
            return false;
        }
    }
    return true;
}
function mergeSets(...sets) {
    const merged = new Set();
    for (const set of sets) {
        for (const value of set) {
            merged.add(value);
        }
    }
    return merged;
}
import logo from "./assets/photo_selector.png";
export function App() {
    const { addToast } = useToast();
    const initialPreferencesRef = useRef(loadPhotoSelectorPreferences());
    // ── Persisted state ──────────────────────────────────────────────────
    const [projectName, setProjectName] = useState("Selezione foto");
    const [desktopRuntime, setDesktopRuntime] = useState(null);
    const [sourceFolderPath, setSourceFolderPath] = useState("");
    // ── Asset catalog ────────────────────────────────────────────────────
    const [allAssets, setAllAssets] = useState([]);
    const [activeAssetIds, setActiveAssetIds] = useState([]);
    const [photoMetadataVersion, setPhotoMetadataVersion] = useState(0);
    const usesMockData = false;
    const bumpPhotoMetadataVersion = useCallback(() => {
        setPhotoMetadataVersion((current) => current + 1);
    }, []);
    // ── Pipeline ─────────────────────────────────────────────────────────
    const pipelineRef = useRef(null);
    const previewWarmupPipelineRef = useRef(null);
    const [thumbnailProgress, setThumbnailProgress] = useState({ done: 0, total: 0 });
    const [thumbnailProfile, setThumbnailProfile] = useState(initialPreferencesRef.current.thumbnailProfile);
    const [sortCacheEnabled, setSortCacheEnabled] = useState(initialPreferencesRef.current.sortCacheEnabled);
    const [performanceSnapshot, setPerformanceSnapshot] = useState({
        folderOpenToFirstThumbnailMs: null,
        folderOpenToGridCompleteMs: null,
        cachedThumbnailCount: 0,
        totalThumbnailCount: 0,
        bytesRead: 0,
        rawBytesRead: 0,
        standardBytesRead: 0,
        thumbnailProfile: initialPreferencesRef.current.thumbnailProfile,
        sortCacheEnabled: initialPreferencesRef.current.sortCacheEnabled,
    });
    // ── UI state ─────────────────────────────────────────────────────────
    const [currentScreen, setCurrentScreen] = useState("browse");
    const [isProjectSelectorOpen, setIsProjectSelectorOpen] = useState(false);
    const [hasWritableFolderAccess, setHasWritableFolderAccess] = useState(false);
    const [isXmpBannerDismissed, setIsXmpBannerDismissed] = useState(false);
    const xmpSyncTimerRef = useRef(null);
    const xmpSnapshotRef = useRef(new Map());
    const pendingXmpSyncIdsRef = useRef(new Set());
    const xmpSyncInFlightRef = useRef(null);
    const [xmpSyncVersion, setXmpSyncVersion] = useState(0);
    const [xmpSyncState, setXmpSyncState] = useState({
        phase: "idle",
        pending: 0,
        failed: 0,
        lastSyncedAt: null,
    });
    const [importProgress, setImportProgress] = useState({
        isOpen: false,
        phase: "reading",
        supported: 0,
        ignored: 0,
        total: 0,
        processed: 0,
        currentFile: null,
        folderLabel: "",
        diagnostics: null,
    });
    const [isImportPanelDismissed, setIsImportPanelDismissed] = useState(false);
    const [folderDiagnostics, setFolderDiagnostics] = useState(null);
    const [desktopThumbnailCacheInfo, setDesktopThumbnailCacheInfo] = useState(null);
    const [desktopCacheLocationRecommendation, setDesktopCacheLocationRecommendation] = useState(null);
    const [isDesktopThumbnailCacheBusy, setIsDesktopThumbnailCacheBusy] = useState(false);
    const [isDesktopCacheRecommendationModalOpen, setIsDesktopCacheRecommendationModalOpen] = useState(false);
    const [isDesktopCacheRecommendationSnoozedForSession, setIsDesktopCacheRecommendationSnoozedForSession] = useState(false);
    const assetNameByIdRef = useRef(new Map());
    const assetIndexByIdRef = useRef(new Map());
    const thumbnailTotalCountRef = useRef(0);
    const settledThumbnailIdsRef = useRef(new Set());
    const thumbnailEntryByIdRef = useRef(new Map());
    const visibleThumbnailIdsRef = useRef(new Set());
    const prioritizedThumbnailIdsRef = useRef(new Set());
    const previewPriorityIdsRef = useRef(new Set());
    const interactiveThumbnailIdsRef = useRef(new Set());
    const folderLoadSessionRef = useRef(0);
    const xmpImportStartTimerRef = useRef(null);
    const backgroundThumbnailEnqueueTimerRef = useRef(null);
    const backgroundCacheLookupTimerRef = useRef(null);
    const rawPreviewWarmupTimerRef = useRef(null);
    const hasLoggedFirstThumbnailRef = useRef(false);
    const hasLoggedGridCompleteRef = useRef(false);
    const folderOpenStartedAtRef = useRef(null);
    // ── Restore from IndexedDB on mount ──────────────────────────────────
    useEffect(() => {
        const persisted = loadPersistedState();
        if (!persisted)
            return;
        setProjectName(persisted.projectName);
        setSourceFolderPath(persisted.sourceFolderPath);
        setHasWritableFolderAccess(false);
        void loadImageAssets(PROJECT_ID).then((assetMap) => {
            if (assetMap.size === 0)
                return;
            const loaded = Array.from(assetMap.values());
            setAllAssets(loaded);
            bumpPhotoMetadataVersion();
            const loadedIds = new Set(loaded.map((a) => a.id));
            const validActiveIds = persisted.activeAssetIds.filter((id) => loadedIds.has(id));
            setActiveAssetIds(validActiveIds.length > 0 ? validActiveIds : loaded.map((a) => a.id));
            setCurrentScreen("selection");
        }).catch(() => {
            addToast("Errore nel caricamento dei dati salvati. Riseleziona la cartella.", "error");
        });
    }, [addToast, bumpPhotoMetadataVersion]);
    // ── Persist state on change ──────────────────────────────────────────
    useEffect(() => {
        savePersistedState({
            projectName,
            sourceFolderPath,
            activeAssetIds,
            usesMockData: false,
        });
    }, [projectName, sourceFolderPath, activeAssetIds]);
    useEffect(() => {
        setPerformanceSnapshot((current) => ({
            ...current,
            thumbnailProfile,
            sortCacheEnabled,
        }));
    }, [sortCacheEnabled, thumbnailProfile]);
    // ── Cleanup pipeline on unmount ──────────────────────────────────────
    useEffect(() => {
        return () => {
            folderLoadSessionRef.current += 1;
            if (xmpImportStartTimerRef.current !== null) {
                window.clearTimeout(xmpImportStartTimerRef.current);
            }
            if (backgroundThumbnailEnqueueTimerRef.current !== null) {
                window.clearTimeout(backgroundThumbnailEnqueueTimerRef.current);
            }
            if (backgroundCacheLookupTimerRef.current !== null) {
                window.clearTimeout(backgroundCacheLookupTimerRef.current);
            }
            if (rawPreviewWarmupTimerRef.current !== null) {
                window.clearTimeout(rawPreviewWarmupTimerRef.current);
            }
            pipelineRef.current?.destroy();
            prioritizedThumbnailIdsRef.current = new Set();
            previewPriorityIdsRef.current = new Set();
            previewWarmupPipelineRef.current?.destroy();
            previewWarmupPipelineRef.current = null;
        };
    }, []);
    // ── Undo/redo for classification changes ─────────────────────────────
    const allAssetsRef = useRef(allAssets);
    allAssetsRef.current = allAssets;
    const undoRedo = useUndoRedo(() => allAssetsRef.current, (snapshot) => {
        setAllAssets(snapshot);
        bumpPhotoMetadataVersion();
    });
    const activeAssetIdsRef = useRef(activeAssetIds);
    activeAssetIdsRef.current = activeAssetIds;
    const queueXmpSync = useCallback((assetIds) => {
        if (usesMockData || !hasWritableFolderAccess) {
            return;
        }
        if (assetIds.length === 0) {
            return;
        }
        let added = false;
        for (const assetId of assetIds) {
            if (pendingXmpSyncIdsRef.current.has(assetId)) {
                continue;
            }
            pendingXmpSyncIdsRef.current.add(assetId);
            added = true;
        }
        if (added) {
            setXmpSyncState((current) => ({
                phase: "pending",
                pending: pendingXmpSyncIdsRef.current.size,
                failed: 0,
                lastSyncedAt: current.lastSyncedAt,
            }));
            setXmpSyncVersion((current) => current + 1);
        }
    }, [hasWritableFolderAccess, usesMockData]);
    const flushPendingXmpSync = useCallback(async () => {
        if (usesMockData || !hasWritableFolderAccess) {
            return true;
        }
        if (xmpSyncTimerRef.current !== null) {
            window.clearTimeout(xmpSyncTimerRef.current);
            xmpSyncTimerRef.current = null;
        }
        let hadFailures = false;
        while (true) {
            if (xmpSyncInFlightRef.current) {
                const result = await xmpSyncInFlightRef.current;
                hadFailures = hadFailures || result.failed > 0;
                continue;
            }
            const idsToSync = Array.from(pendingXmpSyncIdsRef.current);
            if (idsToSync.length === 0) {
                return !hadFailures;
            }
            pendingXmpSyncIdsRef.current.clear();
            const assetMap = new Map(allAssetsRef.current.map((asset) => [asset.id, asset]));
            const activeSet = new Set(activeAssetIdsRef.current);
            setXmpSyncState((current) => ({
                phase: "syncing",
                pending: idsToSync.length,
                failed: 0,
                lastSyncedAt: current.lastSyncedAt,
            }));
            const task = Promise.all(idsToSync.map(async (assetId) => {
                const asset = assetMap.get(assetId);
                if (!asset) {
                    return true;
                }
                try {
                    const existingXml = await readSidecarXmp(asset.id);
                    const nextXml = upsertXmpState(existingXml, asset, activeSet.has(asset.id));
                    return await writeSidecarXmp(asset.id, nextXml);
                }
                catch {
                    return false;
                }
            })).then((results) => {
                const failed = results.filter((result) => result === false).length;
                if (failed > 0) {
                    setXmpSyncState((current) => ({
                        phase: "error",
                        pending: 0,
                        failed,
                        lastSyncedAt: current.lastSyncedAt,
                    }));
                    addToast(`${failed} file XMP non sono stati aggiornati. Riapri la cartella con accesso completo per mantenere rating e pick nei sidecar.`, "warning", 6500);
                }
                else {
                    setXmpSyncState({
                        phase: "saved",
                        pending: 0,
                        failed: 0,
                        lastSyncedAt: Date.now(),
                    });
                }
                return {
                    synced: results.length - failed,
                    failed,
                };
            });
            xmpSyncInFlightRef.current = task;
            const result = await task.finally(() => {
                if (xmpSyncInFlightRef.current === task) {
                    xmpSyncInFlightRef.current = null;
                }
            });
            hadFailures = hadFailures || result.failed > 0;
        }
    }, [addToast, hasWritableFolderAccess, usesMockData]);
    // ── Warn before losing unsaved work ──────────────────────────────────
    useEffect(() => {
        if (typeof window !== "undefined" && typeof window.filexDesktop !== "undefined") {
            return;
        }
        const handler = (e) => {
            if (allAssets.length > 0) {
                e.preventDefault();
            }
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [allAssets.length]);
    const syncThumbnailProgress = useCallback((lastProcessedId) => {
        const interactiveIds = interactiveThumbnailIdsRef.current;
        const total = interactiveIds.size;
        if (total === 0) {
            setThumbnailProgress({ done: 0, total: 0 });
            setImportProgress((current) => (current.isOpen
                ? {
                    ...current,
                    isOpen: false,
                    total: 0,
                    processed: 0,
                }
                : current));
            return;
        }
        let processed = 0;
        for (const assetId of interactiveIds) {
            if (settledThumbnailIdsRef.current.has(assetId)) {
                processed += 1;
            }
        }
        setThumbnailProgress({ done: processed, total });
        setImportProgress((current) => current.isOpen
            ? {
                ...current,
                phase: "preparing",
                total,
                processed,
                currentFile: lastProcessedId
                    ? assetNameByIdRef.current.get(lastProcessedId) ?? current.currentFile
                    : current.currentFile,
            }
            : current);
        if (processed >= total) {
            setThumbnailProgress({ done: 0, total: 0 });
            setImportProgress((current) => (current.isOpen
                ? {
                    ...current,
                    isOpen: false,
                    total: 0,
                    processed: 0,
                }
                : current));
        }
    }, []);
    function checkAllThumbnailsSettled() {
        const total = thumbnailTotalCountRef.current;
        if (total === 0 || settledThumbnailIdsRef.current.size < total) {
            return;
        }
        void refreshDesktopThumbnailCacheInfo();
        afterNextPaint(() => {
            markGridComplete();
        });
    }
    const enqueueVisibleThumbnailEntries = useCallback((ids, priority = 0) => {
        const pipeline = pipelineRef.current;
        if (!pipeline) {
            return;
        }
        const items = [];
        for (const id of ids) {
            if (settledThumbnailIdsRef.current.has(id)) {
                continue;
            }
            const entry = thumbnailEntryByIdRef.current.get(id);
            if (!entry) {
                continue;
            }
            items.push(entry);
        }
        if (items.length > 0) {
            pipeline.enqueue(items, priority);
        }
    }, []);
    const enqueuePriorityThumbnailEntries = useCallback((ids, priority = 1) => {
        const pipeline = pipelineRef.current;
        if (!pipeline) {
            return;
        }
        const items = [];
        for (const id of ids) {
            if (settledThumbnailIdsRef.current.has(id)) {
                continue;
            }
            const entry = thumbnailEntryByIdRef.current.get(id);
            if (!entry) {
                continue;
            }
            items.push(entry);
        }
        if (items.length > 0) {
            pipeline.enqueue(items, priority);
        }
    }, []);
    const invalidateThumbnailEntries = useCallback((ids) => {
        const pipeline = pipelineRef.current;
        if (!pipeline) {
            return [];
        }
        const uniqueIds = [];
        const seen = new Set();
        for (const id of ids) {
            if (seen.has(id) || !thumbnailEntryByIdRef.current.has(id)) {
                continue;
            }
            seen.add(id);
            uniqueIds.push(id);
            settledThumbnailIdsRef.current.delete(id);
        }
        if (uniqueIds.length > 0) {
            pipeline.invalidate(uniqueIds);
        }
        return uniqueIds;
    }, []);
    const ensurePreviewWarmupPipeline = useCallback(() => {
        if (!previewWarmupPipelineRef.current) {
            previewWarmupPipelineRef.current = new PreviewWarmupPipeline((assetId, maxDimension, priority) => warmOnDemandPreviewCache(assetId, priority, { maxDimension }));
        }
        return previewWarmupPipelineRef.current;
    }, []);
    const enqueuePreviewWarmupForIds = useCallback((ids, priority = 1, limit = RAW_PREVIEW_FILTER_WARM_COUNT) => {
        const fitPreviewMaxDimension = getQuickPreviewFitMaxDimension(thumbnailProfile);
        const items = [];
        for (const id of ids) {
            const fileName = assetNameByIdRef.current.get(id);
            if (!fileName || !isRawFile(fileName)) {
                continue;
            }
            items.push({ assetId: id, maxDimension: fitPreviewMaxDimension });
            if (items.length >= limit) {
                break;
            }
        }
        if (items.length > 0) {
            ensurePreviewWarmupPipeline().enqueue(items, priority);
        }
    }, [ensurePreviewWarmupPipeline, thumbnailProfile]);
    const enqueueQuickPreviewWarmupForIds = useCallback((ids, priority = 0, limit = QUICK_PREVIEW_PRIORITY_WARM_COUNT) => {
        const fitPreviewMaxDimension = getQuickPreviewFitMaxDimension(thumbnailProfile);
        const items = [];
        const seen = new Set();
        for (const id of ids) {
            if (seen.has(id) || !assetNameByIdRef.current.has(id)) {
                continue;
            }
            seen.add(id);
            items.push({ assetId: id, maxDimension: fitPreviewMaxDimension });
            if (items.length >= limit) {
                break;
            }
        }
        if (items.length > 0) {
            ensurePreviewWarmupPipeline().enqueue(items, priority);
        }
    }, [ensurePreviewWarmupPipeline, thumbnailProfile]);
    useEffect(() => {
        const pipeline = pipelineRef.current;
        if (!pipeline || allAssetsRef.current.length === 0) {
            return;
        }
        pipeline.updateOptions(getThumbnailPipelineOptions(thumbnailProfile));
        const visibleIds = Array.from(visibleThumbnailIdsRef.current);
        const effectivePriorityIds = mergeSets(prioritizedThumbnailIdsRef.current, previewPriorityIdsRef.current);
        const prioritizedIds = Array.from(effectivePriorityIds)
            .filter((id) => !visibleThumbnailIdsRef.current.has(id));
        const invalidatedVisibleIds = invalidateThumbnailEntries(visibleIds);
        const invalidatedPriorityIds = invalidateThumbnailEntries(prioritizedIds);
        pipeline.updateViewport(visibleThumbnailIdsRef.current, effectivePriorityIds);
        if (invalidatedVisibleIds.length > 0) {
            enqueueVisibleThumbnailEntries(invalidatedVisibleIds, 0);
        }
        if (invalidatedPriorityIds.length > 0) {
            enqueuePriorityThumbnailEntries(invalidatedPriorityIds, 1);
        }
        previewWarmupPipelineRef.current?.destroy();
        previewWarmupPipelineRef.current = null;
        enqueuePreviewWarmupForIds(visibleThumbnailIdsRef.current, 0, RAW_PREVIEW_FILTER_WARM_COUNT);
        enqueuePreviewWarmupForIds(prioritizedThumbnailIdsRef.current, 1, RAW_PREVIEW_FILTER_WARM_COUNT);
        enqueueQuickPreviewWarmupForIds(previewPriorityIdsRef.current, 0, QUICK_PREVIEW_PRIORITY_WARM_COUNT);
    }, [
        enqueueQuickPreviewWarmupForIds,
        enqueuePreviewWarmupForIds,
        enqueuePriorityThumbnailEntries,
        enqueueVisibleThumbnailEntries,
        invalidateThumbnailEntries,
        thumbnailProfile,
    ]);
    const markFirstThumbnailVisible = useCallback(() => {
        if (hasLoggedFirstThumbnailRef.current) {
            return;
        }
        hasLoggedFirstThumbnailRef.current = true;
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        const elapsedMs = folderOpenStartedAtRef.current !== null
            ? Math.max(0, Math.round(now - folderOpenStartedAtRef.current))
            : null;
        const byteStats = getPerfByteReadStats();
        setPerformanceSnapshot((current) => ({
            ...current,
            folderOpenToFirstThumbnailMs: elapsedMs,
            bytesRead: byteStats.totalBytes,
            rawBytesRead: byteStats.rawBytes,
            standardBytesRead: byteStats.standardBytes,
        }));
        perfTimeEnd(PERF_FOLDER_OPEN_TO_FIRST_THUMBNAIL_VISIBLE);
        perfTime(PERF_FIRST_THUMBNAIL_TO_GRID_COMPLETE);
    }, []);
    const markGridComplete = useCallback(() => {
        if (!hasLoggedFirstThumbnailRef.current || hasLoggedGridCompleteRef.current) {
            return;
        }
        hasLoggedGridCompleteRef.current = true;
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        const elapsedMs = folderOpenStartedAtRef.current !== null
            ? Math.max(0, Math.round(now - folderOpenStartedAtRef.current))
            : null;
        const byteStats = getPerfByteReadStats();
        setPerformanceSnapshot((current) => ({
            ...current,
            folderOpenToGridCompleteMs: elapsedMs,
            bytesRead: byteStats.totalBytes,
            rawBytesRead: byteStats.rawBytes,
            standardBytesRead: byteStats.standardBytes,
        }));
        perfTimeEnd(PERF_FIRST_THUMBNAIL_TO_GRID_COMPLETE);
    }, []);
    // ── Thumbnail batch handler (called by pipeline every ~120 ms) ──────
    const handleThumbnailBatch = useCallback((batch) => {
        const renderMetricToken = beginReactBatchMetric(batch.length, allAssetsRef.current.length);
        startTransition(() => {
            setAllAssets((prev) => {
                if (prev.length === 0) {
                    return prev;
                }
                const next = prev.slice();
                let changed = false;
                for (const update of batch) {
                    const index = assetIndexByIdRef.current.get(update.id);
                    if (index === undefined) {
                        continue;
                    }
                    const asset = next[index];
                    if (!asset) {
                        continue;
                    }
                    next[index] = {
                        ...asset,
                        thumbnailUrl: update.url,
                        width: update.width,
                        height: update.height,
                        orientation: detectOrientation(update.width, update.height),
                        aspectRatio: update.width / update.height,
                        sourceFileKey: update.sourceFileKey ?? asset.sourceFileKey,
                    };
                    changed = true;
                }
                return changed ? next : prev;
            });
        });
        for (const item of batch) {
            settledThumbnailIdsRef.current.add(item.id);
        }
        syncThumbnailProgress(batch[batch.length - 1]?.id ?? null);
        checkAllThumbnailsSettled();
        afterNextPaint(() => {
            finishReactBatchMetric(renderMetricToken);
            if (batch.length > 0) {
                markFirstThumbnailVisible();
            }
        });
        void cacheThumbnailBatch(batch.map((item) => ({
            id: item.id,
            blob: item.blob,
            width: item.width,
            height: item.height,
        })));
    }, [checkAllThumbnailsSettled, markFirstThumbnailVisible, syncThumbnailProgress]);
    // Error handler for failed thumbnail generations (e.g. RAW files)
    const lastErrorToastRef = useRef(0);
    const handleThumbnailError = useCallback((failedCount, failedId) => {
        if (failedId) {
            settledThumbnailIdsRef.current.add(failedId);
        }
        syncThumbnailProgress(failedId);
        checkAllThumbnailsSettled();
        // Debounce toast — show at most once per 5 seconds
        const now = Date.now();
        if (now - lastErrorToastRef.current < 5000)
            return;
        lastErrorToastRef.current = now;
        addToast(`${failedCount} foto non decodificabil${failedCount === 1 ? "e" : "i"} (formati RAW o non supportati).`, "warning");
    }, [addToast, checkAllThumbnailsSettled, syncThumbnailProgress]);
    function isValidCachedThumbnail(asset, hit, minimumRawDimension) {
        if (!isRawFile(asset.fileName))
            return true;
        const minDimension = Math.min(hit.width, hit.height);
        // Old cache entries may contain tiny embedded thumbnails (e.g. 160x120).
        // For RAW files we require a minimally useful preview size.
        return minDimension >= minimumRawDimension;
    }
    const stopCurrentImport = useCallback(() => {
        folderLoadSessionRef.current += 1;
        pipelineRef.current?.destroy();
        pipelineRef.current = null;
        if (xmpImportStartTimerRef.current !== null) {
            window.clearTimeout(xmpImportStartTimerRef.current);
            xmpImportStartTimerRef.current = null;
        }
        if (xmpSyncTimerRef.current !== null) {
            window.clearTimeout(xmpSyncTimerRef.current);
            xmpSyncTimerRef.current = null;
        }
        if (backgroundThumbnailEnqueueTimerRef.current !== null) {
            window.clearTimeout(backgroundThumbnailEnqueueTimerRef.current);
            backgroundThumbnailEnqueueTimerRef.current = null;
        }
        if (backgroundCacheLookupTimerRef.current !== null) {
            window.clearTimeout(backgroundCacheLookupTimerRef.current);
            backgroundCacheLookupTimerRef.current = null;
        }
        if (rawPreviewWarmupTimerRef.current !== null) {
            window.clearTimeout(rawPreviewWarmupTimerRef.current);
            rawPreviewWarmupTimerRef.current = null;
        }
        previewWarmupPipelineRef.current?.destroy();
        previewWarmupPipelineRef.current = null;
        revokeImageAssetUrls(allAssetsRef.current);
        clearImageCache();
        assetNameByIdRef.current = new Map();
        assetIndexByIdRef.current = new Map();
        thumbnailEntryByIdRef.current = new Map();
        visibleThumbnailIdsRef.current = new Set();
        prioritizedThumbnailIdsRef.current = new Set();
        previewPriorityIdsRef.current = new Set();
        interactiveThumbnailIdsRef.current = new Set();
        settledThumbnailIdsRef.current = new Set();
        thumbnailTotalCountRef.current = 0;
        pendingXmpSyncIdsRef.current.clear();
        xmpSnapshotRef.current.clear();
        hasLoggedFirstThumbnailRef.current = false;
        hasLoggedGridCompleteRef.current = false;
        cancelReactBatchMetric();
        perfTimeEnd(PERF_FOLDER_OPEN_TO_FIRST_THUMBNAIL_VISIBLE);
        perfTimeEnd(PERF_FIRST_THUMBNAIL_TO_GRID_COMPLETE);
        perfTimeEnd(PERF_XMP_IMPORT);
        setThumbnailProgress({ done: 0, total: 0 });
        setImportProgress({
            isOpen: false,
            phase: "reading",
            supported: 0,
            ignored: 0,
            total: 0,
            processed: 0,
            currentFile: null,
            folderLabel: "",
            diagnostics: null,
        });
        setIsImportPanelDismissed(false);
        setAllAssets([]);
        bumpPhotoMetadataVersion();
        setActiveAssetIds([]);
        setSourceFolderPath("");
        setHasWritableFolderAccess(false);
        setFolderDiagnostics(null);
        setIsProjectSelectorOpen(false);
        setCurrentScreen("browse");
        setIsXmpBannerDismissed(false);
        setXmpSyncState({
            phase: "idle",
            pending: 0,
            failed: 0,
            lastSyncedAt: null,
        });
        folderOpenStartedAtRef.current = null;
        setPerformanceSnapshot((current) => ({
            ...current,
            folderOpenToFirstThumbnailMs: null,
            folderOpenToGridCompleteMs: null,
            cachedThumbnailCount: 0,
            totalThumbnailCount: 0,
            bytesRead: 0,
            rawBytesRead: 0,
            standardBytesRead: 0,
        }));
        undoRedo.reset();
    }, [bumpPhotoMetadataVersion, undoRedo]);
    const handleCancelImport = useCallback(() => {
        stopCurrentImport();
        addToast("Caricamento annullato. Torniamo alla scelta cartella.", "info");
    }, [addToast, stopCurrentImport]);
    // ── Open folder (instant grid + streaming thumbnails) ────────────────
    const handleFolderOpened = useCallback(async ({ name: folderName, entries, rootPath, diagnostics }) => {
        await flushPendingXmpSync();
        const thumbnailOptions = getThumbnailPipelineOptions(thumbnailProfile);
        const minimumRawCacheDimension = thumbnailProfile === "ultra-fast"
            ? 160
            : thumbnailProfile === "fast"
                ? 200
                : 280;
        folderOpenStartedAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
        const nextDiagnostics = diagnostics ?? {
            source: "file-input",
            selectedPath: rootPath ?? folderName,
            topLevelSupportedCount: entries.length,
            nestedSupportedDiscardedCount: 0,
            totalSupportedSeen: entries.length,
            nestedDirectoriesSeen: 0,
        };
        setFolderDiagnostics(nextDiagnostics);
        setIsImportPanelDismissed(true);
        hasLoggedFirstThumbnailRef.current = false;
        hasLoggedGridCompleteRef.current = false;
        cancelReactBatchMetric();
        resetPerfByteReadStats();
        setPerformanceSnapshot({
            folderOpenToFirstThumbnailMs: null,
            folderOpenToGridCompleteMs: null,
            cachedThumbnailCount: 0,
            totalThumbnailCount: entries.length,
            bytesRead: 0,
            rawBytesRead: 0,
            standardBytesRead: 0,
            thumbnailProfile,
            sortCacheEnabled,
        });
        perfTime(PERF_FOLDER_OPEN_TO_FIRST_THUMBNAIL_VISIBLE);
        perfTime(PERF_XMP_IMPORT);
        if (entries.length === 0) {
            perfTimeEnd(PERF_FOLDER_OPEN_TO_FIRST_THUMBNAIL_VISIBLE);
            perfTimeEnd(PERF_XMP_IMPORT);
            addToast("Nessuna immagine supportata trovata nella cartella.", "warning");
            return;
        }
        // 1. Destroy previous pipeline
        pipelineRef.current?.destroy();
        folderLoadSessionRef.current += 1;
        const folderLoadSession = folderLoadSessionRef.current;
        thumbnailEntryByIdRef.current = new Map();
        visibleThumbnailIdsRef.current = new Set();
        prioritizedThumbnailIdsRef.current = new Set();
        previewPriorityIdsRef.current = new Set();
        if (xmpImportStartTimerRef.current !== null) {
            window.clearTimeout(xmpImportStartTimerRef.current);
            xmpImportStartTimerRef.current = null;
        }
        if (backgroundThumbnailEnqueueTimerRef.current !== null) {
            window.clearTimeout(backgroundThumbnailEnqueueTimerRef.current);
            backgroundThumbnailEnqueueTimerRef.current = null;
        }
        if (backgroundCacheLookupTimerRef.current !== null) {
            window.clearTimeout(backgroundCacheLookupTimerRef.current);
            backgroundCacheLookupTimerRef.current = null;
        }
        if (rawPreviewWarmupTimerRef.current !== null) {
            window.clearTimeout(rawPreviewWarmupTimerRef.current);
            rawPreviewWarmupTimerRef.current = null;
        }
        previewWarmupPipelineRef.current?.destroy();
        previewWarmupPipelineRef.current = null;
        // 2. Clean up previous blob URLs
        revokeImageAssetUrls(allAssets);
        clearImageCache();
        // 3. Create placeholder assets INSTANTLY (no file reading)
        const assets = buildPlaceholderAssets(entries);
        const rawPreviewBootstrapIds = assets
            .filter((asset) => isRawFile(asset.fileName))
            .slice(0, RAW_PREVIEW_BOOTSTRAP_COUNT)
            .map((asset) => asset.id);
        assetNameByIdRef.current = new Map(assets.map((asset) => [asset.id, asset.fileName]));
        assetIndexByIdRef.current = new Map(assets.map((asset, index) => [asset.id, index]));
        const writableAccess = entries.some((entry) => !!entry.fileHandle || !!entry.absolutePath);
        setAllAssets(assets);
        bumpPhotoMetadataVersion();
        setActiveAssetIds([]);
        setSourceFolderPath(rootPath ?? folderName);
        setHasWritableFolderAccess(writableAccess);
        setIsXmpBannerDismissed(false);
        setCurrentScreen("selection"); // instant — grid shows immediately
        undoRedo.reset();
        pendingXmpSyncIdsRef.current.clear();
        setXmpSyncState({
            phase: writableAccess ? "idle" : "unavailable",
            pending: 0,
            failed: 0,
            lastSyncedAt: null,
        });
        addRecentFolder(folderName, entries.length, rootPath);
        if (!writableAccess) {
            addToast("Cartella aperta senza accesso completo ai sidecar XMP. Le modifiche restano locali finché non riapri la cartella con accesso scrivibile.", "warning", 6500);
        }
        setImportProgress({
            isOpen: true,
            phase: "preparing",
            supported: entries.length,
            ignored: 0,
            total: entries.length,
            processed: 0,
            currentFile: entries[0]?.name ?? null,
            folderLabel: folderName,
            diagnostics: nextDiagnostics,
        });
        addToast(`${entries.length} foto trovate in "${folderName}".`, "info");
        if (rawPreviewBootstrapIds.length > 0) {
            rawPreviewWarmupTimerRef.current = window.setTimeout(() => {
                rawPreviewWarmupTimerRef.current = null;
                if (folderLoadSessionRef.current !== folderLoadSession) {
                    return;
                }
                enqueuePreviewWarmupForIds(rawPreviewBootstrapIds, 1, RAW_PREVIEW_BOOTSTRAP_COUNT);
            }, RAW_PREVIEW_WARMUP_START_DELAY_MS);
        }
        // 4. Import Adobe-compatible XMP sidecars in background with limited concurrency.
        const runXmpImport = () => {
            void mapWithConcurrency(assets, XMP_IMPORT_CONCURRENCY, async (asset) => {
                if (folderLoadSessionRef.current !== folderLoadSession) {
                    return null;
                }
                const xml = await readSidecarXmp(asset.id);
                if (!xml)
                    return null;
                return { id: asset.id, state: parseXmpState(xml) };
            }).then((records) => {
                if (folderLoadSessionRef.current !== folderLoadSession) {
                    return;
                }
                const valid = records.filter((r) => r !== null);
                if (valid.length === 0)
                    return;
                const selectedByXmp = valid
                    .filter((r) => r.state.selected === true)
                    .map((r) => r.id);
                startTransition(() => {
                    setAllAssets((prev) => {
                        if (prev.length === 0) {
                            return prev;
                        }
                        const next = prev.slice();
                        let changed = false;
                        for (const record of valid) {
                            const index = assetIndexByIdRef.current.get(record.id);
                            if (index === undefined) {
                                continue;
                            }
                            const asset = next[index];
                            if (!asset) {
                                continue;
                            }
                            const hasEdits = record.state.hasCameraRawAdjustments || record.state.hasPhotoshopAdjustments;
                            const xmpEditInfo = record.state.hasCameraRawAdjustments && record.state.hasPhotoshopAdjustments
                                ? "Camera Raw + Photoshop"
                                : record.state.hasCameraRawAdjustments
                                    ? "Camera Raw"
                                    : record.state.hasPhotoshopAdjustments
                                        ? "Photoshop"
                                        : undefined;
                            next[index] = {
                                ...asset,
                                rating: record.state.rating ?? asset.rating,
                                pickStatus: record.state.pickStatus ?? asset.pickStatus,
                                colorLabel: record.state.colorLabel !== undefined ? record.state.colorLabel : asset.colorLabel,
                                customLabels: record.state.customLabels !== undefined ? record.state.customLabels : asset.customLabels,
                                xmpHasEdits: hasEdits,
                                xmpEditInfo,
                            };
                            changed = true;
                        }
                        return changed ? next : prev;
                    });
                });
                if (valid.length > 0) {
                    bumpPhotoMetadataVersion();
                }
                if (selectedByXmp.length > 0) {
                    setActiveAssetIds(selectedByXmp);
                }
                const editedBySidecar = valid.filter((r) => r.state.hasCameraRawAdjustments || r.state.hasPhotoshopAdjustments).length;
                if (editedBySidecar > 0) {
                    addToast(`${editedBySidecar} foto con modifiche XMP (Camera Raw/Photoshop) rilevate.`, "info");
                }
            }).catch(() => {
                // Sidecar import is best-effort only.
            }).finally(() => {
                xmpImportStartTimerRef.current = null;
                perfTimeEnd(PERF_XMP_IMPORT);
            });
        };
        if (XMP_IMPORT_START_DELAY_MS > 0) {
            xmpImportStartTimerRef.current = window.setTimeout(runXmpImport, XMP_IMPORT_START_DELAY_MS);
        }
        else {
            runXmpImport();
        }
        // 5. Check thumbnail cache, then start pipeline for ALL images (including RAW)
        const assetIdByPath = new Map(assets.map((asset) => [asset.path, asset.id]));
        const pipelineEntries = [];
        for (const entry of entries) {
            const id = assetIdByPath.get(entry.relativePath);
            if (!id) {
                continue;
            }
            pipelineEntries.push({
                id,
                file: entry.file,
                loadFile: entry.file ? undefined : () => getFileForAsset(id),
                absolutePath: entry.absolutePath,
                sourceFileKey: entry.file
                    ? buildSourceFileKey(entry.file, entry.relativePath)
                    : entry.size !== undefined && entry.lastModified !== undefined
                        ? buildSourceFileKeyFromStats(entry.relativePath, entry.size, entry.lastModified)
                        : undefined,
                createSourceFileKey: entry.file || !entry.absolutePath
                    ? (file) => buildSourceFileKey(file, entry.relativePath)
                    : undefined,
            });
        }
        thumbnailEntryByIdRef.current = new Map(pipelineEntries.map((entry) => [entry.id, entry]));
        thumbnailTotalCountRef.current = pipelineEntries.length;
        settledThumbnailIdsRef.current = new Set();
        setPerformanceSnapshot((current) => ({
            ...current,
            totalThumbnailCount: pipelineEntries.length,
        }));
        if (pipelineEntries.length === 0) {
            perfTimeEnd(PERF_FOLDER_OPEN_TO_FIRST_THUMBNAIL_VISIBLE);
            perfTimeEnd(PERF_XMP_IMPORT);
            setImportProgress((current) => ({ ...current, isOpen: false, total: 0, processed: 0 }));
            return;
        }
        const bootstrapCacheCount = Math.min(pipelineEntries.length, Math.max(THUMBNAIL_BOOTSTRAP_COUNT, 36));
        const bootstrapEntries = pipelineEntries.slice(0, bootstrapCacheCount);
        const remainingEntries = pipelineEntries.slice(bootstrapCacheCount);
        interactiveThumbnailIdsRef.current = new Set(bootstrapEntries.map((entry) => entry.id));
        setThumbnailProgress({
            done: 0,
            total: interactiveThumbnailIdsRef.current.size,
        });
        setImportProgress((current) => ({
            ...current,
            isOpen: interactiveThumbnailIdsRef.current.size > 0,
            total: interactiveThumbnailIdsRef.current.size,
            processed: 0,
        }));
        const ensurePipeline = () => {
            if (!pipelineRef.current) {
                pipelineRef.current = new ThumbnailPipeline(handleThumbnailBatch, handleThumbnailError, thumbnailOptions);
            }
            return pipelineRef.current;
        };
        const enqueuePipelineEntries = (entriesToEnqueue, strategy) => {
            if (entriesToEnqueue.length === 0) {
                return;
            }
            const pipeline = ensurePipeline();
            if (strategy === "bootstrap") {
                pipeline.enqueue(entriesToEnqueue.slice(0, THUMBNAIL_BOOTSTRAP_COUNT), 0);
                enqueueVisibleThumbnailEntries(visibleThumbnailIdsRef.current, 0);
                const deferredEntries = entriesToEnqueue.slice(THUMBNAIL_BOOTSTRAP_COUNT);
                if (deferredEntries.length > 0) {
                    backgroundThumbnailEnqueueTimerRef.current = window.setTimeout(() => {
                        if (folderLoadSessionRef.current !== folderLoadSession || pipelineRef.current !== pipeline) {
                            return;
                        }
                        pipeline.enqueue(deferredEntries, 4);
                        backgroundThumbnailEnqueueTimerRef.current = null;
                    }, BACKGROUND_THUMBNAIL_ENQUEUE_DELAY_MS);
                }
                return;
            }
            pipeline.enqueue(entriesToEnqueue, 4);
            enqueueVisibleThumbnailEntries(visibleThumbnailIdsRef.current, 0);
        };
        const applyCachedThumbnails = (cached) => {
            const validCachedIds = new Set();
            if (cached.size > 0) {
                startTransition(() => {
                    setAllAssets((prev) => {
                        if (prev.length === 0) {
                            return prev;
                        }
                        const next = prev.slice();
                        let changed = false;
                        for (const [assetId, hit] of cached) {
                            const index = assetIndexByIdRef.current.get(assetId);
                            if (index === undefined) {
                                continue;
                            }
                            const asset = next[index];
                            if (!asset || !isValidCachedThumbnail(asset, hit, minimumRawCacheDimension) || asset.thumbnailUrl) {
                                continue;
                            }
                            validCachedIds.add(asset.id);
                            next[index] = {
                                ...asset,
                                thumbnailUrl: hit.url,
                                width: hit.width,
                                height: hit.height,
                                orientation: detectOrientation(hit.width, hit.height),
                                aspectRatio: hit.width / hit.height,
                            };
                            changed = true;
                        }
                        return changed ? next : prev;
                    });
                });
            }
            if (validCachedIds.size > 0) {
                setPerformanceSnapshot((current) => ({
                    ...current,
                    cachedThumbnailCount: current.cachedThumbnailCount + validCachedIds.size,
                }));
                for (const assetId of validCachedIds) {
                    settledThumbnailIdsRef.current.add(assetId);
                }
                syncThumbnailProgress(Array.from(validCachedIds).at(-1) ?? null);
                checkAllThumbnailsSettled();
                afterNextPaint(() => {
                    markFirstThumbnailVisible();
                });
            }
            return validCachedIds;
        };
        const scheduleRemainingCachePhase = () => {
            if (remainingEntries.length === 0) {
                return;
            }
            backgroundCacheLookupTimerRef.current = window.setTimeout(() => {
                backgroundCacheLookupTimerRef.current = null;
                const processRemainingChunk = (startIndex) => {
                    if (folderLoadSessionRef.current !== folderLoadSession) {
                        return;
                    }
                    const chunk = remainingEntries.slice(startIndex, startIndex + BACKGROUND_WARMUP_CACHE_CHUNK_SIZE);
                    if (chunk.length === 0) {
                        return;
                    }
                    void loadCachedThumbnails(chunk, thumbnailOptions).then((cached) => {
                        if (folderLoadSessionRef.current !== folderLoadSession) {
                            return;
                        }
                        const validCachedIds = applyCachedThumbnails(cached);
                        const uncachedRemaining = chunk.filter((entry) => !validCachedIds.has(entry.id));
                        for (let index = 0; index < uncachedRemaining.length; index += BACKGROUND_WARMUP_PIPELINE_CHUNK_SIZE) {
                            const pipelineChunk = uncachedRemaining.slice(index, index + BACKGROUND_WARMUP_PIPELINE_CHUNK_SIZE);
                            if (pipelineChunk.length > 0) {
                                enqueuePipelineEntries(pipelineChunk, "background");
                            }
                        }
                        if (startIndex + BACKGROUND_WARMUP_CACHE_CHUNK_SIZE < remainingEntries.length) {
                            backgroundCacheLookupTimerRef.current = window.setTimeout(() => {
                                backgroundCacheLookupTimerRef.current = null;
                                processRemainingChunk(startIndex + BACKGROUND_WARMUP_CACHE_CHUNK_SIZE);
                            }, BACKGROUND_THUMBNAIL_ENQUEUE_DELAY_MS);
                        }
                    }).catch(() => {
                        if (folderLoadSessionRef.current !== folderLoadSession) {
                            return;
                        }
                        for (let index = 0; index < chunk.length; index += BACKGROUND_WARMUP_PIPELINE_CHUNK_SIZE) {
                            const pipelineChunk = chunk.slice(index, index + BACKGROUND_WARMUP_PIPELINE_CHUNK_SIZE);
                            if (pipelineChunk.length > 0) {
                                enqueuePipelineEntries(pipelineChunk, "background");
                            }
                        }
                        if (startIndex + BACKGROUND_WARMUP_CACHE_CHUNK_SIZE < remainingEntries.length) {
                            backgroundCacheLookupTimerRef.current = window.setTimeout(() => {
                                backgroundCacheLookupTimerRef.current = null;
                                processRemainingChunk(startIndex + BACKGROUND_WARMUP_CACHE_CHUNK_SIZE);
                            }, BACKGROUND_THUMBNAIL_ENQUEUE_DELAY_MS);
                        }
                    });
                };
                processRemainingChunk(0);
            }, BACKGROUND_WARMUP_START_DELAY_MS);
        };
        void loadCachedThumbnails(bootstrapEntries, thumbnailOptions).then((cached) => {
            if (folderLoadSessionRef.current !== folderLoadSession) {
                return;
            }
            const validCachedIds = applyCachedThumbnails(cached);
            const uncachedBootstrap = bootstrapEntries.filter((entry) => !validCachedIds.has(entry.id));
            enqueuePipelineEntries(uncachedBootstrap, "bootstrap");
            scheduleRemainingCachePhase();
            if (remainingEntries.length === 0 && uncachedBootstrap.length === 0) {
                afterNextPaint(() => {
                    if (validCachedIds.size > 0) {
                        markFirstThumbnailVisible();
                    }
                    markGridComplete();
                });
                setThumbnailProgress({ done: 0, total: 0 });
                setImportProgress((current) => ({ ...current, isOpen: false, total: 0, processed: 0 }));
            }
        }).catch(() => {
            if (folderLoadSessionRef.current !== folderLoadSession) {
                return;
            }
            setThumbnailProgress({ done: 0, total: interactiveThumbnailIdsRef.current.size });
            setImportProgress((current) => ({
                ...current,
                isOpen: interactiveThumbnailIdsRef.current.size > 0,
                phase: "preparing",
                supported: entries.length,
                ignored: 0,
                total: interactiveThumbnailIdsRef.current.size,
                processed: 0,
            }));
            enqueuePipelineEntries(pipelineEntries, "bootstrap");
        });
    }, [
        addToast,
        allAssets,
        bumpPhotoMetadataVersion,
        enqueuePreviewWarmupForIds,
        enqueueVisibleThumbnailEntries,
        flushPendingXmpSync,
        handleThumbnailBatch,
        handleThumbnailError,
        markFirstThumbnailVisible,
        markGridComplete,
        syncThumbnailProgress,
        sortCacheEnabled,
        thumbnailProfile,
        undoRedo,
    ]);
    // ── Load mock data ───────────────────────────────────────────────────
    // ── Photo metadata changes (with undo history) ───────────────────────
    const handlePhotosChange = useCallback((photos) => {
        const previousAssets = allAssetsRef.current;
        const changedIds = [];
        for (let index = 0; index < photos.length; index += 1) {
            if (photos[index] !== previousAssets[index]) {
                changedIds.push(photos[index].id);
            }
        }
        undoRedo.push(allAssetsRef.current);
        startTransition(() => {
            setAllAssets(photos);
        });
        bumpPhotoMetadataVersion();
        queueXmpSync(changedIds);
    }, [bumpPhotoMetadataVersion, queueXmpSync, undoRedo]);
    const handleSelectionChange = useCallback((nextIds) => {
        const previousSet = new Set(activeAssetIdsRef.current);
        const nextSet = new Set(nextIds);
        const changedIds = new Set();
        for (const assetId of previousSet) {
            if (!nextSet.has(assetId)) {
                changedIds.add(assetId);
            }
        }
        for (const assetId of nextSet) {
            if (!previousSet.has(assetId)) {
                changedIds.add(assetId);
            }
        }
        setActiveAssetIds(nextIds);
        queueXmpSync(Array.from(changedIds));
    }, [queueXmpSync]);
    const refreshDesktopThumbnailCacheInfo = useCallback(async () => {
        const info = await getDesktopThumbnailCacheInfo();
        setDesktopThumbnailCacheInfo(info);
    }, []);
    const refreshDesktopCacheLocationRecommendation = useCallback(async () => {
        const recommendation = await getDesktopCacheLocationRecommendation();
        setDesktopCacheLocationRecommendation(recommendation);
    }, []);
    const handleChooseDesktopThumbnailCacheDirectory = useCallback(async () => {
        setIsDesktopThumbnailCacheBusy(true);
        try {
            const info = await chooseDesktopThumbnailCacheDirectory();
            if (info) {
                setDesktopThumbnailCacheInfo(info);
                await refreshDesktopCacheLocationRecommendation();
                setIsDesktopCacheRecommendationModalOpen(false);
                setIsDesktopCacheRecommendationSnoozedForSession(false);
                addToast("Percorso cache thumbnail aggiornato.", "success");
            }
        }
        finally {
            setIsDesktopThumbnailCacheBusy(false);
        }
    }, [addToast, refreshDesktopCacheLocationRecommendation]);
    const handleSetDesktopThumbnailCacheDirectory = useCallback(async (directoryPath) => {
        setIsDesktopThumbnailCacheBusy(true);
        try {
            const info = await setDesktopThumbnailCacheDirectory(directoryPath);
            if (info) {
                setDesktopThumbnailCacheInfo(info);
                await refreshDesktopCacheLocationRecommendation();
                setIsDesktopCacheRecommendationModalOpen(false);
                setIsDesktopCacheRecommendationSnoozedForSession(false);
                addToast("Nuovo percorso cache applicato.", "success");
            }
            else {
                addToast("Non sono riuscito ad aggiornare il percorso cache.", "error");
            }
        }
        finally {
            setIsDesktopThumbnailCacheBusy(false);
        }
    }, [addToast, refreshDesktopCacheLocationRecommendation]);
    const handleMigrateDesktopThumbnailCacheDirectory = useCallback(async (directoryPath) => {
        setIsDesktopThumbnailCacheBusy(true);
        try {
            const result = await migrateDesktopThumbnailCacheDirectory(directoryPath);
            if (!result) {
                addToast("Non sono riuscito a migrare la cache nel nuovo percorso.", "error");
                return;
            }
            if (!result.ok || !result.cacheInfo) {
                addToast(result.error ?? "Non sono riuscito a migrare la cache nel nuovo percorso.", "error");
                return;
            }
            setDesktopThumbnailCacheInfo(result.cacheInfo);
            await refreshDesktopCacheLocationRecommendation();
            setIsDesktopCacheRecommendationModalOpen(false);
            setIsDesktopCacheRecommendationSnoozedForSession(false);
            addToast(`Cache migrata: ${result.copiedEntries} file copiati, ${result.removedSourceEntries} rimossi dal vecchio percorso.`, "success", 5200);
            if (result.error) {
                addToast(result.error, "warning", 6500);
            }
        }
        finally {
            setIsDesktopThumbnailCacheBusy(false);
        }
    }, [addToast, refreshDesktopCacheLocationRecommendation]);
    const handleUseRecommendedDesktopThumbnailCacheDirectory = useCallback(async () => {
        const recommendedPath = desktopCacheLocationRecommendation?.recommendedPath;
        if (!recommendedPath) {
            addToast("Non ho trovato un percorso consigliato valido per la cache.", "warning");
            return;
        }
        await handleMigrateDesktopThumbnailCacheDirectory(recommendedPath);
    }, [addToast, desktopCacheLocationRecommendation?.recommendedPath, handleMigrateDesktopThumbnailCacheDirectory]);
    const handleResetDesktopThumbnailCacheDirectory = useCallback(async () => {
        setIsDesktopThumbnailCacheBusy(true);
        try {
            const info = await resetDesktopThumbnailCacheDirectory();
            if (info) {
                setDesktopThumbnailCacheInfo(info);
                await refreshDesktopCacheLocationRecommendation();
                addToast("Cache riportata al percorso predefinito.", "success");
            }
        }
        finally {
            setIsDesktopThumbnailCacheBusy(false);
        }
    }, [addToast, refreshDesktopCacheLocationRecommendation]);
    const handleClearDesktopThumbnailCache = useCallback(async () => {
        setIsDesktopThumbnailCacheBusy(true);
        try {
            const cleared = await clearDesktopThumbnailCache();
            if (cleared) {
                addToast("Cache thumbnail svuotata.", "success");
                await Promise.all([
                    refreshDesktopThumbnailCacheInfo(),
                    refreshDesktopCacheLocationRecommendation(),
                ]);
            }
            else {
                addToast("Non sono riuscito a svuotare la cache thumbnail.", "error");
            }
        }
        finally {
            setIsDesktopThumbnailCacheBusy(false);
        }
    }, [addToast, refreshDesktopCacheLocationRecommendation, refreshDesktopThumbnailCacheInfo]);
    const handleSnoozeDesktopCacheRecommendation = useCallback(() => {
        setIsDesktopCacheRecommendationSnoozedForSession(true);
        setIsDesktopCacheRecommendationModalOpen(false);
    }, []);
    const handleDismissDesktopCacheRecommendation = useCallback(async () => {
        setIsDesktopThumbnailCacheBusy(true);
        try {
            const dismissed = await dismissDesktopCacheLocationRecommendation();
            if (!dismissed) {
                addToast("Non sono riuscito a salvare la preferenza del suggerimento cache.", "error");
                return;
            }
            setIsDesktopCacheRecommendationModalOpen(false);
            setIsDesktopCacheRecommendationSnoozedForSession(false);
            await refreshDesktopCacheLocationRecommendation();
            addToast("Suggerimento automatico cache disattivato.", "success");
        }
        finally {
            setIsDesktopThumbnailCacheBusy(false);
        }
    }, [addToast, refreshDesktopCacheLocationRecommendation]);
    const handleSelectorApply = useCallback((nextIds, nextAssets) => {
        const previousAssets = allAssetsRef.current;
        const changedIds = new Set();
        for (let index = 0; index < nextAssets.length; index += 1) {
            if (nextAssets[index] !== previousAssets[index]) {
                changedIds.add(nextAssets[index].id);
            }
        }
        const previousSet = new Set(activeAssetIdsRef.current);
        const nextSet = new Set(nextIds);
        for (const assetId of previousSet) {
            if (!nextSet.has(assetId)) {
                changedIds.add(assetId);
            }
        }
        for (const assetId of nextSet) {
            if (!previousSet.has(assetId)) {
                changedIds.add(assetId);
            }
        }
        setAllAssets(nextAssets);
        bumpPhotoMetadataVersion();
        setActiveAssetIds(nextIds);
        setIsProjectSelectorOpen(false);
        queueXmpSync(Array.from(changedIds));
        addToast(`Selezione aggiornata: ${nextIds.length} foto attive.`, "success");
    }, [addToast, bumpPhotoMetadataVersion, queueXmpSync]);
    const handleExportSelection = useCallback(() => {
        const result = buildSelectionResult(PROJECT_ID, projectName, allAssets, activeAssetIds);
        const json = JSON.stringify(result, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${projectName.replace(/[^a-zA-Z0-9_-]/g, "_")}_selection.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addToast(`Selezione esportata: ${activeAssetIds.length} foto in "${a.download}".`, "success");
    }, [activeAssetIds, addToast, allAssets, projectName]);
    // ── Viewport tracking for pipeline priority ──────────────────────────
    const handleVisibleIdsChange = useCallback((ids) => {
        if (areSetsEqual(visibleThumbnailIdsRef.current, ids)) {
            return;
        }
        visibleThumbnailIdsRef.current = ids;
        enqueueVisibleThumbnailEntries(ids, 0);
        pipelineRef.current?.updateViewport(ids, mergeSets(prioritizedThumbnailIdsRef.current, previewPriorityIdsRef.current));
    }, [enqueueVisibleThumbnailEntries]);
    const handlePriorityIdsChange = useCallback((ids) => {
        if (areSetsEqual(prioritizedThumbnailIdsRef.current, ids)) {
            return;
        }
        prioritizedThumbnailIdsRef.current = ids;
        enqueuePriorityThumbnailEntries(ids, 1);
        enqueuePreviewWarmupForIds(ids, 0, RAW_PREVIEW_FILTER_WARM_COUNT);
        pipelineRef.current?.updateViewport(visibleThumbnailIdsRef.current, mergeSets(ids, previewPriorityIdsRef.current));
    }, [enqueuePreviewWarmupForIds, enqueuePriorityThumbnailEntries]);
    const handlePreviewPriorityIdsChange = useCallback((ids) => {
        if (areSetsEqual(previewPriorityIdsRef.current, ids)) {
            return;
        }
        previewPriorityIdsRef.current = ids;
        enqueuePriorityThumbnailEntries(ids, 0);
        enqueueQuickPreviewWarmupForIds(ids, 0, QUICK_PREVIEW_PRIORITY_WARM_COUNT);
        pipelineRef.current?.updateViewport(visibleThumbnailIdsRef.current, mergeSets(prioritizedThumbnailIdsRef.current, ids));
    }, [enqueuePriorityThumbnailEntries, enqueueQuickPreviewWarmupForIds]);
    useEffect(() => {
        let cancelled = false;
        void getDesktopRuntimeInfo().then((runtimeInfo) => {
            if (!cancelled) {
                setDesktopRuntime(runtimeInfo);
            }
        });
        return () => {
            cancelled = true;
        };
    }, []);
    useEffect(() => {
        void refreshDesktopThumbnailCacheInfo();
        void refreshDesktopCacheLocationRecommendation();
    }, [refreshDesktopCacheLocationRecommendation, refreshDesktopThumbnailCacheInfo]);
    useEffect(() => {
        if (currentScreen !== "selection" || importProgress.isOpen) {
            setIsDesktopCacheRecommendationModalOpen(false);
            return;
        }
        if (!desktopCacheLocationRecommendation?.shouldPrompt
            || isDesktopCacheRecommendationSnoozedForSession) {
            return;
        }
        setIsDesktopCacheRecommendationModalOpen(true);
    }, [
        currentScreen,
        desktopCacheLocationRecommendation?.shouldPrompt,
        importProgress.isOpen,
        isDesktopCacheRecommendationSnoozedForSession,
    ]);
    useEffect(() => {
        if (!desktopCacheLocationRecommendation?.shouldPrompt) {
            setIsDesktopCacheRecommendationModalOpen(false);
            setIsDesktopCacheRecommendationSnoozedForSession(false);
        }
    }, [desktopCacheLocationRecommendation?.shouldPrompt]);
    useEffect(() => {
        if (usesMockData || allAssets.length === 0) {
            setXmpSyncState({
                phase: "idle",
                pending: 0,
                failed: 0,
                lastSyncedAt: null,
            });
            return;
        }
        if (!hasWritableFolderAccess) {
            setXmpSyncState((current) => ({
                phase: "unavailable",
                pending: 0,
                failed: current.failed,
                lastSyncedAt: current.lastSyncedAt,
            }));
        }
    }, [allAssets.length, hasWritableFolderAccess, usesMockData]);
    useEffect(() => {
        if (!importProgress.isOpen)
            return;
        if (importProgress.total === 0 || importProgress.processed < importProgress.total)
            return;
        const timeoutId = window.setTimeout(() => {
            setIsImportPanelDismissed(false);
            setImportProgress((current) => (current.isOpen && current.processed >= current.total
                ? { ...current, isOpen: false }
                : current));
        }, 280);
        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [importProgress]);
    // ── Persist classification + active selection to XMP sidecars ───────
    useEffect(() => {
        if (usesMockData || !hasWritableFolderAccess || allAssets.length === 0 || pendingXmpSyncIdsRef.current.size === 0)
            return;
        if (xmpSyncTimerRef.current !== null) {
            window.clearTimeout(xmpSyncTimerRef.current);
        }
        xmpSyncTimerRef.current = window.setTimeout(() => {
            xmpSyncTimerRef.current = null;
            void flushPendingXmpSync();
        }, 700);
        return () => {
            if (xmpSyncTimerRef.current !== null) {
                window.clearTimeout(xmpSyncTimerRef.current);
            }
        };
    }, [allAssets.length, flushPendingXmpSync, hasWritableFolderAccess, usesMockData, xmpSyncVersion]);
    // ── Computed values ──────────────────────────────────────────────────
    const emptyUsageMap = useMemo(() => new Map(), []);
    const isGeneratingThumbnails = thumbnailProgress.total > 0 && thumbnailProgress.done < thumbnailProgress.total;
    const shouldShowXmpBanner = !isXmpBannerDismissed &&
        !usesMockData &&
        allAssets.length > 0 &&
        !hasWritableFolderAccess;
    const xmpSyncLabel = xmpSyncState.phase === "pending"
        ? `XMP in coda (${xmpSyncState.pending})`
        : xmpSyncState.phase === "syncing"
            ? `XMP in scrittura (${xmpSyncState.pending})`
            : xmpSyncState.phase === "saved"
                ? `XMP aggiornati alle ${formatSyncTimestamp(xmpSyncState.lastSyncedAt)}`
                : xmpSyncState.phase === "error"
                    ? `XMP con errori (${xmpSyncState.failed})`
                    : xmpSyncState.phase === "unavailable"
                        ? "XMP non disponibili"
                        : "XMP pronti";
    // ── Render ───────────────────────────────────────────────────────────
    return (_jsx(ErrorBoundary, { children: _jsxs("div", { className: "photo-selector-app", children: [_jsxs("header", { className: "app-header", children: [_jsx("img", { src: logo, alt: "Logo", style: { height: 40, marginRight: 16 } }), _jsxs("div", { className: "app-header__brand", children: [_jsx("h1", { className: "app-header__title", children: "Selezione Foto" }), _jsx("span", { className: "app-header__subtitle", children: "Photo Tools Suite" })] }), _jsxs("nav", { className: "app-header__nav", children: [_jsx("button", { type: "button", className: currentScreen === "browse" ? "app-header__tab app-header__tab--active" : "app-header__tab", onClick: () => setCurrentScreen("browse"), children: "Sfoglia" }), _jsxs("button", { type: "button", className: currentScreen === "selection" ? "app-header__tab app-header__tab--active" : "app-header__tab", onClick: () => setCurrentScreen("selection"), disabled: allAssets.length === 0, children: ["Selezione (", activeAssetIds.length, ")"] }), _jsx("button", { type: "button", className: currentScreen === "review" ? "app-header__tab app-header__tab--active" : "app-header__tab", onClick: () => setCurrentScreen("review"), disabled: activeAssetIds.length === 0, children: "Riepilogo" })] }), _jsxs("div", { className: "app-header__actions", children: [isGeneratingThumbnails ? (_jsxs("button", { type: "button", className: "app-header__pipeline-status app-header__pipeline-status--button", onClick: () => setIsImportPanelDismissed(false), title: "Mostra stato caricamento", children: [_jsx("div", { className: "pipeline-progress", children: _jsx("div", { className: "pipeline-progress__fill", style: { width: `${Math.round((thumbnailProgress.done / Math.max(1, thumbnailProgress.total)) * 100)}%` } }) }), _jsxs("span", { className: "pipeline-progress__label", children: [thumbnailProgress.done, "/", thumbnailProgress.total] })] })) : null, allAssets.length > 0 ? (_jsx("button", { type: "button", className: "ghost-button", onClick: () => setCurrentScreen("browse"), children: "Apri cartella" })) : null, allAssets.length > 0 ? (_jsx("button", { type: "button", className: "secondary-button", onClick: () => setIsProjectSelectorOpen(true), children: "Selezione progetto" })) : null, !usesMockData && allAssets.length > 0 ? (_jsx("div", { className: `app-header__sync-status app-header__sync-status--${xmpSyncState.phase}`, children: xmpSyncLabel })) : null, allAssets.length > 0 ? (_jsx("div", { className: "app-header__folder-pill", children: sourceFolderPath || "Cartella attiva" })) : null, _jsx("label", { className: "field app-header__project-name", children: _jsx("input", { type: "text", value: projectName, onChange: (e) => setProjectName(e.target.value), placeholder: "Nome progetto" }) })] })] }), _jsxs("main", { className: "app-main", children: [shouldShowXmpBanner ? (_jsx(DismissibleBanner, { title: "Sincronizzazione XMP non attiva", message: hasNativeFolderAccess()
                                ? "La sessione e' stata riaperta senza il collegamento scrivibile alla cartella. Rating, pick e colori non verranno scritti nei sidecar finché non riapri la cartella."
                                : desktopRuntime
                                    ? `La shell desktop FileX e' attiva per ${desktopRuntime.toolName}, ma in questa prima integrazione il flusso cartella/XMP usa ancora il bridge browser. Il collegamento nativo e' il prossimo step.`
                                    : "Questo browser usa l'import fallback e non puo' scrivere i sidecar XMP. Per un workflow automatico stile Bridge/Photo Mechanic riapri il tool in Edge o Chrome.", type: "warning", action: sourceFolderPath
                                ? {
                                    label: "Vai a Sfoglia",
                                    onClick: () => setCurrentScreen("browse"),
                                }
                                : undefined, onDismiss: () => setIsXmpBannerDismissed(true) })) : null, folderDiagnostics ? (_jsxs("div", { className: "folder-diagnostics-panel", role: "status", "aria-live": "polite", children: [_jsxs("div", { className: "folder-diagnostics-panel__header", children: [_jsxs("div", { children: [_jsx("strong", { children: "Diagnostica cartella" }), _jsx("span", { children: formatFolderDiagnosticsSource(folderDiagnostics.source) })] }), _jsxs("div", { className: "folder-diagnostics-panel__badge", children: [folderDiagnostics.topLevelSupportedCount, " top-level"] })] }), _jsxs("div", { className: "folder-diagnostics-panel__grid", children: [_jsxs("div", { className: "folder-diagnostics-panel__item", children: [_jsx("span", { children: "Path selezionato" }), _jsx("strong", { title: folderDiagnostics.selectedPath, children: folderDiagnostics.selectedPath })] }), _jsxs("div", { className: "folder-diagnostics-panel__item", children: [_jsx("span", { children: "Top-level caricati" }), _jsx("strong", { children: folderDiagnostics.topLevelSupportedCount })] }), _jsxs("div", { className: "folder-diagnostics-panel__item", children: [_jsx("span", { children: "Annidati scartati" }), _jsx("strong", { children: folderDiagnostics.nestedSupportedDiscardedCount })] }), _jsxs("div", { className: "folder-diagnostics-panel__item", children: [_jsx("span", { children: "Totale supportate viste" }), _jsx("strong", { children: folderDiagnostics.totalSupportedSeen })] }), _jsxs("div", { className: "folder-diagnostics-panel__item", children: [_jsx("span", { children: "Sottocartelle viste" }), _jsx("strong", { children: folderDiagnostics.nestedDirectoriesSeen ?? 0 })] })] })] })) : null, currentScreen === "browse" ? (_jsx("div", { className: "app-section", children: _jsx(FolderBrowser, { onFolderOpened: handleFolderOpened }) })) : null, currentScreen === "selection" ? (_jsx("div", { className: "app-section app-section--full", children: _jsx(PhotoSelector, { photos: allAssets, metadataVersion: photoMetadataVersion, sourceFolderPath: sourceFolderPath, selectedIds: activeAssetIds, onSelectionChange: handleSelectionChange, onPhotosChange: handlePhotosChange, onVisibleIdsChange: handleVisibleIdsChange, onPriorityIdsChange: handlePriorityIdsChange, onPreviewPriorityIdsChange: handlePreviewPriorityIdsChange, onUndo: undoRedo.undo, onRedo: undoRedo.redo, canUndo: undoRedo.canUndo, canRedo: undoRedo.canRedo, thumbnailProfile: thumbnailProfile, sortCacheEnabled: sortCacheEnabled, performanceSnapshot: performanceSnapshot, onThumbnailProfileChange: setThumbnailProfile, onSortCacheEnabledChange: setSortCacheEnabled, desktopThumbnailCacheInfo: desktopThumbnailCacheInfo, desktopCacheLocationRecommendation: desktopCacheLocationRecommendation, isDesktopThumbnailCacheBusy: isDesktopThumbnailCacheBusy, isDesktopCacheRecommendationModalOpen: isDesktopCacheRecommendationModalOpen, onChooseDesktopThumbnailCacheDirectory: handleChooseDesktopThumbnailCacheDirectory, onSetDesktopThumbnailCacheDirectory: handleSetDesktopThumbnailCacheDirectory, onUseRecommendedDesktopThumbnailCacheDirectory: handleUseRecommendedDesktopThumbnailCacheDirectory, onResetDesktopThumbnailCacheDirectory: handleResetDesktopThumbnailCacheDirectory, onClearDesktopThumbnailCache: handleClearDesktopThumbnailCache, onSnoozeDesktopCacheRecommendation: handleSnoozeDesktopCacheRecommendation, onDismissDesktopCacheRecommendation: handleDismissDesktopCacheRecommendation }) })) : null, currentScreen === "review" ? (_jsx("div", { className: "app-section", children: _jsx(SelectionSummary, { allAssets: allAssets, activeAssetIds: activeAssetIds, projectName: projectName, onExportSelection: handleExportSelection, onBackToSelection: () => setCurrentScreen("selection"), onOpenProjectSelector: () => setIsProjectSelectorOpen(true) }) })) : null] }), isProjectSelectorOpen ? (_jsx(ProjectPhotoSelectorModal, { assets: allAssets, activeAssetIds: activeAssetIds, usageByAssetId: emptyUsageMap, onClose: () => setIsProjectSelectorOpen(false), onApply: handleSelectorApply })) : null, _jsx(ImportProgressModal, { isOpen: importProgress.isOpen && !isImportPanelDismissed, phase: importProgress.phase, supported: importProgress.supported, ignored: importProgress.ignored, total: importProgress.total, processed: importProgress.processed, currentFile: importProgress.currentFile, folderLabel: importProgress.folderLabel, diagnostics: importProgress.diagnostics, onDismiss: () => setIsImportPanelDismissed(true), onCancel: handleCancelImport })] }) }));
}
//# sourceMappingURL=App.js.map