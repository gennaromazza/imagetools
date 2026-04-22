import type { ImageAsset } from "@photo-tools/shared-types";
import type { CustomLabelShortcut, CustomLabelTone } from "../services/photo-selector-preferences";
import type { ThumbnailProfile } from "../services/photo-selector-preferences";
interface PreviewPageTarget {
    id: string;
    pageNumber: number;
    templateLabel?: string;
    photoCount?: number;
    capacity?: number;
    isAtCapacity?: boolean;
}
interface PhotoQuickPreviewModalProps {
    asset: ImageAsset | null;
    assets?: ImageAsset[];
    thumbnailProfile?: ThumbnailProfile;
    startZoomed?: boolean;
    usageByAssetId?: Map<string, {
        pageNumber: number;
        pageId?: string;
        slotId?: string;
    }>;
    pages?: PreviewPageTarget[];
    activePageId?: string | null;
    customLabelsCatalog?: string[];
    customLabelColors?: Record<string, CustomLabelTone>;
    customLabelShortcuts?: Record<string, CustomLabelShortcut | null>;
    autoAdvanceOnAction?: boolean;
    onClose: () => void;
    onSelectAsset?: (assetId: string) => void;
    onAddToPage?: (pageId: string, assetId: string) => void;
    onJumpToPage?: (pageId: string) => void;
    onUpdateAsset?: (assetId: string, changes: Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel" | "customLabels">>) => void;
}
export declare function PhotoQuickPreviewModal({ asset, assets, thumbnailProfile, startZoomed, usageByAssetId, pages, activePageId, customLabelsCatalog, customLabelColors, customLabelShortcuts, autoAdvanceOnAction, onClose, onSelectAsset, onAddToPage, onJumpToPage, onUpdateAsset }: PhotoQuickPreviewModalProps): import("react/jsx-runtime").JSX.Element | null;
export {};
