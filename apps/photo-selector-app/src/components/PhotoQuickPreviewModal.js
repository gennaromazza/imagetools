import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { preloadImageUrls } from "../services/image-cache";
import { getCachedDesktopQuickPreviewFrame, getDesktopQuickPreviewFrame, hasDesktopQuickPreviewApi, invalidateDesktopQuickPreviewFrame, peekDesktopQuickPreviewFrame, warmDesktopQuickPreviewFrames, } from "../services/desktop-quick-preview";
import { createOnDemandPreviewAsync, getAssetAbsolutePath, getCachedOnDemandPreviewUrl, isRawFile, saveAssetAs, warmOnDemandPreviewCache, } from "../services/folder-access";
import { getDesktopPerformanceSnapshot, logDesktopEvent, recordDesktopPerformanceSnapshot, } from "../services/desktop-store";
import { PhotoClassificationHelpButton } from "./PhotoClassificationHelpButton";
import { COLOR_LABEL_NAMES, COLOR_LABELS, DEFAULT_PHOTO_FILTERS, formatAssetStars, getAssetColorLabel, getAssetPickStatus, getAssetRating, getColorShortcutHint, matchesPhotoFilters, PICK_STATUS_LABELS, resolvePhotoClassificationShortcut } from "../services/photo-classification";
const orientationLabels = {
    horizontal: "Orizzontale",
    vertical: "Verticale",
    square: "Quadrata"
};
const MIN_RAW_PREVIEW_DIMENSION = 900;
const DOCK_THUMB_ESTIMATED_SIZE = 81;
const DOCK_THUMB_OVERSCAN = 4;
const QUICK_PREVIEW_DESKTOP_FALLBACK_DELAY_MS = 80;
const QUICK_PREVIEW_DETAIL_IDLE_DELAY_MS = 160;
function getVirtualStripRange(totalCount, itemSize, overscan, viewport, anchorIndex) {
    if (totalCount <= 0) {
        return { start: 0, endExclusive: 0 };
    }
    if (viewport.viewportSize <= 0) {
        const centeredStart = anchorIndex >= 0
            ? Math.max(0, anchorIndex - overscan - 2)
            : 0;
        const endExclusive = Math.min(totalCount, centeredStart + 8 + overscan * 2);
        return { start: centeredStart, endExclusive };
    }
    const visibleCount = Math.max(1, Math.ceil(viewport.viewportSize / itemSize));
    const start = Math.max(0, Math.floor(viewport.scrollOffset / itemSize) - overscan);
    const endExclusive = Math.min(totalCount, start + visibleCount + overscan * 2);
    return { start, endExclusive };
}
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
function getPreviewColorClass(colorLabel) {
    return colorLabel ? `quick-preview__stage--color-${colorLabel}` : "quick-preview__stage--color-none";
}
function formatDesktopPreviewSourceLabel(stage, source, cacheHit, sourceOverride) {
    const stageLabel = stage === "detail" ? "Detail" : "Fit";
    const sourceLabel = sourceOverride ?? (source === "memory-cache"
        ? "memory-cache"
        : source === "disk-cache"
            ? "disk-cache"
            : source === "embedded-preview"
                ? "embedded-preview"
                : source === "native-provider"
                    ? "native-provider"
                    : "source-file");
    return `${stageLabel} | ${sourceLabel}${cacheHit ? " | hit" : ""}`;
    return `${stageLabel} · ${sourceLabel}${cacheHit ? " · hit" : ""}`;
}
function createDesktopManagedPreviewState(assetId, stage, frame, sourceOverride) {
    const cacheHit = sourceOverride ? true : frame.cacheHit;
    return {
        assetId,
        url: frame.src,
        token: frame.token,
        sourceLabel: formatDesktopPreviewSourceLabel(stage, frame.source, cacheHit, sourceOverride),
        cacheHit,
    };
}
export function PhotoQuickPreviewModal({ asset, assets = [], thumbnailProfile = "ultra-fast", startZoomed = false, usageByAssetId, pages = [], activePageId, customLabelsCatalog = [], customLabelColors = {}, customLabelShortcuts = {}, onClose, onSelectAsset, onAddToPage, onJumpToPage, onUpdateAsset }) {
    const stageRef = useRef(null);
    const dockStripRef = useRef(null);
    const dockScrollRafRef = useRef(null);
    const pendingDockViewportRef = useRef(null);
    const assignFeedbackTimeoutRef = useRef(null);
    const classificationFeedbackTimeoutRef = useRef(null);
    const previewWarmupTimeoutRef = useRef(null);
    const detailPreviewTimeoutRef = useRef(null);
    const fallbackPreviewTimeoutRef = useRef(null);
    const pendingSelectionReasonRef = useRef(null);
    const previewPerfStartRef = useRef(null);
    const detailPreviewPerfStartRef = useRef(null);
    const mainPreviewRecoveryKeyRef = useRef(null);
    const comparePreviewRecoveryKeyRef = useRef(null);
    const lastAssetIdRef = useRef(null);
    const lastPerfSinkSignatureRef = useRef("");
    const fallbackSignatureRef = useRef("");
    const previewFrameMetricsRef = useRef({
        requested: 0,
        cacheHits: 0,
        fallbackCount: 0,
        sourceCounts: new Map(),
    });
    const classificationFeedbackTokenRef = useRef(0);
    const [filterPickStatus, setFilterPickStatus] = useState(DEFAULT_PHOTO_FILTERS.pickStatus);
    const [filterRating, setFilterRating] = useState(DEFAULT_PHOTO_FILTERS.ratingFilter);
    const [filterColorLabel, setFilterColorLabel] = useState(DEFAULT_PHOTO_FILTERS.colorLabel);
    const [filterCustomLabel, setFilterCustomLabel] = useState("all");
    const [assignFeedbackPageNumber, setAssignFeedbackPageNumber] = useState(null);
    const [resolvedPreview, setResolvedPreview] = useState(null);
    const [resolvedDetailPreview, setResolvedDetailPreview] = useState(null);
    const [compareMode, setCompareMode] = useState(false);
    const [compareAssetId, setCompareAssetId] = useState(null);
    const [resolvedComparePreview, setResolvedComparePreview] = useState(null);
    const [classificationFeedback, setClassificationFeedback] = useState(null);
    const [quickPreviewPerf, setQuickPreviewPerf] = useState({
        openLatencyMs: null,
        navigationLatencyMs: null,
        fitLatencyMs: null,
        detailLatencyMs: null,
        warmHitRate: null,
        fallbackCount: 0,
        sourceBreakdown: "n/d",
        lastRenderedSource: "n/d",
        lastRenderedAssetName: "",
    });
    const [zoomLevel, setZoomLevel] = useState(startZoomed ? 2.2 : 1);
    const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [dockViewport, setDockViewport] = useState({
        scrollOffset: 0,
        viewportSize: 0,
    });
    const [stageViewport, setStageViewport] = useState({
        width: 0,
        height: 0,
        devicePixelRatio: 1,
    });
    const panDragRef = useRef(null);
    const panAnimationFrameRef = useRef(null);
    const pendingPanOffsetRef = useRef(null);
    const usage = asset ? usageByAssetId?.get(asset.id) : undefined;
    const activePage = useMemo(() => pages.find((page) => page.id === activePageId) ?? null, [activePageId, pages]);
    const desktopQuickPreviewEnabled = useMemo(() => hasDesktopQuickPreviewApi(), []);
    const fitPreviewCap = thumbnailProfile === "ultra-fast"
        ? 1600
        : thumbnailProfile === "fast"
            ? 1920
            : 2560;
    const detailPreviewCap = thumbnailProfile === "ultra-fast"
        ? 2800
        : thumbnailProfile === "fast"
            ? 3200
            : 4096;
    const stageBaseDimension = useMemo(() => {
        const effectiveWidth = compareMode ? Math.max(0, stageViewport.width / 2) : stageViewport.width;
        const basePixels = Math.ceil(Math.max(effectiveWidth, stageViewport.height) * Math.max(1, stageViewport.devicePixelRatio));
        return basePixels > 0 ? basePixels : 0;
    }, [compareMode, stageViewport.devicePixelRatio, stageViewport.height, stageViewport.width]);
    const fitPreviewMaxDimension = useMemo(() => {
        void stageBaseDimension;
        return fitPreviewCap;
    }, [fitPreviewCap, stageBaseDimension]);
    const detailPreviewMaxDimension = useMemo(() => {
        void stageBaseDimension;
        void fitPreviewMaxDimension;
        return detailPreviewCap;
    }, [detailPreviewCap, fitPreviewMaxDimension, stageBaseDimension]);
    const adjacentPreviewWarmupDelayMs = desktopQuickPreviewEnabled
        ? 24
        : thumbnailProfile === "ultra-fast"
            ? 520
            : thumbnailProfile === "fast"
                ? 260
                : 140;
    const adjacentStandardPreviewWarmupDelayMs = desktopQuickPreviewEnabled
        ? 24
        : thumbnailProfile === "ultra-fast"
            ? 40
            : thumbnailProfile === "fast"
                ? 90
                : 140;
    const hasActiveFilters = filterPickStatus !== "all"
        || filterRating !== "any"
        || filterColorLabel !== "all"
        || filterCustomLabel !== "all";
    const filteredAssets = useMemo(() => assets.filter((item) => matchesPhotoFilters(item, {
        pickStatus: filterPickStatus,
        ratingFilter: filterRating,
        colorLabel: filterColorLabel
    })
        && (filterCustomLabel === "all"
            || (item.customLabels ?? []).some((label) => label.toLocaleLowerCase() === filterCustomLabel.toLocaleLowerCase()))), [assets, filterColorLabel, filterCustomLabel, filterRating, filterPickStatus]);
    const selectAssetFromPreview = useCallback((assetId, reason = "jump") => {
        if (!onSelectAsset) {
            return;
        }
        pendingSelectionReasonRef.current = reason;
        onSelectAsset(assetId);
    }, [onSelectAsset]);
    useEffect(() => {
        if (!asset || !onSelectAsset || !hasActiveFilters) {
            return;
        }
        const assetIsVisible = filteredAssets.some((item) => item.id === asset.id);
        if (!assetIsVisible && filteredAssets.length > 0) {
            selectAssetFromPreview(filteredAssets[0].id, "jump");
        }
    }, [asset, filteredAssets, hasActiveFilters, onSelectAsset, selectAssetFromPreview]);
    const navigationAssets = hasActiveFilters ? filteredAssets : assets;
    const currentIndex = useMemo(() => (asset ? navigationAssets.findIndex((item) => item.id === asset.id) : -1), [asset, navigationAssets]);
    const previousAsset = currentIndex > 0 ? navigationAssets[currentIndex - 1] : null;
    const nextAsset = currentIndex >= 0 && currentIndex < navigationAssets.length - 1
        ? navigationAssets[currentIndex + 1]
        : null;
    const compareAsset = compareAssetId
        ? navigationAssets.find((item) => item.id === compareAssetId && item.id !== asset?.id) ?? null
        : null;
    const assetAbsolutePath = asset ? getAssetAbsolutePath(asset.id) : undefined;
    const compareAssetAbsolutePath = compareAsset ? getAssetAbsolutePath(compareAsset.id) : undefined;
    const canUseDesktopQuickPreview = Boolean(desktopQuickPreviewEnabled && assetAbsolutePath);
    const canUseDesktopQuickPreviewForCompare = Boolean(desktopQuickPreviewEnabled && compareAssetAbsolutePath);
    const syncPreviewFrameMetrics = useCallback(() => {
        const metrics = previewFrameMetricsRef.current;
        const sourceBreakdown = Array.from(metrics.sourceCounts.entries())
            .sort((left, right) => right[1] - left[1])
            .map(([source, count]) => `${source}:${count}`)
            .join(" · ") || "n/d";
        const warmHitRate = metrics.requested > 0
            ? Math.round((metrics.cacheHits / metrics.requested) * 100)
            : null;
        setQuickPreviewPerf((current) => ({
            ...current,
            warmHitRate,
            fallbackCount: metrics.fallbackCount,
            sourceBreakdown,
        }));
    }, []);
    const recordPreviewFrameMetric = useCallback((sourceLabel, cacheHit) => {
        const metrics = previewFrameMetricsRef.current;
        metrics.requested += 1;
        if (cacheHit) {
            metrics.cacheHits += 1;
        }
        metrics.sourceCounts.set(sourceLabel, (metrics.sourceCounts.get(sourceLabel) ?? 0) + 1);
        syncPreviewFrameMetrics();
    }, [syncPreviewFrameMetrics]);
    const recordPreviewFallbackUsage = useCallback(() => {
        previewFrameMetricsRef.current.fallbackCount += 1;
        syncPreviewFrameMetrics();
    }, [syncPreviewFrameMetrics]);
    const handleNavigate = useCallback((direction) => {
        if (currentIndex < 0) {
            return;
        }
        const targetIndex = direction === "previous" ? currentIndex - 1 : currentIndex + 1;
        const targetAsset = navigationAssets[targetIndex];
        if (targetAsset) {
            selectAssetFromPreview(targetAsset.id, "navigate");
        }
    }, [currentIndex, navigationAssets, selectAssetFromPreview]);
    const announceClassificationFeedback = useCallback((changes) => {
        let tone;
        let labels;
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
            token: classificationFeedbackTokenRef.current,
            tone,
            labels,
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
    const announceCustomLabelFeedback = useCallback((label, nextIsActive) => {
        classificationFeedbackTokenRef.current += 1;
        const nextFeedback = {
            kind: "label",
            label: nextIsActive ? `Etichetta assegnata: ${label}` : `Etichetta rimossa: ${label}`,
            token: classificationFeedbackTokenRef.current,
            tone: customLabelColors[label] ?? "sand",
            labels: [label],
        };
        setClassificationFeedback(nextFeedback);
        if (classificationFeedbackTimeoutRef.current !== null) {
            window.clearTimeout(classificationFeedbackTimeoutRef.current);
        }
        classificationFeedbackTimeoutRef.current = window.setTimeout(() => {
            setClassificationFeedback((current) => current?.token === nextFeedback.token ? null : current);
            classificationFeedbackTimeoutRef.current = null;
        }, 1450);
    }, [customLabelColors]);
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
    const getQuickPreviewThumbUrl = useCallback((item) => {
        return item.thumbnailUrl ?? item.previewUrl ?? null;
    }, []);
    const dockVirtualRange = useMemo(() => getVirtualStripRange(navigationAssets.length, DOCK_THUMB_ESTIMATED_SIZE, DOCK_THUMB_OVERSCAN, dockViewport, currentIndex), [currentIndex, dockViewport, navigationAssets.length]);
    const dockStripItems = useMemo(() => navigationAssets.slice(dockVirtualRange.start, dockVirtualRange.endExclusive), [dockVirtualRange.endExclusive, dockVirtualRange.start, navigationAssets]);
    const dockLeftSpacerWidth = dockVirtualRange.start * DOCK_THUMB_ESTIMATED_SIZE;
    const dockRightSpacerWidth = Math.max(0, (navigationAssets.length - dockVirtualRange.endExclusive) * DOCK_THUMB_ESTIMATED_SIZE);
    useEffect(() => {
        const element = stageRef.current;
        if (!element) {
            return;
        }
        const sync = () => {
            setStageViewport({
                width: element.clientWidth,
                height: element.clientHeight,
                devicePixelRatio: typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
                    ? window.devicePixelRatio
                    : 1,
            });
        };
        sync();
        const resizeObserver = new ResizeObserver(sync);
        resizeObserver.observe(element);
        if (typeof window !== "undefined") {
            window.addEventListener("resize", sync);
        }
        return () => {
            resizeObserver.disconnect();
            if (typeof window !== "undefined") {
                window.removeEventListener("resize", sync);
            }
        };
    }, [asset?.id, compareMode]);
    // Preload only prev/current/next thumbnails or lightweight previews.
    useEffect(() => {
        if (desktopQuickPreviewEnabled) {
            return;
        }
        if (currentIndex < 0)
            return;
        const toPreload = [];
        for (const candidate of [previousAsset, asset, nextAsset]) {
            if (!candidate) {
                continue;
            }
            const thumbUrl = getQuickPreviewThumbUrl(candidate);
            if (thumbUrl) {
                toPreload.push(thumbUrl);
            }
        }
        preloadImageUrls(toPreload);
    }, [asset, currentIndex, desktopQuickPreviewEnabled, getQuickPreviewThumbUrl, nextAsset, previousAsset]);
    useEffect(() => {
        if (desktopQuickPreviewEnabled) {
            return;
        }
        if (currentIndex < 0) {
            return;
        }
        const standardCandidates = [asset, previousAsset, nextAsset].filter((candidate) => {
            if (!candidate) {
                return false;
            }
            return !shouldLoadRawPreview(candidate);
        });
        if (standardCandidates.length === 0) {
            return;
        }
        const timer = window.setTimeout(() => {
            void Promise.all(standardCandidates.map((candidate, index) => createOnDemandPreviewAsync(candidate.id, index === 0 ? 0 : 1, {
                maxDimension: fitPreviewMaxDimension,
            }).catch(() => null)));
        }, adjacentStandardPreviewWarmupDelayMs);
        return () => window.clearTimeout(timer);
    }, [
        adjacentStandardPreviewWarmupDelayMs,
        asset,
        currentIndex,
        desktopQuickPreviewEnabled,
        fitPreviewMaxDimension,
        nextAsset,
        previousAsset,
    ]);
    const availableCustomLabels = useMemo(() => {
        const merged = [...customLabelsCatalog, ...Object.keys(customLabelColors)];
        const seen = new Set();
        const labels = [];
        for (const value of merged) {
            const cleaned = value.replace(/\s+/g, " ").trim().slice(0, 48);
            if (!cleaned) {
                continue;
            }
            const key = cleaned.toLocaleLowerCase();
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            labels.push(cleaned);
        }
        return labels;
    }, [customLabelColors, customLabelsCatalog]);
    const customLabelByShortcut = useMemo(() => {
        const entries = Object.entries(customLabelShortcuts)
            .filter((entry) => Boolean(entry[1]));
        return new Map(entries.map(([label, shortcut]) => [shortcut, label]));
    }, [customLabelShortcuts]);
    const activePreviewAssetNeedsManagedPreview = Boolean(asset && (canUseDesktopQuickPreview
        || !asset.previewUrl
        || !asset.sourceUrl
        || shouldLoadRawPreview(asset)));
    const desktopFitPreviewRequest = useMemo(() => {
        if (!asset || !canUseDesktopQuickPreview || !assetAbsolutePath || !activePreviewAssetNeedsManagedPreview) {
            return null;
        }
        return {
            absolutePath: assetAbsolutePath,
            maxDimension: fitPreviewMaxDimension,
            sourceFileKey: asset.sourceFileKey,
            stage: "fit",
        };
    }, [
        activePreviewAssetNeedsManagedPreview,
        asset,
        assetAbsolutePath,
        canUseDesktopQuickPreview,
        fitPreviewMaxDimension,
    ]);
    const desktopDetailPreviewRequest = useMemo(() => {
        if (!asset
            || !canUseDesktopQuickPreview
            || !assetAbsolutePath
            || !activePreviewAssetNeedsManagedPreview
            || compareMode
            || zoomLevel <= 1.05) {
            return null;
        }
        return {
            absolutePath: assetAbsolutePath,
            maxDimension: detailPreviewMaxDimension,
            sourceFileKey: asset.sourceFileKey,
            stage: "detail",
        };
    }, [
        activePreviewAssetNeedsManagedPreview,
        asset,
        assetAbsolutePath,
        canUseDesktopQuickPreview,
        compareMode,
        detailPreviewMaxDimension,
        zoomLevel,
    ]);
    const desktopComparePreviewRequest = useMemo(() => {
        if (!compareAsset || !canUseDesktopQuickPreviewForCompare || !compareAssetAbsolutePath) {
            return null;
        }
        return {
            absolutePath: compareAssetAbsolutePath,
            maxDimension: fitPreviewMaxDimension,
            sourceFileKey: compareAsset.sourceFileKey,
            stage: "fit",
        };
    }, [
        canUseDesktopQuickPreviewForCompare,
        compareAsset,
        compareAssetAbsolutePath,
        fitPreviewMaxDimension,
    ]);
    const immediateFitPreview = useMemo(() => {
        if (!asset || !desktopFitPreviewRequest) {
            return null;
        }
        const frame = peekDesktopQuickPreviewFrame(desktopFitPreviewRequest);
        return frame ? createDesktopManagedPreviewState(asset.id, "fit", frame, "renderer-cache") : null;
    }, [asset, desktopFitPreviewRequest]);
    const immediateDetailPreview = useMemo(() => {
        if (!asset || !desktopDetailPreviewRequest) {
            return null;
        }
        const frame = peekDesktopQuickPreviewFrame(desktopDetailPreviewRequest);
        return frame ? createDesktopManagedPreviewState(asset.id, "detail", frame, "renderer-cache") : null;
    }, [asset, desktopDetailPreviewRequest]);
    const immediateComparePreview = useMemo(() => {
        if (!compareAsset || !desktopComparePreviewRequest) {
            return null;
        }
        const frame = peekDesktopQuickPreviewFrame(desktopComparePreviewRequest);
        return frame ? createDesktopManagedPreviewState(compareAsset.id, "fit", frame, "renderer-cache") : null;
    }, [compareAsset, desktopComparePreviewRequest]);
    useEffect(() => {
        if (previewWarmupTimeoutRef.current !== null) {
            window.clearTimeout(previewWarmupTimeoutRef.current);
            previewWarmupTimeoutRef.current = null;
        }
        if (currentIndex < 0) {
            return;
        }
        if (desktopQuickPreviewEnabled) {
            const warmCandidates = navigationAssets
                .slice(Math.max(0, currentIndex - 3), Math.min(navigationAssets.length, currentIndex + 4))
                .map((candidate) => {
                const absolutePath = getAssetAbsolutePath(candidate.id);
                if (!absolutePath) {
                    return null;
                }
                return {
                    absolutePath,
                    maxDimension: fitPreviewMaxDimension,
                    sourceFileKey: candidate.sourceFileKey,
                    stage: "fit",
                };
            })
                .filter((candidate) => candidate !== null);
            if (warmCandidates.length > 0) {
                previewWarmupTimeoutRef.current = window.setTimeout(() => {
                    previewWarmupTimeoutRef.current = null;
                    void warmDesktopQuickPreviewFrames(warmCandidates);
                }, adjacentPreviewWarmupDelayMs);
            }
            return () => {
                if (previewWarmupTimeoutRef.current !== null) {
                    window.clearTimeout(previewWarmupTimeoutRef.current);
                    previewWarmupTimeoutRef.current = null;
                }
            };
        }
        const adjacentManagedWarmups = [previousAsset, nextAsset].filter((candidate) => {
            if (!candidate) {
                return false;
            }
            if (!shouldLoadRawPreview(candidate) && (candidate.previewUrl || candidate.sourceUrl)) {
                return false;
            }
            return true;
        });
        if (adjacentManagedWarmups.length > 0) {
            previewWarmupTimeoutRef.current = window.setTimeout(() => {
                previewWarmupTimeoutRef.current = null;
                void Promise.all(adjacentManagedWarmups.map((candidate) => warmOnDemandPreviewCache(candidate.id, 2, {
                    maxDimension: fitPreviewMaxDimension,
                }).catch(() => null)));
            }, adjacentPreviewWarmupDelayMs);
        }
        return () => {
            if (previewWarmupTimeoutRef.current !== null) {
                window.clearTimeout(previewWarmupTimeoutRef.current);
                previewWarmupTimeoutRef.current = null;
            }
        };
    }, [
        adjacentPreviewWarmupDelayMs,
        currentIndex,
        desktopQuickPreviewEnabled,
        fitPreviewMaxDimension,
        navigationAssets,
        nextAsset,
        previousAsset,
    ]);
    useEffect(() => {
        return () => {
            if (previewWarmupTimeoutRef.current !== null) {
                window.clearTimeout(previewWarmupTimeoutRef.current);
            }
            if (detailPreviewTimeoutRef.current !== null) {
                window.clearTimeout(detailPreviewTimeoutRef.current);
            }
            if (fallbackPreviewTimeoutRef.current !== null) {
                window.clearTimeout(fallbackPreviewTimeoutRef.current);
            }
            if (assignFeedbackTimeoutRef.current !== null) {
                window.clearTimeout(assignFeedbackTimeoutRef.current);
            }
            if (classificationFeedbackTimeoutRef.current !== null) {
                window.clearTimeout(classificationFeedbackTimeoutRef.current);
            }
            if (panAnimationFrameRef.current !== null) {
                window.cancelAnimationFrame(panAnimationFrameRef.current);
            }
            if (dockScrollRafRef.current !== null) {
                window.cancelAnimationFrame(dockScrollRafRef.current);
                dockScrollRafRef.current = null;
            }
            pendingDockViewportRef.current = null;
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
            setResolvedPreview(null);
            setResolvedDetailPreview(null);
            return;
        }
        setResolvedDetailPreview(null);
        detailPreviewPerfStartRef.current = null;
        if (!activePreviewAssetNeedsManagedPreview) {
            setResolvedPreview(null);
            return;
        }
        let active = true;
        if (desktopFitPreviewRequest) {
            const cachedFrame = getCachedDesktopQuickPreviewFrame(desktopFitPreviewRequest);
            if (cachedFrame) {
                const cachedState = createDesktopManagedPreviewState(asset.id, "fit", cachedFrame, "renderer-cache");
                const measurement = previewPerfStartRef.current;
                const elapsed = measurement && measurement.assetId === asset.id
                    ? Math.max(0, Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - measurement.startedAt))
                    : null;
                setResolvedPreview(cachedState);
                recordPreviewFrameMetric(cachedState.sourceLabel, true);
                setQuickPreviewPerf((current) => ({
                    ...current,
                    fitLatencyMs: elapsed ?? current.fitLatencyMs,
                    openLatencyMs: elapsed !== null && measurement?.reason === "open" ? elapsed : current.openLatencyMs,
                    navigationLatencyMs: elapsed !== null && measurement?.reason === "navigate" ? elapsed : current.navigationLatencyMs,
                    lastRenderedSource: cachedState.sourceLabel,
                    lastRenderedAssetName: asset.fileName,
                }));
                previewPerfStartRef.current = null;
                return () => {
                    active = false;
                };
            }
            void getDesktopQuickPreviewFrame(desktopFitPreviewRequest)
                .then((frame) => {
                if (!frame) {
                    if (active) {
                        setResolvedPreview(null);
                    }
                    return;
                }
                if (!active) {
                    return;
                }
                const sourceLabel = formatDesktopPreviewSourceLabel("fit", frame.source, frame.cacheHit);
                const measurement = previewPerfStartRef.current;
                setResolvedPreview({
                    assetId: asset.id,
                    url: frame.src,
                    token: frame.token,
                    sourceLabel,
                    cacheHit: frame.cacheHit,
                });
                recordPreviewFrameMetric(sourceLabel, frame.cacheHit);
                void logDesktopEvent({
                    channel: "preview",
                    level: "info",
                    message: measurement?.reason === "navigate" ? "preview_navigation_ready" : "preview_fit_ready",
                    details: JSON.stringify({
                        assetId: asset.id,
                        fileName: asset.fileName,
                        source: frame.source,
                        cacheHit: frame.cacheHit,
                        maxDimension: desktopFitPreviewRequest.maxDimension,
                    }),
                });
                if (measurement && measurement.assetId === asset.id) {
                    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
                    const elapsed = Math.max(0, Math.round(now - measurement.startedAt));
                    setQuickPreviewPerf((current) => ({
                        ...current,
                        fitLatencyMs: elapsed,
                        openLatencyMs: measurement.reason === "open" ? elapsed : current.openLatencyMs,
                        navigationLatencyMs: measurement.reason === "navigate" ? elapsed : current.navigationLatencyMs,
                        lastRenderedSource: sourceLabel,
                        lastRenderedAssetName: asset.fileName,
                    }));
                    previewPerfStartRef.current = null;
                }
            })
                .catch(() => {
                if (active) {
                    setResolvedPreview(null);
                }
            });
        }
        else {
            const cachedPreviewUrl = getCachedOnDemandPreviewUrl(asset.id, {
                maxDimension: fitPreviewMaxDimension,
            });
            setResolvedPreview(cachedPreviewUrl
                ? {
                    assetId: asset.id,
                    url: cachedPreviewUrl,
                    token: null,
                    sourceLabel: "Fit · renderer-cache",
                    cacheHit: true,
                }
                : null);
            createOnDemandPreviewAsync(asset.id, 0, {
                maxDimension: fitPreviewMaxDimension,
            })
                .then((url) => {
                if (active && url) {
                    setResolvedPreview({
                        assetId: asset.id,
                        url,
                        token: null,
                        sourceLabel: "Fit · renderer-preview",
                        cacheHit: Boolean(cachedPreviewUrl),
                    });
                }
            })
                .catch(() => {
                if (active) {
                    setResolvedPreview(null);
                }
            });
        }
        return () => {
            active = false;
        };
    }, [
        activePreviewAssetNeedsManagedPreview,
        asset,
        desktopFitPreviewRequest,
        fitPreviewMaxDimension,
        recordPreviewFrameMetric,
    ]);
    useEffect(() => {
        if (!asset || compareMode || zoomLevel <= 1.05 || !activePreviewAssetNeedsManagedPreview) {
            setResolvedDetailPreview(null);
            if (detailPreviewTimeoutRef.current !== null) {
                window.clearTimeout(detailPreviewTimeoutRef.current);
                detailPreviewTimeoutRef.current = null;
            }
            return;
        }
        let active = true;
        if (desktopDetailPreviewRequest) {
            const cachedFrame = getCachedDesktopQuickPreviewFrame(desktopDetailPreviewRequest);
            if (cachedFrame) {
                const cachedState = createDesktopManagedPreviewState(asset.id, "detail", cachedFrame, "renderer-cache");
                setResolvedDetailPreview(cachedState);
                recordPreviewFrameMetric(cachedState.sourceLabel, true);
                setQuickPreviewPerf((current) => ({
                    ...current,
                    detailLatencyMs: 0,
                    lastRenderedSource: cachedState.sourceLabel,
                    lastRenderedAssetName: asset.fileName,
                }));
                detailPreviewPerfStartRef.current = null;
                return () => {
                    active = false;
                    if (detailPreviewTimeoutRef.current !== null) {
                        window.clearTimeout(detailPreviewTimeoutRef.current);
                        detailPreviewTimeoutRef.current = null;
                    }
                };
            }
            detailPreviewPerfStartRef.current = null;
            detailPreviewTimeoutRef.current = window.setTimeout(() => {
                detailPreviewTimeoutRef.current = null;
                detailPreviewPerfStartRef.current = {
                    assetId: asset.id,
                    startedAt: typeof performance !== "undefined" ? performance.now() : Date.now(),
                };
                void getDesktopQuickPreviewFrame(desktopDetailPreviewRequest)
                    .then((frame) => {
                    if (!frame) {
                        if (active) {
                            setResolvedDetailPreview(null);
                        }
                        return;
                    }
                    if (!active) {
                        return;
                    }
                    const sourceLabel = formatDesktopPreviewSourceLabel("detail", frame.source, frame.cacheHit);
                    setResolvedDetailPreview({
                        assetId: asset.id,
                        url: frame.src,
                        token: frame.token,
                        sourceLabel,
                        cacheHit: frame.cacheHit,
                    });
                    recordPreviewFrameMetric(sourceLabel, frame.cacheHit);
                    void logDesktopEvent({
                        channel: "preview",
                        level: "info",
                        message: "preview_detail_ready",
                        details: JSON.stringify({
                            assetId: asset.id,
                            fileName: asset.fileName,
                            source: frame.source,
                            cacheHit: frame.cacheHit,
                            maxDimension: desktopDetailPreviewRequest.maxDimension,
                        }),
                    });
                    const detailMeasurement = detailPreviewPerfStartRef.current;
                    if (detailMeasurement && detailMeasurement.assetId === asset.id) {
                        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
                        const elapsed = Math.max(0, Math.round(now - detailMeasurement.startedAt));
                        setQuickPreviewPerf((current) => ({
                            ...current,
                            detailLatencyMs: elapsed,
                            lastRenderedSource: sourceLabel,
                            lastRenderedAssetName: asset.fileName,
                        }));
                        detailPreviewPerfStartRef.current = null;
                    }
                })
                    .catch(() => {
                    if (active) {
                        setResolvedDetailPreview(null);
                    }
                });
            }, QUICK_PREVIEW_DETAIL_IDLE_DELAY_MS);
        }
        else {
            const cachedDetailPreviewUrl = getCachedOnDemandPreviewUrl(asset.id, {
                maxDimension: detailPreviewMaxDimension,
            });
            setResolvedDetailPreview(cachedDetailPreviewUrl
                ? {
                    assetId: asset.id,
                    url: cachedDetailPreviewUrl,
                    token: null,
                    sourceLabel: "Detail · renderer-cache",
                    cacheHit: true,
                }
                : null);
            createOnDemandPreviewAsync(asset.id, 0, {
                maxDimension: detailPreviewMaxDimension,
            })
                .then((url) => {
                if (active && url) {
                    setResolvedDetailPreview({
                        assetId: asset.id,
                        url,
                        token: null,
                        sourceLabel: "Detail · renderer-preview",
                        cacheHit: Boolean(cachedDetailPreviewUrl),
                    });
                }
            })
                .catch(() => {
                if (active) {
                    setResolvedDetailPreview(null);
                }
            });
        }
        return () => {
            active = false;
            if (detailPreviewTimeoutRef.current !== null) {
                window.clearTimeout(detailPreviewTimeoutRef.current);
                detailPreviewTimeoutRef.current = null;
            }
        };
    }, [
        activePreviewAssetNeedsManagedPreview,
        asset,
        compareMode,
        desktopDetailPreviewRequest,
        detailPreviewMaxDimension,
        recordPreviewFrameMetric,
        zoomLevel,
    ]);
    useEffect(() => {
        if (!compareMode) {
            setCompareAssetId(null);
            setResolvedComparePreview(null);
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
            setResolvedComparePreview(null);
            return;
        }
        if (!canUseDesktopQuickPreviewForCompare && !shouldLoadRawPreview(compareAsset)) {
            setResolvedComparePreview(null);
            return;
        }
        let active = true;
        setResolvedComparePreview(immediateComparePreview);
        if (desktopComparePreviewRequest) {
            const cachedFrame = getCachedDesktopQuickPreviewFrame(desktopComparePreviewRequest);
            if (cachedFrame) {
                const cachedState = createDesktopManagedPreviewState(compareAsset.id, "fit", cachedFrame, "renderer-cache");
                setResolvedComparePreview(cachedState);
                recordPreviewFrameMetric(cachedState.sourceLabel, true);
                return () => {
                    active = false;
                };
            }
            void getDesktopQuickPreviewFrame(desktopComparePreviewRequest)
                .then((frame) => {
                if (!frame) {
                    if (active) {
                        setResolvedComparePreview(null);
                    }
                    return;
                }
                if (!active) {
                    return;
                }
                const sourceLabel = formatDesktopPreviewSourceLabel("fit", frame.source, frame.cacheHit);
                setResolvedComparePreview({
                    assetId: compareAsset.id,
                    url: frame.src,
                    token: frame.token,
                    sourceLabel,
                    cacheHit: frame.cacheHit,
                });
                recordPreviewFrameMetric(sourceLabel, frame.cacheHit);
            })
                .catch(() => {
                if (active) {
                    setResolvedComparePreview(null);
                }
            });
        }
        else {
            const cachedComparePreviewUrl = getCachedOnDemandPreviewUrl(compareAsset.id, {
                maxDimension: fitPreviewMaxDimension,
            });
            setResolvedComparePreview(cachedComparePreviewUrl
                ? {
                    assetId: compareAsset.id,
                    url: cachedComparePreviewUrl,
                    token: null,
                    sourceLabel: "Fit · renderer-cache",
                    cacheHit: true,
                }
                : null);
            createOnDemandPreviewAsync(compareAsset.id, 1, {
                maxDimension: fitPreviewMaxDimension,
            })
                .then((url) => {
                if (active && url) {
                    setResolvedComparePreview({
                        assetId: compareAsset.id,
                        url,
                        token: null,
                        sourceLabel: "Fit · renderer-preview",
                        cacheHit: Boolean(cachedComparePreviewUrl),
                    });
                }
            })
                .catch(() => {
                if (active) {
                    setResolvedComparePreview(null);
                }
            });
        }
        return () => {
            active = false;
        };
    }, [
        compareAsset,
        desktopComparePreviewRequest,
        fitPreviewMaxDimension,
        immediateComparePreview,
        recordPreviewFrameMetric,
    ]);
    useEffect(() => {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        if (!asset) {
            lastAssetIdRef.current = null;
            previewPerfStartRef.current = null;
            detailPreviewPerfStartRef.current = null;
            fallbackSignatureRef.current = "";
            return;
        }
        const previousAssetId = lastAssetIdRef.current;
        const reason = previousAssetId === null
            ? "open"
            : pendingSelectionReasonRef.current === "navigate"
                ? "navigate"
                : "jump";
        previewPerfStartRef.current = {
            assetId: asset.id,
            startedAt: now,
            reason,
        };
        detailPreviewPerfStartRef.current = null;
        fallbackSignatureRef.current = "";
        pendingSelectionReasonRef.current = null;
        lastAssetIdRef.current = asset.id;
        void logDesktopEvent({
            channel: "preview",
            level: "info",
            message: reason === "navigate" ? "preview_navigation_requested" : "preview_open_requested",
            details: JSON.stringify({
                assetId: asset.id,
                fileName: asset.fileName,
                fitPreviewMaxDimension,
                detailPreviewMaxDimension,
            }),
        });
    }, [asset?.fileName, asset?.id, detailPreviewMaxDimension, fitPreviewMaxDimension]);
    useEffect(() => {
        const element = dockStripRef.current;
        if (!element) {
            return;
        }
        const sync = () => {
            setDockViewport({
                scrollOffset: element.scrollLeft,
                viewportSize: element.clientWidth,
            });
        };
        sync();
        const resizeObserver = new ResizeObserver(sync);
        resizeObserver.observe(element);
        return () => resizeObserver.disconnect();
    }, []);
    useEffect(() => {
        const dock = dockStripRef.current;
        if (!dock || currentIndex < 0) {
            return;
        }
        const itemStart = currentIndex * DOCK_THUMB_ESTIMATED_SIZE;
        const itemEnd = itemStart + DOCK_THUMB_ESTIMATED_SIZE;
        const viewportStart = dock.scrollLeft;
        const viewportEnd = viewportStart + dock.clientWidth;
        if (itemStart >= viewportStart && itemEnd <= viewportEnd) {
            return;
        }
        if (itemStart < viewportStart) {
            dock.scrollTo({ left: Math.max(0, itemStart - 24), behavior: "auto" });
        }
        else if (itemEnd > viewportEnd) {
            dock.scrollTo({
                left: Math.max(0, itemEnd - dock.clientWidth + 24),
                behavior: "auto",
            });
        }
    }, [currentIndex]);
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
    const clampPan = useCallback((x, y, zoom = zoomLevel) => {
        const stage = stageRef.current;
        if (!stage || zoom <= 1 || !asset) {
            return { x: 0, y: 0 };
        }
        const safeWidth = Math.max(1, asset.width);
        const safeHeight = Math.max(1, asset.height);
        const fitScale = Math.min(stage.clientWidth / safeWidth, stage.clientHeight / safeHeight);
        const renderedWidth = safeWidth * fitScale;
        const renderedHeight = safeHeight * fitScale;
        const maxX = Math.max(0, (renderedWidth * zoom - stage.clientWidth) / 2);
        const maxY = Math.max(0, (renderedHeight * zoom - stage.clientHeight) / 2);
        return {
            x: Math.max(-maxX, Math.min(maxX, x)),
            y: Math.max(-maxY, Math.min(maxY, y)),
        };
    }, [asset, zoomLevel]);
    const commitPanOffset = useCallback((nextPanOffset) => {
        pendingPanOffsetRef.current = nextPanOffset;
        if (panAnimationFrameRef.current !== null) {
            return;
        }
        panAnimationFrameRef.current = window.requestAnimationFrame(() => {
            panAnimationFrameRef.current = null;
            const pendingPanOffset = pendingPanOffsetRef.current;
            if (!pendingPanOffset) {
                return;
            }
            pendingPanOffsetRef.current = null;
            setPanOffset(pendingPanOffset);
        });
    }, []);
    const applyZoom = useCallback((nextZoom) => {
        const clampedZoom = Math.max(1, Math.min(4, Number(nextZoom.toFixed(2))));
        setZoomLevel(clampedZoom);
        const nextPanOffset = clampPan(panOffset.x, panOffset.y, clampedZoom);
        pendingPanOffsetRef.current = nextPanOffset;
        setPanOffset(nextPanOffset);
    }, [clampPan, panOffset.x, panOffset.y]);
    const toggleZoom = useCallback(() => {
        const nextZoom = zoomLevel > 1.05 ? 1 : 2.2;
        pendingPanOffsetRef.current = { x: 0, y: 0 };
        setPanOffset({ x: 0, y: 0 });
        applyZoom(nextZoom);
    }, [applyZoom, zoomLevel]);
    const panBy = useCallback((deltaX, deltaY) => {
        if (compareMode || zoomLevel <= 1.05) {
            return;
        }
        const nextPanOffset = clampPan((pendingPanOffsetRef.current?.x ?? panOffset.x) + deltaX, (pendingPanOffsetRef.current?.y ?? panOffset.y) + deltaY);
        commitPanOffset(nextPanOffset);
    }, [clampPan, commitPanOffset, compareMode, panOffset.x, panOffset.y, zoomLevel]);
    useEffect(() => {
        if (compareMode) {
            setZoomLevel(1);
            setPanOffset({ x: 0, y: 0 });
            setIsPanning(false);
            panDragRef.current = null;
            return;
        }
        setZoomLevel(startZoomed ? 2.2 : 1);
        setPanOffset({ x: 0, y: 0 });
        pendingPanOffsetRef.current = { x: 0, y: 0 };
        setIsPanning(false);
        panDragRef.current = null;
    }, [asset?.id, compareMode, startZoomed]);
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
            if (event.key === "z" || event.key === "Z") {
                event.preventDefault();
                toggleZoom();
                return;
            }
            if (!event.ctrlKey && !event.metaKey && !event.altKey) {
                const shortcutLabel = customLabelByShortcut.get(event.key.toUpperCase());
                if (shortcutLabel) {
                    event.preventDefault();
                    toggleCustomLabel(shortcutLabel);
                    return;
                }
            }
            if (!compareMode && zoomLevel > 1.05) {
                const step = event.shiftKey ? 180 : 90;
                if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    panBy(step, 0);
                    return;
                }
                if (event.key === "ArrowRight") {
                    event.preventDefault();
                    panBy(-step, 0);
                    return;
                }
                if (event.key === "ArrowUp") {
                    event.preventDefault();
                    panBy(0, step);
                    return;
                }
                if (event.key === "ArrowDown") {
                    event.preventDefault();
                    panBy(0, -step);
                    return;
                }
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
        activePageCanAccept,
        asset,
        compareMode,
        customLabelByShortcut,
        handleAssignToActivePage,
        handleNavigate,
        onAddToPage,
        onClose,
        onUpdateAsset,
        announceClassificationFeedback,
        panBy,
        toggleCustomLabel,
        toggleNativeFullscreen,
        toggleZoom,
        zoomLevel,
    ]);
    const currentCustomLabels = asset?.customLabels ?? [];
    const currentAssetId = asset?.id ?? null;
    const currentAssetFileName = asset?.fileName ?? "";
    const fallbackPreviewUrl = asset ? getQuickPreviewThumbUrl(asset) : null;
    const activeResolvedPreview = resolvedPreview && resolvedPreview.assetId === currentAssetId
        ? resolvedPreview
        : null;
    const activeResolvedDetailPreview = resolvedDetailPreview && resolvedDetailPreview.assetId === currentAssetId
        ? resolvedDetailPreview
        : null;
    const activeResolvedComparePreview = resolvedComparePreview && resolvedComparePreview.assetId === compareAsset?.id
        ? resolvedComparePreview
        : null;
    const managedPreviewUrl = activeResolvedDetailPreview?.url
        ?? immediateDetailPreview?.url
        ?? activeResolvedPreview?.url
        ?? immediateFitPreview?.url
        ?? null;
    const previewUrl = managedPreviewUrl
        ?? (!canUseDesktopQuickPreview ? asset?.previewUrl ?? asset?.sourceUrl ?? null : null);
    const displayPreviewUrl = previewUrl ?? (canUseDesktopQuickPreview ? fallbackPreviewUrl : null);
    const previewIsFallback = !previewUrl && Boolean(canUseDesktopQuickPreview && fallbackPreviewUrl);
    const compareFallbackPreviewUrl = compareAsset ? getQuickPreviewThumbUrl(compareAsset) : null;
    const comparePreviewUrl = compareAsset
        ? activeResolvedComparePreview?.url
            ?? immediateComparePreview?.url
            ?? (!canUseDesktopQuickPreviewForCompare ? compareAsset.previewUrl ?? compareAsset.sourceUrl ?? null : null)
        : null;
    const displayComparePreviewUrl = comparePreviewUrl ?? (canUseDesktopQuickPreviewForCompare ? compareFallbackPreviewUrl : null);
    const comparePreviewIsFallback = !comparePreviewUrl && Boolean(canUseDesktopQuickPreviewForCompare && compareFallbackPreviewUrl);
    const previewSourceLabel = activeResolvedDetailPreview
        ? activeResolvedDetailPreview.sourceLabel
        : immediateDetailPreview
            ? immediateDetailPreview.sourceLabel
            : activeResolvedPreview
                ? activeResolvedPreview.sourceLabel
                : immediateFitPreview
                    ? immediateFitPreview.sourceLabel
                    : previewIsFallback
                        ? "Fallback"
                        : asset?.previewUrl
                            ? "Embedded"
                            : asset?.sourceUrl
                                ? "Source"
                                : "Fallback";
    const currentManagedPreviewState = activeResolvedDetailPreview
        ?? immediateDetailPreview
        ?? activeResolvedPreview
        ?? immediateFitPreview
        ?? null;
    const handleMainPreviewError = useCallback(() => {
        if (!asset || !canUseDesktopQuickPreview || !displayPreviewUrl?.startsWith("filex-preview://")) {
            return;
        }
        const request = (activeResolvedDetailPreview || immediateDetailPreview)
            ? desktopDetailPreviewRequest
            : desktopFitPreviewRequest;
        const stage = request?.stage ?? "fit";
        if (!request) {
            return;
        }
        const recoveryKey = `${asset.id}:${request.stage}:${request.maxDimension}:${request.sourceFileKey ?? ""}`;
        if (mainPreviewRecoveryKeyRef.current === recoveryKey) {
            return;
        }
        mainPreviewRecoveryKeyRef.current = recoveryKey;
        setQuickPreviewPerf((current) => ({
            ...current,
            lastRenderedSource: `${currentManagedPreviewState?.sourceLabel ?? previewSourceLabel} | recovering`,
            lastRenderedAssetName: asset.fileName,
        }));
        void (async () => {
            await invalidateDesktopQuickPreviewFrame(request);
            const frame = await getDesktopQuickPreviewFrame(request);
            if (!frame) {
                if (stage === "detail") {
                    setResolvedDetailPreview(null);
                }
                else {
                    setResolvedPreview(null);
                }
                return;
            }
            const nextState = createDesktopManagedPreviewState(asset.id, stage, frame);
            if (stage === "detail") {
                setResolvedDetailPreview(nextState);
            }
            else {
                setResolvedPreview(nextState);
            }
            recordPreviewFrameMetric(nextState.sourceLabel, frame.cacheHit);
            setQuickPreviewPerf((current) => ({
                ...current,
                lastRenderedSource: `${nextState.sourceLabel} | recovered`,
                lastRenderedAssetName: asset.fileName,
            }));
            void logDesktopEvent({
                channel: "preview",
                level: "warn",
                message: "preview_frame_recovered",
                details: JSON.stringify({
                    assetId: asset.id,
                    fileName: asset.fileName,
                    stage,
                    source: frame.source,
                    cacheHit: frame.cacheHit,
                }),
            });
        })()
            .catch(() => {
            if (stage === "detail") {
                setResolvedDetailPreview(null);
            }
            else {
                setResolvedPreview(null);
            }
        })
            .finally(() => {
            if (mainPreviewRecoveryKeyRef.current === recoveryKey) {
                mainPreviewRecoveryKeyRef.current = null;
            }
        });
    }, [
        activeResolvedDetailPreview,
        asset,
        canUseDesktopQuickPreview,
        currentManagedPreviewState?.sourceLabel,
        desktopDetailPreviewRequest,
        desktopFitPreviewRequest,
        displayPreviewUrl,
        immediateDetailPreview,
        previewSourceLabel,
        recordPreviewFrameMetric,
    ]);
    const handleComparePreviewError = useCallback(() => {
        if (!compareAsset || !canUseDesktopQuickPreviewForCompare || !displayComparePreviewUrl?.startsWith("filex-preview://") || !desktopComparePreviewRequest) {
            return;
        }
        const recoveryKey = `${compareAsset.id}:${desktopComparePreviewRequest.maxDimension}:${desktopComparePreviewRequest.sourceFileKey ?? ""}`;
        if (comparePreviewRecoveryKeyRef.current === recoveryKey) {
            return;
        }
        comparePreviewRecoveryKeyRef.current = recoveryKey;
        void (async () => {
            await invalidateDesktopQuickPreviewFrame(desktopComparePreviewRequest);
            const frame = await getDesktopQuickPreviewFrame(desktopComparePreviewRequest);
            if (!frame) {
                setResolvedComparePreview(null);
                return;
            }
            const nextState = createDesktopManagedPreviewState(compareAsset.id, "fit", frame);
            setResolvedComparePreview(nextState);
            recordPreviewFrameMetric(nextState.sourceLabel, frame.cacheHit);
            void logDesktopEvent({
                channel: "preview",
                level: "warn",
                message: "compare_preview_frame_recovered",
                details: JSON.stringify({
                    assetId: compareAsset.id,
                    fileName: compareAsset.fileName,
                    source: frame.source,
                    cacheHit: frame.cacheHit,
                }),
            });
        })()
            .catch(() => {
            setResolvedComparePreview(null);
        })
            .finally(() => {
            if (comparePreviewRecoveryKeyRef.current === recoveryKey) {
                comparePreviewRecoveryKeyRef.current = null;
            }
        });
    }, [
        canUseDesktopQuickPreviewForCompare,
        compareAsset,
        desktopComparePreviewRequest,
        displayComparePreviewUrl,
        recordPreviewFrameMetric,
    ]);
    function toggleCustomLabel(label) {
        if (!asset || !onUpdateAsset) {
            return;
        }
        const nextIsActive = !currentCustomLabels.includes(label);
        const nextCustomLabels = currentCustomLabels.includes(label)
            ? currentCustomLabels.filter((currentLabel) => currentLabel !== label)
            : [...currentCustomLabels, label];
        onUpdateAsset(asset.id, {
            customLabels: nextCustomLabels,
        });
        announceCustomLabelFeedback(label, nextIsActive);
    }
    const handleDockStripScroll = useCallback((event) => {
        pendingDockViewportRef.current = {
            scrollOffset: event.currentTarget.scrollLeft,
            viewportSize: event.currentTarget.clientWidth,
        };
        if (dockScrollRafRef.current !== null) {
            return;
        }
        dockScrollRafRef.current = window.requestAnimationFrame(() => {
            dockScrollRafRef.current = null;
            const pendingDockViewport = pendingDockViewportRef.current;
            if (!pendingDockViewport) {
                return;
            }
            pendingDockViewportRef.current = null;
            setDockViewport((currentViewport) => (currentViewport.scrollOffset === pendingDockViewport.scrollOffset
                && currentViewport.viewportSize === pendingDockViewport.viewportSize
                ? currentViewport
                : pendingDockViewport));
        });
    }, []);
    const handleMainPreviewLoad = useCallback((event) => {
        if (canUseDesktopQuickPreview) {
            const renderedSource = event.currentTarget.currentSrc || event.currentTarget.src || previewSourceLabel;
            setQuickPreviewPerf((current) => ({
                ...current,
                lastRenderedSource: `${previewSourceLabel} · ${renderedSource ? "ready" : "n/d"}`,
                lastRenderedAssetName: currentAssetFileName,
            }));
            return;
        }
        const measurement = previewPerfStartRef.current;
        if (!measurement || measurement.assetId !== currentAssetId) {
            return;
        }
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        const elapsed = Math.max(0, Math.round(now - measurement.startedAt));
        const renderedSource = event.currentTarget.currentSrc || event.currentTarget.src || previewSourceLabel;
        setQuickPreviewPerf((current) => ({
            ...current,
            openLatencyMs: measurement.reason === "open" ? elapsed : current.openLatencyMs,
            navigationLatencyMs: measurement.reason === "navigate" ? elapsed : current.navigationLatencyMs,
            lastRenderedSource: `${previewSourceLabel} · ${renderedSource ? "ready" : "n/d"}`,
            lastRenderedAssetName: currentAssetFileName,
        }));
        previewPerfStartRef.current = null;
    }, [canUseDesktopQuickPreview, currentAssetFileName, currentAssetId, previewSourceLabel]);
    useEffect(() => {
        if (!previewIsFallback || !currentAssetId) {
            return;
        }
        if (fallbackPreviewTimeoutRef.current !== null) {
            window.clearTimeout(fallbackPreviewTimeoutRef.current);
            fallbackPreviewTimeoutRef.current = null;
        }
        fallbackPreviewTimeoutRef.current = window.setTimeout(() => {
            fallbackPreviewTimeoutRef.current = null;
            const signature = `${currentAssetId}:${currentAssetFileName}`;
            if (fallbackSignatureRef.current === signature) {
                return;
            }
            fallbackSignatureRef.current = signature;
            recordPreviewFallbackUsage();
            setQuickPreviewPerf((current) => ({
                ...current,
                lastRenderedSource: "Fallback",
                lastRenderedAssetName: currentAssetFileName,
            }));
            void logDesktopEvent({
                channel: "preview",
                level: "info",
                message: "preview_fallback_used",
                details: JSON.stringify({
                    assetId: currentAssetId,
                    fileName: currentAssetFileName,
                }),
            });
        }, QUICK_PREVIEW_DESKTOP_FALLBACK_DELAY_MS);
        return () => {
            if (fallbackPreviewTimeoutRef.current !== null) {
                window.clearTimeout(fallbackPreviewTimeoutRef.current);
                fallbackPreviewTimeoutRef.current = null;
            }
        };
    }, [currentAssetFileName, currentAssetId, previewIsFallback, recordPreviewFallbackUsage]);
    useEffect(() => {
        if (previewUrl || canUseDesktopQuickPreview) {
            return;
        }
        const measurement = previewPerfStartRef.current;
        if (!measurement || measurement.assetId !== currentAssetId) {
            return;
        }
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        const elapsed = Math.max(0, Math.round(now - measurement.startedAt));
        setQuickPreviewPerf((current) => ({
            ...current,
            openLatencyMs: measurement.reason === "open" ? elapsed : current.openLatencyMs,
            navigationLatencyMs: measurement.reason === "navigate" ? elapsed : current.navigationLatencyMs,
            lastRenderedSource: "Placeholder",
            lastRenderedAssetName: currentAssetFileName,
        }));
        previewPerfStartRef.current = null;
    }, [canUseDesktopQuickPreview, currentAssetFileName, currentAssetId, previewUrl]);
    useEffect(() => {
        if (!asset) {
            lastPerfSinkSignatureRef.current = "";
            return;
        }
        if (quickPreviewPerf.openLatencyMs === null && quickPreviewPerf.navigationLatencyMs === null) {
            return;
        }
        const signature = [
            asset.id,
            quickPreviewPerf.openLatencyMs ?? "n",
            quickPreviewPerf.navigationLatencyMs ?? "n",
            quickPreviewPerf.lastRenderedSource,
        ].join(":");
        if (signature === lastPerfSinkSignatureRef.current) {
            return;
        }
        lastPerfSinkSignatureRef.current = signature;
        const timestamp = Date.now();
        void getDesktopPerformanceSnapshot()
            .then((current) => recordDesktopPerformanceSnapshot({
            folderOpenToFirstThumbnailMs: current?.folderOpenToFirstThumbnailMs ?? null,
            folderOpenToGridCompleteMs: current?.folderOpenToGridCompleteMs ?? null,
            previewOpenLatencyMs: quickPreviewPerf.openLatencyMs ?? current?.previewOpenLatencyMs ?? null,
            previewNavigationLatencyMs: quickPreviewPerf.navigationLatencyMs ?? current?.previewNavigationLatencyMs ?? null,
            previewFitLatencyMs: quickPreviewPerf.fitLatencyMs ?? current?.previewFitLatencyMs ?? null,
            previewDetailLatencyMs: quickPreviewPerf.detailLatencyMs ?? current?.previewDetailLatencyMs ?? null,
            previewWarmHitRate: quickPreviewPerf.warmHitRate ?? current?.previewWarmHitRate ?? null,
            previewFallbackCount: quickPreviewPerf.fallbackCount,
            previewSourceBreakdown: quickPreviewPerf.sourceBreakdown,
            xmpSyncLatencyMs: current?.xmpSyncLatencyMs ?? null,
            bytesRead: current?.bytesRead ?? 0,
            rawBytesRead: current?.rawBytesRead ?? 0,
            standardBytesRead: current?.standardBytesRead ?? 0,
            thumbnailProfile,
            sortCacheEnabled: current?.sortCacheEnabled,
            lastUpdatedAt: timestamp,
        }))
            .catch(() => null);
        void logDesktopEvent({
            channel: "preview",
            level: "info",
            message: "Quick preview render completato",
            details: JSON.stringify({
                assetId: asset.id,
                fileName: asset.fileName,
                openLatencyMs: quickPreviewPerf.openLatencyMs,
                navigationLatencyMs: quickPreviewPerf.navigationLatencyMs,
                fitLatencyMs: quickPreviewPerf.fitLatencyMs,
                detailLatencyMs: quickPreviewPerf.detailLatencyMs,
                warmHitRate: quickPreviewPerf.warmHitRate,
                fallbackCount: quickPreviewPerf.fallbackCount,
                source: quickPreviewPerf.lastRenderedSource,
                sourceBreakdown: quickPreviewPerf.sourceBreakdown,
            }),
            timestamp,
        });
    }, [
        asset,
        quickPreviewPerf.detailLatencyMs,
        quickPreviewPerf.fallbackCount,
        quickPreviewPerf.fitLatencyMs,
        quickPreviewPerf.lastRenderedSource,
        quickPreviewPerf.navigationLatencyMs,
        quickPreviewPerf.openLatencyMs,
        quickPreviewPerf.sourceBreakdown,
        quickPreviewPerf.warmHitRate,
        thumbnailProfile,
    ]);
    if (!asset) {
        return null;
    }
    const rating = getAssetRating(asset);
    const pickStatus = getAssetPickStatus(asset);
    const colorLabel = getAssetColorLabel(asset);
    const compareColorLabel = compareAsset ? getAssetColorLabel(compareAsset) : null;
    const stageColorClass = getPreviewColorClass(colorLabel);
    const comparePanelColorClass = getPreviewColorClass(compareColorLabel);
    const previewContent = (_jsxs("div", { className: "quick-preview", onClick: onClose, role: "dialog", "aria-modal": "true", "aria-label": "Anteprima foto a schermo intero", children: [assets.length > 1 ? (_jsxs("div", { className: "quick-preview__sidebar", onClick: (event) => event.stopPropagation(), children: [_jsxs("div", { className: "quick-preview__sidebar-filters", children: [_jsx("div", { className: "quick-preview__filter-summary", children: hasActiveFilters
                                    ? `${filteredAssets.length} di ${assets.length} foto`
                                    : `${assets.length} foto` }), _jsxs("div", { className: "quick-preview__filter-controls", children: [_jsxs("label", { className: "quick-preview__filter-field", children: [_jsx("span", { children: "Stato" }), _jsxs("select", { className: "quick-preview__filter-select", value: filterPickStatus, onChange: (event) => setFilterPickStatus(event.target.value), children: [_jsx("option", { value: "all", children: "Tutti" }), _jsx("option", { value: "picked", children: "Pick" }), _jsx("option", { value: "rejected", children: "Scartate" }), _jsx("option", { value: "unmarked", children: "Neutre" })] })] }), _jsxs("label", { className: "quick-preview__filter-field", children: [_jsx("span", { children: "Stelle" }), _jsxs("select", { className: "quick-preview__filter-select", value: filterRating, onChange: (event) => setFilterRating(event.target.value), children: [_jsx("option", { value: "any", children: "Tutte" }), _jsxs("optgroup", { label: "Minimo", children: [_jsx("option", { value: "1+", children: "\u2605 1+" }), _jsx("option", { value: "2+", children: "\u2605\u2605 2+" }), _jsx("option", { value: "3+", children: "\u2605\u2605\u2605 3+" }), _jsx("option", { value: "4+", children: "\u2605\u2605\u2605\u2605 4+" })] }), _jsxs("optgroup", { label: "Esatto", children: [_jsx("option", { value: "0", children: "Senza stelle" }), _jsx("option", { value: "1", children: "\u2605 Solo 1" }), _jsx("option", { value: "2", children: "\u2605\u2605 Solo 2" }), _jsx("option", { value: "3", children: "\u2605\u2605\u2605 Solo 3" }), _jsx("option", { value: "4", children: "\u2605\u2605\u2605\u2605 Solo 4" }), _jsx("option", { value: "5", children: "\u2605\u2605\u2605\u2605\u2605 Solo 5" })] })] })] }), availableCustomLabels.length > 0 ? (_jsxs("label", { className: "quick-preview__filter-field", children: [_jsx("span", { children: "Label custom" }), _jsxs("select", { className: "quick-preview__filter-select", value: filterCustomLabel, onChange: (event) => setFilterCustomLabel(event.target.value), children: [_jsx("option", { value: "all", children: "Tutte" }), availableCustomLabels.map((label) => (_jsx("option", { value: label, children: label }, `preview-label-${label}`)))] })] })) : null] }), _jsxs("div", { className: "quick-preview__filter-colors", children: [_jsx("button", { type: "button", className: filterColorLabel === "all"
                                            ? "quick-preview__color-chip quick-preview__color-chip--clear quick-preview__color-chip--selected"
                                            : "quick-preview__color-chip quick-preview__color-chip--clear", onClick: () => setFilterColorLabel("all"), children: "Tutti" }), COLOR_LABELS.map((value) => (_jsx("button", { type: "button", className: filterColorLabel === value
                                            ? `quick-preview__color-chip quick-preview__color-chip--${value} quick-preview__color-chip--selected`
                                            : `quick-preview__color-chip quick-preview__color-chip--${value}`, onClick: () => setFilterColorLabel(value), title: COLOR_LABEL_NAMES[value] }, value)))] })] }), hasActiveFilters && navigationAssets.length === 0 ? (_jsx("div", { className: "quick-preview__empty-filter", children: "Nessuna foto corrisponde ai filtri attivi." })) : null] })) : null, _jsxs("div", { className: "quick-preview__main", onClick: (event) => event.stopPropagation(), children: [_jsxs("div", { className: "quick-preview__chrome", children: [_jsxs("div", { className: "quick-preview__title", children: [_jsx("strong", { children: asset.fileName }), _jsxs("span", { children: [asset.width, " x ", asset.height, " | ", orientationLabels[asset.orientation], asset.width > 0 && asset.height > 0
                                                ? ` | ${((asset.width * asset.height) / 1_000_000).toFixed(1)} MP`
                                                : "", usage ? ` | Foglio ${usage.pageNumber}` : " | Non ancora usata nel layout"] }), asset.xmpHasEdits ? (_jsxs("span", { className: "quick-preview__xmp-badge", title: "Metadati XMP rilevati", children: ["XMP Edit: ", asset.xmpEditInfo ?? "Sviluppo rilevato"] })) : null] }), _jsxs("div", { className: "quick-preview__actions", children: [_jsx("span", { className: "quick-preview__stars", children: formatAssetStars(asset) }), classificationFeedback ? (_jsx("span", { className: [
                                            "quick-preview__feedback",
                                            `quick-preview__feedback--${classificationFeedback.kind}`,
                                            classificationFeedback.kind === "label" && classificationFeedback.tone
                                                ? `quick-preview__feedback--${classificationFeedback.tone}`
                                                : "",
                                        ].join(" ").trim(), "aria-live": "polite", children: classificationFeedback.label }, classificationFeedback.token)) : null, _jsx(PhotoClassificationHelpButton, { title: "Scorciatoie preview foto" }), _jsx("span", { className: "quick-preview__perf-badge", title: `Benchmark locale della quick preview | ${quickPreviewPerf.sourceBreakdown}`, children: `Fit ${quickPreviewPerf.fitLatencyMs ?? "n/d"} ms · Detail ${quickPreviewPerf.detailLatencyMs ?? "n/d"} ms · Hit ${quickPreviewPerf.warmHitRate ?? "n/d"}% · ${quickPreviewPerf.lastRenderedSource}` }), _jsx("button", { type: "button", className: compareMode
                                            ? "ghost-button quick-preview__action quick-preview__action--active"
                                            : "ghost-button quick-preview__action", onClick: () => setCompareMode((current) => !current), disabled: !nextAsset && !previousAsset, children: compareMode ? "Chiudi confronto" : "Confronta" }), _jsx("button", { type: "button", className: "ghost-button quick-preview__action", onClick: toggleZoom, children: zoomLevel > 1.05 ? "Adatta" : "Zoom 220%" }), _jsx("button", { type: "button", className: "ghost-button quick-preview__action", onClick: toggleNativeFullscreen, children: "Fullscreen" }), _jsx("button", { type: "button", className: "ghost-button quick-preview__action", onClick: () => void saveAssetAs(asset.id), title: "Salva una copia del file in una posizione a scelta per aprirlo in un editor esterno (Photoshop, Lightroom, ecc.)", children: "Salva copia" }), _jsx("button", { type: "button", className: "ghost-button quick-preview__action", onClick: onClose, children: "Chiudi" })] })] }), _jsxs("div", { className: "quick-preview__meta-bar", children: [_jsxs("div", { className: "quick-preview__meta-group", children: [_jsx("span", { className: "quick-preview__meta-label", children: "Stelle" }), _jsxs("div", { className: "quick-preview__stars-editor", children: [[1, 2, 3, 4, 5].map((value) => (_jsx("button", { type: "button", className: value <= rating
                                                    ? "quick-preview__star quick-preview__star--active"
                                                    : "quick-preview__star", onClick: () => updateRating(value), children: "\u2605" }, value))), _jsx("button", { type: "button", className: "ghost-button quick-preview__tiny-action", onClick: () => updateRating(0), children: "Azzera" })] })] }), _jsxs("div", { className: "quick-preview__meta-group", children: [_jsx("span", { className: "quick-preview__meta-label", children: "Stato" }), _jsx("div", { className: "quick-preview__pill-row", children: ["picked", "rejected", "unmarked"].map((value) => (_jsx("button", { type: "button", className: pickStatus === value
                                                ? "quick-preview__pill quick-preview__pill--active"
                                                : "quick-preview__pill", onClick: () => updatePickStatus(value), children: PICK_STATUS_LABELS[value] }, value))) })] }), _jsxs("div", { className: "quick-preview__meta-group", children: [_jsx("span", { className: "quick-preview__meta-label", children: "Colore" }), _jsxs("div", { className: "quick-preview__color-row", children: [_jsx("button", { type: "button", className: colorLabel === null
                                                    ? "quick-preview__color-chip quick-preview__color-chip--clear quick-preview__color-chip--selected"
                                                    : "quick-preview__color-chip quick-preview__color-chip--clear", onClick: () => updateColorLabel(null), children: "Nessuno" }), COLOR_LABELS.map((value) => (_jsx("button", { type: "button", className: colorLabel === value
                                                    ? `quick-preview__color-chip quick-preview__color-chip--${value} quick-preview__color-chip--selected`
                                                    : `quick-preview__color-chip quick-preview__color-chip--${value}`, onClick: () => updateColorLabel(value), title: `${COLOR_LABEL_NAMES[value]} | ${getColorShortcutHint(value)}` }, value)))] })] }), availableCustomLabels.length > 0 ? (_jsxs("div", { className: "quick-preview__meta-group", children: [_jsx("span", { className: "quick-preview__meta-label", children: "Label custom" }), _jsx("div", { className: "quick-preview__pill-row", children: availableCustomLabels.map((label) => {
                                            const tone = customLabelColors[label] ?? "sand";
                                            const isActive = currentCustomLabels.includes(label);
                                            const shortcut = customLabelShortcuts[label] ?? null;
                                            const isFeedbackTarget = classificationFeedback?.kind === "label"
                                                && classificationFeedback.labels?.includes(label);
                                            return (_jsx("button", { type: "button", className: [
                                                    "quick-preview__custom-label",
                                                    `quick-preview__custom-label--${tone}`,
                                                    isActive ? "quick-preview__custom-label--active" : "",
                                                    isFeedbackTarget ? "quick-preview__custom-label--flash" : "",
                                                ].join(" ").trim(), onClick: () => toggleCustomLabel(label), title: shortcut ? `${label} · scorciatoia ${shortcut}` : label, children: shortcut ? `${label} · ${shortcut}` : label }, label));
                                        }) })] })) : null] }), _jsxs("div", { className: [
                            "quick-preview__stage",
                            stageColorClass,
                            compareMode && compareAsset
                                ? "quick-preview__stage--compare"
                                : zoomLevel > 1.05
                                    ? isPanning
                                        ? "quick-preview__stage--zoomed quick-preview__stage--panning"
                                        : "quick-preview__stage--zoomed"
                                    : "",
                        ].join(" ").trim(), ref: stageRef, onWheel: (event) => {
                            if (compareMode) {
                                return;
                            }
                            event.preventDefault();
                            const nextZoom = zoomLevel + (event.deltaY < 0 ? 0.25 : -0.25);
                            if (nextZoom <= 1) {
                                setPanOffset({ x: 0, y: 0 });
                            }
                            applyZoom(nextZoom);
                        }, onPointerDown: (event) => {
                            if (compareMode || zoomLevel <= 1.05 || event.button !== 0) {
                                return;
                            }
                            panDragRef.current = {
                                pointerId: event.pointerId,
                                startX: event.clientX,
                                startY: event.clientY,
                                originX: panOffset.x,
                                originY: panOffset.y,
                            };
                            setIsPanning(true);
                            event.currentTarget.setPointerCapture(event.pointerId);
                        }, onPointerMove: (event) => {
                            const drag = panDragRef.current;
                            if (!drag || drag.pointerId !== event.pointerId || compareMode || zoomLevel <= 1.05) {
                                return;
                            }
                            const deltaX = event.clientX - drag.startX;
                            const deltaY = event.clientY - drag.startY;
                            commitPanOffset(clampPan(drag.originX + deltaX, drag.originY + deltaY));
                        }, onPointerUp: (event) => {
                            if (panDragRef.current?.pointerId === event.pointerId) {
                                panDragRef.current = null;
                                setIsPanning(false);
                                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                                    event.currentTarget.releasePointerCapture(event.pointerId);
                                }
                            }
                        }, onPointerCancel: (event) => {
                            if (panDragRef.current?.pointerId === event.pointerId) {
                                panDragRef.current = null;
                                setIsPanning(false);
                                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                                    event.currentTarget.releasePointerCapture(event.pointerId);
                                }
                            }
                        }, onLostPointerCapture: () => {
                            panDragRef.current = null;
                            setIsPanning(false);
                        }, children: [previousAsset ? (_jsx("button", { type: "button", className: "quick-preview__nav quick-preview__nav--prev", onClick: () => handleNavigate("previous"), children: "<" })) : null, compareMode && compareAsset ? (_jsxs("div", { className: "quick-preview__compare-grid", children: [_jsxs("div", { className: `quick-preview__compare-panel ${stageColorClass}`, children: [_jsx("span", { className: "quick-preview__compare-label", children: "Corrente" }), displayPreviewUrl ? (_jsx("img", { src: displayPreviewUrl, alt: asset.fileName, className: "quick-preview__image quick-preview__image--compare", draggable: false, decoding: "sync", onError: handleMainPreviewError, onDoubleClick: toggleNativeFullscreen })) : (_jsx("div", { className: "quick-preview__placeholder", children: _jsx("span", { className: "quick-preview__loading-badge", children: "Preparazione preview" }) })), previewIsFallback ? (_jsx("span", { className: "quick-preview__loading-badge quick-preview__loading-badge--overlay", children: "Fit preview in arrivo" })) : null] }), _jsxs("div", { className: `quick-preview__compare-panel ${comparePanelColorClass}`, children: [_jsx("span", { className: "quick-preview__compare-label", children: compareAsset.fileName }), displayComparePreviewUrl ? (_jsx("img", { src: displayComparePreviewUrl, alt: compareAsset.fileName, className: "quick-preview__image quick-preview__image--compare", draggable: false, decoding: "sync", onError: handleComparePreviewError, onDoubleClick: toggleNativeFullscreen })) : (_jsx("div", { className: "quick-preview__placeholder", children: _jsx("span", { className: "quick-preview__loading-badge", children: "Preparazione preview" }) })), comparePreviewIsFallback ? (_jsx("span", { className: "quick-preview__loading-badge quick-preview__loading-badge--overlay", children: "Fit preview in arrivo" })) : null] })] })) : displayPreviewUrl ? (_jsx("img", { src: displayPreviewUrl, alt: asset.fileName, className: zoomLevel > 1.05
                                    ? isPanning
                                        ? "quick-preview__image quick-preview__image--zoomed quick-preview__image--panning"
                                        : "quick-preview__image quick-preview__image--zoomed"
                                    : "quick-preview__image", draggable: false, decoding: "sync", onLoad: handleMainPreviewLoad, onError: handleMainPreviewError, onDoubleClick: toggleNativeFullscreen, style: {
                                    transform: `translate3d(${panOffset.x}px, ${panOffset.y}px, 0) scale(${zoomLevel})`,
                                } })) : (_jsx("div", { className: "quick-preview__placeholder", children: _jsx("span", { className: "quick-preview__loading-badge", children: "Preparazione preview" }) })), previewIsFallback && !compareMode ? (_jsx("span", { className: "quick-preview__loading-badge quick-preview__loading-badge--overlay", children: "Fit preview in arrivo" })) : null, classificationFeedback ? (_jsx("span", { className: [
                                    "quick-preview__classification-overlay",
                                    `quick-preview__classification-overlay--${classificationFeedback.kind}`,
                                    classificationFeedback.kind === "label" && classificationFeedback.tone
                                        ? `quick-preview__classification-overlay--${classificationFeedback.tone}`
                                        : "",
                                ].join(" ").trim(), "aria-live": "polite", children: classificationFeedback.label }, `overlay-${classificationFeedback.token}`)) : null, nextAsset ? (_jsx("button", { type: "button", className: "quick-preview__nav quick-preview__nav--next", onClick: () => handleNavigate("next"), children: ">" })) : null] }), navigationAssets.length > 1 ? (_jsxs("div", { className: "quick-preview__dock", children: [_jsxs("div", { className: "quick-preview__dock-copy", children: [_jsxs("strong", { children: ["Foto ", currentIndex + 1, " di ", navigationAssets.length] }), _jsxs("span", { children: [previousAsset ? `Prec: ${previousAsset.fileName}` : "Inizio serie", " \u00B7", " ", nextAsset ? `Succ: ${nextAsset.fileName}` : "Fine serie"] })] }), _jsxs("div", { ref: dockStripRef, className: "quick-preview__dock-strip", onScroll: handleDockStripScroll, children: [dockLeftSpacerWidth > 0 ? (_jsx("div", { className: "quick-preview__dock-spacer", style: { width: dockLeftSpacerWidth }, "aria-hidden": "true" })) : null, dockStripItems.map((item) => {
                                        const itemPreview = getQuickPreviewThumbUrl(item);
                                        const isActive = item.id === asset.id;
                                        return (_jsx("button", { type: "button", className: isActive
                                                ? "quick-preview__dock-thumb quick-preview__dock-thumb--active"
                                                : "quick-preview__dock-thumb", "aria-current": isActive ? "true" : undefined, onClick: () => selectAssetFromPreview(item.id, "jump"), title: item.fileName, children: itemPreview ? (_jsx("img", { src: itemPreview, alt: item.fileName, className: "quick-preview__dock-image", loading: "lazy", decoding: "async" })) : (_jsx("span", { className: "quick-preview__dock-fallback", children: item.fileName })) }, `dock-${item.id}`));
                                    }), dockRightSpacerWidth > 0 ? (_jsx("div", { className: "quick-preview__dock-spacer", style: { width: dockRightSpacerWidth }, "aria-hidden": "true" })) : null] })] })) : null, pages.length > 0 && onAddToPage ? (_jsxs("div", { className: showAssignSuccess
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