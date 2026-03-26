import { app, nativeImage } from "electron";
import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { DesktopRenderedImage } from "@photo-tools/desktop-contracts";
import { extractEmbeddedJpeg, locateEmbeddedJpegRange } from "./raw-jpeg-extractor.js";
import {
  getCachedThumbnailsFromDisk,
  storeThumbnailInDiskCache,
} from "./thumbnail-disk-cache.js";

const STANDARD_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const RAW_HEADER_READ_BYTES = 512 * 1024;
const MIN_EMBEDDED_JPEG_BYTES = 10_000;
const PERF_ENABLED = !app.isPackaged;

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

function isBrowserDecodablePath(absolutePath: string): boolean {
  return STANDARD_EXTENSIONS.has(extname(absolutePath).toLowerCase());
}

function getMimeTypeForPath(absolutePath: string): string {
  const ext = extname(absolutePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
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
    candidate.offset + candidate.length > fileSize
  ) {
    return null;
  }

  const previewBuffer = await readFileSlice(handle, candidate.offset, candidate.length);
  recordDesktopBytesRead("raw", previewBuffer.byteLength);
  return previewBuffer.byteLength >= MIN_EMBEDDED_JPEG_BYTES ? previewBuffer : null;
}

async function resolvePreviewBuffer(absolutePath: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  let handle: FileHandle | null = null;

  try {
    handle = await open(absolutePath, "r");
    if (isBrowserDecodablePath(absolutePath)) {
      const fileBuffer = await handle.readFile();
      recordDesktopBytesRead("standard", fileBuffer.byteLength);
      return {
        buffer: fileBuffer,
        mimeType: getMimeTypeForPath(absolutePath),
      };
    }

    const stats = await handle.stat();
    const fastPreviewBuffer = await tryReadEmbeddedPreviewBuffer(handle, stats.size);
    if (fastPreviewBuffer && decodeImage(fastPreviewBuffer)) {
      return {
        buffer: fastPreviewBuffer,
        mimeType: "image/jpeg",
      };
    }

    const fileBuffer = await handle.readFile();
    recordDesktopBytesRead("raw", fileBuffer.byteLength);

    const arrayBuffer = toArrayBufferView(fileBuffer);
    const jpegBuffer = extractEmbeddedJpeg(arrayBuffer);
    if (!jpegBuffer) {
      return null;
    }

    return {
      buffer: Buffer.from(jpegBuffer),
      mimeType: "image/jpeg",
    };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
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

export async function getDesktopPreview(absolutePath: string): Promise<DesktopRenderedImage | null> {
  const source = await resolvePreviewBuffer(absolutePath);
  if (!source) {
    return null;
  }

  const decoded = decodeImage(source.buffer);
  if (!decoded) {
    return null;
  }

  return {
    bytes: toOwnedUint8Array(source.buffer),
    mimeType: source.mimeType,
    width: decoded.width,
    height: decoded.height,
  };
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

  const source = await resolvePreviewBuffer(absolutePath);
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
    width: decoded.width,
    height: decoded.height,
  };
  void storeThumbnailInDiskCache(absolutePath, sourceFileKey, maxDimension, quality, rendered);
  return rendered;
}

export function getDesktopDisplayName(absolutePath: string): string {
  return basename(absolutePath);
}
