/**
 * IndexedDB-backed thumbnail cache.
 * Stores generated thumbnails keyed by asset ID so they survive page reloads.
 * Lightweight — only stores the blob + dimensions, not the full asset.
 */

const DB_NAME = "imagetool-thumb-cache";
const DB_VERSION = 1;
const STORE_NAME = "thumbnails";

interface CachedThumb {
  id: string;
  blob: Blob;
  width: number;
  height: number;
  cachedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
  });

  return dbPromise;
}

/** Save a generated thumbnail blob for an asset. Fire-and-forget. */
export async function cacheThumbnail(
  id: string,
  blob: Blob,
  width: number,
  height: number,
): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({ id, blob, width, height, cachedAt: Date.now() } satisfies CachedThumb);
  } catch {
    // Non-critical — silently skip
  }
}

/** Retrieve cached thumbnails for a list of asset IDs. Returns a Map of found entries. */
export async function loadCachedThumbnails(
  ids: string[],
): Promise<Map<string, { url: string; width: number; height: number }>> {
  const result = new Map<string, { url: string; width: number; height: number }>();
  if (ids.length === 0) return result;

  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);

    await Promise.all(
      ids.map(
        (id) =>
          new Promise<void>((resolve) => {
            const req = store.get(id);
            req.onsuccess = () => {
              const data = req.result as CachedThumb | undefined;
              if (data?.blob) {
                result.set(id, {
                  url: URL.createObjectURL(data.blob),
                  width: data.width,
                  height: data.height,
                });
              }
              resolve();
            };
            req.onerror = () => resolve();
          }),
      ),
    );
  } catch {
    // Non-critical
  }

  return result;
}

/** Clear the entire thumbnail cache (e.g. on folder change). */
export async function clearThumbnailCache(): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
  } catch {
    // ignore
  }
}
