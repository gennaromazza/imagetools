import * as electron from "electron";
import type {
  DesktopDockState,
  DesktopReleaseChannel,
  DesktopSuiteUpdateState,
  DesktopToolId,
} from "@photo-tools/desktop-contracts";

const { contextBridge, ipcRenderer } = electron;

const suiteApi = {
  getRuntimeInfo: () => ipcRenderer.invoke("filex:get-runtime-info"),
  getSuiteUpdateState: () => ipcRenderer.invoke("filex:get-suite-update-state"),
  checkSuiteUpdate: () => ipcRenderer.invoke("filex:check-suite-update"),
  installSuiteUpdate: () => ipcRenderer.invoke("filex:install-suite-update"),
  prepareSuiteUpdate: (): Promise<DesktopToolId[]> => ipcRenderer.invoke("filex:prepare-suite-update"),
  onSuiteUpdateState: (listener: (state: DesktopSuiteUpdateState) => void) => {
    const wrappedListener = (_event: electron.IpcRendererEvent, state: DesktopSuiteUpdateState) => listener(state);
    ipcRenderer.on("filex:suite-update-state", wrappedListener);
    return () => ipcRenderer.removeListener("filex:suite-update-state", wrappedListener);
  },
  listAvailableTools: (channel?: DesktopReleaseChannel) =>
    ipcRenderer.invoke("filex:list-available-tools", channel),
  checkToolUpdate: (toolId: DesktopToolId, currentVersion?: string | null, channel?: DesktopReleaseChannel) =>
    ipcRenderer.invoke("filex:check-tool-update", toolId, currentVersion, channel),
  downloadToolUpdate: (toolId: DesktopToolId, channel?: DesktopReleaseChannel) =>
    ipcRenderer.invoke("filex:download-tool-update", toolId, channel),
  getToolUpdateJob: (jobId: string) => ipcRenderer.invoke("filex:get-tool-update-job", jobId),
  applyToolUpdate: (jobId: string) => ipcRenderer.invoke("filex:apply-tool-update", jobId),
  forceCloseToolForUpdate: (toolId: DesktopToolId) =>
    ipcRenderer.invoke("filex:force-close-tool-for-update", toolId),
  openInstalledTool: (toolId: DesktopToolId, launchArgs?: string[]) =>
    ipcRenderer.invoke("filex:open-installed-tool", toolId, launchArgs),
  getSuiteDockState: (): Promise<DesktopDockState> => ipcRenderer.invoke("filex:get-suite-dock-state"),
  saveSuiteDockState: (state: Partial<DesktopDockState>): Promise<DesktopDockState> =>
    ipcRenderer.invoke("filex:save-suite-dock-state", state),
  setSuiteDockEnabled: (enabled: boolean): Promise<DesktopDockState> =>
    ipcRenderer.invoke("filex:set-suite-dock-enabled", enabled),
  getLicenseState: (refresh?: boolean) => ipcRenderer.invoke("filex:get-license-state", refresh),
  activateLicense: (licenseKey: string, deviceLabel?: string) =>
    ipcRenderer.invoke("filex:activate-license", licenseKey, deviceLabel),
  deactivateLicense: () => ipcRenderer.invoke("filex:deactivate-license"),
  openLicenseCheckout: (billingPeriod: "monthly" | "annual") =>
    ipcRenderer.invoke("filex:open-license-checkout", billingPeriod),
};

contextBridge.exposeInMainWorld("filexDesktop", suiteApi);
