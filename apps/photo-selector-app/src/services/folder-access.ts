/**
 * Folder access — File System Access API (Chrome/Edge) with <input webkitdirectory> fallback.
 * Also manages recent-folders list in localStorage and the in-memory file store.
 */

import type { ImageAsset } from "@photo-tools/shared-types";
import { preloadImageUrls } from "./image-cache";
import { RawPreviewPipeline } from "./raw-preview-pipeline";

// ── Supported formats ──────────────────────────────────────────────────

const STANDARD_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const RAW_EXTENSIONS = new Set([
  ".cr2", ".cr3", ".crw",   // Canon (CR2, CR3, older CRW)
  ".nef", ".nrw",            // Nikon (NEF, Coolpix NRW)
  ".arw", ".srf", ".sr2",   // Sony (ARW, older SRF/SR2)
  ".raf",                    // Fujifilm
  ".dng",                    // Adobe DNG (universal)
  ".rw2",                    // Panasonic / Lumix
  ".orf",                    // Olympus / OM System
  ".pef",                    // Pentax
  ".srw",                    // Samsung
  ".3fr",                    // Hasselblad
  ".x3f",                    // Sigma / Foveon
  ".gpr",                    // GoPro (DNG-based)
]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export function isImageFile(name: string): boolean {
  // Ignore macOS AppleDouble sidecars (e.g. ._IMG_0001.CR2):
  // they are metadata files, not real images, and trigger false decode errors.
  if (name.startsWith("._")) return false;
  const ext = extOf(name);
  return STANDARD_EXTENSIONS.has(ext) || RAW_EXTENSIONS.has(ext);
}

export function isRawFile(name: string): boolean {
  return RAW_EXTENSIONS.has(extOf(name));
}

/** Can the browser natively decode this format via <img> / createImageBitmap? */
export function isBrowserDecodable(name: string): boolean {
  return STANDARD_EXTENSIONS.has(extOf(name));
}

// ── File store (module-level Map) ──────────────────────────────────────

/** In-memory store: assetId → File.  Used for on-demand preview generation. */
export const fileStore = new Map<string, File>();
const fileHandleStore = new Map<string, FileSystemFileHandle>();
const filePromiseStore = new Map<string, Promise<File | null>>();
const assetPathStore = new Map<string, string>();
const assetAbsolutePathStore = new Map<string, string>();
const assetSourceFileKeyStore = new Map<string, string>();
const livePreviewStore = new Map<string, string>();
const sidecarHandleByAssetId = new Map<string, FileSystemFileHandle>();
const sidecarHandleByStemPath = new Map<string, FileSystemFileHandle>();
const directoryHandleByPath = new Map<string, FileSystemDirectoryHandle>();
const onDemandPreviewStore = new Map<string, string>();
const onDemandPreviewPromiseStore = new Map<string, Promise<string | null>>();
const rawPreviewPipeline =
  typeof window !== "undefined" && typeof Worker !== "undefined"
    ? new RawPreviewPipeline()
    : null;
let previewGeneration = 0;

function hasDesktopFolderBridge(): boolean {
  return typeof window !== "undefined" && typeof window.filexDesktop?.openFolder === "function";
}

function hasDesktopFileBridge(): boolean {
  return typeof window !== "undefined" && typeof window.filexDesktop?.readFile === "function";
}

function hasDesktopPreviewBridge(): boolean {
  return typeof window !== "undefined" && typeof window.filexDesktop?.getPreview === "function";
}

function hasDesktopPreviewWarmBridge(): boolean {
  return typeof window !== "undefined" && typeof window.filexDesktop?.warmPreview === "function";
}

function hasDesktopSidecarBridge(): boolean {
  return typeof window !== "undefined"
    && typeof window.filexDesktop?.readSidecarXmp === "function"
    && typeof window.filexDesktop?.writeSidecarXmp === "function";
}

function extensionOf(path: string): string {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i).toLowerCase() : "";
}

function stemPath(path: string): string {
  const slash = path.replace(/\\/g, "/").toLowerCase();
  const i = slash.lastIndexOf(".");
  return i >= 0 ? slash.slice(0, i) : slash;
}

function basenameWithoutExt(path: string): string {
  const slash = path.replace(/\\/g, "/");
  const leaf = slash.slice(slash.lastIndexOf("/") + 1);
  const i = leaf.lastIndexOf(".");
  return i >= 0 ? leaf.slice(0, i) : leaf;
}

function dirname(path: string): string {
  const slash = path.replace(/\\/g, "/");
  const i = slash.lastIndexOf("/");
  return i >= 0 ? slash.slice(0, i) : "";
}

function detectOrientation(width: number, height: number): "horizontal" | "vertical" | "square" {
  if (width === height) return "square";
  return height > width ? "vertical" : "horizontal";
}

function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function revokeLivePreviewUrl(assetId: string): void {
  const current = livePreviewStore.get(assetId);
  if (current) {
    URL.revokeObjectURL(current);
    livePreviewStore.delete(assetId);
  }
}

function invalidateOnDemandPreview(assetId: string): void {
  const keyPrefix = `${assetId}::`;
  for (const [cacheKey, current] of onDemandPreviewStore.entries()) {
    if (cacheKey === assetId || cacheKey.startsWith(keyPrefix)) {
      URL.revokeObjectURL(current);
      onDemandPreviewStore.delete(cacheKey);
    }
  }
  for (const cacheKey of onDemandPreviewPromiseStore.keys()) {
    if (cacheKey === assetId || cacheKey.startsWith(keyPrefix)) {
      onDemandPreviewPromiseStore.delete(cacheKey);
    }
  }
}

export interface OnDemandPreviewOptions {
  maxDimension?: number;
}

function getOnDemandPreviewCacheKey(assetId: string, options: OnDemandPreviewOptions = {}): string {
  const maxDimension = Math.max(0, Math.round(options.maxDimension ?? 0));
  return `${assetId}::${maxDimension}`;
}

export function getCachedOnDemandPreviewUrl(
  assetId: string,
  options: OnDemandPreviewOptions = {},
): string | null {
  return onDemandPreviewStore.get(getOnDemandPreviewCacheKey(assetId, options)) ?? null;
}

async function readImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  if (!isBrowserDecodable(file.name)) {
    return null;
  }

  try {
    if ("createImageBitmap" in window) {
      const bmp = await createImageBitmap(file);
      const width = bmp.width;
      const height = bmp.height;
      bmp.close();
      return width > 0 && height > 0 ? { width, height } : null;
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      const dims = await new Promise<{ width: number; height: number } | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(
          img.naturalWidth > 0 && img.naturalHeight > 0
            ? { width: img.naturalWidth, height: img.naturalHeight }
            : null
        );
        img.onerror = () => resolve(null);
        img.src = objectUrl;
      });
      return dims;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return null;
  }
}

// ── Asset ID helpers (mirrored from browser-image-assets) ──────────────

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function buildSourceFileKey(file: File, relativePath: string): string {
  return `${relativePath}::${file.size}::${file.lastModified}`;
}

export function buildSourceFileKeyFromStats(
  relativePath: string,
  size: number,
  lastModified: number,
): string {
  return `${relativePath}::${size}::${lastModified}`;
}

function buildPlaceholderSourceFileKey(relativePath: string): string {
  return `${relativePath}::0::0`;
}

export function buildAssetId(relativePath: string): string {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  return `asset-${hashString(normalizedPath.toLowerCase())}-${sanitizeId(normalizedPath)}`;
}

// ── Folder entry ───────────────────────────────────────────────────────

export interface FolderEntry {
  name: string;
  file?: File;
  relativePath: string;
  fileHandle?: FileSystemFileHandle;
  absolutePath?: string;
  size?: number;
  lastModified?: number;
}

export interface FolderOpenResult {
  name: string;
  entries: FolderEntry[];
  rootPath?: string;
  diagnostics?: FolderOpenDiagnostics;
}

export interface FolderOpenDiagnostics {
  source: "desktop-native" | "browser-native" | "file-input";
  selectedPath: string;
  topLevelSupportedCount: number;
  nestedSupportedDiscardedCount: number;
  totalSupportedSeen: number;
  nestedDirectoriesSeen?: number;
}

function isTopLevelRelativePath(relativePath: string): boolean {
  const segments = relativePath.split("/").filter(Boolean);
  return segments.length <= 2;
}

function keepTopLevelEntries(entries: FolderEntry[]): FolderEntry[] {
  return entries.filter((entry) => isTopLevelRelativePath(entry.relativePath));
}

function buildFolderDiagnostics(
  source: FolderOpenDiagnostics["source"],
  selectedPath: string,
  topLevelSupportedCount: number,
  nestedSupportedDiscardedCount: number,
  nestedDirectoriesSeen = 0,
): FolderOpenDiagnostics {
  return {
    source,
    selectedPath,
    topLevelSupportedCount,
    nestedSupportedDiscardedCount,
    totalSupportedSeen: topLevelSupportedCount + nestedSupportedDiscardedCount,
    nestedDirectoriesSeen,
  };
}

function toFolderOpenResult(
  name: string,
  rootPath: string | undefined,
  entries: FolderEntry[],
  diagnostics?: FolderOpenDiagnostics,
): FolderOpenResult {
  return {
    name,
    rootPath,
    entries,
    diagnostics,
  };
}

async function getRecentFolderHandleDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") {
    return null;
  }

  try {
    return await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("photo-selector-folder-access", 1);

      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("recent-directory-handles")) {
          db.createObjectStore("recent-directory-handles", { keyPath: "name" });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
  } catch {
    return null;
  }
}

async function saveRecentFolderHandle(name: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await getRecentFolderHandleDb();
  if (!db) {
    return;
  }

  await new Promise<void>((resolve) => {
    const tx = db.transaction("recent-directory-handles", "readwrite");
    tx.objectStore("recent-directory-handles").put({ name, handle });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function loadRecentFolderHandle(name: string): Promise<FileSystemDirectoryHandle | null> {
  const db = await getRecentFolderHandleDb();
  if (!db) {
    return null;
  }

  return new Promise((resolve) => {
    const tx = db.transaction("recent-directory-handles", "readonly");
    const request = tx.objectStore("recent-directory-handles").get(name);
    request.onsuccess = () => {
      const record = request.result as { handle?: FileSystemDirectoryHandle } | undefined;
      resolve(record?.handle ?? null);
    };
    request.onerror = () => resolve(null);
  });
}

async function deleteRecentFolderHandle(name: string): Promise<void> {
  const db = await getRecentFolderHandleDb();
  if (!db) {
    return;
  }

  await new Promise<void>((resolve) => {
    const tx = db.transaction("recent-directory-handles", "readwrite");
    tx.objectStore("recent-directory-handles").delete(name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function countNestedDirectoryHandleImagesInternal(
  dirHandle: FileSystemDirectoryHandle,
  includeCurrentFiles: boolean,
): Promise<{
  nestedSupportedDiscardedCount: number;
  nestedDirectoriesSeen: number;
}> {
  let nestedSupportedDiscardedCount = 0;
  let nestedDirectoriesSeen = 0;

  for await (const [nestedName, nestedHandle] of (dirHandle as any).entries()) {
    if (nestedHandle.kind === "file") {
      if (includeCurrentFiles && isImageFile(nestedName)) {
        nestedSupportedDiscardedCount += 1;
      }
      continue;
    }

    nestedDirectoriesSeen += 1;
    const nestedResult = await countNestedDirectoryHandleImagesInternal(
      nestedHandle as FileSystemDirectoryHandle,
      true,
    );
    nestedDirectoriesSeen += nestedResult.nestedDirectoriesSeen;
    nestedSupportedDiscardedCount += nestedResult.nestedSupportedDiscardedCount;
  }

  return {
    nestedSupportedDiscardedCount,
    nestedDirectoriesSeen,
  };
}

async function scanDirectoryHandle(dirHandle: FileSystemDirectoryHandle): Promise<{
  entries: FolderEntry[];
  diagnostics: FolderOpenDiagnostics;
}> {
  sidecarHandleByStemPath.clear();
  directoryHandleByPath.clear();

  const entries: FolderEntry[] = [];
  directoryHandleByPath.set(dirHandle.name, dirHandle);
  for await (const [entryName, childHandle] of (dirHandle as any).entries()) {
    if (childHandle.kind !== "file") {
      continue;
    }

    const relPath = `${dirHandle.name}/${entryName}`;
    if (extensionOf(entryName) === ".xmp") {
      sidecarHandleByStemPath.set(stemPath(relPath), childHandle as FileSystemFileHandle);
      continue;
    }
    if (!isImageFile(entryName)) continue;
    entries.push({
      name: entryName,
      relativePath: relPath,
      fileHandle: childHandle as FileSystemFileHandle,
    });
  }

  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const nestedCounts = await countNestedDirectoryHandleImagesInternal(dirHandle, false);

  return {
    entries,
    diagnostics: buildFolderDiagnostics(
      "browser-native",
      dirHandle.name,
      entries.length,
      nestedCounts.nestedSupportedDiscardedCount,
      nestedCounts.nestedDirectoriesSeen,
    ),
  };
}

// ── File System Access API ─────────────────────────────────────────────

export function hasNativeFolderAccess(): boolean {
  return hasDesktopFolderBridge()
    || (typeof window !== "undefined" && "showDirectoryPicker" in window);
}

/**
 * Open a folder with the File System Access API (Chrome/Edge).
 * Reads only top-level files and keeps diagnostics about nested files.
 * Returns null if the user cancels the picker.
 */
export async function openFolderNative(): Promise<FolderOpenResult | null> {
  if (hasDesktopFolderBridge()) {
    const result = await window.filexDesktop?.openFolder();
    if (!result) {
      return null;
    }

    const mappedEntries = result.entries.map((entry) => ({
      name: entry.name,
      relativePath: entry.relativePath,
      absolutePath: entry.absolutePath,
      size: entry.size,
      lastModified: entry.lastModified,
    }));
    const entries = keepTopLevelEntries(mappedEntries);
    const diagnostics = buildFolderDiagnostics(
      "desktop-native",
      result.diagnostics?.selectedPath ?? result.rootPath,
      entries.length,
      result.diagnostics?.nestedSupportedDiscardedCount ?? Math.max(0, mappedEntries.length - entries.length),
      result.diagnostics?.nestedDirectoriesSeen ?? 0,
    );

    return toFolderOpenResult(
      result.name,
      result.rootPath,
      entries,
      diagnostics,
    );
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dirHandle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({
      mode: "readwrite",
    });
    const { entries, diagnostics } = await scanDirectoryHandle(dirHandle);
    void saveRecentFolderHandle(dirHandle.name, dirHandle);
    return toFolderOpenResult(dirHandle.name, dirHandle.name, entries, diagnostics);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }
}

export async function reopenRecentFolder(folder: RecentFolder): Promise<FolderOpenResult | null> {
  if (hasDesktopFolderBridge()) {
    if (!folder.path) {
      return null;
    }

    const result = await window.filexDesktop?.reopenFolder(folder.path);
    if (!result) {
      return null;
    }

    const mappedEntries = result.entries.map((entry) => ({
      name: entry.name,
      relativePath: entry.relativePath,
      absolutePath: entry.absolutePath,
      size: entry.size,
      lastModified: entry.lastModified,
    }));
    const entries = keepTopLevelEntries(mappedEntries);
    const diagnostics = buildFolderDiagnostics(
      "desktop-native",
      result.diagnostics?.selectedPath ?? result.rootPath,
      entries.length,
      result.diagnostics?.nestedSupportedDiscardedCount ?? Math.max(0, mappedEntries.length - entries.length),
      result.diagnostics?.nestedDirectoriesSeen ?? 0,
    );

    return toFolderOpenResult(
      result.name,
      result.rootPath,
      entries,
      diagnostics,
    );
  }

  const handle = await loadRecentFolderHandle(folder.name);
  if (!handle) {
    return null;
  }

  try {
    const permissionHandle = handle as FileSystemDirectoryHandle & {
      queryPermission?: (descriptor?: { mode?: "readwrite" | "read" }) => Promise<PermissionState>;
      requestPermission?: (descriptor?: { mode?: "readwrite" | "read" }) => Promise<PermissionState>;
    };
    const permission = permissionHandle.queryPermission
      ? await permissionHandle.queryPermission({ mode: "readwrite" })
      : "prompt";
    const granted = permission === "granted"
      ? "granted"
      : permissionHandle.requestPermission
        ? await permissionHandle.requestPermission({ mode: "readwrite" })
        : "denied";

    if (granted !== "granted") {
      return null;
    }

    const { entries, diagnostics } = await scanDirectoryHandle(handle);
    return toFolderOpenResult(handle.name, handle.name, entries, diagnostics);
  } catch {
    void deleteRecentFolderHandle(folder.name);
    return null;
  }
}

// ── Fallback: FileList from <input webkitdirectory> ────────────────────

export function fileListToEntries(files: FileList): FolderOpenResult {
  const entries: FolderEntry[] = [];
  const first = files[0] as File & { webkitRelativePath?: string };
  const folderName = first?.webkitRelativePath?.split("/")[0] ?? "Cartella selezionata";
  let nestedSupportedDiscardedCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i] as File & { webkitRelativePath?: string };
    const relativePath = file.webkitRelativePath || file.name;
    if (!isImageFile(file.name)) continue;
    if (!isTopLevelRelativePath(relativePath)) {
      nestedSupportedDiscardedCount += 1;
      continue;
    }
    entries.push({
      name: file.name,
      file,
      relativePath,
    });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return toFolderOpenResult(
    folderName,
    folderName,
    entries,
    buildFolderDiagnostics("file-input", folderName, entries.length, nestedSupportedDiscardedCount),
  );
}

// ── Build placeholder assets from folder entries (instant) ─────────────

/**
 * Creates ImageAsset[] immediately from directory entries — no image reading.
 * Width/height are 0 until the thumbnail worker reports them.
 * Also populates the global fileStore.
 */
export function buildPlaceholderAssets(entries: FolderEntry[]): ImageAsset[] {
  previewGeneration += 1;
  for (const url of onDemandPreviewStore.values()) {
    URL.revokeObjectURL(url);
  }
  for (const url of livePreviewStore.values()) {
    URL.revokeObjectURL(url);
  }
  onDemandPreviewStore.clear();
  onDemandPreviewPromiseStore.clear();
  livePreviewStore.clear();
  fileHandleStore.clear();
  filePromiseStore.clear();
  assetPathStore.clear();
  assetAbsolutePathStore.clear();
  assetSourceFileKeyStore.clear();
  sidecarHandleByAssetId.clear();
  fileStore.clear();

  return entries.map((entry) => {
    const id = buildAssetId(entry.relativePath);
    const sourceFileKey = entry.file
      ? buildSourceFileKey(entry.file, entry.relativePath)
      : entry.size !== undefined && entry.lastModified !== undefined
        ? buildSourceFileKeyFromStats(entry.relativePath, entry.size, entry.lastModified)
        : buildPlaceholderSourceFileKey(entry.relativePath);
    if (entry.file) {
      fileStore.set(id, entry.file);
    }
    assetPathStore.set(id, entry.relativePath);
    assetSourceFileKeyStore.set(id, sourceFileKey);
    if (entry.absolutePath) {
      assetAbsolutePathStore.set(id, entry.absolutePath);
    }
    if (entry.fileHandle) {
      fileHandleStore.set(id, entry.fileHandle);
    }

    const sidecarHandle = sidecarHandleByStemPath.get(stemPath(entry.relativePath));
    if (sidecarHandle) {
      sidecarHandleByAssetId.set(id, sidecarHandle);
    }

    return {
      id,
      fileName: entry.name,
      path: entry.relativePath,
      sourceFileKey,
      rating: 0,
      pickStatus: "unmarked" as const,
      colorLabel: null,
      width: 0,
      height: 0,
      orientation: "horizontal" as const, // placeholder — updated by worker
      aspectRatio: 4 / 3, // placeholder
      thumbnailUrl: undefined,
      previewUrl: undefined,
      sourceUrl: undefined,
    };
  });
}

export async function getFileForAsset(assetId: string): Promise<File | null> {
  const existing = fileStore.get(assetId);
  if (existing) {
    return existing;
  }

  const pending = filePromiseStore.get(assetId);
  if (pending) {
    return pending;
  }

  const handle = fileHandleStore.get(assetId);
  if (handle) {
    const task = handle.getFile()
      .then((file) => {
        fileStore.set(assetId, file);
        return file;
      })
      .catch(() => null)
      .finally(() => {
        if (filePromiseStore.get(assetId) === task) {
          filePromiseStore.delete(assetId);
        }
      });

    filePromiseStore.set(assetId, task);
    return task;
  }

  const absolutePath = assetAbsolutePathStore.get(assetId);
  if (!absolutePath || !hasDesktopFileBridge()) {
    return null;
  }

  const task = window.filexDesktop!.readFile(absolutePath)
    .then((payload) => {
      if (!payload) {
        return null;
      }

      const file = new File([toOwnedArrayBuffer(payload.bytes)], payload.name, {
        lastModified: payload.lastModified,
      });
      fileStore.set(assetId, file);
      return file;
    })
    .catch(() => null)
    .finally(() => {
      if (filePromiseStore.get(assetId) === task) {
        filePromiseStore.delete(assetId);
      }
    });

  filePromiseStore.set(assetId, task);
  return task;
}

async function ensureSidecarHandle(assetId: string): Promise<FileSystemFileHandle | null> {
  const existing = sidecarHandleByAssetId.get(assetId);
  if (existing) return existing;

  const relativePath = assetPathStore.get(assetId);
  if (!relativePath) return null;

  const dirPath = dirname(relativePath);
  const dirHandle = directoryHandleByPath.get(dirPath);
  if (!dirHandle) return null;

  const sidecarName = `${basenameWithoutExt(relativePath)}.xmp`;
  try {
    const handle = await dirHandle.getFileHandle(sidecarName, { create: true });
    sidecarHandleByAssetId.set(assetId, handle);
    sidecarHandleByStemPath.set(stemPath(relativePath), handle);
    return handle;
  } catch {
    return null;
  }
}

export async function readSidecarXmp(assetId: string): Promise<string | null> {
  const handle = sidecarHandleByAssetId.get(assetId);
  if (handle) {
    try {
      const file = await handle.getFile();
      return await file.text();
    } catch {
      return null;
    }
  }

  const absolutePath = assetAbsolutePathStore.get(assetId);
  if (!absolutePath || !hasDesktopSidecarBridge()) {
    return null;
  }

  return window.filexDesktop!.readSidecarXmp(absolutePath);
}

export async function writeSidecarXmp(assetId: string, xml: string): Promise<boolean> {
  const absolutePath = assetAbsolutePathStore.get(assetId);
  if (absolutePath && hasDesktopSidecarBridge()) {
    return window.filexDesktop!.writeSidecarXmp(absolutePath, xml);
  }

  const handle = await ensureSidecarHandle(assetId);
  if (!handle) return false;
  try {
    const writable = await handle.createWritable();
    await writable.write(xml);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a preview (full-resolution) blob URL on-demand for a given asset.
 * Returns the URL — caller is responsible for revoking when done.
 * Extracted asynchronously to support resolving embedded JPEG previews from RAWs.
 */
export async function createOnDemandPreviewAsync(
  assetId: string,
  priority = 0,
  options: OnDemandPreviewOptions = {},
): Promise<string | null> {
  const cacheKey = getOnDemandPreviewCacheKey(assetId, options);
  const cached = onDemandPreviewStore.get(cacheKey);
  if (cached) return cached;

  const pending = onDemandPreviewPromiseStore.get(cacheKey);
  if (pending) {
    rawPreviewPipeline?.bumpPriority(assetId, priority);
    return pending;
  }

  const absolutePath = assetAbsolutePathStore.get(assetId);

  const generation = previewGeneration;
  const task = (async () => {
    if (absolutePath && hasDesktopPreviewBridge()) {
      try {
        const preview = await window.filexDesktop!.getPreview(absolutePath, {
          maxDimension: options.maxDimension,
          sourceFileKey: assetSourceFileKeyStore.get(assetId),
        });
        if (!preview) {
          return null;
        }

        const blob = new Blob([toOwnedArrayBuffer(preview.bytes)], { type: preview.mimeType });
        const url = URL.createObjectURL(blob);
        if (generation !== previewGeneration) {
          URL.revokeObjectURL(url);
          return null;
        }

        onDemandPreviewStore.set(cacheKey, url);
        preloadImageUrls([url]);
        return url;
      } catch {
        return null;
      }
    }

    const file = await getFileForAsset(assetId);
    if (!file) return null;

    // For browser-decodable formats, a blob URL to the original file works directly.
    if (isBrowserDecodable(file.name)) {
      const url = URL.createObjectURL(file);
      if (generation !== previewGeneration) {
        URL.revokeObjectURL(url);
        return null;
      }
      onDemandPreviewStore.set(cacheKey, url);
      preloadImageUrls([url]);
      return url;
    }

    try {
      const buffer = await file.arrayBuffer();
      const jpegBuffer = rawPreviewPipeline
        ? await rawPreviewPipeline.extract(assetId, buffer, priority)
        : (await import("../workers/raw-jpeg-extractor")).extractEmbeddedJpeg(buffer);
      if (!jpegBuffer) return null;

      const blob = new Blob([jpegBuffer], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      if (generation !== previewGeneration) {
        URL.revokeObjectURL(url);
        return null;
      }

      onDemandPreviewStore.set(cacheKey, url);
      preloadImageUrls([url]);
      return url;
    } catch (err) {
      console.error("RAW preview extraction failed:", err);
      return null;
    }
  })();

  onDemandPreviewPromiseStore.set(cacheKey, task);
  task.finally(() => {
    if (onDemandPreviewPromiseStore.get(cacheKey) === task) {
      onDemandPreviewPromiseStore.delete(cacheKey);
    }
  });
  return task;
}

export async function warmOnDemandPreviewCache(
  assetId: string,
  _priority = 0,
  options: OnDemandPreviewOptions = {},
): Promise<boolean> {
  const absolutePath = assetAbsolutePathStore.get(assetId);
  if (absolutePath && hasDesktopPreviewWarmBridge()) {
    try {
      return await window.filexDesktop!.warmPreview(absolutePath, {
        maxDimension: options.maxDimension,
        sourceFileKey: assetSourceFileKeyStore.get(assetId),
      });
    } catch {
      return false;
    }
  }

  const url = await createOnDemandPreviewAsync(assetId, _priority, options);
  return Boolean(url);
}

export interface AssetDiskChange {
  id: string;
  sourceFileKey: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  sourceUrl?: string;
  width?: number;
  height?: number;
  orientation?: "horizontal" | "vertical" | "square";
  aspectRatio?: number;
}

/**
 * Checks whether selected assets were modified on disk by external tools (e.g. Photoshop).
 * If changed, refreshes the in-memory file store and invalidates cached on-demand previews.
 */
export async function detectChangedAssetsOnDisk(assetIds: string[]): Promise<AssetDiskChange[]> {
  if (assetIds.length === 0) return [];

  const changes: AssetDiskChange[] = [];
  const uniqueIds = Array.from(new Set(assetIds));

  for (const assetId of uniqueIds) {
    const handle = fileHandleStore.get(assetId);
    const absolutePath = assetAbsolutePathStore.get(assetId);
    if (!handle && (!absolutePath || !hasDesktopFileBridge())) continue;

    try {
      let latestFile: File | null = null;
      if (handle) {
        latestFile = await handle.getFile();
      } else if (absolutePath) {
        const payload = await window.filexDesktop!.readFile(absolutePath);
        if (payload) {
          latestFile = new File([toOwnedArrayBuffer(payload.bytes)], payload.name, {
            lastModified: payload.lastModified,
          });
        }
      }
      if (!latestFile) {
        continue;
      }
      const currentFile = fileStore.get(assetId);
      const hasChanged =
        !currentFile ||
        currentFile.lastModified !== latestFile.lastModified ||
        currentFile.size !== latestFile.size;

      if (!hasChanged) continue;

      fileStore.set(assetId, latestFile);
      invalidateOnDemandPreview(assetId);

      const relativePath = assetPathStore.get(assetId) ?? latestFile.name;
      const nextSourceFileKey = buildSourceFileKey(latestFile, relativePath);
      assetSourceFileKeyStore.set(assetId, nextSourceFileKey);
      const next: AssetDiskChange = {
        id: assetId,
        sourceFileKey: nextSourceFileKey,
      };

      if (isBrowserDecodable(latestFile.name)) {
        revokeLivePreviewUrl(assetId);
        const liveUrl = URL.createObjectURL(latestFile);
        livePreviewStore.set(assetId, liveUrl);
        preloadImageUrls([liveUrl]);

        next.thumbnailUrl = liveUrl;
        next.previewUrl = liveUrl;
        next.sourceUrl = liveUrl;

        const dims = await readImageDimensions(latestFile);
        if (dims) {
          next.width = dims.width;
          next.height = dims.height;
          next.orientation = detectOrientation(dims.width, dims.height);
          next.aspectRatio = dims.width / dims.height;
        }
      }

      changes.push(next);
    } catch {
      // Ignore single-file read failures and continue checking the others.
    }
  }

  return changes;
}

// ── Subfolder extraction ───────────────────────────────────────────────

/**
 * Extract the subfolder portion from an asset's path relative to the root folder.
 * e.g. "Wedding/Ceremony/IMG_001.jpg" → "Ceremony"
 *      "Wedding/IMG_002.jpg" → "" (root)
 * The first segment is the root folder name, so we skip it.
 */
export function getSubfolder(assetPath: string): string {
  const parts = assetPath.split("/");
  // parts: ["rootFolder", ..., "filename"]
  // subfolder = everything between root and filename
  if (parts.length <= 2) return ""; // file is in root
  return parts.slice(1, -1).join("/");
}

/**
 * Build a sorted list of unique subfolder names from a set of assets.
 * Returns entries with folder name and count. Root-level files get folder = "".
 */
export function extractSubfolders(
  assets: ImageAsset[]
): { folder: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const asset of assets) {
    const folder = getSubfolder(asset.path);
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  const result = Array.from(counts.entries())
    .map(([folder, count]) => ({ folder, count }))
    .sort((a, b) => a.folder.localeCompare(b.folder));
  return result;
}

// ── File operations (copy / move / save-as) ───────────────────────────

type FileOpResult = "ok" | "cancelled" | "error" | "no-file" | "unsupported";

/** Returns the relative virtual path for an asset (e.g. "Folder/sub/IMG_001.CR3") */
export function getAssetRelativePath(assetId: string): string | null {
  return assetPathStore.get(assetId) ?? null;
}

export function getAssetAbsolutePath(assetId: string): string | null {
  return assetAbsolutePathStore.get(assetId) ?? null;
}

export function getAssetAbsolutePaths(assetIds: string[]): string[] {
  const uniquePaths = new Set<string>();
  for (const assetId of assetIds) {
    const absolutePath = assetAbsolutePathStore.get(assetId);
    if (absolutePath) {
      uniquePaths.add(absolutePath);
    }
  }

  return Array.from(uniquePaths);
}

/**
 * Copy one or more assets to a user-chosen destination folder (FSAA).
 * Opens ONE directory picker for all files.
 */
export async function copyAssetsToFolder(assetIds: string[]): Promise<FileOpResult> {
  if (assetIds.length === 0) return "no-file";
  if (!("showDirectoryPicker" in window)) return "unsupported";

  let destDirHandle: FileSystemDirectoryHandle;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    destDirHandle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
    return "error";
  }

  let hasError = false;
  for (const assetId of assetIds) {
    const file = await getFileForAsset(assetId);
    if (!file) { hasError = true; continue; }
    try {
      const destFileHandle = await destDirHandle.getFileHandle(file.name, { create: true });
      const writable = await destFileHandle.createWritable();
      await writable.write(await file.arrayBuffer());
      await writable.close();
    } catch {
      hasError = true;
    }
  }

  return hasError ? "error" : "ok";
}

/**
 * Move one or more assets to a user-chosen destination folder (FSAA).
 * Copies the bytes, then removes the originals using the stored parent handle.
 * Returns the list of successfully moved assetIds.
 */
export async function moveAssetsToFolder(assetIds: string[]): Promise<{ result: FileOpResult; movedIds: string[] }> {
  if (assetIds.length === 0) return { result: "no-file", movedIds: [] };
  if (!("showDirectoryPicker" in window)) return { result: "unsupported", movedIds: [] };

  let destDirHandle: FileSystemDirectoryHandle;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    destDirHandle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return { result: "cancelled", movedIds: [] };
    return { result: "error", movedIds: [] };
  }

  let hasError = false;
  const movedIds: string[] = [];

  for (const assetId of assetIds) {
    const file = await getFileForAsset(assetId);
    if (!file) { hasError = true; continue; }

    try {
      const relativePath = assetPathStore.get(assetId);
      if (!relativePath) {
        hasError = true;
        continue;
      }
      const parentPath = dirname(relativePath);
      const parentHandle = directoryHandleByPath.get(parentPath);
      if (!parentHandle) {
        // No source directory handle (e.g. webkitdirectory fallback): cannot perform a true move.
        hasError = true;
        continue;
      }

      const destFileHandle = await destDirHandle.getFileHandle(file.name, { create: true });
      const writable = await destFileHandle.createWritable();
      await writable.write(await file.arrayBuffer());
      await writable.close();

      // Remove from source. If this fails, treat as partial failure and keep asset in UI.
      await parentHandle.removeEntry(file.name);

      assetPathStore.delete(assetId);
      assetAbsolutePathStore.delete(assetId);
      fileStore.delete(assetId);
      fileHandleStore.delete(assetId);
      filePromiseStore.delete(assetId);
      movedIds.push(assetId);
    } catch {
      hasError = true;
    }
  }

  return { result: hasError ? "error" : "ok", movedIds };
}

/**
 * Save a single asset to a user-chosen location (like "Save As").
 * Falls back to a normal download if showSaveFilePicker is unavailable.
 */
export async function saveAssetAs(assetId: string): Promise<FileOpResult> {
  const file = await getFileForAsset(assetId);
  if (!file) return "no-file";

  // Fallback for browsers without showSaveFilePicker (Firefox, Safari)
  if (!("showSaveFilePicker" in window)) {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return "ok";
  }

  try {
    const ext = extOf(file.name).replace(".", "").toLowerCase();
    const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
      : ext === "png" ? "image/png"
      : ext === "webp" ? "image/webp"
      : "application/octet-stream";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle = await (window as any).showSaveFilePicker({
      suggestedName: file.name,
      types: [{ description: "File immagine", accept: { [mimeType]: [`.${ext}`] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(await file.arrayBuffer());
    await writable.close();
    return "ok";
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
    return "error";
  }
}

// ── Recent folders ─────────────────────────────────────────────────────

const RECENT_KEY = "photo-selector-recent-folders";
const MAX_RECENT = 8;

export interface RecentFolder {
  name: string;
  path?: string;
  imageCount: number;
  openedAt: number;
}

export function getRecentFolders(): RecentFolder[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addRecentFolder(name: string, imageCount: number, path?: string): void {
  try {
    const recent = getRecentFolders().filter((f) => f.name !== name || f.path !== path);
    recent.unshift({ name, path, imageCount, openedAt: Date.now() });
    if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // ignore
  }
}
