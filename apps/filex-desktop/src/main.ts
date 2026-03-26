import { app, BrowserWindow, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DesktopRuntimeInfo, DesktopThumbnailCacheLookupEntry } from "@photo-tools/desktop-contracts";
import {
  openFolderDesktop,
  readFileFromDisk,
  readSidecarXmpFromAssetPath,
  reopenFolderDesktop,
  writeSidecarXmpForAssetPath,
} from "./native-folder-service.js";
import { getDesktopPreview, getDesktopThumbnail } from "./native-image-service.js";
import {
  chooseThumbnailCacheDirectory,
  clearThumbnailCacheDirectory,
  getCachedThumbnailsFromDisk,
  getThumbnailCacheInfo,
  resetThumbnailCacheDirectory,
  setThumbnailCacheDirectory,
} from "./thumbnail-disk-cache.js";
import { getDesktopToolOrDefault } from "./tool-manifest.js";

const requestedTool = getDesktopToolOrDefault(process.env.FILEX_TOOL);
const shouldUseDevRenderer =
  process.env.FILEX_RENDERER_MODE === "dev" && typeof process.env.FILEX_RENDERER_URL === "string";

function resolveRendererEntry(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, requestedTool.packagedDistDir, "index.html");
  }

  return resolve(app.getAppPath(), requestedTool.workspaceDistDirRelativeToShell, "index.html");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildMissingRendererHtml(entryPath: string): string {
  const buildCommand = `npm --workspace ${requestedTool.workspacePackageName} run build`;

  return `<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8" />
    <title>FileX Desktop</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #181d1a;
        color: #f3efe5;
        font: 16px/1.6 "Segoe UI", sans-serif;
      }
      main {
        width: min(720px, calc(100vw - 48px));
        padding: 32px;
        border-radius: 24px;
        background: rgba(44, 51, 46, 0.92);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
      }
      code {
        display: block;
        margin-top: 16px;
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(0, 0, 0, 0.24);
        color: #f8d58c;
        white-space: pre-wrap;
        word-break: break-word;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 30px;
      }
      p {
        margin: 0 0 12px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Renderer non trovato</h1>
      <p>La shell desktop e' pronta, ma il build del tool <strong>${escapeHtml(requestedTool.displayName)}</strong> non e' presente.</p>
      <p>Esegui questo comando prima di riaprire la shell:</p>
      <code>${escapeHtml(buildCommand)}</code>
      <p>Percorso atteso:</p>
      <code>${escapeHtml(entryPath)}</code>
    </main>
  </body>
</html>`;
}

function registerIpcHandlers(): void {
  ipcMain.handle("filex:get-runtime-info", () => {
    const payload: DesktopRuntimeInfo = {
      shell: "electron",
      platform: process.platform,
      isPackaged: app.isPackaged,
      appVersion: app.getVersion(),
      toolId: requestedTool.id,
      toolName: requestedTool.displayName,
    };

    return payload;
  });
  ipcMain.handle("filex:open-folder", () => openFolderDesktop());
  ipcMain.handle("filex:reopen-folder", (_event, rootPath: string) => reopenFolderDesktop(rootPath));
  ipcMain.handle("filex:read-file", (_event, absolutePath: string) => readFileFromDisk(absolutePath));
  ipcMain.handle(
    "filex:get-thumbnail",
    (_event, absolutePath: string, maxDimension: number, quality: number, sourceFileKey?: string) =>
      getDesktopThumbnail(absolutePath, maxDimension, quality, sourceFileKey),
  );
  ipcMain.handle(
    "filex:get-cached-thumbnails",
    (_event, entries: DesktopThumbnailCacheLookupEntry[], maxDimension: number, quality: number) =>
      getCachedThumbnailsFromDisk(entries, maxDimension, quality),
  );
  ipcMain.handle("filex:get-thumbnail-cache-info", () => getThumbnailCacheInfo());
  ipcMain.handle("filex:choose-thumbnail-cache-directory", () => chooseThumbnailCacheDirectory());
  ipcMain.handle("filex:set-thumbnail-cache-directory", (_event, directoryPath: string) =>
    setThumbnailCacheDirectory(directoryPath),
  );
  ipcMain.handle("filex:reset-thumbnail-cache-directory", () => resetThumbnailCacheDirectory());
  ipcMain.handle("filex:clear-thumbnail-cache", () => clearThumbnailCacheDirectory());
  ipcMain.handle("filex:get-preview", (_event, absolutePath: string) => getDesktopPreview(absolutePath));
  ipcMain.handle("filex:read-sidecar-xmp", (_event, absolutePath: string) =>
    readSidecarXmpFromAssetPath(absolutePath),
  );
  ipcMain.handle("filex:write-sidecar-xmp", (_event, absolutePath: string, xml: string) =>
    writeSidecarXmpForAssetPath(absolutePath, xml),
  );
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  if (shouldUseDevRenderer && process.env.FILEX_RENDERER_URL) {
    await window.loadURL(process.env.FILEX_RENDERER_URL);
    return;
  }

  const entryPath = resolveRendererEntry();
  if (!existsSync(entryPath)) {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildMissingRendererHtml(entryPath))}`);
    return;
  }

  await window.loadFile(entryPath);
}

async function createMainWindow(): Promise<void> {
  const mainWindow = new BrowserWindow({
    title: `FileX Suite - ${requestedTool.displayName}`,
    width: requestedTool.defaultWindowWidth,
    height: requestedTool.defaultWindowHeight,
    minWidth: requestedTool.minWindowWidth,
    minHeight: requestedTool.minWindowHeight,
    autoHideMenuBar: true,
    backgroundColor: "#181d1a",
    webPreferences: {
      preload: join(app.getAppPath(), "dist-electron", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  await loadRenderer(mainWindow);

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
}).catch((error) => {
  console.error("FileX Desktop failed to start", error);
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
