import type { DesktopThumbnailCacheInfo } from "@photo-tools/desktop-contracts";
import type { ImageAsset } from "@photo-tools/shared-types";
interface PhotoSelectorProps {
    photos: ImageAsset[];
    selectedIds: string[];
    onSelectionChange: (selectedIds: string[]) => void;
    onPhotosChange?: (photos: ImageAsset[]) => void;
    onVisibleIdsChange?: (visibleIds: Set<string>) => void;
    onUndo?: () => void;
    onRedo?: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
    desktopThumbnailCacheInfo?: DesktopThumbnailCacheInfo | null;
    isDesktopThumbnailCacheBusy?: boolean;
    onChooseDesktopThumbnailCacheDirectory?: () => void | Promise<void>;
    onSetDesktopThumbnailCacheDirectory?: (directoryPath: string) => void | Promise<void>;
    onResetDesktopThumbnailCacheDirectory?: () => void | Promise<void>;
    onClearDesktopThumbnailCache?: () => void | Promise<void>;
}
export declare function PhotoSelector({ photos, selectedIds, onSelectionChange, onPhotosChange, onVisibleIdsChange, onUndo, onRedo, canUndo, canRedo, desktopThumbnailCacheInfo, isDesktopThumbnailCacheBusy, onChooseDesktopThumbnailCacheDirectory, onSetDesktopThumbnailCacheDirectory, onResetDesktopThumbnailCacheDirectory, onClearDesktopThumbnailCache, }: PhotoSelectorProps): import("react/jsx-runtime").JSX.Element;
export {};
