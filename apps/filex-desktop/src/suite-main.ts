import * as electron from "electron";
import type {
  BrowserWindow as BrowserWindowInstance,
  Tray as TrayInstance,
} from "electron";
import { existsSync } from "node:fs";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  DesktopDockState,
  DesktopSuiteNotification,
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
import { activateLicense, deactivateLicense, getCheckoutConfiguration, getLicenseState, startTrial, finishTrial } from "./license-service.js";
import {
  resolveSuiteDockEnabled,
  resolveSuiteStartupPolicy,
  resolveSuiteLauncherBounds,
} from "./suite-startup-policy.js";

const { app, BrowserWindow, dialog, ipcMain, Menu, Notification, screen, shell, Tray } = electron;
const suite = desktopToolManifest["suite-launcher"];
const appUserModelId = `studio.filex.${suite.id}${app.isPackaged ? "" : ".dev"}`;
let mainWindow: BrowserWindowInstance | null = null;
let dockWindow: BrowserWindowInstance | null = null;
let launcherHeight = 112;
let launcherWidth = 440;
let launcherAnchor: { displayId: number; x: number } | null = null;
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

async function saveDockState(partial: Partial<DesktopDockState>): Promise<DesktopDockState> {
  const current = await readDockState();
  const next = sanitizeDockState({ ...current, ...partial });
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

async function createDock(reveal = true): Promise<void> {
  if (!dockEnabled) return;
  if (dockWindow && !dockWindow.isDestroyed()) {
    if (reveal) {
      positionLauncher(dockWindow);
      dockWindow.restore();
      dockWindow.show();
      dockWindow.focus();
    }
    return;
  }
  const window = new BrowserWindow({
    title: "FileX Suite Launcher",
    width: launcherWidth, height: launcherHeight,
    frame: false, resizable: false, movable: false,
    minimizable: true, maximizable: false,
    skipTaskbar: false, alwaysOnTop: false, show: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    icon: iconPath(),
    webPreferences: {
      preload: preloadPath(), contextIsolation: true,
      nodeIntegration: false, sandbox: false,
    },
  });
  dockWindow = window;
  positionLauncher(window);
  window.on("restore", () => positionLauncher(window));
  window.on("blur", () => {
    if (!window.isDestroyed() && window.isVisible() && !window.isMinimized()) window.minimize();
  });
  window.on("close", (event) => {
    event.preventDefault();
    window.minimize();
  });
  window.on("closed", () => { if (dockWindow === window) dockWindow = null; });
  const entry = rendererPath("dock.html");
  if (!existsSync(entry)) throw new Error(`Launcher FileX Suite non trovato: ${entry}`);
  await window.loadFile(entry);
  if (reveal) {
    window.show();
    window.focus();
  } else {
    // Minimize rather than hide to retain the Windows taskbar entry.
    window.minimize();
  }
}

function positionLauncher(window: BrowserWindowInstance, followCursor = true): void {
  const cursor = screen.getCursorScreenPoint();
  const cursorDisplay = screen.getDisplayNearestPoint(cursor);
  const area = cursorDisplay.workArea;
  // On taskbar restore the pointer is still over the clicked FileX button.
  // Keep that anchor while the pointer moves into the dock or panels resize.
  const onTaskbar = cursor.y >= area.y + area.height - 2 || cursor.y < area.y
    || cursor.x < area.x || cursor.x >= area.x + area.width;
  if (followCursor && onTaskbar) launcherAnchor = { displayId: cursorDisplay.id, x: cursor.x };
  const display = screen.getAllDisplays().find(display => display.id === launcherAnchor?.displayId) ?? cursorDisplay;
  if (!launcherAnchor || launcherAnchor.displayId !== display.id) {
    launcherAnchor = { displayId: display.id, x: display.workArea.x + display.workArea.width / 2 };
  }
  window.setBounds(resolveSuiteLauncherBounds(display.workArea, launcherWidth, launcherHeight, launcherAnchor.x));
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
  if (dockEnabled) await createDock();
  else await createMainWindow();
}

function updateTrayMenu(): void {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Apri launcher", click: () => { void openSuiteExperience(); } },
    { label: "Gestisci FileX Suite", click: () => { void createMainWindow(); } },
    {
      label: "Launcher nella barra delle applicazioni",
      type: "checkbox",
      checked: dockEnabled,
      click: (menuItem) => {
        void setDockEnabled(menuItem.checked).catch((error) => {
          dialog.showErrorBox(
            "FileX Suite",
            `Impossibile aggiornare il launcher: ${error instanceof Error ? error.message : String(error)}`,
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
    notification.on("click", () => { void createMainWindow(); });
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

async function readSuiteNotifications(): Promise<DesktopSuiteNotification[]> {
  const directories = [join(app.getPath("appData"), "FileX", "notifications")];
  if (!app.isPackaged) directories.push(join(app.getPath("appData"), "FileX", "notifications-dev"));
  const result: DesktopSuiteNotification[] = [];
  for (const directory of directories) {
    const names = await readdir(directory).catch(() => []);
    for (const name of names.filter(name => /^\d+-[a-f0-9-]+\.json$/.test(name)).sort().slice(-100)) {
      try {
        const file = join(directory, name);
        if ((await stat(file)).size > 8192) continue;
        const value = JSON.parse(await readFile(file, "utf8")) as DesktopSuiteNotification;
        if (value.toolId !== "filex-send" || typeof value.id !== "string" || typeof value.title !== "string"
          || typeof value.message !== "string" || !Number.isFinite(value.createdAt)) continue;
        result.push({ ...value, title: value.title.slice(0, 120), message: value.message.slice(0, 500) });
      } catch { /* Ignore incomplete or invalid events without losing the rest of the inbox. */ }
    }
  }
  return result.sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
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
  ipcMain.handle("filex:open-suite-window", () => createMainWindow());
  ipcMain.handle("filex:resize-suite-launcher", (event, height: number, width?: number) => {
    if (!dockWindow || event.sender !== dockWindow.webContents || !Number.isFinite(height)) return;
    launcherHeight = Math.min(620, Math.max(96, Math.ceil(height)));
    if (typeof width === "number" && Number.isFinite(width)) launcherWidth = Math.min(900, Math.max(240, Math.ceil(width)));
    if (!dockWindow.isMinimized()) positionLauncher(dockWindow, false);
  });
  ipcMain.handle("filex:get-suite-notifications", () => readSuiteNotifications());
  ipcMain.handle("filex:get-suite-dock-state", () => readDockState());
  ipcMain.handle("filex:save-suite-dock-state", (_event, state: Partial<DesktopDockState>) => saveDockState(state));
  ipcMain.handle("filex:set-suite-dock-enabled", (_event, enabled: boolean) => setDockEnabled(enabled !== false));
  ipcMain.handle("filex:get-license-state", (_event, refresh?: boolean) => getLicenseState(Boolean(refresh)));
  ipcMain.handle("filex:activate-license", (_event, licenseKey: string, deviceLabel?: string) => activateLicense(licenseKey, deviceLabel));
  ipcMain.handle("filex:deactivate-license", () => deactivateLicense());
  ipcMain.handle("filex:start-trial", () => startTrial());
  ipcMain.handle("filex:finish-trial", () => finishTrial());
  ipcMain.handle("filex:open-license-checkout", async (_event, billingPeriod: "monthly" | "annual") => {
    const checkout = await getCheckoutConfiguration();
    const destination = checkout[billingPeriod] ?? "https://filex-suite.web.app/#prezzi";
    return shell.openExternal(destination);
  });
}

app.setName(suite.productName);
if (process.platform === "win32") {
  app.setAppUserModelId(appUserModelId);
  app.on("browser-window-created", (_event, window) => {
    window.setAppDetails({
      appId: appUserModelId,
      appIconPath: iconPath(),
      appIconIndex: 0,
      ...(app.isPackaged ? { relaunchCommand: `"${process.execPath}"`, relaunchDisplayName: suite.productName } : {}),
    });
  });
}

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
      await createDock(false);
      if (!dockWindow || dockWindow.isDestroyed() || dockWindow.getTitle() !== "FileX Suite Launcher") {
        throw new Error("La Dock impacchettata non e' stata creata correttamente.");
      }
      const launcher: BrowserWindowInstance = dockWindow;
      if (launcher.isAlwaysOnTop() || !launcher.isMinimizable() || !launcher.isMinimized()) {
        throw new Error("Il launcher deve partire ridotto e non essere sempre in primo piano.");
      }
      await createDock();
      if (launcher.isMinimized() || !launcher.isVisible()) {
        throw new Error("Il launcher non si ripristina dalla barra.");
      }
      launcher.close();
      if (launcher.isDestroyed() || !launcher.isMinimized()) {
        throw new Error("La chiusura deve ridurre il launcher senza distruggerlo.");
      }
      await createDock();
      if (BrowserWindow.getAllWindows().length !== 1) {
        throw new Error("La riapertura ha duplicato le finestre.");
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
    if (startupPolicy.createDock) await createDock(!startsInBackground);
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
