import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ToastProvider } from "./components/ToastProvider";
import "./styles.css";
const REQUIRED_DESKTOP_METHODS = [
    "getRuntimeInfo",
    "openFolder",
    "reopenFolder",
    "consumePendingOpenFolderPath",
    "markOpenFolderRequestReady",
    "onOpenFolderRequest",
    "readFile",
    "getThumbnail",
    "getCachedThumbnails",
    "getThumbnailCacheInfo",
    "chooseThumbnailCacheDirectory",
    "setThumbnailCacheDirectory",
    "resetThumbnailCacheDirectory",
    "clearThumbnailCache",
    "getCacheLocationRecommendation",
    "migrateThumbnailCacheDirectory",
    "dismissCacheLocationRecommendation",
    "getPreview",
    "warmPreview",
    "getQuickPreviewFrame",
    "warmQuickPreviewFrames",
    "releaseQuickPreviewFrames",
    "chooseEditorExecutable",
    "getInstalledEditorCandidates",
    "sendToEditor",
    "openWithEditor",
    "canStartDragOut",
    "startDragOut",
    "copyFilesToFolder",
    "moveFilesToFolder",
    "saveFileAs",
    "getDesktopPreferences",
    "saveDesktopPreferences",
    "getDesktopSessionState",
    "saveDesktopSessionState",
    "getRecentFolders",
    "saveRecentFolder",
    "removeRecentFolder",
    "getSortCache",
    "saveSortCache",
    "getFolderCatalogState",
    "saveFolderCatalogState",
    "saveFolderAssetStates",
    "getDesktopPerformanceSnapshot",
    "recordDesktopPerformanceSnapshot",
    "logDesktopEvent",
    "readSidecarXmp",
    "writeSidecarXmp",
];
function getDesktopApiGuard() {
    if (typeof window === "undefined" || typeof window.filexDesktop === "undefined") {
        return { ok: false, missingMethods: REQUIRED_DESKTOP_METHODS.map((name) => String(name)) };
    }
    const desktopApi = window.filexDesktop;
    const missingMethods = REQUIRED_DESKTOP_METHODS.filter((name) => typeof desktopApi[name] !== "function")
        .map((name) => String(name));
    if (missingMethods.length > 0) {
        return { ok: false, missingMethods };
    }
    return { ok: true };
}
function DesktopOnlyBlockedScreen({ missingMethods }) {
    const isBridgeMissing = missingMethods.length === REQUIRED_DESKTOP_METHODS.length;
    return (_jsx("div", { className: "photo-selector-app", style: { minHeight: "100vh", display: "grid", placeItems: "center", padding: "2rem" }, children: _jsxs("div", { className: "modal-panel", style: { maxWidth: 760, width: "100%" }, children: [_jsx("div", { className: "modal-panel__header", children: _jsxs("div", { children: [_jsx("h2", { children: "Aggiorna FileX Desktop" }), _jsx("p", { children: "Photo Selector e' disponibile solo nella shell desktop FileX." })] }) }), _jsxs("div", { className: "modal-panel__body", style: { display: "grid", gap: "0.8rem" }, children: [_jsx("p", { children: isBridgeMissing
                                ? "Bridge desktop non rilevato. Avvia il tool con `npm run dev:filex-desktop:photo-selector` o dalla build FileX Desktop."
                                : "Shell desktop rilevata ma non compatibile con questa versione del renderer. Aggiorna FileX Desktop e riavvia il tool." }), !isBridgeMissing ? (_jsxs("details", { children: [_jsx("summary", { children: "API mancanti" }), _jsx("pre", { style: { whiteSpace: "pre-wrap", marginTop: "0.8rem" }, children: missingMethods.join("\n") })] })) : null] })] }) }));
}
const desktopGuard = getDesktopApiGuard();
ReactDOM.createRoot(document.getElementById("root")).render(_jsx(React.StrictMode, { children: _jsx(ToastProvider, { children: desktopGuard.ok ? _jsx(App, {}) : _jsx(DesktopOnlyBlockedScreen, { missingMethods: desktopGuard.missingMethods }) }) }));
//# sourceMappingURL=main.js.map