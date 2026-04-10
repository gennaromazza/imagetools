import type { ImageAsset } from "@photo-tools/shared-types";
export declare function saveImageAssets(projectId: string, _files: File[], imageAssets: ImageAsset[]): Promise<void>;
export declare function loadImageAssets(projectId: string): Promise<Map<string, ImageAsset>>;
export declare function deleteProjectImages(projectId: string): Promise<void>;
export declare function hasProjectImages(projectId: string): Promise<boolean>;
