export type DesktopToolId =
  | "auto-layout-app"
  | "image-party-frame"
  | "image-id-print"
  | "archivio-flow"
  | "photo-selector-app";

export type DesktopThumbnailProfile = "ultra-fast" | "fast" | "balanced";
export type DesktopPhotoSortMode = "name" | "orientation" | "rating";
export type DesktopCustomLabelTone = "sand" | "rose" | "green" | "blue" | "purple" | "slate";
export type DesktopColorLabel = "red" | "yellow" | "green" | "blue" | "purple";
export type DesktopPickStatus = "picked" | "rejected" | "unmarked";

export interface DesktopRuntimeInfo {
  shell: "electron";
  platform: string;
  isPackaged: boolean;
  appVersion: string;
  toolId: DesktopToolId;
  toolName: string;
}

export interface DesktopFolderEntry {
  name: string;
  relativePath: string;
  absolutePath: string;
  size: number;
  lastModified: number;
}

export interface DesktopFolderOpenDiagnostics {
  source: "desktop-native";
  selectedPath: string;
  topLevelSupportedCount: number;
  nestedSupportedDiscardedCount: number;
  totalSupportedSeen: number;
  nestedDirectoriesSeen: number;
}

export interface DesktopFolderOpenResult {
  name: string;
  rootPath: string;
  entries: DesktopFolderEntry[];
  diagnostics?: DesktopFolderOpenDiagnostics;
}

export interface DesktopFilePayload {
  name: string;
  absolutePath: string;
  bytes: Uint8Array;
  size: number;
  lastModified: number;
}

export interface DesktopRenderedImage {
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
}

export interface DesktopPreviewOptions {
  maxDimension?: number;
  sourceFileKey?: string;
}

export interface DesktopEditorCandidate {
  path: string;
  label: string;
}

export interface DesktopThumbnailCacheLookupEntry {
  id: string;
  absolutePath: string;
  sourceFileKey?: string;
}

export interface DesktopCachedThumbnail {
  id: string;
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
}

export interface DesktopThumbnailCacheInfo {
  currentPath: string;
  defaultPath: string;
  usesCustomPath: boolean;
  entryCount: number;
  totalBytes: number;
}

export interface DesktopStorageVolumeInfo {
  mountPath: string;
  label: string;
  freeBytes: number;
  totalBytes: number;
  isSystem: boolean;
  isWritable: boolean;
}

export type DesktopCacheRecommendationReason =
  | "healthy"
  | "low-space-recommendation"
  | "already-custom"
  | "no-suitable-volume"
  | "dismissed"
  | "unsupported-platform";

export interface DesktopCacheLocationRecommendation {
  shouldPrompt: boolean;
  currentPath: string;
  recommendedPath: string | null;
  currentVolume: DesktopStorageVolumeInfo | null;
  recommendedVolume: DesktopStorageVolumeInfo | null;
  reason: DesktopCacheRecommendationReason;
  dismissed: boolean;
}

export interface DesktopCacheMigrationResult {
  ok: boolean;
  cacheInfo?: DesktopThumbnailCacheInfo;
  copiedEntries: number;
  removedSourceEntries: number;
  error?: string;
}

export interface DesktopPhotoFilterPreset {
  id: string;
  name: string;
  filters: {
    pickStatus: "all" | DesktopPickStatus;
    ratingFilter: string;
    colorLabel: "all" | DesktopColorLabel;
    customLabelFilter?: string;
    folderFilter?: string;
    seriesFilter?: string;
    timeClusterFilter?: string;
    searchQuery?: string;
  };
}

export interface DesktopPhotoSelectorPreferences {
  colorNames: Record<DesktopColorLabel, string>;
  filterPresets: DesktopPhotoFilterPreset[];
  customLabelsCatalog: string[];
  customLabelColors: Record<string, DesktopCustomLabelTone>;
  customLabelShortcuts: Record<string, string | null>;
  thumbnailProfile: DesktopThumbnailProfile;
  sortCacheEnabled: boolean;
  cardSize: number;
  rootFolderPathOverride: string;
  preferredEditorPath: string;
}

export interface DesktopPersistedState {
  projectName: string;
  sourceFolderPath: string;
  activeAssetIds: string[];
  usesMockData?: boolean;
}

export interface DesktopRecentFolder {
  name: string;
  path?: string;
  imageCount: number;
  openedAt: number;
}

export interface DesktopSortCacheEntry {
  folderPath: string;
  sortBy: DesktopPhotoSortMode;
  signature: string;
  orderedIds: string[];
  updatedAt: number;
}

export interface DesktopFolderCatalogAssetState {
  assetId: string;
  fileName: string;
  relativePath: string;
  absolutePath?: string;
  sourceFileKey?: string;
  rating: number;
  pickStatus: DesktopPickStatus;
  colorLabel: DesktopColorLabel | null;
  customLabels: string[];
  updatedAt: number;
}

export interface DesktopFolderCatalogState {
  folderPath: string;
  folderName: string;
  imageCount: number;
  activeAssetIds: string[];
  lastOpenedAt: number;
  updatedAt: number;
  assetStates?: DesktopFolderCatalogAssetState[];
}

export interface DesktopPerformanceSnapshot {
  folderOpenToFirstThumbnailMs: number | null;
  folderOpenToGridCompleteMs: number | null;
  previewOpenLatencyMs: number | null;
  previewNavigationLatencyMs: number | null;
  previewFitLatencyMs?: number | null;
  previewDetailLatencyMs?: number | null;
  previewWarmHitRate?: number | null;
  previewFallbackCount?: number;
  previewSourceBreakdown?: string;
  xmpSyncLatencyMs: number | null;
  bytesRead: number;
  rawBytesRead: number;
  standardBytesRead: number;
  thumbnailProfile?: DesktopThumbnailProfile;
  sortCacheEnabled?: boolean;
  lastUpdatedAt: number | null;
}

export type DesktopSendToEditorStatus =
  | "ok"
  | "invalid-editor"
  | "launch-failed"
  | "partial"
  | "timeout";

export interface DesktopSendToEditorResult {
  ok: boolean;
  status: DesktopSendToEditorStatus;
  requestedCount: number;
  launchedCount: number;
  error?: string;
}

export type DesktopDragOutReason =
  | "ok"
  | "missing-paths"
  | "too-many-files"
  | "invalid-paths"
  | "empty-selection";

export interface DesktopDragOutCheck {
  ok: boolean;
  requestedCount: number;
  validCount: number;
  allowedCount: number;
  reason: DesktopDragOutReason;
  message: string;
}

export interface DesktopLogEvent {
  channel: string;
  level: "info" | "warn" | "error";
  message: string;
  details?: string;
  timestamp?: number;
}

export type DesktopQuickPreviewStage = "fit" | "detail";
export type DesktopQuickPreviewSource =
  | "memory-cache"
  | "disk-cache"
  | "embedded-preview"
  | "native-provider"
  | "source-file";

export interface DesktopQuickPreviewFrame {
  token: string;
  src: string;
  width: number;
  height: number;
  stage: DesktopQuickPreviewStage;
  source: DesktopQuickPreviewSource;
  cacheHit: boolean;
}

export interface DesktopQuickPreviewRequest {
  absolutePath: string;
  sourceFileKey?: string;
  maxDimension: number;
  stage: DesktopQuickPreviewStage;
  priority?: number;
}

export interface DesktopQuickPreviewWarmRequest extends DesktopQuickPreviewRequest {}

export interface DesktopQuickPreviewWarmResult {
  requestedCount: number;
  warmedCount: number;
  cacheHitCount: number;
  failedCount: number;
}

export interface FileXDesktopApi {
  getRuntimeInfo: () => Promise<DesktopRuntimeInfo>;
  openFolder: () => Promise<DesktopFolderOpenResult | null>;
  reopenFolder: (rootPath: string) => Promise<DesktopFolderOpenResult | null>;
  consumePendingOpenFolderPath: () => Promise<string | null>;
  markOpenFolderRequestReady: () => Promise<void>;
  onOpenFolderRequest: (listener: (folderPath: string) => void) => () => void;
  canStartDragOut: (absolutePaths: string[]) => Promise<DesktopDragOutCheck>;
  startDragOut: (absolutePaths: string[]) => void;
  readFile: (absolutePath: string) => Promise<DesktopFilePayload | null>;
  getThumbnail: (
    absolutePath: string,
    maxDimension: number,
    quality: number,
    sourceFileKey?: string,
  ) => Promise<DesktopRenderedImage | null>;
  getCachedThumbnails: (
    entries: DesktopThumbnailCacheLookupEntry[],
    maxDimension: number,
    quality: number,
  ) => Promise<DesktopCachedThumbnail[]>;
  getThumbnailCacheInfo: () => Promise<DesktopThumbnailCacheInfo>;
  chooseThumbnailCacheDirectory: () => Promise<DesktopThumbnailCacheInfo | null>;
  setThumbnailCacheDirectory: (directoryPath: string) => Promise<DesktopThumbnailCacheInfo>;
  resetThumbnailCacheDirectory: () => Promise<DesktopThumbnailCacheInfo>;
  clearThumbnailCache: () => Promise<boolean>;
  getCacheLocationRecommendation: () => Promise<DesktopCacheLocationRecommendation>;
  migrateThumbnailCacheDirectory: (directoryPath: string) => Promise<DesktopCacheMigrationResult>;
  dismissCacheLocationRecommendation: () => Promise<void>;
  getPreview: (
    absolutePath: string,
    options?: DesktopPreviewOptions,
  ) => Promise<DesktopRenderedImage | null>;
  warmPreview: (
    absolutePath: string,
    options?: DesktopPreviewOptions,
  ) => Promise<boolean>;
  getQuickPreviewFrame: (
    request: DesktopQuickPreviewRequest,
  ) => Promise<DesktopQuickPreviewFrame | null>;
  warmQuickPreviewFrames: (
    requests: DesktopQuickPreviewWarmRequest[],
  ) => Promise<DesktopQuickPreviewWarmResult>;
  releaseQuickPreviewFrames: (tokens: string[]) => Promise<void>;
  chooseEditorExecutable: (currentPath?: string) => Promise<string | null>;
  getInstalledEditorCandidates: () => Promise<DesktopEditorCandidate[]>;
  sendToEditor: (
    editorPath: string,
    absolutePaths: string[],
  ) => Promise<DesktopSendToEditorResult>;
  openWithEditor: (
    editorPath: string,
    absolutePaths: string[],
  ) => Promise<DesktopSendToEditorResult>;
  getDesktopPreferences: () => Promise<DesktopPhotoSelectorPreferences>;
  saveDesktopPreferences: (
    preferences: DesktopPhotoSelectorPreferences,
  ) => Promise<DesktopPhotoSelectorPreferences>;
  getDesktopSessionState: () => Promise<DesktopPersistedState | null>;
  saveDesktopSessionState: (state: DesktopPersistedState) => Promise<void>;
  getRecentFolders: () => Promise<DesktopRecentFolder[]>;
  saveRecentFolder: (folder: DesktopRecentFolder) => Promise<DesktopRecentFolder[]>;
  removeRecentFolder: (folderPathOrName: string) => Promise<DesktopRecentFolder[]>;
  getSortCache: (folderPath?: string) => Promise<DesktopSortCacheEntry[]>;
  saveSortCache: (entry: DesktopSortCacheEntry) => Promise<void>;
  getFolderCatalogState: (folderPath: string) => Promise<DesktopFolderCatalogState | null>;
  saveFolderCatalogState: (state: DesktopFolderCatalogState) => Promise<void>;
  saveFolderAssetStates: (
    folderPath: string,
    assetStates: DesktopFolderCatalogAssetState[],
  ) => Promise<void>;
  getDesktopPerformanceSnapshot: () => Promise<DesktopPerformanceSnapshot | null>;
  recordDesktopPerformanceSnapshot: (snapshot: DesktopPerformanceSnapshot) => Promise<void>;
  logDesktopEvent: (event: DesktopLogEvent) => Promise<void>;
  readSidecarXmp: (absolutePath: string) => Promise<string | null>;
  writeSidecarXmp: (absolutePath: string, xml: string) => Promise<boolean>;
}
