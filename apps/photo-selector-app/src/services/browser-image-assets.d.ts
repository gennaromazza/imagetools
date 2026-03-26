import type { ImageAsset } from "@photo-tools/shared-types";
export interface ImageImportProgressUpdate {
    supported: number;
    ignored: number;
    total: number;
    processed: number;
    currentFile: string | null;
}
export declare function loadImageAssetsFromFiles(files: File[], options?: {
    onProgress?: (update: ImageImportProgressUpdate) => void;
}): Promise<ImageAsset[]>;
export declare function revokeImageAssetUrls(assets: ImageAsset[]): void;
export declare function inferFolderLabelFromFiles(files: File[]): string;
