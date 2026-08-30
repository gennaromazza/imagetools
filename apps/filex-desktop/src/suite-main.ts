import * as electron from "electron";
import type {
  BrowserWindow as BrowserWindowInstance,
  Tray as TrayInstance,
} from "electron";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  DesktopDockState,
  DesktopReleaseChannel,
  DesktopRuntimeInfo,
  DesktopSuiteUpdateState,
  DesktopToolId,
} from "@photo-tools/desktop-contracts";
import {
  applyToolUpdate,
  checkToolUpdate,
  downloadToolUpdate,
  forceCloseToolForUpdate,
  getUpdateJob,
  listAvailableTools,
  openInstalledTool,
} from "./updater.js";
import {
  checkSuiteUpdate,
  configureSuiteUpdater,
  getSuiteUpdateState,
  installSuiteUpdate,
} from "./suite-updater.js";
import { desktopToolManifest, getSuiteManagedTools } from "./tool-manifest.js";
import { prepareFileXSuiteUpdate } from "./filex-process-coordinator.js";
import { activateLicense, deactivateLicense, getCheckoutConfiguration, getLicenseState } from "./license-service.js";
import {
  resolveSuiteDockEnabled,
  resolveSuiteStartupPolicy,
} from "./suite-startup-policy.js";

const { app, BrowserWindow, dialog, ipcMain, Menu, Notification, screen, shell, Tray } = electron;
const suite = desktopToolManifest["suite-launcher"];
const appUserModelId = `studio.filex.${suite.id}`;
let mainWindow: BrowserWindowInstance | null = null;
let dockWindow: BrowserWindowInstance | null = null;
let tray: TrayInstance | null = null;
let dockEnabled = true;
let toolUpdateTimer: NodeJS.Timeout | null = null;
let lastNotifiedToolUpdateCount: number | null = null;
const TOOL_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const startsInBackground = process.argv.includes("--filex-background");
const isPackagedSmokeTest = process.argv.includes("--filex-suite-packaged-smoke-test");

const defaultDockState: DesktopDockState = {
  schemaVersion: 2,
  enabled: true,
  x: 0,
  y: 0,
  opacity: 0.94,
  collapsed: true,
  autoHide: true,
  toolOrder: getSuiteManagedTools().map((tool) => tool.id),
  visibleToolCount: 0,
  settingsOpen: false,
  notificationCenterOpen: false,
  edgeAnchor: "bottom",
};

function releaseChannel(): DesktopReleaseChannel {
  return process.env.FILEX_RELEASE_CHANNEL === "beta" ? "beta" : "stable";
}

function preloadPath(): string {
  return join(app.getAppPath(), ".output", "electron", suite.electronPreloadOutputFile);
}

function rendererPath(fileName = "index.html"): string {
  return app.isPackaged
    ? join(process.resourcesPath, suite.packagedDistDir, fileName)
    : resolve(app.getAppPath(), suite.workspaceDistDirRelativeToShell, fileName);
}

function iconPath(): string {
  const extension = process.platform === "win32" ? "ico" : "png";
  return app.isPackaged
    ? join(process.resourcesPath, "branding", `${suite.id}.${extension}`)
    : resolve(app.getAppPath(), ".output", "branding", `${suite.id}.${extension}`);
}

function dockStatePath(): string {
  return join(app.getPath("userData"), "suite-dock-state.json");
}

function sanitizeDockState(value: Partial<DesktopDockState> | null | undefined): DesktopDockState {
  const allowedToolIds = new Set(getSuiteManagedTools().map((tool) => tool.id));
  const requestedOrder = Array.isArray(value?.toolOrder) ? value.toolOrder : [];
  const toolOrder = Array.from(new Set(requestedOrder.filter((toolId) => allowedToolIds.has(toolId))));
  for (const tool of getSuiteManagedTools()) {
    if (!toolOrder.includes(tool.id)) toolOrder.push(tool.id);
  }
  const x = Number(value?.x);
  const y = Number(value?.y);
  const opacity = Number(value?.opacity);
  const visibleToolCount = Number(value?.visibleToolCount);
  const nextEdgeAnchor = typeof value?.edgeAnchor === "string"
    && (value.edgeAnchor === "left" || value.edgeAnchor === "right" || value.edgeAnchor === "bottom")
      ? value.edgeAnchor
      : defaultDockState.edgeAnchor;
  return {
    schemaVersion: 2,
    enabled: resolveSuiteDockEnabled(value),
    x: Number.isFinite(x) ? Math.round(x) : 0,
    y: Number.isFinite(y) ? Math.round(y) : 0,
    opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0.45, opacity)) : defaultDockState.opacity,
    collapsed: value?.collapsed ?? defaultDockState.collapsed,
    autoHide: value?.autoHide ?? defaultDockState.autoHide,
    toolOrder,
    visibleToolCount: Number.isFinite(visibleToolCount)
      ? Math.min(getSuiteManagedTools().length, Math.max(0, Math.round(visibleToolCount)))
      : 0,
    settingsOpen: value?.settingsOpen ?? false,
    notificationCenterOpen: value?.notificationCenterOpen ?? false,
    edgeAnchor: nextEdgeAnchor,
  };
}

async function readDockState(): Promise<DesktopDockState> {
  try {
    const stored = JSON.parse(await readFile(dockStatePath(), "utf8")) as Partial<DesktopDockState>;
    return sanitizeDockState(stored);
  } catch {
    return { ...defaultDockState, toolOrder: [...defaultDockState.toolOrder] };
  }
}

function applyDockLayout(state: DesktopDockState, animate: boolean, resetPosition = false): void {
  if (!dockWindow || dockWindow.isDestroyed()) return;
  const currentBounds = dockWindow.getBounds();
  const display = screen.getDisplayMatching(currentBounds);
  const isBottomAnchor = state.edgeAnchor === "bottom";
  const isLeftAnchor = state.edgeAnchor === "left";
  const itemCount = Math.min(getSuiteManagedTools().length, Math.max(0, state.visibleToolCount));
  const collapsedSize = isBottomAnchor ? 88 : 76;
  const expandedWidth = isBottomAnchor
    ? Math.min(display.workAreaSize.width - 24, Math.max(220, 142 + itemCount * 62))
    : state.settingsOpen || state.notificationCenterOpen ? 380 : 82;
  const expandedHeight = isBottomAnchor
    ? state.notificationCenterOpen && !state.collapsed ? 420 : state.settingsOpen && !state.collapsed ? 220 : 100
    : Math.min(display.workAreaSize.height - 30, Math.max(state.notificationCenterOpen ? 340 : 220, 132 + itemCount * 62 + (state.settingsOpen && !state.collapsed ? 70 : 0)));
  const width = state.collapsed ? collapsedSize : expandedWidth;
  const height = state.collapsed ? collapsedSize : expandedHeight;
  const centerY = resetPosition
    ? display.workArea.y + display.workAreaSize.height / 2
    : currentBounds.y + currentBounds.height / 2;
  const centerX = resetPosition
    ? display.workArea.x + display.workAreaSize.width / 2
    : currentBounds.x + currentBounds.width / 2;
  const bottom = resetPosition
    ? display.workArea.y + display.workAreaSize.height - 18
    : currentBounds.y + currentBounds.height;
  const defaultY = isBottomAnchor ? Math.round(bottom - height) : Math.round(centerY - height / 2);
  const defaultX = isBottomAnchor
    ? Math.round(centerX - width / 2)
    : isLeftAnchor
      ? display.workArea.x
      : display.workArea.x + display.workAreaSize.width - width;
  const x = isBottomAnchor
    ? Math.min(
      display.workArea.x + display.workAreaSize.width - width,
      Math.max(display.workArea.x, defaultX),
    )
    : defaultX;
  const y = Math.min(
    display.workArea.y + display.workAreaSize.height - height,
    Math.max(display.workArea.y, defaultY),
  );
  dockWindow.setBounds({ x, y, width, height }, animate);
}

async function saveDockState(partial: Partial<DesktopDockState>): Promise<DesktopDockState> {
  const current = await readDockState();
  const bounds = dockWindow && !dockWindow.isDestroyed() ? dockWindow.getBounds() : null;
  const next = sanitizeDockState({
    ...current,
    ...partial,
    x: typeof partial.x === "number" ? partial.x : bounds?.x ?? current.x,
    y: typeof partial.y === "number" ? partial.y : bounds?.y ?? current.y,
  });
  if (dockWindow && !dockWindow.isDestroyed()) {
    if (
      typeof partial.collapsed === "boolean"
      || typeof partial.visibleToolCount === "number"
      || typeof partial.settingsOpen === "boolean"
      || typeof partial.notificationCenterOpen === "boolean"
      || typeof partial.edgeAnchor === "string"
    ) {
      const edgeChanged = typeof partial.edgeAnchor === "string" && partial.edgeAnchor !== current.edgeAnchor;
      applyDockLayout(next, true, edgeChanged);
      const resizedBounds = dockWindow.getBounds();
      next.x = resizedBounds.x;
      next.y = resizedBounds.y;
    }
    if (typeof partial.x === "number" || typeof partial.y === "number") {
      dockWindow.setPosition(next.x, next.y, true);
    }
    dockWindow.setOpacity(next.opacity);
  }
  await writeFile(dockStatePath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function createMainWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusMainWindow();
    return;
  }
  const title = `${suite.productName} — Versione ${app.getVersion()}`;
  const window = new BrowserWindow({
    title,
    width: suite.defaultWindowWidth,
    height: suite.defaultWindowHeight,
    minWidth: suite.minWindowWidth,
    minHeight: suite.minWindowHeight,
    autoHideMenuBar: true,
    backgroundColor: "#181d1a",
    icon: iconPath(),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow = window;
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(title);
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  const entry = rendererPath();
  if (!existsSync(entry)) throw new Error(`Renderer FileX Suite non trovato: ${entry}`);
  await window.loadFile(entry);
}

async function createDock(): Promise<void> {
  if (!dockEnabled || (dockWindow && !dockWindow.isDestroyed())) return;
  const display = screen.getPrimaryDisplay();
  const state = await readDockState();
  if (!resolveSuiteDockEnabled(state)) {
    dockEnabled = false;
    updateTrayMenu();
    return;
  }
  const isBottomAnchor = state.edgeAnchor === "bottom";
  const isLeftAnchor = state.edgeAnchor === "left";
  const itemCount = Math.min(getSuiteManagedTools().length, Math.max(0, state.visibleToolCount));
  const width = state.collapsed ? (isBottomAnchor ? 88 : 76) : isBottomAnchor
    ? Math.min(display.workAreaSize.width - 24, Math.max(220, 142 + itemCount * 62))
    : state.settingsOpen || state.notificationCenterOpen ? 380 : 82;
  const height = state.collapsed ? (isBottomAnchor ? 88 : 76) : isBottomAnchor
    ? (state.notificationCenterOpen ? 420 : state.settingsOpen ? 220 : 100)
    : Math.min(display.workAreaSize.height - 30, Math.max(state.notificationCenterOpen ? 340 : 220, 132 + itemCount * 62 + (state.settingsOpen ? 70 : 0)));
  const defaultX = isBottomAnchor
    ? Math.round(display.workArea.x + (display.workAreaSize.width - width) / 2)
    : isLeftAnchor
      ? display.workArea.x
      : display.workArea.x + display.workAreaSize.width - width;
  const defaultY = isBottomAnchor
    ? display.workArea.y + display.workAreaSize.height - height - 18
    : Math.round(display.workArea.y + (display.workAreaSize.height - height) / 2);
  dockWindow = new BrowserWindow({
    width,
    height,
    x: isBottomAnchor ? state.x || defaultX : defaultX,
    y: state.y || defaultY,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  dockWindow.setOpacity(state.opacity);
  dockWindow.setAlwaysOnTop(true, "floating");
  dockWindow.on("closed", () => { dockWindow = null; });
  const entry = rendererPath("dock.html");
  if (existsSync(entry)) {
    await dockWindow.loadFile(entry);
    dockWindow.showInactive();
  }
}

async function setDockEnabled(enabled: boolean): Promise<DesktopDockState> {
  const previousDockEnabled = dockEnabled;
  dockEnabled = enabled;
  let state: DesktopDockState;
  try {
    state = await saveDockState({
      enabled,
      settingsOpen: false,
      notificationCenterOpen: false,
    });
  } catch (error) {
    dockEnabled = previousDockEnabled;
    updateTrayMenu();
    throw error;
  }
  updateTrayMenu();
  if (enabled) {
    await createDock();
  } else {
    const windowToClose = dockWindow;
    setTimeout(() => {
      if (windowToClose && !windowToClose.isDestroyed()) windowToClose.destroy();
    }, 75);
  }
  return state;
}

async function openSuiteExperience(): Promise<void> {
  await createMainWindow();
  await createDock();
}

function updateTrayMenu(): void {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Apri FileX Suite", click: () => { void openSuiteExperience(); } },
    {
      label: "Dock Station",
      type: "checkbox",
      checked: dockEnabled,
      click: (menuItem) => {
        void setDockEnabled(menuItem.checked).catch((error) => {
          dialog.showErrorBox(
            "FileX Suite",
            `Impossibile aggiornare la Dock Station: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      },
    },
    { type: "separator" },
    ...getSuiteManagedTools().map((tool) => ({
      label: tool.displayName,
      click: async () => {
        const license = await getLicenseState();
        if (!license.canUseTools && tool.licenseRuntime !== "standalone") {
          dialog.showErrorBox("FileX Suite", "FileX All Access non e' attivo. Apri la Suite per gestire la licenza.");
          return;
        }
        const result = await openInstalledTool(tool.id);
        if (!result.ok) dialog.showErrorBox("FileX Suite", result.message);
      },
    })),
    { type: "separator" },
    { label: "Esci", click: () => app.quit() },
  ]));
}

function createTray(): void {
  if (tray) return;
  tray = new Tray(iconPath());
  tray.setToolTip("FileX Suite");
  updateTrayMenu();
  tray.on("double-click", () => { void openSuiteExperience(); });
}

async function checkToolUpdatesInBackground(): Promise<void> {
  const tools = await listAvailableTools(releaseChannel()).catch(() => []);
  const count = tools.filter((tool) => tool.status === "update-available").length;
  if (count > 0 && count !== lastNotifiedToolUpdateCount && Notification.isSupported()) {
    const notification = new Notification({
      title: "FileX Suite",
      body: `${count} ${count === 1 ? "aggiornamento è disponibile" : "aggiornamenti sono disponibili"}. Apri FileX Suite per installarli.`,
    });
    notification.on("click", () => { void openSuiteExperience(); });
    notification.show();
  }
  lastNotifiedToolUpdateCount = count;
}

function startToolUpdateChecks(): void {
  void checkToolUpdatesInBackground();
  if (!toolUpdateTimer) {
    toolUpdateTimer = setInterval(() => { void checkToolUpdatesInBackground(); }, TOOL_UPDATE_CHECK_INTERVAL_MS);
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle("filex:get-suite-update-state", () => getSuiteUpdateState());
  ipcMain.handle("filex:check-suite-update", () => checkSuiteUpdate());
  ipcMain.handle("filex:install-suite-update", () => installSuiteUpdate());
  ipcMain.handle("filex:prepare-suite-update", () => prepareFileXSuiteUpdate());
  ipcMain.handle("filex:get-runtime-info", async () => {
    const installedTools = await listAvailableTools(releaseChannel()).catch(() => []);
    const runtime: DesktopRuntimeInfo = {
      shell: "electron",
      platform: process.platform,
      isPackaged: app.isPackaged,
      appVersion: app.getVersion(),
      toolId: suite.id,
      toolName: suite.displayName,
      releaseChannel: releaseChannel(),
      aiSidecarInstalled: false,
      installedTools,
    };
    return runtime;
  });
  ipcMain.handle("filex:list-available-tools", (_event, channel?: DesktopReleaseChannel) =>
    listAvailableTools(channel ?? releaseChannel()).catch(() => []));
  ipcMain.handle(
    "filex:check-tool-update",
    (_event, toolId: DesktopToolId, currentVersion?: string | null, channel?: DesktopReleaseChannel) =>
      checkToolUpdate(toolId, currentVersion, channel ?? releaseChannel()),
  );
  ipcMain.handle("filex:download-tool-update", (_event, toolId: DesktopToolId, channel?: DesktopReleaseChannel) =>
    downloadToolUpdate(toolId, channel ?? releaseChannel()));
  ipcMain.handle("filex:get-tool-update-job", (_event, jobId: string) => getUpdateJob(jobId));
  ipcMain.handle("filex:apply-tool-update", (_event, jobId: string) => applyToolUpdate(jobId));
  ipcMain.handle("filex:force-close-tool-for-update", (_event, toolId: DesktopToolId) =>
    forceCloseToolForUpdate(toolId));
  ipcMain.handle("filex:open-installed-tool", (_event, toolId: DesktopToolId, launchArgs?: string[]) => {
    const requiresLicense = desktopToolManifest[toolId]?.licenseRuntime !== "standalone";
    return getLicenseState().then((license) => !requiresLicense || license.canUseTools
      ? openInstalledTool(toolId, launchArgs)
      : ({ ok: false, message: "FileX All Access non e' attivo. Apri la sezione Licenza nella Suite." }));
  });
  ipcMain.handle("filex:get-suite-dock-state", () => readDockState());
  ipcMain.handle("filex:save-suite-dock-state", (_event, state: Partial<DesktopDockState>) => saveDockState(state));
  ipcMain.handle("filex:set-suite-dock-enabled", (_event, enabled: boolean) => setDockEnabled(enabled !== false));
  ipcMain.handle("filex:get-license-state", (_event, refresh?: boolean) => getLicenseState(Boolean(refresh)));
  ipcMain.handle("filex:activate-license", (_event, licenseKey: string, deviceLabel?: string) => activateLicense(licenseKey, deviceLabel));
  ipcMain.handle("filex:deactivate-license", () => deactivateLicense());
  ipcMain.handle("filex:open-license-checkout", async (_event, billingPeriod: "monthly" | "annual") => {
    const checkout = await getCheckoutConfiguration();
    const destination = checkout[billingPeriod] ?? "https://filex-suite.web.app/#prezzi";
    return shell.openExternal(destination);
  });
}

app.setName(suite.productName);
if (process.platform === "win32") app.setAppUserModelId(appUserModelId);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => { void openSuiteExperience(); });
  app.whenReady().then(async () => {
    registerIpcHandlers();
    const initialDockState = await readDockState();
    dockEnabled = resolveSuiteDockEnabled(initialDockState);
    const startupPolicy = resolveSuiteStartupPolicy({ startsInBackground, dockEnabled });
    if (isPackagedSmokeTest) {
      if (!startupPolicy.createDock) throw new Error("La Dock deve essere attiva nel profilo smoke test.");
      await createDock();
      if (!dockWindow || dockWindow.isDestroyed() || dockWindow.getTitle() !== "FileX Suite Dock") {
        throw new Error("La Dock impacchettata non e' stata creata correttamente.");
      }
      app.exit(0);
      return;
    }
    configureSuiteUpdater({
      currentVersion: app.getVersion(),
      enabled: app.isPackaged && process.platform === "win32",
      allowPrerelease: releaseChannel() === "beta",
      onState: (state: DesktopSuiteUpdateState) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("filex:suite-update-state", state);
        }
      },
    });
    if (app.isPackaged && process.platform === "win32") {
      app.setLoginItemSettings({
        openAtLogin: true,
        openAsHidden: true,
        args: ["--filex-background"],
      });
    }
    if (startupPolicy.createMainWindow) await createMainWindow();
    createTray();
    if (startupPolicy.createDock) await createDock();
    startToolUpdateChecks();
    if (app.isPackaged) setTimeout(() => { void checkSuiteUpdate(); }, 3500);
  }).catch((error) => {
    console.error("FileX Suite failed to start", error);
    app.exit(1);
  });
}

app.on("activate", () => { void openSuiteExperience(); });
app.on("window-all-closed", () => undefined);
app.on("before-quit", () => {
  if (toolUpdateTimer) clearInterval(toolUpdateTimer);
  toolUpdateTimer = null;
  tray?.destroy();
  tray = null;
  dockWindow?.destroy();
  dockWindow = null;
});
