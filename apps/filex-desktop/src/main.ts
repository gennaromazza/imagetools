import * as electron from "electron";
import type { BrowserWindow as BrowserWindowInstance, Tray as TrayInstance } from "electron";
import { execSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { readFile as readFileAsync, writeFile as writeFileAsync } from "node:fs/promises";
import { basename, dirname, join, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// When the app is launched from a terminal that is later closed, Node can
// report EPIPE for diagnostic console writes. It must not terminate the
// desktop process while a folder is being scanned or exported.
for (const output of [process.stdout, process.stderr]) {
  output.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") {
      // Keep the error observable without allowing a broken diagnostic pipe
      // to take down the renderer/main process.
      return;
    }
  });
}

import type {
  DesktopDragOutCheck,
  DesktopDockState,
  DesktopEditorCandidate,
  DesktopFolderCatalogAssetState,
  DesktopFolderCatalogState,
  DesktopFolderOpenOptions,
  DesktopLogEvent,
  DesktopPerformanceSnapshot,
  DesktopPersistedState,
  DesktopRamBudgetPreset,
  DesktopReleaseChannel,
  DesktopPhotoSelectorPreferences,
  DesktopQuickPreviewRequest,
  DesktopRecentFolder,
  DesktopRuntimeInfo,
  DesktopSuiteUpdateState,
  DesktopSendToEditorResult,
  DesktopSortCacheEntry,
  DesktopToolId,
  DesktopToolInstallState,
  DesktopThumbnailCacheLookupEntry,
  DesktopThumbnailBatchRequest,
  DesktopThumbnailRequestOptions,
  ImageConverterJobConfig,
  ImageFileFinderJobConfig,
  ImageFileFinderScanRequest,
} from "@photo-tools/desktop-contracts";
import {
  copyFilesToFolderDesktop,
  moveFilesToFolderDesktop,
  listPhotoSelectorLegacyProjectsDesktop,
  openFolderDesktop,
  readFileFromDisk,
  readPhotoSelectorProjectFileDesktop,
  readSidecarXmpFromAssetPath,
  relocatePhotoSelectorProjectFileDesktop,
  resolvePhotoSelectorProjectDesktop,
  reopenFolderDesktop,
  saveFileAsDesktop,
  statFilesFromDisk,
  writePhotoSelectorProjectFileDesktop,
  writeSidecarXmpForAssetPath,
} from "./native-folder-service.js";
import {
  configureDesktopImageService,
  getDesktopImageCacheLimits,
  getDesktopQuickPreviewFrame,
  getDesktopPreview,
  getDesktopThumbnail,
  getDesktopCachedThumbnailFrames,
  getDesktopThumbnailFrame,
  getDesktopThumbnails,
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
  getFolderCatalogState,
  listFolderCatalogStatesUnderRoot,
  getRecentFolders,
  getSortCache,
  logDesktopEvent,
  recordDesktopPerformanceSnapshot,
  removeRecentFolder,
  saveDesktopPreferences,
  saveDesktopSessionState,
  saveFolderAssetStates,
  saveFolderAssetStatesDelta,
  saveFolderCatalogState,
  saveRecentFolder,
  saveSortCache,
  shutdownDesktopStore,
} from "./desktop-store.js";
import {
  applyToolUpdate,
  checkToolUpdate,
  downloadToolUpdate,
  getUpdateJob,
  listAvailableTools,
  openInstalledTool,
} from "./updater.js";
import { findDesktopToolByRuntimeToken, getDesktopToolOrDefault, getSuiteManagedTools } from "./tool-manifest.js";
import { consumeFileXRestartPlan } from "./filex-process-coordinator.js";
import {
  checkSuiteUpdate,
  configureSuiteUpdater,
  getSuiteUpdateState,
  installSuiteUpdate,
} from "./suite-updater.js";
import {
  connectGoogleDrive,
  disconnectGoogleDrive,
  downloadPhotoSelectorDriveVersion,
  exportPhotoSelectorProjectToDrive,
  getGoogleDriveStatus,
  listPhotoSelectorDriveVersions,
} from "./google-drive-service.js";
import {
  cancelImageConverterJobDesktop,
  chooseImageConverterFoldersDesktop,
  getImageConverterPresetsDesktop,
  getImageConverterProgressDesktop,
  openImageConverterFolderDesktop,
  scanImageConverterInputsDesktop,
  startImageConverterJobDesktop,
} from "./image-converter-service.js";
import {
  cancelImageFileFinderJobDesktop,
  chooseImageFileFinderDestinationFolderDesktop,
  chooseImageFileFinderSourceFolderDesktop,
  getImageFileFinderProgressDesktop,
  openImageFileFinderFolderDesktop,
  scanImageFileFinderMatchesDesktop,
  startImageFileFinderJobDesktop,
} from "./image-file-finder-service.js";

const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, screen, session, shell, Tray } = electron;

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
let deliveredOpenFolderPath: string | null = null;
let isOpenProjectRequestRendererReady = false;
let pendingOpenProjectPath: string | null = null;
let mainWindowCreationPromise: Promise<void> | null = null;
let suiteTray: TrayInstance | null = null;
let suiteDockWindow: BrowserWindowInstance | null = null;
const defaultSuiteDockState: DesktopDockState = {
  schemaVersion: 2,
  x: 0,
  y: 0,
  opacity: 0.94,
  collapsed: true,
  autoHide: true,
  toolOrder: getSuiteManagedTools().map((tool) => tool.id),
  visibleToolCount: 0,
  settingsOpen: false,
};

function getSuiteDockStatePath(): string {
  return join(app.getPath("userData"), "suite-dock-state.json");
}

function sanitizeSuiteDockState(value: Partial<DesktopDockState> | null | undefined): DesktopDockState {
  const x = Number(value?.x);
  const y = Number(value?.y);
  const opacity = Number(value?.opacity);
  const visibleToolCount = Number(value?.visibleToolCount);
  const allowedToolIds = new Set(getSuiteManagedTools().map((tool) => tool.id));
  const requestedOrder = Array.isArray(value?.toolOrder) ? value.toolOrder : [];
  const toolOrder = Array.from(new Set(requestedOrder.filter((toolId) => allowedToolIds.has(toolId))));
  for (const tool of getSuiteManagedTools()) {
    if (!toolOrder.includes(tool.id)) toolOrder.push(tool.id);
  }
  return {
    schemaVersion: 2,
    x: Number.isFinite(x) ? Math.round(x) : defaultSuiteDockState.x,
    y: Number.isFinite(y) ? Math.round(y) : defaultSuiteDockState.y,
    opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0.45, opacity)) : defaultSuiteDockState.opacity,
    collapsed: Boolean(value?.collapsed),
    autoHide: Boolean(value?.autoHide),
    toolOrder,
    visibleToolCount: Number.isFinite(visibleToolCount)
      ? Math.min(getSuiteManagedTools().length, Math.max(0, Math.round(visibleToolCount)))
      : defaultSuiteDockState.visibleToolCount,
    settingsOpen: Boolean(value?.settingsOpen),
  };
}

async function readSuiteDockState(): Promise<DesktopDockState> {
  try {
    const raw = JSON.parse(await readFileAsync(getSuiteDockStatePath(), "utf8")) as Partial<DesktopDockState>;
    if (raw.schemaVersion !== 2) {
      return sanitizeSuiteDockState({
        ...raw,
        schemaVersion: 2,
        collapsed: true,
        autoHide: true,
        settingsOpen: false,
      });
    }
    return { ...defaultSuiteDockState, ...sanitizeSuiteDockState(raw) };
  } catch {
    return { ...defaultSuiteDockState };
  }
}

function applySuiteDockWindowLayout(state: DesktopDockState, animate: boolean): void {
  if (!suiteDockWindow || suiteDockWindow.isDestroyed()) return;
  const currentBounds = suiteDockWindow.getBounds();
  const display = screen.getDisplayMatching(currentBounds);
  const itemCount = Math.min(getSuiteManagedTools().length, Math.max(0, state.visibleToolCount));
  const expandedWidth = Math.min(
    display.workAreaSize.width - 24,
    Math.max(220, 142 + itemCount * 62),
  );
  const width = state.collapsed ? 88 : expandedWidth;
  const height = state.settingsOpen && !state.collapsed ? 190 : 100;
  const centerX = currentBounds.x + currentBounds.width / 2;
  const bottom = currentBounds.y + currentBounds.height;
  const minX = display.workArea.x;
  const maxX = display.workArea.x + display.workAreaSize.width - width;
  const minY = display.workArea.y;
  const maxY = display.workArea.y + display.workAreaSize.height - height;
  const x = Math.min(maxX, Math.max(minX, Math.round(centerX - width / 2)));
  const y = Math.min(maxY, Math.max(minY, Math.round(bottom - height)));
  suiteDockWindow.setBounds({ x, y, width, height }, animate);
}

async function saveSuiteDockState(partial: Partial<DesktopDockState>): Promise<DesktopDockState> {
  const current = await readSuiteDockState();
  const bounds = suiteDockWindow && !suiteDockWindow.isDestroyed() ? suiteDockWindow.getBounds() : null;
  const next = sanitizeSuiteDockState({
    ...current,
    ...partial,
    x: typeof partial.x === "number" ? partial.x : bounds?.x ?? current.x,
    y: typeof partial.y === "number" ? partial.y : bounds?.y ?? current.y,
  });
  if (
    suiteDockWindow &&
    !suiteDockWindow.isDestroyed() &&
    (typeof partial.collapsed === "boolean" ||
      typeof partial.visibleToolCount === "number" ||
      typeof partial.settingsOpen === "boolean")
  ) {
    applySuiteDockWindowLayout(next, true);
    const resizedBounds = suiteDockWindow.getBounds();
    next.x = resizedBounds.x;
    next.y = resizedBounds.y;
  }
  if (suiteDockWindow && !suiteDockWindow.isDestroyed() && (typeof partial.x === "number" || typeof partial.y === "number")) {
    suiteDockWindow.setPosition(next.x, next.y, true);
  }
  if (suiteDockWindow && !suiteDockWindow.isDestroyed()) {
    suiteDockWindow.setOpacity(next.opacity);
  }
  await writeFileAsync(getSuiteDockStatePath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
let archivioFlowTray: TrayInstance | null = null;
let archivioFlowSdWatchTimer: NodeJS.Timeout | null = null;
let archivioFlowKnownSdPaths = new Set<string>();
let archivioFlowIsQuitting = false;
const archivioFlowWatchMode = requestedTool.id === "archivio-flow" && process.argv.includes("--archivio-flow-watch");
let archivioFlowModulePromise: Promise<any> | null = null;
let imagePartyFrameServerModulePromise: Promise<any> | null = null;

function resolveReleaseChannel(): DesktopReleaseChannel {
  return process.env.FILEX_RELEASE_CHANNEL === "beta" ? "beta" : "stable";
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
  const extension = process.platform === "win32" ? "ico" : "png";
  if (app.isPackaged) {
    return join(process.resourcesPath, "branding", `${requestedTool.id}.${extension}`);
  }

  return resolve(app.getAppPath(), ".output", "branding", `${requestedTool.id}.${extension}`);
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

function isInternalLaunchDirectory(candidatePath: string): boolean {
  const normalizedCandidate = sanitizeDesktopPath(candidatePath).toLowerCase();
  if (!normalizedCandidate) {
    return true;
  }

  const internalRoots = new Set(
    [
      dirname(process.execPath),
      process.cwd(),
      app.getAppPath(),
      process.resourcesPath,
    ]
      .map((value) => sanitizeDesktopPath(value).toLowerCase())
      .filter(Boolean),
  );

  return internalRoots.has(normalizedCandidate);
}

function resolveWorkingDirectoryOpenFolderPath(workingDirectory?: string | null): string | null {
  if (typeof workingDirectory !== "string" || !workingDirectory.trim()) {
    return null;
  }

  const directoryPath = resolveValidDirectoryPath(workingDirectory);
  if (!directoryPath || isInternalLaunchDirectory(directoryPath)) {
    return null;
  }

  return directoryPath;
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

function resolveSuiteDockEntry(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "apps/filex-desktop/suite-launcher", "dock.html");
  }

  return resolve(app.getAppPath(), ".output", "suite-launcher", "dock.html");
}

async function loadArchivioFlowModule(): Promise<any> {
  if (archivioFlowModulePromise) {
    return archivioFlowModulePromise;
  }

  archivioFlowModulePromise = (async () => {
    try {
      process.env.ARCHIVIO_FLOW_DATA_DIR = getArchivioFlowDataDir();
      const modulePath = resolve(app.getAppPath(), ".output", "electron", "archivio-flow-server", "index.js");
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
      const modulePath = resolve(app.getAppPath(), ".output", "electron", "image-party-frame-server", "server", "index.js");
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

function extractOpenFolderPathFromArgv(argv: string[], workingDirectory?: string | null): string | null {
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

  return resolveWorkingDirectoryOpenFolderPath(workingDirectory);
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

  // Manteniamo la richiesta pendente fino all'ack del renderer, ma non la
  // rispediamo a ogni evento di focus mentre la cartella è in apertura.
  if (deliveredOpenFolderPath === folderPath) {
    return;
  }

  deliveredOpenFolderPath = folderPath;
  mainWindow.webContents.send("filex:open-folder-request", folderPath);
  logDesktopEvent({
    channel: "folder-open",
    level: "info",
    message: "Richiesta apertura cartella inviata al renderer",
    details: folderPath,
  });
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

const initialOpenFolderPath = extractOpenFolderPathFromArgv(process.argv, process.cwd());
const initialOpenProjectPath = extractOpenProjectPathFromArgv(process.argv);
const hasSingleInstanceLock = app.requestSingleInstanceLock({
  requestedToolId: requestedTool.id,
  openFolderPath: initialOpenFolderPath,
  openProjectPath: initialOpenProjectPath,
});
if (!hasSingleInstanceLock) {
  writeEarlyBootLog("Single instance lock denied, quitting");
  app.quit();
} else {
  writeEarlyBootLog("Single instance lock acquired");
  pendingOpenFolderPath = initialOpenFolderPath;
  pendingOpenProjectPath = initialOpenProjectPath;

  app.on("second-instance", (_event, argv, workingDirectory, additionalData) => {
    const launchData = additionalData && typeof additionalData === "object"
      ? additionalData as { openFolderPath?: unknown; openProjectPath?: unknown }
      : null;
    const sharedFolderPath = typeof launchData?.openFolderPath === "string"
      ? resolveValidDirectoryPath(launchData.openFolderPath)
      : null;
    const sharedProjectPath = typeof launchData?.openProjectPath === "string"
      ? resolveValidFilePath(launchData.openProjectPath)
      : null;
    queueOpenFolderPath(sharedFolderPath ?? extractOpenFolderPathFromArgv(argv, workingDirectory));
    queueOpenProjectPath(sharedProjectPath ?? extractOpenProjectPathFromArgv(argv));
    void ensureMainWindow();
    focusMainWindow();
  });

  app.on("browser-window-focus", () => {
    if (
      pendingOpenFolderPath
      && pendingOpenFolderPath !== deliveredOpenFolderPath
      && isOpenFolderRequestRendererReady
    ) {
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
  ipcMain.handle("filex:get-suite-update-state", () => getSuiteUpdateState());
  ipcMain.handle("filex:check-suite-update", () => checkSuiteUpdate());
  ipcMain.handle("filex:install-suite-update", () => installSuiteUpdate());
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
      aiSidecarInstalled: false,
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
  ipcMain.handle("filex:get-tool-update-job", (_event, jobId: string) => getUpdateJob(jobId));
  ipcMain.handle("filex:apply-tool-update", async (_event, jobId: string) => applyToolUpdate(jobId));
  ipcMain.handle(
    "filex:open-installed-tool",
    async (_event, toolId: DesktopToolId, launchArgs?: string[]) => openInstalledTool(toolId, launchArgs),
  );
  ipcMain.handle("filex:open-folder", (_event, options?: DesktopFolderOpenOptions) => openFolderDesktop(options));
  ipcMain.handle("filex:reopen-folder", (_event, rootPath: string, options?: DesktopFolderOpenOptions) =>
    reopenFolderDesktop(sanitizeDesktopPath(rootPath), options));
  ipcMain.handle("filex:consume-pending-open-folder-path", () => {
    return pendingOpenFolderPath;
  });
  ipcMain.handle("filex:acknowledge-open-folder-request", (_event, folderPath?: string | null) => {
    const normalizedFolderPath = typeof folderPath === "string" ? sanitizeDesktopPath(folderPath) : "";
    const normalizedPendingPath = pendingOpenFolderPath ? sanitizeDesktopPath(pendingOpenFolderPath) : "";
    const normalizedDeliveredPath = deliveredOpenFolderPath ? sanitizeDesktopPath(deliveredOpenFolderPath) : "";

    if (!pendingOpenFolderPath && !deliveredOpenFolderPath) {
      return;
    }

    const acknowledgesPending = !normalizedFolderPath || normalizedFolderPath === normalizedPendingPath;
    const acknowledgesDelivered = !normalizedFolderPath || normalizedFolderPath === normalizedDeliveredPath;
    if (acknowledgesPending || acknowledgesDelivered) {
      logDesktopEvent({
        channel: "folder-open",
        level: "info",
        message: "Richiesta apertura cartella confermata dal renderer",
        details: folderPath ?? pendingOpenFolderPath ?? deliveredOpenFolderPath ?? "",
      });
      if (acknowledgesPending) {
        pendingOpenFolderPath = null;
      }
      if (acknowledgesDelivered) {
        deliveredOpenFolderPath = null;
      }
    }
  });
  ipcMain.handle("filex:mark-open-folder-request-ready", (event) => {
    const windowForEvent = BrowserWindow.fromWebContents(event.sender);
    if (!windowForEvent || windowForEvent !== mainWindow) {
      return;
    }

    isOpenFolderRequestRendererReady = true;
    if (pendingOpenFolderPath && pendingOpenFolderPath !== deliveredOpenFolderPath) {
      deliverOpenFolderRequest(pendingOpenFolderPath);
    }
  });
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
  ipcMain.handle("filex:stat-files", (_event, absolutePaths: string[]) => statFilesFromDisk(absolutePaths));
  ipcMain.handle(
    "filex:get-thumbnail",
    (
      _event,
      absolutePath: string,
      maxDimension: number,
      quality: number,
      sourceFileKey?: string,
      options?: DesktopThumbnailRequestOptions,
    ) => getDesktopThumbnail(absolutePath, maxDimension, quality, sourceFileKey, options),
  );
  ipcMain.handle("filex:get-suite-dock-state", () => readSuiteDockState());
  ipcMain.handle("filex:save-suite-dock-state", (_event, state: Partial<DesktopDockState>) =>
    saveSuiteDockState(state ?? {}),
  );
  ipcMain.handle(
    "filex:get-thumbnail-frame",
    (
      _event,
      absolutePath: string,
      maxDimension: number,
      quality: number,
      sourceFileKey?: string,
      options?: DesktopThumbnailRequestOptions,
    ) => getDesktopThumbnailFrame(absolutePath, maxDimension, quality, sourceFileKey, options),
  );
  ipcMain.handle(
    "filex:get-thumbnails",
    (_event, requests: DesktopThumbnailBatchRequest[]) => getDesktopThumbnails(requests),
  );
  ipcMain.handle(
    "filex:get-cached-thumbnails",
    (_event, entries: DesktopThumbnailCacheLookupEntry[], maxDimension: number, quality: number) =>
      getCachedThumbnailsFromDisk(entries, maxDimension, quality),
  );
  ipcMain.handle(
    "filex:get-cached-thumbnail-frames",
    (_event, entries: DesktopThumbnailCacheLookupEntry[], maxDimension: number, quality: number) =>
      getDesktopCachedThumbnailFrames(entries, maxDimension, quality),
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
  ipcMain.handle("filex:choose-image-file", async (_event, currentPath?: string) => {
    const normalizedCurrentPath = sanitizeDesktopPath(currentPath ?? "");
    const result = await dialog.showOpenDialog({
      title: "Seleziona foto salvata",
      defaultPath: normalizedCurrentPath || undefined,
      buttonLabel: "Usa questo file",
      properties: ["openFile"],
      filters: [
        { name: "Immagini", extensions: ["jpg", "jpeg", "png", "webp", "tif", "tiff", "psd"] },
        { name: "Tutti i file", extensions: ["*"] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return sanitizeDesktopPath(result.filePaths[0]);
  });
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
  ipcMain.handle("filex:read-photo-selector-project-file", (_event, rootPath: string) =>
    readPhotoSelectorProjectFileDesktop(sanitizeDesktopPath(rootPath)),
  );
  ipcMain.handle(
    "filex:write-photo-selector-project-file",
    (_event, rootPath: string, project) =>
      writePhotoSelectorProjectFileDesktop(sanitizeDesktopPath(rootPath), project),
  );
  ipcMain.handle(
    "filex:relocate-photo-selector-project-file",
    (_event, sourceRootPath: string, targetRootPath: string, project) =>
      relocatePhotoSelectorProjectFileDesktop(
        sanitizeDesktopPath(sourceRootPath),
        sanitizeDesktopPath(targetRootPath),
        project,
      ),
  );
  ipcMain.handle("filex:resolve-photo-selector-project", (_event, folderPath: string) =>
    resolvePhotoSelectorProjectDesktop(sanitizeDesktopPath(folderPath)),
  );
  ipcMain.handle("filex:list-photo-selector-legacy-projects", async (_event, rootPath: string) => {
    const normalizedRootPath = sanitizeDesktopPath(rootPath);
    const fileProjects = await listPhotoSelectorLegacyProjectsDesktop(normalizedRootPath);
    const catalogProjects = listFolderCatalogStatesUnderRoot(normalizedRootPath).map((catalog) => ({
      rootPath: catalog.folderPath,
      project: {
        schemaVersion: 1 as const,
        app: "image-select-pro" as const,
        updatedAt: catalog.updatedAt,
        projectName: catalog.folderName,
        folderState: {
          activeAssetIds: catalog.activeAssetIds,
          assetStates: catalog.assetStates ?? [],
        },
      },
    }));
    return [...fileProjects, ...catalogProjects];
  });
  ipcMain.handle("filex:get-google-drive-status", () => getGoogleDriveStatus());
  ipcMain.handle("filex:connect-google-drive", () => connectGoogleDrive());
  ipcMain.handle("filex:disconnect-google-drive", () => disconnectGoogleDrive());
  ipcMain.handle("filex:export-photo-selector-project-to-drive", (_event, manifest) =>
    exportPhotoSelectorProjectToDrive(manifest),
  );
  ipcMain.handle("filex:list-photo-selector-drive-versions", (_event, projectName: string) =>
    listPhotoSelectorDriveVersions(projectName),
  );
  ipcMain.handle("filex:download-photo-selector-drive-version", (_event, versionId: string) =>
    downloadPhotoSelectorDriveVersion(versionId),
  );
  ipcMain.handle("filex:get-desktop-session-state", () => getDesktopSessionState());
  ipcMain.handle("filex:save-desktop-session-state", (_event, state: DesktopPersistedState) =>
    saveDesktopSessionState(state),
  );
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
  ipcMain.handle(
    "filex:save-folder-asset-states-delta",
    (_event, folderPath: string, assetStates: DesktopFolderCatalogAssetState[]) =>
      saveFolderAssetStatesDelta(folderPath, assetStates),
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
  ipcMain.handle("filex:analyze-archivio-archive", async () => {
    const archivio = await loadArchivioFlowModule();
    return await archivio.analyzeArchiveService();
  });
  ipcMain.handle("filex:rename-archivio-archive-jobs", async (_event, requests: Array<{ jobId: string; nomeLavoro?: string; dataLavoro?: string }>) => {
    const archivio = await loadArchivioFlowModule();
    return await archivio.renameArchiveJobsService(requests);
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
  ipcMain.handle("filex:get-image-converter-presets", () => getImageConverterPresetsDesktop());
  ipcMain.handle("filex:choose-image-converter-folders", () => chooseImageConverterFoldersDesktop());
  ipcMain.handle("filex:scan-image-converter-inputs", (_event, paths: string[]) =>
    scanImageConverterInputsDesktop(paths),
  );
  ipcMain.handle("filex:start-image-converter-job", (_event, config: ImageConverterJobConfig) =>
    startImageConverterJobDesktop(config),
  );
  ipcMain.handle("filex:get-image-converter-progress", () => getImageConverterProgressDesktop());
  ipcMain.handle("filex:cancel-image-converter-job", () => cancelImageConverterJobDesktop());
  ipcMain.handle("filex:open-image-converter-folder", (_event, folderPath: string) =>
    openImageConverterFolderDesktop(folderPath),
  );
  ipcMain.handle("filex:choose-image-file-finder-source-folder", () =>
    chooseImageFileFinderSourceFolderDesktop(),
  );
  ipcMain.handle("filex:choose-image-file-finder-destination-folder", () =>
    chooseImageFileFinderDestinationFolderDesktop(),
  );
  ipcMain.handle("filex:scan-image-file-finder-matches", (_event, request: ImageFileFinderScanRequest) =>
    scanImageFileFinderMatchesDesktop(request),
  );
  ipcMain.handle("filex:start-image-file-finder-job", (_event, config: ImageFileFinderJobConfig) =>
    startImageFileFinderJobDesktop(config),
  );
  ipcMain.handle("filex:get-image-file-finder-progress", () => getImageFileFinderProgressDesktop());
  ipcMain.handle("filex:cancel-image-file-finder-job", () => cancelImageFileFinderJobDesktop());
  ipcMain.handle("filex:open-image-file-finder-folder", (_event, folderPath: string) =>
    openImageFileFinderFolderDesktop(folderPath),
  );
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

function createSuiteTray(): void {
  if (requestedTool.id !== "suite-launcher" || suiteTray) return;
  suiteTray = new Tray(resolveWindowIcon());
  suiteTray.setToolTip("FileX Suite");
  const toolItems = getSuiteManagedTools().map((tool) => ({
    label: tool.displayName,
    click: async () => {
      const result = await openInstalledTool(tool.id);
      if (!result.ok) dialog.showErrorBox("FileX Suite", result.message);
    },
  }));
  suiteTray.setContextMenu(Menu.buildFromTemplate([
    { label: "Apri FileX Suite", click: () => { void ensureMainWindow().then(focusMainWindow); } },
    { type: "separator" },
    ...toolItems,
    { type: "separator" },
    { label: "Esci", click: () => app.quit() },
  ]));
  suiteTray.on("double-click", () => { void ensureMainWindow().then(focusMainWindow); });
}

async function createSuiteDock(): Promise<void> {
  if (requestedTool.id !== "suite-launcher" || (suiteDockWindow && !suiteDockWindow.isDestroyed())) return;

  const display = screen.getPrimaryDisplay();
  const dockState = await readSuiteDockState();
  const width = dockState.collapsed
    ? 88
    : Math.min(display.workAreaSize.width - 24, Math.max(220, 142 + dockState.visibleToolCount * 62));
  const height = dockState.settingsOpen && !dockState.collapsed ? 190 : 100;
  const defaultX = Math.round(display.workArea.x + (display.workAreaSize.width - width) / 2);
  const defaultY = display.workArea.y + display.workAreaSize.height - height - 18;
  suiteDockWindow = new BrowserWindow({
    width,
    height,
    x: dockState.x || defaultX,
    y: dockState.y || defaultY,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(app.getAppPath(), ".output", "electron", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  suiteDockWindow.setOpacity(dockState.opacity);
  suiteDockWindow.setAlwaysOnTop(true, "floating");
  suiteDockWindow.on("closed", () => { suiteDockWindow = null; });
  const entryPath = resolveSuiteDockEntry();
  if (existsSync(entryPath)) {
    await suiteDockWindow.loadFile(entryPath);
    suiteDockWindow.showInactive();
  } else {
    writeBootLog(`Suite dock entry missing ${entryPath}`);
  }
}

function stopArchivioFlowSdWatcher(): void {
  if (archivioFlowSdWatchTimer) {
    clearInterval(archivioFlowSdWatchTimer);
    archivioFlowSdWatchTimer = null;
  }
}

function createArchivioFlowTray(): void {
  if (!archivioFlowWatchMode || archivioFlowTray) return;

  archivioFlowTray = new Tray(resolveWindowIcon());
  archivioFlowTray.setToolTip("Archivio Flow — rilevamento SD attivo");
  archivioFlowTray.setContextMenu(Menu.buildFromTemplate([
    {
      label: "Apri Archivio Flow",
      click: () => { void ensureMainWindow().then(focusMainWindow); },
    },
    { type: "separator" },
    {
      label: "Esci (il monitoraggio riparte all'accesso)",
      click: () => {
        archivioFlowIsQuitting = true;
        stopArchivioFlowSdWatcher();
        app.quit();
      },
    },
  ]));
  archivioFlowTray.on("double-click", () => { void ensureMainWindow().then(focusMainWindow); });
}

function startArchivioFlowSdWatcher(): void {
  if (!archivioFlowWatchMode || archivioFlowSdWatchTimer) return;

  const checkForNewSd = async () => {
    try {
      const cards = await getArchivioSdCardsDesktop();
      const paths = new Set(cards.map((card) => card.path));
      const hasNewCard = [...paths].some((cardPath) => !archivioFlowKnownSdPaths.has(cardPath));
      archivioFlowKnownSdPaths = paths;
      if (hasNewCard) {
        await ensureMainWindow();
        focusMainWindow();
      }
    } catch (error) {
      writeBootLog(`Archivio Flow SD watcher error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  void checkForNewSd();
  archivioFlowSdWatchTimer = setInterval(() => { void checkForNewSd(); }, 2500);
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
      preload: join(app.getAppPath(), ".output", "electron", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow = windowInstance;
  isOpenFolderRequestRendererReady = false;
  deliveredOpenFolderPath = null;

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

  if (archivioFlowWatchMode) {
    windowInstance.on("close", (event) => {
      if (archivioFlowIsQuitting) return;
      event.preventDefault();
      windowInstance.hide();
    });
  }

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
    configureSuiteUpdater({
      currentVersion: app.getVersion(),
      enabled: requestedTool.id === "suite-launcher" && app.isPackaged && process.platform === "win32",
      allowPrerelease: resolveReleaseChannel() === "beta",
      onState: (state: DesktopSuiteUpdateState) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("filex:suite-update-state", state);
        }
      },
    });
    if (requestedTool.id === "archivio-flow" && process.platform === "win32") {
      app.setLoginItemSettings({
        openAtLogin: true,
        openAsHidden: true,
        args: ["--archivio-flow-watch"],
      });
      writeBootLog(`Archivio Flow SD watcher ${archivioFlowWatchMode ? "started in background" : "startup registration enabled"}`);
    }
    if (requestedTool.id === "archivio-flow" && archivioFlowWatchMode) {
      createArchivioFlowTray();
      startArchivioFlowSdWatcher();
    } else {
      await ensureMainWindow();
    }
    createSuiteTray();
    await createSuiteDock();
    if (requestedTool.id === "suite-launcher" && app.isPackaged) {
      const toolsToRestart = consumeFileXRestartPlan();
      for (const toolId of toolsToRestart) {
        await openInstalledTool(toolId);
      }
      setTimeout(() => { void checkSuiteUpdate(); }, 3500);
    }
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
  if (requestedTool.id === "suite-launcher") return;
  if (requestedTool.id === "archivio-flow" && archivioFlowWatchMode) return;
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.once("before-quit", () => {
  archivioFlowIsQuitting = true;
  stopArchivioFlowSdWatcher();
  archivioFlowTray?.destroy();
  archivioFlowTray = null;
  suiteTray?.destroy();
  suiteTray = null;
  suiteDockWindow?.destroy();
  suiteDockWindow = null;
  void shutdownDesktopImageService();
  shutdownDesktopStore();
});
