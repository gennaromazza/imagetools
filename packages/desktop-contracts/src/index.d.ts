export type DesktopToolId =
  | "auto-layout-app"
  | "image-party-frame"
  | "image-id-print"
  | "archivio-flow"
  | "photo-selector-app";

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

export interface DesktopOpenWithEditorResult {
  ok: boolean;
  error?: string;
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

export interface FileXDesktopApi {
  getRuntimeInfo: () => Promise<DesktopRuntimeInfo>;
  openFolder: () => Promise<DesktopFolderOpenResult | null>;
  reopenFolder: (rootPath: string) => Promise<DesktopFolderOpenResult | null>;
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
  chooseEditorExecutable: (currentPath?: string) => Promise<string | null>;
  getInstalledEditorCandidates: () => Promise<DesktopEditorCandidate[]>;
  openWithEditor: (
    editorPath: string,
    absolutePaths: string[],
  ) => Promise<DesktopOpenWithEditorResult>;
  readSidecarXmp: (absolutePath: string) => Promise<string | null>;
  writeSidecarXmp: (absolutePath: string, xml: string) => Promise<boolean>;
}
