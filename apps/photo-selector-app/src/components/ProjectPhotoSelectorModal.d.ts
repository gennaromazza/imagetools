import type { ImageAsset } from "@photo-tools/shared-types";
interface UsageInfo {
    pageNumber: number;
    pageId?: string;
    slotId?: string;
}
interface ProjectPhotoSelectorModalProps {
    assets: ImageAsset[];
    activeAssetIds: string[];
    usageByAssetId: Map<string, UsageInfo>;
    onClose: () => void;
    onApply: (nextIds: string[], nextAssets: ImageAsset[]) => void;
}
export declare function ProjectPhotoSelectorModal({ assets, activeAssetIds, usageByAssetId, onClose, onApply }: ProjectPhotoSelectorModalProps): import("react").ReactPortal;
export {};
