import { app, BrowserWindow, ipcMain } from "electron";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  closeAdobeProcesses,
  executeCacheCleanup,
  scanCacheSweep,
  uninstallOldAdobeVersion,
} from "./cache-sweep-service.js";
import { directToolLicenseAllowed } from "./license-gate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;

app.setName("FileX Adobe Cleaner");
if (process.platform === "win32") app.setAppUserModelId("studio.filex.cache-sweep");

function rendererEntry(): string {
  if (app.isPackaged) return join(process.resourcesPath, "apps", "cache-sweep", "web", "index.html");
  return resolve(app.getAppPath(), ".output", "web", "index.html");
}

function iconPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, "branding", "cache-sweep.ico");
  return resolve(app.getAppPath(), "..", "filex-desktop", ".output", "branding", "cache-sweep.ico");
}

function registerIpc(): void {
  ipcMain.handle("cache-sweep:scan", () => scanCacheSweep());
  ipcMain.handle("cache-sweep:close-processes", (_event, ruleIds: unknown, force: unknown) => {
    const safeRuleIds = Array.isArray(ruleIds) ? ruleIds.filter((value): value is string => typeof value === "string") : [];
    return closeAdobeProcesses(safeRuleIds, force === true);
  });
  ipcMain.handle("cache-sweep:cleanup", (_event, ruleIds: unknown) => {
    const safeRuleIds = Array.isArray(ruleIds) ? ruleIds.filter((value): value is string => typeof value === "string") : [];
    return executeCacheCleanup(safeRuleIds);
  });
  ipcMain.handle("cache-sweep:uninstall-old-version", (_event, candidateId: unknown) => (
    uninstallOldAdobeVersion(typeof candidateId === "string" ? candidateId : "")
  ));
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 940,
    minHeight: 720,
    title: "FileX Adobe Cleaner",
    icon: iconPath(),
    backgroundColor: "#f3f4ef",
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  if (process.env.FILEX_RENDERER_MODE === "dev" && process.env.FILEX_RENDERER_URL) {
    await mainWindow.loadURL(process.env.FILEX_RENDERER_URL);
  } else {
    await mainWindow.loadFile(rendererEntry());
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    if (argv.includes("--filex-update-shutdown")) {
      app.quit();
      return;
    }
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    if (!(await directToolLicenseAllowed())) { app.quit(); return; }
    registerIpc();
    await createWindow();
  });
}

app.on("activate", () => {
  if (!mainWindow) void createWindow();
});

app.on("window-all-closed", () => app.quit());
