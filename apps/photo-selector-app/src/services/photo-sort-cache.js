const SORT_CACHE_KEY = "photo-selector-sort-cache-v1";
const SORT_CACHE_MAX_ENTRIES = 24;
function loadEntries() {
    if (typeof window === "undefined") {
        return [];
    }
    try {
        const raw = window.localStorage.getItem(SORT_CACHE_KEY);
        if (!raw) {
            return [];
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter((entry) => (!!entry &&
            typeof entry.folderPath === "string" &&
            (entry.sortBy === "name" || entry.sortBy === "orientation" || entry.sortBy === "rating") &&
            typeof entry.signature === "string" &&
            Array.isArray(entry.orderedIds) &&
            typeof entry.updatedAt === "number"));
    }
    catch {
        return [];
    }
}
function saveEntries(entries) {
    if (typeof window === "undefined") {
        return;
    }
    window.localStorage.setItem(SORT_CACHE_KEY, JSON.stringify(entries));
}
function appendHash(hash, value) {
    let next = hash;
    for (let index = 0; index < value.length; index += 1) {
        next = ((next << 5) + next + value.charCodeAt(index)) >>> 0;
    }
    return next;
}
export function buildPhotoSortSignature(photos, sortBy) {
    let hash = 5381;
    hash = appendHash(hash, sortBy);
    hash = appendHash(hash, String(photos.length));
    for (const photo of photos) {
        hash = appendHash(hash, photo.id);
        hash = appendHash(hash, photo.fileName);
        if (sortBy === "rating") {
            hash = appendHash(hash, String(photo.rating ?? 0));
        }
        else if (sortBy === "orientation") {
            hash = appendHash(hash, photo.orientation ?? "");
        }
        else {
            hash = appendHash(hash, photo.sourceFileKey ?? photo.path);
        }
    }
    return `${photos.length}:${hash.toString(16)}`;
}
export function loadCachedPhotoSortOrder(folderPath, sortBy, signature) {
    if (!folderPath) {
        return null;
    }
    const match = loadEntries().find((entry) => (entry.folderPath === folderPath &&
        entry.sortBy === sortBy &&
        entry.signature === signature));
    return match ? [...match.orderedIds] : null;
}
export function saveCachedPhotoSortOrder(folderPath, sortBy, signature, orderedIds) {
    if (!folderPath || orderedIds.length === 0 || typeof window === "undefined") {
        return;
    }
    const nextEntry = {
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
}
//# sourceMappingURL=photo-sort-cache.js.map