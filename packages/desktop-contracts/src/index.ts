export type DesktopToolId =
  | "suite-launcher"
  | "auto-layout-app"
  | "image-party-frame"
  | "image-id-print"
  | "archivio-flow"
  | "photo-selector-app";

export type DesktopReleaseChannel = "stable" | "beta";

export type DesktopThumbnailProfile = "ultra-fast" | "fast" | "balanced";
export type DesktopRamBudgetPreset = "conservative" | "default" | "performance" | "maximum";
export type DesktopPhotoSortMode = "name" | "orientation" | "rating" | "createdAt";
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
  releaseChannel: DesktopReleaseChannel;
  aiSidecarInstalled: boolean;
  installedTools: DesktopToolInstallState[];
}

export type DesktopToolInstallStatus = "installed" | "not-installed" | "update-available";

export interface DesktopToolInstallState {
  toolId: DesktopToolId;
  toolName: string;
  productName: string;
  installed: boolean;
  executablePath: string | null;
  installedVersion: string | null;
  latestVersion: string | null;
  status: DesktopToolInstallStatus;
}

export interface DesktopToolReleaseEntry {
  toolId: DesktopToolId;
  version: string;
  channel: DesktopReleaseChannel;
  installerUrl: string;
  installerSha256: string;
  minLauncherVersion: string;
  publishedAt: string;
}

export interface DesktopReleaseManifest {
  schemaVersion: 1;
  generatedAt: string;
  generatedBy: string;
  payloadSha256?: string;
  payloadSignature?: string;
  signatureAlgorithm?: "hmac-sha256";
  channels: DesktopReleaseChannel[];
  releases: DesktopToolReleaseEntry[];
}

export interface DesktopToolUpdateCheckResult {
  toolId: DesktopToolId;
  channel: DesktopReleaseChannel;
  currentVersion: string | null;
  available: boolean;
  release: DesktopToolReleaseEntry | null;
  reason?: "up-to-date" | "new-version" | "not-installed" | "not-found";
}

export type DesktopToolUpdateJobStatus =
  | "queued"
  | "downloading"
  | "downloaded"
  | "verifying"
  | "ready-to-apply"
  | "applying"
  | "completed"
  | "failed";

export interface DesktopToolUpdateJob {
  id: string;
  toolId: DesktopToolId;
  channel: DesktopReleaseChannel;
  status: DesktopToolUpdateJobStatus;
  installerPath: string | null;
  releaseVersion: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  checksumVerified: boolean;
  retries: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DesktopAiSidecarStatus {
  installed: boolean;
  pythonFound: boolean;
  serverScriptPath: string | null;
  requirementsPath: string | null;
  health: "unknown" | "ok" | "missing-runtime" | "missing-script";
}

export interface DesktopFolderEntry {
  name: string;
  relativePath: string;
  absolutePath: string;
  size: number;
  lastModified: number;
  createdAt: number;
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
  rawRenderCacheHit?: number;
  effectiveThumbnailRamMaxEntries?: number;
  effectiveThumbnailRamMaxBytes?: number;
  effectiveRenderedPreviewMaxEntries?: number;
  effectiveRenderedPreviewMaxBytes?: number;
  effectivePreviewSourceMaxEntries?: number;
  effectivePreviewSourceMaxBytes?: number;
  systemTotalMemoryBytes?: number;
  ramBudgetPreset?: DesktopRamBudgetPreset;
  ramBudgetBytes?: number;
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
  ramBudgetPreset: DesktopRamBudgetPreset;
}

export interface DesktopPersistedState {
  projectName: string;
  sourceFolderPath: string;
  activeAssetIds: string[];
  usesMockData?: boolean;
}

export interface DesktopAutoLayoutHandoffFile {
  fileName: string;
  content: string;
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
  reactCommitCount?: number;
  hotPatchApplied?: number;
  deferredPatchApplied?: number;
  scrollLiteActiveMs?: number;
  rawRenderCacheHit?: number;
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

export type DesktopNativeFileOpStatus = "ok" | "cancelled" | "error" | "partial" | "no-file";

export interface DesktopCopyFilesResult {
  status: DesktopNativeFileOpStatus;
  requestedCount: number;
  copiedCount: number;
  copiedPaths: string[];
  destinationDirectory: string | null;
}

export interface DesktopMoveFilesResult {
  status: DesktopNativeFileOpStatus;
  requestedCount: number;
  movedCount: number;
  movedPaths: string[];
  destinationDirectory: string | null;
}

export interface DesktopSaveFileAsResult {
  status: DesktopNativeFileOpStatus;
  sourcePath: string;
  destinationPath: string | null;
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

export interface ArchivioArchiveHierarchyConfig {
  yearLevel: number | null;
  categoryLevel: number | null;
  jobLevel: number;
}

export interface ArchivioSdCard {
  deviceId: string;
  volumeName: string;
  totalSize: number;
  freeSpace: number;
  path: string;
}

export interface ArchivioSdPreview {
  totalFiles: number;
  rawFiles: number;
  jpgFiles: number;
}

export interface ArchivioJob {
  id: string;
  nomeLavoro: string;
  dataLavoro: string;
  autore: string;
  annoArchivio?: string;
  categoriaArchivio?: string;
  contrattoLink?: string;
  percorsoCartella: string;
  percorsoSelezione?: string;
  nomeCartella: string;
  dataCreazione: string;
  numeroFile: number;
  folderExists?: boolean;
  hasLowQualityFiles?: boolean;
}

export interface ArchivioSelectionCandidate {
  path: string;
  label: string;
  fileCount: number;
  depth: number;
}

export interface ArchivioSettings {
  archiveRoot: string;
  defaultDestinazione: string;
  defaultAutore: string;
  cartellePredefinite: string[];
  archiveHierarchy: ArchivioArchiveHierarchyConfig;
}

export interface ArchivioImportRequest {
  sdPath: string;
  nomeLavoro: string;
  dataLavoro: string;
  autore: string;
  destinazione: string;
  sottoCartella: string;
  contrattoLink?: string;
  existingJobId?: string;
  rinominaFile: boolean;
  generaJpg: boolean;
  fileNameIncludes?: string;
  mtimeFrom?: string;
  mtimeTo?: string;
}

export interface ArchivioImportResult {
  ok: boolean;
  job: ArchivioJob;
  reusedExistingJob?: boolean;
  copiedFiles: number;
  skippedFiles: number;
  jpgGenerati: number;
  cartellaFotoFinale: string;
  errors: string[];
}

export interface ArchivioImportProgressSnapshot {
  active: boolean;
  phase: "idle" | "copying" | "compressing" | "done" | "error";
  scannedFiles: number;
  plannedFiles: number;
  copiedFiles: number;
  skippedFiles: number;
  manifestSkippedFiles: number;
  inFlight: number;
  copyConcurrency: number;
  initialCopyConcurrency: number;
  elapsedMs: number;
  estimatedRemainingSec: number | null;
  targetFolder: string;
  jpgEnabled: boolean;
  jpgPlanned: number;
  jpgDone: number;
  error: string | null;
  completedScheduled: number;
  knownTotal: number;
  progressPct: number;
  totalWorkItems: number;
  completedWorkItems: number;
  remainingWorkItems: number;
  overallProgressPct: number;
  currentPhaseLabel: string;
  currentFileName: string | null;
  currentSpeedFilesPerSec: number | null;
  currentSpeedBytesPerSec: number | null;
}

export interface ArchivioLowQualityProgressSnapshot {
  active: boolean;
  jobId: string;
  jobName: string;
  phase: "idle" | "scanning" | "compressing" | "done" | "error";
  totalJpg: number;
  processedJpg: number;
  generated: number;
  skippedExisting: number;
  errors: number;
  overwrite: boolean;
  elapsedMs: number;
  estimatedRemainingSec: number | null;
  outputDir: string;
  sourceRoot: string;
  error: string | null;
  progressPct: number;
}

export interface ArchivioFilterPreviewData {
  ok: true;
  scannedFiles: number;
  matchedFiles: number;
  matchedRawFiles: number;
  matchedJpgFiles: number;
  minMtimeMs: number | null;
  maxMtimeMs: number | null;
  sampleFiles: Array<{
    filePath: string;
    fileName: string;
    mtimeMs: number;
    size: number;
    ext: string;
    isJpg: boolean;
  }>;
}

export interface FileXDesktopApi {
  getRuntimeInfo: () => Promise<DesktopRuntimeInfo>;
  listAvailableTools: (channel?: DesktopReleaseChannel) => Promise<DesktopToolInstallState[]>;
  checkToolUpdate: (
    toolId: DesktopToolId,
    currentVersion?: string | null,
    channel?: DesktopReleaseChannel,
  ) => Promise<DesktopToolUpdateCheckResult>;
  downloadToolUpdate: (
    toolId: DesktopToolId,
    channel?: DesktopReleaseChannel,
  ) => Promise<DesktopToolUpdateJob>;
  applyToolUpdate: (jobId: string) => Promise<DesktopToolUpdateJob>;
  openInstalledTool: (
    toolId: DesktopToolId,
    launchArgs?: string[],
  ) => Promise<{ ok: boolean; message: string }>;
  getImageIdPrintAiStatus: () => Promise<DesktopAiSidecarStatus>;
  openFolder: () => Promise<DesktopFolderOpenResult | null>;
  reopenFolder: (rootPath: string) => Promise<DesktopFolderOpenResult | null>;
  consumePendingOpenFolderPath: () => Promise<string | null>;
  acknowledgeOpenFolderRequest: (folderPath?: string | null) => Promise<void>;
  markOpenFolderRequestReady: () => Promise<void>;
  onOpenFolderRequest: (listener: (folderPath: string) => void) => () => void;
  createAutoLayoutHandoffFile: (payload: DesktopAutoLayoutHandoffFile) => Promise<string | null>;
  consumePendingOpenProjectPath: () => Promise<string | null>;
  markOpenProjectRequestReady: () => Promise<void>;
  onOpenProjectRequest: (listener: (projectPath: string) => void) => () => void;
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
  getRamBudgetInfo: () => Promise<DesktopThumbnailCacheInfo>;
  setRamBudgetPreset: (preset: DesktopRamBudgetPreset) => Promise<DesktopThumbnailCacheInfo>;
  relaunch: () => Promise<void>;
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
  copyFilesToFolder: (absolutePaths: string[]) => Promise<DesktopCopyFilesResult>;
  moveFilesToFolder: (absolutePaths: string[]) => Promise<DesktopMoveFilesResult>;
  saveFileAs: (absolutePath: string) => Promise<DesktopSaveFileAsResult>;
  getDesktopPreferences: () => Promise<DesktopPhotoSelectorPreferences>;
  saveDesktopPreferences: (
    preferences: DesktopPhotoSelectorPreferences,
  ) => Promise<DesktopPhotoSelectorPreferences>;
  getDesktopSessionState: () => Promise<DesktopPersistedState | null>;
  saveDesktopSessionState: (state: DesktopPersistedState) => Promise<void>;
  getAutoLayoutProjects: () => Promise<unknown[]>;
  saveAutoLayoutProjects: (projects: unknown[]) => Promise<void>;
  chooseOutputFolder: () => Promise<string | null>;
  saveNewFileAs: (suggestedName: string, bytes: Uint8Array) => Promise<string | null>;
  writeFile: (absolutePath: string, bytes: Uint8Array) => Promise<boolean>;
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
  browseArchivioFolder: () => Promise<string | null>;
  getArchivioSettings: () => Promise<ArchivioSettings>;
  saveArchivioSettings: (settings: Partial<ArchivioSettings>) => Promise<ArchivioSettings>;
  getArchivioImportProgress: () => Promise<ArchivioImportProgressSnapshot>;
  cancelArchivioImport: () => Promise<{ ok: boolean; active: boolean }>;
  getArchivioLowQualityProgress: () => Promise<ArchivioLowQualityProgressSnapshot>;
  getArchivioSdCards: () => Promise<ArchivioSdCard[]>;
  getArchivioSdPreview: (sdPath: string) => Promise<ArchivioSdPreview>;
  getArchivioFilterPreview: (input: {
    sdPath: string;
    fileNameIncludes?: string;
    mtimeFrom?: string;
    mtimeTo?: string;
    maxSamples?: number;
  }) => Promise<ArchivioFilterPreviewData>;
  getArchivioPreviewImage: (sdPath: string, filePath: string) => Promise<DesktopRenderedImage | null>;
  startArchivioImport: (input: ArchivioImportRequest) => Promise<ArchivioImportResult>;
  listArchivioJobs: () => Promise<ArchivioJob[]>;
  deleteArchivioJob: (jobId: string) => Promise<{ ok: boolean }>;
  updateArchivioJobContractLink: (jobId: string, contrattoLink: string) => Promise<ArchivioJob>;
  listArchivioJobSubfolders: (jobId: string) => Promise<{ subfolders: string[] }>;
  listArchivioJobSelectionCandidates: (jobId: string) => Promise<{
    candidates: ArchivioSelectionCandidate[];
    preferredPath: string | null;
  }>;
  generateArchivioLowQuality: (jobId: string, overwrite: boolean, sourceSubfolder?: string) => Promise<{
    ok: boolean;
    jobId: string;
    totalJpg: number;
    generated: number;
    skippedExisting: number;
    errors: number;
    overwrite: boolean;
    sourceSubfolder: string | null;
    preserveStructure: boolean;
    outputDir: string;
    durationMs: number;
  }>;
  openArchivioFolder: (folderPath: string) => Promise<{ ok: boolean }>;
}
