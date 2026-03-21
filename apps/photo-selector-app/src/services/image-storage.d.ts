/**
 * IndexedDB storage for image assets persistence.
 * Solves the issue where blob URLs become invalid after page reload.
 */
import type { ImageAsset } from "@photo-tools/shared-types";
export declare function saveImageAssets(projectId: string, files: File[], imageAssets: ImageAsset[]): Promise<void>;
export declare function loadImageAssets(projectId: string): Promise<Map<string, ImageAsset>>;
export declare function deleteProjectImages(projectId: string): Promise<void>;
export declare function hasProjectImages(projectId: string): Promise<boolean>;
