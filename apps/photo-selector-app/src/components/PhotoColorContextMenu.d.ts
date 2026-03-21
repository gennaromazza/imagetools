import type { ColorLabel } from "@photo-tools/shared-types";
interface PhotoColorContextMenuProps {
    x: number;
    y: number;
    selectedColor: ColorLabel | null;
    title?: string;
    onSelect: (colorLabel: ColorLabel | null) => void;
}
export declare function PhotoColorContextMenu({ x, y, selectedColor, title, onSelect }: PhotoColorContextMenuProps): import("react/jsx-runtime").JSX.Element;
export {};
