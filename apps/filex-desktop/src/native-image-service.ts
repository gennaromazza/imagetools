import { app, nativeImage } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { availableParallelism, totalmem } from "node:os";
import { basename, extname, join } from "node:path";
import type {
  DesktopQuickPreviewFrame,
  DesktopQuickPreviewRequest,
  DesktopQuickPreviewSource,
  DesktopQuickPreviewWarmResult,
  DesktopRenderedImage,
} from "@photo-tools/desktop-contracts";
import { ExifTool } from "exiftool-vendored";
import { extractEmbeddedJpeg, locateEmbeddedJpegRange, locateJpegExifThumbnailRange } from "./raw-jpeg-extractor.js";

// sharp is a native module — load lazily so the app still starts if binaries
// are missing (dev environment without native rebuild).
let _sharpModule: typeof import("sharp") | null | undefined = undefined;
async function getSharp(): Promise<typeof import("sharp") | null> {
  if (_sharpModule !== undefined) return _sharpModule;
  try {
    _sharpModule = (await import("sharp")).default as unknown as typeof import("sharp");
  } catch {
    _sharpModule = null;
  }
  return _sharpModule;
}
import {
  getCachedPreviewFromDisk,
  getCachedThumbnailsFromDisk,
  storePreviewInDiskCache,
  storeThumbnailInDiskCache,
} from "./thumbnail-disk-cache.js";

const STANDARD_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const RAW_EXTENSIONS = new Set([
  ".cr2", ".cr3", ".crw",
  ".nef", ".nrw",
  ".arw", ".srf", ".sr2",
  ".raf",
  ".dng",
  ".rw2",
  ".orf",
  ".pef",
  ".srw",
  ".3fr",
  ".x3f",
  ".gpr",
]);
const RAW_HEADER_READ_BYTES = 512 * 1024;
const RAW_PREFIX_SCAN_BYTES = 6 * 1024 * 1024;
const RAW_FAST_PREVIEW_MAX_BYTES = 12 * 1024 * 1024;
const MIN_EMBEDDED_JPEG_BYTES = 10_000;
const MB = 1024 * 1024;
const SYSTEM_MEMORY_BYTES = Math.max(2 * 1024 * MB, totalmem());

// RAM budget preset fractions
const RAM_BUDGET_FRACTIONS: Record<string, number> = {
  conservative: 0.06,
  default: 0.12,
  performance: 0.20,
  maximum: 0.28,
};

function computeCacheLimits(budgetFraction: number): {
  autoCacheBudgetBytes: number;
  previewSourceCacheMaxBytes: number;
  previewSourceCacheMaxEntries: number;
  renderedPreviewCacheMaxBytes: number;
  renderedPreviewCacheMaxEntries: number;
  thumbnailMemoryCacheMaxBytes: number;
  thumbnailMemoryCacheMaxEntries: number;
} {
  const autoCacheBudgetBytes = clampNumber(
    Math.round(SYSTEM_MEMORY_BYTES * budgetFraction),
    256 * MB,
    Math.round(SYSTEM_MEMORY_BYTES * 0.60), // never exceed 60% of system RAM
  );
  const previewSourceCacheMaxBytes = clampNumber(Math.round(autoCacheBudgetBytes * 0.15), 64 * MB, 2048 * MB);
  const previewSourceCacheMaxEntries = clampNumber(Math.floor(previewSourceCacheMaxBytes / (5 * MB)), 12, 2048);
  const renderedPreviewCacheMaxBytes = clampNumber(Math.round(autoCacheBudgetBytes * 0.3), 96 * MB, 8192 * MB);
  const renderedPreviewCacheMaxEntries = clampNumber(Math.floor(renderedPreviewCacheMaxBytes / (3 * MB)), 24, 4096);
  const thumbnailMemoryCacheMaxBytes = clampNumber(Math.round(autoCacheBudgetBytes * 0.55), 128 * MB, 16384 * MB);
  const thumbnailMemoryCacheMaxEntries = clampNumber(Math.floor(thumbnailMemoryCacheMaxBytes / (320 * 1024)), 256, 32768);
  return {
    autoCacheBudgetBytes,
    previewSourceCacheMaxBytes,
    previewSourceCacheMaxEntries,
    renderedPreviewCacheMaxBytes,
    renderedPreviewCacheMaxEntries,
    thumbnailMemoryCacheMaxBytes,
    thumbnailMemoryCacheMaxEntries,
  };
}

// Mutable cache limit variables — reconfigured at startup via configureDesktopImageService()
let _limits = computeCacheLimits(RAM_BUDGET_FRACTIONS.default);
let PREVIEW_SOURCE_CACHE_MAX_BYTES = _limits.previewSourceCacheMaxBytes;
let PREVIEW_SOURCE_CACHE_MAX_ENTRIES = _limits.previewSourceCacheMaxEntries;
let RENDERED_PREVIEW_CACHE_MAX_BYTES = _limits.renderedPreviewCacheMaxBytes;
let RENDERED_PREVIEW_CACHE_MAX_ENTRIES = _limits.renderedPreviewCacheMaxEntries;
let THUMBNAIL_MEMORY_CACHE_MAX_BYTES = _limits.thumbnailMemoryCacheMaxBytes;
let THUMBNAIL_MEMORY_CACHE_MAX_ENTRIES = _limits.thumbnailMemoryCacheMaxEntries;
let _activeBudgetBytes = _limits.autoCacheBudgetBytes;
const THUMBNAIL_BATCH_WINDOW_MS = 8;
const THUMBNAIL_BATCH_MAX_ITEMS = 128;
const QUICK_PREVIEW_FRAME_MAX_ENTRIES = 128;
const RAW_EMBEDDED_RANGE_CACHE_MAX_ENTRIES = 20_000;
const RAW_EMBEDDED_RANGE_CACHE_FILE_NAME = "raw-embedded-range-cache-v1.json";
const RAW_EMBEDDED_RANGE_CACHE_PERSIST_DEBOUNCE_MS = 2_000;
const JPEG_EXIF_RANGE_CACHE_MAX_ENTRIES = 20_000;
const JPEG_EXIF_RANGE_CACHE_FILE_NAME = "jpeg-exif-range-cache-v1.json";
const JPEG_EXIF_RANGE_CACHE_PERSIST_DEBOUNCE_MS = 2_000;
const JPEG_EXIF_HEADER_READ_BYTES = 65_536; // APP1 Exif is always within first 64 KB
const JPEG_EXIF_SENTINEL_OFFSET = -1; // marks "checked, no usable thumbnail"
const THUMBNAIL_PERF_LOG_INTERVAL = 200;
const PERF_ENABLED = !app.isPackaged;
const RAW_EXIFTOOL_MAX_PROCS = Math.max(2, Math.min(8, Math.ceil(availableParallelism() / 2)));
const RAW_EXIFTOOL_TAGS = ["PreviewImage", "JpgFromRaw", "ThumbnailImage"] as const;
const JPG_FROM_RAW_FIRST_EXTENSIONS = new Set([".nef", ".nrw", ".rw2"]);
const STANDARD_DECODE_CONCURRENCY = Math.max(1, Math.min(availableParallelism(), 8));
const RAW_DECODE_CONCURRENCY = Math.max(2, Math.min(Math.max(2, Math.floor(availableParallelism() / 2)), 4));

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getDesktopImageCacheLimits(): {
  rawRenderCacheHit: number;
  effectiveThumbnailRamMaxEntries: number;
  effectiveThumbnailRamMaxBytes: number;
  effectiveRenderedPreviewMaxEntries: number;
  effectiveRenderedPreviewMaxBytes: number;
  effectivePreviewSourceMaxEntries: number;
  effectivePreviewSourceMaxBytes: number;
  systemTotalMemoryBytes: number;
  ramBudgetBytes: number;
} {
  return {
    rawRenderCacheHit: thumbnailPerfMetrics.rawRenderCacheHit,
    effectiveThumbnailRamMaxEntries: THUMBNAIL_MEMORY_CACHE_MAX_ENTRIES,
    effectiveThumbnailRamMaxBytes: THUMBNAIL_MEMORY_CACHE_MAX_BYTES,
    effectiveRenderedPreviewMaxEntries: RENDERED_PREVIEW_CACHE_MAX_ENTRIES,
    effectiveRenderedPreviewMaxBytes: RENDERED_PREVIEW_CACHE_MAX_BYTES,
    effectivePreviewSourceMaxEntries: PREVIEW_SOURCE_CACHE_MAX_ENTRIES,
    effectivePreviewSourceMaxBytes: PREVIEW_SOURCE_CACHE_MAX_BYTES,
    systemTotalMemoryBytes: SYSTEM_MEMORY_BYTES,
    ramBudgetBytes: _activeBudgetBytes,
  };
}

/**
 * Configure the RAM cache budget. Must be called before any thumbnail operations.
 * Accepts a preset name ("conservative" | "default" | "performance" | "maximum").
 * The limits are applied immediately; existing cached data is NOT evicted (the new
 * lower/upper bounds take effect on the next trim cycle).
 */
export function configureDesktopImageService(preset: string): void {
  const fraction = RAM_BUDGET_FRACTIONS[preset] ?? RAM_BUDGET_FRACTIONS.default;
  const limits = computeCacheLimits(fraction);
  PREVIEW_SOURCE_CACHE_MAX_BYTES = limits.previewSourceCacheMaxBytes;
  PREVIEW_SOURCE_CACHE_MAX_ENTRIES = limits.previewSourceCacheMaxEntries;
  RENDERED_PREVIEW_CACHE_MAX_BYTES = limits.renderedPreviewCacheMaxBytes;
  RENDERED_PREVIEW_CACHE_MAX_ENTRIES = limits.renderedPreviewCacheMaxEntries;
  THUMBNAIL_MEMORY_CACHE_MAX_BYTES = limits.thumbnailMemoryCacheMaxBytes;
  THUMBNAIL_MEMORY_CACHE_MAX_ENTRIES = limits.thumbnailMemoryCacheMaxEntries;
  _activeBudgetBytes = limits.autoCacheBudgetBytes;
}

const byteReadStats = {
  totalBytes: 0,
  totalImages: 0,
  rawBytes: 0,
  rawImages: 0,
  standardBytes: 0,
  standardImages: 0,
};

function recordDesktopBytesRead(kind: "raw" | "standard", bytes: number): void {
  if (!PERF_ENABLED || bytes <= 0) {
    return;
  }

  byteReadStats.totalBytes += bytes;
  byteReadStats.totalImages += 1;

  if (kind === "raw") {
    byteReadStats.rawBytes += bytes;
    byteReadStats.rawImages += 1;
  } else {
    byteReadStats.standardBytes += bytes;
    byteReadStats.standardImages += 1;
  }

  const overallAverageKb = (byteReadStats.totalBytes / Math.max(1, byteReadStats.totalImages)) / 1024;
  const rawAverageKb = (byteReadStats.rawBytes / Math.max(1, byteReadStats.rawImages || 1)) / 1024;
  const standardAverageKb = (byteReadStats.standardBytes / Math.max(1, byteReadStats.standardImages || 1)) / 1024;
  const rawFlag = byteReadStats.rawImages > 0 && rawAverageKb > 512 ? " [FLAG raw > 512KB]" : "";
  const standardFlag = byteReadStats.standardImages > 0 && standardAverageKb > 200 ? " [FLAG standard > 200KB]" : "";

  console.log(
    `[PERF] avg bytes-read per image                 : ${overallAverageKb.toFixed(1)}KB` +
      ` (raw ${rawAverageKb.toFixed(1)}KB${rawFlag}, standard ${standardAverageKb.toFixed(1)}KB${standardFlag})`,
  );
}

function toOwnedUint8Array(buffer: Buffer): Uint8Array {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy;
}

interface ResolvedPreviewSource {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

interface ResolvedPreviewSourceResult {
  source: ResolvedPreviewSource;
  origin: DesktopQuickPreviewSource;
  cacheHit: boolean;
}

interface DesktopPreviewRenderResult {
  rendered: DesktopRenderedImage;
  source: DesktopQuickPreviewSource;
  cacheHit: boolean;
  cacheKey: string;
}

interface QuickPreviewFrameEntry {
  cacheKey: string;
  width: number;
  height: number;
  mimeType: string;
  stage: "fit" | "detail";
  source: DesktopQuickPreviewSource;
  cacheHit: boolean;
  createdAt: number;
}

interface CachedEmbeddedJpegRange {
  offset: number;
  length: number;
}

interface BatchedThumbnailRequest {
  dedupeKey: string;
  absolutePath: string;
  maxDimension: number;
  quality: number;
  sourceFileKey?: string;
  resolvers: Array<(value: DesktopRenderedImage | null) => void>;
}

interface ResolvePreviewBufferOptions {
  sourceFileKey?: string;
  allowExifTool?: boolean;
  allowFullRead?: boolean;
}

const previewSourceCache = new Map<string, ResolvedPreviewSource>();
const previewSourcePromiseCache = new Map<string, Promise<ResolvedPreviewSourceResult | null>>();
let previewSourceCacheTotalBytes = 0;
const renderedPreviewCache = new Map<string, DesktopRenderedImage>();
const renderedPreviewPromiseCache = new Map<string, Promise<DesktopPreviewRenderResult | null>>();
let renderedPreviewCacheTotalBytes = 0;
const thumbnailMemoryCache = new Map<string, DesktopRenderedImage>();
let thumbnailMemoryCacheTotalBytes = 0;
const rawEmbeddedRangeCache = new Map<string, CachedEmbeddedJpegRange>();
let rawEmbeddedRangeCacheLoaded = false;
let rawEmbeddedRangeCachePersistTimer: ReturnType<typeof setTimeout> | null = null;
let rawEmbeddedRangeCachePersistInFlight: Promise<void> | null = null;
const jpegExifRangeCache = new Map<string, CachedEmbeddedJpegRange>();
let jpegExifRangeCacheLoaded = false;
let jpegExifRangeCachePersistTimer: ReturnType<typeof setTimeout> | null = null;
let jpegExifRangeCachePersistInFlight: Promise<void> | null = null;
const quickPreviewFrameStore = new Map<string, QuickPreviewFrameEntry>();
const quickPreviewFrameTokenByCacheKey = new Map<string, string>();
const thumbnailBatchQueue = new Map<string, BatchedThumbnailRequest>();
const thumbnailBatchOrder: string[] = [];
const inFlightThumbnailSingleFlight = new Map<string, Promise<DesktopRenderedImage | null>>();
let thumbnailBatchTimer: ReturnType<typeof setTimeout> | null = null;
const thumbnailPerfMetrics = {
  requested: 0,
  singleFlightHit: 0,
  cacheHitRam: 0,
  cacheHitDisk: 0,
  rawOffsetHit: 0,
  rawRenderCacheHit: 0,
};
const rawPreviewExifTool = new ExifTool({
  maxProcs: RAW_EXIFTOOL_MAX_PROCS,
  spawnTimeoutMillis: 60_000,
  taskTimeoutMillis: 60_000,
});

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

const standardDecodeSemaphore = new AsyncSemaphore(STANDARD_DECODE_CONCURRENCY);
const rawDecodeSemaphore = new AsyncSemaphore(RAW_DECODE_CONCURRENCY);

export const QUICK_PREVIEW_PROTOCOL_SCHEME = "filex-preview";

function logThumbnailPerfMetricsMaybe(): void {
  if (!PERF_ENABLED) {
    return;
  }

  if (thumbnailPerfMetrics.requested > 0 && thumbnailPerfMetrics.requested % THUMBNAIL_PERF_LOG_INTERVAL === 0) {
    console.log(
      `[PERF] thumbnail metrics                        : req ${thumbnailPerfMetrics.requested}` +
      ` | ram-hit ${thumbnailPerfMetrics.cacheHitRam}` +
      ` | disk-hit ${thumbnailPerfMetrics.cacheHitDisk}` +
      ` | single-flight-hit ${thumbnailPerfMetrics.singleFlightHit}` +
      ` | raw-offset-hit ${thumbnailPerfMetrics.rawOffsetHit}` +
      ` | raw-render-cache-hit ${thumbnailPerfMetrics.rawRenderCacheHit}`,
    );
  }
}

function recordThumbnailRequest(): void {
  thumbnailPerfMetrics.requested += 1;
  logThumbnailPerfMetricsMaybe();
}

function recordThumbnailMetric(
  key: "singleFlightHit" | "cacheHitRam" | "cacheHitDisk" | "rawOffsetHit" | "rawRenderCacheHit",
): void {
  thumbnailPerfMetrics[key] += 1;
  logThumbnailPerfMetricsMaybe();
}

function getPreviewSourceCacheKey(absolutePath: string, sourceFileKey?: string): string {
  return sourceFileKey || absolutePath;
}

function getRenderedPreviewCacheKey(
  absolutePath: string,
  maxDimension: number,
  sourceFileKey?: string,
): string {
  return `${getPreviewSourceCacheKey(absolutePath, sourceFileKey)}::${Math.max(0, Math.round(maxDimension))}`;
}

function buildThumbnailDedupeKey(
  absolutePath: string,
  maxDimension: number,
  quality: number,
  sourceFileKey?: string,
): string {
  const normalizedQuality = Math.max(1, Math.min(100, Math.round(quality * 100)));
  return `${sourceFileKey ?? absolutePath}::${Math.max(0, Math.round(maxDimension))}::${normalizedQuality}`;
}

function getRawEmbeddedRangeCacheFilePath(): string {
  return join(app.getPath("userData"), RAW_EMBEDDED_RANGE_CACHE_FILE_NAME);
}

function getJpegExifRangeCacheFilePath(): string {
  return join(app.getPath("userData"), JPEG_EXIF_RANGE_CACHE_FILE_NAME);
}

async function ensureRawEmbeddedRangeCacheLoaded(): Promise<void> {
  if (rawEmbeddedRangeCacheLoaded) {
    return;
  }

  rawEmbeddedRangeCacheLoaded = true;
  try {
    const raw = await readFile(getRawEmbeddedRangeCacheFilePath(), "utf8");
    const parsed = JSON.parse(raw) as Array<{ key?: string; offset?: number; length?: number }>;
    if (!Array.isArray(parsed)) {
      return;
    }

    for (const entry of parsed) {
      if (!entry || typeof entry.key !== "string") {
        continue;
      }
      const offsetRaw = entry.offset;
      const lengthRaw = entry.length;
      if (typeof offsetRaw !== "number" || !Number.isFinite(offsetRaw)) {
        continue;
      }
      if (typeof lengthRaw !== "number" || !Number.isFinite(lengthRaw)) {
        continue;
      }
      const offset = Math.max(0, Math.floor(offsetRaw));
      const length = Math.max(0, Math.floor(lengthRaw));
      if (length <= 0) {
        continue;
      }

      rawEmbeddedRangeCache.set(entry.key, { offset, length });
      if (rawEmbeddedRangeCache.size > RAW_EMBEDDED_RANGE_CACHE_MAX_ENTRIES) {
        const oldest = rawEmbeddedRangeCache.keys().next().value as string | undefined;
        if (oldest) {
          rawEmbeddedRangeCache.delete(oldest);
        }
      }
    }
  } catch {
    // Best-effort cache hydration; ignore malformed or missing files.
  }
}

async function persistRawEmbeddedRangeCache(): Promise<void> {
  if (!rawEmbeddedRangeCacheLoaded) {
    return;
  }
  if (rawEmbeddedRangeCachePersistInFlight) {
    await rawEmbeddedRangeCachePersistInFlight;
    return;
  }

  rawEmbeddedRangeCachePersistInFlight = (async () => {
    try {
      const entries = Array.from(rawEmbeddedRangeCache.entries()).map(([key, value]) => ({
        key,
        offset: value.offset,
        length: value.length,
      }));
      await mkdir(app.getPath("userData"), { recursive: true });
      await writeFile(
        getRawEmbeddedRangeCacheFilePath(),
        JSON.stringify(entries),
        "utf8",
      );
    } catch {
      // Persistence is best-effort and should never block rendering.
    } finally {
      rawEmbeddedRangeCachePersistInFlight = null;
    }
  })();

  await rawEmbeddedRangeCachePersistInFlight;
}

function schedulePersistRawEmbeddedRangeCache(): void {
  if (!rawEmbeddedRangeCacheLoaded || rawEmbeddedRangeCachePersistTimer !== null) {
    return;
  }

  rawEmbeddedRangeCachePersistTimer = setTimeout(() => {
    rawEmbeddedRangeCachePersistTimer = null;
    void persistRawEmbeddedRangeCache();
  }, RAW_EMBEDDED_RANGE_CACHE_PERSIST_DEBOUNCE_MS);
}

// ── JPEG EXIF range cache (IFD1 thumbnail offsets for standard JPG files) ─

async function ensureJpegExifRangeCacheLoaded(): Promise<void> {
  if (jpegExifRangeCacheLoaded) {
    return;
  }

  jpegExifRangeCacheLoaded = true;
  try {
    const raw = await readFile(getJpegExifRangeCacheFilePath(), "utf8");
    const parsed = JSON.parse(raw) as Array<{ key?: string; offset?: number; length?: number }>;
    if (!Array.isArray(parsed)) {
      return;
    }

    for (const entry of parsed) {
      if (!entry || typeof entry.key !== "string") {
        continue;
      }
      const offsetRaw = entry.offset;
      const lengthRaw = entry.length;
      if (typeof offsetRaw !== "number" || !Number.isFinite(offsetRaw)) {
        continue;
      }
      if (typeof lengthRaw !== "number" || !Number.isFinite(lengthRaw)) {
        continue;
      }
      const offset = Math.floor(offsetRaw); // may be JPEG_EXIF_SENTINEL_OFFSET (-1)
      const length = Math.max(0, Math.floor(lengthRaw));

      jpegExifRangeCache.set(entry.key, { offset, length });
      if (jpegExifRangeCache.size > JPEG_EXIF_RANGE_CACHE_MAX_ENTRIES) {
        const oldest = jpegExifRangeCache.keys().next().value as string | undefined;
        if (oldest) {
          jpegExifRangeCache.delete(oldest);
        }
      }
    }
  } catch {
    // Best-effort cache hydration; ignore malformed or missing files.
  }
}

async function persistJpegExifRangeCache(): Promise<void> {
  if (!jpegExifRangeCacheLoaded) {
    return;
  }
  if (jpegExifRangeCachePersistInFlight) {
    await jpegExifRangeCachePersistInFlight;
    return;
  }

  jpegExifRangeCachePersistInFlight = (async () => {
    try {
      const entries = Array.from(jpegExifRangeCache.entries()).map(([key, value]) => ({
        key,
        offset: value.offset,
        length: value.length,
      }));
      await mkdir(app.getPath("userData"), { recursive: true });
      await writeFile(
        getJpegExifRangeCacheFilePath(),
        JSON.stringify(entries),
        "utf8",
      );
    } catch {
      // Persistence is best-effort and should never block rendering.
    } finally {
      jpegExifRangeCachePersistInFlight = null;
    }
  })();

  await jpegExifRangeCachePersistInFlight;
}

function schedulePersistJpegExifRangeCache(): void {
  if (!jpegExifRangeCacheLoaded || jpegExifRangeCachePersistTimer !== null) {
    return;
  }

  jpegExifRangeCachePersistTimer = setTimeout(() => {
    jpegExifRangeCachePersistTimer = null;
    void persistJpegExifRangeCache();
  }, JPEG_EXIF_RANGE_CACHE_PERSIST_DEBOUNCE_MS);
}

function getCachedJpegExifRange(cacheKey: string | undefined): CachedEmbeddedJpegRange | null {
  if (!cacheKey) {
    return null;
  }

  const cached = jpegExifRangeCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  // Touch (LRU)
  jpegExifRangeCache.delete(cacheKey);
  jpegExifRangeCache.set(cacheKey, cached);
  return cached;
}

function setCachedJpegExifRange(cacheKey: string | undefined, entry: CachedEmbeddedJpegRange): void {
  if (!cacheKey) {
    return;
  }

  jpegExifRangeCache.delete(cacheKey);
  jpegExifRangeCache.set(cacheKey, entry);
  while (jpegExifRangeCache.size > JPEG_EXIF_RANGE_CACHE_MAX_ENTRIES) {
    const oldest = jpegExifRangeCache.keys().next().value as string | undefined;
    if (!oldest) {
      break;
    }
    jpegExifRangeCache.delete(oldest);
  }
  schedulePersistJpegExifRangeCache();
}

function touchRawEmbeddedRangeCacheEntry(
  cacheKey: string,
  entry: CachedEmbeddedJpegRange,
): CachedEmbeddedJpegRange {
  rawEmbeddedRangeCache.delete(cacheKey);
  rawEmbeddedRangeCache.set(cacheKey, entry);
  return entry;
}

function getCachedRawEmbeddedRange(cacheKey: string | undefined): CachedEmbeddedJpegRange | null {
  if (!cacheKey) {
    return null;
  }

  const cached = rawEmbeddedRangeCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  return touchRawEmbeddedRangeCacheEntry(cacheKey, cached);
}

function setCachedRawEmbeddedRange(cacheKey: string | undefined, entry: CachedEmbeddedJpegRange): void {
  if (!cacheKey) {
    return;
  }

  rawEmbeddedRangeCache.delete(cacheKey);
  rawEmbeddedRangeCache.set(cacheKey, entry);
  while (rawEmbeddedRangeCache.size > RAW_EMBEDDED_RANGE_CACHE_MAX_ENTRIES) {
    const oldest = rawEmbeddedRangeCache.keys().next().value as string | undefined;
    if (!oldest) {
      break;
    }

    rawEmbeddedRangeCache.delete(oldest);
  }
  schedulePersistRawEmbeddedRangeCache();
}

function deleteCachedRawEmbeddedRange(cacheKey: string | undefined): void {
  if (!cacheKey) {
    return;
  }

  rawEmbeddedRangeCache.delete(cacheKey);
  schedulePersistRawEmbeddedRangeCache();
}

function runDecodeTask<T>(isRaw: boolean, task: () => Promise<T> | T): Promise<T> {
  return (isRaw ? rawDecodeSemaphore : standardDecodeSemaphore).run(task);
}

/**
 * Fast-path for standard JPG files: read only the EXIF IFD1 thumbnail (typically
 * 50–500 KB depending on the exporting application), instead of loading the full
 * source file (8–25 MB). Falls back to null if:
 *   - No IFD1 thumbnail is found in the EXIF header
 *   - The thumbnail short-side is smaller than maxDimension (would require upscaling)
 *   - The sentinel entry in cache says this file has already been checked and has no
 *     usable thumbnail
 */
async function tryReadJpegExifThumbnail(
  handle: FileHandle,
  fileSize: number,
  sourceCacheKey: string | undefined,
  maxDimension: number,
): Promise<Buffer | null> {
  await ensureJpegExifRangeCacheLoaded();

  const cached = getCachedJpegExifRange(sourceCacheKey);

  if (cached) {
    // Sentinel: already checked this file, no usable EXIF thumbnail
    if (cached.offset === JPEG_EXIF_SENTINEL_OFFSET) {
      return null;
    }

    const cachedEnd = cached.offset + cached.length;
    const rangeValid =
      cached.offset >= 0 &&
      cached.length >= 1000 &&
      cached.length <= JPEG_EXIF_HEADER_READ_BYTES &&
      cachedEnd <= fileSize;

    if (rangeValid) {
      const thumbnailBuffer = await readFileSlice(handle, cached.offset, cached.length);
      recordDesktopBytesRead("standard", thumbnailBuffer.byteLength);

      if (thumbnailBuffer.byteLength >= 1000 && thumbnailBuffer[0] === 0xff && thumbnailBuffer[1] === 0xd8) {
        // Validate that the embedded thumbnail is large enough to downscale (not upscale)
        const decoded = decodeImage(thumbnailBuffer);
        if (decoded) {
          const shortSide = Math.min(decoded.width, decoded.height);
          if (shortSide >= maxDimension) {
            return thumbnailBuffer;
          }
        }
      }

      // Range in cache is stale or too small — remove and fall through to re-probe
      setCachedJpegExifRange(sourceCacheKey, { offset: JPEG_EXIF_SENTINEL_OFFSET, length: 0 });
      return null;
    }

    // Stale cache entry (file changed size) — delete and re-probe
    setCachedJpegExifRange(sourceCacheKey, { offset: JPEG_EXIF_SENTINEL_OFFSET, length: 0 });
  }

  // Cache miss: read the header and locate the EXIF IFD1 thumbnail range
  const headerLength = Math.min(fileSize, JPEG_EXIF_HEADER_READ_BYTES);
  if (headerLength < 20) {
    setCachedJpegExifRange(sourceCacheKey, { offset: JPEG_EXIF_SENTINEL_OFFSET, length: 0 });
    return null;
  }

  const headerBuffer = await readFileSlice(handle, 0, headerLength);
  recordDesktopBytesRead("standard", headerBuffer.byteLength);

  const range = locateJpegExifThumbnailRange(
    headerBuffer.buffer.slice(
      headerBuffer.byteOffset,
      headerBuffer.byteOffset + headerBuffer.byteLength,
    ) as ArrayBuffer,
  );

  if (
    !range ||
    range.offset < 0 ||
    range.length < 1000 ||
    range.length > JPEG_EXIF_HEADER_READ_BYTES ||
    range.offset + range.length > fileSize
  ) {
    setCachedJpegExifRange(sourceCacheKey, { offset: JPEG_EXIF_SENTINEL_OFFSET, length: 0 });
    return null;
  }

  setCachedJpegExifRange(sourceCacheKey, { offset: range.offset, length: range.length });

  // The thumbnail may be fully contained within the header we already read
  if (range.offset + range.length <= headerBuffer.byteLength) {
    const thumbnailBuffer = Buffer.from(
      headerBuffer.buffer,
      headerBuffer.byteOffset + range.offset,
      range.length,
    );
    const decoded = decodeImage(thumbnailBuffer);
    if (decoded && Math.min(decoded.width, decoded.height) >= maxDimension) {
      return thumbnailBuffer;
    }
    setCachedJpegExifRange(sourceCacheKey, { offset: JPEG_EXIF_SENTINEL_OFFSET, length: 0 });
    return null;
  }

  // Thumbnail range goes beyond the header — read the slice directly
  const thumbnailBuffer = await readFileSlice(handle, range.offset, range.length);
  recordDesktopBytesRead("standard", thumbnailBuffer.byteLength);

  if (thumbnailBuffer.byteLength < 1000 || thumbnailBuffer[0] !== 0xff || thumbnailBuffer[1] !== 0xd8) {
    setCachedJpegExifRange(sourceCacheKey, { offset: JPEG_EXIF_SENTINEL_OFFSET, length: 0 });
    return null;
  }

  const decoded = decodeImage(thumbnailBuffer);
  if (!decoded || Math.min(decoded.width, decoded.height) < maxDimension) {
    setCachedJpegExifRange(sourceCacheKey, { offset: JPEG_EXIF_SENTINEL_OFFSET, length: 0 });
    return null;
  }

  return thumbnailBuffer;
}

function touchPreviewSourceCacheEntry(
  cacheKey: string,
  entry: ResolvedPreviewSource,
): ResolvedPreviewSource {
  previewSourceCache.delete(cacheKey);
  previewSourceCache.set(cacheKey, entry);
  return entry;
}

function getCachedPreviewSource(cacheKey: string): ResolvedPreviewSourceResult | null {
  const cached = previewSourceCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  return {
    source: touchPreviewSourceCacheEntry(cacheKey, cached),
    origin: "memory-cache",
    cacheHit: true,
  };
}

function trimPreviewSourceCache(): void {
  while (
    previewSourceCache.size > PREVIEW_SOURCE_CACHE_MAX_ENTRIES ||
    previewSourceCacheTotalBytes > PREVIEW_SOURCE_CACHE_MAX_BYTES
  ) {
    const oldest = previewSourceCache.entries().next().value as [string, ResolvedPreviewSource] | undefined;
    if (!oldest) {
      break;
    }

    previewSourceCache.delete(oldest[0]);
    previewSourceCacheTotalBytes = Math.max(0, previewSourceCacheTotalBytes - oldest[1].buffer.byteLength);
  }
}

function touchRenderedPreviewCacheEntry(
  cacheKey: string,
  entry: DesktopRenderedImage,
): DesktopRenderedImage {
  renderedPreviewCache.delete(cacheKey);
  renderedPreviewCache.set(cacheKey, entry);
  return entry;
}

function getCachedRenderedPreview(cacheKey: string): DesktopRenderedImage | null {
  const cached = renderedPreviewCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  return touchRenderedPreviewCacheEntry(cacheKey, cached);
}

function touchThumbnailMemoryCacheEntry(
  cacheKey: string,
  entry: DesktopRenderedImage,
): DesktopRenderedImage {
  thumbnailMemoryCache.delete(cacheKey);
  thumbnailMemoryCache.set(cacheKey, entry);
  return entry;
}

function getCachedThumbnailFromMemory(cacheKey: string): DesktopRenderedImage | null {
  const cached = thumbnailMemoryCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  recordThumbnailMetric("cacheHitRam");
  return touchThumbnailMemoryCacheEntry(cacheKey, cached);
}

function trimThumbnailMemoryCache(): void {
  while (
    thumbnailMemoryCache.size > THUMBNAIL_MEMORY_CACHE_MAX_ENTRIES ||
    thumbnailMemoryCacheTotalBytes > THUMBNAIL_MEMORY_CACHE_MAX_BYTES
  ) {
    const oldest = thumbnailMemoryCache.entries().next().value as [string, DesktopRenderedImage] | undefined;
    if (!oldest) {
      break;
    }

    thumbnailMemoryCache.delete(oldest[0]);
    thumbnailMemoryCacheTotalBytes = Math.max(0, thumbnailMemoryCacheTotalBytes - oldest[1].bytes.byteLength);
  }
}

function cacheThumbnailInMemory(cacheKey: string, rendered: DesktopRenderedImage): DesktopRenderedImage {
  const existing = thumbnailMemoryCache.get(cacheKey);
  if (existing) {
    thumbnailMemoryCacheTotalBytes = Math.max(0, thumbnailMemoryCacheTotalBytes - existing.bytes.byteLength);
  }

  thumbnailMemoryCache.delete(cacheKey);
  thumbnailMemoryCache.set(cacheKey, rendered);
  thumbnailMemoryCacheTotalBytes += rendered.bytes.byteLength;
  trimThumbnailMemoryCache();
  return rendered;
}

function trimRenderedPreviewCache(): void {
  while (
    renderedPreviewCache.size > RENDERED_PREVIEW_CACHE_MAX_ENTRIES ||
    renderedPreviewCacheTotalBytes > RENDERED_PREVIEW_CACHE_MAX_BYTES
  ) {
    const oldest = renderedPreviewCache.entries().next().value as [string, DesktopRenderedImage] | undefined;
    if (!oldest) {
      break;
    }

    renderedPreviewCache.delete(oldest[0]);
    renderedPreviewCacheTotalBytes = Math.max(0, renderedPreviewCacheTotalBytes - oldest[1].bytes.byteLength);
  }
}

function trimQuickPreviewFrameStore(): void {
  while (quickPreviewFrameStore.size > QUICK_PREVIEW_FRAME_MAX_ENTRIES) {
    const oldest = quickPreviewFrameStore.entries().next().value as [string, QuickPreviewFrameEntry] | undefined;
    if (!oldest) {
      break;
    }

    removeQuickPreviewFrameToken(oldest[0]);
  }
}

function removeQuickPreviewFrameToken(token: string): void {
  const existing = quickPreviewFrameStore.get(token);
  quickPreviewFrameStore.delete(token);
  if (existing && quickPreviewFrameTokenByCacheKey.get(existing.cacheKey) === token) {
    quickPreviewFrameTokenByCacheKey.delete(existing.cacheKey);
  }
}

function cacheRenderedPreview(cacheKey: string, rendered: DesktopRenderedImage): DesktopRenderedImage {
  const existing = renderedPreviewCache.get(cacheKey);
  if (existing) {
    renderedPreviewCacheTotalBytes = Math.max(0, renderedPreviewCacheTotalBytes - existing.bytes.byteLength);
  }

  renderedPreviewCache.delete(cacheKey);
  renderedPreviewCache.set(cacheKey, rendered);
  renderedPreviewCacheTotalBytes += rendered.bytes.byteLength;
  trimRenderedPreviewCache();
  return rendered;
}

function cachePreviewSource(cacheKey: string, source: ResolvedPreviewSource): ResolvedPreviewSource {
  const existing = previewSourceCache.get(cacheKey);
  if (existing) {
    previewSourceCacheTotalBytes = Math.max(0, previewSourceCacheTotalBytes - existing.buffer.byteLength);
  }

  previewSourceCache.delete(cacheKey);
  previewSourceCache.set(cacheKey, source);
  previewSourceCacheTotalBytes += source.buffer.byteLength;
  trimPreviewSourceCache();
  return source;
}

function isBrowserDecodablePath(absolutePath: string): boolean {
  return STANDARD_EXTENSIONS.has(extname(absolutePath).toLowerCase());
}

function isRawPath(absolutePath: string): boolean {
  return RAW_EXTENSIONS.has(extname(absolutePath).toLowerCase());
}

function getMimeTypeForPath(absolutePath: string): string {
  const ext = extname(absolutePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function getMimeTypeForBuffer(buffer: Buffer): string {
  if (
    buffer.byteLength >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    buffer.byteLength >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }

  return "image/jpeg";
}

async function readFileSlice(
  handle: FileHandle,
  offset: number,
  length: number,
): Promise<Buffer> {
  const targetLength = Math.max(0, length);
  const buffer = Buffer.allocUnsafe(targetLength);
  let totalBytesRead = 0;

  while (totalBytesRead < targetLength) {
    const { bytesRead } = await handle.read(
      buffer,
      totalBytesRead,
      targetLength - totalBytesRead,
      offset + totalBytesRead,
    );
    if (bytesRead === 0) {
      break;
    }

    totalBytesRead += bytesRead;
  }

  return totalBytesRead === targetLength
    ? buffer
    : buffer.subarray(0, totalBytesRead);
}

function toArrayBufferView(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

async function tryReadEmbeddedPreviewBuffer(
  handle: FileHandle,
  fileSize: number,
  sourceCacheKey?: string,
): Promise<Buffer | null> {
  const cachedRange = getCachedRawEmbeddedRange(sourceCacheKey);
  if (cachedRange) {
    const cachedEnd = cachedRange.offset + cachedRange.length;
    const cachedRangeLooksValid =
      cachedRange.offset >= 0
      && cachedRange.length >= MIN_EMBEDDED_JPEG_BYTES
      && cachedRange.length <= RAW_FAST_PREVIEW_MAX_BYTES
      && cachedEnd <= fileSize;

    if (cachedRangeLooksValid) {
      const cachedPreviewBuffer = await readFileSlice(handle, cachedRange.offset, cachedRange.length);
      recordDesktopBytesRead("raw", cachedPreviewBuffer.byteLength);
      if (
        cachedPreviewBuffer.byteLength >= MIN_EMBEDDED_JPEG_BYTES
        && cachedPreviewBuffer[0] === 0xff
        && cachedPreviewBuffer[1] === 0xd8
      ) {
        recordThumbnailMetric("rawOffsetHit");
        return cachedPreviewBuffer;
      }
    }

    deleteCachedRawEmbeddedRange(sourceCacheKey);
  }

  const headerLength = Math.min(fileSize, RAW_HEADER_READ_BYTES);
  if (headerLength < 12) {
    return null;
  }

  const headerBuffer = await readFileSlice(handle, 0, headerLength);
  recordDesktopBytesRead("raw", headerBuffer.byteLength);
  const candidate = locateEmbeddedJpegRange(toArrayBufferView(headerBuffer));
  if (
    !candidate ||
    candidate.offset < 0 ||
    candidate.length < MIN_EMBEDDED_JPEG_BYTES ||
    candidate.length > RAW_FAST_PREVIEW_MAX_BYTES ||
    candidate.offset + candidate.length > fileSize
  ) {
    return null;
  }

  setCachedRawEmbeddedRange(sourceCacheKey, {
    offset: candidate.offset,
    length: candidate.length,
  });

  const previewBuffer = await readFileSlice(handle, candidate.offset, candidate.length);
  recordDesktopBytesRead("raw", previewBuffer.byteLength);
  return previewBuffer.byteLength >= MIN_EMBEDDED_JPEG_BYTES ? previewBuffer : null;
}

async function resolvePreviewSourceFromBuffer(
  buffer: Buffer,
  mimeType: string,
): Promise<ResolvedPreviewSource | null> {
  if (mimeType === "image/jpeg") {
    const sharpMod = await getSharp();
    if (sharpMod) {
      try {
        const { data, info } = await sharpMod(buffer, { failOn: "none" })
          .rotate()
          .jpeg({ quality: 90 })
          .toBuffer({ resolveWithObject: true });
        if ((info.width ?? 0) > 0 && (info.height ?? 0) > 0) {
          return {
            buffer: Buffer.from(data),
            mimeType: "image/jpeg",
            width: info.width,
            height: info.height,
          };
        }
      } catch {
        // Fall back to nativeImage decode below.
      }
    }
  }

  const decoded = decodeImage(buffer);
  if (!decoded) {
    return null;
  }

  return {
    buffer,
    mimeType,
    width: decoded.width,
    height: decoded.height,
  };
}

function resolvePreviewSourceFromBufferWithBudget(
  buffer: Buffer,
  mimeType: string,
  isRaw: boolean,
): Promise<ResolvedPreviewSource | null> {
  return runDecodeTask(isRaw, () => resolvePreviewSourceFromBuffer(buffer, mimeType));
}

async function tryExtractEmbeddedPreviewFromPrefix(
  handle: FileHandle,
  fileSize: number,
): Promise<Buffer | null> {
  const prefixLength = Math.min(fileSize, RAW_PREFIX_SCAN_BYTES);
  if (prefixLength <= 0) {
    return null;
  }

  const prefixBuffer = await readFileSlice(handle, 0, prefixLength);
  recordDesktopBytesRead("raw", prefixBuffer.byteLength);
  const jpegBuffer = extractEmbeddedJpeg(toArrayBufferView(prefixBuffer));
  return jpegBuffer ? Buffer.from(jpegBuffer) : null;
}

async function tryExtractEmbeddedPreviewWithExifTool(
  absolutePath: string,
): Promise<ResolvedPreviewSource | null> {
  if (!isRawPath(absolutePath)) {
    return null;
  }

  const extension = extname(absolutePath).toLowerCase();
  const tags = JPG_FROM_RAW_FIRST_EXTENSIONS.has(extension)
    ? (["JpgFromRaw", "PreviewImage", "ThumbnailImage"] as const)
    : RAW_EXIFTOOL_TAGS;

  for (const tag of tags) {
    try {
      const previewBuffer = await rawPreviewExifTool.extractBinaryTagToBuffer(tag, absolutePath);
      if (previewBuffer.byteLength < MIN_EMBEDDED_JPEG_BYTES) {
        continue;
      }

      const resolved = await resolvePreviewSourceFromBufferWithBudget(
        previewBuffer,
        getMimeTypeForBuffer(previewBuffer),
        true,
      );
      if (resolved) {
        return resolved;
      }
    } catch {
      // Fall through to the next tag or extractor strategy.
    }
  }

  return null;
}

async function resolvePreviewBuffer(
  absolutePath: string,
  options: ResolvePreviewBufferOptions = {},
): Promise<ResolvedPreviewSourceResult | null> {
  const sourceFileKey = options.sourceFileKey;
  const allowExifTool = options.allowExifTool !== false;
  const allowFullRead = options.allowFullRead !== false;
  const sourceCacheKey = getPreviewSourceCacheKey(absolutePath, sourceFileKey);

  await ensureRawEmbeddedRangeCacheLoaded();

  const cached = getCachedPreviewSource(sourceCacheKey);
  if (cached) {
    return cached;
  }

  const pending = previewSourcePromiseCache.get(sourceCacheKey);
  if (pending) {
    return pending;
  }

  const task = (async (): Promise<ResolvedPreviewSourceResult | null> => {
    let handle: FileHandle | null = null;

    try {
      handle = await open(absolutePath, "r");
      if (isBrowserDecodablePath(absolutePath)) {
        const fileBuffer = await handle.readFile();
        recordDesktopBytesRead("standard", fileBuffer.byteLength);
        const resolved = await resolvePreviewSourceFromBufferWithBudget(
          fileBuffer,
          getMimeTypeForPath(absolutePath),
          false,
        );
        return resolved
          ? {
              source: cachePreviewSource(sourceCacheKey, resolved),
              origin: "source-file",
              cacheHit: false,
            }
          : null;
      }

      const stats = await handle.stat();
      const fastPreviewBuffer = await tryReadEmbeddedPreviewBuffer(handle, stats.size, sourceCacheKey);
      if (fastPreviewBuffer) {
        const resolved = await resolvePreviewSourceFromBufferWithBudget(
          fastPreviewBuffer,
          "image/jpeg",
          true,
        );
        if (resolved) {
          return {
            source: cachePreviewSource(sourceCacheKey, resolved),
            origin: "embedded-preview",
            cacheHit: false,
          };
        }
      }

      if (allowExifTool) {
        const exifToolPreview = await tryExtractEmbeddedPreviewWithExifTool(absolutePath);
        if (exifToolPreview) {
          return {
            source: cachePreviewSource(sourceCacheKey, exifToolPreview),
            origin: "embedded-preview",
            cacheHit: false,
          };
        }
      }

      const prefixPreviewBuffer = await tryExtractEmbeddedPreviewFromPrefix(handle, stats.size);
      if (prefixPreviewBuffer) {
        const resolved = await resolvePreviewSourceFromBufferWithBudget(
          prefixPreviewBuffer,
          "image/jpeg",
          true,
        );
        if (resolved) {
          return {
            source: cachePreviewSource(sourceCacheKey, resolved),
            origin: "embedded-preview",
            cacheHit: false,
          };
        }
      }

      if (!allowFullRead) {
        return null;
      }

      const fileBuffer = await handle.readFile();
      recordDesktopBytesRead("raw", fileBuffer.byteLength);

      const arrayBuffer = toArrayBufferView(fileBuffer);
      const jpegBuffer = extractEmbeddedJpeg(arrayBuffer);
      if (!jpegBuffer) {
        return null;
      }

      const resolved = await resolvePreviewSourceFromBufferWithBudget(
        Buffer.from(jpegBuffer),
        "image/jpeg",
        true,
      );
      return resolved
        ? {
            source: cachePreviewSource(sourceCacheKey, resolved),
            origin: "embedded-preview",
            cacheHit: false,
          }
        : null;
    } catch {
      return null;
    } finally {
      previewSourcePromiseCache.delete(sourceCacheKey);
      await handle?.close().catch(() => {});
    }
  })();

  previewSourcePromiseCache.set(sourceCacheKey, task);
  return task;
}

function decodeImage(buffer: Buffer) {
  const decoded = nativeImage.createFromBuffer(buffer);
  if (decoded.isEmpty()) {
    return null;
  }

  const { width, height } = decoded.getSize();
  if (width <= 0 || height <= 0) {
    return null;
  }

  return { decoded, width, height };
}

async function renderNativePreviewFromPath(
  absolutePath: string,
  maxDimension: number,
): Promise<DesktopRenderedImage | null> {
  if (maxDimension <= 0) {
    return null;
  }

  // Fast-path: use sharp (libjpeg-turbo, multi-threaded) — 2-4× faster than
  // Windows Shell for cold in-camera JPEGs.
  const sharpMod = await getSharp();
  if (sharpMod) {
    try {
      const { data, info } = await sharpMod(absolutePath)
        .rotate() // honour EXIF orientation
        .resize(maxDimension, maxDimension, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer({ resolveWithObject: true });
      if (info.width > 0 && info.height > 0) {
        return {
          bytes: new Uint8Array(data),
          mimeType: "image/jpeg",
          width: info.width,
          height: info.height,
        };
      }
    } catch {
      // fall through to nativeImage
    }
  }

  // Fallback: Windows Shell thumbnail (slower on cold reads)
  try {
    const thumbnail = await nativeImage.createThumbnailFromPath(absolutePath, {
      width: maxDimension,
      height: maxDimension,
    });
    if (thumbnail.isEmpty()) {
      return null;
    }

    const { width, height } = thumbnail.getSize();
    if (width <= 0 || height <= 0) {
      return null;
    }

    const previewBuffer = thumbnail.toJPEG(90);
    return {
      bytes: toOwnedUint8Array(previewBuffer),
      mimeType: "image/jpeg",
      width,
      height,
    };
  } catch {
    return null;
  }
}

export async function getDesktopPreview(
  absolutePath: string,
  maxDimension = 0,
  sourceFileKey?: string,
): Promise<DesktopRenderedImage | null> {
  const result = await getDesktopPreviewInternal(absolutePath, maxDimension, sourceFileKey);
  return result?.rendered ?? null;
}

async function getDesktopPreviewInternal(
  absolutePath: string,
  maxDimension = 0,
  sourceFileKey?: string,
): Promise<DesktopPreviewRenderResult | null> {
  const cacheKey = getRenderedPreviewCacheKey(absolutePath, maxDimension, sourceFileKey);
  const rawPath = isRawPath(absolutePath);
  const cachedRendered = getCachedRenderedPreview(cacheKey);
  if (cachedRendered) {
    if (rawPath) {
      recordThumbnailMetric("rawRenderCacheHit");
    }
    return {
      rendered: cachedRendered,
      source: "memory-cache",
      cacheHit: true,
      cacheKey,
    };
  }

  const pendingRendered = renderedPreviewPromiseCache.get(cacheKey);
  if (pendingRendered) {
    return pendingRendered;
  }

  const task = (async (): Promise<DesktopPreviewRenderResult | null> => {
    const cachedDiskPreview = await getCachedPreviewFromDisk(absolutePath, sourceFileKey, maxDimension);
    if (cachedDiskPreview) {
      if (rawPath) {
        recordThumbnailMetric("rawRenderCacheHit");
      }
      return {
        rendered: cacheRenderedPreview(cacheKey, cachedDiskPreview),
        source: "disk-cache",
        cacheHit: true,
        cacheKey,
      };
    }

    if (!rawPath) {
      const nativePreview = await runDecodeTask(false, () => renderNativePreviewFromPath(absolutePath, maxDimension));
      if (nativePreview) {
        const rendered = cacheRenderedPreview(cacheKey, nativePreview);
        void storePreviewInDiskCache(absolutePath, sourceFileKey, maxDimension, rendered);
        return {
          rendered,
          source: "native-provider",
          cacheHit: false,
          cacheKey,
        };
      }
    }

    const source = await resolvePreviewBuffer(absolutePath, { sourceFileKey });
    if (!source && rawPath) {
      const nativePreview = await runDecodeTask(true, () => renderNativePreviewFromPath(absolutePath, maxDimension));
      if (nativePreview) {
        const rendered = cacheRenderedPreview(cacheKey, nativePreview);
        void storePreviewInDiskCache(absolutePath, sourceFileKey, maxDimension, rendered);
        return {
          rendered,
          source: "native-provider",
          cacheHit: false,
          cacheKey,
        };
      }
    }

    if (!source) {
      return null;
    }

    if (maxDimension <= 0 || Math.max(source.source.width, source.source.height) <= maxDimension) {
      const rendered = cacheRenderedPreview(cacheKey, {
        bytes: toOwnedUint8Array(source.source.buffer),
        mimeType: source.source.mimeType,
        width: source.source.width,
        height: source.source.height,
      });
      void storePreviewInDiskCache(absolutePath, sourceFileKey, maxDimension, rendered);
      return {
        rendered,
        source: source.origin,
        cacheHit: source.cacheHit,
        cacheKey,
      };
    }

    return runDecodeTask(rawPath, async () => {
      const decoded = decodeImage(source.source.buffer);
      if (!decoded) {
        return null;
      }

      const scale = Math.min(1, maxDimension / Math.max(decoded.width, decoded.height));
      const targetWidth = Math.max(1, Math.round(decoded.width * scale));
      const targetHeight = Math.max(1, Math.round(decoded.height * scale));
      const resized = decoded.decoded.resize({
        width: targetWidth,
        height: targetHeight,
        quality: "good",
      });
      const previewBuffer = resized.toJPEG(90);
      const rendered = cacheRenderedPreview(cacheKey, {
        bytes: toOwnedUint8Array(previewBuffer),
        mimeType: "image/jpeg",
        width: targetWidth,
        height: targetHeight,
      });
      void storePreviewInDiskCache(absolutePath, sourceFileKey, maxDimension, rendered);
      return {
        rendered,
        source: source.origin,
        cacheHit: source.cacheHit,
        cacheKey,
      };
    });
  })().finally(() => {
    renderedPreviewPromiseCache.delete(cacheKey);
  });

  renderedPreviewPromiseCache.set(cacheKey, task);
  return task;
}

export async function warmDesktopPreview(
  absolutePath: string,
  maxDimension = 0,
  sourceFileKey?: string,
): Promise<boolean> {
  const rendered = await getDesktopPreview(absolutePath, maxDimension, sourceFileKey);
  return Boolean(rendered);
}

function buildQuickPreviewFrameSrc(token: string): string {
  return `${QUICK_PREVIEW_PROTOCOL_SCHEME}://frame/${encodeURIComponent(token)}`;
}

function registerQuickPreviewFrame(
  entry: QuickPreviewFrameEntry,
): DesktopQuickPreviewFrame {
  const existingToken = quickPreviewFrameTokenByCacheKey.get(entry.cacheKey);
  const token = existingToken ?? randomUUID();
  quickPreviewFrameStore.delete(token);
  quickPreviewFrameStore.set(token, {
    ...entry,
    createdAt: Date.now(),
  });
  quickPreviewFrameTokenByCacheKey.set(entry.cacheKey, token);
  trimQuickPreviewFrameStore();

  return {
    token,
    src: buildQuickPreviewFrameSrc(token),
    width: entry.width,
    height: entry.height,
    stage: entry.stage,
    source: entry.source,
    cacheHit: entry.cacheHit,
  };
}

export function getQuickPreviewFrameContent(
  token: string,
): { bytes: Uint8Array; mimeType: string } | null {
  const frame = quickPreviewFrameStore.get(token);
  if (!frame) {
    return null;
  }

  const rendered = getCachedRenderedPreview(frame.cacheKey);
  if (!rendered) {
    removeQuickPreviewFrameToken(token);
    return null;
  }

  quickPreviewFrameStore.delete(token);
  quickPreviewFrameStore.set(token, {
    ...frame,
    createdAt: Date.now(),
  });
  return {
    bytes: rendered.bytes,
    mimeType: frame.mimeType,
  };
}

export async function getDesktopQuickPreviewFrame(
  request: DesktopQuickPreviewRequest,
): Promise<DesktopQuickPreviewFrame | null> {
  const result = await getDesktopPreviewInternal(
    request.absolutePath,
    request.maxDimension,
    request.sourceFileKey,
  );
  if (!result) {
    return null;
  }

  return registerQuickPreviewFrame({
    cacheKey: result.cacheKey,
    width: result.rendered.width,
    height: result.rendered.height,
    mimeType: result.rendered.mimeType,
    stage: request.stage,
    source: result.source,
    cacheHit: result.cacheHit,
    createdAt: Date.now(),
  });
}

export async function warmDesktopQuickPreviewFrames(
  requests: DesktopQuickPreviewRequest[],
): Promise<DesktopQuickPreviewWarmResult> {
  const uniqueRequests = requests.filter((request, index, current) =>
    current.findIndex((candidate) =>
      candidate.absolutePath === request.absolutePath
      && candidate.maxDimension === request.maxDimension
      && candidate.stage === request.stage
      && candidate.sourceFileKey === request.sourceFileKey,
    ) === index,
  );

  let warmedCount = 0;
  let cacheHitCount = 0;

  const settled = await Promise.allSettled(
    uniqueRequests.map(async (request) => {
      const result = await getDesktopPreviewInternal(
        request.absolutePath,
        request.maxDimension,
        request.sourceFileKey,
      );
      if (!result) {
        return null;
      }

      warmedCount += 1;
      if (result.cacheHit) {
        cacheHitCount += 1;
      }

      return result;
    }),
  );

  const failedCount = settled.filter((entry) => entry.status === "rejected" || entry.value === null).length;
  return {
    requestedCount: uniqueRequests.length,
    warmedCount,
    cacheHitCount,
    failedCount,
  };
}

export function releaseDesktopQuickPreviewFrames(tokens: string[]): void {
  for (const token of tokens) {
    removeQuickPreviewFrameToken(token);
  }
}

function renderThumbnailFromResolvedSource(
  source: ResolvedPreviewSourceResult,
  maxDimension: number,
  quality: number,
): DesktopRenderedImage | null {
  const decoded = decodeImage(source.source.buffer);
  if (!decoded) {
    return null;
  }

  const scale = Math.min(1, maxDimension / Math.max(decoded.width, decoded.height));
  const targetWidth = Math.max(1, Math.round(decoded.width * scale));
  const targetHeight = Math.max(1, Math.round(decoded.height * scale));
  const resized = decoded.decoded.resize({
    width: targetWidth,
    height: targetHeight,
    quality: "good",
  });
  const jpegQuality = Math.max(1, Math.min(100, Math.round(quality * 100)));
  const thumbnailBuffer = resized.toJPEG(jpegQuality);
  return {
    bytes: toOwnedUint8Array(thumbnailBuffer),
    mimeType: "image/jpeg",
    width: source.source.width,
    height: source.source.height,
  };
}

async function computeDesktopThumbnail(
  absolutePath: string,
  maxDimension: number,
  quality: number,
  sourceFileKey?: string,
): Promise<DesktopRenderedImage | null> {
  const dedupeKey = buildThumbnailDedupeKey(absolutePath, maxDimension, quality, sourceFileKey);
  const memoryCached = getCachedThumbnailFromMemory(dedupeKey);
  if (memoryCached) {
    return memoryCached;
  }

  const cached = await getCachedThumbnailsFromDisk(
    [{ id: absolutePath, absolutePath, sourceFileKey }],
    maxDimension,
    quality,
  );
  const cachedHit = cached[0];
  if (cachedHit) {
    recordThumbnailMetric("cacheHitDisk");
    return cacheThumbnailInMemory(dedupeKey, {
      bytes: cachedHit.bytes,
      mimeType: cachedHit.mimeType,
      width: cachedHit.width,
      height: cachedHit.height,
    });
  }

  const rawPath = isRawPath(absolutePath);

  if (!rawPath) {
    // Fast-path: try to read the EXIF IFD1 thumbnail (50–500 KB partial read) before
    // falling back to nativeImage.createThumbnailFromPath (which may read the entire
    // file if the Windows Shell thumbnail cache is cold).
    let exifFastPathSucceeded = false;
    let handle: FileHandle | null = null;
    try {
      handle = await open(absolutePath, "r");
      const stats = await handle.stat();
      const sourceCacheKey = getPreviewSourceCacheKey(absolutePath, sourceFileKey);
      const exifThumbnailBuffer = await tryReadJpegExifThumbnail(handle, stats.size, sourceCacheKey, maxDimension);
      if (exifThumbnailBuffer) {
        const source: ResolvedPreviewSourceResult = {
          source: {
            buffer: exifThumbnailBuffer,
            mimeType: getMimeTypeForBuffer(exifThumbnailBuffer),
            width: 0, // will be ignored — renderThumbnailFromResolvedSource decodes inline
            height: 0,
          },
          origin: "embedded-preview",
          cacheHit: false,
        };
        // Decode dimensions properly before rendering
        const decoded = decodeImage(exifThumbnailBuffer);
        if (decoded) {
          source.source.width = decoded.width;
          source.source.height = decoded.height;
          const rendered = await runDecodeTask(false, () => renderThumbnailFromResolvedSource(source, maxDimension, quality));
          if (rendered) {
            const cachedRendered = cacheThumbnailInMemory(dedupeKey, rendered);
            void storeThumbnailInDiskCache(absolutePath, sourceFileKey, maxDimension, quality, cachedRendered);
            exifFastPathSucceeded = true;
            return cachedRendered;
          }
        }
      }
    } catch {
      // Fast-path is best-effort; fall through to standard path below
    } finally {
      await handle?.close().catch(() => {});
    }

    if (!exifFastPathSucceeded) {
      const nativeRendered = await runDecodeTask(false, () => renderNativePreviewFromPath(absolutePath, maxDimension));
      if (nativeRendered) {
        const rendered = cacheThumbnailInMemory(dedupeKey, nativeRendered);
        void storeThumbnailInDiskCache(absolutePath, sourceFileKey, maxDimension, quality, rendered);
        return rendered;
      }

      const source = await resolvePreviewBuffer(absolutePath, {
        sourceFileKey,
        allowExifTool: false,
      });
      if (!source) {
        return null;
      }

      const rendered = await runDecodeTask(false, () => renderThumbnailFromResolvedSource(source, maxDimension, quality));
      if (!rendered) {
        return null;
      }

      const cachedRendered = cacheThumbnailInMemory(dedupeKey, rendered);
      void storeThumbnailInDiskCache(absolutePath, sourceFileKey, maxDimension, quality, cachedRendered);
      return cachedRendered;
    }

    return null; // unreachable but satisfies TypeScript
  }

  let source = await resolvePreviewBuffer(absolutePath, {
    sourceFileKey,
    allowExifTool: false,
    allowFullRead: false,
  });

  if (!source) {
    const nativeRendered = await runDecodeTask(true, () => renderNativePreviewFromPath(absolutePath, maxDimension));
    if (nativeRendered) {
      const rendered = cacheThumbnailInMemory(dedupeKey, nativeRendered);
      void storeThumbnailInDiskCache(absolutePath, sourceFileKey, maxDimension, quality, rendered);
      return rendered;
    }
  }

  if (!source) {
    source = await resolvePreviewBuffer(absolutePath, {
      sourceFileKey,
      allowExifTool: false,
      allowFullRead: true,
    });
  }

  if (!source) {
    return null;
  }

  const rendered = await runDecodeTask(true, () => renderThumbnailFromResolvedSource(source, maxDimension, quality));
  if (!rendered) {
    return null;
  }

  const cachedRendered = cacheThumbnailInMemory(dedupeKey, rendered);
  void storeThumbnailInDiskCache(absolutePath, sourceFileKey, maxDimension, quality, cachedRendered);
  return cachedRendered;
}

function dispatchBatchedThumbnailRequest(request: BatchedThumbnailRequest): void {
  const existingInFlight = inFlightThumbnailSingleFlight.get(request.dedupeKey);
  if (existingInFlight) {
    recordThumbnailMetric("singleFlightHit");
    existingInFlight.then((value) => {
      for (const resolve of request.resolvers) {
        resolve(value);
      }
    });
    return;
  }

  const task = computeDesktopThumbnail(
    request.absolutePath,
    request.maxDimension,
    request.quality,
    request.sourceFileKey,
  )
    .catch(() => null)
    .finally(() => {
      inFlightThumbnailSingleFlight.delete(request.dedupeKey);
    });

  inFlightThumbnailSingleFlight.set(request.dedupeKey, task);

  task.then((value) => {
    for (const resolve of request.resolvers) {
      resolve(value);
    }
  });
}

function scheduleThumbnailBatchFlush(): void {
  if (thumbnailBatchTimer !== null) {
    return;
  }

  thumbnailBatchTimer = setTimeout(() => {
    thumbnailBatchTimer = null;
    flushThumbnailBatch();
  }, THUMBNAIL_BATCH_WINDOW_MS);
}

function flushThumbnailBatch(): void {
  const keys = thumbnailBatchOrder.splice(0, THUMBNAIL_BATCH_MAX_ITEMS);
  for (const key of keys) {
    const request = thumbnailBatchQueue.get(key);
    if (!request) {
      continue;
    }

    thumbnailBatchQueue.delete(key);
    dispatchBatchedThumbnailRequest(request);
  }

  if (thumbnailBatchOrder.length > 0) {
    scheduleThumbnailBatchFlush();
  }
}

export function getDesktopThumbnail(
  absolutePath: string,
  maxDimension: number,
  quality: number,
  sourceFileKey?: string,
): Promise<DesktopRenderedImage | null> {
  recordThumbnailRequest();

  const dedupeKey = buildThumbnailDedupeKey(absolutePath, maxDimension, quality, sourceFileKey);
  const cachedInMemory = getCachedThumbnailFromMemory(dedupeKey);
  if (cachedInMemory) {
    return Promise.resolve(cachedInMemory);
  }

  const existingInFlight = inFlightThumbnailSingleFlight.get(dedupeKey);
  if (existingInFlight) {
    recordThumbnailMetric("singleFlightHit");
    return existingInFlight;
  }

  return new Promise<DesktopRenderedImage | null>((resolve) => {
    const pending = thumbnailBatchQueue.get(dedupeKey);
    if (pending) {
      recordThumbnailMetric("singleFlightHit");
      pending.resolvers.push(resolve);
      return;
    }

    thumbnailBatchQueue.set(dedupeKey, {
      dedupeKey,
      absolutePath,
      maxDimension,
      quality,
      sourceFileKey,
      resolvers: [resolve],
    });
    thumbnailBatchOrder.push(dedupeKey);

    if (thumbnailBatchOrder.length >= THUMBNAIL_BATCH_MAX_ITEMS) {
      if (thumbnailBatchTimer !== null) {
        clearTimeout(thumbnailBatchTimer);
        thumbnailBatchTimer = null;
      }
      queueMicrotask(() => flushThumbnailBatch());
      return;
    }

    scheduleThumbnailBatchFlush();
  });
}

export function getDesktopDisplayName(absolutePath: string): string {
  return basename(absolutePath);
}

export async function shutdownDesktopImageService(): Promise<void> {
  if (thumbnailBatchTimer !== null) {
    clearTimeout(thumbnailBatchTimer);
    thumbnailBatchTimer = null;
  }
  if (rawEmbeddedRangeCachePersistTimer !== null) {
    clearTimeout(rawEmbeddedRangeCachePersistTimer);
    rawEmbeddedRangeCachePersistTimer = null;
  }
  if (jpegExifRangeCachePersistTimer !== null) {
    clearTimeout(jpegExifRangeCachePersistTimer);
    jpegExifRangeCachePersistTimer = null;
  }
  await persistRawEmbeddedRangeCache().catch(() => {});
  await persistJpegExifRangeCache().catch(() => {});

  previewSourcePromiseCache.clear();
  previewSourceCache.clear();
  previewSourceCacheTotalBytes = 0;
  renderedPreviewPromiseCache.clear();
  renderedPreviewCache.clear();
  renderedPreviewCacheTotalBytes = 0;
  thumbnailMemoryCache.clear();
  thumbnailMemoryCacheTotalBytes = 0;
  rawEmbeddedRangeCache.clear();
  jpegExifRangeCache.clear();
  thumbnailBatchQueue.clear();
  thumbnailBatchOrder.splice(0, thumbnailBatchOrder.length);
  inFlightThumbnailSingleFlight.clear();
  quickPreviewFrameStore.clear();
  quickPreviewFrameTokenByCacheKey.clear();
  await rawPreviewExifTool.end().catch(() => {});
}
