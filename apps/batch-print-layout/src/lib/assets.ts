import type { DesktopPhotoToolHandoff } from "@photo-tools/desktop-contracts";
import type { PhotoAsset } from "../print-engine";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const DESKTOP_PREVIEW_CONCURRENCY = 8;
/** Lato massimo della preview richiesta al desktop per l'anteprima a schermo. */
export const DESKTOP_PREVIEW_MAX_DIMENSION = 2400;

export function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function loadBrowserImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Immagine non leggibile."));
    image.src = src;
  });
}

export function bytesToObjectUrl(bytes: Uint8Array, mimeType: string): string {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return URL.createObjectURL(new Blob([buffer], { type: mimeType }));
}

export function fileNameFromPath(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() || value;
}

function isExtendedDesktopImageName(fileName: string): boolean {
  return /\.(?:heic|heif|tif|tiff)$/i.test(fileName);
}

export function revokeBlobUrl(value: string | null | undefined): void {
  if (value?.startsWith("blob:")) {
    URL.revokeObjectURL(value);
  }
}

export function revokeAssetUrls(asset: PhotoAsset): void {
  revokeBlobUrl(asset.previewUrl);
  if (asset.sourceUrl !== asset.previewUrl) {
    revokeBlobUrl(asset.sourceUrl);
  }
}

export async function fileToAsset(file: File): Promise<PhotoAsset | null> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return null;
  }
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await loadBrowserImage(sourceUrl);
    const absolutePath = window.filexDesktop?.getPathForFile?.(file) || undefined;
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const key = `${absolutePath || relativePath}:${file.size}:${file.lastModified}`;
    return {
      id: `asset-${hashString(key)}`,
      fileName: file.name,
      relativePath,
      absolutePath,
      size: file.size,
      lastModified: file.lastModified,
      sourceUrl,
      previewUrl: sourceUrl,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } catch (error) {
    URL.revokeObjectURL(sourceUrl);
    throw error;
  }
}

export interface DesktopFolderImport {
  assets: PhotoAsset[];
  folderName: string;
  nestedDirectoriesSeen: number;
  scannedDirectoryCount: number;
  failedPreviewCount: number;
  failedExtendedPreviewCount: number;
  cancelled: boolean;
}

interface PreviewSource {
  absolutePath: string;
  size: number;
  lastModified: number;
  fileName: string;
  relativePath?: string;
}

/**
 * Carica le preview desktop con concorrenza limitata. Un file illeggibile non
 * interrompe gli altri: viene solo contato.
 */
async function loadDesktopPreviews(
  sources: PreviewSource[],
  onProgress?: (completed: number, total: number) => void,
): Promise<{ assets: PhotoAsset[]; failedPreviewCount: number; failedExtendedPreviewCount: number }> {
  const assets: Array<PhotoAsset | null> = new Array(sources.length).fill(null);
  let nextIndex = 0;
  let completed = 0;
  let failedPreviewCount = 0;
  let failedExtendedPreviewCount = 0;

  const loadNext = async () => {
    while (nextIndex < sources.length) {
      const entryIndex = nextIndex;
      nextIndex += 1;
      const entry = sources[entryIndex];
      try {
        const preview = await window.filexDesktop?.getPreview?.(entry.absolutePath, {
          maxDimension: DESKTOP_PREVIEW_MAX_DIMENSION,
          sourceFileKey: `${entry.size}:${entry.lastModified}`,
        });
        if (!preview) {
          failedPreviewCount += 1;
          if (isExtendedDesktopImageName(entry.fileName)) failedExtendedPreviewCount += 1;
          continue;
        }
        const previewUrl = bytesToObjectUrl(preview.bytes, preview.mimeType);
        assets[entryIndex] = {
          id: `asset-${hashString(`${entry.absolutePath}:${entry.size}:${entry.lastModified}`)}`,
          fileName: entry.fileName,
          relativePath: entry.relativePath,
          absolutePath: entry.absolutePath,
          size: entry.size,
          lastModified: entry.lastModified,
          sourceUrl: previewUrl,
          previewUrl,
          width: preview.width,
          height: preview.height,
        };
      } catch {
        failedPreviewCount += 1;
        if (isExtendedDesktopImageName(entry.fileName)) failedExtendedPreviewCount += 1;
      } finally {
        completed += 1;
        onProgress?.(completed, sources.length);
      }
    }
  };

  const workerCount = Math.min(DESKTOP_PREVIEW_CONCURRENCY, Math.max(1, sources.length));
  await Promise.all(Array.from({ length: workerCount }, () => loadNext()));
  return {
    assets: assets.filter((asset): asset is PhotoAsset => Boolean(asset)),
    failedPreviewCount,
    failedExtendedPreviewCount,
  };
}

export async function importDesktopFolder(onProgress?: (completed: number, total: number) => void): Promise<DesktopFolderImport> {
  const folder = await window.filexDesktop?.openFolder?.({ includeExtendedImages: true });
  if (!folder) {
    return {
      assets: [],
      folderName: "",
      nestedDirectoriesSeen: 0,
      scannedDirectoryCount: 0,
      failedPreviewCount: 0,
      failedExtendedPreviewCount: 0,
      cancelled: true,
    };
  }
  const loaded = await loadDesktopPreviews(
    folder.entries.map((entry) => ({
      absolutePath: entry.absolutePath,
      size: entry.size,
      lastModified: entry.lastModified,
      fileName: entry.name,
      relativePath: entry.relativePath,
    })),
    onProgress,
  );
  return {
    ...loaded,
    folderName: folder.name,
    nestedDirectoriesSeen: folder.diagnostics?.nestedDirectoriesSeen ?? 0,
    scannedDirectoryCount: folder.diagnostics?.scannedDirectoryCount ?? 1,
    cancelled: false,
  };
}

export async function importDesktopHandoffFiles(
  files: DesktopPhotoToolHandoff["files"],
  onProgress?: (completed: number, total: number) => void,
): Promise<{ assets: PhotoAsset[]; failedPreviewCount: number }> {
  const loaded = await loadDesktopPreviews(
    files.map((entry) => ({
      absolutePath: entry.absolutePath,
      size: entry.size,
      lastModified: entry.lastModified,
      fileName: entry.fileName,
      relativePath: entry.relativePath,
    })),
    onProgress,
  );
  return { assets: loaded.assets, failedPreviewCount: loaded.failedPreviewCount };
}
