import { nativeImage } from "electron";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { DesktopRenderedImage } from "@photo-tools/desktop-contracts";
import { extractEmbeddedJpeg } from "./raw-jpeg-extractor.js";

const STANDARD_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

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

async function resolvePreviewBuffer(absolutePath: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const fileBuffer = await readFile(absolutePath);
    if (isBrowserDecodablePath(absolutePath)) {
      return {
        buffer: fileBuffer,
        mimeType: getMimeTypeForPath(absolutePath),
      };
    }

    const arrayBuffer = fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength,
    );
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
): Promise<DesktopRenderedImage | null> {
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

  return {
    bytes: toOwnedUint8Array(thumbnailBuffer),
    mimeType: "image/jpeg",
    width: decoded.width,
    height: decoded.height,
  };
}

export function getDesktopDisplayName(absolutePath: string): string {
  return basename(absolutePath);
}
