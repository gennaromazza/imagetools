import React from "react";
import ReactDOM from "react-dom/client";
import type { FileXDesktopApi } from "@photo-tools/desktop-contracts";
import { App } from "./App";
import { ToastProvider } from "./components/ToastProvider";
import "./styles.css";

const REQUIRED_DESKTOP_METHODS: Array<keyof FileXDesktopApi> = [
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

function getDesktopApiGuard(): { ok: true } | { ok: false; missingMethods: string[] } {
  if (typeof window === "undefined" || typeof window.filexDesktop === "undefined") {
    return { ok: false, missingMethods: REQUIRED_DESKTOP_METHODS.map((name) => String(name)) };
  }

  const desktopApi = window.filexDesktop as Partial<FileXDesktopApi>;
  const missingMethods = REQUIRED_DESKTOP_METHODS.filter((name) => typeof desktopApi[name] !== "function")
    .map((name) => String(name));

  if (missingMethods.length > 0) {
    return { ok: false, missingMethods };
  }

  return { ok: true };
}

function DesktopOnlyBlockedScreen({ missingMethods }: { missingMethods: string[] }) {
  const isBridgeMissing = missingMethods.length === REQUIRED_DESKTOP_METHODS.length;

  return (
    <div className="photo-selector-app" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "2rem" }}>
      <div className="modal-panel" style={{ maxWidth: 760, width: "100%" }}>
        <div className="modal-panel__header">
          <div>
            <h2>Aggiorna FileX Desktop</h2>
            <p>Image Select Pro e' disponibile solo nella shell desktop FileX.</p>
          </div>
        </div>
        <div className="modal-panel__body" style={{ display: "grid", gap: "0.8rem" }}>
          <p>
            {isBridgeMissing
              ? "Bridge desktop non rilevato. Avvia il tool con `npm run dev:filex-desktop:photo-selector` o dalla build FileX Desktop."
              : "Shell desktop rilevata ma non compatibile con questa versione del renderer. Aggiorna FileX Desktop e riavvia il tool."}
          </p>
          {!isBridgeMissing ? (
            <details>
              <summary>API mancanti</summary>
              <pre style={{ whiteSpace: "pre-wrap", marginTop: "0.8rem" }}>{missingMethods.join("\n")}</pre>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const desktopGuard = getDesktopApiGuard();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      {desktopGuard.ok ? <App /> : <DesktopOnlyBlockedScreen missingMethods={desktopGuard.missingMethods} />}
    </ToastProvider>
  </React.StrictMode>,
);
