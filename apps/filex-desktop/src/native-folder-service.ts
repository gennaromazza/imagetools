import * as electron from "electron";
import { copyFile, lstat, readFile, readdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
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
  DesktopPhotoSelectorProjectLocation,
  DesktopPhotoSelectorProjectRelocationResult,
  DesktopSaveFileAsResult,
  DesktopSidecarXmpInfo,
} from "@photo-tools/desktop-contracts";
import { createDesktopSourceIdentity, probeDesktopSourceVolume } from "./source-identity.js";

const { dialog } = electron;

const FOLDER_SCAN_STAT_CONCURRENCY = 32;
const STANDARD_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const PSD_EXTENSIONS = new Set([".psd"]);
const EXTENDED_IMAGE_EXTENSIONS = new Set([".heic", ".heif", ".tif", ".tiff"]);
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

export function isNativeFolderImageFile(fileName: string, includeExtendedImages = false): boolean {
  if (fileName.startsWith("._")) {
    return false;
  }

  const extension = extname(fileName).toLowerCase();
  return STANDARD_EXTENSIONS.has(extension)
    || PSD_EXTENSIONS.has(extension)
    || RAW_EXTENSIONS.has(extension)
    || (includeExtendedImages && EXTENDED_IMAGE_EXTENSIONS.has(extension));
}

function toRelativeAssetPath(
  rootName: string,
  rootPath: string,
  absolutePath: string,
  mode: DesktopFolderOpenOptions["relativePathMode"] = "legacy",
): string {
  const rel = normalizeSlashes(relative(rootPath, absolutePath));
  if (mode === "project-relative") {
    return rel;
  }
  return rel.length > 0 ? `${rootName}/${rel}` : rootName;
}

function sidecarPathForAsset(absolutePath: string): string {
  const assetDir = dirname(absolutePath);
  const assetName = basename(absolutePath, extname(absolutePath));
  return join(assetDir, `${assetName}.xmp`);
}

const PHOTO_RENAME_FORBIDDEN = /[<>:"/\\|?*\x00-\x1f]/;

export interface PhotoFileRenameItem {
  fromAbsolutePath: string;
  toFileName: string;
}

export interface PhotoFileRenameResult {
  fromAbsolutePath: string;
  toAbsolutePath: string;
  ok: boolean;
  error?: string;
}

function failRename(
  fromAbsolutePath: string,
  toAbsolutePath: string,
  error: string,
): PhotoFileRenameResult {
  return { fromAbsolutePath, toAbsolutePath, ok: false, error };
}

/**
 * Rinomina file fotografici dentro la radice indicata (sottocartelle incluse),
 * con sidecar XMP al seguito. Il nuovo nome resta nella stessa cartella
 * del file: mai spostamenti né sovrascritture.
 * Due fasi via nomi temporanei (gestisce scambi, cicli e cambi solo-maiuscole);
 * ogni file è isolato: l'errore su uno non blocca gli altri.
 */
export async function renamePhotoFilesDesktop(
  rootPath: string,
  items: PhotoFileRenameItem[],
): Promise<PhotoFileRenameResult[]> {
  const normalizedRoot = rootPath.replace(/[\\/]+$/, "");
  try {
    if (!(await lstat(normalizedRoot)).isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const valid = new Map<string, string>();
  for (const item of items ?? []) {
    const from = typeof item?.fromAbsolutePath === "string" ? item.fromAbsolutePath : "";
    const toFileName = typeof item?.toFileName === "string" ? item.toFileName.trim() : "";
    if (!from || !toFileName || toFileName === "." || toFileName === "..") {
      continue;
    }
    if (toFileName !== basename(toFileName) || PHOTO_RENAME_FORBIDDEN.test(toFileName)) {
      continue;
    }
    try {
      if (!(await lstat(from)).isFile()) {
        continue;
      }
    } catch {
      continue;
    }
    const normalizedFromDir = dirname(from).replace(/[\\/]+$/, "");
    const insideRoot = process.platform === "win32"
      ? normalizedFromDir.toLocaleLowerCase() === normalizedRoot.toLocaleLowerCase()
        || normalizedFromDir.toLocaleLowerCase().startsWith(`${normalizedRoot.toLocaleLowerCase()}\\`)
      : normalizedFromDir === normalizedRoot
        || normalizedFromDir.startsWith(`${normalizedRoot}/`);
    if (!insideRoot) {
      continue;
    }    if (!valid.has(from)) {
      valid.set(from, toFileName);
    }
  }

  const staged: Array<{ from: string; temp: string; to: string }> = [];
  let counter = 0;
  for (const [from, toFileName] of valid) {
    const fromDir = dirname(from).replace(/[\\/]+$/, "");
    const to = join(fromDir, toFileName);
    if (from === to) {
      continue;
    }
    if (from.toLocaleLowerCase() !== to.toLocaleLowerCase()) {
      try {
        await lstat(to);
        continue;
      } catch {
        // destinazione libera: ok
      }
    }
    counter += 1;
    staged.push({ from, temp: join(normalizedRoot, `.filex-rename-${Date.now()}-${counter}.tmp`), to });
  }

  async function moveWithSidecar(source: string, destination: string): Promise<void> {
    await rename(source, destination);
    const sourceSidecar = sidecarPathForAsset(source);
    const destinationSidecar = sidecarPathForAsset(destination);
    try {
      await lstat(sourceSidecar);
    } catch {
      return;
    }
    await rename(sourceSidecar, destinationSidecar);
  }

  const completed: Array<{ from: string; temp: string; to: string }> = [];
  const failed = new Map<string, string>();
  for (const step of staged) {
    try {
      await moveWithSidecar(step.from, step.temp);
      completed.push(step);
    } catch (error) {
      failed.set(step.from, error instanceof Error ? error.message : "Spostamento temporaneo non riuscito.");
      await moveWithSidecar(step.temp, step.from).catch(() => undefined);
    }
  }
  const succeeded: Array<{ from: string; to: string }> = [];
  for (const step of completed) {
    try {
      await moveWithSidecar(step.temp, step.to);
      succeeded.push({ from: step.from, to: step.to });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Rinomina non riuscita.";
      failed.set(step.from, message);
      await moveWithSidecar(step.temp, step.from).catch(() => undefined);
    }
  }

  const succeededSet = new Set(succeeded.map((step) => step.from));
  return [...valid.keys()].map((from) => {
    const target = staged.find((step) => step.from === from)?.to ?? from;
    if (succeededSet.has(from)) {
      return { fromAbsolutePath: from, toAbsolutePath: target, ok: true };
    }
    if (!staged.some((step) => step.from === from)) {
      return failRename(from, from, "Nome non valido, già esistente o fuori cartella.");
    }
    return failRename(from, target, failed.get(from) ?? "Rinomina non riuscita.");
  });
}

function projectFilePathForFolder(rootPath: string): string {
  return join(rootPath, PHOTO_SELECTOR_PROJECT_FILE_NAME);
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
  const normalizedRootPath = resolve(rootPath);
  const sourceProbePromise = probeDesktopSourceVolume(normalizedRootPath);
  const rootName = basename(normalizedRootPath) || normalizedRootPath;

  const scanStartedAt = nowMs();
  const candidates: string[] = [];
  let nestedDirectoriesSeen = 0;
  let scannedDirectoryCount = 0;
  let unreadableDirectoryCount = 0;
  let topLevelSupportedCount = 0;

  async function collectImagePaths(directoryPath: string, depth: number): Promise<void> {
    scannedDirectoryCount += 1;
    let dirEntries;
    try {
      dirEntries = await readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      if (depth === 0) {
        throw error;
      }
      unreadableDirectoryCount += 1;
      return;
    }
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

      if (!dirEntry.isFile() || !isNativeFolderImageFile(dirEntry.name, options.includeExtendedImages === true)) {
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
        relativePath: toRelativeAssetPath(
          rootName,
          normalizedRootPath,
          absolutePath,
          options.relativePathMode,
        ),
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
    unreadableDirectoryCount,
  };
  const sourceIdentity = await createDesktopSourceIdentity(
    normalizedRootPath,
    entries,
    await sourceProbePromise,
  );

  return {
    name: rootName,
    rootPath: normalizedRootPath,
    entries,
    sourceIdentity,
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

async function readProjectAtPath(rootPath: string): Promise<DesktopPhotoSelectorProjectFile | null> {
  try {
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

export async function resolvePhotoSelectorProjectDesktop(
  folderPath: string,
): Promise<DesktopPhotoSelectorProjectLocation | null> {
  let currentPath = folderPath.replace(/[\\/]+$/, "");
  try {
    const stats = await lstat(currentPath);
    if (!stats.isDirectory()) {
      currentPath = dirname(currentPath);
    }
  } catch {
    return null;
  }

  while (currentPath) {
    const project = await readProjectAtPath(currentPath);
    if (project?.projectMode === "master") {
      return { rootPath: currentPath, project };
    }
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }
    currentPath = parentPath;
  }
  return null;
}

export async function listPhotoSelectorLegacyProjectsDesktop(
  rootPath: string,
): Promise<DesktopPhotoSelectorProjectLocation[]> {
  const normalizedRootPath = rootPath.replace(/[\\/]+$/, "");
  const results: DesktopPhotoSelectorProjectLocation[] = [];

  async function visit(directoryPath: string): Promise<void> {
    const project = await readProjectAtPath(directoryPath);
    if (project) {
      results.push({ rootPath: directoryPath, project });
    }

    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }
      await visit(join(directoryPath, entry.name));
    }
  }

  await visit(normalizedRootPath);
  return results;
}

const NESTED_PROJECT_SCAN_SKIP_DIRS = new Set([
  "$recycle.bin",
  "system volume information",
  "windows",
  "program files",
  "program files (x86)",
  "programdata",
]);

export interface NestedPhotoSelectorProjectScanOptions {
  maxDepth?: number;
  maxDirectories?: number;
}

/**
 * Cerca progetti master nei discendenti di una cartella, con limiti rigidi.
 * Serve al flusso tasto-destro: distingue 0 / 1 / 2+ candidati e si ferma
 * appena ne trova 2, senza scandire interi dischi.
 */
export async function findNestedPhotoSelectorProjectsDesktop(
  rootPath: string,
  options: NestedPhotoSelectorProjectScanOptions = {},
): Promise<DesktopPhotoSelectorProjectLocation[]> {
  const maxDepth = Math.max(1, Math.min(6, Math.trunc(options.maxDepth ?? 3)));
  const maxDirectories = Math.max(16, Math.min(2000, Math.trunc(options.maxDirectories ?? 300)));
  const normalizedRoot = rootPath.replace(/[\\/]+$/, "");
  const results: DesktopPhotoSelectorProjectLocation[] = [];
  let visitedDirectories = 0;
  let stopped = false;

  async function visit(directoryPath: string, depth: number): Promise<void> {
    if (stopped || visitedDirectories >= maxDirectories || results.length >= 2) {
      stopped = true;
      return;
    }
    visitedDirectories += 1;
    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (stopped || results.length >= 2 || visitedDirectories >= maxDirectories) {
        stopped = true;
        return;
      }
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }
      if (entry.name.startsWith(".")) {
        continue;
      }
      if (NESTED_PROJECT_SCAN_SKIP_DIRS.has(entry.name.toLocaleLowerCase())) {
        continue;
      }
      if (depth + 1 > maxDepth) {
        continue;
      }
      const childPath = join(directoryPath, entry.name);
      const project = await readProjectAtPath(childPath);
      if (project) {
        results.push({ rootPath: childPath, project });
      }
      if (results.length < 2) {
        await visit(childPath, depth + 1);
      }
    }
  }

  try {
    const stats = await lstat(normalizedRoot);
    if (!stats.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }
  await visit(normalizedRoot, 0);
  return results;
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
    const existingProject = await readProjectAtPath(rootPath);
    if (project.projectMode === "master" && existingProject && existingProject.projectMode !== "master") {
      const legacyBackupPath = join(rootPath, `.image-select-pro.legacy-${Date.now()}.json`);
      await copyFile(filePath, legacyBackupPath);
    }
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

export async function relocatePhotoSelectorProjectFileDesktop(
  sourceRootPath: string,
  targetRootPath: string,
  project: DesktopPhotoSelectorProjectFile,
): Promise<DesktopPhotoSelectorProjectRelocationResult> {
  const relocationTask = projectFileWriteQueue.then(async (): Promise<DesktopPhotoSelectorProjectRelocationResult> => {
    const [sourceStats, targetStats] = await Promise.all([
      lstat(sourceRootPath),
      lstat(targetRootPath),
    ]);
    if (!sourceStats.isDirectory() || sourceStats.isSymbolicLink()) {
      throw new Error("La cartella master attuale non è una directory locale valida.");
    }
    if (!targetStats.isDirectory() || targetStats.isSymbolicLink()) {
      throw new Error("La nuova cartella master non è una directory locale valida.");
    }

    const [resolvedSourceRoot, resolvedTargetRoot] = await Promise.all([
      realpath(sourceRootPath),
      realpath(targetRootPath),
    ]);
    const targetRelativeToSource = relative(resolvedSourceRoot, resolvedTargetRoot);
    if (
      !targetRelativeToSource
      || targetRelativeToSource === ".."
      || targetRelativeToSource.startsWith(`..${sep}`)
    ) {
      throw new Error("La correzione richiede una sottocartella del master attuale.");
    }
    if (project.projectMode !== "master") {
      throw new Error("Il nuovo file non è un progetto master valido.");
    }

    const sourceProject = await readProjectAtPath(resolvedSourceRoot);
    if (sourceProject?.projectMode !== "master") {
      throw new Error("Il progetto master di origine non è più disponibile.");
    }
    const targetProject = await readProjectAtPath(resolvedTargetRoot);
    if (targetProject?.projectMode === "master") {
      throw new Error("La cartella scelta è già un progetto master.");
    }

    const timestamp = Date.now();
    const sourceFilePath = projectFilePathForFolder(resolvedSourceRoot);
    const sourceBackupPath = join(resolvedSourceRoot, `.image-select-pro.previous-master-${timestamp}.json`);
    const targetFilePath = projectFilePathForFolder(resolvedTargetRoot);
    const targetBackupPath = join(resolvedTargetRoot, `.image-select-pro.before-master-correction-${timestamp}.json`);
    const targetTempPath = join(resolvedTargetRoot, `.image-select-pro.correcting-${timestamp}.tmp`);
    const payload: DesktopPhotoSelectorProjectFile = {
      ...project,
      schemaVersion: 1,
      app: "image-select-pro",
      projectMode: "master",
      updatedAt: timestamp,
    };

    let targetWasBackedUp = false;
    let sourceWasBackedUp = false;
    try {
      await writeFile(targetTempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      try {
        const existingTargetStats = await lstat(targetFilePath);
        if (!existingTargetStats.isFile() || existingTargetStats.isSymbolicLink()) {
          throw new Error("Il file progetto esistente nella destinazione non è un file locale valido.");
        }
        await rename(targetFilePath, targetBackupPath);
        targetWasBackedUp = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }

      await rename(sourceFilePath, sourceBackupPath);
      sourceWasBackedUp = true;
      await rename(targetTempPath, targetFilePath);
      return {
        ok: true,
        sourceBackupPath,
        ...(targetWasBackedUp ? { targetBackupPath } : {}),
      };
    } catch (error) {
      await unlink(targetTempPath).catch(() => undefined);
      if (sourceWasBackedUp) {
        await rename(sourceBackupPath, sourceFilePath).catch(() => undefined);
      }
      if (targetWasBackedUp) {
        await rename(targetBackupPath, targetFilePath).catch(() => undefined);
      }
      throw error;
    }
  });

  projectFileWriteQueue = relocationTask.then(() => undefined, () => undefined);
  return relocationTask.catch((error) => ({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  }));
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

export async function readSidecarXmpInfoFromAssetPath(
  absolutePath: string,
): Promise<DesktopSidecarXmpInfo | null> {
  try {
    const sidecarPath = sidecarPathForAsset(absolutePath);
    const [xml, stats] = await Promise.all([
      readFile(sidecarPath, "utf8"),
      lstat(sidecarPath),
    ]);
    return {
      xml,
      lastModified: Math.round(stats.mtimeMs),
    };
  } catch {
    return null;
  }
}

export async function readSidecarXmpFromAssetPath(absolutePath: string): Promise<string | null> {
  return (await readSidecarXmpInfoFromAssetPath(absolutePath))?.xml ?? null;
}

export async function writeSidecarXmpForAssetPath(
  absolutePath: string,
  xml: string,
): Promise<boolean> {
  try {
    const sidecarPath = sidecarPathForAsset(absolutePath);
    const existingXml = await readFile(sidecarPath, "utf8").catch(() => null);
    if (existingXml === xml) {
      return true;
    }
    await writeFile(sidecarPath, xml, "utf8");
    return true;
  } catch {
    return false;
  }
}

export async function shutdownNativeFolderService(): Promise<void> {
  return;
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
