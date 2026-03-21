export const COLOR_LABELS = ["red", "yellow", "green", "blue", "purple"];
export const COLOR_LABEL_NAMES = {
    red: "Rosso",
    yellow: "Giallo",
    green: "Verde",
    blue: "Blu",
    purple: "Viola"
};
export const PICK_STATUS_LABELS = {
    picked: "Pick",
    rejected: "Scartata",
    unmarked: "Neutra"
};
export const PHOTO_CLASSIFICATION_SHORTCUTS = [
    { keys: "1-5", description: "Assegna stelle" },
    { keys: "0", description: "Azzera le stelle" },
    { keys: "P / X / U", description: "Pick, Scartata, Neutra" },
    { keys: "Ctrl/Cmd + 6", description: "Etichetta rossa" },
    { keys: "Ctrl/Cmd + 7", description: "Etichetta gialla" },
    { keys: "Ctrl/Cmd + 8", description: "Etichetta verde" },
    { keys: "Ctrl/Cmd + 9", description: "Etichetta blu" },
    { keys: "Ctrl/Cmd + V", description: "Etichetta viola" },
    { keys: "Ctrl/Cmd + 0", description: "Rimuove il colore" },
    { keys: "Spazio", description: "Apre la preview grande" }
];
export const DEFAULT_PHOTO_FILTERS = {
    pickStatus: "all",
    ratingFilter: "any",
    colorLabel: "all"
};
export function getAssetRating(asset) {
    return Math.max(0, Math.min(5, Math.round(asset.rating ?? 0)));
}
export function getAssetPickStatus(asset) {
    return asset.pickStatus ?? "unmarked";
}
export function getAssetColorLabel(asset) {
    return asset.colorLabel ?? null;
}
export function formatAssetStars(asset) {
    const rating = getAssetRating(asset);
    return rating > 0 ? "★".repeat(rating) : "Nessuna stella";
}
export function matchesPhotoFilters(asset, filters) {
    if (filters.pickStatus !== "all" && getAssetPickStatus(asset) !== filters.pickStatus) {
        return false;
    }
    if (filters.colorLabel !== "all" && getAssetColorLabel(asset) !== filters.colorLabel) {
        return false;
    }
    const rf = filters.ratingFilter ?? "any";
    if (rf !== "any") {
        const rating = getAssetRating(asset);
        if (rf.endsWith("+")) {
            if (rating < Number(rf.slice(0, -1)))
                return false;
        }
        else {
            if (rating !== Number(rf))
                return false;
        }
    }
    return true;
}
export function getColorShortcutHint(colorLabel) {
    switch (colorLabel) {
        case "red":
            return "Ctrl/Cmd + 6";
        case "yellow":
            return "Ctrl/Cmd + 7";
        case "green":
            return "Ctrl/Cmd + 8";
        case "blue":
            return "Ctrl/Cmd + 9";
        case "purple":
            return "Ctrl/Cmd + V";
    }
}
export function resolvePhotoClassificationShortcut(input) {
    const normalizedKey = input.key.toLowerCase();
    const usesModifier = Boolean(input.ctrlKey || input.metaKey);
    if (!usesModifier && /^[0-5]$/.test(input.key)) {
        return { rating: Number(input.key) };
    }
    if (!usesModifier && normalizedKey === "p") {
        return { pickStatus: "picked" };
    }
    if (!usesModifier && normalizedKey === "x") {
        return { pickStatus: "rejected" };
    }
    if (!usesModifier && normalizedKey === "u") {
        return { pickStatus: "unmarked" };
    }
    if (usesModifier && (input.code === "Digit0" || normalizedKey === "0")) {
        return { colorLabel: null };
    }
    if (usesModifier && input.code === "Digit6") {
        return { colorLabel: "red" };
    }
    if (usesModifier && input.code === "Digit7") {
        return { colorLabel: "yellow" };
    }
    if (usesModifier && input.code === "Digit8") {
        return { colorLabel: "green" };
    }
    if (usesModifier && input.code === "Digit9") {
        return { colorLabel: "blue" };
    }
    if (usesModifier && normalizedKey === "v") {
        return { colorLabel: "purple" };
    }
    return null;
}
//# sourceMappingURL=photo-classification.js.map