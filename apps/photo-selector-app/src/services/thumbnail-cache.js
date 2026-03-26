/**
 * IndexedDB-backed thumbnail cache.
 * Stores generated thumbnails keyed by asset ID so they survive page reloads.
 * Lightweight — only stores the blob + dimensions, not the full asset.
 */
import { measureAsync } from "./performance-utils";
const DB_NAME = "imagetool-thumb-cache";
const DB_VERSION = 1;
const STORE_NAME = "thumbnails";
const THUMBNAIL_CACHE_MAX_DIMENSION = 420;
const THUMBNAIL_CACHE_QUALITY = 0.72;
let dbPromise = null;
function canUseDesktopThumbnailCache() {
    return typeof window !== "undefined" && typeof window.filexDesktop?.getCachedThumbnails === "function";
}
function toLookupIds(entries) {
    return entries.map((entry) => (typeof entry === "string" ? entry : entry.id));
}
function toDesktopLookupEntries(entries) {
    return entries.flatMap((entry) => (typeof entry === "string" || !entry.absolutePath
        ? []
        : [{
                id: entry.id,
                absolutePath: entry.absolutePath,
                sourceFileKey: entry.sourceFileKey,
            }]));
}
function getDB() {
    if (dbPromise)
        return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "id" });
            }
        };
    });
    return dbPromise;
}
/** Save a generated thumbnail blob for an asset. Fire-and-forget. */
export async function cacheThumbnail(id, blob, width, height) {
    await cacheThumbnailBatch([{ id, blob, width, height }]);
}
export async function cacheThumbnailBatch(items) {
    if (items.length === 0) {
        return;
    }
    if (canUseDesktopThumbnailCache()) {
        return;
    }
    await measureAsync(`[PERF] indexeddb batch-write (${items.length})`, async () => {
        try {
            const db = await getDB();
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const cachedAt = Date.now();
            for (const item of items) {
                store.put({
                    id: item.id,
                    blob: item.blob,
                    width: item.width,
                    height: item.height,
                    cachedAt,
                });
            }
            await new Promise((resolve, reject) => {
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
            });
        }
        catch {
            // Non-critical — silently skip
        }
    });
}
/** Retrieve cached thumbnails for a list of asset IDs. Returns a Map of found entries. */
export async function loadCachedThumbnails(entries) {
    const result = new Map();
    if (entries.length === 0)
        return result;
    const desktopEntries = toDesktopLookupEntries(entries);
    if (desktopEntries.length > 0 && canUseDesktopThumbnailCache()) {
        await measureAsync(`[PERF] desktop cache bulk-read (${desktopEntries.length})`, async () => {
            try {
                const cached = await window.filexDesktop.getCachedThumbnails(desktopEntries, THUMBNAIL_CACHE_MAX_DIMENSION, THUMBNAIL_CACHE_QUALITY);
                for (const hit of cached) {
                    const ownedBytes = new Uint8Array(hit.bytes.byteLength);
                    ownedBytes.set(hit.bytes);
                    result.set(hit.id, {
                        url: URL.createObjectURL(new Blob([ownedBytes], { type: hit.mimeType })),
                        width: hit.width,
                        height: hit.height,
                    });
                }
            }
            catch {
                // Non-critical
            }
        });
        return result;
    }
    const ids = toLookupIds(entries);
    await measureAsync(`[PERF] indexeddb bulk-read (${ids.length})`, async () => {
        try {
            const db = await getDB();
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const requestedIds = new Set(ids);
            const records = await new Promise((resolve, reject) => {
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result ?? []);
                req.onerror = () => reject(req.error);
            });
            for (const data of records) {
                if (!requestedIds.has(data.id) || !data.blob) {
                    continue;
                }
                result.set(data.id, {
                    url: URL.createObjectURL(data.blob),
                    width: data.width,
                    height: data.height,
                });
            }
        }
        catch {
            // Non-critical
        }
    });
    return result;
}
/** Clear the entire thumbnail cache (e.g. on folder change). */
export async function clearThumbnailCache() {
    if (typeof window !== "undefined" && typeof window.filexDesktop?.clearThumbnailCache === "function") {
        try {
            await window.filexDesktop.clearThumbnailCache();
            return;
        }
        catch {
            // Ignore native failures and continue to the browser fallback.
        }
    }
    try {
        const db = await getDB();
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).clear();
    }
    catch {
        // ignore
    }
}
//# sourceMappingURL=thumbnail-cache.js.map