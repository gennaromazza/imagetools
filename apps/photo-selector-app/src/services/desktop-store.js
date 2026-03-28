function getDesktopApi() {
    if (typeof window === "undefined") {
        return null;
    }
    return window.filexDesktop ?? null;
}
export function hasDesktopStateApi() {
    const api = getDesktopApi();
    return Boolean(typeof api?.getDesktopPreferences === "function"
        && typeof api?.saveDesktopPreferences === "function"
        && typeof api?.getRecentFolders === "function"
        && typeof api?.getSortCache === "function");
}
export async function getDesktopPreferences() {
    const api = getDesktopApi();
    if (!api?.getDesktopPreferences) {
        return null;
    }
    try {
        return await api.getDesktopPreferences();
    }
    catch {
        return null;
    }
}
export async function saveDesktopPreferences(preferences) {
    const api = getDesktopApi();
    if (!api?.saveDesktopPreferences) {
        return null;
    }
    try {
        return await api.saveDesktopPreferences(preferences);
    }
    catch {
        return null;
    }
}
export async function getDesktopSessionState() {
    const api = getDesktopApi();
    if (!api?.getDesktopSessionState) {
        return null;
    }
    try {
        return await api.getDesktopSessionState();
    }
    catch {
        return null;
    }
}
export async function saveDesktopSessionState(state) {
    const api = getDesktopApi();
    if (!api?.saveDesktopSessionState) {
        return false;
    }
    try {
        await api.saveDesktopSessionState(state);
        return true;
    }
    catch {
        return false;
    }
}
export async function getDesktopRecentFolders() {
    const api = getDesktopApi();
    if (!api?.getRecentFolders) {
        return null;
    }
    try {
        return await api.getRecentFolders();
    }
    catch {
        return null;
    }
}
export async function saveDesktopRecentFolder(folder) {
    const api = getDesktopApi();
    if (!api?.saveRecentFolder) {
        return null;
    }
    try {
        return await api.saveRecentFolder(folder);
    }
    catch {
        return null;
    }
}
export async function removeDesktopRecentFolder(folderPathOrName) {
    const api = getDesktopApi();
    if (!api?.removeRecentFolder) {
        return null;
    }
    try {
        return await api.removeRecentFolder(folderPathOrName);
    }
    catch {
        return null;
    }
}
export async function getDesktopSortCache(folderPath) {
    const api = getDesktopApi();
    if (!api?.getSortCache) {
        return null;
    }
    try {
        return await api.getSortCache(folderPath);
    }
    catch {
        return null;
    }
}
export async function saveDesktopSortCache(entry) {
    const api = getDesktopApi();
    if (!api?.saveSortCache) {
        return false;
    }
    try {
        await api.saveSortCache(entry);
        return true;
    }
    catch {
        return false;
    }
}
export async function getDesktopFolderCatalogState(folderPath) {
    const api = getDesktopApi();
    if (!api?.getFolderCatalogState) {
        return null;
    }
    try {
        return await api.getFolderCatalogState(folderPath);
    }
    catch {
        return null;
    }
}
export async function saveDesktopFolderCatalogState(state) {
    const api = getDesktopApi();
    if (!api?.saveFolderCatalogState) {
        return false;
    }
    try {
        await api.saveFolderCatalogState(state);
        return true;
    }
    catch {
        return false;
    }
}
export async function saveDesktopFolderAssetStates(folderPath, assetStates) {
    const api = getDesktopApi();
    if (!api?.saveFolderAssetStates) {
        return false;
    }
    try {
        await api.saveFolderAssetStates(folderPath, assetStates);
        return true;
    }
    catch {
        return false;
    }
}
export async function getDesktopPerformanceSnapshot() {
    const api = getDesktopApi();
    if (!api?.getDesktopPerformanceSnapshot) {
        return null;
    }
    try {
        return await api.getDesktopPerformanceSnapshot();
    }
    catch {
        return null;
    }
}
export async function recordDesktopPerformanceSnapshot(snapshot) {
    const api = getDesktopApi();
    if (!api?.recordDesktopPerformanceSnapshot) {
        return false;
    }
    try {
        await api.recordDesktopPerformanceSnapshot(snapshot);
        return true;
    }
    catch {
        return false;
    }
}
export async function logDesktopEvent(event) {
    const api = getDesktopApi();
    if (!api?.logDesktopEvent) {
        return false;
    }
    try {
        await api.logDesktopEvent(event);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=desktop-store.js.map