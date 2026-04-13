import type { ImageAsset } from "@photo-tools/shared-types";
import { measureAsync } from "./performance-utils";

const SUPPORTED_EXTENSIONS = [".jpg", ".jpeg", ".png"];
const RAW_EXTENSIONS = [
  ".nef", ".nrw",
  ".cr2", ".cr3", ".crw",
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
];
const THUMBNAIL_MAX_DIMENSION = 420;
const PREVIEW_MAX_DIMENSION = 1600;
const THUMBNAIL_JPEG_QUALITY = 0.68;
const PREVIEW_JPEG_QUALITY = 0.8;
const LOAD_CONCURRENCY = 4;

export interface ImageImportProgressUpdate {
  supported: number;
  ignored: number;
  total: number;
  processed: number;
  currentFile: string | null;
}

type DesktopFile = File & {
  webkitRelativePath: string;
};

function buildSourceFileKey(file: File): string {
  const desktopFile = file as DesktopFile;
  const desktopAbsolutePath = typeof (desktopFile as { path?: unknown }).path === "string"
    ? ((desktopFile as { path?: string }).path ?? "")
    : "";
  const relativePath = desktopAbsolutePath || desktopFile.webkitRelativePath || file.name;
  return `${relativePath}::${file.size}::${file.lastModified}`;
}

function hashString(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function hasSupportedExtension(fileName: string): boolean {
  const lowerFileName = fileName.toLowerCase();
  return (
    SUPPORTED_EXTENSIONS.some((extension) => lowerFileName.endsWith(extension)) ||
    RAW_EXTENSIONS.some((extension) => lowerFileName.endsWith(extension))
  );
}

function isRawFile(fileName: string): boolean {
  const lowerFileName = fileName.toLowerCase();
  return RAW_EXTENSIONS.some((extension) => lowerFileName.endsWith(extension));
}

function detectOrientation(width: number, height: number): ImageAsset["orientation"] {
  if (width === height) {
    return "square";
  }

  return height > width ? "vertical" : "horizontal";
}

function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function readAscii(view: DataView, offset: number, length: number): string {
  let output = "";
  const safeLength = Math.max(0, Math.min(length, view.byteLength - offset));

  for (let index = 0; index < safeLength; index += 1) {
    output += String.fromCharCode(view.getUint8(offset + index));
  }

  return output;
}

function parseExifDateString(value: string): number | undefined {
  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return undefined;
  }

  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw) - 1;
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = Number(secondRaw);
  const timestamp = new Date(year, month, day, hour, minute, second).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function readTiffUint16(view: DataView, offset: number, littleEndian: boolean): number | undefined {
  if (offset < 0 || offset + 2 > view.byteLength) {
    return undefined;
  }

  return view.getUint16(offset, littleEndian);
}

function readTiffUint32(view: DataView, offset: number, littleEndian: boolean): number | undefined {
  if (offset < 0 || offset + 4 > view.byteLength) {
    return undefined;
  }

  return view.getUint32(offset, littleEndian);
}

function readExifAsciiTagValue(
  view: DataView,
  tiffOffset: number,
  ifdOffset: number,
  littleEndian: boolean,
  tagId: number
): string | undefined {
  const entryCount = readTiffUint16(view, ifdOffset, littleEndian);
  if (typeof entryCount !== "number") {
    return undefined;
  }

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    const currentTagId = readTiffUint16(view, entryOffset, littleEndian);
    const type = readTiffUint16(view, entryOffset + 2, littleEndian);
    const count = readTiffUint32(view, entryOffset + 4, littleEndian);
    if (currentTagId !== tagId || type !== 2 || typeof count !== "number" || count <= 0) {
      continue;
    }

    const valueOffsetField = entryOffset + 8;
    const valueOffset = readTiffUint32(view, valueOffsetField, littleEndian);
    if (typeof valueOffset !== "number") {
      continue;
    }

    const dataStart = count <= 4 ? valueOffsetField : tiffOffset + valueOffset;
    if (dataStart < 0 || dataStart + count > view.byteLength) {
      continue;
    }

    const raw = readAscii(view, dataStart, count);
    return raw.replace(/\0+$/, "").trim();
  }

  return undefined;
}

function readExifIfdOffset(
  view: DataView,
  ifdOffset: number,
  littleEndian: boolean
): number | undefined {
  const entryCount = readTiffUint16(view, ifdOffset, littleEndian);
  if (typeof entryCount !== "number") {
    return undefined;
  }

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    const currentTagId = readTiffUint16(view, entryOffset, littleEndian);
    if (currentTagId !== 0x8769) {
      continue;
    }

    return readTiffUint32(view, entryOffset + 8, littleEndian);
  }

  return undefined;
}

function readExifTimestampFromJpegBuffer(buffer: ArrayBuffer): number | undefined {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) {
    return undefined;
  }

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = view.getUint8(offset + 1);
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    const segmentLength = view.getUint16(offset + 2, false);
    if (segmentLength < 2) {
      break;
    }

    const segmentStart = offset + 4;
    const segmentEnd = offset + 2 + segmentLength;
    if (segmentEnd > view.byteLength) {
      break;
    }

    if (marker === 0xe1 && readAscii(view, segmentStart, 6) === "Exif\0\0") {
      const tiffOffset = segmentStart + 6;
      const byteOrder = readAscii(view, tiffOffset, 2);
      const littleEndian = byteOrder === "II";
      if (!(littleEndian || byteOrder === "MM")) {
        break;
      }

      const magic = readTiffUint16(view, tiffOffset + 2, littleEndian);
      if (magic !== 42) {
        break;
      }

      const firstIfdRelativeOffset = readTiffUint32(view, tiffOffset + 4, littleEndian);
      if (typeof firstIfdRelativeOffset !== "number") {
        break;
      }

      const ifd0Offset = tiffOffset + firstIfdRelativeOffset;
      const exifIfdRelativeOffset = readExifIfdOffset(view, ifd0Offset, littleEndian);
      const exifIfdOffset =
        typeof exifIfdRelativeOffset === "number" ? tiffOffset + exifIfdRelativeOffset : undefined;

      const dateTimeOriginal =
        typeof exifIfdOffset === "number"
          ? readExifAsciiTagValue(view, tiffOffset, exifIfdOffset, littleEndian, 0x9003)
          : undefined;
      const dateTimeDigitized =
        typeof exifIfdOffset === "number"
          ? readExifAsciiTagValue(view, tiffOffset, exifIfdOffset, littleEndian, 0x9004)
          : undefined;
      const dateTime = readExifAsciiTagValue(view, tiffOffset, ifd0Offset, littleEndian, 0x0132);

      return (
        (dateTimeOriginal ? parseExifDateString(dateTimeOriginal) : undefined) ??
        (dateTimeDigitized ? parseExifDateString(dateTimeDigitized) : undefined) ??
        (dateTime ? parseExifDateString(dateTime) : undefined)
      );
    }

    offset = segmentEnd;
  }

  return undefined;
}

async function readExifTimestamp(file: File): Promise<number | undefined> {
  if (!/\.(jpe?g)$/i.test(file.name)) {
    return undefined;
  }

  try {
    const buffer = await file.arrayBuffer();
    return readExifTimestampFromJpegBuffer(buffer);
  } catch {
    return undefined;
  }
}

function loadImageFromUrl(url: string, fileName: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      resolve(image);
    };

    image.onerror = () => {
      reject(new Error(`Impossibile leggere l'immagine ${fileName}.`));
    };

    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Impossibile generare l'anteprima compressa."));
          return;
        }

        resolve(blob);
      },
      "image/jpeg",
      quality
    );
  });
}

async function renderCompressedBlob(
  image: HTMLImageElement,
  maxDimension: number,
  quality: number
): Promise<{ blob: Blob | null; width: number; height: number }> {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  if (scale >= 1) {
    return { blob: null, width: targetWidth, height: targetHeight };
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D non disponibile per comprimere le anteprime.");
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

  return {
    blob: await canvasToBlob(canvas, quality),
    width: targetWidth,
    height: targetHeight
  };
}

async function createCompressedPreview(file: File): Promise<{
  width: number;
  height: number;
  thumbnailUrl: string;
  previewUrl: string;
  sourceUrl: string;
}> {
  // RAW path: usa il bridge Electron (getPreview) che estrae il JPEG embedded
  // dal file RAW tramite sharp/raw-jpeg-extractor già presenti in filex-desktop.
  const desktopFile = file as DesktopFile & { path?: string };
  const absolutePath = typeof desktopFile.path === "string" ? desktopFile.path : "";

  if (isRawFile(file.name) && absolutePath && typeof window.filexDesktop?.getPreview === "function") {
    const [thumbResult, previewResult] = await Promise.all([
      window.filexDesktop.getPreview(absolutePath, { maxDimension: THUMBNAIL_MAX_DIMENSION }),
      window.filexDesktop.getPreview(absolutePath, { maxDimension: PREVIEW_MAX_DIMENSION })
    ]);

    if (previewResult) {
      const thumbBlob = thumbResult
        ? new Blob([thumbResult.bytes.buffer as ArrayBuffer], { type: thumbResult.mimeType })
        : null;
      const previewBlob = new Blob([previewResult.bytes.buffer as ArrayBuffer], { type: previewResult.mimeType });

      return {
        width: previewResult.width,
        height: previewResult.height,
        thumbnailUrl: thumbBlob ? URL.createObjectURL(thumbBlob) : URL.createObjectURL(previewBlob),
        previewUrl: URL.createObjectURL(previewBlob),
        // sourceUrl punta al percorso assoluto così l'export PSD può leggere i byte originali
        sourceUrl: absolutePath
      };
    }
  }

  // Percorso standard: JPG/PNG via canvas
  const sourceUrl = URL.createObjectURL(file);

  try {
    const image = await loadImageFromUrl(sourceUrl, file.name);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const thumbnailRender = await renderCompressedBlob(
      image,
      THUMBNAIL_MAX_DIMENSION,
      THUMBNAIL_JPEG_QUALITY
    );
    const previewRender = await renderCompressedBlob(
      image,
      PREVIEW_MAX_DIMENSION,
      PREVIEW_JPEG_QUALITY
    );
    const thumbnailUrl = thumbnailRender.blob ? URL.createObjectURL(thumbnailRender.blob) : sourceUrl;
    const previewUrl = previewRender.blob ? URL.createObjectURL(previewRender.blob) : sourceUrl;

    if (!thumbnailRender.blob && !previewRender.blob) {
      return {
        width,
        height,
        thumbnailUrl: sourceUrl,
        previewUrl: sourceUrl,
        sourceUrl
      };
    }

    return {
      width,
      height,
      thumbnailUrl,
      previewUrl,
      sourceUrl
    };
  } catch (error) {
    URL.revokeObjectURL(sourceUrl);
    throw error;
  }
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  limit: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
  onItemProcessed?: (index: number) => void
): Promise<TOutput[]> {
  const results = new Array<TOutput>(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      onItemProcessed?.(currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );

  return results;
}

export async function loadImageAssetsFromFiles(
  files: File[],
  options?: {
    onProgress?: (update: ImageImportProgressUpdate) => void;
  }
): Promise<ImageAsset[]> {
  return measureAsync("load-image-assets", async () => {
    const supportedFiles = files.filter((file) => hasSupportedExtension(file.name));
    let processed = 0;

    options?.onProgress?.({
      supported: supportedFiles.length,
      ignored: files.length - supportedFiles.length,
      total: supportedFiles.length,
      processed,
      currentFile: supportedFiles[0]?.name ?? null
    });

    const assets = await mapWithConcurrency(
      supportedFiles,
      LOAD_CONCURRENCY,
      async (file) => {
        const desktopFile = file as DesktopFile;
        const relativePath = desktopFile.webkitRelativePath || file.name;
        const desktopAbsolutePath = typeof (desktopFile as { path?: unknown }).path === "string"
          ? ((desktopFile as { path?: string }).path ?? "")
          : "";
        const effectivePath = desktopAbsolutePath || relativePath;
        const sourceFileKey = buildSourceFileKey(file);
        const [{ width, height, thumbnailUrl, previewUrl, sourceUrl }, exifTimestamp] = await Promise.all([
          createCompressedPreview(file),
          readExifTimestamp(file)
        ]);

        return {
          id: `asset-${hashString(sourceFileKey)}-${sanitizeId(relativePath)}`,
          fileName: file.name,
          path: effectivePath,
          sourceFileKey: desktopAbsolutePath || sourceFileKey,
          createdAt: exifTimestamp ?? file.lastModified,
          rating: 0,
          pickStatus: "unmarked",
          colorLabel: null,
          width,
          height,
          orientation: detectOrientation(width, height),
          aspectRatio: width / height,
          thumbnailUrl,
          previewUrl,
          sourceUrl
        } satisfies ImageAsset;
      },
      (index) => {
        processed += 1;
        options?.onProgress?.({
          supported: supportedFiles.length,
          ignored: files.length - supportedFiles.length,
          total: supportedFiles.length,
          processed,
          currentFile: supportedFiles[index + 1]?.name ?? supportedFiles[index]?.name ?? null
        });
      }
    );

    return assets.sort((left, right) => {
      const leftCreatedAt = typeof left.createdAt === "number" ? left.createdAt : Number.POSITIVE_INFINITY;
      const rightCreatedAt = typeof right.createdAt === "number" ? right.createdAt : Number.POSITIVE_INFINITY;

      if (leftCreatedAt !== rightCreatedAt) {
        return leftCreatedAt - rightCreatedAt;
      }

      return left.fileName.localeCompare(right.fileName, undefined, {
        numeric: true,
        sensitivity: "base"
      });
    });
  });
}

export function revokeImageAssetUrls(assets: ImageAsset[]): void {
  const seen = new Set<string>();

  assets.forEach((asset) => {
    [asset.thumbnailUrl, asset.previewUrl, asset.sourceUrl].forEach((url) => {
      if (!url || !url.startsWith("blob:") || seen.has(url)) {
        return;
      }

      seen.add(url);
      URL.revokeObjectURL(url);
    });
  });
}

export function inferFolderLabelFromFiles(files: File[]): string {
  const firstFile = files[0] as DesktopFile | undefined;

  if (!firstFile) {
    return "";
  }

  if (firstFile.webkitRelativePath) {
    return firstFile.webkitRelativePath.split("/")[0];
  }

  return `${files.length} file selezionati`;
}
