import { COLOR_LABEL_NAMES } from "./photo-classification";
import { getDesktopPreferences, hasDesktopStateApi, saveDesktopPreferences as saveDesktopPreferencesNative } from "./desktop-store";
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
    cardSize: 160,
    rootFolderPathOverride: "",
    preferredEditorPath: "",
    autoAdvanceOnAction: true,
};
let preferencesCache = { ...DEFAULT_PHOTO_SELECTOR_PREFERENCES };
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
function isPlainRecord(value) {
    // Object.entries lancia su null/undefined e si comporta in modo strano su
    // array o tipi primitivi. Usato per blindare i valori letti dal DB nel caso
    // di drift di schema o file di preferenze toccati a mano.
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function normalizeCustomLabelColors(catalog, colors) {
    const normalized = {};
    if (!colors || !isPlainRecord(colors)) {
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
    const safeShortcuts = isPlainRecord(shortcuts) ? shortcuts : {};
    const shortcutEntries = Object.entries(safeShortcuts);
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
function clampCardSize(value) {
    return Math.max(100, Math.min(320, Number(value ?? DEFAULT_PHOTO_SELECTOR_PREFERENCES.cardSize)));
}
function isValidFilterPreset(value) {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value;
    return (typeof candidate.id === "string"
        && typeof candidate.name === "string"
        && Boolean(candidate.filters)
        && typeof candidate.filters === "object");
}
function clonePreferences(preferences) {
    return {
        ...preferences,
        colorNames: { ...preferences.colorNames },
        filterPresets: preferences.filterPresets.map((preset) => ({
            ...preset,
            filters: { ...preset.filters },
        })),
        customLabelsCatalog: [...preferences.customLabelsCatalog],
        customLabelColors: { ...preferences.customLabelColors },
        customLabelShortcuts: { ...preferences.customLabelShortcuts },
    };
}
export function loadPhotoSelectorPreferences() {
    return clonePreferences(preferencesCache);
}
function parseStoredPreferences(parsed) {
    const customLabelsCatalog = normalizeCustomLabelsCatalog(parsed?.customLabelsCatalog);
    return {
        colorNames: {
            ...COLOR_LABEL_NAMES,
            ...(parsed?.colorNames ?? {}),
        },
        filterPresets: Array.isArray(parsed?.filterPresets)
            ? parsed.filterPresets.filter(isValidFilterPreset)
            : [],
        customLabelsCatalog,
        customLabelColors: normalizeCustomLabelColors(customLabelsCatalog, parsed?.customLabelColors),
        customLabelShortcuts: normalizeCustomLabelShortcuts(customLabelsCatalog, parsed?.customLabelShortcuts),
        thumbnailProfile: parsed?.thumbnailProfile === "balanced"
            ? "balanced"
            : parsed?.thumbnailProfile === "fast"
                ? "fast"
                : "ultra-fast",
        sortCacheEnabled: parsed?.sortCacheEnabled !== false,
        cardSize: clampCardSize(parsed?.cardSize),
        rootFolderPathOverride: typeof parsed?.rootFolderPathOverride === "string"
            ? parsed.rootFolderPathOverride
            : "",
        preferredEditorPath: typeof parsed?.preferredEditorPath === "string"
            ? parsed.preferredEditorPath
            : "",
        autoAdvanceOnAction: parsed?.autoAdvanceOnAction !== false,
    };
}
function toDesktopPreferences(preferences) {
    return {
        colorNames: preferences.colorNames,
        filterPresets: preferences.filterPresets,
        customLabelsCatalog: preferences.customLabelsCatalog,
        customLabelColors: preferences.customLabelColors,
        customLabelShortcuts: preferences.customLabelShortcuts,
        thumbnailProfile: preferences.thumbnailProfile,
        sortCacheEnabled: preferences.sortCacheEnabled,
        cardSize: preferences.cardSize,
        rootFolderPathOverride: preferences.rootFolderPathOverride,
        preferredEditorPath: preferences.preferredEditorPath,
        autoAdvanceOnAction: preferences.autoAdvanceOnAction,
    };
}
export async function hydratePhotoSelectorPreferences() {
    if (typeof window === "undefined") {
        return preferencesCache;
    }
    const nativePreferences = await getDesktopPreferences();
    preferencesCache = parseStoredPreferences(nativePreferences);
    return preferencesCache;
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
        cardSize: preferences.cardSize !== undefined ? clampCardSize(preferences.cardSize) : current.cardSize,
        rootFolderPathOverride: preferences.rootFolderPathOverride ?? current.rootFolderPathOverride,
        preferredEditorPath: preferences.preferredEditorPath ?? current.preferredEditorPath,
        autoAdvanceOnAction: preferences.autoAdvanceOnAction !== undefined
            ? preferences.autoAdvanceOnAction
            : current.autoAdvanceOnAction,
    };
    next.customLabelColors = normalizeCustomLabelColors(next.customLabelsCatalog, {
        ...current.customLabelColors,
        ...(preferences.customLabelColors ?? {}),
    });
    next.customLabelShortcuts = normalizeCustomLabelShortcuts(next.customLabelsCatalog, {
        ...current.customLabelShortcuts,
        ...(preferences.customLabelShortcuts ?? {}),
    });
    preferencesCache = next;
    if (hasDesktopStateApi()) {
        void saveDesktopPreferencesNative(toDesktopPreferences(next));
    }
}
//# sourceMappingURL=photo-selector-preferences.js.map