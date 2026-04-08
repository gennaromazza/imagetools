import { type DragEvent } from "react";
import type { ImageAsset } from "@photo-tools/shared-types";
import type { CustomLabelShortcut, CustomLabelTone } from "../services/photo-selector-preferences";
interface PhotoCardProps {
    photo: ImageAsset;
    isSelected: boolean;
    onToggle: (id: string, event?: React.MouseEvent) => void;
    onUpdatePhoto: (id: string, changes: Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel" | "customLabels">>) => void;
    onFocus: (id: string) => void;
    onPreview: (id: string) => void;
    onContextMenu: (id: string, x: number, y: number) => void;
    onExternalDragStart?: (id: string, event: DragEvent<HTMLDivElement>) => void;
    canExternalDrag?: boolean;
    customLabelColors?: Record<string, CustomLabelTone>;
    customLabelShortcuts?: Record<string, CustomLabelShortcut | null>;
    disableNonEssentialUi?: boolean;
    batchPulseToken?: number;
    batchPulseKind?: "dot" | "label" | null;
    editable: boolean;
}
export declare const PhotoCard: import("react").NamedExoticComponent<PhotoCardProps>;
export {};
