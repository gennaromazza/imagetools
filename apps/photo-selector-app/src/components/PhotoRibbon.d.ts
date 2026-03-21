import type { ImageAsset } from "@photo-tools/shared-types";
interface RibbonUsage {
    pageNumber: number;
}
interface RibbonDragState {
    imageId: string;
}
interface PhotoRibbonProps {
    assets: ImageAsset[];
    assetFilter: "all" | "unused" | "used";
    usageByAssetId: Map<string, RibbonUsage>;
    dragState: RibbonDragState | null;
    variant?: "horizontal" | "vertical";
    onAssetFilterChange: (filter: "all" | "unused" | "used") => void;
    onDragAssetStart: (imageId: string) => void;
    onDragEnd: () => void;
    onAssetDoubleClick?: (imageId: string) => void;
    onAssetsMetadataChange?: (changesById: Map<string, Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">>>) => void;
}
declare function PhotoRibbonContent({ assets, assetFilter, usageByAssetId, dragState, variant, onAssetFilterChange, onDragAssetStart, onDragEnd, onAssetDoubleClick, onAssetsMetadataChange }: PhotoRibbonProps): import("react/jsx-runtime").JSX.Element;
export declare const PhotoRibbon: import("react").MemoExoticComponent<typeof PhotoRibbonContent>;
export {};
