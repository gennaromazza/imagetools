import * as electron from "electron";
import { access, copyFile, lstat, mkdir, readdir, rename, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import type {
  ImageFileFinderAmbiguousMatch,
  ImageFileFinderFileMatch,
  ImageFileFinderInputParseResult,
  ImageFileFinderJobConfig,
  ImageFileFinderJobStartResult,
  ImageFileFinderMatchMode,
  ImageFileFinderProgressLogEntry,
  ImageFileFinderProgressSnapshot,
  ImageFileFinderScanIssue,
  ImageFileFinderScanRequest,
  ImageFileFinderScanResult,
} from "@photo-tools/desktop-contracts";

const { dialog, shell } = electron;

const SUPPORTED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".tif",
  ".tiff",
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

const idleProgress: ImageFileFinderProgressSnapshot = {
  jobId: null,
  status: "idle",
  operation: null,
  matchMode: null,
  sourceFolder: null,
  destinationFolder: null,
  total: 0,
  completed: 0,
  copied: 0,
  moved: 0,
  skipped: 0,
  errors: 0,
  currentFile: null,
  startedAt: null,
  finishedAt: null,
  error: null,
  logs: [],
};

let progress: ImageFileFinderProgressSnapshot = { ...idleProgress, logs: [] };
let cancelRequested = false;

function sanitizeDesktopPath(value: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  const withoutQuotes = trimmed.replace(/^"+|"+$/g, "");
  return process.platform === "win32" ? withoutQuotes.replace(/\//g, "\\") : withoutQuotes;
}

function normalizeSlashes(value: string): string {
  return value.split(sep).join("/");
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function normalizeInputName(value: string): string {
  const trimmed = value.trim().replace(/^["'`]+|["'`]+$/g, "");
  const normalizedSeparators = trimmed.replace(/[\\/]+/g, "/");
  return basename(normalizedSeparators).trim();
}

export function parseImageFileFinderInput(rawInput: string): ImageFileFinderInputParseResult {
  const source = typeof rawInput === "string" ? rawInput : "";
  const tokens = source
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .split(/[\r\n,;\t]+| {2,}/g)
    .map(normalizeInputName)
    .filter(Boolean);

  const seen = new Set<string>();
  const names: string[] = [];
  const ignoredDuplicates: string[] = [];
  for (const token of tokens) {
    const key = normalizeKey(token);
    if (seen.has(key)) {
      ignoredDuplicates.push(token);
      continue;
    }
    seen.add(key);
    names.push(token);
  }

  return { names, ignoredDuplicates };
}

function isSupportedImage(fileName: string): boolean {
  if (fileName.startsWith("._")) {
    return false;
  }
  return SUPPORTED_EXTENSIONS.has(extname(fileName).toLowerCase());
}

function matchFileName(requestedName: string, fileName: string, mode: ImageFileFinderMatchMode): boolean {
  const requested = normalizeKey(requestedName);
  const actual = normalizeKey(fileName);
  const requestedExtension = extname(requestedName);
  if (mode === "exact") {
    if (!requestedExtension) {
      return normalizeKey(basename(fileName, extname(fileName))) === requested;
    }
    return actual === requested;
  }
  if (mode === "stem") {
    return normalizeKey(basename(fileName, extname(fileName))) === normalizeKey(basename(requestedName, extname(requestedName)));
  }
  return actual.includes(requested);
}

function log(level: ImageFileFinderProgressLogEntry["level"], message: string, path?: string): void {
  progress = {
    ...progress,
    logs: [
      ...progress.logs.slice(-119),
      {
        level,
        message,
        path,
        timestamp: Date.now(),
      },
    ],
  };
}

async function pathExists(pathValue: string): Promise<boolean> {
  try {
    await access(pathValue, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function uniqueDestinationPath(destinationFolder: string, sourcePath: string): Promise<string> {
  const fileName = basename(sourcePath);
  const firstPath = join(destinationFolder, fileName);
  if (!(await pathExists(firstPath))) {
    return firstPath;
  }

  const extension = extname(fileName);
  const name = basename(fileName, extension);
  for (let index = 2; index < 10000; index += 1) {
    const candidate = join(destinationFolder, `${name} (${index})${extension}`);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }

  return join(destinationFolder, `${name} (${Date.now()})${extension}`);
}

async function scanDirectory(
  sourceFolder: string,
  currentPath: string,
  files: ImageFileFinderFileMatch[],
  issues: ImageFileFinderScanIssue[],
): Promise<void> {
  let dirEntries;
  try {
    dirEntries = await readdir(currentPath, { withFileTypes: true });
  } catch (error) {
    issues.push({
      path: currentPath,
      message: error instanceof Error ? error.message : "Impossibile leggere la cartella.",
    });
    return;
  }

  dirEntries.sort((left, right) => left.name.localeCompare(right.name));
  for (const dirEntry of dirEntries) {
    const absolutePath = join(currentPath, dirEntry.name);
    if (dirEntry.isSymbolicLink()) {
      continue;
    }
    if (dirEntry.isDirectory()) {
      await scanDirectory(sourceFolder, absolutePath, files, issues);
      continue;
    }
    if (!dirEntry.isFile() || !isSupportedImage(dirEntry.name)) {
      continue;
    }

    try {
      const stats = await lstat(absolutePath);
      files.push({
        requestedName: "",
        absolutePath,
        fileName: basename(absolutePath),
        relativePath: normalizeSlashes(relative(sourceFolder, absolutePath)),
        size: stats.size,
      });
    } catch (error) {
      issues.push({
        path: absolutePath,
        message: error instanceof Error ? error.message : "Impossibile leggere il file.",
      });
    }
  }
}

export async function chooseImageFileFinderSourceFolderDesktop(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: "Seleziona cartella sorgente",
    buttonLabel: "Usa cartella sorgente",
    properties: ["openDirectory"],
  });
  return result.canceled || result.filePaths.length === 0 ? null : sanitizeDesktopPath(result.filePaths[0]);
}

export async function chooseImageFileFinderDestinationFolderDesktop(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: "Seleziona cartella destinazione",
    buttonLabel: "Usa cartella destinazione",
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled || result.filePaths.length === 0 ? null : sanitizeDesktopPath(result.filePaths[0]);
}

export async function scanImageFileFinderMatchesDesktop(
  request: ImageFileFinderScanRequest,
): Promise<ImageFileFinderScanResult> {
  const sourceFolder = sanitizeDesktopPath(request.sourceFolder);
  const parsed = parseImageFileFinderInput(request.rawInput);
  const matchMode = request.matchMode ?? "exact";
  const issues: ImageFileFinderScanIssue[] = [];
  const allFiles: ImageFileFinderFileMatch[] = [];

  if (!sourceFolder) {
    return {
      sourceFolder,
      requestedNames: parsed.names,
      ignoredDuplicates: parsed.ignoredDuplicates,
      matched: [],
      missing: parsed.names.map((requestedName) => ({ requestedName })),
      ambiguous: [],
      issues: [{ path: "", message: "Cartella sorgente non selezionata." }],
      scannedFiles: 0,
    };
  }

  try {
    const stats = await lstat(sourceFolder);
    if (!stats.isDirectory()) {
      throw new Error("Il percorso sorgente non e' una cartella.");
    }
    await scanDirectory(sourceFolder, sourceFolder, allFiles, issues);
  } catch (error) {
    issues.push({
      path: sourceFolder,
      message: error instanceof Error ? error.message : "Cartella sorgente non leggibile.",
    });
  }

  const matched: ImageFileFinderFileMatch[] = [];
  const missing: Array<{ requestedName: string }> = [];
  const ambiguous: ImageFileFinderAmbiguousMatch[] = [];

  for (const requestedName of parsed.names) {
    const candidates = allFiles
      .filter((file) => matchFileName(requestedName, file.fileName, matchMode))
      .map((file) => ({ ...file, requestedName }));

    if (candidates.length === 0) {
      missing.push({ requestedName });
    } else if (candidates.length === 1) {
      matched.push(candidates[0]);
    } else {
      ambiguous.push({ requestedName, matches: candidates });
    }
  }

  return {
    sourceFolder,
    requestedNames: parsed.names,
    ignoredDuplicates: parsed.ignoredDuplicates,
    matched,
    missing,
    ambiguous,
    issues,
    scannedFiles: allFiles.length,
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

function makeProgress(jobId: string, config: ImageFileFinderJobConfig): ImageFileFinderProgressSnapshot {
  return {
    jobId,
    status: "scanning",
    operation: config.operation,
    matchMode: config.matchMode,
    sourceFolder: sanitizeDesktopPath(config.sourceFolder),
    destinationFolder: sanitizeDesktopPath(config.destinationFolder),
    total: 0,
    completed: 0,
    copied: 0,
    moved: 0,
    skipped: 0,
    errors: 0,
    currentFile: null,
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
    logs: [],
  };
}

async function runJob(jobId: string, config: ImageFileFinderJobConfig): Promise<void> {
  try {
    const destinationFolder = sanitizeDesktopPath(config.destinationFolder);
    const destinationStats = await lstat(destinationFolder);
    if (!destinationStats.isDirectory()) {
      throw new Error("La destinazione non e' una cartella.");
    }

    const scan = await scanImageFileFinderMatchesDesktop(config);
    progress = {
      ...progress,
      status: "running",
      total: scan.matched.length,
    };

    if (scan.ignoredDuplicates.length > 0) {
      log("info", `${scan.ignoredDuplicates.length} nomi duplicati ignorati.`);
    }
    for (const missing of scan.missing) {
      log("warn", "File non trovato.", missing.requestedName);
    }
    for (const item of scan.ambiguous) {
      log("warn", `${item.matches.length} corrispondenze, non elaborato.`, item.requestedName);
    }
    for (const issue of scan.issues) {
      log("warn", issue.message, issue.path);
    }

    await mkdir(destinationFolder, { recursive: true });
    for (const match of scan.matched) {
      if (cancelRequested || progress.jobId !== jobId) {
        progress = {
          ...progress,
          status: "cancelled",
          currentFile: null,
          finishedAt: Date.now(),
        };
        log("warn", "Operazione annullata.");
        return;
      }

      progress = { ...progress, currentFile: match.absolutePath };
      try {
        const destinationPath = await uniqueDestinationPath(destinationFolder, match.absolutePath);
        if (config.operation === "move") {
          await moveFileToDestination(match.absolutePath, destinationPath);
          progress = { ...progress, moved: progress.moved + 1 };
          log("info", "Spostato.", destinationPath);
        } else {
          await copyFile(match.absolutePath, destinationPath);
          progress = { ...progress, copied: progress.copied + 1 };
          log("info", "Copiato.", destinationPath);
        }
        progress = { ...progress, completed: progress.completed + 1 };
      } catch (error) {
        progress = {
          ...progress,
          completed: progress.completed + 1,
          skipped: progress.skipped + 1,
          errors: progress.errors + 1,
        };
        log("error", error instanceof Error ? error.message : "Operazione file fallita.", match.absolutePath);
      }
    }

    progress = {
      ...progress,
      status: "completed",
      currentFile: null,
      finishedAt: Date.now(),
    };
    log("info", "Operazione completata.");
  } catch (error) {
    progress = {
      ...progress,
      status: "error",
      currentFile: null,
      finishedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error),
    };
    log("error", progress.error ?? "Errore imprevisto.");
  } finally {
    cancelRequested = false;
  }
}

export function startImageFileFinderJobDesktop(config: ImageFileFinderJobConfig): ImageFileFinderJobStartResult {
  if (progress.status === "scanning" || progress.status === "running") {
    return {
      ok: false,
      progress,
      error: "Un job Trova Foto da Lista e' gia in corso.",
    };
  }

  if (!config.rawInput?.trim()) {
    progress = {
      ...idleProgress,
      status: "error",
      error: "Incolla almeno un nome file.",
      finishedAt: Date.now(),
      logs: [],
    };
    log("error", "Incolla almeno un nome file.");
    return { ok: false, progress, error: progress.error ?? undefined };
  }

  const jobId = `image-file-finder-${Date.now()}`;
  cancelRequested = false;
  progress = makeProgress(jobId, {
    ...config,
    operation: config.operation === "move" ? "move" : "copy",
    matchMode: config.matchMode ?? "exact",
  });
  log("info", config.operation === "move" ? "Avvio spostamento." : "Avvio copia.");
  void runJob(jobId, {
    ...config,
    operation: config.operation === "move" ? "move" : "copy",
    matchMode: config.matchMode ?? "exact",
  });

  return { ok: true, progress };
}

export function getImageFileFinderProgressDesktop(): ImageFileFinderProgressSnapshot {
  return progress;
}

export function cancelImageFileFinderJobDesktop(): { ok: boolean; active: boolean } {
  const active = progress.status === "scanning" || progress.status === "running";
  if (active) {
    cancelRequested = true;
  }
  return { ok: true, active };
}

export async function openImageFileFinderFolderDesktop(folderPath: string): Promise<{ ok: boolean }> {
  const normalizedPath = sanitizeDesktopPath(folderPath);
  const stats = await lstat(normalizedPath);
  if (!stats.isDirectory()) {
    throw new Error("Il percorso selezionato non e' una cartella");
  }

  const shellError = await shell.openPath(normalizedPath);
  if (shellError) {
    throw new Error(shellError);
  }

  return { ok: true };
}
