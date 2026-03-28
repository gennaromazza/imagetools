export async function getDesktopRuntimeInfo() {
    if (typeof window === "undefined" || typeof window.filexDesktop === "undefined") {
        return null;
    }
    try {
        return await window.filexDesktop.getRuntimeInfo();
    }
    catch {
        return null;
    }
}
export async function consumePendingDesktopOpenFolderPath() {
    if (typeof window === "undefined" || typeof window.filexDesktop === "undefined") {
        return null;
    }
    try {
        return await window.filexDesktop.consumePendingOpenFolderPath();
    }
    catch {
        return null;
    }
}
export async function markDesktopOpenFolderRequestReady() {
    if (typeof window === "undefined" || typeof window.filexDesktop === "undefined") {
        return;
    }
    try {
        await window.filexDesktop.markOpenFolderRequestReady();
    }
    catch {
        // Ignore desktop bridge errors
    }
}
export function subscribeDesktopOpenFolderRequest(listener) {
    if (typeof window === "undefined" || typeof window.filexDesktop === "undefined") {
        return null;
    }
    try {
        return window.filexDesktop.onOpenFolderRequest(listener);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=desktop-runtime.js.map