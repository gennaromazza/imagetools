import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { dirname, join, resolve } from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { cancelBackupGuard, configureBackupGuardInbox, configureBackupGuardStorage, configureBackupGuardTestMode, deepVerifyBackupGuard, deleteBackupGuardTrash, executeBackupGuard, getBackupGuardConfiguration, getBackupGuardProgress, listBackupGuardHistory, listBackupGuardTrash, listPendingBackupGuardProjects, pauseBackupGuard, recoverBackupGuardTrash, resolveBackupGuardConflict, resumeBackupGuard, saveBackupGuardConfiguration, scanBackupGuard } from "./backup-guard-service.js";
import { directToolLicenseAllowed } from "./license-gate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
const testMode = process.argv.includes("--allow-same-volume-test");
const argumentValue = (name: string): string | null => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
app.setName("FileX Backup Guard");
if (process.platform === "win32") app.setAppUserModelId("studio.filex.backup-guard");

function rendererEntry(): string { return app.isPackaged ? join(process.resourcesPath, "apps", "backup-guard", "web", "index.html") : resolve(app.getAppPath(), ".output", "web", "index.html"); }
function iconPath(): string { return app.isPackaged ? join(process.resourcesPath, "branding", "backup-guard.ico") : resolve(app.getAppPath(), "..", "filex-desktop", ".output", "branding", "backup-guard.ico"); }

function registerIpc(): void {
  ipcMain.handle("backup-guard:is-test-mode", () => testMode);
  ipcMain.handle("backup-guard:browse", async () => (await dialog.showOpenDialog({ properties: ["openDirectory"], title: "Seleziona cartella" })).filePaths[0] ?? null);
  ipcMain.handle("backup-guard:get-configuration", () => getBackupGuardConfiguration());
  ipcMain.handle("backup-guard:save-configuration", (_event, master: unknown, clone: unknown) => saveBackupGuardConfiguration(typeof master === "string" ? master : "", typeof clone === "string" ? clone : ""));
  ipcMain.handle("backup-guard:scan", () => scanBackupGuard());
  ipcMain.handle("backup-guard:execute", (_event, scanId: unknown, confirmDeletions: unknown) => executeBackupGuard(typeof scanId === "string" ? scanId : "", confirmDeletions === true));
  ipcMain.handle("backup-guard:get-progress", () => getBackupGuardProgress());
  ipcMain.handle("backup-guard:pause", () => pauseBackupGuard());
  ipcMain.handle("backup-guard:resume", () => resumeBackupGuard());
  ipcMain.handle("backup-guard:cancel", () => cancelBackupGuard());
  ipcMain.handle("backup-guard:deep-verify", () => deepVerifyBackupGuard());
  ipcMain.handle("backup-guard:list-trash", () => listBackupGuardTrash());
  ipcMain.handle("backup-guard:recover-trash", (_event, sessionId: unknown) => recoverBackupGuardTrash(typeof sessionId === "string" ? sessionId : ""));
  ipcMain.handle("backup-guard:delete-trash", (_event, sessionId: unknown) => deleteBackupGuardTrash(typeof sessionId === "string" ? sessionId : ""));
  ipcMain.handle("backup-guard:open-path", async (_event, path: unknown) => {
    if (typeof path !== "string" || !path) return { ok: false };
    return { ok: (await shell.openPath(path)) === "" };
  });
  ipcMain.handle("backup-guard:export-history", async () => {
    const destination = await dialog.showSaveDialog({ title: "Esporta report Backup Guard", defaultPath: `FileX-Backup-Guard-report-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: "Report JSON", extensions: ["json"] }] });
    if (destination.canceled || !destination.filePath) return { ok: false };
    const report = { schemaVersion: 1, product: "FileX Backup Guard", exportedAt: new Date().toISOString(), history: await listBackupGuardHistory() };
    await fs.writeFile(destination.filePath, JSON.stringify(report, null, 2), "utf8");
    return { ok: true, path: destination.filePath };
  });
  ipcMain.handle("backup-guard:resolve-conflict", (_event, scanId: unknown, relativePath: unknown, action: unknown) => {
    if (typeof scanId !== "string" || typeof relativePath !== "string" || !["keep-both", "use-master", "use-clone"].includes(String(action))) throw new Error("Richiesta di risoluzione conflitto non valida.");
    return resolveBackupGuardConflict(scanId, relativePath, action as "keep-both" | "use-master" | "use-clone");
  });
  ipcMain.handle("backup-guard:list-pending-projects", () => listPendingBackupGuardProjects());
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
  app.whenReady().then(async () => {
    if (!(await directToolLicenseAllowed())) { app.quit(); return; }
    configureBackupGuardStorage(app.getPath("userData")); configureBackupGuardInbox(app.getPath("appData")); configureBackupGuardTestMode(testMode);
    const testMaster = argumentValue("--test-master"); const testClone = argumentValue("--test-clone");
    if (testMode && testMaster && testClone) await saveBackupGuardConfiguration(testMaster, testClone);
    registerIpc(); await createWindow();
  });
}
app.on("activate", () => { if (!mainWindow) void createWindow(); });
app.on("window-all-closed", () => app.quit());
