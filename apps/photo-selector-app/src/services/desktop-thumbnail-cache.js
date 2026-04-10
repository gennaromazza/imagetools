function getDesktopApi() {
    if (typeof window === "undefined") {
        return null;
    }
    return window.filexDesktop ?? null;
}
export async function getDesktopThumbnailCacheInfo() {
    const api = getDesktopApi();
    if (!api?.getThumbnailCacheInfo) {
        return null;
    }
    try {
        return await api.getThumbnailCacheInfo();
    }
    catch {
        return null;
    }
}
export async function chooseDesktopThumbnailCacheDirectory() {
    const api = getDesktopApi();
    if (!api?.chooseThumbnailCacheDirectory) {
        return null;
    }
    try {
        return await api.chooseThumbnailCacheDirectory();
    }
    catch {
        return null;
    }
}
export async function setDesktopThumbnailCacheDirectory(directoryPath) {
    const api = getDesktopApi();
    if (!api?.setThumbnailCacheDirectory) {
        return null;
    }
    try {
        return await api.setThumbnailCacheDirectory(directoryPath);
    }
    catch {
        return null;
    }
}
export async function resetDesktopThumbnailCacheDirectory() {
    const api = getDesktopApi();
    if (!api?.resetThumbnailCacheDirectory) {
        return null;
    }
    try {
        return await api.resetThumbnailCacheDirectory();
    }
    catch {
        return null;
    }
}
export async function clearDesktopThumbnailCache() {
    const api = getDesktopApi();
    if (!api?.clearThumbnailCache) {
        return false;
    }
    try {
        return await api.clearThumbnailCache();
    }
    catch {
        return false;
    }
}
export async function getDesktopCacheLocationRecommendation() {
    const api = getDesktopApi();
    if (!api?.getCacheLocationRecommendation) {
        return null;
    }
    try {
        return await api.getCacheLocationRecommendation();
    }
    catch {
        return null;
    }
}
export async function migrateDesktopThumbnailCacheDirectory(directoryPath) {
    const api = getDesktopApi();
    if (!api?.migrateThumbnailCacheDirectory) {
        return null;
    }
    try {
        return await api.migrateThumbnailCacheDirectory(directoryPath);
    }
    catch {
        return null;
    }
}
export async function dismissDesktopCacheLocationRecommendation() {
    const api = getDesktopApi();
    if (!api?.dismissCacheLocationRecommendation) {
        return false;
    }
    try {
        await api.dismissCacheLocationRecommendation();
        return true;
    }
    catch {
        return false;
    }
}
export async function getDesktopRamBudgetInfo() {
    const api = getDesktopApi();
    if (!api?.getRamBudgetInfo) {
        return null;
    }
    try {
        return await api.getRamBudgetInfo();
    }
    catch {
        return null;
    }
}
export async function setDesktopRamBudgetPreset(preset) {
    const api = getDesktopApi();
    if (!api?.setRamBudgetPreset) {
        return null;
    }
    try {
        return await api.setRamBudgetPreset(preset);
    }
    catch {
        return null;
    }
}
export function relaunchDesktopApp() {
    const api = getDesktopApi();
    if (api?.relaunch) {
        void api.relaunch();
    }
}
//# sourceMappingURL=desktop-thumbnail-cache.js.map