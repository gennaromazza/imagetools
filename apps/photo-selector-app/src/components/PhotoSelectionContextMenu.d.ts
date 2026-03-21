import type { ColorLabel, PickStatus } from "@photo-tools/shared-types";
interface PhotoSelectionContextMenuProps {
    x: number;
    y: number;
    targetCount: number;
    colorLabelNames?: Record<ColorLabel, string>;
    onApplyRating: (rating: number) => void;
    onApplyPickStatus: (pickStatus: PickStatus) => void;
    onApplyColor: (colorLabel: ColorLabel | null) => void;
    onInvertVisible: () => void;
    onClearSelection: () => void;
}
export declare function PhotoSelectionContextMenu({ x, y, targetCount, colorLabelNames, onApplyRating, onApplyPickStatus, onApplyColor, onInvertVisible, onClearSelection, }: PhotoSelectionContextMenuProps): import("react/jsx-runtime").JSX.Element;
export {};
