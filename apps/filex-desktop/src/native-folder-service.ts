import { dialog } from "electron";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import type {
  DesktopFilePayload,
  DesktopFolderEntry,
  DesktopFolderOpenDiagnostics,
  DesktopFolderOpenResult,
} from "@photo-tools/desktop-contracts";

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
