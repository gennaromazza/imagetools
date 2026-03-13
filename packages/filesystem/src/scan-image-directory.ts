import { readdir } from "node:fs/promises";
import path from "node:path";
import type { ImageAsset } from "@photo-tools/shared-types";
import { buildImageAsset, SUPPORTED_IMAGE_EXTENSIONS } from "./image-metadata";

export async function scanImageDirectory(directoryPath: string): Promise<ImageAsset[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const imagePaths = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(directoryPath, entry.name))
    .filter((filePath) => SUPPORTED_IMAGE_EXTENSIONS.includes(path.extname(filePath).toLowerCase()));

  const assets = await Promise.all(imagePaths.map((filePath) => buildImageAsset(filePath)));

  return assets.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

