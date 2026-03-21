import type { ColorLabel } from "@photo-tools/shared-types";
import type { PhotoFilterState } from "./photo-classification";
import { COLOR_LABEL_NAMES } from "./photo-classification";

const PREFERENCES_KEY = "photo-selector-preferences-v1";

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

export const DEFAULT_PHOTO_SELECTOR_PREFERENCES: PhotoSelectorPreferences = {
  colorNames: { ...COLOR_LABEL_NAMES },
  filterPresets: [],
};

export function loadPhotoSelectorPreferences(): PhotoSelectorPreferences {
  if (typeof window === "undefined") {
    return DEFAULT_PHOTO_SELECTOR_PREFERENCES;
  }

  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    if (!raw) {
      return DEFAULT_PHOTO_SELECTOR_PREFERENCES;
    }

    const parsed = JSON.parse(raw) as Partial<PhotoSelectorPreferences>;
    return {
      colorNames: {
        ...COLOR_LABEL_NAMES,
        ...(parsed.colorNames ?? {}),
      },
      filterPresets: Array.isArray(parsed.filterPresets) ? parsed.filterPresets : [],
    };
  } catch {
    return DEFAULT_PHOTO_SELECTOR_PREFERENCES;
  }
}

export function savePhotoSelectorPreferences(preferences: PhotoSelectorPreferences): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}
