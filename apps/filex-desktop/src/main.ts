import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  DesktopDragOutCheck,
  DesktopEditorCandidate,
  DesktopFolderCatalogAssetState,
  DesktopFolderCatalogState,
  DesktopLogEvent,
  DesktopPerformanceSnapshot,
  DesktopPersistedState,
  DesktopPhotoSelectorPreferences,
  DesktopQuickPreviewRequest,
  DesktopRecentFolder,
  DesktopRuntimeInfo,
  DesktopSendToEditorResult,
  DesktopSortCacheEntry,
  DesktopThumbnailCacheLookupEntry,
} from "@photo-tools/desktop-contracts";
import {
  openFolderDesktop,
  readFileFromDisk,
  readSidecarXmpFromAssetPath,
  reopenFolderDesktop,
  writeSidecarXmpForAssetPath,
} from "./native-folder-service.js";
import {
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
  getThumbnailCacheInfo,
  migrateThumbnailCacheDirectory,
  resetThumbnailCacheDirectory,
  setThumbnailCacheDirectory,
} from "./thumbnail-disk-cache.js";
import {
  getDesktopPreferences,
  getDesktopSessionState,
  getDesktopPerformanceSnapshot,
  getFolderCatalogState,
  getRecentFolders,
  getSortCache,
  logDesktopEvent,
  recordDesktopPerformanceSnapshot,
  removeRecentFolder,
  saveDesktopPreferences,
  saveDesktopSessionState,
  saveFolderAssetStates,
  saveFolderCatalogState,
  saveRecentFolder,
  saveSortCache,
  shutdownDesktopStore,
} from "./desktop-store.js";
import { getDesktopToolOrDefault } from "./tool-manifest.js";

const requestedTool = getDesktopToolOrDefault(process.env.FILEX_TOOL);
const MAX_DESKTOP_DRAG_OUT_FILES = 25;
const shouldUseDevRenderer =
  process.env.FILEX_RENDERER_MODE === "dev" && typeof process.env.FILEX_RENDERER_URL === "string";
const appUserModelId = `studio.filex.${requestedTool.id}`;
let mainWindow: BrowserWindow | null = null;
let isOpenFolderRequestRendererReady = false;
let pendingOpenFolderPath: string | null = null;
let mainWindowCreationPromise: Promise<void> | null = null;

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

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  pendingOpenFolderPath = extractOpenFolderPathFromArgv(process.argv);

  app.on("second-instance", (_event, argv) => {
    queueOpenFolderPath(extractOpenFolderPathFromArgv(argv));
    void ensureMainWindow();
    focusMainWindow();
  });

  app.on("browser-window-focus", () => {
    if (pendingOpenFolderPath && isOpenFolderRequestRendererReady) {
      deliverOpenFolderRequest(pendingOpenFolderPath);
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
      allowedCount: Math.min(validCount, MAX_DESKTOP_DRAG_OUT_FILES),
      reason: "invalid-paths",
      message: "Alcuni file selezionati non hanno un percorso valido.",
    };
  }

  if (validCount > MAX_DESKTOP_DRAG_OUT_FILES) {
    return {
      ok: false,
      requestedCount,
      validCount,
      allowedCount: MAX_DESKTOP_DRAG_OUT_FILES,
      reason: "too-many-files",
      message: `Drag esterno limitato a ${MAX_DESKTOP_DRAG_OUT_FILES} file. Usa 'Apri con editor' per selezioni piu grandi.`,
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
  ipcMain.handle("filex:get-runtime-info", () => {
    const payload: DesktopRuntimeInfo = {
      shell: "electron",
      platform: process.platform,
      isPackaged: app.isPackaged,
      appVersion: app.getVersion(),
      toolId: requestedTool.id,
      toolName: requestedTool.displayName,
    };

    return payload;
  });
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
  ipcMain.handle("filex:get-thumbnail-cache-info", () => getThumbnailCacheInfo());
  ipcMain.handle("filex:choose-thumbnail-cache-directory", () => chooseThumbnailCacheDirectory());
  ipcMain.handle("filex:set-thumbnail-cache-directory", (_event, directoryPath: string) =>
    setThumbnailCacheDirectory(directoryPath),
  );
  ipcMain.handle("filex:reset-thumbnail-cache-directory", () => resetThumbnailCacheDirectory());
  ipcMain.handle("filex:clear-thumbnail-cache", () => clearThumbnailCacheDirectory());
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
  ipcMain.handle("filex:get-desktop-preferences", () => getDesktopPreferences());
  ipcMain.handle("filex:save-desktop-preferences", (_event, preferences: DesktopPhotoSelectorPreferences) =>
    saveDesktopPreferences(preferences),
  );
  ipcMain.handle("filex:get-desktop-session-state", () => getDesktopSessionState());
  ipcMain.handle("filex:save-desktop-session-state", (_event, state: DesktopPersistedState) =>
    saveDesktopSessionState(state),
  );
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
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  if (shouldUseDevRenderer && process.env.FILEX_RENDERER_URL) {
    await window.loadURL(process.env.FILEX_RENDERER_URL);
    return;
  }

  const entryPath = resolveRendererEntry();
  if (!existsSync(entryPath)) {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildMissingRendererHtml(entryPath))}`);
    return;
  }

  await window.loadFile(entryPath);
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
    logDesktopEvent({
      channel: "renderer",
      level: "error",
      message: "Renderer process terminato",
      details: `${details.reason}${details.exitCode ? ` (code ${details.exitCode})` : ""}`,
    });
  });

  await loadRenderer(windowInstance);

  windowInstance.setTitle(requestedTool.productName);

  if (!app.isPackaged) {
    windowInstance.webContents.openDevTools({ mode: "detach" });
  }

  windowInstance.on("closed", () => {
    if (mainWindow) {
      mainWindow = null;
    }
    isOpenFolderRequestRendererReady = false;
  });

  if (pendingOpenFolderPath) {
    focusMainWindow();
  }
}

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    registerPreviewProtocol();
    registerIpcHandlers();
    await ensureMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void ensureMainWindow();
      }
    });
  }).catch((error) => {
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
