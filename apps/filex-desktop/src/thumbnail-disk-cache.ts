import { app, dialog } from "electron";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  DesktopCachedThumbnail,
  DesktopRenderedImage,
  DesktopThumbnailCacheInfo,
  DesktopThumbnailCacheLookupEntry,
} from "@photo-tools/desktop-contracts";

interface DesktopShellSettings {
  thumbnailCacheDirectory?: string;
}

const SETTINGS_FILE_NAME = "desktop-settings.json";
const CACHE_FILE_EXTENSION = ".thumb";
const CACHE_VERSION = "v1";
const CACHE_LOOKUP_CONCURRENCY = 24;

let settingsCache: DesktopShellSettings | null = null;

function getSettingsFilePath(): string {
  return join(app.getPath("userData"), SETTINGS_FILE_NAME);
}

function getDefaultThumbnailCacheDirectory(): string {
  const localAppDataPath = process.env.LOCALAPPDATA;
  if (localAppDataPath) {
    return join(localAppDataPath, "FileX", "ThumbnailCache");
  }

  return join(app.getPath("userData"), "ThumbnailCache");
}

function toOwnedUint8Array(buffer: Buffer): Uint8Array {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy;
}

function normalizeDirectoryPath(directoryPath: string): string {
  return resolve(directoryPath.trim());
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

async function getActiveCacheDirectory(): Promise<{
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

async function summarizeCacheDirectory(directoryPath: string): Promise<{
  entryCount: number;
  totalBytes: number;
}> {
  try {
    const dirEntries = await readdir(directoryPath, { withFileTypes: true });
    let entryCount = 0;
    let totalBytes = 0;

    for (const dirEntry of dirEntries) {
      if (!dirEntry.isFile() || !dirEntry.name.endsWith(CACHE_FILE_EXTENSION)) {
        continue;
      }

      entryCount += 1;
      try {
        const stats = await lstat(join(directoryPath, dirEntry.name));
        totalBytes += stats.size;
      } catch {
        // Ignore unreadable entries in the summary.
      }
    }

    return { entryCount, totalBytes };
  } catch {
    return { entryCount: 0, totalBytes: 0 };
  }
}

export async function getThumbnailCacheInfo(): Promise<DesktopThumbnailCacheInfo> {
  const directoryInfo = await getActiveCacheDirectory();
  const summary = await summarizeCacheDirectory(directoryInfo.currentPath);

  return {
    currentPath: directoryInfo.currentPath,
    defaultPath: directoryInfo.defaultPath,
    usesCustomPath: directoryInfo.usesCustomPath,
    entryCount: summary.entryCount,
    totalBytes: summary.totalBytes,
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
  const normalizedPath = await ensureDirectory(directoryPath);
  await saveSettings({
    ...(await loadSettings()),
    thumbnailCacheDirectory: normalizedPath,
  });
  return getThumbnailCacheInfo();
}

export async function resetThumbnailCacheDirectory(): Promise<DesktopThumbnailCacheInfo> {
  const settings = await loadSettings();
  delete settings.thumbnailCacheDirectory;
  await saveSettings(settings);
  return getThumbnailCacheInfo();
}

export async function clearThumbnailCacheDirectory(): Promise<boolean> {
  try {
    const { currentPath } = await getActiveCacheDirectory();
    await rm(currentPath, { recursive: true, force: true });
    await mkdir(currentPath, { recursive: true });
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
      const fileBuffer = await readFile(
        getCacheFilePath(currentPath, entry.absolutePath, entry.sourceFileKey, maxDimension, quality),
      );
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
    const { currentPath } = await getActiveCacheDirectory();
    await writeFile(
      getCacheFilePath(currentPath, absolutePath, sourceFileKey, maxDimension, quality),
      encodeThumbnailFile(rendered),
    );
  } catch {
    // The disk cache is best-effort and should never block thumbnail delivery.
  }
}
