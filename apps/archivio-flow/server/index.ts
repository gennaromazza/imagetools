import express, { type Request, type Response } from "express";
import cors from "cors";
import { execSync } from "child_process";
import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = parseInt(process.env.PORT ?? "3003", 10);
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));

// Jobs registry — stored next to this server file
const DATA_DIR = path.join(SERVER_DIR, "data");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Types ──────────────────────────────────────────────────────────────────────

interface SdCard {
  deviceId: string;
  volumeName: string;
  totalSize: number;
  freeSpace: number;
  path: string;
}

interface Job {
  id: string;
  nomeLavoro: string;
  dataLavoro: string;
  autore: string;
  annoArchivio?: string;
  categoriaArchivio?: string;
  contrattoLink?: string;
  percorsoCartella: string;
  nomeCartella: string;
  dataCreazione: string;
  numeroFile: number;
  folderExists?: boolean;
}

interface ImportRequest {
  sdPath: string;
  nomeLavoro: string;
  dataLavoro: string;
  autore: string;
  destinazione: string;
  sottoCartella: string;
  contrattoLink?: string;
  existingJobId?: string;
  rinominaFile: boolean;
  generaJpg: boolean;
  fileNameIncludes?: string;
  mtimeFrom?: string;
  mtimeTo?: string;
}

interface FilterCriteria {
  fileNameIncludes?: string;
  mtimeFrom?: string;
  mtimeTo?: string;
}

interface ImportProgressState {
  active: boolean;
  phase: "idle" | "copying" | "compressing" | "done" | "error";
  startedAt: number | null;
  updatedAt: number;
  scannedFiles: number;
  plannedFiles: number;
  copiedFiles: number;
  skippedFiles: number;
  manifestSkippedFiles: number;
  inFlight: number;
  copyConcurrency: number;
  initialCopyConcurrency: number;
  bytesCopied: number;
  elapsedMs: number;
  estimatedRemainingSec: number | null;
  targetFolder: string;
  jpgEnabled: boolean;
  jpgDone: number;
  error: string | null;
}

const COPY_CONCURRENCY_MAX = 6;
const COPY_CONCURRENCY_MIN = 2;
const JPG_CONCURRENCY = 2;
const IMPORTABLE_EXT = new Set([
  ".raf", ".cr2", ".cr3", ".arw", ".nef", ".dng", ".orf", ".rw2", ".pef", ".srw",
  ".jpg", ".jpeg", ".xmp",
]);

function createEmptyImportProgress(): ImportProgressState {
  return {
    active: false,
    phase: "idle",
    startedAt: null,
    updatedAt: Date.now(),
    scannedFiles: 0,
    plannedFiles: 0,
    copiedFiles: 0,
    skippedFiles: 0,
    manifestSkippedFiles: 0,
    inFlight: 0,
    copyConcurrency: COPY_CONCURRENCY_MIN,
    initialCopyConcurrency: COPY_CONCURRENCY_MIN,
    bytesCopied: 0,
    elapsedMs: 0,
    estimatedRemainingSec: null,
    targetFolder: "",
    jpgEnabled: false,
    jpgDone: 0,
    error: null,
  };
}

let importProgress: ImportProgressState = createEmptyImportProgress();

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Remove characters illegal in Windows file/folder names */
function sanitizeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim();
}

/** Keep a single safe folder segment (no nested path) */
function sanitizeFolderSegment(name: string): string {
  return sanitizeName(name)
    .replace(/[\\/]/g, "")
    .replace(/\.+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .trim();
}

function normalizeContractLink(raw: string | undefined): string | undefined {
  const value = (raw ?? "").trim();
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^www\./i.test(value)) return `https://${value}`;
  // Accept bare domains like "drive.google.com/...".
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(value)) return `https://${value}`;
  return undefined;
}

/** Collapse to alphanumeric + accented chars (no spaces, no special) */
function toSafeId(name: string): string {
  return name
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9\u00C0-\u00F6\u00F8-\u00FF]/g, "");
}

/** Validate an absolute path has no traversal nonsense */
function resolveAndValidate(p: string): string {
  if (!p || typeof p !== "string") throw new Error("Percorso vuoto");
  const resolved = path.resolve(p);
  // Reject UNC paths and paths with suspicious sequences
  if (resolved.startsWith("\\\\")) throw new Error("UNC paths non supportati");
  return resolved;
}

/** "YYYY-MM-DD" → "YYYYMMDD" */
function ymd(dateStr: string): string {
  return dateStr.replace(/-/g, "");
}

/** "YYYY-MM-DD" → "DD-MM-YYYY" */
function dmy(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}-${m}-${y}`;
}

/** Build canonical folder name: "2026-03-21 - Maria Rossi Shooting - 21-03-2026" */
function buildFolderName(nomeLavoro: string, dataLavoro: string): string {
  return `${dataLavoro} - ${sanitizeName(nomeLavoro)} - ${dmy(dataLavoro)}`;
}

/** Recursively collect all file paths under a directory */
async function collectFiles(dir: string): Promise<string[]> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await collectFiles(full)));
    } else {
      result.push(full);
    }
  }
  return result;
}

async function* walkFiles(dir: string): AsyncGenerator<string> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else {
      yield full;
    }
  }
}

async function collectSampleFiles(dir: string, limit: number, acc: string[] = []): Promise<string[]> {
  if (acc.length >= limit) return acc;
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (acc.length >= limit) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectSampleFiles(full, limit, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

interface ImportManifestRecord {
  sourceRelativePath: string;
  sourceSize: number;
  sourceMtimeMs: number;
  destFileName: string;
  status: "done";
}

type ImportManifest = Record<string, ImportManifestRecord>;

function buildManifestKey(relativePath: string, size: number, mtimeMs: number): string {
  return `${relativePath}|${size}|${Math.trunc(mtimeMs)}`;
}

function loadImportManifest(filePath: string): ImportManifest {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as ImportManifest;
    }
  } catch {
    /* ignore and start fresh */
  }
  return {};
}

async function saveImportManifestAsync(filePath: string, manifest: ImportManifest): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  const payload = JSON.stringify(manifest, null, 2);
  await fs.promises.writeFile(tempPath, payload, "utf-8");
  await fs.promises.rename(tempPath, filePath);
}

function shortStableSuffix(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 8);
}

function buildDestinationFileName(params: {
  originalName: string;
  sourceRelativePath: string;
  rinominaFile: boolean;
  safeNome: string;
  safeData: string;
  safeAutore: string;
}): string {
  const { originalName, sourceRelativePath, rinominaFile, safeNome, safeData, safeAutore } = params;
  const ext = path.extname(originalName);
  const stem = path.basename(originalName, ext);
  const suffix = shortStableSuffix(sourceRelativePath);
  const base = rinominaFile
    ? `${safeNome}_${safeData}_${safeAutore}_${stem}`
    : stem;
  return `${base}_${suffix}${ext}`;
}

function isImportableFile(filePath: string): boolean {
  return IMPORTABLE_EXT.has(path.extname(filePath).toLowerCase());
}

function parseFilterCriteria(criteria: FilterCriteria): {
  normalizedNameFilter: string;
  hasFromFilter: boolean;
  hasToFilter: boolean;
  fromMs: number;
  toMs: number;
  error?: string;
} {
  const normalizedNameFilter = (criteria.fileNameIncludes ?? "").trim().toLowerCase();
  const fromMs = criteria.mtimeFrom ? Date.parse(criteria.mtimeFrom) : NaN;
  const toMs = criteria.mtimeTo ? Date.parse(criteria.mtimeTo) : NaN;
  const hasFromFilter = Number.isFinite(fromMs);
  const hasToFilter = Number.isFinite(toMs);

  if (criteria.mtimeFrom && !hasFromFilter) {
    return { normalizedNameFilter, hasFromFilter, hasToFilter, fromMs, toMs, error: "Filtro data/ora inizio non valido" };
  }
  if (criteria.mtimeTo && !hasToFilter) {
    return { normalizedNameFilter, hasFromFilter, hasToFilter, fromMs, toMs, error: "Filtro data/ora fine non valido" };
  }
  if (hasFromFilter && hasToFilter && fromMs > toMs) {
    return { normalizedNameFilter, hasFromFilter, hasToFilter, fromMs, toMs, error: "Intervallo data/ora non valido: inizio dopo fine" };
  }

  return { normalizedNameFilter, hasFromFilter, hasToFilter, fromMs, toMs };
}

function isFileMatchingFilter(
  fileName: string,
  sourceMtimeMs: number,
  filter: {
    normalizedNameFilter: string;
    hasFromFilter: boolean;
    hasToFilter: boolean;
    fromMs: number;
    toMs: number;
  }
): boolean {
  if (filter.normalizedNameFilter && !fileName.toLowerCase().includes(filter.normalizedNameFilter)) {
    return false;
  }
  if (filter.hasFromFilter && sourceMtimeMs < filter.fromMs) {
    return false;
  }
  if (filter.hasToFilter && sourceMtimeMs > filter.toMs) {
    return false;
  }
  return true;
}

class AdaptiveCopyController {
  private current: number;
  private bestMbps = 0;
  private windowBytes = 0;
  private windowStartedAt = Date.now();

  constructor(
    private readonly min: number,
    private readonly max: number,
    initial: number
  ) {
    this.current = Math.max(min, Math.min(max, initial));
  }

  getLimit(): number {
    return this.current;
  }

  reportCompleted(bytes: number): void {
    this.windowBytes += bytes;
    const now = Date.now();
    const elapsedMs = now - this.windowStartedAt;
    if (elapsedMs < 2000) return;

    const mbps = (this.windowBytes / 1024 / 1024) / (elapsedMs / 1000);
    if (mbps > this.bestMbps * 1.05 && this.current < this.max) {
      this.bestMbps = mbps;
      this.current += 1;
    } else if (this.bestMbps > 0 && mbps < this.bestMbps * 0.9 && this.current > this.min) {
      this.current -= 1;
      this.bestMbps = Math.max(mbps, this.bestMbps * 0.97);
    } else {
      this.bestMbps = Math.max(this.bestMbps, mbps);
    }

    this.windowBytes = 0;
    this.windowStartedAt = now;
  }
}

function chooseCopyConcurrency(fileCount: number, averageSizeBytes: number): number {
  if (fileCount <= 20) return 2;
  if (averageSizeBytes > 35 * 1024 * 1024) return 2;
  if (averageSizeBytes > 12 * 1024 * 1024) return 3;
  return 4;
}

async function estimateAverageFileSize(files: string[], sampleSize = 30): Promise<number> {
  const sample = files.slice(0, sampleSize);
  if (sample.length === 0) return 10 * 1024 * 1024;
  const stats = await Promise.all(sample.map(async (f) => {
    try {
      return await fs.promises.stat(f);
    } catch {
      return null;
    }
  }));
  const valid = stats.filter((s): s is fs.Stats => s !== null);
  if (valid.length === 0) return 10 * 1024 * 1024;
  const total = valid.reduce((sum, s) => sum + s.size, 0);
  return total / valid.length;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;

  async function runner(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runner()));
}

async function copyFileWithRetry(src: string, dest: string, retries = 2): Promise<void> {
  let attempt = 0;
  for (;;) {
    try {
      await fs.promises.copyFile(src, dest);
      return;
    } catch (error) {
      if (attempt >= retries) throw error;
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 120 * attempt));
    }
  }
}

async function safeCopyFileVerified(
  src: string,
  dest: string,
  sourceSize: number,
  retries = 2
): Promise<"copied" | "skipped"> {
  try {
    const destStat = await fs.promises.stat(dest);
    if (destStat.size === sourceSize) {
      return "skipped";
    }
  } catch {
    /* dest does not exist */
  }

  let attempt = 0;
  for (;;) {
    const tmp = `${dest}.part.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    try {
      await copyFileWithRetry(src, tmp, 0);

      const tmpStat = await fs.promises.stat(tmp);
      if (tmpStat.size !== sourceSize) {
        throw new Error(`Verifica size fallita (${sourceSize} != ${tmpStat.size})`);
      }

      await fs.promises.rename(tmp, dest);
      return "copied";
    } catch (error) {
      try { await fs.promises.unlink(tmp); } catch { /* ignore */ }
      if (attempt >= retries) throw error;
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
}

function loadJobs(): Job[] {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      return JSON.parse(fs.readFileSync(JOBS_FILE, "utf-8")) as Job[];
    }
  } catch {
    /* ignore parse errors, start fresh */
  }
  return [];
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const tempPath = `${filePath}.tmp`;
  const payload = JSON.stringify(value, null, 2);
  fs.writeFileSync(tempPath, payload, "utf-8");
  fs.renameSync(tempPath, filePath);
}

function appendJob(job: Job): void {
  const jobs = loadJobs();
  jobs.unshift(job);
  writeJsonAtomic(JOBS_FILE, jobs);
}

function incrementJobFiles(jobId: string, incremento: number, contrattoLink?: string): Job | null {
  const jobs = loadJobs();
  const idx = jobs.findIndex((j) => j.id === jobId);
  if (idx < 0) return null;
  const current = jobs[idx]!;
  const updated: Job = {
    ...current,
    numeroFile: (current.numeroFile ?? 0) + Math.max(0, incremento),
    contrattoLink: contrattoLink ?? current.contrattoLink,
  };
  jobs[idx] = updated;
  writeJsonAtomic(JOBS_FILE, jobs);
  return updated;
}

function updateJobContractLink(jobId: string, contrattoLink: string | undefined): Job | null {
  const jobs = loadJobs();
  const idx = jobs.findIndex((j) => j.id === jobId);
  if (idx < 0) return null;
  const current = jobs[idx]!;
  const updated: Job = {
    ...current,
    contrattoLink,
  };
  jobs[idx] = updated;
  writeJsonAtomic(JOBS_FILE, jobs);
  return updated;
}

function deleteJob(jobId: string): boolean {
  const jobs = loadJobs();
  const next = jobs.filter((job) => job.id !== jobId);
  if (next.length === jobs.length) return false;
  writeJsonAtomic(JOBS_FILE, next);
  return true;
}

function shouldPruneMissingJob(job: Job): boolean {
  const folderPath = job.percorsoCartella;
  if (!folderPath) return false;
  if (fs.existsSync(folderPath)) return false;

  const rootPath = path.parse(folderPath).root;
  if (!rootPath) return false;

  // Prune only if the underlying drive/root is available.
  return fs.existsSync(rootPath);
}

function cleanupMissingJobs(): Job[] {
  const jobs = loadJobs();
  const next = jobs.filter((job) => !shouldPruneMissingJob(job));
  if (next.length !== jobs.length) {
    writeJsonAtomic(JOBS_FILE, next);
  }
  return next;
}

function withFolderStatus(job: Job): Job {
  return {
    ...job,
    folderExists: fs.existsSync(job.percorsoCartella),
  };
}

function withArchiveMetadata(job: Job, archiveRoot: string): Job {
  const location = extractArchiveLocationInfo(job.percorsoCartella, archiveRoot);
  return {
    ...job,
    annoArchivio: job.annoArchivio ?? location.annoArchivio,
    categoriaArchivio: job.categoriaArchivio ?? location.categoriaArchivio,
  };
}

interface ArchiveLocationInfo {
  annoArchivio?: string;
  categoriaArchivio?: string;
}

const ARCHIVE_SYSTEM_DIRS = new Set([
  "$RECYCLE.BIN",
  "System Volume Information",
  "$WINRE_BACKUP_PARTITION.MARKER",
]);

const ARCHIVE_CATEGORY_MAP = [
  { label: "Matrimoni", aliases: ["matrimoni", "matrimonio", "wedding", "sposi"] },
  { label: "Battesimi", aliases: ["battesimi", "battesimo", "baptism"] },
  { label: "Comunioni", aliases: ["comunioni", "comunione", "cresime", "cresima"] },
  { label: "Shooting", aliases: ["shooting", "maternity", "newborn", "smash", "family", "ritratti"] },
  { label: "Eventi", aliases: ["eventi", "evento", "party", "diciottesimo", "18mo", "18esimo"] },
];

const ARCHIVE_NAME_NOISE_PATTERNS: RegExp[] = [
  /^prima\s+comunione\s+/i,
  /^primo\s+compleanno\s+/i,
  /^gender\s+reveal\s+/i,
  /^matrimonio\s+/i,
  /^battesimo\s+/i,
  /^comunione\s+/i,
  /^cresima\s+/i,
  /^shooting\s+/i,
  /^maternity\s+/i,
  /^newborn\s+/i,
  /^smash\s+/i,
  /^recita\s+/i,
  /^festa\s+/i,
  /^compleanno\s+/i,
  /^18mo\s+/i,
  /^18esimo\s+/i,
  /^18\s*esimo\s+/i,
];

const DISPLAY_LOWERCASE_WORDS = new Set(["e", "ed", "di", "de", "del", "della", "dei", "degli", "da", "la", "le"]);

function normalizeArchiveToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isArchiveSystemDir(dirName: string): boolean {
  return ARCHIVE_SYSTEM_DIRS.has(dirName) || dirName.startsWith("$");
}

function isYearFolder(dirName: string): boolean {
  return /^\d{4}$/.test(dirName.trim());
}

function extractArchiveLocationInfo(folderPath: string, archiveRoot: string): ArchiveLocationInfo {
  const normalizedRoot = archiveRoot.trim();
  if (!normalizedRoot) return {};

  let rootPath: string;
  let resolvedFolder: string;
  try {
    rootPath = resolveAndValidate(normalizedRoot);
    resolvedFolder = resolveAndValidate(folderPath);
  } catch {
    return {};
  }

  const relative = path.relative(rootPath, resolvedFolder);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return {};
  }

  const segments = relative.split(path.sep).filter(Boolean);
  if (segments.length < 2) return {};

  if (isYearFolder(segments[0]!)) {
    return {
      annoArchivio: segments[0]!,
      categoriaArchivio: segments[1]!,
    };
  }

  if (isYearFolder(path.basename(rootPath)) && segments.length >= 2) {
    return {
      annoArchivio: path.basename(rootPath),
      categoriaArchivio: segments[0]!,
    };
  }

  return {
    categoriaArchivio: segments[0]!,
  };
}

function getArchiveCategoryLabel(dirName: string): string | null {
  const normalized = normalizeArchiveToken(dirName);
  if (!normalized) return null;

  for (const category of ARCHIVE_CATEGORY_MAP) {
    if (category.aliases.some((alias) => normalized.includes(alias))) {
      return category.label;
    }
  }

  return null;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  return true;
}

function extractHistoricalIsoDate(folderName: string): string | null {
  const canonicalMatch = folderName.match(/^(\d{4}-\d{2}-\d{2})\s+-\s+(.*?)\s+-\s+\d{2}-\d{2}-\d{4}$/);
  if (canonicalMatch) return canonicalMatch[1]!;

  const candidates: Array<{ index: number; iso: string }> = [];

  for (const match of folderName.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const year = parseInt(match[1]!, 10);
    const month = parseInt(match[2]!, 10);
    const day = parseInt(match[3]!, 10);
    if (isValidDateParts(year, month, day)) {
      candidates.push({ index: match.index ?? 0, iso: `${year}-${pad2(month)}-${pad2(day)}` });
    }
  }

  for (const match of folderName.matchAll(/\b(\d{2})-(\d{2})-(\d{4})\b/g)) {
    const first = parseInt(match[1]!, 10);
    const second = parseInt(match[2]!, 10);
    const year = parseInt(match[3]!, 10);

    if (isValidDateParts(year, second, first)) {
      candidates.push({ index: match.index ?? 0, iso: `${year}-${pad2(second)}-${pad2(first)}` });
      continue;
    }

    if (isValidDateParts(year, first, second)) {
      candidates.push({ index: match.index ?? 0, iso: `${year}-${pad2(first)}-${pad2(second)}` });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.index - b.index);
  return candidates[candidates.length - 1]!.iso;
}

function toDisplayCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part, index) => {
      const lower = part.toLowerCase();
      if (index > 0 && DISPLAY_LOWERCASE_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function normalizeDiscoveredJobDate(folderName: string, fallbackIsoDate: string): string {
  return extractHistoricalIsoDate(folderName) ?? fallbackIsoDate;
}

function normalizeDiscoveredJobName(folderName: string, categoryLabel: string | null): string {
  const canonicalMatch = folderName.match(/^(\d{4}-\d{2}-\d{2})\s+-\s+(.*?)\s+-\s+\d{2}-\d{2}-\d{4}$/);
  if (canonicalMatch) return toDisplayCase(canonicalMatch[2]!.trim());

  let cleaned = folderName
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{2}-\d{2}-\d{4}\b/g, " ")
    .replace(/^\d+\s*[-_]?\s*/, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  let previous = "";
  while (cleaned && cleaned !== previous) {
    previous = cleaned;
    for (const pattern of ARCHIVE_NAME_NOISE_PATTERNS) {
      cleaned = cleaned.replace(pattern, "").trim();
    }
  }

  if (categoryLabel) {
    const categoryEntry = ARCHIVE_CATEGORY_MAP.find((entry) => entry.label === categoryLabel);
    const categoryNoise = new Set(
      [categoryLabel, ...(categoryEntry?.aliases ?? [])]
        .filter((value): value is string => Boolean(value))
        .map((value) => normalizeArchiveToken(value))
        .filter(Boolean)
    );
    const pieces = cleaned.split(/\s+/);
    cleaned = pieces
      .filter((piece) => !categoryNoise.has(normalizeArchiveToken(piece)))
      .join(" ")
      .trim();
  }

  return toDisplayCase(cleaned || folderName);
}

function parseJobNameFromFolder(folderName: string): { nomeLavoro: string; dataLavoro: string } {
  const match = folderName.match(/^(\d{4}-\d{2}-\d{2})\s+-\s+(.*?)\s+-\s+\d{2}-\d{2}-\d{4}$/);
  if (match) {
    return {
      dataLavoro: match[1]!,
      nomeLavoro: match[2]!.trim(),
    };
  }
  return {
    dataLavoro: "",
    nomeLavoro: folderName,
  };
}

function hasCanonicalJobFolderName(folderName: string): boolean {
  return /^(\d{4}-\d{2}-\d{2})\s+-\s+(.*?)\s+-\s+\d{2}-\d{2}-\d{4}$/.test(folderName);
}

function looksLikeJobFolder(dirPath: string): boolean {
  try {
    const fotoSdDir = path.join(dirPath, "FOTO_SD");
    const bassaQualitaDir = path.join(dirPath, "BASSA_QUALITA");
    const exportDir = path.join(dirPath, "EXPORT");
    return (
      hasCanonicalJobFolderName(path.basename(dirPath)) ||
      fs.existsSync(fotoSdDir) ||
      fs.existsSync(bassaQualitaDir) ||
      fs.existsSync(exportDir)
    );
  } catch {
    return false;
  }
}

async function discoverArchiveJobs(archiveRoot: string, knownJobs: Job[]): Promise<Job[]> {
  const normalizedRoot = archiveRoot.trim();
  if (!normalizedRoot) return [];

  let rootPath: string;
  try {
    rootPath = resolveAndValidate(normalizedRoot);
  } catch {
    return [];
  }

  if (!fs.existsSync(rootPath)) return [];

  const knownPaths = new Set(knownJobs.map((job) => path.resolve(job.percorsoCartella).toLowerCase()));
  const discovered: Job[] = [];
  const discoveredPaths = new Set<string>();

  function pushDiscoveredJob(fullPath: string, folderName: string, folderStat: fs.Stats, categoryFolderName?: string, yearFolderName?: string): void {
    const normalizedFull = path.resolve(fullPath).toLowerCase();
    if (knownPaths.has(normalizedFull) || discoveredPaths.has(normalizedFull)) return;

    const fallbackIsoDate = new Date(folderStat.birthtimeMs || folderStat.mtimeMs).toISOString().slice(0, 10);
    const fallbackLocation = extractArchiveLocationInfo(fullPath, rootPath);
    discovered.push({
      id: `fs:${normalizedFull}`,
      nomeLavoro: normalizeDiscoveredJobName(folderName, categoryFolderName ?? fallbackLocation.categoriaArchivio ?? null),
      dataLavoro: normalizeDiscoveredJobDate(folderName, fallbackIsoDate),
      autore: "Archivio",
      annoArchivio: yearFolderName ?? fallbackLocation.annoArchivio,
      categoriaArchivio: categoryFolderName ?? fallbackLocation.categoriaArchivio,
      percorsoCartella: fullPath,
      nomeCartella: folderName,
      dataCreazione: new Date(folderStat.birthtimeMs || folderStat.mtimeMs).toISOString(),
      numeroFile: 0,
      folderExists: true,
    });
    discoveredPaths.add(normalizedFull);
  }

  async function listDirectories(dirPath: string): Promise<Array<{ name: string; fullPath: string; stat: fs.Stats }>> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }

    const directories: Array<{ name: string; fullPath: string; stat: fs.Stats }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (isArchiveSystemDir(entry.name)) continue;

      const fullPath = path.join(dirPath, entry.name);
      try {
        const stat = await fs.promises.stat(fullPath);
        directories.push({ name: entry.name, fullPath, stat });
      } catch {
        /* ignore unreadable directory */
      }
    }

    return directories;
  }

  async function scanCategoryDirectory(categoryPath: string, categoryFolderName: string, yearFolderName?: string): Promise<void> {
    const jobDirs = await listDirectories(categoryPath);

    for (const jobDir of jobDirs) {
      pushDiscoveredJob(jobDir.fullPath, jobDir.name, jobDir.stat, categoryFolderName, yearFolderName);
    }
  }

  async function scanYearDirectory(yearPath: string, yearFolderName: string): Promise<void> {
    const categoryDirs = await listDirectories(yearPath);

    for (const categoryDir of categoryDirs) {
      await scanCategoryDirectory(categoryDir.fullPath, categoryDir.name, yearFolderName);
    }
  }

  const rootDirs = await listDirectories(rootPath);
  const yearDirs = rootDirs.filter((dir) => isYearFolder(dir.name));

  if (yearDirs.length > 0) {
    for (const yearDir of yearDirs) {
      await scanYearDirectory(yearDir.fullPath, yearDir.name);
    }
    return discovered;
  }

  if (isYearFolder(path.basename(rootPath))) {
    await scanYearDirectory(rootPath, path.basename(rootPath));
    return discovered;
  }

  const rootCategoryDirs = rootDirs.filter((dir) => !isYearFolder(dir.name));
  if (rootCategoryDirs.length > 0) {
    for (const categoryDir of rootCategoryDirs) {
      await scanCategoryDirectory(categoryDir.fullPath, categoryDir.name);
    }
    return discovered;
  }

  return discovered;
}

interface Settings {
  archiveRoot: string;
  defaultDestinazione: string;
  defaultAutore: string;
  cartellePredefinite: string[];
}

function loadSettings(): Settings {
  try {
    if (!fs.existsSync(SETTINGS_FILE) && fs.existsSync(`${SETTINGS_FILE}.tmp`)) {
      fs.renameSync(`${SETTINGS_FILE}.tmp`, SETTINGS_FILE);
    }
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")) as Partial<Settings>;
      const cartellePredefinite = Array.isArray(raw.cartellePredefinite)
        ? raw.cartellePredefinite
            .map((v) => sanitizeFolderSegment(String(v ?? "")))
            .filter((v) => v.length > 0)
        : [];
      return {
        archiveRoot: typeof raw.archiveRoot === "string" ? raw.archiveRoot : "",
        defaultDestinazione: typeof raw.defaultDestinazione === "string" ? raw.defaultDestinazione : "",
        defaultAutore: typeof raw.defaultAutore === "string" ? raw.defaultAutore : "",
        cartellePredefinite,
      };
    }
  } catch { /* ignore */ }
  return { archiveRoot: "", defaultDestinazione: "", defaultAutore: "", cartellePredefinite: [] };
}

function saveSettings(s: Settings): void {
  writeJsonAtomic(SETTINGS_FILE, s);
}

function computeEstimatedRemainingSec(snapshot: ImportProgressState): number | null {
  if (!snapshot.startedAt) return null;
  const elapsedSec = (Date.now() - snapshot.startedAt) / 1000;
  if (elapsedSec < 1.5) return null;
  const copySkipped = Math.max(0, snapshot.skippedFiles - snapshot.manifestSkippedFiles);
  const completedScheduled = snapshot.copiedFiles + copySkipped;
  if (completedScheduled <= 0 || snapshot.plannedFiles <= 0) return null;
  const remaining = Math.max(0, snapshot.plannedFiles - completedScheduled);
  const filesPerSec = completedScheduled / elapsedSec;
  if (filesPerSec <= 0.01) return null;
  return Math.ceil(remaining / filesPerSec);
}

function updateImportProgress(patch: Partial<ImportProgressState>): void {
  importProgress = {
    ...importProgress,
    ...patch,
  };
  if (importProgress.startedAt) {
    importProgress.elapsedMs = Date.now() - importProgress.startedAt;
  }
  importProgress.copyConcurrency = Math.max(COPY_CONCURRENCY_MIN, importProgress.copyConcurrency);
  importProgress.updatedAt = Date.now();
  importProgress.estimatedRemainingSec = computeEstimatedRemainingSec(importProgress);
}

// ── Routes ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/browse-folder
 * Opens a native Windows folder browser dialog and returns the selected path.
 */
app.post("/api/browse-folder", (req: Request, res: Response) => {
  const scriptPath = path.join(os.tmpdir(), `archivio-browse-${Date.now()}.ps1`);
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.ShowNewFolderButton = $true",
    "$result = $dialog.ShowDialog()",
    "if ($result -eq 'OK') { Write-Host $dialog.SelectedPath }",
  ].join("\n");

  try {
    fs.writeFileSync(scriptPath, script, "utf-8");
    const output = execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
      { encoding: "utf-8", timeout: 120000 }
    ).trim();
    try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
    res.json({ path: output || null });
  } catch {
    try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
    res.status(500).json({ error: "Impossibile aprire il selettore cartelle" });
  }
});

/**
 * GET /api/settings
 */
app.get("/api/settings", (_req: Request, res: Response) => {
  res.json(loadSettings());
});

/**
 * GET /api/import-progress
 * Returns live import progress snapshot for UI polling.
 */
app.get("/api/import-progress", (_req: Request, res: Response) => {
  const copySkipped = Math.max(0, importProgress.skippedFiles - importProgress.manifestSkippedFiles);
  const completedScheduled = importProgress.copiedFiles + copySkipped;
  const knownTotal = Math.max(importProgress.plannedFiles, completedScheduled);
  const progressPct = knownTotal > 0
    ? Math.min(100, Math.round((completedScheduled / knownTotal) * 100))
    : 0;

  res.json({
    ...importProgress,
    completedScheduled,
    knownTotal,
    progressPct,
  });
});

/**
 * POST /api/settings
 */
app.post("/api/settings", (req: Request, res: Response) => {
  const { archiveRoot, defaultDestinazione, defaultAutore, cartellePredefinite } = req.body as Partial<Settings>;
  const current = loadSettings();
  const normalizedCartelle = Array.isArray(cartellePredefinite)
    ? Array.from(new Set(cartellePredefinite
        .map((v) => sanitizeFolderSegment(String(v ?? "")))
        .filter((v) => v.length > 0)))
    : current.cartellePredefinite;

  const updated: Settings = {
    archiveRoot: typeof archiveRoot === "string" ? archiveRoot.trim() : current.archiveRoot,
    defaultDestinazione: typeof defaultDestinazione === "string" ? defaultDestinazione.trim() : current.defaultDestinazione,
    defaultAutore: typeof defaultAutore === "string" ? defaultAutore.trim() : current.defaultAutore,
    cartellePredefinite: normalizedCartelle,
  };
  saveSettings(updated);
  res.json({ ok: true, settings: updated });
});

/**
 * GET /api/sd-cards
 * Lists removable drives on Windows via PowerShell + WMI.
 * Returns empty array if none found or command unavailable.
 */
app.get("/api/sd-cards", (_req: Request, res: Response) => {
  const scriptPath = path.join(os.tmpdir(), `archivio-sd-cards-${Date.now()}.ps1`);
  try {
    const script = [
      '$query = "SELECT DeviceID,VolumeName,Size,FreeSpace FROM Win32_LogicalDisk WHERE DriveType=2"',
      "Get-WmiObject -Query $query | ForEach-Object {",
      "  Write-Host ($_.DeviceID + '|' + $_.VolumeName + '|' + $_.Size + '|' + $_.FreeSpace)",
      "}",
    ].join("\n");

    fs.writeFileSync(scriptPath, script, "utf-8");
    const raw = execSync(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}"`, {
      encoding: "utf-8",
      timeout: 7000,
    });

    const sdCards: SdCard[] = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l.includes("|"))
      .map((line) => {
        const [deviceId, volumeName, size, freeSpace] = line.split("|");
        return {
          deviceId: (deviceId ?? "").trim(),
          volumeName: (volumeName ?? "").trim(),
          totalSize: parseInt(size ?? "0", 10) || 0,
          freeSpace: parseInt(freeSpace ?? "0", 10) || 0,
          path: (deviceId ?? "").trim() + "\\",
        };
      })
      .filter((c) => c.deviceId.length > 0);

    res.json({ sdCards });
  } catch {
    res.json({ sdCards: [] });
  } finally {
    try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
  }
});

/**
 * GET /api/sd-preview?path=E:\
 * Returns file counts for a given path (used to preview SD card contents).
 */
app.get("/api/sd-preview", async (req: Request, res: Response) => {
  const sdPath = req.query["path"] as string | undefined;
  if (!sdPath) return void res.status(400).json({ error: "path mancante" });

  let normalized: string;
  try {
    normalized = resolveAndValidate(sdPath);
  } catch (e) {
    return void res.status(400).json({ error: String(e) });
  }

  if (!fs.existsSync(normalized)) {
    return void res.json({ totalFiles: 0, rawFiles: 0, jpgFiles: 0 });
  }

  try {
    const allFiles = await collectFiles(normalized);
    const RAW_EXT = new Set([".raf", ".cr2", ".cr3", ".arw", ".nef", ".dng", ".orf", ".rw2", ".pef", ".srw"]);
    const JPG_EXT = new Set([".jpg", ".jpeg"]);
    const rawFiles = allFiles.filter((f) => RAW_EXT.has(path.extname(f).toLowerCase())).length;
    const jpgFiles = allFiles.filter((f) => JPG_EXT.has(path.extname(f).toLowerCase())).length;
    res.json({ totalFiles: allFiles.length, rawFiles, jpgFiles });
  } catch {
    res.status(500).json({ error: "Impossibile leggere la SD" });
  }
});

/**
 * POST /api/filter-preview
 * Lightweight preview for multi-job SD filtering.
 */
app.post("/api/filter-preview", async (req: Request, res: Response) => {
  const {
    sdPath,
    fileNameIncludes,
    mtimeFrom,
    mtimeTo,
    maxSamples,
  } = req.body as {
    sdPath?: string;
    fileNameIncludes?: string;
    mtimeFrom?: string;
    mtimeTo?: string;
    maxSamples?: number;
  };

  if (!sdPath?.trim()) {
    return void res.status(400).json({ error: "sdPath mancante" });
  }

  let sdNorm: string;
  try {
    sdNorm = resolveAndValidate(sdPath);
  } catch (e) {
    return void res.status(400).json({ error: "Percorso non valido: " + String(e) });
  }

  if (!fs.existsSync(sdNorm)) {
    return void res.status(404).json({ error: "Percorso SD non trovato" });
  }

  const filter = parseFilterCriteria({ fileNameIncludes, mtimeFrom, mtimeTo });
  if (filter.error) {
    return void res.status(400).json({ error: filter.error });
  }

  const sampleLimit = Math.max(1, Math.min(5000, Number(maxSamples) || 36));
  const JPG_EXT = new Set([".jpg", ".jpeg"]);
  const RAW_EXT = new Set([".raf", ".cr2", ".cr3", ".arw", ".nef", ".dng", ".orf", ".rw2", ".pef", ".srw"]);

  let scannedFiles = 0;
  let matchedFiles = 0;
  let matchedRawFiles = 0;
  let matchedJpgFiles = 0;
  let minMtimeMs: number | null = null;
  let maxMtimeMsValue: number | null = null;
  const sampleRawFiles: Array<{ filePath: string; fileName: string; mtimeMs: number; size: number; ext: string; isJpg: boolean }> = [];
  const sampleJpgFiles: Array<{ filePath: string; fileName: string; mtimeMs: number; size: number; ext: string; isJpg: boolean }> = [];

  for await (const srcFile of walkFiles(sdNorm)) {
    scannedFiles += 1;
    if (!isImportableFile(srcFile)) continue;

    const fileName = path.basename(srcFile);
    let sourceStat: fs.Stats;
    try {
      sourceStat = await fs.promises.stat(srcFile);
    } catch {
      continue;
    }

    const sourceMtimeMs = sourceStat.mtimeMs;
    if (!isFileMatchingFilter(fileName, sourceMtimeMs, filter)) {
      continue;
    }

    matchedFiles += 1;
    const ext = path.extname(fileName).toLowerCase();
    const isRaw = RAW_EXT.has(ext);
    const isJpg = JPG_EXT.has(ext);
    if (isRaw) matchedRawFiles += 1;
    if (isJpg) matchedJpgFiles += 1;

    minMtimeMs = minMtimeMs === null ? sourceMtimeMs : Math.min(minMtimeMs, sourceMtimeMs);
    maxMtimeMsValue = maxMtimeMsValue === null ? sourceMtimeMs : Math.max(maxMtimeMsValue, sourceMtimeMs);

    if (isRaw && sampleRawFiles.length < sampleLimit) {
      sampleRawFiles.push({
        filePath: srcFile,
        fileName,
        mtimeMs: sourceMtimeMs,
        size: sourceStat.size,
        ext,
        isJpg: false,
      });
    }
    if (isJpg && sampleJpgFiles.length < sampleLimit) {
      sampleJpgFiles.push({
        filePath: srcFile,
        fileName,
        mtimeMs: sourceMtimeMs,
        size: sourceStat.size,
        ext,
        isJpg: true,
      });
    }
  }

  const sampleFiles: Array<{ filePath: string; fileName: string; mtimeMs: number; size: number; ext: string; isJpg: boolean }> = [];
  let rawIdx = 0;
  let jpgIdx = 0;
  while (sampleFiles.length < sampleLimit && (rawIdx < sampleRawFiles.length || jpgIdx < sampleJpgFiles.length)) {
    if (rawIdx < sampleRawFiles.length) {
      sampleFiles.push(sampleRawFiles[rawIdx]!);
      rawIdx += 1;
      if (sampleFiles.length >= sampleLimit) break;
    }
    if (jpgIdx < sampleJpgFiles.length) {
      sampleFiles.push(sampleJpgFiles[jpgIdx]!);
      jpgIdx += 1;
    }
  }

  sampleFiles.sort((a, b) => a.mtimeMs - b.mtimeMs);

  res.json({
    ok: true,
    scannedFiles,
    matchedFiles,
    matchedRawFiles,
    matchedJpgFiles,
    minMtimeMs,
    maxMtimeMs: maxMtimeMsValue,
    sampleFiles,
  });
});

/**
 * GET /api/preview-image
 * Returns a lightweight JPG thumbnail for preview cards.
 */
app.get("/api/preview-image", async (req: Request, res: Response) => {
  const sdPath = req.query["sdPath"] as string | undefined;
  const filePath = req.query["filePath"] as string | undefined;
  if (!sdPath || !filePath) {
    return void res.status(400).json({ error: "sdPath o filePath mancanti" });
  }

  let sdNorm: string;
  let fileNorm: string;
  try {
    sdNorm = resolveAndValidate(sdPath);
    fileNorm = resolveAndValidate(filePath);
  } catch (e) {
    return void res.status(400).json({ error: "Percorso non valido: " + String(e) });
  }

  const relativeToSd = path.relative(sdNorm, fileNorm);
  const isInsideSd = relativeToSd.length === 0 || (!relativeToSd.startsWith("..") && !path.isAbsolute(relativeToSd));
  if (!isInsideSd) {
    return void res.status(403).json({ error: "File fuori dal percorso SD selezionato" });
  }

  if (!fs.existsSync(fileNorm)) {
    return void res.status(404).json({ error: "File non trovato" });
  }

  try {
    const buffer = await sharp(fileNorm)
      .resize({ width: 280, height: 180, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer();
    res.setHeader("Content-Type", "image/jpeg");
    res.send(buffer);
  } catch {
    res.status(415).json({ error: "Impossibile generare anteprima" });
  }
});

/**
 * POST /api/import
 * Full import pipeline: create folders, copy files, (optionally) rename + compress.
 * Saves job to registry.
 */
app.post("/api/import", async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const {
    sdPath,
    nomeLavoro,
    dataLavoro,
    autore,
    destinazione,
    sottoCartella,
    contrattoLink,
    existingJobId,
    rinominaFile,
    generaJpg,
    fileNameIncludes,
    mtimeFrom,
    mtimeTo,
  } = req.body as ImportRequest;
  const settings = loadSettings();
  const effectiveDestinazione = destinazione?.trim() || settings.defaultDestinazione.trim() || settings.archiveRoot.trim();

  // ── Basic validation ─────────────────────────────────────────────────────────
  if (!sdPath || !dataLavoro || !autore?.trim()) {
    return void res.status(400).json({ error: "Campi obbligatori mancanti" });
  }
  if (!existingJobId && (!nomeLavoro?.trim() || !effectiveDestinazione)) {
    return void res.status(400).json({ error: "Per nuovo lavoro servono nome lavoro e destinazione" });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataLavoro)) {
    return void res.status(400).json({ error: "Formato data non valido — atteso YYYY-MM-DD" });
  }

  let sdNorm: string;
  let destNorm = "";
  try {
    sdNorm = resolveAndValidate(sdPath);
    if (!existingJobId) {
      destNorm = resolveAndValidate(effectiveDestinazione);
    }
  } catch (e) {
    return void res.status(400).json({ error: "Percorso non valido: " + String(e) });
  }

  if (!fs.existsSync(sdNorm)) {
    return void res.status(400).json({ error: "Percorso SD non trovato: " + sdNorm });
  }

  const jobsSnapshot = loadJobs();
  const existingJob = existingJobId
    ? jobsSnapshot.find((j) => j.id === existingJobId)
    : null;

  if (existingJobId && !existingJob) {
    return void res.status(404).json({ error: "Lavoro esistente non trovato" });
  }

  const folderName = existingJob
    ? existingJob.nomeCartella
    : buildFolderName(nomeLavoro.trim(), dataLavoro);
  const jobRoot = existingJob
    ? resolveAndValidate(existingJob.percorsoCartella)
    : path.join(destNorm, folderName);

  if (!existingJob && fs.existsSync(jobRoot)) {
    return void res.status(409).json({ error: "Cartella già esistente: " + folderName });
  }

  // ── Create folder structure ──────────────────────────────────────────────────
  const fotoSdDir = path.join(jobRoot, "FOTO_SD");
  const sottoCartellaPulita = sanitizeFolderSegment(sottoCartella ?? "");
  const targetFotoDir = sottoCartellaPulita
    ? path.join(fotoSdDir, sottoCartellaPulita)
    : fotoSdDir;
  const bassaQualitaDir = path.join(jobRoot, "BASSA_QUALITA");
  const exportDir = path.join(jobRoot, "EXPORT");

  try {
    fs.mkdirSync(fotoSdDir, { recursive: true });
    fs.mkdirSync(targetFotoDir, { recursive: true });
    fs.mkdirSync(bassaQualitaDir, { recursive: true });
    fs.mkdirSync(exportDir, { recursive: true });
  } catch (err) {
    return void res.status(500).json({ error: "Errore creazione cartelle: " + String(err) });
  }

  const safeNome = toSafeId(nomeLavoro.trim());
  const safeData = ymd(dataLavoro);
  const safeAutore = toSafeId(autore.trim());
  const safeContrattoLink = normalizeContractLink(contrattoLink);
  const filter = parseFilterCriteria({ fileNameIncludes, mtimeFrom, mtimeTo });
  if (filter.error) {
    return void res.status(400).json({ error: filter.error });
  }

  const scanSampleStartedAt = Date.now();
  const sampled = await collectSampleFiles(sdNorm, 50).catch(() => [] as string[]);
  const sampleFiles = sampled.filter((f) => isImportableFile(f)).slice(0, 30);
  const averageSize = await estimateAverageFileSize(sampleFiles);
  const initialCopyConcurrency = Math.max(
    COPY_CONCURRENCY_MIN,
    Math.min(COPY_CONCURRENCY_MAX, chooseCopyConcurrency(Math.max(sampleFiles.length, 30), averageSize))
  );
  const copyController = new AdaptiveCopyController(
    COPY_CONCURRENCY_MIN,
    COPY_CONCURRENCY_MAX,
    initialCopyConcurrency
  );
  const sampleMs = Date.now() - scanSampleStartedAt;

  let copiedCount = 0;
  let skippedCount = 0;
  let scannedFiles = 0;
  let plannedFiles = 0;
  let filteredOutFiles = 0;
  let manifestSkippedFiles = 0;
  const copiedDestPaths: string[] = [];
  const errors: string[] = [];
  const manifestPath = path.join(targetFotoDir, ".import-manifest.json");
  const manifest = loadImportManifest(manifestPath);
  let manifestDirty = 0;
  let lastManifestFlushAt = Date.now();
  let manifestFlushChain: Promise<void> = Promise.resolve();

  importProgress = createEmptyImportProgress();
  updateImportProgress({
    active: true,
    phase: "copying",
    startedAt: Date.now(),
    targetFolder: targetFotoDir,
    jpgEnabled: generaJpg,
    initialCopyConcurrency,
    copyConcurrency: copyController.getLimit(),
  });

  async function maybeFlushManifest(force = false): Promise<void> {
    const now = Date.now();
    if (!force && manifestDirty < 100 && now - lastManifestFlushAt < 3000) {
      return;
    }
    await saveImportManifestAsync(manifestPath, manifest);
    manifestDirty = 0;
    lastManifestFlushAt = now;
  }

  function queueManifestFlush(force = false): void {
    manifestFlushChain = manifestFlushChain
      .then(() => maybeFlushManifest(force))
      .catch((error) => {
        errors.push(`manifest flush: ${String(error)}`);
      });
  }

  // ── Streaming copy + optionally rename ──────────────────────────────────────
  const copyStartedAt = Date.now();
  const scanStartedAt = Date.now();
  const inFlight = new Set<Promise<void>>();

  async function scheduleCopy(task: {
    srcFile: string;
    originalName: string;
    destPath: string;
    sourceSize: number;
    manifestKey: string;
    sourceRelativePath: string;
    sourceMtimeMs: number;
  }): Promise<void> {
    let taskPromise: Promise<void>;
    taskPromise = (async () => {
      try {
        const result = await safeCopyFileVerified(task.srcFile, task.destPath, task.sourceSize);
        if (result === "copied") {
          copiedDestPaths.push(task.destPath);
          copiedCount += 1;
          updateImportProgress({
            copiedFiles: copiedCount,
            bytesCopied: importProgress.bytesCopied + task.sourceSize,
          });
          copyController.reportCompleted(task.sourceSize);
        } else {
          skippedCount += 1;
          updateImportProgress({ skippedFiles: skippedCount });
        }

        manifest[task.manifestKey] = {
          sourceRelativePath: task.sourceRelativePath,
          sourceSize: task.sourceSize,
          sourceMtimeMs: task.sourceMtimeMs,
          destFileName: path.basename(task.destPath),
          status: "done",
        };
        manifestDirty += 1;
        queueManifestFlush(false);
        updateImportProgress({
          copyConcurrency: copyController.getLimit(),
          inFlight: inFlight.size,
          plannedFiles,
          scannedFiles,
          manifestSkippedFiles,
        });
      } catch (err) {
        errors.push(`${task.originalName}: ${String(err)}`);
        updateImportProgress({ inFlight: inFlight.size });
      }
    })().finally(() => {
      inFlight.delete(taskPromise);
    });

    inFlight.add(taskPromise);
    updateImportProgress({ inFlight: inFlight.size, copyConcurrency: copyController.getLimit() });
    while (inFlight.size >= copyController.getLimit()) {
      await Promise.race(inFlight);
      updateImportProgress({ inFlight: inFlight.size, copyConcurrency: copyController.getLimit() });
    }
  }

  try {
    for await (const srcFile of walkFiles(sdNorm)) {
      scannedFiles += 1;
      updateImportProgress({ scannedFiles });
      if (!isImportableFile(srcFile)) {
        continue;
      }

      const originalName = path.basename(srcFile);
      const sourceRelativePath = path.relative(sdNorm, srcFile).replace(/\\/g, "/");

      let sourceStat: fs.Stats;
      try {
        sourceStat = await fs.promises.stat(srcFile);
      } catch (error) {
        errors.push(`${originalName}: impossibile leggere metadata sorgente (${String(error)})`);
        continue;
      }

      const sourceSize = sourceStat.size;
      const sourceMtimeMs = sourceStat.mtimeMs;

      if (!isFileMatchingFilter(originalName, sourceMtimeMs, filter)) {
        filteredOutFiles += 1;
        continue;
      }

      const manifestKey = buildManifestKey(sourceRelativePath, sourceSize, sourceMtimeMs);
      const manifestEntry = manifest[manifestKey];

      if (manifestEntry?.status === "done") {
        const manifestDestPath = path.join(targetFotoDir, manifestEntry.destFileName);
        try {
          const st = await fs.promises.stat(manifestDestPath);
          if (st.size === sourceSize) {
            skippedCount += 1;
            manifestSkippedFiles += 1;
            updateImportProgress({
              skippedFiles: skippedCount,
              manifestSkippedFiles,
            });
            continue;
          }
        } catch {
          /* file missing/invalid: fallback to normal copy */
        }
      }

      const destName = buildDestinationFileName({
        originalName,
        sourceRelativePath,
        rinominaFile,
        safeNome,
        safeData,
        safeAutore,
      });
      const destPath = path.join(targetFotoDir, destName);
      plannedFiles += 1;
      updateImportProgress({ plannedFiles });

      await scheduleCopy({
        srcFile,
        originalName,
        destPath,
        sourceSize,
        manifestKey,
        sourceRelativePath,
        sourceMtimeMs,
      });
    }

    await Promise.all(inFlight);
    queueManifestFlush(true);
    await manifestFlushChain;
  } catch (err) {
    updateImportProgress({
      active: false,
      phase: "error",
      error: "Errore durante scansione/copia streaming",
      inFlight: 0,
    });
    return void res.status(500).json({ error: "Errore durante scansione/copia streaming: " + String(err) });
  }
  const scanMs = Date.now() - scanStartedAt;
  const copyMs = Date.now() - copyStartedAt;

  // ── Generate compressed JPGs in BASSA_QUALITA ────────────────────────────────
  let jpgGenerati = 0;
  const compressStartedAt = Date.now();
  if (generaJpg) {
    updateImportProgress({ phase: "compressing", inFlight: 0 });
    const JPG_EXT = new Set([".jpg", ".jpeg"]);
    const jpgFiles = copiedDestPaths.filter((f) => JPG_EXT.has(path.extname(f).toLowerCase()));
    await runWithConcurrency(jpgFiles, JPG_CONCURRENCY, async (src) => {
      const relativeFromFotoSd = path.relative(fotoSdDir, src);
      const destPath = path.join(bassaQualitaDir, relativeFromFotoSd);
      try {
        await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
        await sharp(src)
          .resize({ width: 1920, withoutEnlargement: true })
          .jpeg({ quality: 70 })
          .toFile(destPath);
        jpgGenerati += 1;
        updateImportProgress({ jpgDone: jpgGenerati });
      } catch {
        /* Skip unreadable files silently */
      }
    });
  }
  const compressMs = Date.now() - compressStartedAt;

  // ── Save job ─────────────────────────────────────────────────────────────────
  let job: Job;
  if (existingJob) {
    job = incrementJobFiles(existingJob.id, copiedCount, safeContrattoLink) ?? {
      ...existingJob,
      numeroFile: (existingJob.numeroFile ?? 0) + copiedCount,
      contrattoLink: safeContrattoLink ?? existingJob.contrattoLink,
    };
  } else {
    job = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      nomeLavoro: sanitizeName(nomeLavoro.trim()),
      dataLavoro,
      autore: sanitizeName(autore.trim()),
      contrattoLink: safeContrattoLink,
      percorsoCartella: jobRoot,
      nomeCartella: folderName,
      dataCreazione: new Date().toISOString(),
      numeroFile: copiedCount,
    };
    appendJob(job);
  }

  res.json({
    ok: true,
    job,
    reusedExistingJob: Boolean(existingJob),
    copiedFiles: copiedCount,
    skippedFiles: skippedCount,
    jpgGenerati,
    cartellaFotoFinale: targetFotoDir,
    performance: {
      totalMs: Date.now() - startedAt,
      sampleMs,
      scanMs,
      copyMs,
      compressMs,
      scannedFiles,
      plannedFiles,
      filteredOutFiles,
      manifestSkippedFiles,
      copyConcurrency: copyController.getLimit(),
      initialCopyConcurrency,
      jpgConcurrency: JPG_CONCURRENCY,
    },
    errors: errors.slice(0, 20),
  });

  updateImportProgress({
    active: false,
    phase: "done",
    inFlight: 0,
    copiedFiles: copiedCount,
    skippedFiles: skippedCount,
    plannedFiles,
    scannedFiles,
    manifestSkippedFiles,
    copyConcurrency: copyController.getLimit(),
    error: null,
  });
});

/**
 * GET /api/jobs
 * Returns all saved jobs (newest first).
 */
app.get("/api/jobs", async (_req: Request, res: Response) => {
  const settings = loadSettings();
  const registeredJobs = cleanupMissingJobs()
    .map((job) => withArchiveMetadata(withFolderStatus(job), settings.archiveRoot));
  const discoveredJobs = await discoverArchiveJobs(settings.archiveRoot, registeredJobs);
  const allJobs = [...registeredJobs, ...discoveredJobs.map(withFolderStatus)]
    .sort((a, b) => new Date(b.dataCreazione).getTime() - new Date(a.dataCreazione).getTime());
  res.json(allJobs);
});

/**
 * DELETE /api/jobs/:id
 * Removes a job entry from the archive registry only.
 */
app.delete("/api/jobs/:id", (req: Request, res: Response) => {
  const paramId = req.params["id"];
  const jobId = typeof paramId === "string"
    ? paramId.trim()
    : Array.isArray(paramId)
      ? (paramId[0] ?? "").trim()
      : "";
  if (!jobId) return void res.status(400).json({ error: "id lavoro mancante" });

  const deleted = deleteJob(jobId);
  if (!deleted) {
    return void res.status(404).json({ error: "Lavoro non trovato" });
  }

  res.json({ ok: true });
});

/**
 * POST /api/jobs/:id/contract-link
 * Updates (or clears) contract link for an existing job.
 */
app.post("/api/jobs/:id/contract-link", (req: Request, res: Response) => {
  const paramId = req.params["id"];
  const jobId = typeof paramId === "string"
    ? paramId.trim()
    : Array.isArray(paramId)
      ? (paramId[0] ?? "").trim()
      : "";
  if (!jobId) return void res.status(400).json({ error: "id lavoro mancante" });

  const raw = typeof req.body?.contrattoLink === "string" ? req.body.contrattoLink : "";
  const trimmed = raw.trim();
  const normalized = normalizeContractLink(trimmed);

  if (trimmed && !normalized) {
    return void res.status(400).json({ error: "Link contratto non valido" });
  }

  const updated = updateJobContractLink(jobId, normalized);
  if (!updated) {
    return void res.status(404).json({ error: "Lavoro non trovato" });
  }

  res.json({ ok: true, job: updated });
});

/**
 * POST /api/jobs/:id/generate-low-quality
 * Generates compressed JPG copies in BASSA_QUALITA for an existing job.
 */
app.post("/api/jobs/:id/generate-low-quality", async (req: Request, res: Response) => {
  const paramId = req.params["id"];
  const jobId = typeof paramId === "string"
    ? paramId.trim()
    : Array.isArray(paramId)
      ? (paramId[0] ?? "").trim()
      : "";
  if (!jobId) return void res.status(400).json({ error: "id lavoro mancante" });

  const overwrite = Boolean(req.body?.overwrite);
  const jobs = loadJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return void res.status(404).json({ error: "Lavoro non trovato" });

  const fotoSdDir = path.join(job.percorsoCartella, "FOTO_SD");
  const bassaQualitaDir = path.join(job.percorsoCartella, "BASSA_QUALITA");
  if (!fs.existsSync(fotoSdDir)) {
    return void res.status(404).json({ error: "Cartella FOTO_SD non trovata" });
  }

  fs.mkdirSync(bassaQualitaDir, { recursive: true });

  const startedAt = Date.now();
  let totalJpg = 0;
  let generated = 0;
  let skippedExisting = 0;
  let errors = 0;

  const jpgFiles: string[] = [];
  const JPG_EXT = new Set([".jpg", ".jpeg"]);
  for await (const srcFile of walkFiles(fotoSdDir)) {
    if (JPG_EXT.has(path.extname(srcFile).toLowerCase())) {
      jpgFiles.push(srcFile);
    }
  }
  totalJpg = jpgFiles.length;

  await runWithConcurrency(jpgFiles, JPG_CONCURRENCY, async (src) => {
    const relativeFromFotoSd = path.relative(fotoSdDir, src);
    const destPath = path.join(bassaQualitaDir, relativeFromFotoSd);
    if (!overwrite) {
      try {
        await fs.promises.access(destPath, fs.constants.F_OK);
        skippedExisting += 1;
        return;
      } catch {
        /* continue and generate */
      }
    }

    try {
      await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
      await sharp(src)
        .resize({ width: 1920, withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toFile(destPath);
      generated += 1;
    } catch {
      errors += 1;
    }
  });

  res.json({
    ok: true,
    jobId,
    totalJpg,
    generated,
    skippedExisting,
    errors,
    overwrite,
    preserveStructure: true,
    outputDir: bassaQualitaDir,
    durationMs: Date.now() - startedAt,
  });
});

/**
 * POST /api/open-folder
 * Opens a folder in Windows Explorer. Path must exist.
 */
app.post("/api/open-folder", (req: Request, res: Response) => {
  const { folderPath } = req.body as { folderPath?: string };
  if (!folderPath) return void res.status(400).json({ error: "folderPath mancante" });

  let normalized: string;
  try {
    normalized = resolveAndValidate(folderPath);
  } catch (e) {
    return void res.status(400).json({ error: String(e) });
  }

  if (!fs.existsSync(normalized)) {
    return void res.status(404).json({ error: "Cartella non trovata" });
  }

  try {
    // explorer.exe returns non-zero exit codes normally; ignore them
    execSync(`explorer "${normalized}"`);
  } catch {
    /* intentionally ignored */
  }
  res.json({ ok: true });
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🗂️  Archivio Flow Server  →  http://localhost:${PORT}\n`);
});
