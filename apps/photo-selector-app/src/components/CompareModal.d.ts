import type { ImageAsset } from "@photo-tools/shared-types";
interface CompareModalProps {
    photos: ImageAsset[];
    onClose: () => void;
    onUpdatePhoto: (id: string, changes: Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">>) => void;
}
export declare function CompareModal({ photos, onClose, onUpdatePhoto }: CompareModalProps): import("react/jsx-runtime").JSX.Element;
export {};
