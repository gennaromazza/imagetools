import type { ColorLabel } from "@photo-tools/shared-types";
import type { PhotoFilterState } from "./photo-classification";
export type ThumbnailProfile = "ultra-fast" | "fast" | "balanced";
export type CustomLabelTone = "sand" | "rose" | "green" | "blue" | "purple" | "slate";
export declare const DEFAULT_CUSTOM_LABEL_TONE: CustomLabelTone;
export declare const CUSTOM_LABEL_SHORTCUT_OPTIONS: readonly ["A", "S", "D", "G", "H", "J", "K", "L", "Q", "W", "E", "R", "T", "Y"];
export type CustomLabelShortcut = (typeof CUSTOM_LABEL_SHORTCUT_OPTIONS)[number];
export interface PhotoFilterPreset {
    id: string;
    name: string;
    filters: PhotoFilterState & {
        customLabelFilter?: string;
        folderFilter?: string;
        seriesFilter?: string;
        timeClusterFilter?: string;
        searchQuery?: string;
    };
}
export interface PhotoSelectorPreferences {
    colorNames: Record<ColorLabel, string>;
    filterPresets: PhotoFilterPreset[];
    customLabelsCatalog: string[];
    customLabelColors: Record<string, CustomLabelTone>;
    customLabelShortcuts: Record<string, CustomLabelShortcut | null>;
    thumbnailProfile: ThumbnailProfile;
    sortCacheEnabled: boolean;
    cardSize: number;
    rootFolderPathOverride: string;
    preferredEditorPath: string;
}
export declare const DEFAULT_PHOTO_SELECTOR_PREFERENCES: PhotoSelectorPreferences;
export declare function normalizeCustomLabelName(value: string): string;
export declare function normalizeCustomLabelsCatalog(values: string[] | undefined): string[];
export declare function normalizeCustomLabelTone(value: string | undefined): CustomLabelTone;
export declare function normalizeCustomLabelColors(catalog: string[], colors: Record<string, string> | undefined): Record<string, CustomLabelTone>;
export declare function normalizeCustomLabelShortcut(value: string | null | undefined): CustomLabelShortcut | null;
export declare function normalizeCustomLabelShortcuts(catalog: string[], shortcuts: Record<string, string | null> | undefined): Record<string, CustomLabelShortcut | null>;
export declare function loadPhotoSelectorPreferences(): PhotoSelectorPreferences;
export declare function hydratePhotoSelectorPreferences(): Promise<PhotoSelectorPreferences>;
export declare function savePhotoSelectorPreferences(preferences: Partial<PhotoSelectorPreferences>): void;
