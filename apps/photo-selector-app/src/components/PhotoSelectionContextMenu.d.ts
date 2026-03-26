import type { ColorLabel, PickStatus } from "@photo-tools/shared-types";
interface PhotoSelectionContextMenuProps {
    x: number;
    y: number;
    targetCount: number;
    colorLabelNames?: Record<ColorLabel, string>;
    hasFileAccess?: boolean;
    rootFolderPath?: string;
    targetPath?: string;
    onApplyRating: (rating: number) => void;
    onApplyPickStatus: (pickStatus: PickStatus) => void;
    onApplyColor: (colorLabel: ColorLabel | null) => void;
    onInvertVisible: () => void;
    onClearSelection: () => void;
    onToggleSelection?: () => void;
    onOpenPreview?: () => void;
    onCopyFiles?: () => void;
    onMoveFiles?: () => void;
    onSaveAs?: () => void;
    onCopyPath?: () => void;
    onOpenWithEditor?: () => void;
}
export declare function PhotoSelectionContextMenu({ x, y, targetCount, colorLabelNames, hasFileAccess, rootFolderPath, targetPath, onApplyRating, onApplyPickStatus, onApplyColor, onInvertVisible, onClearSelection, onToggleSelection, onOpenPreview, onCopyFiles, onMoveFiles, onSaveAs, onCopyPath, onOpenWithEditor, }: PhotoSelectionContextMenuProps): import("react/jsx-runtime").JSX.Element;
export {};
