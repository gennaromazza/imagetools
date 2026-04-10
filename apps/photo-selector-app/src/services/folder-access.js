import { preloadImageUrls } from "./image-cache";
import { getDesktopRecentFolders, removeDesktopRecentFolder, saveDesktopRecentFolder, } from "./desktop-store";
const STANDARD_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const RAW_EXTENSIONS = new Set([
    ".cr2", ".cr3", ".crw",
    ".nef", ".nrw",
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
]);
function extOf(name) {
    const i = name.lastIndexOf(".");
    return i >= 0 ? name.slice(i).toLowerCase() : "";
}
export function isImageFile(name) {
    if (name.startsWith("._"))
        return false;
    const ext = extOf(name);
    return STANDARD_EXTENSIONS.has(ext) || RAW_EXTENSIONS.has(ext);
}
export function isRawFile(name) {
    return RAW_EXTENSIONS.has(extOf(name));
}
export const fileStore = new Map();
const filePromiseStore = new Map();
const assetPathStore = new Map();
const assetAbsolutePathStore = new Map();
const assetSourceFileKeyStore = new Map();
const livePreviewStore = new Map();
const onDemandPreviewStore = new Map();
const onDemandPreviewPromiseStore = new Map();
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
function hasDesktopThumbnailBridge() {
    return typeof window !== "undefined" && typeof window.filexDesktop?.getThumbnail === "function";
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
function hasDesktopCopyBridge() {
    return typeof window !== "undefined" && typeof window.filexDesktop?.copyFilesToFolder === "function";
}
function hasDesktopMoveBridge() {
    return typeof window !== "undefined" && typeof window.filexDesktop?.moveFilesToFolder === "function";
}
function hasDesktopSaveAsBridge() {
    return typeof window !== "undefined" && typeof window.filexDesktop?.saveFileAs === "function";
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
function buildFolderDiagnostics(selectedPath, topLevelSupportedCount, nestedSupportedDiscardedCount, nestedDirectoriesSeen = 0) {
    return {
        source: "desktop-native",
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
export function hasNativeFolderAccess() {
    return hasDesktopFolderBridge();
}
export async function openFolderNative() {
    if (!hasDesktopFolderBridge()) {
        return null;
    }
    const result = await window.filexDesktop.openFolder();
    if (!result) {
        return null;
    }
    const mappedEntries = result.entries.map((entry) => ({
        name: entry.name,
        relativePath: entry.relativePath,
        absolutePath: entry.absolutePath,
        size: entry.size,
        lastModified: entry.lastModified,
        createdAt: entry.createdAt,
    }));
    const entries = keepTopLevelEntries(mappedEntries);
    const diagnostics = buildFolderDiagnostics(result.diagnostics?.selectedPath ?? result.rootPath, entries.length, result.diagnostics?.nestedSupportedDiscardedCount ?? Math.max(0, mappedEntries.length - entries.length), result.diagnostics?.nestedDirectoriesSeen ?? 0);
    return toFolderOpenResult(result.name, result.rootPath, entries, diagnostics);
}
export async function reopenRecentFolder(folder) {
    if (!hasDesktopFolderBridge() || !folder.path) {
        return null;
    }
    const result = await window.filexDesktop.reopenFolder(folder.path);
    if (!result) {
        return null;
    }
    const mappedEntries = result.entries.map((entry) => ({
        name: entry.name,
        relativePath: entry.relativePath,
        absolutePath: entry.absolutePath,
        size: entry.size,
        lastModified: entry.lastModified,
        createdAt: entry.createdAt,
    }));
    const entries = keepTopLevelEntries(mappedEntries);
    const diagnostics = buildFolderDiagnostics(result.diagnostics?.selectedPath ?? result.rootPath, entries.length, result.diagnostics?.nestedSupportedDiscardedCount ?? Math.max(0, mappedEntries.length - entries.length), result.diagnostics?.nestedDirectoriesSeen ?? 0);
    return toFolderOpenResult(result.name, result.rootPath, entries, diagnostics);
}
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
    filePromiseStore.clear();
    assetPathStore.clear();
    assetAbsolutePathStore.clear();
    assetSourceFileKeyStore.clear();
    fileStore.clear();
    return entries.map((entry) => {
        const id = buildAssetId(entry.relativePath);
        const sourceFileKey = buildSourceFileKeyFromStats(entry.relativePath, entry.size, entry.lastModified)
            || buildPlaceholderSourceFileKey(entry.relativePath);
        assetPathStore.set(id, entry.relativePath);
        assetAbsolutePathStore.set(id, entry.absolutePath);
        assetSourceFileKeyStore.set(id, sourceFileKey);
        return {
            id,
            fileName: entry.name,
            path: entry.relativePath,
            sourceFileKey,
            rating: 0,
            pickStatus: "unmarked",
            colorLabel: null,
            customLabels: [],
            createdAt: entry.createdAt,
            width: 0,
            height: 0,
            orientation: "horizontal",
            aspectRatio: 4 / 3,
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
export async function readSidecarXmp(assetId) {
    const absolutePath = assetAbsolutePathStore.get(assetId);
    if (!absolutePath || !hasDesktopSidecarBridge()) {
        return null;
    }
    return window.filexDesktop.readSidecarXmp(absolutePath);
}
export async function writeSidecarXmp(assetId, xml) {
    const absolutePath = assetAbsolutePathStore.get(assetId);
    if (!absolutePath || !hasDesktopSidecarBridge()) {
        return false;
    }
    return window.filexDesktop.writeSidecarXmp(absolutePath, xml);
}
export async function createOnDemandPreviewAsync(assetId, _priority = 0, options = {}) {
    const cacheKey = getOnDemandPreviewCacheKey(assetId, options);
    const cached = onDemandPreviewStore.get(cacheKey);
    if (cached)
        return cached;
    const pending = onDemandPreviewPromiseStore.get(cacheKey);
    if (pending) {
        return pending;
    }
    const absolutePath = assetAbsolutePathStore.get(assetId);
    if (!absolutePath || !hasDesktopPreviewBridge()) {
        return null;
    }
    const generation = previewGeneration;
    const task = (async () => {
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
    })();
    onDemandPreviewPromiseStore.set(cacheKey, task);
    task.finally(() => {
        if (onDemandPreviewPromiseStore.get(cacheKey) === task) {
            onDemandPreviewPromiseStore.delete(cacheKey);
        }
    });
    return task;
}
export async function warmOnDemandPreviewCache(assetId, priority = 0, options = {}) {
    const absolutePath = assetAbsolutePathStore.get(assetId);
    const sourceFileKey = assetSourceFileKeyStore.get(assetId);
    if (absolutePath && hasDesktopQuickPreviewWarmBridge()) {
        try {
            const result = await window.filexDesktop.warmQuickPreviewFrames([{
                    absolutePath,
                    maxDimension: Math.max(0, Math.round(options.maxDimension ?? 0)),
                    sourceFileKey,
                    stage: "fit",
                    priority,
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
    const url = await createOnDemandPreviewAsync(assetId, priority, options);
    return Boolean(url);
}
export async function detectChangedAssetsOnDisk(assetIds) {
    if (assetIds.length === 0)
        return [];
    const changes = [];
    const uniqueIds = Array.from(new Set(assetIds));
    for (const assetId of uniqueIds) {
        const absolutePath = assetAbsolutePathStore.get(assetId);
        if (!absolutePath || !hasDesktopFileBridge())
            continue;
        try {
            const payload = await window.filexDesktop.readFile(absolutePath);
            if (!payload) {
                continue;
            }
            const latestFile = new File([toOwnedArrayBuffer(payload.bytes)], payload.name, {
                lastModified: payload.lastModified,
            });
            const currentFile = fileStore.get(assetId);
            const hasChanged = !currentFile
                || currentFile.lastModified !== latestFile.lastModified
                || currentFile.size !== latestFile.size;
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
            revokeLivePreviewUrl(assetId);
            if (hasDesktopPreviewBridge()) {
                const preview = await window.filexDesktop.getPreview(absolutePath, {
                    sourceFileKey: nextSourceFileKey,
                });
                if (preview) {
                    const liveUrl = URL.createObjectURL(new Blob([toOwnedArrayBuffer(preview.bytes)], { type: preview.mimeType }));
                    livePreviewStore.set(assetId, liveUrl);
                    preloadImageUrls([liveUrl]);
                    next.thumbnailUrl = liveUrl;
                    next.previewUrl = liveUrl;
                    next.sourceUrl = liveUrl;
                    next.width = preview.width;
                    next.height = preview.height;
                    next.orientation = detectOrientation(preview.width, preview.height);
                    next.aspectRatio = preview.width / preview.height;
                }
            }
            else if (hasDesktopThumbnailBridge()) {
                const thumbnail = await window.filexDesktop.getThumbnail(absolutePath, 320, 0.72, nextSourceFileKey);
                if (thumbnail) {
                    const liveUrl = URL.createObjectURL(new Blob([toOwnedArrayBuffer(thumbnail.bytes)], { type: thumbnail.mimeType }));
                    livePreviewStore.set(assetId, liveUrl);
                    preloadImageUrls([liveUrl]);
                    next.thumbnailUrl = liveUrl;
                    next.previewUrl = liveUrl;
                    next.sourceUrl = liveUrl;
                    next.width = thumbnail.width;
                    next.height = thumbnail.height;
                    next.orientation = detectOrientation(thumbnail.width, thumbnail.height);
                    next.aspectRatio = thumbnail.width / thumbnail.height;
                }
            }
            changes.push(next);
        }
        catch {
            // Ignore single-file read failures.
        }
    }
    return changes;
}
export function getSubfolder(assetPath) {
    const parts = assetPath.split("/");
    if (parts.length <= 2)
        return "";
    return parts.slice(1, -1).join("/");
}
export function extractSubfolders(assets) {
    const counts = new Map();
    for (const asset of assets) {
        const folder = getSubfolder(asset.path);
        counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
    return Array.from(counts.entries())
        .map(([folder, count]) => ({ folder, count }))
        .sort((a, b) => a.folder.localeCompare(b.folder));
}
function mapDesktopFileOpStatus(status) {
    switch (status) {
        case "ok":
        case "cancelled":
        case "partial":
        case "no-file":
            return status;
        default:
            return "error";
    }
}
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
export async function copyAssetsToFolder(assetIds) {
    if (assetIds.length === 0)
        return "no-file";
    if (!hasDesktopCopyBridge())
        return "error";
    const absolutePaths = getAssetAbsolutePaths(assetIds);
    if (absolutePaths.length === 0)
        return "no-file";
    try {
        const result = await window.filexDesktop.copyFilesToFolder(absolutePaths);
        return mapDesktopFileOpStatus(result.status);
    }
    catch {
        return "error";
    }
}
export async function moveAssetsToFolder(assetIds) {
    if (assetIds.length === 0)
        return { result: "no-file", movedIds: [] };
    if (!hasDesktopMoveBridge())
        return { result: "error", movedIds: [] };
    const idByAbsolutePath = new Map();
    for (const assetId of assetIds) {
        const absolutePath = assetAbsolutePathStore.get(assetId);
        if (absolutePath && !idByAbsolutePath.has(absolutePath)) {
            idByAbsolutePath.set(absolutePath, assetId);
        }
    }
    const absolutePaths = Array.from(idByAbsolutePath.keys());
    if (absolutePaths.length === 0)
        return { result: "no-file", movedIds: [] };
    try {
        const response = await window.filexDesktop.moveFilesToFolder(absolutePaths);
        const movedIds = Array.from(new Set(response.movedPaths
            .map((path) => idByAbsolutePath.get(path) ?? null)
            .filter((id) => id !== null)));
        for (const assetId of movedIds) {
            revokeLivePreviewUrl(assetId);
            invalidateOnDemandPreview(assetId);
            assetPathStore.delete(assetId);
            assetAbsolutePathStore.delete(assetId);
            assetSourceFileKeyStore.delete(assetId);
            fileStore.delete(assetId);
            filePromiseStore.delete(assetId);
        }
        return {
            result: mapDesktopFileOpStatus(response.status),
            movedIds,
        };
    }
    catch {
        return { result: "error", movedIds: [] };
    }
}
export async function saveAssetAs(assetId) {
    const absolutePath = assetAbsolutePathStore.get(assetId);
    if (!absolutePath)
        return "no-file";
    if (!hasDesktopSaveAsBridge())
        return "error";
    try {
        const result = await window.filexDesktop.saveFileAs(absolutePath);
        return mapDesktopFileOpStatus(result.status);
    }
    catch {
        return "error";
    }
}
const MAX_RECENT = 8;
let recentFoldersCache = [];
export function getRecentFolders() {
    return recentFoldersCache;
}
export function addRecentFolder(name, imageCount, path) {
    const nextFolder = { name, path, imageCount, openedAt: Date.now() };
    recentFoldersCache = [nextFolder, ...recentFoldersCache.filter((folder) => folder.path !== path || folder.name !== name)]
        .slice(0, MAX_RECENT);
    void saveDesktopRecentFolder(nextFolder).then((recentFolders) => {
        if (recentFolders) {
            recentFoldersCache = recentFolders;
        }
    });
}
export async function hydrateRecentFolders() {
    const recentFolders = await getDesktopRecentFolders();
    recentFoldersCache = recentFolders ?? [];
    return recentFoldersCache;
}
export async function removeRecentFolder(folderPathOrName) {
    const recentFolders = await removeDesktopRecentFolder(folderPathOrName);
    recentFoldersCache = recentFolders ?? [];
    return recentFoldersCache;
}
//# sourceMappingURL=folder-access.js.map