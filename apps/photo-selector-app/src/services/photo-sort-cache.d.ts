import type { ImageAsset } from "@photo-tools/shared-types";
export type PhotoSortMode = "name" | "orientation" | "rating" | "createdAt";
interface SortCacheEntry {
    folderPath: string;
    sortBy: PhotoSortMode;
    signature: string;
    orderedIds: string[];
    updatedAt: number;
}
export declare function buildPhotoSortSignature(photos: ImageAsset[], sortBy: PhotoSortMode): string;
export declare function loadCachedPhotoSortOrder(folderPath: string, sortBy: PhotoSortMode, signature: string): string[] | null;
export declare function hydratePhotoSortCache(folderPath?: string): Promise<SortCacheEntry[]>;
export declare function saveCachedPhotoSortOrder(folderPath: string, sortBy: PhotoSortMode, signature: string, orderedIds: string[]): void;
export {};
