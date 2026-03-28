import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { FileXDesktopApi } from "@photo-tools/desktop-contracts";

const api: FileXDesktopApi = {
  getRuntimeInfo: () => ipcRenderer.invoke("filex:get-runtime-info"),
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
  getDesktopPreferences: () => ipcRenderer.invoke("filex:get-desktop-preferences"),
  saveDesktopPreferences: (preferences) => ipcRenderer.invoke("filex:save-desktop-preferences", preferences),
  getDesktopSessionState: () => ipcRenderer.invoke("filex:get-desktop-session-state"),
  saveDesktopSessionState: (state) => ipcRenderer.invoke("filex:save-desktop-session-state", state),
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
};

contextBridge.exposeInMainWorld("filexDesktop", api);
