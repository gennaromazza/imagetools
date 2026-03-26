import type { ImageAsset } from "@photo-tools/shared-types";
interface SelectionSummaryProps {
    allAssets: ImageAsset[];
    activeAssetIds: string[];
    projectName: string;
    onExportSelection: () => void;
    onBackToSelection: () => void;
    onOpenProjectSelector: () => void;
}
export declare function SelectionSummary({ allAssets, activeAssetIds, projectName, onExportSelection, onBackToSelection, onOpenProjectSelector, }: SelectionSummaryProps): import("react/jsx-runtime").JSX.Element;
export {};
