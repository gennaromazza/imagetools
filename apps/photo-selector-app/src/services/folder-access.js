/**
 * Folder access — File System Access API (Chrome/Edge) with <input webkitdirectory> fallback.
 * Also manages recent-folders list in localStorage and the in-memory file store.
 */
import { preloadImageUrls } from "./image-cache";
import { RawPreviewPipeline } from "./raw-preview-pipeline";
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
const assetPathStore = new Map();
const sidecarHandleByAssetId = new Map();
const sidecarHandleByStemPath = new Map();
const directoryHandleByPath = new Map();
const onDemandPreviewStore = new Map();
const onDemandPreviewPromiseStore = new Map();
const rawPreviewPipeline = typeof window !== "undefined" && typeof Worker !== "undefined"
    ? new RawPreviewPipeline()
    : null;
let previewGeneration = 0;
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
function buildSourceFileKey(file, relativePath) {
    return `${relativePath}::${file.size}::${file.lastModified}`;
}
export function buildAssetId(file, relativePath) {
    const key = buildSourceFileKey(file, relativePath);
    return `asset-${hashString(key)}-${sanitizeId(relativePath)}`;
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
async function scanDirectoryHandle(dirHandle) {
    sidecarHandleByStemPath.clear();
    directoryHandleByPath.clear();
    const entries = [];
    async function scanDir(handle, pathPrefix) {
        directoryHandleByPath.set(pathPrefix, handle);
        for await (const [entryName, childHandle] of handle.entries()) {
            if (childHandle.kind === "directory") {
                await scanDir(childHandle, `${pathPrefix}/${entryName}`);
            }
            else if (childHandle.kind === "file") {
                const relPath = `${pathPrefix}/${entryName}`;
                if (extensionOf(entryName) === ".xmp") {
                    sidecarHandleByStemPath.set(stemPath(relPath), childHandle);
                    continue;
                }
                if (!isImageFile(entryName))
                    continue;
                const file = await childHandle.getFile();
                entries.push({
                    name: entryName,
                    file,
                    relativePath: relPath,
                    fileHandle: childHandle,
                });
            }
        }
    }
    await scanDir(dirHandle, dirHandle.name);
    entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    return entries;
}
// ── File System Access API ─────────────────────────────────────────────
export function hasNativeFolderAccess() {
    return typeof window !== "undefined" && "showDirectoryPicker" in window;
}
/**
 * Open a folder with the File System Access API (Chrome/Edge).
 * Recursively scans subfolders for image files.
 * Returns null if the user cancels the picker.
 */
export async function openFolderNative() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dirHandle = await window.showDirectoryPicker({
            mode: "readwrite",
        });
        const entries = await scanDirectoryHandle(dirHandle);
        void saveRecentFolderHandle(dirHandle.name, dirHandle);
        return { name: dirHandle.name, entries };
    }
    catch (err) {
        if (err instanceof DOMException && err.name === "AbortError")
            return null;
        throw err;
    }
}
export async function reopenRecentFolder(name) {
    const handle = await loadRecentFolderHandle(name);
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
        const entries = await scanDirectoryHandle(handle);
        return { name: handle.name, entries };
    }
    catch {
        void deleteRecentFolderHandle(name);
        return null;
    }
}
// ── Fallback: FileList from <input webkitdirectory> ────────────────────
export function fileListToEntries(files) {
    const entries = [];
    const first = files[0];
    const folderName = first?.webkitRelativePath?.split("/")[0] ?? "Cartella selezionata";
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!isImageFile(file.name))
            continue;
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
export function buildPlaceholderAssets(entries) {
    previewGeneration += 1;
    for (const url of onDemandPreviewStore.values()) {
        URL.revokeObjectURL(url);
    }
    onDemandPreviewStore.clear();
    onDemandPreviewPromiseStore.clear();
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
    if (!handle)
        return null;
    try {
        const file = await handle.getFile();
        return await file.text();
    }
    catch {
        return null;
    }
}
export async function writeSidecarXmp(assetId, xml) {
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
export async function createOnDemandPreviewAsync(assetId, priority = 0) {
    const cached = onDemandPreviewStore.get(assetId);
    if (cached)
        return cached;
    const pending = onDemandPreviewPromiseStore.get(assetId);
    if (pending) {
        rawPreviewPipeline?.bumpPriority(assetId, priority);
        return pending;
    }
    const file = fileStore.get(assetId);
    if (!file)
        return null;
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
            if (!jpegBuffer)
                return null;
            const blob = new Blob([jpegBuffer], { type: "image/jpeg" });
            const url = URL.createObjectURL(blob);
            if (generation !== previewGeneration) {
                URL.revokeObjectURL(url);
                return null;
            }
            onDemandPreviewStore.set(assetId, url);
            preloadImageUrls([url]);
            return url;
        }
        catch (err) {
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
// ── Recent folders ─────────────────────────────────────────────────────
const RECENT_KEY = "photo-selector-recent-folders";
const MAX_RECENT = 8;
export function getRecentFolders() {
    try {
        const raw = localStorage.getItem(RECENT_KEY);
        return raw ? JSON.parse(raw) : [];
    }
    catch {
        return [];
    }
}
export function addRecentFolder(name, imageCount) {
    try {
        const recent = getRecentFolders().filter((f) => f.name !== name);
        recent.unshift({ name, imageCount, openedAt: Date.now() });
        if (recent.length > MAX_RECENT)
            recent.length = MAX_RECENT;
        localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    }
    catch {
        // ignore
    }
}
//# sourceMappingURL=folder-access.js.map