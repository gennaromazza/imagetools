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
//# sourceMappingURL=desktop-runtime.js.map