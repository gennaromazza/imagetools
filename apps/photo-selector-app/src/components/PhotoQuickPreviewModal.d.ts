import type { ImageAsset } from "@photo-tools/shared-types";
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
    usageByAssetId?: Map<string, {
        pageNumber: number;
        pageId?: string;
        slotId?: string;
    }>;
    pages?: PreviewPageTarget[];
    activePageId?: string | null;
    onClose: () => void;
    onSelectAsset?: (assetId: string) => void;
    onAddToPage?: (pageId: string, assetId: string) => void;
    onJumpToPage?: (pageId: string) => void;
    onUpdateAsset?: (assetId: string, changes: Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">>) => void;
}
export declare function PhotoQuickPreviewModal({ asset, assets, usageByAssetId, pages, activePageId, onClose, onSelectAsset, onAddToPage, onJumpToPage, onUpdateAsset }: PhotoQuickPreviewModalProps): import("react/jsx-runtime").JSX.Element | null;
export {};
