import type { ImageAsset } from "@photo-tools/shared-types";
import type { CustomLabelShortcut, CustomLabelTone } from "../services/photo-selector-preferences";
interface UsageInfo {
    pageNumber: number;
    pageId?: string;
    slotId?: string;
}
interface ProjectPhotoSelectorModalProps {
    assets: ImageAsset[];
    activeAssetIds: string[];
    usageByAssetId: Map<string, UsageInfo>;
    customLabelsCatalog?: string[];
    customLabelColors?: Record<string, CustomLabelTone>;
    customLabelShortcuts?: Record<string, CustomLabelShortcut | null>;
    onClose: () => void;
    onApply: (nextIds: string[], nextAssets: ImageAsset[]) => void;
}
export declare function ProjectPhotoSelectorModal({ assets, activeAssetIds, usageByAssetId, customLabelsCatalog, customLabelColors, customLabelShortcuts, onClose, onApply }: ProjectPhotoSelectorModalProps): import("react").ReactPortal;
export {};
