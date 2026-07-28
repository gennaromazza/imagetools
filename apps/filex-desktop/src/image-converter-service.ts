import * as electron from "electron";
import { access, copyFile, lstat, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import sharp from "sharp";
import type {
  ImageConverterInputEntry,
  ImageConverterInputIssue,
  ImageConverterJobConfig,
  ImageConverterJobStartResult,
  ImageConverterPreset,
  ImageConverterPresetId,
  ImageConverterProgressLogEntry,
  ImageConverterProgressSnapshot,
  ImageConverterScanResult,
} from "@photo-tools/desktop-contracts";

const { dialog, shell } = electron;

const OUTPUT_ROOT_NAME = "Image Converter Output";
const BITMAP_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"]);
const RAW_EXTENSIONS = new Set([
  ".3fr", ".arw", ".cr2", ".cr3", ".dcr", ".erf", ".fff", ".iiq", ".kdc", ".mef",
  ".mos", ".mrw", ".nef", ".nrw", ".orf", ".pef", ".raf", ".raw", ".rw2", ".rwl", ".sr2", ".srf", ".srw",
]);
const SUPPORTED_EXTENSIONS = new Set([...BITMAP_EXTENSIONS, ...RAW_EXTENSIONS]);
const PRESETS: ImageConverterPreset[] = [
  {
    id: "web-quality",
    name: "Web qualita",
    description: "JPG leggero per siti e gallery online.",
    maxLongEdge: 2048,
    format: "jpg",
    quality: 85,
  },
  {
    id: "web-light",
    name: "Web leggero",
    description: "WebP compatto per consegne rapide.",
    maxLongEdge: 1600,
    format: "webp",
    quality: 78,
  },
  {
    id: "social",
    name: "Social",
    description: "JPG pronto per feed e condivisioni.",
    maxLongEdge: 1350,
    format: "jpg",
    quality: 85,
  },
  {
    id: "quick-preview",
    name: "Anteprima rapida",
    description: "WebP piccolo per revisione veloce.",
    maxLongEdge: 900,
    format: "webp",
    quality: 70,
  },
  {
    id: "print-jpg",
    name: "Stampa JPG",
    description: "JPG ad alta qualita per stampa leggera.",
    maxLongEdge: 4000,
    format: "jpg",
    quality: 92,
  },
  {
    id: "raw-archive-lossless",
    name: "Archivio RAW senza perdita",
    description: "Converte i RAW in DNG compresso, copia gli XMP e conserva sempre gli originali.",
    maxLongEdge: 0,
    format: "dng",
    quality: 100,
  },
];

const idleProgress: ImageConverterProgressSnapshot = {
  jobId: null,
  status: "idle",
  presetId: null,
  total: 0,
  completed: 0,
  generated: 0,
  skipped: 0,
  errors: 0,
  currentFile: null,
  outputRoots: [],
  startedAt: null,
  finishedAt: null,
  error: null,
  logs: [],
};

let progress: ImageConverterProgressSnapshot = { ...idleProgress, logs: [] };
let cancelRequested = false;
let activeDngProcess: ChildProcess | null = null;
let cachedDngConverterPath: string | null = null;

function normalizeSlashes(value: string): string {
  return value.split(sep).join("/");
}

function sanitizeDesktopPath(value: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  const withoutQuotes = trimmed.replace(/^"+|"+$/g, "");
  return process.platform === "win32" ? withoutQuotes.replace(/\//g, "\\") : withoutQuotes;
}

function getPreset(presetId: ImageConverterPresetId): ImageConverterPreset {
  return PRESETS.find((preset) => preset.id === presetId) ?? PRESETS[0];
}

function resolveMaxLongEdge(config: ImageConverterJobConfig, preset: ImageConverterPreset): number {
  const value = Number(config.overrides?.maxLongEdge);
  if (Number.isFinite(value) && value >= 200 && value <= 12000) {
    return Math.round(value);
  }
  return preset.maxLongEdge;
}

function resolveTargetMaxBytes(config: ImageConverterJobConfig): number | null {
  const value = Number(config.overrides?.targetMaxBytesMb);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(Math.min(value, 200) * 1024 * 1024);
}

function isSupportedImage(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function getSourceKind(filePath: string): "bitmap" | "raw" {
  return RAW_EXTENSIONS.has(extname(filePath).toLowerCase()) ? "raw" : "bitmap";
}

function isInsideGeneratedOutput(pathValue: string): boolean {
  return normalizeSlashes(pathValue).split("/").some((part) => part.toLowerCase() === OUTPUT_ROOT_NAME.toLowerCase());
}

function toOutputFolderName(preset: ImageConverterPreset): string {
  return preset.id;
}

function log(level: ImageConverterProgressLogEntry["level"], message: string, path?: string): void {
  progress = {
    ...progress,
    logs: [
      ...progress.logs.slice(-79),
      {
        level,
        message,
        path,
        timestamp: Date.now(),
      },
    ],
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function uniqueOutputPath(outputPath: string): Promise<string> {
  if (!(await pathExists(outputPath))) {
    return outputPath;
  }

  const folder = dirname(outputPath);
  const extension = extname(outputPath);
  const name = basename(outputPath, extension);
  for (let index = 1; index < 10000; index += 1) {
    const candidate = join(folder, `${name}-${index}${extension}`);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }

  return join(folder, `${name}-${Date.now()}${extension}`);
}

async function scanDirectory(
  sourceRoot: string,
  currentPath: string,
  entries: ImageConverterInputEntry[],
  issues: ImageConverterInputIssue[],
): Promise<void> {
  if (isInsideGeneratedOutput(relative(sourceRoot, currentPath))) {
    return;
  }

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

  dirEntries.sort((a, b) => a.name.localeCompare(b.name));
  for (const dirEntry of dirEntries) {
    const absolutePath = join(currentPath, dirEntry.name);
    if (dirEntry.isSymbolicLink()) {
      continue;
    }
    if (dirEntry.isDirectory()) {
      await scanDirectory(sourceRoot, absolutePath, entries, issues);
      continue;
    }
    if (!dirEntry.isFile() || !isSupportedImage(dirEntry.name)) {
      continue;
    }

    try {
      const stats = await lstat(absolutePath);
      entries.push({
        sourceRoot,
        absolutePath,
        relativePath: normalizeSlashes(relative(sourceRoot, absolutePath)),
        size: stats.size,
        sourceKind: getSourceKind(absolutePath),
      });
    } catch (error) {
      issues.push({
        path: absolutePath,
        message: error instanceof Error ? error.message : "Impossibile leggere il file.",
      });
    }
  }
}

export function getImageConverterPresetsDesktop(): ImageConverterPreset[] {
  return PRESETS;
}

export async function chooseImageConverterFoldersDesktop(): Promise<string[]> {
  const result = await dialog.showOpenDialog({
    title: "Seleziona una o piu cartelle",
    buttonLabel: "Usa cartelle",
    properties: ["openDirectory", "multiSelections"],
  });

  if (result.canceled) {
    return [];
  }

  return result.filePaths.map(sanitizeDesktopPath).filter(Boolean);
}

export async function scanImageConverterInputsDesktop(paths: string[]): Promise<ImageConverterScanResult> {
  const normalizedPaths = Array.from(
    new Set((Array.isArray(paths) ? paths : []).map(sanitizeDesktopPath).filter(Boolean)),
  );
  const entries: ImageConverterInputEntry[] = [];
  const issues: ImageConverterInputIssue[] = [];
  const roots = new Set<string>();
  const seenFiles = new Set<string>();
  let duplicateCount = 0;

  for (const inputPath of normalizedPaths) {
    try {
      const stats = await lstat(inputPath);
      if (stats.isDirectory()) {
        if (isInsideGeneratedOutput(inputPath)) {
          issues.push({ path: inputPath, message: "Cartella output generata ignorata." });
          continue;
        }
        roots.add(inputPath);
        await scanDirectory(inputPath, inputPath, entries, issues);
        continue;
      }
      if (stats.isFile() && isSupportedImage(inputPath)) {
        const sourceRoot = dirname(inputPath);
        roots.add(sourceRoot);
        entries.push({
          sourceRoot,
          absolutePath: inputPath,
          relativePath: basename(inputPath),
          size: stats.size,
          sourceKind: getSourceKind(inputPath),
        });
        continue;
      }
      issues.push({ path: inputPath, message: "Percorso non supportato." });
    } catch {
      issues.push({ path: inputPath, message: "Percorso non trovato." });
    }
  }

  const uniqueEntries: ImageConverterInputEntry[] = [];
  for (const entry of entries) {
    const key = process.platform === "win32" ? entry.absolutePath.toLowerCase() : entry.absolutePath;
    if (seenFiles.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seenFiles.add(key);
    uniqueEntries.push(entry);
  }

  uniqueEntries.sort((a, b) => a.absolutePath.localeCompare(b.absolutePath));

  return {
    roots: Array.from(roots).sort((a, b) => a.localeCompare(b)),
    totalImages: uniqueEntries.length,
    entries: uniqueEntries,
    issues,
    duplicateCount,
  };
}

function buildOutputPath(entry: ImageConverterInputEntry, preset: ImageConverterPreset): string {
  const parsedExtension = preset.format === "jpg" ? ".jpg" : preset.format === "webp" ? ".webp" : ".dng";
  const relativeWithoutExtension = normalizeSlashes(entry.relativePath).replace(/\.[^.\\/]+$/, "");
  return join(
    entry.sourceRoot,
    OUTPUT_ROOT_NAME,
    toOutputFolderName(preset),
    `${relativeWithoutExtension}${parsedExtension}`,
  );
}

async function findAdobeDngConverter(): Promise<string> {
  if (cachedDngConverterPath && await pathExists(cachedDngConverterPath)) return cachedDngConverterPath;
  const configured = sanitizeDesktopPath(process.env.ADOBE_DNG_CONVERTER_PATH ?? "");
  const candidates = [
    configured,
    process.platform === "win32" ? join(process.env.ProgramFiles ?? "C:\\Program Files", "Adobe", "Adobe DNG Converter", "Adobe DNG Converter.exe") : "",
    process.platform === "darwin" ? "/Applications/Adobe DNG Converter.app/Contents/MacOS/Adobe DNG Converter" : "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      cachedDngConverterPath = candidate;
      return candidate;
    }
  }
  throw new Error("Adobe DNG Converter non trovato. Installalo oppure imposta ADOBE_DNG_CONVERTER_PATH.");
}

async function copyXmpSidecar(inputPath: string, targetPath: string): Promise<void> {
  const sourceBase = inputPath.slice(0, -extname(inputPath).length);
  const targetBase = targetPath.slice(0, -extname(targetPath).length);
  for (const extension of [".xmp", ".XMP"]) {
    const source = `${sourceBase}${extension}`;
    if (await pathExists(source)) {
      await copyFile(source, `${targetBase}.xmp`);
      return;
    }
  }
}

async function convertRawToDng(entry: ImageConverterInputEntry, preset: ImageConverterPreset): Promise<string> {
  if (entry.sourceKind !== "raw") throw new Error("Il preset Archivio RAW accetta soltanto file RAW.");
  const converterPath = await findAdobeDngConverter();
  const targetPath = await uniqueOutputPath(buildOutputPath(entry, preset));
  await mkdir(dirname(targetPath), { recursive: true });
  const temporaryFolder = await mkdtemp(join(dirname(targetPath), ".filex-dng-"));
  const temporaryOutput = join(temporaryFolder, `${basename(entry.absolutePath, extname(entry.absolutePath))}.dng`);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = execFile(converterPath, ["-c", "-p1", "-d", temporaryFolder, entry.absolutePath], {
        windowsHide: true,
        timeout: 10 * 60 * 1000,
      }, (error) => {
        activeDngProcess = null;
        if (error) reject(error);
        else resolve();
      });
      activeDngProcess = child;
    });
    const temporaryStats = await stat(temporaryOutput).catch(() => null);
    if (!temporaryStats?.isFile() || temporaryStats.size < 1024) throw new Error("Il DNG generato non ha superato la verifica di integrita minima.");
    await rename(temporaryOutput, targetPath);
  } finally {
    const resolvedTemporaryFolder = resolve(temporaryFolder);
    const resolvedOutputFolder = resolve(dirname(targetPath));
    if (dirname(resolvedTemporaryFolder) === resolvedOutputFolder && basename(resolvedTemporaryFolder).startsWith(".filex-dng-")) {
      await rm(resolvedTemporaryFolder, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  const outputStats = await stat(targetPath).catch(() => null);
  if (!outputStats?.isFile() || outputStats.size < 1024) throw new Error("Il DNG generato non ha superato la verifica di integrita minima.");
  try {
    await copyXmpSidecar(entry.absolutePath, targetPath);
  } catch (error) {
    log("warn", `DNG valido, ma copia XMP non riuscita: ${error instanceof Error ? error.message : String(error)}`, entry.absolutePath);
  }
  return targetPath;
}

function createSharpPipeline(
  inputPath: string,
  preset: ImageConverterPreset,
  maxLongEdge: number,
  quality: number,
) {
  let pipeline = sharp(inputPath, { failOn: "none" })
    .rotate()
    .resize({
      width: maxLongEdge,
      height: maxLongEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .withMetadata();

  if (preset.format === "jpg") {
    pipeline = pipeline.jpeg({ quality, mozjpeg: true });
  } else {
    pipeline = pipeline.webp({ quality });
  }

  return pipeline;
}

async function renderWithSizeLimit(
  entry: ImageConverterInputEntry,
  preset: ImageConverterPreset,
  maxLongEdge: number,
  targetMaxBytes: number | null,
): Promise<Buffer> {
  if (!targetMaxBytes) {
    return createSharpPipeline(entry.absolutePath, preset, maxLongEdge, preset.quality).toBuffer();
  }

  const minQuality = preset.format === "jpg" ? 45 : 40;
  let nextLongEdge = maxLongEdge;
  let bestBuffer: Buffer | null = null;
  let bestQuality = preset.quality;

  for (let resizeAttempt = 0; resizeAttempt < 5; resizeAttempt += 1) {
    for (let quality = preset.quality; quality >= minQuality; quality -= 5) {
      const buffer = await createSharpPipeline(entry.absolutePath, preset, nextLongEdge, quality).toBuffer();
      bestBuffer = buffer;
      bestQuality = quality;
      if (buffer.byteLength <= targetMaxBytes) {
        if (quality < preset.quality || nextLongEdge < maxLongEdge) {
          log(
            "info",
            `Limite MB rispettato con lato ${nextLongEdge}px e qualita ${quality}.`,
            entry.absolutePath,
          );
        }
        return buffer;
      }
    }

    if (!bestBuffer) {
      break;
    }

    const scale = Math.sqrt(targetMaxBytes / bestBuffer.byteLength);
    nextLongEdge = Math.max(200, Math.floor(nextLongEdge * Math.min(0.9, scale)));
    if (nextLongEdge <= 200) {
      break;
    }
  }

  if (bestBuffer && bestBuffer.byteLength > targetMaxBytes) {
    log(
      "warn",
      `Limite MB non garantito: esportato al minimo pratico con qualita ${bestQuality}.`,
      entry.absolutePath,
    );
    return bestBuffer;
  }

  return bestBuffer ?? createSharpPipeline(entry.absolutePath, preset, maxLongEdge, minQuality).toBuffer();
}

async function convertOne(
  entry: ImageConverterInputEntry,
  preset: ImageConverterPreset,
  config: ImageConverterJobConfig,
): Promise<string> {
  if (preset.format === "dng") return convertRawToDng(entry, preset);
  if (entry.sourceKind === "raw") throw new Error("Per i RAW seleziona il preset Archivio RAW senza perdita.");
  const targetPath = await uniqueOutputPath(buildOutputPath(entry, preset));
  await mkdir(dirname(targetPath), { recursive: true });

  const buffer = await renderWithSizeLimit(
    entry,
    preset,
    resolveMaxLongEdge(config, preset),
    resolveTargetMaxBytes(config),
  );
  await writeFile(targetPath, buffer);
  return targetPath;
}

function makeProgress(jobId: string, presetId: ImageConverterPresetId): ImageConverterProgressSnapshot {
  return {
    jobId,
    status: "scanning",
    presetId,
    total: 0,
    completed: 0,
    generated: 0,
    skipped: 0,
    errors: 0,
    currentFile: null,
    outputRoots: [],
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
    logs: [],
  };
}

async function runJob(jobId: string, config: ImageConverterJobConfig): Promise<void> {
  try {
    const preset = getPreset(config.presetId);
    const scan = await scanImageConverterInputsDesktop(config.inputPaths);
    const eligibleEntries = scan.entries.filter((entry) => preset.format === "dng" ? entry.sourceKind === "raw" : entry.sourceKind === "bitmap");
    if (preset.format === "dng" && eligibleEntries.length > 0) await findAdobeDngConverter();
    const generatedOutputRoots = new Set<string>();
    progress = {
      ...progress,
      status: "running",
      total: eligibleEntries.length,
      outputRoots: [],
    };

    for (const issue of scan.issues) {
      log("warn", issue.message, issue.path);
    }
    if (scan.duplicateCount > 0) {
      log("info", `${scan.duplicateCount} duplicati ignorati.`);
    }
    if (eligibleEntries.length === 0) {
      progress = {
        ...progress,
        status: "completed",
        finishedAt: Date.now(),
        currentFile: null,
      };
      log("warn", "Nessuna immagine supportata trovata.");
      return;
    }

    for (const entry of eligibleEntries) {
      if (cancelRequested || progress.jobId !== jobId) {
        progress = {
          ...progress,
          status: "cancelled",
          currentFile: null,
          finishedAt: Date.now(),
        };
        log("warn", "Elaborazione annullata.");
        return;
      }

      progress = {
        ...progress,
        currentFile: entry.absolutePath,
      };

      try {
        const targetPath = await convertOne(entry, preset, config);
        generatedOutputRoots.add(join(entry.sourceRoot, OUTPUT_ROOT_NAME, toOutputFolderName(preset)));
        progress = {
          ...progress,
          completed: progress.completed + 1,
          generated: progress.generated + 1,
          outputRoots: Array.from(generatedOutputRoots),
        };
        log("info", preset.format === "dng" ? "Generato e verificato DNG; originale conservato." : "Generata immagine.", targetPath);
      } catch (error) {
        progress = {
          ...progress,
          completed: progress.completed + 1,
          skipped: progress.skipped + 1,
          errors: progress.errors + 1,
        };
        log("error", error instanceof Error ? error.message : "Conversione fallita.", entry.absolutePath);
      }
    }

    progress = {
      ...progress,
      status: "completed",
      currentFile: null,
      finishedAt: Date.now(),
    };
    log("info", "Conversione completata.");
    if (config.overrides?.openOutputWhenDone !== false && progress.generated > 0) {
      for (const outputRoot of generatedOutputRoots) {
        if (!(await pathExists(outputRoot))) continue;
        const openError = await shell.openPath(outputRoot);
        if (openError) log("warn", `Impossibile aprire automaticamente la cartella: ${openError}`, outputRoot);
        else log("info", "Cartella output aperta automaticamente.", outputRoot);
      }
    }
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

export function startImageConverterJobDesktop(config: ImageConverterJobConfig): ImageConverterJobStartResult {
  if (progress.status === "scanning" || progress.status === "running") {
    return {
      ok: false,
      progress,
      error: "Un job Image Converter e' gia in corso.",
    };
  }

  const inputPaths = Array.isArray(config.inputPaths) ? config.inputPaths : [];
  if (inputPaths.length === 0) {
    progress = {
      ...idleProgress,
      status: "error",
      error: "Nessun percorso selezionato.",
      finishedAt: Date.now(),
      logs: [],
    };
    log("error", "Nessun percorso selezionato.");
    return {
      ok: false,
      progress,
      error: progress.error ?? undefined,
    };
  }

  const preset = getPreset(config.presetId);
  const jobId = `image-converter-${Date.now()}`;
  cancelRequested = false;
  progress = makeProgress(jobId, preset.id);
  log("info", `Avvio preset ${preset.name}.`);
  if (config.overrides?.maxLongEdge || config.overrides?.targetMaxBytesMb) {
    log(
      "info",
      `Personalizzazione: lato ${resolveMaxLongEdge(config, preset)}px${
        resolveTargetMaxBytes(config) ? `, limite ${config.overrides?.targetMaxBytesMb} MB` : ""
      }.`,
    );
  }
  void runJob(jobId, { inputPaths, presetId: preset.id, overrides: config.overrides });

  return {
    ok: true,
    progress,
  };
}

export function getImageConverterProgressDesktop(): ImageConverterProgressSnapshot {
  return progress;
}

export function cancelImageConverterJobDesktop(): { ok: boolean; active: boolean } {
  const active = progress.status === "scanning" || progress.status === "running";
  if (active) {
    cancelRequested = true;
    activeDngProcess?.kill();
  }
  return { ok: true, active };
}

export async function openImageConverterFolderDesktop(folderPath: string): Promise<{ ok: boolean }> {
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
