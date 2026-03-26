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
//# sourceMappingURL=desktop-thumbnail-cache.js.map