import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ImageAsset, ImageOrientation } from "@photo-tools/shared-types";

export const SUPPORTED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png"];

function detectOrientation(width: number, height: number): ImageOrientation {
  if (width === height) {
    return "square";
  }

  return height > width ? "vertical" : "horizontal";
}

function readPngDimensions(buffer: Buffer): { width: number; height: number } {
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function readJpegDimensions(buffer: Buffer): { width: number; height: number } {
  let offset = 2;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    const segmentLength = buffer.readUInt16BE(offset + 2);

    if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf
    ) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      };
    }

    offset += segmentLength + 2;
  }

  throw new Error("Unable to read JPEG dimensions.");
}

export async function readImageDimensions(filePath: string): Promise<{ width: number; height: number }> {
  const extension = path.extname(filePath).toLowerCase();
  const buffer = await readFile(filePath);

  if (extension === ".png") {
    return readPngDimensions(buffer);
  }

  return readJpegDimensions(buffer);
}

export async function buildImageAsset(filePath: string): Promise<ImageAsset> {
  const { width, height } = await readImageDimensions(filePath);
  const fileName = path.basename(filePath);
  const orientation = detectOrientation(width, height);

  return {
    id: fileName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    fileName,
    path: filePath,
    width,
    height,
    orientation,
    aspectRatio: width / height
  };
}

