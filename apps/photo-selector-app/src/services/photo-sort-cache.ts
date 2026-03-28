import type { ImageAsset } from "@photo-tools/shared-types";
import { getDesktopSortCache, hasDesktopStateApi, saveDesktopSortCache } from "./desktop-store";

const SORT_CACHE_KEY = "photo-selector-sort-cache-v1";
const SORT_CACHE_MAX_ENTRIES = 24;

export type PhotoSortMode = "name" | "orientation" | "rating";

interface SortCacheEntry {
  folderPath: string;
  sortBy: PhotoSortMode;
  signature: string;
  orderedIds: string[];
  updatedAt: number;
}

let sortCacheEntries: SortCacheEntry[] = [];

function loadEntries(): SortCacheEntry[] {
  if (typeof window === "undefined") {
    return sortCacheEntries;
  }

  if (hasDesktopStateApi()) {
    return sortCacheEntries;
  }

  try {
    const raw = window.localStorage.getItem(SORT_CACHE_KEY);
    if (!raw) {
      sortCacheEntries = [];
      return sortCacheEntries;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      sortCacheEntries = [];
      return sortCacheEntries;
    }

    sortCacheEntries = parsed.filter((entry): entry is SortCacheEntry => (
      !!entry &&
      typeof entry.folderPath === "string" &&
      (entry.sortBy === "name" || entry.sortBy === "orientation" || entry.sortBy === "rating") &&
      typeof entry.signature === "string" &&
      Array.isArray(entry.orderedIds) &&
      typeof entry.updatedAt === "number"
    ));
    return sortCacheEntries;
  } catch {
    sortCacheEntries = [];
    return sortCacheEntries;
  }
}

function saveEntries(entries: SortCacheEntry[]): void {
  sortCacheEntries = entries;
  if (typeof window === "undefined") {
    return;
  }

  if (hasDesktopStateApi()) {
    return;
  }

  window.localStorage.setItem(SORT_CACHE_KEY, JSON.stringify(entries));
}

function appendHash(hash: number, value: string): number {
  let next = hash;
  for (let index = 0; index < value.length; index += 1) {
    next = ((next << 5) + next + value.charCodeAt(index)) >>> 0;
  }
  return next;
}

export function buildPhotoSortSignature(
  photos: ImageAsset[],
  sortBy: PhotoSortMode,
): string {
  let hash = 5381;
  hash = appendHash(hash, sortBy);
  hash = appendHash(hash, String(photos.length));

  for (const photo of photos) {
    hash = appendHash(hash, photo.id);
    hash = appendHash(hash, photo.fileName);

    if (sortBy === "rating") {
      hash = appendHash(hash, String(photo.rating ?? 0));
    } else if (sortBy === "orientation") {
      hash = appendHash(hash, photo.orientation ?? "");
    } else {
      hash = appendHash(hash, photo.sourceFileKey ?? photo.path);
    }
  }

  return `${photos.length}:${hash.toString(16)}`;
}

export function loadCachedPhotoSortOrder(
  folderPath: string,
  sortBy: PhotoSortMode,
  signature: string,
): string[] | null {
  if (!folderPath) {
    return null;
  }

  const match = loadEntries().find((entry) => (
    entry.folderPath === folderPath &&
    entry.sortBy === sortBy &&
    entry.signature === signature
  ));

  return match ? [...match.orderedIds] : null;
}

export async function hydratePhotoSortCache(folderPath?: string): Promise<SortCacheEntry[]> {
  if (typeof window === "undefined") {
    return sortCacheEntries;
  }

  if (!hasDesktopStateApi()) {
    return loadEntries();
  }

  const entries = await getDesktopSortCache(folderPath);
  sortCacheEntries = Array.isArray(entries)
    ? entries.filter((entry): entry is SortCacheEntry => (
        !!entry &&
        typeof entry.folderPath === "string" &&
        (entry.sortBy === "name" || entry.sortBy === "orientation" || entry.sortBy === "rating") &&
        typeof entry.signature === "string" &&
        Array.isArray(entry.orderedIds) &&
        typeof entry.updatedAt === "number"
      ))
    : [];
  return sortCacheEntries;
}

export function saveCachedPhotoSortOrder(
  folderPath: string,
  sortBy: PhotoSortMode,
  signature: string,
  orderedIds: string[],
): void {
  if (!folderPath || orderedIds.length === 0 || typeof window === "undefined") {
    return;
  }

  const nextEntry: SortCacheEntry = {
    folderPath,
    sortBy,
    signature,
    orderedIds: [...orderedIds],
    updatedAt: Date.now(),
  };

  const entries = loadEntries()
    .filter((entry) => !(entry.folderPath === folderPath && entry.sortBy === sortBy))
    .concat(nextEntry)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, SORT_CACHE_MAX_ENTRIES);

  saveEntries(entries);

  if (hasDesktopStateApi()) {
    void saveDesktopSortCache(nextEntry);
  }
}
