import { contextBridge, ipcRenderer } from "electron";
import type { BackupGuardDesktopApi } from "../src/contracts.js";

const api: BackupGuardDesktopApi = {
  isTestMode: () => ipcRenderer.invoke("backup-guard:is-test-mode"),
  browseFolder: (role) => ipcRenderer.invoke("backup-guard:browse", role),
  getConfiguration: () => ipcRenderer.invoke("backup-guard:get-configuration"),
  saveConfiguration: (masterPath, clonePath) => ipcRenderer.invoke("backup-guard:save-configuration", masterPath, clonePath),
  scan: () => ipcRenderer.invoke("backup-guard:scan"),
  execute: (scanId, confirmDeletions) => ipcRenderer.invoke("backup-guard:execute", scanId, confirmDeletions),
  getProgress: () => ipcRenderer.invoke("backup-guard:get-progress"),
  pause: () => ipcRenderer.invoke("backup-guard:pause"),
  resume: () => ipcRenderer.invoke("backup-guard:resume"),
  cancel: () => ipcRenderer.invoke("backup-guard:cancel"),
  deepVerify: () => ipcRenderer.invoke("backup-guard:deep-verify"),
  listTrash: () => ipcRenderer.invoke("backup-guard:list-trash"),
  recoverTrash: (sessionId) => ipcRenderer.invoke("backup-guard:recover-trash", sessionId),
  deleteTrash: (sessionId) => ipcRenderer.invoke("backup-guard:delete-trash", sessionId),
  openPath: (path) => ipcRenderer.invoke("backup-guard:open-path", path),
  exportHistoryReport: () => ipcRenderer.invoke("backup-guard:export-history"),
  resolveConflict: (scanId, relativePath, action) => ipcRenderer.invoke("backup-guard:resolve-conflict", scanId, relativePath, action),
  listPendingProjects: () => ipcRenderer.invoke("backup-guard:list-pending-projects"),
  listHistory: () => ipcRenderer.invoke("backup-guard:list-history"),
};
contextBridge.exposeInMainWorld("backupGuard", api);
