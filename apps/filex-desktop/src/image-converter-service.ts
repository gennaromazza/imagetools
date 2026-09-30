import * as electron from "electron";
import { access, copyFile, lstat, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { availableParallelism } from "node:os";
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
import {
  isInsideImageConverterOutput,
  resolveImageConverterFormat,
  resolveImageConverterKeepMetadata,
  resolveImageConverterMaxLongEdge,
  resolveImageConverterOutputDirectory,
  resolveImageConverterQuality,
  resolveImageConverterTargetMaxBytes,
} from "./image-converter-policy.js";
import { claimOutputPath, dropJpegsPairedWithRaw, isValidOutputDirectory } from "./image-converter-output.js";
import {
  copyRawMetadata,
  disposeImageConverterExifTool,
  extractLargestEmbeddedPreview,
  formatRawLookSummary,
  isPreviewTooSmall,
  readRawLookSummary,
} from "./image-converter-raw.js";

const { dialog, shell } = electron;

const OUTPUT_ROOT_NAME = "Image Converter Output";
const BITMAP_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"]);
const RAW_EXTENSIONS = new Set([
  ".3fr", ".arw", ".cr2", ".cr3", ".dcr", ".erf", ".fff", ".iiq", ".kdc", ".mef",
  ".mos", ".mrw", ".nef", ".nrw", ".orf", ".pef", ".raf", ".raw", ".rw2", ".rwl", ".sr2", ".srf", ".srw", ".dng",
]);
const RAW_CONVERSION_CONCURRENCY = Math.max(2, Math.min(4, Math.floor(availableParallelism() / 2)));
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
    id: "raw-camera-jpg",
    name: "RAW in JPG massima qualita",
    description: "JPG a risoluzione originale con il look della fotocamera (stile immagine, bilanciamento bianco) e tutti i metadati del RAW.",
    maxLongEdge: 0,
    format: "jpg",
    quality: 100,
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
let jobClaims = new Set<string>();
let jobEvents: string[] = [];
const MAX_VISIBLE_LOGS = 400;
let cachedDngConverterPath: string | null = null;

function normalizeSlashes(value: string): string {
  return value.split(sep).join("/");
}

function sanitizeDesktopPath(value: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  const withoutQuotes = trimmed.replace(/^"+|"+$/g, "");
  return process.platform === "win32" ? withoutQuotes.replace(/\//g, "\\") : withoutQuotes;
}

function findPreset(presetId: ImageConverterPresetId): ImageConverterPreset | undefined {
  return PRESETS.find((preset) => preset.id === presetId);
}

function isSupportedImage(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function getSourceKind(filePath: string): "bitmap" | "raw" {
  return RAW_EXTENSIONS.has(extname(filePath).toLowerCase()) ? "raw" : "bitmap";
}

function isEligibleForFormat(entry: ImageConverterInputEntry, format: ImageConverterPreset["format"]): boolean {
  if (format === "dng") {
    return entry.sourceKind === "raw" && extname(entry.absolutePath).toLowerCase() !== ".dng";
  }
  return true;
}

function toOutputFolderName(preset: ImageConverterPreset): string {
  return preset.id;
}

function log(level: ImageConverterProgressLogEntry["level"], message: string, path?: string): void {
  const timestamp = Date.now();
  jobEvents.push(`${new Date(timestamp).toISOString()} [${level}] ${message}${path ? ` | ${path}` : ""}`);
  let logs = [...progress.logs, { level, message, path, timestamp }];
  // Con lotti grandi si scartano prima i messaggi informativi: errori e avvisi restano visibili.
  while (logs.length > MAX_VISIBLE_LOGS) {
    const index = logs.findIndex((entry) => entry.level === "info");
    logs.splice(index >= 0 ? index : 0, 1);
  }
  progress = { ...progress, logs };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function scanDirectory(
  sourceRoot: string,
  currentPath: string,
  entries: ImageConverterInputEntry[],
  issues: ImageConverterInputIssue[],
): Promise<void> {
  if (isInsideImageConverterOutput(relative(sourceRoot, currentPath))) {
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
        if (isInsideImageConverterOutput(inputPath)) {
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

function buildOutputPath(entry: ImageConverterInputEntry, preset: ImageConverterPreset, config?: ImageConverterJobConfig): string {
  const parsedExtension = preset.format === "jpg" ? ".jpg" : preset.format === "webp" ? ".webp" : ".dng";
  const relativeWithoutExtension = normalizeSlashes(entry.relativePath).replace(/\.[^.\\/]+$/, "");
  const customDirectory = config ? resolveImageConverterOutputDirectory(config) : null;
  if (customDirectory) {
    return join(customDirectory, `${relativeWithoutExtension}${parsedExtension}`);
  }
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

async function convertRawToDng(
  entry: ImageConverterInputEntry,
  preset: ImageConverterPreset,
  config: ImageConverterJobConfig,
): Promise<{ targetPath: string; existing: boolean }> {
  if (entry.sourceKind !== "raw") throw new Error("Il preset Archivio RAW accetta soltanto file RAW.");
  const converterPath = await findAdobeDngConverter();
  const { path: targetPath, existing } = await claimOutputPath(buildOutputPath(entry, preset, config), jobClaims);
  if (existing) return { targetPath, existing };
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
        if (error) reject(cancelRequested ? new Error("Elaborazione annullata.") : error);
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
  return { targetPath, existing: false };
}

function orientPipeline(pipeline: sharp.Sharp, orientation: number | null): sharp.Sharp {
  if (!orientation) return pipeline.rotate();
  // Le fotocamere scrivono solo 1, 3, 6 e 8: gli orientamenti speculari non si applicano.
  const angles: Record<number, number> = { 3: 180, 6: 90, 8: 270 };
  return pipeline.rotate(angles[orientation] ?? 0);
}

function createSharpPipeline(
  input: string | Buffer,
  preset: ImageConverterPreset,
  maxLongEdge: number,
  quality: number,
  keepMetadata: boolean,
  forcedOrientation: number | null = null,
) {
  let pipeline = orientPipeline(sharp(input, { failOn: "none" }), forcedOrientation);
  if (maxLongEdge > 0) {
    pipeline = pipeline.resize({
      width: maxLongEdge,
      height: maxLongEdge,
      fit: "inside",
      withoutEnlargement: true,
    });
  }
  if (keepMetadata) {
    pipeline = pipeline.withMetadata();
  }

  if (preset.format === "jpg") {
    pipeline = pipeline.flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true, chromaSubsampling: quality >= 90 ? "4:4:4" : "4:2:0" });
  } else {
    pipeline = pipeline.webp({ quality });
  }

  return pipeline;
}

async function renderWithSizeLimit(
  entry: ImageConverterInputEntry,
  input: string | Buffer,
  preset: ImageConverterPreset,
  maxLongEdge: number,
  targetMaxBytes: number | null,
  keepMetadata: boolean,
  forcedOrientation: number | null = null,
): Promise<Buffer> {
  if (!targetMaxBytes) {
    return createSharpPipeline(input, preset, maxLongEdge, preset.quality, keepMetadata, forcedOrientation).toBuffer();
  }

  const minQuality = preset.format === "jpg" ? 45 : 40;
  let nextLongEdge = maxLongEdge;
  let bestBuffer: Buffer | null = null;
  let bestQuality = preset.quality;

  for (let resizeAttempt = 0; resizeAttempt < 5; resizeAttempt += 1) {
    for (let quality = preset.quality; quality >= minQuality; quality -= 5) {
      const buffer = await createSharpPipeline(input, preset, nextLongEdge, quality, keepMetadata, forcedOrientation).toBuffer();
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

  return bestBuffer ?? createSharpPipeline(input, preset, maxLongEdge, minQuality, keepMetadata, forcedOrientation).toBuffer();
}

async function convertOne(
  entry: ImageConverterInputEntry,
  preset: ImageConverterPreset,
  config: ImageConverterJobConfig,
): Promise<{ targetPath: string; detail?: string; existing?: boolean }> {
  if (preset.format === "dng") return convertRawToDng(entry, preset, config);
  const { path: targetPath, existing } = await claimOutputPath(buildOutputPath(entry, preset, config), jobClaims);
  if (existing) return { targetPath, existing: true };
  try {
    return await renderInto(entry, preset, config, targetPath);
  } catch (error) {
    await rm(targetPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function renderInto(
  entry: ImageConverterInputEntry,
  preset: ImageConverterPreset,
  config: ImageConverterJobConfig,
  targetPath: string,
): Promise<{ targetPath: string; detail?: string }> {
  const maxLongEdge = resolveImageConverterMaxLongEdge(config, preset);
  const keepMetadata = resolveImageConverterKeepMetadata(config);
  let input: string | Buffer = entry.absolutePath;
  let detail: string | undefined;
  let rawPath: string | null = null;
  let forcedOrientation: number | null = null;

  if (entry.sourceKind === "raw") {
    const [preview, summary] = await Promise.all([
      extractLargestEmbeddedPreview(entry.absolutePath),
      readRawLookSummary(entry.absolutePath),
    ]);
    if (!preview) {
      throw new Error("Nessuna anteprima JPEG incorporata nel RAW: usa il preset Archivio RAW (DNG).");
    }
    input = preview.buffer;
    rawPath = entry.absolutePath;
    // Le anteprime dei RAW spesso non portano l'orientamento: lo applichiamo dal RAW.
    if (summary.orientation && summary.orientation !== 1) {
      const previewMeta = await sharp(preview.buffer, { failOn: "none" }).metadata();
      if (!previewMeta.orientation) forcedOrientation = summary.orientation;
    }
    detail = [formatRawLookSummary(summary), `anteprima ${preview.width}x${preview.height}`].filter(Boolean).join(" | ");
    if (isPreviewTooSmall(preview, { width: summary.rawWidth, height: summary.rawHeight }, maxLongEdge)) {
      log("warn", `Anteprima incorporata piu' piccola del richiesto (${preview.width}x${preview.height}): non viene ingrandita.`, entry.absolutePath);
    }
  }

  await mkdir(dirname(targetPath), { recursive: true });
  // Nessun ridimensionamento ne' limite di peso: il JPEG della fotocamera viene scritto
  // cosi' com'e', senza ricompressione, identico a uno scatto in JPG.
  const passthrough = Boolean(rawPath) && preset.format === "jpg" && maxLongEdge === 0
    && preset.quality >= 100 && resolveImageConverterTargetMaxBytes(config) === null && input !== entry.absolutePath;
  if (passthrough && rawPath && Buffer.isBuffer(input)) {
    await writeFile(targetPath, input);
    if (keepMetadata) {
      try {
        const previewOrientation = (await sharp(input, { failOn: "none" }).metadata()).orientation;
        await copyRawMetadata(rawPath, targetPath, await findXmpSidecar(rawPath), previewOrientation ?? forcedOrientation ?? 1);
      } catch (error) {
        log("warn", `Immagine generata, ma copia metadati RAW non riuscita: ${error instanceof Error ? error.message : String(error)}`, entry.absolutePath);
      }
    }
    return { targetPath, detail: `${detail ?? ""}${detail ? " | " : ""}JPEG originale della fotocamera, senza ricompressione` };
  }
  const buffer = await renderWithSizeLimit(
    entry,
    input,
    preset,
    maxLongEdge,
    resolveImageConverterTargetMaxBytes(config),
    keepMetadata,
    forcedOrientation,
  );
  await writeFile(targetPath, buffer);

  if (rawPath && keepMetadata) {
    try {
      const sidecar = await findXmpSidecar(rawPath);
      await copyRawMetadata(rawPath, targetPath, sidecar);
    } catch (error) {
      log("warn", `Immagine generata, ma copia metadati RAW non riuscita: ${error instanceof Error ? error.message : String(error)}`, entry.absolutePath);
    }
  }
  return { targetPath, detail };
}

async function findXmpSidecar(inputPath: string): Promise<string | null> {
  const base = inputPath.slice(0, -extname(inputPath).length);
  for (const extension of [".xmp", ".XMP"]) {
    if (await pathExists(`${base}${extension}`)) return `${base}${extension}`;
  }
  return null;
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
    const preset = findPreset(config.presetId);
    if (!preset) throw new Error("Preset non valido.");
    jobClaims = new Set<string>();
    jobEvents = [];
    const effectivePreset: ImageConverterPreset = {
      ...preset,
      format: resolveImageConverterFormat(config, preset),
      quality: resolveImageConverterQuality(config, preset),
    };
    const customOutputDirectory = resolveImageConverterOutputDirectory(config);
    if (customOutputDirectory) {
      try {
        await mkdir(customOutputDirectory, { recursive: true });
        if (!(await lstat(customOutputDirectory)).isDirectory()) {
          throw new Error("La destinazione non è una cartella.");
        }
      } catch {
        progress = {
          ...progress,
          status: "error",
          finishedAt: Date.now(),
          currentFile: null,
          error: "Cartella di destinazione non valida.",
        };
        log("error", "Cartella di destinazione non valida.");
        return;
      }
    }
    const scan = await scanImageConverterInputsDesktop(config.inputPaths);
    const outputDirectoryKey = customOutputDirectory ? resolve(customOutputDirectory).toLowerCase() : null;
    const pairing = effectivePreset.format === "dng"
      ? { kept: scan.entries, dropped: 0 }
      : dropJpegsPairedWithRaw(scan.entries);
    const eligibleEntries = pairing.kept.filter((entry) => {
      if (!isEligibleForFormat(entry, effectivePreset.format)) return false;
      if (!outputDirectoryKey) return true;
      const entryKey = resolve(entry.absolutePath).toLowerCase();
      return !entryKey.startsWith(`${outputDirectoryKey}${sep}`);
    });
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
    if (pairing.dropped > 0) {
      log("info", `${pairing.dropped} JPG affiancati a un RAW ignorati: si converte solo il RAW.`);
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

    // Pool limitato: un lotto di centinaia di RAW non satura memoria e CPU e un file
    // in errore non blocca gli altri.
    const concurrency = effectivePreset.format === "dng" ? 1 : RAW_CONVERSION_CONCURRENCY;
    let nextIndex = 0;
    let stopped = false;
    const isStopped = () => cancelRequested || progress.jobId !== jobId;
    const worker = async (): Promise<void> => {
      while (!stopped) {
        if (isStopped()) {
          stopped = true;
          return;
        }
        const entry = eligibleEntries[nextIndex];
        nextIndex += 1;
        if (!entry) return;
        progress = { ...progress, currentFile: entry.absolutePath };
        try {
          const { targetPath, detail, existing } = await convertOne(entry, effectivePreset, config);
          if (existing) {
            progress = { ...progress, completed: progress.completed + 1, skipped: progress.skipped + 1 };
            log("info", "Output gia presente da una conversione precedente: file saltato.", targetPath);
            continue;
          }
          generatedOutputRoots.add(customOutputDirectory ?? join(entry.sourceRoot, OUTPUT_ROOT_NAME, toOutputFolderName(effectivePreset)));
          progress = {
            ...progress,
            completed: progress.completed + 1,
            generated: progress.generated + 1,
            outputRoots: Array.from(generatedOutputRoots),
          };
          log("info", effectivePreset.format === "dng"
            ? "Generato e verificato DNG; originale conservato."
            : `Generata immagine${detail ? ` (${detail})` : ""}.`, targetPath);
        } catch (error) {
          if (isStopped()) {
            stopped = true;
            return;
          }
          progress = {
            ...progress,
            completed: progress.completed + 1,
            skipped: progress.skipped + 1,
            errors: progress.errors + 1,
          };
          log("error", error instanceof Error ? error.message : "Conversione fallita.", entry.absolutePath);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, eligibleEntries.length) }, () => worker()));

    if (isStopped()) {
      progress = { ...progress, status: "cancelled", currentFile: null, finishedAt: Date.now() };
      log("warn", "Elaborazione annullata.");
      return;
    }

    progress = {
      ...progress,
      status: "completed",
      currentFile: null,
      finishedAt: Date.now(),
    };
    log(progress.errors > 0 ? "warn" : "info",
      `Conversione completata: ${progress.generated} generate, ${progress.skipped - progress.errors} gia presenti, ${progress.errors} errori.`);
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
    await disposeImageConverterExifTool();
    await writeJobLogFiles(jobId);
  }
}

/** Log completo del job (senza limite) accanto ai risultati, utile con centinaia di file. */
async function writeJobLogFiles(jobId: string): Promise<void> {
  if (progress.jobId !== jobId || progress.outputRoots.length === 0 || jobEvents.length === 0) return;
  const content = `${jobEvents.join("\n")}\n`;
  for (const root of progress.outputRoots) {
    try {
      await writeFile(join(root, `filex-conversion-log-${jobId.replace(/\D/g, "")}.txt`), content, "utf8");
    } catch {
      // il log su file e' un di piu': non deve rendere fallito un job riuscito
    }
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

  const inputPaths = (Array.isArray(config.inputPaths) ? config.inputPaths : [])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
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

  const preset = findPreset(config.presetId);
  const rawOutputDirectory = config.overrides?.outputDirectory;
  const invalidReason = !preset
    ? "Preset non valido."
    : typeof rawOutputDirectory === "string" && rawOutputDirectory.trim().length > 0 && !isValidOutputDirectory(rawOutputDirectory)
      ? "Cartella di destinazione non valida: serve un percorso assoluto."
      : null;
  if (invalidReason || !preset) {
    progress = { ...idleProgress, status: "error", error: invalidReason ?? "Preset non valido.", finishedAt: Date.now(), logs: [] };
    return { ok: false, progress, error: progress.error ?? undefined };
  }
  const jobId = `image-converter-${Date.now()}`;
  cancelRequested = false;
  progress = makeProgress(jobId, preset.id);
  log("info", `Avvio preset ${preset.name}.`);
  const customDetails: string[] = [];
  if (config.overrides?.maxLongEdge || config.overrides?.targetMaxBytesMb) {
    customDetails.push(`lato ${resolveImageConverterMaxLongEdge(config, preset)}px${
      resolveImageConverterTargetMaxBytes(config) ? `, limite ${config.overrides?.targetMaxBytesMb} MB` : ""
    }`);
  }
  if (config.overrides?.format || config.overrides?.quality) {
    customDetails.push(`${resolveImageConverterFormat(config, preset).toUpperCase()} qualità ${resolveImageConverterQuality(config, preset)}`);
  }
  if (config.overrides?.keepMetadata === false) {
    customDetails.push("metadati rimossi");
  }
  if (resolveImageConverterOutputDirectory(config)) {
    customDetails.push(`destinazione ${resolveImageConverterOutputDirectory(config)}`);
  }
  if (customDetails.length > 0) {
    log("info", `Personalizzazione: ${customDetails.join(" · ")}.`);
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
