import * as electron from "electron";
import type { BrowserWindow as BrowserWindowInstance } from "electron";
import { execSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { writeFile as writeFileAsync } from "node:fs/promises";
import { basename, join, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  DesktopAiSidecarStatus,
  DesktopDragOutCheck,
  DesktopEditorCandidate,
  DesktopFolderCatalogAssetState,
  DesktopFolderCatalogState,
  DesktopLogEvent,
  DesktopPerformanceSnapshot,
  DesktopPersistedState,
  DesktopRamBudgetPreset,
  DesktopReleaseChannel,
  DesktopPhotoSelectorPreferences,
  DesktopQuickPreviewRequest,
  DesktopRecentFolder,
  DesktopRuntimeInfo,
  DesktopSendToEditorResult,
  DesktopSortCacheEntry,
  DesktopToolId,
  DesktopToolInstallState,
  DesktopThumbnailCacheLookupEntry,
} from "@photo-tools/desktop-contracts";
import {
  createAutoLayoutHandoffFileDesktop,
  copyFilesToFolderDesktop,
  moveFilesToFolderDesktop,
  openFolderDesktop,
  readFileFromDisk,
  readSidecarXmpFromAssetPath,
  reopenFolderDesktop,
  saveFileAsDesktop,
  writeSidecarXmpForAssetPath,
} from "./native-folder-service.js";
import {
  configureDesktopImageService,
  getDesktopImageCacheLimits,
  getDesktopQuickPreviewFrame,
  getDesktopPreview,
  getDesktopThumbnail,
  getQuickPreviewFrameContent,
  QUICK_PREVIEW_PROTOCOL_SCHEME,
  releaseDesktopQuickPreviewFrames,
  shutdownDesktopImageService,
  warmDesktopPreview,
  warmDesktopQuickPreviewFrames,
} from "./native-image-service.js";
import {
  chooseThumbnailCacheDirectory,
  clearThumbnailCacheDirectory,
  dismissCacheLocationRecommendation,
  getCachedThumbnailsFromDisk,
  getCacheLocationRecommendation,
  getRamBudgetInfo,
  getThumbnailCacheInfo,
  loadRamBudgetPreset,
  migrateThumbnailCacheDirectory,
  resetThumbnailCacheDirectory,
  saveRamBudgetPreset,
  setThumbnailCacheDirectory,
} from "./thumbnail-disk-cache.js";
import {
  getDesktopPreferences,
  getDesktopSessionState,
  getDesktopPerformanceSnapshot,
  getAutoLayoutProjects,
  getFolderCatalogState,
  getRecentFolders,
  getSortCache,
  logDesktopEvent,
  recordDesktopPerformanceSnapshot,
  removeRecentFolder,
  saveDesktopPreferences,
  saveAutoLayoutProjects,
  saveDesktopSessionState,
  saveFolderAssetStates,
  saveFolderCatalogState,
  saveRecentFolder,
  saveSortCache,
  shutdownDesktopStore,
} from "./desktop-store.js";
import {
  applyToolUpdate,
  checkToolUpdate,
  downloadToolUpdate,
  listAvailableTools,
  openInstalledTool,
} from "./updater.js";
import { findDesktopToolByRuntimeToken, getDesktopToolOrDefault } from "./tool-manifest.js";

const { app, BrowserWindow, dialog, ipcMain, protocol, session, shell } = electron;

const EARLY_BOOT_LOG_PATH = join(process.env.TEMP || process.cwd(), "filex-image-party-frame-early.log");

function writeEarlyBootLog(message: string): void {
  try {
    appendFileSync(EARLY_BOOT_LOG_PATH, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch {
    // ignore logging failures during earliest bootstrap
  }
}

function writeBootLog(message: string): void {
  try {
    const logDir = join(app.getPath("userData"), "logs");
    mkdirSync(logDir, { recursive: true });
    appendFileSync(join(logDir, "boot.log"), `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch {
    // ignore logging failures during bootstrap
  }
}

writeEarlyBootLog(`Main module loaded for tool env=${process.env.FILEX_TOOL ?? ""} exec=${process.execPath}`);

function resolveRequestedTool() {
  const fromEnv = getDesktopToolOrDefault(process.env.FILEX_TOOL);
  if (process.env.FILEX_TOOL) {
    return fromEnv;
  }

  const executableBaseName = basename(process.execPath, parse(process.execPath).ext);
  const fromExecutable = findDesktopToolByRuntimeToken(executableBaseName);
  if (fromExecutable) {
    return fromExecutable;
  }

  const appName = app.getName();
  const fromAppName = findDesktopToolByRuntimeToken(appName);
  if (fromAppName) {
    return fromAppName;
  }

  return fromEnv;
}

const requestedTool = resolveRequestedTool();
const shouldUseDevRenderer =
  process.env.FILEX_RENDERER_MODE === "dev" && typeof process.env.FILEX_RENDERER_URL === "string";
const appUserModelId = `studio.filex.${requestedTool.id}`;
let mainWindow: BrowserWindowInstance | null = null;
let isOpenFolderRequestRendererReady = false;
let pendingOpenFolderPath: string | null = null;
let isOpenProjectRequestRendererReady = false;
let pendingOpenProjectPath: string | null = null;
let mainWindowCreationPromise: Promise<void> | null = null;
let archivioFlowModulePromise: Promise<any> | null = null;
let imagePartyFrameServerModulePromise: Promise<any> | null = null;

function resolveReleaseChannel(): DesktopReleaseChannel {
  return process.env.FILEX_RELEASE_CHANNEL === "beta" ? "beta" : "stable";
}

function getImageIdPrintAiStatus(): DesktopAiSidecarStatus {
  const sidecarRoot = join(app.getPath("userData"), "image-id-print-ai");
  const serverScriptPath = join(sidecarRoot, "rembg_server.py");
  const requirementsPath = join(sidecarRoot, "requirements.txt");
  const pythonCandidates = ["python", "py"];
  let pythonFound = false;
  for (const command of pythonCandidates) {
    try {
      execSync(`${command} --version`, { stdio: ["ignore", "ignore", "ignore"] });
      pythonFound = true;
      break;
    } catch {
      // continue
    }
  }

  const hasScript = existsSync(serverScriptPath);
  const installed = hasScript && existsSync(requirementsPath);
  let health: DesktopAiSidecarStatus["health"] = "ok";
  if (!hasScript) {
    health = "missing-script";
  } else if (!pythonFound) {
    health = "missing-runtime";
  }

  return {
    installed,
    pythonFound,
    serverScriptPath: hasScript ? serverScriptPath : null,
    requirementsPath: existsSync(requirementsPath) ? requirementsPath : null,
    health,
  };
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: QUICK_PREVIEW_PROTOCOL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      bypassCSP: true,
    },
  },
]);

app.setName(requestedTool.productName);
if (process.platform === "win32") {
  app.setAppUserModelId(appUserModelId);
}

function resolveWindowIcon(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "branding", `${requestedTool.id}.png`);
  }

  return resolve(app.getAppPath(), "build", "branding", `${requestedTool.id}.png`);
}

function resolveRendererEntry(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, requestedTool.packagedDistDir, "index.html");
  }

  return resolve(app.getAppPath(), requestedTool.workspaceDistDirRelativeToShell, "index.html");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sanitizeDesktopPath(value: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  const withoutQuotes = trimmed.replace(/^"+|"+$/g, "");
  return process.platform === "win32" ? withoutQuotes.replace(/\//g, "\\") : withoutQuotes;
}

function resolveValidDirectoryPath(candidatePath: string): string | null {
  const normalizedPath = sanitizeDesktopPath(candidatePath);
  if (!normalizedPath || !existsSync(normalizedPath)) {
    return null;
  }

  try {
    return statSync(normalizedPath).isDirectory() ? normalizedPath : null;
  } catch {
    return null;
  }
}

function resolveValidFilePath(candidatePath: string): string | null {
  const normalizedPath = sanitizeDesktopPath(candidatePath);
  if (!normalizedPath || !existsSync(normalizedPath)) {
    return null;
  }

  try {
    return statSync(normalizedPath).isFile() ? normalizedPath : null;
  } catch {
    return null;
  }
}

function normalizeUint8Array(payload: unknown): Uint8Array {
  if (payload instanceof Uint8Array) {
    return payload;
  }
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }
  if (Array.isArray(payload)) {
    return new Uint8Array(payload);
  }
  return new Uint8Array();
}

function getArchivioFlowDataDir(): string {
  return join(app.getPath("userData"), "archivio-flow");
}

function getImagePartyFrameDataDir(): string {
  return join(app.getPath("userData"), "image-party-frame");
}

async function loadArchivioFlowModule(): Promise<any> {
  if (archivioFlowModulePromise) {
    return archivioFlowModulePromise;
  }

  archivioFlowModulePromise = (async () => {
    try {
      process.env.ARCHIVIO_FLOW_DATA_DIR = getArchivioFlowDataDir();
      const modulePath = resolve(app.getAppPath(), "dist-electron", "archivio-flow-server", "index.js");
      return await import(pathToFileURL(modulePath).href);
    } catch (error) {
      archivioFlowModulePromise = null;
      throw error;
    }
  })();

  return await archivioFlowModulePromise;
}

async function ensureImagePartyFrameServer(): Promise<void> {
  if (imagePartyFrameServerModulePromise) {
    writeBootLog("Image Party Frame server reuse requested");
    await imagePartyFrameServerModulePromise;
    return;
  }

  imagePartyFrameServerModulePromise = (async () => {
    try {
      writeBootLog("Image Party Frame server bootstrap start");
      process.env.IMAGE_PARTY_FRAME_DATA_DIR = getImagePartyFrameDataDir();
      const modulePath = resolve(app.getAppPath(), "dist-electron", "image-party-frame-server", "server", "index.js");
      writeBootLog(`Image Party Frame server import ${modulePath}`);
      await import(pathToFileURL(modulePath).href);
      writeBootLog("Image Party Frame server bootstrap completed");
    } catch (error) {
      imagePartyFrameServerModulePromise = null;
      writeBootLog(`Image Party Frame server bootstrap failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
      throw error;
    }
  })();

  await imagePartyFrameServerModulePromise;
}

async function browseArchivioFolderDesktop(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: "Seleziona una cartella",
    properties: ["openDirectory", "createDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return sanitizeDesktopPath(result.filePaths[0]);
}

async function getArchivioSdCardsDesktop(): Promise<Array<{
  deviceId: string;
  volumeName: string;
  totalSize: number;
  freeSpace: number;
  path: string;
}>> {
  if (process.platform === "darwin") {
    const volumesRoot = "/Volumes";
    if (!existsSync(volumesRoot)) {
      return [];
    }

    return readdirSync(volumesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const volumePath = join(volumesRoot, entry.name);
        let totalSize = 0;
        let freeSpace = 0;

        try {
          const output = execSync(`df -k "${volumePath.replace(/"/g, '\\"')}" | tail -1`, {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          }).trim();
          const columns = output.split(/\s+/);
          totalSize = (Number(columns[1]) || 0) * 1024;
          freeSpace = (Number(columns[3]) || 0) * 1024;
        } catch {
          /* ignore */
        }

        return {
          deviceId: entry.name,
          volumeName: entry.name,
          totalSize,
          freeSpace,
          path: volumePath,
        };
      });
  }

  const archivio = await loadArchivioFlowModule();
  const result = await archivio.getSdCardsService();
  return result.sdCards;
}

function extractOpenFolderPathFromArgv(argv: string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (typeof value !== "string") {
      continue;
    }

    if (value === "--open-folder") {
      const nextValue = argv[index + 1];
      return typeof nextValue === "string" ? resolveValidDirectoryPath(nextValue) : null;
    }

    if (value.startsWith("--open-folder=")) {
      return resolveValidDirectoryPath(value.slice("--open-folder=".length));
    }
  }

  for (const value of argv.slice(1)) {
    if (typeof value !== "string" || value.startsWith("--")) {
      continue;
    }

    const directoryPath = resolveValidDirectoryPath(value);
    if (directoryPath) {
      return directoryPath;
    }
  }

  return null;
}

function extractOpenProjectPathFromArgv(argv: string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (typeof value !== "string") {
      continue;
    }

    if (value === "--open-project") {
      const nextValue = argv[index + 1];
      return typeof nextValue === "string" ? resolveValidFilePath(nextValue) : null;
    }

    if (value.startsWith("--open-project=")) {
      return resolveValidFilePath(value.slice("--open-project=".length));
    }
  }

  return null;
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  mainWindow.focus();
}

function deliverOpenFolderRequest(folderPath: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingOpenFolderPath = folderPath;
    return;
  }

  mainWindow.webContents.send("filex:open-folder-request", folderPath);
  logDesktopEvent({
    channel: "folder-open",
    level: "info",
    message: "Richiesta apertura cartella inviata al renderer",
    details: folderPath,
  });
  pendingOpenFolderPath = null;
}

function deliverOpenProjectRequest(projectPath: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingOpenProjectPath = projectPath;
    return;
  }

  mainWindow.webContents.send("filex:open-project-request", projectPath);
  pendingOpenProjectPath = null;
}

function queueOpenFolderPath(folderPath: string | null): void {
  if (!folderPath) {
    return;
  }

  pendingOpenFolderPath = folderPath;
  logDesktopEvent({
    channel: "folder-open",
    level: "info",
    message: "Richiesta apertura cartella accodata",
    details: folderPath,
  });
  if (isOpenFolderRequestRendererReady) {
    deliverOpenFolderRequest(folderPath);
  }
}

function queueOpenProjectPath(projectPath: string | null): void {
  if (!projectPath) {
    return;
  }

  pendingOpenProjectPath = projectPath;
  if (isOpenProjectRequestRendererReady) {
    deliverOpenProjectRequest(projectPath);
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  writeEarlyBootLog("Single instance lock denied, quitting");
  app.quit();
} else {
  writeEarlyBootLog("Single instance lock acquired");
  pendingOpenFolderPath = extractOpenFolderPathFromArgv(process.argv);
  pendingOpenProjectPath = extractOpenProjectPathFromArgv(process.argv);

  app.on("second-instance", (_event, argv) => {
    queueOpenFolderPath(extractOpenFolderPathFromArgv(argv));
    queueOpenProjectPath(extractOpenProjectPathFromArgv(argv));
    void ensureMainWindow();
    focusMainWindow();
  });

  app.on("browser-window-focus", () => {
    if (pendingOpenFolderPath && isOpenFolderRequestRendererReady) {
      deliverOpenFolderRequest(pendingOpenFolderPath);
    }
    if (pendingOpenProjectPath && isOpenProjectRequestRendererReady) {
      deliverOpenProjectRequest(pendingOpenProjectPath);
    }
  });
}

function normalizeExistingAbsolutePaths(absolutePaths: unknown): string[] {
  if (!Array.isArray(absolutePaths)) {
    return [];
  }

  const unique = new Set<string>();
  for (const value of absolutePaths) {
    if (typeof value !== "string") {
      continue;
    }

    const normalized = sanitizeDesktopPath(value);
    if (!normalized || !existsSync(normalized)) {
      continue;
    }

    unique.add(normalized);
  }

  return Array.from(unique);
}

function validateDesktopDragOut(absolutePaths: unknown): DesktopDragOutCheck {
  const requestedCount = Array.isArray(absolutePaths) ? absolutePaths.length : 0;
  const normalizedPaths = normalizeExistingAbsolutePaths(absolutePaths);
  const validCount = normalizedPaths.length;

  if (requestedCount <= 0) {
    return {
      ok: false,
      requestedCount,
      validCount,
      allowedCount: 0,
      reason: "empty-selection",
      message: "Nessun file selezionato per il drag esterno.",
    };
  }

  if (validCount === 0) {
    return {
      ok: false,
      requestedCount,
      validCount,
      allowedCount: 0,
      reason: "missing-paths",
      message: "La selezione non ha percorsi assoluti validi per il drag esterno.",
    };
  }

  if (validCount !== requestedCount) {
    return {
      ok: false,
      requestedCount,
      validCount,
      allowedCount: validCount,
      reason: "invalid-paths",
      message: "Alcuni file selezionati non hanno un percorso valido.",
    };
  }

  return {
    ok: true,
    requestedCount,
    validCount,
    allowedCount: validCount,
    reason: "ok",
    message: validCount === 1
      ? "1 file pronto per il drag esterno."
      : `${validCount} file pronti per il drag esterno.`,
  };
}

function launchEditorProcess(
  editorPath: string,
  absolutePaths: string[],
): DesktopSendToEditorResult {
  const normalizedEditorPath = sanitizeDesktopPath(editorPath);
  const targetPaths = normalizeExistingAbsolutePaths(absolutePaths);

  if (!normalizedEditorPath || !existsSync(normalizedEditorPath)) {
    const installedEditors = getInstalledEditorCandidates();
    const installedHint = installedEditors[0]
      ? ` Editor rilevato: ${installedEditors[0].path}`
      : "";
    return {
      ok: false,
      status: "invalid-editor",
      requestedCount: Array.isArray(absolutePaths) ? absolutePaths.length : 0,
      launchedCount: 0,
      error: `Editor non trovato o percorso non valido.${installedHint}`,
    };
  }

  if (targetPaths.length === 0) {
    return {
      ok: false,
      status: "partial",
      requestedCount: Array.isArray(absolutePaths) ? absolutePaths.length : 0,
      launchedCount: 0,
      error: "Nessun file valido da aprire.",
    };
  }

  try {
    if (process.platform === "darwin") {
      const child = spawn("open", ["-a", normalizedEditorPath, ...targetPaths], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    } else {
      const child = spawn(normalizedEditorPath, targetPaths, {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.unref();
    }

    return {
      ok: true,
      status: "ok",
      requestedCount: Array.isArray(absolutePaths) ? absolutePaths.length : targetPaths.length,
      launchedCount: targetPaths.length,
    };
  } catch (error) {
    return {
      ok: false,
      status: "launch-failed",
      requestedCount: Array.isArray(absolutePaths) ? absolutePaths.length : targetPaths.length,
      launchedCount: 0,
      error: error instanceof Error ? error.message : "Impossibile aprire l'editor.",
    };
  }
}

function getInstalledEditorCandidates(): DesktopEditorCandidate[] {
  const roots = [
    "C:\\Program Files\\Adobe",
    "C:\\Program Files (x86)\\Adobe",
  ];
  const candidates: DesktopEditorCandidate[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    if (!existsSync(root)) {
      continue;
    }

    let entries: string[] = [];
    try {
      entries = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^Adobe Photoshop\b/i.test(entry.name))
        .map((entry) => entry.name);
    } catch {
      continue;
    }

    entries
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true, sensitivity: "base" }))
      .forEach((directoryName) => {
        const executablePath = join(root, directoryName, "Photoshop.exe");
        const normalizedPath = sanitizeDesktopPath(executablePath);
        if (!existsSync(normalizedPath) || seen.has(normalizedPath.toLowerCase())) {
          return;
        }

        seen.add(normalizedPath.toLowerCase());
        candidates.push({
          path: normalizedPath,
          label: directoryName.replace(/^Adobe\s+/i, ""),
        });
      });
  }

  return candidates;
}

function enforceUtf8CharsetOnTextResponses(): void {
  // Chromium può ricadere sulla codifica locale (Windows-1252 sui PC italiani)
  // quando file:// e Vite servono asset di testo senza un parametro `charset`
  // esplicito nella Content-Type. Questo causa mojibake sui caratteri non-ASCII
  // dei bundle (es. `·`, `★`, `✓`) anche se i file sorgente sono UTF-8 corretti.
  // Forziamo `charset=utf-8` su tutte le risposte di testo dei renderer.
  const targetSession = session.defaultSession;
  if (!targetSession) {
    return;
  }

  targetSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders ?? {};
    const contentTypeKey = Object.keys(headers).find(
      (key) => key.toLowerCase() === "content-type",
    );

    if (!contentTypeKey) {
      callback({ responseHeaders: headers });
      return;
    }

    const rawValues = headers[contentTypeKey];
    const values = Array.isArray(rawValues) ? rawValues : [rawValues];
    const updated = values.map((value) => {
      if (typeof value !== "string") {
        return value;
      }
      const lower = value.toLowerCase();
      if (lower.includes("charset=")) {
        return value;
      }
      const isText =
        lower.startsWith("text/") ||
        lower.includes("javascript") ||
        lower.includes("ecmascript") ||
        lower.includes("json") ||
        lower.includes("xml") ||
        lower.includes("svg");
      if (!isText) {
        return value;
      }
      const trimmed = value.trim();
      const separator = trimmed.endsWith(";") ? " " : "; ";
      return `${trimmed}${separator}charset=utf-8`;
    });

    callback({
      responseHeaders: {
        ...headers,
        [contentTypeKey]: updated as string[],
      },
    });
  });
}

function registerPreviewProtocol(): void {
  protocol.handle(QUICK_PREVIEW_PROTOCOL_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const token = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const content = getQuickPreviewFrameContent(token);
      if (!content) {
        return new Response("Not Found", { status: 404 });
      }

      return new Response(Buffer.from(content.bytes), {
        status: 200,
        headers: {
          "content-type": content.mimeType,
          "cache-control": "private, max-age=31536000, immutable",
        },
      });
    } catch (error) {
      logDesktopEvent({
        channel: "preview",
        level: "warn",
        message: "Protocollo preview non riuscito",
        details: error instanceof Error ? error.message : String(error),
      });
      return new Response("Bad Request", { status: 400 });
    }
  });
}

function logAnonymousCrash(scope: string, error: unknown): void {
  const message = error instanceof Error ? error.name : typeof error;
  const details = error instanceof Error
    ? `${error.name}: ${error.message}`.slice(0, 500)
    : String(error).slice(0, 500);
  logDesktopEvent({
    channel: "crash",
    level: "error",
    message: `Crash anonimo (${scope})`,
    details: `${message} | ${details}`,
  });
}

function registerCrashTelemetryHandlers(): void {
  process.on("uncaughtException", (error) => {
    logAnonymousCrash("main-uncaughtException", error);
  });
  process.on("unhandledRejection", (reason) => {
    logAnonymousCrash("main-unhandledRejection", reason);
  });
  app.on("render-process-gone", (_event, _webContents, details) => {
    logDesktopEvent({
      channel: "crash",
      level: "error",
      message: "Crash anonimo renderer",
      details: `${details.reason}${details.exitCode ? `:${details.exitCode}` : ""}`,
    });
  });
  app.on("child-process-gone", (_event, details) => {
    logDesktopEvent({
      channel: "crash",
      level: "error",
      message: "Crash anonimo child process",
      details: `${details.type}:${details.reason}${details.exitCode ? `:${details.exitCode}` : ""}`,
    });
  });
}

function buildMissingRendererHtml(entryPath: string): string {
  const buildCommand = `npm --workspace ${requestedTool.workspacePackageName} run build`;

  return `<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8" />
    <title>FileX Desktop</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #181d1a;
        color: #f3efe5;
        font: 16px/1.6 "Segoe UI", sans-serif;
      }
      main {
        width: min(720px, calc(100vw - 48px));
        padding: 32px;
        border-radius: 24px;
        background: rgba(44, 51, 46, 0.92);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
      }
      code {
        display: block;
        margin-top: 16px;
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(0, 0, 0, 0.24);
        color: #f8d58c;
        white-space: pre-wrap;
        word-break: break-word;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 30px;
      }
      p {
        margin: 0 0 12px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Renderer non trovato</h1>
      <p>La shell desktop e' pronta, ma il build del tool <strong>${escapeHtml(requestedTool.displayName)}</strong> non e' presente.</p>
      <p>Esegui questo comando prima di riaprire la shell:</p>
      <code>${escapeHtml(buildCommand)}</code>
      <p>Percorso atteso:</p>
      <code>${escapeHtml(entryPath)}</code>
    </main>
  </body>
</html>`;
}

function registerIpcHandlers(): void {
  ipcMain.handle("filex:get-runtime-info", async () => {
    let installedTools: DesktopToolInstallState[] = [];
    try {
      installedTools = await listAvailableTools(resolveReleaseChannel());
    } catch (error) {
      logDesktopEvent({
        channel: "update",
        level: "warn",
        message: "Impossibile leggere manifest release",
        details: error instanceof Error ? error.message : String(error),
      });
    }
    const payload: DesktopRuntimeInfo = {
      shell: "electron",
      platform: process.platform,
      isPackaged: app.isPackaged,
      appVersion: app.getVersion(),
      toolId: requestedTool.id,
      toolName: requestedTool.displayName,
      releaseChannel: resolveReleaseChannel(),
      aiSidecarInstalled: getImageIdPrintAiStatus().installed,
      installedTools,
    };

    return payload;
  });
  ipcMain.handle("filex:list-available-tools", async (_event, channel?: DesktopReleaseChannel) =>
    listAvailableTools(channel ?? resolveReleaseChannel()).catch((error) => {
      logDesktopEvent({
        channel: "update",
        level: "warn",
        message: "list-available-tools fallback",
        details: error instanceof Error ? error.message : String(error),
      });
      return [];
    }),
  );
  ipcMain.handle(
    "filex:check-tool-update",
    async (
      _event,
      toolId: DesktopToolId,
      currentVersion?: string | null,
      channel?: DesktopReleaseChannel,
    ) => checkToolUpdate(toolId, currentVersion, channel ?? resolveReleaseChannel()),
  );
  ipcMain.handle(
    "filex:download-tool-update",
    async (_event, toolId: DesktopToolId, channel?: DesktopReleaseChannel) =>
      downloadToolUpdate(toolId, channel ?? resolveReleaseChannel()),
  );
  ipcMain.handle("filex:apply-tool-update", async (_event, jobId: string) => applyToolUpdate(jobId));
  ipcMain.handle(
    "filex:open-installed-tool",
    async (_event, toolId: DesktopToolId, launchArgs?: string[]) => openInstalledTool(toolId, launchArgs),
  );
  ipcMain.handle("filex:get-image-id-print-ai-status", () => getImageIdPrintAiStatus());
  ipcMain.handle("filex:open-folder", () => openFolderDesktop());
  ipcMain.handle("filex:reopen-folder", (_event, rootPath: string) => reopenFolderDesktop(rootPath));
  ipcMain.handle("filex:consume-pending-open-folder-path", () => {
    const folderPath = pendingOpenFolderPath;
    pendingOpenFolderPath = null;
    return folderPath;
  });
  ipcMain.handle("filex:mark-open-folder-request-ready", (event) => {
    const windowForEvent = BrowserWindow.fromWebContents(event.sender);
    if (!windowForEvent || windowForEvent !== mainWindow) {
      return;
    }

    isOpenFolderRequestRendererReady = true;
    if (pendingOpenFolderPath) {
      deliverOpenFolderRequest(pendingOpenFolderPath);
    }
  });
  ipcMain.handle("filex:create-auto-layout-handoff-file", (_event, payload: { fileName?: string; content?: string }) =>
    createAutoLayoutHandoffFileDesktop(
      payload?.fileName ?? "photo-selector-handoff.imagetool",
      payload?.content ?? "",
    ),
  );
  ipcMain.handle("filex:consume-pending-open-project-path", () => {
    const projectPath = pendingOpenProjectPath;
    pendingOpenProjectPath = null;
    return projectPath;
  });
  ipcMain.handle("filex:mark-open-project-request-ready", (event) => {
    const windowForEvent = BrowserWindow.fromWebContents(event.sender);
    if (!windowForEvent || windowForEvent !== mainWindow) {
      return;
    }

    isOpenProjectRequestRendererReady = true;
    if (pendingOpenProjectPath) {
      deliverOpenProjectRequest(pendingOpenProjectPath);
    }
  });
  ipcMain.handle("filex:can-start-drag-out", (_event, absolutePaths: unknown) =>
    validateDesktopDragOut(absolutePaths),
  );
  ipcMain.on("filex:start-drag-out", (event, absolutePaths: unknown) => {
    const dragCheck = validateDesktopDragOut(absolutePaths);
    const paths = normalizeExistingAbsolutePaths(absolutePaths);

    if (!dragCheck.ok || paths.length === 0) {
      logDesktopEvent({
        channel: "drag-out",
        level: "warn",
        message: "Drag esterno bloccato",
        details: dragCheck.message,
      });
      return;
    }

    const iconPath = resolveWindowIcon();
    const dragItem = paths.length > 1
      ? { file: paths[0], files: paths, icon: iconPath }
      : { file: paths[0], icon: iconPath };

    try {
      event.sender.startDrag(dragItem);
      logDesktopEvent({
        channel: "drag-out",
        level: "info",
        message: "Drag esterno avviato",
        details: `${paths.length} file`,
      });
    } catch (error) {
      console.error("FileX startDrag failed", error);
      logDesktopEvent({
        channel: "drag-out",
        level: "error",
        message: "startDrag fallito",
        details: error instanceof Error ? error.message : String(error),
      });

      if (paths.length > 1) {
        try {
          event.sender.startDrag({
            file: paths[0],
            icon: iconPath,
          });
          logDesktopEvent({
            channel: "drag-out",
            level: "warn",
            message: "startDrag fallback singolo file usato",
            details: paths[0],
          });
          return;
        } catch (fallbackError) {
          console.error("FileX startDrag fallback failed", fallbackError);
          logDesktopEvent({
            channel: "drag-out",
            level: "error",
            message: "Fallback startDrag fallito",
            details: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
        }
      }
    }
  });
  ipcMain.handle("filex:read-file", (_event, absolutePath: string) => readFileFromDisk(absolutePath));
  ipcMain.handle(
    "filex:get-thumbnail",
    (_event, absolutePath: string, maxDimension: number, quality: number, sourceFileKey?: string) =>
      getDesktopThumbnail(absolutePath, maxDimension, quality, sourceFileKey),
  );
  ipcMain.handle(
    "filex:get-cached-thumbnails",
    (_event, entries: DesktopThumbnailCacheLookupEntry[], maxDimension: number, quality: number) =>
      getCachedThumbnailsFromDisk(entries, maxDimension, quality),
  );
  ipcMain.handle("filex:get-thumbnail-cache-info", async () => {
    const info = await getThumbnailCacheInfo();
    return {
      ...info,
      ...getDesktopImageCacheLimits(),
    };
  });
  ipcMain.handle("filex:choose-thumbnail-cache-directory", () => chooseThumbnailCacheDirectory());
  ipcMain.handle("filex:set-thumbnail-cache-directory", (_event, directoryPath: string) =>
    setThumbnailCacheDirectory(directoryPath),
  );
  ipcMain.handle("filex:reset-thumbnail-cache-directory", () => resetThumbnailCacheDirectory());
  ipcMain.handle("filex:clear-thumbnail-cache", () => clearThumbnailCacheDirectory());
  ipcMain.handle("filex:get-ram-budget-info", async () => {
    const limits = getDesktopImageCacheLimits();
    return getRamBudgetInfo(limits.systemTotalMemoryBytes, limits.ramBudgetBytes, {
      effectiveThumbnailRamMaxEntries: limits.effectiveThumbnailRamMaxEntries,
      effectiveThumbnailRamMaxBytes: limits.effectiveThumbnailRamMaxBytes,
      effectiveRenderedPreviewMaxEntries: limits.effectiveRenderedPreviewMaxEntries,
      effectiveRenderedPreviewMaxBytes: limits.effectiveRenderedPreviewMaxBytes,
      effectivePreviewSourceMaxEntries: limits.effectivePreviewSourceMaxEntries,
      effectivePreviewSourceMaxBytes: limits.effectivePreviewSourceMaxBytes,
    });
  });
  ipcMain.handle("filex:set-ram-budget-preset", async (_event, preset: DesktopRamBudgetPreset) => {
    configureDesktopImageService(preset);
    await saveRamBudgetPreset(preset);
    const limits = getDesktopImageCacheLimits();
    return getRamBudgetInfo(limits.systemTotalMemoryBytes, limits.ramBudgetBytes, {
      effectiveThumbnailRamMaxEntries: limits.effectiveThumbnailRamMaxEntries,
      effectiveThumbnailRamMaxBytes: limits.effectiveThumbnailRamMaxBytes,
      effectiveRenderedPreviewMaxEntries: limits.effectiveRenderedPreviewMaxEntries,
      effectiveRenderedPreviewMaxBytes: limits.effectiveRenderedPreviewMaxBytes,
      effectivePreviewSourceMaxEntries: limits.effectivePreviewSourceMaxEntries,
      effectivePreviewSourceMaxBytes: limits.effectivePreviewSourceMaxBytes,
    });
  });
  ipcMain.handle("filex:relaunch", () => {
    app.relaunch();
    app.quit();
  });
  ipcMain.handle("filex:get-cache-location-recommendation", () => getCacheLocationRecommendation());
  ipcMain.handle("filex:migrate-thumbnail-cache-directory", (_event, directoryPath: string) =>
    migrateThumbnailCacheDirectory(directoryPath),
  );
  ipcMain.handle("filex:dismiss-cache-location-recommendation", () =>
    dismissCacheLocationRecommendation(),
  );
  ipcMain.handle("filex:choose-editor-executable", async (_event, currentPath?: string) => {
    const normalizedCurrentPath = sanitizeDesktopPath(currentPath ?? "");
    const installedCandidates = getInstalledEditorCandidates();
    const fallbackCandidate = installedCandidates[0]?.path ?? "";
    const defaultPath = existsSync(normalizedCurrentPath) ? normalizedCurrentPath : fallbackCandidate;
    const result = await dialog.showOpenDialog({
      title: "Seleziona editor esterno",
      defaultPath: defaultPath || undefined,
      buttonLabel: "Usa questo editor",
      properties: ["openFile"],
      filters: [
        { name: "Eseguibili Windows", extensions: ["exe", "bat", "cmd"] },
        { name: "Tutti i file", extensions: ["*"] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return sanitizeDesktopPath(result.filePaths[0]);
  });
  ipcMain.handle("filex:get-installed-editor-candidates", () => getInstalledEditorCandidates());
  ipcMain.handle(
    "filex:get-preview",
    (_event, absolutePath: string, options?: { maxDimension?: number; sourceFileKey?: string }) =>
      getDesktopPreview(absolutePath, options?.maxDimension, options?.sourceFileKey),
  );
  ipcMain.handle("filex:get-quick-preview-frame", (_event, request: DesktopQuickPreviewRequest) =>
    getDesktopQuickPreviewFrame(request),
  );
  ipcMain.handle(
    "filex:warm-preview",
    (_event, absolutePath: string, options?: { maxDimension?: number; sourceFileKey?: string }) =>
      warmDesktopPreview(absolutePath, options?.maxDimension, options?.sourceFileKey),
  );
  ipcMain.handle("filex:warm-quick-preview-frames", (_event, requests: DesktopQuickPreviewRequest[]) =>
    warmDesktopQuickPreviewFrames(requests),
  );
  ipcMain.handle("filex:release-quick-preview-frames", (_event, tokens: string[]) => {
    releaseDesktopQuickPreviewFrames(Array.isArray(tokens) ? tokens : []);
  });
  ipcMain.handle("filex:send-to-editor", async (_event, editorPath: string, absolutePaths: string[]) => {
    const result = launchEditorProcess(editorPath, absolutePaths);
    logDesktopEvent({
      channel: "editor",
      level: result.ok ? "info" : "error",
      message: result.ok ? "Invio a editor riuscito" : "Invio a editor fallito",
      details: result.ok
        ? `${result.launchedCount}/${result.requestedCount} file`
        : result.error ?? `${result.launchedCount}/${result.requestedCount} file`,
    });
    return result;
  });
  ipcMain.handle("filex:open-with-editor", async (_event, editorPath: string, absolutePaths: string[]) =>
    launchEditorProcess(editorPath, absolutePaths),
  );
  ipcMain.handle("filex:copy-files-to-folder", async (_event, absolutePaths: string[]) =>
    copyFilesToFolderDesktop(absolutePaths),
  );
  ipcMain.handle("filex:move-files-to-folder", async (_event, absolutePaths: string[]) =>
    moveFilesToFolderDesktop(absolutePaths),
  );
  ipcMain.handle("filex:save-file-as", async (_event, absolutePath: string) =>
    saveFileAsDesktop(absolutePath),
  );
  ipcMain.handle("filex:get-desktop-preferences", () => getDesktopPreferences());
  ipcMain.handle("filex:save-desktop-preferences", (_event, preferences: DesktopPhotoSelectorPreferences) =>
    saveDesktopPreferences(preferences),
  );
  ipcMain.handle("filex:get-desktop-session-state", () => getDesktopSessionState());
  ipcMain.handle("filex:save-desktop-session-state", (_event, state: DesktopPersistedState) =>
    saveDesktopSessionState(state),
  );
  ipcMain.handle("filex:get-auto-layout-projects", () => getAutoLayoutProjects());
  ipcMain.handle("filex:save-auto-layout-projects", (_event, projects: unknown[]) => {
    saveAutoLayoutProjects(Array.isArray(projects) ? projects : []);
  });
  ipcMain.handle("filex:choose-output-folder", async () => {
    const result = await dialog.showOpenDialog({
      title: "Seleziona cartella output",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return sanitizeDesktopPath(result.filePaths[0]);
  });
  ipcMain.handle("filex:save-new-file-as", async (_event, suggestedName: string, bytes: Uint8Array) => {
    const normalizedSuggestedName =
      typeof suggestedName === "string" && suggestedName.trim().length > 0
        ? suggestedName.trim()
        : `export-${Date.now()}.bin`;
    const saveResult = await dialog.showSaveDialog({
      title: "Salva file",
      defaultPath: join(app.getPath("documents"), normalizedSuggestedName),
    });
    if (saveResult.canceled || !saveResult.filePath) {
      return null;
    }

    const absolutePath = sanitizeDesktopPath(saveResult.filePath);
    const payload = normalizeUint8Array(bytes);
    await writeFileAsync(absolutePath, payload);
    return absolutePath;
  });
  ipcMain.handle("filex:write-file", async (_event, absolutePath: string, bytes: Uint8Array) => {
    const normalizedPath = sanitizeDesktopPath(absolutePath);
    if (!normalizedPath) {
      return false;
    }

    try {
      await writeFileAsync(normalizedPath, normalizeUint8Array(bytes));
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle("filex:get-recent-folders", () => getRecentFolders());
  ipcMain.handle("filex:save-recent-folder", (_event, folder: DesktopRecentFolder) => saveRecentFolder(folder));
  ipcMain.handle("filex:remove-recent-folder", (_event, folderPathOrName: string) =>
    removeRecentFolder(folderPathOrName),
  );
  ipcMain.handle("filex:get-sort-cache", (_event, folderPath?: string) => getSortCache(folderPath));
  ipcMain.handle("filex:save-sort-cache", (_event, entry: DesktopSortCacheEntry) => saveSortCache(entry));
  ipcMain.handle("filex:get-folder-catalog-state", (_event, folderPath: string) => getFolderCatalogState(folderPath));
  ipcMain.handle("filex:save-folder-catalog-state", (_event, state: DesktopFolderCatalogState) =>
    saveFolderCatalogState(state),
  );
  ipcMain.handle(
    "filex:save-folder-asset-states",
    (_event, folderPath: string, assetStates: DesktopFolderCatalogAssetState[]) =>
      saveFolderAssetStates(folderPath, assetStates),
  );
  ipcMain.handle("filex:get-desktop-performance-snapshot", () => getDesktopPerformanceSnapshot());
  ipcMain.handle("filex:record-desktop-performance-snapshot", (_event, snapshot: DesktopPerformanceSnapshot) =>
    recordDesktopPerformanceSnapshot(snapshot),
  );
  ipcMain.handle("filex:log-desktop-event", (_event, event: DesktopLogEvent) => logDesktopEvent(event));
  ipcMain.handle("filex:read-sidecar-xmp", (_event, absolutePath: string) =>
    readSidecarXmpFromAssetPath(absolutePath),
  );
  ipcMain.handle("filex:write-sidecar-xmp", (_event, absolutePath: string, xml: string) =>
    writeSidecarXmpForAssetPath(absolutePath, xml),
  );
  ipcMain.handle("filex:browse-archivio-folder", () => browseArchivioFolderDesktop());
  ipcMain.handle("filex:get-archivio-settings", async () => {
    const archivio = await loadArchivioFlowModule();
    return await archivio.getSettingsService();
  });
  ipcMain.handle("filex:save-archivio-settings", async (_event, settings: unknown) => {
    const archivio = await loadArchivioFlowModule();
    const result = await archivio.saveSettingsService((settings ?? {}) as Record<string, unknown>);
    return result.settings;
  });
  ipcMain.handle("filex:get-archivio-import-progress", async () => {
    const archivio = await loadArchivioFlowModule();
    return await archivio.getImportProgressService();
  });
  ipcMain.handle("filex:cancel-archivio-import", async () => {
    const archivio = await loadArchivioFlowModule();
    return await archivio.cancelImportService();
  });
  ipcMain.handle("filex:get-archivio-low-quality-progress", async () => {
    const archivio = await loadArchivioFlowModule();
    return await archivio.getLowQualityProgressService();
  });
  ipcMain.handle("filex:get-archivio-sd-cards", async () => await getArchivioSdCardsDesktop());
  ipcMain.handle("filex:get-archivio-sd-preview", async (_event, sdPath: string) => {
    const archivio = await loadArchivioFlowModule();
    return await archivio.getSdPreviewService(sdPath);
  });
  ipcMain.handle("filex:get-archivio-filter-preview", async (_event, input: Record<string, unknown>) => {
    const archivio = await loadArchivioFlowModule();
    return await archivio.getFilterPreviewService(input);
  });
  ipcMain.handle("filex:get-archivio-preview-image", async (_event, sdPath: string, filePath: string) => {
    const archivio = await loadArchivioFlowModule();
    const preview = await archivio.getPreviewImageService(sdPath, filePath);
    return {
      bytes: new Uint8Array(preview.bytes),
      mimeType: preview.mimeType,
      width: 0,
      height: 0,
    };
  });
  ipcMain.handle("filex:start-archivio-import", async (_event, input: Record<string, unknown>) => {
    const archivio = await loadArchivioFlowModule();
    return await archivio.importService(input);
  });
  ipcMain.handle("filex:list-archivio-jobs", async () => {
    const archivio = await loadArchivioFlowModule();
    return await archivio.listJobsService();
  });
  ipcMain.handle("filex:delete-archivio-job", async (_event, jobId: string) => {
    const archivio = await loadArchivioFlowModule();
    return await archivio.deleteJobService(jobId);
  });
  ipcMain.handle("filex:update-archivio-job-contract-link", async (_event, jobId: string, contrattoLink: string) => {
    const archivio = await loadArchivioFlowModule();
    const result = await archivio.updateJobContractLinkService(jobId, contrattoLink);
    return result.job;
  });
  ipcMain.handle("filex:list-archivio-job-subfolders", async (_event, jobId: string) => {
    const archivio = await loadArchivioFlowModule();
    return await archivio.listJobSubfoldersService(jobId);
  });
  ipcMain.handle("filex:list-archivio-job-selection-candidates", async (_event, jobId: string) => {
    const archivio = await loadArchivioFlowModule();
    return await archivio.listJobSelectionCandidatesService(jobId);
  });
  ipcMain.handle("filex:generate-archivio-low-quality", async (_event, jobId: string, overwrite: boolean, sourceSubfolder?: string) => {
    const archivio = await loadArchivioFlowModule();
    return await archivio.generateLowQualityService(jobId, overwrite, sourceSubfolder);
  });
  ipcMain.handle("filex:open-archivio-folder", async (_event, folderPath: string) => {
    const normalizedPath = sanitizeDesktopPath(folderPath);
    if (!normalizedPath || !existsSync(normalizedPath)) {
      throw new Error("Cartella non trovata");
    }
    if (!statSync(normalizedPath).isDirectory()) {
      throw new Error("Il percorso selezionato non e' una cartella");
    }
    const shellError = await shell.openPath(normalizedPath);
    if (shellError) {
      throw new Error(shellError);
    }
    return { ok: true };
  });
}

async function loadRenderer(window: BrowserWindowInstance): Promise<void> {
  if (shouldUseDevRenderer && process.env.FILEX_RENDERER_URL) {
    writeBootLog(`Loading dev renderer ${process.env.FILEX_RENDERER_URL}`);
    await window.loadURL(process.env.FILEX_RENDERER_URL);
    return;
  }

  const entryPath = resolveRendererEntry();
  writeBootLog(`Loading renderer entry ${entryPath}`);
  if (!existsSync(entryPath)) {
    writeBootLog(`Renderer entry missing ${entryPath}`);
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildMissingRendererHtml(entryPath))}`);
    return;
  }

  await window.loadFile(entryPath);
  writeBootLog("Renderer loadFile completed");
}

async function ensureMainWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindowCreationPromise) {
    await mainWindowCreationPromise;
    return;
  }

  mainWindowCreationPromise = createMainWindow().finally(() => {
    mainWindowCreationPromise = null;
  });
  await mainWindowCreationPromise;
}

async function createMainWindow(): Promise<void> {
  writeBootLog("Creating main window");
  const windowInstance = new BrowserWindow({
    title: requestedTool.productName,
    width: requestedTool.defaultWindowWidth,
    height: requestedTool.defaultWindowHeight,
    minWidth: requestedTool.minWindowWidth,
    minHeight: requestedTool.minWindowHeight,
    autoHideMenuBar: true,
    backgroundColor: "#181d1a",
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: join(app.getAppPath(), "dist-electron", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow = windowInstance;
  isOpenFolderRequestRendererReady = false;

  windowInstance.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  windowInstance.webContents.on("will-prevent-unload", (event) => {
    event.preventDefault();
    windowInstance.destroy();
  });

  windowInstance.webContents.on("render-process-gone", (_event, details) => {
    writeBootLog(`Renderer process gone: ${details.reason}${details.exitCode ? ` (code ${details.exitCode})` : ""}`);
    logDesktopEvent({
      channel: "renderer",
      level: "error",
      message: "Renderer process terminato",
      details: `${details.reason}${details.exitCode ? ` (code ${details.exitCode})` : ""}`,
    });
  });

  await loadRenderer(windowInstance);

  windowInstance.setTitle(requestedTool.productName);
  writeBootLog("Main window created");

  if (!app.isPackaged) {
    windowInstance.webContents.openDevTools({ mode: "detach" });
  }

  windowInstance.on("closed", () => {
    writeBootLog("Main window closed");
    if (mainWindow) {
      mainWindow = null;
    }
    isOpenFolderRequestRendererReady = false;
  });

  if (pendingOpenFolderPath) {
    focusMainWindow();
  }
}

// Safety net globale: cattura errori asincroni non gestiti dagli IPC handler
// (es. fs.promises.* che rejectano dentro un .handle senza try/catch) e
// converte la condizione "process Main crash" in "evento loggato + dialog".
// Senza questi guard, una promise rejected in un handler chiude l'app intera.
// In dev (NON packaged) lasciamo crashare per evidenziare i bug, attiviamo
// il safety net solo in produzione.
const isPackagedBuild = app.isPackaged;
process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  try {
    writeBootLog(`Unhandled promise rejection: ${stack ?? message}`);
  } catch {
    // ignore boot-log failures
  }
  try {
    logDesktopEvent({
      channel: "app",
      level: "error",
      message: "Unhandled promise rejection",
      details: stack ?? message,
    });
  } catch {
    // logDesktopEvent può fallire se lo store non è ancora pronto
  }
  if (!isPackagedBuild) {
    // In dev: rilancia in modo asincrono così Electron mostra l'overlay e
    // possiamo fixare il bug invece di nasconderlo.
    setImmediate(() => {
      throw reason instanceof Error ? reason : new Error(String(reason));
    });
  }
});

process.on("uncaughtException", (error) => {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  try {
    writeBootLog(`Uncaught exception: ${stack ?? message}`);
  } catch {
    // ignore
  }
  try {
    logDesktopEvent({
      channel: "app",
      level: "error",
      message: "Uncaught exception",
      details: stack ?? message,
    });
  } catch {
    // ignore
  }
  if (!isPackagedBuild) {
    // In dev: lascia crashare per non mascherare bug.
    throw error instanceof Error ? error : new Error(String(error));
  }
});

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    writeBootLog(`App ready for tool ${requestedTool.id}`);
    // Apply the persisted RAM budget before registering IPC handlers so that
    // the cache limits are already in effect when the first thumbnail request arrives.
    const savedPreset = await loadRamBudgetPreset();
    configureDesktopImageService(savedPreset);

    if (requestedTool.id === "image-party-frame") {
      await ensureImagePartyFrameServer();
    }

    enforceUtf8CharsetOnTextResponses();
    registerPreviewProtocol();
    registerCrashTelemetryHandlers();
    registerIpcHandlers();
    await ensureMainWindow();
    writeBootLog("Startup sequence completed");

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void ensureMainWindow();
      }
    });
  }).catch((error) => {
    writeBootLog(`Startup sequence failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    console.error("FileX Desktop failed to start", error);
    logDesktopEvent({
      channel: "app",
      level: "error",
      message: "Avvio shell fallito",
      details: error instanceof Error ? error.message : String(error),
    });
    app.exit(1);
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.once("before-quit", () => {
  void shutdownDesktopImageService();
  shutdownDesktopStore();
});
