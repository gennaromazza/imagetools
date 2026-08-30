import type { CustomTemplate, CustomTemplateVariant } from "../contexts/ProjectContext";
import { clearCustomTemplateBackgroundFiles, setCustomTemplateBackgroundFile } from "../contexts/ProjectContext";

export type SavedTemplateRecord = {
  id: string;
  name: string;
  createdAt: string;
  summary: string;
  template: CustomTemplate;
};

export type PreparedSavedTemplateHydration = {
  template: CustomTemplate;
  backgroundFiles: Partial<Record<Orientation, File>>;
  previewUrls: string[];
};

export type PortableTemplateAsset = {
  fileName: string;
  mimeType: string;
  dataUrl: string;
};

export type PortableSavedTemplatesPackage = {
  version: 1;
  exportedAt: string;
  templates: Array<{
    record: SavedTemplateRecord;
    assets?: Partial<Record<Orientation, PortableTemplateAsset>>;
  }>;
};

type StagedTemplateAsset = {
  assetKey: string;
  file: File;
};

export type PreparedSavedTemplatesPackageImport = {
  generation: number;
  mode: "merge" | "replace";
  records: SavedTemplateRecord[];
  stagedAssets: StagedTemplateAsset[];
  disposed: boolean;
};

type Orientation = "vertical" | "horizontal";
type AllowedImageMime = keyof typeof MIME_EXTENSIONS;

const STORAGE_KEY = "desktop-frame-composer.saved-templates";
const STORAGE_EVENT = "desktop-frame-composer:saved-templates-updated";
const ASSET_DB_NAME = "desktop-frame-composer-assets";
const ASSET_STORE_NAME = "template-backgrounds";
const ORIENTATIONS = ["vertical", "horizontal"] as const;
const MAX_SAVED_TEMPLATES = 50;
const MAX_LOCAL_STORAGE_CHARS = 2 * 1024 * 1024;
const MAX_TEMPLATE_NAME_LENGTH = 120;
const MAX_TEMPLATE_ID_LENGTH = 180;
const MAX_FILE_NAME_LENGTH = 180;
const MAX_ASSET_KEY_LENGTH = 320;
const MAX_TEMPLATE_SIDE_PX = 12_000;
const MAX_TEMPLATE_PIXELS = 50_000_000;
const MAX_TEMPLATE_BORDER_PX = 2_000;
const MIN_PHOTO_AREA_SIDE_PX = 40;

export const MAX_PORTABLE_ASSET_BYTES = 35 * 1024 * 1024;
// Two builder-approved 35 MiB backgrounds need about 93.4 MiB once base64 encoded.
export const MAX_PORTABLE_PACKAGE_BYTES = 100 * 1024 * 1024;

const MIME_EXTENSIONS = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
  "image/tiff": [".tif", ".tiff"],
  "image/heic": [".heic"],
  "image/heif": [".heif"],
} as const;

let lastGeneratedIdTimestamp = -1;
let generatedIdSequence = 0;
let latestLibraryImportGeneration = 0;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedBoundedText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized.slice(0, maximumLength) : null;
}

function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizedMimeType(value: unknown, fileName?: string): AllowedImageMime | null {
  const normalized = typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
  const aliased = normalized === "image/jpg" ? "image/jpeg" : normalized;
  if (aliased in MIME_EXTENSIONS) {
    return aliased as AllowedImageMime;
  }
  if (!aliased && fileName) {
    const lowerName = fileName.toLocaleLowerCase();
    for (const [mimeType, extensions] of Object.entries(MIME_EXTENSIONS)) {
      if (extensions.some((extension) => lowerName.endsWith(extension))) {
        return mimeType as AllowedImageMime;
      }
    }
  }
  return null;
}

function extensionForMimeType(mimeType: AllowedImageMime): string {
  return MIME_EXTENSIONS[mimeType][0];
}

export function normalizePortableImageFileName(value: unknown, mimeType?: string): string | null {
  if (typeof value !== "string" || value !== value.trim() || value.length < 1 || value.length > MAX_FILE_NAME_LENGTH) {
    return null;
  }
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(value) || /[. ]$/.test(value) || value === "." || value === "..") {
    return null;
  }
  const dotIndex = value.lastIndexOf(".");
  const stem = (dotIndex > 0 ? value.slice(0, dotIndex) : value).toLocaleUpperCase();
  const deviceStem = stem.split(".", 1)[0];
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(deviceStem)) {
    return null;
  }
  const canonicalMime = normalizedMimeType(mimeType, value);
  if (!canonicalMime) {
    return null;
  }
  const lowerName = value.toLocaleLowerCase();
  return MIME_EXTENSIONS[canonicalMime].some((extension) => lowerName.endsWith(extension)) ? value : null;
}

function safeExportFileName(value: unknown, mimeType: AllowedImageMime, fallbackStem: string): string {
  const alreadySafe = normalizePortableImageFileName(value, mimeType);
  if (alreadySafe) {
    return alreadySafe;
  }
  const rawStem = typeof value === "string" ? value.replace(/\.[^.]*$/, "") : fallbackStem;
  const sanitizedStem = rawStem
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, MAX_FILE_NAME_LENGTH - 8) || fallbackStem;
  const reservedSafeStem = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(sanitizedStem.split(".", 1)[0])
    ? `${sanitizedStem}-image`
    : sanitizedStem;
  return `${reservedSafeStem}${extensionForMimeType(mimeType)}`;
}

function matchesImageSignature(bytes: Uint8Array, mimeType: AllowedImageMime): boolean {
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  switch (mimeType) {
    case "image/jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      return bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 3) === "PNG"
        && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
    case "image/webp":
      return bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP";
    case "image/gif":
      return bytes.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a");
    case "image/tiff":
      return bytes.length >= 4
        && ((ascii(0, 2) === "II" && bytes[2] === 0x2a && bytes[3] === 0x00)
          || (ascii(0, 2) === "MM" && bytes[2] === 0x00 && bytes[3] === 0x2a));
    case "image/heic":
    case "image/heif": {
      if (bytes.length < 12 || ascii(4, 4) !== "ftyp") {
        return false;
      }
      const brand = ascii(8, 4);
      return mimeType === "image/heic"
        ? ["heic", "heix", "hevc", "hevx"].includes(brand)
        : ["heif", "mif1", "msf1"].includes(brand);
    }
  }
}

function strictBase64DecodedLength(dataUrl: string, contentStart: number): number | null {
  const contentLength = dataUrl.length - contentStart;
  if (contentLength === 0 || contentLength % 4 !== 0) {
    return null;
  }
  const padding = dataUrl.endsWith("==") ? 2 : dataUrl.endsWith("=") ? 1 : 0;
  const unpaddedEnd = dataUrl.length - padding;
  for (let index = contentStart; index < unpaddedEnd; index += 1) {
    const code = dataUrl.charCodeAt(index);
    const isBase64Character = (code >= 0x41 && code <= 0x5a)
      || (code >= 0x61 && code <= 0x7a)
      || (code >= 0x30 && code <= 0x39)
      || code === 0x2b
      || code === 0x2f;
    if (!isBase64Character) {
      return null;
    }
  }
  for (let index = unpaddedEnd; index < dataUrl.length; index += 1) {
    if (dataUrl.charCodeAt(index) !== 0x3d) {
      return null;
    }
  }
  const base64Value = (code: number): number => {
    if (code >= 0x41 && code <= 0x5a) return code - 0x41;
    if (code >= 0x61 && code <= 0x7a) return code - 0x61 + 26;
    if (code >= 0x30 && code <= 0x39) return code - 0x30 + 52;
    return code === 0x2b ? 62 : 63;
  };
  if (padding === 2 && (base64Value(dataUrl.charCodeAt(dataUrl.length - 3)) & 0x0f) !== 0) {
    return null;
  }
  if (padding === 1 && (base64Value(dataUrl.charCodeAt(dataUrl.length - 2)) & 0x03) !== 0) {
    return null;
  }
  return (contentLength / 4) * 3 - padding;
}

export function decodePortableImageAsset(value: unknown, maximumBytes = MAX_PORTABLE_ASSET_BYTES): File {
  if (!isPlainRecord(value)) {
    throw new Error("Asset immagine non valido.");
  }
  const declaredMime = normalizedMimeType(value.mimeType);
  if (!declaredMime) {
    throw new Error("Il tipo immagine dell'asset non e supportato.");
  }
  const fileName = normalizePortableImageFileName(value.fileName, declaredMime);
  if (!fileName) {
    throw new Error("Il nome file dell'asset non e sicuro o e troppo lungo.");
  }
  if (typeof value.dataUrl !== "string") {
    throw new Error("L'asset non contiene un data URL base64 valido.");
  }
  const maximumEncodedLength = Math.ceil(Math.max(0, maximumBytes) / 3) * 4 + 64;
  if (value.dataUrl.length > maximumEncodedLength) {
    throw new Error("L'asset supera il limite di 35 MB.");
  }
  const commaIndex = value.dataUrl.indexOf(",");
  if (commaIndex < 1 || commaIndex > 64) {
    throw new Error("Sono ammessi solo data URL immagine base64.");
  }
  const expectedHeader = `data:${declaredMime};base64`;
  if (value.dataUrl.slice(0, commaIndex) !== expectedHeader) {
    throw new Error("Il MIME del data URL non corrisponde all'asset dichiarato.");
  }
  const contentStart = commaIndex + 1;
  const decodedLength = strictBase64DecodedLength(value.dataUrl, contentStart);
  if (decodedLength === null) {
    throw new Error("Il contenuto base64 dell'asset non e valido.");
  }
  if (decodedLength < 1 || decodedLength > maximumBytes) {
    throw new Error("L'asset supera il limite di 35 MB.");
  }
  const bytes = new Uint8Array(decodedLength);
  let outputOffset = 0;
  try {
    const encodedChunkSize = 64 * 1024;
    for (let offset = contentStart; offset < value.dataUrl.length; offset += encodedChunkSize) {
      const binaryChunk = globalThis.atob(value.dataUrl.slice(offset, Math.min(value.dataUrl.length, offset + encodedChunkSize)));
      for (let index = 0; index < binaryChunk.length; index += 1) {
        bytes[outputOffset] = binaryChunk.charCodeAt(index);
        outputOffset += 1;
      }
    }
  } catch {
    throw new Error("Il contenuto base64 dell'asset non e decodificabile.");
  }
  if (outputOffset !== decodedLength) {
    throw new Error("La lunghezza dell'asset decodificato non e valida.");
  }
  if (!matchesImageSignature(bytes.subarray(0, 16), declaredMime)) {
    throw new Error("La firma binaria non corrisponde al formato immagine dichiarato.");
  }
  return new File([bytes], fileName, { type: declaredMime });
}

export async function normalizePortableImageFile(blob: Blob, fileName: unknown, fallbackStem: string): Promise<File> {
  if (!Number.isFinite(blob.size) || blob.size < 1 || blob.size > MAX_PORTABLE_ASSET_BYTES) {
    throw new Error("Lo sfondo template e vuoto o supera il limite di 35 MB.");
  }
  const mimeType = normalizedMimeType(blob.type, typeof fileName === "string" ? fileName : undefined);
  if (!mimeType) {
    throw new Error("Il formato dello sfondo template non e supportato.");
  }
  const safeName = safeExportFileName(fileName, mimeType, fallbackStem);
  const signature = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (!matchesImageSignature(signature, mimeType)) {
    throw new Error("Lo sfondo template e danneggiato o non corrisponde al formato dichiarato.");
  }
  const lastModified = blob instanceof File ? blob.lastModified : Date.now();
  return new File([blob], safeName, { type: mimeType, lastModified });
}

function normalizeAssetKey(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length < 1 || value.length > MAX_ASSET_KEY_LENGTH) {
    return undefined;
  }
  return /^[A-Za-z0-9._:-]+$/.test(value) ? value : undefined;
}

function normalizeTemplateId(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length < 1 || value.length > MAX_TEMPLATE_ID_LENGTH) {
    return undefined;
  }
  return /^[A-Za-z0-9._:-]+$/.test(value) ? value : undefined;
}

function finiteNumber(value: unknown, minimum: number, maximum: number, integer = false): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    return null;
  }
  return !integer || Number.isInteger(value) ? value : null;
}

function normalizeCustomTemplateVariant(value: unknown): CustomTemplateVariant | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  const widthCm = finiteNumber(value.widthCm, 1, 100);
  const heightCm = finiteNumber(value.heightCm, 1, 100);
  const dpi = finiteNumber(value.dpi, 72, 600, true);
  const widthPx = finiteNumber(value.widthPx, 64, MAX_TEMPLATE_SIDE_PX, true);
  const heightPx = finiteNumber(value.heightPx, 64, MAX_TEMPLATE_SIDE_PX, true);
  const photoAreaX = finiteNumber(value.photoAreaX, 0, MAX_TEMPLATE_SIDE_PX, true);
  const photoAreaY = finiteNumber(value.photoAreaY, 0, MAX_TEMPLATE_SIDE_PX, true);
  const photoAreaWidth = finiteNumber(value.photoAreaWidth, MIN_PHOTO_AREA_SIDE_PX, MAX_TEMPLATE_SIDE_PX, true);
  const photoAreaHeight = finiteNumber(value.photoAreaHeight, MIN_PHOTO_AREA_SIDE_PX, MAX_TEMPLATE_SIDE_PX, true);
  const photoAspectRatio = finiteNumber(value.photoAspectRatio, 0.1, 10);
  const borderSizePx = finiteNumber(value.borderSizePx, 0, MAX_TEMPLATE_BORDER_PX, true);
  const borderColor = typeof value.borderColor === "string" && /^#[0-9a-fA-F]{6}$/.test(value.borderColor)
    ? value.borderColor
    : null;
  const expectedWidthPx = widthCm !== null && dpi !== null ? Math.max(1, Math.round((widthCm / 2.54) * dpi)) : null;
  const expectedHeightPx = heightCm !== null && dpi !== null ? Math.max(1, Math.round((heightCm / 2.54) * dpi)) : null;
  const areaAspectRatio = photoAreaWidth !== null && photoAreaHeight !== null
    ? photoAreaWidth / photoAreaHeight
    : null;
  if (
    widthCm === null || heightCm === null || dpi === null || widthPx === null || heightPx === null
    || widthPx !== expectedWidthPx || heightPx !== expectedHeightPx
    || widthPx * heightPx > MAX_TEMPLATE_PIXELS
    || photoAreaX === null || photoAreaY === null || photoAreaWidth === null || photoAreaHeight === null
    || photoAreaX + photoAreaWidth > widthPx || photoAreaY + photoAreaHeight > heightPx
    || (value.lockAspectRatio !== true && value.lockAspectRatio !== false)
    || photoAspectRatio === null || borderSizePx === null
    || (value.lockAspectRatio === true && areaAspectRatio !== null
      && Math.abs(areaAspectRatio - photoAspectRatio) / photoAspectRatio > 0.03)
    || borderSizePx >= Math.min(photoAreaWidth, photoAreaHeight) / 2 || borderColor === null
  ) {
    return null;
  }
  const backgroundFileName = normalizePortableImageFileName(value.backgroundFileName);
  const backgroundAssetKey = normalizeAssetKey(value.backgroundAssetKey);
  return {
    widthCm, heightCm, dpi, widthPx, heightPx,
    photoAreaX, photoAreaY, photoAreaWidth, photoAreaHeight,
    lockAspectRatio: value.lockAspectRatio,
    photoAspectRatio,
    ...(backgroundFileName ? { backgroundFileName } : {}),
    ...(backgroundAssetKey ? { backgroundAssetKey } : {}),
    borderSizePx,
    borderColor,
  };
}

export function normalizePortableCustomTemplate(value: unknown): CustomTemplate | null {
  if (!isPlainRecord(value) || value.id !== "custom" || !isPlainRecord(value.variants)) {
    return null;
  }
  const name = normalizedBoundedText(value.name, MAX_TEMPLATE_NAME_LENGTH);
  const vertical = normalizeCustomTemplateVariant(value.variants.vertical);
  const horizontal = normalizeCustomTemplateVariant(value.variants.horizontal);
  if (!name || !vertical || !horizontal) {
    return null;
  }
  const libraryTemplateId = normalizeTemplateId(value.libraryTemplateId);
  return {
    id: "custom",
    ...(libraryTemplateId ? { libraryTemplateId } : {}),
    name,
    variants: { vertical, horizontal },
  };
}

function templateSummary(template: CustomTemplate): string {
  const { vertical, horizontal } = template.variants;
  return `Verticale ${vertical.widthCm}x${vertical.heightCm} cm | Orizzontale ${horizontal.widthCm}x${horizontal.heightCm} cm`;
}

export function normalizeSavedTemplateRecord(value: unknown): SavedTemplateRecord | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  const id = normalizeTemplateId(value.id);
  const template = normalizePortableCustomTemplate(value.template);
  const name = normalizedBoundedText(value.name, MAX_TEMPLATE_NAME_LENGTH)
    ?? (template ? normalizedBoundedText(template.name, MAX_TEMPLATE_NAME_LENGTH) : null);
  if (!id || !template || !name) {
    return null;
  }
  template.libraryTemplateId = id;
  template.name = name;
  return {
    id,
    name,
    createdAt: normalizeIsoDate(value.createdAt) ?? new Date(0).toISOString(),
    summary: templateSummary(template),
    template,
  };
}

export function normalizeSavedTemplateRecords(value: unknown): SavedTemplateRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seenIds = new Set<string>();
  const normalized: SavedTemplateRecord[] = [];
  for (const candidate of value) {
    const record = normalizeSavedTemplateRecord(candidate);
    if (!record || seenIds.has(record.id)) {
      continue;
    }
    seenIds.add(record.id);
    normalized.push(record);
    if (normalized.length >= MAX_SAVED_TEMPLATES) {
      break;
    }
  }
  return normalized;
}

function safeLocalStorageGet(): SavedTemplateRecord[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    if (raw.length > MAX_LOCAL_STORAGE_CHARS) {
      console.warn("Saved template library exceeds the safe localStorage limit");
      return [];
    }
    return normalizeSavedTemplateRecords(JSON.parse(raw) as unknown);
  } catch (error) {
    console.warn("Failed to load saved templates", error);
    return [];
  }
}

function safeLocalStorageSet(records: SavedTemplateRecord[], throwOnError: boolean): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    const normalized = normalizeSavedTemplateRecords(records);
    const serialized = JSON.stringify(normalized);
    if (serialized.length > MAX_LOCAL_STORAGE_CHARS) {
      throw new Error("La libreria template supera il limite sicuro di archiviazione locale.");
    }
    window.localStorage.setItem(STORAGE_KEY, serialized);
    try {
      window.dispatchEvent(new Event(STORAGE_EVENT));
    } catch (error) {
      console.warn("Saved template update listener failed", error);
    }
    return true;
  } catch (error) {
    if (throwOnError) {
      throw error;
    }
    console.warn("Failed to save templates", error);
    return false;
  }
}

function openAssetsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB non e disponibile."));
      return;
    }
    const request = window.indexedDB.open(ASSET_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ASSET_STORE_NAME)) {
        db.createObjectStore(ASSET_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
    request.onblocked = () => reject(new Error("IndexedDB e temporaneamente bloccato."));
  });
}

async function setAssetBlobs(entries: StagedTemplateAsset[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  const db = await openAssetsDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(ASSET_STORE_NAME, "readwrite");
      const store = transaction.objectStore(ASSET_STORE_NAME);
      for (const entry of entries) {
        store.put(entry.file, entry.assetKey);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Failed to store template assets"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Template asset transaction aborted"));
    });
  } finally {
    db.close();
  }
}

async function getAssetBlob(assetKey: string): Promise<Blob | null> {
  const db = await openAssetsDb();
  try {
    const result = await new Promise<unknown>((resolve, reject) => {
      const transaction = db.transaction(ASSET_STORE_NAME, "readonly");
      const request = transaction.objectStore(ASSET_STORE_NAME).get(assetKey);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Failed to load template asset"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Template asset transaction aborted"));
    });
    return result instanceof Blob ? result : null;
  } finally {
    db.close();
  }
}

async function deleteAssetBlobs(assetKeys: Iterable<string>): Promise<void> {
  const uniqueKeys = [...new Set(assetKeys)];
  if (uniqueKeys.length === 0) {
    return;
  }
  const db = await openAssetsDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(ASSET_STORE_NAME, "readwrite");
      const store = transaction.objectStore(ASSET_STORE_NAME);
      for (const assetKey of uniqueKeys) {
        store.delete(assetKey);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Failed to delete template assets"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Template asset transaction aborted"));
    });
  } finally {
    db.close();
  }
}

async function clearAssetStore(): Promise<void> {
  const db = await openAssetsDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(ASSET_STORE_NAME, "readwrite");
      transaction.objectStore(ASSET_STORE_NAME).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Failed to clear template assets"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Template asset transaction aborted"));
    });
  } finally {
    db.close();
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to convert blob to data URL"));
    reader.readAsDataURL(blob);
  });
}

function collectRecordAssetKeys(record: SavedTemplateRecord): string[] {
  return ORIENTATIONS
    .map((orientation) => normalizeAssetKey(record.template?.variants?.[orientation]?.backgroundAssetKey))
    .filter((assetKey): assetKey is string => Boolean(assetKey));
}

export function findUnreferencedAssetKeys(
  removedRecords: SavedTemplateRecord[],
  survivingRecords: SavedTemplateRecord[]
): string[] {
  const survivingKeys = new Set(survivingRecords.flatMap(collectRecordAssetKeys));
  return [...new Set(removedRecords.flatMap(collectRecordAssetKeys))]
    .filter((assetKey) => !survivingKeys.has(assetKey));
}

function scheduleAssetCleanup(assetKeys: Iterable<string>): void {
  const keys = [...new Set(assetKeys)];
  if (keys.length === 0) {
    return;
  }
  void deleteAssetBlobs(keys).catch((error) => {
    console.warn("Failed to cleanup template assets", error);
  });
}

function randomIdPart(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) {
    return randomUuid.replace(/-/g, "").slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 14).padEnd(12, "0");
}

export function createSavedTemplateId(now = Date.now()): string {
  const timestamp = Number.isFinite(now) ? Math.max(0, Math.floor(now)) : Date.now();
  if (timestamp === lastGeneratedIdTimestamp) {
    generatedIdSequence += 1;
  } else {
    lastGeneratedIdTimestamp = timestamp;
    generatedIdSequence = 0;
  }
  return `tpl_${timestamp.toString(36)}_${generatedIdSequence.toString(36)}_${randomIdPart()}`;
}

function createUniqueTemplateId(existingIds: Set<string>): string {
  let candidate = createSavedTemplateId();
  while (existingIds.has(candidate)) {
    candidate = createSavedTemplateId();
  }
  return candidate;
}

function createAssetKey(templateId: string, orientation: Orientation): string {
  return `${templateId}:${orientation}:${randomIdPart()}`;
}

export function loadSavedTemplates(): SavedTemplateRecord[] {
  return safeLocalStorageGet();
}

export function onSavedTemplatesUpdated(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  window.addEventListener(STORAGE_EVENT, listener);
  return () => window.removeEventListener(STORAGE_EVENT, listener);
}

export async function saveTemplateToLibrary(
  template: CustomTemplate,
  backgroundFiles?: Partial<Record<Orientation, File | null>>
): Promise<SavedTemplateRecord> {
  const normalizedTemplate = normalizePortableCustomTemplate(template);
  if (!normalizedTemplate) {
    throw new Error("Il template non supera la validazione di dimensioni e geometria.");
  }
  const existing = loadSavedTemplates();
  const recordId = createUniqueTemplateId(new Set(existing.map((record) => record.id)));
  normalizedTemplate.libraryTemplateId = recordId;
  const record: SavedTemplateRecord = {
    id: recordId,
    name: normalizedTemplate.name,
    createdAt: new Date().toISOString(),
    summary: templateSummary(normalizedTemplate),
    template: normalizedTemplate,
  };
  const stagedAssets: StagedTemplateAsset[] = [];
  for (const orientation of ORIENTATIONS) {
    const sourceFile = backgroundFiles?.[orientation];
    if (!sourceFile) {
      continue;
    }
    const file = await normalizePortableImageFile(sourceFile, sourceFile.name, `background-${orientation}`);
    const assetKey = createAssetKey(recordId, orientation);
    stagedAssets.push({ assetKey, file });
    record.template.variants[orientation].backgroundAssetKey = assetKey;
    record.template.variants[orientation].backgroundFileName = file.name;
  }
  try {
    await setAssetBlobs(stagedAssets);
    const next = [record, ...existing].slice(0, 20);
    safeLocalStorageSet(next, true);
    scheduleAssetCleanup(findUnreferencedAssetKeys(existing, next));
    return record;
  } catch (error) {
    await deleteAssetBlobs(stagedAssets.map((entry) => entry.assetKey)).catch(() => undefined);
    throw error;
  }
}

export function renameSavedTemplate(templateId: string, nextName: string): SavedTemplateRecord[] {
  const current = loadSavedTemplates();
  const cleanedName = normalizedBoundedText(nextName, MAX_TEMPLATE_NAME_LENGTH);
  if (!cleanedName) {
    return current;
  }
  const next = current.map((record) => record.id === templateId
    ? {
        ...record,
        name: cleanedName,
        summary: templateSummary(record.template),
        template: { ...record.template, libraryTemplateId: record.id, name: cleanedName },
      }
    : record);
  return safeLocalStorageSet(next, false) ? next : current;
}

export function deleteSavedTemplate(templateId: string): SavedTemplateRecord[] {
  const current = loadSavedTemplates();
  const next = current.filter((record) => record.id !== templateId);
  if (next.length === current.length || !safeLocalStorageSet(next, false)) {
    return current;
  }
  scheduleAssetCleanup(findUnreferencedAssetKeys(current, next));
  return next;
}

export async function clearSavedTemplatesLibrary(): Promise<SavedTemplateRecord[]> {
  reserveSavedTemplatesImportGeneration();
  const current = loadSavedTemplates();
  if (!safeLocalStorageSet([], false)) {
    return current;
  }
  await clearAssetStore().catch((error) => console.warn("Failed to clear template assets", error));
  return [];
}

export function duplicateSavedTemplate(templateId: string, nextName?: string): SavedTemplateRecord[] {
  const current = loadSavedTemplates();
  const source = current.find((record) => record.id === templateId);
  if (!source) {
    return current;
  }
  const duplicateName = normalizedBoundedText(nextName, MAX_TEMPLATE_NAME_LENGTH)
    ?? normalizedBoundedText(`${source.name} Copy`, MAX_TEMPLATE_NAME_LENGTH);
  if (!duplicateName) {
    return current;
  }
  const duplicateId = createUniqueTemplateId(new Set(current.map((record) => record.id)));
  // Background keys are intentionally shared. Cleanup is reference-aware.
  const duplicateTemplate: CustomTemplate = {
    ...source.template,
    libraryTemplateId: duplicateId,
    name: duplicateName,
    variants: {
      vertical: { ...source.template.variants.vertical },
      horizontal: { ...source.template.variants.horizontal },
    },
  };
  const duplicateRecord: SavedTemplateRecord = {
    id: duplicateId,
    name: duplicateName,
    createdAt: new Date().toISOString(),
    summary: templateSummary(duplicateTemplate),
    template: duplicateTemplate,
  };
  const next = [duplicateRecord, ...current].slice(0, 20);
  if (!safeLocalStorageSet(next, false)) {
    return current;
  }
  scheduleAssetCleanup(findUnreferencedAssetKeys(current, next));
  return next;
}

export function templateRecordDateLabel(record: SavedTemplateRecord): string {
  const timestamp = Date.parse(record.createdAt);
  if (!Number.isFinite(timestamp)) {
    return "Data non disponibile";
  }
  return new Date(timestamp).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export async function attachTemplateBackgroundAsset(
  templateId: string,
  orientation: Orientation,
  sourceFile: File
): Promise<string> {
  const safeTemplateId = normalizeTemplateId(templateId);
  if (!safeTemplateId) {
    throw new Error("ID template non valido.");
  }
  const file = await normalizePortableImageFile(sourceFile, sourceFile.name, `background-${orientation}`);
  const assetKey = createAssetKey(safeTemplateId, orientation);
  await setAssetBlobs([{ assetKey, file }]);
  return assetKey;
}

export async function prepareSavedTemplateHydration(
  sourceRecord: SavedTemplateRecord
): Promise<PreparedSavedTemplateHydration> {
  const record = normalizeSavedTemplateRecord(sourceRecord);
  if (!record) {
    throw new Error("Il template salvato e danneggiato o incompleto.");
  }
  const nextTemplate: CustomTemplate = {
    ...record.template,
    libraryTemplateId: record.id,
    variants: {
      vertical: { ...record.template.variants.vertical },
      horizontal: { ...record.template.variants.horizontal },
    },
  };
  const backgroundFiles: PreparedSavedTemplateHydration["backgroundFiles"] = {};
  const previewUrls: string[] = [];

  for (const orientation of ORIENTATIONS) {
    const variant = nextTemplate.variants[orientation];
    if (!variant.backgroundAssetKey || !variant.backgroundFileName) {
      delete variant.backgroundAssetKey;
      continue;
    }
    try {
      const blob = await getAssetBlob(variant.backgroundAssetKey);
      if (!blob) {
        throw new Error("Asset IndexedDB mancante o non valido.");
      }
      const file = await normalizePortableImageFile(blob, variant.backgroundFileName, `background-${orientation}`);
      const previewUrl = URL.createObjectURL(file);
      backgroundFiles[orientation] = file;
      previewUrls.push(previewUrl);
      variant.backgroundFileName = file.name;
      variant.backgroundPreviewUrl = previewUrl;
    } catch (error) {
      console.warn(`Ignored corrupt template asset ${variant.backgroundAssetKey}`, error);
      delete variant.backgroundAssetKey;
      delete variant.backgroundFileName;
      delete variant.backgroundPreviewUrl;
    }
  }

  return { template: nextTemplate, backgroundFiles, previewUrls };
}

export function commitPreparedSavedTemplateHydration(
  prepared: PreparedSavedTemplateHydration
): CustomTemplate {
  clearCustomTemplateBackgroundFiles();
  for (const orientation of ORIENTATIONS) {
    const file = prepared.backgroundFiles[orientation];
    if (file) {
      setCustomTemplateBackgroundFile(orientation, file);
    }
  }
  return prepared.template;
}

export function disposePreparedSavedTemplateHydration(
  prepared: PreparedSavedTemplateHydration
): void {
  prepared.previewUrls.splice(0).forEach((previewUrl) => URL.revokeObjectURL(previewUrl));
}

export async function hydrateSavedTemplate(record: SavedTemplateRecord): Promise<CustomTemplate> {
  return commitPreparedSavedTemplateHydration(await prepareSavedTemplateHydration(record));
}

export async function exportSavedTemplatesPackage(): Promise<PortableSavedTemplatesPackage> {
  const templates: PortableSavedTemplatesPackage["templates"] = [];
  let encodedAssetBudget = 0;

  for (const sourceRecord of loadSavedTemplates()) {
    const record = normalizeSavedTemplateRecord(sourceRecord);
    if (!record) {
      continue;
    }
    const portableRecord = normalizeSavedTemplateRecord(record)!;
    const assets: Partial<Record<Orientation, PortableTemplateAsset>> = {};

    for (const orientation of ORIENTATIONS) {
      const sourceVariant = record.template.variants[orientation];
      const portableVariant = portableRecord.template.variants[orientation];
      delete portableVariant.backgroundAssetKey;
      if (!sourceVariant.backgroundAssetKey || !sourceVariant.backgroundFileName) {
        delete portableVariant.backgroundFileName;
        continue;
      }
      try {
        const blob = await getAssetBlob(sourceVariant.backgroundAssetKey);
        if (!blob) {
          throw new Error("Asset IndexedDB mancante o non valido.");
        }
        const file = await normalizePortableImageFile(blob, sourceVariant.backgroundFileName, `background-${orientation}`);
        const encodedLength = Math.ceil(file.size / 3) * 4 + 64;
        if (encodedAssetBudget + encodedLength > MAX_PORTABLE_PACKAGE_BYTES) {
          throw new Error("La libreria supera il limite di 100 MB del pacchetto portabile.");
        }
        encodedAssetBudget += encodedLength;
        assets[orientation] = {
          fileName: file.name,
          mimeType: file.type,
          dataUrl: await blobToDataUrl(file),
        };
        portableVariant.backgroundFileName = file.name;
      } catch (error) {
        if (error instanceof Error && error.message.includes("limite di 100 MB")) {
          throw error;
        }
        console.warn(`Skipped corrupt template asset ${sourceVariant.backgroundAssetKey}`, error);
        delete portableVariant.backgroundFileName;
      }
    }

    templates.push({
      record: portableRecord,
      assets: Object.keys(assets).length > 0 ? assets : undefined,
    });
  }

  return { version: 1, exportedAt: new Date().toISOString(), templates };
}

export function reserveSavedTemplatesImportGeneration(): number {
  latestLibraryImportGeneration += 1;
  return latestLibraryImportGeneration;
}

export function isSavedTemplatesImportGenerationCurrent(generation: number): boolean {
  return generation === latestLibraryImportGeneration;
}

export function prepareSavedTemplatesPackageImport(
  payload: unknown,
  mode: "merge" | "replace" = "merge",
  generation = reserveSavedTemplatesImportGeneration()
): PreparedSavedTemplatesPackageImport {
  if (mode !== "merge" && mode !== "replace") {
    throw new Error("Modalita di importazione libreria non valida.");
  }
  if (!isPlainRecord(payload) || payload.version !== 1 || !normalizeIsoDate(payload.exportedAt)) {
    throw new Error("File libreria non valido o versione non supportata.");
  }
  if (!Array.isArray(payload.templates) || payload.templates.length > MAX_SAVED_TEMPLATES) {
    throw new Error(`La libreria deve contenere al massimo ${MAX_SAVED_TEMPLATES} template.`);
  }

  const seenIds = new Set<string>();
  const records: SavedTemplateRecord[] = [];
  const stagedAssets: StagedTemplateAsset[] = [];
  let encodedAssetBudget = 0;

  for (let index = 0; index < payload.templates.length; index += 1) {
    const entry = payload.templates[index];
    if (!isPlainRecord(entry)) {
      throw new Error(`Template ${index + 1}: record non valido.`);
    }
    const record = normalizeSavedTemplateRecord(entry.record);
    if (!record || seenIds.has(record.id)) {
      throw new Error(`Template ${index + 1}: struttura o ID non valido/duplicato.`);
    }
    seenIds.add(record.id);

    const assets = entry.assets;
    if (assets !== undefined && !isPlainRecord(assets)) {
      throw new Error(`Template ${index + 1}: elenco asset non valido.`);
    }
    for (const orientation of ORIENTATIONS) {
      const variant = record.template.variants[orientation];
      delete variant.backgroundAssetKey;
      delete variant.backgroundPreviewUrl;
      delete variant.backgroundDataUrl;
      const asset = isPlainRecord(assets) ? assets[orientation] : undefined;
      if (asset === undefined) {
        delete variant.backgroundFileName;
        continue;
      }
      if (isPlainRecord(asset) && typeof asset.dataUrl === "string") {
        encodedAssetBudget += asset.dataUrl.length;
      }
      if (encodedAssetBudget > MAX_PORTABLE_PACKAGE_BYTES) {
        throw new Error("La libreria supera il limite di 100 MB del pacchetto portabile.");
      }
      const file = decodePortableImageAsset(asset);
      const assetKey = createAssetKey(record.id, orientation);
      stagedAssets.push({ assetKey, file });
      variant.backgroundAssetKey = assetKey;
      variant.backgroundFileName = file.name;
    }
    records.push(record);
  }

  return { generation, mode, records, stagedAssets, disposed: false };
}

export function disposePreparedSavedTemplatesPackageImport(
  prepared: PreparedSavedTemplatesPackageImport
): void {
  prepared.disposed = true;
  prepared.stagedAssets.splice(0);
  prepared.records.splice(0);
}

export async function commitPreparedSavedTemplatesPackageImport(
  prepared: PreparedSavedTemplatesPackageImport
): Promise<SavedTemplateRecord[]> {
  if (prepared.disposed || !isSavedTemplatesImportGenerationCurrent(prepared.generation)) {
    disposePreparedSavedTemplatesPackageImport(prepared);
    return loadSavedTemplates();
  }

  const current = loadSavedTemplates();
  const importedRecords = [...prepared.records];
  const stagedAssets = [...prepared.stagedAssets];
  try {
    await setAssetBlobs(stagedAssets);
    if (prepared.disposed || !isSavedTemplatesImportGenerationCurrent(prepared.generation)) {
      await deleteAssetBlobs(stagedAssets.map((entry) => entry.assetKey)).catch(() => undefined);
      disposePreparedSavedTemplatesPackageImport(prepared);
      return loadSavedTemplates();
    }

    const byId = new Map<string, SavedTemplateRecord>();
    if (prepared.mode === "merge") {
      for (const record of current) {
        byId.set(record.id, record);
      }
    }
    for (const record of importedRecords) {
      byId.set(record.id, record);
    }
    const next = [...byId.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, MAX_SAVED_TEMPLATES);

    safeLocalStorageSet(next, true);
    const referencedKeys = new Set(next.flatMap(collectRecordAssetKeys));
    const stagedKeysNotReferenced = stagedAssets
      .map((entry) => entry.assetKey)
      .filter((assetKey) => !referencedKeys.has(assetKey));
    scheduleAssetCleanup([
      ...findUnreferencedAssetKeys(current, next),
      ...stagedKeysNotReferenced,
    ]);
    prepared.stagedAssets.splice(0);
    prepared.records.splice(0);
    prepared.disposed = true;
    return next;
  } catch (error) {
    await deleteAssetBlobs(stagedAssets.map((entry) => entry.assetKey)).catch(() => undefined);
    disposePreparedSavedTemplatesPackageImport(prepared);
    throw error;
  }
}

export async function importSavedTemplatesPackage(
  payload: unknown,
  mode: "merge" | "replace" = "merge"
): Promise<SavedTemplateRecord[]> {
  const generation = reserveSavedTemplatesImportGeneration();
  const prepared = prepareSavedTemplatesPackageImport(payload, mode, generation);
  return commitPreparedSavedTemplatesPackageImport(prepared);
}
