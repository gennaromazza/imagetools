import type { ImageAsset } from "@photo-tools/shared-types";
interface PhotoCardProps {
    photo: ImageAsset;
    isSelected: boolean;
    onToggle: (id: string, event?: React.MouseEvent) => void;
    onUpdatePhoto: (id: string, changes: Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">>) => void;
    onFocus: (id: string) => void;
    onPreview: (id: string) => void;
    onContextMenu: (id: string, x: number, y: number) => void;
    editable: boolean;
}
export declare const PhotoCard: import("react").NamedExoticComponent<PhotoCardProps>;
export {};
