/**
 * Folder access — File System Access API (Chrome/Edge) with <input webkitdirectory> fallback.
 * Also manages recent-folders list in localStorage and the in-memory file store.
 */
import { preloadImageUrls } from "./image-cache";
import { RawPreviewPipeline } from "./raw-preview-pipeline";
import { getDesktopRecentFolders, hasDesktopStateApi, removeDesktopRecentFolder, saveDesktopRecentFolder, } from "./desktop-store";
// ── Supported formats ──────────────────────────────────────────────────
const STANDARD_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const RAW_EXTENSIONS = new Set([
    ".cr2", ".cr3", ".crw", // Canon (CR2, CR3, older CRW)
    ".nef", ".nrw", // Nikon (NEF, Coolpix NRW)
    ".arw", ".srf", ".sr2", // Sony (ARW, older SRF/SR2)
    ".raf", // Fujifilm
    ".dng", // Adobe DNG (universal)
    ".rw2", // Panasonic / Lumix
    ".orf", // Olympus / OM System
    ".pef", // Pentax
    ".srw", // Samsung
    ".3fr", // Hasselblad
    ".x3f", // Sigma / Foveon
    ".gpr", // GoPro (DNG-based)
]);
function extOf(name) {
    const i = name.lastIndexOf(".");
    return i >= 0 ? name.slice(i).toLowerCase() : "";
}
export function isImageFile(name) {
    // Ignore macOS AppleDouble sidecars (e.g. ._IMG_0001.CR2):
    // they are metadata files, not real images, and trigger false decode errors.
    if (name.startsWith("._"))
        return false;
    const ext = extOf(name);
    return STANDARD_EXTENSIONS.has(ext) || RAW_EXTENSIONS.has(ext);
}
export function isRawFile(name) {
    return RAW_EXTENSIONS.has(extOf(name));
}
/** Can the browser natively decode this format via <img> / createImageBitmap? */
export function isBrowserDecodable(name) {
    return STANDARD_EXTENSIONS.has(extOf(name));
}
// ── File store (module-level Map) ──────────────────────────────────────
/** In-memory store: assetId → File.  Used for on-demand preview generation. */
export const fileStore = new Map();
const fileHandleStore = new Map();
const filePromiseStore = new Map();
const assetPathStore = new Map();
const assetAbsolutePathStore = new Map();
const assetSourceFileKeyStore = new Map();
const livePreviewStore = new Map();
const sidecarHandleByAssetId = new Map();
const sidecarHandleByStemPath = new Map();
const directoryHandleByPath = new Map();
const onDemandPreviewStore = new Map();
const onDemandPreviewPromiseStore = new Map();
const rawPreviewPipeline = typeof window !== "undefined" && typeof Worker !== "undefined"
    ? new RawPreviewPipeline()
    : null;
let previewGeneration = 0;
function hasDesktopFolderBridge() {
    return typeof window !== "undefined" && typeof window.filexDesktop?.openFolder === "function";
}
function hasDesktopFileBridge() {
    return typeof window !== "undefined" && typeof window.filexDesktop?.readFile === "function";
}
function hasDesktopPreviewBridge() {
    return typeof window !== "undefined" && typeof window.filexDesktop?.getPreview === "function";
}
function hasDesktopPreviewWarmBridge() {
    return typeof window !== "undefined" && typeof window.filexDesktop?.warmPreview === "function";
}
function hasDesktopQuickPreviewWarmBridge() {
    return typeof window !== "undefined"
        && typeof window.filexDesktop?.warmQuickPreviewFrames === "function";
}
function hasDesktopSidecarBridge() {
    return typeof window !== "undefined"
        && typeof window.filexDesktop?.readSidecarXmp === "function"
        && typeof window.filexDesktop?.writeSidecarXmp === "function";
}
function extensionOf(path) {
    const i = path.lastIndexOf(".");
    return i >= 0 ? path.slice(i).toLowerCase() : "";
}
function stemPath(path) {
    const slash = path.replace(/\\/g, "/").toLowerCase();
    const i = slash.lastIndexOf(".");
    return i >= 0 ? slash.slice(0, i) : slash;
}
function basenameWithoutExt(path) {
    const slash = path.replace(/\\/g, "/");
    const leaf = slash.slice(slash.lastIndexOf("/") + 1);
    const i = leaf.lastIndexOf(".");
    return i >= 0 ? leaf.slice(0, i) : leaf;
}
function dirname(path) {
    const slash = path.replace(/\\/g, "/");
    const i = slash.lastIndexOf("/");
    return i >= 0 ? slash.slice(0, i) : "";
}
function detectOrientation(width, height) {
    if (width === height)
        return "square";
    return height > width ? "vertical" : "horizontal";
}
function toOwnedArrayBuffer(bytes) {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
}
function revokeLivePreviewUrl(assetId) {
    const current = livePreviewStore.get(assetId);
    if (current) {
        URL.revokeObjectURL(current);
        livePreviewStore.delete(assetId);
    }
}
function invalidateOnDemandPreview(assetId) {
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
function getOnDemandPreviewCacheKey(assetId, options = {}) {
    const maxDimension = Math.max(0, Math.round(options.maxDimension ?? 0));
    return `${assetId}::${maxDimension}`;
}
export function getCachedOnDemandPreviewUrl(assetId, options = {}) {
    return onDemandPreviewStore.get(getOnDemandPreviewCacheKey(assetId, options)) ?? null;
}
async function readImageDimensions(file) {
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
            const dims = await new Promise((resolve) => {
                const img = new Image();
                img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0
                    ? { width: img.naturalWidth, height: img.naturalHeight }
                    : null);
                img.onerror = () => resolve(null);
                img.src = objectUrl;
            });
            return dims;
        }
        finally {
            URL.revokeObjectURL(objectUrl);
        }
    }
    catch {
        return null;
    }
}
// ── Asset ID helpers (mirrored from browser-image-assets) ──────────────
function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}
function sanitizeId(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
export function buildSourceFileKey(file, relativePath) {
    return `${relativePath}::${file.size}::${file.lastModified}`;
}
export function buildSourceFileKeyFromStats(relativePath, size, lastModified) {
    return `${relativePath}::${size}::${lastModified}`;
}
function buildPlaceholderSourceFileKey(relativePath) {
    return `${relativePath}::0::0`;
}
export function buildAssetId(relativePath) {
    const normalizedPath = relativePath.replace(/\\/g, "/");
    return `asset-${hashString(normalizedPath.toLowerCase())}-${sanitizeId(normalizedPath)}`;
}
function isTopLevelRelativePath(relativePath) {
    const segments = relativePath.split("/").filter(Boolean);
    return segments.length <= 2;
}
function keepTopLevelEntries(entries) {
    return entries.filter((entry) => isTopLevelRelativePath(entry.relativePath));
}
function buildFolderDiagnostics(source, selectedPath, topLevelSupportedCount, nestedSupportedDiscardedCount, nestedDirectoriesSeen = 0) {
    return {
        source,
        selectedPath,
        topLevelSupportedCount,
        nestedSupportedDiscardedCount,
        totalSupportedSeen: topLevelSupportedCount + nestedSupportedDiscardedCount,
        nestedDirectoriesSeen,
    };
}
function toFolderOpenResult(name, rootPath, entries, diagnostics) {
    return {
        name,
        rootPath,
        entries,
        diagnostics,
    };
}
async function getRecentFolderHandleDb() {
    if (typeof indexedDB === "undefined") {
        return null;
    }
    try {
        return await new Promise((resolve, reject) => {
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
    }
    catch {
        return null;
    }
}
async function saveRecentFolderHandle(name, handle) {
    const db = await getRecentFolderHandleDb();
    if (!db) {
        return;
    }
    await new Promise((resolve) => {
        const tx = db.transaction("recent-directory-handles", "readwrite");
        tx.objectStore("recent-directory-handles").put({ name, handle });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
    });
}
async function loadRecentFolderHandle(name) {
    const db = await getRecentFolderHandleDb();
    if (!db) {
        return null;
    }
    return new Promise((resolve) => {
        const tx = db.transaction("recent-directory-handles", "readonly");
        const request = tx.objectStore("recent-directory-handles").get(name);
        request.onsuccess = () => {
            const record = request.result;
            resolve(record?.handle ?? null);
        };
        request.onerror = () => resolve(null);
    });
}
async function deleteRecentFolderHandle(name) {
    const db = await getRecentFolderHandleDb();
    if (!db) {
        return;
    }
    await new Promise((resolve) => {
        const tx = db.transaction("recent-directory-handles", "readwrite");
        tx.objectStore("recent-directory-handles").delete(name);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
    });
}
async function countNestedDirectoryHandleImagesInternal(dirHandle, includeCurrentFiles) {
    let nestedSupportedDiscardedCount = 0;
    let nestedDirectoriesSeen = 0;
    for await (const [nestedName, nestedHandle] of dirHandle.entries()) {
        if (nestedHandle.kind === "file") {
            if (includeCurrentFiles && isImageFile(nestedName)) {
                nestedSupportedDiscardedCount += 1;
            }
            continue;
        }
        nestedDirectoriesSeen += 1;
        const nestedResult = await countNestedDirectoryHandleImagesInternal(nestedHandle, true);
        nestedDirectoriesSeen += nestedResult.nestedDirectoriesSeen;
        nestedSupportedDiscardedCount += nestedResult.nestedSupportedDiscardedCount;
    }
    return {
        nestedSupportedDiscardedCount,
        nestedDirectoriesSeen,
    };
}
async function scanDirectoryHandle(dirHandle) {
    sidecarHandleByStemPath.clear();
    directoryHandleByPath.clear();
    const entries = [];
    directoryHandleByPath.set(dirHandle.name, dirHandle);
    for await (const [entryName, childHandle] of dirHandle.entries()) {
        if (childHandle.kind !== "file") {
            continue;
        }
        const relPath = `${dirHandle.name}/${entryName}`;
        if (extensionOf(entryName) === ".xmp") {
            sidecarHandleByStemPath.set(stemPath(relPath), childHandle);
            continue;
        }
        if (!isImageFile(entryName))
            continue;
        entries.push({
            name: entryName,
            relativePath: relPath,
            fileHandle: childHandle,
        });
    }
    entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    const nestedCounts = await countNestedDirectoryHandleImagesInternal(dirHandle, false);
    return {
        entries,
        diagnostics: buildFolderDiagnostics("browser-native", dirHandle.name, entries.length, nestedCounts.nestedSupportedDiscardedCount, nestedCounts.nestedDirectoriesSeen),
    };
}
// ── File System Access API ─────────────────────────────────────────────
export function hasNativeFolderAccess() {
    return hasDesktopFolderBridge()
        || (typeof window !== "undefined" && "showDirectoryPicker" in window);
}
/**
 * Open a folder with the File System Access API (Chrome/Edge).
 * Reads only top-level files and keeps diagnostics about nested files.
 * Returns null if the user cancels the picker.
 */
export async function openFolderNative() {
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
        const diagnostics = buildFolderDiagnostics("desktop-native", result.diagnostics?.selectedPath ?? result.rootPath, entries.length, result.diagnostics?.nestedSupportedDiscardedCount ?? Math.max(0, mappedEntries.length - entries.length), result.diagnostics?.nestedDirectoriesSeen ?? 0);
        return toFolderOpenResult(result.name, result.rootPath, entries, diagnostics);
    }
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dirHandle = await window.showDirectoryPicker({
            mode: "readwrite",
        });
        const { entries, diagnostics } = await scanDirectoryHandle(dirHandle);
        void saveRecentFolderHandle(dirHandle.name, dirHandle);
        return toFolderOpenResult(dirHandle.name, dirHandle.name, entries, diagnostics);
    }
    catch (err) {
        if (err instanceof DOMException && err.name === "AbortError")
            return null;
        throw err;
    }
}
export async function reopenRecentFolder(folder) {
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
        const diagnostics = buildFolderDiagnostics("desktop-native", result.diagnostics?.selectedPath ?? result.rootPath, entries.length, result.diagnostics?.nestedSupportedDiscardedCount ?? Math.max(0, mappedEntries.length - entries.length), result.diagnostics?.nestedDirectoriesSeen ?? 0);
        return toFolderOpenResult(result.name, result.rootPath, entries, diagnostics);
    }
    const handle = await loadRecentFolderHandle(folder.name);
    if (!handle) {
        return null;
    }
    try {
        const permissionHandle = handle;
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
    }
    catch {
        void deleteRecentFolderHandle(folder.name);
        return null;
    }
}
// ── Fallback: FileList from <input webkitdirectory> ────────────────────
export function fileListToEntries(files) {
    const entries = [];
    const first = files[0];
    const folderName = first?.webkitRelativePath?.split("/")[0] ?? "Cartella selezionata";
    let nestedSupportedDiscardedCount = 0;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const relativePath = file.webkitRelativePath || file.name;
        if (!isImageFile(file.name))
            continue;
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
    return toFolderOpenResult(folderName, folderName, entries, buildFolderDiagnostics("file-input", folderName, entries.length, nestedSupportedDiscardedCount));
}
// ── Build placeholder assets from folder entries (instant) ─────────────
/**
 * Creates ImageAsset[] immediately from directory entries — no image reading.
 * Width/height are 0 until the thumbnail worker reports them.
 * Also populates the global fileStore.
 */
export function buildPlaceholderAssets(entries) {
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
            pickStatus: "unmarked",
            colorLabel: null,
            width: 0,
            height: 0,
            orientation: "horizontal", // placeholder — updated by worker
            aspectRatio: 4 / 3, // placeholder
            thumbnailUrl: undefined,
            previewUrl: undefined,
            sourceUrl: undefined,
        };
    });
}
export async function getFileForAsset(assetId) {
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
    const task = window.filexDesktop.readFile(absolutePath)
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
async function ensureSidecarHandle(assetId) {
    const existing = sidecarHandleByAssetId.get(assetId);
    if (existing)
        return existing;
    const relativePath = assetPathStore.get(assetId);
    if (!relativePath)
        return null;
    const dirPath = dirname(relativePath);
    const dirHandle = directoryHandleByPath.get(dirPath);
    if (!dirHandle)
        return null;
    const sidecarName = `${basenameWithoutExt(relativePath)}.xmp`;
    try {
        const handle = await dirHandle.getFileHandle(sidecarName, { create: true });
        sidecarHandleByAssetId.set(assetId, handle);
        sidecarHandleByStemPath.set(stemPath(relativePath), handle);
        return handle;
    }
    catch {
        return null;
    }
}
export async function readSidecarXmp(assetId) {
    const handle = sidecarHandleByAssetId.get(assetId);
    if (handle) {
        try {
            const file = await handle.getFile();
            return await file.text();
        }
        catch {
            return null;
        }
    }
    const absolutePath = assetAbsolutePathStore.get(assetId);
    if (!absolutePath || !hasDesktopSidecarBridge()) {
        return null;
    }
    return window.filexDesktop.readSidecarXmp(absolutePath);
}
export async function writeSidecarXmp(assetId, xml) {
    const absolutePath = assetAbsolutePathStore.get(assetId);
    if (absolutePath && hasDesktopSidecarBridge()) {
        return window.filexDesktop.writeSidecarXmp(absolutePath, xml);
    }
    const handle = await ensureSidecarHandle(assetId);
    if (!handle)
        return false;
    try {
        const writable = await handle.createWritable();
        await writable.write(xml);
        await writable.close();
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Create a preview (full-resolution) blob URL on-demand for a given asset.
 * Returns the URL — caller is responsible for revoking when done.
 * Extracted asynchronously to support resolving embedded JPEG previews from RAWs.
 */
export async function createOnDemandPreviewAsync(assetId, priority = 0, options = {}) {
    const cacheKey = getOnDemandPreviewCacheKey(assetId, options);
    const cached = onDemandPreviewStore.get(cacheKey);
    if (cached)
        return cached;
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
                const preview = await window.filexDesktop.getPreview(absolutePath, {
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
            }
            catch {
                return null;
            }
        }
        const file = await getFileForAsset(assetId);
        if (!file)
            return null;
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
            if (!jpegBuffer)
                return null;
            const blob = new Blob([jpegBuffer], { type: "image/jpeg" });
            const url = URL.createObjectURL(blob);
            if (generation !== previewGeneration) {
                URL.revokeObjectURL(url);
                return null;
            }
            onDemandPreviewStore.set(cacheKey, url);
            preloadImageUrls([url]);
            return url;
        }
        catch (err) {
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
export async function warmOnDemandPreviewCache(assetId, _priority = 0, options = {}) {
    const absolutePath = assetAbsolutePathStore.get(assetId);
    const sourceFileKey = assetSourceFileKeyStore.get(assetId);
    if (absolutePath && hasDesktopQuickPreviewWarmBridge()) {
        try {
            const result = await window.filexDesktop.warmQuickPreviewFrames([{
                    absolutePath,
                    maxDimension: Math.max(0, Math.round(options.maxDimension ?? 0)),
                    sourceFileKey,
                    stage: "fit",
                }]);
            return result.warmedCount > 0;
        }
        catch {
            return false;
        }
    }
    if (absolutePath && hasDesktopPreviewWarmBridge()) {
        try {
            return await window.filexDesktop.warmPreview(absolutePath, {
                maxDimension: options.maxDimension,
                sourceFileKey,
            });
        }
        catch {
            return false;
        }
    }
    const url = await createOnDemandPreviewAsync(assetId, _priority, options);
    return Boolean(url);
}
/**
 * Checks whether selected assets were modified on disk by external tools (e.g. Photoshop).
 * If changed, refreshes the in-memory file store and invalidates cached on-demand previews.
 */
export async function detectChangedAssetsOnDisk(assetIds) {
    if (assetIds.length === 0)
        return [];
    const changes = [];
    const uniqueIds = Array.from(new Set(assetIds));
    for (const assetId of uniqueIds) {
        const handle = fileHandleStore.get(assetId);
        const absolutePath = assetAbsolutePathStore.get(assetId);
        if (!handle && (!absolutePath || !hasDesktopFileBridge()))
            continue;
        try {
            let latestFile = null;
            if (handle) {
                latestFile = await handle.getFile();
            }
            else if (absolutePath) {
                const payload = await window.filexDesktop.readFile(absolutePath);
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
            const hasChanged = !currentFile ||
                currentFile.lastModified !== latestFile.lastModified ||
                currentFile.size !== latestFile.size;
            if (!hasChanged)
                continue;
            fileStore.set(assetId, latestFile);
            invalidateOnDemandPreview(assetId);
            const relativePath = assetPathStore.get(assetId) ?? latestFile.name;
            const nextSourceFileKey = buildSourceFileKey(latestFile, relativePath);
            assetSourceFileKeyStore.set(assetId, nextSourceFileKey);
            const next = {
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
        }
        catch {
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
export function getSubfolder(assetPath) {
    const parts = assetPath.split("/");
    // parts: ["rootFolder", ..., "filename"]
    // subfolder = everything between root and filename
    if (parts.length <= 2)
        return ""; // file is in root
    return parts.slice(1, -1).join("/");
}
/**
 * Build a sorted list of unique subfolder names from a set of assets.
 * Returns entries with folder name and count. Root-level files get folder = "".
 */
export function extractSubfolders(assets) {
    const counts = new Map();
    for (const asset of assets) {
        const folder = getSubfolder(asset.path);
        counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
    const result = Array.from(counts.entries())
        .map(([folder, count]) => ({ folder, count }))
        .sort((a, b) => a.folder.localeCompare(b.folder));
    return result;
}
/** Returns the relative virtual path for an asset (e.g. "Folder/sub/IMG_001.CR3") */
export function getAssetRelativePath(assetId) {
    return assetPathStore.get(assetId) ?? null;
}
export function getAssetAbsolutePath(assetId) {
    return assetAbsolutePathStore.get(assetId) ?? null;
}
export function getAssetAbsolutePaths(assetIds) {
    const uniquePaths = new Set();
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
export async function copyAssetsToFolder(assetIds) {
    if (assetIds.length === 0)
        return "no-file";
    if (!("showDirectoryPicker" in window))
        return "unsupported";
    let destDirHandle;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        destDirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    }
    catch (err) {
        if (err instanceof DOMException && err.name === "AbortError")
            return "cancelled";
        return "error";
    }
    let hasError = false;
    for (const assetId of assetIds) {
        const file = await getFileForAsset(assetId);
        if (!file) {
            hasError = true;
            continue;
        }
        try {
            const destFileHandle = await destDirHandle.getFileHandle(file.name, { create: true });
            const writable = await destFileHandle.createWritable();
            await writable.write(await file.arrayBuffer());
            await writable.close();
        }
        catch {
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
export async function moveAssetsToFolder(assetIds) {
    if (assetIds.length === 0)
        return { result: "no-file", movedIds: [] };
    if (!("showDirectoryPicker" in window))
        return { result: "unsupported", movedIds: [] };
    let destDirHandle;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        destDirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    }
    catch (err) {
        if (err instanceof DOMException && err.name === "AbortError")
            return { result: "cancelled", movedIds: [] };
        return { result: "error", movedIds: [] };
    }
    let hasError = false;
    const movedIds = [];
    for (const assetId of assetIds) {
        const file = await getFileForAsset(assetId);
        if (!file) {
            hasError = true;
            continue;
        }
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
        }
        catch {
            hasError = true;
        }
    }
    return { result: hasError ? "error" : "ok", movedIds };
}
/**
 * Save a single asset to a user-chosen location (like "Save As").
 * Falls back to a normal download if showSaveFilePicker is unavailable.
 */
export async function saveAssetAs(assetId) {
    const file = await getFileForAsset(assetId);
    if (!file)
        return "no-file";
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
        const handle = await window.showSaveFilePicker({
            suggestedName: file.name,
            types: [{ description: "File immagine", accept: { [mimeType]: [`.${ext}`] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(await file.arrayBuffer());
        await writable.close();
        return "ok";
    }
    catch (err) {
        if (err instanceof DOMException && err.name === "AbortError")
            return "cancelled";
        return "error";
    }
}
// ── Recent folders ─────────────────────────────────────────────────────
const RECENT_KEY = "photo-selector-recent-folders";
const MAX_RECENT = 8;
let recentFoldersCache = [];
export function getRecentFolders() {
    if (typeof window === "undefined") {
        return recentFoldersCache;
    }
    if (hasDesktopStateApi()) {
        return recentFoldersCache;
    }
    try {
        const raw = localStorage.getItem(RECENT_KEY);
        recentFoldersCache = raw ? JSON.parse(raw) : [];
        return recentFoldersCache;
    }
    catch {
        recentFoldersCache = [];
        return recentFoldersCache;
    }
}
export function addRecentFolder(name, imageCount, path) {
    const nextFolder = { name, path, imageCount, openedAt: Date.now() };
    if (hasDesktopStateApi()) {
        recentFoldersCache = [nextFolder, ...recentFoldersCache.filter((folder) => folder.path !== path || folder.name !== name)]
            .slice(0, MAX_RECENT);
        void saveDesktopRecentFolder(nextFolder).then((recentFolders) => {
            if (recentFolders) {
                recentFoldersCache = recentFolders;
            }
        });
        return;
    }
    try {
        const recent = getRecentFolders().filter((f) => f.name !== name || f.path !== path);
        recent.unshift(nextFolder);
        if (recent.length > MAX_RECENT)
            recent.length = MAX_RECENT;
        recentFoldersCache = recent;
        localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    }
    catch {
        // ignore
    }
}
export async function hydrateRecentFolders() {
    if (typeof window === "undefined") {
        return recentFoldersCache;
    }
    if (hasDesktopStateApi()) {
        const recentFolders = await getDesktopRecentFolders();
        recentFoldersCache = recentFolders ?? [];
        return recentFoldersCache;
    }
    return getRecentFolders();
}
export async function removeRecentFolder(folderPathOrName) {
    if (typeof window === "undefined") {
        return recentFoldersCache;
    }
    if (hasDesktopStateApi()) {
        const recentFolders = await removeDesktopRecentFolder(folderPathOrName);
        recentFoldersCache = recentFolders ?? [];
        return recentFoldersCache;
    }
    const normalizedValue = folderPathOrName.trim().toLowerCase();
    recentFoldersCache = getRecentFolders().filter((folder) => {
        const folderPath = folder.path?.trim().toLowerCase() ?? "";
        return folderPath !== normalizedValue && folder.name.trim().toLowerCase() !== normalizedValue;
    });
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentFoldersCache));
    return recentFoldersCache;
}
//# sourceMappingURL=folder-access.js.map