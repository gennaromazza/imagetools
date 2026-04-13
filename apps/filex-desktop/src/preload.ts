import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { FileXDesktopApi } from "@photo-tools/desktop-contracts";

const api: FileXDesktopApi = {
  getRuntimeInfo: () => ipcRenderer.invoke("filex:get-runtime-info"),
  listAvailableTools: (channel) => ipcRenderer.invoke("filex:list-available-tools", channel),
  checkToolUpdate: (toolId, currentVersion, channel) =>
    ipcRenderer.invoke("filex:check-tool-update", toolId, currentVersion, channel),
  downloadToolUpdate: (toolId, channel) => ipcRenderer.invoke("filex:download-tool-update", toolId, channel),
  applyToolUpdate: (jobId) => ipcRenderer.invoke("filex:apply-tool-update", jobId),
  openInstalledTool: (toolId, launchArgs) => ipcRenderer.invoke("filex:open-installed-tool", toolId, launchArgs),
  getImageIdPrintAiStatus: () => ipcRenderer.invoke("filex:get-image-id-print-ai-status"),
  openFolder: () => ipcRenderer.invoke("filex:open-folder"),
  reopenFolder: (rootPath) => ipcRenderer.invoke("filex:reopen-folder", rootPath),
  consumePendingOpenFolderPath: () => ipcRenderer.invoke("filex:consume-pending-open-folder-path"),
  markOpenFolderRequestReady: () => ipcRenderer.invoke("filex:mark-open-folder-request-ready"),
  onOpenFolderRequest: (listener) => {
    const wrappedListener = (_event: IpcRendererEvent, folderPath: string) => {
      listener(folderPath);
    };
    ipcRenderer.on("filex:open-folder-request", wrappedListener);
    return () => {
      ipcRenderer.removeListener("filex:open-folder-request", wrappedListener);
    };
  },
  createAutoLayoutHandoffFile: (payload) => ipcRenderer.invoke("filex:create-auto-layout-handoff-file", payload),
  consumePendingOpenProjectPath: () => ipcRenderer.invoke("filex:consume-pending-open-project-path"),
  markOpenProjectRequestReady: () => ipcRenderer.invoke("filex:mark-open-project-request-ready"),
  onOpenProjectRequest: (listener) => {
    const wrappedListener = (_event: IpcRendererEvent, projectPath: string) => {
      listener(projectPath);
    };
    ipcRenderer.on("filex:open-project-request", wrappedListener);
    return () => {
      ipcRenderer.removeListener("filex:open-project-request", wrappedListener);
    };
  },
  canStartDragOut: (absolutePaths) => ipcRenderer.invoke("filex:can-start-drag-out", absolutePaths),
  startDragOut: (absolutePaths) => ipcRenderer.send("filex:start-drag-out", absolutePaths),
  readFile: (absolutePath) => ipcRenderer.invoke("filex:read-file", absolutePath),
  getThumbnail: (absolutePath, maxDimension, quality, sourceFileKey) =>
    ipcRenderer.invoke("filex:get-thumbnail", absolutePath, maxDimension, quality, sourceFileKey),
  getCachedThumbnails: (entries, maxDimension, quality) =>
    ipcRenderer.invoke("filex:get-cached-thumbnails", entries, maxDimension, quality),
  getThumbnailCacheInfo: () => ipcRenderer.invoke("filex:get-thumbnail-cache-info"),
  chooseThumbnailCacheDirectory: () => ipcRenderer.invoke("filex:choose-thumbnail-cache-directory"),
  setThumbnailCacheDirectory: (directoryPath) =>
    ipcRenderer.invoke("filex:set-thumbnail-cache-directory", directoryPath),
  resetThumbnailCacheDirectory: () => ipcRenderer.invoke("filex:reset-thumbnail-cache-directory"),
  clearThumbnailCache: () => ipcRenderer.invoke("filex:clear-thumbnail-cache"),
  getRamBudgetInfo: () => ipcRenderer.invoke("filex:get-ram-budget-info"),
  setRamBudgetPreset: (preset) => ipcRenderer.invoke("filex:set-ram-budget-preset", preset),
  relaunch: () => ipcRenderer.invoke("filex:relaunch"),
  getCacheLocationRecommendation: () => ipcRenderer.invoke("filex:get-cache-location-recommendation"),
  migrateThumbnailCacheDirectory: (directoryPath) =>
    ipcRenderer.invoke("filex:migrate-thumbnail-cache-directory", directoryPath),
  dismissCacheLocationRecommendation: () =>
    ipcRenderer.invoke("filex:dismiss-cache-location-recommendation"),
  getPreview: (absolutePath, options) => ipcRenderer.invoke("filex:get-preview", absolutePath, options),
  warmPreview: (absolutePath, options) => ipcRenderer.invoke("filex:warm-preview", absolutePath, options),
  getQuickPreviewFrame: (request) => ipcRenderer.invoke("filex:get-quick-preview-frame", request),
  warmQuickPreviewFrames: (requests) => ipcRenderer.invoke("filex:warm-quick-preview-frames", requests),
  releaseQuickPreviewFrames: (tokens) => ipcRenderer.invoke("filex:release-quick-preview-frames", tokens),
  chooseEditorExecutable: (currentPath) => ipcRenderer.invoke("filex:choose-editor-executable", currentPath),
  getInstalledEditorCandidates: () => ipcRenderer.invoke("filex:get-installed-editor-candidates"),
  sendToEditor: (editorPath, absolutePaths) =>
    ipcRenderer.invoke("filex:send-to-editor", editorPath, absolutePaths),
  openWithEditor: (editorPath, absolutePaths) =>
    ipcRenderer.invoke("filex:open-with-editor", editorPath, absolutePaths),
  copyFilesToFolder: (absolutePaths) =>
    ipcRenderer.invoke("filex:copy-files-to-folder", absolutePaths),
  moveFilesToFolder: (absolutePaths) =>
    ipcRenderer.invoke("filex:move-files-to-folder", absolutePaths),
  saveFileAs: (absolutePath) =>
    ipcRenderer.invoke("filex:save-file-as", absolutePath),
  getDesktopPreferences: () => ipcRenderer.invoke("filex:get-desktop-preferences"),
  saveDesktopPreferences: (preferences) => ipcRenderer.invoke("filex:save-desktop-preferences", preferences),
  getDesktopSessionState: () => ipcRenderer.invoke("filex:get-desktop-session-state"),
  saveDesktopSessionState: (state) => ipcRenderer.invoke("filex:save-desktop-session-state", state),
  getAutoLayoutProjects: () => ipcRenderer.invoke("filex:get-auto-layout-projects"),
  saveAutoLayoutProjects: (projects: unknown[]) => ipcRenderer.invoke("filex:save-auto-layout-projects", projects),
  chooseOutputFolder: () => ipcRenderer.invoke("filex:choose-output-folder"),
  saveNewFileAs: (suggestedName: string, bytes: Uint8Array) =>
    ipcRenderer.invoke("filex:save-new-file-as", suggestedName, bytes),
  writeFile: (absolutePath: string, bytes: Uint8Array) =>
    ipcRenderer.invoke("filex:write-file", absolutePath, bytes),
  getRecentFolders: () => ipcRenderer.invoke("filex:get-recent-folders"),
  saveRecentFolder: (folder) => ipcRenderer.invoke("filex:save-recent-folder", folder),
  removeRecentFolder: (folderPathOrName) => ipcRenderer.invoke("filex:remove-recent-folder", folderPathOrName),
  getSortCache: (folderPath) => ipcRenderer.invoke("filex:get-sort-cache", folderPath),
  saveSortCache: (entry) => ipcRenderer.invoke("filex:save-sort-cache", entry),
  getFolderCatalogState: (folderPath) => ipcRenderer.invoke("filex:get-folder-catalog-state", folderPath),
  saveFolderCatalogState: (state) => ipcRenderer.invoke("filex:save-folder-catalog-state", state),
  saveFolderAssetStates: (folderPath, assetStates) =>
    ipcRenderer.invoke("filex:save-folder-asset-states", folderPath, assetStates),
  getDesktopPerformanceSnapshot: () => ipcRenderer.invoke("filex:get-desktop-performance-snapshot"),
  recordDesktopPerformanceSnapshot: (snapshot) =>
    ipcRenderer.invoke("filex:record-desktop-performance-snapshot", snapshot),
  logDesktopEvent: (event) => ipcRenderer.invoke("filex:log-desktop-event", event),
  readSidecarXmp: (absolutePath) => ipcRenderer.invoke("filex:read-sidecar-xmp", absolutePath),
  writeSidecarXmp: (absolutePath, xml) => ipcRenderer.invoke("filex:write-sidecar-xmp", absolutePath, xml),
  browseArchivioFolder: () => ipcRenderer.invoke("filex:browse-archivio-folder"),
  getArchivioSettings: () => ipcRenderer.invoke("filex:get-archivio-settings"),
  saveArchivioSettings: (settings) => ipcRenderer.invoke("filex:save-archivio-settings", settings),
  getArchivioImportProgress: () => ipcRenderer.invoke("filex:get-archivio-import-progress"),
  cancelArchivioImport: () => ipcRenderer.invoke("filex:cancel-archivio-import"),
  getArchivioLowQualityProgress: () => ipcRenderer.invoke("filex:get-archivio-low-quality-progress"),
  getArchivioSdCards: () => ipcRenderer.invoke("filex:get-archivio-sd-cards"),
  getArchivioSdPreview: (sdPath) => ipcRenderer.invoke("filex:get-archivio-sd-preview", sdPath),
  getArchivioFilterPreview: (input) => ipcRenderer.invoke("filex:get-archivio-filter-preview", input),
  getArchivioPreviewImage: (sdPath, filePath) => ipcRenderer.invoke("filex:get-archivio-preview-image", sdPath, filePath),
  startArchivioImport: (input) => ipcRenderer.invoke("filex:start-archivio-import", input),
  listArchivioJobs: () => ipcRenderer.invoke("filex:list-archivio-jobs"),
  deleteArchivioJob: (jobId) => ipcRenderer.invoke("filex:delete-archivio-job", jobId),
  updateArchivioJobContractLink: (jobId, contrattoLink) =>
    ipcRenderer.invoke("filex:update-archivio-job-contract-link", jobId, contrattoLink),
  listArchivioJobSubfolders: (jobId) =>
    ipcRenderer.invoke("filex:list-archivio-job-subfolders", jobId),
  listArchivioJobSelectionCandidates: (jobId) =>
    ipcRenderer.invoke("filex:list-archivio-job-selection-candidates", jobId),
  generateArchivioLowQuality: (jobId, overwrite, sourceSubfolder) =>
    ipcRenderer.invoke("filex:generate-archivio-low-quality", jobId, overwrite, sourceSubfolder),
  openArchivioFolder: (folderPath) => ipcRenderer.invoke("filex:open-archivio-folder", folderPath),
};

contextBridge.exposeInMainWorld("filexDesktop", api);
