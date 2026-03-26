import type { ColorLabel, ImageAsset, PickStatus } from "@photo-tools/shared-types";
export declare const COLOR_LABELS: ColorLabel[];
export declare const COLOR_LABEL_NAMES: Record<ColorLabel, string>;
export declare const PICK_STATUS_LABELS: Record<PickStatus, string>;
export interface PhotoFilterState {
    pickStatus: "all" | PickStatus;
    /** "any" | "0".."5" (esatto) | "1+".."4+" (minimo) */
    ratingFilter: string;
    colorLabel: "all" | ColorLabel;
}
export interface PhotoShortcutItem {
    keys: string;
    description: string;
}
export interface PhotoShortcutInput {
    key: string;
    code?: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
}
export declare const PHOTO_CLASSIFICATION_SHORTCUTS: PhotoShortcutItem[];
export declare const DEFAULT_PHOTO_FILTERS: PhotoFilterState;
export declare function getAssetRating(asset: ImageAsset): number;
export declare function getAssetPickStatus(asset: ImageAsset): PickStatus;
export declare function getAssetColorLabel(asset: ImageAsset): ColorLabel | null;
export declare function formatAssetStars(asset: ImageAsset): string;
export declare function matchesPhotoFilters(asset: ImageAsset, filters: PhotoFilterState): boolean;
export declare function getColorShortcutHint(colorLabel: ColorLabel): string;
export declare function resolvePhotoClassificationShortcut(input: PhotoShortcutInput): Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">> | null;
