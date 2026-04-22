import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  DesktopCacheLocationRecommendation,
  DesktopDragOutCheck,
  DesktopEditorCandidate,
  DesktopRamBudgetPreset,
  DesktopThumbnailCacheInfo,
} from "@photo-tools/desktop-contracts";
import type { ColorLabel, ImageAsset, PickStatus } from "@photo-tools/shared-types";
import { PhotoClassificationHelpButton } from "./PhotoClassificationHelpButton";
import { PhotoQuickPreviewModal } from "./PhotoQuickPreviewModal";
import { PhotoSearchBar } from "./PhotoSearchBar";
import { PhotoCard } from "./PhotoCard";
import { PhotoSelectionContextMenu } from "./PhotoSelectionContextMenu";
import { CompareModal } from "./CompareModal";
import {
  createOnDemandPreviewAsync,
  getCachedOnDemandPreviewUrl,
  getSubfolder,
  extractSubfolders,
  copyAssetsToFolder,
  moveAssetsToFolder,
  saveAssetAs,
  getAssetRelativePath,
  getAssetAbsolutePath,
  getAssetAbsolutePaths,
  detectChangedAssetsOnDisk,
  warmOnDemandPreviewCache,
} from "../services/folder-access";
import {
  COLOR_LABEL_NAMES,
  COLOR_LABELS,
  DEFAULT_PHOTO_FILTERS,
  getAssetColorLabel,
  getAssetPickStatus,
  getAssetRating,
  matchesPhotoFilters,
  resolvePhotoClassificationShortcut,
} from "../services/photo-classification";
import {
  CUSTOM_LABEL_SHORTCUT_OPTIONS,
  DEFAULT_CUSTOM_LABEL_TONE,
  normalizeCustomLabelColors,
  hydratePhotoSelectorPreferences,
  normalizeCustomLabelName,
  normalizeCustomLabelsCatalog,
  normalizeCustomLabelShortcut,
  normalizeCustomLabelShortcuts,
  savePhotoSelectorPreferences,
  type CustomLabelShortcut,
  type CustomLabelTone,
  type PhotoFilterPreset,
  type ThumbnailProfile,
} from "../services/photo-selector-preferences";
import {
  buildPhotoSortSignature,
  loadCachedPhotoSortOrder,
  hydratePhotoSortCache,
  saveCachedPhotoSortOrder,
} from "../services/photo-sort-cache";
import { logDesktopEvent } from "../services/desktop-store";
import { useToast } from "./ToastProvider";

interface PhotoSelectorProps {
  photos: ImageAsset[];
  metadataVersion: number;
  sourceFolderPath?: string;
  selectedIds: string[];
  onSelectionChange: (selectedIds: string[]) => void;
  onPhotosChange?: (photos: ImageAsset[]) => void;
  onVisibleIdsChange?: (visibleIds: Set<string>) => void;
  onPriorityIdsChange?: (priorityIds: Set<string>) => void;
  onPreviewPriorityIdsChange?: (priorityIds: Set<string>) => void;
  onBackgroundPreviewOrderChange?: (orderedIds: string[]) => void;
  onScrollLiteActiveMsChange?: (activeMs: number) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  isThumbnailLoading?: boolean;
  thumbnailProfile?: ThumbnailProfile;
  sortCacheEnabled?: boolean;
  performanceSnapshot?: {
    folderOpenToFirstThumbnailMs: number | null;
    folderOpenToGridCompleteMs: number | null;
    cachedThumbnailCount: number;
    totalThumbnailCount: number;
    bytesRead: number;
    rawBytesRead: number;
    standardBytesRead: number;
    thumbnailProfile: ThumbnailProfile;
    sortCacheEnabled: boolean;
  } | null;
  onThumbnailProfileChange?: (profile: ThumbnailProfile) => void;
  onSortCacheEnabledChange?: (enabled: boolean) => void;
  desktopThumbnailCacheInfo?: DesktopThumbnailCacheInfo | null;
  desktopCacheLocationRecommendation?: DesktopCacheLocationRecommendation | null;
  isDesktopThumbnailCacheBusy?: boolean;
  isDesktopCacheRecommendationModalOpen?: boolean;
  onChooseDesktopThumbnailCacheDirectory?: () => void | Promise<void>;
  onSetDesktopThumbnailCacheDirectory?: (directoryPath: string) => void | Promise<void>;
  onUseRecommendedDesktopThumbnailCacheDirectory?: () => void | Promise<void>;
  onResetDesktopThumbnailCacheDirectory?: () => void | Promise<void>;
  onClearDesktopThumbnailCache?: () => void | Promise<void>;
  onSnoozeDesktopCacheRecommendation?: () => void | Promise<void>;
  onDismissDesktopCacheRecommendation?: () => void | Promise<void>;
  onRamBudgetPresetChange?: (preset: DesktopRamBudgetPreset) => void | Promise<void>;
  onRelaunch?: () => void;
}

type SortMode = "name" | "orientation" | "rating" | "createdAt";
type CreatedAtSortDirection = "asc" | "desc";
type PickFilter = "all" | PickStatus;
type ColorFilter = "all" | ColorLabel;
type PhotoMetadataChanges = Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel" | "customLabels">>;
type BatchPulseKind = "dot" | "label";
const CUSTOM_LABEL_TONES: CustomLabelTone[] = ["sand", "rose", "green", "blue", "purple", "slate"];

const GRID_GAP_PX = 12;
const CARD_STAGE_HEIGHT_RATIO = 0.75;
const QUICK_PREVIEW_FIT_MAX_DIMENSION = 2048;
const CARD_CHROME_HEIGHT_PX = 64;
const VIRTUAL_OVERSCAN_ROWS_IDLE = 4;
const VIRTUAL_OVERSCAN_ROWS_FAST = 10;
const PRIORITY_PREFETCH_ROWS_BEFORE_IDLE = 2;
const PRIORITY_PREFETCH_ROWS_AFTER_IDLE = 6;
const PRIORITY_PREFETCH_ROWS_BEFORE_FAST = 2;
const PRIORITY_PREFETCH_ROWS_AFTER_FAST = 14;
const PRIORITY_PREFETCH_MAX_IDS = 360;
const FAST_SCROLL_COOLDOWN_MS = 120;
const ROOT_FOLDER_OVERRIDE_KEY = "ps-root-folder-path-override";
const LEGACY_ROOT_FOLDER_KEY = "ps-root-folder-path";
const KNOWN_EDITOR_PRESET_PATHS = [
  "C:\\Program Files\\Adobe\\Adobe Photoshop 2026\\Photoshop.exe",
  "C:\\Program Files\\Adobe\\Adobe Photoshop 2025\\Photoshop.exe",
  "C:\\Program Files\\Adobe\\Adobe Photoshop 2024\\Photoshop.exe",
  "C:\\Program Files\\Adobe\\Adobe Photoshop 2023\\Photoshop.exe",
];

function sanitizeEditorExecutablePath(value: string): string {
  const normalized = value.trim().replace(/^"+|"+$/g, "");
  // Windows local (C:\...) o UNC (\\server\share\...) → normalizza i separatori.
  if (/^[a-zA-Z]:/.test(normalized) || /^\\\\/.test(normalized)) {
    return normalized.replace(/\//g, "\\");
  }
  return normalized;
}

function isValidDesktopEditorPath(value: string): boolean {
  const normalized = sanitizeEditorExecutablePath(value);
  if (!normalized) {
    return false;
  }

  if (/^[a-zA-Z]:\\/.test(normalized)) {
    return /\.(exe|bat|cmd)$/i.test(normalized);
  }

  // UNC: \\server\share\...\file.exe
  if (/^\\\\[^\\]+\\[^\\]+\\/.test(normalized)) {
    return /\.(exe|bat|cmd)$/i.test(normalized);
  }

  if (normalized.startsWith("/")) {
    return /\.app$/i.test(normalized) || /\/[^/]+$/.test(normalized);
  }

  return false;
}

function normalizeAssetCustomLabels(values: string[] | undefined): string[] {
  return normalizeCustomLabelsCatalog(values);
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

function areOrderedIdsEqual(left: string[], right: string[]): boolean {
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

function resolvePhotoCreatedAt(photo: ImageAsset): number {
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

function describeMetadataChanges(
  changes: PhotoMetadataChanges,
  targetCount: number
): string {
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

function getSeriesKey(photo: ImageAsset): string {
  const stem = photo.fileName.replace(/\.[^.]+$/, "");
  const normalized = stem.replace(/[_\-\s]*\d+$/, "").trim();
  return normalized || stem;
}

function getTimeClusterKey(photo: ImageAsset): string {
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

function formatBytes(totalBytes: number): string {
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

function formatMilliseconds(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "n/d";
  }

  return `${value} ms`;
}

function formatVolumeSummary(
  recommendation: DesktopCacheLocationRecommendation | null,
): { current: string; recommended: string | null } {
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

const RAM_PRESET_OPTIONS = [
  { preset: "conservative" as DesktopRamBudgetPreset, label: "Conservativo", fraction: 0.06 },
  { preset: "default" as DesktopRamBudgetPreset, label: "Default", fraction: 0.12 },
  { preset: "performance" as DesktopRamBudgetPreset, label: "Performance", fraction: 0.20 },
  { preset: "maximum" as DesktopRamBudgetPreset, label: "Massimo", fraction: 0.28 },
] as const;

function RamBudgetSection({
  systemTotalMemoryBytes,
  activePreset,
  activeRamBudgetBytes,
  onPresetChange,
  onRelaunch,
}: {
  systemTotalMemoryBytes: number;
  activePreset: DesktopRamBudgetPreset | null;
  activeRamBudgetBytes: number | null;
  onPresetChange: (preset: DesktopRamBudgetPreset) => void | Promise<void>;
  onRelaunch?: () => void;
}) {
  const [pendingPreset, setPendingPreset] = useState<DesktopRamBudgetPreset | null>(null);
  const [applying, setApplying] = useState(false);

  const displayPreset = pendingPreset ?? activePreset;
  const hasPendingChange = pendingPreset !== null && pendingPreset !== activePreset;

  async function handleApply() {
    if (!pendingPreset || applying) return;
    setApplying(true);
    await onPresetChange(pendingPreset);
    setPendingPreset(null);
    setApplying(false);
    onRelaunch?.();
  }

  return (
    <>
      <label className="photo-selector__settings-color-row" style={{ alignItems: "center", marginTop: "0.6rem" }}>
        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", minWidth: 90 }}>Budget RAM</span>
      </label>
      <div className="photo-selector__settings-preset-row" style={{ flexWrap: "wrap", gap: "0.3rem" }}>
        {RAM_PRESET_OPTIONS.map(({ preset, label, fraction }) => {
          const gb = ((systemTotalMemoryBytes * fraction) / (1024 ** 3)).toFixed(1);
          const isSelected = displayPreset === preset;
          const isActive = activePreset === preset;
          return (
            <button
              key={preset}
              type="button"
              className={`ghost-button ghost-button--small${isSelected ? " ghost-button--active" : ""}`}
              onClick={() => setPendingPreset(preset)}
              title={`${label}: ${gb} GB (${Math.round(fraction * 100)}% RAM)${isActive ? " — preset corrente" : ""}`}
              style={isActive && !isSelected ? { opacity: 0.55 } : undefined}
            >
              {label} ({gb} GB)
            </button>
          );
        })}
      </div>
      {hasPendingChange ? (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.35rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className="secondary-button"
            style={{ fontSize: "0.8rem", padding: "0.4rem 0.8rem" }}
            onClick={() => void handleApply()}
            disabled={applying}
          >
            {applying ? "Salvo…" : "Applica e riavvia"}
          </button>
          <button
            type="button"
            className="ghost-button ghost-button--small"
            onClick={() => setPendingPreset(null)}
            disabled={applying}
          >
            Annulla
          </button>
        </div>
      ) : (
        <p className="photo-selector__settings-empty" style={{ marginTop: "0.3rem" }}>
          {activePreset
            ? `Preset attivo: ${activePreset} · ${((activeRamBudgetBytes ?? 0) / (1024 ** 3)).toFixed(1)} GB`
            : "Seleziona un preset per configurare il budget RAM della cache."}
        </p>
      )}
    </>
  );
}

export function PhotoSelector({
  photos,
  metadataVersion,
  sourceFolderPath = "",
  selectedIds,
  onSelectionChange,
  onPhotosChange,
  onVisibleIdsChange,
  onPriorityIdsChange,
  onPreviewPriorityIdsChange,
  onBackgroundPreviewOrderChange,
  onScrollLiteActiveMsChange,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  isThumbnailLoading = false,
  thumbnailProfile = "ultra-fast",
  sortCacheEnabled = true,
  performanceSnapshot = null,
  onThumbnailProfileChange,
  onSortCacheEnabledChange,
  desktopThumbnailCacheInfo = null,
  desktopCacheLocationRecommendation = null,
  isDesktopThumbnailCacheBusy = false,
  isDesktopCacheRecommendationModalOpen = false,
  onChooseDesktopThumbnailCacheDirectory,
  onSetDesktopThumbnailCacheDirectory,
  onUseRecommendedDesktopThumbnailCacheDirectory,
  onResetDesktopThumbnailCacheDirectory,
  onClearDesktopThumbnailCache,
  onSnoozeDesktopCacheRecommendation,
  onDismissDesktopCacheRecommendation,
  onRamBudgetPresetChange,
  onRelaunch,
}: PhotoSelectorProps) {
  const { addToast } = useToast();
  const [sortBy, setSortBy] = useState<SortMode>("name");
  const [createdAtSortDirection, setCreatedAtSortDirection] = useState<CreatedAtSortDirection>("desc");
  const [pickFilter, setPickFilter] = useState<PickFilter>(DEFAULT_PHOTO_FILTERS.pickStatus);
  const [ratingFilter, setRatingFilter] = useState(DEFAULT_PHOTO_FILTERS.ratingFilter);
  const [colorFilter, setColorFilter] = useState<ColorFilter>(DEFAULT_PHOTO_FILTERS.colorLabel);
  const [customLabelFilter, setCustomLabelFilter] = useState<string>("all");
  const [folderFilter, setFolderFilter] = useState<string>("all");
  const [seriesFilter, setSeriesFilter] = useState<string>("all");
  const [timeClusterFilter, setTimeClusterFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [customColorNames, setCustomColorNames] = useState<Record<ColorLabel, string>>(() => ({ ...COLOR_LABEL_NAMES }));
  const [customLabelsCatalog, setCustomLabelsCatalog] = useState<string[]>([]);
  const [customLabelColors, setCustomLabelColors] = useState<Record<string, CustomLabelTone>>({});
  const [customLabelShortcuts, setCustomLabelShortcuts] = useState<Record<string, CustomLabelShortcut | null>>({});
  const [filterPresets, setFilterPresets] = useState<PhotoFilterPreset[]>([]);
  const [selectedThumbnailProfile, setSelectedThumbnailProfile] = useState<ThumbnailProfile>(thumbnailProfile);
  const [isSortCacheEnabled, setIsSortCacheEnabled] = useState<boolean>(sortCacheEnabled);
  const [newPresetName, setNewPresetName] = useState("");
  const [newCustomLabelName, setNewCustomLabelName] = useState("");
  const [newCustomLabelTone, setNewCustomLabelTone] = useState<CustomLabelTone>(DEFAULT_CUSTOM_LABEL_TONE);
  const [newCustomLabelShortcut, setNewCustomLabelShortcut] = useState<CustomLabelShortcut | null>(null);
  const [newBatchCustomLabelName, setNewBatchCustomLabelName] = useState("");
  const [newBatchCustomLabelTone, setNewBatchCustomLabelTone] = useState<CustomLabelTone>(DEFAULT_CUSTOM_LABEL_TONE);
  const [newBatchCustomLabelShortcut, setNewBatchCustomLabelShortcut] = useState<CustomLabelShortcut | null>(null);
  const [timelineEntries, setTimelineEntries] = useState<Array<{ id: string; label: string }>>([]);
  const [isBatchToolsOpen, setIsBatchToolsOpen] = useState(false);
  const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [cardSize, setCardSize] = useState<number>(160);
  const [rootFolderPathOverride, setRootFolderPathOverride] = useState<string>("");
  const [preferredEditorPath, setPreferredEditorPath] = useState<string>("");
  const [preferencesHydrated, setPreferencesHydrated] = useState(false);
  const [sortCacheHydrationToken, setSortCacheHydrationToken] = useState(0);
  const [desktopDragOutCheck, setDesktopDragOutCheck] = useState<DesktopDragOutCheck | null>(null);
  const [installedEditorCandidates, setInstalledEditorCandidates] = useState<DesktopEditorCandidate[]>([]);
  const [desktopThumbnailCachePathInput, setDesktopThumbnailCachePathInput] = useState("");

  const setPreferredEditorPathPersisted = useCallback((value: string) => {
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
  const setRootFolderPathOverridePersisted = useCallback((value: string) => {
    setRootFolderPathOverride(value);
    if (preferencesHydrated) {
      savePhotoSelectorPreferences({
        rootFolderPathOverride: value.trim() ? value : "",
      });
    }
  }, [preferencesHydrated]);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const [contextMenuState, setContextMenuState] = useState<{
    x: number;
    y: number;
    targetIds: string[];
  } | null>(null);
  const [focusedPhotoId, setFocusedPhotoId] = useState<string | null>(null);
  const [previewStartsZoomed, setPreviewStartsZoomed] = useState(false);
  const lastPreviewAssetIdRef = useRef<string | null>(null);
  const pendingPreviewRestoreIdRef = useRef<string | null>(null);
  const lastClickedIdRef = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const fastScrollCooldownTimerRef = useRef<number | null>(null);
  const fastScrollStartedAtRef = useRef<number | null>(null);
  const accumulatedFastScrollMsRef = useRef(0);
  const lastVisibleIdsRef = useRef<string[]>([]);
  const pendingVisibleIdsRef = useRef<string[] | null>(null);
  const visibleIdsDispatchRafRef = useRef<number | null>(null);
  const lastBackgroundPreviewOrderSignatureRef = useRef<string>("");
  const frozenDynamicSortOrderRef = useRef<{ sortBy: SortMode; signature: string; ids: string[] } | null>(null);
  const batchPulseTokenRef = useRef(0);
  const batchPulseClearTimerRef = useRef<number | null>(null);
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);
  const [dragRect, setDragRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [gridViewport, setGridViewport] = useState({ width: 0, height: 720 });
  const [isFastScrollActive, setIsFastScrollActive] = useState(false);
  const [batchPulseState, setBatchPulseState] = useState<{
    token: number;
    kind: BatchPulseKind;
    ids: Set<string>;
  } | null>(null);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const effectiveRootFolderPath = useMemo(
    () => rootFolderPathOverride.trim() || sourceFolderPath.trim(),
    [rootFolderPathOverride, sourceFolderPath],
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const metadataPhotos = useMemo(() => photos, [metadataVersion, photos.length]);
  const metadataAssetById = useMemo(
    () => new Map(metadataPhotos.map((photo) => [photo.id, photo])),
    [metadataPhotos],
  );
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

  const activeFilterCount = useMemo(
    () =>
      [
        pickFilter !== "all",
        ratingFilter !== "any",
        colorFilter !== "all",
        customLabelFilter !== "all",
        folderFilter !== "all",
        seriesFilter !== "all",
        timeClusterFilter !== "all",
        searchQuery !== "",
      ].filter(Boolean).length,
    [pickFilter, ratingFilter, colorFilter, customLabelFilter, folderFilter, seriesFilter, timeClusterFilter, searchQuery]
  );

  const selectionStats = useMemo(() => {
    if (selectedIds.length === 0) return null;
    const sel = selectedIds
      .map((photoId) => metadataAssetById.get(photoId))
      .filter((photo): photo is ImageAsset => !!photo);
    return {
      picked: sel.filter((p) => getAssetPickStatus(p) === "picked").length,
      rejected: sel.filter((p) => getAssetPickStatus(p) === "rejected").length,
      highRating: sel.filter((p) => getAssetRating(p) >= 3).length,
    };
  }, [metadataAssetById, selectedIds]);

  const hasActiveFilters =
    pickFilter !== "all" ||
    ratingFilter !== "any" ||
    colorFilter !== "all" ||
    customLabelFilter !== "all" ||
    folderFilter !== "all" ||
    seriesFilter !== "all" ||
    timeClusterFilter !== "all" ||
    searchQuery !== "";

  const customLabelByShortcut = useMemo(() => {
    const entries = Object.entries(customLabelShortcuts)
      .filter((entry): entry is [string, CustomLabelShortcut] => Boolean(entry[1]));
    return new Map(entries.map(([label, shortcut]) => [shortcut, label]));
  }, [customLabelShortcuts]);

  const pushTimelineEntry = useCallback((label: string) => {
    setTimelineEntries((current) => [
      { id: `timeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, label },
      ...current,
    ].slice(0, 5));
  }, []);

  const triggerBatchPulse = useCallback((targetIds: string[], kind: BatchPulseKind) => {
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
      setBatchPulseState((current) => (
        current?.token === token ? null : current
      ));
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

  const applyPhotoChanges = useCallback((
    id: string,
    changes: PhotoMetadataChanges
  ) => {
    if (!onPhotosChange) return;

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

      if (
        nextRating === photo.rating &&
        nextPickStatus === photo.pickStatus &&
        nextColorLabel === photo.colorLabel &&
        areStringArraysEqual(nextCustomLabels, normalizeAssetCustomLabels(photo.customLabels))
      ) {
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

  const persistPreferences = useCallback((
    nextColorNames: Record<ColorLabel, string>,
    nextFilterPresets: PhotoFilterPreset[],
    nextCustomLabelsCatalog: string[],
    nextCustomLabelColors: Record<string, CustomLabelTone>,
    nextCustomLabelShortcuts: Record<string, CustomLabelShortcut | null>,
    nextThumbnailProfile = selectedThumbnailProfile,
    nextSortCacheEnabled = isSortCacheEnabled,
  ) => {
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

  const handleColorNameChange = useCallback((label: ColorLabel, value: string) => {
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

    const nextPreset: PhotoFilterPreset = {
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

  const applyPreset = useCallback((preset: PhotoFilterPreset) => {
    setPickFilter(preset.filters.pickStatus);
    setRatingFilter(preset.filters.ratingFilter);
    setColorFilter(preset.filters.colorLabel);
    setCustomLabelFilter(preset.filters.customLabelFilter ?? "all");
    setFolderFilter(preset.filters.folderFilter ?? "all");
    setSeriesFilter(preset.filters.seriesFilter ?? "all");
    setTimeClusterFilter(preset.filters.timeClusterFilter ?? "all");
    setSearchQuery(preset.filters.searchQuery ?? "");
  }, []);

  const removePreset = useCallback((presetId: string) => {
    setFilterPresets((current) => {
      const next = current.filter((preset) => preset.id !== presetId);
      persistPreferences(customColorNames, next, customLabelsCatalog, customLabelColors, customLabelShortcuts);
      return next;
    });
  }, [customColorNames, customLabelsCatalog, persistPreferences]);

  const persistCustomLabelsCatalog = useCallback((nextCatalog: string[]) => {
    const normalized = normalizeCustomLabelsCatalog(nextCatalog);
    setCustomLabelsCatalog(normalized);
    const nextShortcuts = normalizeCustomLabelShortcuts(normalized, customLabelShortcuts);
    setCustomLabelShortcuts(nextShortcuts);
    persistPreferences(
      customColorNames,
      filterPresets,
      normalized,
      normalizeCustomLabelColors(normalized, customLabelColors),
      nextShortcuts,
    );
    return normalized;
  }, [customColorNames, customLabelColors, customLabelShortcuts, filterPresets, persistPreferences]);

  const resolveCustomLabelTone = useCallback((label: string): CustomLabelTone => {
    const match = Object.entries(customLabelColors).find(
      ([key]) => key.toLocaleLowerCase() === label.toLocaleLowerCase(),
    );
    return match?.[1] ?? DEFAULT_CUSTOM_LABEL_TONE;
  }, [customLabelColors]);

  const resolveCustomLabelShortcut = useCallback((label: string): CustomLabelShortcut | null => {
    const match = Object.entries(customLabelShortcuts).find(
      ([key]) => key.toLocaleLowerCase() === label.toLocaleLowerCase(),
    );
    return match?.[1] ?? null;
  }, [customLabelShortcuts]);

  const handleCustomLabelToneChange = useCallback((label: string, tone: CustomLabelTone) => {
    setCustomLabelColors((current) => {
      const next = normalizeCustomLabelColors(customLabelsCatalog, {
        ...current,
        [label]: tone,
      });
      persistPreferences(customColorNames, filterPresets, customLabelsCatalog, next, customLabelShortcuts);
      return next;
    });
  }, [customColorNames, customLabelShortcuts, customLabelsCatalog, filterPresets, persistPreferences]);

  const handleCustomLabelShortcutChange = useCallback((label: string, shortcut: CustomLabelShortcut | null) => {
    setCustomLabelShortcuts((current) => {
      const nextEntries = Object.fromEntries(
        Object.entries(current).map(([currentLabel, currentShortcut]) => {
          if (currentLabel !== label && currentShortcut === shortcut && shortcut !== null) {
            return [currentLabel, null];
          }
          return [currentLabel, currentShortcut];
        }),
      ) as Record<string, CustomLabelShortcut | null>;

      const next = normalizeCustomLabelShortcuts(customLabelsCatalog, {
        ...nextEntries,
        [label]: shortcut,
      });
      persistPreferences(customColorNames, filterPresets, customLabelsCatalog, customLabelColors, next);
      return next;
    });
  }, [customColorNames, customLabelColors, customLabelsCatalog, filterPresets, persistPreferences]);

  const findCatalogCustomLabel = useCallback((label: string): string | null => {
    const match = customLabelsCatalog.find(
      (existingLabel) => existingLabel.toLocaleLowerCase() === label.toLocaleLowerCase(),
    );
    return match ?? null;
  }, [customLabelsCatalog]);

  const handleThumbnailProfileChange = useCallback((nextProfile: ThumbnailProfile) => {
    setSelectedThumbnailProfile(nextProfile);
    savePhotoSelectorPreferences({
      thumbnailProfile: nextProfile,
    });
    onThumbnailProfileChange?.(nextProfile);
    pushTimelineEntry(
      nextProfile === "ultra-fast"
        ? "Profilo anteprime: Ultra Fast"
        : nextProfile === "fast"
          ? "Profilo anteprime: Fast contact sheet"
          : "Profilo anteprime: Bilanciato",
    );
  }, [onThumbnailProfileChange, pushTimelineEntry]);

  const handleSortCacheEnabledChange = useCallback((nextEnabled: boolean) => {
    setIsSortCacheEnabled(nextEnabled);
    savePhotoSelectorPreferences({
      sortCacheEnabled: nextEnabled,
    });
    onSortCacheEnabledChange?.(nextEnabled);
    pushTimelineEntry(nextEnabled ? "Sort cache attivata" : "Sort cache disattivata");
  }, [onSortCacheEnabledChange, pushTimelineEntry]);

  const updateCustomLabelsForIds = useCallback((
    targetIds: string[],
    updater: (currentLabels: string[], photo: ImageAsset) => string[],
    timelineLabel: string,
  ) => {
    if (!onPhotosChange || targetIds.length === 0) {
      return;
    }

    const idSet = new Set(targetIds);
    let changed = false;
    const changedIds: string[] = [];
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

  const assignCustomLabelToSelection = useCallback((label: string) => {
    if (selectedIds.length === 0) {
      return;
    }

    updateCustomLabelsForIds(
      selectedIds,
      (currentLabels) => (
        currentLabels.some((currentLabel) => currentLabel.toLocaleLowerCase() === label.toLocaleLowerCase())
          ? currentLabels
          : [...currentLabels, label]
      ),
      `${selectedIds.length === 1 ? "1 foto" : `${selectedIds.length} foto`}: aggiunta etichetta ${label}`,
    );
  }, [selectedIds, updateCustomLabelsForIds]);

  const toggleCustomLabelForIds = useCallback((targetIds: string[], label: string) => {
    if (targetIds.length === 0) {
      return;
    }

    const allHaveLabel = targetIds.every((id) => {
      const asset = assetById.get(id);
      return normalizeAssetCustomLabels(asset?.customLabels).some(
        (currentLabel) => currentLabel.toLocaleLowerCase() === label.toLocaleLowerCase(),
      );
    });

    updateCustomLabelsForIds(
      targetIds,
      (currentLabels) => allHaveLabel
        ? currentLabels.filter((currentLabel) => currentLabel.toLocaleLowerCase() !== label.toLocaleLowerCase())
        : [...currentLabels, label],
      allHaveLabel
        ? `${targetIds.length === 1 ? "1 foto" : `${targetIds.length} foto`}: rimossa etichetta ${label}`
        : `${targetIds.length === 1 ? "1 foto" : `${targetIds.length} foto`}: aggiunta etichetta ${label}`,
    );
  }, [assetById, updateCustomLabelsForIds]);

  const handleAddCustomLabelToCatalog = useCallback((
    rawLabel: string,
    options?: {
      assignToSelection?: boolean;
      tone?: CustomLabelTone;
      shortcut?: CustomLabelShortcut | null;
    },
  ) => {
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
    } else {
      setCustomLabelColors((current) => {
        const nextColors = normalizeCustomLabelColors(
          nextCatalog,
          {
            ...current,
            [canonicalLabel]: current[canonicalLabel] ?? requestedTone,
          },
        );
        return nextColors;
      });

      setCustomLabelShortcuts((current) => {
        const next = normalizeCustomLabelShortcuts(nextCatalog, {
          ...Object.fromEntries(
            Object.entries(current).map(([label, currentShortcut]) => {
              if (label !== canonicalLabel && currentShortcut === requestedShortcut && requestedShortcut !== null) {
                return [label, null];
              }
              return [label, currentShortcut];
            }),
          ),
          [canonicalLabel]: requestedShortcut,
        });
        persistPreferences(
          customColorNames,
          filterPresets,
          nextCatalog,
          normalizeCustomLabelColors(nextCatalog, {
            ...customLabelColors,
            [canonicalLabel]: requestedTone,
          }),
          next,
        );
        return next;
      });
    }

    if (assignToSelection && selectedIds.length > 0) {
      assignCustomLabelToSelection(canonicalLabel);
    } else if (!existingLabel) {
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

  const handleRenameCustomLabel = useCallback((previousLabel: string, nextRawLabel: string) => {
    const nextLabel = normalizeCustomLabelName(nextRawLabel);
    if (!nextLabel || nextLabel === previousLabel) {
      return;
    }

    const nextCatalog = customLabelsCatalog.map((label) => (label === previousLabel ? nextLabel : label));
    persistCustomLabelsCatalog(nextCatalog);
    setCustomLabelColors((current) => {
      const previousTone = resolveCustomLabelTone(previousLabel);
      const withoutPrevious = Object.fromEntries(
        Object.entries(current).filter(([label]) => label !== previousLabel),
      ) as Record<string, CustomLabelTone>;
      const nextColors = normalizeCustomLabelColors(nextCatalog, {
        ...withoutPrevious,
        [nextLabel]: previousTone,
      });
      persistPreferences(
        customColorNames,
        filterPresets,
        nextCatalog,
        nextColors,
        normalizeCustomLabelShortcuts(nextCatalog, {
          ...customLabelShortcuts,
          [nextLabel]: resolveCustomLabelShortcut(previousLabel),
        }),
      );
      return nextColors;
    });

    setCustomLabelShortcuts((current) => {
      const previousShortcut = resolveCustomLabelShortcut(previousLabel);
      const withoutPrevious = Object.fromEntries(
        Object.entries(current).filter(([label]) => label !== previousLabel),
      ) as Record<string, CustomLabelShortcut | null>;
      return normalizeCustomLabelShortcuts(nextCatalog, {
        ...withoutPrevious,
        [nextLabel]: previousShortcut,
      });
    });

    updateCustomLabelsForIds(
      photos.map((photo) => photo.id),
      (currentLabels) => currentLabels.map((label) => (label === previousLabel ? nextLabel : label)),
      `Etichetta rinominata: ${previousLabel} -> ${nextLabel}`,
    );
  }, [customColorNames, customLabelShortcuts, customLabelsCatalog, filterPresets, persistCustomLabelsCatalog, photos, resolveCustomLabelShortcut, resolveCustomLabelTone, updateCustomLabelsForIds]);

  const handleRemoveCustomLabel = useCallback((labelToRemove: string) => {
    const nextCatalog = customLabelsCatalog.filter((label) => label !== labelToRemove);
    persistCustomLabelsCatalog(nextCatalog);
    setCustomLabelColors((current) => {
      const nextColors = normalizeCustomLabelColors(
        nextCatalog,
        Object.fromEntries(
          Object.entries(current).filter(([label]) => label !== labelToRemove),
        ) as Record<string, CustomLabelTone>,
      );
      persistPreferences(
        customColorNames,
        filterPresets,
        nextCatalog,
        nextColors,
        normalizeCustomLabelShortcuts(nextCatalog, customLabelShortcuts),
      );
      return nextColors;
    });
    setCustomLabelShortcuts((current) =>
      normalizeCustomLabelShortcuts(
        nextCatalog,
        Object.fromEntries(
          Object.entries(current).filter(([label]) => label !== labelToRemove),
        ) as Record<string, CustomLabelShortcut | null>,
      )
    );

    updateCustomLabelsForIds(
      photos.map((photo) => photo.id),
      (currentLabels) => currentLabels.filter((label) => label !== labelToRemove),
      `Etichetta rimossa: ${labelToRemove}`,
    );
  }, [customColorNames, customLabelShortcuts, customLabelsCatalog, filterPresets, persistCustomLabelsCatalog, photos, persistPreferences, updateCustomLabelsForIds]);

  // Extract unique subfolders for the folder filter dropdown
  const subfolders = useMemo(() => extractSubfolders(metadataPhotos), [metadataPhotos]);
  const seriesGroups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const photo of metadataPhotos) {
      const key = getSeriesKey(photo);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
  }, [metadataPhotos]);
  const timeClusters = useMemo(() => {
    const counts = new Map<string, number>();
    for (const photo of metadataPhotos) {
      const key = getTimeClusterKey(photo);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((left, right) => left.key.localeCompare(right.key));
  }, [metadataPhotos]);
  const customLabelFilterOptions = useMemo(() => {
    const counts = new Map<string, number>();
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
    const sortCacheVariant = sortBy === "createdAt" ? `createdAt:${createdAtSortDirection}` : sortBy;
    const signature = `${buildPhotoSortSignature(metadataPhotos, sortBy)}:${sortCacheVariant}`;
    const knownIds = new Set(metadataPhotos.map((photo) => photo.id));

    if (isDynamicSort && isThumbnailLoading) {
      const frozen = frozenDynamicSortOrderRef.current;
      if (
        frozen &&
        frozen.sortBy === sortBy &&
        frozen.ids.length === metadataPhotos.length &&
        frozen.ids.every((photoId) => knownIds.has(photoId))
      ) {
        return frozen.ids;
      }
    }

    if (sourceFolderPath && isSortCacheEnabled) {
      const cachedIds = loadCachedPhotoSortOrder(sourceFolderPath, sortBy, signature);
      if (
        cachedIds &&
        cachedIds.length === metadataPhotos.length &&
        cachedIds.every((photoId) => knownIds.has(photoId))
      ) {
        if (isDynamicSort && isThumbnailLoading) {
          frozenDynamicSortOrderRef.current = {
            sortBy,
            signature,
            ids: cachedIds,
          };
        } else if (!isThumbnailLoading && frozenDynamicSortOrderRef.current?.sortBy === sortBy) {
          frozenDynamicSortOrderRef.current = null;
        }
        return cachedIds;
      }
    }

    const orderedIds = metadataPhotos
      .slice()
      .sort((left, right) => {
        if (sortBy === "rating") {
          return (
            getAssetRating(right) - getAssetRating(left) ||
            left.fileName.localeCompare(right.fileName)
          );
        }

        if (sortBy === "orientation") {
          return (
            left.orientation.localeCompare(right.orientation) ||
            left.fileName.localeCompare(right.fileName)
          );
        }

        if (sortBy === "createdAt") {
          const createdAtDiff = resolvePhotoCreatedAt(left) - resolvePhotoCreatedAt(right);
          return (
            (createdAtSortDirection === "asc" ? createdAtDiff : -createdAtDiff) ||
            left.fileName.localeCompare(right.fileName)
          );
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
    } else if (!isThumbnailLoading && frozenDynamicSortOrderRef.current?.sortBy === sortBy) {
      frozenDynamicSortOrderRef.current = null;
    }

    if (sourceFolderPath && isSortCacheEnabled) {
      saveCachedPhotoSortOrder(sourceFolderPath, sortBy, signature, orderedIds);
    }

    return orderedIds;
  }, [createdAtSortDirection, isSortCacheEnabled, isThumbnailLoading, metadataPhotos, sortBy, sortCacheHydrationToken, sourceFolderPath]);

  const visiblePhotoIds = useMemo(() => {
    const lowerSearch = deferredSearchQuery.toLowerCase();
    const filteredIds: string[] = [];

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

      if (
        customLabelFilter !== "all"
        && !normalizeAssetCustomLabels(photo.customLabels).some(
          (label) => label.toLocaleLowerCase() === customLabelFilter.toLocaleLowerCase(),
        )
      ) {
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

  const getVisiblePhotoAtIndex = useCallback((index: number): ImageAsset | null => {
    const id = visiblePhotoIds[index];
    if (!id) {
      return null;
    }
    return assetById.get(id) ?? null;
  }, [assetById, visiblePhotoIds]);
  const visiblePhotoIndexById = useMemo(
    () => new Map(visiblePhotoIds.map((photoId, index) => [photoId, index])),
    [visiblePhotoIds],
  );
  const visiblePhotoIdSet = useMemo(() => new Set(visiblePhotoIds), [visiblePhotoIds]);
  const gridColumnCount = useMemo(() => {
    const width = gridViewport.width || cardSize;
    return Math.max(1, Math.floor((width + GRID_GAP_PX) / (cardSize + GRID_GAP_PX)));
  }, [cardSize, gridViewport.width]);
  const gridColumnWidth = useMemo(() => {
    const width = gridViewport.width || cardSize;
    return Math.max(
      cardSize,
      Math.floor((width - GRID_GAP_PX * Math.max(0, gridColumnCount - 1)) / gridColumnCount),
    );
  }, [cardSize, gridColumnCount, gridViewport.width]);
  const cardStageHeight = useMemo(
    () => Math.max(96, Math.round(gridColumnWidth * CARD_STAGE_HEIGHT_RATIO)),
    [gridColumnWidth],
  );
  const gridRowHeight = useMemo(
    () => cardStageHeight + CARD_CHROME_HEIGHT_PX + GRID_GAP_PX,
    [cardStageHeight],
  );
  const totalVirtualRows = useMemo(
    () => Math.max(1, Math.ceil(visiblePhotoIds.length / gridColumnCount)),
    [gridColumnCount, visiblePhotoIds.length],
  );
  const rowVirtualizer = useVirtualizer({
    count: totalVirtualRows,
    getScrollElement: () => gridRef.current,
    estimateSize: () => gridRowHeight,
    overscan: isFastScrollActive ? VIRTUAL_OVERSCAN_ROWS_FAST : VIRTUAL_OVERSCAN_ROWS_IDLE,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const renderedPhotoIds = useMemo(() => {
    const ids: string[] = [];
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
  const viewportPriorityIds = useMemo(() => {
    if (visiblePhotoIds.length === 0) {
      return [] as string[];
    }

    const prefetchBefore = isFastScrollActive
      ? PRIORITY_PREFETCH_ROWS_BEFORE_FAST
      : PRIORITY_PREFETCH_ROWS_BEFORE_IDLE;
    const prefetchAfter = isFastScrollActive
      ? PRIORITY_PREFETCH_ROWS_AFTER_FAST
      : PRIORITY_PREFETCH_ROWS_AFTER_IDLE;

    if (virtualRows.length === 0) {
      const fallbackCount = Math.min(
        visiblePhotoIds.length,
        Math.max(gridColumnCount * (prefetchBefore + prefetchAfter + 2), gridColumnCount * 6),
      );
      return visiblePhotoIds.slice(0, Math.min(PRIORITY_PREFETCH_MAX_IDS, fallbackCount));
    }

    const firstVisibleRow = virtualRows[0]?.index ?? 0;
    const lastVisibleRow = virtualRows[virtualRows.length - 1]?.index ?? firstVisibleRow;
    const rowStart = Math.max(0, firstVisibleRow - prefetchBefore);
    const rowEndExclusive = Math.min(totalVirtualRows, lastVisibleRow + 1 + prefetchAfter);
    const startIndex = rowStart * gridColumnCount;
    const endIndex = Math.min(visiblePhotoIds.length, rowEndExclusive * gridColumnCount);

    if (endIndex <= startIndex) {
      return [] as string[];
    }

    const ids = visiblePhotoIds.slice(startIndex, endIndex);
    if (ids.length <= PRIORITY_PREFETCH_MAX_IDS) {
      return ids;
    }

    return ids.slice(0, PRIORITY_PREFETCH_MAX_IDS);
  }, [gridColumnCount, isFastScrollActive, totalVirtualRows, virtualRows, visiblePhotoIds]);
  const renderedPhotos = useMemo(
    () => renderedPhotoIds
      .map((photoId) => assetById.get(photoId))
      .filter((photo): photo is ImageAsset => Boolean(photo)),
    [assetById, renderedPhotoIds],
  );
  const topSpacerHeight = virtualRows[0]?.start ?? 0;
  const bottomSpacerHeight = Math.max(
    0,
    rowVirtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0),
  );

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

    const ids: string[] = [];
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

  const gridResetSignature = useMemo(
    () => [
      sourceFolderPath,
      sortBy === "createdAt" ? `createdAt:${createdAtSortDirection}` : sortBy,
      pickFilter,
      ratingFilter,
      colorFilter,
      customLabelFilter,
      folderFilter,
      seriesFilter,
      timeClusterFilter,
      deferredSearchQuery,
    ].join("||"),
    [
      colorFilter,
      createdAtSortDirection,
      customLabelFilter,
      deferredSearchQuery,
      folderFilter,
      pickFilter,
      ratingFilter,
      seriesFilter,
      sortBy,
      sourceFolderPath,
      timeClusterFilter,
    ],
  );

  const openPreview = useCallback((photoId: string, startZoomed = false) => {
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

    const ids = new Set<string>(viewportPriorityIds);

    if (hasActiveFilters && ids.size < PRIORITY_PREFETCH_MAX_IDS) {
      for (const id of visiblePhotoIds.slice(0, PRIORITY_PREFETCH_MAX_IDS)) {
        ids.add(id);
        if (ids.size >= PRIORITY_PREFETCH_MAX_IDS) {
          break;
        }
      }
    }

    for (const id of previewPriorityIds) {
      ids.add(id);
    }

    onPriorityIdsChange(ids);
  }, [hasActiveFilters, onPriorityIdsChange, previewPriorityIds, viewportPriorityIds, visiblePhotoIds]);

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

  const scrollPhotoIntoView = useCallback((photoId: string, behavior: ScrollBehavior = "smooth") => {
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
    } else if (rowBottom > viewportBottom) {
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
        const card = grid?.querySelector<HTMLElement>(`[data-preview-asset-id="${restoreId}"]`);
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
  const handleWindowKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Context menu open: only handle Escape
      if (contextMenuState) {
        if (event.key === "Escape") {
          event.preventDefault();
          setContextMenuState(null);
        }
        return;
      }
      // Quick preview open: let it handle keys
      if (previewAssetId) return;

      const target = event.target as HTMLElement;
      if (target.closest("select, input, textarea")) return;

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
        const normalizedKey = event.key.toLowerCase();
        if (normalizedKey === "a") {
          event.preventDefault();
          toggleAll(true);
          return;
        }
      }

      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        const shortcutLabel = customLabelByShortcut.get(event.key.toUpperCase() as CustomLabelShortcut);
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

      if (
        (event.key === "z" || event.key === "Z") &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
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
      if (!arrowKeys.includes(event.key)) return;

      event.preventDefault();
      if (visiblePhotoIds.length === 0) return;

      const currentIndex = focusedPhotoId
        ? (visiblePhotoIndexById.get(focusedPhotoId) ?? -1)
        : -1;

      const grid = gridRef.current;
      let cols = 4;
      if (grid) {
        const firstCard = grid.querySelector<HTMLElement>(".photo-card");
        if (firstCard && firstCard.offsetWidth > 0) {
          cols = Math.max(1, Math.floor(grid.clientWidth / firstCard.offsetWidth));
        }
      }

      let nextIndex: number;
      if (currentIndex < 0) {
        nextIndex = 0;
      } else if (event.key === "ArrowRight") {
        nextIndex = Math.min(visiblePhotoIds.length - 1, currentIndex + 1);
      } else if (event.key === "ArrowLeft") {
        nextIndex = Math.max(0, currentIndex - 1);
      } else if (event.key === "ArrowDown") {
        nextIndex = Math.min(visiblePhotoIds.length - 1, currentIndex + cols);
      } else {
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
            const el = grid?.querySelector<HTMLElement>(`[data-preview-asset-id="${nextId}"]`);
            if (el) {
              el.focus();
            }
          });
        });
      }
    },
    [
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
    ]
  );

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

  function togglePhoto(id: string, event?: React.MouseEvent) {
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
    } else {
      nextSelection.add(id);
    }

    lastClickedIdRef.current = id;
    onSelectionChange(Array.from(nextSelection));
  }

  function toggleAll(selectAll: boolean) {
    if (selectAll) {
      const idsToSelect = hasActiveFilters
        ? visiblePhotoIds
        : photos.map((p) => p.id);
      onSelectionChange(idsToSelect);
      pushTimelineEntry(
        hasActiveFilters
          ? `Selezionate ${idsToSelect.length} foto visibili con i filtri attivi`
          : `Selezionate tutte le ${idsToSelect.length} foto`
      );
    } else {
      onSelectionChange([]);
      pushTimelineEntry("Deselezionate tutte le foto");
    }
  }

  function updatePhoto(
    id: string,
    changes: PhotoMetadataChanges
  ) {
    applyPhotoChanges(id, changes);
  }

  const applyBatchChanges = useCallback((
    targetIds: string[],
    changes: PhotoMetadataChanges
  ) => {
    if (!onPhotosChange || targetIds.length === 0) {
      return;
    }

    const idSet = new Set(targetIds);
    let changed = false;
    const changedIds: string[] = [];
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

      if (
        nextRating === photo.rating &&
        nextPickStatus === photo.pickStatus &&
        nextColorLabel === photo.colorLabel &&
        areStringArraysEqual(currentCustomLabels, nextCustomLabels)
      ) {
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
    const counts = new Map<string, number>();
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

  const handleToggleBatchCustomLabel = useCallback((label: string) => {
    const activeCount = selectedCustomLabelCounts.get(label) ?? 0;
    const shouldRemove = selectedIds.length > 0 && activeCount === selectedIds.length;
    updateCustomLabelsForIds(
      selectedIds,
      (currentLabels) => shouldRemove
        ? currentLabels.filter((currentLabel) => currentLabel !== label)
        : [...currentLabels, label],
      shouldRemove
        ? `${selectedIds.length === 1 ? "1 foto" : `${selectedIds.length} foto`}: rimossa etichetta ${label}`
        : `${selectedIds.length === 1 ? "1 foto" : `${selectedIds.length} foto`}: aggiunta etichetta ${label}`,
    );
  }, [selectedCustomLabelCounts, selectedIds, updateCustomLabelsForIds]);

  const handleClearBatchCustomLabels = useCallback(() => {
    updateCustomLabelsForIds(
      selectedIds,
      () => [],
      `${selectedIds.length === 1 ? "1 foto" : `${selectedIds.length} foto`}: etichette personalizzate azzerate`,
    );
  }, [selectedIds, updateCustomLabelsForIds]);

  const selectedAbsolutePaths = useMemo(() => getAssetAbsolutePaths(selectedIds), [selectedIds]);
  const selectedAbsolutePathsSignature = useMemo(
    () => selectedAbsolutePaths.join("\n"),
    [selectedAbsolutePaths],
  );
  const dragOutCheckSeqRef = useRef(0);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.filexDesktop?.canStartDragOut !== "function"
    ) {
      setDesktopDragOutCheck(null);
      return;
    }

    // Snapshot stabile della selezione per questa esecuzione: evita race in cui
    // il signature cambia mentre la promise è in volo.
    const requestedCount = selectedIds.length;
    const pathsSnapshot = selectedAbsolutePaths.slice();

    if (pathsSnapshot.length === 0) {
      dragOutCheckSeqRef.current += 1;
      setDesktopDragOutCheck({
        ok: false,
        requestedCount,
        validCount: 0,
        allowedCount: 0,
        reason: "empty-selection",
        message: "Nessun file selezionato per il drag esterno.",
      });
      return;
    }

    dragOutCheckSeqRef.current += 1;
    const seq = dragOutCheckSeqRef.current;

    void window.filexDesktop.canStartDragOut(pathsSnapshot).then((result) => {
      if (seq !== dragOutCheckSeqRef.current) {
        return;
      }

      setDesktopDragOutCheck(result);
    }).catch(() => {
      if (seq !== dragOutCheckSeqRef.current) {
        return;
      }

      setDesktopDragOutCheck({
        ok: false,
        requestedCount,
        validCount: pathsSnapshot.length,
        allowedCount: 0,
        reason: "invalid-paths",
        message: "Impossibile validare il drag esterno in questa sessione.",
      });
    });

    return () => {
      // Invalidate this in-flight check so a late resolve cannot overwrite a
      // newer state computed for a different selection.
      dragOutCheckSeqRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAbsolutePathsSignature]);

  const canStartDesktopDragOut = Boolean(
    desktopDragOutCheck?.ok
    && typeof window !== "undefined"
    && typeof window.filexDesktop?.startDragOut === "function",
  );
  const desktopDragOutMessage = desktopDragOutCheck?.message
    ?? "Drag esterno non disponibile in questa sessione desktop.";
  const desktopDragOutDisabledMessage = selectedIds.length === 0
    ? "Seleziona almeno una foto per il drag esterno."
    : desktopDragOutMessage;

  const handleSelectionDragStart = useCallback((event: DragEvent<HTMLElement>) => {
    if (!canStartDesktopDragOut) {
      event.preventDefault();
      pushTimelineEntry(desktopDragOutMessage);
      return;
    }

    // Important: prevent HTML drag so Electron native drag-out is the only active channel.
    event.preventDefault();
    window.filexDesktop!.startDragOut(selectedAbsolutePaths);
  }, [canStartDesktopDragOut, desktopDragOutMessage, pushTimelineEntry, selectedAbsolutePaths]);

  const handleCardExternalDragStart = useCallback((photoId: string, event: DragEvent<HTMLDivElement>) => {
    const draggingSelection = selectedSet.has(photoId);
    const targetPaths = draggingSelection
      ? getAssetAbsolutePaths(selectedIds)
      : getAssetAbsolutePaths([photoId]);

    if (
      targetPaths.length === 0
      || typeof window.filexDesktop?.startDragOut !== "function"
      || (draggingSelection && (!desktopDragOutCheck?.ok || targetPaths.length !== selectedIds.length))
    ) {
      event.preventDefault();
      return;
    }

    // Important: prevent HTML drag so Electron native drag-out is the only active channel.
    event.preventDefault();
    window.filexDesktop.startDragOut(targetPaths);
  }, [desktopDragOutCheck?.ok, selectedIds, selectedSet]);

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
  const handleFocus = useCallback((id: string) => {
    setFocusedPhotoId(id);
  }, []);

  const handlePreview = useCallback((id: string) => {
    openPreview(id, false);
  }, [openPreview]);

  const handlePreviewAssetSelection = useCallback((assetId: string) => {
    lastPreviewAssetIdRef.current = assetId;
    setFocusedPhotoId(assetId);
    setPreviewAssetId(assetId);
  }, []);

  const handleContextMenu = useCallback((id: string, x: number, y: number) => {
    if (!onPhotosChange) return;
    const targetIds = selectedSet.has(id) ? selectedIds : [id];
    setContextMenuState({ x, y, targetIds });
  }, [onPhotosChange, selectedIds, selectedSet]);

  const handleUpdatePhoto = useCallback((id: string, changes: PhotoMetadataChanges) => {
    applyPhotoChanges(id, changes);
  }, [applyPhotoChanges]);

  // ── On-demand preview URL for QuickPreviewModal ──
  // Key insight: the URL must be stable for a given asset ID so the browser
  // can finish decoding large JPEGs without being interrupted by thumbnail
  // batch updates that change the asset object reference every ~120 ms.
  const previewUrlRef = useRef<{ id: string; url: string; sourceFileKey?: string } | null>(null);
  const [asyncPreviewUrl, setAsyncPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!previewAsset) {
      if (previewUrlRef.current) {
        previewUrlRef.current = null;
      }
      setAsyncPreviewUrl(null);
      return;
    }

    if (
      previewUrlRef.current &&
      previewUrlRef.current.id === previewAsset.id &&
      previewUrlRef.current.sourceFileKey === previewAsset.sourceFileKey
    ) {
      return;
    }

    const abortController = new AbortController();
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
      signal: abortController.signal,
    }).then((url) => {
      if (abortController.signal.aborted) return;
      if (url) {
        previewUrlRef.current = { id: previewAsset.id, url, sourceFileKey: previewAsset.sourceFileKey };
        setAsyncPreviewUrl(url);
      }
    });

    return () => {
      abortController.abort();
    };
  }, [previewAsset]);

  // Keep preview warmup light here. The modal performs the heavier adjacent warmup.
  useEffect(() => {
    if (!previewAssetId || visiblePhotoIds.length === 0) return;

    const currentIndex = visiblePhotoIndexById.get(previewAssetId) ?? -1;
    if (currentIndex < 0) return;

    const idsToWarm: string[] = [];
    for (let delta = 1; delta <= 1; delta++) {
      const prevId = visiblePhotoIds[currentIndex - delta];
      const nextId = visiblePhotoIds[currentIndex + delta];
      const prev = prevId ? assetById.get(prevId) ?? null : null;
      const next = nextId ? assetById.get(nextId) ?? null : null;
      if (prev && (!prev.previewUrl || !prev.sourceUrl)) idsToWarm.push(prev.id);
      if (next && (!next.previewUrl || !next.sourceUrl)) idsToWarm.push(next.id);
    }

    if (idsToWarm.length === 0) return;
    void Promise.all(
      idsToWarm.map((id, index) =>
        warmOnDemandPreviewCache(id, index < 4 ? 1 : 2, {
          maxDimension: QUICK_PREVIEW_FIT_MAX_DIMENSION,
        }).catch(() => null)
      )
    );
  }, [assetById, previewAssetId, visiblePhotoIds, visiblePhotoIndexById]);

  const previewAssetWithUrl = useMemo(() => {
    if (!previewAsset) return null;

    if (previewAsset.previewUrl || previewAsset.sourceUrl) return previewAsset;

    if (
      previewUrlRef.current &&
      previewUrlRef.current.id === previewAsset.id &&
      previewUrlRef.current.sourceFileKey === previewAsset.sourceFileKey
    ) {
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
      return [] as ImageAsset[];
    }

    return visiblePhotoIds
      .map((photoId) => assetById.get(photoId))
      .filter((photo): photo is ImageAsset => Boolean(photo));
  }, [assetById, previewAssetId, visiblePhotoIds]);

  const allSelected = photos.length > 0 && selectedIds.length === photos.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < photos.length;
  const visibleSelectedCount = useMemo(
    () => visiblePhotoIds.filter((photoId) => selectedSet.has(photoId)).length,
    [selectedSet, visiblePhotoIds],
  );

  const photoStats = useMemo(() => {
    const ratingCounts = new Map<number, number>();
    const pickCounts = new Map<PickStatus, number>();
    const colorCounts = new Map<ColorLabel, number>();
    for (const photo of metadataPhotos) {
      const r = getAssetRating(photo);
      ratingCounts.set(r, (ratingCounts.get(r) ?? 0) + 1);
      const ps = getAssetPickStatus(photo);
      pickCounts.set(ps, (pickCounts.get(ps) ?? 0) + 1);
      const cl = getAssetColorLabel(photo);
      if (cl) colorCounts.set(cl, (colorCounts.get(cl) ?? 0) + 1);
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

  function selectByMinimumRating(minRating: number) {
    onSelectionChange(photos.filter((photo) => getAssetRating(photo) >= minRating).map((photo) => photo.id));
    pushTimelineEntry(`Selezionate le foto con almeno ${minRating} stelle`);
  }

  const scrolledInitialRef = useRef(false);
  useEffect(() => {
    if (scrolledInitialRef.current || selectedIds.length === 0 || visiblePhotoIds.length === 0) return;
    scrolledInitialRef.current = true;
    const firstId = selectedIds.find((id) => visiblePhotoIdSet.has(id));
    if (!firstId) return;
    const timer = setTimeout(() => {
      scrollPhotoIntoView(firstId, "smooth");
    }, 200);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePhotoIds.length]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.filexDesktop?.getInstalledEditorCandidates !== "function"
    ) {
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

      const shouldAutoReplaceKnownPreset =
        !currentPath || KNOWN_EDITOR_PRESET_PATHS.includes(currentPath);

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
  const handleCopyFiles = useCallback(async (ids: string[]) => {
    const result = await copyAssetsToFolder(ids);
    if (result === "ok") pushTimelineEntry(`${ids.length === 1 ? "1 file" : `${ids.length} file`} copiato/i in cartella`);
    else if (result === "partial") addToast("Copia parziale: alcuni file non sono stati copiati.", "warning");
    else if (result === "error") addToast("Errore durante la copia. Alcuni file potrebbero non essere stati copiati.", "error");
  }, [addToast, pushTimelineEntry]);

  const handleMoveFiles = useCallback(async (ids: string[]) => {
    const { result, movedIds } = await moveAssetsToFolder(ids);
    if (result === "cancelled") return;
    if (movedIds.length > 0 && onPhotosChange) {
      const movedSet = new Set(movedIds);
      onPhotosChange(photos.filter((p) => !movedSet.has(p.id)));
      onSelectionChange(selectedIds.filter((id) => !movedSet.has(id)));
      pushTimelineEntry(`${movedIds.length === 1 ? "1 file" : `${movedIds.length} file`} spostato/i in cartella`);
    }
    if (result === "partial") addToast("Spostamento parziale: alcuni file non sono stati mossi.", "warning");
    if (result === "error") addToast("Spostamento non riuscito.", "error");
  }, [addToast, onPhotosChange, onSelectionChange, photos, pushTimelineEntry, selectedIds]);

  const handleSaveAs = useCallback(async (ids: string[]) => {
    for (const id of ids) {
      const result = await saveAssetAs(id);
      if (result === "error") { addToast("Errore durante il salvataggio del file.", "error"); break; }
      if (result === "cancelled") break;
    }
  }, [addToast]);

  const handleCopyPath = useCallback((ids: string[], root: string) => {
    const absolutePaths = getAssetAbsolutePaths(ids);
    const paths = absolutePaths.length === ids.length
      ? absolutePaths
      : ids
        .map((id) => getAssetRelativePath(id))
        .filter(Boolean)
        .map((rel) => root ? `${root.replace(/[\\/]+$/, "")}/${rel}` : rel!);
    if (paths.length === 0) return;
    void navigator.clipboard.writeText(paths.join("\n"));
    pushTimelineEntry(`Percorso copiato negli appunti`);
  }, [pushTimelineEntry]);

  const handleOpenWithEditor = useCallback((ids: string[]) => {
    const editor = sanitizeEditorExecutablePath(preferredEditorPath);
    if (!isValidDesktopEditorPath(editor)) {
      addToast(
        "Nessun editor associato valido. Imposta il percorso completo dell'editor (es. C:\\Program Files\\Adobe\\...\\Photoshop.exe).",
        "error",
      );
      return;
    }

    const directAbsolutePaths = getAssetAbsolutePaths(ids);
    const absolutePaths = directAbsolutePaths.length === ids.length
      ? directAbsolutePaths.map((value) => value.replace(/\//g, "\\"))
      : ids
        .map((id) => getAssetRelativePath(id))
        .filter((value): value is string => Boolean(value))
        .map((relative) => {
          const root = effectiveRootFolderPath.trim().replace(/[\\/]+$/, "");
          return `${root}/${relative}`.replace(/\//g, "\\");
        });

    if (absolutePaths.length === 0) {
      addToast("Nessun percorso disponibile per le foto selezionate.", "warning");
      return;
    }

    if (
      typeof window === "undefined" ||
      typeof window.filexDesktop?.sendToEditor !== "function"
    ) {
      // App desktop: il bridge nativo deve essere disponibile. Se non lo è,
      // siamo in uno stato non supportato — niente più fallback BAT lato web.
      addToast(
        "Bridge desktop non disponibile: impossibile aprire l'editor esterno in questa sessione.",
        "error",
      );
      return;
    }

    void window.filexDesktop.sendToEditor(editor, absolutePaths).then((result) => {
      if (!result?.ok) {
        const fallbackMessage = result?.status === "invalid-editor"
          ? "Editor non trovato o percorso non valido."
          : result?.status === "partial"
            ? "Solo una parte della selezione ha percorsi validi per l'editor."
            : result?.status === "timeout"
              ? "L'editor non ha risposto in tempo."
              : "Impossibile aprire l'editor esterno.";
        addToast(result?.error ?? fallbackMessage, "error");
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

      pushTimelineEntry(
        `${absolutePaths.length === 1 ? "1 foto" : `${absolutePaths.length} foto`} aperta/e nell'editor`
      );
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
  }, [addToast, effectiveRootFolderPath, preferredEditorPath, pushTimelineEntry]);

  // Detect external edits (Photoshop overwrite) and refresh in-app previews automatically.
  useEffect(() => {
    if (!onPhotosChange) return;

    let disposed = false;
    let running = false;

    const run = async () => {
      if (running) return;
      if (typeof document !== "undefined" && document.hidden) return;
      const targets = Array.from(new Set([
        ...selectedIds,
        ...(previewAssetId ? [previewAssetId] : []),
      ]));
      if (targets.length === 0) return;

      running = true;
      try {
        const changes = await detectChangedAssetsOnDisk(targets);
        if (disposed || changes.length === 0) return;

        const byId = new Map(changes.map((change) => [change.id, change]));
        const next = photosRef.current.map((asset) => {
          const change = byId.get(asset.id);
          if (!change) return asset;
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
          pushTimelineEntry(
            `${changes.length === 1 ? "1 foto aggiornata" : `${changes.length} foto aggiornate`} dopo modifica esterna`
          );
        }
      } finally {
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
      return { kind: "empty" as const, text: "Non configurato" };
    }
    if (isValidDesktopEditorPath(value)) {
      return { kind: "ok" as const, text: "Formato percorso OK" };
    }
    return { kind: "warn" as const, text: "Percorso incompleto o formato non valido" };
  }, [preferredEditorPath]);

  const desktopThumbnailCacheStatus = useMemo(() => {
    if (!desktopThumbnailCacheInfo) {
      return null;
    }

    return {
      kind: desktopThumbnailCacheInfo.usesCustomPath ? "ok" as const : "empty" as const,
      text: desktopThumbnailCacheInfo.usesCustomPath
        ? "Percorso personalizzato attivo"
        : "Percorso predefinito attivo",
    };
  }, [desktopThumbnailCacheInfo]);

  const cacheLocationSummary = useMemo(
    () => formatVolumeSummary(desktopCacheLocationRecommendation),
    [desktopCacheLocationRecommendation],
  );

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
        kind: "warn" as const,
        text: "C: è stretto: conviene spostare la cache pesante su un disco più capiente.",
      };
    }

    switch (desktopCacheLocationRecommendation.reason) {
      case "already-custom":
        return {
          kind: "ok" as const,
          text: "La cache è già fuori dal disco di sistema.",
        };
      case "dismissed":
        return {
          kind: "empty" as const,
          text: "Suggerimento automatico disattivato.",
        };
      case "no-suitable-volume":
        return {
          kind: "empty" as const,
          text: "Nessun altro disco capiente trovato per una migrazione consigliata.",
        };
      default:
        return {
          kind: "ok" as const,
          text: "Configurazione cache attuale già adatta.",
        };
    }
  }, [desktopCacheLocationRecommendation]);

  const handleBrowsePreferredEditor = useCallback(() => {
    if (
      typeof window !== "undefined" &&
      typeof window.filexDesktop?.chooseEditorExecutable === "function"
    ) {
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
        addToast(
          `Selezionato file: ${selected.name}. Il percorso assoluto non è stato rilevato automaticamente. Usa uno dei preset Photoshop o incolla il percorso completo (es. C:\\Program Files\\Adobe\\...\\Photoshop.exe).`,
          "warning",
          8000,
        );
      }

      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    };

    document.body.appendChild(input);
    input.click();
  }, [addToast, preferredEditorPath, setPreferredEditorPathPersisted]);

  const handleApplyDesktopThumbnailCachePath = useCallback(() => {
    const nextPath = desktopThumbnailCachePathInput.trim();
    if (!nextPath || !onSetDesktopThumbnailCacheDirectory) {
      return;
    }

    void onSetDesktopThumbnailCacheDirectory(nextPath);
  }, [desktopThumbnailCachePathInput, onSetDesktopThumbnailCacheDirectory]);

  return (
    <div className="photo-selector">
      {/* ── FILTER BAR ── */}
      <div className="photo-selector__filter-bar">
        {hasActiveFilters && (
          <div className="selector-filters__reset">
            <button
              type="button"
              className="ghost-button ghost-button--small"
              onClick={resetFilters}
              title={`${activeFilterCount} filtro/i attivo/i`}
            >
              ✕ Azzera
              {activeFilterCount > 0 && (
                <span className="photo-selector__filter-count-badge">{activeFilterCount}</span>
              )}
            </button>
          </div>
        )}

        {subfolders.length > 1 && (
          <label className="field">
            <span>Cartella</span>
            <select
              className={folderFilter !== "all" ? "field__select--active" : undefined}
              value={folderFilter}
              onChange={(event) => setFolderFilter(event.target.value)}
            >
              <option value="all">Tutte ({photos.length})</option>
              {subfolders.map(({ folder, count }) => (
                <option key={folder} value={folder}>
                  {folder === "" ? "Root" : folder} ({count})
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="field">
          <span>Stato</span>
          <select
            className={pickFilter !== "all" ? "field__select--active" : undefined}
            value={pickFilter}
            onChange={(event) => setPickFilter(event.target.value as PickFilter)}
          >
            <option value="all">Tutti</option>
            <option value="picked">Pick</option>
            <option value="rejected">Scartate</option>
            <option value="unmarked">Neutre</option>
          </select>
        </label>

        <label className="field">
          <span>Stelle</span>
          <select
            className={ratingFilter !== "any" ? "field__select--active" : undefined}
            value={ratingFilter}
            onChange={(event) => setRatingFilter(event.target.value)}
          >
            <option value="any">Tutte</option>
            <optgroup label="Minimo">
              <option value="1+">★ 1+</option>
              <option value="2+">★★ 2+</option>
              <option value="3+">★★★ 3+</option>
              <option value="4+">★★★★ 4+</option>
            </optgroup>
            <optgroup label="Esattamente">
              <option value="0">Senza stelle</option>
              <option value="1">★ 1</option>
              <option value="2">★★ 2</option>
              <option value="3">★★★ 3</option>
              <option value="4">★★★★ 4</option>
              <option value="5">★★★★★ 5</option>
            </optgroup>
          </select>
        </label>

        <div className="field photo-selector__color-filter">
          <span>Colore</span>
          <div className="photo-selector__color-filter-dots">
            <button
              type="button"
              className={`photo-selector__color-all-btn${colorFilter === "all" ? " photo-selector__color-all-btn--active" : ""}`}
              onClick={() => setColorFilter("all")}
              title="Tutti i colori"
            >
              ✕
            </button>
            {COLOR_LABELS.map((value) => (
              <button
                key={value}
                type="button"
                className={`asset-color-dot asset-color-dot--${value}${colorFilter === value ? " asset-color-dot--selected" : ""}`}
                onClick={() => setColorFilter(colorFilter === value ? "all" : value)}
                title={customColorNames[value]}
              />
            ))}
          </div>
        </div>

        {customLabelFilterOptions.length > 0 && (
          <label className="field">
            <span>Label custom</span>
            <select
              className={customLabelFilter !== "all" ? "field__select--active" : undefined}
              value={customLabelFilter}
              onChange={(event) => setCustomLabelFilter(event.target.value)}
            >
              <option value="all">Tutte</option>
              {customLabelFilterOptions.map(({ label, count }) => (
                <option key={label} value={label}>
                  {label} ({count})
                </option>
              ))}
            </select>
          </label>
        )}

        {seriesGroups.length > 1 && (
          <label className="field">
            <span>Serie</span>
            <select
              className={seriesFilter !== "all" ? "field__select--active" : undefined}
              value={seriesFilter}
              onChange={(event) => setSeriesFilter(event.target.value)}
            >
              <option value="all">Tutte</option>
              {seriesGroups.map(({ key, count }) => (
                <option key={key} value={key}>
                  {key} ({count})
                </option>
              ))}
            </select>
          </label>
        )}

        {timeClusters.length > 1 && (
          <label className="field">
            <span>Fascia oraria</span>
            <select
              className={timeClusterFilter !== "all" ? "field__select--active" : undefined}
              value={timeClusterFilter}
              onChange={(event) => setTimeClusterFilter(event.target.value)}
            >
              <option value="all">Tutte</option>
              {timeClusters.map(({ key, count }) => (
                <option key={key} value={key}>
                  {key} ({count})
                </option>
              ))}
            </select>
          </label>
        )}

        {filterPresets.length > 0 && (
          <div className="photo-selector__preset-chips">
            <span className="photo-selector__filter-bar-label">Preset</span>
            {filterPresets.map((preset) => (
              <button
                key={preset.id}
                className="photo-selector__preset-apply"
                onClick={() => applyPreset(preset)}
              >
                {preset.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── TOOLBAR ── */}
      <div className="photo-selector__controls">
        <div className="photo-selector__action-inline">
          <div className="photo-selector__undo-group">
            <button
              type="button"
              className="icon-button"
              onClick={handleUndoClick}
              disabled={!canUndo}
              title="Annulla"
            >
              ↩
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={handleRedoClick}
              disabled={!canRedo}
              title="Ripeti"
            >
              ↪
            </button>
          </div>
          <div className="photo-selector__toolbar-divider" />
          <button
            type="button"
            className={`checkbox-button photo-selector__toolbar-control ${allSelected ? "checkbox-button--checked" : someSelected ? "checkbox-button--indeterminate" : ""}`}
            onClick={() => toggleAll(!allSelected)}
          >
            {allSelected ? "Deseleziona tutto" : "Seleziona tutto"}
          </button>
          <div className="photo-selector__toolbar-divider" />
          <button
            type="button"
            className="ghost-button ghost-button--small"
            onClick={selectVisible}
            title="Seleziona le foto visibili"
          >
            Visibili
          </button>
          <button
            type="button"
            className="ghost-button ghost-button--small"
            onClick={activatePickedOnly}
            title="Seleziona solo le foto Pick"
          >
            Solo pick
          </button>
          {selectedIds.length >= 2 && selectedIds.length <= 4 && (
            <button
              type="button"
              className="ghost-button ghost-button--small"
              onClick={() => setIsCompareOpen(true)}
              title={`Confronta ${selectedIds.length} foto selezionate`}
            >
              Confronta
            </button>
          )}
        </div>

        <div className="photo-selector__action-inline photo-selector__toolbar-search">
          <PhotoSearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            resultCount={visiblePhotoIds.length}
            totalCount={photos.length}
          />
        </div>

        <div className="photo-selector__action-inline">
          <label className="photo-selector__zoom-label" title="Dimensione card">
            <span>🔎</span>
            <input
              type="range"
              className="photo-selector__zoom-slider"
              min={100}
              max={320}
              step={10}
              value={cardSize}
              onChange={(e) => setCardSize(Number(e.target.value))}
              aria-label="Dimensione card"
            />
          </label>
          <div className="photo-selector__toolbar-divider" />
          <select
            className="photo-selector__sort photo-selector__toolbar-control"
            value={sortBy === "createdAt" ? `createdAt:${createdAtSortDirection}` : sortBy}
            onChange={(event) => {
              const nextSort = event.target.value;
              if (nextSort === "createdAt:asc") {
                setSortBy("createdAt");
                setCreatedAtSortDirection("asc");
                return;
              }
              if (nextSort === "createdAt:desc") {
                setSortBy("createdAt");
                setCreatedAtSortDirection("desc");
                return;
              }
              setSortBy(nextSort as SortMode);
            }}
          >
            <option value="name">AZ ↑ Nome</option>
            <option value="createdAt:desc">Data creazione ↓</option>
            <option value="createdAt:asc">Data creazione ↑</option>
            <option value="orientation">Orientamento</option>
            <option value="rating">Valutazione</option>
          </select>
          <button
            type="button"
            className={`icon-button${isSettingsPanelOpen ? " icon-button--active" : ""}`}
            onClick={() => setIsSettingsPanelOpen((v) => !v)}
            title="Impostazioni workspace"
          >
            ⚙
          </button>
          <PhotoClassificationHelpButton />
        </div>
      </div>

      {/* ── QUICK STATS CHIPS ── */}
      {photos.length > 0 && (
        <div className="photo-selector__quick-stats">
          {[1, 2, 3, 4, 5].map((r) => {
            const count = photoStats.ratingCounts.get(r) ?? 0;
            if (count === 0) return null;
            const isActive = ratingFilter === String(r);
            return (
              <button
                key={r}
                type="button"
                className={`photo-selector__qs-chip photo-selector__qs-chip--star${isActive ? " photo-selector__qs-chip--active" : ""}`}
                onClick={() => setRatingFilter(isActive ? "any" : String(r))}
                title={`${r} stelle — ${count} foto`}
              >
                {"★".repeat(r)}
                <span className="photo-selector__qs-count">{count}</span>
              </button>
            );
          })}
          {(["picked", "rejected"] as PickStatus[]).map((ps) => {
            const count = photoStats.pickCounts.get(ps) ?? 0;
            if (count === 0) return null;
            const isActive = pickFilter === ps;
            return (
              <button
                key={ps}
                type="button"
                className={`photo-selector__qs-chip photo-selector__qs-chip--${ps}${isActive ? " photo-selector__qs-chip--active" : ""}`}
                onClick={() => setPickFilter(isActive ? "all" : ps)}
                title={ps === "picked" ? `Pick — ${count} foto` : `Scartate — ${count} foto`}
              >
                {ps === "picked" ? "✓" : "✕"}
                <span className="photo-selector__qs-count">{count}</span>
              </button>
            );
          })}
          {COLOR_LABELS.map((cl) => {
            const count = photoStats.colorCounts.get(cl) ?? 0;
            if (count === 0) return null;
            const isActive = colorFilter === cl;
            return (
              <button
                key={cl}
                type="button"
                className={`photo-selector__qs-chip photo-selector__qs-chip--color-${cl}${isActive ? " photo-selector__qs-chip--active" : ""}`}
                onClick={() => setColorFilter(isActive ? "all" : cl)}
                title={`${customColorNames[cl]} — ${count} foto`}
              >
                <span
                  className={`asset-color-dot asset-color-dot--${cl}`}
                  style={{ width: "8px", height: "8px", minWidth: "8px" }}
                />
                <span className="photo-selector__qs-count">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── MAIN CONTENT ── */}
      <div
        ref={gridRef}
        className="photo-selector__grid"
        style={{
          "--ps-card-min": `${cardSize}px`,
          "--ps-card-stage-height": `${cardStageHeight}px`,
        } as React.CSSProperties}
        role="listbox"
        onPointerDown={(e) => {
          // Never start a lasso drag while the context menu is open
          if (contextMenuState) return;
          // Only start drag on the grid background (not on photo cards)
          if ((e.target as HTMLElement).closest(".photo-card")) return;
          if (e.button !== 0) return;
          dragOriginRef.current = { x: e.clientX, y: e.clientY };
          setDragRect(null);
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragOriginRef.current) return;
          const ox = dragOriginRef.current.x;
          const oy = dragOriginRef.current.y;
          const cx = e.clientX;
          const cy = e.clientY;
          const threshold = 6;
          if (Math.abs(cx - ox) < threshold && Math.abs(cy - oy) < threshold) return;
          setDragRect({
            left: Math.min(ox, cx),
            top: Math.min(oy, cy),
            width: Math.abs(cx - ox),
            height: Math.abs(cy - oy),
          });
        }}
        onPointerUp={(e) => {
          if (!dragOriginRef.current) return;
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
          if (!grid) return;
          const cards = grid.querySelectorAll<HTMLElement>("[data-preview-asset-id]");
          const newIds: string[] = [];
          for (let i = 0; i < cards.length; i++) {
            const cr = cards[i].getBoundingClientRect();
            const overlaps =
              cr.left < selRect.right &&
              cr.right > selRect.left &&
              cr.top < selRect.bottom &&
              cr.bottom > selRect.top;
            if (overlaps) {
              const id = cards[i].dataset.previewAssetId;
              if (id) newIds.push(id);
            }
          }
          if (newIds.length > 0) {
            const base = e.shiftKey ? new Set(selectedIds) : new Set<string>();
            for (const id of newIds) base.add(id);
            onSelectionChange(Array.from(base));
            pushTimelineEntry(`Selezionate ${newIds.length} foto con lasso`);
          }
        }}
        onScroll={handleGridScroll}
      >
        {visiblePhotoIds.length === 0 ? (
          <div className="photo-selector__empty">
            <p>Nessuna foto trovata.</p>
          </div>
        ) : (
          <>
            {topSpacerHeight > 0 ? (
              <div
                className="photo-selector__virtual-spacer"
                style={{ height: topSpacerHeight }}
                aria-hidden="true"
              />
            ) : null}
            {renderedPhotos.map((photo) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                isSelected={selectedSet.has(photo.id)}
                onToggle={togglePhoto}
                onUpdatePhoto={handleUpdatePhoto}
                onFocus={handleFocus}
                onPreview={handlePreview}
                onContextMenu={handleContextMenu}
                onExternalDragStart={handleCardExternalDragStart}
                customLabelColors={customLabelColors}
                customLabelShortcuts={customLabelShortcuts}
                canExternalDrag={typeof window !== "undefined"
                  && typeof window.filexDesktop?.startDragOut === "function"
                  && (
                    selectedSet.has(photo.id)
                      ? canStartDesktopDragOut
                      : Boolean(getAssetAbsolutePath(photo.id))
                  )}
                disableNonEssentialUi={isFastScrollActive}
                batchPulseToken={batchPulseState?.ids.has(photo.id) ? batchPulseState.token : 0}
                batchPulseKind={batchPulseState?.ids.has(photo.id) ? batchPulseState.kind : null}
                editable={!!onPhotosChange}
              />
            ))}
            {bottomSpacerHeight > 0 ? (
              <div
                className="photo-selector__virtual-spacer"
                style={{ height: bottomSpacerHeight }}
                aria-hidden="true"
              />
            ) : null}
          </>
        )}
        {dragRect && (
          <div
            className="photo-selector__drag-rect"
            style={{
              position: "fixed",
              left: dragRect.left,
              top: dragRect.top,
              width: dragRect.width,
              height: dragRect.height,
            }}
          />
        )}
      </div>

      {/* ── STATUS BAR (Bridge Bottom Style) ── */}
      <footer className="photo-selector__bottom-bar">
        <div className="photo-selector__stats">
          <span className="photo-selector__count">
            {photos.length} elementi — {selectedIds.length} selezionati
            {hasActiveFilters ? ` (${visiblePhotoIds.length} filtrati)` : ""}
          </span>
          {selectionStats && (
            <div className="photo-selector__stat-chips">
              {selectionStats.picked > 0 && (
                <span className="photo-selector__stat-chip photo-selector__stat-chip--pick">
                  Pick {selectionStats.picked}
                </span>
              )}
              {selectionStats.rejected > 0 && (
                <span className="photo-selector__stat-chip photo-selector__stat-chip--reject">
                  Scart. {selectionStats.rejected}
                </span>
              )}
              {selectionStats.highRating > 0 && (
                <span className="photo-selector__stat-chip photo-selector__stat-chip--star">
                  ★3+ {selectionStats.highRating}
                </span>
              )}
            </div>
          )}
        </div>
        
        {timelineEntries.length > 0 && (
          canUndo ? (
            <button
              type="button"
              className="photo-selector__timeline-status photo-selector__timeline-undo-btn"
              onClick={handleUndoClick}
              title="Clicca per annullare"
            >
              ↩ {timelineEntries[0].label}
            </button>
          ) : (
            <div className="photo-selector__timeline-status">
              {timelineEntries[0].label}
            </div>
          )
        )}

        <div className="photo-selector__footer-actions">
          <button
              type="button"
              className={`ghost-button ghost-button--small${canStartDesktopDragOut ? " photo-selector__dragout-button" : ""}`}
              draggable={canStartDesktopDragOut}
              onDragStart={handleSelectionDragStart}
              title={canStartDesktopDragOut
                ? "Trascina la selezione direttamente dentro Auto Layout, Photoshop o un'altra app desktop."
                : desktopDragOutDisabledMessage}
              disabled={!canStartDesktopDragOut}
            >
              Trascina fuori ({selectedIds.length})
            </button>
          {!canStartDesktopDragOut && (
            <span className="photo-selector__dragout-feedback" role="status" aria-live="polite">
              {desktopDragOutDisabledMessage}
            </span>
          )}
          {selectedIds.length > 0 && (
            <button 
              className="ghost-button ghost-button--small" 
              onClick={() => setIsBatchToolsOpen(!isBatchToolsOpen)}
            >
              {isBatchToolsOpen ? "Chiudi Batch" : "Apri Batch"}
            </button>
          )}
        </div>
      </footer>

      {isBatchToolsOpen && selectedIds.length > 0 && (
        <section
          className="photo-selector__selection-bar photo-selector__batch-panel"
        >
          <div className="photo-selector__selection-tools">
              <div className="photo-selector__selection-group" aria-label="Valutazione">
                <span className="photo-selector__selection-label">Stelle</span>
                <div className="photo-selector__selection-stars">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className="photo-selector__batch-star"
                      onClick={() => applyBatchChanges(selectedIds, { rating: value })}
                    >
                      {Array.from({ length: value }, () => "★").join("")}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="ghost-button ghost-button--small"
                    onClick={() => applyBatchChanges(selectedIds, { rating: 0 })}
                  >
                    Azzera
                  </button>
                </div>
              </div>

              <div className="photo-selector__selection-group" aria-label="Stato">
                <span className="photo-selector__selection-label">Stato</span>
                <div className="photo-selector__selection-pills">
                  {(["picked", "rejected", "unmarked"] as PickStatus[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className="photo-selector__batch-pill"
                      onClick={() => applyBatchChanges(selectedIds, { pickStatus: value })}
                    >
                      {value === "picked" ? "Pick" : value === "rejected" ? "Scartata" : "Neutra"}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="ghost-button ghost-button--small"
                    onClick={excludeRejected}
                    title="Rimuovi dalla selezione le foto scartate"
                  >
                    − Escludi scartate
                  </button>
                </div>
              </div>

              <div className="photo-selector__selection-group" aria-label="Etichette colore">
                <span className="photo-selector__selection-label">Etichette</span>
                <div className="photo-selector__selection-colors">
                  <button
                    type="button"
                    className="ghost-button ghost-button--small"
                    onClick={() => applyBatchChanges(selectedIds, { colorLabel: null })}
                  >
                    Nessuna
                  </button>
                  {COLOR_LABELS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`asset-color-dot asset-color-dot--${value}`}
                      onClick={() => applyBatchChanges(selectedIds, { colorLabel: value })}
                    />
                  ))}
                </div>
              </div>

              <div className="photo-selector__selection-group" aria-label="Etichette personalizzate">
                <span className="photo-selector__selection-label">Label custom</span>
                <div className="photo-selector__selection-pills photo-selector__selection-pills--wrap">
                  <button
                    type="button"
                    className="ghost-button ghost-button--small"
                    onClick={handleClearBatchCustomLabels}
                  >
                    Azzera
                  </button>
                  {customLabelsCatalog.map((label) => {
                    const activeCount = selectedCustomLabelCounts.get(label) ?? 0;
                    const isActive = selectedIds.length > 0 && activeCount === selectedIds.length;
                    const isPartial = activeCount > 0 && activeCount < selectedIds.length;
                    const tone = resolveCustomLabelTone(label);
                    return (
                      <button
                        key={label}
                        type="button"
                        className={[
                          "photo-selector__batch-pill",
                          "photo-selector__batch-pill--label",
                          `photo-selector__batch-pill--${tone}`,
                          isActive ? "photo-selector__batch-pill--active" : "",
                          isPartial ? "photo-selector__batch-pill--partial" : "",
                        ].filter(Boolean).join(" ")}
                        onClick={() => handleToggleBatchCustomLabel(label)}
                        title={isActive ? `Rimuovi ${label} dalla selezione` : `Assegna ${label} alla selezione`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <div className="photo-selector__label-create-row">
                  <input
                    type="text"
                    className="photo-selector__settings-color-input"
                    value={newBatchCustomLabelName}
                    onChange={(event) => setNewBatchCustomLabelName(event.target.value)}
                    onKeyDown={(event) => {
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
                    }}
                    placeholder="Nuova etichetta, es. Album sposi"
                  />
                  <select
                    className="photo-selector__settings-color-input"
                    value={newBatchCustomLabelTone}
                    onChange={(event) => setNewBatchCustomLabelTone(event.target.value as CustomLabelTone)}
                    title="Colore etichetta"
                  >
                    {CUSTOM_LABEL_TONES.map((tone) => (
                      <option key={tone} value={tone}>
                        {`Colore ${tone}`}
                      </option>
                    ))}
                  </select>
                  <select
                    className="photo-selector__settings-color-input"
                    value={newBatchCustomLabelShortcut ?? ""}
                    onChange={(event) => setNewBatchCustomLabelShortcut(normalizeCustomLabelShortcut(event.target.value))}
                    title="Tasto rapido"
                  >
                    <option value="">Nessun tasto</option>
                    {CUSTOM_LABEL_SHORTCUT_OPTIONS.map((shortcut) => (
                      <option key={shortcut} value={shortcut}>
                        {`Tasto ${shortcut}`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="ghost-button ghost-button--small"
                    onClick={() => {
                      handleAddCustomLabelToCatalog(newBatchCustomLabelName, {
                        assignToSelection: true,
                        tone: newBatchCustomLabelTone,
                        shortcut: newBatchCustomLabelShortcut,
                      });
                      setNewBatchCustomLabelName("");
                      setNewBatchCustomLabelTone(DEFAULT_CUSTOM_LABEL_TONE);
                      setNewBatchCustomLabelShortcut(null);
                    }}
                    disabled={!newBatchCustomLabelName.trim()}
                  >
                    Aggiungi e assegna
                  </button>
                </div>
              </div>
          </div>
        </section>
      )}

      <PhotoQuickPreviewModal
        asset={previewAssetWithUrl}
        assets={visiblePreviewAssets}
        thumbnailProfile={selectedThumbnailProfile}
        startZoomed={previewStartsZoomed}
        customLabelsCatalog={customLabelsCatalog}
        customLabelColors={customLabelColors}
        customLabelShortcuts={customLabelShortcuts}
        onClose={closePreview}
        onSelectAsset={handlePreviewAssetSelection}
        onUpdateAsset={(assetId, changes) => updatePhoto(assetId, changes)}
      />

      {isSettingsPanelOpen && (        <aside className="photo-selector__settings-flyout" aria-label="Impostazioni workspace">
          <div className="photo-selector__settings-header">
            <span>Impostazioni</span>
            <button
              type="button"
              className="icon-button"
              onClick={() => setIsSettingsPanelOpen(false)}
              title="Chiudi"
            >
              ✕
            </button>
          </div>

          <div className="photo-selector__settings-section">
            <h4 className="photo-selector__settings-section-title">Nomi etichette colore</h4>
            {COLOR_LABELS.map((label) => (
              <label key={label} className="photo-selector__settings-color-row">
                <span className={`asset-color-dot asset-color-dot--${label}`} />
                <input
                  type="text"
                  className="photo-selector__settings-color-input"
                  value={customColorNames[label]}
                  onChange={(e) => handleColorNameChange(label, e.target.value)}
                  placeholder={COLOR_LABEL_NAMES[label]}
                />
              </label>
            ))}
          </div>

          <div className="photo-selector__settings-section">
            <h4 className="photo-selector__settings-section-title">Etichette personalizzate</h4>
            <p className="photo-selector__settings-empty">
              Crea etichette tipo "Album sposi", "Trailer", "Dettagli sala". Ora puoi scegliere subito colore e tasto rapido, assegnarle alla selezione e ritrovarle sia in UI sia nei sidecar XMP.
            </p>
            <div className="photo-selector__label-grid">
              {customLabelsCatalog.map((label) => (
                <div key={label} className="photo-selector__label-editor">
                  <span className={`photo-selector__label-chip photo-selector__label-chip--${resolveCustomLabelTone(label)}`}>
                    Tag
                  </span>
                  <input
                    type="text"
                    defaultValue={label}
                    onBlur={(event) => {
                      const nextValue = normalizeCustomLabelName(event.target.value);
                      if (!nextValue) {
                        event.currentTarget.value = label;
                        return;
                      }
                      handleRenameCustomLabel(label, nextValue);
                      event.currentTarget.value = nextValue;
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                    }}
                  />
                  <div className="photo-selector__label-tone-picker" aria-label={`Colore ${label}`}>
                    {CUSTOM_LABEL_TONES.map((tone) => (
                      <button
                        key={`${label}-${tone}`}
                        type="button"
                        className={
                          resolveCustomLabelTone(label) === tone
                            ? `photo-selector__label-tone photo-selector__label-tone--${tone} photo-selector__label-tone--active`
                            : `photo-selector__label-tone photo-selector__label-tone--${tone}`
                        }
                        onClick={() => handleCustomLabelToneChange(label, tone)}
                        title={`Usa colore ${tone} per ${label}`}
                      />
                    ))}
                  </div>
                  <select
                    className="photo-selector__settings-color-input"
                    value={resolveCustomLabelShortcut(label) ?? ""}
                    onChange={(event) => handleCustomLabelShortcutChange(label, normalizeCustomLabelShortcut(event.target.value))}
                    title={`Scorciatoia ${label}`}
                  >
                    <option value="">Nessun tasto</option>
                    {CUSTOM_LABEL_SHORTCUT_OPTIONS.map((shortcut) => (
                      <option key={`${label}-${shortcut}`} value={shortcut}>
                        {`Tasto ${shortcut}`}
                      </option>
                    ))}
                  </select>
                  {selectedIds.length > 0 ? (
                    <button
                      type="button"
                      className="ghost-button ghost-button--small"
                      title={`Assegna ${label} alle foto selezionate${resolveCustomLabelShortcut(label) ? ` · ${resolveCustomLabelShortcut(label)}` : ""}`}
                      onClick={() => assignCustomLabelToSelection(label)}
                    >
                      {resolveCustomLabelShortcut(label) ? `Assegna · ${resolveCustomLabelShortcut(label)}` : "Assegna"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="icon-button icon-button--danger"
                    title={`Rimuovi ${label}`}
                    onClick={() => handleRemoveCustomLabel(label)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="photo-selector__settings-preset-row">
              <input
                type="text"
                className="photo-selector__settings-color-input"
                value={newCustomLabelName}
                onChange={(event) => setNewCustomLabelName(event.target.value)}
                onKeyDown={(event) => {
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
                }}
                placeholder="Nuova etichetta workflow"
              />
              <select
                className="photo-selector__settings-color-input"
                value={newCustomLabelTone}
                onChange={(event) => setNewCustomLabelTone(event.target.value as CustomLabelTone)}
                title="Colore etichetta"
              >
                {CUSTOM_LABEL_TONES.map((tone) => (
                  <option key={`new-${tone}`} value={tone}>
                    {`Colore ${tone}`}
                  </option>
                ))}
              </select>
              <select
                className="photo-selector__settings-color-input"
                value={newCustomLabelShortcut ?? ""}
                onChange={(event) => setNewCustomLabelShortcut(normalizeCustomLabelShortcut(event.target.value))}
                title="Tasto rapido"
              >
                <option value="">Nessun tasto</option>
                {CUSTOM_LABEL_SHORTCUT_OPTIONS.map((shortcut) => (
                  <option key={`new-shortcut-${shortcut}`} value={shortcut}>
                    {`Tasto ${shortcut}`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ghost-button ghost-button--small"
                onClick={() => {
                  handleAddCustomLabelToCatalog(newCustomLabelName, {
                    tone: newCustomLabelTone,
                    shortcut: newCustomLabelShortcut,
                  });
                  setNewCustomLabelName("");
                  setNewCustomLabelTone(DEFAULT_CUSTOM_LABEL_TONE);
                  setNewCustomLabelShortcut(null);
                }}
                disabled={!newCustomLabelName.trim()}
              >
                Aggiungi
              </button>
              {selectedIds.length > 0 ? (
                <button
                  type="button"
                  className="ghost-button ghost-button--small"
                  onClick={() => {
                    handleAddCustomLabelToCatalog(newCustomLabelName, {
                      assignToSelection: true,
                      tone: newCustomLabelTone,
                      shortcut: newCustomLabelShortcut,
                    });
                    setNewCustomLabelName("");
                    setNewCustomLabelTone(DEFAULT_CUSTOM_LABEL_TONE);
                    setNewCustomLabelShortcut(null);
                  }}
                  disabled={!newCustomLabelName.trim()}
                >
                  Aggiungi e assegna
                </button>
              ) : null}
            </div>
          </div>

          <div className="photo-selector__settings-section">
            <h4 className="photo-selector__settings-section-title">
              Editor esterno
              <button
                type="button"
                className="photo-selector__settings-info-btn"
                title="Imposta il percorso assoluto della cartella radice sul tuo PC (es. C:\Foto\Matrimonio). Questo permette di copiare il percorso completo di un file per aprirlo in Photoshop o qualsiasi altro editor esterno."
              >
                ?
              </button>
            </h4>
            <label className="photo-selector__settings-color-row">
              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", minWidth: 90 }}>Cartella radice</span>
              <input
                type="text"
                className="photo-selector__settings-color-input"
                value={effectiveRootFolderPath}
                onChange={(e) => {
                  setRootFolderPathOverridePersisted(e.target.value);
                }}
                placeholder={sourceFolderPath || "C:\\Utenti\\Foto\\Matrimonio"}
                spellCheck={false}
              />
            </label>
            <div className="photo-selector__settings-preset-row">
              <button
                type="button"
                className="ghost-button ghost-button--small"
                onClick={() => setRootFolderPathOverridePersisted("")}
                disabled={!rootFolderPathOverride.trim()}
                title="Torna a usare automaticamente la cartella aperta"
              >
                Usa cartella aperta
              </button>
            </div>
            <label className="photo-selector__settings-color-row">
              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", minWidth: 90 }}>Editor</span>
              <div className="photo-selector__settings-input-with-button">
                <input
                  type="text"
                  className="photo-selector__settings-color-input"
                  value={preferredEditorPath}
                  onChange={(e) => setPreferredEditorPathPersisted(e.target.value)}
                  placeholder={installedEditorCandidates[0]?.path ?? "C:\\Program Files\\Adobe\\Adobe Photoshop 2026\\Photoshop.exe"}
                  spellCheck={false}
                />
              </div>
            </label>
            <div className="photo-selector__settings-browse-row">
              <button
                type="button"
                className="photo-selector__settings-browse-prominent"
                onClick={() => void handleBrowsePreferredEditor()}
                title="Seleziona l'eseguibile dell'editor (Photoshop.exe, ecc.)"
              >
                📂 Sfoglia editor...
              </button>
            </div>
            <div className="photo-selector__settings-preset-row photo-selector__settings-editor-presets">
              {(installedEditorCandidates.length > 0 ? installedEditorCandidates : KNOWN_EDITOR_PRESET_PATHS.map((path) => ({
                path,
                label: path.match(/Adobe Photoshop \d{4}/i)?.[0]?.replace(/^Adobe\s+/i, "") ?? "Photoshop",
              }))).map((candidate) => (
                <button
                  key={candidate.path}
                  type="button"
                  className="ghost-button ghost-button--small"
                  onClick={() => setPreferredEditorPathPersisted(candidate.path)}
                  title={`Imposta percorso ${candidate.label}`}
                >
                  {candidate.label}
                </button>
              ))}
            </div>
            <p
              className={`photo-selector__settings-path-status photo-selector__settings-path-status--${editorPathStatus.kind}`}
            >
              {editorPathStatus.text}
            </p>
            {installedEditorCandidates.length > 0 ? (
              <p className="photo-selector__settings-empty" style={{ marginTop: "0.3rem" }}>
                Editor rilevato: {installedEditorCandidates[0].path}
              </p>
            ) : null}
            <p className="photo-selector__settings-empty" style={{ marginTop: "0.3rem" }}>
              {rootFolderPathOverride.trim()
                ? `Override manuale attivo. Cartella aperta: ${sourceFolderPath || "n/d"}`
                : sourceFolderPath
                  ? `Auto dalla cartella aperta: ${sourceFolderPath}`
                  : "Si auto-compila quando apri una cartella in modalità desktop."}
            </p>
            <p className="photo-selector__settings-empty" style={{ marginTop: "0.3rem" }}>
              Usato per "Apri con editor" e "Copia percorso" nel menu contestuale.
            </p>
          </div>

          <div className="photo-selector__settings-section">
            <h4 className="photo-selector__settings-section-title">
              Prestazioni
              <button
                type="button"
                className="photo-selector__settings-info-btn"
                title="Ultra Fast privilegia al massimo la reattivita' e alleggerisce anche la quick preview. Fast contact sheet mantiene un po' piu' dettaglio. Bilanciato punta di piu' alla pulizia visiva. Il profilo si applica subito ai task attivi e alla quick preview; riaprire la cartella rigenera tutta la cache con il nuovo profilo."
              >
                ?
              </button>
            </h4>
            <label className="photo-selector__settings-color-row">
              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", minWidth: 90 }}>Anteprime</span>
              <select
                className="photo-selector__settings-color-input"
                value={selectedThumbnailProfile}
                onChange={(event) => handleThumbnailProfileChange(
                  event.target.value === "balanced"
                    ? "balanced"
                    : event.target.value === "fast"
                      ? "fast"
                      : "ultra-fast"
                )}
              >
                <option value="ultra-fast">Ultra Fast</option>
                <option value="balanced">Bilanciato</option>
                <option value="fast">Fast contact sheet</option>
              </select>
            </label>
            <label className="photo-selector__settings-color-row" style={{ alignItems: "center" }}>
              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", minWidth: 90 }}>Sort cache</span>
              <input
                type="checkbox"
                checked={isSortCacheEnabled}
                onChange={(event) => handleSortCacheEnabledChange(event.target.checked)}
              />
            </label>
            <p className="photo-selector__settings-empty" style={{ marginTop: "0.3rem" }}>
              Profilo attivo: {
                selectedThumbnailProfile === "ultra-fast"
                  ? "Ultra Fast"
                  : selectedThumbnailProfile === "fast"
                    ? "Fast contact sheet"
                    : "Bilanciato"
              }.
              {selectedThumbnailProfile !== thumbnailProfile ? " Aggiorno subito task attivi e quick preview; riaprire la cartella rigenera tutta la cache col nuovo profilo." : ""}
            </p>
            {performanceSnapshot ? (
              <>
                <p className="photo-selector__settings-empty" style={{ marginTop: "0.3rem" }}>
                  Primo thumbnail: {formatMilliseconds(performanceSnapshot.folderOpenToFirstThumbnailMs)} | Griglia completa: {formatMilliseconds(performanceSnapshot.folderOpenToGridCompleteMs)}
                </p>
                <p className="photo-selector__settings-empty" style={{ marginTop: "0.3rem" }}>
                  Cache colpite: {performanceSnapshot.cachedThumbnailCount}/{performanceSnapshot.totalThumbnailCount} | Letture disco: {formatBytes(performanceSnapshot.bytesRead)}
                </p>
                <p className="photo-selector__settings-empty" style={{ marginTop: "0.3rem" }}>
                  RAW: {formatBytes(performanceSnapshot.rawBytesRead)} | Standard: {formatBytes(performanceSnapshot.standardBytesRead)}
                </p>
              </>
            ) : null}
            {desktopThumbnailCacheInfo?.systemTotalMemoryBytes != null && onRamBudgetPresetChange ? (
              <RamBudgetSection
                systemTotalMemoryBytes={desktopThumbnailCacheInfo.systemTotalMemoryBytes}
                activePreset={desktopThumbnailCacheInfo.ramBudgetPreset ?? null}
                activeRamBudgetBytes={desktopThumbnailCacheInfo.ramBudgetBytes ?? null}
                onPresetChange={onRamBudgetPresetChange}
                onRelaunch={onRelaunch}
              />
            ) : null}
          </div>

          {desktopThumbnailCacheInfo ? (
            <div className="photo-selector__settings-section">
              <h4 className="photo-selector__settings-section-title">
                Cache thumbnail desktop
                <button
                  type="button"
                  className="photo-selector__settings-info-btn"
                  title="Spostiamo solo le cache pesanti gestite da Selezione Foto. AppData, Temp e cache Chromium di sistema restano nei percorsi di Windows."
                >
                  ?
                </button>
              </h4>
              <p className="photo-selector__settings-empty" style={{ marginTop: "0.1rem" }}>
                Spostiamo le cache pesanti gestite da Selezione Foto, non i percorsi di sistema di Windows.
              </p>
              <label className="photo-selector__settings-color-row">
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", minWidth: 90 }}>Percorso</span>
                <div className="photo-selector__settings-input-with-button">
                  <input
                    type="text"
                    className="photo-selector__settings-color-input"
                    value={desktopThumbnailCachePathInput}
                    onChange={(e) => setDesktopThumbnailCachePathInput(e.target.value)}
                    placeholder={desktopThumbnailCacheInfo.defaultPath}
                    spellCheck={false}
                    disabled={isDesktopThumbnailCacheBusy}
                  />
                </div>
              </label>
              <div className="photo-selector__settings-preset-row">
                <button
                  type="button"
                  className="ghost-button ghost-button--small"
                  onClick={handleApplyDesktopThumbnailCachePath}
                  disabled={isDesktopThumbnailCacheBusy || !desktopThumbnailCachePathInput.trim()}
                >
                  Applica
                </button>
                <button
                  type="button"
                  className="ghost-button ghost-button--small"
                  onClick={() => void onChooseDesktopThumbnailCacheDirectory?.()}
                  disabled={isDesktopThumbnailCacheBusy || !onChooseDesktopThumbnailCacheDirectory}
                >
                  Sfoglia...
                </button>
                <button
                  type="button"
                  className="ghost-button ghost-button--small"
                  onClick={() => void onResetDesktopThumbnailCacheDirectory?.()}
                  disabled={isDesktopThumbnailCacheBusy || !onResetDesktopThumbnailCacheDirectory}
                >
                  Default
                </button>
                <button
                  type="button"
                  className="ghost-button ghost-button--small"
                  onClick={() => void onUseRecommendedDesktopThumbnailCacheDirectory?.()}
                  disabled={
                    isDesktopThumbnailCacheBusy
                    || !onUseRecommendedDesktopThumbnailCacheDirectory
                    || !canUseRecommendedCacheLocation
                  }
                >
                  Usa percorso consigliato
                </button>
                <button
                  type="button"
                  className="ghost-button ghost-button--small"
                  onClick={() => void onClearDesktopThumbnailCache?.()}
                  disabled={isDesktopThumbnailCacheBusy || !onClearDesktopThumbnailCache}
                >
                  Svuota cache
                </button>
              </div>
              {desktopThumbnailCacheStatus ? (
                <p
                  className={`photo-selector__settings-path-status photo-selector__settings-path-status--${desktopThumbnailCacheStatus.kind}`}
                >
                  {desktopThumbnailCacheStatus.text}
                </p>
              ) : null}
              {desktopCacheRecommendationStatus ? (
                <p
                  className={`photo-selector__settings-path-status photo-selector__settings-path-status--${desktopCacheRecommendationStatus.kind}`}
                >
                  {desktopCacheRecommendationStatus.text}
                </p>
              ) : null}
              <p className="photo-selector__settings-empty" style={{ marginTop: "0.3rem" }}>
                {desktopThumbnailCacheInfo.entryCount} anteprime, {formatBytes(desktopThumbnailCacheInfo.totalBytes)} su disco.
              </p>
              {typeof desktopThumbnailCacheInfo.rawRenderCacheHit === "number" ? (
                <p className="photo-selector__settings-empty" style={{ marginTop: "0.3rem" }}>
                  RAW render cache hit (sessione): {desktopThumbnailCacheInfo.rawRenderCacheHit}
                </p>
              ) : null}
              {(desktopThumbnailCacheInfo.effectiveThumbnailRamMaxBytes
                || desktopThumbnailCacheInfo.effectiveRenderedPreviewMaxBytes
                || desktopThumbnailCacheInfo.effectivePreviewSourceMaxBytes) ? (
                <p className="photo-selector__settings-empty" style={{ marginTop: "0.3rem" }}>
                  Limiti auto cache RAM:
                  {desktopThumbnailCacheInfo.effectiveThumbnailRamMaxBytes
                    ? ` Thumb ${desktopThumbnailCacheInfo.effectiveThumbnailRamMaxEntries ?? "?"} / ${formatBytes(desktopThumbnailCacheInfo.effectiveThumbnailRamMaxBytes)}`
                    : ""}
                  {desktopThumbnailCacheInfo.effectiveRenderedPreviewMaxBytes
                    ? ` · Render ${desktopThumbnailCacheInfo.effectiveRenderedPreviewMaxEntries ?? "?"} / ${formatBytes(desktopThumbnailCacheInfo.effectiveRenderedPreviewMaxBytes)}`
                    : ""}
                  {desktopThumbnailCacheInfo.effectivePreviewSourceMaxBytes
                    ? ` · Source ${desktopThumbnailCacheInfo.effectivePreviewSourceMaxEntries ?? "?"} / ${formatBytes(desktopThumbnailCacheInfo.effectivePreviewSourceMaxBytes)}`
                    : ""}
                </p>
              ) : null}
              <p className="photo-selector__settings-empty" style={{ marginTop: "0.3rem" }}>
                Percorso predefinito: {desktopThumbnailCacheInfo.defaultPath}
              </p>
              <p className="photo-selector__settings-empty" style={{ marginTop: "0.3rem" }}>
                Drive attuale: {cacheLocationSummary.current}
              </p>
              {cacheLocationSummary.recommended ? (
                <p className="photo-selector__settings-empty" style={{ marginTop: "0.3rem" }}>
                  Percorso consigliato: {cacheLocationSummary.recommended}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="photo-selector__settings-section">
            <h4 className="photo-selector__settings-section-title">
              Preset filtri
              <button
                type="button"
                className="photo-selector__settings-info-btn"
                title="Un preset salva la combinazione attuale di filtri (stelle, stato, colore, cartella...) con un nome. Utile per richiamare in un click un insieme di filtri che usi spesso — es. &#39;Migliori Pick&#39; = Pick + 4 stelle + verde."
              >
                ?
              </button>
            </h4>
            <div className="photo-selector__settings-preset-row">
              <input
                type="text"
                className="photo-selector__settings-color-input"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                placeholder="Nome preset…"
                onKeyDown={(e) => e.key === "Enter" && handleSavePreset()}
              />
              <button
                type="button"
                className="ghost-button ghost-button--small"
                onClick={handleSavePreset}
                disabled={!newPresetName.trim()}
              >
                Salva
              </button>
            </div>
            {filterPresets.length === 0 && (
              <p className="photo-selector__settings-empty">Nessun preset salvato.</p>
            )}
            {filterPresets.map((preset) => (
              <div key={preset.id} className="photo-selector__settings-preset-item">
                <button
                  type="button"
                  className="ghost-button ghost-button--small photo-selector__settings-preset-name"
                  onClick={() => applyPreset(preset)}
                >
                  {preset.name}
                </button>
                <button
                  type="button"
                  className="icon-button icon-button--danger"
                  onClick={() => removePreset(preset.id)}
                  title="Elimina preset"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </aside>
      )}

      {isDesktopCacheRecommendationModalOpen && desktopCacheLocationRecommendation?.recommendedPath ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal-panel photo-selector__cache-recommendation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cache-recommendation-title"
          >
            <div className="modal-panel__header">
              <div>
                <strong id="cache-recommendation-title">Spazio disco e cache</strong>
                <p>
                  C: ha poco spazio libero. Possiamo spostare le cache pesanti gestite da Selezione Foto su un disco più capiente.
                </p>
              </div>
            </div>
            <div className="modal-panel__body">
              <div className="photo-selector__cache-recommendation-grid">
                <div className="photo-selector__cache-recommendation-card">
                  <span className="photo-selector__cache-recommendation-label">Percorso attuale</span>
                  <strong>{desktopCacheLocationRecommendation.currentPath}</strong>
                  <p>{cacheLocationSummary.current}</p>
                </div>
                <div className="photo-selector__cache-recommendation-card">
                  <span className="photo-selector__cache-recommendation-label">Percorso consigliato</span>
                  <strong>{desktopCacheLocationRecommendation.recommendedPath}</strong>
                  <p>{cacheLocationSummary.recommended ?? "Disco consigliato non disponibile"}</p>
                </div>
              </div>
              <p className="photo-selector__settings-empty">
                Copiamo thumbnail e quick preview già create, poi passiamo al nuovo percorso e liberiamo quello vecchio se tutto va bene.
              </p>
            </div>
            <div className="modal-panel__footer">
              <button
                type="button"
                className="ghost-button"
                onClick={() => void onSnoozeDesktopCacheRecommendation?.()}
                disabled={isDesktopThumbnailCacheBusy || !onSnoozeDesktopCacheRecommendation}
              >
                Più tardi
              </button>
              <div className="photo-selector__cache-recommendation-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => void onDismissDesktopCacheRecommendation?.()}
                  disabled={isDesktopThumbnailCacheBusy || !onDismissDesktopCacheRecommendation}
                >
                  Non mostrare più
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void onUseRecommendedDesktopThumbnailCacheDirectory?.()}
                  disabled={isDesktopThumbnailCacheBusy || !onUseRecommendedDesktopThumbnailCacheDirectory}
                >
                  Sposta ora
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {/* Backdrop: transparent overlay that closes the context menu when clicked outside */}
      {contextMenuState && (
        <div
          className="photo-selector__context-backdrop"
          onClick={() => setContextMenuState(null)}
          onContextMenu={(e) => e.preventDefault()}
        />
      )}

      {contextMenuState ? (
        <PhotoSelectionContextMenu
          x={contextMenuState.x}
          y={contextMenuState.y}
          targetCount={contextMenuState.targetIds.length}
          colorLabelNames={customColorNames}
          hasFileAccess={Boolean(window.filexDesktop?.sendToEditor)}
          rootFolderPath={effectiveRootFolderPath || undefined}
          targetPath={contextMenuState.targetIds.length === 1 ? (getAssetRelativePath(contextMenuState.targetIds[0]) ?? undefined) : undefined}
          onApplyRating={(rating) => {
            applyBatchChanges(contextMenuState.targetIds, { rating });
            setContextMenuState(null);
          }}
          onApplyPickStatus={(pickStatus) => {
            applyBatchChanges(contextMenuState.targetIds, { pickStatus });
            setContextMenuState(null);
          }}
          onApplyColor={(colorLabel) => {
            applyBatchChanges(contextMenuState.targetIds, { colorLabel });
            setContextMenuState(null);
          }}
          onInvertVisible={() => {
            invertVisibleSelection();
            setContextMenuState(null);
          }}
          onClearSelection={() => {
            clearSelection();
            setContextMenuState(null);
          }}
          onToggleSelection={() => {
            if (contextMenuState.targetIds.length === 1) {
              togglePhoto(contextMenuState.targetIds[0]);
            } else {
              invertVisibleSelection();
            }
            setContextMenuState(null);
          }}
          onOpenPreview={() => {
            if (contextMenuState.targetIds.length > 0) {
              handlePreview(contextMenuState.targetIds[0]);
            }
            setContextMenuState(null);
          }}
          onCopyFiles={() => {
            const ids = [...contextMenuState.targetIds];
            setContextMenuState(null);
            void handleCopyFiles(ids);
          }}
          onMoveFiles={() => {
            const ids = [...contextMenuState.targetIds];
            setContextMenuState(null);
            void handleMoveFiles(ids);
          }}
          onSaveAs={() => {
            const ids = [...contextMenuState.targetIds];
            setContextMenuState(null);
            void handleSaveAs(ids);
          }}
          onCopyPath={() => {
            handleCopyPath(contextMenuState.targetIds, effectiveRootFolderPath);
            setContextMenuState(null);
          }}
          onOpenWithEditor={() => {
            const ids = [...contextMenuState.targetIds];
            setContextMenuState(null);
            handleOpenWithEditor(ids);
          }}
        />
      ) : null}

      {isCompareOpen && selectedIds.length >= 2 && (
        <CompareModal
          photos={photos.filter((p) => selectedSet.has(p.id)).slice(0, 4)}
          onClose={() => setIsCompareOpen(false)}
          onUpdatePhoto={(id, changes) => updatePhoto(id, changes)}
        />
      )}
    </div>
  );
}

