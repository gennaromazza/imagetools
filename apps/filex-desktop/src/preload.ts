import { contextBridge, ipcRenderer } from "electron";
import type { FileXDesktopApi } from "@photo-tools/desktop-contracts";

const api: FileXDesktopApi = {
  getRuntimeInfo: () => ipcRenderer.invoke("filex:get-runtime-info"),
  openFolder: () => ipcRenderer.invoke("filex:open-folder"),
  reopenFolder: (rootPath) => ipcRenderer.invoke("filex:reopen-folder", rootPath),
  readFile: (absolutePath) => ipcRenderer.invoke("filex:read-file", absolutePath),
  getThumbnail: (absolutePath, maxDimension, quality) =>
    ipcRenderer.invoke("filex:get-thumbnail", absolutePath, maxDimension, quality),
  getPreview: (absolutePath) => ipcRenderer.invoke("filex:get-preview", absolutePath),
  readSidecarXmp: (absolutePath) => ipcRenderer.invoke("filex:read-sidecar-xmp", absolutePath),
  writeSidecarXmp: (absolutePath, xml) => ipcRenderer.invoke("filex:write-sidecar-xmp", absolutePath, xml),
};

contextBridge.exposeInMainWorld("filexDesktop", api);
