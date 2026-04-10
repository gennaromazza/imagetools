import type { ImageAsset } from "@photo-tools/shared-types";
export declare function isImageFile(name: string): boolean;
export declare function isRawFile(name: string): boolean;
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
    relativePath: string;
    absolutePath: string;
    size: number;
    lastModified: number;
    createdAt: number;
}
export interface FolderOpenResult {
    name: string;
    entries: FolderEntry[];
    rootPath: string;
    diagnostics?: FolderOpenDiagnostics;
}
export interface FolderOpenDiagnostics {
    source: "desktop-native";
    selectedPath: string;
    topLevelSupportedCount: number;
    nestedSupportedDiscardedCount: number;
    totalSupportedSeen: number;
    nestedDirectoriesSeen: number;
}
export declare function hasNativeFolderAccess(): boolean;
export declare function openFolderNative(): Promise<FolderOpenResult | null>;
export declare function reopenRecentFolder(folder: RecentFolder): Promise<FolderOpenResult | null>;
export declare function buildPlaceholderAssets(entries: FolderEntry[]): ImageAsset[];
export declare function getFileForAsset(assetId: string): Promise<File | null>;
export declare function readSidecarXmp(assetId: string): Promise<string | null>;
export declare function writeSidecarXmp(assetId: string, xml: string): Promise<boolean>;
export declare function createOnDemandPreviewAsync(assetId: string, _priority?: number, options?: OnDemandPreviewOptions): Promise<string | null>;
export declare function warmOnDemandPreviewCache(assetId: string, priority?: number, options?: OnDemandPreviewOptions): Promise<boolean>;
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
export declare function detectChangedAssetsOnDisk(assetIds: string[]): Promise<AssetDiskChange[]>;
export declare function getSubfolder(assetPath: string): string;
export declare function extractSubfolders(assets: ImageAsset[]): {
    folder: string;
    count: number;
}[];
type FileOpResult = "ok" | "cancelled" | "error" | "partial" | "no-file";
export declare function getAssetRelativePath(assetId: string): string | null;
export declare function getAssetAbsolutePath(assetId: string): string | null;
export declare function getAssetAbsolutePaths(assetIds: string[]): string[];
export declare function copyAssetsToFolder(assetIds: string[]): Promise<FileOpResult>;
export declare function moveAssetsToFolder(assetIds: string[]): Promise<{
    result: FileOpResult;
    movedIds: string[];
}>;
export declare function saveAssetAs(assetId: string): Promise<FileOpResult>;
export interface RecentFolder {
    name: string;
    path?: string;
    imageCount: number;
    openedAt: number;
}
export declare function getRecentFolders(): RecentFolder[];
export declare function addRecentFolder(name: string, imageCount: number, path?: string): void;
export declare function hydrateRecentFolders(): Promise<RecentFolder[]>;
export declare function removeRecentFolder(folderPathOrName: string): Promise<RecentFolder[]>;
export {};
