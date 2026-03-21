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
}
export declare function PhotoSelector({ photos, selectedIds, onSelectionChange, onPhotosChange, onVisibleIdsChange, onUndo, onRedo, canUndo, canRedo, }: PhotoSelectorProps): import("react/jsx-runtime").JSX.Element;
export {};
