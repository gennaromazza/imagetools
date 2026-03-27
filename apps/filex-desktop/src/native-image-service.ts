import { app, nativeImage } from "electron";
import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { basename, extname } from "node:path";
import type { DesktopRenderedImage } from "@photo-tools/desktop-contracts";
import { ExifTool } from "exiftool-vendored";
import { extractEmbeddedJpeg, locateEmbeddedJpegRange } from "./raw-jpeg-extractor.js";
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
const PREVIEW_SOURCE_CACHE_MAX_ENTRIES = 24;
const PREVIEW_SOURCE_CACHE_MAX_BYTES = 96 * 1024 * 1024;
const RENDERED_PREVIEW_CACHE_MAX_ENTRIES = 48;
const RENDERED_PREVIEW_CACHE_MAX_BYTES = 160 * 1024 * 1024;
const PERF_ENABLED = !app.isPackaged;
const RAW_EXIFTOOL_MAX_PROCS = Math.max(2, Math.min(8, Math.ceil(availableParallelism() / 2)));
const RAW_EXIFTOOL_TAGS = ["PreviewImage", "JpgFromRaw", "ThumbnailImage"] as const;
const JPG_FROM_RAW_FIRST_EXTENSIONS = new Set([".nef", ".nrw", ".rw2"]);

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

const previewSourceCache = new Map<string, ResolvedPreviewSource>();
const previewSourcePromiseCache = new Map<string, Promise<ResolvedPreviewSource | null>>();
let previewSourceCacheTotalBytes = 0;
const renderedPreviewCache = new Map<string, DesktopRenderedImage>();
let renderedPreviewCacheTotalBytes = 0;
const rawPreviewExifTool = new ExifTool({
  maxProcs: RAW_EXIFTOOL_MAX_PROCS,
  spawnTimeoutMillis: 60_000,
  taskTimeoutMillis: 60_000,
});

function touchPreviewSourceCacheEntry(
  cacheKey: string,
  entry: ResolvedPreviewSource,
): ResolvedPreviewSource {
  previewSourceCache.delete(cacheKey);
  previewSourceCache.set(cacheKey, entry);
  return entry;
}

function getCachedPreviewSource(cacheKey: string): ResolvedPreviewSource | null {
  const cached = previewSourceCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  return touchPreviewSourceCacheEntry(cacheKey, cached);
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

function getRenderedPreviewCacheKey(absolutePath: string, maxDimension: number): string {
  return `${absolutePath}::${Math.max(0, Math.round(maxDimension))}`;
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
): Promise<Buffer | null> {
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

  const previewBuffer = await readFileSlice(handle, candidate.offset, candidate.length);
  recordDesktopBytesRead("raw", previewBuffer.byteLength);
  return previewBuffer.byteLength >= MIN_EMBEDDED_JPEG_BYTES ? previewBuffer : null;
}

function resolvePreviewSourceFromBuffer(
  buffer: Buffer,
  mimeType: string,
): ResolvedPreviewSource | null {
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

      const resolved = resolvePreviewSourceFromBuffer(
        previewBuffer,
        getMimeTypeForBuffer(previewBuffer),
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

async function resolvePreviewBuffer(absolutePath: string): Promise<ResolvedPreviewSource | null> {
  const cached = getCachedPreviewSource(absolutePath);
  if (cached) {
    return cached;
  }

  const pending = previewSourcePromiseCache.get(absolutePath);
  if (pending) {
    return pending;
  }

  const task = (async (): Promise<ResolvedPreviewSource | null> => {
    let handle: FileHandle | null = null;

    try {
      handle = await open(absolutePath, "r");
      if (isBrowserDecodablePath(absolutePath)) {
        const fileBuffer = await handle.readFile();
        recordDesktopBytesRead("standard", fileBuffer.byteLength);
        const resolved = resolvePreviewSourceFromBuffer(
          fileBuffer,
          getMimeTypeForPath(absolutePath),
        );
        return resolved ? cachePreviewSource(absolutePath, resolved) : null;
      }

      const stats = await handle.stat();
      const fastPreviewBuffer = await tryReadEmbeddedPreviewBuffer(handle, stats.size);
      if (fastPreviewBuffer) {
        const resolved = resolvePreviewSourceFromBuffer(fastPreviewBuffer, "image/jpeg");
        if (resolved) {
          return cachePreviewSource(absolutePath, resolved);
        }
      }

      const exifToolPreview = await tryExtractEmbeddedPreviewWithExifTool(absolutePath);
      if (exifToolPreview) {
        return cachePreviewSource(absolutePath, exifToolPreview);
      }

      const prefixPreviewBuffer = await tryExtractEmbeddedPreviewFromPrefix(handle, stats.size);
      if (prefixPreviewBuffer) {
        const resolved = resolvePreviewSourceFromBuffer(prefixPreviewBuffer, "image/jpeg");
        if (resolved) {
          return cachePreviewSource(absolutePath, resolved);
        }
      }

      const fileBuffer = await handle.readFile();
      recordDesktopBytesRead("raw", fileBuffer.byteLength);

      const arrayBuffer = toArrayBufferView(fileBuffer);
      const jpegBuffer = extractEmbeddedJpeg(arrayBuffer);
      if (!jpegBuffer) {
        return null;
      }

      const resolved = resolvePreviewSourceFromBuffer(Buffer.from(jpegBuffer), "image/jpeg");
      return resolved ? cachePreviewSource(absolutePath, resolved) : null;
    } catch {
      return null;
    } finally {
      previewSourcePromiseCache.delete(absolutePath);
      await handle?.close().catch(() => {});
    }
  })();

  previewSourcePromiseCache.set(absolutePath, task);
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
  const cacheKey = getRenderedPreviewCacheKey(absolutePath, maxDimension);
  const cachedRendered = getCachedRenderedPreview(cacheKey);
  if (cachedRendered) {
    return cachedRendered;
  }

  const cachedDiskPreview = await getCachedPreviewFromDisk(absolutePath, sourceFileKey, maxDimension);
  if (cachedDiskPreview) {
    return cacheRenderedPreview(cacheKey, cachedDiskPreview);
  }

  if (!isRawPath(absolutePath)) {
    const nativePreview = await renderNativePreviewFromPath(absolutePath, maxDimension);
    if (nativePreview) {
      const rendered = cacheRenderedPreview(cacheKey, nativePreview);
      void storePreviewInDiskCache(absolutePath, sourceFileKey, maxDimension, rendered);
      return rendered;
    }
  }

  const source = await resolvePreviewBuffer(absolutePath);
  if (!source && isRawPath(absolutePath)) {
    const nativePreview = await renderNativePreviewFromPath(absolutePath, maxDimension);
    if (nativePreview) {
      const rendered = cacheRenderedPreview(cacheKey, nativePreview);
      void storePreviewInDiskCache(absolutePath, sourceFileKey, maxDimension, rendered);
      return rendered;
    }
  }

  if (!source) {
    return null;
  }

  if (maxDimension <= 0 || Math.max(source.width, source.height) <= maxDimension) {
    const rendered = cacheRenderedPreview(cacheKey, {
      bytes: toOwnedUint8Array(source.buffer),
      mimeType: source.mimeType,
      width: source.width,
      height: source.height,
    });
    void storePreviewInDiskCache(absolutePath, sourceFileKey, maxDimension, rendered);
    return rendered;
  }

  const decoded = decodeImage(source.buffer);
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
  return rendered;
}

export async function warmDesktopPreview(
  absolutePath: string,
  maxDimension = 0,
  sourceFileKey?: string,
): Promise<boolean> {
  const rendered = await getDesktopPreview(absolutePath, maxDimension, sourceFileKey);
  return Boolean(rendered);
}

export async function getDesktopThumbnail(
  absolutePath: string,
  maxDimension: number,
  quality: number,
  sourceFileKey?: string,
): Promise<DesktopRenderedImage | null> {
  const cached = await getCachedThumbnailsFromDisk(
    [{ id: absolutePath, absolutePath, sourceFileKey }],
    maxDimension,
    quality,
  );
  const cachedHit = cached[0];
  if (cachedHit) {
    return {
      bytes: cachedHit.bytes,
      mimeType: cachedHit.mimeType,
      width: cachedHit.width,
      height: cachedHit.height,
    };
  }

  if (!isRawPath(absolutePath)) {
    const nativeRendered = await renderNativePreviewFromPath(absolutePath, maxDimension);
    if (nativeRendered) {
      void storeThumbnailInDiskCache(absolutePath, sourceFileKey, maxDimension, quality, nativeRendered);
      return nativeRendered;
    }
  }

  const source = await resolvePreviewBuffer(absolutePath);
  if (!source && isRawPath(absolutePath)) {
    const nativeRendered = await renderNativePreviewFromPath(absolutePath, maxDimension);
    if (nativeRendered) {
      void storeThumbnailInDiskCache(absolutePath, sourceFileKey, maxDimension, quality, nativeRendered);
      return nativeRendered;
    }
  }

  if (!source) {
    return null;
  }

  const decoded = decodeImage(source.buffer);
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
  const rendered: DesktopRenderedImage = {
    bytes: toOwnedUint8Array(thumbnailBuffer),
    mimeType: "image/jpeg",
    width: source.width,
    height: source.height,
  };
  void storeThumbnailInDiskCache(absolutePath, sourceFileKey, maxDimension, quality, rendered);
  return rendered;
}

export function getDesktopDisplayName(absolutePath: string): string {
  return basename(absolutePath);
}

export async function shutdownDesktopImageService(): Promise<void> {
  previewSourcePromiseCache.clear();
  await rawPreviewExifTool.end().catch(() => {});
}
