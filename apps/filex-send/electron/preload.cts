import { contextBridge, ipcRenderer } from "electron";
import type { FileSendDesktopApi } from "../src/contracts.js";

const api: FileSendDesktopApi = {
  getSnapshot: () => ipcRenderer.invoke("filex-send:get-snapshot"),
  startSession: (label) => ipcRenderer.invoke("filex-send:start-session", label),
  startRemoteSession: (label, expiresAt) => ipcRenderer.invoke("filex-send:start-remote-session", label, expiresAt),
  closeSession: () => ipcRenderer.invoke("filex-send:close-session"),
  chooseOutputRoot: () => ipcRenderer.invoke("filex-send:choose-output-root"),
  saveWifi: (wifi) => ipcRenderer.invoke("filex-send:save-wifi", wifi),
  detectWifi: () => ipcRenderer.invoke("filex-send:detect-wifi"),
  openSessionFolder: () => ipcRenderer.invoke("filex-send:open-session-folder"),
};

contextBridge.exposeInMainWorld("fileXSend", api);
