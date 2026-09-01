import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  DesktopCacheLocationRecommendation,
  DesktopDiskCacheBudgetPreset,
  DesktopDragOutCheck,
  DesktopEditorCandidate,
  DesktopGraphicsStatus,
  DesktopRamBudgetPreset,
  DesktopPsdJpegConversionProgress,
  DesktopSelectionMode,
  DesktopThumbnailCacheInfo,
} from "@photo-tools/desktop-contracts";
import type { ColorLabel, ImageAsset, PickStatus } from "@photo-tools/shared-types";
import { PhotoQuickPreviewModal } from "./PhotoQuickPreviewModal";
import { PhotoCard } from "./PhotoCard";
import { PhotoSelectionContextMenu } from "./PhotoSelectionContextMenu";
import { PsdJpegConversionModal } from "./PsdJpegConversionModal";
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
  isRawFile,
} from "../services/folder-access";
import {
  cancelPsdJpegConversion,
  getPsdJpegConversionProgress,
  startPsdJpegConversion,
} from "../services/psd-jpeg-conversion";
import {
  COLOR_LABEL_NAMES,
  COLOR_LABELS,
  DEFAULT_PHOTO_FILTERS,
  JPEG_EXTENSIONS,
  PSD_EXTENSIONS,
  RAW_EXTENSIONS,
  getAssetColorLabel,
  getAssetFileExtension,
  getAssetGroupingKey,
  getAssetGroupingPriority,
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
  subscribePhotoSelectorPreferenceSaveFailures,
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
import { DockableWorkspace } from "./workspace/DockableWorkspace";
import { useWorkspacePanelLayout } from "./workspace/useWorkspacePanelLayout";
import { getThumbnailView } from "../services/thumbnail-view-store";
import { useThumbnailView } from "../services/use-thumbnail-view";
import { getAssetRotation, rotateImage, type RotationDirection } from "../services/photo-rotation";
import {
  buildToggleAllSelection,
  countSelectionOutsideFilter,
  resolveRotationTargetIds,
  togglePhotoSelection,
} from "../services/photo-selection";
import { PhotoFilterPanel } from "./selector/PhotoFilterPanel";
import { QuickStatsPanel } from "./selector/QuickStatsPanel";
import { SelectionActionsPanel } from "./selector/SelectionActionsPanel";
import { ViewControlsPanel } from "./selector/ViewControlsPanel";

interface PhotoSelectorProps {
  photos: ImageAsset[];
  metadataVersion: number;
  sourceFolderPath?: string;
  initialFolderFilter?: string | null;
  workspaceMode: DesktopSelectionMode | null;
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
  desktopGraphicsStatus?: DesktopGraphicsStatus | null;
  onThumbnailProfileChange?: (profile: ThumbnailProfile) => void;
  onSortCacheEnabledChange?: (enabled: boolean) => void;
  desktopThumbnailCacheInfo?: DesktopThumbnailCacheInfo | null;
  desktopPerformanceFeedback?: {
    message: string;
    tone: "success" | "error" | "warning";
  } | null;
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
  onDiskCacheBudgetPresetChange?: (preset: DesktopDiskCacheBudgetPreset) => void | Promise<void>;
  onRefreshDesktopThumbnailCacheInfo?: () => void | Promise<void>;
  onPsdJpegConversionComplete?: () => void | Promise<void>;
}

type SortMode = "name" | "orientation" | "rating" | "createdAt";
type CreatedAtSortDirection = "asc" | "desc";
type PickFilter = "all" | PickStatus;
type ColorFilter = "all" | ColorLabel;
type FormatFilter = "all" | "jpg" | "raw" | "raw+jpg" | "psd";

function useLatestCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  return useCallback((...args: Args) => callbackRef.current(...args), []);
}
type PhotoMetadataChanges = Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel" | "customLabels" | "rotationDegrees">>;
type BatchPulseKind = "dot" | "label";
type PreviewFeedbackKind = "star" | "pill" | "dot" | "label";
type PreviewSyncFeedback = {
  token: number;
  assetIds: string[];
  kind: PreviewFeedbackKind;
  label: string;
  tone?: CustomLabelTone;
  labels?: string[];
};
type PhotoGroupInfo = {
  size: number;
  rawCount: number;
  jpegCount: number;
  leaderId: string | null;
};
const CUSTOM_LABEL_TONES: CustomLabelTone[] = ["sand", "rose", "green", "blue", "purple", "slate"];

const GRID_GAP_PX = 12;
const CARD_STAGE_HEIGHT_RATIO = 0.75;
const QUICK_PREVIEW_FIT_MAX_DIMENSION = 2048;
const CARD_CHROME_HEIGHT_PX = 64;
const VIRTUAL_OVERSCAN_ROWS = 4;
const PRIORITY_PREFETCH_ROWS_BEFORE = 2;
const PRIORITY_PREFETCH_ROWS_AFTER = 6;
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
  if (changes.rotationDegrees !== undefined) {
    return `${subject}: rotazione ${changes.rotationDegrees}°`;
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
}: {
  systemTotalMemoryBytes: number;
  activePreset: DesktopRamBudgetPreset | null;
  activeRamBudgetBytes: number | null;
  onPresetChange: (preset: DesktopRamBudgetPreset) => void | Promise<void>;
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
            {applying ? "Applico…" : "Applica"}
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

// Revoca una blob: URL precedente quando viene rimpiazzata da una nuova URL
// diversa. Ignora valori falsy, URL identiche e URL non-blob (es. http:, file:).
function revokeBlobUrlIfReplaced(previous: string | undefined, next: string | undefined): void {
  if (!previous || !next || previous === next) return;
  if (!previous.startsWith("blob:")) return;
  try {
    URL.revokeObjectURL(previous);
  } catch {
    // ignore: revokeObjectURL non lancia mai in pratica, ma siamo difensivi.
  }
}

export function PhotoSelector({
  photos,
  metadataVersion,
  sourceFolderPath = "",
  initialFolderFilter = null,
  workspaceMode,
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
  desktopGraphicsStatus = null,
  onThumbnailProfileChange,
  onSortCacheEnabledChange,
  desktopThumbnailCacheInfo = null,
  desktopPerformanceFeedback = null,
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
  onDiskCacheBudgetPresetChange,
  onRefreshDesktopThumbnailCacheInfo,
  onPsdJpegConversionComplete,
}: PhotoSelectorProps) {
  const { addToast } = useToast();
  const [sortBy, setSortBy] = useState<SortMode>("name");
  const [createdAtSortDirection, setCreatedAtSortDirection] = useState<CreatedAtSortDirection>("desc");
  const [pickFilter, setPickFilter] = useState<PickFilter>(DEFAULT_PHOTO_FILTERS.pickStatus);
  const [ratingFilter, setRatingFilter] = useState(DEFAULT_PHOTO_FILTERS.ratingFilter);
  const [colorFilter, setColorFilter] = useState<ColorFilter>(DEFAULT_PHOTO_FILTERS.colorLabel);
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("all");
  const [customLabelFilter, setCustomLabelFilter] = useState<string>("all");
  const [folderFilter, setFolderFilter] = useState<string>("all");
  const [seriesFilter, setSeriesFilter] = useState<string>("all");
  const [timeClusterFilter, setTimeClusterFilter] = useState<string>("all");

  useEffect(() => {
    setFolderFilter(initialFolderFilter?.trim() || "all");
  }, [initialFolderFilter, sourceFolderPath]);
  const [searchQuery, setSearchQuery] = useState("");
  const [customColorNames, setCustomColorNames] = useState<Record<ColorLabel, string>>(() => ({ ...COLOR_LABEL_NAMES }));
  const [customLabelsCatalog, setCustomLabelsCatalog] = useState<string[]>([]);
  const [customLabelColors, setCustomLabelColors] = useState<Record<string, CustomLabelTone>>({});
  const [customLabelShortcuts, setCustomLabelShortcuts] = useState<Record<string, CustomLabelShortcut | null>>({});
  const [filterPresets, setFilterPresets] = useState<PhotoFilterPreset[]>([]);
  const [selectedThumbnailProfile, setSelectedThumbnailProfile] = useState<ThumbnailProfile>(thumbnailProfile);
  const [isSortCacheEnabled, setIsSortCacheEnabled] = useState<boolean>(sortCacheEnabled);
  const [autoAdvanceOnAction, setAutoAdvanceOnAction] = useState<boolean>(true);
  const [newPresetName, setNewPresetName] = useState("");
  const [newCustomLabelName, setNewCustomLabelName] = useState("");
  const [newCustomLabelTone, setNewCustomLabelTone] = useState<CustomLabelTone>(DEFAULT_CUSTOM_LABEL_TONE);
  const [newCustomLabelShortcut, setNewCustomLabelShortcut] = useState<CustomLabelShortcut | null>(null);
  const [newBatchCustomLabelName, setNewBatchCustomLabelName] = useState("");
  const [newBatchCustomLabelTone, setNewBatchCustomLabelTone] = useState<CustomLabelTone>(DEFAULT_CUSTOM_LABEL_TONE);
  const [newBatchCustomLabelShortcut, setNewBatchCustomLabelShortcut] = useState<CustomLabelShortcut | null>(null);
  const [timelineEntries, setTimelineEntries] = useState<Array<{ id: string; label: string }>>([]);
  const [isBatchToolsOpen, setIsBatchToolsOpen] = useState(false);
  const [isAdvancedFiltersOpen, setIsAdvancedFiltersOpen] = useState(false);
  const [isSelectionActionsOpen, setIsSelectionActionsOpen] = useState(false);
  const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const {
    layout: workspacePanelLayout,
    movePanel: moveWorkspacePanel,
    togglePanel: toggleWorkspacePanel,
  } = useWorkspacePanelLayout();
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
  const [psdConversionTargetIds, setPsdConversionTargetIds] = useState<string[] | null>(null);
  const [psdConversionProgress, setPsdConversionProgress] = useState<DesktopPsdJpegConversionProgress | null>(null);
  const [isPsdConversionStarting, setIsPsdConversionStarting] = useState(false);
  const [focusedPhotoId, setFocusedPhotoId] = useState<string | null>(null);
  const [previewStartsZoomed, setPreviewStartsZoomed] = useState(false);
  const lastPreviewAssetIdRef = useRef<string | null>(null);
  const completedPsdConversionJobIdRef = useRef<string | null>(null);
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
  const lastAppliedGridResetSignatureRef = useRef<string | null>(null);
  const frozenDynamicSortOrderRef = useRef<{ sortBy: SortMode; signature: string; ids: string[] } | null>(null);
  const batchPulseTokenRef = useRef(0);
  const batchPulseClearTimerRef = useRef<number | null>(null);
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);
  const [dragRect, setDragRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [gridViewport, setGridViewport] = useState({ width: 0, height: 720 });
  const [batchPulseState, setBatchPulseState] = useState<{
    token: number;
    kind: BatchPulseKind;
    ids: Set<string>;
  } | null>(null);
  const previewFeedbackTokenRef = useRef(0);
  const cardFeedbackTokenRef = useRef(0);
  const [previewSyncFeedback, setPreviewSyncFeedback] = useState<PreviewSyncFeedback | null>(null);
  const [cardSyncFeedback, setCardSyncFeedback] = useState<PreviewSyncFeedback | null>(null);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const effectiveRootFolderPath = useMemo(
    () => rootFolderPathOverride.trim() || sourceFolderPath.trim(),
    [rootFolderPathOverride, sourceFolderPath],
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedIdsRef = useRef(selectedIds);
  const selectedSetRef = useRef(selectedSet);
  const lastSelectedIdsPropRef = useRef(selectedIds);
  if (lastSelectedIdsPropRef.current !== selectedIds) {
    lastSelectedIdsPropRef.current = selectedIds;
    selectedIdsRef.current = selectedIds;
    selectedSetRef.current = selectedSet;
  }
  // Thumbnail batches replace the photo array many times per second. Metadata
  // only needs rebuilding for actual metadata changes and once at pipeline end,
  // when orientation-based sorting can consume the final thumbnail dimensions.
  const metadataPhotos = photos;
  const metadataIndex = useMemo(() => {
    const assetById = new Map<string, ImageAsset>();
    const searchTextById = new Map<string, string>();
    const seriesCounts = new Map<string, number>();
    const timeClusterCounts = new Map<string, number>();
    const customLabelCounts = new Map<string, number>();

    for (const photo of metadataPhotos) {
      assetById.set(photo.id, photo);
      searchTextById.set(photo.id, photo.fileName.toLocaleLowerCase());
      const seriesKey = getSeriesKey(photo);
      seriesCounts.set(seriesKey, (seriesCounts.get(seriesKey) ?? 0) + 1);
      const timeClusterKey = getTimeClusterKey(photo);
      timeClusterCounts.set(timeClusterKey, (timeClusterCounts.get(timeClusterKey) ?? 0) + 1);
      for (const label of normalizeAssetCustomLabels(photo.customLabels)) {
        customLabelCounts.set(label, (customLabelCounts.get(label) ?? 0) + 1);
      }
    }

    return { assetById, searchTextById, seriesCounts, timeClusterCounts, customLabelCounts };
  }, [metadataPhotos]);
  const metadataAssetById = metadataIndex.assetById;
  const currentFolderPhotos = useMemo(
    () => folderFilter === "all"
      ? metadataPhotos
      : metadataPhotos.filter((photo) => getSubfolder(photo.path) === folderFilter),
    [folderFilter, metadataPhotos],
  );
  const currentFolderPhotoIdSet = useMemo(
    () => new Set(currentFolderPhotos.map((photo) => photo.id)),
    [currentFolderPhotos],
  );
  const currentFolderSelectedIds = useMemo(
    () => selectedIds.filter((photoId) => currentFolderPhotoIdSet.has(photoId)),
    [currentFolderPhotoIdSet, selectedIds],
  );
  const assetById = metadataAssetById;
  const selectedPsdIds = useMemo(
    () => selectedIds.filter((id) => {
      const asset = assetById.get(id);
      return Boolean(asset && PSD_EXTENSIONS.has(getAssetFileExtension(asset)));
    }),
    [assetById, selectedIds],
  );
  const photosRef = useRef(photos);
  const lastPhotosPropRef = useRef(photos);
  if (lastPhotosPropRef.current !== photos) {
    lastPhotosPropRef.current = photos;
    photosRef.current = photos;
  }

  const commitSelection = useLatestCallback((nextIds: readonly string[]) => {
    const normalizedIds = Array.from(new Set(nextIds));
    selectedIdsRef.current = normalizedIds;
    selectedSetRef.current = new Set(normalizedIds);
    onSelectionChange(normalizedIds);
  });

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
        formatFilter !== "all",
        customLabelFilter !== "all",
        folderFilter !== "all",
        seriesFilter !== "all",
        timeClusterFilter !== "all",
        searchQuery !== "",
      ].filter(Boolean).length,
    [pickFilter, ratingFilter, colorFilter, formatFilter, customLabelFilter, folderFilter, seriesFilter, timeClusterFilter, searchQuery]
  );

  // Statistiche aggregate sulla cartella visualizzata: utili come "vital signs"
  // sempre visibili in cima alla griglia, indipendentemente da selezione/filtri.
  const folderStats = useMemo(() => {
    const total = currentFolderPhotos.length;
    if (total === 0) return null;
    let picked = 0;
    let rejected = 0;
    for (const p of currentFolderPhotos) {
      const status = getAssetPickStatus(p);
      if (status === "picked") picked += 1;
      else if (status === "rejected") rejected += 1;
    }
    const decided = picked + rejected;
    const completionPct = Math.round((decided / total) * 100);
    return { total, picked, rejected, completionPct };
  }, [currentFolderPhotos]);

  const selectionStats = useMemo(() => {
    if (currentFolderSelectedIds.length === 0) return null;
    const sel = currentFolderSelectedIds
      .map((photoId) => metadataAssetById.get(photoId))
      .filter((photo): photo is ImageAsset => !!photo);
    return {
      picked: sel.filter((p) => getAssetPickStatus(p) === "picked").length,
      rejected: sel.filter((p) => getAssetPickStatus(p) === "rejected").length,
      highRating: sel.filter((p) => getAssetRating(p) >= 3).length,
    };
  }, [currentFolderSelectedIds, metadataAssetById]);

  const hasActiveFilters =
    pickFilter !== "all" ||
    ratingFilter !== "any" ||
    colorFilter !== "all" ||
    formatFilter !== "all" ||
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
  const emitPreviewSyncFeedback = useCallback((feedback: Omit<PreviewSyncFeedback, "token"> | null) => {
    if (!feedback || feedback.assetIds.length === 0) {
      return;
    }
    previewFeedbackTokenRef.current += 1;
    setPreviewSyncFeedback({
      ...feedback,
      token: previewFeedbackTokenRef.current,
    });
  }, []);
  const emitCardSyncFeedback = useCallback((feedback: Omit<PreviewSyncFeedback, "token"> | null) => {
    if (!feedback || feedback.assetIds.length === 0) {
      return;
    }
    cardFeedbackTokenRef.current += 1;
    setCardSyncFeedback({
      ...feedback,
      token: cardFeedbackTokenRef.current,
    });
  }, []);
  const buildPreviewSyncFeedback = useCallback((
    changes: PhotoMetadataChanges,
    assetIds: string[],
  ): Omit<PreviewSyncFeedback, "token"> | null => {
    const uniqueIds = Array.from(new Set(assetIds));
    if (uniqueIds.length === 0) {
      return null;
    }

    if (changes.rating !== undefined) {
      return {
        assetIds: uniqueIds,
        kind: "star",
        label: changes.rating > 0 ? `Valutazione: ${"★".repeat(changes.rating)}` : "Valutazione rimossa",
      };
    }
    if (changes.pickStatus !== undefined) {
      return {
        assetIds: uniqueIds,
        kind: "pill",
        label: `Stato: ${changes.pickStatus === "picked" ? "Pick" : changes.pickStatus === "rejected" ? "Scartata" : "Neutra"}`,
      };
    }
    if (changes.colorLabel !== undefined) {
      return {
        assetIds: uniqueIds,
        kind: "dot",
        label: changes.colorLabel ? `Colore: ${COLOR_LABEL_NAMES[changes.colorLabel]}` : "Colore rimosso",
      };
    }
    if (changes.customLabels !== undefined) {
      const normalized = normalizeAssetCustomLabels(changes.customLabels);
      const firstLabel = normalized[0];
      return {
        assetIds: uniqueIds,
        kind: "label",
        label: normalized.length > 0 ? `Etichette: ${normalized.join(", ")}` : "Etichette personalizzate rimosse",
        tone: firstLabel ? (customLabelColors[firstLabel] ?? DEFAULT_CUSTOM_LABEL_TONE) : undefined,
        labels: normalized.length > 0 ? normalized : undefined,
      };
    }

    return null;
  }, [customLabelColors]);

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
      setAutoAdvanceOnAction(preferences.autoAdvanceOnAction);
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

  useEffect(() => subscribePhotoSelectorPreferenceSaveFailures((preferences) => {
    setCustomColorNames(preferences.colorNames);
    setFilterPresets(preferences.filterPresets);
    setCustomLabelsCatalog(preferences.customLabelsCatalog);
    setCustomLabelColors(preferences.customLabelColors);
    setCustomLabelShortcuts(preferences.customLabelShortcuts);
    setSelectedThumbnailProfile(preferences.thumbnailProfile);
    setIsSortCacheEnabled(preferences.sortCacheEnabled);
    setAutoAdvanceOnAction(preferences.autoAdvanceOnAction);
    setCardSize(preferences.cardSize);
    setRootFolderPathOverride(preferences.rootFolderPathOverride);
    setPreferredEditorPath(sanitizeEditorExecutablePath(preferences.preferredEditorPath));
    addToast("Salvataggio impostazioni non riuscito: valori precedenti ripristinati.", "error", 5000);
  }), [addToast]);

  useEffect(() => {
    if (!isSettingsPanelOpen || !onRefreshDesktopThumbnailCacheInfo) {
      return;
    }

    void onRefreshDesktopThumbnailCacheInfo();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void onRefreshDesktopThumbnailCacheInfo();
      }
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [isSettingsPanelOpen, onRefreshDesktopThumbnailCacheInfo]);

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
    changes: PhotoMetadataChanges,
    source: "grid" | "modal" = "grid",
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
      const nextRotation = changes.rotationDegrees !== undefined
        ? changes.rotationDegrees
        : getAssetRotation(photo);

      if (
        nextRating === photo.rating &&
        nextPickStatus === photo.pickStatus &&
        nextColorLabel === photo.colorLabel &&
        nextRotation === getAssetRotation(photo) &&
        areStringArraysEqual(nextCustomLabels, normalizeAssetCustomLabels(photo.customLabels))
      ) {
        return photo;
      }

      changed = true;
      return {
        ...photo,
        ...changes,
        customLabels: nextCustomLabels,
        rotationDegrees: nextRotation,
      };
    });

    if (changed) {
      onPhotosChange(nextPhotos);
      pushTimelineEntry(describeMetadataChanges(changes, 1));
      addToast(describeMetadataChanges(changes, 1), "success", 1800);
      if (source === "grid") {
        emitPreviewSyncFeedback(buildPreviewSyncFeedback(changes, [id]));
      } else if (source === "modal") {
        emitCardSyncFeedback(buildPreviewSyncFeedback(changes, [id]));
      }
    }
  }, [addToast, buildPreviewSyncFeedback, emitCardSyncFeedback, emitPreviewSyncFeedback, onPhotosChange, photos, pushTimelineEntry]);

  function resetFilters() {
    setPickFilter("all");
    setFormatFilter("all");
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
        formatFilter,
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
  }, [colorFilter, customColorNames, customLabelFilter, customLabelsCatalog, folderFilter, formatFilter, newPresetName, persistPreferences, pickFilter, ratingFilter, searchQuery, seriesFilter, timeClusterFilter]);

  const applyPreset = useCallback((preset: PhotoFilterPreset) => {
    setPickFilter(preset.filters.pickStatus);
    setRatingFilter(preset.filters.ratingFilter);
    setColorFilter(preset.filters.colorLabel);
    setFormatFilter((preset.filters.formatFilter as FormatFilter | undefined) ?? "all");
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

  const handleAutoAdvanceChange = useCallback((nextEnabled: boolean) => {
    setAutoAdvanceOnAction(nextEnabled);
    savePhotoSelectorPreferences({ autoAdvanceOnAction: nextEnabled });
    pushTimelineEntry(
      nextEnabled
        ? "Avanzamento automatico dopo classificazione: ON"
        : "Avanzamento automatico dopo classificazione: OFF",
    );
  }, [pushTimelineEntry]);

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
    return Array.from(metadataIndex.seriesCounts.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
  }, [metadataIndex]);
  const timeClusters = useMemo(() => {
    return Array.from(metadataIndex.timeClusterCounts.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((left, right) => left.key.localeCompare(right.key));
  }, [metadataIndex]);
  const customLabelFilterOptions = useMemo(() => {
    // Also discover labels already present in the project. This keeps the
    // filter available when a project/XMP was opened on another computer and
    // its local preferences do not yet contain the label catalog.
    const labels = [...customLabelsCatalog];
    for (const label of metadataIndex.customLabelCounts.keys()) {
      if (!labels.some((knownLabel) => knownLabel.toLocaleLowerCase() === label.toLocaleLowerCase())) {
        labels.push(label);
      }
    }

    return labels
      .map((label) => ({ label, count: metadataIndex.customLabelCounts.get(label) ?? 0 }))
      .filter(({ count }) => count > 0);
  }, [customLabelsCatalog, metadataIndex]);

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
      if (formatFilter !== "all") {
        const kind = photo.groupKind ?? (isRawFile(photo.fileName) ? "raw" : "standard");
        if (formatFilter === "raw+jpg" && kind !== "raw+jpg") {
          continue;
        }
        if (formatFilter === "raw" && kind !== "raw") {
          continue;
        }
        if (formatFilter === "jpg") {
          // "JPG" matches plain JPG cards (no companion). Grouped cards are
          // surfaced under the dedicated "RAW + JPG" option to match the
          // labelling on the card badge.
          if (kind !== "standard" || isRawFile(photo.fileName) || PSD_EXTENSIONS.has(getAssetFileExtension(photo))) {
            continue;
          }
        }
        if (formatFilter === "psd" && !PSD_EXTENSIONS.has(getAssetFileExtension(photo))) {
          continue;
        }
      }
      if (timeClusterFilter !== "all" && getTimeClusterKey(photo) !== timeClusterFilter) {
        continue;
      }
      if (lowerSearch && !metadataIndex.searchTextById.get(photo.id)?.includes(lowerSearch)) {
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
    formatFilter,
    metadataAssetById,
    metadataIndex,
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
  const comparePhotos = useMemo(
    () => selectedIds
      .filter((photoId) => visiblePhotoIdSet.has(photoId))
      .sort((left, right) => (
        (visiblePhotoIndexById.get(left) ?? Number.MAX_SAFE_INTEGER)
        - (visiblePhotoIndexById.get(right) ?? Number.MAX_SAFE_INTEGER)
      ))
      .map((photoId) => assetById.get(photoId))
      .filter((photo): photo is ImageAsset => Boolean(photo)),
    [assetById, selectedIds, visiblePhotoIdSet, visiblePhotoIndexById],
  );
  const canComparePhotos = comparePhotos.length >= 2 && comparePhotos.length <= 4;
  const openCompare = useCallback(() => {
    if (!canComparePhotos) {
      addToast("Per confrontare, seleziona da 2 a 4 foto visibili nella griglia.", "info");
      return;
    }
    setIsCompareOpen(true);
  }, [addToast, canComparePhotos]);
  const photoGroupKeyById = useMemo(() => {
    const mapping = new Map<string, string>();
    for (const photoId of visiblePhotoIds) {
      const photo = metadataAssetById.get(photoId);
      if (!photo) {
        continue;
      }
      mapping.set(photoId, getAssetGroupingKey(photo));
    }
    return mapping;
  }, [metadataAssetById, visiblePhotoIds]);
  const photoGroupInfoByKey = useMemo(() => {
    const grouped = new Map<string, {
      ids: string[];
      rawCount: number;
      jpegCount: number;
      leaderId: string;
    }>();

    for (const photoId of visiblePhotoIds) {
      const photo = metadataAssetById.get(photoId);
      if (!photo) {
        continue;
      }

      const key = getAssetGroupingKey(photo);
      const extension = getAssetFileExtension(photo);
      const isRaw = RAW_EXTENSIONS.has(extension);
      const isJpeg = JPEG_EXTENSIONS.has(extension);
      const current = grouped.get(key);
      if (!current) {
        grouped.set(key, {
          ids: [photoId],
          rawCount: isRaw ? 1 : 0,
          jpegCount: isJpeg ? 1 : 0,
          leaderId: photoId,
        });
        continue;
      }

      current.ids.push(photoId);
      if (isRaw) {
        current.rawCount += 1;
      }
      if (isJpeg) {
        current.jpegCount += 1;
      }
      const leader = metadataAssetById.get(current.leaderId);
      if (leader) {
        const priorityDiff = getAssetGroupingPriority(photo) - getAssetGroupingPriority(leader);
        if (priorityDiff < 0 || (priorityDiff === 0 && photo.fileName.localeCompare(leader.fileName) < 0)) {
          current.leaderId = photoId;
        }
      }
    }

    const result = new Map<string, PhotoGroupInfo>();
    for (const [key, info] of grouped.entries()) {
      result.set(key, {
        size: info.ids.length,
        rawCount: info.rawCount,
        jpegCount: info.jpegCount,
        leaderId: info.leaderId,
      });
    }
    return result;
  }, [metadataAssetById, visiblePhotoIds]);
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
    overscan: VIRTUAL_OVERSCAN_ROWS,
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
  const viewportPhotoIds = useMemo(() => {
    if (visiblePhotoIds.length === 0) {
      return [] as string[];
    }

    const grid = gridRef.current;
    if (!grid || gridRowHeight <= 0) {
      return renderedPhotoIds;
    }

    const firstVisibleRow = Math.max(
      0,
      Math.min(totalVirtualRows - 1, Math.floor(grid.scrollTop / gridRowHeight)),
    );
    const visibleRowCount = Math.max(1, Math.ceil(grid.clientHeight / gridRowHeight) + 1);
    const startIndex = firstVisibleRow * gridColumnCount;
    const endIndex = Math.min(
      visiblePhotoIds.length,
      (firstVisibleRow + visibleRowCount) * gridColumnCount,
    );
    return visiblePhotoIds.slice(startIndex, endIndex);
  }, [gridColumnCount, gridRowHeight, renderedPhotoIds, totalVirtualRows, virtualRows, visiblePhotoIds]);
  const viewportPriorityIds = useMemo(() => {
    if (visiblePhotoIds.length === 0) {
      return [] as string[];
    }

    const grid = gridRef.current;
    if (!grid || gridRowHeight <= 0 || virtualRows.length === 0) {
      const fallbackCount = Math.min(
        visiblePhotoIds.length,
        Math.max(
          gridColumnCount * (PRIORITY_PREFETCH_ROWS_BEFORE + PRIORITY_PREFETCH_ROWS_AFTER + 2),
          gridColumnCount * 6,
        ),
      );
      return visiblePhotoIds.slice(0, Math.min(PRIORITY_PREFETCH_MAX_IDS, fallbackCount));
    }

    const firstVisibleRow = Math.max(
      0,
      Math.min(totalVirtualRows - 1, Math.floor(grid.scrollTop / gridRowHeight)),
    );
    const visibleRowCount = Math.max(1, Math.ceil(grid.clientHeight / gridRowHeight) + 1);
    const lastVisibleRow = Math.min(totalVirtualRows - 1, firstVisibleRow + visibleRowCount - 1);
    const rowStart = Math.max(0, firstVisibleRow - PRIORITY_PREFETCH_ROWS_BEFORE);
    const rowEndExclusive = Math.min(
      totalVirtualRows,
      lastVisibleRow + 1 + PRIORITY_PREFETCH_ROWS_AFTER,
    );
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
  }, [gridColumnCount, gridRowHeight, totalVirtualRows, virtualRows, visiblePhotoIds]);
  const renderedPhotos = useMemo(
    () => renderedPhotoIds
      .map((photoId) => assetById.get(photoId))
      .filter((photo): photo is ImageAsset => Boolean(photo)),
    [assetById, renderedPhotoIds],
  );
  const renderedPhotoCardMeta = useMemo(() => renderedPhotos.map((photo) => {
    const groupKey = photoGroupKeyById.get(photo.id);
    const groupInfo = groupKey ? photoGroupInfoByKey.get(groupKey) : null;

    if (!groupInfo || groupInfo.size <= 1) {
      return { photo, groupBadge: null, isGroupLeader: false };
    }

    const badgeParts: string[] = [];
    if (groupInfo.rawCount > 0) {
      badgeParts.push(groupInfo.rawCount > 1 ? `${groupInfo.rawCount} RAW` : "RAW");
    }
    if (groupInfo.jpegCount > 0) {
      badgeParts.push(groupInfo.jpegCount > 1 ? `${groupInfo.jpegCount} JPG` : "JPG");
    }
    if (badgeParts.length === 0) {
      badgeParts.push(`${groupInfo.size} file`);
    }

    return {
      photo,
      groupBadge: badgeParts.join(" + "),
      isGroupLeader: groupInfo.leaderId === photo.id,
    };
  }), [photoGroupInfoByKey, photoGroupKeyById, renderedPhotos]);
  // The spacer is itself a CSS-grid row, so the grid inserts one gap after it.
  // Subtract that gap or every virtual-window change shifts the cards downward.
  const topSpacerHeight = Math.max(0, (virtualRows[0]?.start ?? 0) - GRID_GAP_PX);
  const bottomSpacerHeight = Math.max(
    0,
    rowVirtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0),
  );

  useEffect(() => {
    rowVirtualizer.measure();
  }, [gridColumnCount, gridRowHeight, rowVirtualizer, totalVirtualRows]);

  // Search in all photos so preview doesn't close when filters change
  const previewThumbnailView = useThumbnailView(previewAssetId);
  const previewAssetBase = previewAssetId ? (assetById.get(previewAssetId) ?? null) : null;
  const previewAsset = previewAssetBase && previewThumbnailView
    ? { ...previewAssetBase, ...previewThumbnailView }
    : previewAssetBase;
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
      formatFilter,
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
      formatFilter,
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
    gridRef.current?.classList.add("photo-selector__grid--scrolling");

    if (fastScrollCooldownTimerRef.current !== null) {
      window.clearTimeout(fastScrollCooldownTimerRef.current);
    }

    fastScrollCooldownTimerRef.current = window.setTimeout(() => {
      fastScrollCooldownTimerRef.current = null;
      gridRef.current?.classList.remove("photo-selector__grid--scrolling");
      flushFastScrollAccumulatedMs(true);
    }, FAST_SCROLL_COOLDOWN_MS);
  }, [flushFastScrollAccumulatedMs]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) {
      return;
    }

    let resizeFrame = 0;
    const syncGridViewport = () => {
      if (document.body.classList.contains("workspace-is-resizing") || resizeFrame !== 0) {
        return;
      }
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = 0;
        setGridViewport((current) => {
          const width = grid.clientWidth;
          const height = grid.clientHeight;
          if (current.width === width && current.height === height) {
            return current;
          }
          return { width, height };
        });
      });
    };

    syncGridViewport();
    const resizeObserver = new ResizeObserver(syncGridViewport);
    resizeObserver.observe(grid);
    window.addEventListener("resize", syncGridViewport);

    return () => {
      if (resizeFrame !== 0) window.cancelAnimationFrame(resizeFrame);
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
      gridRef.current?.classList.remove("photo-selector__grid--scrolling");
      flushFastScrollAccumulatedMs(true);
    };
  }, [flushFastScrollAccumulatedMs]);

  useEffect(() => {
    if (!onVisibleIdsChange) {
      return;
    }

    const ids = viewportPhotoIds;
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
  }, [onVisibleIdsChange, viewportPhotoIds]);

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

  // Sposta il focus alla foto successiva (o alla precedente se in fondo).
  // Usato dall'auto-advance dopo una classificazione tramite scorciatoia,
  // per replicare il flusso "Photo Mechanic" — un tasto = una decisione + avanti.
  const rotatePhotos = useCallback((targetIds: string[], direction: RotationDirection) => {
    if (!onPhotosChange || targetIds.length === 0) {
      return;
    }

    const idSet = new Set(targetIds);
    const changedIds: string[] = [];
    const nextPhotos = photosRef.current.map((photo) => {
      if (!idSet.has(photo.id)) {
        return photo;
      }
      changedIds.push(photo.id);
      return {
        ...photo,
        rotationDegrees: rotateImage(photo.rotationDegrees, direction),
      };
    });

    if (changedIds.length === 0) {
      return;
    }

    photosRef.current = nextPhotos;
    onPhotosChange(nextPhotos);
    const subject = changedIds.length === 1 ? "1 foto" : `${changedIds.length} foto`;
    const directionLabel = direction === "left" ? "a sinistra" : "a destra";
    const message = `${subject}: ruotata ${directionLabel}`;
    pushTimelineEntry(message);
    addToast(message, "success", 1800);
  }, [addToast, onPhotosChange, pushTimelineEntry]);

  const advanceFocusToNext = useCallback(
    (currentId: string) => {
      if (!autoAdvanceOnAction || visiblePhotoIds.length === 0) return;
      const currentIndex = visiblePhotoIndexById.get(currentId);
      if (currentIndex === undefined || currentIndex < 0) return;
      const nextIndex = currentIndex < visiblePhotoIds.length - 1
        ? currentIndex + 1
        : currentIndex; // resta sull'ultima se non c'è successiva
      const nextId = visiblePhotoIds[nextIndex];
      if (!nextId || nextId === currentId) return;
      setFocusedPhotoId(nextId);
      scrollPhotoIntoView(nextId);
      requestAnimationFrame(() => {
        const grid = gridRef.current;
        const el = grid?.querySelector<HTMLElement>(`[data-preview-asset-id="${nextId}"]`);
        if (el) el.focus();
      });
    },
    [autoAdvanceOnAction, scrollPhotoIntoView, visiblePhotoIds, visiblePhotoIndexById],
  );

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

      const target = event.target;
      if (target instanceof HTMLElement && target.closest("select, input, textarea")) return;

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
        const normalizedKey = event.key.toLowerCase();
        if (normalizedKey === "a") {
          event.preventDefault();
          toggleAll(true);
          return;
        }
        if (normalizedKey === "b") {
          event.preventDefault();
          if (event.repeat) {
            return;
          }
          if (isCompareOpen) {
            setIsCompareOpen(false);
          } else {
            openCompare();
          }
          return;
        }
        if (normalizedKey === "r") {
          event.preventDefault();
          if (event.repeat) {
            return;
          }
          const targetIds = resolveRotationTargetIds(
            focusedPhotoId ?? visiblePhotoIds[0] ?? null,
            selectedIdsRef.current,
            "single",
          );
          rotatePhotos(targetIds, "right");
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
            // Auto-advance: dopo una custom label da scorciatoia, sposta il focus
            // alla foto successiva (solo se la pref è attiva e c'è un focus singolo).
            if (focusedPhotoId && targetIds.length === 1 && targetIds[0] === focusedPhotoId) {
              advanceFocusToNext(focusedPhotoId);
            }
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
      advanceFocusToNext,
      contextMenuState,
      focusedPhotoId,
      hasActiveFilters,
      isCompareOpen,
      onSelectionChange,
      openPreview,
      openCompare,
      photos,
      previewAssetId,
      pushTimelineEntry,
      rotatePhotos,
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
    if (lastAppliedGridResetSignatureRef.current === gridResetSignature) {
      return;
    }
    lastAppliedGridResetSignatureRef.current = gridResetSignature;

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

  const togglePhoto = useLatestCallback((id: string, event?: React.MouseEvent) => {
    setFocusedPhotoId(id);

    // Shift+click range selection
    if (event?.shiftKey && lastClickedIdRef.current) {
      const lastIdx = visiblePhotoIndexById.get(lastClickedIdRef.current) ?? -1;
      const curIdx = visiblePhotoIndexById.get(id) ?? -1;
      if (lastIdx >= 0 && curIdx >= 0) {
        const rangeSelection = new Set(selectedIdsRef.current);
        const [from, to] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
        for (let i = from; i <= to; i++) {
          const rangeId = visiblePhotoIds[i];
          if (rangeId) {
            rangeSelection.add(rangeId);
          }
        }
        lastClickedIdRef.current = id;
        commitSelection(Array.from(rangeSelection));
        return;
      }
    }

    const nextSelection = togglePhotoSelection(selectedIdsRef.current, id);
    lastClickedIdRef.current = id;
    commitSelection(nextSelection);
  });

  const toggleAll = useLatestCallback((selectAll: boolean) => {
    const allPhotoIds = photosRef.current.map((photo) => photo.id);
    const nextSelection = buildToggleAllSelection({
      selectAll,
      hasActiveFilters,
      selectedIds: selectedIdsRef.current,
      visibleIds: visiblePhotoIds,
      allPhotoIds,
    });
    commitSelection(nextSelection);

    if (selectAll) {
      const selectedCount = hasActiveFilters ? visiblePhotoIds.length : allPhotoIds.length;
      pushTimelineEntry(
        hasActiveFilters
          ? `Selezione sostituita con ${selectedCount} foto visibili nel perimetro attivo`
          : `Selezionate tutte le ${selectedCount} foto`
      );
    } else {
      pushTimelineEntry(hasActiveFilters ? "Deselezionate le foto visibili" : "Deselezionate tutte le foto");
    }
  });

  function updatePhoto(
    id: string,
    changes: PhotoMetadataChanges,
    source: "grid" | "modal" = "grid",
  ) {
    applyPhotoChanges(id, changes, source);
  }

  const applyBatchChanges = useCallback((
    targetIds: string[],
    changes: PhotoMetadataChanges,
    source: "grid" | "modal" = "grid",
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
      const nextRotation = changes.rotationDegrees !== undefined
        ? changes.rotationDegrees
        : getAssetRotation(photo);

      if (
        nextRating === photo.rating &&
        nextPickStatus === photo.pickStatus &&
        nextColorLabel === photo.colorLabel &&
        nextRotation === getAssetRotation(photo) &&
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
        rotationDegrees: nextRotation,
      };
    });

    if (changed) {
      onPhotosChange(nextPhotos);
      pushTimelineEntry(describeMetadataChanges(changes, targetIds.length));
      addToast(describeMetadataChanges(changes, changedIds.length), "success", 2200);
      if (changes.colorLabel !== undefined) {
        triggerBatchPulse(changedIds, "dot");
      }
      if (changes.customLabels !== undefined) {
        triggerBatchPulse(changedIds, "label");
      }
      if (source === "grid") {
        emitPreviewSyncFeedback(buildPreviewSyncFeedback(changes, changedIds));
      } else if (source === "modal") {
        emitCardSyncFeedback(buildPreviewSyncFeedback(changes, changedIds));
      }
    }
  }, [addToast, buildPreviewSyncFeedback, emitCardSyncFeedback, emitPreviewSyncFeedback, onPhotosChange, photos, pushTimelineEntry, triggerBatchPulse]);

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
    const lowerLabel = label.toLocaleLowerCase();
    updateCustomLabelsForIds(
      selectedIds,
      (currentLabels) => shouldRemove
        ? currentLabels.filter((cl) => cl.toLocaleLowerCase() !== lowerLabel)
        : currentLabels.some((cl) => cl.toLocaleLowerCase() === lowerLabel)
          ? currentLabels
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

  const selectedAbsolutePaths = useMemo(
    () => getAssetAbsolutePaths(currentFolderSelectedIds),
    [currentFolderSelectedIds],
  );
  const selectedAbsolutePathsSignature = useMemo(
    () => selectedAbsolutePaths.join("\n"),
    [selectedAbsolutePaths],
  );
  const openPsdJpegConversion = useCallback((candidateIds: string[]) => {
    const targetIds = candidateIds.filter((id) => {
      const asset = assetById.get(id);
      return Boolean(asset && PSD_EXTENSIONS.has(getAssetFileExtension(asset)));
    });
    if (targetIds.length === 0) {
      addToast("Seleziona almeno un file PSD da convertire.", "warning");
      return;
    }

    completedPsdConversionJobIdRef.current = null;
    setPsdConversionTargetIds(targetIds);
    setPsdConversionProgress(null);
  }, [addToast, assetById]);

  const startSelectedPsdJpegConversion = useCallback(async () => {
    if (!psdConversionTargetIds || psdConversionTargetIds.length === 0) {
      return;
    }

    const inputPaths = getAssetAbsolutePaths(psdConversionTargetIds);
    if (inputPaths.length === 0) {
      addToast("I PSD selezionati non sono più disponibili nella cartella aperta.", "error");
      return;
    }

    setIsPsdConversionStarting(true);
    try {
      const nextProgress = await startPsdJpegConversion({
        inputPaths,
      });
      if (!nextProgress) {
        addToast("La conversione PSD è disponibile solo nell'app desktop FileX.", "warning");
        return;
      }
      setPsdConversionProgress(nextProgress);
      if (nextProgress.status === "error") {
        addToast(nextProgress.error ?? "Non è stato possibile avviare la conversione PSD.", "error");
      }
    } catch (error) {
      addToast(error instanceof Error ? error.message : "Non è stato possibile avviare la conversione PSD.", "error");
    } finally {
      setIsPsdConversionStarting(false);
    }
  }, [addToast, psdConversionTargetIds]);

  const cancelSelectedPsdJpegConversion = useCallback(() => {
    void cancelPsdJpegConversion().catch(() => {
      addToast("Non è stato possibile annullare la conversione PSD.", "error");
    });
  }, [addToast]);

  const closePsdJpegConversion = useCallback(() => {
    if (psdConversionProgress?.status === "running") {
      return;
    }
    setPsdConversionTargetIds(null);
    setPsdConversionProgress(null);
  }, [psdConversionProgress?.status]);

  useEffect(() => {
    if (psdConversionProgress?.status !== "running") {
      return;
    }

    let disposed = false;
    const refreshProgress = () => {
      void getPsdJpegConversionProgress().then((nextProgress) => {
        if (!disposed && nextProgress) {
          setPsdConversionProgress(nextProgress);
        }
      }).catch(() => undefined);
    };
    refreshProgress();
    const intervalId = window.setInterval(refreshProgress, 300);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [psdConversionProgress?.status]);

  useEffect(() => {
    if (
      psdConversionProgress?.status !== "completed"
      || !psdConversionProgress.jobId
      || completedPsdConversionJobIdRef.current === psdConversionProgress.jobId
    ) {
      return;
    }

    completedPsdConversionJobIdRef.current = psdConversionProgress.jobId;
    if (psdConversionProgress.generated === 0) {
      addToast("Conversione PSD conclusa senza creare JPEG. Controlla gli errori indicati.", "warning");
      return;
    }

    addToast(
      `${psdConversionProgress.generated} JPEG creati in “JPEG da PSD”. Aggiorno subito la cartella aperta.`,
      "success",
      7000,
    );
    void Promise.resolve(onPsdJpegConversionComplete?.()).catch(() => {
      addToast("I JPEG sono stati creati, ma non sono riuscito ad aggiornare la griglia.", "warning", 7000);
    });
  }, [addToast, onPsdJpegConversionComplete, psdConversionProgress]);
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
    const requestedCount = currentFolderSelectedIds.length;
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
  const desktopDragOutDisabledMessage = currentFolderSelectedIds.length === 0
    ? "Seleziona almeno una foto nella cartella corrente per il drag esterno."
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

  const handleCardExternalDragStart = useLatestCallback((photoId: string, event: DragEvent<HTMLDivElement>) => {
    const draggingSelection = selectedSetRef.current.has(photoId);
    const targetPaths = draggingSelection
      ? getAssetAbsolutePaths(currentFolderSelectedIds)
      : getAssetAbsolutePaths([photoId]);

    if (
      targetPaths.length === 0
      || typeof window.filexDesktop?.startDragOut !== "function"
      || (draggingSelection && !desktopDragOutCheck?.ok)
    ) {
      event.preventDefault();
      return;
    }

    // Important: prevent HTML drag so Electron native drag-out is the only active channel.
    event.preventDefault();
    window.filexDesktop.startDragOut(targetPaths);
  });
  const handlePreviewExternalDragStart = useCallback((photoId: string, event: DragEvent<HTMLElement>) => {
    const targetPaths = getAssetAbsolutePaths([photoId]);
    if (targetPaths.length === 0 || typeof window.filexDesktop?.startDragOut !== "function") {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    window.filexDesktop.startDragOut(targetPaths);
  }, []);

  const clearSelection = useCallback(() => {
    commitSelection([]);
    pushTimelineEntry("Selezione svuotata");
  }, [commitSelection, pushTimelineEntry]);

  const invertVisibleSelection = useLatestCallback(() => {
    const nextSelection = new Set(selectedIdsRef.current.filter((id) => !visiblePhotoIdSet.has(id)));
    for (const photoId of visiblePhotoIds) {
      if (!selectedSetRef.current.has(photoId)) {
        nextSelection.add(photoId);
      }
    }
    commitSelection(Array.from(nextSelection));
    pushTimelineEntry("Selezione visibile invertita");
  });

  // Le card sono memoizzate: questi handler mantengono un'identità stabile ma
  // inoltrano sempre all'implementazione più recente, evitando closure obsolete.
  const handleFocus = useCallback((id: string) => {
    setFocusedPhotoId(id);
  }, []);

  const handlePreview = useLatestCallback((id: string) => {
    openPreview(id, false);
  });

  const handleAfterShortcutClassification = useLatestCallback((id: string) => {
    advanceFocusToNext(id);
  });

  const handleRotatePhoto = useLatestCallback((id: string, direction: RotationDirection) => {
    const targetIds = resolveRotationTargetIds(id, selectedIdsRef.current, "single");
    rotatePhotos(targetIds, direction);
  });

  const handleRotateSelection = useLatestCallback((direction: RotationDirection) => {
    const targetIds = resolveRotationTargetIds(null, selectedIdsRef.current, "selection");
    rotatePhotos(targetIds, direction);
  });

  const handlePreviewAssetSelection = useCallback((assetId: string) => {
    lastPreviewAssetIdRef.current = assetId;
    setFocusedPhotoId(assetId);
    setPreviewAssetId(assetId);
  }, []);

  const handleContextMenu = useLatestCallback((id: string, x: number, y: number) => {
    if (!onPhotosChange) return;
    const targetIds = selectedSetRef.current.has(id) ? selectedIdsRef.current : [id];
    setContextMenuState({ x, y, targetIds });
  });

  const handleUpdatePhoto = useLatestCallback((id: string, changes: PhotoMetadataChanges) => {
    applyPhotoChanges(id, changes, "grid");
  });

  const handleShortcutClassification = useLatestCallback((id: string, changes: PhotoMetadataChanges) => {
    applyPhotoChanges(id, changes, "grid");
  });

  const handleModalAssetUpdate = useLatestCallback((assetId: string, changes: PhotoMetadataChanges) => {
    applyPhotoChanges(assetId, changes, "modal");
  });

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

  const isPreviewOpen = Boolean(previewAssetId);
  const visiblePreviewAssets = useMemo(() => {
    if (!isPreviewOpen) {
      return [] as ImageAsset[];
    }
    return visiblePhotoIds
      .map((photoId) => {
        const photo = assetById.get(photoId);
        if (!photo) return null;
        const thumbnailView = getThumbnailView(photoId);
        return thumbnailView ? { ...photo, ...thumbnailView } : photo;
      })
      .filter((photo): photo is ImageAsset => Boolean(photo));
  }, [assetById, isPreviewOpen, visiblePhotoIds]);

  const visibleSelectedCount = useMemo(
    () => selectedIds.reduce(
      (count, photoId) => count + (visiblePhotoIdSet.has(photoId) ? 1 : 0),
      0,
    ),
    [selectedIds, visiblePhotoIdSet],
  );
  const selectedOutsideFilterCount = useMemo(
    () => hasActiveFilters ? countSelectionOutsideFilter(selectedIds, visiblePhotoIdSet) : 0,
    [hasActiveFilters, selectedIds, visiblePhotoIdSet],
  );
  const allVisibleSelected = visiblePhotoIds.length > 0 && visibleSelectedCount === visiblePhotoIds.length;
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected;
  const allSelected = !hasActiveFilters && photos.length > 0 && selectedIds.length === photos.length;
  const someSelected = !hasActiveFilters && selectedIds.length > 0 && selectedIds.length < photos.length;

  const photoStats = useMemo(() => {
    const ratingCounts = new Map<number, number>();
    const pickCounts = new Map<PickStatus, number>();
    const colorCounts = new Map<ColorLabel, number>();
    for (const photo of currentFolderPhotos) {
      const r = getAssetRating(photo);
      ratingCounts.set(r, (ratingCounts.get(r) ?? 0) + 1);
      const ps = getAssetPickStatus(photo);
      pickCounts.set(ps, (pickCounts.get(ps) ?? 0) + 1);
      const cl = getAssetColorLabel(photo);
      if (cl) colorCounts.set(cl, (colorCounts.get(cl) ?? 0) + 1);
    }
    return { ratingCounts, pickCounts, colorCounts };
  }, [currentFolderPhotos]);

  function selectVisible() {
    commitSelection(visiblePhotoIds);
    pushTimelineEntry(`Selezionate ${visiblePhotoIds.length} foto visibili`);
  }

  function addVisibleToSelection() {
    const nextSelection = new Set(selectedIdsRef.current);
    for (const photoId of visiblePhotoIds) {
      nextSelection.add(photoId);
    }
    commitSelection(Array.from(nextSelection));
    pushTimelineEntry(`Aggiunte ${visiblePhotoIds.length} foto visibili alla selezione`);
  }

  function removeVisibleFromSelection() {
    commitSelection(selectedIdsRef.current.filter((id) => !visiblePhotoIdSet.has(id)));
    pushTimelineEntry("Rimosse dalla selezione le foto visibili");
  }

  function activatePickedOnly() {
    commitSelection(currentFolderPhotos.filter((photo) => photo.pickStatus === "picked").map((photo) => photo.id));
    pushTimelineEntry("Selezionate solo le foto Pick della cartella corrente");
  }

  function excludeRejected() {
    commitSelection(selectedIdsRef.current.filter((id) => {
      const photo = assetById.get(id);
      return photo?.pickStatus !== "rejected";
    }));
    pushTimelineEntry("Escluse dalla selezione le scartate");
  }

  function selectByMinimumRating(minRating: number) {
    commitSelection(currentFolderPhotos.filter((photo) => getAssetRating(photo) >= minRating).map((photo) => photo.id));
    pushTimelineEntry(`Selezionate nella cartella corrente le foto con almeno ${minRating} stelle`);
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
      commitSelection(selectedIdsRef.current.filter((id) => !movedSet.has(id)));
      pushTimelineEntry(`${movedIds.length === 1 ? "1 file" : `${movedIds.length} file`} spostato/i in cartella`);
    }
    if (result === "partial") addToast("Spostamento parziale: alcuni file non sono stati mossi.", "warning");
    if (result === "error") addToast("Spostamento non riuscito.", "error");
  }, [addToast, commitSelection, onPhotosChange, photos, pushTimelineEntry]);

  const handleSaveAs = useCallback(async (ids: string[]) => {
    for (const id of ids) {
      const result = await saveAssetAs(id);
      if (result === "error") { addToast("Errore durante il salvataggio del file.", "error"); break; }
      if (result === "cancelled") break;
    }
  }, [addToast]);

  const handleCopyPath = useCallback((ids: string[], root: string) => {
    const absolutePaths = getAssetAbsolutePaths(ids);
    const paths = absolutePaths.length > 0
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
    const absolutePaths = directAbsolutePaths.length > 0
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
    const MAX_DISK_POLL_TARGETS = 28;
    const POLL_FAST_MS = 4000;
    const POLL_MEDIUM_MS = 6500;
    const POLL_SLOW_MS = 9500;

    const pollIntervalMs = selectedIds.length > 40
      ? POLL_SLOW_MS
      : selectedIds.length > 12
        ? POLL_MEDIUM_MS
        : POLL_FAST_MS;

    const run = async () => {
      if (disposed || running) return;
      if (typeof document !== "undefined" && document.hidden) return;

      const targets: string[] = [];
      const seen = new Set<string>();
      const appendTarget = (id: string | null | undefined) => {
        if (!id || seen.has(id) || targets.length >= MAX_DISK_POLL_TARGETS) {
          return;
        }
        seen.add(id);
        targets.push(id);
      };

      appendTarget(previewAssetId);
      for (const selectedId of selectedIds) {
        appendTarget(selectedId);
        if (targets.length >= MAX_DISK_POLL_TARGETS) {
          break;
        }
      }

      if (targets.length === 0) return;

      running = true;
      try {
        const changes = await detectChangedAssetsOnDisk(targets);
        if (disposed || changes.length === 0) return;

        const byId = new Map(changes.map((change) => [change.id, change]));
        const next = photosRef.current.map((asset) => {
          const change = byId.get(asset.id);
          if (!change) return asset;
          // Quando una preview/thumbnail viene rimpiazzata da una nuova blob: URL,
          // revochiamo la vecchia: altrimenti il browser tiene il blob in memoria
          // per tutta la sessione (memory leak su cartelle modificate spesso).
          revokeBlobUrlIfReplaced(asset.thumbnailUrl, change.thumbnailUrl);
          revokeBlobUrlIfReplaced(asset.previewUrl, change.previewUrl);
          revokeBlobUrlIfReplaced(asset.sourceUrl, change.sourceUrl);
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
    }, pollIntervalMs);

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
      <DockableWorkspace
        layout={workspacePanelLayout}
        panels={[
          {
            id: "filters",
            title: "Filtri",
            content: (
              <PhotoFilterPanel
                folderStats={folderStats}
                activeFilterCount={activeFilterCount}
                hasActiveFilters={hasActiveFilters}
                photosCount={photos.length}
                subfolders={subfolders}
                folderFilter={folderFilter}
                pickFilter={pickFilter}
                formatFilter={formatFilter}
                ratingFilter={ratingFilter}
                ratingCounts={photoStats.ratingCounts}
                colorFilter={colorFilter}
                customColorNames={customColorNames}
                customLabelFilter={customLabelFilter}
                customLabelFilterOptions={customLabelFilterOptions}
                isAdvancedFiltersOpen={isAdvancedFiltersOpen}
                seriesGroups={seriesGroups}
                seriesFilter={seriesFilter}
                timeClusters={timeClusters}
                timeClusterFilter={timeClusterFilter}
                filterPresets={filterPresets}
                onReset={resetFilters}
                onFolderFilterChange={setFolderFilter}
                onPickFilterChange={setPickFilter}
                onFormatFilterChange={setFormatFilter}
                onRatingFilterChange={setRatingFilter}
                onColorFilterChange={setColorFilter}
                onCustomLabelFilterChange={setCustomLabelFilter}
                onAdvancedFiltersToggle={() => setIsAdvancedFiltersOpen((open) => !open)}
                onSeriesFilterChange={setSeriesFilter}
                onTimeClusterFilterChange={setTimeClusterFilter}
                onApplyPreset={applyPreset}
              />
            ),
          },
          {
            id: "selection",
            title: "Selezione",
            content: (
              <SelectionActionsPanel
                canUndo={canUndo}
                canRedo={canRedo}
                hasActiveFilters={hasActiveFilters}
                allSelected={allSelected}
                allVisibleSelected={allVisibleSelected}
                someSelected={someSelected}
                someVisibleSelected={someVisibleSelected}
                visibleCount={visiblePhotoIds.length}
                visibleSelectedCount={visibleSelectedCount}
                selectedOutsideFilterCount={selectedOutsideFilterCount}
                currentFolderSelectedCount={currentFolderSelectedIds.length}
                selectedCount={selectedIds.length}
                psdSelectedCount={selectedPsdIds.length}
                workspaceMode={workspaceMode}
                compareCount={comparePhotos.length}
                isMenuOpen={isSelectionActionsOpen}
                onUndo={handleUndoClick}
                onRedo={handleRedoClick}
                onToggleAll={toggleAll}
                onToggleMenu={() => setIsSelectionActionsOpen((open) => !open)}
                onSelectVisible={() => { selectVisible(); setIsSelectionActionsOpen(false); }}
                onAddVisible={() => { addVisibleToSelection(); setIsSelectionActionsOpen(false); }}
                onRemoveVisible={() => { removeVisibleFromSelection(); setIsSelectionActionsOpen(false); }}
                onInvertVisible={() => { invertVisibleSelection(); setIsSelectionActionsOpen(false); }}
                onRotateSelected={(direction) => { handleRotateSelection(direction); setIsSelectionActionsOpen(false); }}
                onActivatePickedOnly={() => { activatePickedOnly(); setIsSelectionActionsOpen(false); }}
                onConvertPsdSelected={() => { openPsdJpegConversion(selectedPsdIds); setIsSelectionActionsOpen(false); }}
                onCompare={openCompare}
              />
            ),
          },
          {
            id: "view",
            title: "Vista",
            content: (
              <ViewControlsPanel
                searchQuery={searchQuery}
                resultCount={visiblePhotoIds.length}
                totalCount={photos.length}
                cardSize={cardSize}
                sortBy={sortBy}
                createdAtSortDirection={createdAtSortDirection}
                isSettingsPanelOpen={isSettingsPanelOpen}
                onSearchChange={setSearchQuery}
                onCardSizeChange={setCardSize}
                onSortChange={(nextSort, direction) => {
                  setSortBy(nextSort);
                  if (direction) setCreatedAtSortDirection(direction);
                }}
                onSettingsToggle={() => setIsSettingsPanelOpen((open) => !open)}
              />
            ),
          },
          {
            id: "stats",
            title: "Statistiche rapide",
            content: (
              <QuickStatsPanel
                ratingCounts={photoStats.ratingCounts}
                pickCounts={photoStats.pickCounts}
                colorCounts={photoStats.colorCounts}
                ratingFilter={ratingFilter}
                pickFilter={pickFilter}
                colorFilter={colorFilter}
                customColorNames={customColorNames}
                onRatingFilterChange={setRatingFilter}
                onPickFilterChange={setPickFilter}
                onColorFilterChange={setColorFilter}
              />
            ),
          },
        ]}
        onMovePanel={moveWorkspacePanel}
        onTogglePanel={toggleWorkspacePanel}
      >

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
          const eventTarget = e.target;
          if (eventTarget instanceof HTMLElement && eventTarget.closest(".photo-card")) return;
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
            const base = e.shiftKey ? new Set(selectedIdsRef.current) : new Set<string>();
            for (const id of newIds) base.add(id);
            commitSelection(Array.from(base));
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
            {renderedPhotoCardMeta.map(({ photo, groupBadge, isGroupLeader }) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                isSelected={selectedSet.has(photo.id)}
                groupBadge={groupBadge}
                isGroupLeader={isGroupLeader}
                onToggle={togglePhoto}
                onUpdatePhoto={handleUpdatePhoto}
                onApplyShortcutChanges={handleShortcutClassification}
                onAfterShortcutClassification={handleAfterShortcutClassification}
                onFocus={handleFocus}
                onPreview={handlePreview}
                onRotate={handleRotatePhoto}
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
                batchPulseToken={batchPulseState?.ids.has(photo.id) ? batchPulseState.token : 0}
                batchPulseKind={batchPulseState?.ids.has(photo.id) ? batchPulseState.kind : null}
                externalFeedback={cardSyncFeedback}
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

      </DockableWorkspace>

      {/* ── STATUS BAR (Bridge Bottom Style) ── */}
      <footer className="photo-selector__bottom-bar">
        <div className="photo-selector__stats">
          <span className="photo-selector__count">
            Ambito: {folderFilter === "all" ? "tutte le cartelle" : folderFilter} ({currentFolderPhotos.length} foto)
            {hasActiveFilters
              ? ` · Filtro: ${visiblePhotoIds.length} visibili · Selezione: ${visibleSelectedCount} visibili${selectedOutsideFilterCount > 0 ? ` + ${selectedOutsideFilterCount} fuori filtro` : ""}`
              : ` · Selezione: ${currentFolderSelectedIds.length}`}
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
                ? "Trascina la selezione verso un editor esterno o un'altra app desktop."
                : desktopDragOutDisabledMessage}
              disabled={!canStartDesktopDragOut}
            >
              Trascina fuori ({currentFolderSelectedIds.length})
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
        externalFeedback={previewSyncFeedback}
        canExternalDrag={Boolean(previewAssetWithUrl ? getAssetAbsolutePath(previewAssetWithUrl.id) : null)}
        onExternalDragStart={handlePreviewExternalDragStart}
        autoAdvanceOnAction={autoAdvanceOnAction}
        onAutoAdvanceOnActionChange={handleAutoAdvanceChange}
        onClose={closePreview}
        onSelectAsset={handlePreviewAssetSelection}
        onRotateAsset={handleRotatePhoto}
        onUpdateAsset={handleModalAssetUpdate}
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

          {desktopPerformanceFeedback ? (
            <div
              className={`photo-selector__settings-feedback photo-selector__settings-feedback--${desktopPerformanceFeedback.tone}`}
              role="status"
              aria-live="polite"
            >
              {desktopPerformanceFeedback.message}
            </div>
          ) : null}

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
            <p className="photo-selector__settings-empty" style={{ marginTop: "0.1rem" }}>
              Budget RAM, profilo anteprime e limite cache si applicano subito: non serve riavviare il software.
            </p>
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
            <label
              className="photo-selector__settings-color-row"
              style={{ alignItems: "center" }}
              title="Quando attivo, dopo una scorciatoia di rating/pick/colore/etichetta il focus si sposta sulla foto successiva (flusso Photo Mechanic)."
            >
              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", minWidth: 90 }}>Auto-advance</span>
              <input
                type="checkbox"
                checked={autoAdvanceOnAction}
                onChange={(event) => handleAutoAdvanceChange(event.target.checked)}
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
            <div className={`performance-hardware-status${desktopGraphicsStatus?.hardwareAccelerationEnabled ? " performance-hardware-status--active" : " performance-hardware-status--inactive"}`}>
              <span className="performance-hardware-status__indicator" aria-hidden="true" />
              <div>
                <strong>
                  {desktopGraphicsStatus
                    ? desktopGraphicsStatus.hardwareAccelerationEnabled
                      ? "Accelerazione grafica attiva"
                      : "Accelerazione grafica non attiva"
                    : "Stato GPU disponibile solo nell’app desktop"}
                </strong>
                {desktopGraphicsStatus ? (
                  <>
                    <span>{desktopGraphicsStatus.deviceName ?? "Scheda video non identificata"}</span>
                    <small>
                      Compositing: {desktopGraphicsStatus.gpuCompositing} · WebGL: {desktopGraphicsStatus.webgl} · Raster: {desktopGraphicsStatus.rasterization}
                    </small>
                  </>
                ) : null}
                <small>La GPU accelera rendering e scorrimento; la decodifica RAW/JPEG usa la pipeline nativa CPU.</small>
              </div>
            </div>
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
                Spostiamo le cache pesanti gestite da Selezione Foto, non i percorsi di sistema di Windows. Anche il nuovo percorso diventa attivo subito, senza riavvio.
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
                {onDiskCacheBudgetPresetChange ? (
                  <label className="photo-selector__settings-inline-select">
                    <span>Limite disco</span>
                    <select
                      value={desktopThumbnailCacheInfo.diskBudgetPreset ?? "balanced"}
                      onChange={(event) => void onDiskCacheBudgetPresetChange(
                        event.target.value as DesktopDiskCacheBudgetPreset,
                      )}
                      disabled={isDesktopThumbnailCacheBusy}
                    >
                      <option value="compact">Compatta · 2 GB</option>
                      <option value="balanced">Bilanciata · 8 GB</option>
                      <option value="performance">Performance · 24 GB</option>
                      <option value="unlimited">Senza limite</option>
                    </select>
                  </label>
                ) : null}
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
                <button
                  type="button"
                  className="ghost-button ghost-button--small"
                  onClick={() => void onRefreshDesktopThumbnailCacheInfo?.()}
                  disabled={isDesktopThumbnailCacheBusy || !onRefreshDesktopThumbnailCacheInfo}
                >
                  Aggiorna dati
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
                {desktopThumbnailCacheInfo.entryCount} anteprime, {formatBytes(desktopThumbnailCacheInfo.totalBytes)} su disco
                {desktopThumbnailCacheInfo.diskBudgetBytes == null
                  ? " (nessun limite)."
                  : ` su ${formatBytes(desktopThumbnailCacheInfo.diskBudgetBytes)}.`}
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
          canConvertPsd={contextMenuState.targetIds.some((id) => {
            const asset = assetById.get(id);
            return Boolean(asset && PSD_EXTENSIONS.has(getAssetFileExtension(asset)));
          })}
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
          onConvertPsd={() => {
            const ids = [...contextMenuState.targetIds];
            setContextMenuState(null);
            openPsdJpegConversion(ids);
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

      {psdConversionTargetIds ? (
        <PsdJpegConversionModal
          totalPsd={psdConversionTargetIds.length}
          progress={psdConversionProgress}
          isStarting={isPsdConversionStarting}
          onStart={() => { void startSelectedPsdJpegConversion(); }}
          onCancel={cancelSelectedPsdJpegConversion}
          onClose={closePsdJpegConversion}
        />
      ) : null}

      {isCompareOpen && canComparePhotos && (
        <CompareModal
          photos={comparePhotos}
          onClose={() => setIsCompareOpen(false)}
          onUpdatePhoto={(id, changes) => updatePhoto(id, changes)}
        />
      )}
    </div>
  );
}

