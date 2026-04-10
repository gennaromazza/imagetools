export interface CachedThumbnailWrite {
    id: string;
    blob: Blob;
    width: number;
    height: number;
}
export interface ThumbnailCacheLookupEntry {
    id: string;
    absolutePath?: string;
    sourceFileKey?: string;
}
export type ThumbnailCacheLookup = string | ThumbnailCacheLookupEntry;
export interface ThumbnailCacheLoadOptions {
    maxDimension?: number;
    quality?: number;
}
export declare function cacheThumbnail(_id: string, _blob: Blob, _width: number, _height: number): Promise<void>;
export declare function cacheThumbnailBatch(_items: CachedThumbnailWrite[]): Promise<void>;
export declare function loadCachedThumbnails(entries: ThumbnailCacheLookup[], options?: ThumbnailCacheLoadOptions): Promise<Map<string, {
    url: string;
    width: number;
    height: number;
}>>;
export declare function clearThumbnailCache(): Promise<void>;
