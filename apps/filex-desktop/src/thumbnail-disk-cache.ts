import * as electron from "electron";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join, parse, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  DesktopCachedThumbnail,
  DesktopCacheLocationRecommendation,
  DesktopCacheMigrationResult,
  DesktopDiskCacheBudgetPreset,
  DesktopRamBudgetPreset,
  DesktopRenderedImage,
  DesktopStorageVolumeInfo,
  DesktopThumbnailCacheInfo,
  DesktopThumbnailCacheLookupEntry,
} from "@photo-tools/desktop-contracts";
import {
  AsyncReadWriteGate,
  getDiskCacheBudgetBytes,
  normalizeDiskCacheBudgetPreset,
  selectDiskCacheEntriesToPrune,
  type DiskCacheEntryStat,
} from "./thumbnail-cache-policy.js";

const { app, dialog } = electron;

interface DesktopShellSettings {
  thumbnailCacheDirectory?: string;
  cacheLocationRecommendationDismissed?: boolean;
  cacheLocationRecommendationDismissedAt?: string;
  cacheLocationRecommendationLastPromptedAt?: string;
  ramBudgetPreset?: DesktopRamBudgetPreset;
  diskCacheBudgetPreset?: DesktopDiskCacheBudgetPreset;
}

interface WindowsLogicalDiskRow {
  DeviceID?: string;
  VolumeName?: string;
  Size?: string | number;
  FreeSpace?: string | number;
  DriveType?: string | number;
}

const SETTINGS_FILE_NAME = "desktop-settings.json";
const DEVELOPMENT_SETTINGS_FILE_NAME = "desktop-settings.dev.json";
const CACHE_FILE_EXTENSION = ".thumb";
const PREVIEW_CACHE_FILE_EXTENSION = ".preview";
const CACHE_VERSION = "v2";
const PREVIEW_CACHE_VERSION = "preview-v1";
const CACHE_LOOKUP_CONCURRENCY = 24;
const LOW_SPACE_FREE_BYTES_THRESHOLD = 15 * 1024 * 1024 * 1024;
const LOW_SPACE_FREE_RATIO_THRESHOLD = 0.1;
const RECOMMENDED_TARGET_FREE_BYTES_THRESHOLD = 50 * 1024 * 1024 * 1024;
const RECOMMENDED_FREE_SPACE_MULTIPLIER = 3;
const POWERSHELL_MAX_BUFFER_BYTES = 1024 * 1024;
const CACHE_WRITE_CONCURRENCY = 2;
const CACHE_STATS_CONCURRENCY = 16;
const CACHE_PRUNE_CONCURRENCY = 4;
const CACHE_PRUNE_MIN_INTERVAL_MS = 60_000;
const CACHE_PRUNE_IDLE_DELAY_MS = 5_000;
const CACHE_PRUNE_TARGET_RATIO = 0.9;
const CACHE_SUMMARY_MAX_AGE_MS = 5_000;
const CACHE_ACCESS_TOUCH_MIN_INTERVAL_MS = 250;
const execFileAsync = promisify(execFile);

let settingsCache: DesktopShellSettings | null = null;
let activeCacheDirectoryPromise: Promise<{
  currentPath: string;
  defaultPath: string;
  usesCustomPath: boolean;
}> | null = null;
let cacheSummaryCache: {
  directoryPath: string;
  entryCount: number;
  totalBytes: number;
  cachedAt: number;
} | null = null;
let cachePruneTimer: NodeJS.Timeout | null = null;
let lastCachePruneAt = 0;
let lastCacheEntryTouchAt = 0;

function usesDevelopmentCache(): boolean {
  return !app.isPackaged && process.env.FILEX_RENDERER_MODE === "dev";
}

class AsyncSemaphore {
  private active = 0;
  private queue: Array<() => void> = [];
  private readonly concurrency: number;

  constructor(concurrency: number) {
    this.concurrency = Math.max(1, concurrency);
  }

  async run<T>(task: () => Promise<T> | T): Promise<T> {
    if (this.active >= this.concurrency) {
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }

    this.active += 1;
    try {
      return await task();
    } finally {
      this.active = Math.max(0, this.active - 1);
      const next = this.queue.shift();
      next?.();
    }
  }
}

const cacheWriteSemaphore = new AsyncSemaphore(CACHE_WRITE_CONCURRENCY);
const cacheMutationGate = new AsyncReadWriteGate();

function getSettingsFilePath(): string {
  return join(
    app.getPath("userData"),
    usesDevelopmentCache() ? DEVELOPMENT_SETTINGS_FILE_NAME : SETTINGS_FILE_NAME,
  );
}

function getDefaultThumbnailCacheDirectory(): string {
  const localAppDataPath = process.env.LOCALAPPDATA;
  if (localAppDataPath) {
    return usesDevelopmentCache()
      ? join(localAppDataPath, "FileX", "Development", "ThumbnailCache")
      : join(localAppDataPath, "FileX", "ThumbnailCache");
  }

  return usesDevelopmentCache()
    ? join(app.getPath("userData"), "Development", "ThumbnailCache")
    : join(app.getPath("userData"), "ThumbnailCache");
}

function toOwnedUint8Array(buffer: Buffer): Uint8Array {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy;
}

function normalizeDirectoryPath(directoryPath: string): string {
  return resolve(directoryPath.trim());
}

function normalizePathForComparison(pathValue: string): string {
  return normalizeDirectoryPath(pathValue).replace(/[\\\/]+$/, "").toLowerCase();
}

function pathsEqual(left: string, right: string): boolean {
  return normalizePathForComparison(left) === normalizePathForComparison(right);
}

function isNestedPath(parentPath: string, childPath: string): boolean {
  const relativePath = relative(normalizeDirectoryPath(parentPath), normalizeDirectoryPath(childPath));
  return Boolean(relativePath) && !relativePath.startsWith("..") && !parse(relativePath).root;
}

function getMountPath(pathValue: string): string {
  return parse(normalizeDirectoryPath(pathValue)).root || pathValue;
}

function getSystemMountPath(): string {
  const systemDrive = process.env.SystemDrive;
  if (systemDrive) {
    return `${systemDrive.replace(/[\\\/]+$/, "")}\\`;
  }

  return getMountPath(app.getPath("home"));
}

function parseNumericValue(value: string | number | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

async function loadSettings(): Promise<DesktopShellSettings> {
  if (settingsCache) {
    return settingsCache;
  }

  try {
    const raw = await readFile(getSettingsFilePath(), "utf8");
    settingsCache = JSON.parse(raw) as DesktopShellSettings;
  } catch {
    settingsCache = {};
  }

  return settingsCache;
}

async function saveSettings(settings: DesktopShellSettings): Promise<void> {
  settingsCache = settings;
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(getSettingsFilePath(), JSON.stringify(settings, null, 2), "utf8");
}

async function ensureDirectory(directoryPath: string): Promise<string> {
  const normalizedPath = normalizeDirectoryPath(directoryPath);
  await mkdir(normalizedPath, { recursive: true });
  return normalizedPath;
}

function invalidateActiveCacheDirectory(): void {
  activeCacheDirectoryPromise = null;
  cacheSummaryCache = null;
}

function invalidateCacheSummary(): void {
  cacheSummaryCache = null;
}

function touchCacheEntry(cacheFilePath: string): void {
  const timestamp = Date.now();
  if (timestamp - lastCacheEntryTouchAt < CACHE_ACCESS_TOUCH_MIN_INTERVAL_MS) {
    return;
  }
  lastCacheEntryTouchAt = timestamp;
  const now = new Date(timestamp);
  void utimes(cacheFilePath, now, now).catch(() => {});
}

async function resolveActiveCacheDirectory(): Promise<{
  currentPath: string;
  defaultPath: string;
  usesCustomPath: boolean;
}> {
  const settings = await loadSettings();
  const defaultPath = await ensureDirectory(getDefaultThumbnailCacheDirectory());

  if (!settings.thumbnailCacheDirectory) {
    return {
      currentPath: defaultPath,
      defaultPath,
      usesCustomPath: false,
    };
  }

  try {
    return {
      currentPath: await ensureDirectory(settings.thumbnailCacheDirectory),
      defaultPath,
      usesCustomPath: true,
    };
  } catch {
    return {
      currentPath: defaultPath,
      defaultPath,
      usesCustomPath: false,
    };
  }
}

async function getActiveCacheDirectory(): Promise<{
  currentPath: string;
  defaultPath: string;
  usesCustomPath: boolean;
}> {
  if (!activeCacheDirectoryPromise) {
    activeCacheDirectoryPromise = resolveActiveCacheDirectory().catch((error) => {
      activeCacheDirectoryPromise = null;
      throw error;
    });
  }

  return activeCacheDirectoryPromise;
}

function buildCacheKey(
  absolutePath: string,
  sourceFileKey: string | undefined,
  maxDimension: number,
  quality: number,
): string {
  const normalizedQuality = Math.max(1, Math.min(100, Math.round(quality * 100)));
  return createHash("sha1")
    .update(CACHE_VERSION)
    .update("|")
    .update(sourceFileKey ?? absolutePath)
    .update("|")
    .update(String(maxDimension))
    .update("|")
    .update(String(normalizedQuality))
    .digest("hex");
}

function getCacheFilePath(
  cacheDirectory: string,
  absolutePath: string,
  sourceFileKey: string | undefined,
  maxDimension: number,
  quality: number,
): string {
  const cacheKey = buildCacheKey(absolutePath, sourceFileKey, maxDimension, quality);
  return join(cacheDirectory, `${cacheKey}${CACHE_FILE_EXTENSION}`);
}

function buildPreviewCacheKey(
  absolutePath: string,
  sourceFileKey: string | undefined,
  maxDimension: number,
): string {
  return createHash("sha1")
    .update(PREVIEW_CACHE_VERSION)
    .update("|")
    .update(sourceFileKey ?? absolutePath)
    .update("|")
    .update(String(maxDimension))
    .digest("hex");
}

function getPreviewCacheFilePath(
  cacheDirectory: string,
  absolutePath: string,
  sourceFileKey: string | undefined,
  maxDimension: number,
): string {
  const cacheKey = buildPreviewCacheKey(absolutePath, sourceFileKey, maxDimension);
  return join(cacheDirectory, `${cacheKey}${PREVIEW_CACHE_FILE_EXTENSION}`);
}

function encodeThumbnailFile(rendered: DesktopRenderedImage): Buffer {
  const payload = Buffer.from(rendered.bytes);
  const header = Buffer.allocUnsafe(8);
  header.writeUInt32BE(rendered.width, 0);
  header.writeUInt32BE(rendered.height, 4);
  return Buffer.concat([header, payload]);
}

function decodeThumbnailFile(id: string, buffer: Buffer): DesktopCachedThumbnail | null {
  if (buffer.byteLength <= 8) {
    return null;
  }

  const width = buffer.readUInt32BE(0);
  const height = buffer.readUInt32BE(4);
  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    id,
    bytes: toOwnedUint8Array(buffer.subarray(8)),
    mimeType: "image/jpeg",
    width,
    height,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const safeConcurrency = Math.max(1, concurrency);
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(safeConcurrency, items.length) }, () => run()),
  );
  return results;
}

async function listCacheEntries(directoryPath: string): Promise<string[]> {
  try {
    const dirEntries = await readdir(directoryPath, { withFileTypes: true });
    return dirEntries
      .filter((dirEntry) =>
        dirEntry.isFile()
        && (dirEntry.name.endsWith(CACHE_FILE_EXTENSION) || dirEntry.name.endsWith(PREVIEW_CACHE_FILE_EXTENSION)),
      )
      .map((dirEntry) => dirEntry.name);
  } catch {
    return [];
  }
}

async function summarizeCacheDirectory(directoryPath: string): Promise<{
  entryCount: number;
  totalBytes: number;
}> {
  if (
    cacheSummaryCache
    && pathsEqual(cacheSummaryCache.directoryPath, directoryPath)
    && Date.now() - cacheSummaryCache.cachedAt <= CACHE_SUMMARY_MAX_AGE_MS
  ) {
    return {
      entryCount: cacheSummaryCache.entryCount,
      totalBytes: cacheSummaryCache.totalBytes,
    };
  }

  const cacheEntries = await listCacheEntries(directoryPath);
  const stats = await mapWithConcurrency(cacheEntries, CACHE_STATS_CONCURRENCY, async (entryName) => {
    try {
      const entryStats = await lstat(join(directoryPath, entryName));
      return entryStats.size;
    } catch {
      return 0;
    }
  });
  const totalBytes = stats.reduce((total, size) => total + size, 0);
  cacheSummaryCache = {
    directoryPath,
    entryCount: cacheEntries.length,
    totalBytes,
    cachedAt: Date.now(),
  };

  return { entryCount: cacheEntries.length, totalBytes };
}

async function listCacheEntryStats(directoryPath: string): Promise<DiskCacheEntryStat[]> {
  const cacheEntries = await listCacheEntries(directoryPath);
  const stats = await mapWithConcurrency(cacheEntries, CACHE_STATS_CONCURRENCY, async (entryName) => {
    try {
      const entryStats = await lstat(join(directoryPath, entryName));
      return {
        name: entryName,
        size: entryStats.size,
        mtimeMs: entryStats.mtimeMs,
      } satisfies DiskCacheEntryStat;
    } catch {
      return null;
    }
  });
  return stats.filter((entry): entry is DiskCacheEntryStat => entry !== null);
}

async function pruneThumbnailCacheToBudget(): Promise<void> {
  await cacheMutationGate.runExclusive(async () => {
    const settings = await loadSettings();
    const preset = normalizeDiskCacheBudgetPreset(settings.diskCacheBudgetPreset);
    const budgetBytes = getDiskCacheBudgetBytes(preset);
    if (budgetBytes === null) {
      return;
    }

    const { currentPath } = await getActiveCacheDirectory();
    const entries = await listCacheEntryStats(currentPath);
    const entriesToRemove = selectDiskCacheEntriesToPrune(
      entries,
      budgetBytes,
      CACHE_PRUNE_TARGET_RATIO,
    );
    await mapWithConcurrency(entriesToRemove, CACHE_PRUNE_CONCURRENCY, async (entry) => {
      await rm(join(currentPath, entry.name), { force: true }).catch(() => {});
    });
    lastCachePruneAt = Date.now();
    invalidateCacheSummary();
  });
}

function scheduleThumbnailCachePrune(): void {
  if (cachePruneTimer) {
    return;
  }

  const elapsed = Date.now() - lastCachePruneAt;
  const delay = Math.max(CACHE_PRUNE_IDLE_DELAY_MS, CACHE_PRUNE_MIN_INTERVAL_MS - elapsed);
  cachePruneTimer = setTimeout(() => {
    cachePruneTimer = null;
    void pruneThumbnailCacheToBudget();
  }, delay);
  cachePruneTimer.unref?.();
}

async function getWindowsStorageVolumes(): Promise<DesktopStorageVolumeInfo[]> {
  if (process.platform !== "win32") {
    return [];
  }

  const systemMountPath = normalizePathForComparison(getSystemMountPath());
  const script = [
    "$ErrorActionPreference='Stop'",
    "Get-CimInstance Win32_LogicalDisk",
    "| Where-Object { $_.DriveType -in 2,3 }",
    "| Select-Object DeviceID,VolumeName,Size,FreeSpace,DriveType",
    "| ConvertTo-Json -Compress",
  ].join(" ");

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        windowsHide: true,
        maxBuffer: POWERSHELL_MAX_BUFFER_BYTES,
      },
    );

    if (!stdout.trim()) {
      return [];
    }

    const rawParsed = JSON.parse(stdout) as WindowsLogicalDiskRow | WindowsLogicalDiskRow[];
    const rows = Array.isArray(rawParsed) ? rawParsed : [rawParsed];
    const volumes = await Promise.all(rows.map(async (row) => {
      const mountPathRaw = row.DeviceID ? `${row.DeviceID.replace(/[\\\/]+$/, "")}\\` : "";
      if (!mountPathRaw) {
        return null;
      }

      const mountPath = resolve(mountPathRaw);
      let isWritable = false;
      try {
        await access(mountPath, fsConstants.R_OK | fsConstants.W_OK);
        isWritable = true;
      } catch {
        isWritable = false;
      }

      return {
        mountPath,
        label: row.VolumeName?.trim() || row.DeviceID?.trim() || mountPathRaw,
        freeBytes: parseNumericValue(row.FreeSpace),
        totalBytes: parseNumericValue(row.Size),
        isSystem: normalizePathForComparison(mountPath) === systemMountPath,
        isWritable,
      } satisfies DesktopStorageVolumeInfo;
    }));

    return volumes
      .filter((volume): volume is DesktopStorageVolumeInfo => volume !== null)
      .sort((left, right) => right.freeBytes - left.freeBytes);
  } catch {
    return [];
  }
}

async function buildFallbackVolumeInfo(pathValue: string): Promise<DesktopStorageVolumeInfo | null> {
  const mountPath = getMountPath(pathValue);
  if (!mountPath) {
    return null;
  }

  let isWritable = false;
  try {
    await access(mountPath, fsConstants.R_OK | fsConstants.W_OK);
    isWritable = true;
  } catch {
    isWritable = false;
  }

  return {
    mountPath,
    label: mountPath.replace(/[\\\/]+$/, ""),
    freeBytes: 0,
    totalBytes: 0,
    isSystem: normalizePathForComparison(mountPath) === normalizePathForComparison(getSystemMountPath()),
    isWritable,
  };
}

async function getCurrentAndRecommendedVolumes(currentPath: string): Promise<{
  currentVolume: DesktopStorageVolumeInfo | null;
  recommendedVolume: DesktopStorageVolumeInfo | null;
}> {
  const volumes = await getWindowsStorageVolumes();
  const currentMountPath = normalizePathForComparison(getMountPath(currentPath));
  const currentVolume = volumes.find((volume) => normalizePathForComparison(volume.mountPath) === currentMountPath)
    ?? await buildFallbackVolumeInfo(currentPath);

  if (!currentVolume) {
    return {
      currentVolume: null,
      recommendedVolume: null,
    };
  }

  const lowFreeSpace = currentVolume.freeBytes < LOW_SPACE_FREE_BYTES_THRESHOLD
    || (currentVolume.totalBytes > 0
      && currentVolume.freeBytes / Math.max(1, currentVolume.totalBytes) < LOW_SPACE_FREE_RATIO_THRESHOLD);

  if (!currentVolume.isSystem || !lowFreeSpace) {
    return {
      currentVolume,
      recommendedVolume: null,
    };
  }

  const recommendedVolume = volumes.find((volume) =>
    normalizePathForComparison(volume.mountPath) !== currentMountPath
    && volume.isWritable
    && volume.freeBytes >= RECOMMENDED_TARGET_FREE_BYTES_THRESHOLD
    && volume.freeBytes >= currentVolume.freeBytes * RECOMMENDED_FREE_SPACE_MULTIPLIER,
  ) ?? null;

  return {
    currentVolume,
    recommendedVolume,
  };
}

function formatErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

async function markRecommendationPrompted(): Promise<void> {
  const settings = await loadSettings();
  settings.cacheLocationRecommendationLastPromptedAt = new Date().toISOString();
  await saveSettings(settings);
}

export async function getThumbnailCacheInfo(): Promise<DesktopThumbnailCacheInfo> {
  const directoryInfo = await getActiveCacheDirectory();
  const summary = await summarizeCacheDirectory(directoryInfo.currentPath);
  const settings = await loadSettings();
  const diskBudgetPreset = normalizeDiskCacheBudgetPreset(settings.diskCacheBudgetPreset);

  return {
    currentPath: directoryInfo.currentPath,
    defaultPath: directoryInfo.defaultPath,
    usesCustomPath: directoryInfo.usesCustomPath,
    entryCount: summary.entryCount,
    totalBytes: summary.totalBytes,
    ramBudgetPreset: settings.ramBudgetPreset ?? "default",
    diskBudgetPreset,
    diskBudgetBytes: getDiskCacheBudgetBytes(diskBudgetPreset),
  };
}

export async function getRamBudgetInfo(
  systemTotalMemoryBytes: number,
  ramBudgetBytes: number,
  effectiveLimits: {
    effectiveThumbnailRamMaxEntries: number;
    effectiveThumbnailRamMaxBytes: number;
    effectiveRenderedPreviewMaxEntries: number;
    effectiveRenderedPreviewMaxBytes: number;
    effectivePreviewSourceMaxEntries: number;
    effectivePreviewSourceMaxBytes: number;
  },
): Promise<DesktopThumbnailCacheInfo> {
  const directoryInfo = await getActiveCacheDirectory();
  const summary = await summarizeCacheDirectory(directoryInfo.currentPath);
  const settings = await loadSettings();
  const diskBudgetPreset = normalizeDiskCacheBudgetPreset(settings.diskCacheBudgetPreset);

  return {
    currentPath: directoryInfo.currentPath,
    defaultPath: directoryInfo.defaultPath,
    usesCustomPath: directoryInfo.usesCustomPath,
    entryCount: summary.entryCount,
    totalBytes: summary.totalBytes,
    ramBudgetPreset: settings.ramBudgetPreset ?? "default",
    diskBudgetPreset,
    diskBudgetBytes: getDiskCacheBudgetBytes(diskBudgetPreset),
    systemTotalMemoryBytes,
    ramBudgetBytes,
    ...effectiveLimits,
  };
}

export async function saveRamBudgetPreset(preset: DesktopRamBudgetPreset): Promise<void> {
  const settings = await loadSettings();
  await saveSettings({ ...settings, ramBudgetPreset: preset });
}

export async function loadRamBudgetPreset(): Promise<DesktopRamBudgetPreset> {
  const settings = await loadSettings();
  return settings.ramBudgetPreset ?? "default";
}

export async function setDiskCacheBudgetPreset(
  preset: DesktopDiskCacheBudgetPreset,
): Promise<DesktopThumbnailCacheInfo> {
  const normalizedPreset = normalizeDiskCacheBudgetPreset(preset);
  await saveSettings({
    ...(await loadSettings()),
    diskCacheBudgetPreset: normalizedPreset,
  });
  await pruneThumbnailCacheToBudget();
  return getThumbnailCacheInfo();
}

export async function getCacheLocationRecommendation(): Promise<DesktopCacheLocationRecommendation> {
  const settings = await loadSettings();
  const directoryInfo = await getActiveCacheDirectory();

  if (process.platform !== "win32") {
    return {
      shouldPrompt: false,
      currentPath: directoryInfo.currentPath,
      recommendedPath: null,
      currentVolume: await buildFallbackVolumeInfo(directoryInfo.currentPath),
      recommendedVolume: null,
      reason: "unsupported-platform",
      dismissed: Boolean(settings.cacheLocationRecommendationDismissed),
    };
  }

  const { currentVolume, recommendedVolume } = await getCurrentAndRecommendedVolumes(directoryInfo.currentPath);
  const recommendedPath = recommendedVolume
    ? join(recommendedVolume.mountPath, "FileX", "ThumbnailCache")
    : null;
  const dismissed = Boolean(settings.cacheLocationRecommendationDismissed);
  const usesOffSystemCustomPath = Boolean(
    directoryInfo.usesCustomPath
    && currentVolume
    && !currentVolume.isSystem,
  );

  let reason: DesktopCacheLocationRecommendation["reason"] = "healthy";
  let shouldPrompt = false;

  if (usesOffSystemCustomPath) {
    reason = "already-custom";
  } else if (!currentVolume || !currentVolume.isSystem) {
    reason = "healthy";
  } else if (dismissed) {
    reason = "dismissed";
  } else {
    const lowFreeSpace = currentVolume.freeBytes < LOW_SPACE_FREE_BYTES_THRESHOLD
      || (currentVolume.totalBytes > 0
        && currentVolume.freeBytes / Math.max(1, currentVolume.totalBytes) < LOW_SPACE_FREE_RATIO_THRESHOLD);

    if (!lowFreeSpace) {
      reason = "healthy";
    } else if (!recommendedVolume || !recommendedPath) {
      reason = "no-suitable-volume";
    } else {
      reason = "low-space-recommendation";
      shouldPrompt = true;
    }
  }

  if (shouldPrompt) {
    await markRecommendationPrompted();
  }

  return {
    shouldPrompt,
    currentPath: directoryInfo.currentPath,
    recommendedPath,
    currentVolume,
    recommendedVolume,
    reason,
    dismissed,
  };
}

export async function chooseThumbnailCacheDirectory(): Promise<DesktopThumbnailCacheInfo | null> {
  const result = await dialog.showOpenDialog({
    title: "Seleziona la cartella cache thumbnail",
    properties: ["openDirectory", "createDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return setThumbnailCacheDirectory(result.filePaths[0]);
}

export async function setThumbnailCacheDirectory(directoryPath: string): Promise<DesktopThumbnailCacheInfo> {
  const result = await migrateThumbnailCacheDirectory(directoryPath);
  if (!result.ok || !result.cacheInfo) {
    throw new Error(result.error ?? "Non sono riuscito a spostare la cache thumbnail.");
  }
  return result.cacheInfo;
}

export async function migrateThumbnailCacheDirectory(
  directoryPath: string,
): Promise<DesktopCacheMigrationResult> {
  return cacheMutationGate.runExclusive(async () => {
    const sourceInfo = await getActiveCacheDirectory();
    const sourcePath = sourceInfo.currentPath;

    try {
    const normalizedTargetPath = await ensureDirectory(directoryPath);

    if (pathsEqual(sourcePath, normalizedTargetPath)) {
      return {
        ok: true,
        cacheInfo: await getThumbnailCacheInfo(),
        copiedEntries: 0,
        removedSourceEntries: 0,
      };
    }

    if (isNestedPath(sourcePath, normalizedTargetPath) || isNestedPath(normalizedTargetPath, sourcePath)) {
      return {
        ok: false,
        copiedEntries: 0,
        removedSourceEntries: 0,
        error: "Il nuovo percorso cache non può trovarsi dentro quello attuale o viceversa.",
      };
    }

    const sourceEntries = await listCacheEntries(sourcePath);
    const copyResults = await mapWithConcurrency(sourceEntries, CACHE_PRUNE_CONCURRENCY, async (entryName) => {
      try {
        await copyFile(
          join(sourcePath, entryName),
          join(normalizedTargetPath, entryName),
          fsConstants.COPYFILE_EXCL,
        );
        return true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        if (code === "EEXIST") {
          return false;
        }
        throw error;
      }
    });
    const copiedEntries = copyResults.filter(Boolean).length;

    await access(normalizedTargetPath, fsConstants.R_OK | fsConstants.W_OK);

    await saveSettings({
      ...(await loadSettings()),
      thumbnailCacheDirectory: normalizedTargetPath,
    });
    invalidateActiveCacheDirectory();

    let removedSourceEntries = 0;
    let cleanupError: string | undefined;

    try {
      await rm(sourcePath, { recursive: true, force: true });
      removedSourceEntries = sourceEntries.length;
    } catch (error) {
      cleanupError = formatErrorMessage(
        error,
        "Cache migrata, ma non sono riuscito a rimuovere completamente la cartella originale.",
      );
    }

    return {
      ok: true,
      cacheInfo: await getThumbnailCacheInfo(),
      copiedEntries,
      removedSourceEntries,
      error: cleanupError,
    };
    } catch (error) {
    return {
      ok: false,
      copiedEntries: 0,
      removedSourceEntries: 0,
      error: formatErrorMessage(
        error,
        "Non sono riuscito a migrare la cache nel nuovo percorso.",
      ),
    };
    }
  });
}

export async function dismissCacheLocationRecommendation(): Promise<void> {
  await saveSettings({
    ...(await loadSettings()),
    cacheLocationRecommendationDismissed: true,
    cacheLocationRecommendationDismissedAt: new Date().toISOString(),
  });
}

export async function resetThumbnailCacheDirectory(): Promise<DesktopThumbnailCacheInfo> {
  await setThumbnailCacheDirectory(getDefaultThumbnailCacheDirectory());
  const settings = await loadSettings();
  delete settings.thumbnailCacheDirectory;
  await saveSettings(settings);
  invalidateActiveCacheDirectory();
  return getThumbnailCacheInfo();
}

export async function clearThumbnailCacheDirectory(): Promise<boolean> {
  try {
    await cacheMutationGate.runExclusive(async () => {
      const { currentPath } = await getActiveCacheDirectory();
      await rm(currentPath, { recursive: true, force: true });
      await mkdir(currentPath, { recursive: true });
      invalidateCacheSummary();
    });
    return true;
  } catch {
    return false;
  }
}

export async function getCachedThumbnailsFromDisk(
  entries: DesktopThumbnailCacheLookupEntry[],
  maxDimension: number,
  quality: number,
): Promise<DesktopCachedThumbnail[]> {
  if (entries.length === 0) {
    return [];
  }

  const { currentPath } = await getActiveCacheDirectory();
  const hits = await mapWithConcurrency(entries, CACHE_LOOKUP_CONCURRENCY, async (entry) => {
    try {
      const cacheFilePath = getCacheFilePath(
        currentPath,
        entry.absolutePath,
        entry.sourceFileKey,
        maxDimension,
        quality,
      );
      const fileBuffer = await readFile(cacheFilePath);
      touchCacheEntry(cacheFilePath);
      return decodeThumbnailFile(entry.id, fileBuffer);
    } catch {
      return null;
    }
  });

  return hits.filter((hit): hit is DesktopCachedThumbnail => hit !== null);
}

export async function storeThumbnailInDiskCache(
  absolutePath: string,
  sourceFileKey: string | undefined,
  maxDimension: number,
  quality: number,
  rendered: DesktopRenderedImage,
): Promise<void> {
  try {
    await cacheMutationGate.runShared(async () => {
      await cacheWriteSemaphore.run(async () => {
        const { currentPath } = await getActiveCacheDirectory();
        await writeFile(
          getCacheFilePath(currentPath, absolutePath, sourceFileKey, maxDimension, quality),
          encodeThumbnailFile(rendered),
        );
        invalidateCacheSummary();
      });
    });
    scheduleThumbnailCachePrune();
  } catch {
    // The disk cache is best-effort and should never block thumbnail delivery.
  }
}

export async function getCachedPreviewFromDisk(
  absolutePath: string,
  sourceFileKey: string | undefined,
  maxDimension: number,
): Promise<DesktopRenderedImage | null> {
  if (maxDimension <= 0) {
    return null;
  }

  try {
    const { currentPath } = await getActiveCacheDirectory();
    const cacheFilePath = getPreviewCacheFilePath(currentPath, absolutePath, sourceFileKey, maxDimension);
    const fileBuffer = await readFile(cacheFilePath);
    touchCacheEntry(cacheFilePath);
    const decoded = decodeThumbnailFile(absolutePath, fileBuffer);
    if (!decoded) {
      return null;
    }

    return {
      bytes: decoded.bytes,
      mimeType: decoded.mimeType,
      width: decoded.width,
      height: decoded.height,
    };
  } catch {
    return null;
  }
}

export async function storePreviewInDiskCache(
  absolutePath: string,
  sourceFileKey: string | undefined,
  maxDimension: number,
  rendered: DesktopRenderedImage,
): Promise<void> {
  if (maxDimension <= 0) {
    return;
  }

  try {
    await cacheMutationGate.runShared(async () => {
      await cacheWriteSemaphore.run(async () => {
        const { currentPath } = await getActiveCacheDirectory();
        await writeFile(
          getPreviewCacheFilePath(currentPath, absolutePath, sourceFileKey, maxDimension),
          encodeThumbnailFile(rendered),
        );
        invalidateCacheSummary();
      });
    });
    scheduleThumbnailCachePrune();
  } catch {
    // The disk cache is best-effort and should never block preview delivery.
  }
}
