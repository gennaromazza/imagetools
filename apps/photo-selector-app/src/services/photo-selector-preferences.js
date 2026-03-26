import { COLOR_LABEL_NAMES } from "./photo-classification";
const PREFERENCES_KEY = "photo-selector-preferences-v1";
export const DEFAULT_PHOTO_SELECTOR_PREFERENCES = {
    colorNames: { ...COLOR_LABEL_NAMES },
    filterPresets: [],
};
export function loadPhotoSelectorPreferences() {
    if (typeof window === "undefined") {
        return DEFAULT_PHOTO_SELECTOR_PREFERENCES;
    }
    try {
        const raw = window.localStorage.getItem(PREFERENCES_KEY);
        if (!raw) {
            return DEFAULT_PHOTO_SELECTOR_PREFERENCES;
        }
        const parsed = JSON.parse(raw);
        return {
            colorNames: {
                ...COLOR_LABEL_NAMES,
                ...(parsed.colorNames ?? {}),
            },
            filterPresets: Array.isArray(parsed.filterPresets) ? parsed.filterPresets : [],
        };
    }
    catch {
        return DEFAULT_PHOTO_SELECTOR_PREFERENCES;
    }
}
export function savePhotoSelectorPreferences(preferences) {
    if (typeof window === "undefined") {
        return;
    }
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}
//# sourceMappingURL=photo-selector-preferences.js.map