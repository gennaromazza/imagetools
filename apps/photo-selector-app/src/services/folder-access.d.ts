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
export interface OnDemandPreviewOptions {
    maxDimension?: number;
}
export declare function getCachedOnDemandPreviewUrl(assetId: string, options?: OnDemandPreviewOptions): string | null;
export declare function buildSourceFileKey(file: File, relativePath: string): string;
export declare function buildSourceFileKeyFromStats(relativePath: string, size: number, lastModified: number): string;
export declare function buildAssetId(relativePath: string): string;
export interface FolderEntry {
    name: string;
    file?: File;
    relativePath: string;
    fileHandle?: FileSystemFileHandle;
    absolutePath?: string;
    size?: number;
    lastModified?: number;
}
export interface FolderOpenResult {
    name: string;
    entries: FolderEntry[];
    rootPath?: string;
    diagnostics?: FolderOpenDiagnostics;
}
export interface FolderOpenDiagnostics {
    source: "desktop-native" | "browser-native" | "file-input";
    selectedPath: string;
    topLevelSupportedCount: number;
    nestedSupportedDiscardedCount: number;
    totalSupportedSeen: number;
    nestedDirectoriesSeen?: number;
}
export declare function hasNativeFolderAccess(): boolean;
/**
 * Open a folder with the File System Access API (Chrome/Edge).
 * Reads only top-level files and keeps diagnostics about nested files.
 * Returns null if the user cancels the picker.
 */
export declare function openFolderNative(): Promise<FolderOpenResult | null>;
export declare function reopenRecentFolder(folder: RecentFolder): Promise<FolderOpenResult | null>;
export declare function fileListToEntries(files: FileList): FolderOpenResult;
/**
 * Creates ImageAsset[] immediately from directory entries — no image reading.
 * Width/height are 0 until the thumbnail worker reports them.
 * Also populates the global fileStore.
 */
export declare function buildPlaceholderAssets(entries: FolderEntry[]): ImageAsset[];
export declare function getFileForAsset(assetId: string): Promise<File | null>;
export declare function readSidecarXmp(assetId: string): Promise<string | null>;
export declare function writeSidecarXmp(assetId: string, xml: string): Promise<boolean>;
/**
 * Create a preview (full-resolution) blob URL on-demand for a given asset.
 * Returns the URL — caller is responsible for revoking when done.
 * Extracted asynchronously to support resolving embedded JPEG previews from RAWs.
 */
export declare function createOnDemandPreviewAsync(assetId: string, priority?: number, options?: OnDemandPreviewOptions): Promise<string | null>;
export declare function warmOnDemandPreviewCache(assetId: string, _priority?: number, options?: OnDemandPreviewOptions): Promise<boolean>;
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
export declare function detectChangedAssetsOnDisk(assetIds: string[]): Promise<AssetDiskChange[]>;
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
type FileOpResult = "ok" | "cancelled" | "error" | "no-file" | "unsupported";
/** Returns the relative virtual path for an asset (e.g. "Folder/sub/IMG_001.CR3") */
export declare function getAssetRelativePath(assetId: string): string | null;
export declare function getAssetAbsolutePath(assetId: string): string | null;
export declare function getAssetAbsolutePaths(assetIds: string[]): string[];
/**
 * Copy one or more assets to a user-chosen destination folder (FSAA).
 * Opens ONE directory picker for all files.
 */
export declare function copyAssetsToFolder(assetIds: string[]): Promise<FileOpResult>;
/**
 * Move one or more assets to a user-chosen destination folder (FSAA).
 * Copies the bytes, then removes the originals using the stored parent handle.
 * Returns the list of successfully moved assetIds.
 */
export declare function moveAssetsToFolder(assetIds: string[]): Promise<{
    result: FileOpResult;
    movedIds: string[];
}>;
/**
 * Save a single asset to a user-chosen location (like "Save As").
 * Falls back to a normal download if showSaveFilePicker is unavailable.
 */
export declare function saveAssetAs(assetId: string): Promise<FileOpResult>;
export interface RecentFolder {
    name: string;
    path?: string;
    imageCount: number;
    openedAt: number;
}
export declare function getRecentFolders(): RecentFolder[];
export declare function addRecentFolder(name: string, imageCount: number, path?: string): void;
export {};
