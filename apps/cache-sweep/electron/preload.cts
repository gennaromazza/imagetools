import { contextBridge, ipcRenderer } from "electron";
import type { CacheSweepDesktopApi } from "../src/contracts.js";

const api: CacheSweepDesktopApi = {
  scan: () => ipcRenderer.invoke("cache-sweep:scan"),
  closeProcesses: (ruleIds, force) => ipcRenderer.invoke("cache-sweep:close-processes", ruleIds, force),
  cleanup: (ruleIds) => ipcRenderer.invoke("cache-sweep:cleanup", ruleIds),
  uninstallOldVersion: (candidateId) => ipcRenderer.invoke("cache-sweep:uninstall-old-version", candidateId),
};

contextBridge.exposeInMainWorld("cacheSweep", api);
