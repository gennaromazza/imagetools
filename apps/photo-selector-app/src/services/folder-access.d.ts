/**
 * Folder access — File System Access API (Chrome/Edge) with <input webkitdirectory> fallback.
 * Also manages recent-folders list in localStorage and the in-memory file store.
 */
import type { ImageAsset } from "@photo-tools/shared-types";
export declare function isImageFile(name: string): boolean;
export declare function isRawFile(name: string): boolean;
/** Can the browser natively decode this format via <img> / createImageBitmap? */
export declare function isBrowserDecodable(name: string): boolean;
/** In-memory store: assetId → File.  Used for on-demand preview generation. */
export declare const fileStore: Map<string, File>;
export declare function buildAssetId(file: File, relativePath: string): string;
export interface FolderEntry {
    name: string;
    file: File;
    relativePath: string;
    fileHandle?: FileSystemFileHandle;
}
export declare function hasNativeFolderAccess(): boolean;
/**
 * Open a folder with the File System Access API (Chrome/Edge).
 * Recursively scans subfolders for image files.
 * Returns null if the user cancels the picker.
 */
export declare function openFolderNative(): Promise<{
    name: string;
    entries: FolderEntry[];
} | null>;
export declare function reopenRecentFolder(name: string): Promise<{
    name: string;
    entries: FolderEntry[];
} | null>;
export declare function fileListToEntries(files: FileList): {
    name: string;
    entries: FolderEntry[];
};
/**
 * Creates ImageAsset[] immediately from directory entries — no image reading.
 * Width/height are 0 until the thumbnail worker reports them.
 * Also populates the global fileStore.
 */
export declare function buildPlaceholderAssets(entries: FolderEntry[]): ImageAsset[];
export declare function readSidecarXmp(assetId: string): Promise<string | null>;
export declare function writeSidecarXmp(assetId: string, xml: string): Promise<boolean>;
/**
 * Create a preview (full-resolution) blob URL on-demand for a given asset.
 * Returns the URL — caller is responsible for revoking when done.
 * Extracted asynchronously to support resolving embedded JPEG previews from RAWs.
 */
export declare function createOnDemandPreviewAsync(assetId: string, priority?: number): Promise<string | null>;
/**
 * Extract the subfolder portion from an asset's path relative to the root folder.
 * e.g. "Wedding/Ceremony/IMG_001.jpg" → "Ceremony"
 *      "Wedding/IMG_002.jpg" → "" (root)
 * The first segment is the root folder name, so we skip it.
 */
export declare function getSubfolder(assetPath: string): string;
/**
 * Build a sorted list of unique subfolder names from a set of assets.
 * Returns entries with folder name and count. Root-level files get folder = "".
 */
export declare function extractSubfolders(assets: ImageAsset[]): {
    folder: string;
    count: number;
}[];
export interface RecentFolder {
    name: string;
    imageCount: number;
    openedAt: number;
}
export declare function getRecentFolders(): RecentFolder[];
export declare function addRecentFolder(name: string, imageCount: number): void;
