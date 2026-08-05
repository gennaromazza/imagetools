import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DesktopCloudProjectManifest,
  DesktopCloudProjectVersion,
  DesktopCacheLocationRecommendation,
  DesktopFolderCatalogAssetState,
  DesktopFolderCatalogState,
  DesktopPerformanceSnapshot,
  DesktopPersistedState,
  DesktopRamBudgetPreset,
  DesktopRuntimeInfo,
  DesktopThumbnailCacheInfo,
} from "@photo-tools/desktop-contracts";
import type { ImageAsset, ImageOrientation } from "@photo-tools/shared-types";
import {
  revokeImageAssetUrls,
} from "./services/browser-image-assets";
import {
  acknowledgeDesktopOpenFolderRequest,
  consumePendingDesktopOpenFolderPath,
  getDesktopRuntimeInfo,
  markDesktopOpenFolderRequestReady,
  subscribeDesktopOpenFolderRequest,
} from "./services/desktop-runtime";
import {
  chooseDesktopThumbnailCacheDirectory,
  clearDesktopThumbnailCache,
  dismissDesktopCacheLocationRecommendation,
  getDesktopCacheLocationRecommendation,
  getDesktopThumbnailCacheInfo,
  migrateDesktopThumbnailCacheDirectory,
  relaunchDesktopApp,
  resetDesktopThumbnailCacheDirectory,
  setDesktopRamBudgetPreset,
  setDesktopThumbnailCacheDirectory,
} from "./services/desktop-thumbnail-cache";
import { clearImageCache } from "./services/image-cache";
import {
  buildPlaceholderAssets,
  addRecentFolder,
  getAssetAbsolutePath,
  buildSourceFileKeyFromStats,
  isRawFile,
  openProjectFolderNative,
  readSidecarXmp,
  reopenProjectFolder,
  warmOnDemandPreviewCache,
  writeSidecarXmp,
  type FolderOpenDiagnostics,
  type FolderOpenResult,
} from "./services/folder-access";
import { parseXmpState, upsertXmpState } from "./services/xmp-sidecar";
import {
  ThumbnailPipeline,
  type ThumbnailPipelineOptions,
  type ThumbnailUpdate,
} from "./services/thumbnail-pipeline";
import { loadCachedThumbnails } from "./services/thumbnail-cache";
import {
  clearDesktopQuickPreviewFrameCache,
  releaseDesktopQuickPreviewFrames,
} from "./services/desktop-quick-preview";
import {
  applyThumbnailViews,
  clearThumbnailViews,
  getThumbnailView,
  getThumbnailViewEntries,
  removeThumbnailViews,
  type ThumbnailViewState,
} from "./services/thumbnail-view-store";
import {
  beginReactBatchMetric,
  cancelReactBatchMetric,
  finishReactBatchMetric,
  getPerfByteReadStats,
  perfLog,
  perfTime,
  perfTimeEnd,
  resetPerfByteReadStats,
} from "./services/performance-utils";
import {
  loadPhotoSelectorPreferences,
  hydratePhotoSelectorPreferences,
  type ThumbnailProfile,
} from "./services/photo-selector-preferences";
import {
  getDesktopFolderCatalogState,
  getDesktopSessionState,
  hasDesktopStateApi,
  logDesktopEvent,
  recordDesktopPerformanceSnapshot,
  readPhotoSelectorProjectFile,
  listPhotoSelectorLegacyProjects,
  relocatePhotoSelectorProjectFile,
  resolvePhotoSelectorProject,
  saveDesktopFolderAssetStates,
  saveDesktopFolderAssetStatesDelta,
  saveDesktopFolderCatalogState,
  saveDesktopSessionState,
  updatePhotoSelectorProjectFile,
} from "./services/desktop-store";
import { PreviewWarmupPipeline } from "./services/preview-warmup-pipeline";
import { useUndoRedo } from "./hooks/useUndoRedo";
import { buildSelectionResult } from "./types/selection";
import { useToast } from "./components/ToastProvider";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { DismissibleBanner } from "./components/DismissibleBanner";
import { FolderBrowser } from "./components/FolderBrowser";
import { ImportProgressModal } from "./components/ImportProgressModal";
import {
  DriveManualRootPickerModal,
  DriveVersionPickerModal,
} from "./components/GoogleDriveDialogs";
import {
  ConfirmProjectCreationModal,
  ConfirmMasterCorrectionModal,
  RenameProjectModal,
  UnassignedFolderModal,
  type MasterCorrectionPreview,
  type ProjectCreationPreview,
  type UnassignedFolderChoice,
} from "./components/ProjectDialogs";
import { PhotoSelector } from "./components/PhotoSelector";
import { SelectionSummary } from "./components/SelectionSummary";
import {
  connectGoogleDrive,
  downloadGoogleDriveVersion,
  exportProjectToGoogleDrive,
  getGoogleDriveStatus,
  listGoogleDriveVersions,
} from "./services/google-drive-projects";
import { buildMasterProject } from "./services/project-workflow";
import { mapCloudProjectToAssets, normalizeCloudPath } from "./services/cloud-project-mapping";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const PROJECT_ID = "photo-selector-default";
const THUMBNAIL_BOOTSTRAP_COUNT = 64;
const XMP_IMPORT_CONCURRENCY = 4;
const XMP_WRITE_CONCURRENCY = 4;
const XMP_IMPORT_START_DELAY_MS = 1000;
const XMP_IMPORT_INITIAL_COUNT = 96;
const XMP_IMPORT_BACKGROUND_CHUNK_SIZE = 96;
const XMP_IMPORT_BACKGROUND_DELAY_MS = 450;
const BACKGROUND_THUMBNAIL_ENQUEUE_DELAY_MS = 120;
const BACKGROUND_WARMUP_START_DELAY_MS = 480;
const BACKGROUND_WARMUP_CACHE_CHUNK_SIZE = 144;
const BACKGROUND_WARMUP_PIPELINE_CHUNK_SIZE = 64;
const RAW_PREVIEW_BOOTSTRAP_COUNT = 192;
const RAW_PREVIEW_FILTER_WARM_COUNT = 72;
const RAW_PREVIEW_WARMUP_START_DELAY_MS = 1600;
const QUICK_PREVIEW_PRIORITY_WARM_COUNT = 3;
const BACKGROUND_FIT_PREVIEW_WARM_START_DELAY_MS = 2400;
const BACKGROUND_FIT_PREVIEW_WARM_BATCH_INTERVAL_MS = 520;
const BACKGROUND_FIT_PREVIEW_WARM_BATCH_SIZE = 10;
const BACKGROUND_FIT_PREVIEW_WARM_MAX_COUNT = 240;
const BACKGROUND_WORK_INTERACTION_GRACE_MS = 900;
const BACKGROUND_WORK_DEFER_RETRY_MS = 260;
const CATALOG_PERSIST_DEBOUNCE_MS = 500;
const PERFORMANCE_SNAPSHOT_PERSIST_DEBOUNCE_MS = 500;
const PERFORMANCE_METRICS_UI_THROTTLE_MS = 180;
const THUMBNAIL_PATCH_FLUSH_MAX_ITEMS = 64;

function buildCloudManifest(
  projectName: string,
  sourceFolderPath: string,
  assets: ImageAsset[],
  activeAssetIds: string[],
  exportedFrom?: string,
  projectId = PROJECT_ID,
): DesktopCloudProjectManifest {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  return {
    schemaVersion: 1,
    app: "image-select-pro",
    projectId,
    projectName: projectName.trim() || "Senza nome",
    sourceFolderName: sourceFolderPath.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() ?? "Cartella",
    exportedAt: new Date().toISOString(),
    exportedFrom,
    activeRelativePaths: activeAssetIds
      .map((id) => byId.get(id)?.path)
      .filter((path): path is string => Boolean(path))
      .map(normalizeCloudPath),
    assets: assets.map((asset) => ({
      relativePath: asset.path.replace(/\\/g, "/"),
      fileName: asset.fileName,
      size: asset.size,
      sourceFileKey: asset.sourceFileKey,
      rating: asset.rating ?? 0,
      pickStatus: asset.pickStatus ?? "unmarked",
      colorLabel: asset.colorLabel ?? null,
      customLabels: asset.customLabels ?? [],
      active: activeAssetIds.includes(asset.id),
    })),
  };
}
const THUMBNAIL_PATCH_FLUSH_MIN_INTERVAL_MS = 32;
const PERF_FOLDER_OPEN_TO_FIRST_THUMBNAIL_VISIBLE = "[PERF] folder-open → first-thumbnail-visible";
const PERF_FIRST_THUMBNAIL_TO_GRID_COMPLETE = "[PERF] first-thumbnail → grid-complete";
const PERF_XMP_IMPORT = "[PERF] xmp-import start → xmp-import complete";

function getThumbnailPipelineOptions(profile: ThumbnailProfile): ThumbnailPipelineOptions {
  if (profile === "ultra-fast") {
    return {
      maxDimension: 192,
      quality: 0.5,
      minimumPreviewShortSide: 480,
      desktopOptions: {
        minimumEmbeddedShortSide: 96,
        preferEmbeddedPreview: true,
        profile: "ultra-fast",
        allowDirectEmbeddedJpeg: true,
      },
    };
  }

  if (profile === "fast") {
    return {
      maxDimension: 256,
      quality: 0.62,
      minimumPreviewShortSide: 640,
      desktopOptions: {
        minimumEmbeddedShortSide: 256,
        preferEmbeddedPreview: true,
        profile: "fast",
      },
    };
  }

  return {
    maxDimension: 320,
    quality: 0.72,
    minimumPreviewShortSide: 800,
    desktopOptions: {
      minimumEmbeddedShortSide: 320,
      preferEmbeddedPreview: true,
      profile: "balanced",
    },
  };
}

function getQuickPreviewFitMaxDimension(profile: ThumbnailProfile): number {
  if (profile === "ultra-fast") {
    return 1600;
  }

  if (profile === "fast") {
    return 1920;
  }

  return 2560;
}

function afterNextPaint(run: () => void): void {
  if (typeof window === "undefined") {
    run();
    return;
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(run);
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const safeConcurrency = Math.max(1, concurrency);
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(safeConcurrency, items.length) }, () => run()),
  );
  return results;
}

type ThumbnailPipelineEntry = {
  id: string;
  absolutePath?: string;
  sourceFileKey?: string;
  skipDiskCacheRead?: boolean;
};

type ThumbnailAssetPatch = Pick<
  ImageAsset,
  "thumbnailUrl" | "width" | "height" | "orientation" | "aspectRatio" | "sourceFileKey"
>;

type ThumbnailPipelineMetrics = {
  reactCommitCount: number;
  hotPatchApplied: number;
  deferredPatchApplied: number;
};

function createThumbnailPipelineMetrics(): ThumbnailPipelineMetrics {
  return {
    reactCommitCount: 0,
    hotPatchApplied: 0,
    deferredPatchApplied: 0,
  };
}

function detectOrientation(w: number, h: number): ImageOrientation {
  if (w === h) return "square";
  return h > w ? "vertical" : "horizontal";
}

function revokeThumbnailViewUrl(view: ThumbnailViewState | undefined): void {
  const url = view?.thumbnailUrl;
  if (!url) {
    return;
  }

  const token = getThumbnailFrameToken(url);
  if (token) {
    void releaseDesktopQuickPreviewFrames([token]);
    return;
  }

  if (!url.startsWith("blob:")) {
    return;
  }

  try {
    URL.revokeObjectURL(url);
  } catch {
    // ignore: revokeObjectURL is best-effort cleanup
  }
}

function revokeCachedThumbnailUrls(
  cached: Iterable<{ url: string }>,
): void {
  for (const hit of cached) {
    const token = getThumbnailFrameToken(hit.url);
    if (token) {
      void releaseDesktopQuickPreviewFrames([token]);
      continue;
    }

    if (!hit.url.startsWith("blob:")) {
      continue;
    }

    try {
      URL.revokeObjectURL(hit.url);
    } catch {
      // Cache cleanup is best-effort when a folder load becomes stale.
    }
  }
}

function getThumbnailFrameToken(url: string | undefined): string | null {
  if (!url || !url.startsWith("filex-preview://")) {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "frame") {
      return null;
    }
    return decodeURIComponent(parsed.pathname.replace(/^\/+/, "")) || null;
  } catch {
    return null;
  }
}


function buildCatalogAssetStateSignature(assetState: DesktopFolderCatalogAssetState): string {
  return JSON.stringify([
    assetState.fileName,
    assetState.relativePath,
    assetState.absolutePath ?? null,
    assetState.sourceFileKey ?? null,
    assetState.rating,
    assetState.pickStatus,
    assetState.colorLabel ?? null,
    assetState.customLabels ?? [],
  ]);
}

function formatSyncTimestamp(timestamp: number | null): string {
  if (!timestamp) {
    return "In attesa";
  }

  return new Date(timestamp).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFolderDiagnosticsSource(source: FolderOpenDiagnostics["source"]): string {
  return source === "desktop-native" ? "Desktop Windows" : source;
}

function areSetsEqual<T>(left: Set<T>, right: Set<T>): boolean {
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

function mergeSets<T>(...sets: Array<Set<T>>): Set<T> {
  const merged = new Set<T>();
  for (const set of sets) {
    for (const value of set) {
      merged.add(value);
    }
  }
  return merged;
}

function areStringArraysEqual(left: string[] | undefined, right: string[] | undefined): boolean {
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

function hasUndoableAssetChange(previous: ImageAsset | undefined, next: ImageAsset): boolean {
  if (!previous || previous.id !== next.id) {
    return false;
  }

  return previous.rating !== next.rating
    || previous.pickStatus !== next.pickStatus
    || previous.colorLabel !== next.colorLabel
    || !areStringArraysEqual(previous.customLabels, next.customLabels);
}

function hasAssetRuntimeStateChange(previous: ImageAsset, next: ImageAsset): boolean {
  return previous.sourceFileKey !== next.sourceFileKey
    || previous.previewUrl !== next.previewUrl
    || previous.sourceUrl !== next.sourceUrl
    || previous.thumbnailUrl !== next.thumbnailUrl
    || previous.width !== next.width
    || previous.height !== next.height
    || previous.orientation !== next.orientation
    || previous.aspectRatio !== next.aspectRatio
    || previous.rating !== next.rating
    || previous.pickStatus !== next.pickStatus
    || previous.colorLabel !== next.colorLabel
    || !areStringArraysEqual(previous.customLabels, next.customLabels);
}

function mergeUndoableSnapshotAssets(
  previousAssets: ImageAsset[],
  snapshotAssets: ImageAsset[],
): { mergedAssets: ImageAsset[]; changedIds: string[] } {
  const snapshotById = new Map(snapshotAssets.map((asset) => [asset.id, asset]));
  const changedIds = new Set<string>();
  const mergedAssets = previousAssets.map((asset) => {
    const snapshotAsset = snapshotById.get(asset.id);
    if (!snapshotAsset || !hasUndoableAssetChange(asset, snapshotAsset)) {
      return asset;
    }

    changedIds.add(asset.id);
    return {
      ...asset,
      rating: snapshotAsset.rating,
      pickStatus: snapshotAsset.pickStatus,
      colorLabel: snapshotAsset.colorLabel,
      customLabels: snapshotAsset.customLabels ?? [],
    };
  });

  return {
    mergedAssets,
    changedIds: Array.from(changedIds),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// App
// ═══════════════════════════════════════════════════════════════════════════

type Screen = "browse" | "selection" | "review";

type XmpSyncState =
  | { phase: "idle"; pending: number; failed: number; lastSyncedAt: number | null }
  | { phase: "pending"; pending: number; failed: number; lastSyncedAt: number | null }
  | { phase: "syncing"; pending: number; failed: number; lastSyncedAt: number | null }
  | { phase: "saved"; pending: number; failed: number; lastSyncedAt: number | null }
  | { phase: "error"; pending: number; failed: number; lastSyncedAt: number | null }
  | { phase: "unavailable"; pending: number; failed: number; lastSyncedAt: number | null };

interface ImportProgressState {
  isOpen: boolean;
  phase: "reading" | "preparing";
  supported: number;
  ignored: number;
  total: number;
  processed: number;
  currentFile: string | null;
  folderLabel: string;
}

interface PerformanceSnapshot {
  folderOpenToFirstThumbnailMs: number | null;
  folderOpenToGridCompleteMs: number | null;
  previewOpenLatencyMs: number | null;
  previewNavigationLatencyMs: number | null;
  xmpSyncLatencyMs: number | null;
  cachedThumbnailCount: number;
  totalThumbnailCount: number;
  bytesRead: number;
  rawBytesRead: number;
  standardBytesRead: number;
  thumbnailProfile: ThumbnailProfile;
  sortCacheEnabled: boolean;
  reactCommitCount: number;
  hotPatchApplied: number;
  deferredPatchApplied: number;
  scrollLiteActiveMs: number;
  rawRenderCacheHit: number;
  lastUpdatedAt: number | null;
}

import logo from "./assets/photo_selector.png";

export function App() {
  const { addToast } = useToast();
  const initialPreferencesRef = useRef(loadPhotoSelectorPreferences());

  // ── Persisted state ──────────────────────────────────────────────────
  const [projectName, setProjectName] = useState("Image Select Pro");
  const [desktopRuntime, setDesktopRuntime] = useState<DesktopRuntimeInfo | null>(null);
  const [googleDriveStatus, setGoogleDriveStatus] = useState({
    configured: false,
    connected: false,
    accountEmail: null as string | null,
  });
  const [isGoogleDriveBusy, setIsGoogleDriveBusy] = useState(false);
  const [driveVersionPicker, setDriveVersionPicker] = useState<{
    versions: DesktopCloudProjectVersion[];
    resolve: (version: DesktopCloudProjectVersion | null) => void;
  } | null>(null);
  const [driveManualRootPicker, setDriveManualRootPicker] = useState<{
    initialPath: string;
    unmatchedCount: number;
    resolve: (path: string | null) => void;
  } | null>(null);
  const [unassignedFolderPrompt, setUnassignedFolderPrompt] = useState<{
    folderPath: string;
    resolve: (choice: UnassignedFolderChoice) => void;
  } | null>(null);
  const [projectCreationPrompt, setProjectCreationPrompt] = useState<{
    preview: ProjectCreationPreview;
    resolve: (confirmed: boolean) => void;
  } | null>(null);
  const [masterCorrectionPrompt, setMasterCorrectionPrompt] = useState<{
    preview: MasterCorrectionPreview;
    resolve: (confirmed: boolean) => void;
  } | null>(null);
  const [isRenameProjectOpen, setIsRenameProjectOpen] = useState(false);
  const [sourceFolderPath, setSourceFolderPath] = useState("");
  const [projectFolderFocus, setProjectFolderFocus] = useState<string | null>(null);

  // ── Asset catalog ────────────────────────────────────────────────────
  const [allAssets, setAllAssets] = useState<ImageAsset[]>([]);
  const [activeAssetIds, setActiveAssetIds] = useState<string[]>([]);
  const [photoMetadataVersion, setPhotoMetadataVersion] = useState(0);
  const usesMockData = false;
  const bumpPhotoMetadataVersion = useCallback(() => {
    setPhotoMetadataVersion((current) => current + 1);
  }, []);

  // ── Pipeline ─────────────────────────────────────────────────────────
  const pipelineRef = useRef<ThumbnailPipeline | null>(null);
  const previewWarmupPipelineRef = useRef<PreviewWarmupPipeline | null>(null);
  const [thumbnailProgress, setThumbnailProgress] = useState({ done: 0, total: 0 });
  const [thumbnailViewVersion, setThumbnailViewVersion] = useState(0);
  const [thumbnailProfile, setThumbnailProfile] = useState<ThumbnailProfile>(
    initialPreferencesRef.current.thumbnailProfile,
  );
  const [sortCacheEnabled, setSortCacheEnabled] = useState<boolean>(
    initialPreferencesRef.current.sortCacheEnabled,
  );
  const [performanceSnapshot, setPerformanceSnapshot] = useState<PerformanceSnapshot>({
    folderOpenToFirstThumbnailMs: null,
    folderOpenToGridCompleteMs: null,
    previewOpenLatencyMs: null,
    previewNavigationLatencyMs: null,
    xmpSyncLatencyMs: null,
    cachedThumbnailCount: 0,
    totalThumbnailCount: 0,
    bytesRead: 0,
    rawBytesRead: 0,
    standardBytesRead: 0,
    thumbnailProfile: initialPreferencesRef.current.thumbnailProfile,
    sortCacheEnabled: initialPreferencesRef.current.sortCacheEnabled,
    reactCommitCount: 0,
    hotPatchApplied: 0,
    deferredPatchApplied: 0,
    scrollLiteActiveMs: 0,
    rawRenderCacheHit: 0,
    lastUpdatedAt: null,
  });

  // ── UI state ─────────────────────────────────────────────────────────
  const [currentScreen, setCurrentScreen] = useState<Screen>("browse");
  const [isFolderTransitionBusy, setIsFolderTransitionBusy] = useState(false);
  const [folderTransitionLabel, setFolderTransitionLabel] = useState("");
  const [hasWritableFolderAccess, setHasWritableFolderAccess] = useState(false);
  const [isXmpBannerDismissed, setIsXmpBannerDismissed] = useState(false);
  const xmpSyncTimerRef = useRef<number | null>(null);
  const xmpSnapshotRef = useRef(new Map<string, string>());
  const pendingXmpSyncIdsRef = useRef(new Set<string>());
  const xmpSyncInFlightRef = useRef<Promise<{ synced: number; failed: number }> | null>(null);
  const [xmpSyncVersion, setXmpSyncVersion] = useState(0);
  const [xmpSyncState, setXmpSyncState] = useState<XmpSyncState>({
    phase: "idle",
    pending: 0,
    failed: 0,
    lastSyncedAt: null,
  });
  const [importProgress, setImportProgress] = useState<ImportProgressState>({
    isOpen: false,
    phase: "reading",
    supported: 0,
    ignored: 0,
    total: 0,
    processed: 0,
    currentFile: null,
    folderLabel: "",
  });
  const [isImportPanelDismissed, setIsImportPanelDismissed] = useState(false);
  const [folderDiagnostics, setFolderDiagnostics] = useState<FolderOpenDiagnostics | null>(null);
  const [isFolderDiagnosticsExpanded, setIsFolderDiagnosticsExpanded] = useState(false);
  const [desktopThumbnailCacheInfo, setDesktopThumbnailCacheInfo] = useState<DesktopThumbnailCacheInfo | null>(null);
  const [desktopCacheLocationRecommendation, setDesktopCacheLocationRecommendation] =
    useState<DesktopCacheLocationRecommendation | null>(null);
  const [isDesktopThumbnailCacheBusy, setIsDesktopThumbnailCacheBusy] = useState(false);
  const [isDesktopCacheRecommendationModalOpen, setIsDesktopCacheRecommendationModalOpen] = useState(false);
  const [isDesktopCacheRecommendationSnoozedForSession, setIsDesktopCacheRecommendationSnoozedForSession] =
    useState(false);
  const assetNameByIdRef = useRef(new Map<string, string>());
  const assetIndexByIdRef = useRef(new Map<string, number>());
  const thumbnailTotalCountRef = useRef(0);
  const settledThumbnailIdsRef = useRef<Set<string>>(new Set());
  const thumbnailEntryByIdRef = useRef(new Map<string, ThumbnailPipelineEntry>());
  const visibleThumbnailIdsRef = useRef(new Set<string>());
  const prioritizedThumbnailIdsRef = useRef(new Set<string>());
  const previewPriorityIdsRef = useRef(new Set<string>());
  const interactiveThumbnailIdsRef = useRef(new Set<string>());
  const folderLoadSessionRef = useRef(0);
  const folderOpenRequestRef = useRef(0);
  const persistedStateHydrationRef = useRef<{ folderPath: string; session: number } | null>(null);
  const xmpImportStartTimerRef = useRef<number | null>(null);
  const backgroundThumbnailEnqueueTimerRef = useRef<number | null>(null);
  const backgroundCacheLookupTimerRef = useRef<number | null>(null);
  const rawPreviewWarmupTimerRef = useRef<number | null>(null);
  const backgroundFitPreviewWarmupTimerRef = useRef<number | null>(null);
  const backgroundFitPreviewCursorRef = useRef(0);
  const backgroundFitPreviewOrderedIdsRef = useRef<string[]>([]);
  const interactiveWorkUntilRef = useRef(0);
  const hasLoggedFirstThumbnailRef = useRef(false);
  const hasLoggedGridCompleteRef = useRef(false);
  const folderOpenStartedAtRef = useRef<number | null>(null);
  const thumbnailPatchStoreRef = useRef(new Map<string, ThumbnailAssetPatch>());
  const thumbnailPatchDeferredQueueRef = useRef<string[]>([]);
  const thumbnailPatchDeferredSetRef = useRef(new Set<string>());
  const thumbnailPatchFlushRafRef = useRef<number | null>(null);
  const thumbnailPatchFlushTimerRef = useRef<number | null>(null);
  const thumbnailPatchLastFlushAtRef = useRef(0);
  const thumbnailPipelineMetricsRef = useRef<ThumbnailPipelineMetrics>(createThumbnailPipelineMetrics());
  const applyThumbnailViewsAndNotify = useCallback((updates: Iterable<[string, ThumbnailViewState]>) => {
    const entries = Array.from(updates);
    if (entries.length === 0) {
      return;
    }
    applyThumbnailViews(entries);
    setThumbnailViewVersion((current) => current + 1);
  }, []);
  const catalogPersistTimerRef = useRef<number | null>(null);
  const catalogIdentitySignatureRef = useRef<string>("");
  const catalogAssetStateSignatureRef = useRef(new Map<string, string>());
  const catalogPersistedAssetsRef = useRef<ImageAsset[] | null>(null);
  const catalogAssetStatesRef = useRef<DesktopFolderCatalogAssetState[]>([]);
  const catalogProjectActiveSignatureRef = useRef("");
  const catalogProjectNameRef = useRef("");
  const performanceSnapshotPersistTimerRef = useRef<number | null>(null);
  const performanceMetricsUiTimerRef = useRef<number | null>(null);
  const scrollLiteActiveMsRef = useRef(0);
  const thumbnailProgressStateRef = useRef(thumbnailProgress);
  const publishThumbnailProgress = useCallback((next: { done: number; total: number }) => {
    const current = thumbnailProgressStateRef.current;
    if (current.done === next.done && current.total === next.total) {
      return;
    }

    thumbnailProgressStateRef.current = next;
    setThumbnailProgress(next);
  }, []);

  // ── Restore from IndexedDB on mount ──────────────────────────────────
  useEffect(() => {
    let active = true;
    const folderRequestAtStart = folderOpenRequestRef.current;

    void (async () => {
      const persisted = await getDesktopSessionState();

      if (
        !active
        || !persisted
        || folderOpenRequestRef.current !== folderRequestAtStart
      ) {
        return;
      }

      setProjectName(persisted.projectName);
      setSourceFolderPath(persisted.sourceFolderPath);
      setHasWritableFolderAccess(false);

    })();

    return () => {
      active = false;
    };
  }, []);

  // ── Persist state on change ──────────────────────────────────────────
  useEffect(() => {
    const nextState: DesktopPersistedState = {
      projectName,
      sourceFolderPath,
      activeAssetIds,
      usesMockData: false,
    };

    void saveDesktopSessionState(nextState);
  }, [projectName, sourceFolderPath, activeAssetIds]);

  useEffect(() => {
    let active = true;
    void hydratePhotoSelectorPreferences().then((preferences) => {
      if (!active) {
        return;
      }

      setThumbnailProfile(preferences.thumbnailProfile);
      setSortCacheEnabled(preferences.sortCacheEnabled);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setPerformanceSnapshot((current) => ({
      ...current,
      thumbnailProfile,
      sortCacheEnabled,
      lastUpdatedAt: Date.now(),
    }));
  }, [sortCacheEnabled, thumbnailProfile]);

  useEffect(() => {
    if (!hasDesktopStateApi()) {
      return;
    }

    const nextSnapshot: DesktopPerformanceSnapshot = {
      folderOpenToFirstThumbnailMs: performanceSnapshot.folderOpenToFirstThumbnailMs,
      folderOpenToGridCompleteMs: performanceSnapshot.folderOpenToGridCompleteMs,
      previewOpenLatencyMs: performanceSnapshot.previewOpenLatencyMs,
      previewNavigationLatencyMs: performanceSnapshot.previewNavigationLatencyMs,
      xmpSyncLatencyMs: performanceSnapshot.xmpSyncLatencyMs,
      bytesRead: performanceSnapshot.bytesRead,
      rawBytesRead: performanceSnapshot.rawBytesRead,
      standardBytesRead: performanceSnapshot.standardBytesRead,
      thumbnailProfile: performanceSnapshot.thumbnailProfile,
      sortCacheEnabled: performanceSnapshot.sortCacheEnabled,
      reactCommitCount: performanceSnapshot.reactCommitCount,
      hotPatchApplied: performanceSnapshot.hotPatchApplied,
      deferredPatchApplied: performanceSnapshot.deferredPatchApplied,
      scrollLiteActiveMs: performanceSnapshot.scrollLiteActiveMs,
      rawRenderCacheHit: performanceSnapshot.rawRenderCacheHit,
      lastUpdatedAt: performanceSnapshot.lastUpdatedAt,
    };

    if (performanceSnapshotPersistTimerRef.current !== null) {
      window.clearTimeout(performanceSnapshotPersistTimerRef.current);
    }

    performanceSnapshotPersistTimerRef.current = window.setTimeout(() => {
      performanceSnapshotPersistTimerRef.current = null;
      void recordDesktopPerformanceSnapshot(nextSnapshot);
    }, PERFORMANCE_SNAPSHOT_PERSIST_DEBOUNCE_MS);
  }, [performanceSnapshot]);

  useEffect(() => {
    if (!hasDesktopStateApi()) {
      return;
    }

    const onError = (event: ErrorEvent) => {
      void logDesktopEvent({
        channel: "renderer",
        level: "error",
        message: event.message || "Renderer error",
        details: event.filename
          ? `${event.filename}:${event.lineno}:${event.colno}`
          : undefined,
      });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error
        ? event.reason.message
        : typeof event.reason === "string"
          ? event.reason
          : JSON.stringify(event.reason);
      void logDesktopEvent({
        channel: "renderer",
        level: "error",
        message: "Unhandled promise rejection",
        details: reason,
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    if (!hasDesktopStateApi() || !sourceFolderPath.trim() || allAssets.length === 0) {
      return;
    }

    const pendingHydration = persistedStateHydrationRef.current;
    if (
      pendingHydration &&
      pendingHydration.folderPath === sourceFolderPath &&
      pendingHydration.session === folderLoadSessionRef.current
    ) {
      return;
    }

    if (catalogPersistTimerRef.current !== null) {
      window.clearTimeout(catalogPersistTimerRef.current);
    }

    const scheduledFolderPath = sourceFolderPath;
    const scheduledSession = folderLoadSessionRef.current;

    catalogPersistTimerRef.current = window.setTimeout(() => {
      catalogPersistTimerRef.current = null;
      if (
        scheduledSession !== folderLoadSessionRef.current ||
        scheduledFolderPath !== sourceFolderPath
      ) {
        return;
      }

      const timestamp = Date.now();
      const folderName = sourceFolderPath.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() ?? sourceFolderPath;
      const catalogState: DesktopFolderCatalogState = {
        folderPath: sourceFolderPath,
        folderName,
        imageCount: allAssets.length,
        activeAssetIds,
        lastOpenedAt: timestamp,
        updatedAt: timestamp,
      };
      const assetsReferenceChanged = catalogPersistedAssetsRef.current !== allAssets;
      const assetStates = assetsReferenceChanged
        ? allAssets.map((asset): DesktopFolderCatalogAssetState => ({
          assetId: asset.id,
          fileName: asset.fileName,
          relativePath: asset.path,
          absolutePath: getAssetAbsolutePath(asset.id) ?? undefined,
          sourceFileKey: asset.sourceFileKey,
          rating: asset.rating ?? 0,
          pickStatus: asset.pickStatus ?? "unmarked",
          colorLabel: asset.colorLabel ?? null,
          customLabels: asset.customLabels ?? [],
          updatedAt: timestamp,
        }))
        : catalogAssetStatesRef.current;

      const identitySignature = assetsReferenceChanged
        ? `${sourceFolderPath}::${allAssets.length}::${allAssets
          .map((asset) => `${asset.id}:${asset.sourceFileKey ?? ""}`)
          .join("|")}`
        : catalogIdentitySignatureRef.current;
      const requiresFullAssetSave = assetsReferenceChanged
        && catalogIdentitySignatureRef.current !== identitySignature;
      const changedAssetStates = requiresFullAssetSave
        ? assetStates
        : assetsReferenceChanged
          ? assetStates.filter((assetState) => (
          catalogAssetStateSignatureRef.current.get(assetState.assetId) !== buildCatalogAssetStateSignature(assetState)
          ))
          : [];

      void saveDesktopFolderCatalogState(catalogState);
      if (requiresFullAssetSave) {
        void saveDesktopFolderAssetStates(sourceFolderPath, assetStates);
        catalogIdentitySignatureRef.current = identitySignature;
      } else if (changedAssetStates.length > 0) {
        void saveDesktopFolderAssetStatesDelta(sourceFolderPath, changedAssetStates);
      }

      if (assetsReferenceChanged) {
        catalogPersistedAssetsRef.current = allAssets;
        catalogAssetStatesRef.current = assetStates;
      }
      for (const assetState of changedAssetStates) {
        catalogAssetStateSignatureRef.current.set(
          assetState.assetId,
          buildCatalogAssetStateSignature(assetState),
        );
      }

      const activeSignature = activeAssetIds.join("|");
      const shouldWriteProject = assetsReferenceChanged
        || catalogProjectActiveSignatureRef.current !== activeSignature
        || catalogProjectNameRef.current !== projectName;
      if (shouldWriteProject) {
        catalogProjectActiveSignatureRef.current = activeSignature;
        catalogProjectNameRef.current = projectName;
        void updatePhotoSelectorProjectFile(sourceFolderPath, (existingProject) => ({
          ...existingProject,
          schemaVersion: 1,
          app: "image-select-pro",
          updatedAt: Date.now(),
          projectName,
          folderState: {
            activeAssetIds,
            // The desktop project format accepts the same catalog state and
            // avoids allocating a second array for the shared file.
            assetStates,
          },
        })).catch(() => false);
      }
    }, CATALOG_PERSIST_DEBOUNCE_MS);
  }, [activeAssetIds, allAssets, projectName, sourceFolderPath]);

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
      if (thumbnailPatchFlushRafRef.current !== null) {
        window.cancelAnimationFrame(thumbnailPatchFlushRafRef.current);
        thumbnailPatchFlushRafRef.current = null;
      }
      if (thumbnailPatchFlushTimerRef.current !== null) {
        window.clearTimeout(thumbnailPatchFlushTimerRef.current);
        thumbnailPatchFlushTimerRef.current = null;
      }
      if (performanceMetricsUiTimerRef.current !== null) {
        window.clearTimeout(performanceMetricsUiTimerRef.current);
        performanceMetricsUiTimerRef.current = null;
      }
      if (catalogPersistTimerRef.current !== null) {
        window.clearTimeout(catalogPersistTimerRef.current);
        catalogPersistTimerRef.current = null;
      }
      if (performanceSnapshotPersistTimerRef.current !== null) {
        window.clearTimeout(performanceSnapshotPersistTimerRef.current);
        performanceSnapshotPersistTimerRef.current = null;
      }
      const staleThumbnailPatches = Array.from(thumbnailPatchStoreRef.current.values());
      for (const patch of staleThumbnailPatches) {
        revokeThumbnailViewUrl(patch);
      }
      thumbnailPatchStoreRef.current.clear();
      thumbnailPatchDeferredQueueRef.current = [];
      thumbnailPatchDeferredSetRef.current.clear();
      const staleThumbnailViews = Array.from(getThumbnailViewEntries(), ([, view]) => view);
      for (const view of staleThumbnailViews) {
        revokeThumbnailViewUrl(view);
      }
      // The store owns thumbnail views outside React state. Clearing it also
      // notifies the virtualized grid before the pipeline is destroyed.
      clearThumbnailViews();
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
  const queueXmpSyncRef = useRef<(assetIds: string[]) => void>(() => {});

  const undoRedo = useUndoRedo<ImageAsset[]>(
    () => allAssetsRef.current,
    (snapshot) => {
      const { mergedAssets, changedIds } = mergeUndoableSnapshotAssets(allAssetsRef.current, snapshot);
      if (changedIds.length === 0) {
        return;
      }
      setAllAssets(mergedAssets);
      bumpPhotoMetadataVersion();
      queueXmpSyncRef.current(changedIds);
    },
  );
  const activeAssetIdsRef = useRef(activeAssetIds);
  activeAssetIdsRef.current = activeAssetIds;

  const queueXmpSync = useCallback((assetIds: string[]) => {
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
  queueXmpSyncRef.current = queueXmpSync;

  const flushPendingXmpSync = useCallback(async (): Promise<boolean> => {
    if (usesMockData || !hasWritableFolderAccess) {
      return true;
    }

    if (xmpSyncTimerRef.current !== null) {
      window.clearTimeout(xmpSyncTimerRef.current);
      xmpSyncTimerRef.current = null;
    }

    let hadFailures = false;
    const syncStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();

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

      const task = mapWithConcurrency(
        idsToSync,
        XMP_WRITE_CONCURRENCY,
        async (assetId) => {
          const asset = assetMap.get(assetId);
          if (!asset) {
            return true;
          }

          try {
            const existingXml = await readSidecarXmp(asset.id);
            const nextXml = upsertXmpState(existingXml, asset, activeSet.has(asset.id));
            return await writeSidecarXmp(asset.id, nextXml);
          } catch {
            return false;
          }
        },
      ).then((results) => {
        const failed = results.filter((result) => result === false).length;
        if (failed > 0) {
          setXmpSyncState((current) => ({
            phase: "error",
            pending: 0,
            failed,
            lastSyncedAt: current.lastSyncedAt,
          }));
          addToast(
            `${failed} file XMP non sono stati aggiornati. Riapri la cartella con accesso completo per mantenere rating e pick nei sidecar.`,
            "warning",
            6500,
          );
        } else {
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
      const syncFinishedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      setPerformanceSnapshot((current) => ({
        ...current,
        xmpSyncLatencyMs: Math.max(0, Math.round(syncFinishedAt - syncStartedAt)),
        lastUpdatedAt: Date.now(),
      }));
      hadFailures = hadFailures || result.failed > 0;
    }
  }, [addToast, hasWritableFolderAccess, usesMockData]);

  const suspendActiveFolderWork = useCallback(() => {
    folderLoadSessionRef.current += 1;
    persistedStateHydrationRef.current = null;
    interactiveWorkUntilRef.current = 0;
    pipelineRef.current?.destroy();
    pipelineRef.current = null;

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
    if (backgroundFitPreviewWarmupTimerRef.current !== null) {
      window.clearTimeout(backgroundFitPreviewWarmupTimerRef.current);
      backgroundFitPreviewWarmupTimerRef.current = null;
    }
    if (thumbnailPatchFlushRafRef.current !== null) {
      window.cancelAnimationFrame(thumbnailPatchFlushRafRef.current);
      thumbnailPatchFlushRafRef.current = null;
    }
    if (thumbnailPatchFlushTimerRef.current !== null) {
      window.clearTimeout(thumbnailPatchFlushTimerRef.current);
      thumbnailPatchFlushTimerRef.current = null;
    }
    if (performanceMetricsUiTimerRef.current !== null) {
      window.clearTimeout(performanceMetricsUiTimerRef.current);
      performanceMetricsUiTimerRef.current = null;
    }
    if (catalogPersistTimerRef.current !== null) {
      window.clearTimeout(catalogPersistTimerRef.current);
      catalogPersistTimerRef.current = null;
    }
    if (performanceSnapshotPersistTimerRef.current !== null) {
      window.clearTimeout(performanceSnapshotPersistTimerRef.current);
      performanceSnapshotPersistTimerRef.current = null;
    }

    previewWarmupPipelineRef.current?.destroy();
    previewWarmupPipelineRef.current = null;
    backgroundFitPreviewCursorRef.current = 0;
    backgroundFitPreviewOrderedIdsRef.current = [];

    visibleThumbnailIdsRef.current = new Set();
    prioritizedThumbnailIdsRef.current = new Set();
    previewPriorityIdsRef.current = new Set();
    interactiveThumbnailIdsRef.current = new Set();
    settledThumbnailIdsRef.current = new Set();
    thumbnailEntryByIdRef.current = new Map();
    thumbnailTotalCountRef.current = 0;
    const staleThumbnailPatches = Array.from(thumbnailPatchStoreRef.current.values());
    for (const patch of staleThumbnailPatches) {
      revokeThumbnailViewUrl(patch);
    }
    thumbnailPatchStoreRef.current.clear();
    thumbnailPatchDeferredQueueRef.current = [];
    thumbnailPatchDeferredSetRef.current.clear();
    thumbnailPatchLastFlushAtRef.current = 0;
    catalogIdentitySignatureRef.current = "";
    catalogAssetStateSignatureRef.current.clear();
    catalogPersistedAssetsRef.current = null;
    catalogAssetStatesRef.current = [];
    catalogProjectActiveSignatureRef.current = "";
    catalogProjectNameRef.current = "";
    const staleThumbnailViews = Array.from(getThumbnailViewEntries(), ([, view]) => view);
    for (const view of staleThumbnailViews) {
      revokeThumbnailViewUrl(view);
    }
    clearThumbnailViews();
    thumbnailPipelineMetricsRef.current = createThumbnailPipelineMetrics();
    scrollLiteActiveMsRef.current = 0;
    hasLoggedFirstThumbnailRef.current = false;
    hasLoggedGridCompleteRef.current = false;
    clearDesktopQuickPreviewFrameCache();

    publishThumbnailProgress({ done: 0, total: 0 });
    setPerformanceSnapshot((current) => ({
      ...current,
      reactCommitCount: 0,
      hotPatchApplied: 0,
      deferredPatchApplied: 0,
      scrollLiteActiveMs: 0,
      rawRenderCacheHit: 0,
      lastUpdatedAt: Date.now(),
    }));
    setImportProgress((current) => (
      current.isOpen
        ? {
            ...current,
            isOpen: false,
            total: 0,
            processed: 0,
            currentFile: null,
          }
        : current
    ));
  }, [publishThumbnailProgress]);

  const markInteractiveWork = useCallback((durationMs = BACKGROUND_WORK_INTERACTION_GRACE_MS) => {
    const until = Date.now() + durationMs;
    if (until > interactiveWorkUntilRef.current) {
      interactiveWorkUntilRef.current = until;
    }
  }, []);

  const shouldDeferBackgroundWork = useCallback((priority: number) => (
    priority >= 3 && Date.now() < interactiveWorkUntilRef.current
  ), []);

  // ── Warn before losing unsaved work ──────────────────────────────────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (allAssets.length > 0) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [allAssets.length]);

  const syncThumbnailProgress = useCallback((lastProcessedId?: string | null) => {
    const interactiveIds = interactiveThumbnailIdsRef.current;
    const total = interactiveIds.size;
    if (total === 0) {
      publishThumbnailProgress({ done: 0, total: 0 });
      setImportProgress((current) => (
        current.isOpen
          ? {
              ...current,
              isOpen: false,
              total: 0,
              processed: 0,
            }
          : current
      ));
      return;
    }

    let processed = 0;
    for (const assetId of interactiveIds) {
      if (settledThumbnailIdsRef.current.has(assetId)) {
        processed += 1;
      }
    }

    if (processed >= total) {
      publishThumbnailProgress({ done: 0, total: 0 });
      setImportProgress((current) => (
        current.isOpen
          ? {
              ...current,
              isOpen: false,
              total: 0,
              processed: 0,
            }
          : current
      ));
      return;
    }

    publishThumbnailProgress({ done: processed, total });
    setImportProgress((current) => {
      if (!current.isOpen) {
        return current;
      }

      const currentFile = lastProcessedId
        ? assetNameByIdRef.current.get(lastProcessedId) ?? current.currentFile
        : current.currentFile;

      if (
        current.phase === "preparing" &&
        current.total === total &&
        current.processed === processed &&
        current.currentFile === currentFile
      ) {
        return current;
      }

      return {
        ...current,
        phase: "preparing",
        total,
        processed,
        currentFile,
      };
    });
  }, [publishThumbnailProgress]);

  function checkAllThumbnailsSettled(): void {
    const total = thumbnailTotalCountRef.current;
    if (total === 0 || settledThumbnailIdsRef.current.size < total) {
      return;
    }

    void refreshDesktopThumbnailCacheInfo();
    afterNextPaint(() => {
      markGridComplete();
    });
  }

  const updateThumbnailPipelineMetrics = useCallback((
    updater: (current: ThumbnailPipelineMetrics) => ThumbnailPipelineMetrics,
  ) => {
    const nextMetrics = updater(thumbnailPipelineMetricsRef.current);
    thumbnailPipelineMetricsRef.current = nextMetrics;

    if (performanceMetricsUiTimerRef.current !== null) {
      return;
    }

    performanceMetricsUiTimerRef.current = window.setTimeout(() => {
      performanceMetricsUiTimerRef.current = null;
      const metrics = thumbnailPipelineMetricsRef.current;
      setPerformanceSnapshot((current) => ({
        ...current,
        reactCommitCount: metrics.reactCommitCount,
        hotPatchApplied: metrics.hotPatchApplied,
        deferredPatchApplied: metrics.deferredPatchApplied,
        scrollLiteActiveMs: Math.round(scrollLiteActiveMsRef.current),
        lastUpdatedAt: Date.now(),
      }));
    }, PERFORMANCE_METRICS_UI_THROTTLE_MS);
  }, []);

  const resetThumbnailPatchPipeline = useCallback(() => {
    if (thumbnailPatchFlushRafRef.current !== null) {
      window.cancelAnimationFrame(thumbnailPatchFlushRafRef.current);
      thumbnailPatchFlushRafRef.current = null;
    }
    if (thumbnailPatchFlushTimerRef.current !== null) {
      window.clearTimeout(thumbnailPatchFlushTimerRef.current);
      thumbnailPatchFlushTimerRef.current = null;
    }
    if (performanceMetricsUiTimerRef.current !== null) {
      window.clearTimeout(performanceMetricsUiTimerRef.current);
      performanceMetricsUiTimerRef.current = null;
    }
    const staleThumbnailPatches = Array.from(thumbnailPatchStoreRef.current.values());
    for (const patch of staleThumbnailPatches) {
      revokeThumbnailViewUrl(patch);
    }
    thumbnailPatchStoreRef.current.clear();
    thumbnailPatchDeferredQueueRef.current = [];
    thumbnailPatchDeferredSetRef.current.clear();
    thumbnailPatchLastFlushAtRef.current = 0;
    thumbnailPipelineMetricsRef.current = createThumbnailPipelineMetrics();
    scrollLiteActiveMsRef.current = 0;
    setPerformanceSnapshot((current) => ({
      ...current,
      reactCommitCount: 0,
      hotPatchApplied: 0,
      deferredPatchApplied: 0,
      scrollLiteActiveMs: 0,
      rawRenderCacheHit: 0,
      lastUpdatedAt: Date.now(),
    }));
  }, []);

  const isHotThumbnailId = useCallback((id: string): boolean => (
    visibleThumbnailIdsRef.current.has(id)
    || previewPriorityIdsRef.current.has(id)
    || prioritizedThumbnailIdsRef.current.has(id)
  ), []);

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
      lastUpdatedAt: Date.now(),
    }));
    perfTimeEnd(PERF_FOLDER_OPEN_TO_FIRST_THUMBNAIL_VISIBLE);
    perfTime(PERF_FIRST_THUMBNAIL_TO_GRID_COMPLETE);
  }, []);

  const applyThumbnailPatches = useCallback((
    ids: Iterable<string>,
    source: "hot" | "deferred",
  ): number => {
    const seen = new Set<string>();
    const applicableIds: string[] = [];
    const assetsSnapshot = allAssetsRef.current;

    for (const id of ids) {
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);

      const patch = thumbnailPatchStoreRef.current.get(id);
      const index = assetIndexByIdRef.current.get(id);
      const asset = index === undefined ? null : assetsSnapshot[index] ?? null;
      if (!patch || !asset) {
        continue;
      }

      if (patch.sourceFileKey && asset.sourceFileKey && patch.sourceFileKey !== asset.sourceFileKey) {
        revokeThumbnailViewUrl(patch);
        thumbnailPatchStoreRef.current.delete(id);
        continue;
      }

      const patchSourceFileKey = patch.sourceFileKey ?? asset.sourceFileKey;
      const currentView = getThumbnailView(id);
      if (
        currentView?.thumbnailUrl === patch.thumbnailUrl
        && currentView?.width === patch.width
        && currentView?.height === patch.height
        && currentView?.orientation === patch.orientation
        && currentView?.aspectRatio === patch.aspectRatio
        && (currentView?.sourceFileKey ?? asset.sourceFileKey) === patchSourceFileKey
      ) {
        thumbnailPatchStoreRef.current.delete(id);
        continue;
      }

      applicableIds.push(id);
    }

    if (applicableIds.length === 0) {
      return 0;
    }

    const applicableIdSet = new Set(applicableIds);
    const renderMetricToken = beginReactBatchMetric(applicableIds.length, assetsSnapshot.length);

    const nextViews: Array<[string, ThumbnailViewState]> = [];
    for (const id of applicableIds) {
      const patch = thumbnailPatchStoreRef.current.get(id);
      const index = assetIndexByIdRef.current.get(id);
      if (!patch || index === undefined) {
        continue;
      }
      const asset = allAssetsRef.current[index];
      if (!asset) {
        continue;
      }

          // Se l'asset aveva già una blob URL (es. da cache disco) e la pipeline
          // produce una nuova URL diversa, revochiamo la vecchia per evitare
          // che il browser tenga in memoria thumbnail orfani per tutta la sessione.
      if (patch.sourceFileKey && asset.sourceFileKey && patch.sourceFileKey !== asset.sourceFileKey) {
        revokeThumbnailViewUrl(patch);
        thumbnailPatchStoreRef.current.delete(id);
        continue;
      }

      const previousView = getThumbnailView(id);
      if (previousView?.thumbnailUrl && previousView.thumbnailUrl !== patch.thumbnailUrl) {
        revokeThumbnailViewUrl(previousView);
      }

      nextViews.push([id, {
        ...patch,
        sourceFileKey: patch.sourceFileKey ?? asset.sourceFileKey,
      }]);
      thumbnailPatchStoreRef.current.delete(id);
    }

    applyThumbnailViewsAndNotify(nextViews);

    updateThumbnailPipelineMetrics((current) => ({
      reactCommitCount: current.reactCommitCount + 1,
      hotPatchApplied: current.hotPatchApplied + (source === "hot" ? applicableIds.length : 0),
      deferredPatchApplied: current.deferredPatchApplied + (source === "deferred" ? applicableIds.length : 0),
    }));

    for (const id of applicableIdSet) {
      thumbnailPatchDeferredSetRef.current.delete(id);
    }

    afterNextPaint(() => {
      finishReactBatchMetric(renderMetricToken);
      if (applicableIds.length > 0) {
        markFirstThumbnailVisible();
      }
      perfLog(
        `[PERF] thumbnail patch commit (${source})           : applied ${applicableIds.length}` +
          ` | queue ${thumbnailPatchDeferredQueueRef.current.length}` +
          ` | store ${thumbnailPatchStoreRef.current.size}`,
      );
    });

    return applicableIds.length;
  }, [applyThumbnailViewsAndNotify, markFirstThumbnailVisible, updateThumbnailPipelineMetrics]);

  const flushDeferredThumbnailPatchQueue = useCallback(() => {
    if (thumbnailPatchFlushRafRef.current !== null) {
      thumbnailPatchFlushRafRef.current = null;
    }
    if (thumbnailPatchFlushTimerRef.current !== null) {
      window.clearTimeout(thumbnailPatchFlushTimerRef.current);
      thumbnailPatchFlushTimerRef.current = null;
    }

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const elapsed = now - thumbnailPatchLastFlushAtRef.current;
    if (elapsed < THUMBNAIL_PATCH_FLUSH_MIN_INTERVAL_MS) {
      const waitMs = Math.max(0, THUMBNAIL_PATCH_FLUSH_MIN_INTERVAL_MS - elapsed);
      thumbnailPatchFlushTimerRef.current = window.setTimeout(() => {
        thumbnailPatchFlushTimerRef.current = null;
        thumbnailPatchFlushRafRef.current = window.requestAnimationFrame(() => {
          flushDeferredThumbnailPatchQueue();
        });
      }, waitMs);
      return;
    }

    const queue = thumbnailPatchDeferredQueueRef.current;
    const deferredIds: string[] = [];
    while (queue.length > 0 && deferredIds.length < THUMBNAIL_PATCH_FLUSH_MAX_ITEMS) {
      const nextId = queue.shift();
      if (!nextId) {
        continue;
      }
      if (!thumbnailPatchDeferredSetRef.current.has(nextId)) {
        continue;
      }
      if (isHotThumbnailId(nextId)) {
        continue;
      }
      thumbnailPatchDeferredSetRef.current.delete(nextId);
      if (!thumbnailPatchStoreRef.current.has(nextId)) {
        continue;
      }
      deferredIds.push(nextId);
    }

    thumbnailPatchLastFlushAtRef.current = now;
    if (deferredIds.length > 0) {
      applyThumbnailPatches(deferredIds, "deferred");
    }

    if (queue.length > 0 && thumbnailPatchFlushRafRef.current === null) {
      thumbnailPatchFlushRafRef.current = window.requestAnimationFrame(() => {
        flushDeferredThumbnailPatchQueue();
      });
    }
  }, [applyThumbnailPatches, isHotThumbnailId]);

  const scheduleDeferredThumbnailPatchFlush = useCallback(() => {
    if (thumbnailPatchFlushRafRef.current !== null || thumbnailPatchFlushTimerRef.current !== null) {
      return;
    }

    thumbnailPatchFlushRafRef.current = window.requestAnimationFrame(() => {
      flushDeferredThumbnailPatchQueue();
    });
  }, [flushDeferredThumbnailPatchQueue]);

  const flushHotThumbnailPatches = useCallback((limit = THUMBNAIL_PATCH_FLUSH_MAX_ITEMS) => {
    if (thumbnailPatchStoreRef.current.size === 0) {
      return;
    }

    const ids: string[] = [];
    const seen = new Set<string>();
    const collect = (sourceIds: Set<string>) => {
      for (const id of sourceIds) {
        if (ids.length >= limit) {
          return;
        }
        if (seen.has(id) || !thumbnailPatchStoreRef.current.has(id)) {
          continue;
        }
        seen.add(id);
        ids.push(id);
      }
    };

    collect(visibleThumbnailIdsRef.current);
    collect(previewPriorityIdsRef.current);
    collect(prioritizedThumbnailIdsRef.current);

    if (ids.length > 0) {
      applyThumbnailPatches(ids, "hot");
    }
  }, [applyThumbnailPatches]);

  const enqueueVisibleThumbnailEntries = useCallback((ids: Iterable<string>, priority = 0) => {
    const pipeline = pipelineRef.current;
    if (!pipeline) {
      return;
    }

    const items: ThumbnailPipelineEntry[] = [];
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

  const enqueuePriorityThumbnailEntries = useCallback((ids: Iterable<string>, priority = 1) => {
    const pipeline = pipelineRef.current;
    if (!pipeline) {
      return;
    }

    const items: ThumbnailPipelineEntry[] = [];
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

  const invalidateThumbnailEntries = useCallback((ids: Iterable<string>): string[] => {
    const pipeline = pipelineRef.current;
    if (!pipeline) {
      return [];
    }

    const uniqueIds: string[] = [];
    const seen = new Set<string>();

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
      previewWarmupPipelineRef.current = new PreviewWarmupPipeline(
        (assetId, maxDimension, priority) =>
          warmOnDemandPreviewCache(assetId, priority, { maxDimension }),
        {
          shouldDefer: shouldDeferBackgroundWork,
          deferDelayMs: BACKGROUND_WORK_DEFER_RETRY_MS,
        },
      );
    }

    return previewWarmupPipelineRef.current;
  }, [shouldDeferBackgroundWork]);

  const enqueuePreviewWarmupForIds = useCallback((
    ids: Iterable<string>,
    priority = 1,
    limit = RAW_PREVIEW_FILTER_WARM_COUNT,
  ) => {
    const fitPreviewMaxDimension = getQuickPreviewFitMaxDimension(thumbnailProfile);
    const items: Array<{ assetId: string; maxDimension: number }> = [];

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

  const enqueueQuickPreviewWarmupForIds = useCallback((
    ids: Iterable<string>,
    priority = 0,
    limit = QUICK_PREVIEW_PRIORITY_WARM_COUNT,
  ) => {
    const fitPreviewMaxDimension = getQuickPreviewFitMaxDimension(thumbnailProfile);
    const items: Array<{ assetId: string; maxDimension: number }> = [];
    const seen = new Set<string>();

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

  const scheduleBackgroundFitPreviewWarmup = useCallback((delayMs = BACKGROUND_FIT_PREVIEW_WARM_START_DELAY_MS) => {
    if (backgroundFitPreviewWarmupTimerRef.current !== null) {
      window.clearTimeout(backgroundFitPreviewWarmupTimerRef.current);
    }

    const orderedIds = backgroundFitPreviewOrderedIdsRef.current;
    const maxCount = Math.min(orderedIds.length, BACKGROUND_FIT_PREVIEW_WARM_MAX_COUNT);
    if (maxCount === 0 || backgroundFitPreviewCursorRef.current >= maxCount) {
      backgroundFitPreviewWarmupTimerRef.current = null;
      return;
    }

    backgroundFitPreviewWarmupTimerRef.current = window.setTimeout(() => {
      backgroundFitPreviewWarmupTimerRef.current = null;
      if (shouldDeferBackgroundWork(3)) {
        scheduleBackgroundFitPreviewWarmup(BACKGROUND_WORK_DEFER_RETRY_MS);
        return;
      }

      const refreshedOrderedIds = backgroundFitPreviewOrderedIdsRef.current;
      const refreshedMaxCount = Math.min(refreshedOrderedIds.length, BACKGROUND_FIT_PREVIEW_WARM_MAX_COUNT);
      if (refreshedMaxCount === 0 || backgroundFitPreviewCursorRef.current >= refreshedMaxCount) {
        return;
      }

      const batchStart = backgroundFitPreviewCursorRef.current;
      const batchEnd = Math.min(
        refreshedMaxCount,
        batchStart + BACKGROUND_FIT_PREVIEW_WARM_BATCH_SIZE,
      );
      const batchIds = refreshedOrderedIds.slice(batchStart, batchEnd);

      if (batchIds.length === 0) {
        backgroundFitPreviewCursorRef.current = batchEnd;
        return;
      }

      enqueueQuickPreviewWarmupForIds(batchIds, 3, batchIds.length);
      backgroundFitPreviewCursorRef.current = batchEnd;

      if (batchEnd < refreshedMaxCount) {
        scheduleBackgroundFitPreviewWarmup(BACKGROUND_FIT_PREVIEW_WARM_BATCH_INTERVAL_MS);
      }
    }, delayMs);
  }, [enqueueQuickPreviewWarmupForIds, shouldDeferBackgroundWork]);

  const handleBackgroundPreviewOrderChange = useCallback((orderedIds: string[]) => {
    if (typeof window === "undefined" || typeof window.filexDesktop === "undefined") {
      return;
    }

    backgroundFitPreviewOrderedIdsRef.current = orderedIds.slice(0, BACKGROUND_FIT_PREVIEW_WARM_MAX_COUNT);
    backgroundFitPreviewCursorRef.current = 0;
    scheduleBackgroundFitPreviewWarmup();
  }, [scheduleBackgroundFitPreviewWarmup]);

  useEffect(() => {
    const pipeline = pipelineRef.current;
    if (!pipeline || allAssetsRef.current.length === 0) {
      return;
    }

    pipeline.updateOptions(getThumbnailPipelineOptions(thumbnailProfile));

    const visibleIds = Array.from(visibleThumbnailIdsRef.current);
    const effectivePriorityIds = mergeSets(
      prioritizedThumbnailIdsRef.current,
      previewPriorityIdsRef.current,
    );
    const prioritizedIds = Array.from(effectivePriorityIds)
      .filter((id) => !visibleThumbnailIdsRef.current.has(id));

    const invalidatedVisibleIds = invalidateThumbnailEntries(visibleIds);
    const invalidatedPriorityIds = invalidateThumbnailEntries(prioritizedIds);
    const invalidatedIds = [...invalidatedVisibleIds, ...invalidatedPriorityIds];
    if (invalidatedIds.length > 0) {
      for (const id of invalidatedIds) {
        revokeThumbnailViewUrl(getThumbnailView(id));
      }
      removeThumbnailViews(invalidatedIds);
    }

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
      lastUpdatedAt: Date.now(),
    }));
    perfTimeEnd(PERF_FIRST_THUMBNAIL_TO_GRID_COMPLETE);
  }, []);

  // ── Thumbnail batch handler (called by pipeline every ~120 ms) ──────
  const handleThumbnailBatch = useCallback((batch: ThumbnailUpdate[]) => {
    if (batch.length === 0) {
      return;
    }

    const hotIds: string[] = [];
    for (const update of batch) {
      const previousPatch = thumbnailPatchStoreRef.current.get(update.id);
      if (previousPatch && previousPatch.thumbnailUrl !== update.url) {
        revokeThumbnailViewUrl(previousPatch);
      }
      thumbnailPatchStoreRef.current.set(update.id, {
        thumbnailUrl: update.url,
        width: update.width,
        height: update.height,
        orientation: detectOrientation(update.width, update.height),
        aspectRatio: update.width / update.height,
        sourceFileKey: update.sourceFileKey,
      });

      if (isHotThumbnailId(update.id)) {
        hotIds.push(update.id);
      } else if (!thumbnailPatchDeferredSetRef.current.has(update.id)) {
        thumbnailPatchDeferredSetRef.current.add(update.id);
        thumbnailPatchDeferredQueueRef.current.push(update.id);
      }
    }

    applyThumbnailPatches(hotIds, "hot");
    flushHotThumbnailPatches(Math.max(16, Math.ceil(THUMBNAIL_PATCH_FLUSH_MAX_ITEMS / 2)));
    scheduleDeferredThumbnailPatchFlush();

    for (const item of batch) {
      settledThumbnailIdsRef.current.add(item.id);
    }
    syncThumbnailProgress(batch[batch.length - 1]?.id ?? null);
    checkAllThumbnailsSettled();

  }, [
    applyThumbnailPatches,
    checkAllThumbnailsSettled,
    flushHotThumbnailPatches,
    isHotThumbnailId,
    scheduleDeferredThumbnailPatchFlush,
    syncThumbnailProgress,
  ]);

  // Error handler for failed thumbnail generations (e.g. RAW files)
  const lastErrorToastRef = useRef(0);
  const handleThumbnailError = useCallback((failedCount: number, failedId: string) => {
    if (failedId) {
      settledThumbnailIdsRef.current.add(failedId);
      const stalePatch = thumbnailPatchStoreRef.current.get(failedId);
      if (stalePatch) {
        revokeThumbnailViewUrl(stalePatch);
        thumbnailPatchStoreRef.current.delete(failedId);
      }
      thumbnailPatchDeferredSetRef.current.delete(failedId);
    }
    syncThumbnailProgress(failedId);
    checkAllThumbnailsSettled();

    // Debounce toast — show at most once per 5 seconds
    const now = Date.now();
    if (now - lastErrorToastRef.current < 5000) return;
    lastErrorToastRef.current = now;
    addToast(
      `${failedCount} foto non decodificabil${failedCount === 1 ? "e" : "i"} (formati RAW o non supportati).`,
      "warning",
    );
  }, [addToast, checkAllThumbnailsSettled, syncThumbnailProgress]);

  function isValidCachedThumbnail(
    asset: ImageAsset,
    hit: { width: number; height: number },
    minimumRawDimension: number,
  ): boolean {
    if (!isRawFile(asset.fileName)) return true;
    const minDimension = Math.min(hit.width, hit.height);
    // Old cache entries may contain tiny embedded thumbnails (e.g. 160x120).
    // For RAW files we require a minimally useful preview size.
    return minDimension >= minimumRawDimension;
  }

  const stopCurrentImport = useCallback(() => {
    suspendActiveFolderWork();
    resetThumbnailPatchPipeline();
    folderOpenRequestRef.current += 1;
    setIsFolderTransitionBusy(false);
    setFolderTransitionLabel("");

    if (xmpSyncTimerRef.current !== null) {
      window.clearTimeout(xmpSyncTimerRef.current);
      xmpSyncTimerRef.current = null;
    }

    revokeImageAssetUrls(allAssetsRef.current);
    clearImageCache();
    assetNameByIdRef.current = new Map();
    assetIndexByIdRef.current = new Map();
    pendingXmpSyncIdsRef.current.clear();
    xmpSnapshotRef.current.clear();
    cancelReactBatchMetric();
    perfTimeEnd(PERF_FOLDER_OPEN_TO_FIRST_THUMBNAIL_VISIBLE);
    perfTimeEnd(PERF_FIRST_THUMBNAIL_TO_GRID_COMPLETE);
    perfTimeEnd(PERF_XMP_IMPORT);

    publishThumbnailProgress({ done: 0, total: 0 });
    setImportProgress({
      isOpen: false,
      phase: "reading",
      supported: 0,
      ignored: 0,
      total: 0,
      processed: 0,
      currentFile: null,
      folderLabel: "",
    });
    setIsImportPanelDismissed(false);
    setAllAssets([]);
    bumpPhotoMetadataVersion();
    setActiveAssetIds([]);
    setSourceFolderPath("");
    setHasWritableFolderAccess(false);
    setFolderDiagnostics(null);
    setIsFolderDiagnosticsExpanded(false);
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
      previewOpenLatencyMs: null,
      previewNavigationLatencyMs: null,
      xmpSyncLatencyMs: null,
      cachedThumbnailCount: 0,
      totalThumbnailCount: 0,
      bytesRead: 0,
      rawBytesRead: 0,
      standardBytesRead: 0,
      reactCommitCount: 0,
      hotPatchApplied: 0,
      deferredPatchApplied: 0,
      scrollLiteActiveMs: 0,
      rawRenderCacheHit: 0,
      lastUpdatedAt: Date.now(),
    }));
    undoRedo.reset();
  }, [bumpPhotoMetadataVersion, publishThumbnailProgress, resetThumbnailPatchPipeline, suspendActiveFolderWork, undoRedo]);

  const handleCancelImport = useCallback(() => {
    stopCurrentImport();
    addToast("Caricamento annullato. Torniamo alla scelta cartella.", "info");
  }, [addToast, stopCurrentImport]);

  // ── Open folder (instant grid + streaming thumbnails) ────────────────
  const handleFolderOpened = useCallback(
    async ({ name: folderName, entries, rootPath, diagnostics }: FolderOpenResult) => {
      const openRequestId = folderOpenRequestRef.current + 1;
      folderOpenRequestRef.current = openRequestId;
      setIsFolderTransitionBusy(true);
      setFolderTransitionLabel(rootPath ?? folderName);
      suspendActiveFolderWork();

      try {
        // Pending sidecar writes must finish before the new folder snapshot
        // clears the old asset map, including when the user reopens the same
        // folder. Otherwise the queued IDs are discarded below.
        await flushPendingXmpSync().catch(() => false);
        if (folderOpenRequestRef.current !== openRequestId) {
          return;
        }

        const thumbnailOptions = getThumbnailPipelineOptions(thumbnailProfile);
        const minimumRawCacheDimension =
          thumbnailProfile === "ultra-fast"
            ? 160
            : thumbnailProfile === "fast"
              ? 200
              : 280;
        folderOpenStartedAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
        const nextDiagnostics = diagnostics ?? {
          source: "desktop-native",
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
          previewOpenLatencyMs: null,
          previewNavigationLatencyMs: null,
          xmpSyncLatencyMs: null,
          cachedThumbnailCount: 0,
          totalThumbnailCount: entries.length,
          bytesRead: 0,
          rawBytesRead: 0,
          standardBytesRead: 0,
          thumbnailProfile,
          sortCacheEnabled,
          reactCommitCount: 0,
          hotPatchApplied: 0,
          deferredPatchApplied: 0,
          scrollLiteActiveMs: 0,
          rawRenderCacheHit: 0,
          lastUpdatedAt: Date.now(),
        });
        perfTime(PERF_FOLDER_OPEN_TO_FIRST_THUMBNAIL_VISIBLE);
        perfTime(PERF_XMP_IMPORT);

        if (entries.length === 0) {
          revokeImageAssetUrls(allAssetsRef.current);
          clearImageCache();
          assetNameByIdRef.current = new Map();
          assetIndexByIdRef.current = new Map();
          pendingXmpSyncIdsRef.current.clear();
          xmpSnapshotRef.current.clear();
          setAllAssets([]);
          bumpPhotoMetadataVersion();
          setActiveAssetIds([]);
          setSourceFolderPath(rootPath ?? folderName);
          setHasWritableFolderAccess(false);
          setIsFolderDiagnosticsExpanded(false);
          setCurrentScreen("browse");
          setXmpSyncState({
            phase: "idle",
            pending: 0,
            failed: 0,
            lastSyncedAt: null,
          });
          setImportProgress({
            isOpen: false,
            phase: "reading",
            supported: 0,
            ignored: 0,
            total: 0,
            processed: 0,
            currentFile: null,
            folderLabel: folderName,
          });
          perfTimeEnd(PERF_FOLDER_OPEN_TO_FIRST_THUMBNAIL_VISIBLE);
          perfTimeEnd(PERF_XMP_IMPORT);
          addToast("Nessuna immagine supportata trovata nella cartella.", "warning");
          return;
        }

        // 1. Reset session for the new folder load
        const folderLoadSession = folderLoadSessionRef.current;
        persistedStateHydrationRef.current = rootPath
          ? { folderPath: rootPath, session: folderLoadSession }
          : null;

      // 2. Clean up previous blob URLs
      revokeImageAssetUrls(allAssets);
      clearImageCache();

      // 3. Create placeholder assets INSTANTLY (no file reading)
      const placeholderAssets = buildPlaceholderAssets(entries);
      const groupedAssetCount = placeholderAssets.length;
      setFolderDiagnostics((current) =>
        current ? { ...current, groupedAssetCount } : current,
      );
      const assets = placeholderAssets;
      const assetIdSet = new Set(assets.map((asset) => asset.id));
      const hydratePersistedStateAfterPaint = () => {
        if (!rootPath) {
          return;
        }

        afterNextPaint(() => {
          void (async () => {
            try {
              const [sharedProjectFile, cachedCatalogState] = await Promise.all([
                readPhotoSelectorProjectFile(rootPath).catch(() => null),
                hasDesktopStateApi()
                  ? getDesktopFolderCatalogState(rootPath).catch(() => null)
                  : Promise.resolve(null),
              ]);

              if (
                folderOpenRequestRef.current !== openRequestId ||
                folderLoadSessionRef.current !== folderLoadSession
              ) {
                return;
              }

              if (sharedProjectFile?.projectName) {
                setProjectName(sharedProjectFile.projectName);
              }

              const cachedStates = sharedProjectFile?.folderState?.assetStates ?? cachedCatalogState?.assetStates ?? [];
              if (cachedStates.length > 0) {
                const cachedStateByPath = new Map(
                  cachedStates.map((assetState) => [
                    assetState.relativePath.toLocaleLowerCase(),
                    assetState,
                  ]),
                );

                startTransition(() => {
                  setAllAssets((prev) => {
                    if (prev.length === 0) {
                      return prev;
                    }

                    let changed = false;
                    const next = prev.map((asset) => {
                      const cachedState = cachedStateByPath.get(asset.path.toLocaleLowerCase());
                      if (!cachedState) {
                        return asset;
                      }

                      changed = true;
                      return {
                        ...asset,
                        rating: cachedState.rating,
                        pickStatus: cachedState.pickStatus,
                        colorLabel: cachedState.colorLabel,
                        customLabels: cachedState.customLabels,
                      };
                    });

                    return changed ? next : prev;
                  });
                });
                bumpPhotoMetadataVersion();
              }

              const persistedActiveAssetIds = (
                sharedProjectFile?.folderState?.activeAssetIds ??
                cachedCatalogState?.activeAssetIds ??
                []
              ).filter((assetId) => assetIdSet.has(assetId));

              if (persistedActiveAssetIds.length > 0) {
                setActiveAssetIds(persistedActiveAssetIds);
              }
            } finally {
              const pendingHydration = persistedStateHydrationRef.current;
              if (
                pendingHydration &&
                pendingHydration.folderPath === rootPath &&
                pendingHydration.session === folderLoadSession
              ) {
                persistedStateHydrationRef.current = null;
              }
            }
          })();
        });
      };
      const rawPreviewBootstrapIds = assets
        .filter((asset) => isRawFile(asset.fileName))
        .slice(0, RAW_PREVIEW_BOOTSTRAP_COUNT)
        .map((asset) => asset.id);
      assetNameByIdRef.current = new Map(assets.map((asset) => [asset.id, asset.fileName]));
      assetIndexByIdRef.current = new Map(assets.map((asset, index) => [asset.id, index]));
      const writableAccess = entries.some((entry) => !!entry.absolutePath);

      setAllAssets(assets);
      bumpPhotoMetadataVersion();
      setActiveAssetIds([]);
      setSourceFolderPath(rootPath ?? folderName);
      setHasWritableFolderAccess(writableAccess);
      setIsFolderDiagnosticsExpanded(false);
      setIsXmpBannerDismissed(false);
      setCurrentScreen("selection"); // instant — grid shows immediately
      markInteractiveWork(2200);
      hydratePersistedStateAfterPaint();
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
        addToast(
          "Cartella aperta senza accesso completo ai sidecar XMP. Le modifiche restano locali finché non riapri la cartella con accesso scrivibile.",
          "warning",
          6500,
        );
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
      });
      addToast(`${entries.length} foto trovate in "${folderName}".`, "info");
      if (hasDesktopStateApi() && rootPath) {
        void logDesktopEvent({
          channel: "folder-open",
          level: "info",
          message: "Cartella aperta",
          details: `${rootPath} (${entries.length} file)`,
        });
      }

      if (rawPreviewBootstrapIds.length > 0) {
        rawPreviewWarmupTimerRef.current = window.setTimeout(() => {
          rawPreviewWarmupTimerRef.current = null;
          if (folderLoadSessionRef.current !== folderLoadSession) {
            return;
          }

          enqueuePreviewWarmupForIds(rawPreviewBootstrapIds, 3, RAW_PREVIEW_BOOTSTRAP_COUNT);
        }, RAW_PREVIEW_WARMUP_START_DELAY_MS);
      }

      // 4. Import Adobe-compatible XMP sidecars progressively. The first chunk
      // is enough to make the visible grid useful; the rest must not compete
      // with thumbnail decoding while the user starts browsing.
      let xmpCursor = 0;
      let editedBySidecarTotal = 0;

      const runXmpImport = () => {
        xmpImportStartTimerRef.current = null;
        if (folderLoadSessionRef.current !== folderLoadSession) {
          return;
        }

        const chunkSize = xmpCursor === 0
          ? XMP_IMPORT_INITIAL_COUNT
          : XMP_IMPORT_BACKGROUND_CHUNK_SIZE;
        const chunk = assets.slice(xmpCursor, xmpCursor + chunkSize);
        xmpCursor += chunk.length;
        if (chunk.length === 0) {
          perfTimeEnd(PERF_XMP_IMPORT);
          return;
        }

        void mapWithConcurrency(
          chunk,
          XMP_IMPORT_CONCURRENCY,
          async (asset) => {
            if (folderLoadSessionRef.current !== folderLoadSession) {
              return null;
            }

            const xml = await readSidecarXmp(asset.id);
            if (!xml) return null;
            return { id: asset.id, state: parseXmpState(xml) };
          },
        ).then((records) => {
          if (folderLoadSessionRef.current !== folderLoadSession) {
            return;
          }

          const valid = records.filter((r): r is { id: string; state: ReturnType<typeof parseXmpState> } => r !== null);
          const selectedByXmp = valid
            .filter((r) => r.state.selected === true)
            .map((r) => r.id);
          const recordsToApply = valid.filter((record) => {
            const index = assetIndexByIdRef.current.get(record.id);
            const asset = index === undefined ? null : allAssetsRef.current[index] ?? null;
            if (!asset) {
              return false;
            }

            const hasEdits = record.state.hasCameraRawAdjustments || record.state.hasPhotoshopAdjustments;
            const xmpEditInfo = record.state.hasCameraRawAdjustments && record.state.hasPhotoshopAdjustments
              ? "Camera Raw + Photoshop"
              : record.state.hasCameraRawAdjustments
                ? "Camera Raw"
                : record.state.hasPhotoshopAdjustments
                  ? "Photoshop"
                  : undefined;
            const nextRating = record.state.rating ?? asset.rating;
            const nextPickStatus = record.state.pickStatus ?? asset.pickStatus;
            const nextColorLabel = record.state.colorLabel !== undefined
              ? record.state.colorLabel
              : asset.colorLabel;
            const nextCustomLabels = record.state.customLabels !== undefined
              ? record.state.customLabels
              : asset.customLabels;

            return nextRating !== asset.rating
              || nextPickStatus !== asset.pickStatus
              || nextColorLabel !== asset.colorLabel
              || !areStringArraysEqual(nextCustomLabels, asset.customLabels)
              || asset.xmpHasEdits !== hasEdits
              || asset.xmpEditInfo !== xmpEditInfo;
          });

          if (recordsToApply.length > 0) {
            startTransition(() => {
              setAllAssets((prev) => {
                if (prev.length === 0) {
                  return prev;
                }

                const next = prev.slice();
                let changed = false;

                for (const record of recordsToApply) {
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
            bumpPhotoMetadataVersion();
          }

          if (selectedByXmp.length > 0) {
            setActiveAssetIds((current) => Array.from(new Set([...current, ...selectedByXmp])));
          }

          editedBySidecarTotal += valid.filter(
            (r) => r.state.hasCameraRawAdjustments || r.state.hasPhotoshopAdjustments,
          ).length;
        }).catch(() => {
          // Sidecar import is best-effort only.
        }).finally(() => {
          if (folderLoadSessionRef.current !== folderLoadSession) {
            return;
          }

          if (xmpCursor < assets.length) {
            xmpImportStartTimerRef.current = window.setTimeout(runXmpImport, XMP_IMPORT_BACKGROUND_DELAY_MS);
            return;
          }

          if (editedBySidecarTotal > 0) {
            addToast(
              `${editedBySidecarTotal} foto con modifiche XMP (Camera Raw/Photoshop) rilevate.`,
              "info",
            );
          }
          perfTimeEnd(PERF_XMP_IMPORT);
        });
      };

      if (XMP_IMPORT_START_DELAY_MS > 0) {
        xmpImportStartTimerRef.current = window.setTimeout(runXmpImport, XMP_IMPORT_START_DELAY_MS);
      } else {
        runXmpImport();
      }

      // 5. Check thumbnail cache, then start pipeline for ALL images (including RAW)
      const assetIdByPath = new Map(assets.map((asset) => [asset.path, asset.id]));
      const pipelineEntries: ThumbnailPipelineEntry[] = [];
      for (const entry of entries) {
        const id = assetIdByPath.get(entry.relativePath);
        if (!id) {
          continue;
        }

        pipelineEntries.push({
          id,
          absolutePath: entry.absolutePath,
          sourceFileKey: buildSourceFileKeyFromStats(
            entry.relativePath,
            entry.size,
            entry.lastModified,
          ),
        });
      }

      thumbnailEntryByIdRef.current = new Map(pipelineEntries.map((entry) => [entry.id, entry]));
      thumbnailTotalCountRef.current = pipelineEntries.length;
      settledThumbnailIdsRef.current = new Set();
      setPerformanceSnapshot((current) => ({
        ...current,
        totalThumbnailCount: pipelineEntries.length,
        lastUpdatedAt: Date.now(),
      }));

      if (pipelineEntries.length === 0) {
        perfTimeEnd(PERF_FOLDER_OPEN_TO_FIRST_THUMBNAIL_VISIBLE);
        perfTimeEnd(PERF_XMP_IMPORT);
        setImportProgress((current) => ({ ...current, isOpen: false, total: 0, processed: 0 }));
        return;
      }

      const bootstrapCacheCount = Math.min(
        pipelineEntries.length,
        Math.max(THUMBNAIL_BOOTSTRAP_COUNT, 36),
      );
      const bootstrapEntries = pipelineEntries.slice(0, bootstrapCacheCount);
      const remainingEntries = pipelineEntries.slice(bootstrapCacheCount);
      interactiveThumbnailIdsRef.current = new Set(bootstrapEntries.map((entry) => entry.id));
      publishThumbnailProgress({
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
          pipelineRef.current = new ThumbnailPipeline(
            handleThumbnailBatch,
            handleThumbnailError,
            {
              ...thumbnailOptions,
              shouldDefer: shouldDeferBackgroundWork,
              deferDelayMs: BACKGROUND_WORK_DEFER_RETRY_MS,
            },
          );
        }

        return pipelineRef.current;
      };

      const enqueuePipelineEntries = (
        entriesToEnqueue: ThumbnailPipelineEntry[],
        strategy: "bootstrap" | "background",
      ) => {
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

      const markCacheMissEntries = (entriesToMark: ThumbnailPipelineEntry[]): ThumbnailPipelineEntry[] =>
        entriesToMark.map((entry) => ({ ...entry, skipDiskCacheRead: true }));

      const applyCachedThumbnails = (
        cached: Map<string, { url: string; width: number; height: number }>,
      ) => {
        const validCachedIds = new Set<string>();
        const assetsSnapshot = allAssetsRef.current;

        for (const [assetId, hit] of cached) {
          const index = assetIndexByIdRef.current.get(assetId);
          const asset = index === undefined ? null : assetsSnapshot[index] ?? null;
          if (!asset || !isValidCachedThumbnail(asset, hit, minimumRawCacheDimension) || getThumbnailView(assetId)?.thumbnailUrl) {
            revokeCachedThumbnailUrls([hit]);
            continue;
          }

          validCachedIds.add(assetId);
        }

        if (validCachedIds.size > 0) {
          {
              if (folderLoadSessionRef.current !== folderLoadSession) {
                for (const assetId of validCachedIds) {
                  const hit = cached.get(assetId);
                  if (hit) {
                    revokeCachedThumbnailUrls([hit]);
                  }
                }
                validCachedIds.clear();
              }

              if (allAssetsRef.current.length === 0) {
                for (const assetId of validCachedIds) {
                  const hit = cached.get(assetId);
                  if (hit) {
                    revokeCachedThumbnailUrls([hit]);
                  }
                }
                validCachedIds.clear();
              }

              const nextViews: Array<[string, ThumbnailViewState]> = [];

              for (const [assetId, hit] of cached) {
                if (!validCachedIds.has(assetId)) {
                  continue;
                }

                const index = assetIndexByIdRef.current.get(assetId);
                if (index === undefined) {
                  revokeCachedThumbnailUrls([hit]);
                  continue;
                }

                const asset = allAssetsRef.current[index];
                if (!asset || !isValidCachedThumbnail(asset, hit, minimumRawCacheDimension) || getThumbnailView(assetId)?.thumbnailUrl) {
                  revokeCachedThumbnailUrls([hit]);
                  validCachedIds.delete(assetId);
                  continue;
                }

                nextViews.push([assetId, {
                  thumbnailUrl: hit.url,
                  width: hit.width,
                  height: hit.height,
                  orientation: detectOrientation(hit.width, hit.height),
                  aspectRatio: hit.width / hit.height,
                  sourceFileKey: asset.sourceFileKey,
                }]);
              }

              applyThumbnailViewsAndNotify(nextViews);
          }
        }

        if (validCachedIds.size > 0) {
          setPerformanceSnapshot((current) => ({
            ...current,
            cachedThumbnailCount: current.cachedThumbnailCount + validCachedIds.size,
            lastUpdatedAt: Date.now(),
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
          if (shouldDeferBackgroundWork(4)) {
            scheduleRemainingCachePhase();
            return;
          }

          const processRemainingChunk = (startIndex: number) => {
            if (folderLoadSessionRef.current !== folderLoadSession) {
              return;
            }

            const chunk = remainingEntries.slice(startIndex, startIndex + BACKGROUND_WARMUP_CACHE_CHUNK_SIZE);
            if (chunk.length === 0) {
              return;
            }

            void loadCachedThumbnails(chunk, thumbnailOptions).then((cached) => {
              if (folderLoadSessionRef.current !== folderLoadSession) {
                revokeCachedThumbnailUrls(cached.values());
                return;
              }

              const validCachedIds = applyCachedThumbnails(cached);
              const uncachedRemaining = markCacheMissEntries(chunk.filter((entry) => !validCachedIds.has(entry.id)));

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
          revokeCachedThumbnailUrls(cached.values());
          return;
        }

        const validCachedIds = applyCachedThumbnails(cached);
        const uncachedBootstrap = markCacheMissEntries(bootstrapEntries.filter((entry) => !validCachedIds.has(entry.id)));
        enqueuePipelineEntries(uncachedBootstrap, "bootstrap");
        scheduleRemainingCachePhase();

        if (remainingEntries.length === 0 && uncachedBootstrap.length === 0) {
          afterNextPaint(() => {
            if (validCachedIds.size > 0) {
              markFirstThumbnailVisible();
            }
            markGridComplete();
          });
          publishThumbnailProgress({ done: 0, total: 0 });
          setImportProgress((current) => ({ ...current, isOpen: false, total: 0, processed: 0 }));
        }
      }).catch(() => {
        if (folderLoadSessionRef.current !== folderLoadSession) {
          return;
        }

        publishThumbnailProgress({ done: 0, total: interactiveThumbnailIdsRef.current.size });
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
      } catch (error) {
        if (folderOpenRequestRef.current === openRequestId) {
          addToast("Apertura cartella non riuscita. Riprova.", "error");
        }
        if (hasDesktopStateApi()) {
          void logDesktopEvent({
            channel: "folder-open",
            level: "error",
            message: "Apertura cartella fallita",
            details: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        if (folderOpenRequestRef.current === openRequestId) {
          setIsFolderTransitionBusy(false);
          setFolderTransitionLabel("");
        }
      }
    },
    [
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
      markInteractiveWork,
      publishThumbnailProgress,
      suspendActiveFolderWork,
      syncThumbnailProgress,
      sortCacheEnabled,
      sourceFolderPath,
      thumbnailProfile,
      undoRedo,
    ]
  );

  // ── Load mock data ───────────────────────────────────────────────────

  // ── Photo metadata changes (with undo history) ───────────────────────
  const chooseUnassignedFolderAction = useCallback(
    (folderPath: string) => new Promise<UnassignedFolderChoice>((resolve) => {
      setUnassignedFolderPrompt({ folderPath, resolve });
    }),
    [],
  );

  const confirmProjectCreation = useCallback(
    (preview: ProjectCreationPreview) => new Promise<boolean>((resolve) => {
      setProjectCreationPrompt({ preview, resolve });
    }),
    [],
  );

  const confirmMasterCorrection = useCallback(
    (preview: MasterCorrectionPreview) => new Promise<boolean>((resolve) => {
      setMasterCorrectionPrompt({ preview, resolve });
    }),
    [],
  );

  const openExistingMasterProject = useCallback(async (rootPath: string, requestedFolderPath?: string) => {
    const projectFolder = await reopenProjectFolder(rootPath);
    if (!projectFolder) {
      addToast("Non sono riuscito ad aprire la cartella master del progetto.", "error");
      return false;
    }
    const normalizedRoot = rootPath.replace(/[\\/]+$/, "").toLocaleLowerCase();
    const normalizedRequested = requestedFolderPath?.replace(/[\\/]+$/, "") ?? "";
    const relativeFocus = normalizedRequested.toLocaleLowerCase().startsWith(`${normalizedRoot}\\`)
      || normalizedRequested.toLocaleLowerCase().startsWith(`${normalizedRoot}/`)
      ? normalizedRequested.slice(rootPath.replace(/[\\/]+$/, "").length + 1).replace(/\\/g, "/")
      : "";
    setProjectFolderFocus(relativeFocus || null);
    await handleFolderOpened(projectFolder);
    return true;
  }, [addToast, handleFolderOpened]);

  const createMasterProject = useCallback(async (projectFolder: FolderOpenResult) => {
    if (!projectFolder.rootPath || projectFolder.entries.length === 0) {
      addToast("La cartella master non contiene fotografie supportate.", "warning");
      return false;
    }

    await flushPendingXmpSync().catch(() => false);
    const legacyProjects = await listPhotoSelectorLegacyProjects(projectFolder.rootPath);
    const normalizedProjectRoot = projectFolder.rootPath.replace(/[\\/]+$/, "").toLocaleLowerCase();
    const nestedMasterProjects = legacyProjects.filter((location) => (
      location.project.projectMode === "master"
      && location.rootPath.replace(/[\\/]+$/, "").toLocaleLowerCase() !== normalizedProjectRoot
    ));
    if (nestedMasterProjects.length > 0) {
      addToast(
        `Cartella troppo ampia: contiene già ${nestedMasterProjects.length} progetto/i master. Scegli la cartella del singolo lavoro.`,
        "error",
        8000,
      );
      return false;
    }
    const assets = buildPlaceholderAssets(projectFolder.entries);
    const pathSegments = projectFolder.rootPath.split(/[\\/]+/).filter(Boolean);
    const parentFolderName = pathSegments.at(-2);
    const suggestedName = projectFolder.name.toLocaleUpperCase() === "FOTO_SD" && parentFolderName
      ? parentFolderName
      : projectFolder.name;
    const merge = buildMasterProject(
      projectFolder.name,
      suggestedName,
      assets,
      getAssetAbsolutePath,
      legacyProjects,
    );
    const topLevelPhotos = Math.min(
      projectFolder.entries.length,
      Math.max(0, projectFolder.diagnostics?.topLevelSupportedCount ?? projectFolder.entries.length),
    );
    const confirmed = await confirmProjectCreation({
      folderPath: projectFolder.rootPath,
      folderName: suggestedName,
      totalPhotos: projectFolder.entries.length,
      topLevelPhotos,
      nestedPhotos: Math.max(0, projectFolder.entries.length - topLevelPhotos),
      nestedFolders: projectFolder.diagnostics?.nestedDirectoriesSeen ?? 0,
      legacyProjectCount: merge.legacyProjectCount,
      recoverableSelections: merge.migratedSelectionCount,
    });
    if (!confirmed) {
      return false;
    }
    const written = await updatePhotoSelectorProjectFile(
      projectFolder.rootPath,
      () => merge.project,
    );
    if (!written) {
      addToast("Creazione del progetto master non riuscita. I progetti esistenti non sono stati modificati.", "error", 7000);
      return false;
    }

    setProjectName(merge.project.projectName ?? suggestedName);
    setProjectFolderFocus(null);
    await handleFolderOpened(projectFolder);
    addToast(
      `Progetto master creato: ${projectFolder.entries.length} foto, ${merge.migratedSelectionCount} selezioni recuperate da ${merge.legacyProjectCount} progetto/i esistenti.`,
      "success",
      8000,
    );
    return true;
  }, [addToast, confirmProjectCreation, flushPendingXmpSync, handleFolderOpened]);

  const handleCreateProject = useCallback(async () => {
    const selectedFolder = await openProjectFolderNative();
    if (!selectedFolder) {
      return;
    }
    const existingProject = await resolvePhotoSelectorProject(selectedFolder.rootPath);
    if (existingProject) {
      await openExistingMasterProject(existingProject.rootPath, selectedFolder.rootPath);
      addToast("Questa cartella appartiene già a un progetto master esistente.", "info");
      return;
    }
    await createMasterProject(selectedFolder);
  }, [addToast, createMasterProject, openExistingMasterProject]);

  const handleRenameProject = useCallback(async (nextName: string) => {
    const normalizedName = nextName.trim();
    if (!normalizedName || !sourceFolderPath) {
      return;
    }
    const localProject = await readPhotoSelectorProjectFile(sourceFolderPath);
    if (localProject?.projectMode !== "master") {
      addToast("È possibile rinominare soltanto un progetto master.", "warning", 5000);
      setIsRenameProjectOpen(false);
      return;
    }
    const saved = await updatePhotoSelectorProjectFile(sourceFolderPath, (current) => ({
      ...(current ?? localProject),
      schemaVersion: 1,
      app: "image-select-pro",
      updatedAt: Date.now(),
      projectName: normalizedName,
    }));
    if (!saved) {
      addToast("Rinomina non riuscita. Il nome precedente è rimasto invariato.", "error", 6000);
      return;
    }
    setProjectName(normalizedName);
    setIsRenameProjectOpen(false);
    addToast("Progetto rinominato. Le versioni Drive continueranno a usare la stessa identità.", "success", 5000);
  }, [addToast, sourceFolderPath]);

  const handleCorrectProjectMaster = useCallback(async () => {
    if (!sourceFolderPath || allAssets.length === 0) {
      addToast("Apri prima il progetto master da correggere.", "warning", 5000);
      return;
    }
    const currentProject = await readPhotoSelectorProjectFile(sourceFolderPath);
    if (currentProject?.projectMode !== "master") {
      addToast("La cartella aperta non è un progetto master.", "warning", 5000);
      return;
    }

    const targetFolder = await openProjectFolderNative();
    if (!targetFolder) {
      return;
    }
    const normalizedSource = sourceFolderPath.replace(/[\\/]+$/, "");
    const normalizedTarget = targetFolder.rootPath.replace(/[\\/]+$/, "");
    if (normalizedTarget.toLocaleLowerCase() === normalizedSource.toLocaleLowerCase()) {
      addToast("Hai scelto la cartella master già attiva.", "info", 4500);
      return;
    }
    const isDescendant = normalizedTarget.toLocaleLowerCase().startsWith(`${normalizedSource.toLocaleLowerCase()}\\`)
      || normalizedTarget.toLocaleLowerCase().startsWith(`${normalizedSource.toLocaleLowerCase()}/`);
    if (!isDescendant) {
      addToast("Scegli una sottocartella del master attuale.", "warning", 6000);
      return;
    }
    if (targetFolder.entries.length === 0) {
      addToast("La nuova cartella master non contiene fotografie supportate.", "warning", 6000);
      return;
    }

    await flushPendingXmpSync().catch(() => false);
    const targetLegacyProjects = await listPhotoSelectorLegacyProjects(targetFolder.rootPath);
    const assets = buildPlaceholderAssets(targetFolder.entries);
    const merge = buildMasterProject(
      targetFolder.name,
      currentProject.projectName ?? projectName,
      assets,
      getAssetAbsolutePath,
      [
        ...targetLegacyProjects,
        { rootPath: sourceFolderPath, project: currentProject },
      ],
    );
    const sourceFolderName = normalizedSource.split(/[\\/]+/).filter(Boolean).pop() ?? normalizedSource;
    const targetSegments = normalizedTarget.split(/[\\/]+/).filter(Boolean);
    const targetParentName = targetSegments.at(-2);
    const targetSuggestedName = targetFolder.name.toLocaleUpperCase() === "FOTO_SD" && targetParentName
      ? targetParentName
      : targetFolder.name;
    const currentProjectName = (currentProject.projectName ?? projectName).trim();
    const correctedProjectName = currentProjectName.toLocaleLowerCase() === sourceFolderName.toLocaleLowerCase()
      ? targetSuggestedName
      : currentProjectName;
    const relocatedProject = {
      ...merge.project,
      projectId: currentProject.projectId ?? merge.project.projectId,
      createdAt: currentProject.createdAt ?? merge.project.createdAt,
      projectName: correctedProjectName,
    };
    const currentSelectionCount = currentProject.folderState?.activeAssetIds?.length ?? activeAssetIds.length;
    const confirmed = await confirmMasterCorrection({
      currentFolderPath: sourceFolderPath,
      targetFolderPath: targetFolder.rootPath,
      totalPhotos: assets.length,
      recoveredSelections: merge.migratedSelectionCount,
      excludedSelections: Math.max(0, currentSelectionCount - merge.migratedSelectionCount),
    });
    if (!confirmed) {
      return;
    }

    if (catalogPersistTimerRef.current !== null) {
      window.clearTimeout(catalogPersistTimerRef.current);
      catalogPersistTimerRef.current = null;
    }
    setIsFolderTransitionBusy(true);
    setFolderTransitionLabel(targetFolder.rootPath);
    const relocation = await relocatePhotoSelectorProjectFile(
      sourceFolderPath,
      targetFolder.rootPath,
      relocatedProject,
    );
    if (!relocation.ok) {
      setIsFolderTransitionBusy(false);
      setFolderTransitionLabel("");
      addToast(relocation.message ?? "Correzione della cartella master non riuscita.", "error", 7000);
      return;
    }

    setProjectFolderFocus(null);
    await handleFolderOpened(targetFolder);
    addToast(
      `Master corretto: ${assets.length} foto e ${merge.migratedSelectionCount} selezioni recuperate. Il master precedente è stato conservato come backup.`,
      "success",
      9000,
    );
  }, [
    activeAssetIds.length,
    addToast,
    allAssets.length,
    confirmMasterCorrection,
    flushPendingXmpSync,
    handleFolderOpened,
    projectName,
    sourceFolderPath,
  ]);

  const handleFolderCandidateOpened = useCallback(async (folder: FolderOpenResult) => {
    const projectLocation = await resolvePhotoSelectorProject(folder.rootPath);
    if (projectLocation) {
      await openExistingMasterProject(projectLocation.rootPath, folder.rootPath);
      return;
    }
    setProjectFolderFocus(null);
    await handleFolderOpened(folder);
  }, [handleFolderOpened, openExistingMasterProject]);

  const handleDesktopRequestedFolderOpen = useCallback(async (folderPath: string) => {
    if (
      typeof window === "undefined"
      || typeof window.filexDesktop === "undefined"
      || typeof window.filexDesktop.reopenFolder !== "function"
    ) {
      return;
    }

    const normalizedPath = folderPath.trim();
    if (!normalizedPath) {
      return;
    }

    try {
      const projectLocation = await resolvePhotoSelectorProject(normalizedPath);
      if (projectLocation) {
        await openExistingMasterProject(projectLocation.rootPath, normalizedPath);
        if (hasDesktopStateApi()) {
          void logDesktopEvent({
            channel: "folder-open",
            level: "info",
            message: "Sottocartella aperta nel progetto master",
            details: `${normalizedPath} -> ${projectLocation.rootPath}`,
          });
        }
        return;
      }

      const unassignedChoice = await chooseUnassignedFolderAction(normalizedPath);
      if (unassignedChoice === "cancel") {
        return;
      }
      if (unassignedChoice === "choose-master") {
        await handleCreateProject();
        return;
      }
      const projectFolder = await reopenProjectFolder(normalizedPath);
      if (projectFolder) {
        await createMasterProject(projectFolder);
        return;
      }

      let reopenedFolder = null;
      const retryDelaysMs = [0, 180, 420, 900];

      for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
        const delayMs = retryDelaysMs[attempt];
        if (delayMs > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        }

        reopenedFolder = await window.filexDesktop.reopenFolder(normalizedPath, { recursive: false });
        if (reopenedFolder) {
          break;
        }
      }

      if (!reopenedFolder) {
        addToast("Non sono riuscito ad aprire la cartella richiesta da Esplora file.", "warning");
        if (hasDesktopStateApi()) {
          void logDesktopEvent({
            channel: "folder-open",
            level: "warn",
            message: "Cartella da menu contestuale non risolta",
            details: normalizedPath,
          });
        }
        return;
      }

      await handleFolderOpened(reopenedFolder);
      if (hasDesktopStateApi()) {
        void logDesktopEvent({
          channel: "folder-open",
          level: "info",
          message: "Cartella aperta dal menu contestuale",
          details: normalizedPath,
        });
      }
    } catch (error) {
      addToast("Apertura cartella dal menu contestuale non riuscita.", "error");
      if (hasDesktopStateApi()) {
        void logDesktopEvent({
          channel: "folder-open",
          level: "error",
          message: "Apertura cartella dal menu contestuale fallita",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      // Anche un percorso non più disponibile deve chiudere la richiesta
      // desktop, altrimenti resta pendente e viene riproposto a ogni focus.
      await acknowledgeDesktopOpenFolderRequest(normalizedPath);
    }
  }, [
    addToast,
    chooseUnassignedFolderAction,
    createMasterProject,
    handleCreateProject,
    handleFolderOpened,
    openExistingMasterProject,
  ]);

  // Il listener IPC resta montato mentre cambiano asset e stato della UI;
  // il ref gli fornisce sempre l'ultima versione della callback.
  const desktopFolderRequestHandlerRef = useRef(handleDesktopRequestedFolderOpen);
  desktopFolderRequestHandlerRef.current = handleDesktopRequestedFolderOpen;

  const handlePhotosChange = useCallback((photos: ImageAsset[]) => {
    const previousAssets = allAssetsRef.current;
    let hasChanges = false;
    const undoableChangedIds = new Set<string>();

    const maxLength = Math.max(photos.length, previousAssets.length);
    for (let index = 0; index < maxLength; index += 1) {
      const nextAsset = photos[index];
      const previousAsset = previousAssets[index];
      if (nextAsset !== previousAsset) {
        hasChanges = true;
        if (nextAsset && previousAsset && hasUndoableAssetChange(previousAsset, nextAsset)) {
          undoableChangedIds.add(nextAsset.id);
        }
      }
    }

    if (!hasChanges) {
      return;
    }

    if (undoableChangedIds.size > 0) {
      undoRedo.push(allAssetsRef.current);
    }
    allAssetsRef.current = photos;
    assetIndexByIdRef.current = new Map(photos.map((asset, index) => [asset.id, index]));
    startTransition(() => {
      setAllAssets(photos);
    });
    if (undoableChangedIds.size > 0) {
      bumpPhotoMetadataVersion();
      queueXmpSync(Array.from(undoableChangedIds));
    }
  }, [bumpPhotoMetadataVersion, queueXmpSync, undoRedo]);

  const handlePhotoUpdates = useCallback((updates: Array<{ id: string; asset: ImageAsset }>) => {
    if (updates.length === 0) {
      return;
    }

    const previousAssets = allAssetsRef.current;
    const nextAssets = previousAssets.slice();
    const undoableChangedIds = new Set<string>();
    const thumbnailUpdates = new Map<string, ThumbnailViewState>();
    const thumbnailRemovals = new Set<string>();
    let hasChanges = false;

    for (const update of updates) {
      const index = assetIndexByIdRef.current.get(update.id);
      if (index === undefined) {
        continue;
      }

      const previousAsset = nextAssets[index];
      if (!previousAsset || previousAsset === update.asset) {
        continue;
      }

      if (update.asset.thumbnailUrl) {
        thumbnailUpdates.set(update.id, {
          thumbnailUrl: update.asset.thumbnailUrl,
          width: update.asset.width,
          height: update.asset.height,
          orientation: update.asset.orientation,
          aspectRatio: update.asset.aspectRatio,
          sourceFileKey: update.asset.sourceFileKey ?? previousAsset.sourceFileKey,
        });
      } else if (
        update.asset.sourceFileKey &&
        previousAsset.sourceFileKey &&
        update.asset.sourceFileKey !== previousAsset.sourceFileKey
      ) {
        thumbnailRemovals.add(update.id);
      }

      const metadataAsset: ImageAsset = {
        ...update.asset,
        thumbnailUrl: previousAsset.thumbnailUrl,
      };

      if (hasAssetRuntimeStateChange(previousAsset, metadataAsset)) {
        nextAssets[index] = metadataAsset;
        hasChanges = true;
      }
      if (hasUndoableAssetChange(previousAsset, metadataAsset)) {
        undoableChangedIds.add(update.id);
      }
    }

    if (thumbnailUpdates.size > 0 || thumbnailRemovals.size > 0) {
      (() => {
        for (const id of thumbnailRemovals) {
          const previousView = getThumbnailView(id);
          if (!previousView) {
            continue;
          }
          revokeThumbnailViewUrl(previousView);
        }
        removeThumbnailViews(thumbnailRemovals);
        for (const [id, view] of thumbnailUpdates) {
          const previousView = getThumbnailView(id);
          if (previousView?.thumbnailUrl && previousView.thumbnailUrl !== view.thumbnailUrl) {
            revokeThumbnailViewUrl(previousView);
          }
        }
        applyThumbnailViewsAndNotify(thumbnailUpdates);
      })();
    }

    if (!hasChanges) {
      return;
    }

    if (undoableChangedIds.size > 0) {
      undoRedo.push(previousAssets);
    }

    allAssetsRef.current = nextAssets;
    startTransition(() => {
      setAllAssets(nextAssets);
    });

    if (undoableChangedIds.size > 0) {
      bumpPhotoMetadataVersion();
      queueXmpSync(Array.from(undoableChangedIds));
    }
  }, [bumpPhotoMetadataVersion, queueXmpSync, undoRedo]);

  const handleSelectionChange = useCallback((nextIds: string[]) => {
    const previousSet = new Set(activeAssetIdsRef.current);
    const nextSet = new Set(nextIds);
    const changedIds = new Set<string>();

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

  const handleGoogleDriveConnect = useCallback(async () => {
    setIsGoogleDriveBusy(true);
    try {
      const status = await connectGoogleDrive();
      setGoogleDriveStatus(status);
      addToast(
        status.accountEmail ? `Google Drive collegato: ${status.accountEmail}` : "Google Drive collegato.",
        "success",
        3200,
      );
    } catch (error) {
      addToast(error instanceof Error ? error.message : "Collegamento Google Drive non riuscito.", "error", 5000);
    } finally {
      setIsGoogleDriveBusy(false);
    }
  }, [addToast]);

  const chooseGoogleDriveVersion = useCallback(
    (versions: DesktopCloudProjectVersion[]) => new Promise<DesktopCloudProjectVersion | null>((resolve) => {
      setDriveVersionPicker({ versions, resolve });
    }),
    [],
  );

  const chooseGoogleDriveManualRoot = useCallback(
    (initialPath: string, unmatchedCount: number) => new Promise<string | null>((resolve) => {
      setDriveManualRootPicker({ initialPath, unmatchedCount, resolve });
    }),
    [],
  );

  const handleGoogleDriveExport = useCallback(async () => {
    if (allAssets.length === 0) {
      addToast("Apri prima una cartella di foto.", "warning");
      return;
    }

    setIsGoogleDriveBusy(true);
    try {
      const localProject = await readPhotoSelectorProjectFile(sourceFolderPath);
      if (localProject?.projectMode !== "master") {
        addToast("Prima crea o apri un progetto master. Le cartelle singole non vengono esportate su Drive.", "warning", 7000);
        return;
      }
      let status = googleDriveStatus;
      if (!status.connected) {
        status = await connectGoogleDrive();
        setGoogleDriveStatus(status);
      }

      const manifest = buildCloudManifest(
        projectName,
        sourceFolderPath,
        allAssets,
        activeAssetIds,
        desktopRuntime?.appVersion,
        localProject.projectId,
      );
      const version = await exportProjectToGoogleDrive(manifest);
      addToast(
        `Selezione esportata su Google Drive: ${new Date(version.createdAt).toLocaleString("it-IT")}`,
        "success",
        5000,
      );
    } catch (error) {
      const refreshedStatus = await getGoogleDriveStatus().catch(() => null);
      if (refreshedStatus) {
        setGoogleDriveStatus(refreshedStatus);
      }
      addToast(error instanceof Error ? error.message : "Esportazione Google Drive non riuscita.", "error", 6000);
    } finally {
      setIsGoogleDriveBusy(false);
    }
  }, [activeAssetIds, addToast, allAssets, desktopRuntime?.appVersion, googleDriveStatus, projectName, sourceFolderPath]);

  const handleGoogleDriveImport = useCallback(async () => {
    setIsGoogleDriveBusy(true);
    try {
      if (allAssets.length > 0) {
        const localProject = await readPhotoSelectorProjectFile(sourceFolderPath);
        if (localProject?.projectMode !== "master") {
          addToast("Questa è una cartella singola. Crea o apri il progetto master prima di continuare da Drive.", "warning", 7000);
          return;
        }
      }
      let status = googleDriveStatus;
      if (!status.connected) {
        status = await connectGoogleDrive();
        setGoogleDriveStatus(status);
      }

      const versions = await listGoogleDriveVersions();
      if (versions.length === 0) {
        addToast("Non ho trovato selezioni PhotoSelector su Google Drive.", "warning", 5000);
        return;
      }

      const version = await chooseGoogleDriveVersion(versions);
      if (!version) {
        return;
      }

      const manifest = await downloadGoogleDriveVersion(version.id);

      if (allAssets.length === 0) {
        addToast(`Scegli la cartella master locale per “${manifest.sourceFolderName}”.`, "info", 6000);
        let projectFolder = await openProjectFolderNative();
        if (!projectFolder) {
          return;
        }

        let createdForDriveImport = false;
        const existingProject = await resolvePhotoSelectorProject(projectFolder.rootPath);
        if (existingProject) {
          projectFolder = await reopenProjectFolder(existingProject.rootPath);
          if (!projectFolder) {
            throw new Error("Non sono riuscito ad aprire il progetto master locale.");
          }
        } else {
          const created = await createMasterProject(projectFolder);
          if (!created) {
            return;
          }
          createdForDriveImport = true;
        }

        const targetAssets = buildPlaceholderAssets(projectFolder.entries);
        const mapping = mapCloudProjectToAssets(targetAssets, manifest.assets);
        const cloudStateByAssetId = mapping.stateByAssetId;
        if (mapping.unmatchedCount > 0 || mapping.ambiguousCount > 0) {
          const details = [
            mapping.unmatchedCount > 0 ? `${mapping.unmatchedCount} non trovate` : null,
            mapping.ambiguousCount > 0 ? `${mapping.ambiguousCount} ambigue` : null,
          ].filter(Boolean).join(", ");
          addToast(`Cartella non compatibile: ${details}. Nessuna selezione è stata sovrascritta.`, "warning", 8000);
          return;
        }

        const localProject = await readPhotoSelectorProjectFile(projectFolder.rootPath);
        const localStateByPath = new Map(
          (localProject?.folderState?.assetStates ?? []).map((state) => [normalizeCloudPath(state.relativePath), state]),
        );
        const localActiveIds = new Set(localProject?.folderState?.activeAssetIds ?? []);
        const now = Date.now();
        const activeAssetIds: string[] = [];
        const assetStates = targetAssets.map((asset) => {
          const cloudState = cloudStateByAssetId.get(asset.id);
          const localState = localStateByPath.get(normalizeCloudPath(asset.path));
          if (cloudState ? cloudState.active === true : localActiveIds.has(asset.id)) {
            activeAssetIds.push(asset.id);
          }
          return {
            assetId: asset.id,
            fileName: asset.fileName,
            relativePath: asset.path,
            absolutePath: getAssetAbsolutePath(asset.id) ?? undefined,
            sourceFileKey: asset.sourceFileKey,
            rating: cloudState?.rating ?? localState?.rating ?? asset.rating ?? 0,
            pickStatus: cloudState?.pickStatus ?? localState?.pickStatus ?? asset.pickStatus ?? "unmarked",
            colorLabel: cloudState?.colorLabel ?? localState?.colorLabel ?? asset.colorLabel ?? null,
            customLabels: cloudState?.customLabels ?? localState?.customLabels ?? asset.customLabels ?? [],
            updatedAt: now,
          };
        });
        const saved = await updatePhotoSelectorProjectFile(projectFolder.rootPath, (current) => ({
          ...(current ?? {
            schemaVersion: 1,
            app: "image-select-pro" as const,
            updatedAt: now,
          }),
          projectMode: "master",
          projectId: createdForDriveImport
            ? manifest.projectId
            : current?.projectId ?? manifest.projectId ?? globalThis.crypto?.randomUUID?.() ?? `project-${now}`,
          projectRootFolderName: projectFolder.name,
          createdAt: current?.createdAt ?? now,
          projectName: createdForDriveImport ? manifest.projectName : current?.projectName ?? manifest.projectName,
          folderState: { activeAssetIds, assetStates },
        }));
        if (!saved) {
          throw new Error("Non sono riuscito a salvare la selezione nel progetto master locale.");
        }
        await handleFolderOpened(projectFolder);
        setProjectName(createdForDriveImport ? manifest.projectName : localProject?.projectName ?? manifest.projectName);
        addToast(
          `Selezione recuperata: ${activeAssetIds.length} foto da “${manifest.sourceFolderName}”.`,
          "success",
          7000,
        );
        return;
      }

      const mapping = mapCloudProjectToAssets(allAssets, manifest.assets);
      const mappingIssueCount = mapping.unmatchedCount + mapping.ambiguousCount;
      if (mappingIssueCount > 0) {
        const manualRoot = await chooseGoogleDriveManualRoot(sourceFolderPath, mappingIssueCount);
        if (manualRoot?.trim() && window.filexDesktop?.reopenFolder) {
          const reopened = await window.filexDesktop.reopenFolder(manualRoot.trim(), { recursive: true });
          if (reopened) {
            await handleFolderOpened(reopened);
            addToast("Cartella backup riaperta. Premi di nuovo Continua da Drive per completare la mappatura.", "info", 6000);
            return;
          }
        }
        addToast(
          `Importazione annullata: ${mapping.unmatchedCount} foto non trovate e ${mapping.ambiguousCount} ambigue.`,
          "warning",
          7000,
        );
        return;
      }

      const localBackup = buildCloudManifest(
        projectName,
        sourceFolderPath,
        allAssets,
        activeAssetIds,
        desktopRuntime?.appVersion,
      );
      const desktopApi = typeof window === "undefined" ? null : window.filexDesktop;
      if (desktopApi?.writeFile && sourceFolderPath) {
        const backupPath = `${sourceFolderPath.replace(/[\\/]+$/, "")}\\.image-select-pro.backup-${Date.now()}.json`;
        await desktopApi.writeFile(backupPath, new TextEncoder().encode(JSON.stringify(localBackup, null, 2)));
      }

      const importedStateByAssetId = mapping.stateByAssetId;
      const nextAssets = allAssets.map((asset) => {
        const state = importedStateByAssetId.get(asset.id);
        if (!state) {
          return asset;
        }
        return {
          ...asset,
          rating: state.rating,
          pickStatus: state.pickStatus,
          colorLabel: state.colorLabel,
          customLabels: state.customLabels,
        };
      });
      handlePhotosChange(nextAssets);

      const retainedActiveIds = activeAssetIds.filter((assetId) => !importedStateByAssetId.has(assetId));
      const importedActiveIds = Array.from(importedStateByAssetId.entries())
        .filter(([, state]) => state.active === true)
        .map(([assetId]) => assetId);
      handleSelectionChange([...retainedActiveIds, ...importedActiveIds]);
      setProjectName(manifest.projectName);
      addToast(
        `Selezione importata: versione del ${new Date(manifest.exportedAt).toLocaleString("it-IT")}. XMP in aggiornamento.`,
        "success",
        6000,
      );
    } catch (error) {
      const refreshedStatus = await getGoogleDriveStatus().catch(() => null);
      if (refreshedStatus) {
        setGoogleDriveStatus(refreshedStatus);
      }
      addToast(error instanceof Error ? error.message : "Importazione Google Drive non riuscita.", "error", 6000);
    } finally {
      setIsGoogleDriveBusy(false);
    }
  }, [activeAssetIds, addToast, allAssets, chooseGoogleDriveManualRoot, chooseGoogleDriveVersion, createMasterProject, desktopRuntime?.appVersion, googleDriveStatus, handleFolderOpened, handlePhotosChange, handleSelectionChange, projectName, sourceFolderPath]);

  const refreshDesktopThumbnailCacheInfo = useCallback(async () => {
    const info = await getDesktopThumbnailCacheInfo();
    setDesktopThumbnailCacheInfo(info);
  }, []);

  useEffect(() => {
    const nextRawRenderCacheHit = desktopThumbnailCacheInfo?.rawRenderCacheHit;
    if (typeof nextRawRenderCacheHit !== "number" || !Number.isFinite(nextRawRenderCacheHit)) {
      return;
    }

    const normalizedValue = Math.max(0, Math.round(nextRawRenderCacheHit));
    setPerformanceSnapshot((current) => (
      current.rawRenderCacheHit === normalizedValue
        ? current
        : {
            ...current,
            rawRenderCacheHit: normalizedValue,
            lastUpdatedAt: Date.now(),
          }
    ));
  }, [desktopThumbnailCacheInfo?.rawRenderCacheHit]);

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
    } finally {
      setIsDesktopThumbnailCacheBusy(false);
    }
  }, [addToast, refreshDesktopCacheLocationRecommendation]);

  const handleSetDesktopThumbnailCacheDirectory = useCallback(async (directoryPath: string) => {
    setIsDesktopThumbnailCacheBusy(true);
    try {
      const info = await setDesktopThumbnailCacheDirectory(directoryPath);
      if (info) {
        setDesktopThumbnailCacheInfo(info);
        await refreshDesktopCacheLocationRecommendation();
        setIsDesktopCacheRecommendationModalOpen(false);
        setIsDesktopCacheRecommendationSnoozedForSession(false);
        addToast("Nuovo percorso cache applicato.", "success");
      } else {
        addToast("Non sono riuscito ad aggiornare il percorso cache.", "error");
      }
    } finally {
      setIsDesktopThumbnailCacheBusy(false);
    }
  }, [addToast, refreshDesktopCacheLocationRecommendation]);

  const handleMigrateDesktopThumbnailCacheDirectory = useCallback(async (directoryPath: string) => {
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

      addToast(
        `Cache migrata: ${result.copiedEntries} file copiati, ${result.removedSourceEntries} rimossi dal vecchio percorso.`,
        "success",
        5200,
      );

      if (result.error) {
        addToast(result.error, "warning", 6500);
      }
    } finally {
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
    } finally {
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
      } else {
        addToast("Non sono riuscito a svuotare la cache thumbnail.", "error");
      }
    } finally {
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
    } finally {
      setIsDesktopThumbnailCacheBusy(false);
    }
  }, [addToast, refreshDesktopCacheLocationRecommendation]);

  const handleRamBudgetPresetChange = useCallback(async (preset: DesktopRamBudgetPreset) => {
    const info = await setDesktopRamBudgetPreset(preset);
    if (info) {
      setDesktopThumbnailCacheInfo(info);
    }
  }, []);

  const handleExportSelection = useCallback(() => {
    const result = buildSelectionResult(
      PROJECT_ID,
      projectName,
      allAssets,
      activeAssetIds
    );

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

    addToast(
      `Selezione esportata: ${activeAssetIds.length} foto in "${a.download}".`,
      "success"
    );
  }, [activeAssetIds, addToast, allAssets, projectName]);

  // ── Viewport tracking for pipeline priority ──────────────────────────
  const handleVisibleIdsChange = useCallback((ids: Set<string>) => {
    markInteractiveWork();
    if (areSetsEqual(visibleThumbnailIdsRef.current, ids)) {
      return;
    }
    visibleThumbnailIdsRef.current = ids;
    enqueueVisibleThumbnailEntries(ids, 0);
    pipelineRef.current?.updateViewport(
      ids,
      mergeSets(prioritizedThumbnailIdsRef.current, previewPriorityIdsRef.current),
    );
    flushHotThumbnailPatches();
  }, [enqueueVisibleThumbnailEntries, flushHotThumbnailPatches, markInteractiveWork]);

  const handlePriorityIdsChange = useCallback((ids: Set<string>) => {
    markInteractiveWork();
    if (areSetsEqual(prioritizedThumbnailIdsRef.current, ids)) {
      return;
    }

    prioritizedThumbnailIdsRef.current = ids;
    enqueuePriorityThumbnailEntries(ids, 1);
    enqueuePreviewWarmupForIds(ids, 0, RAW_PREVIEW_FILTER_WARM_COUNT);
    pipelineRef.current?.updateViewport(
      visibleThumbnailIdsRef.current,
      mergeSets(ids, previewPriorityIdsRef.current),
    );
    flushHotThumbnailPatches();
  }, [enqueuePreviewWarmupForIds, enqueuePriorityThumbnailEntries, flushHotThumbnailPatches, markInteractiveWork]);

  const handlePreviewPriorityIdsChange = useCallback((ids: Set<string>) => {
    markInteractiveWork();
    if (areSetsEqual(previewPriorityIdsRef.current, ids)) {
      return;
    }

    previewPriorityIdsRef.current = ids;
    enqueuePriorityThumbnailEntries(ids, 0);
    enqueueQuickPreviewWarmupForIds(ids, 0, QUICK_PREVIEW_PRIORITY_WARM_COUNT);
    pipelineRef.current?.updateViewport(
      visibleThumbnailIdsRef.current,
      mergeSets(prioritizedThumbnailIdsRef.current, ids),
    );
    flushHotThumbnailPatches();
  }, [enqueuePriorityThumbnailEntries, enqueueQuickPreviewWarmupForIds, flushHotThumbnailPatches, markInteractiveWork]);

  const handleScrollActivityChange = useCallback((active: boolean) => {
    if (active) {
      markInteractiveWork();
    }
  }, [markInteractiveWork]);

  const handleScrollLiteActiveMsChange = useCallback((activeMs: number) => {
    const roundedValue = Math.max(0, Math.round(activeMs));
    if (roundedValue === Math.round(scrollLiteActiveMsRef.current)) {
      return;
    }

    scrollLiteActiveMsRef.current = roundedValue;
    setPerformanceSnapshot((current) => ({
      ...current,
      scrollLiteActiveMs: roundedValue,
      lastUpdatedAt: Date.now(),
    }));
  }, []);

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
    const unsubscribe = subscribeDesktopOpenFolderRequest((folderPath) => {
      void desktopFolderRequestHandlerRef.current(folderPath);
    });
    let cancelled = false;

    void (async () => {
      const pendingFolderPath = await consumePendingDesktopOpenFolderPath();
      if (!cancelled && pendingFolderPath) {
        await desktopFolderRequestHandlerRef.current(pendingFolderPath);
      }

      if (!cancelled) {
        await markDesktopOpenFolderRequestReady();
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getGoogleDriveStatus().then((status) => {
      if (!cancelled) {
        setGoogleDriveStatus(status);
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

    if (
      !desktopCacheLocationRecommendation?.shouldPrompt
      || isDesktopCacheRecommendationSnoozedForSession
    ) {
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
    if (!importProgress.isOpen) return;
    if (importProgress.total === 0 || importProgress.processed < importProgress.total) return;

    const timeoutId = window.setTimeout(() => {
      setIsImportPanelDismissed(false);
      setImportProgress((current) => (
        current.isOpen && current.processed >= current.total
          ? { ...current, isOpen: false }
          : current
      ));
    }, 280);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [importProgress]);

  // ── Persist classification + active selection to XMP sidecars ───────
  useEffect(() => {
    if (usesMockData || !hasWritableFolderAccess || allAssets.length === 0 || pendingXmpSyncIdsRef.current.size === 0) return;

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

  const assetsWithThumbnailViews = useMemo(
    () => allAssets.map((asset) => {
      const thumbnailView = getThumbnailView(asset.id);
      return thumbnailView ? { ...asset, ...thumbnailView } : asset;
    }),
    [allAssets, thumbnailViewVersion],
  );

  const isGeneratingThumbnails =
    thumbnailProgress.total > 0 && thumbnailProgress.done < thumbnailProgress.total;
  const shouldShowXmpBanner =
    !isXmpBannerDismissed &&
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
  return (
    <ErrorBoundary>
      <div className="photo-selector-app">
        <header className="app-header">
          <div className="app-header__identity">
            <img className="app-header__logo" src={logo} alt="" />
            <div className="app-header__brand">
              <h1 className="app-header__title">Image Select Pro</h1>
              <span className="app-header__subtitle">Photo Tools Suite</span>
            </div>
          </div>
          <nav className="app-header__nav">
            <button
              type="button"
              className={currentScreen === "browse" ? "app-header__tab app-header__tab--active" : "app-header__tab"}
              onClick={() => setCurrentScreen("browse")}
            >
              Sfoglia
            </button>
            <button
              type="button"
              className={currentScreen === "selection" ? "app-header__tab app-header__tab--active" : "app-header__tab"}
              onClick={() => setCurrentScreen("selection")}
              disabled={allAssets.length === 0}
            >
              Selezione ({activeAssetIds.length})
            </button>
            <button
              type="button"
              className={currentScreen === "review" ? "app-header__tab app-header__tab--active" : "app-header__tab"}
              onClick={() => setCurrentScreen("review")}
              disabled={allAssets.length === 0}
            >
              Riepilogo ({activeAssetIds.length})
            </button>
          </nav>
          <div className="app-header__primary-actions">
            <button
              type="button"
              className="primary-button app-header__button"
              onClick={() => void handleCreateProject()}
              disabled={isFolderTransitionBusy || isGoogleDriveBusy}
            >
              Nuovo progetto
            </button>
            {allAssets.length > 0 ? (
              <>
                <button
                  type="button"
                  className="ghost-button app-header__button"
                  onClick={() => void handleCorrectProjectMaster()}
                  disabled={isFolderTransitionBusy || isGoogleDriveBusy}
                >
                  Correggi master
                </button>
                <button
                  type="button"
                  className="ghost-button app-header__button"
                  onClick={() => setCurrentScreen("browse")}
                  disabled={isFolderTransitionBusy}
                >
                  Apri altro
                </button>
              </>
            ) : null}
          </div>

          <div className="app-header__context">
            {allAssets.length > 0 ? (
              <div className="app-header__project-name">
                <span>Nome progetto</span>
                <div className="app-header__project-name-value">
                  <strong title={projectName}>{projectName}</strong>
                  <button
                    type="button"
                    className="ghost-button app-header__rename-button"
                    onClick={() => setIsRenameProjectOpen(true)}
                    disabled={isFolderTransitionBusy || isGoogleDriveBusy}
                  >
                    Rinomina
                  </button>
                </div>
              </div>
            ) : (
              <div className="app-header__project-empty">
                <span>Progetto</span>
                <strong>Nessun progetto aperto</strong>
              </div>
            )}

            <div className="app-header__drive-actions">
              <button
                type="button"
                className="ghost-button app-header__button app-header__drive-account"
                onClick={() => void handleGoogleDriveConnect()}
                disabled={isGoogleDriveBusy}
                title={googleDriveStatus.accountEmail ?? "Collega Google Drive"}
              >
                <span className="app-header__drive-label">
                  {googleDriveStatus.connected ? "Drive collegato" : "Collega Drive"}
                </span>
                {googleDriveStatus.connected && googleDriveStatus.accountEmail ? (
                  <span className="app-header__drive-email">{googleDriveStatus.accountEmail}</span>
                ) : null}
              </button>
              {allAssets.length > 0 ? (
                <button
                  type="button"
                  className="secondary-button app-header__button"
                  onClick={() => void handleGoogleDriveExport()}
                  disabled={isGoogleDriveBusy}
                >
                  Esporta su Drive
                </button>
              ) : null}
              <button
                type="button"
                className="secondary-button app-header__button"
                onClick={() => void handleGoogleDriveImport()}
                disabled={isGoogleDriveBusy || isFolderTransitionBusy}
                title={allAssets.length > 0
                  ? "Importa una versione Drive nel progetto aperto"
                  : "Recupera una selezione Drive e associala alla cartella master locale"}
              >
                {allAssets.length > 0 ? "Continua da Drive" : "Recupera da Drive"}
              </button>
            </div>

            <div className="app-header__statuses" aria-live="polite">
              {isGeneratingThumbnails ? (
                <button
                  type="button"
                  className="app-header__pipeline-status app-header__pipeline-status--button"
                  onClick={() => setIsImportPanelDismissed(false)}
                  title="Mostra stato caricamento"
                >
                  <div className="pipeline-progress">
                    <div
                      className="pipeline-progress__fill"
                      style={{ width: `${Math.round((thumbnailProgress.done / Math.max(1, thumbnailProgress.total)) * 100)}%` }}
                    />
                  </div>
                  <span className="pipeline-progress__label">
                    {thumbnailProgress.done}/{thumbnailProgress.total}
                  </span>
                </button>
              ) : null}
              {isFolderTransitionBusy ? (
                <div className="app-header__sync-status app-header__sync-status--pending" title={folderTransitionLabel}>
                  Cambio cartella...
                </div>
              ) : null}
              {!usesMockData && allAssets.length > 0 ? (
                <div className={`app-header__sync-status app-header__sync-status--${xmpSyncState.phase}`}>
                  {xmpSyncLabel}
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="app-main">
          {shouldShowXmpBanner ? (
            <DismissibleBanner
              title="Sincronizzazione XMP non attiva"
              message={desktopRuntime
                ? `La shell desktop FileX e' attiva per ${desktopRuntime.toolName}, ma questa cartella non e' stata aperta con accesso scrivibile completo. Rating, pick e colori resteranno locali finche' non la riapri dal picker desktop.`
                : "La cartella corrente non e' stata aperta con accesso scrivibile completo. Rating, pick e colori resteranno locali finche' non la riapri dal picker desktop."}
              type="warning"
              action={sourceFolderPath
                ? {
                    label: "Vai a Sfoglia",
                    onClick: () => setCurrentScreen("browse"),
                  }
                : undefined}
              onDismiss={() => setIsXmpBannerDismissed(true)}
            />
          ) : null}
          {folderDiagnostics ? (
            <div className="folder-diagnostics-panel" role="status" aria-live="polite">
              <div className="folder-diagnostics-panel__header">
                <div className="folder-diagnostics-panel__context">
                  <strong>Cartella attiva</strong>
                  <span title={folderDiagnostics.selectedPath}>{folderDiagnostics.selectedPath}</span>
                </div>
                <div className="folder-diagnostics-panel__actions">
                  <span className="folder-diagnostics-panel__badge">
                    {folderDiagnostics.groupedAssetCount ?? folderDiagnostics.topLevelSupportedCount} foto
                  </span>
                  {folderDiagnostics.nestedSupportedDiscardedCount > 0 ? (
                    <span className="folder-diagnostics-panel__warning">
                      {folderDiagnostics.nestedSupportedDiscardedCount} annidate ignorate
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="ghost-button ghost-button--small"
                    onClick={() => setIsFolderDiagnosticsExpanded((current) => !current)}
                    aria-expanded={isFolderDiagnosticsExpanded}
                  >
                    {isFolderDiagnosticsExpanded ? "Nascondi dettagli" : "Dettagli"}
                  </button>
                </div>
              </div>

              {isFolderDiagnosticsExpanded ? (
                <div className="folder-diagnostics-panel__grid">
                  <div className="folder-diagnostics-panel__item">
                    <span>Origine</span>
                    <strong>{formatFolderDiagnosticsSource(folderDiagnostics.source)}</strong>
                  </div>
                  <div className="folder-diagnostics-panel__item">
                    <span>File fisici nella cartella</span>
                    <strong>{folderDiagnostics.topLevelSupportedCount}</strong>
                  </div>
                  {typeof folderDiagnostics.groupedAssetCount === "number" ? (
                    <div className="folder-diagnostics-panel__item">
                      <span>Foto dopo raggruppamento</span>
                      <strong>{folderDiagnostics.groupedAssetCount}</strong>
                    </div>
                  ) : null}
                  <div className="folder-diagnostics-panel__item">
                    <span>File nelle sottocartelle ignorati</span>
                    <strong>{folderDiagnostics.nestedSupportedDiscardedCount}</strong>
                  </div>
                  <div className="folder-diagnostics-panel__item">
                    <span>Totale file supportati rilevati</span>
                    <strong>{folderDiagnostics.totalSupportedSeen}</strong>
                  </div>
                  <div className="folder-diagnostics-panel__item">
                    <span>Sottocartelle analizzate</span>
                    <strong>{folderDiagnostics.nestedDirectoriesSeen ?? 0}</strong>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {currentScreen === "browse" ? (
            <div className="app-section">
              <FolderBrowser
                onFolderOpened={handleFolderCandidateOpened}
                onCreateProject={handleCreateProject}
                isBusy={isFolderTransitionBusy}
              />
            </div>
          ) : null}

          {currentScreen === "selection" ? (
            <div className="app-section app-section--full">
              <PhotoSelector
                photos={assetsWithThumbnailViews}
                metadataVersion={photoMetadataVersion}
                sourceFolderPath={sourceFolderPath}
                initialFolderFilter={projectFolderFocus}
                selectedIds={activeAssetIds}
                onSelectionChange={handleSelectionChange}
                onPhotosChange={handlePhotosChange}
                onVisibleIdsChange={handleVisibleIdsChange}
                onPriorityIdsChange={handlePriorityIdsChange}
                onPreviewPriorityIdsChange={handlePreviewPriorityIdsChange}
                onBackgroundPreviewOrderChange={handleBackgroundPreviewOrderChange}
                onScrollLiteActiveMsChange={handleScrollLiteActiveMsChange}
                onUndo={undoRedo.undo}
                onRedo={undoRedo.redo}
                canUndo={undoRedo.canUndo}
                canRedo={undoRedo.canRedo}
                isThumbnailLoading={isGeneratingThumbnails}
                thumbnailProfile={thumbnailProfile}
                sortCacheEnabled={sortCacheEnabled}
                performanceSnapshot={performanceSnapshot}
                onThumbnailProfileChange={setThumbnailProfile}
                onSortCacheEnabledChange={setSortCacheEnabled}
                desktopThumbnailCacheInfo={desktopThumbnailCacheInfo}
                desktopCacheLocationRecommendation={desktopCacheLocationRecommendation}
                isDesktopThumbnailCacheBusy={isDesktopThumbnailCacheBusy}
                isDesktopCacheRecommendationModalOpen={isDesktopCacheRecommendationModalOpen}
                onChooseDesktopThumbnailCacheDirectory={handleChooseDesktopThumbnailCacheDirectory}
                onSetDesktopThumbnailCacheDirectory={handleSetDesktopThumbnailCacheDirectory}
                onUseRecommendedDesktopThumbnailCacheDirectory={handleUseRecommendedDesktopThumbnailCacheDirectory}
                onResetDesktopThumbnailCacheDirectory={handleResetDesktopThumbnailCacheDirectory}
                onClearDesktopThumbnailCache={handleClearDesktopThumbnailCache}
                onSnoozeDesktopCacheRecommendation={handleSnoozeDesktopCacheRecommendation}
                onDismissDesktopCacheRecommendation={handleDismissDesktopCacheRecommendation}
                onRamBudgetPresetChange={handleRamBudgetPresetChange}
                  onRelaunch={relaunchDesktopApp}
                />
            </div>
          ) : null}

          {currentScreen === "review" ? (
            <div className="app-section">
              <SelectionSummary
                allAssets={allAssets}
                activeAssetIds={activeAssetIds}
                projectName={projectName}
                onExportSelection={handleExportSelection}
                onBackToSelection={() => setCurrentScreen("selection")}
              />
            </div>
          ) : null}
        </main>

        <ImportProgressModal
          isOpen={importProgress.isOpen && !isImportPanelDismissed}
          phase={importProgress.phase}
          supported={importProgress.supported}
          ignored={importProgress.ignored}
          total={importProgress.total}
          processed={importProgress.processed}
          currentFile={importProgress.currentFile}
          folderLabel={importProgress.folderLabel}
          onDismiss={() => setIsImportPanelDismissed(true)}
          onCancel={handleCancelImport}
        />

        {driveVersionPicker ? (
          <DriveVersionPickerModal
            versions={driveVersionPicker.versions}
            onSelect={(version) => {
              driveVersionPicker.resolve(version);
              setDriveVersionPicker(null);
            }}
            onCancel={() => {
              driveVersionPicker.resolve(null);
              setDriveVersionPicker(null);
            }}
          />
        ) : null}

        {driveManualRootPicker ? (
          <DriveManualRootPickerModal
            initialPath={driveManualRootPicker.initialPath}
            unmatchedCount={driveManualRootPicker.unmatchedCount}
            onConfirm={(path) => {
              driveManualRootPicker.resolve(path);
              setDriveManualRootPicker(null);
            }}
            onCancel={() => {
              driveManualRootPicker.resolve(null);
              setDriveManualRootPicker(null);
            }}
          />
        ) : null}

        {unassignedFolderPrompt ? (
          <UnassignedFolderModal
            folderPath={unassignedFolderPrompt.folderPath}
            onChoose={(choice) => {
              unassignedFolderPrompt.resolve(choice);
              setUnassignedFolderPrompt(null);
            }}
          />
        ) : null}

        {projectCreationPrompt ? (
          <ConfirmProjectCreationModal
            preview={projectCreationPrompt.preview}
            onConfirm={() => {
              projectCreationPrompt.resolve(true);
              setProjectCreationPrompt(null);
            }}
            onCancel={() => {
              projectCreationPrompt.resolve(false);
              setProjectCreationPrompt(null);
            }}
          />
        ) : null}

        {masterCorrectionPrompt ? (
          <ConfirmMasterCorrectionModal
            preview={masterCorrectionPrompt.preview}
            onConfirm={() => {
              masterCorrectionPrompt.resolve(true);
              setMasterCorrectionPrompt(null);
            }}
            onCancel={() => {
              masterCorrectionPrompt.resolve(false);
              setMasterCorrectionPrompt(null);
            }}
          />
        ) : null}

        {isRenameProjectOpen ? (
          <RenameProjectModal
            currentName={projectName}
            onConfirm={(name) => void handleRenameProject(name)}
            onCancel={() => setIsRenameProjectOpen(false)}
          />
        ) : null}
      </div>
    </ErrorBoundary>
  );
}
