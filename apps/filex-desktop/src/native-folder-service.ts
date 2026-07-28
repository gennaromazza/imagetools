import * as electron from "electron";
import { copyFile, lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import type {
  DesktopCopyFilesResult,
  DesktopFileStat,
  DesktopFilePayload,
  DesktopFolderEntry,
  DesktopFolderOpenDiagnostics,
  DesktopFolderOpenOptions,
  DesktopFolderOpenResult,
  DesktopMoveFilesResult,
  DesktopNativeFileOpStatus,
  DesktopPhotoSelectorProjectFile,
  DesktopSaveFileAsResult,
} from "@photo-tools/desktop-contracts";

const { app, dialog } = electron;

const FOLDER_SCAN_STAT_CONCURRENCY = 32;
const STANDARD_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const PHOTO_SELECTOR_PROJECT_FILE_NAME = ".image-select-pro.json";
let projectFileWriteQueue: Promise<void> = Promise.resolve();
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

function projectFilePathForFolder(rootPath: string): string {
  return join(rootPath, PHOTO_SELECTOR_PROJECT_FILE_NAME);
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

function nowMs(): number {
  return Date.now();
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => run()),
  );

  return results;
}

async function scanFolderByPath(
  rootPath: string,
  options: DesktopFolderOpenOptions = {},
): Promise<DesktopFolderOpenResult> {
  const stats = await lstat(rootPath);
  if (!stats.isDirectory()) {
    throw new Error("Selected path is not a directory");
  }

  const recursiveScanEnabled = options.recursive !== false;
  const normalizedRootPath = rootPath.replace(/[\\/]+$/, "");
  const rootName = basename(normalizedRootPath) || normalizedRootPath;

  const scanStartedAt = nowMs();
  const candidates: string[] = [];
  let nestedDirectoriesSeen = 0;
  let scannedDirectoryCount = 0;
  let topLevelSupportedCount = 0;

  async function collectImagePaths(directoryPath: string, depth: number): Promise<void> {
    scannedDirectoryCount += 1;
    const dirEntries = await readdir(directoryPath, { withFileTypes: true });
    dirEntries.sort((a, b) => a.name.localeCompare(b.name));

    for (const dirEntry of dirEntries) {
      if (dirEntry.isSymbolicLink()) {
        continue;
      }

      const absolutePath = join(directoryPath, dirEntry.name);
      if (dirEntry.isDirectory()) {
        if (depth === 0) {
          nestedDirectoriesSeen += 1;
        }
        if (recursiveScanEnabled) {
          await collectImagePaths(absolutePath, depth + 1);
        }
        continue;
      }

      if (!dirEntry.isFile() || !isImageFile(dirEntry.name)) {
        continue;
      }

      if (depth === 0) {
        topLevelSupportedCount += 1;
      }
      candidates.push(absolutePath);
    }
  }

  await collectImagePaths(normalizedRootPath, 0);
  const scanMs = Math.max(0, nowMs() - scanStartedAt);

  const statStartedAt = nowMs();
  const maybeEntries = await mapWithConcurrency(candidates, FOLDER_SCAN_STAT_CONCURRENCY, async (absolutePath) => {
    try {
      const fileStats = await lstat(absolutePath);
      return {
        name: basename(absolutePath),
        relativePath: toRelativeAssetPath(rootName, normalizedRootPath, absolutePath),
        absolutePath,
        size: fileStats.size,
        lastModified: Math.round(fileStats.mtimeMs),
        createdAt: resolveCreatedAtMs(fileStats.birthtimeMs, fileStats.mtimeMs),
      } satisfies DesktopFolderEntry;
    } catch {
      return null;
    }
  });
  const statMs = Math.max(0, nowMs() - statStartedAt);

  const entries = maybeEntries
    .filter((entry): entry is DesktopFolderEntry => Boolean(entry))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, undefined, {
      numeric: true,
      sensitivity: "base",
    }));

  const diagnostics: DesktopFolderOpenDiagnostics = {
    source: "desktop-native",
    selectedPath: normalizedRootPath,
    topLevelSupportedCount,
    nestedSupportedDiscardedCount: Math.max(0, entries.length - topLevelSupportedCount),
    totalSupportedSeen: entries.length,
    nestedDirectoriesSeen,
    scanMs,
    statMs,
    nestedScanSkipped: !recursiveScanEnabled && nestedDirectoriesSeen > 0,
    recursiveScanEnabled,
    scannedDirectoryCount,
  };

  return {
    name: rootName,
    rootPath: normalizedRootPath,
    entries,
    diagnostics,
  };
}

export async function openFolderDesktop(
  options: DesktopFolderOpenOptions = {},
): Promise<DesktopFolderOpenResult | null> {
  const result = await dialog.showOpenDialog({
    title: "Apri una cartella fotografica",
    properties: ["openDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return scanFolderByPath(result.filePaths[0], options);
}

export async function reopenFolderDesktop(
  rootPath: string,
  options: DesktopFolderOpenOptions = {},
): Promise<DesktopFolderOpenResult | null> {
  try {
    return await scanFolderByPath(rootPath, options);
  } catch {
    return null;
  }
}

export async function readPhotoSelectorProjectFileDesktop(
  rootPath: string,
): Promise<DesktopPhotoSelectorProjectFile | null> {
  try {
    const stats = await lstat(rootPath);
    if (!stats.isDirectory()) {
      return null;
    }

    const content = await readFile(projectFilePathForFolder(rootPath), "utf8");
    const parsed = JSON.parse(content) as Partial<DesktopPhotoSelectorProjectFile>;
    if (parsed.schemaVersion !== 1 || parsed.app !== "image-select-pro") {
      return null;
    }

    return parsed as DesktopPhotoSelectorProjectFile;
  } catch {
    return null;
  }
}

export async function writePhotoSelectorProjectFileDesktop(
  rootPath: string,
  project: DesktopPhotoSelectorProjectFile,
): Promise<boolean> {
  const writeTask = projectFileWriteQueue.then(async () => {
    const stats = await lstat(rootPath);
    if (!stats.isDirectory()) {
      throw new Error("Project root is not a directory");
    }

    const filePath = projectFilePathForFolder(rootPath);
    const tempPath = join(rootPath, `${PHOTO_SELECTOR_PROJECT_FILE_NAME}.tmp`);
    const payload: DesktopPhotoSelectorProjectFile = {
      ...project,
      schemaVersion: 1,
      app: "image-select-pro",
      updatedAt: Date.now(),
    };
    await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await rename(tempPath, filePath);
  });

  // Keep later writes serialized even when an earlier write fails.
  projectFileWriteQueue = writeTask.catch(() => undefined);
  return writeTask.then(() => true).catch(() => false);
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

export async function statFilesFromDisk(absolutePaths: string[]): Promise<DesktopFileStat[]> {
  const uniquePaths = Array.from(new Set(absolutePaths.filter((path) => typeof path === "string" && path.length > 0)));
  const stats = await Promise.all(
    uniquePaths.map(async (absolutePath) => {
      try {
        const stat = await lstat(absolutePath);
        if (!stat.isFile()) {
          return null;
        }

        return {
          name: basename(absolutePath),
          absolutePath,
          size: stat.size,
          lastModified: Math.round(stat.mtimeMs),
        } satisfies DesktopFileStat;
      } catch {
        return null;
      }
    }),
  );

  return stats.filter((stat): stat is DesktopFileStat => stat !== null);
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
