import { contextBridge, ipcRenderer } from "electron";
import type { FileSendDesktopApi } from "../src/contracts.js";

const api: FileSendDesktopApi = {
  getSnapshot: () => ipcRenderer.invoke("filex-send:get-snapshot"),
  startSession: (label) => ipcRenderer.invoke("filex-send:start-session", label),
  startRemoteSession: (label, expiresAt) => ipcRenderer.invoke("filex-send:start-remote-session", label, expiresAt),
  startSendSession: (mode, label, expiresAt) => ipcRenderer.invoke("filex-send:start-send-session", mode, label, expiresAt),
  selectSession: (mode, sessionId) => ipcRenderer.invoke("filex-send:select-session", mode, sessionId),
  closeSession: (mode, sessionId) => ipcRenderer.invoke("filex-send:close-session", mode, sessionId),
  chooseOutputRoot: () => ipcRenderer.invoke("filex-send:choose-output-root"),
  saveWifi: (wifi) => ipcRenderer.invoke("filex-send:save-wifi", wifi),
  detectWifi: () => ipcRenderer.invoke("filex-send:detect-wifi"),
  openSessionFolder: (mode, sessionId) => ipcRenderer.invoke("filex-send:open-session-folder", mode, sessionId),
  openHistoryFolder: (sessionId) => ipcRenderer.invoke("filex-send:open-history-folder", sessionId),
};

contextBridge.exposeInMainWorld("fileXSend", api);
