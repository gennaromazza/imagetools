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
const assetPathStore = new Map<string, string>();
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

function revokeLivePreviewUrl(assetId: string): void {
  const current = livePreviewStore.get(assetId);
  if (current) {
    URL.revokeObjectURL(current);
    livePreviewStore.delete(assetId);
  }
}

function invalidateOnDemandPreview(assetId: string): void {
  const current = onDemandPreviewStore.get(assetId);
  if (current) {
    URL.revokeObjectURL(current);
    onDemandPreviewStore.delete(assetId);
  }
  onDemandPreviewPromiseStore.delete(assetId);
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

function buildSourceFileKey(file: File, relativePath: string): string {
  return `${relativePath}::${file.size}::${file.lastModified}`;
}

export function buildAssetId(file: File, relativePath: string): string {
  const key = buildSourceFileKey(file, relativePath);
  return `asset-${hashString(key)}-${sanitizeId(relativePath)}`;
}

// ── Folder entry ───────────────────────────────────────────────────────

export interface FolderEntry {
  name: string;
  file: File;
  relativePath: string;
  fileHandle?: FileSystemFileHandle;
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

async function scanDirectoryHandle(dirHandle: FileSystemDirectoryHandle): Promise<FolderEntry[]> {
  sidecarHandleByStemPath.clear();
  directoryHandleByPath.clear();

  const entries: FolderEntry[] = [];

  async function scanDir(handle: FileSystemDirectoryHandle, pathPrefix: string) {
    directoryHandleByPath.set(pathPrefix, handle);
    for await (const [entryName, childHandle] of (handle as any).entries()) {
      if (childHandle.kind === "directory") {
        await scanDir(
          childHandle as FileSystemDirectoryHandle,
          `${pathPrefix}/${entryName}`
        );
      } else if (childHandle.kind === "file") {
        const relPath = `${pathPrefix}/${entryName}`;
        if (extensionOf(entryName) === ".xmp") {
          sidecarHandleByStemPath.set(stemPath(relPath), childHandle as FileSystemFileHandle);
          continue;
        }
        if (!isImageFile(entryName)) continue;
        const file: File = await (childHandle as FileSystemFileHandle).getFile();
        entries.push({
          name: entryName,
          file,
          relativePath: relPath,
          fileHandle: childHandle as FileSystemFileHandle,
        });
      }
    }
  }

  await scanDir(dirHandle, dirHandle.name);
  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return entries;
}

// ── File System Access API ─────────────────────────────────────────────

export function hasNativeFolderAccess(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/**
 * Open a folder with the File System Access API (Chrome/Edge).
 * Recursively scans subfolders for image files.
 * Returns null if the user cancels the picker.
 */
export async function openFolderNative(): Promise<{
  name: string;
  entries: FolderEntry[];
} | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dirHandle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({
      mode: "readwrite",
    });
    const entries = await scanDirectoryHandle(dirHandle);
    void saveRecentFolderHandle(dirHandle.name, dirHandle);
    return { name: dirHandle.name, entries };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }
}

export async function reopenRecentFolder(name: string): Promise<{
  name: string;
  entries: FolderEntry[];
} | null> {
  const handle = await loadRecentFolderHandle(name);
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

    const entries = await scanDirectoryHandle(handle);
    return { name: handle.name, entries };
  } catch {
    void deleteRecentFolderHandle(name);
    return null;
  }
}

// ── Fallback: FileList from <input webkitdirectory> ────────────────────

export function fileListToEntries(files: FileList): {
  name: string;
  entries: FolderEntry[];
} {
  const entries: FolderEntry[] = [];
  const first = files[0] as File & { webkitRelativePath?: string };
  const folderName = first?.webkitRelativePath?.split("/")[0] ?? "Cartella selezionata";

  for (let i = 0; i < files.length; i++) {
    const file = files[i] as File & { webkitRelativePath?: string };
    if (!isImageFile(file.name)) continue;
    entries.push({
      name: file.name,
      file,
      relativePath: file.webkitRelativePath || file.name,
    });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { name: folderName, entries };
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
  assetPathStore.clear();
  sidecarHandleByAssetId.clear();
  fileStore.clear();

  return entries.map((entry) => {
    const id = buildAssetId(entry.file, entry.relativePath);
    fileStore.set(id, entry.file);
    assetPathStore.set(id, entry.relativePath);
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
      sourceFileKey: buildSourceFileKey(entry.file, entry.relativePath),
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
  if (!handle) return null;
  try {
    const file = await handle.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

export async function writeSidecarXmp(assetId: string, xml: string): Promise<boolean> {
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
): Promise<string | null> {
  const cached = onDemandPreviewStore.get(assetId);
  if (cached) return cached;

  const pending = onDemandPreviewPromiseStore.get(assetId);
  if (pending) {
    rawPreviewPipeline?.bumpPriority(assetId, priority);
    return pending;
  }

  const file = fileStore.get(assetId);
  if (!file) return null;

  const generation = previewGeneration;
  const task = (async () => {
    // For browser-decodable formats, a blob URL to the original file works directly.
    if (isBrowserDecodable(file.name)) {
      const url = URL.createObjectURL(file);
      if (generation !== previewGeneration) {
        URL.revokeObjectURL(url);
        return null;
      }
      onDemandPreviewStore.set(assetId, url);
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

      onDemandPreviewStore.set(assetId, url);
      preloadImageUrls([url]);
      return url;
    } catch (err) {
      console.error("RAW preview extraction failed:", err);
      return null;
    }
  })();

  onDemandPreviewPromiseStore.set(assetId, task);
  task.finally(() => {
    if (onDemandPreviewPromiseStore.get(assetId) === task) {
      onDemandPreviewPromiseStore.delete(assetId);
    }
  });
  return task;
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
    if (!handle) continue;

    try {
      const latestFile = await handle.getFile();
      const currentFile = fileStore.get(assetId);
      const hasChanged =
        !currentFile ||
        currentFile.lastModified !== latestFile.lastModified ||
        currentFile.size !== latestFile.size;

      if (!hasChanged) continue;

      fileStore.set(assetId, latestFile);
      invalidateOnDemandPreview(assetId);

      const relativePath = assetPathStore.get(assetId) ?? latestFile.name;
      const next: AssetDiskChange = {
        id: assetId,
        sourceFileKey: buildSourceFileKey(latestFile, relativePath),
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
    const file = fileStore.get(assetId);
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
    const file = fileStore.get(assetId);
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
      fileStore.delete(assetId);
      fileHandleStore.delete(assetId);
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
  const file = fileStore.get(assetId);
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

export function addRecentFolder(name: string, imageCount: number): void {
  try {
    const recent = getRecentFolders().filter((f) => f.name !== name);
    recent.unshift({ name, imageCount, openedAt: Date.now() });
    if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // ignore
  }
}
