import * as electron from "electron";
import { access, copyFile, link, lstat, mkdir, readdir, realpath, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
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

function isSameOrNestedPath(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath));
}

export function parseImageFileFinderInput(rawInput: string): ImageFileFinderInputParseResult {
  const source = typeof rawInput === "string" ? rawInput.replace(/[“”]/g, '"').replace(/[‘’]/g, "'") : "";
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | "`" | null = null;
  const flush = () => {
    const name = normalizeInputName(current);
    if (name) tokens.push(name);
    current = "";
  };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (/[\r\n,;\t]/u.test(character) || (character === " " && source[index + 1] === " ")) {
      flush();
      while (character === " " && source[index + 1] === " ") index += 1;
      continue;
    }
    current += character;
  }
  flush();

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

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST";
}

function canFallbackToCopy(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && ["EXDEV", "EPERM", "EOPNOTSUPP", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "");
}

async function copyToUniqueDestination(destinationFolder: string, sourcePath: string): Promise<string> {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const destinationPath = await uniqueDestinationPath(destinationFolder, sourcePath);
    try {
      await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
      return destinationPath;
    } catch (error) {
      if (isAlreadyExists(error)) continue;
      throw error;
    }
  }
  throw new Error("Non riesco a creare un nome libero nella cartella destinazione.");
}

async function scanDirectory(
  sourceFolder: string,
  currentPath: string,
  files: ImageFileFinderFileMatch[],
  issues: ImageFileFinderScanIssue[],
  isCancelled: () => boolean,
): Promise<void> {
  if (isCancelled()) throw new ImageFileFinderCancelledError();
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
    if (isCancelled()) throw new ImageFileFinderCancelledError();
    const absolutePath = join(currentPath, dirEntry.name);
    if (dirEntry.isSymbolicLink()) {
      continue;
    }
    if (dirEntry.isDirectory()) {
      await scanDirectory(sourceFolder, absolutePath, files, issues, isCancelled);
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
  options: { isCancelled?: () => boolean } = {},
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
    await scanDirectory(sourceFolder, sourceFolder, allFiles, issues, options.isCancelled ?? (() => false));
  } catch (error) {
    if (error instanceof ImageFileFinderCancelledError) throw error;
    issues.push({
      path: sourceFolder,
      message: error instanceof Error ? error.message : "Cartella sorgente non leggibile.",
    });
  }

  const matched: ImageFileFinderFileMatch[] = [];
  const missing: Array<{ requestedName: string }> = [];
  const ambiguous: ImageFileFinderAmbiguousMatch[] = [];

  const exactIndex = new Map<string, ImageFileFinderFileMatch[]>();
  const stemIndex = new Map<string, ImageFileFinderFileMatch[]>();
  for (const file of allFiles) {
    const exactKey = normalizeKey(file.fileName);
    const stemKey = normalizeKey(basename(file.fileName, extname(file.fileName)));
    const exactMatches = exactIndex.get(exactKey);
    if (exactMatches) exactMatches.push(file);
    else exactIndex.set(exactKey, [file]);
    const stemMatches = stemIndex.get(stemKey);
    if (stemMatches) stemMatches.push(file);
    else stemIndex.set(stemKey, [file]);
  }
  for (const requestedName of parsed.names) {
    if (options.isCancelled?.()) throw new ImageFileFinderCancelledError();
    const requestedStem = normalizeKey(basename(requestedName, extname(requestedName)));
    const indexed = matchMode === "exact"
      ? (extname(requestedName) ? exactIndex.get(normalizeKey(requestedName)) : stemIndex.get(requestedStem))
      : matchMode === "stem" ? stemIndex.get(requestedStem) : undefined;
    const candidates = (indexed ?? (matchMode === "contains"
      ? allFiles.filter((file) => matchFileName(requestedName, file.fileName, matchMode))
      : []))
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

class ImageFileFinderCancelledError extends Error {
  constructor() {
    super("Operazione annullata");
  }
}

async function moveToUniqueDestination(destinationFolder: string, sourcePath: string): Promise<string> {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const destinationPath = await uniqueDestinationPath(destinationFolder, sourcePath);
    try {
      await link(sourcePath, destinationPath);
      await unlink(sourcePath);
      return destinationPath;
    } catch (error) {
      if (isAlreadyExists(error)) continue;
      if (!canFallbackToCopy(error)) throw error;
    }
    try {
      await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
      await unlink(sourcePath);
      return destinationPath;
    } catch (error) {
      if (isAlreadyExists(error)) continue;
      throw error;
    }
  }
  throw new Error("Non riesco a creare un nome libero nella cartella destinazione.");
}

async function resolveExplicitSelection(
  sourceFolder: string,
  selectedFilePaths: string[] | undefined,
): Promise<ImageFileFinderFileMatch[] | null> {
  if (selectedFilePaths === undefined) return null;
  if (!Array.isArray(selectedFilePaths) || selectedFilePaths.length === 0 || selectedFilePaths.length > 20_000) {
    throw new Error("Seleziona da 1 a 20000 foto valide dall'anteprima.");
  }
  const sourceRealPath = await realpath(sourceFolder);
  const selected: ImageFileFinderFileMatch[] = [];
  const seen = new Set<string>();
  for (const selectedPath of selectedFilePaths) {
    if (typeof selectedPath !== "string" || !selectedPath.trim()) throw new Error("La selezione contiene un percorso non valido.");
    const resolvedPath = resolve(selectedPath);
    const realPath = await realpath(resolvedPath);
    const stats = await lstat(realPath);
    const key = normalizeKey(realPath);
    if (!isSameOrNestedPath(sourceRealPath, realPath) || !stats.isFile() || !isSupportedImage(basename(realPath))) {
      throw new Error("La selezione contiene un file non più valido nella cartella sorgente.");
    }
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push({
      requestedName: basename(realPath),
      absolutePath: realPath,
      fileName: basename(realPath),
      relativePath: normalizeSlashes(relative(sourceRealPath, realPath)),
      size: stats.size,
    });
  }
  return selected;
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

    const selectedMatches = await resolveExplicitSelection(config.sourceFolder, config.selectedFilePaths);
    const scan = selectedMatches ? null : await scanImageFileFinderMatchesDesktop(config, {
      isCancelled: () => cancelRequested || progress.jobId !== jobId,
    });
    const matches = selectedMatches ?? scan?.matched ?? [];
    progress = {
      ...progress,
      status: "running",
      total: matches.length,
    };

    if (scan?.ignoredDuplicates.length) {
      log("info", `${scan.ignoredDuplicates.length} nomi duplicati ignorati.`);
    }
    for (const missing of scan?.missing ?? []) {
      log("warn", "File non trovato.", missing.requestedName);
    }
    for (const item of scan?.ambiguous ?? []) {
      log("warn", `${item.matches.length} corrispondenze, non elaborato.`, item.requestedName);
    }
    for (const issue of scan?.issues ?? []) {
      log("warn", issue.message, issue.path);
    }

    await mkdir(destinationFolder, { recursive: true });
    for (const match of matches) {
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
        if (config.operation === "move") {
          const destinationPath = await moveToUniqueDestination(destinationFolder, match.absolutePath);
          progress = { ...progress, moved: progress.moved + 1 };
          log("info", "Spostato.", destinationPath);
        } else {
          const destinationPath = await copyToUniqueDestination(destinationFolder, match.absolutePath);
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
    if (error instanceof ImageFileFinderCancelledError) {
      progress = { ...progress, status: "cancelled", currentFile: null, finishedAt: Date.now() };
      log("warn", "Operazione annullata.");
      return;
    }
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

export async function validateImageFileFinderFolderDesktop(folderPath: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  const normalizedPath = sanitizeDesktopPath(folderPath);
  if (!normalizedPath) return { ok: false, error: "Trascina una cartella valida." };
  try {
    if (!(await lstat(normalizedPath)).isDirectory()) return { ok: false, error: "Puoi trascinare soltanto una cartella." };
    return { ok: true, path: normalizedPath };
  } catch {
    return { ok: false, error: "La cartella trascinata non è più disponibile." };
  }
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
