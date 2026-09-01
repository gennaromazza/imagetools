import * as electron from "electron";
import { activateLicense, deactivateLicense, getCheckoutConfiguration, getLicenseState } from "./license-service.js";
import type { BrowserWindow as BrowserWindowInstance, Tray as TrayInstance } from "electron";
import { execSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import {
  mkdtemp,
  readFile as readFileAsync,
  rm as rmAsync,
  stat as statAsync,
  writeFile as writeFileAsync,
} from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { basename, dirname, extname, join, parse, resolve } from "node:path";
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
  DesktopAtomicWriteFinalizeRecovery,
  DesktopAtomicWriteFile,
  DesktopDragOutCheck,
  DesktopDockState,
  DesktopEditorCandidate,
  DesktopFreeSelectionSnapshot,
  DesktopFolderCatalogAssetState,
  DesktopFolderCatalogState,
  DesktopFolderOpenOptions,
  DesktopGraphicsStatus,
  DesktopIdPhotoBackgroundRequest,
  DesktopIdPhotoWorkingCopyRequest,
  DesktopIdPhotoPrintRequest,
  DesktopLogEvent,
  DesktopPerformanceSnapshot,
  DesktopPersistedState,
  DesktopPhotoToolHandoffRequest,
  DesktopDiskCacheBudgetPreset,
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
  DesktopPsdJpegConversionRequest,
} from "@photo-tools/desktop-contracts";
import {
  copyFilesToFolderDesktop,
  moveFilesToFolderDesktop,
  listPhotoSelectorLegacyProjectsDesktop,
  openFolderDesktop,
  readFileFromDisk,
  readPhotoSelectorProjectFileDesktop,
  readSidecarXmpFromAssetPath,
  readSidecarXmpInfoFromAssetPath,
  relocatePhotoSelectorProjectFileDesktop,
  resolvePhotoSelectorProjectDesktop,
  reopenFolderDesktop,
  saveFileAsDesktop,
  shutdownNativeFolderService,
  statFilesFromDisk,
  writePhotoSelectorProjectFileDesktop,
  writeSidecarXmpForAssetPath,
} from "./native-folder-service.js";
import { AtomicOutputTransactionManager } from "./atomic-output-transaction.js";
import {
  configureDesktopImageService,
  clearDesktopImageMemoryCaches,
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
  setDiskCacheBudgetPreset,
  setThumbnailCacheDirectory,
} from "./thumbnail-disk-cache.js";
import {
  getDesktopPreferences,
  getDesktopSessionState,
  getDesktopPerformanceSnapshot,
  getFreeSelectionSnapshot,
  getFolderCatalogState,
  listFolderCatalogStatesUnderRoot,
  getRecentFolders,
  getSortCache,
  logDesktopEvent,
  recordDesktopPerformanceSnapshot,
  removeRecentFolder,
  saveDesktopPreferences,
  saveDesktopSessionState,
  saveFreeSelectionSnapshot,
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
  forceCloseToolForUpdate,
  getUpdateJob,
  listAvailableTools,
  openInstalledTool,
} from "./updater.js";
import { findDesktopToolByRuntimeToken, getDesktopToolOrDefault, getSuiteManagedTools } from "./tool-manifest.js";
import {
  checkSuiteUpdate,
  configureSuiteUpdater,
  getSuiteUpdateState,
  installSuiteUpdate,
} from "./suite-updater.js";
import { prepareFileXSuiteUpdate } from "./filex-process-coordinator.js";
import {
  connectGoogleDrive,
  disconnectGoogleDrive,
  downloadPhotoSelectorDriveVersion,
  exportPhotoSelectorProjectToDrive,
  getGoogleDriveStatus,
  listPhotoSelectorDriveVersions,
  uploadStudioFlowRegistryToDrive,
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
import {
  cancelPsdJpegConversionDesktop,
  getPsdJpegConversionProgressDesktop,
  startPsdJpegConversionDesktop,
} from "./psd-jpeg-conversion-service.js";
import {
  cleanupIdPhotoWorkingFiles,
  createIdPhotoWorkingCopy,
  resolveIdPhotoDataRoot,
} from "./id-photo-working-files.js";
import { fingerprintFilesDesktop } from "./id-photo-file-fingerprint.js";
import { createIdPhotoQuitCoordinator, createIdPhotoUnloadGuard } from "./id-photo-unload-guard.js";
import {
  printIdPhotoPagesDesktop,
  type IdPhotoPrintWindow,
} from "./id-photo-print-service.js";
import { OpenProjectRequestQueue, PhotoToolHandoffManager } from "./photo-tool-handoff.js";

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
const imagePartyFrameSessionToken = requestedTool.id === "image-party-frame"
  ? process.env.IMAGE_PARTY_FRAME_SESSION_TOKEN || randomBytes(32).toString("hex")
  : null;
if (imagePartyFrameSessionToken) {
  process.env.IMAGE_PARTY_FRAME_SESSION_TOKEN = imagePartyFrameSessionToken;
}
const shouldUseDevRenderer =
  process.env.FILEX_RENDERER_MODE === "dev" && typeof process.env.FILEX_RENDERER_URL === "string";
const appUserModelId = `studio.filex.${requestedTool.id}`;
let mainWindow: BrowserWindowInstance | null = null;
const idPhotoQuitCoordinator = createIdPhotoQuitCoordinator();
const PHOTO_SELECTOR_CLOSE_PREPARATION_TIMEOUT_MS = 20_000;
type PhotoSelectorClosePreparationState = "idle" | "pending" | "ready";
let photoSelectorClosePreparationState: PhotoSelectorClosePreparationState = "idle";
let photoSelectorClosePreparationTimer: ReturnType<typeof setTimeout> | null = null;
let photoSelectorQuitAfterPreparation = false;
let isOpenFolderRequestRendererReady = false;
let pendingOpenFolderPath: string | null = null;
let deliveredOpenFolderPath: string | null = null;
const openProjectRequests = new OpenProjectRequestQueue();
let mainWindowCreationPromise: Promise<void> | null = null;
let suiteTray: TrayInstance | null = null;
let suiteDockWindow: BrowserWindowInstance | null = null;
let photoToolHandoffManager: PhotoToolHandoffManager | null = null;

function getPhotoToolHandoffManager(): PhotoToolHandoffManager {
  if (!photoToolHandoffManager) {
    photoToolHandoffManager = new PhotoToolHandoffManager({
      storageRoot: join(app.getPath("appData"), "FileX", "photo-tool-handoffs"),
      currentToolId: requestedTool.id,
      launchTool: (toolId, launchArgs) => openInstalledTool(toolId, launchArgs),
    });
  }
  return photoToolHandoffManager;
}

function resetPhotoSelectorClosePreparation(): void {
  if (photoSelectorClosePreparationTimer) {
    clearTimeout(photoSelectorClosePreparationTimer);
    photoSelectorClosePreparationTimer = null;
  }
  photoSelectorClosePreparationState = "idle";
  photoSelectorQuitAfterPreparation = false;
}

function finishPhotoSelectorClosePreparation(reason: "renderer" | "timeout" | "send-failed"): void {
  if (requestedTool.id !== "photo-selector-app" || photoSelectorClosePreparationState !== "pending") {
    return;
  }

  if (photoSelectorClosePreparationTimer) {
    clearTimeout(photoSelectorClosePreparationTimer);
    photoSelectorClosePreparationTimer = null;
  }
  photoSelectorClosePreparationState = "ready";
  const shouldQuit = photoSelectorQuitAfterPreparation;
  const windowToClose = mainWindow;
  if (reason !== "renderer") {
    writeBootLog(`Photo Selector close preparation continued after ${reason}`);
  }

  // Let the IPC response reach the renderer before closing its WebContents.
  setTimeout(() => {
    if (shouldQuit) {
      app.quit();
      return;
    }
    if (windowToClose && !windowToClose.isDestroyed()) {
      windowToClose.destroy();
    }
  }, 0);
}

function requestPhotoSelectorClosePreparation(
  windowInstance: BrowserWindowInstance,
  quitAfterPreparation: boolean,
): boolean {
  if (
    requestedTool.id !== "photo-selector-app"
    || windowInstance !== mainWindow
    || windowInstance.isDestroyed()
    || windowInstance.webContents.isDestroyed()
  ) {
    return false;
  }

  photoSelectorQuitAfterPreparation ||= quitAfterPreparation;
  if (photoSelectorClosePreparationState === "ready") {
    return true;
  }
  if (photoSelectorClosePreparationState === "pending") {
    return true;
  }

  photoSelectorClosePreparationState = "pending";
  photoSelectorClosePreparationTimer = setTimeout(() => {
    finishPhotoSelectorClosePreparation("timeout");
  }, PHOTO_SELECTOR_CLOSE_PREPARATION_TIMEOUT_MS);
  try {
    windowInstance.webContents.send("filex:prepare-close");
  } catch {
    finishPhotoSelectorClosePreparation("send-failed");
  }
  return true;
}

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
  notificationCenterOpen: false,
  edgeAnchor: "bottom",
};

function getSuiteDockStatePath(): string {
  return join(app.getPath("userData"), "suite-dock-state.json");
}

function getIdPhotoWorkingBasePath(): string {
  // Photoshop 2026 on Windows can reject otherwise valid files stored below
  // Electron's roaming userData and Local AppData directories. Keep the
  // guarded subtree directly in the local user profile: unlike Pictures,
  // this path is not redirected by the common OneDrive Known Folder Backup
  // policy, and it has been verified with Photoshop's Windows file access.
  return resolveIdPhotoDataRoot(
    process.platform,
    app.getPath("home"),
    app.getPath("userData"),
  );
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
  const nextEdgeAnchor = typeof value?.edgeAnchor === "string"
    && (value.edgeAnchor === "left" || value.edgeAnchor === "right" || value.edgeAnchor === "bottom")
      ? value.edgeAnchor
      : defaultSuiteDockState.edgeAnchor;
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
    notificationCenterOpen: Boolean(value?.notificationCenterOpen),
    edgeAnchor: nextEdgeAnchor,
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

function applySuiteDockWindowLayout(state: DesktopDockState, animate: boolean, resetPosition = false): void {
  if (!suiteDockWindow || suiteDockWindow.isDestroyed()) return;
  const currentBounds = suiteDockWindow.getBounds();
  const display = screen.getDisplayMatching(currentBounds);
  const isBottomAnchor = state.edgeAnchor === "bottom";
  const isLeftAnchor = state.edgeAnchor === "left";
  const itemCount = Math.min(getSuiteManagedTools().length, Math.max(0, state.visibleToolCount));
  const collapsedSize = isBottomAnchor ? 88 : 76;
  const expandedWidth = isBottomAnchor
    ? Math.min(
      display.workAreaSize.width - 24,
      Math.max(220, 142 + itemCount * 62),
    )
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
  const defaultX = isBottomAnchor
    ? Math.round(centerX - width / 2)
    : isLeftAnchor
      ? display.workArea.x
      : display.workArea.x + display.workAreaSize.width - width;
  const defaultY = isBottomAnchor ? Math.round(bottom - height) : Math.round(centerY - height / 2);
  const minX = display.workArea.x;
  const maxX = display.workArea.x + display.workAreaSize.width - width;
  const minY = display.workArea.y;
  const maxY = display.workArea.y + display.workAreaSize.height - height;
  const x = isBottomAnchor
    ? Math.min(maxX, Math.max(minX, defaultX))
    : defaultX;
  const y = Math.min(maxY, Math.max(minY, defaultY));
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
      typeof partial.settingsOpen === "boolean" ||
      typeof partial.notificationCenterOpen === "boolean" ||
      typeof partial.edgeAnchor === "string")
  ) {
    const edgeChanged = typeof partial.edgeAnchor === "string" && partial.edgeAnchor !== current.edgeAnchor;
    applySuiteDockWindowLayout(next, true, edgeChanged);
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
let archivioFlowKnownSdIdentities = new Map<string, string>();
let archivioFlowIsQuitting = false;
const archivioFlowWatchMode = requestedTool.id === "archivio-flow" && process.argv.includes("--archivio-flow-watch");
let archivioFlowModulePromise: Promise<any> | null = null;
let imagePartyFrameServerModulePromise: Promise<any> | null = null;

function getArchivioFlowStartupPreferencePath(): string {
  return join(app.getPath("userData"), "archivio-flow-startup.json");
}

async function getArchivioFlowStartupPreference(): Promise<boolean | null> {
  try {
    const raw = await readFileAsync(getArchivioFlowStartupPreferencePath(), "utf8");
    const value = JSON.parse(raw) as { enabled?: unknown };
    return typeof value.enabled === "boolean" ? value.enabled : null;
  } catch {
    return null;
  }
}

async function setArchivioFlowStartupPreference(enabled: boolean): Promise<boolean> {
  await writeFileAsync(getArchivioFlowStartupPreferencePath(), `${JSON.stringify({ enabled })}\n`, "utf8");
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
    args: enabled ? ["--archivio-flow-watch"] : [],
  });
  return app.getLoginItemSettings().openAtLogin;
}

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

const atomicOutputTransactions = new AtomicOutputTransactionManager();

async function writeFilesAtomicallyDesktop(
  directoryPathInput: string,
  filesInput: DesktopAtomicWriteFile[],
  ownerId: number,
): Promise<string[]> {
  const directoryPath = resolveValidDirectoryPath(directoryPathInput);
  if (!directoryPath) throw new Error("Cartella di output non valida o non disponibile.");
  if (!Array.isArray(filesInput) || filesInput.length === 0) {
    throw new Error("Il batch di output deve contenere almeno un file.");
  }

  const transactionId = await atomicOutputTransactions.begin(directoryPath, ownerId);
  try {
    for (const input of filesInput) {
      await atomicOutputTransactions.stage(
        ownerId,
        transactionId,
        input?.fileName,
        normalizeUint8Array(input?.bytes),
      );
    }
    const savedFileNames = await atomicOutputTransactions.commit(ownerId, transactionId);
    await atomicOutputTransactions.finalize(ownerId, transactionId);
    return savedFileNames;
  } catch (error) {
    try {
      await atomicOutputTransactions.rollback(ownerId, transactionId);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Scrittura output fallita e rollback incompleto.");
    }
    throw error;
  }
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
      const modulePath = resolve(app.getAppPath(), ".output", "electron", "archivio-flow-server", "server", "index.js");
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
  volumeSerial?: string;
  filesystem?: string;
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
          volumeSerial: entry.name,
          filesystem: "unknown",
        };
      });
  }

  const archivio = await loadArchivioFlowModule();
  const result = await archivio.getSdCardsService();
  return result.sdCards;
}

async function ejectArchivioSdCardDesktop(sdPath: unknown): Promise<{ ok: boolean; message: string }> {
  if (typeof sdPath !== "string") {
    throw new Error("Percorso della SD non valido.");
  }

  const cards = await getArchivioSdCardsDesktop();
  const card = cards.find((candidate) => candidate.path.toLowerCase() === sdPath.toLowerCase());
  if (!card) {
    throw new Error("La SD da espellere non è più disponibile.");
  }

  if (process.platform !== "win32") {
    throw new Error("L'espulsione sicura è disponibile in questa versione solo su Windows.");
  }

  const driveLetter = /^[a-zA-Z]:[\\\\/]?$/.exec(card.path.trim())?.[0]?.slice(0, 1);
  if (!driveLetter) {
    throw new Error("La SD non usa un'unità Windows espellibile.");
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$shell = New-Object -ComObject Shell.Application; $item = $shell.Namespace(17).ParseName($args[0]); if ($null -eq $item) { exit 2 }; $item.InvokeVerb('Eject')",
      `${driveLetter}:`,
    ], { windowsHide: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Windows non ha espulso la SD (codice ${code ?? "sconosciuto"}).`)));
  });

  return { ok: true, message: "SD espulsa. Ora puoi rimuoverla." };
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

function deliverNextOpenProjectRequest(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    openProjectRequests.resetRenderer();
    return;
  }

  const projectPath = openProjectRequests.takeForDelivery();
  if (!projectPath) {
    return;
  }
  try {
    mainWindow.webContents.send("filex:open-project-request", projectPath);
  } catch (error) {
    openProjectRequests.resetRenderer();
    writeBootLog(`Invio open-project al renderer fallito: ${error instanceof Error ? error.message : String(error)}`);
  }
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

  openProjectRequests.enqueue(projectPath);
  deliverNextOpenProjectRequest();
}

const initialOpenFolderPath = extractOpenFolderPathFromArgv(process.argv, process.cwd());
const initialOpenProjectPath = extractOpenProjectPathFromArgv(process.argv);
const isUpdateShutdownRequest = (argv: readonly string[]): boolean =>
  argv.includes("--filex-update-shutdown");
const isPhotoSelectorPackagedSmokeTest =
  requestedTool.id === "photo-selector-app"
  && process.argv.includes("--filex-photo-selector-packaged-smoke-test");
const isIdPhotoPackagedSmokeTest =
  requestedTool.id === "id-photo"
  && process.argv.includes("--filex-id-photo-packaged-smoke-test");
const hasSingleInstanceLock = app.requestSingleInstanceLock({
  requestedToolId: requestedTool.id,
  openFolderPath: initialOpenFolderPath,
  openProjectPath: initialOpenProjectPath,
});
if (!hasSingleInstanceLock) {
  writeEarlyBootLog("Single instance lock denied, quitting");
  if (isIdPhotoPackagedSmokeTest) {
    writeEarlyBootLog("FileX ID Photo packaged smoke test aborted: single instance lock denied");
    app.exit(3);
  } else {
    app.quit();
  }
} else {
  writeEarlyBootLog("Single instance lock acquired");
  pendingOpenFolderPath = initialOpenFolderPath;
  if (initialOpenProjectPath) {
    openProjectRequests.enqueue(initialOpenProjectPath);
  }

  app.on("second-instance", (_event, argv, workingDirectory, additionalData) => {
    // La Suite usa questo comando solo dopo avere verificato che il tool e'
    // gia' in esecuzione. E' una chiusura cooperativa: l'app puo' eseguire il
    // proprio before-quit e rilasciare file e processi figli prima dell'update.
    if (isUpdateShutdownRequest(argv)) {
      app.quit();
      return;
    }
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
    deliverNextOpenProjectRequest();
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

async function launchEditorProcess(
  editorPath: string,
  absolutePaths: string[],
): Promise<DesktopSendToEditorResult> {
  const normalizedEditorPath = sanitizeDesktopPath(editorPath);
  const targetPaths = normalizeExistingAbsolutePaths(absolutePaths);

  const windowsEditorIsExecutable = process.platform !== "win32"
    || extname(normalizedEditorPath).toLocaleLowerCase() === ".exe";
  let editorPathIsUsable = false;
  try {
    if (normalizedEditorPath) {
      const editorStat = await statAsync(normalizedEditorPath);
      editorPathIsUsable = process.platform === "darwin" || editorStat.isFile();
    }
  } catch {
    editorPathIsUsable = false;
  }
  if (!normalizedEditorPath
    || !editorPathIsUsable
    || !windowsEditorIsExecutable
  ) {
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
    const child = process.platform === "darwin"
      ? spawn("open", ["-a", normalizedEditorPath, ...targetPaths], {
        detached: true,
        stdio: "ignore",
      })
      : spawn(normalizedEditorPath, targetPaths, {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      child.once("spawn", resolveSpawn);
      child.once("error", rejectSpawn);
    });
    child.unref();

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
  ipcMain.handle("filex:get-party-frame-session-token", () => imagePartyFrameSessionToken);
  ipcMain.handle("filex:complete-close-preparation", (event) => {
    if (requestedTool.id !== "photo-selector-app" || photoSelectorClosePreparationState !== "pending") {
      return;
    }
    const windowForEvent = BrowserWindow.fromWebContents(event.sender);
    if (!windowForEvent || windowForEvent !== mainWindow) {
      return;
    }
    finishPhotoSelectorClosePreparation("renderer");
  });
  ipcMain.handle("filex:get-suite-update-state", () => getSuiteUpdateState());
  ipcMain.handle("filex:check-suite-update", () => checkSuiteUpdate());
  ipcMain.handle("filex:install-suite-update", () => installSuiteUpdate());
  ipcMain.handle("filex:prepare-suite-update", () => prepareFileXSuiteUpdate());
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
  ipcMain.handle("filex:get-graphics-status", async () => {
    const features = app.getGPUFeatureStatus() as unknown as Record<string, string>;
    const gpuInfo = await app.getGPUInfo("basic").catch(() => null) as {
      gpuDevice?: Array<{ deviceString?: string }>;
      auxAttributes?: { glRenderer?: string };
    } | null;
    const gpuCompositing = features.gpu_compositing ?? "unknown";
    const webgl = features.webgl ?? "unknown";
    const isAccelerated = (status: string) => status.startsWith("enabled");
    const payload: DesktopGraphicsStatus = {
      hardwareAccelerationEnabled:
        !app.commandLine.hasSwitch("disable-gpu")
        && (isAccelerated(gpuCompositing) || isAccelerated(webgl)),
      gpuCompositing,
      webgl,
      rasterization: features.rasterization ?? "unknown",
      videoDecode: features.video_decode ?? "unknown",
      deviceName: gpuInfo?.gpuDevice?.find((device) => device.deviceString)?.deviceString
        ?? gpuInfo?.auxAttributes?.glRenderer
        ?? null,
    };
    writeBootLog(
      `GPU status accelerated=${payload.hardwareAccelerationEnabled} compositing=${gpuCompositing} webgl=${webgl} raster=${payload.rasterization} device=${payload.deviceName ?? "unknown"}`,
    );
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
  ipcMain.handle("filex:force-close-tool-for-update", async (_event, toolId: DesktopToolId) =>
    forceCloseToolForUpdate(toolId));
  ipcMain.handle(
    "filex:open-installed-tool",
    async (_event, toolId: DesktopToolId, launchArgs?: string[]) => openInstalledTool(toolId, launchArgs),
  );
  ipcMain.handle(
    "filex:send-photo-selection-to-tool",
    async (_event, request: DesktopPhotoToolHandoffRequest) =>
      getPhotoToolHandoffManager().sendPhotoSelectionToTool(request),
  );
  ipcMain.handle(
    "filex:consume-photo-selection-handoff",
    async (_event, projectPath: string) =>
      getPhotoToolHandoffManager().consumePhotoSelectionHandoff(projectPath),
  );
  ipcMain.handle("filex:get-license-state", (_event, refresh?: boolean) => getLicenseState(Boolean(refresh)));
  ipcMain.handle("filex:activate-license", (_event, licenseKey: string, deviceLabel?: string) =>
    activateLicense(licenseKey, deviceLabel));
  ipcMain.handle("filex:deactivate-license", () => deactivateLicense());
  ipcMain.handle("filex:open-license-checkout", async (_event, billingPeriod: "monthly" | "annual") => {
    const checkout = await getCheckoutConfiguration();
    const destination = checkout[billingPeriod] ?? "https://filex-suite.web.app/#prezzi";
    await shell.openExternal(destination);
  });
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
  ipcMain.handle("filex:consume-pending-open-project-path", (event) => {
    const windowForEvent = BrowserWindow.fromWebContents(event.sender);
    if (!windowForEvent || windowForEvent !== mainWindow) {
      return null;
    }
    return openProjectRequests.consumePending();
  });
  ipcMain.handle("filex:acknowledge-open-project-request", (event, projectPath: string) => {
    const windowForEvent = BrowserWindow.fromWebContents(event.sender);
    if (!windowForEvent || windowForEvent !== mainWindow || typeof projectPath !== "string") {
      return;
    }
    if (openProjectRequests.acknowledge(sanitizeDesktopPath(projectPath))) {
      deliverNextOpenProjectRequest();
    }
  });
  ipcMain.handle("filex:mark-open-project-request-ready", (event) => {
    const windowForEvent = BrowserWindow.fromWebContents(event.sender);
    if (!windowForEvent || windowForEvent !== mainWindow) {
      return;
    }

    openProjectRequests.markRendererReady();
    deliverNextOpenProjectRequest();
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
    "filex:create-id-photo-working-copy",
    (_event, request: DesktopIdPhotoWorkingCopyRequest) =>
      createIdPhotoWorkingCopy(getIdPhotoWorkingBasePath(), request),
  );
  ipcMain.handle(
    "filex:cleanup-id-photo-working-files",
    (_event, jobId: string) => cleanupIdPhotoWorkingFiles(getIdPhotoWorkingBasePath(), jobId),
  );
  if (requestedTool.id === "id-photo") {
    ipcMain.handle(
      "filex:process-id-photo-background",
      async (_event, request: DesktopIdPhotoBackgroundRequest) => {
        const { processIdPhotoBackground } = await import("./id-photo-background-service.js");
        return processIdPhotoBackground(getIdPhotoWorkingBasePath(), request);
      },
    );
  }
  ipcMain.handle("filex:list-id-photo-printers", async (event) => {
    const printers = await event.sender.getPrintersAsync();
    return printers.map((printer) => ({
      name: printer.name,
      displayName: printer.displayName || printer.name,
      description: printer.description || "",
    }));
  });
  ipcMain.handle(
    "filex:print-id-photo-pages",
    (_event, request: DesktopIdPhotoPrintRequest) => printIdPhotoPagesDesktop(request, () => new BrowserWindow({
      show: false,
      width: 900,
      height: 700,
      autoHideMenuBar: true,
      backgroundColor: "#ffffff",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    }) as unknown as IdPhotoPrintWindow),
  );
  ipcMain.handle("filex:stat-files", (_event, absolutePaths: string[]) => statFilesFromDisk(absolutePaths));
  ipcMain.handle("filex:fingerprint-files", (_event, absolutePaths: string[]) => fingerprintFilesDesktop(absolutePaths));
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
  ipcMain.handle("filex:choose-thumbnail-cache-directory", async () => {
    const info = await chooseThumbnailCacheDirectory();
    return info ? { ...info, ...getDesktopImageCacheLimits() } : null;
  });
  ipcMain.handle("filex:set-thumbnail-cache-directory", async (_event, directoryPath: string) => ({
    ...await setThumbnailCacheDirectory(directoryPath),
    ...getDesktopImageCacheLimits(),
  }));
  ipcMain.handle("filex:reset-thumbnail-cache-directory", async () => ({
    ...await resetThumbnailCacheDirectory(),
    ...getDesktopImageCacheLimits(),
  }));
  ipcMain.handle("filex:clear-thumbnail-cache", async () => {
    const cleared = await clearThumbnailCacheDirectory();
    if (cleared) {
      clearDesktopImageMemoryCaches();
    }
    return cleared;
  });
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
  ipcMain.handle("filex:set-disk-cache-budget-preset", async (_event, preset: DesktopDiskCacheBudgetPreset) => ({
    ...await setDiskCacheBudgetPreset(preset),
    ...getDesktopImageCacheLimits(),
  }));
  ipcMain.handle("filex:relaunch", () => {
    app.relaunch();
    app.quit();
  });
  ipcMain.handle("filex:get-cache-location-recommendation", () => getCacheLocationRecommendation());
  ipcMain.handle("filex:migrate-thumbnail-cache-directory", async (_event, directoryPath: string) => {
    const result = await migrateThumbnailCacheDirectory(directoryPath);
    return result.cacheInfo
      ? { ...result, cacheInfo: { ...result.cacheInfo, ...getDesktopImageCacheLimits() } }
      : result;
  });
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
      filters: process.platform === "win32"
        ? [{ name: "Applicazioni Windows", extensions: ["exe"] }]
        : [{ name: "Applicazioni", extensions: ["app"] }, { name: "Tutti i file", extensions: ["*"] }],
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
  ipcMain.handle("filex:start-psd-jpeg-conversion", (_event, request: DesktopPsdJpegConversionRequest) =>
    startPsdJpegConversionDesktop(request),
  );
  ipcMain.handle("filex:get-psd-jpeg-conversion-progress", () =>
    getPsdJpegConversionProgressDesktop(),
  );
  ipcMain.handle("filex:cancel-psd-jpeg-conversion", () => {
    cancelPsdJpegConversionDesktop();
  });
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
    const result = await launchEditorProcess(editorPath, absolutePaths);
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
        { name: "Immagini", extensions: ["jpg", "jpeg", "png", "webp", "heic", "heif", "tif", "tiff", "psd"] },
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
  ipcMain.handle("filex:get-desktop-preferences", async () => ({
    ...(await getDesktopPreferences()),
    ramBudgetPreset: await loadRamBudgetPreset(),
  }));
  ipcMain.handle("filex:save-desktop-preferences", async (_event, preferences: DesktopPhotoSelectorPreferences) =>
    saveDesktopPreferences({
      ...preferences,
      // The native image service owns this setting. Do not let an unrelated
      // UI preference save overwrite the preset that is actually in use.
      ramBudgetPreset: await loadRamBudgetPreset(),
    }),
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
  ipcMain.handle("filex:get-free-selection-snapshot", (_event, sourceId: string) =>
    getFreeSelectionSnapshot(sourceId),
  );
  ipcMain.handle("filex:save-free-selection-snapshot", (_event, snapshot: DesktopFreeSelectionSnapshot) =>
    saveFreeSelectionSnapshot(snapshot),
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
  ipcMain.handle(
    "filex:write-files-atomically",
    (event, directoryPath: string, files: DesktopAtomicWriteFile[]) =>
      writeFilesAtomicallyDesktop(directoryPath, files, event.sender.id),
  );
  ipcMain.handle("filex:begin-atomic-write-transaction", async (event, directoryPathInput: string) => {
    const directoryPath = resolveValidDirectoryPath(directoryPathInput);
    if (!directoryPath) throw new Error("Cartella di output non valida o non disponibile.");
    return atomicOutputTransactions.begin(directoryPath, event.sender.id);
  });
  ipcMain.handle(
    "filex:stage-atomic-write-transaction-file",
    (event, transactionId: string, file: DesktopAtomicWriteFile) =>
      atomicOutputTransactions.stage(
        event.sender.id,
        transactionId,
        file?.fileName,
        normalizeUint8Array(file?.bytes),
      ),
  );
  ipcMain.handle("filex:commit-atomic-write-transaction", (event, transactionId: string) =>
    atomicOutputTransactions.commit(event.sender.id, transactionId),
  );
  ipcMain.handle(
    "filex:finalize-atomic-write-transaction",
    (event, transactionId: string, recovery?: DesktopAtomicWriteFinalizeRecovery) =>
      atomicOutputTransactions.finalize(event.sender.id, transactionId, recovery),
  );
  ipcMain.handle("filex:rollback-atomic-write-transaction", (event, transactionId: string) =>
    atomicOutputTransactions.rollback(event.sender.id, transactionId),
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
  ipcMain.handle("filex:read-sidecar-xmp-info", (_event, absolutePath: string) =>
    readSidecarXmpInfoFromAssetPath(absolutePath),
  );
  ipcMain.handle("filex:write-sidecar-xmp", (_event, absolutePath: string, xml: string) =>
    writeSidecarXmpForAssetPath(absolutePath, xml),
  );
  ipcMain.handle("filex:browse-archivio-folder", () => browseArchivioFolderDesktop());
  ipcMain.handle("filex:notify-backup-guard-project", (_event, notification: unknown) => {
    if (!notification || typeof notification !== "object") return { ok: false };
    const candidate = notification as Record<string, unknown>;
    if (candidate.schemaVersion !== 1 || typeof candidate.eventId !== "string" || typeof candidate.projectId !== "string" || typeof candidate.absolutePath !== "string") return { ok: false };
    const sharedDirectory = join(app.getPath("appData"), "FileX", "shared");
    mkdirSync(sharedDirectory, { recursive: true });
    appendFileSync(join(sharedDirectory, "backup-guard-inbox.jsonl"), `${JSON.stringify(candidate)}\n`, "utf8");
    return { ok: true };
  });
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
  ipcMain.handle("filex:eject-archivio-sd-card", async (_event, sdPath: unknown) => await ejectArchivioSdCardDesktop(sdPath));
  ipcMain.handle("filex:show-archivio-flow-window", async () => {
    await ensureMainWindow();
    focusMainWindow();
    return { ok: true as const };
  });
  ipcMain.handle("filex:get-archivio-sd-preview", async (_event, sdPath: string) => {
    const archivio = await loadArchivioFlowModule();
    return await archivio.getSdPreviewService(sdPath);
  });
  ipcMain.handle("filex:check-archivio-safe-to-format", async (_event, sdPath: string) => {
    const archivio = await loadArchivioFlowModule();
    return await archivio.checkSafeToFormatService(sdPath);
  });
  ipcMain.handle("filex:get-archivio-studioflow-status", async () => {
    const archivio = await loadArchivioFlowModule();
    return await archivio.getStudioFlowStatusService();
  });
  ipcMain.handle("filex:reconcile-archivio-index", async () => {
    const archivio = await loadArchivioFlowModule();
    return await archivio.reconcileArchiveIndexService();
  });
  ipcMain.handle("filex:resume-archivio-import", async (_event, sessionId: string) => {
    const archivio = await loadArchivioFlowModule();
    return await archivio.resumeImportService(sessionId);
  });
  ipcMain.handle("filex:sync-archivio-drive-registry", async () => {
    const archivio = await loadArchivioFlowModule();
    const batch = await archivio.getDriveRegistryBatchService();
    const ids = batch.outbox.map((item: { id: number }) => item.id);
    if (ids.length === 0) return { ok: true, syncedEvents: 0, message: "Registro già sincronizzato" };
    try {
      const uploaded = await uploadStudioFlowRegistryToDrive(batch);
      archivio.completeDriveRegistrySyncService(ids);
      return {
        ok: true,
        syncedEvents: ids.length,
        message: `Registro caricato: ${uploaded.fileName}`,
        driveUrl: uploaded.driveUrl,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      archivio.completeDriveRegistrySyncService(ids, message);
      throw error;
    }
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
  ipcMain.handle("filex:get-archivio-start-at-login", async () => {
    const preference = await getArchivioFlowStartupPreference();
    return preference ?? app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle("filex:set-archivio-start-at-login", async (_event, enabled: boolean) => {
    if (typeof enabled !== "boolean") throw new Error("Valore avvio automatico non valido");
    return await setArchivioFlowStartupPreference(enabled);
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
  ipcMain.handle("filex:get-archivio-archive-rename-progress", async () => {
    const archivio = await loadArchivioFlowModule();
    return archivio.getArchiveRenameProgressService();
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
  ipcMain.handle("filex:list-archivio-job-subfolders", async (_event, jobId: string, author?: string) => {
    const archivio = await loadArchivioFlowModule();
    return await archivio.listJobSubfoldersService(jobId, author);
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

type IdPhotoPackagedSmokeResult = {
  fingerprints?: Array<{
    absolutePath?: unknown;
    size?: unknown;
    sha256?: unknown;
  }>;
  committedPaths?: unknown;
  rollbackResult?: unknown;
};

async function runIdPhotoPackagedSmokeTest(): Promise<void> {
  const smokeRoot = await mkdtemp(join(app.getPath("temp"), "filex-id-photo-packaged-smoke-"));
  const fingerprintBytes = Buffer.from("FileX ID Photo packaged preload fingerprint smoke\n", "utf8");
  const transactionBytes = Buffer.from("FileX ID Photo packaged IPC transaction smoke\n", "utf8");
  const fingerprintPath = join(smokeRoot, "fingerprint-source.bin");
  const committedFileName = "transaction-committed.bin";
  const rolledBackFileName = "transaction-rolled-back.bin";
  const preloadPath = join(app.getAppPath(), ".output", "electron", "preload.js");
  let smokeWindow: BrowserWindowInstance | null = null;
  let smokeTimeout: ReturnType<typeof setTimeout> | null = null;
  let rendererOwnerId: number | null = null;

  try {
    if (!existsSync(preloadPath)) {
      throw new Error(`Preload ID Photo impacchettato non trovato: ${preloadPath}`);
    }
    const rendererEntryPath = resolveRendererEntry();
    if (!existsSync(rendererEntryPath)) {
      throw new Error(`Renderer ID Photo impacchettato non trovato: ${rendererEntryPath}`);
    }
    await writeFileAsync(fingerprintPath, fingerprintBytes);

    smokeWindow = new BrowserWindow({
      show: false,
      width: 320,
      height: 240,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    rendererOwnerId = smokeWindow.webContents.id;

    const smokeScript = `
      (async () => {
        const api = window.filexDesktop;
        const requiredMethods = [
          "fingerprintFiles",
          "beginAtomicWriteTransaction",
          "stageAtomicWriteTransactionFile",
          "commitAtomicWriteTransaction",
          "finalizeAtomicWriteTransaction",
          "rollbackAtomicWriteTransaction",
        ];
        const missingMethods = requiredMethods.filter((name) => typeof api?.[name] !== "function");
        if (missingMethods.length > 0) {
          throw new Error(\`Preload API mancanti: \${missingMethods.join(", ")}\`);
        }

        const fingerprints = await api.fingerprintFiles([${JSON.stringify(fingerprintPath)}]);
        const commitTransactionId = await api.beginAtomicWriteTransaction(${JSON.stringify(smokeRoot)});
        await api.stageAtomicWriteTransactionFile(commitTransactionId, {
          fileName: ${JSON.stringify(committedFileName)},
          bytes: new Uint8Array(${JSON.stringify(Array.from(transactionBytes))}),
        });
        const committedPaths = await api.commitAtomicWriteTransaction(commitTransactionId);
        await api.finalizeAtomicWriteTransaction(commitTransactionId);

        const rollbackTransactionId = await api.beginAtomicWriteTransaction(${JSON.stringify(smokeRoot)});
        await api.stageAtomicWriteTransactionFile(rollbackTransactionId, {
          fileName: ${JSON.stringify(rolledBackFileName)},
          bytes: new Uint8Array([1, 2, 3, 4]),
        });
        const rollbackResult = await api.rollbackAtomicWriteTransaction(rollbackTransactionId);
        return { fingerprints, committedPaths, rollbackResult };
      })()
    `;

    const smokeOperation = (async () => {
      await loadRenderer(smokeWindow!);
      const rendererReady = await smokeWindow!.webContents.executeJavaScript(`
        Boolean(
          document.getElementById("root")?.children.length
          && Array.from(document.querySelectorAll("strong")).some((node) => node.textContent?.includes("FileX ID Photo"))
        )
      `, true);
      if (!rendererReady) {
        throw new Error("Il renderer distribuito di FileX ID Photo non ha completato il bootstrap.");
      }
      return smokeWindow!.webContents.executeJavaScript(smokeScript, true);
    })();
    const timeoutOperation = new Promise<never>((_resolve, reject) => {
      smokeTimeout = setTimeout(() => {
        reject(new Error("Timeout durante lo smoke test packaged di preload e IPC ID Photo."));
      }, 20_000);
    });
    const result = await Promise.race([smokeOperation, timeoutOperation]) as IdPhotoPackagedSmokeResult;

    const fingerprint = Array.isArray(result.fingerprints) ? result.fingerprints[0] : null;
    const expectedSha256 = createHash("sha256").update(fingerprintBytes).digest("hex");
    if (
      result.fingerprints?.length !== 1
      || fingerprint?.absolutePath !== resolve(fingerprintPath)
      || fingerprint?.size !== fingerprintBytes.byteLength
      || fingerprint?.sha256 !== expectedSha256
    ) {
      throw new Error("Lo smoke packaged non ha verificato correttamente fingerprint e SHA-256 via preload IPC.");
    }

    if (!Array.isArray(result.committedPaths) || result.committedPaths.length !== 1) {
      throw new Error("Lo smoke packaged non ha confermato la transazione atomica via preload IPC.");
    }
    if (result.committedPaths[0] !== committedFileName) {
      throw new Error("La transazione smoke ha restituito un nome finale inatteso.");
    }
    const committedPath = resolve(smokeRoot, committedFileName);
    const committedBytes = await readFileAsync(committedPath);
    if (!committedBytes.equals(transactionBytes)) {
      throw new Error("La transazione smoke ha pubblicato byte diversi da quelli inviati dal preload.");
    }
    if (result.rollbackResult !== true || existsSync(join(smokeRoot, rolledBackFileName))) {
      throw new Error("Lo smoke packaged non ha completato il rollback della transazione via preload IPC.");
    }
  } finally {
    if (smokeTimeout) clearTimeout(smokeTimeout);
    if (rendererOwnerId !== null) {
      try {
        await atomicOutputTransactions.rollbackOwner(rendererOwnerId);
      } catch (error) {
        writeBootLog(`ID Photo packaged smoke rollback cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (smokeWindow && !smokeWindow.isDestroyed()) {
      smokeWindow.destroy();
    }
    await rmAsync(smokeRoot, { recursive: true, force: true }).catch((error) => {
      writeBootLog(`ID Photo packaged smoke temp cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
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
  const isBottomAnchor = dockState.edgeAnchor === "bottom";
  const isLeftAnchor = dockState.edgeAnchor === "left";
  const itemCount = Math.min(getSuiteManagedTools().length, Math.max(0, dockState.visibleToolCount));
  const width = dockState.collapsed ? (isBottomAnchor ? 88 : 76) : isBottomAnchor
    ? Math.min(display.workAreaSize.width - 24, Math.max(220, 142 + itemCount * 62))
    : dockState.settingsOpen || dockState.notificationCenterOpen ? 380 : 82;
  const height = dockState.collapsed ? (isBottomAnchor ? 88 : 76) : isBottomAnchor
    ? (dockState.notificationCenterOpen ? 420 : dockState.settingsOpen ? 220 : 100)
    : Math.min(display.workAreaSize.height - 30, Math.max(dockState.notificationCenterOpen ? 340 : 220, 132 + itemCount * 62 + (dockState.settingsOpen ? 70 : 0)));
  const defaultX = isBottomAnchor
    ? Math.round(display.workArea.x + (display.workAreaSize.width - width) / 2)
    : isLeftAnchor
      ? display.workArea.x
      : display.workArea.x + display.workAreaSize.width - width;
  const defaultY = isBottomAnchor
    ? display.workArea.y + display.workAreaSize.height - height - 18
    : Math.round(display.workArea.y + (display.workAreaSize.height - height) / 2);
  suiteDockWindow = new BrowserWindow({
    width,
    height,
    x: isBottomAnchor ? dockState.x || defaultX : defaultX,
    y: dockState.y || defaultY,
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
  if (requestedTool.id !== "archivio-flow" || archivioFlowTray) return;

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
  if (requestedTool.id !== "archivio-flow" || archivioFlowSdWatchTimer) return;

  const checkForNewSd = async () => {
    try {
      const cards = await getArchivioSdCardsDesktop();
      const identities = new Map(cards.map((card) => [
        card.path,
        `${card.path.toLowerCase()}|${card.volumeSerial ?? ""}|${card.deviceId}|${card.volumeName}`,
      ]));
      const hasNewCard = [...identities].some(([cardPath, identity]) => archivioFlowKnownSdIdentities.get(cardPath) !== identity);
      archivioFlowKnownSdIdentities = identities;
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
  const windowTitle = `${requestedTool.productName} — Versione ${app.getVersion()}`;
  const windowInstance = new BrowserWindow({
    title: windowTitle,
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
  if (requestedTool.id === "photo-selector-app") {
    resetPhotoSelectorClosePreparation();
  }
  isOpenFolderRequestRendererReady = false;
  deliveredOpenFolderPath = null;
  openProjectRequests.resetRenderer();
  const rendererOwnerId = windowInstance.webContents.id;
  const idPhotoUnloadGuard = createIdPhotoUnloadGuard();

  windowInstance.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  windowInstance.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      writeBootLog(
        `Renderer load failed: ${errorDescription} (code ${errorCode}) url=${validatedURL}`,
      );
    },
  );
  windowInstance.webContents.on("preload-error", (_event, preloadPath, error) => {
    writeBootLog(`Preload failed ${preloadPath}: ${error.message}`);
  });
  windowInstance.on("unresponsive", () => {
    writeBootLog("Main window became unresponsive");
  });
  windowInstance.webContents.on("console-message", (details) => {
    if (details.level !== "warning" && details.level !== "error") return;
    writeBootLog(
      `Renderer console ${details.level}: ${details.message}`
      + `${details.sourceId ? ` (${details.sourceId}:${details.lineNumber})` : ""}`,
    );
  });

  windowInstance.on("page-title-updated", (event) => {
    event.preventDefault();
    windowInstance.setTitle(windowTitle);
  });

  windowInstance.webContents.on("will-prevent-unload", (event) => {
    if (requestedTool.id === "photo-selector-app") {
      if (photoSelectorClosePreparationState === "ready") {
        // Electron otherwise honours the renderer's beforeunload cancellation.
        event.preventDefault();
        return;
      }
      if (requestPhotoSelectorClosePreparation(windowInstance, false)) {
        // Keep the window alive while the renderer flushes XMP and local state.
        return;
      }
    }
    if (requestedTool.id === "id-photo") {
      // Do not call preventDefault here: in Electron that would override the
      // renderer's cancellation and discard the unsaved local state.
      idPhotoUnloadGuard.handlePreventedUnload({
        requestDecision: async () => {
          const { response } = await dialog.showMessageBox(windowInstance, {
            type: "warning",
            title: "Modifiche non salvate",
            message: "FileX ID Photo non è riuscito a salvare tutte le modifiche.",
            detail: "Resta nell’app e usa “Riprova salvataggio”. Se chiudi comunque, le modifiche non ancora salvate andranno perse.",
            buttons: ["Resta e salva", "Chiudi comunque"],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          if (response !== 1) {
            idPhotoQuitCoordinator.cancelPendingQuit();
          }
          return response === 1 ? "close-anyway" : "stay";
        },
        closeAnyway: () => {
          if (!windowInstance.isDestroyed()) {
            windowInstance.destroy();
          }
        },
        onError: (error) => {
          idPhotoQuitCoordinator.cancelPendingQuit();
          writeBootLog(`ID Photo unsaved changes dialog error: ${error instanceof Error ? error.message : String(error)}`);
        },
      });
      return;
    }
    event.preventDefault();
    windowInstance.destroy();
  });

  windowInstance.webContents.on("render-process-gone", (_event, details) => {
    openProjectRequests.resetRenderer();
    writeBootLog(`Renderer process gone: ${details.reason}${details.exitCode ? ` (code ${details.exitCode})` : ""}`);
    logDesktopEvent({
      channel: "renderer",
      level: "error",
      message: "Renderer process terminato",
      details: `${details.reason}${details.exitCode ? ` (code ${details.exitCode})` : ""}`,
    });
    void atomicOutputTransactions.rollbackOwner(rendererOwnerId).catch((error) => {
      writeBootLog(`Rollback output renderer incompleto: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  windowInstance.webContents.on("did-start-loading", () => {
    if (mainWindow === windowInstance) {
      openProjectRequests.resetRenderer();
    }
  });

  await loadRenderer(windowInstance);

  if (!app.isPackaged) {
    try {
      const rendererState = await windowInstance.webContents.executeJavaScript(`({
        href: window.location.href,
        readyState: document.readyState,
        rootChildren: document.getElementById("root")?.children.length ?? -1,
        bodyChildren: document.body?.children.length ?? -1,
      })`, true) as {
        href?: unknown;
        readyState?: unknown;
        rootChildren?: unknown;
        bodyChildren?: unknown;
      };
      writeBootLog(
        `Renderer ready href=${String(rendererState.href)} state=${String(rendererState.readyState)}`
        + ` rootChildren=${String(rendererState.rootChildren)} bodyChildren=${String(rendererState.bodyChildren)}`,
      );
    } catch (error) {
      writeBootLog(`Renderer readiness probe failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  windowInstance.setTitle(windowTitle);
  writeBootLog("Main window created");

  if (!app.isPackaged) {
    windowInstance.webContents.openDevTools({ mode: "detach" });
  }

  windowInstance.on("closed", () => {
    writeBootLog("Main window closed");
    void atomicOutputTransactions.rollbackOwner(rendererOwnerId).catch((error) => {
      writeBootLog(`Rollback output finestra incompleto: ${error instanceof Error ? error.message : String(error)}`);
    });
    if (mainWindow === windowInstance) {
      mainWindow = null;
    }
    if (requestedTool.id === "photo-selector-app") {
      resetPhotoSelectorClosePreparation();
    }
    if (requestedTool.id === "id-photo" && idPhotoQuitCoordinator.hasPendingQuit()) {
      setTimeout(() => {
        if (idPhotoQuitCoordinator.consumePendingQuitAfterWindowClosed()) {
          app.quit();
        }
      }, 0);
    }
    isOpenFolderRequestRendererReady = false;
    openProjectRequests.resetRenderer();
  });

  if (requestedTool.id === "archivio-flow") {
    windowInstance.on("close", (event) => {
      if (archivioFlowIsQuitting) return;
      event.preventDefault();
      windowInstance.hide();
    });
  }

  if (pendingOpenFolderPath || openProjectRequests.peek()) {
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
    if (isPhotoSelectorPackagedSmokeTest) {
      writeBootLog("Image Select Pro packaged smoke test passed");
      app.exit(0);
      return;
    }
    if (requestedTool.id !== "suite-launcher" && !isIdPhotoPackagedSmokeTest) {
      const license = await getLicenseState();
      if (!license.canUseTools) {
        dialog.showErrorBox("FileX All Access", "La licenza FileX non e' attiva. Apri FileX Suite per attivarla o aggiornare il pagamento.");
        app.quit();
        return;
      }
    }
    // Apply the persisted RAM budget before registering IPC handlers so that
    // the cache limits are already in effect when the first thumbnail request arrives.
    const savedPreset = await loadRamBudgetPreset();
    configureDesktopImageService(savedPreset);

    if (requestedTool.id === "image-party-frame" && !shouldUseDevRenderer) {
      await ensureImagePartyFrameServer();
    }

    enforceUtf8CharsetOnTextResponses();
    registerPreviewProtocol();
    registerCrashTelemetryHandlers();
    registerIpcHandlers();
    if (isIdPhotoPackagedSmokeTest) {
      await runIdPhotoPackagedSmokeTest();
      writeBootLog("FileX ID Photo packaged preload and IPC smoke test passed");
      app.exit(0);
      return;
    }
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
      const startupPreference = await getArchivioFlowStartupPreference();
      const startupEnabled = startupPreference ?? true;
      if (startupPreference === null) {
        await setArchivioFlowStartupPreference(true);
      } else {
        app.setLoginItemSettings({
          openAtLogin: startupEnabled,
          openAsHidden: true,
          args: startupEnabled ? ["--archivio-flow-watch"] : [],
        });
      }
      writeBootLog(`Archivio Flow SD watcher ${archivioFlowWatchMode ? "started in background" : startupEnabled ? "startup registration enabled" : "startup registration disabled"}`);
    }
    if (requestedTool.id === "archivio-flow" && archivioFlowWatchMode) {
      createArchivioFlowTray();
      startArchivioFlowSdWatcher();
    } else {
      await ensureMainWindow();
    }
    if (requestedTool.id === "archivio-flow") {
      createArchivioFlowTray();
      startArchivioFlowSdWatcher();
    }
    createSuiteTray();
    await createSuiteDock();
    if (requestedTool.id === "suite-launcher" && app.isPackaged) {
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
  if (requestedTool.id === "archivio-flow") return;
  if (isIdPhotoPackagedSmokeTest) return;
  if (requestedTool.id === "id-photo" && idPhotoQuitCoordinator.hasPendingQuit()) return;
  if (process.platform !== "darwin") {
    app.quit();
  }
});

const NATIVE_SHUTDOWN_TIMEOUT_MS = 10_000;
let nativeShutdownStarted = false;
let nativeShutdownCompleted = false;

app.on("before-quit", (event) => {
  if (nativeShutdownCompleted) {
    return;
  }

  if (
    requestedTool.id === "photo-selector-app"
    && mainWindow
    && !mainWindow.isDestroyed()
    && photoSelectorClosePreparationState !== "ready"
    && requestPhotoSelectorClosePreparation(mainWindow, true)
  ) {
    event.preventDefault();
    return;
  }

  if (requestedTool.id === "id-photo") {
    const hasOpenWindow = Boolean(mainWindow && !mainWindow.isDestroyed());
    if (idPhotoQuitCoordinator.handleBeforeQuit(hasOpenWindow) === "close-window-first") {
      event.preventDefault();
      try {
        mainWindow?.close();
      } catch (error) {
        idPhotoQuitCoordinator.cancelPendingQuit();
        writeBootLog(`ID Photo close before native shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
  }

  event.preventDefault();
  if (nativeShutdownStarted) {
    return;
  }
  nativeShutdownStarted = true;

  archivioFlowIsQuitting = true;
  stopArchivioFlowSdWatcher();
  archivioFlowTray?.destroy();
  archivioFlowTray = null;
  suiteTray?.destroy();
  suiteTray = null;
  suiteDockWindow?.destroy();
  suiteDockWindow = null;

  const nativeShutdown = Promise.allSettled([
    atomicOutputTransactions.rollbackAll(),
    shutdownDesktopImageService(),
    shutdownNativeFolderService(),
  ]);
  const timeout = new Promise<void>((resolve) => {
    setTimeout(resolve, NATIVE_SHUTDOWN_TIMEOUT_MS);
  });

  void Promise.race([nativeShutdown, timeout]).finally(() => {
    shutdownDesktopStore();
    nativeShutdownCompleted = true;
    app.quit();
  });
});
