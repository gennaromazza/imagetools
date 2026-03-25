import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopRuntimeInfo } from "@photo-tools/desktop-contracts";
import type { ImageAsset, ImageOrientation } from "@photo-tools/shared-types";
import {
  revokeImageAssetUrls,
} from "./services/browser-image-assets";
import { getDesktopRuntimeInfo } from "./services/desktop-runtime";
import { loadImageAssets } from "./services/image-storage";
import { clearImageCache } from "./services/image-cache";
import {
  buildPlaceholderAssets,
  addRecentFolder,
  buildSourceFileKey,
  buildSourceFileKeyFromStats,
  getFileForAsset,
  hasNativeFolderAccess,
  isRawFile,
  readSidecarXmp,
  writeSidecarXmp,
  type FolderOpenResult,
} from "./services/folder-access";
import { parseXmpState, upsertXmpState } from "./services/xmp-sidecar";
import { ThumbnailPipeline, type ThumbnailUpdate } from "./services/thumbnail-pipeline";
import { cacheThumbnail, loadCachedThumbnails } from "./services/thumbnail-cache";
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
const THUMBNAIL_BOOTSTRAP_COUNT = 24;
const XMP_IMPORT_CONCURRENCY = 4;
const XMP_IMPORT_START_DELAY_MS = 180;

type ThumbnailPipelineEntry = {
  id: string;
  file?: File;
  loadFile?: () => Promise<File | null>;
  absolutePath?: string;
  sourceFileKey?: string;
  createSourceFileKey?: (file: File) => string;
};

interface PersistedState {
  projectName: string;
  sourceFolderPath: string;
  activeAssetIds: string[];
  usesMockData?: boolean;
}

function loadPersistedState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

function savePersistedState(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}

function detectOrientation(w: number, h: number): ImageOrientation {
  if (w === h) return "square";
  return h > w ? "vertical" : "horizontal";
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

export function App() {
  const { addToast } = useToast();

  // ── Persisted state ──────────────────────────────────────────────────
  const [projectName, setProjectName] = useState("Selezione foto");
  const [desktopRuntime, setDesktopRuntime] = useState<DesktopRuntimeInfo | null>(null);
  const [sourceFolderPath, setSourceFolderPath] = useState("");

  // ── Asset catalog ────────────────────────────────────────────────────
  const [allAssets, setAllAssets] = useState<ImageAsset[]>([]);
  const [activeAssetIds, setActiveAssetIds] = useState<string[]>([]);
  const usesMockData = false;

  // ── Pipeline ─────────────────────────────────────────────────────────
  const pipelineRef = useRef<ThumbnailPipeline | null>(null);
  const [thumbnailProgress, setThumbnailProgress] = useState({ done: 0, total: 0 });

  // ── UI state ─────────────────────────────────────────────────────────
  const [currentScreen, setCurrentScreen] = useState<Screen>("browse");
  const [isProjectSelectorOpen, setIsProjectSelectorOpen] = useState(false);
  const [hasWritableFolderAccess, setHasWritableFolderAccess] = useState(false);
  const [isXmpBannerDismissed, setIsXmpBannerDismissed] = useState(false);
  const xmpSyncTimerRef = useRef<number | null>(null);
  const xmpSnapshotRef = useRef(new Map<string, string>());
  const pendingXmpSyncIdsRef = useRef(new Set<string>());
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
  const assetNameByIdRef = useRef(new Map<string, string>());
  const thumbnailTotalCountRef = useRef(0);
  const settledThumbnailIdsRef = useRef<Set<string>>(new Set());
  const thumbnailEntryByIdRef = useRef(new Map<string, ThumbnailPipelineEntry>());
  const visibleThumbnailIdsRef = useRef(new Set<string>());
  const folderLoadSessionRef = useRef(0);
  const xmpImportStartTimerRef = useRef<number | null>(null);

  // ── Restore from IndexedDB on mount ──────────────────────────────────
  useEffect(() => {
    const persisted = loadPersistedState();
    if (!persisted) return;

    setProjectName(persisted.projectName);
    setSourceFolderPath(persisted.sourceFolderPath);
    setHasWritableFolderAccess(false);

    void loadImageAssets(PROJECT_ID).then((assetMap) => {
      if (assetMap.size === 0) return;
      const loaded = Array.from(assetMap.values());
      setAllAssets(loaded);
      const loadedIds = new Set(loaded.map((a) => a.id));
      const validActiveIds = persisted.activeAssetIds.filter((id) => loadedIds.has(id));
      setActiveAssetIds(validActiveIds.length > 0 ? validActiveIds : loaded.map((a) => a.id));
      setCurrentScreen("selection");
    }).catch(() => {
      addToast("Errore nel caricamento dei dati salvati. Riseleziona la cartella.", "error");
    });
  }, []);

  // ── Persist state on change ──────────────────────────────────────────
  useEffect(() => {
    savePersistedState({
      projectName,
      sourceFolderPath,
      activeAssetIds,
      usesMockData: false,
    });
  }, [projectName, sourceFolderPath, activeAssetIds]);

  // ── Cleanup pipeline on unmount ──────────────────────────────────────
  useEffect(() => {
    return () => {
      folderLoadSessionRef.current += 1;
      if (xmpImportStartTimerRef.current !== null) {
        window.clearTimeout(xmpImportStartTimerRef.current);
      }
      pipelineRef.current?.destroy();
    };
  }, []);

  // ── Undo/redo for classification changes ─────────────────────────────
  const allAssetsRef = useRef(allAssets);
  allAssetsRef.current = allAssets;

  const undoRedo = useUndoRedo<ImageAsset[]>(
    () => allAssetsRef.current,
    (snapshot) => setAllAssets(snapshot),
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
    const total = thumbnailTotalCountRef.current;
    const processed = Math.min(total, settledThumbnailIdsRef.current.size);

    setThumbnailProgress({ done: processed, total });
    setImportProgress((current) =>
      current.isOpen
        ? {
            ...current,
            phase: "preparing",
            total,
            processed,
            currentFile: lastProcessedId
              ? assetNameByIdRef.current.get(lastProcessedId) ?? current.currentFile
              : current.currentFile,
          }
        : current
    );
  }, []);

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

  // ── Thumbnail batch handler (called by pipeline every ~120 ms) ──────
  const handleThumbnailBatch = useCallback((batch: ThumbnailUpdate[]) => {
    setAllAssets((prev) => {
      const lookup = new Map(batch.map((b) => [b.id, b]));
      return prev.map((asset) => {
        const update = lookup.get(asset.id);
        if (!update) return asset;
        return {
          ...asset,
          thumbnailUrl: update.url,
          width: update.width,
          height: update.height,
          orientation: detectOrientation(update.width, update.height),
          aspectRatio: update.width / update.height,
          sourceFileKey: update.sourceFileKey ?? asset.sourceFileKey,
        };
      });
    });

    for (const item of batch) {
      settledThumbnailIdsRef.current.add(item.id);
    }
    syncThumbnailProgress(batch[batch.length - 1]?.id ?? null);

    // Persist thumbnails to IndexedDB cache (fire-and-forget)
    for (const item of batch) {
      fetch(item.url).then((r) => r.blob()).then((blob) => {
        void cacheThumbnail(item.id, blob, item.width, item.height);
      }).catch(() => { /* non-critical */ });
    }
  }, [syncThumbnailProgress]);

  // Error handler for failed thumbnail generations (e.g. RAW files)
  const lastErrorToastRef = useRef(0);
  const handleThumbnailError = useCallback((failedCount: number, failedId: string) => {
    if (failedId) {
      settledThumbnailIdsRef.current.add(failedId);
    }
    syncThumbnailProgress(failedId);

    // Debounce toast — show at most once per 5 seconds
    const now = Date.now();
    if (now - lastErrorToastRef.current < 5000) return;
    lastErrorToastRef.current = now;
    addToast(
      `${failedCount} foto non decodificabil${failedCount === 1 ? "e" : "i"} (formati RAW o non supportati).`,
      "warning",
    );
  }, [addToast, syncThumbnailProgress]);

  function isValidCachedThumbnail(asset: ImageAsset, hit: { width: number; height: number }): boolean {
    if (!isRawFile(asset.fileName)) return true;
    const minDimension = Math.min(hit.width, hit.height);
    // Old cache entries may contain tiny embedded thumbnails (e.g. 160x120).
    // For RAW files we require a minimally useful preview size.
    return minDimension >= 900;
  }

  // ── Open folder (instant grid + streaming thumbnails) ────────────────
  const handleFolderOpened = useCallback(
    ({ name: folderName, entries, rootPath }: FolderOpenResult) => {
      if (entries.length === 0) {
        addToast("Nessuna immagine supportata trovata nella cartella.", "warning");
        return;
      }

      // 1. Destroy previous pipeline
      pipelineRef.current?.destroy();
      folderLoadSessionRef.current += 1;
      const folderLoadSession = folderLoadSessionRef.current;
      thumbnailEntryByIdRef.current = new Map();
      visibleThumbnailIdsRef.current = new Set();
      if (xmpImportStartTimerRef.current !== null) {
        window.clearTimeout(xmpImportStartTimerRef.current);
        xmpImportStartTimerRef.current = null;
      }

      // 2. Clean up previous blob URLs
      revokeImageAssetUrls(allAssets);
      clearImageCache();

      // 3. Create placeholder assets INSTANTLY (no file reading)
      const assets = buildPlaceholderAssets(entries);
      assetNameByIdRef.current = new Map(assets.map((asset) => [asset.id, asset.fileName]));
      const writableAccess = entries.some((entry) => !!entry.fileHandle || !!entry.absolutePath);

      setAllAssets(assets);
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
      addToast(`${entries.length} foto trovate in "${folderName}". Generazione anteprime…`, "info");

      // 4. Import Adobe-compatible XMP sidecars (rating/label/pick) + app selection flag.
      void Promise.all(
        assets.map(async (asset) => {
          const xml = await readSidecarXmp(asset.id);
          if (!xml) return null;
          return { id: asset.id, state: parseXmpState(xml) };
        }),
      ).then((records) => {
        const valid = records.filter((r): r is { id: string; state: ReturnType<typeof parseXmpState> } => r !== null);
        if (valid.length === 0) return;

        const byId = new Map(valid.map((r) => [r.id, r.state]));
        const selectedByXmp = valid
          .filter((r) => r.state.selected === true)
          .map((r) => r.id);

        setAllAssets((prev) =>
          prev.map((asset) => {
            const state = byId.get(asset.id);
            if (!state) return asset;
            const hasEdits = state.hasCameraRawAdjustments || state.hasPhotoshopAdjustments;
            const xmpEditInfo = state.hasCameraRawAdjustments && state.hasPhotoshopAdjustments
              ? "Camera Raw + Photoshop"
              : state.hasCameraRawAdjustments
                ? "Camera Raw"
                : state.hasPhotoshopAdjustments
                  ? "Photoshop"
                  : undefined;
            return {
              ...asset,
              rating: state.rating ?? asset.rating,
              pickStatus: state.pickStatus ?? asset.pickStatus,
              colorLabel: state.colorLabel !== undefined ? state.colorLabel : asset.colorLabel,
              xmpHasEdits: hasEdits,
              xmpEditInfo,
            };
          }),
        );

        if (selectedByXmp.length > 0) {
          setActiveAssetIds(selectedByXmp);
        }

        const editedBySidecar = valid.filter(
          (r) => r.state.hasCameraRawAdjustments || r.state.hasPhotoshopAdjustments,
        ).length;
        if (editedBySidecar > 0) {
          addToast(
            `${editedBySidecar} foto con modifiche XMP (Camera Raw/Photoshop) rilevate.`,
            "info",
          );
        }
      }).catch(() => {
        // Sidecar import is best-effort only.
      });

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
          file: entry.file,
          loadFile: entry.file ? undefined : () => getFileForAsset(id),
          absolutePath: entry.absolutePath,
          sourceFileKey:
            entry.file
              ? buildSourceFileKey(entry.file, entry.relativePath)
              : entry.size !== undefined && entry.lastModified !== undefined
                ? buildSourceFileKeyFromStats(entry.relativePath, entry.size, entry.lastModified)
                : undefined,
          createSourceFileKey: entry.file || !entry.absolutePath
            ? (file: File) => buildSourceFileKey(file, entry.relativePath)
            : undefined,
        });
      }

      thumbnailEntryByIdRef.current = new Map(pipelineEntries.map((entry) => [entry.id, entry]));
      thumbnailTotalCountRef.current = pipelineEntries.length;
      settledThumbnailIdsRef.current = new Set();
      setThumbnailProgress({ done: 0, total: pipelineEntries.length });

      if (pipelineEntries.length === 0) {
        setImportProgress((current) => ({ ...current, isOpen: false, total: 0, processed: 0 }));
        return;
      }

      const allIds = pipelineEntries.map((entry) => entry.id);
      void loadCachedThumbnails(allIds).then((cached) => {
        if (folderLoadSessionRef.current !== folderLoadSession) {
          return;
        }

        const validCachedIds = new Set<string>();

        // Apply cached thumbnails instantly
        if (cached.size > 0) {
          setAllAssets((prev) =>
            prev.map((asset) => {
              const hit = cached.get(asset.id);
              if (!hit) return asset;
              if (!isValidCachedThumbnail(asset, hit)) return asset;
              if (asset.thumbnailUrl) return asset;

              validCachedIds.add(asset.id);
              return {
                ...asset,
                thumbnailUrl: hit.url,
                width: hit.width,
                height: hit.height,
                orientation: detectOrientation(hit.width, hit.height),
                aspectRatio: hit.width / hit.height,
              };
            }),
          );
        }

        for (const assetId of validCachedIds) {
          settledThumbnailIdsRef.current.add(assetId);
        }
        syncThumbnailProgress(Array.from(validCachedIds).at(-1) ?? null);

        const uncached = pipelineEntries.filter((entry) => !validCachedIds.has(entry.id));
        if (uncached.length > 0) {
          const pipeline = new ThumbnailPipeline(handleThumbnailBatch, handleThumbnailError);
          pipelineRef.current = pipeline;
          pipeline.enqueue(uncached.slice(0, THUMBNAIL_BOOTSTRAP_COUNT), 0);
          enqueueVisibleThumbnailEntries(visibleThumbnailIdsRef.current, 0);
        } else {
          setImportProgress((current) => ({ ...current, isOpen: false }));
        }
      }).catch(() => {
        // Cache unavailable — enqueue everything to the pipeline
        setThumbnailProgress({ done: 0, total: pipelineEntries.length });
        setImportProgress((current) => ({
          ...current,
          isOpen: pipelineEntries.length > 0,
          phase: "preparing",
          supported: entries.length,
          ignored: 0,
          total: pipelineEntries.length,
          processed: 0,
        }));
        const pipeline = new ThumbnailPipeline(handleThumbnailBatch, handleThumbnailError);
        pipelineRef.current = pipeline;
        pipeline.enqueue(pipelineEntries.slice(0, THUMBNAIL_BOOTSTRAP_COUNT), 0);
        enqueueVisibleThumbnailEntries(visibleThumbnailIdsRef.current, 0);
      });
    },
    [
      addToast,
      allAssets,
      enqueueVisibleThumbnailEntries,
      handleThumbnailBatch,
      handleThumbnailError,
      syncThumbnailProgress,
      undoRedo,
    ]
  );

  // ── Load mock data ───────────────────────────────────────────────────

  // ── Photo metadata changes (with undo history) ───────────────────────
  const handlePhotosChange = useCallback((photos: ImageAsset[]) => {
    const previousAssets = allAssetsRef.current;
    const changedIds: string[] = [];

    for (let index = 0; index < photos.length; index += 1) {
      if (photos[index] !== previousAssets[index]) {
        changedIds.push(photos[index].id);
      }
    }

    undoRedo.push(allAssetsRef.current);
    startTransition(() => {
      setAllAssets(photos);
    });
    queueXmpSync(changedIds);
  }, [queueXmpSync, undoRedo]);

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

  const handleSelectorApply = useCallback(
    (nextIds: string[], nextAssets: ImageAsset[]) => {
      const previousAssets = allAssetsRef.current;
      const changedIds = new Set<string>();

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
      setActiveAssetIds(nextIds);
      setIsProjectSelectorOpen(false);
      queueXmpSync(Array.from(changedIds));
      addToast(`Selezione aggiornata: ${nextIds.length} foto attive.`, "success");
    },
    [addToast, queueXmpSync]
  );

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
    visibleThumbnailIdsRef.current = ids;
    enqueueVisibleThumbnailEntries(ids, 0);
    pipelineRef.current?.updateViewport(ids);
  }, [enqueueVisibleThumbnailEntries]);

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
      const idsToSync = Array.from(pendingXmpSyncIdsRef.current);
      pendingXmpSyncIdsRef.current.clear();
      const assetMap = new Map(allAssetsRef.current.map((asset) => [asset.id, asset]));
      const activeSet = new Set(activeAssetIdsRef.current);
      setXmpSyncState((current) => ({
        phase: "syncing",
        pending: idsToSync.length,
        failed: 0,
        lastSyncedAt: current.lastSyncedAt,
      }));

      void Promise.all(
        idsToSync.map(async (assetId) => {
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
        }),
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
          return;
        }

        setXmpSyncState({
          phase: "saved",
          pending: 0,
          failed: 0,
          lastSyncedAt: Date.now(),
        });
      });
      xmpSyncTimerRef.current = null;
    }, 700);

    return () => {
      if (xmpSyncTimerRef.current !== null) {
        window.clearTimeout(xmpSyncTimerRef.current);
      }
    };
  }, [addToast, allAssets.length, hasWritableFolderAccess, usesMockData, xmpSyncVersion]);

  // ── Computed values ──────────────────────────────────────────────────
  const emptyUsageMap = useMemo(() => new Map(), []);

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
          <div className="app-header__brand">
            <h1 className="app-header__title">Selezione Foto</h1>
            <span className="app-header__subtitle">Photo Tools Suite</span>
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
                disabled={activeAssetIds.length === 0}
            >
              Riepilogo
            </button>
          </nav>
          <div className="app-header__actions">
            {isGeneratingThumbnails ? (
              <div className="app-header__pipeline-status">
                <div className="pipeline-progress">
                  <div
                    className="pipeline-progress__fill"
                    style={{ width: `${Math.round((thumbnailProgress.done / Math.max(1, thumbnailProgress.total)) * 100)}%` }}
                  />
                </div>
                <span className="pipeline-progress__label">
                  {thumbnailProgress.done}/{thumbnailProgress.total}
                </span>
              </div>
            ) : null}
            {allAssets.length > 0 ? (
              <button
                type="button"
                className="ghost-button"
                onClick={() => setCurrentScreen("browse")}
              >
                Apri cartella
              </button>
            ) : null}
            {allAssets.length > 0 ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setIsProjectSelectorOpen(true)}
              >
                Selezione progetto
              </button>
            ) : null}
            {!usesMockData && allAssets.length > 0 ? (
              <div className={`app-header__sync-status app-header__sync-status--${xmpSyncState.phase}`}>
                {xmpSyncLabel}
              </div>
            ) : null}
            {allAssets.length > 0 ? (
              <div className="app-header__folder-pill">
                {sourceFolderPath || "Cartella attiva"}
              </div>
            ) : null}
            <label className="field app-header__project-name">
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Nome progetto"
              />
            </label>
          </div>
        </header>

        <main className="app-main">
          {shouldShowXmpBanner ? (
            <DismissibleBanner
              title="Sincronizzazione XMP non attiva"
              message={hasNativeFolderAccess()
                ? "La sessione e' stata riaperta senza il collegamento scrivibile alla cartella. Rating, pick e colori non verranno scritti nei sidecar finché non riapri la cartella."
                : desktopRuntime
                  ? `La shell desktop FileX e' attiva per ${desktopRuntime.toolName}, ma in questa prima integrazione il flusso cartella/XMP usa ancora il bridge browser. Il collegamento nativo e' il prossimo step.`
                  : "Questo browser usa l'import fallback e non puo' scrivere i sidecar XMP. Per un workflow automatico stile Bridge/Photo Mechanic riapri il tool in Edge o Chrome."}
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
          {currentScreen === "browse" ? (
            <div className="app-section">
              <FolderBrowser
                onFolderOpened={handleFolderOpened}
              />
            </div>
          ) : null}

          {currentScreen === "selection" ? (
            <div className="app-section app-section--full">
              <PhotoSelector
                photos={allAssets}
                selectedIds={activeAssetIds}
                onSelectionChange={handleSelectionChange}
                onPhotosChange={handlePhotosChange}
                onVisibleIdsChange={handleVisibleIdsChange}
                onUndo={undoRedo.undo}
                onRedo={undoRedo.redo}
                canUndo={undoRedo.canUndo}
                canRedo={undoRedo.canRedo}
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
                onOpenProjectSelector={() => setIsProjectSelectorOpen(true)}
              />
            </div>
          ) : null}
        </main>

        {/* Project Photo Selector Modal — full-screen cataloging */}
        {isProjectSelectorOpen ? (
          <ProjectPhotoSelectorModal
            assets={allAssets}
            activeAssetIds={activeAssetIds}
            usageByAssetId={emptyUsageMap}
            onClose={() => setIsProjectSelectorOpen(false)}
            onApply={handleSelectorApply}
          />
        ) : null}
        <ImportProgressModal
          isOpen={currentScreen === "browse" && importProgress.isOpen}
          phase={importProgress.phase}
          supported={importProgress.supported}
          ignored={importProgress.ignored}
          total={importProgress.total}
          processed={importProgress.processed}
          currentFile={importProgress.currentFile}
          folderLabel={importProgress.folderLabel}
        />
      </div>
    </ErrorBoundary>
  );
}
