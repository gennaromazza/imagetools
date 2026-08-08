import * as electron from "electron";
import type { IpcRendererEvent } from "electron";
import type { FileXDesktopApi } from "@photo-tools/desktop-contracts";

const { contextBridge, ipcRenderer, webUtils } = electron;

const api: FileXDesktopApi = {
  getRuntimeInfo: () => ipcRenderer.invoke("filex:get-runtime-info"),
  getGraphicsStatus: () => ipcRenderer.invoke("filex:get-graphics-status"),
  getSuiteUpdateState: () => ipcRenderer.invoke("filex:get-suite-update-state"),
  checkSuiteUpdate: () => ipcRenderer.invoke("filex:check-suite-update"),
  installSuiteUpdate: () => ipcRenderer.invoke("filex:install-suite-update"),
  onSuiteUpdateState: (listener) => {
    const wrappedListener = (_event: IpcRendererEvent, state: Parameters<typeof listener>[0]) => {
      listener(state);
    };
    ipcRenderer.on("filex:suite-update-state", wrappedListener);
    return () => ipcRenderer.removeListener("filex:suite-update-state", wrappedListener);
  },
  listAvailableTools: (channel) => ipcRenderer.invoke("filex:list-available-tools", channel),
  checkToolUpdate: (toolId, currentVersion, channel) =>
    ipcRenderer.invoke("filex:check-tool-update", toolId, currentVersion, channel),
  downloadToolUpdate: (toolId, channel) => ipcRenderer.invoke("filex:download-tool-update", toolId, channel),
  getToolUpdateJob: (jobId) => ipcRenderer.invoke("filex:get-tool-update-job", jobId),
  applyToolUpdate: (jobId) => ipcRenderer.invoke("filex:apply-tool-update", jobId),
  openInstalledTool: (toolId, launchArgs) => ipcRenderer.invoke("filex:open-installed-tool", toolId, launchArgs),
  getSuiteDockState: () => ipcRenderer.invoke("filex:get-suite-dock-state"),
  saveSuiteDockState: (state) => ipcRenderer.invoke("filex:save-suite-dock-state", state),
  openFolder: (options) => ipcRenderer.invoke("filex:open-folder", options),
  reopenFolder: (rootPath, options) => ipcRenderer.invoke("filex:reopen-folder", rootPath, options),
  consumePendingOpenFolderPath: () => ipcRenderer.invoke("filex:consume-pending-open-folder-path"),
  acknowledgeOpenFolderRequest: (folderPath: string | null | undefined) =>
    ipcRenderer.invoke("filex:acknowledge-open-folder-request", folderPath),
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
  statFiles: (absolutePaths) => ipcRenderer.invoke("filex:stat-files", absolutePaths),
  getThumbnail: (absolutePath, maxDimension, quality, sourceFileKey, options) =>
    ipcRenderer.invoke("filex:get-thumbnail", absolutePath, maxDimension, quality, sourceFileKey, options),
  getThumbnailFrame: (absolutePath, maxDimension, quality, sourceFileKey, options) =>
    ipcRenderer.invoke("filex:get-thumbnail-frame", absolutePath, maxDimension, quality, sourceFileKey, options),
  getThumbnails: (requests) => ipcRenderer.invoke("filex:get-thumbnails", requests),
  getCachedThumbnails: (entries, maxDimension, quality) =>
    ipcRenderer.invoke("filex:get-cached-thumbnails", entries, maxDimension, quality),
  getCachedThumbnailFrames: (entries, maxDimension, quality) =>
    ipcRenderer.invoke("filex:get-cached-thumbnail-frames", entries, maxDimension, quality),
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
  chooseImageFile: (currentPath) => ipcRenderer.invoke("filex:choose-image-file", currentPath),
  copyFilesToFolder: (absolutePaths) =>
    ipcRenderer.invoke("filex:copy-files-to-folder", absolutePaths),
  moveFilesToFolder: (absolutePaths) =>
    ipcRenderer.invoke("filex:move-files-to-folder", absolutePaths),
  saveFileAs: (absolutePath) =>
    ipcRenderer.invoke("filex:save-file-as", absolutePath),
  getDesktopPreferences: () => ipcRenderer.invoke("filex:get-desktop-preferences"),
  saveDesktopPreferences: (preferences) => ipcRenderer.invoke("filex:save-desktop-preferences", preferences),
  readPhotoSelectorProjectFile: (rootPath) =>
    ipcRenderer.invoke("filex:read-photo-selector-project-file", rootPath),
  writePhotoSelectorProjectFile: (rootPath, project) =>
    ipcRenderer.invoke("filex:write-photo-selector-project-file", rootPath, project),
  relocatePhotoSelectorProjectFile: (sourceRootPath, targetRootPath, project) =>
    ipcRenderer.invoke("filex:relocate-photo-selector-project-file", sourceRootPath, targetRootPath, project),
  resolvePhotoSelectorProject: (folderPath) =>
    ipcRenderer.invoke("filex:resolve-photo-selector-project", folderPath),
  listPhotoSelectorLegacyProjects: (rootPath) =>
    ipcRenderer.invoke("filex:list-photo-selector-legacy-projects", rootPath),
  getGoogleDriveStatus: () => ipcRenderer.invoke("filex:get-google-drive-status"),
  connectGoogleDrive: () => ipcRenderer.invoke("filex:connect-google-drive"),
  disconnectGoogleDrive: () => ipcRenderer.invoke("filex:disconnect-google-drive"),
  exportPhotoSelectorProjectToDrive: (manifest) =>
    ipcRenderer.invoke("filex:export-photo-selector-project-to-drive", manifest),
  listPhotoSelectorDriveVersions: (projectName) =>
    ipcRenderer.invoke("filex:list-photo-selector-drive-versions", projectName),
  downloadPhotoSelectorDriveVersion: (versionId) =>
    ipcRenderer.invoke("filex:download-photo-selector-drive-version", versionId),
  getDesktopSessionState: () => ipcRenderer.invoke("filex:get-desktop-session-state"),
  saveDesktopSessionState: (state) => ipcRenderer.invoke("filex:save-desktop-session-state", state),
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
  saveFolderAssetStatesDelta: (folderPath, assetStates) =>
    ipcRenderer.invoke("filex:save-folder-asset-states-delta", folderPath, assetStates),
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
  analyzeArchivioArchive: () => ipcRenderer.invoke("filex:analyze-archivio-archive"),
  renameArchivioArchiveJobs: (requests) => ipcRenderer.invoke("filex:rename-archivio-archive-jobs", requests),
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
  getImageConverterPresets: () => ipcRenderer.invoke("filex:get-image-converter-presets"),
  chooseImageConverterFolders: () => ipcRenderer.invoke("filex:choose-image-converter-folders"),
  scanImageConverterInputs: (paths) => ipcRenderer.invoke("filex:scan-image-converter-inputs", paths),
  startImageConverterJob: (config) => ipcRenderer.invoke("filex:start-image-converter-job", config),
  getImageConverterProgress: () => ipcRenderer.invoke("filex:get-image-converter-progress"),
  cancelImageConverterJob: () => ipcRenderer.invoke("filex:cancel-image-converter-job"),
  openImageConverterFolder: (folderPath) => ipcRenderer.invoke("filex:open-image-converter-folder", folderPath),
  chooseImageFileFinderSourceFolder: () => ipcRenderer.invoke("filex:choose-image-file-finder-source-folder"),
  chooseImageFileFinderDestinationFolder: () => ipcRenderer.invoke("filex:choose-image-file-finder-destination-folder"),
  scanImageFileFinderMatches: (request) => ipcRenderer.invoke("filex:scan-image-file-finder-matches", request),
  startImageFileFinderJob: (config) => ipcRenderer.invoke("filex:start-image-file-finder-job", config),
  getImageFileFinderProgress: () => ipcRenderer.invoke("filex:get-image-file-finder-progress"),
  cancelImageFileFinderJob: () => ipcRenderer.invoke("filex:cancel-image-file-finder-job"),
  openImageFileFinderFolder: (folderPath) => ipcRenderer.invoke("filex:open-image-file-finder-folder", folderPath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld("filexDesktop", api);
