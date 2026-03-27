import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DesktopEditorCandidate, DesktopRuntimeInfo, DesktopThumbnailCacheLookupEntry } from "@photo-tools/desktop-contracts";
import {
  openFolderDesktop,
  readFileFromDisk,
  readSidecarXmpFromAssetPath,
  reopenFolderDesktop,
  writeSidecarXmpForAssetPath,
} from "./native-folder-service.js";
import {
  getDesktopPreview,
  getDesktopThumbnail,
  shutdownDesktopImageService,
  warmDesktopPreview,
} from "./native-image-service.js";
import {
  chooseThumbnailCacheDirectory,
  clearThumbnailCacheDirectory,
  dismissCacheLocationRecommendation,
  getCachedThumbnailsFromDisk,
  getCacheLocationRecommendation,
  getThumbnailCacheInfo,
  migrateThumbnailCacheDirectory,
  resetThumbnailCacheDirectory,
  setThumbnailCacheDirectory,
} from "./thumbnail-disk-cache.js";
import { getDesktopToolOrDefault } from "./tool-manifest.js";

const requestedTool = getDesktopToolOrDefault(process.env.FILEX_TOOL);
const shouldUseDevRenderer =
  process.env.FILEX_RENDERER_MODE === "dev" && typeof process.env.FILEX_RENDERER_URL === "string";
const appUserModelId = `studio.filex.${requestedTool.id}`;

app.setName(requestedTool.productName);
if (process.platform === "win32") {
  app.setAppUserModelId(appUserModelId);
}

function resolveWindowIcon(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "branding", `${requestedTool.id}.png`);
  }

  return resolve(app.getAppPath(), "build", "branding", `${requestedTool.id}.png`);
}

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

function sanitizeDesktopPath(value: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  const withoutQuotes = trimmed.replace(/^"+|"+$/g, "");
  return withoutQuotes.replace(/\//g, "\\");
}

function getInstalledEditorCandidates(): DesktopEditorCandidate[] {
  const roots = [
    "C:\\Program Files\\Adobe",
    "C:\\Program Files (x86)\\Adobe",
  ];
  const candidates: DesktopEditorCandidate[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    if (!existsSync(root)) {
      continue;
    }

    let entries: string[] = [];
    try {
      entries = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^Adobe Photoshop\b/i.test(entry.name))
        .map((entry) => entry.name);
    } catch {
      continue;
    }

    entries
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true, sensitivity: "base" }))
      .forEach((directoryName) => {
        const executablePath = join(root, directoryName, "Photoshop.exe");
        const normalizedPath = sanitizeDesktopPath(executablePath);
        if (!existsSync(normalizedPath) || seen.has(normalizedPath.toLowerCase())) {
          return;
        }

        seen.add(normalizedPath.toLowerCase());
        candidates.push({
          path: normalizedPath,
          label: directoryName.replace(/^Adobe\s+/i, ""),
        });
      });
  }

  return candidates;
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
  ipcMain.on("filex:start-drag-out", (event, absolutePaths: unknown) => {
    const paths = Array.isArray(absolutePaths)
      ? absolutePaths.filter((value): value is string => typeof value === "string" && value.length > 0 && existsSync(value))
      : [];

    if (paths.length === 0) {
      return;
    }

    const iconPath = resolveWindowIcon();
    const dragItem = paths.length > 1
      ? { file: paths[0], files: paths, icon: iconPath }
      : { file: paths[0], icon: iconPath };

    try {
      event.sender.startDrag(dragItem);
    } catch (error) {
      console.error("FileX startDrag failed", error);

      if (paths.length > 1) {
        try {
          event.sender.startDrag({
            file: paths[0],
            icon: iconPath,
          });
          return;
        } catch (fallbackError) {
          console.error("FileX startDrag fallback failed", fallbackError);
        }
      }
    }
  });
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
  ipcMain.handle("filex:get-cache-location-recommendation", () => getCacheLocationRecommendation());
  ipcMain.handle("filex:migrate-thumbnail-cache-directory", (_event, directoryPath: string) =>
    migrateThumbnailCacheDirectory(directoryPath),
  );
  ipcMain.handle("filex:dismiss-cache-location-recommendation", () =>
    dismissCacheLocationRecommendation(),
  );
  ipcMain.handle("filex:choose-editor-executable", async (_event, currentPath?: string) => {
    const normalizedCurrentPath = sanitizeDesktopPath(currentPath ?? "");
    const installedCandidates = getInstalledEditorCandidates();
    const fallbackCandidate = installedCandidates[0]?.path ?? "";
    const defaultPath = existsSync(normalizedCurrentPath) ? normalizedCurrentPath : fallbackCandidate;
    const result = await dialog.showOpenDialog({
      title: "Seleziona editor esterno",
      defaultPath: defaultPath || undefined,
      buttonLabel: "Usa questo editor",
      properties: ["openFile"],
      filters: [
        { name: "Eseguibili Windows", extensions: ["exe", "bat", "cmd"] },
        { name: "Tutti i file", extensions: ["*"] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return sanitizeDesktopPath(result.filePaths[0]);
  });
  ipcMain.handle("filex:get-installed-editor-candidates", () => getInstalledEditorCandidates());
  ipcMain.handle(
    "filex:get-preview",
    (_event, absolutePath: string, options?: { maxDimension?: number; sourceFileKey?: string }) =>
      getDesktopPreview(absolutePath, options?.maxDimension, options?.sourceFileKey),
  );
  ipcMain.handle(
    "filex:warm-preview",
    (_event, absolutePath: string, options?: { maxDimension?: number; sourceFileKey?: string }) =>
      warmDesktopPreview(absolutePath, options?.maxDimension, options?.sourceFileKey),
  );
  ipcMain.handle(
    "filex:open-with-editor",
    async (_event, editorPath: string, absolutePaths: string[]) => {
      const normalizedEditorPath = sanitizeDesktopPath(editorPath);
      const targetPaths = Array.isArray(absolutePaths)
        ? absolutePaths.filter((value): value is string => {
            const normalizedValue = sanitizeDesktopPath(value);
            return normalizedValue.length > 0 && existsSync(normalizedValue);
          }).map((value) => sanitizeDesktopPath(value))
        : [];

      if (!normalizedEditorPath || !existsSync(normalizedEditorPath)) {
        const installedEditors = getInstalledEditorCandidates();
        const installedHint = installedEditors[0]
          ? ` Editor rilevato: ${installedEditors[0].path}`
          : "";
        return { ok: false, error: `Editor non trovato o percorso non valido.${installedHint}` };
      }

      if (targetPaths.length === 0) {
        return { ok: false, error: "Nessun file valido da aprire." };
      }

      try {
        const child = spawn(normalizedEditorPath, targetPaths, {
          detached: true,
          stdio: "ignore",
          windowsHide: false,
        });
        child.unref();
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Impossibile aprire l'editor.",
        };
      }
    },
  );
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
    title: requestedTool.productName,
    width: requestedTool.defaultWindowWidth,
    height: requestedTool.defaultWindowHeight,
    minWidth: requestedTool.minWindowWidth,
    minHeight: requestedTool.minWindowHeight,
    autoHideMenuBar: true,
    backgroundColor: "#181d1a",
    icon: resolveWindowIcon(),
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

  mainWindow.webContents.on("will-prevent-unload", (event) => {
    event.preventDefault();
    mainWindow.destroy();
  });

  await loadRenderer(mainWindow);

  mainWindow.setTitle(requestedTool.productName);

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

app.once("before-quit", () => {
  void shutdownDesktopImageService();
});
