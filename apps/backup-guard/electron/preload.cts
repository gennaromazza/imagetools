import { contextBridge, ipcRenderer } from "electron";
import type { BackupGuardDesktopApi } from "../src/contracts.js";

const api: BackupGuardDesktopApi = {
  browseFolder: (role) => ipcRenderer.invoke("backup-guard:browse", role),
  getConfiguration: () => ipcRenderer.invoke("backup-guard:get-configuration"),
  saveConfiguration: (masterPath, clonePath) => ipcRenderer.invoke("backup-guard:save-configuration", masterPath, clonePath),
  scan: () => ipcRenderer.invoke("backup-guard:scan"),
  listHistory: () => ipcRenderer.invoke("backup-guard:list-history"),
};
contextBridge.exposeInMainWorld("backupGuard", api);
