import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent, type UIEvent } from "react";
import { createPortal } from "react-dom";
import type { ColorLabel, ImageAsset, PickStatus } from "@photo-tools/shared-types";
import { preloadImageUrls } from "../services/image-cache";
import {
  createOnDemandPreviewAsync,
  getCachedOnDemandPreviewUrl,
  isRawFile,
  saveAssetAs,
  warmOnDemandPreviewCache,
} from "../services/folder-access";
import type { CustomLabelShortcut, CustomLabelTone } from "../services/photo-selector-preferences";
import { PhotoClassificationHelpButton } from "./PhotoClassificationHelpButton";
import {
  COLOR_LABEL_NAMES,
  COLOR_LABELS,
  DEFAULT_PHOTO_FILTERS,
  formatAssetStars,
  getAssetColorLabel,
  getAssetPickStatus,
  getAssetRating,
  getColorShortcutHint,
  matchesPhotoFilters,
  PICK_STATUS_LABELS,
  resolvePhotoClassificationShortcut
} from "../services/photo-classification";
import type { ThumbnailProfile } from "../services/photo-selector-preferences";

interface PreviewPageTarget {
  id: string;
  pageNumber: number;
  templateLabel?: string;
  photoCount?: number;
  capacity?: number;
  isAtCapacity?: boolean;
}

interface PhotoQuickPreviewModalProps {
  asset: ImageAsset | null;
  assets?: ImageAsset[];
  thumbnailProfile?: ThumbnailProfile;
  startZoomed?: boolean;
  usageByAssetId?: Map<string, { pageNumber: number; pageId?: string; slotId?: string }>;
  pages?: PreviewPageTarget[];
  activePageId?: string | null;
  customLabelsCatalog?: string[];
  customLabelColors?: Record<string, CustomLabelTone>;
  customLabelShortcuts?: Record<string, CustomLabelShortcut | null>;
  onClose: () => void;
  onSelectAsset?: (assetId: string) => void;
  onAddToPage?: (pageId: string, assetId: string) => void;
  onJumpToPage?: (pageId: string) => void;
  onUpdateAsset?: (
    assetId: string,
    changes: Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel" | "customLabels">>
  ) => void;
}

type PickStatusFilter = PickStatus | "all";
type ColorFilter = ColorLabel | "all";
type PreviewFeedback = {
  kind: "star" | "pill" | "dot";
  label: string;
  token: number;
};

type QuickPreviewPerfSnapshot = {
  openLatencyMs: number | null;
  navigationLatencyMs: number | null;
  lastRenderedSource: string;
  lastRenderedAssetName: string;
};

type VirtualStripViewport = {
  scrollOffset: number;
  viewportSize: number;
};

const orientationLabels: Record<ImageAsset["orientation"], string> = {
  horizontal: "Orizzontale",
  vertical: "Verticale",
  square: "Quadrata"
};

const MIN_RAW_PREVIEW_DIMENSION = 900;
const SIDEBAR_THUMB_ESTIMATED_SIZE = 196;
const SIDEBAR_THUMB_OVERSCAN = 2;
const DOCK_THUMB_ESTIMATED_SIZE = 81;
const DOCK_THUMB_OVERSCAN = 4;

function getVirtualStripRange(
  totalCount: number,
  itemSize: number,
  overscan: number,
  viewport: VirtualStripViewport,
  anchorIndex: number,
): { start: number; endExclusive: number } {
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

function shouldLoadRawPreview(asset: ImageAsset): boolean {
  if (!isRawFile(asset.fileName)) {
    return false;
  }

  if (!asset.previewUrl) {
    return true;
  }

  return Math.min(asset.width, asset.height) > 0 &&
    Math.min(asset.width, asset.height) < MIN_RAW_PREVIEW_DIMENSION;
}

export function PhotoQuickPreviewModal({
  asset,
  assets = [],
  thumbnailProfile = "ultra-fast",
  startZoomed = false,
  usageByAssetId,
  pages = [],
  activePageId,
  customLabelsCatalog = [],
  customLabelColors = {},
  customLabelShortcuts = {},
  onClose,
  onSelectAsset,
  onAddToPage,
  onJumpToPage,
  onUpdateAsset
}: PhotoQuickPreviewModalProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sidebarStripRef = useRef<HTMLDivElement | null>(null);
  const dockStripRef = useRef<HTMLDivElement | null>(null);
  const assignFeedbackTimeoutRef = useRef<number | null>(null);
  const classificationFeedbackTimeoutRef = useRef<number | null>(null);
  const previewWarmupTimeoutRef = useRef<number | null>(null);
  const pendingSelectionReasonRef = useRef<"navigate" | "jump" | null>(null);
  const previewPerfStartRef = useRef<{
    assetId: string;
    startedAt: number;
    reason: "open" | "navigate" | "jump";
  } | null>(null);
  const lastAssetIdRef = useRef<string | null>(null);
  const classificationFeedbackTokenRef = useRef(0);
  const [filterPickStatus, setFilterPickStatus] = useState<PickStatusFilter>(DEFAULT_PHOTO_FILTERS.pickStatus);
  const [filterRating, setFilterRating] = useState(DEFAULT_PHOTO_FILTERS.ratingFilter);
  const [filterColorLabel, setFilterColorLabel] = useState<ColorFilter>(DEFAULT_PHOTO_FILTERS.colorLabel);
  const [filterCustomLabel, setFilterCustomLabel] = useState<string>("all");
  const [assignFeedbackPageNumber, setAssignFeedbackPageNumber] = useState<number | null>(null);
  const [resolvedPreviewUrl, setResolvedPreviewUrl] = useState<string | null>(null);
  const [resolvedDetailPreviewUrl, setResolvedDetailPreviewUrl] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareAssetId, setCompareAssetId] = useState<string | null>(null);
  const [resolvedComparePreviewUrl, setResolvedComparePreviewUrl] = useState<string | null>(null);
  const [classificationFeedback, setClassificationFeedback] = useState<PreviewFeedback | null>(null);
  const [quickPreviewPerf, setQuickPreviewPerf] = useState<QuickPreviewPerfSnapshot>({
    openLatencyMs: null,
    navigationLatencyMs: null,
    lastRenderedSource: "n/d",
    lastRenderedAssetName: "",
  });
  const [zoomLevel, setZoomLevel] = useState(startZoomed ? 2.2 : 1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [sidebarViewport, setSidebarViewport] = useState<VirtualStripViewport>({
    scrollOffset: 0,
    viewportSize: 0,
  });
  const [dockViewport, setDockViewport] = useState<VirtualStripViewport>({
    scrollOffset: 0,
    viewportSize: 0,
  });
  const panDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const panAnimationFrameRef = useRef<number | null>(null);
  const pendingPanOffsetRef = useRef<{ x: number; y: number } | null>(null);

  const usage = asset ? usageByAssetId?.get(asset.id) : undefined;
  const activePage = useMemo(
    () => pages.find((page) => page.id === activePageId) ?? null,
    [activePageId, pages]
  );

  const fitPreviewMaxDimension = thumbnailProfile === "ultra-fast"
    ? 1280
    : thumbnailProfile === "fast"
      ? 1600
      : 2048;
  const detailPreviewMaxDimension = thumbnailProfile === "ultra-fast"
    ? 1920
    : thumbnailProfile === "fast"
      ? 2600
      : 3200;
  const adjacentPreviewWarmupDelayMs = thumbnailProfile === "ultra-fast"
    ? 520
    : thumbnailProfile === "fast"
      ? 260
      : 140;
  const adjacentStandardPreviewWarmupDelayMs = thumbnailProfile === "ultra-fast"
    ? 40
    : thumbnailProfile === "fast"
      ? 90
      : 140;

  const hasActiveFilters =
    filterPickStatus !== "all"
    || filterRating !== "any"
    || filterColorLabel !== "all"
    || filterCustomLabel !== "all";

  const filteredAssets = useMemo(
    () =>
      assets.filter((item) =>
        matchesPhotoFilters(item, {
          pickStatus: filterPickStatus,
          ratingFilter: filterRating,
          colorLabel: filterColorLabel
        })
        && (
          filterCustomLabel === "all"
          || (item.customLabels ?? []).some(
            (label) => label.toLocaleLowerCase() === filterCustomLabel.toLocaleLowerCase(),
          )
        )
      ),
    [assets, filterColorLabel, filterCustomLabel, filterRating, filterPickStatus]
  );

  const selectAssetFromPreview = useCallback((assetId: string, reason: "navigate" | "jump" = "jump") => {
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
  const currentIndex = useMemo(
    () => (asset ? navigationAssets.findIndex((item) => item.id === asset.id) : -1),
    [asset, navigationAssets]
  );
  const previousAsset = currentIndex > 0 ? navigationAssets[currentIndex - 1] : null;
  const nextAsset =
    currentIndex >= 0 && currentIndex < navigationAssets.length - 1
      ? navigationAssets[currentIndex + 1]
      : null;
  const compareAsset = compareAssetId
    ? navigationAssets.find((item) => item.id === compareAssetId && item.id !== asset?.id) ?? null
    : null;

  const handleNavigate = useCallback(
    (direction: "previous" | "next") => {
      if (currentIndex < 0) {
        return;
      }

      const targetIndex = direction === "previous" ? currentIndex - 1 : currentIndex + 1;
      const targetAsset = navigationAssets[targetIndex];
      if (targetAsset) {
        selectAssetFromPreview(targetAsset.id, "navigate");
      }
    },
    [currentIndex, navigationAssets, selectAssetFromPreview]
  );

  const announceClassificationFeedback = useCallback((
    changes: Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">>
  ) => {
    let label: string | null = null;
    let kind: PreviewFeedback["kind"] | null = null;

    if (changes.rating !== undefined) {
      kind = "star";
      label = changes.rating > 0 ? `Valutazione: ${"★".repeat(changes.rating)}` : "Valutazione rimossa";
    } else if (changes.pickStatus !== undefined) {
      kind = "pill";
      label = `Stato: ${PICK_STATUS_LABELS[changes.pickStatus]}`;
    } else if (changes.colorLabel !== undefined) {
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
    } satisfies PreviewFeedback;

    setClassificationFeedback(nextFeedback);

    if (classificationFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(classificationFeedbackTimeoutRef.current);
    }

    classificationFeedbackTimeoutRef.current = window.setTimeout(() => {
      setClassificationFeedback((current) =>
        current?.token === nextFeedback.token ? null : current
      );
      classificationFeedbackTimeoutRef.current = null;
    }, 1200);
  }, []);

  const updateRating = useCallback(
    (rating: number) => {
      if (asset && onUpdateAsset) {
        const changes = { rating } satisfies Partial<Pick<ImageAsset, "rating">>;
        onUpdateAsset(asset.id, changes);
        announceClassificationFeedback(changes);
      }
    },
    [announceClassificationFeedback, asset, onUpdateAsset]
  );

  const updatePickStatus = useCallback(
    (pickStatus: PickStatus) => {
      if (asset && onUpdateAsset) {
        const changes = { pickStatus } satisfies Partial<Pick<ImageAsset, "pickStatus">>;
        onUpdateAsset(asset.id, changes);
        announceClassificationFeedback(changes);
      }
    },
    [announceClassificationFeedback, asset, onUpdateAsset]
  );

  const updateColorLabel = useCallback(
    (colorLabel: ColorLabel | null) => {
      if (asset && onUpdateAsset) {
        const changes = { colorLabel } satisfies Partial<Pick<ImageAsset, "colorLabel">>;
        onUpdateAsset(asset.id, changes);
        announceClassificationFeedback(changes);
      }
    },
    [announceClassificationFeedback, asset, onUpdateAsset]
  );

  const activePageCanAccept = Boolean(
    activePage &&
      (!(activePage.isAtCapacity ?? false) || usage?.pageId === activePage.id)
  );
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

  const getQuickPreviewThumbUrl = useCallback((item: ImageAsset): string | null => {
    return item.thumbnailUrl ?? item.previewUrl ?? null;
  }, []);

  const sidebarVirtualRange = useMemo(
    () => getVirtualStripRange(
      navigationAssets.length,
      SIDEBAR_THUMB_ESTIMATED_SIZE,
      SIDEBAR_THUMB_OVERSCAN,
      sidebarViewport,
      currentIndex,
    ),
    [currentIndex, navigationAssets.length, sidebarViewport],
  );
  const dockVirtualRange = useMemo(
    () => getVirtualStripRange(
      navigationAssets.length,
      DOCK_THUMB_ESTIMATED_SIZE,
      DOCK_THUMB_OVERSCAN,
      dockViewport,
      currentIndex,
    ),
    [currentIndex, dockViewport, navigationAssets.length],
  );

  const sidebarStripItems = useMemo(
    () => navigationAssets.slice(sidebarVirtualRange.start, sidebarVirtualRange.endExclusive),
    [navigationAssets, sidebarVirtualRange.endExclusive, sidebarVirtualRange.start],
  );
  const dockStripItems = useMemo(
    () => navigationAssets.slice(dockVirtualRange.start, dockVirtualRange.endExclusive),
    [dockVirtualRange.endExclusive, dockVirtualRange.start, navigationAssets],
  );

  const sidebarTopSpacerHeight = sidebarVirtualRange.start * SIDEBAR_THUMB_ESTIMATED_SIZE;
  const sidebarBottomSpacerHeight = Math.max(
    0,
    (navigationAssets.length - sidebarVirtualRange.endExclusive) * SIDEBAR_THUMB_ESTIMATED_SIZE,
  );
  const dockLeftSpacerWidth = dockVirtualRange.start * DOCK_THUMB_ESTIMATED_SIZE;
  const dockRightSpacerWidth = Math.max(
    0,
    (navigationAssets.length - dockVirtualRange.endExclusive) * DOCK_THUMB_ESTIMATED_SIZE,
  );

  // Preload only prev/current/next thumbnails or lightweight previews.
  useEffect(() => {
    if (currentIndex < 0) return;
    const toPreload: string[] = [];

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
  }, [asset, currentIndex, getQuickPreviewThumbUrl, nextAsset, previousAsset]);

  useEffect(() => {
    if (currentIndex < 0) {
      return;
    }

    const standardCandidates = [asset, previousAsset, nextAsset].filter((candidate): candidate is ImageAsset => {
      if (!candidate) {
        return false;
      }

      return !shouldLoadRawPreview(candidate);
    });

    if (standardCandidates.length === 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      void Promise.all(
        standardCandidates.map((candidate, index) =>
          createOnDemandPreviewAsync(candidate.id, index === 0 ? 0 : 1, {
            maxDimension: fitPreviewMaxDimension,
          }).catch(() => null),
        ),
      );
    }, adjacentStandardPreviewWarmupDelayMs);

    return () => window.clearTimeout(timer);
  }, [
    adjacentStandardPreviewWarmupDelayMs,
    asset,
    currentIndex,
    fitPreviewMaxDimension,
    nextAsset,
    previousAsset,
  ]);

  const availableCustomLabels = useMemo(() => {
    const merged = [...customLabelsCatalog, ...Object.keys(customLabelColors)];
    const seen = new Set<string>();
    const labels: string[] = [];

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
      .filter((entry): entry is [string, CustomLabelShortcut] => Boolean(entry[1]));
    return new Map(entries.map(([label, shortcut]) => [shortcut, label]));
  }, [customLabelShortcuts]);

  const activePreviewAssetNeedsManagedPreview = Boolean(
    asset && (!asset.previewUrl || !asset.sourceUrl || shouldLoadRawPreview(asset))
  );

  useEffect(() => {
    if (previewWarmupTimeoutRef.current !== null) {
      window.clearTimeout(previewWarmupTimeoutRef.current);
      previewWarmupTimeoutRef.current = null;
    }

    if (currentIndex < 0) {
      return;
    }

    const adjacentManagedWarmups = [previousAsset, nextAsset].filter((candidate): candidate is ImageAsset => {
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
        void Promise.all(
          adjacentManagedWarmups.map((candidate) =>
            warmOnDemandPreviewCache(candidate.id, 2, {
              maxDimension: fitPreviewMaxDimension,
            }).catch(() => null)
          )
        );
      }, adjacentPreviewWarmupDelayMs);
    }

    return () => {
      if (previewWarmupTimeoutRef.current !== null) {
        window.clearTimeout(previewWarmupTimeoutRef.current);
        previewWarmupTimeoutRef.current = null;
      }
    };
  }, [adjacentPreviewWarmupDelayMs, currentIndex, fitPreviewMaxDimension, nextAsset, previousAsset]);

  useEffect(() => {
    return () => {
      if (previewWarmupTimeoutRef.current !== null) {
        window.clearTimeout(previewWarmupTimeoutRef.current);
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
      setResolvedDetailPreviewUrl(null);
      return;
    }

    setResolvedDetailPreviewUrl(null);

    if (!activePreviewAssetNeedsManagedPreview) {
      setResolvedPreviewUrl(null);
      return;
    }

    let active = true;
    const cachedPreviewUrl = getCachedOnDemandPreviewUrl(asset.id, {
      maxDimension: fitPreviewMaxDimension,
    });
    setResolvedPreviewUrl(cachedPreviewUrl);

    createOnDemandPreviewAsync(asset.id, 0, {
      maxDimension: fitPreviewMaxDimension,
    })
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
  }, [activePreviewAssetNeedsManagedPreview, asset, fitPreviewMaxDimension]);

  useEffect(() => {
    if (!asset || compareMode || zoomLevel <= 1.05 || !activePreviewAssetNeedsManagedPreview) {
      setResolvedDetailPreviewUrl(null);
      return;
    }

    let active = true;
    const cachedDetailPreviewUrl = getCachedOnDemandPreviewUrl(asset.id, {
      maxDimension: detailPreviewMaxDimension,
    });
    setResolvedDetailPreviewUrl(cachedDetailPreviewUrl);

    createOnDemandPreviewAsync(asset.id, 0, {
      maxDimension: detailPreviewMaxDimension,
    })
      .then((url) => {
        if (active && url) {
          setResolvedDetailPreviewUrl(url);
        }
      })
      .catch(() => {
        if (active) {
          setResolvedDetailPreviewUrl(null);
        }
      });

    return () => {
      active = false;
    };
  }, [activePreviewAssetNeedsManagedPreview, asset, compareMode, detailPreviewMaxDimension, zoomLevel]);

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

    const cachedComparePreviewUrl = getCachedOnDemandPreviewUrl(compareAsset.id, {
      maxDimension: fitPreviewMaxDimension,
    });
    setResolvedComparePreviewUrl(cachedComparePreviewUrl);

    createOnDemandPreviewAsync(compareAsset.id, 1, {
      maxDimension: fitPreviewMaxDimension,
    })
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
  }, [compareAsset, fitPreviewMaxDimension]);

  useEffect(() => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (!asset) {
      lastAssetIdRef.current = null;
      previewPerfStartRef.current = null;
      return;
    }

    const previousAssetId = lastAssetIdRef.current;
    const reason: "open" | "navigate" | "jump" =
      previousAssetId === null
        ? "open"
        : pendingSelectionReasonRef.current === "navigate"
          ? "navigate"
          : "jump";

    previewPerfStartRef.current = {
      assetId: asset.id,
      startedAt: now,
      reason,
    };
    pendingSelectionReasonRef.current = null;
    lastAssetIdRef.current = asset.id;
  }, [asset?.id]);

  useEffect(() => {
    const element = sidebarStripRef.current;
    if (!element) {
      return;
    }

    const sync = () => {
      setSidebarViewport({
        scrollOffset: element.scrollTop,
        viewportSize: element.clientHeight,
      });
    };

    sync();
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);

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
    const sidebar = sidebarStripRef.current;
    if (!sidebar || currentIndex < 0) {
      return;
    }

    const itemStart = currentIndex * SIDEBAR_THUMB_ESTIMATED_SIZE;
    const itemEnd = itemStart + SIDEBAR_THUMB_ESTIMATED_SIZE;
    const viewportStart = sidebar.scrollTop;
    const viewportEnd = viewportStart + sidebar.clientHeight;

    if (itemStart < viewportStart) {
      sidebar.scrollTo({ top: Math.max(0, itemStart - 12), behavior: "smooth" });
    } else if (itemEnd > viewportEnd) {
      sidebar.scrollTo({
        top: Math.max(0, itemEnd - sidebar.clientHeight + 12),
        behavior: "smooth",
      });
    }
  }, [currentIndex]);

  useEffect(() => {
    const dock = dockStripRef.current;
    if (!dock || currentIndex < 0) {
      return;
    }

    const itemStart = currentIndex * DOCK_THUMB_ESTIMATED_SIZE;
    const itemEnd = itemStart + DOCK_THUMB_ESTIMATED_SIZE;
    const viewportStart = dock.scrollLeft;
    const viewportEnd = viewportStart + dock.clientWidth;

    if (itemStart < viewportStart) {
      dock.scrollTo({ left: Math.max(0, itemStart - 24), behavior: "smooth" });
    } else if (itemEnd > viewportEnd) {
      dock.scrollTo({
        left: Math.max(0, itemEnd - dock.clientWidth + 24),
        behavior: "smooth",
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

  const clampPan = useCallback((x: number, y: number, zoom = zoomLevel) => {
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

  const commitPanOffset = useCallback((nextPanOffset: { x: number; y: number }) => {
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

  const applyZoom = useCallback((nextZoom: number) => {
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

  const panBy = useCallback((deltaX: number, deltaY: number) => {
    if (compareMode || zoomLevel <= 1.05) {
      return;
    }

    const nextPanOffset = clampPan(
      (pendingPanOffsetRef.current?.x ?? panOffset.x) + deltaX,
      (pendingPanOffsetRef.current?.y ?? panOffset.y) + deltaY,
    );
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

    const handleKeyDown = (event: KeyboardEvent) => {
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
        const shortcutLabel = customLabelByShortcut.get(event.key.toUpperCase() as CustomLabelShortcut);
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
        if (
          target instanceof HTMLElement &&
          target.closest("input, textarea, select, button, [contenteditable='true']") !== null
        ) {
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
      if (
        target instanceof HTMLElement &&
        (target.closest("input, textarea, select, [contenteditable='true']") !== null ||
          target.isContentEditable)
      ) {
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
  const previewUrl =
    resolvedDetailPreviewUrl ?? resolvedPreviewUrl ?? asset?.previewUrl ?? asset?.sourceUrl ?? null;
  const comparePreviewUrl = compareAsset
    ? resolvedComparePreviewUrl ?? compareAsset.previewUrl ?? compareAsset.sourceUrl
    : null;
  const previewSourceLabel = resolvedDetailPreviewUrl
    ? "Detail"
    : resolvedPreviewUrl
      ? "Fit"
      : asset?.previewUrl
        ? "Embedded"
        : asset?.sourceUrl
          ? "Source"
          : "Fallback";

  function toggleCustomLabel(label: string) {
    if (!asset || !onUpdateAsset) {
      return;
    }

    const nextCustomLabels = currentCustomLabels.includes(label)
      ? currentCustomLabels.filter((currentLabel) => currentLabel !== label)
      : [...currentCustomLabels, label];

    onUpdateAsset(asset.id, {
      customLabels: nextCustomLabels,
    });
  }

  const handleSidebarStripScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setSidebarViewport({
      scrollOffset: event.currentTarget.scrollTop,
      viewportSize: event.currentTarget.clientHeight,
    });
  }, []);

  const handleDockStripScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setDockViewport({
      scrollOffset: event.currentTarget.scrollLeft,
      viewportSize: event.currentTarget.clientWidth,
    });
  }, []);

  const handleMainPreviewLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const measurement = previewPerfStartRef.current;
    if (!measurement || measurement.assetId !== currentAssetId) {
      return;
    }

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const elapsed = Math.max(0, Math.round(now - measurement.startedAt));
    const renderedSource = event.currentTarget.currentSrc || event.currentTarget.src || previewSourceLabel;

    setQuickPreviewPerf((current) => ({
      openLatencyMs: measurement.reason === "open" ? elapsed : current.openLatencyMs,
      navigationLatencyMs: measurement.reason === "navigate" ? elapsed : current.navigationLatencyMs,
      lastRenderedSource: `${previewSourceLabel} · ${renderedSource ? "ready" : "n/d"}`,
      lastRenderedAssetName: currentAssetFileName,
    }));
    previewPerfStartRef.current = null;
  }, [currentAssetFileName, currentAssetId, previewSourceLabel]);

  useEffect(() => {
    if (previewUrl) {
      return;
    }

    const measurement = previewPerfStartRef.current;
    if (!measurement || measurement.assetId !== currentAssetId) {
      return;
    }

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const elapsed = Math.max(0, Math.round(now - measurement.startedAt));

    setQuickPreviewPerf((current) => ({
      openLatencyMs: measurement.reason === "open" ? elapsed : current.openLatencyMs,
      navigationLatencyMs: measurement.reason === "navigate" ? elapsed : current.navigationLatencyMs,
      lastRenderedSource: "Placeholder",
      lastRenderedAssetName: currentAssetFileName,
    }));
    previewPerfStartRef.current = null;
  }, [currentAssetFileName, currentAssetId, previewUrl]);

  if (!asset) {
    return null;
  }

  const rating = getAssetRating(asset);
  const pickStatus = getAssetPickStatus(asset);
  const colorLabel = getAssetColorLabel(asset);

  const previewContent = (
    <div
      className="quick-preview"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Anteprima foto a schermo intero"
    >
      {/* ── SIDEBAR SINISTRA: filtri + thumbnail verticali ── */}
      {assets.length > 1 ? (
        <div className="quick-preview__sidebar" onClick={(event) => event.stopPropagation()}>
          <div className="quick-preview__sidebar-filters">
            <div className="quick-preview__filter-summary">
              {hasActiveFilters
                ? `${filteredAssets.length} di ${assets.length} foto`
                : `${assets.length} foto`}
            </div>
            <div className="quick-preview__filter-controls">
              <label className="quick-preview__filter-field">
                <span>Stato</span>
                <select
                  className="quick-preview__filter-select"
                  value={filterPickStatus}
                  onChange={(event) =>
                    setFilterPickStatus(event.target.value as PickStatusFilter)
                  }
                >
                  <option value="all">Tutti</option>
                  <option value="picked">Pick</option>
                  <option value="rejected">Scartate</option>
                  <option value="unmarked">Neutre</option>
                </select>
              </label>

              <label className="quick-preview__filter-field">
                <span>Stelle</span>
                <select
                  className="quick-preview__filter-select"
                  value={filterRating}
                  onChange={(event) => setFilterRating(event.target.value)}
                >
                  <option value="any">Tutte</option>
                  <optgroup label="Minimo">
                    <option value="1+">★ 1+</option>
                    <option value="2+">★★ 2+</option>
                    <option value="3+">★★★ 3+</option>
                    <option value="4+">★★★★ 4+</option>
                  </optgroup>
                  <optgroup label="Esatto">
                    <option value="0">Senza stelle</option>
                    <option value="1">★ Solo 1</option>
                    <option value="2">★★ Solo 2</option>
                    <option value="3">★★★ Solo 3</option>
                    <option value="4">★★★★ Solo 4</option>
                    <option value="5">★★★★★ Solo 5</option>
                  </optgroup>
                </select>
              </label>

              {availableCustomLabels.length > 0 ? (
                <label className="quick-preview__filter-field">
                  <span>Label custom</span>
                  <select
                    className="quick-preview__filter-select"
                    value={filterCustomLabel}
                    onChange={(event) => setFilterCustomLabel(event.target.value)}
                  >
                    <option value="all">Tutte</option>
                    {availableCustomLabels.map((label) => (
                      <option key={`preview-label-${label}`} value={label}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="quick-preview__filter-colors">
              <button
                type="button"
                className={
                  filterColorLabel === "all"
                    ? "quick-preview__color-chip quick-preview__color-chip--clear quick-preview__color-chip--selected"
                    : "quick-preview__color-chip quick-preview__color-chip--clear"
                }
                onClick={() => setFilterColorLabel("all")}
              >
                Tutti
              </button>
              {COLOR_LABELS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={
                    filterColorLabel === value
                      ? `quick-preview__color-chip quick-preview__color-chip--${value} quick-preview__color-chip--selected`
                      : `quick-preview__color-chip quick-preview__color-chip--${value}`
                  }
                  onClick={() => setFilterColorLabel(value)}
                  title={COLOR_LABEL_NAMES[value]}
                />
              ))}
            </div>
          </div>

          {navigationAssets.length > 0 ? (
            <div
              ref={sidebarStripRef}
              className="quick-preview__strip"
              onScroll={handleSidebarStripScroll}
            >
              {sidebarTopSpacerHeight > 0 ? (
                <div
                  className="quick-preview__virtual-spacer"
                  style={{ height: sidebarTopSpacerHeight }}
                  aria-hidden="true"
                />
              ) : null}
              {sidebarStripItems.map((item) => {
                const itemPreview = getQuickPreviewThumbUrl(item);
                const isActive = item.id === asset.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={
                      isActive
                        ? "quick-preview__thumb quick-preview__thumb--active"
                        : "quick-preview__thumb"
                    }
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => selectAssetFromPreview(item.id, "jump")}
                  >
                    {itemPreview ? (
                      <img
                        src={itemPreview}
                        alt={item.fileName}
                        className="quick-preview__thumb-image"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      item.fileName
                    )}
                  </button>
                );
              })}
              {sidebarBottomSpacerHeight > 0 ? (
                <div
                  className="quick-preview__virtual-spacer"
                  style={{ height: sidebarBottomSpacerHeight }}
                  aria-hidden="true"
                />
              ) : null}
            </div>
          ) : hasActiveFilters ? (
            <div className="quick-preview__empty-filter">
              Nessuna foto corrisponde ai filtri attivi.
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── AREA PRINCIPALE DESTRA: chrome + meta + foto + assign ── */}
      <div className="quick-preview__main" onClick={(event) => event.stopPropagation()}>
        <div className="quick-preview__chrome">
          <div className="quick-preview__title">
            <strong>{asset.fileName}</strong>
            <span>
              {asset.width} x {asset.height} | {orientationLabels[asset.orientation]}
              {asset.width > 0 && asset.height > 0
                ? ` | ${((asset.width * asset.height) / 1_000_000).toFixed(1)} MP`
                : ""}
              {usage ? ` | Foglio ${usage.pageNumber}` : " | Non ancora usata nel layout"}
            </span>
            {asset.xmpHasEdits ? (
              <span className="quick-preview__xmp-badge" title="Metadati XMP rilevati">
                XMP Edit: {asset.xmpEditInfo ?? "Sviluppo rilevato"}
              </span>
            ) : null}
          </div>

        <div className="quick-preview__actions">
          <span className="quick-preview__stars">{formatAssetStars(asset)}</span>
            {classificationFeedback ? (
              <span
                key={classificationFeedback.token}
                className={`quick-preview__feedback quick-preview__feedback--${classificationFeedback.kind}`}
                aria-live="polite"
              >
                {classificationFeedback.label}
              </span>
            ) : null}
            <PhotoClassificationHelpButton title="Scorciatoie preview foto" />
            <span
              className="quick-preview__perf-badge"
              title="Benchmark locale della quick preview"
            >
              {`Open ${quickPreviewPerf.openLatencyMs ?? "n/d"} ms · Nav ${quickPreviewPerf.navigationLatencyMs ?? "n/d"} ms · ${quickPreviewPerf.lastRenderedSource}`}
            </span>
            <button
              type="button"
              className={
                compareMode
                  ? "ghost-button quick-preview__action quick-preview__action--active"
                  : "ghost-button quick-preview__action"
              }
              onClick={() => setCompareMode((current) => !current)}
              disabled={!nextAsset && !previousAsset}
            >
              {compareMode ? "Chiudi confronto" : "Confronta"}
            </button>
            <button
              type="button"
              className="ghost-button quick-preview__action"
              onClick={toggleZoom}
            >
              {zoomLevel > 1.05 ? "Adatta" : "Zoom 220%"}
            </button>
            <button
              type="button"
              className="ghost-button quick-preview__action"
              onClick={toggleNativeFullscreen}
            >
              Fullscreen
            </button>
            <button
              type="button"
              className="ghost-button quick-preview__action"
              onClick={() => void saveAssetAs(asset.id)}
              title="Salva una copia del file in una posizione a scelta per aprirlo in un editor esterno (Photoshop, Lightroom, ecc.)"
            >
              Salva copia
            </button>
            <button type="button" className="ghost-button quick-preview__action" onClick={onClose}>
              Chiudi
            </button>
          </div>
        </div>

        <div className="quick-preview__meta-bar">
          <div className="quick-preview__meta-group">
            <span className="quick-preview__meta-label">Stelle</span>
            <div className="quick-preview__stars-editor">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={
                    value <= rating
                      ? "quick-preview__star quick-preview__star--active"
                      : "quick-preview__star"
                  }
                  onClick={() => updateRating(value)}
                >
                  ★
                </button>
              ))}
              <button
                type="button"
                className="ghost-button quick-preview__tiny-action"
                onClick={() => updateRating(0)}
              >
                Azzera
              </button>
            </div>
          </div>

          <div className="quick-preview__meta-group">
            <span className="quick-preview__meta-label">Stato</span>
            <div className="quick-preview__pill-row">
              {(["picked", "rejected", "unmarked"] as PickStatus[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={
                    pickStatus === value
                      ? "quick-preview__pill quick-preview__pill--active"
                      : "quick-preview__pill"
                  }
                  onClick={() => updatePickStatus(value)}
                >
                  {PICK_STATUS_LABELS[value]}
                </button>
              ))}
            </div>
          </div>

          <div className="quick-preview__meta-group">
            <span className="quick-preview__meta-label">Colore</span>
            <div className="quick-preview__color-row">
              <button
                type="button"
                className={
                  colorLabel === null
                    ? "quick-preview__color-chip quick-preview__color-chip--clear quick-preview__color-chip--selected"
                    : "quick-preview__color-chip quick-preview__color-chip--clear"
                }
                onClick={() => updateColorLabel(null)}
              >
                Nessuno
              </button>
              {COLOR_LABELS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={
                    colorLabel === value
                      ? `quick-preview__color-chip quick-preview__color-chip--${value} quick-preview__color-chip--selected`
                      : `quick-preview__color-chip quick-preview__color-chip--${value}`
                  }
                  onClick={() => updateColorLabel(value)}
                  title={`${COLOR_LABEL_NAMES[value]} | ${getColorShortcutHint(value)}`}
                />
              ))}
            </div>
          </div>

          {availableCustomLabels.length > 0 ? (
            <div className="quick-preview__meta-group">
              <span className="quick-preview__meta-label">Label custom</span>
              <div className="quick-preview__pill-row">
                {availableCustomLabels.map((label) => {
                  const tone = customLabelColors[label] ?? "sand";
                  const isActive = currentCustomLabels.includes(label);
                  const shortcut = customLabelShortcuts[label] ?? null;
                  return (
                    <button
                      key={label}
                      type="button"
                      className={
                        isActive
                          ? `quick-preview__custom-label quick-preview__custom-label--${tone} quick-preview__custom-label--active`
                          : `quick-preview__custom-label quick-preview__custom-label--${tone}`
                      }
                      onClick={() => toggleCustomLabel(label)}
                      title={shortcut ? `${label} · scorciatoia ${shortcut}` : label}
                    >
                      {shortcut ? `${label} · ${shortcut}` : label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <div
          className={
            compareMode && compareAsset
              ? "quick-preview__stage quick-preview__stage--compare"
              : zoomLevel > 1.05
                ? isPanning
                  ? "quick-preview__stage quick-preview__stage--zoomed quick-preview__stage--panning"
                  : "quick-preview__stage quick-preview__stage--zoomed"
                : "quick-preview__stage"
          }
          ref={stageRef}
          onWheel={(event) => {
            if (compareMode) {
              return;
            }
            event.preventDefault();
            const nextZoom = zoomLevel + (event.deltaY < 0 ? 0.25 : -0.25);
            if (nextZoom <= 1) {
              setPanOffset({ x: 0, y: 0 });
            }
            applyZoom(nextZoom);
          }}
          onPointerDown={(event) => {
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
          }}
          onPointerMove={(event) => {
            const drag = panDragRef.current;
            if (!drag || drag.pointerId !== event.pointerId || compareMode || zoomLevel <= 1.05) {
              return;
            }
            const deltaX = event.clientX - drag.startX;
            const deltaY = event.clientY - drag.startY;
            commitPanOffset(clampPan(drag.originX + deltaX, drag.originY + deltaY));
          }}
          onPointerUp={(event) => {
            if (panDragRef.current?.pointerId === event.pointerId) {
              panDragRef.current = null;
              setIsPanning(false);
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }
          }}
          onPointerCancel={(event) => {
            if (panDragRef.current?.pointerId === event.pointerId) {
              panDragRef.current = null;
              setIsPanning(false);
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }
          }}
          onLostPointerCapture={() => {
            panDragRef.current = null;
            setIsPanning(false);
          }}
        >
          {previousAsset ? (
            <button
              type="button"
              className="quick-preview__nav quick-preview__nav--prev"
              onClick={() => handleNavigate("previous")}
            >
              {"<"}
            </button>
          ) : null}

          {compareMode && compareAsset ? (
            <div className="quick-preview__compare-grid">
              <div className="quick-preview__compare-panel">
                <span className="quick-preview__compare-label">Corrente</span>
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={asset.fileName}
                    className="quick-preview__image quick-preview__image--compare"
                    draggable={false}
                    onDoubleClick={toggleNativeFullscreen}
                  />
                ) : (
                  <div className="quick-preview__placeholder">
                    <div className="quick-preview__placeholder-copy">
                      <strong>Anteprima in caricamento</strong>
                      <span>{asset.fileName}</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="quick-preview__compare-panel">
                <span className="quick-preview__compare-label">{compareAsset.fileName}</span>
                {comparePreviewUrl ? (
                  <img
                    src={comparePreviewUrl}
                    alt={compareAsset.fileName}
                    className="quick-preview__image quick-preview__image--compare"
                    draggable={false}
                    onDoubleClick={toggleNativeFullscreen}
                  />
                ) : (
                  <div className="quick-preview__placeholder">
                    <div className="quick-preview__placeholder-copy">
                      <strong>Anteprima in caricamento</strong>
                      <span>{compareAsset.fileName}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : previewUrl ? (
            <img
              src={previewUrl}
              alt={asset.fileName}
              className={
                zoomLevel > 1.05
                  ? isPanning
                    ? "quick-preview__image quick-preview__image--zoomed quick-preview__image--panning"
                    : "quick-preview__image quick-preview__image--zoomed"
                  : "quick-preview__image"
              }
              draggable={false}
              decoding="sync"
              onLoad={handleMainPreviewLoad}
              onDoubleClick={toggleNativeFullscreen}
              style={{
                transform: `translate3d(${panOffset.x}px, ${panOffset.y}px, 0) scale(${zoomLevel})`,
              }}
            />
          ) : (
            <div className="quick-preview__placeholder">
              <div className="quick-preview__placeholder-copy">
                <strong>Anteprima in caricamento</strong>
                <span>{asset.fileName}</span>
              </div>
            </div>
          )}

          {nextAsset ? (
            <button
              type="button"
              className="quick-preview__nav quick-preview__nav--next"
              onClick={() => handleNavigate("next")}
            >
              {">"}
            </button>
          ) : null}
        </div>

        {navigationAssets.length > 1 ? (
          <div className="quick-preview__dock">
            <div className="quick-preview__dock-copy">
              <strong>
                Foto {currentIndex + 1} di {navigationAssets.length}
              </strong>
              <span>
                {previousAsset ? `Prec: ${previousAsset.fileName}` : "Inizio serie"} ·{" "}
                {nextAsset ? `Succ: ${nextAsset.fileName}` : "Fine serie"}
              </span>
            </div>
            <div
              ref={dockStripRef}
              className="quick-preview__dock-strip"
              onScroll={handleDockStripScroll}
            >
              {dockLeftSpacerWidth > 0 ? (
                <div
                  className="quick-preview__dock-spacer"
                  style={{ width: dockLeftSpacerWidth }}
                  aria-hidden="true"
                />
              ) : null}
              {dockStripItems.map((item) => {
                const itemPreview = getQuickPreviewThumbUrl(item);
                const isActive = item.id === asset.id;

                return (
                  <button
                    key={`dock-${item.id}`}
                    type="button"
                    className={
                      isActive
                        ? "quick-preview__dock-thumb quick-preview__dock-thumb--active"
                        : "quick-preview__dock-thumb"
                    }
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => selectAssetFromPreview(item.id, "jump")}
                    title={item.fileName}
                  >
                    {itemPreview ? (
                      <img
                        src={itemPreview}
                        alt={item.fileName}
                        className="quick-preview__dock-image"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span className="quick-preview__dock-fallback">{item.fileName}</span>
                    )}
                  </button>
                );
              })}
              {dockRightSpacerWidth > 0 ? (
                <div
                  className="quick-preview__dock-spacer"
                  style={{ width: dockRightSpacerWidth }}
                  aria-hidden="true"
                />
              ) : null}
            </div>
          </div>
        ) : null}

        {pages.length > 0 && onAddToPage ? (
          <div
            className={
              showAssignSuccess
                ? "quick-preview__assign-bar quick-preview__assign-bar--success"
                : "quick-preview__assign-bar"
            }
          >
            <div className="quick-preview__assign-copy">
              <strong>
                {activePage
                  ? `Foglio attivo ${activePage.pageNumber}`
                  : "Nessun foglio attivo"}
              </strong>
              <span>
                {activePage
                  ? activePageCanAccept
                    ? usage?.pageId === activePage.id
                      ? "La foto è già in questo foglio. Premi Invio per riorganizzarlo."
                      : "Premi Invio per aggiungere questa foto al foglio attivo."
                    : "Il foglio attivo è pieno. Seleziona un altro foglio nello studio."
                  : "Seleziona un foglio nello studio per usare l'aggiunta rapida."}
              </span>
              {showAssignSuccess ? (
                <span className="quick-preview__assign-success" aria-live="polite">
                  Foto aggiunta al foglio attivo {assignFeedbackPageNumber}.
                </span>
              ) : null}
            </div>

            <div className="quick-preview__assign-actions">
              <button
                type="button"
                className={
                  showAssignSuccess
                    ? "secondary-button quick-preview__assign-button quick-preview__assign-button--active quick-preview__assign-button--success"
                    : "secondary-button quick-preview__assign-button quick-preview__assign-button--active"
                }
                onClick={handleAssignToActivePage}
                disabled={!activePage || !activePageCanAccept}
              >
                {!activePage
                  ? "Nessun foglio attivo"
                  : usage?.pageId === activePage.id
                  ? `Riorganizza foglio ${activePage.pageNumber}`
                  : `Aggiungi al foglio ${activePage.pageNumber}`}
              </button>

              {usage?.pageId && onJumpToPage && usage.pageId !== activePage?.id ? (
                <button
                  type="button"
                  className="ghost-button quick-preview__assign-button"
                  onClick={() => onJumpToPage(usage.pageId!)}
                >
                  {`Vai al foglio ${usage.pageNumber}`}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return previewContent;
  }

  return createPortal(previewContent, document.body);
}
