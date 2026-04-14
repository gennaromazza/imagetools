import * as electron from "electron";
import { copyFile, lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import type {
  DesktopCopyFilesResult,
  DesktopFilePayload,
  DesktopFolderEntry,
  DesktopFolderOpenDiagnostics,
  DesktopFolderOpenResult,
  DesktopMoveFilesResult,
  DesktopNativeFileOpStatus,
  DesktopSaveFileAsResult,
} from "@photo-tools/desktop-contracts";

const { app, dialog } = electron;

const STANDARD_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const RAW_EXTENSIONS = new Set([
  ".cr2",
  ".cr3",
  ".crw",
  ".nef",
  ".nrw",
  ".arw",
  ".srf",
  ".sr2",
  ".raf",
  ".dng",
  ".rw2",
  ".orf",
  ".pef",
  ".srw",
  ".3fr",
  ".x3f",
  ".gpr",
]);

function toOwnedUint8Array(buffer: Buffer): Uint8Array {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy;
}

function normalizeSlashes(value: string): string {
  return value.split(sep).join("/");
}

function isImageFile(fileName: string): boolean {
  if (fileName.startsWith("._")) {
    return false;
  }

  const ext = extname(fileName).toLowerCase();
  return STANDARD_EXTENSIONS.has(ext) || RAW_EXTENSIONS.has(ext);
}

function toRelativeAssetPath(rootName: string, rootPath: string, absolutePath: string): string {
  const rel = normalizeSlashes(relative(rootPath, absolutePath));
  return rel.length > 0 ? `${rootName}/${rel}` : rootName;
}

function sidecarPathForAsset(absolutePath: string): string {
  const assetDir = dirname(absolutePath);
  const assetName = basename(absolutePath, extname(absolutePath));
  return join(assetDir, `${assetName}.xmp`);
}

function sanitizeTempFileName(fileName: string): string {
  const normalized = fileName.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
  return normalized || `handoff-${Date.now()}.imagetool`;
}

function resolveCreatedAtMs(birthtimeMs: number, modifiedMs: number): number {
  const normalizedBirthtime = Math.round(birthtimeMs);
  if (Number.isFinite(normalizedBirthtime) && normalizedBirthtime > 0) {
    return normalizedBirthtime;
  }
  const normalizedModified = Math.round(modifiedMs);
  return Number.isFinite(normalizedModified) && normalizedModified > 0
    ? normalizedModified
    : 0;
}

async function countNestedSupportedFiles(rootPath: string): Promise<{
  nestedSupportedDiscardedCount: number;
  nestedDirectoriesSeen: number;
}> {
  let nestedSupportedDiscardedCount = 0;
  let nestedDirectoriesSeen = 0;
  const pendingDirectories: string[] = [];

  const rootEntries = await readdir(rootPath, { withFileTypes: true });
  for (const dirEntry of rootEntries) {
    if (dirEntry.isSymbolicLink() || !dirEntry.isDirectory()) {
      continue;
    }

    nestedDirectoriesSeen += 1;
    pendingDirectories.push(join(rootPath, dirEntry.name));
  }

  while (pendingDirectories.length > 0) {
    const currentPath = pendingDirectories.pop();
    if (!currentPath) {
      continue;
    }

    const dirEntries = await readdir(currentPath, { withFileTypes: true });
    for (const dirEntry of dirEntries) {
      if (dirEntry.isSymbolicLink()) {
        continue;
      }

      const absolutePath = join(currentPath, dirEntry.name);
      if (dirEntry.isDirectory()) {
        nestedDirectoriesSeen += 1;
        pendingDirectories.push(absolutePath);
        continue;
      }

      if (dirEntry.isFile() && isImageFile(dirEntry.name)) {
        nestedSupportedDiscardedCount += 1;
      }
    }
  }

  return {
    nestedSupportedDiscardedCount,
    nestedDirectoriesSeen,
  };
}

async function scanFolderByPath(rootPath: string): Promise<DesktopFolderOpenResult> {
  const stats = await lstat(rootPath);
  if (!stats.isDirectory()) {
    throw new Error("Selected path is not a directory");
  }

  const normalizedRootPath = rootPath.replace(/[\\/]+$/, "");
  const rootName = basename(normalizedRootPath) || normalizedRootPath;
  const entries: DesktopFolderEntry[] = [];

  const dirEntries = await readdir(normalizedRootPath, { withFileTypes: true });
  dirEntries.sort((a, b) => a.name.localeCompare(b.name));

  for (const dirEntry of dirEntries) {
    const absolutePath = join(normalizedRootPath, dirEntry.name);
    if (dirEntry.isSymbolicLink() || !dirEntry.isFile() || !isImageFile(dirEntry.name)) {
      continue;
    }

    const fileStats = await lstat(absolutePath);
    entries.push({
      name: dirEntry.name,
      relativePath: toRelativeAssetPath(rootName, normalizedRootPath, absolutePath),
      absolutePath,
      size: fileStats.size,
      lastModified: Math.round(fileStats.mtimeMs),
      createdAt: resolveCreatedAtMs(fileStats.birthtimeMs, fileStats.mtimeMs),
    });
  }

  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const nestedCounts = await countNestedSupportedFiles(normalizedRootPath);
  const diagnostics: DesktopFolderOpenDiagnostics = {
    source: "desktop-native",
    selectedPath: normalizedRootPath,
    topLevelSupportedCount: entries.length,
    nestedSupportedDiscardedCount: nestedCounts.nestedSupportedDiscardedCount,
    totalSupportedSeen: entries.length + nestedCounts.nestedSupportedDiscardedCount,
    nestedDirectoriesSeen: nestedCounts.nestedDirectoriesSeen,
  };

  return {
    name: rootName,
    rootPath: normalizedRootPath,
    entries,
    diagnostics,
  };
}

export async function openFolderDesktop(): Promise<DesktopFolderOpenResult | null> {
  const result = await dialog.showOpenDialog({
    title: "Apri una cartella fotografica",
    properties: ["openDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return scanFolderByPath(result.filePaths[0]);
}

export async function reopenFolderDesktop(rootPath: string): Promise<DesktopFolderOpenResult | null> {
  try {
    return await scanFolderByPath(rootPath);
  } catch {
    return null;
  }
}

export async function readFileFromDisk(absolutePath: string): Promise<DesktopFilePayload | null> {
  try {
    const [buffer, stats] = await Promise.all([
      readFile(absolutePath),
      lstat(absolutePath),
    ]);

    return {
      name: basename(absolutePath),
      absolutePath,
      bytes: toOwnedUint8Array(buffer),
      size: stats.size,
      lastModified: Math.round(stats.mtimeMs),
    };
  } catch {
    return null;
  }
}

export async function createAutoLayoutHandoffFileDesktop(
  fileName: string,
  content: string,
): Promise<string | null> {
  const normalizedName = sanitizeTempFileName(fileName.endsWith(".imagetool") ? fileName : `${fileName}.imagetool`);
  const handoffDir = join(app.getPath("temp"), "filex-handoffs");
  const absolutePath = join(handoffDir, `${Date.now()}-${normalizedName}`);

  try {
    await mkdir(handoffDir, { recursive: true });
    await writeFile(absolutePath, content, "utf8");
    return absolutePath;
  } catch {
    return null;
  }
}

export async function readSidecarXmpFromAssetPath(absolutePath: string): Promise<string | null> {
  try {
    return await readFile(sidecarPathForAsset(absolutePath), "utf8");
  } catch {
    return null;
  }
}

export async function writeSidecarXmpForAssetPath(
  absolutePath: string,
  xml: string,
): Promise<boolean> {
  try {
    await writeFile(sidecarPathForAsset(absolutePath), xml, "utf8");
    return true;
  } catch {
    return false;
  }
}

async function resolveExistingFiles(paths: string[]): Promise<string[]> {
  const existing = new Set<string>();
  for (const rawPath of paths) {
    if (typeof rawPath !== "string") {
      continue;
    }

    const absolutePath = rawPath.trim();
    if (!absolutePath || existing.has(absolutePath)) {
      continue;
    }

    try {
      const stats = await lstat(absolutePath);
      if (stats.isFile()) {
        existing.add(absolutePath);
      }
    } catch {
      // Ignore non-existing paths.
    }
  }

  return Array.from(existing);
}

function resolveFileOpStatus(
  completedCount: number,
  requestedCount: number,
  hasError: boolean,
): DesktopNativeFileOpStatus {
  if (requestedCount === 0) {
    return "no-file";
  }

  if (completedCount === 0) {
    return hasError ? "error" : "no-file";
  }

  return hasError || completedCount < requestedCount ? "partial" : "ok";
}

export async function copyFilesToFolderDesktop(absolutePaths: string[]): Promise<DesktopCopyFilesResult> {
  const requestedCount = Array.isArray(absolutePaths) ? absolutePaths.length : 0;
  const sourcePaths = await resolveExistingFiles(Array.isArray(absolutePaths) ? absolutePaths : []);
  if (sourcePaths.length === 0) {
    return {
      status: "no-file",
      requestedCount,
      copiedCount: 0,
      copiedPaths: [],
      destinationDirectory: null,
    };
  }

  const selection = await dialog.showOpenDialog({
    title: "Seleziona cartella di destinazione",
    properties: ["openDirectory", "createDirectory"],
  });
  if (selection.canceled || selection.filePaths.length === 0) {
    return {
      status: "cancelled",
      requestedCount,
      copiedCount: 0,
      copiedPaths: [],
      destinationDirectory: null,
    };
  }

  const destinationDirectory = selection.filePaths[0];
  const copiedPaths: string[] = [];
  let hasError = sourcePaths.length !== requestedCount;

  for (const sourcePath of sourcePaths) {
    try {
      await copyFile(sourcePath, join(destinationDirectory, basename(sourcePath)));
      copiedPaths.push(sourcePath);
    } catch {
      hasError = true;
    }
  }

  return {
    status: resolveFileOpStatus(copiedPaths.length, requestedCount, hasError),
    requestedCount,
    copiedCount: copiedPaths.length,
    copiedPaths,
    destinationDirectory,
  };
}

async function moveFileToDestination(sourcePath: string, destinationPath: string): Promise<void> {
  try {
    await rename(sourcePath, destinationPath);
    return;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || (error as NodeJS.ErrnoException).code !== "EXDEV") {
      throw error;
    }
  }

  await copyFile(sourcePath, destinationPath);
  await unlink(sourcePath);
}

export async function moveFilesToFolderDesktop(absolutePaths: string[]): Promise<DesktopMoveFilesResult> {
  const requestedCount = Array.isArray(absolutePaths) ? absolutePaths.length : 0;
  const sourcePaths = await resolveExistingFiles(Array.isArray(absolutePaths) ? absolutePaths : []);
  if (sourcePaths.length === 0) {
    return {
      status: "no-file",
      requestedCount,
      movedCount: 0,
      movedPaths: [],
      destinationDirectory: null,
    };
  }

  const selection = await dialog.showOpenDialog({
    title: "Seleziona cartella di destinazione",
    properties: ["openDirectory", "createDirectory"],
  });
  if (selection.canceled || selection.filePaths.length === 0) {
    return {
      status: "cancelled",
      requestedCount,
      movedCount: 0,
      movedPaths: [],
      destinationDirectory: null,
    };
  }

  const destinationDirectory = selection.filePaths[0];
  const movedPaths: string[] = [];
  let hasError = sourcePaths.length !== requestedCount;

  for (const sourcePath of sourcePaths) {
    try {
      await moveFileToDestination(sourcePath, join(destinationDirectory, basename(sourcePath)));
      movedPaths.push(sourcePath);
    } catch {
      hasError = true;
    }
  }

  return {
    status: resolveFileOpStatus(movedPaths.length, requestedCount, hasError),
    requestedCount,
    movedCount: movedPaths.length,
    movedPaths,
    destinationDirectory,
  };
}

export async function saveFileAsDesktop(absolutePath: string): Promise<DesktopSaveFileAsResult> {
  const [sourcePath] = await resolveExistingFiles([absolutePath]);
  if (!sourcePath) {
    return {
      status: "no-file",
      sourcePath: absolutePath,
      destinationPath: null,
    };
  }

  const selection = await dialog.showSaveDialog({
    title: "Salva copia come",
    defaultPath: basename(sourcePath),
  });
  if (selection.canceled || !selection.filePath) {
    return {
      status: "cancelled",
      sourcePath,
      destinationPath: null,
    };
  }

  try {
    await copyFile(sourcePath, selection.filePath);
    return {
      status: "ok",
      sourcePath,
      destinationPath: selection.filePath,
    };
  } catch {
    return {
      status: "error",
      sourcePath,
      destinationPath: selection.filePath,
    };
  }
}
