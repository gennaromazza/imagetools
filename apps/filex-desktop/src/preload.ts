import { contextBridge, ipcRenderer } from "electron";
import type { FileXDesktopApi } from "@photo-tools/desktop-contracts";

const api: FileXDesktopApi = {
  getRuntimeInfo: () => ipcRenderer.invoke("filex:get-runtime-info"),
  openFolder: () => ipcRenderer.invoke("filex:open-folder"),
  reopenFolder: (rootPath) => ipcRenderer.invoke("filex:reopen-folder", rootPath),
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
  chooseEditorExecutable: (currentPath) => ipcRenderer.invoke("filex:choose-editor-executable", currentPath),
  getInstalledEditorCandidates: () => ipcRenderer.invoke("filex:get-installed-editor-candidates"),
  openWithEditor: (editorPath, absolutePaths) =>
    ipcRenderer.invoke("filex:open-with-editor", editorPath, absolutePaths),
  readSidecarXmp: (absolutePath) => ipcRenderer.invoke("filex:read-sidecar-xmp", absolutePath),
  writeSidecarXmp: (absolutePath, xml) => ipcRenderer.invoke("filex:write-sidecar-xmp", absolutePath, xml),
};

contextBridge.exposeInMainWorld("filexDesktop", api);
