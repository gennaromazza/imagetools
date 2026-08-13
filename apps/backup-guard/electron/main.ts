import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configureBackupGuardStorage, getBackupGuardConfiguration, listBackupGuardHistory, saveBackupGuardConfiguration, scanBackupGuard } from "./backup-guard-service.js";
import { directToolLicenseAllowed } from "./license-gate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
app.setName("FileX Backup Guard");
if (process.platform === "win32") app.setAppUserModelId("studio.filex.backup-guard");

function rendererEntry(): string { return app.isPackaged ? join(process.resourcesPath, "apps", "backup-guard", "web", "index.html") : resolve(app.getAppPath(), ".output", "web", "index.html"); }
function iconPath(): string { return app.isPackaged ? join(process.resourcesPath, "branding", "backup-guard.ico") : resolve(app.getAppPath(), "..", "filex-desktop", ".output", "branding", "backup-guard.ico"); }

function registerIpc(): void {
  ipcMain.handle("backup-guard:browse", async () => (await dialog.showOpenDialog({ properties: ["openDirectory"], title: "Seleziona cartella" })).filePaths[0] ?? null);
  ipcMain.handle("backup-guard:get-configuration", () => getBackupGuardConfiguration());
  ipcMain.handle("backup-guard:save-configuration", (_event, master: unknown, clone: unknown) => saveBackupGuardConfiguration(typeof master === "string" ? master : "", typeof clone === "string" ? clone : ""));
  ipcMain.handle("backup-guard:scan", () => scanBackupGuard());
  ipcMain.handle("backup-guard:list-history", () => listBackupGuardHistory());
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({ width: 1380, height: 920, minWidth: 1060, minHeight: 720, title: "FileX Backup Guard", icon: iconPath(), backgroundColor: "#1f2421", show: false, webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  mainWindow.once("ready-to-show", () => mainWindow?.show()); mainWindow.on("closed", () => { mainWindow = null; });
  if (process.env.FILEX_RENDERER_MODE === "dev" && process.env.FILEX_RENDERER_URL) await mainWindow.loadURL(process.env.FILEX_RENDERER_URL); else await mainWindow.loadFile(rendererEntry());
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
  app.whenReady().then(async () => { if (!(await directToolLicenseAllowed())) { app.quit(); return; } configureBackupGuardStorage(app.getPath("userData")); registerIpc(); await createWindow(); });
}
app.on("activate", () => { if (!mainWindow) void createWindow(); });
app.on("window-all-closed", () => app.quit());
