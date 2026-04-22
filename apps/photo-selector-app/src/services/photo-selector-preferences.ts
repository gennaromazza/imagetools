import type { ColorLabel } from "@photo-tools/shared-types";
import type { DesktopPhotoSelectorPreferences } from "@photo-tools/desktop-contracts";
import type { PhotoFilterState } from "./photo-classification";
import { COLOR_LABEL_NAMES } from "./photo-classification";
import { getDesktopPreferences, hasDesktopStateApi, saveDesktopPreferences as saveDesktopPreferencesNative } from "./desktop-store";

export type ThumbnailProfile = "ultra-fast" | "fast" | "balanced";
export type CustomLabelTone = "sand" | "rose" | "green" | "blue" | "purple" | "slate";
export const DEFAULT_CUSTOM_LABEL_TONE: CustomLabelTone = "sand";
export const CUSTOM_LABEL_SHORTCUT_OPTIONS = [
  "A", "S", "D", "G", "H", "J", "K", "L", "Q", "W", "E", "R", "T", "Y",
] as const;
export type CustomLabelShortcut = (typeof CUSTOM_LABEL_SHORTCUT_OPTIONS)[number];

export interface PhotoFilterPreset {
  id: string;
  name: string;
  filters: PhotoFilterState & {
    fileTypeFilter?: string;
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

export const DEFAULT_PHOTO_SELECTOR_PREFERENCES: PhotoSelectorPreferences = {
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
};

let preferencesCache: PhotoSelectorPreferences = { ...DEFAULT_PHOTO_SELECTOR_PREFERENCES };

export function normalizeCustomLabelName(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 48);
}

export function normalizeCustomLabelsCatalog(values: string[] | undefined): string[] {
  if (!values || values.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
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

export function normalizeCustomLabelTone(value: string | undefined): CustomLabelTone {
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

export function normalizeCustomLabelColors(
  catalog: string[],
  colors: Record<string, string> | undefined,
): Record<string, CustomLabelTone> {
  const normalized: Record<string, CustomLabelTone> = {};
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

export function normalizeCustomLabelShortcut(
  value: string | null | undefined,
): CustomLabelShortcut | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return CUSTOM_LABEL_SHORTCUT_OPTIONS.includes(normalized as CustomLabelShortcut)
    ? normalized as CustomLabelShortcut
    : null;
}

export function normalizeCustomLabelShortcuts(
  catalog: string[],
  shortcuts: Record<string, string | null> | undefined,
): Record<string, CustomLabelShortcut | null> {
  const normalized: Record<string, CustomLabelShortcut | null> = {};
  const usedShortcuts = new Set<CustomLabelShortcut>();
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

function clampCardSize(value: number | undefined): number {
  return Math.max(
    100,
    Math.min(320, Number(value ?? DEFAULT_PHOTO_SELECTOR_PREFERENCES.cardSize)),
  );
}

function isValidFilterPreset(value: unknown): value is PhotoFilterPreset {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<PhotoFilterPreset>;
  return (
    typeof candidate.id === "string"
    && typeof candidate.name === "string"
    && Boolean(candidate.filters)
    && typeof candidate.filters === "object"
  );
}

function clonePreferences(preferences: PhotoSelectorPreferences): PhotoSelectorPreferences {
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

export function loadPhotoSelectorPreferences(): PhotoSelectorPreferences {
  return clonePreferences(preferencesCache);
}

function parseStoredPreferences(
  parsed: Partial<PhotoSelectorPreferences> | Partial<DesktopPhotoSelectorPreferences> | null,
): PhotoSelectorPreferences {
  const customLabelsCatalog = normalizeCustomLabelsCatalog(parsed?.customLabelsCatalog);
  return {
    colorNames: {
      ...COLOR_LABEL_NAMES,
      ...(parsed?.colorNames ?? {}),
    },
    filterPresets: Array.isArray(parsed?.filterPresets)
      ? (parsed.filterPresets as unknown[]).filter(isValidFilterPreset)
      : [],
    customLabelsCatalog,
    customLabelColors: normalizeCustomLabelColors(
      customLabelsCatalog,
      parsed?.customLabelColors as Record<string, string> | undefined,
    ),
    customLabelShortcuts: normalizeCustomLabelShortcuts(
      customLabelsCatalog,
      parsed?.customLabelShortcuts as Record<string, string | null> | undefined,
    ),
    thumbnailProfile:
      parsed?.thumbnailProfile === "balanced"
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
  };
}

function toDesktopPreferences(preferences: PhotoSelectorPreferences): DesktopPhotoSelectorPreferences {
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
  };
}

export async function hydratePhotoSelectorPreferences(): Promise<PhotoSelectorPreferences> {
  if (typeof window === "undefined") {
    return preferencesCache;
  }

  const nativePreferences = await getDesktopPreferences();
  preferencesCache = parseStoredPreferences(nativePreferences);
  return preferencesCache;
}

export function savePhotoSelectorPreferences(preferences: Partial<PhotoSelectorPreferences>): void {
  if (typeof window === "undefined") {
    return;
  }

  const current = loadPhotoSelectorPreferences();
  const next: PhotoSelectorPreferences = {
    ...current,
    ...preferences,
    colorNames: {
      ...current.colorNames,
      ...(preferences.colorNames ?? {}),
    },
    customLabelsCatalog: normalizeCustomLabelsCatalog(
      preferences.customLabelsCatalog ?? current.customLabelsCatalog,
    ),
    customLabelColors: {},
    customLabelShortcuts: {},
    thumbnailProfile:
      preferences.thumbnailProfile === "balanced"
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
  };

  next.customLabelColors = normalizeCustomLabelColors(
    next.customLabelsCatalog,
    {
      ...current.customLabelColors,
      ...(preferences.customLabelColors ?? {}),
    },
  );
  next.customLabelShortcuts = normalizeCustomLabelShortcuts(
    next.customLabelsCatalog,
    {
      ...current.customLabelShortcuts,
      ...(preferences.customLabelShortcuts ?? {}),
    },
  );

  preferencesCache = next;

  if (hasDesktopStateApi()) {
    void saveDesktopPreferencesNative(toDesktopPreferences(next));
  }
}
