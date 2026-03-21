/**
 * IndexedDB-backed thumbnail cache.
 * Stores generated thumbnails keyed by asset ID so they survive page reloads.
 * Lightweight — only stores the blob + dimensions, not the full asset.
 */
/** Save a generated thumbnail blob for an asset. Fire-and-forget. */
export declare function cacheThumbnail(id: string, blob: Blob, width: number, height: number): Promise<void>;
/** Retrieve cached thumbnails for a list of asset IDs. Returns a Map of found entries. */
export declare function loadCachedThumbnails(ids: string[]): Promise<Map<string, {
    url: string;
    width: number;
    height: number;
}>>;
/** Clear the entire thumbnail cache (e.g. on folder change). */
export declare function clearThumbnailCache(): Promise<void>;
