import { COLOR_LABEL_NAMES } from "./photo-classification";
const PREFERENCES_KEY = "photo-selector-preferences-v1";
export const DEFAULT_CUSTOM_LABEL_TONE = "sand";
export const CUSTOM_LABEL_SHORTCUT_OPTIONS = [
    "A", "S", "D", "G", "H", "J", "K", "L", "Q", "W", "E", "R", "T", "Y",
];
export const DEFAULT_PHOTO_SELECTOR_PREFERENCES = {
    colorNames: { ...COLOR_LABEL_NAMES },
    filterPresets: [],
    customLabelsCatalog: [],
    customLabelColors: {},
    customLabelShortcuts: {},
    thumbnailProfile: "ultra-fast",
    sortCacheEnabled: true,
};
export function normalizeCustomLabelName(value) {
    return value.replace(/\s+/g, " ").trim().slice(0, 48);
}
export function normalizeCustomLabelsCatalog(values) {
    if (!values || values.length === 0) {
        return [];
    }
    const seen = new Set();
    const normalized = [];
    for (const value of values) {
        const cleaned = normalizeCustomLabelName(value);
        if (!cleaned) {
            continue;
        }
        const key = cleaned.toLocaleLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        normalized.push(cleaned);
    }
    return normalized;
}
export function normalizeCustomLabelTone(value) {
    switch (value) {
        case "rose":
        case "green":
        case "blue":
        case "purple":
        case "slate":
        case "sand":
            return value;
        default:
            return DEFAULT_CUSTOM_LABEL_TONE;
    }
}
export function normalizeCustomLabelColors(catalog, colors) {
    const normalized = {};
    if (!colors) {
        for (const label of catalog) {
            normalized[label] = DEFAULT_CUSTOM_LABEL_TONE;
        }
        return normalized;
    }
    const colorEntries = Object.entries(colors);
    for (const label of catalog) {
        const match = colorEntries.find(([key]) => key.toLocaleLowerCase() === label.toLocaleLowerCase());
        normalized[label] = normalizeCustomLabelTone(match?.[1]);
    }
    return normalized;
}
export function normalizeCustomLabelShortcut(value) {
    if (!value) {
        return null;
    }
    const normalized = value.trim().toUpperCase();
    return CUSTOM_LABEL_SHORTCUT_OPTIONS.includes(normalized)
        ? normalized
        : null;
}
export function normalizeCustomLabelShortcuts(catalog, shortcuts) {
    const normalized = {};
    const usedShortcuts = new Set();
    const shortcutEntries = Object.entries(shortcuts ?? {});
    for (const label of catalog) {
        const match = shortcutEntries.find(([key]) => key.toLocaleLowerCase() === label.toLocaleLowerCase());
        const nextShortcut = normalizeCustomLabelShortcut(match?.[1]);
        if (!nextShortcut || usedShortcuts.has(nextShortcut)) {
            normalized[label] = null;
            continue;
        }
        usedShortcuts.add(nextShortcut);
        normalized[label] = nextShortcut;
    }
    return normalized;
}
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
        const customLabelsCatalog = normalizeCustomLabelsCatalog(parsed.customLabelsCatalog);
        return {
            colorNames: {
                ...COLOR_LABEL_NAMES,
                ...(parsed.colorNames ?? {}),
            },
            filterPresets: Array.isArray(parsed.filterPresets) ? parsed.filterPresets : [],
            customLabelsCatalog,
            customLabelColors: normalizeCustomLabelColors(customLabelsCatalog, parsed.customLabelColors),
            customLabelShortcuts: normalizeCustomLabelShortcuts(customLabelsCatalog, parsed.customLabelShortcuts),
            thumbnailProfile: parsed.thumbnailProfile === "balanced"
                ? "balanced"
                : parsed.thumbnailProfile === "fast"
                    ? "fast"
                    : "ultra-fast",
            sortCacheEnabled: parsed.sortCacheEnabled !== false,
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
    const current = loadPhotoSelectorPreferences();
    const next = {
        ...current,
        ...preferences,
        colorNames: {
            ...current.colorNames,
            ...(preferences.colorNames ?? {}),
        },
        customLabelsCatalog: normalizeCustomLabelsCatalog(preferences.customLabelsCatalog ?? current.customLabelsCatalog),
        customLabelColors: {},
        customLabelShortcuts: {},
        thumbnailProfile: preferences.thumbnailProfile === "balanced"
            ? "balanced"
            : preferences.thumbnailProfile === "fast"
                ? "fast"
                : preferences.thumbnailProfile === "ultra-fast"
                    ? "ultra-fast"
                    : current.thumbnailProfile,
        sortCacheEnabled: preferences.sortCacheEnabled ?? current.sortCacheEnabled,
    };
    next.customLabelColors = normalizeCustomLabelColors(next.customLabelsCatalog, {
        ...current.customLabelColors,
        ...(preferences.customLabelColors ?? {}),
    });
    next.customLabelShortcuts = normalizeCustomLabelShortcuts(next.customLabelsCatalog, {
        ...current.customLabelShortcuts,
        ...(preferences.customLabelShortcuts ?? {}),
    });
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
}
//# sourceMappingURL=photo-selector-preferences.js.map