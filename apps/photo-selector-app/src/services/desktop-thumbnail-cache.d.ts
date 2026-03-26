import type { DesktopThumbnailCacheInfo } from "@photo-tools/desktop-contracts";
export declare function getDesktopThumbnailCacheInfo(): Promise<DesktopThumbnailCacheInfo | null>;
export declare function chooseDesktopThumbnailCacheDirectory(): Promise<DesktopThumbnailCacheInfo | null>;
export declare function setDesktopThumbnailCacheDirectory(directoryPath: string): Promise<DesktopThumbnailCacheInfo | null>;
export declare function resetDesktopThumbnailCacheDirectory(): Promise<DesktopThumbnailCacheInfo | null>;
export declare function clearDesktopThumbnailCache(): Promise<boolean>;
