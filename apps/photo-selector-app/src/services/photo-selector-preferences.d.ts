import type { ColorLabel } from "@photo-tools/shared-types";
import type { PhotoFilterState } from "./photo-classification";
export interface PhotoFilterPreset {
    id: string;
    name: string;
    filters: PhotoFilterState & {
        folderFilter?: string;
        seriesFilter?: string;
        timeClusterFilter?: string;
        searchQuery?: string;
    };
}
export interface PhotoSelectorPreferences {
    colorNames: Record<ColorLabel, string>;
    filterPresets: PhotoFilterPreset[];
}
export declare const DEFAULT_PHOTO_SELECTOR_PREFERENCES: PhotoSelectorPreferences;
export declare function loadPhotoSelectorPreferences(): PhotoSelectorPreferences;
export declare function savePhotoSelectorPreferences(preferences: PhotoSelectorPreferences): void;
