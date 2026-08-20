import express, { type Request, type Response } from "express";
import cors from "cors";
import { execFileSync, execSync } from "child_process";
import { createHash, randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import { fileURLToPath, pathToFileURL } from "url";
import { StudioFlowStore, type ImportSessionRecord } from "./studioflow-store.js";
import { resolveDestination, type CategoryMapping } from "./destination-resolver.js";
import { createBloomFilter } from "./bloom-filter.js";
import type { ArchivioArchiveRenameProgress } from "@photo-tools/desktop-contracts";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = parseInt(process.env.PORT ?? "3003", 10);
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));

// Jobs registry — stored next to this server file
const LEGACY_DATA_DIR = path.join(SERVER_DIR, "data");
const DATA_DIR = process.env.ARCHIVIO_FLOW_DATA_DIR?.trim()
  ? path.resolve(process.env.ARCHIVIO_FLOW_DATA_DIR)
  : LEGACY_DATA_DIR;
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const FILE_COUNT_CACHE_FILE = path.join(DATA_DIR, "file-count-cache.json");
const LOG_FILE = path.join(DATA_DIR, "studioflow.log.jsonl");
fs.mkdirSync(DATA_DIR, { recursive: true });
const studioFlowStore = new StudioFlowStore(DATA_DIR);

function writeStudioFlowLog(level: "info" | "warn" | "error", event: string, details: Record<string, unknown> = {}): void {
  try {
    fs.appendFileSync(LOG_FILE, `${JSON.stringify({ at:new Date().toISOString(), level, event, ...details })}\n`, "utf8");
  } catch { /* logging never blocks the workflow */ }
}

app.use((req, res, next) => {
  const correlationId = typeof req.headers["x-correlation-id"] === "string" ? req.headers["x-correlation-id"] : randomUUID();
  res.setHeader("X-Correlation-Id", correlationId);
  const startedAt = Date.now();
  res.on("finish", () => writeStudioFlowLog(res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info", "http_request", {
    correlationId, method:req.method, route:req.path, statusCode:res.statusCode, durationMs:Date.now() - startedAt,
  }));
  next();
});

function migrateLegacyDataIfNeeded(): void {
  if (DATA_DIR === LEGACY_DATA_DIR) return;
  if (process.env.ARCHIVIO_FLOW_SKIP_LEGACY_MIGRATION === "1") return;

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const legacyJobsPath = path.join(LEGACY_DATA_DIR, "jobs.json");
    const legacySettingsPath = path.join(LEGACY_DATA_DIR, "settings.json");

    if (!fs.existsSync(JOBS_FILE) && fs.existsSync(legacyJobsPath)) {
      fs.copyFileSync(legacyJobsPath, JOBS_FILE);
    }
    if (!fs.existsSync(SETTINGS_FILE) && fs.existsSync(legacySettingsPath)) {
      fs.copyFileSync(legacySettingsPath, SETTINGS_FILE);
    }
  } catch {
    /* ignore migration issues and continue with empty storage */
  }
}

migrateLegacyDataIfNeeded();

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SdCard {
  deviceId: string;
  volumeName: string;
  totalSize: number;
  freeSpace: number;
  path: string;
  volumeSerial?: string;
  filesystem?: string;
}

export interface Job {
  id: string;
  nomeLavoro: string;
  dataLavoro: string;
  autore: string;
  annoArchivio?: string;
  categoriaArchivio?: string;
  contrattoLink?: string;
  percorsoCartella: string;
  percorsoSelezione?: string;
  nomeCartella: string;
  dataCreazione: string;
  numeroFile: number;
  folderExists?: boolean;
  hasLowQualityFiles?: boolean;
  discoveredFromArchive?: boolean;
}

export type ArchiveAnalysisStatus = "aligned" | "rename-ready" | "needs-review" | "conflict";

export interface ArchiveAnalysisItem {
  jobId: string;
  currentFolderName: string;
  currentFolderPath: string;
  proposedFolderName: string | null;
  proposedFolderPath: string | null;
  nomeLavoro: string;
  dataLavoro: string | null;
  annoArchivio?: string;
  categoriaArchivio?: string;
  status: ArchiveAnalysisStatus;
  reason: string;
}

export interface ArchiveAnalysisResult {
  archiveRoot: string;
  warnings: string[];
  scannedJobs: number;
  registeredJobs: number;
  alignedJobs: number;
  renameReadyJobs: number;
  needsReviewJobs: number;
  conflictJobs: number;
  items: ArchiveAnalysisItem[];
}

export interface ArchiveRenameResult {
  ok: true;
  renamed: Array<{
    jobId: string;
    previousFolderPath: string;
    folderPath: string;
  }>;
}

export interface ArchiveRenameRequest {
  jobId: string;
  nomeLavoro?: string;
  dataLavoro?: string;
}

export interface JobSelectionCandidate {
  path: string;
  label: string;
  fileCount: number;
  depth: number;
}

export interface ArchiveHierarchyConfig {
  yearLevel: number | null;
  categoryLevel: number | null;
  jobLevel: number;
}

export interface ImportRequest {
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
  categoryKey?: string;
  destinationOverride?: boolean;
}

export interface CardSnapshot {
  id: string;
  cardId: string;
  volumeLabel: string;
  filesystem: string;
  capacityBytes: number;
  contentFingerprint: string;
  fileCount: number;
  totalBytes: number;
  captureSignature: string;
  createdAt: number;
  lastSeenAt: number;
}

export interface FileFingerprint {
  relativePath: string;
  filename: string;
  extension: string;
  size: number;
  mtimeMs: number;
  fastFingerprint: string; // level 1 partial hash
  fullHash: string | null; // level 2 full SHA-256
}

interface FilterCriteria {
  fileNameIncludes?: string;
  mtimeFrom?: string;
  mtimeTo?: string;
}

export interface ImportProgressState {
  active: boolean;
  phase: "idle" | "copying" | "compressing" | "done" | "error";
  startedAt: number | null;
  phaseStartedAt: number | null;
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
  jpgPlanned: number;
  jpgDone: number;
  currentFileName: string | null;
  error: string | null;
}

export interface LowQualityProgressState {
  active: boolean;
  jobId: string;
  jobName: string;
  phase: "idle" | "scanning" | "compressing" | "done" | "error";
  startedAt: number | null;
  phaseStartedAt: number | null;
  updatedAt: number;
  totalJpg: number;
  processedJpg: number;
  generated: number;
  skippedExisting: number;
  errors: number;
  overwrite: boolean;
  elapsedMs: number;
  estimatedRemainingSec: number | null;
  outputDir: string;
  sourceRoot: string;
  error: string | null;
}

const COPY_CONCURRENCY_MAX = 6;
const COPY_CONCURRENCY_MIN = 2;
const JPG_CONCURRENCY = 2;
const JOB_FILE_COUNT_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const RAW_EXT = new Set([
  ".raf", ".cr2", ".cr3", ".crw", ".arw", ".srf", ".sr2", ".nef", ".nrw",
  ".dng", ".orf", ".rw2", ".pef", ".srw", ".3fr", ".x3f", ".gpr",
]);
const JPG_EXT = new Set([".jpg", ".jpeg"]);
const PHOTO_SELECTOR_STANDARD_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const PHOTO_SELECTOR_RAW_EXT = new Set([
  ".cr2", ".cr3", ".crw",
  ".nef", ".nrw",
  ".arw", ".srf", ".sr2",
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
const COPY_EXCLUDED_BASENAMES = new Set([
  ".import-manifest.json",
]);

const jobFileCountCache = new Map<string, { count: number; expiresAt: number }>();

// ── Jobs list cache ───────────────────────────────────────────────────────────
// Avoids re-scanning the archive tree and re-hydrating every job on each page
// load. Returns the cached list immediately; a background refresh fires when
// the cached data is older than JOBS_LIST_CACHE_FRESH_MS.
const JOBS_LIST_CACHE_FRESH_MS = 30_000;   // serve from cache up to 30 s
const JOBS_LIST_CACHE_STALE_MS = 5 * 60_000; // max age before forced refresh

interface JobsListCache {
  jobs: Job[];
  cachedAt: number;
  refreshing: boolean;
}

let jobsListCache: JobsListCache | null = null;

function invalidateJobsListCache(): void {
  jobsListCache = null;
}

function loadPersistedFileCountCache(): void {
  try {
    if (fs.existsSync(FILE_COUNT_CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(FILE_COUNT_CACHE_FILE, "utf-8")) as Record<string, { count: number; expiresAt: number }>;
      const now = Date.now();
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value?.count === "number" && typeof value?.expiresAt === "number" && value.expiresAt > now) {
          jobFileCountCache.set(key, value);
        }
      }
    }
  } catch {
    /* ignore errors, start with empty cache */
  }
}

function saveFileCountCacheToDisk(): void {
  try {
    const now = Date.now();
    const obj: Record<string, { count: number; expiresAt: number }> = {};
    for (const [key, value] of jobFileCountCache) {
      if (value.expiresAt > now) {
        obj[key] = value;
      }
    }
    const tempPath = `${FILE_COUNT_CACHE_FILE}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(obj, null, 2), "utf-8");
    fs.renameSync(tempPath, FILE_COUNT_CACHE_FILE);
  } catch {
    /* ignore disk write errors */
  }
}

loadPersistedFileCountCache();

function createEmptyImportProgress(): ImportProgressState {
  return {
    active: false,
    phase: "idle",
    startedAt: null,
    phaseStartedAt: null,
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
    jpgPlanned: 0,
    jpgDone: 0,
    currentFileName: null,
    error: null,
  };
}

let importProgress: ImportProgressState = createEmptyImportProgress();
let importCancelRequested = false;

function createEmptyLowQualityProgress(): LowQualityProgressState {
  return {
    active: false,
    jobId: "",
    jobName: "",
    phase: "idle",
    startedAt: null,
    phaseStartedAt: null,
    updatedAt: Date.now(),
    totalJpg: 0,
    processedJpg: 0,
    generated: 0,
    skippedExisting: 0,
    errors: 0,
    overwrite: false,
    elapsedMs: 0,
    estimatedRemainingSec: null,
    outputDir: "",
    sourceRoot: "",
    error: null,
  };
}

let lowQualityProgress: LowQualityProgressState = createEmptyLowQualityProgress();

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Level 0 — Discovery: collect basic file info */
function collectFileDiscovery(filePath: string, relPath: string, stat: fs.Stats): FileFingerprint {
  return {
    relativePath: relPath,
    filename: path.basename(filePath),
    extension: path.extname(filePath),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    fastFingerprint: "",
    fullHash: null,
  };
}

/** Level 1 — Fast signature: partial hash from head/middle/tail */
async function computeFastFingerprint(filePath: string): Promise<string> {
  const stream = fs.createReadStream(filePath, { start: 0, end: 63 * 1023 });
  const headHash = createHash("sha256");
  return new Promise<string>((resolve, reject) => {
    stream.on("error", reject);
    stream.on("data", (chunk) => headHash.update(chunk));
    stream.on("end", () => {
      const midSize = 64 * 1024;
      const stat = fs.statSync(filePath);
      const middleStart = Math.max(0, Math.floor(stat.size / 2) - Math.floor(midSize / 2));
      const middleEnd = Math.min(stat.size, middleStart + midSize);
      const tailStart = Math.max(0, stat.size - midSize);

      const middleStream = fs.createReadStream(filePath, { start: middleStart, end: Math.max(middleStart, middleEnd - 1) });
      const midHash = createHash("sha256");
      middleStream.on("error", reject);
      middleStream.on("data", (chunk) => midHash.update(chunk));
      middleStream.on("end", () => {
        const tailStream = fs.createReadStream(filePath, { start: tailStart });
        const tailHash = createHash("sha256");
        tailStream.on("error", reject);
        tailStream.on("data", (chunk) => tailHash.update(chunk));
        tailStream.on("end", () => {
          const result = `${headHash.digest("hex")}|${midHash.digest("hex")}|${tailHash.digest("hex")}`;
          resolve(result);
        });
      });
    });
  });
}

/** Level 2 — Full hash (only when necessary) */
async function computeFullHash(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

/** Card content fingerprint: deterministic combine of file fingerprints */
function computeCardFingerprint(fingerprints: FileFingerprint[]): string {
  const sorted = [...fingerprints].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath, "it")
  );
  const normalized = sorted.map((fp) =>
    `${fp.relativePath}|${fp.size}|${fp.fastFingerprint}`
  ).join("|");
  return createHash("sha256").update(normalized).digest("hex");
}

/** Safe-to-format verification algorithm (spec §63) */
async function checkSafeToFormat(
  sdPath: string,
  archiveRoot: string,
  _hierarchy: ArchiveHierarchyConfig
): Promise<{
  status: "SAFE" | "PARTIAL" | "UNSAFE" | "UNKNOWN";
  totalFiles: number;
  verifiedFiles: number;
  unknownFiles: number;
  reason?: string;
  sessions: string[];
}> {
  // 1. scan current media files on SD
  let sdNorm: string;
  try {
    sdNorm = resolveAndValidate(sdPath);
  } catch (e) {
    return {
    status: "UNKNOWN",
    totalFiles: 0,
    verifiedFiles: 0,
    unknownFiles: 0,
    reason: "Percorso SD non valido",
    sessions: [],
  };
  }

  if (!fs.existsSync(sdNorm)) {
    return {
    status: "UNKNOWN",
    totalFiles: 0,
    verifiedFiles: 0,
    unknownFiles: 0,
    reason: "Percorso SD non trovato",
    sessions: [],
  };
  }

  const allFiles: FileFingerprint[] = [];
  const systemDirs = new Set(["$RECYCLE.BIN", "System Volume Information", "$WINRE_BACKUP_PARTITION.MARKER"]);

  for await (const srcFile of walkFiles(sdNorm)) {
    const baseName = path.basename(srcFile).toLowerCase();
    if (systemDirs.has(baseName)) continue;
    if (!isCopyableFile(srcFile)) continue;

    const relPath = path.relative(sdNorm, srcFile);
    const stat = await fs.promises.stat(srcFile);
    const ff: FileFingerprint = {
      relativePath: relPath,
      filename: path.basename(srcFile),
      extension: path.extname(srcFile),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      fastFingerprint: "", // will be computed if needed
      fullHash: null,
    };
    allFiles.push(ff);
  }

  const totalFiles = allFiles.length;
  if (totalFiles === 0) {
    return {
    status: "UNKNOWN",
    totalFiles: 0,
    verifiedFiles: 0,
    unknownFiles: 0,
    reason: "Nessun file trovabile sulla scheda",
    sessions: [],
  };
  }

  // Fingerprint progressivo: firma veloce per cercare candidati, hash completo
  // soltanto per confermare la prova che autorizza SAFE.
  for (const ff of allFiles) {
    ff.fastFingerprint = await computeFastFingerprint(path.join(sdNorm, ff.relativePath));
  }

  let verifiedFiles = 0;
  let unknownFiles = 0;
  const matchedSessionIds: string[] = [];
  const archiveRootNorm = archiveRoot.trim() ? resolveAndValidate(archiveRoot) : "";

  for (const file of allFiles) {
    const sourcePath = path.join(sdNorm, file.relativePath);
    const candidates = studioFlowStore.findSafeEvidence(file.size, file.fastFingerprint);
    let matched = false;
    for (const candidate of candidates) {
      try {
        const destination = resolveAndValidate(candidate.destinationPath);
        if (archiveRootNorm) {
          const relative = path.relative(archiveRootNorm, destination);
          if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
        }
        const destinationStat = await fs.promises.stat(destination);
        if (!destinationStat.isFile() || destinationStat.size !== file.size) continue;
        const [sourceHash, destinationHash] = await Promise.all([
          computeFullHash(sourcePath),
          computeFullHash(destination),
        ]);
        if (sourceHash !== destinationHash) continue;
        matched = true;
        matchedSessionIds.push(candidate.sessionId);
        break;
      } catch {
        // Prova non più valida (file spostato/cancellato/illeggibile): fail closed.
        continue;
      }
    }
    if (matched) verifiedFiles += 1;
    else unknownFiles += 1;
  }
  const uniqueSessionIds = [...new Set(matchedSessionIds)];

  let status: "SAFE" | "PARTIAL" | "UNSAFE" | "UNKNOWN";
  let reason: string | undefined;

  if (verifiedFiles === totalFiles) {
    status = "SAFE";
  } else if (verifiedFiles > 0 && verifiedFiles < totalFiles) {
    status = "PARTIAL";
    unknownFiles = totalFiles - verifiedFiles;
    reason = `${unknownFiles} file non risultano archiviati`;
  } else {
    status = "UNSAFE";
    reason = "Nessun file corrisponde a importazioni verificate precedenti";
  }

  return {
    status,
    totalFiles,
    verifiedFiles,
    unknownFiles,
    reason,
    sessions: uniqueSessionIds,
  };
}

/** Remove characters illegal in Windows file/folder names. */
function sanitizeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim();
}

export type ArchiveRenameProgress = ArchivioArchiveRenameProgress;

let archiveRenameRuntime: ArchiveRenameProgress = {
  operationId: null,
  phase: "idle",
  active: false,
  total: 0,
  completed: 0,
  currentFolderName: null,
  message: "Nessuna rinomina in corso.",
  startedAt: null,
  finishedAt: null,
  renamedCount: 0,
  error: null,
};

export function getArchiveRenameProgress(): ArchiveRenameProgress {
  return { ...archiveRenameRuntime };
}

interface VolumeIdentity {
  volumeLabel: string;
  volumeSerial: string | null;
  filesystem: string | null;
  capacityBytes: number;
}

async function readVolumeIdentity(sdPath: string): Promise<VolumeIdentity> {
  const resolved = resolveAndValidate(sdPath);
  let capacityBytes = 0;
  try {
    const stats = await fs.promises.statfs(resolved);
    capacityBytes = Number(stats.blocks) * Number(stats.bsize);
  } catch { /* optional signal */ }
  const fallback: VolumeIdentity = {
    volumeLabel: path.basename(path.parse(resolved).root) || path.parse(resolved).root,
    volumeSerial: null,
    filesystem: null,
    capacityBytes,
  };
  if (process.platform !== "win32") return fallback;
  const deviceId = path.parse(resolved).root.slice(0, 2).toUpperCase();
  if (!/^[A-Z]:$/.test(deviceId)) return fallback;
  try {
    const script = `$d=Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='${deviceId}'\"; if($d){$d | Select-Object VolumeName,VolumeSerialNumber,FileSystem,Size | ConvertTo-Json -Compress}`;
    const raw = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 7000 }).trim();
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      volumeLabel: String(value.VolumeName ?? fallback.volumeLabel),
      volumeSerial: value.VolumeSerialNumber ? String(value.VolumeSerialNumber) : null,
      filesystem: value.FileSystem ? String(value.FileSystem) : null,
      capacityBytes: Number(value.Size) || capacityBytes,
    };
  } catch {
    return fallback;
  }
}

export async function captureCardSnapshot(sdPath: string): Promise<CardSnapshot> {
  const sdNorm = resolveAndValidate(sdPath);
  const identity = await readVolumeIdentity(sdNorm);
  const fingerprints: FileFingerprint[] = [];
  let totalBytes = 0;
  for await (const filePath of walkFiles(sdNorm)) {
    if (!isCopyableFile(filePath)) continue;
    const stat = await fs.promises.stat(filePath);
    const relativePath = path.relative(sdNorm, filePath).replace(/\\/g, "/");
    const fingerprint = collectFileDiscovery(filePath, relativePath, stat);
    fingerprint.fastFingerprint = await computeFastFingerprint(filePath);
    fingerprints.push(fingerprint);
    totalBytes += stat.size;
  }
  const contentFingerprint = computeCardFingerprint(fingerprints);
  const physicalSignal = `${identity.volumeSerial ?? "no-serial"}|${identity.filesystem ?? "unknown"}|${identity.capacityBytes}`;
  const cardId = createHash("sha256").update(physicalSignal).digest("hex").slice(0, 24);
  const snapshotId = createHash("sha256").update(`${cardId}|${contentFingerprint}`).digest("hex").slice(0, 32);
  const now = Date.now();
  const snapshot: CardSnapshot = {
    id:snapshotId, cardId, volumeLabel:identity.volumeLabel, filesystem:identity.filesystem ?? "unknown",
    capacityBytes:identity.capacityBytes, contentFingerprint, fileCount:fingerprints.length, totalBytes,
    captureSignature:"fast-v1:head-middle-tail-sha256", createdAt:now, lastSeenAt:now,
  };
  studioFlowStore.saveCardSnapshot({ id:cardId, volumeSerial:identity.volumeSerial, filesystem:identity.filesystem, capacityBytes:identity.capacityBytes }, snapshot);
  return snapshot;
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

function isSameOrNestedPath(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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
    if (entry.isSymbolicLink()) continue;
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
    if (entry.isSymbolicLink()) continue;
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
    if (entry.isSymbolicLink()) continue;
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
  return rinominaFile ? `${base}_${suffix}${ext}` : `${base}${ext}`;
}

function isCopyableFile(filePath: string): boolean {
  return !COPY_EXCLUDED_BASENAMES.has(path.basename(filePath).toLowerCase());
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
    if (destStat.size === sourceSize && await filesHaveSameContent(src, dest)) {
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

      await replaceFileAtomically(tmp, dest);
      return "copied";
    } catch (error) {
      try { await fs.promises.unlink(tmp); } catch { /* ignore */ }
      if (attempt >= retries) throw error;
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
}

export function loadJobs(): Job[] {
  if (studioFlowStore.getMeta("jobs_json_migrated") !== "1") {
    let legacy: Job[] = [];
    try {
      if (fs.existsSync(JOBS_FILE)) legacy = JSON.parse(fs.readFileSync(JOBS_FILE, "utf-8")) as Job[];
    } catch { /* malformed legacy JSON is not authoritative */ }
    if (legacy.length > 0 && studioFlowStore.listDomainRecords<Job>("jobs").length === 0) {
      studioFlowStore.replaceDomainRecords("jobs", legacy);
    }
    studioFlowStore.setMeta("jobs_json_migrated", "1");
  }
  return studioFlowStore.listDomainRecords<Job>("jobs");
}

function saveJobs(jobs: Job[]): void {
  studioFlowStore.replaceDomainRecords("jobs", jobs);
}

function normalizeJobLookupId(rawValue: string): string {
  return rawValue.trim().toLowerCase();
}

function findJobByLookupId(jobs: Job[], requestedJobId: string): Job | null {
  const normalizedRequestedId = normalizeJobLookupId(requestedJobId);
  if (!normalizedRequestedId) return null;

  const directMatch = jobs.find((job) => normalizeJobLookupId(job.id) === normalizedRequestedId);
  if (directMatch) return directMatch;

  if (!normalizedRequestedId.startsWith("fs:")) return null;

  const requestedPath = normalizedRequestedId.slice(3);
  if (!requestedPath) return null;

  const byPathMatch = jobs.find((job) => {
    try {
      return path.resolve(job.percorsoCartella).toLowerCase() === requestedPath;
    } catch {
      return false;
    }
  });
  return byPathMatch ?? null;
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
  saveJobs(jobs);
}

function incrementJobFiles(
  jobId: string,
  incremento: number,
  contrattoLink?: string,
  percorsoSelezione?: string,
): Job | null {
  const jobs = loadJobs();
  const idx = jobs.findIndex((j) => j.id === jobId);
  if (idx < 0) return null;
  const current = jobs[idx]!;
  const updated: Job = {
    ...current,
    numeroFile: (current.numeroFile ?? 0) + Math.max(0, incremento),
    contrattoLink: contrattoLink ?? current.contrattoLink,
    percorsoSelezione: percorsoSelezione ?? current.percorsoSelezione,
  };
  jobs[idx] = updated;
  saveJobs(jobs);
  return updated;
}

export function updateJobContractLink(jobId: string, contrattoLink: string | undefined): Job | null {
  const jobs = loadJobs();
  const idx = jobs.findIndex((j) => j.id === jobId);
  if (idx < 0) return null;
  const current = jobs[idx]!;
  const updated: Job = {
    ...current,
    contrattoLink,
  };
  jobs[idx] = updated;
  saveJobs(jobs);
  return updated;
}

export function deleteJob(jobId: string): boolean {
  const jobs = loadJobs();
  const next = jobs.filter((job) => job.id !== jobId);
  if (next.length === jobs.length) return false;
  saveJobs(next);
  return true;
}

export function cleanupMissingJobs(): Job[] {
  // Missing paths stay in the registry until the user removes them explicitly.
  // Automatically pruning them loses contract links and other metadata after a
  // manual rename, a temporary drive outage, or a delayed network mount.
  return loadJobs();
}

function directoryHasAnyFile(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) return false;
  const stack = [dirPath];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isFile()) return true;
      if (entry.isDirectory()) {
        stack.push(path.join(current, entry.name));
      }
    }
  }

  return false;
}

function hasLowQualityOutputs(jobFolderPath: string): boolean {
  const directCandidates = [
    "BASSA_QUALITA",
    "BASSA QUALITA",
    "BASSA-QUALITA",
    "bassa_qualita",
    "bassa qualita",
  ];

  for (const candidate of directCandidates) {
    if (directoryHasAnyFile(path.join(jobFolderPath, candidate))) {
      return true;
    }
  }

  let rootEntries: fs.Dirent[];
  try {
    rootEntries = fs.readdirSync(jobFolderPath, { withFileTypes: true });
  } catch {
    return false;
  }

  const semanticCandidates = rootEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
      return normalized.includes("bassa") && normalized.includes("qualita");
    });

  for (const dirName of semanticCandidates) {
    if (directoryHasAnyFile(path.join(jobFolderPath, dirName))) {
      return true;
    }
  }

  return false;
}

function normalizeDirToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isLowQualityDirName(dirName: string): boolean {
  const normalized = normalizeDirToken(dirName);
  return normalized.includes("bassa") && normalized.includes("qualita");
}

function isExportDirName(dirName: string): boolean {
  const normalized = normalizeDirToken(dirName);
  return normalized === "export" || normalized.startsWith("export");
}

function shouldSkipSourceFileForLowQuality(sourceRoot: string, sourceFile: string): boolean {
  const relative = path.relative(sourceRoot, sourceFile);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return true;
  const firstSegment = relative.split(path.sep)[0] ?? "";
  if (!firstSegment) return false;
  return isLowQualityDirName(firstSegment) || isExportDirName(firstSegment);
}

export async function collectJpgSourcesForLowQuality(jobFolderPath: string): Promise<{ sourceRoot: string; jpgFiles: string[] }> {
  const candidateRoots = [
    path.join(jobFolderPath, "FOTO_SD"),
    jobFolderPath,
  ];
  for (const candidateRoot of candidateRoots) {
    if (!fs.existsSync(candidateRoot)) continue;

    const jpgFiles: string[] = [];
    for await (const srcFile of walkFiles(candidateRoot)) {
      if (!JPG_EXT.has(path.extname(srcFile).toLowerCase())) continue;
      if (shouldSkipSourceFileForLowQuality(candidateRoot, srcFile)) continue;
      jpgFiles.push(srcFile);
    }

    if (jpgFiles.length > 0) {
      return { sourceRoot: candidateRoot, jpgFiles };
    }
  }

  return { sourceRoot: path.join(jobFolderPath, "FOTO_SD"), jpgFiles: [] };
}

async function countImportableFilesInDirectory(rootPath: string, applyJobRootSkips = false): Promise<number> {
  if (!fs.existsSync(rootPath)) return 0;

  let count = 0;
  for await (const srcFile of walkFiles(rootPath)) {
    if (!isCopyableFile(srcFile)) continue;
    if (applyJobRootSkips && shouldSkipSourceFileForLowQuality(rootPath, srcFile)) continue;
    count += 1;
  }

  return count;
}

async function resolveJobFileCount(jobFolderPath: string): Promise<number> {
  const fotoSdDir = path.join(jobFolderPath, "FOTO_SD");
  if (fs.existsSync(fotoSdDir)) {
    const fotoSdCount = await countImportableFilesInDirectory(fotoSdDir);
    if (fotoSdCount > 0) return fotoSdCount;
  }

  return countImportableFilesInDirectory(jobFolderPath, true);
}

function isPhotoSelectorSupportedFile(fileName: string): boolean {
  if (fileName.startsWith("._")) {
    return false;
  }
  const ext = path.extname(fileName).toLowerCase();
  return PHOTO_SELECTOR_STANDARD_EXT.has(ext) || PHOTO_SELECTOR_RAW_EXT.has(ext);
}

interface PhotoSelectorFolderCandidate {
  folderPath: string;
  fileCount: number;
  depth: number;
  modifiedAt: number;
}

interface RankedPhotoSelectorFolderCandidate extends PhotoSelectorFolderCandidate {
  priority: number;
}

async function listPhotoSelectorFolderCandidates(
  baseFolderPath: string,
  maxDepth: number,
): Promise<PhotoSelectorFolderCandidate[]> {
  if (maxDepth < 0 || !fs.existsSync(baseFolderPath)) {
    return [];
  }

  const queue: Array<{ folderPath: string; depth: number }> = [{ folderPath: baseFolderPath, depth: 0 }];
  const seen = new Set<string>();
  const candidates: PhotoSelectorFolderCandidate[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    let normalizedCurrent = current.folderPath;
    try {
      normalizedCurrent = resolveAndValidate(current.folderPath);
    } catch {
      continue;
    }
    const normalizedKey = normalizedCurrent.toLowerCase();
    if (seen.has(normalizedKey)) {
      continue;
    }
    seen.add(normalizedKey);

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(normalizedCurrent, { withFileTypes: true });
    } catch {
      continue;
    }

    let fileCount = 0;
    const childDirectories: string[] = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isFile()) {
        if (isPhotoSelectorSupportedFile(entry.name)) {
          fileCount += 1;
        }
        continue;
      }
      if (!entry.isDirectory()) {
        continue;
      }
      if (isArchiveSystemDir(entry.name) || isLowQualityDirName(entry.name) || isExportDirName(entry.name)) {
        continue;
      }
      childDirectories.push(path.join(normalizedCurrent, entry.name));
    }

    if (fileCount > 0) {
      let modifiedAt = 0;
      try {
        const stats = await fs.promises.stat(normalizedCurrent);
        modifiedAt = Math.round(stats.mtimeMs);
      } catch {
        modifiedAt = 0;
      }
      candidates.push({
        folderPath: normalizedCurrent,
        fileCount,
        depth: current.depth,
        modifiedAt,
      });
    }

    if (current.depth >= maxDepth) {
      continue;
    }
    for (const childDirectory of childDirectories) {
      queue.push({
        folderPath: childDirectory,
        depth: current.depth + 1,
      });
    }
  }

  return candidates;
}

function buildPhotoSelectorRootCandidates(
  job: Job,
  jobRoot: string,
): Array<{ rootPath: string; priority: number; maxDepth: number }> {
  const fotoSdDir = path.join(jobRoot, "FOTO_SD");
  const autoreFolder = sanitizeFolderSegment(job.autore ?? "");
  const autoreDir = autoreFolder ? path.join(fotoSdDir, autoreFolder) : "";
  const explicitSelectionPath = typeof job.percorsoSelezione === "string"
    ? job.percorsoSelezione.trim()
    : "";

  const rootCandidates: Array<{ rootPath: string; priority: number; maxDepth: number }> = [];
  if (explicitSelectionPath) {
    try {
      const normalizedSelectionPath = resolveAndValidate(explicitSelectionPath);
      if (fs.existsSync(normalizedSelectionPath)) {
        rootCandidates.push({ rootPath: normalizedSelectionPath, priority: -1, maxDepth: 0 });
      }
    } catch {
      // Ignore invalid persisted path and continue with inferred candidates.
    }
  }
  if (autoreDir && fs.existsSync(autoreDir)) {
    rootCandidates.push({ rootPath: autoreDir, priority: 0, maxDepth: 2 });
  }
  if (fs.existsSync(fotoSdDir)) {
    rootCandidates.push({ rootPath: fotoSdDir, priority: 1, maxDepth: 2 });
  }
  rootCandidates.push({ rootPath: jobRoot, priority: 2, maxDepth: 2 });
  return rootCandidates;
}

async function collectJobPhotoSelectorCandidates(job: Job): Promise<RankedPhotoSelectorFolderCandidate[]> {
  let jobRoot: string;
  try {
    jobRoot = resolveAndValidate(job.percorsoCartella);
  } catch {
    return [];
  }
  if (!fs.existsSync(jobRoot)) {
    return [];
  }

  const rootCandidates = buildPhotoSelectorRootCandidates(job, jobRoot);
  const rankedCandidates: RankedPhotoSelectorFolderCandidate[] = [];
  const seenPaths = new Set<string>();

  for (const rootCandidate of rootCandidates) {
    const candidates = await listPhotoSelectorFolderCandidates(rootCandidate.rootPath, rootCandidate.maxDepth);
    for (const candidate of candidates) {
      const candidateKey = candidate.folderPath.toLowerCase();
      if (seenPaths.has(candidateKey)) {
        continue;
      }
      seenPaths.add(candidateKey);
      rankedCandidates.push({
        ...candidate,
        priority: rootCandidate.priority,
      });
    }
  }

  rankedCandidates.sort((left, right) =>
    left.priority - right.priority
    || right.depth - left.depth
    || right.fileCount - left.fileCount
    || right.modifiedAt - left.modifiedAt
    || left.folderPath.localeCompare(right.folderPath, "it")
  );

  return rankedCandidates;
}

async function resolveJobPhotoSelectorFolder(job: Job): Promise<string> {
  let jobRoot: string;
  try {
    jobRoot = resolveAndValidate(job.percorsoCartella);
  } catch {
    return job.percorsoCartella;
  }
  if (!fs.existsSync(jobRoot)) {
    return job.percorsoCartella;
  }

  const rankedCandidates = await collectJobPhotoSelectorCandidates(job);
  return rankedCandidates[0]?.folderPath ?? jobRoot;
}

function formatSelectionCandidateLabel(jobRoot: string, folderPath: string): string {
  const relativeToJobRoot = path.relative(jobRoot, folderPath);
  if (relativeToJobRoot.startsWith("..") || path.isAbsolute(relativeToJobRoot)) {
    return path.basename(folderPath) || folderPath;
  }
  if (!relativeToJobRoot || relativeToJobRoot === ".") {
    return "Cartella lavoro";
  }
  return relativeToJobRoot.split(path.sep).join(" / ");
}

function getJobFileCountCacheKey(jobFolderPath: string): string {
  return path.resolve(jobFolderPath).toLowerCase();
}

function readCachedJobFileCount(jobFolderPath: string): number | null {
  const cacheKey = getJobFileCountCacheKey(jobFolderPath);
  const cached = jobFileCountCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    jobFileCountCache.delete(cacheKey);
    return null;
  }
  return cached.count;
}

function writeCachedJobFileCount(jobFolderPath: string, count: number): void {
  jobFileCountCache.set(getJobFileCountCacheKey(jobFolderPath), {
    count,
    expiresAt: Date.now() + JOB_FILE_COUNT_CACHE_TTL_MS,
  });
  saveFileCountCacheToDisk();
}

function invalidateCachedJobFileCount(jobFolderPath: string): void {
  jobFileCountCache.delete(getJobFileCountCacheKey(jobFolderPath));
  saveFileCountCacheToDisk();
}

function withFolderStatus(job: Job): Job {
  return {
    ...job,
    folderExists: fs.existsSync(job.percorsoCartella),
    hasLowQualityFiles: hasLowQualityOutputs(job.percorsoCartella),
  };
}

export async function hydrateArchiveListJob(job: Job): Promise<Job> {
  const jobWithStatus = withFolderStatus(job);
  if (!jobWithStatus.folderExists) return jobWithStatus;

  const needsDynamicFileCount = jobWithStatus.discoveredFromArchive === true
    || jobWithStatus.id.startsWith("fs:")
    || (jobWithStatus.numeroFile ?? 0) <= 0;
  if (!needsDynamicFileCount) return jobWithStatus;

  const cachedCount = readCachedJobFileCount(jobWithStatus.percorsoCartella);
  if (cachedCount !== null) {
    return {
      ...jobWithStatus,
      numeroFile: cachedCount,
    };
  }

  try {
    const fileCount = await resolveJobFileCount(jobWithStatus.percorsoCartella);
    writeCachedJobFileCount(jobWithStatus.percorsoCartella, fileCount);
    return {
      ...jobWithStatus,
      numeroFile: fileCount,
    };
  } catch {
    return jobWithStatus;
  }
}

function withArchiveMetadata(job: Job, archiveRoot: string, hierarchy: ArchiveHierarchyConfig): Job {
  const location = extractArchiveLocationInfo(job.percorsoCartella, archiveRoot, hierarchy);
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

function sanitizeHierarchyLevel(rawValue: unknown, fallback: number | null, min = 1, max = 8): number | null {
  if (rawValue === undefined) return fallback;
  if (rawValue === null || rawValue === "") return null;
  const parsed = Number.parseInt(String(rawValue), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed <= 0) return null;
  return Math.min(max, Math.max(min, parsed));
}

export function normalizeArchiveHierarchy(raw: Partial<ArchiveHierarchyConfig> | undefined): ArchiveHierarchyConfig {
  const normalized: ArchiveHierarchyConfig = {
    yearLevel: sanitizeHierarchyLevel(raw?.yearLevel, 1),
    categoryLevel: sanitizeHierarchyLevel(raw?.categoryLevel, 2),
    jobLevel: sanitizeHierarchyLevel(raw?.jobLevel, 3) ?? 3,
  };

  if (normalized.yearLevel !== null && normalized.yearLevel >= normalized.jobLevel) {
    normalized.yearLevel = null;
  }
  if (normalized.categoryLevel !== null && normalized.categoryLevel >= normalized.jobLevel) {
    normalized.categoryLevel = null;
  }

  return normalized;
}

function getSegmentAtLevel(segments: string[], level: number | null): string | undefined {
  if (level === null || level <= 0) return undefined;
  const index = level - 1;
  if (index < 0 || index >= segments.length) return undefined;
  return segments[index];
}

function extractArchiveLocationInfo(folderPath: string, archiveRoot: string, hierarchy: ArchiveHierarchyConfig): ArchiveLocationInfo {
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
  if (segments.length === 0) return {};

  const annoArchivio = getSegmentAtLevel(segments, hierarchy.yearLevel);
  const categoriaArchivio = getSegmentAtLevel(segments, hierarchy.categoryLevel);

  if (annoArchivio || categoriaArchivio) {
    return {
      annoArchivio,
      categoriaArchivio,
    };
  }

  if (hierarchy.yearLevel === 1 && isYearFolder(path.basename(rootPath)) && segments.length >= 1) {
    return {
      annoArchivio: path.basename(rootPath),
      categoriaArchivio: categoriaArchivio ?? segments[0],
    };
  }

  return {};
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

export async function discoverArchiveJobs(
  archiveRoot: string,
  knownJobs: Job[],
  hierarchy: ArchiveHierarchyConfig,
  warnings: string[] = [],
): Promise<Job[]> {
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

  function pushDiscoveredJob(fullPath: string, folderName: string, folderStat: fs.Stats, relativeSegments: string[]): void {
    const normalizedFull = path.resolve(fullPath).toLowerCase();
    if (knownPaths.has(normalizedFull) || discoveredPaths.has(normalizedFull)) return;

    const fallbackIsoDate = new Date(folderStat.birthtimeMs || folderStat.mtimeMs).toISOString().slice(0, 10);
    const annoArchivio = getSegmentAtLevel(relativeSegments, hierarchy.yearLevel);
    const categoriaArchivio = getSegmentAtLevel(relativeSegments, hierarchy.categoryLevel);
    const fallbackLocation = extractArchiveLocationInfo(fullPath, rootPath, hierarchy);
    discovered.push({
      id: `fs:${normalizedFull}`,
      nomeLavoro: normalizeDiscoveredJobName(folderName, categoriaArchivio ?? fallbackLocation.categoriaArchivio ?? null),
      dataLavoro: normalizeDiscoveredJobDate(folderName, fallbackIsoDate),
      autore: "Archivio",
      annoArchivio: annoArchivio ?? fallbackLocation.annoArchivio,
      categoriaArchivio: categoriaArchivio ?? fallbackLocation.categoriaArchivio,
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
    } catch (error) {
      warnings.push(`Cartella non leggibile: ${dirPath} (${error instanceof Error ? error.message : String(error)})`);
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
      } catch (error) {
        warnings.push(`Impossibile leggere i dati della cartella: ${fullPath} (${error instanceof Error ? error.message : String(error)})`);
      }
    }

    return directories;
  }

  async function walkArchive(currentPath: string, depth: number, segments: string[]): Promise<void> {
    if (depth >= hierarchy.jobLevel) return;

    const dirs = await listDirectories(currentPath);
    for (const dir of dirs) {
      const nextDepth = depth + 1;
      const nextSegments = [...segments, dir.name];

      if (nextDepth === hierarchy.jobLevel) {
        pushDiscoveredJob(dir.fullPath, dir.name, dir.stat, nextSegments);
      } else {
        await walkArchive(dir.fullPath, nextDepth, nextSegments);
      }
    }
  }

  await walkArchive(rootPath, 0, []);
  return discovered;
}

export interface ArchiveIndexStatus {
  archiveId: string | null;
  rootPath: string;
  state: "idle" | "scanning" | "ready" | "error";
  entryCount: number;
  fileCount: number;
  lastFullScanAt: number | null;
  lastReconciledAt: number | null;
  lastError: string | null;
}

let archiveIndexRuntime: ArchiveIndexStatus = {
  archiveId: null, rootPath: "", state: "idle", entryCount: 0, fileCount: 0,
  lastFullScanAt: null, lastReconciledAt: null, lastError: null,
};
let archiveWatcher: fs.FSWatcher | null = null;
let archiveWatchDebounce: NodeJS.Timeout | null = null;
let archiveReconcileInterval: NodeJS.Timeout | null = null;
let archiveScanPromise: Promise<ArchiveIndexStatus> | null = null;
const pendingArchiveSubtrees = new Set<string>();
const ARCHIVE_FALLBACK_RECONCILE_MS = 6 * 60 * 60_000;

function archiveIdForRoot(rootPath: string): string {
  return createHash("sha256").update(path.resolve(rootPath).toLowerCase()).digest("hex").slice(0, 24);
}

export async function rebuildArchiveIndex(settings = loadSettings()): Promise<ArchiveIndexStatus> {
  if (archiveScanPromise) return archiveScanPromise;
  archiveScanPromise = (async () => {
    const rawRoot = settings.archiveRoot.trim();
    if (!rawRoot) throw new Error("Radice archivio non configurata");
    const rootPath = resolveAndValidate(rawRoot);
    if (!fs.existsSync(rootPath)) throw new Error("Radice archivio non trovata");
    const archiveId = archiveIdForRoot(rootPath);
    archiveIndexRuntime = { ...archiveIndexRuntime, archiveId, rootPath, state: "scanning", lastError: null };
    const entries: Array<{ relativePath: string; entryType: "file" | "directory"; size: number; mtimeMs: number }> = [];
    let scannedFileCount = 0;

    async function scanDirectory(directory: string): Promise<void> {
      const dirEntries = await fs.promises.readdir(directory, { withFileTypes: true });
      for (const entry of dirEntries) {
        if (isArchiveSystemDir(entry.name)) continue;
        const absolutePath = path.join(directory, entry.name);
        const relativePath = path.relative(rootPath, absolutePath).replace(/\\/g, "/");
        try {
          const stat = await fs.promises.stat(absolutePath);
          if (entry.isDirectory()) {
            entries.push({ relativePath, entryType: "directory", size: 0, mtimeMs: stat.mtimeMs });
            await scanDirectory(absolutePath);
          } else if (entry.isFile()) {
            entries.push({ relativePath, entryType: "file", size: stat.size, mtimeMs: stat.mtimeMs });
            scannedFileCount += 1;
          }
          if (entries.length % 250 === 0) {
            archiveIndexRuntime = {
              ...archiveIndexRuntime,
              entryCount:entries.length,
              fileCount:scannedFileCount,
            };
          }
        } catch {
          // File rimosso durante la scansione: la successiva riconciliazione lo recupera.
        }
      }
    }

    await scanDirectory(rootPath);
    studioFlowStore.upsertArchive(archiveId, rootPath, settings.archiveHierarchy);
    studioFlowStore.replaceArchiveEntries(archiveId, entries);
    const persisted = studioFlowStore.getArchiveStatus(archiveId);
    archiveIndexRuntime = { archiveId, rootPath, state: "ready", ...persisted, lastError: null };
    return archiveIndexRuntime;
  })().catch((error) => {
    archiveIndexRuntime = { ...archiveIndexRuntime, state: "error", lastError: error instanceof Error ? error.message : String(error) };
    throw error;
  }).finally(() => {
    archiveScanPromise = null;
  });
  return archiveScanPromise;
}

function normalizedArchiveSubtree(
  archiveRoot: string,
  hierarchy: ArchiveHierarchyConfig,
  changedPath: string,
): string | null {
  const absolutePath = path.isAbsolute(changedPath)
    ? path.resolve(changedPath)
    : path.resolve(archiveRoot, changedPath);
  const relativePath = path.relative(archiveRoot, absolutePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) return null;
  const segments = relativePath.split(/[\\/]+/u).filter(Boolean);
  if (segments.length === 0 || isArchiveSystemDir(segments[0]!)) return null;
  return segments.slice(0, Math.min(hierarchy.jobLevel, segments.length)).join("/");
}

async function collectArchiveSubtreeEntries(
  archiveRoot: string,
  relativePrefix: string,
): Promise<Array<{ relativePath: string; entryType: "file" | "directory"; size: number; mtimeMs: number }>> {
  const entries: Array<{ relativePath: string; entryType: "file" | "directory"; size: number; mtimeMs: number }> = [];
  const target = path.resolve(archiveRoot, ...relativePrefix.split("/"));
  if (!fs.existsSync(target)) return entries;

  async function visit(absolutePath: string): Promise<void> {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(absolutePath);
    } catch {
      return;
    }
    const relativePath = path.relative(archiveRoot, absolutePath).replace(/\\/g, "/");
    if (stat.isDirectory()) {
      entries.push({ relativePath, entryType: "directory", size: 0, mtimeMs: stat.mtimeMs });
      let children: fs.Dirent[];
      try {
        children = await fs.promises.readdir(absolutePath, { withFileTypes: true });
      } catch {
        return;
      }
      for (const child of children) {
        if (isArchiveSystemDir(child.name)) continue;
        await visit(path.join(absolutePath, child.name));
      }
    } else if (stat.isFile()) {
      entries.push({ relativePath, entryType: "file", size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }

  await visit(target);
  return entries;
}

export async function refreshArchiveIndexSubtree(
  changedPath: string,
  settings = loadSettings(),
): Promise<ArchiveIndexStatus> {
  const rawRoot = settings.archiveRoot.trim();
  if (!rawRoot) throw new Error("Radice archivio non configurata");
  const rootPath = resolveAndValidate(rawRoot);
  const relativePrefix = normalizedArchiveSubtree(rootPath, settings.archiveHierarchy, changedPath);
  if (!relativePrefix) return getArchiveIndexStatus();
  if (archiveScanPromise) await archiveScanPromise;

  const archiveId = archiveIdForRoot(rootPath);
  studioFlowStore.upsertArchive(archiveId, rootPath, settings.archiveHierarchy);
  const entries = await collectArchiveSubtreeEntries(rootPath, relativePrefix);
  studioFlowStore.replaceArchiveSubtree(archiveId, relativePrefix, entries);
  const persisted = studioFlowStore.getArchiveStatus(archiveId);
  archiveIndexRuntime = { archiveId, rootPath, state: "ready", ...persisted, lastError: null };
  writeStudioFlowLog("info", "archive_subtree_refreshed", {
    archiveId,
    relativePrefix,
    entries: entries.length,
    files: entries.filter((entry) => entry.entryType === "file").length,
  });
  return getArchiveIndexStatus();
}

function coalesceArchiveSubtrees(values: Iterable<string>): string[] {
  const sorted = [...new Set(values)].sort((a, b) => a.length - b.length || a.localeCompare(b));
  return sorted.filter((candidate, index) => !sorted.slice(0, index).some(
    (parent) => candidate === parent || candidate.startsWith(`${parent}/`),
  ));
}

async function flushArchiveSubtreeChanges(): Promise<void> {
  archiveWatchDebounce = null;
  if (importProgress.active || archiveRenameRuntime.active) {
    archiveWatchDebounce = setTimeout(() => void flushArchiveSubtreeChanges(), 1500);
    return;
  }
  const subtrees = coalesceArchiveSubtrees(pendingArchiveSubtrees);
  pendingArchiveSubtrees.clear();
  if (subtrees.length === 0) return;
  const settings = loadSettings();
  try {
    for (const subtree of subtrees) await refreshArchiveIndexSubtree(subtree, settings);
    await reconcileDiscoveredArchiveJobs(settings);
    invalidateJobsListCache();
  } catch (error) {
    writeStudioFlowLog("warn", "archive_incremental_refresh_failed", {
      subtrees,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function scheduleArchiveReconciliation(changedPath?: string | Buffer | null): void {
  const settings = loadSettings();
  const root = settings.archiveRoot.trim();
  if (!root || !changedPath) return;
  const subtree = normalizedArchiveSubtree(path.resolve(root), settings.archiveHierarchy, String(changedPath));
  if (!subtree) return;
  pendingArchiveSubtrees.add(subtree);
  if (archiveWatchDebounce) clearTimeout(archiveWatchDebounce);
  archiveWatchDebounce = setTimeout(() => void flushArchiveSubtreeChanges(), 1500);
}

function startArchiveFallbackReconciliation(): void {
  if (archiveReconcileInterval) return;
  archiveReconcileInterval = setInterval(() => {
    const settings = loadSettings();
    void reconcileDiscoveredArchiveJobs(settings)
      .then(() => invalidateJobsListCache())
      .catch(() => undefined);
  }, ARCHIVE_FALLBACK_RECONCILE_MS);
  archiveReconcileInterval.unref();
}

export function configureArchiveWatcher(settings = loadSettings()): void {
  archiveWatcher?.close();
  archiveWatcher = null;
  if (archiveReconcileInterval) clearInterval(archiveReconcileInterval);
  archiveReconcileInterval = null;
  const root = settings.archiveRoot.trim();
  if (!root || !fs.existsSync(root)) return;
  const normalizedRoot = path.resolve(root);
  const archiveId = archiveIdForRoot(normalizedRoot);
  const cached = studioFlowStore.getArchiveStatus(archiveId);
  const scanForCurrentArchiveIsRunning = Boolean(
    archiveScanPromise && archiveIndexRuntime.archiveId === archiveId,
  );
  archiveIndexRuntime = scanForCurrentArchiveIsRunning
    ? {
        ...archiveIndexRuntime,
        archiveId,
        rootPath: normalizedRoot,
        state: "scanning",
        lastError: null,
      }
    : {
        archiveId, rootPath: normalizedRoot,
        state: cached.lastFullScanAt ? "ready" : "idle",
        ...cached,
        lastError: null,
      };
  try {
    archiveWatcher = fs.watch(root, { recursive: true }, (_eventType, filename) => {
      scheduleArchiveReconciliation(filename);
    });
    archiveWatcher.on("error", () => {
      archiveWatcher?.close();
      archiveWatcher = null;
      startArchiveFallbackReconciliation();
    });
  } catch {
    // Senza watcher eseguiamo una verifica completa, ma non ogni pochi minuti.
    startArchiveFallbackReconciliation();
  }
}

export function getArchiveIndexStatus(): ArchiveIndexStatus {
  return { ...archiveIndexRuntime };
}

function createStableJobId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function reconcileDiscoveredArchiveJobs(settings: Settings): Promise<{ jobs: Job[]; registered: number; warnings: string[] }> {
  const registeredJobs = cleanupMissingJobs();
  const warnings: string[] = [];
  const discoveredJobs = await discoverArchiveJobs(
    settings.archiveRoot,
    registeredJobs,
    settings.archiveHierarchy,
    warnings,
  );
  if (discoveredJobs.length === 0) {
    return { jobs: registeredJobs, registered: 0, warnings };
  }

  // Reload after the asynchronous scan so an import completed in the meantime is not overwritten.
  const latestJobs = loadJobs();
  const knownPaths = new Set(latestJobs.map((job) => path.resolve(job.percorsoCartella).toLowerCase()));
  const additions: Job[] = [];

  for (const discovered of discoveredJobs) {
    const normalizedPath = path.resolve(discovered.percorsoCartella).toLowerCase();
    if (knownPaths.has(normalizedPath)) continue;
    knownPaths.add(normalizedPath);
    additions.push({
      ...discovered,
      id: createStableJobId(),
      discoveredFromArchive: true,
    });
  }

  if (additions.length > 0) {
    saveJobs([...additions, ...latestJobs]);
    invalidateJobsListCache();
  }

  return { jobs: [...additions, ...latestJobs], registered: additions.length, warnings };
}

function isPathInsideArchive(candidatePath: string, archiveRoot: string): boolean {
  const relative = path.relative(path.resolve(archiveRoot), path.resolve(candidatePath));
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function buildArchiveAnalysisItem(job: Job, archiveRoot: string): ArchiveAnalysisItem | null {
  if (!job.percorsoCartella || !fs.existsSync(job.percorsoCartella)) return null;
  if (!isPathInsideArchive(job.percorsoCartella, archiveRoot)) return null;

  const currentFolderPath = path.resolve(job.percorsoCartella);
  const currentFolderName = path.basename(currentFolderPath);
  const inferredDate = extractHistoricalIsoDate(currentFolderName);
  const categoryLabel = getArchiveCategoryLabel(job.categoriaArchivio ?? "") ?? job.categoriaArchivio ?? null;
  const inferredName = normalizeDiscoveredJobName(currentFolderName, categoryLabel);

  if (!inferredDate) {
    return {
      jobId: job.id,
      currentFolderName,
      currentFolderPath,
      proposedFolderName: null,
      proposedFolderPath: null,
      nomeLavoro: inferredName,
      dataLavoro: null,
      annoArchivio: job.annoArchivio,
      categoriaArchivio: job.categoriaArchivio,
      status: "needs-review",
      reason: "Data non riconoscibile dal nome della cartella: nessuna rinomina proposta.",
    };
  }

  const proposedFolderName = buildFolderName(inferredName, inferredDate);
  const proposedFolderPath = path.join(path.dirname(currentFolderPath), proposedFolderName);
  if (currentFolderName === proposedFolderName) {
    return {
      jobId: job.id,
      currentFolderName,
      currentFolderPath,
      proposedFolderName,
      proposedFolderPath,
      nomeLavoro: inferredName,
      dataLavoro: inferredDate,
      annoArchivio: job.annoArchivio,
      categoriaArchivio: job.categoriaArchivio,
      status: "aligned",
      reason: "Nome gia allineato allo standard Archivio Flow.",
    };
  }

  const isSameWindowsPath = currentFolderPath.toLowerCase() === proposedFolderPath.toLowerCase();
  if (!isSameWindowsPath && fs.existsSync(proposedFolderPath)) {
    return {
      jobId: job.id,
      currentFolderName,
      currentFolderPath,
      proposedFolderName,
      proposedFolderPath,
      nomeLavoro: inferredName,
      dataLavoro: inferredDate,
      annoArchivio: job.annoArchivio,
      categoriaArchivio: job.categoriaArchivio,
      status: "conflict",
      reason: "Esiste gia una cartella con il nome proposto.",
    };
  }

  return {
    jobId: job.id,
    currentFolderName,
    currentFolderPath,
    proposedFolderName,
    proposedFolderPath,
    nomeLavoro: inferredName,
    dataLavoro: inferredDate,
    annoArchivio: job.annoArchivio,
    categoriaArchivio: job.categoriaArchivio,
    status: "rename-ready",
    reason: "Data e nome riconosciuti: rinomina disponibile dopo conferma.",
  };
}

export async function analyzeArchive(settings = loadSettings()): Promise<ArchiveAnalysisResult> {
  const archiveRoot = settings.archiveRoot.trim();
  if (!archiveRoot) throw new Error("Configura prima la radice archivio nelle Impostazioni.");

  const resolvedRoot = resolveAndValidate(archiveRoot);
  if (!fs.existsSync(resolvedRoot)) throw new Error("Radice archivio non trovata.");

  configureArchiveWatcher(settings);
  const archiveId = archiveIdForRoot(resolvedRoot);
  if (!studioFlowStore.getArchiveStatus(archiveId).lastFullScanAt) {
    await rebuildArchiveIndex(settings);
  }

  const reconciled = await reconcileDiscoveredArchiveJobs(settings);
  const jobs = reconciled.jobs.map((job) => withArchiveMetadata(job, resolvedRoot, settings.archiveHierarchy));
  const items = jobs
    .map((job) => buildArchiveAnalysisItem(job, resolvedRoot))
    .filter((item): item is ArchiveAnalysisItem => item !== null)
    .sort((a, b) => a.currentFolderPath.localeCompare(b.currentFolderPath, "it"));

  return {
    archiveRoot: resolvedRoot,
    warnings: reconciled.warnings,
    scannedJobs: items.length,
    registeredJobs: reconciled.registered,
    alignedJobs: items.filter((item) => item.status === "aligned").length,
    renameReadyJobs: items.filter((item) => item.status === "rename-ready").length,
    needsReviewJobs: items.filter((item) => item.status === "needs-review").length,
    conflictJobs: items.filter((item) => item.status === "conflict").length,
    items,
  };
}

function remapNestedPath(value: string | undefined, previousRoot: string, nextRoot: string): string | undefined {
  if (!value) return value;
  const relative = path.relative(previousRoot, value);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return value;
  return relative ? path.join(nextRoot, relative) : nextRoot;
}

async function renameDirectoryPreservingCaseSupport(sourcePath: string, targetPath: string): Promise<void> {
  if (sourcePath === targetPath) return;
  if (sourcePath.toLowerCase() !== targetPath.toLowerCase()) {
    await fs.promises.rename(sourcePath, targetPath);
    return;
  }

  const temporaryPath = path.join(
    path.dirname(sourcePath),
    `.archivio-flow-rename-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  await fs.promises.rename(sourcePath, temporaryPath);
  try {
    await fs.promises.rename(temporaryPath, targetPath);
  } catch (error) {
    await fs.promises.rename(temporaryPath, sourcePath).catch(() => undefined);
    throw error;
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

async function filesHaveSameContent(firstPath: string, secondPath: string): Promise<boolean> {
  const [firstHash, secondHash] = await Promise.all([hashFile(firstPath), hashFile(secondPath)]);
  return firstHash === secondHash;
}

async function replaceFileAtomically(temporaryPath: string, destinationPath: string): Promise<void> {
  let destinationExists = false;
  try {
    destinationExists = (await fs.promises.stat(destinationPath)).isFile();
  } catch {
    destinationExists = false;
  }

  if (!destinationExists) {
    await fs.promises.rename(temporaryPath, destinationPath);
    return;
  }

  const backupPath = `${destinationPath}.backup.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  await fs.promises.rename(destinationPath, backupPath);
  try {
    await fs.promises.rename(temporaryPath, destinationPath);
  } catch (error) {
    await fs.promises.rename(backupPath, destinationPath).catch(() => undefined);
    throw error;
  }
  await fs.promises.unlink(backupPath).catch(() => undefined);
}

async function isUsableJpeg(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile() || stats.size <= 0) return false;
    const metadata = await sharp(filePath).metadata();
    return metadata.format === "jpeg" && Boolean(metadata.width && metadata.height);
  } catch {
    return false;
  }
}

async function writeLowQualityJpeg(sourcePath: string, destinationPath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  const temporaryPath = `${destinationPath}.part.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    await sharp(sourcePath)
      .resize({ width: 1920, withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toFile(temporaryPath);
    await replaceFileAtomically(temporaryPath, destinationPath);
  } catch (error) {
    await fs.promises.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function renameAnalyzedArchiveJobs(
  requests: Array<string | ArchiveRenameRequest>,
): Promise<ArchiveRenameResult> {
  const normalizedRequests = new Map<string, ArchiveRenameRequest>();
  for (const value of requests ?? []) {
    const request = typeof value === "string" ? { jobId: value } : value;
    const jobId = String(request?.jobId ?? "").trim();
    if (!jobId) continue;
    normalizedRequests.set(jobId, {
      jobId,
      nomeLavoro: typeof request.nomeLavoro === "string" ? request.nomeLavoro.trim() : undefined,
      dataLavoro: typeof request.dataLavoro === "string" ? request.dataLavoro.trim() : undefined,
    });
  }
  if (normalizedRequests.size === 0) throw new Error("Seleziona almeno una cartella da rinominare.");

  if (archiveRenameRuntime.active) {
    throw new Error("Una rinomina dell'archivio e gia in corso. Attendi il completamento prima di riprovare.");
  }

  const operationId = randomUUID();
  const startedAt = Date.now();
  archiveRenameRuntime = {
    operationId,
    phase: "preparing",
    active: true,
    total: normalizedRequests.size,
    completed: 0,
    currentFolderName: null,
    message: "Verifico le cartelle selezionate...",
    startedAt,
    finishedAt: null,
    renamedCount: 0,
    error: null,
  };
  writeStudioFlowLog("info", "archive_rename_started", { operationId, total: normalizedRequests.size });

  try {
    const settings = loadSettings();
    if (!settings.archiveRoot.trim()) throw new Error("Configura prima la radice archivio nelle Impostazioni.");
    const archiveRoot = resolveAndValidate(settings.archiveRoot.trim());
    if (!fs.existsSync(archiveRoot)) throw new Error("Radice archivio non trovata.");
    const jobs = loadJobs();
    const jobsById = new Map(jobs.map((job) => [job.id, job]));
    const operations: Array<{
      item: ArchiveAnalysisItem;
      job: Job;
      source: string;
      target: string;
      nomeLavoro: string;
      dataLavoro: string;
      proposedFolderName: string;
    }> = [];
    const targetPaths = new Set<string>();

    for (const [jobId, request] of normalizedRequests) {
      const job = jobsById.get(jobId);
      const item = job ? buildArchiveAnalysisItem(job, archiveRoot) : null;
      if (!item || !job) throw new Error("Una delle cartelle selezionate non e piu disponibile. Ripeti l'analisi.");
      const nomeLavoro = request.nomeLavoro || item.nomeLavoro.trim();
      const dataLavoro = request.dataLavoro || item.dataLavoro || "";
      const isoDateMatch = dataLavoro.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const parsedDate = isoDateMatch ? new Date(`${dataLavoro}T00:00:00Z`) : null;
      if (!nomeLavoro) throw new Error(`Inserisci il nome del lavoro per: ${item.currentFolderName}`);
      if (
        !isoDateMatch
        || !parsedDate
        || Number.isNaN(parsedDate.getTime())
        || parsedDate.toISOString().slice(0, 10) !== dataLavoro
      ) {
        throw new Error(`Inserisci una data valida per: ${item.currentFolderName}`);
      }

      const source = path.resolve(item.currentFolderPath);
      const proposedFolderName = buildFolderName(nomeLavoro, dataLavoro);
      const target = path.resolve(path.dirname(source), proposedFolderName);
      if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
        throw new Error(`Cartella sorgente non trovata: ${source}`);
      }
      if (source === target) throw new Error(`La cartella e gia allineata: ${item.currentFolderName}`);
      if (path.dirname(source).toLowerCase() !== path.dirname(target).toLowerCase()) {
        throw new Error("La rinomina non puo spostare un lavoro fuori dalla cartella corrente.");
      }
      if (source.toLowerCase() !== target.toLowerCase() && fs.existsSync(target)) {
        throw new Error(`La destinazione esiste gia: ${target}`);
      }
      const targetKey = target.toLowerCase();
      if (targetPaths.has(targetKey)) throw new Error(`Due cartelle produrrebbero lo stesso nome: ${target}`);
      targetPaths.add(targetKey);
      operations.push({ item, job, source, target, nomeLavoro, dataLavoro, proposedFolderName });
    }

    const completed: typeof operations = [];
    archiveRenameRuntime = {
      ...archiveRenameRuntime,
      phase: "renaming",
      message: `Rinomino 0 di ${operations.length} cartelle...`,
    };

    for (const operation of operations) {
      archiveRenameRuntime = {
        ...archiveRenameRuntime,
        currentFolderName: operation.item.currentFolderName,
        message: `Rinomino ${completed.length + 1} di ${operations.length}: ${operation.item.currentFolderName}`,
      };
      try {
        await renameDirectoryPreservingCaseSupport(operation.source, operation.target);
        completed.push(operation);
        archiveRenameRuntime = {
          ...archiveRenameRuntime,
          completed: completed.length,
          renamedCount: completed.length,
        };
      } catch (error) {
        for (const renamedOperation of completed.reverse()) {
          await renameDirectoryPreservingCaseSupport(renamedOperation.target, renamedOperation.source).catch(() => undefined);
        }
        throw error;
      }
    }

    const operationById = new Map(operations.map((operation) => [operation.job.id, operation]));
    const refreshedFileCounts = new Map<string, number>();
    archiveRenameRuntime = {
      ...archiveRenameRuntime,
      phase: "counting",
      completed: 0,
      currentFolderName: null,
      message: `Verifico i file di 0 di ${operations.length} cartelle...`,
    };
    for (const [index, operation] of operations.entries()) {
      archiveRenameRuntime = {
        ...archiveRenameRuntime,
        currentFolderName: operation.proposedFolderName,
        message: `Verifico i file di ${index + 1} di ${operations.length}: ${operation.proposedFolderName}`,
      };
      const fileCount = await countImportableFilesInDirectory(operation.target, true)
        .catch(() => operation.job.numeroFile);
      refreshedFileCounts.set(operation.job.id, fileCount);
      archiveRenameRuntime = { ...archiveRenameRuntime, completed: index + 1 };
    }
    archiveRenameRuntime = {
      ...archiveRenameRuntime,
      phase: "saving",
      currentFolderName: null,
      message: "Aggiorno il registro dei lavori...",
    };
    const updatedJobs = jobs.map((job) => {
      const operation = operationById.get(job.id);
      if (!operation) return job;
      return {
        ...job,
        nomeLavoro: operation.nomeLavoro,
        dataLavoro: operation.dataLavoro,
        percorsoCartella: operation.target,
        percorsoSelezione: remapNestedPath(job.percorsoSelezione, operation.source, operation.target),
        nomeCartella: operation.proposedFolderName,
        folderExists: true,
        numeroFile: refreshedFileCounts.get(job.id) ?? job.numeroFile,
      };
    });
    try {
      saveJobs(updatedJobs);
    } catch (error) {
      for (const renamedOperation of [...operations].reverse()) {
        await renameDirectoryPreservingCaseSupport(renamedOperation.target, renamedOperation.source).catch(() => undefined);
      }
      throw error;
    }
    invalidateJobsListCache();
    const result: ArchiveRenameResult = {
      ok: true,
      renamed: operations.map((operation) => ({
        jobId: operation.job.id,
        previousFolderPath: operation.source,
        folderPath: operation.target,
      })),
    };
    archiveRenameRuntime = {
      ...archiveRenameRuntime,
      phase: "completed",
      active: false,
      completed: operations.length,
      currentFolderName: null,
      message: `${operations.length} ${operations.length === 1 ? "cartella rinominata" : "cartelle rinominate"}.`,
      finishedAt: Date.now(),
      renamedCount: operations.length,
    };
    for (const operation of operations) {
      scheduleArchiveReconciliation(operation.source);
      scheduleArchiveReconciliation(operation.target);
    }
    writeStudioFlowLog("info", "archive_rename_completed", {
      operationId,
      total: operations.length,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rinomina archivio non riuscita";
    archiveRenameRuntime = {
      ...archiveRenameRuntime,
      phase: "error",
      active: false,
      currentFolderName: null,
      message,
      finishedAt: Date.now(),
      error: message,
    };
    writeStudioFlowLog("error", "archive_rename_failed", {
      operationId,
      completed: archiveRenameRuntime.completed,
      durationMs: Date.now() - startedAt,
      error: message,
    });
    throw error;
  }
}

export interface Settings {
  archiveRoot: string;
  defaultDestinazione: string;
  defaultAutore: string;
  cartellePredefinite: string[];
  archiveHierarchy: ArchiveHierarchyConfig;
  categoryMappings: CategoryMapping[];
}

export function loadSettings(): Settings {
  if (studioFlowStore.getMeta("settings_json_migrated") !== "1") {
    try {
      if (!fs.existsSync(SETTINGS_FILE) && fs.existsSync(`${SETTINGS_FILE}.tmp`)) fs.renameSync(`${SETTINGS_FILE}.tmp`, SETTINGS_FILE);
      if (fs.existsSync(SETTINGS_FILE) && !studioFlowStore.getSettings<Settings>()) {
        studioFlowStore.setSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")));
      }
    } catch { /* malformed legacy settings fall back to defaults */ }
    studioFlowStore.setMeta("settings_json_migrated", "1");
  }
  try {
    const raw = studioFlowStore.getSettings<Partial<Settings>>();
    if (raw) {
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
        archiveHierarchy: normalizeArchiveHierarchy(raw.archiveHierarchy),
        categoryMappings: Array.isArray(raw.categoryMappings) ? raw.categoryMappings.filter((item): item is CategoryMapping => Boolean(item && typeof item.categoryKey === "string")) : [],
      };
    }
  } catch { /* ignore */ }
  return {
    archiveRoot: "",
    defaultDestinazione: "",
    defaultAutore: "",
    cartellePredefinite: [],
    archiveHierarchy: normalizeArchiveHierarchy(undefined),
    categoryMappings: [],
  };
}

export function saveSettings(s: Settings): void {
  const previous = loadSettings();
  studioFlowStore.setSettings(s);
  const previousRoot = previous.archiveRoot.trim();
  const nextRoot = s.archiveRoot.trim();
  const archiveRootChanged = previousRoot.toLowerCase() !== nextRoot.toLowerCase();

  if (nextRoot && fs.existsSync(nextRoot)) {
    const resolvedRoot = path.resolve(nextRoot);
    const archiveId = archiveIdForRoot(resolvedRoot);
    studioFlowStore.upsertArchive(archiveId, resolvedRoot, s.archiveHierarchy);
  }

  if (archiveRootChanged) {
    configureArchiveWatcher(s);
    if (nextRoot && fs.existsSync(nextRoot)) {
      const archiveId = archiveIdForRoot(path.resolve(nextRoot));
      if (!studioFlowStore.getArchiveStatus(archiveId).lastFullScanAt) {
        void rebuildArchiveIndex(s).catch(() => undefined);
      }
    }
  }
}

function computeEstimatedRemainingSec(snapshot: ImportProgressState): number | null {
  if (snapshot.phase === "compressing" && snapshot.jpgEnabled) {
    const planned = Math.max(0, snapshot.jpgPlanned);
    if (planned <= 0) return null;
    const elapsedFromPhaseSec = snapshot.phaseStartedAt
      ? (Date.now() - snapshot.phaseStartedAt) / 1000
      : 0;
    if (elapsedFromPhaseSec < 1.5 || snapshot.jpgDone <= 0) return null;
    const remaining = Math.max(0, planned - snapshot.jpgDone);
    const itemsPerSec = snapshot.jpgDone / elapsedFromPhaseSec;
    if (itemsPerSec <= 0.01) return null;
    return Math.ceil(remaining / itemsPerSec);
  }

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

function getImportPhaseLabel(snapshot: ImportProgressState): string {
  if (snapshot.phase === "idle") return "In attesa";
  if (snapshot.phase === "done") return "Completato";
  if (snapshot.phase === "error") return snapshot.error?.includes("annullata") ? "Import annullato" : "Errore import";
  if (snapshot.phase === "compressing") {
    return snapshot.jpgDone > 0 ? "Compressione JPG" : "Preparazione JPG BQ";
  }
  if (snapshot.scannedFiles <= 0 || snapshot.plannedFiles <= 0) return "Scansione file";
  return "Copia in corso";
}

function buildImportProgressSnapshot(snapshot: ImportProgressState): ImportProgressState & {
  completedScheduled: number;
  knownTotal: number;
  progressPct: number;
  totalWorkItems: number;
  completedWorkItems: number;
  remainingWorkItems: number;
  overallProgressPct: number;
  currentPhaseLabel: string;
  currentSpeedFilesPerSec: number | null;
  currentSpeedBytesPerSec: number | null;
} {
  const copySkipped = Math.max(0, snapshot.skippedFiles - snapshot.manifestSkippedFiles);
  const completedScheduled = snapshot.copiedFiles + copySkipped;
  const knownTotal = Math.max(snapshot.plannedFiles, completedScheduled);
  const progressPct = knownTotal > 0
    ? Math.min(100, Math.round((completedScheduled / knownTotal) * 100))
    : 0;

  const includeJpgWork = snapshot.phase === "compressing" || snapshot.phase === "done";
  const totalWorkItems = Math.max(
    knownTotal + (includeJpgWork ? Math.max(0, snapshot.jpgPlanned) : 0),
    includeJpgWork ? completedScheduled + snapshot.jpgDone : completedScheduled,
  );
  const completedWorkItems = Math.max(
    0,
    completedScheduled + (includeJpgWork ? snapshot.jpgDone : 0),
  );
  const remainingWorkItems = Math.max(0, totalWorkItems - completedWorkItems);

  let overallProgressPct = totalWorkItems > 0
    ? Math.round((completedWorkItems / totalWorkItems) * 100)
    : 0;
  if (snapshot.phase !== "done" && snapshot.phase !== "idle" && overallProgressPct >= 100) {
    overallProgressPct = 99;
  }
  if ((snapshot.active || snapshot.phase === "copying" || snapshot.phase === "compressing") && totalWorkItems > 0) {
    overallProgressPct = Math.max(1, overallProgressPct);
  }

  let currentSpeedFilesPerSec: number | null = null;
  let currentSpeedBytesPerSec: number | null = null;
  if (snapshot.phase === "compressing") {
    const phaseElapsedSec = snapshot.phaseStartedAt ? (Date.now() - snapshot.phaseStartedAt) / 1000 : 0;
    if (phaseElapsedSec >= 0.5 && snapshot.jpgDone > 0) {
      currentSpeedFilesPerSec = snapshot.jpgDone / phaseElapsedSec;
    }
  } else if (snapshot.startedAt) {
    const elapsedSec = (Date.now() - snapshot.startedAt) / 1000;
    if (elapsedSec >= 0.5 && completedScheduled > 0) {
      currentSpeedFilesPerSec = completedScheduled / elapsedSec;
    }
    if (elapsedSec >= 0.5 && snapshot.bytesCopied > 0) {
      currentSpeedBytesPerSec = snapshot.bytesCopied / elapsedSec;
    }
  }

  return {
    ...snapshot,
    completedScheduled,
    knownTotal,
    progressPct,
    totalWorkItems,
    completedWorkItems,
    remainingWorkItems,
    overallProgressPct,
    currentPhaseLabel: getImportPhaseLabel(snapshot),
    currentSpeedFilesPerSec,
    currentSpeedBytesPerSec,
  };
}

function updateImportProgress(patch: Partial<ImportProgressState>): void {
  const nextPhase = patch.phase;
  const phaseChanged = Boolean(nextPhase && nextPhase !== importProgress.phase);
  importProgress = {
    ...importProgress,
    ...(phaseChanged ? { phaseStartedAt: Date.now() } : {}),
    ...patch,
  };
  if (phaseChanged && importProgress.phase === "done") {
    importProgress.phaseStartedAt = null;
  }
  if (importProgress.startedAt) {
    importProgress.elapsedMs = Date.now() - importProgress.startedAt;
  }
  importProgress.copyConcurrency = Math.max(COPY_CONCURRENCY_MIN, importProgress.copyConcurrency);
  importProgress.updatedAt = Date.now();
  importProgress.estimatedRemainingSec = computeEstimatedRemainingSec(importProgress);
}

function computeLowQualityEstimatedRemainingSec(snapshot: LowQualityProgressState): number | null {
  if (!snapshot.active || snapshot.phase !== "compressing") return null;
  if (snapshot.totalJpg <= 0 || snapshot.processedJpg <= 0) return null;
  if (!snapshot.phaseStartedAt) return null;

  const elapsedSec = (Date.now() - snapshot.phaseStartedAt) / 1000;
  if (elapsedSec < 1.5) return null;

  const remaining = Math.max(0, snapshot.totalJpg - snapshot.processedJpg);
  const itemsPerSec = snapshot.processedJpg / elapsedSec;
  if (itemsPerSec <= 0.01) return null;
  return Math.ceil(remaining / itemsPerSec);
}

function updateLowQualityProgress(patch: Partial<LowQualityProgressState>): void {
  const nextPhase = patch.phase;
  const phaseChanged = Boolean(nextPhase && nextPhase !== lowQualityProgress.phase);
  lowQualityProgress = {
    ...lowQualityProgress,
    ...(phaseChanged ? { phaseStartedAt: Date.now() } : {}),
    ...patch,
  };
  if (lowQualityProgress.startedAt) {
    lowQualityProgress.elapsedMs = Date.now() - lowQualityProgress.startedAt;
  }
  if (phaseChanged && lowQualityProgress.phase === "done") {
    lowQualityProgress.phaseStartedAt = null;
  }
  lowQualityProgress.updatedAt = Date.now();
  lowQualityProgress.estimatedRemainingSec = computeLowQualityEstimatedRemainingSec(lowQualityProgress);
}

interface MockInvocationResult {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
}

function createMockResponse(resolve: (result: MockInvocationResult) => void): Response {
  let statusCode = 200;
  const headers: Record<string, string> = {};
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(body: unknown) {
      resolve({ statusCode, body, headers });
      return response;
    },
    send(body: unknown) {
      resolve({ statusCode, body, headers });
      return response;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return response;
    },
  } as unknown as Response;

  return response;
}

async function invokeHandler(
  handler: (req: Request, res: Response) => void | Promise<void>,
  request: Partial<Pick<Request, "body" | "query" | "params">>,
): Promise<MockInvocationResult> {
  return await new Promise<MockInvocationResult>((resolve, reject) => {
    const req = {
      body: request.body ?? {},
      query: request.query ?? {},
      params: request.params ?? {},
    } as Request;
    const res = createMockResponse(resolve);

    Promise.resolve(handler(req, res)).catch(reject);
  });
}

export async function cancelImportService(): Promise<{ ok: boolean; active: boolean }> {
  importCancelRequested = importProgress.active;
  if (importProgress.active) {
    updateImportProgress({
      error: "Importazione in annullamento...",
    });
  }
  return { ok: true, active: importProgress.active };
}

// ── Routes ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/browse-folder
 * Opens a native Windows folder browser dialog and returns the selected path.
 */
const browseFolderHandler = (req: Request, res: Response) => {
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
};
app.post("/api/browse-folder", browseFolderHandler);

/**
 * GET /api/settings
 */
const getSettingsHandler = (_req: Request, res: Response) => {
  res.json(loadSettings());
};
app.get("/api/settings", getSettingsHandler);

/**
 * GET /api/import-progress
 * Returns live import progress snapshot for UI polling.
 */
const getImportProgressHandler = (_req: Request, res: Response) => {
  res.json(buildImportProgressSnapshot(importProgress));
};
app.get("/api/import-progress", getImportProgressHandler);

/**
 * POST /api/import-cancel
 * Requests cancellation for the active import operation.
 */
const cancelImportHandler = async (_req: Request, res: Response) => {
  const result = await cancelImportService();
  res.json(result);
};
app.post("/api/import-cancel", cancelImportHandler);

/**
 * GET /api/low-quality-progress
 * Returns progress snapshot for BASSA_QUALITA generation.
 */
const getLowQualityProgressHandler = (_req: Request, res: Response) => {
  const progressPct = lowQualityProgress.totalJpg > 0
    ? Math.min(100, Math.round((lowQualityProgress.processedJpg / lowQualityProgress.totalJpg) * 100))
    : 0;

  res.json({
    ...lowQualityProgress,
    progressPct,
  });
};
app.get("/api/low-quality-progress", getLowQualityProgressHandler);

/**
 * POST /api/settings
 */
const saveSettingsHandler = (req: Request, res: Response) => {
  const { archiveRoot, defaultDestinazione, defaultAutore, cartellePredefinite, archiveHierarchy, categoryMappings } = req.body as Partial<Settings>;
  const current = loadSettings();
  const normalizedCartelle = Array.isArray(cartellePredefinite)
    ? Array.from(new Set(cartellePredefinite
        .map((v) => sanitizeFolderSegment(String(v ?? "")))
        .filter((v) => v.length > 0)))
    : current.cartellePredefinite;
  const normalizedHierarchy = normalizeArchiveHierarchy(archiveHierarchy ?? current.archiveHierarchy);

  const updated: Settings = {
    archiveRoot: typeof archiveRoot === "string" ? archiveRoot.trim() : current.archiveRoot,
    defaultDestinazione: typeof defaultDestinazione === "string" ? defaultDestinazione.trim() : current.defaultDestinazione,
    defaultAutore: typeof defaultAutore === "string" ? defaultAutore.trim() : current.defaultAutore,
    cartellePredefinite: normalizedCartelle,
    archiveHierarchy: normalizedHierarchy,
    categoryMappings: Array.isArray(categoryMappings)
      ? categoryMappings.map((item) => ({
          id:sanitizeFolderSegment(String(item.id || item.categoryKey)), categoryKey:sanitizeFolderSegment(String(item.categoryKey)).toLowerCase(),
          displayName:sanitizeName(String(item.displayName)), relativePathPattern:String(item.relativePathPattern ?? "").trim(),
          jobFolderPattern:String(item.jobFolderPattern || "{date} - {client} - {date-dmy}").trim(), enabled:item.enabled !== false,
        })).filter((item) => item.id && item.categoryKey && item.displayName && item.relativePathPattern)
      : current.categoryMappings,
  };
  saveSettings(updated);
  invalidateJobsListCache();
  res.json({ ok: true, settings: updated });
};
app.post("/api/settings", saveSettingsHandler);

/**
 * GET /api/sd-cards
 * Lists removable drives on Windows via PowerShell + WMI.
 * Returns empty array if none found or command unavailable.
 */
const getSdCardsHandler = (_req: Request, res: Response) => {
  const scriptPath = path.join(os.tmpdir(), `archivio-sd-cards-${Date.now()}.ps1`);
  try {
    const script = [
      '$query = "SELECT DeviceID,VolumeName,VolumeSerialNumber,FileSystem,Size,FreeSpace FROM Win32_LogicalDisk WHERE DriveType=2"',
      "Get-WmiObject -Query $query | ForEach-Object {",
      "  Write-Host ($_.DeviceID + '|' + $_.VolumeName + '|' + $_.VolumeSerialNumber + '|' + $_.FileSystem + '|' + $_.Size + '|' + $_.FreeSpace)",
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
        const [deviceId, volumeName, volumeSerial, filesystem, size, freeSpace] = line.split("|");
        return {
          deviceId: (deviceId ?? "").trim(),
          volumeName: (volumeName ?? "").trim(),
          totalSize: parseInt(size ?? "0", 10) || 0,
          freeSpace: parseInt(freeSpace ?? "0", 10) || 0,
          path: (deviceId ?? "").trim() + "\\",
          volumeSerial: (volumeSerial ?? "").trim(),
          filesystem: (filesystem ?? "").trim(),
        };
      })
      .filter((c) => c.deviceId.length > 0);

    res.json({ sdCards });
  } catch {
    res.json({ sdCards: [] });
  } finally {
    try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
  }
};
app.get("/api/sd-cards", getSdCardsHandler);

/**
 * GET /api/sd-preview?path=E:\
 * Returns file counts for a given path (used to preview SD card contents).
 */
const getSdPreviewHandler = async (req: Request, res: Response) => {
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
    const rawFiles = allFiles.filter((f) => RAW_EXT.has(path.extname(f).toLowerCase())).length;
    const jpgFiles = allFiles.filter((f) => JPG_EXT.has(path.extname(f).toLowerCase())).length;
    res.json({ totalFiles: allFiles.length, rawFiles, jpgFiles });
  } catch {
    res.status(500).json({ error: "Impossibile leggere la SD" });
  }
};
app.get("/api/sd-preview", getSdPreviewHandler);

const safeToFormatHandler = async (req: Request, res: Response) => {
  const sdPath = String(req.body?.sdPath ?? "").trim();
  if (!sdPath) return void res.status(400).json({ error: "Percorso SD mancante" });
  const settings = loadSettings();
  if (!settings.archiveRoot.trim()) {
    return void res.status(409).json({ error: "Archivio non configurato: verifica impossibile" });
  }
  try {
    res.json(await checkSafeToFormat(sdPath, settings.archiveRoot, settings.archiveHierarchy));
  } catch (error) {
    res.status(500).json({
      status: "UNKNOWN", totalFiles: 0, verifiedFiles: 0, unknownFiles: 0, sessions: [],
      reason: `Verifica non completata: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
};
app.post("/api/sd/safe-to-format", safeToFormatHandler);

const studioFlowStatusHandler = (_req: Request, res: Response) => {
  res.json({ health: studioFlowStore.health(), archiveIndex: getArchiveIndexStatus(), sessions: studioFlowStore.listSessions(50), resumable: studioFlowStore.listResumableSessions() });
};
app.get("/api/studioflow/status", studioFlowStatusHandler);
const driveRegistryBatchHandler = (_req: Request, res: Response) => {
  const outbox = studioFlowStore.listPendingOutbox(200);
  res.json({
    schemaVersion: 1,
    app: "studioflow",
    generatedAt: new Date().toISOString(),
    outbox,
    sessions: studioFlowStore.listSessions(1000).filter((item) => item.status === "COMPLETED").map((item) => ({
      id:item.id, cardSnapshotId:item.cardSnapshotId, jobId:item.jobId, archiveId:item.archiveId,
      status:item.status, completedAt:item.completedAt, verifiedAt:item.verifiedAt, plannedFiles:item.plannedFiles,
      verifiedFiles:item.verifiedFiles, duplicateFiles:item.duplicateFiles, failedFiles:item.failedFiles,
    })),
    cardSnapshots: studioFlowStore.listCardSnapshots(1000).map((item) => ({
      id:item.id, cardId:item.cardId, contentFingerprint:item.contentFingerprint, fileCount:item.fileCount,
      totalBytes:item.totalBytes, captureSignature:item.captureSignature, createdAt:item.createdAt, lastSeenAt:item.lastSeenAt,
    })),
    fingerprintBloom: createBloomFilter(studioFlowStore.listVerifiedFingerprintKeys(), 65_536, 6),
  });
};
app.get("/api/studioflow/drive-registry-batch", driveRegistryBatchHandler);
const reconcileArchiveIndexHandler = async (_req: Request, res: Response) => {
  try {
    res.json(await rebuildArchiveIndex());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
};
app.post("/api/archive/reconcile", reconcileArchiveIndexHandler);

/**
 * POST /api/filter-preview
 * Lightweight preview for multi-job SD filtering.
 */
const getFilterPreviewHandler = async (req: Request, res: Response) => {
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
    if (!isCopyableFile(srcFile)) continue;

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
};
app.post("/api/filter-preview", getFilterPreviewHandler);

/**
 * GET /api/preview-image
 * Returns a lightweight JPG thumbnail for preview cards.
 */
const getPreviewImageHandler = async (req: Request, res: Response) => {
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
};
app.get("/api/preview-image", getPreviewImageHandler);

/**
 * POST /api/import
 * Full import pipeline: create folders, copy files, (optionally) rename + compress.
 * Saves job to registry.
 */
const importHandler = async (req: Request, res: Response) => {
  const startedAt = Date.now();
  importCancelRequested = false;
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
    categoryKey,
    destinationOverride,
  } = req.body as ImportRequest;
  const requestedExistingJobId = typeof existingJobId === "string" ? existingJobId.trim() : "";
  const settings = loadSettings();
  const configuredDestination = destinazione?.trim() || settings.defaultDestinazione.trim() || settings.archiveRoot.trim();
  const mappingAvailable = settings.categoryMappings.some((item) => item.enabled && item.categoryKey === categoryKey);
  const resolvedAutomaticDestination = !requestedExistingJobId && mappingAvailable && settings.archiveRoot.trim()
    ? resolveDestination({
        archiveId:archiveIdForRoot(settings.archiveRoot), archiveRoot:settings.archiveRoot, mappings:settings.categoryMappings,
        categoryKey, eventDate:dataLavoro, jobName:nomeLavoro,
        overrideParent:destinationOverride ? configuredDestination : undefined,
      })
    : null;
  const effectiveDestinazione = resolvedAutomaticDestination?.absoluteParentPath ?? configuredDestination;

  // ── Basic validation ─────────────────────────────────────────────────────────
  if (!sdPath || !dataLavoro || !autore?.trim()) {
    return void res.status(400).json({ error: "Campi obbligatori mancanti" });
  }
  if (!requestedExistingJobId && (!nomeLavoro?.trim() || !effectiveDestinazione)) {
    return void res.status(400).json({ error: "Per nuovo lavoro servono nome lavoro e destinazione" });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataLavoro)) {
    return void res.status(400).json({ error: "Formato data non valido — atteso YYYY-MM-DD" });
  }

  let sdNorm: string;
  let destNorm = "";
  try {
    sdNorm = resolveAndValidate(sdPath);
    if (!requestedExistingJobId) {
      destNorm = resolveAndValidate(effectiveDestinazione);
    }
  } catch (e) {
    return void res.status(400).json({ error: "Percorso non valido: " + String(e) });
  }

  if (!fs.existsSync(sdNorm)) {
    return void res.status(400).json({ error: "Percorso SD non trovato: " + sdNorm });
  }

  const registeredJobsSnapshot = cleanupMissingJobs();
  let existingJob = requestedExistingJobId
    ? findJobByLookupId(registeredJobsSnapshot, requestedExistingJobId)
    : null;

  if (!existingJob && requestedExistingJobId.startsWith("fs:")) {
    const discoveredJobs = await discoverArchiveJobs(
      settings.archiveRoot,
      registeredJobsSnapshot,
      settings.archiveHierarchy,
    );
    existingJob = findJobByLookupId(discoveredJobs, requestedExistingJobId);
  }

  if (requestedExistingJobId && !existingJob) {
    return void res.status(404).json({
      error: "Lavoro esistente non trovato. Aggiorna la lista e seleziona di nuovo il lavoro.",
    });
  }

  const folderName = existingJob
    ? existingJob.nomeCartella
    : resolvedAutomaticDestination?.folderName ?? buildFolderName(nomeLavoro.trim(), dataLavoro);
  const jobRoot = existingJob
    ? resolveAndValidate(existingJob.percorsoCartella)
    : path.join(destNorm, folderName);

  if (isSameOrNestedPath(sdNorm, jobRoot)) {
    return void res.status(400).json({
      error: "La cartella di destinazione non puo trovarsi dentro la SD sorgente.",
    });
  }

  if (!existingJob && fs.existsSync(jobRoot)) {
    return void res.status(409).json({ error: "Cartella già esistente: " + folderName });
  }

  // ── Create folder structure ──────────────────────────────────────────────────
  const fotoSdDir = path.join(jobRoot, "FOTO_SD");
  const autoreFolder = sanitizeFolderSegment(autore ?? "");
  if (!autoreFolder) {
    return void res.status(400).json({ error: "Nome autore non valido per creare la cartella" });
  }
  const autoreFotoDir = path.join(fotoSdDir, autoreFolder);
  const sottoCartellaPulita = sanitizeFolderSegment(sottoCartella ?? "");
  const targetFotoDir = sottoCartellaPulita
    ? path.join(autoreFotoDir, sottoCartellaPulita)
    : autoreFotoDir;
  const bassaQualitaDir = path.join(jobRoot, "BASSA_QUALITA");
  const exportDir = path.join(jobRoot, "EXPORT");

  try {
    fs.mkdirSync(fotoSdDir, { recursive: true });
    fs.mkdirSync(autoreFotoDir, { recursive: true });
    fs.mkdirSync(targetFotoDir, { recursive: true });
    fs.mkdirSync(bassaQualitaDir, { recursive: true });
    fs.mkdirSync(exportDir, { recursive: true });
  } catch (err) {
    return void res.status(500).json({ error: "Errore creazione cartelle: " + String(err) });
  }

  let cardSnapshot: CardSnapshot;
  try {
    cardSnapshot = await captureCardSnapshot(sdNorm);
  } catch (error) {
    return void res.status(500).json({ error: `Impossibile identificare il contenuto della scheda: ${error instanceof Error ? error.message : String(error)}` });
  }

  // ── Create import session ───────────────────────────────────────────────────
  const importSessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const archiveRootForSession = path.resolve(settings.archiveRoot.trim() || path.dirname(jobRoot));
  const archiveId = archiveIdForRoot(archiveRootForSession);
  studioFlowStore.upsertArchive(archiveId, archiveRootForSession, settings.archiveHierarchy);
  const importSession: ImportSessionRecord = {
    id: importSessionId,
    cardSnapshotId: cardSnapshot.id,
    jobId: existingJob?.id ?? null,
    archiveId,
    sourceRoot: sdNorm,
    destinationRoot: jobRoot,
    destinationRelativePath: path.relative(settings.archiveRoot.trim() || path.dirname(jobRoot), targetFotoDir),
    status: "CREATED",
    startedAt: Date.now(),
    updatedAt: Date.now(),
    completedAt: null,
    verifiedAt: null,
    totalFiles: 0,
    plannedFiles: 0,
    importedFiles: 0,
    verifiedFiles: 0,
    duplicateFiles: 0,
    skippedFiles: 0,
    failedFiles: 0,
    totalBytes: 0,
    importedBytes: 0,
    syncStatus: "PENDING",
    errorCode: null,
    errorMessage: null,
  };
  studioFlowStore.createSession(importSession);
  studioFlowStore.saveSessionPayload(importSessionId, req.body);
  writeStudioFlowLog("info", "import_session_created", { correlationId:importSessionId, sourceRoot:sdNorm, destinationRoot:jobRoot });
  studioFlowStore.updateSession(importSessionId, { status: "ANALYZING" });

  const effectiveNomeLavoro = existingJob?.nomeLavoro?.trim() || nomeLavoro.trim();
  const effectiveDataLavoro = existingJob?.dataLavoro || dataLavoro;
  const safeNome = toSafeId(effectiveNomeLavoro);
  const safeData = ymd(effectiveDataLavoro);
  const safeAutore = toSafeId(autore.trim());
  const safeContrattoLink = normalizeContractLink(contrattoLink);
  const filter = parseFilterCriteria({ fileNameIncludes, mtimeFrom, mtimeTo });
  if (filter.error) {
    studioFlowStore.updateSession(importSessionId, { status: "FAILED", completedAt: Date.now(), errorCode: "INVALID_FILTER", errorMessage: filter.error });
    return void res.status(400).json({ error: filter.error });
  }

  const scanSampleStartedAt = Date.now();
  const sampled = await collectSampleFiles(sdNorm, 50).catch(() => [] as string[]);
  const sampleFiles = sampled.filter((f) => isCopyableFile(f)).slice(0, 30);
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
  studioFlowStore.updateSession(importSessionId, { status: "READY" });

  let copiedCount = 0;
  let skippedCount = 0;
  let scannedFiles = 0;
  let plannedFiles = 0;
  let totalPlannedBytes = 0;
  let filteredOutFiles = 0;
  let manifestSkippedFiles = 0;
  const jpgDestPaths = new Set<string>();
  const errors: string[] = [];
  const manifestPath = path.join(targetFotoDir, ".import-manifest.json");
  const manifest = loadImportManifest(manifestPath);
  const reservedDestinationNames = new Map<string, string>();
  for (const record of Object.values(manifest)) {
    const safeDestName = path.basename(record.destFileName ?? "");
    if (!safeDestName) continue;
    reservedDestinationNames.set(safeDestName.toLowerCase(), record.sourceRelativePath);
  }
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
    currentFileName: null,
  });
  studioFlowStore.updateSession(importSessionId, { status: "IMPORTING" });

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
    studioFlowStore.upsertImportFile({
      sessionId: importSessionId,
      sourceRelativePath: task.sourceRelativePath,
      sourceSize: task.sourceSize,
      sourceMtimeMs: task.sourceMtimeMs,
      fastFingerprint: null,
      fullHash: null,
      destinationPath: task.destPath,
      destinationSize: null,
      destinationFingerprint: null,
      status: "PLANNED",
      errorMessage: null,
      updatedAt: Date.now(),
    });
    let taskPromise: Promise<void>;
    taskPromise = (async () => {
      try {
        if (importCancelRequested) {
          throw new Error("Importazione annullata");
        }
        studioFlowStore.upsertImportFile({
          sessionId: importSessionId, sourceRelativePath: task.sourceRelativePath, sourceSize: task.sourceSize,
          sourceMtimeMs: task.sourceMtimeMs, fastFingerprint: null, fullHash: null, destinationPath: task.destPath,
          destinationSize: null, destinationFingerprint: null, status: "COPYING", errorMessage: null, updatedAt: Date.now(),
        });
        const result = await safeCopyFileVerified(task.srcFile, task.destPath, task.sourceSize);
        const [sourceFingerprint, destinationFingerprint] = await Promise.all([
          computeFastFingerprint(task.srcFile), computeFastFingerprint(task.destPath),
        ]);
        if (sourceFingerprint !== destinationFingerprint) {
          throw new Error("Verifica fingerprint post-copia fallita");
        }
        if (result === "copied") {
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
        studioFlowStore.upsertImportFile({
          sessionId: importSessionId, sourceRelativePath: task.sourceRelativePath, sourceSize: task.sourceSize,
          sourceMtimeMs: task.sourceMtimeMs, fastFingerprint: sourceFingerprint, fullHash: null,
          destinationPath: task.destPath, destinationSize: task.sourceSize, destinationFingerprint,
          status: result === "copied" ? "VERIFIED" : "DUPLICATE_ACCEPTED", errorMessage: null, updatedAt: Date.now(),
        });
        if (JPG_EXT.has(path.extname(task.destPath).toLowerCase())) {
          jpgDestPaths.add(task.destPath);
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
        studioFlowStore.upsertImportFile({
          sessionId: importSessionId, sourceRelativePath: task.sourceRelativePath, sourceSize: task.sourceSize,
          sourceMtimeMs: task.sourceMtimeMs, fastFingerprint: null, fullHash: null, destinationPath: task.destPath,
          destinationSize: null, destinationFingerprint: null, status: "FAILED", errorMessage: String(err), updatedAt: Date.now(),
        });
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
      if (importCancelRequested) {
        throw new Error("Importazione annullata");
      }
      scannedFiles += 1;
      updateImportProgress({ scannedFiles });
      if (!isCopyableFile(srcFile)) {
        continue;
      }

      const originalName = path.basename(srcFile);
      updateImportProgress({ currentFileName: originalName });
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
        const manifestDestPath = path.join(targetFotoDir, path.basename(manifestEntry.destFileName));
        try {
          const st = await fs.promises.stat(manifestDestPath);
          // The manifest key already includes source path, size and mtime.
          // Avoid hashing every file again during a normal resume/re-import.
          if (st.size === sourceSize && await filesHaveSameContent(srcFile, manifestDestPath)) {
            const fastFingerprint = await computeFastFingerprint(srcFile);
            skippedCount += 1;
            manifestSkippedFiles += 1;
            plannedFiles += 1;
            totalPlannedBytes += sourceSize;
            studioFlowStore.upsertImportFile({
              sessionId: importSessionId, sourceRelativePath, sourceSize, sourceMtimeMs,
              fastFingerprint, fullHash: null, destinationPath: manifestDestPath, destinationSize: sourceSize,
              destinationFingerprint: fastFingerprint, status: "DUPLICATE_ACCEPTED", errorMessage: null, updatedAt: Date.now(),
            });
            if (JPG_EXT.has(path.extname(manifestDestPath).toLowerCase())) {
              jpgDestPaths.add(manifestDestPath);
            }
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

      let destName = manifestEntry?.destFileName
        ? path.basename(manifestEntry.destFileName)
        : buildDestinationFileName({
            originalName,
            sourceRelativePath,
            rinominaFile,
            safeNome,
            safeData,
            safeAutore,
          });

      if (!rinominaFile && !manifestEntry) {
        const candidateKey = destName.toLowerCase();
        const reservedFor = reservedDestinationNames.get(candidateKey);
        let needsCollisionSuffix = Boolean(reservedFor && reservedFor !== sourceRelativePath);
        const candidatePath = path.join(targetFotoDir, destName);

        if (!reservedFor && fs.existsSync(candidatePath)) {
          try {
            const candidateStat = await fs.promises.stat(candidatePath);
            needsCollisionSuffix = candidateStat.size !== sourceSize
              || !(await filesHaveSameContent(srcFile, candidatePath));
          } catch {
            needsCollisionSuffix = true;
          }
        }

        if (needsCollisionSuffix) {
          const ext = path.extname(originalName);
          const stem = path.basename(originalName, ext);
          destName = `${stem}_${shortStableSuffix(sourceRelativePath)}${ext}`;
        }
      }

      reservedDestinationNames.set(destName.toLowerCase(), sourceRelativePath);
      const destPath = path.join(targetFotoDir, destName);
      plannedFiles += 1;
      totalPlannedBytes += sourceSize;
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
    if (importCancelRequested) {
      throw new Error("Importazione annullata");
    }
    queueManifestFlush(true);
    await manifestFlushChain;
  } catch (err) {
    const cancelled = String(err).includes("annullata");
    studioFlowStore.updateSession(importSessionId, {
      status: cancelled ? "CANCELLED" : "FAILED",
      totalFiles: plannedFiles,
      plannedFiles,
      importedFiles: copiedCount,
      verifiedFiles: copiedCount + skippedCount,
      duplicateFiles: skippedCount,
      failedFiles: errors.length,
      totalBytes: totalPlannedBytes,
      importedBytes: importProgress.bytesCopied,
      completedAt: Date.now(),
      errorCode: cancelled ? "USER_CANCELLED" : "COPY_FAILED",
      errorMessage: String(err),
    });
    writeStudioFlowLog(cancelled ? "warn" : "error", "import_session_stopped", { correlationId:importSessionId, cancelled, error:String(err) });
    updateImportProgress({
      active: false,
      phase: "error",
      error: String(err).includes("annullata") ? "Importazione annullata" : "Errore durante scansione/copia streaming",
      inFlight: 0,
    });
    importCancelRequested = false;
    return void res.status(String(err).includes("annullata") ? 499 : 500).json({
      error: String(err).includes("annullata")
        ? "Importazione annullata"
        : "Errore durante scansione/copia streaming: " + String(err),
    });
  }
  const scanMs = Date.now() - scanStartedAt;
  const copyMs = Date.now() - copyStartedAt;

  // ── Generate compressed JPGs in BASSA_QUALITA ────────────────────────────────
  let jpgGenerati = 0;
  const compressStartedAt = Date.now();
  if (generaJpg) {
    updateImportProgress({ phase: "compressing", inFlight: 0, currentFileName: null });
    const jpgFiles = [...jpgDestPaths];
    updateImportProgress({ jpgPlanned: jpgFiles.length, jpgDone: 0 });
    await runWithConcurrency(jpgFiles, JPG_CONCURRENCY, async (src) => {
      if (importCancelRequested) {
        return;
      }
      updateImportProgress({ currentFileName: path.basename(src) });
      const relativeFromFotoSd = path.relative(fotoSdDir, src);
      const destPath = path.join(bassaQualitaDir, relativeFromFotoSd);
      try {
        await writeLowQualityJpeg(src, destPath);
        jpgGenerati += 1;
        updateImportProgress({ jpgDone: jpgGenerati });
      } catch (error) {
        errors.push(`${path.basename(src)}: JPG BASSA_QUALITA non generato (${String(error)})`);
      }
    });
    if (importCancelRequested) {
      studioFlowStore.updateSession(importSessionId, {
        status: "CANCELLED", completedAt: Date.now(), totalFiles: plannedFiles, plannedFiles,
        importedFiles: copiedCount, verifiedFiles: copiedCount + skippedCount, duplicateFiles: skippedCount,
        failedFiles: errors.length, totalBytes: totalPlannedBytes, importedBytes: importProgress.bytesCopied,
        errorCode: "USER_CANCELLED", errorMessage: "Importazione annullata durante la generazione JPG",
      });
      updateImportProgress({
        active: false,
        phase: "error",
        inFlight: 0,
        error: "Importazione annullata",
      });
      importCancelRequested = false;
      return void res.status(499).json({ error: "Importazione annullata" });
    }
  }
  const compressMs = Date.now() - compressStartedAt;

  // ── Save job ─────────────────────────────────────────────────────────────────
  let job: Job;
  if (existingJob) {
    const updatedExisting = incrementJobFiles(existingJob.id, copiedCount, safeContrattoLink, targetFotoDir);
    if (updatedExisting) {
      job = updatedExisting;
    } else {
      const fallbackExisting: Job = {
        ...existingJob,
        numeroFile: (existingJob.numeroFile ?? 0) + copiedCount,
        contrattoLink: safeContrattoLink ?? existingJob.contrattoLink,
        percorsoSelezione: targetFotoDir,
      };
      if (existingJob.id.startsWith("fs:")) {
        const normalizedAutore = sanitizeName(autore.trim());
        job = {
          ...fallbackExisting,
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          autore: fallbackExisting.autore === "Archivio" && normalizedAutore
            ? normalizedAutore
            : fallbackExisting.autore,
          dataCreazione: fallbackExisting.dataCreazione || new Date().toISOString(),
        };
        appendJob(job);
      } else {
        job = fallbackExisting;
      }
    }
  } else {
    job = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      nomeLavoro: sanitizeName(nomeLavoro.trim()),
      dataLavoro,
      autore: sanitizeName(autore.trim()),
      categoriaArchivio: settings.categoryMappings.find((item) => item.categoryKey === categoryKey)?.displayName,
      contrattoLink: safeContrattoLink,
      percorsoCartella: jobRoot,
      percorsoSelezione: targetFotoDir,
      nomeCartella: folderName,
      dataCreazione: new Date().toISOString(),
      numeroFile: copiedCount,
    };
    appendJob(job);
  }

  invalidateCachedJobFileCount(jobRoot);

  studioFlowStore.updateSession(importSessionId, { status: "VERIFYING", jobId: job.id });
  const verifiedFiles = copiedCount + skippedCount;
  const completed = errors.length === 0 && verifiedFiles === plannedFiles;
  const completedAt = Date.now();
  studioFlowStore.updateSession(importSessionId, {
    status: completed ? "COMPLETED" : "FAILED",
    completedAt,
    verifiedAt: completed ? completedAt : null,
    totalFiles: plannedFiles,
    plannedFiles,
    importedFiles: copiedCount,
    verifiedFiles,
    duplicateFiles: skippedCount,
    skippedFiles: filteredOutFiles,
    failedFiles: errors.length,
    totalBytes: totalPlannedBytes,
    importedBytes: importProgress.bytesCopied,
    syncStatus: "PENDING",
    errorCode: completed ? null : "VERIFICATION_INCOMPLETE",
    errorMessage: completed ? null : `${errors.length} file non verificati`,
  });
  if (completed) {
    studioFlowStore.enqueueOutbox("import_session", importSessionId, "IMPORT_COMPLETED", {
      sessionId: importSessionId, jobId: job.id, archiveId, verifiedFiles, completedAt,
    });
  }
  writeStudioFlowLog(completed ? "info" : "warn", "import_session_completed", {
    correlationId:importSessionId, completed, plannedFiles, verifiedFiles, failedFiles:errors.length, durationMs:Date.now() - startedAt,
  });

  updateImportProgress({
    active: false,
    phase: completed ? "done" : "error",
    inFlight: 0,
    copiedFiles: copiedCount,
    skippedFiles: skippedCount,
    plannedFiles,
    scannedFiles,
    manifestSkippedFiles,
    copyConcurrency: copyController.getLimit(),
    currentFileName: null,
    error: completed ? null : "Importazione completata con file non verificati",
  });
  importCancelRequested = false;
  scheduleArchiveReconciliation(jobRoot);
  invalidateJobsListCache();

  res.json({
    ok: true,
    incomplete: !completed,
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
    errors,
    failedFiles: errors,
  });

};
app.post("/api/import", importHandler);

const resumeImportHandler = async (req: Request, res: Response) => {
  const sessionId = String(req.params.id ?? "").trim();
  const session = studioFlowStore.listResumableSessions().find((item) => item.id === sessionId);
  if (!session) return void res.status(404).json({ error: "Sessione recuperabile non trovata" });
  const payload = studioFlowStore.getSessionPayload<ImportRequest>(sessionId);
  if (!payload) return void res.status(409).json({ error: "Dati originali della sessione non disponibili" });
  if (!fs.existsSync(session.sourceRoot)) return void res.status(409).json({ error: "Ricollega la scheda sorgente prima di riprendere" });
  studioFlowStore.updateSession(sessionId, { status: "CANCELLED", completedAt: Date.now(), errorCode: "SUPERSEDED_BY_RESUME", errorMessage: "Ripresa in una nuova sessione" });
  await importHandler({ ...req, body: payload } as Request, res);
};
app.post("/api/import-sessions/:id/resume", resumeImportHandler);

async function buildJobsList(): Promise<Job[]> {
  const settings = loadSettings();
  ensureInitialArchiveIndex(settings);
  const registeredJobs = cleanupMissingJobs()
    .map((job) => withArchiveMetadata(job, settings.archiveRoot, settings.archiveHierarchy));
  return registeredJobs
    .sort((a, b) => new Date(b.dataCreazione).getTime() - new Date(a.dataCreazione).getTime());
}

let archiveBackgroundReconcilePromise: Promise<void> | null = null;
function ensureInitialArchiveIndex(settings = loadSettings()): void {
  const rawRoot = settings.archiveRoot.trim();
  if (!rawRoot || !fs.existsSync(rawRoot) || archiveBackgroundReconcilePromise) return;
  const resolvedRoot = path.resolve(rawRoot);
  const archiveId = archiveIdForRoot(resolvedRoot);
  const persisted = studioFlowStore.getArchiveStatus(archiveId);

  // Un indice completato è persistente: all'avvio lo riutilizziamo senza
  // attraversare nuovamente l'intero archivio.
  if (persisted.lastFullScanAt) return;

  archiveBackgroundReconcilePromise = (async () => {
    await rebuildArchiveIndex(settings);
    await reconcileDiscoveredArchiveJobs(settings);
    invalidateJobsListCache();
  })().catch((error) => {
    writeStudioFlowLog("warn", "archive_background_reconcile_failed", { error:error instanceof Error ? error.message : String(error) });
  }).finally(() => { archiveBackgroundReconcilePromise = null; });
}

async function buildRegisteredJobsList(): Promise<Job[]> {
  const settings = loadSettings();
  const registeredJobs = cleanupMissingJobs()
    .map((job) => withArchiveMetadata(job, settings.archiveRoot, settings.archiveHierarchy));
  const hydratedJobs = new Array<Job>(registeredJobs.length);

  await runWithConcurrency(registeredJobs, 6, async (job, index) => {
    hydratedJobs[index] = await hydrateArchiveListJob(job);
  });

  return hydratedJobs
    .filter((job): job is Job => Boolean(job))
    .sort((a, b) => new Date(b.dataCreazione).getTime() - new Date(a.dataCreazione).getTime());
}

function refreshJobsListCacheInBackground(): void {
  if (jobsListCache?.refreshing) return;
  if (jobsListCache) {
    jobsListCache.refreshing = true;
  } else {
    jobsListCache = { jobs: [], cachedAt: 0, refreshing: true };
  }

  buildJobsList().then((jobs) => {
    jobsListCache = { jobs, cachedAt: Date.now(), refreshing: false };
  }).catch(() => {
    if (jobsListCache) jobsListCache.refreshing = false;
  });
}

/**
 * GET /api/jobs
 * Returns all saved jobs (newest first).
 * Cached in memory: fresh for 30 s, stale-while-revalidate up to 5 min.
 */
const listJobsHandler = async (_req: Request, res: Response) => {
  const now = Date.now();

  // Serve from cache if fresh enough
  if (jobsListCache && (now - jobsListCache.cachedAt) < JOBS_LIST_CACHE_FRESH_MS) {
    return void res.json(jobsListCache.jobs);
  }

  // Stale-while-revalidate: return stale data immediately, refresh in background
  if (jobsListCache && (now - jobsListCache.cachedAt) < JOBS_LIST_CACHE_STALE_MS && !jobsListCache.refreshing) {
    const staleJobs = jobsListCache.jobs;
    refreshJobsListCacheInBackground();
    return void res.json(staleJobs);
  }

  // No usable cache — build and cache
  try {
    const jobs = await buildJobsList();
    jobsListCache = { jobs, cachedAt: Date.now(), refreshing: false };
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: "Impossibile caricare la lista lavori" });
  }
};
app.get("/api/jobs", listJobsHandler);

const analyzeArchiveHandler = async (_req: Request, res: Response) => {
  try {
    const result = await analyzeArchive();
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Analisi archivio non riuscita" });
  }
};
app.post("/api/archive/analyze", analyzeArchiveHandler);

const renameArchiveJobsHandler = async (req: Request, res: Response) => {
  const requests = Array.isArray(req.body?.requests)
    ? req.body.requests
    : Array.isArray(req.body?.jobIds)
      ? req.body.jobIds.map((jobId: unknown) => ({ jobId: String(jobId) }))
      : [];
  try {
    const result = await renameAnalyzedArchiveJobs(requests);
    res.json(result);
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Rinomina archivio non riuscita" });
  }
};
app.post("/api/archive/rename", renameArchiveJobsHandler);
app.get("/api/archive/rename/progress", (_req, res) => {
  res.json(getArchiveRenameProgress());
});

/**
 * DELETE /api/jobs/:id
 * Removes a job entry from the archive registry only.
 */
const deleteJobHandler = (req: Request, res: Response) => {
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

  invalidateJobsListCache();
  res.json({ ok: true });
};
app.delete("/api/jobs/:id", deleteJobHandler);

/**
 * POST /api/jobs/:id/contract-link
 * Updates (or clears) contract link for an existing job.
 */
const updateJobContractLinkHandler = (req: Request, res: Response) => {
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

  invalidateJobsListCache();
  res.json({ ok: true, job: updated });
};
app.post("/api/jobs/:id/contract-link", updateJobContractLinkHandler);

/**
 * GET /api/jobs/:id/subfolders
 * Returns the immediate subfolders of the job folder (excluding BASSA_QUALITA and EXPORT).
 */
const listJobSubfoldersHandler = async (req: Request, res: Response) => {
  const paramId = req.params["id"];
  const jobId = typeof paramId === "string"
    ? paramId.trim()
    : Array.isArray(paramId)
      ? (paramId[0] ?? "").trim()
      : "";
  if (!jobId) return void res.status(400).json({ error: "id lavoro mancante" });

  const registeredJobs = loadJobs();
  let job = registeredJobs.find((j) => j.id === jobId);
  if (!job && jobId.startsWith("fs:")) {
    const settings = loadSettings();
    const discoveredJobs = await discoverArchiveJobs(settings.archiveRoot, registeredJobs, settings.archiveHierarchy);
    job = discoveredJobs.find((j) => j.id === jobId);
  }
  if (!job) return void res.status(404).json({ error: "Lavoro non trovato" });

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(job.percorsoCartella, { withFileTypes: true });
  } catch {
    return void res.status(500).json({ error: "Impossibile leggere la cartella del lavoro" });
  }

  const subfolders = entries
    .filter((e) => e.isDirectory() && !isLowQualityDirName(e.name) && !isExportDirName(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, "it"));

  res.json({ subfolders });
};
app.get("/api/jobs/:id/subfolders", listJobSubfoldersHandler);

/**
 * GET /api/jobs/:id/selection-candidates
 * Returns ranked folder candidates for opening the job in Photo Selector.
 */
const listJobSelectionCandidatesHandler = async (req: Request, res: Response) => {
  const paramId = req.params["id"];
  const jobId = typeof paramId === "string"
    ? paramId.trim()
    : Array.isArray(paramId)
      ? (paramId[0] ?? "").trim()
      : "";
  if (!jobId) return void res.status(400).json({ error: "id lavoro mancante" });

  const registeredJobs = loadJobs();
  let job = registeredJobs.find((j) => j.id === jobId);
  if (!job && jobId.startsWith("fs:")) {
    const settings = loadSettings();
    const discoveredJobs = await discoverArchiveJobs(settings.archiveRoot, registeredJobs, settings.archiveHierarchy);
    job = discoveredJobs.find((j) => j.id === jobId);
  }
  if (!job) return void res.status(404).json({ error: "Lavoro non trovato" });

  let jobRoot: string;
  try {
    jobRoot = resolveAndValidate(job.percorsoCartella);
  } catch {
    return void res.status(400).json({ error: "Percorso lavoro non valido" });
  }

  const rankedCandidates = await collectJobPhotoSelectorCandidates(job);
  const preferredPath = await resolveJobPhotoSelectorFolder(job).catch(() => null);
  const candidates: JobSelectionCandidate[] = rankedCandidates
    .slice(0, 25)
    .map((candidate) => ({
      path: candidate.folderPath,
      label: formatSelectionCandidateLabel(jobRoot, candidate.folderPath),
      fileCount: candidate.fileCount,
      depth: candidate.depth,
    }));

  if (candidates.length === 0 && preferredPath) {
    candidates.push({
      path: preferredPath,
      label: formatSelectionCandidateLabel(jobRoot, preferredPath),
      fileCount: 0,
      depth: 0,
    });
  }

  res.json({
    candidates,
    preferredPath,
  });
};
app.get("/api/jobs/:id/selection-candidates", listJobSelectionCandidatesHandler);

/**
 * POST /api/jobs/:id/generate-low-quality
 * Generates compressed JPG copies in BASSA_QUALITA for an existing job.
 * Optional body param `sourceSubfolder` restricts the source to a specific subfolder.
 */
const generateLowQualityHandler = async (req: Request, res: Response) => {
  const paramId = req.params["id"];
  const jobId = typeof paramId === "string"
    ? paramId.trim()
    : Array.isArray(paramId)
      ? (paramId[0] ?? "").trim()
      : "";
  if (!jobId) return void res.status(400).json({ error: "id lavoro mancante" });

  const overwrite = Boolean(req.body?.overwrite);
  const rawSourceSubfolder = typeof req.body?.sourceSubfolder === "string" ? req.body.sourceSubfolder.trim() : "";

  if (lowQualityProgress.active) {
    return void res.status(409).json({
      error: `Generazione BQ già in corso per ${lowQualityProgress.jobName || "un altro lavoro"}`,
    });
  }

  const registeredJobs = cleanupMissingJobs();
  let job = registeredJobs.find((j) => j.id === jobId);

  if (!job && jobId.startsWith("fs:")) {
    const settings = loadSettings();
    const discoveredJobs = await discoverArchiveJobs(settings.archiveRoot, registeredJobs, settings.archiveHierarchy);
    job = discoveredJobs.find((j) => j.id === jobId);
  }

  if (!job) return void res.status(404).json({ error: "Lavoro non trovato" });
  if (!fs.existsSync(job.percorsoCartella) || !fs.statSync(job.percorsoCartella).isDirectory()) {
    return void res.status(404).json({ error: "Cartella del lavoro non trovata" });
  }

  // Validate sourceSubfolder if provided: must be a direct child, not a system dir
  let resolvedSourceRoot: string | null = null;
  if (rawSourceSubfolder) {
    const candidate = path.join(job.percorsoCartella, rawSourceSubfolder);
    const resolvedCandidate = path.resolve(candidate);
    const resolvedJobFolder = path.resolve(job.percorsoCartella);
    const rel = path.relative(resolvedJobFolder, resolvedCandidate);
    if (rel.includes("..") || path.isAbsolute(rel) || rel.includes(path.sep)) {
      return void res.status(400).json({ error: "Sottocartella non valida" });
    }
    if (isLowQualityDirName(rawSourceSubfolder) || isExportDirName(rawSourceSubfolder)) {
      return void res.status(400).json({ error: "Impossibile usare questa cartella come sorgente" });
    }
    if (!fs.existsSync(resolvedCandidate)) {
      return void res.status(404).json({ error: `Cartella sorgente non trovata: ${rawSourceSubfolder}` });
    }
    resolvedSourceRoot = resolvedCandidate;
  }

  lowQualityProgress = createEmptyLowQualityProgress();
  updateLowQualityProgress({
    active: true,
    phase: "scanning",
    startedAt: Date.now(),
    overwrite,
    jobId,
  });

  updateLowQualityProgress({
    jobName: job.nomeLavoro,
    outputDir: path.join(job.percorsoCartella, "BASSA_QUALITA"),
  });

  const bassaQualitaDir = path.join(job.percorsoCartella, "BASSA_QUALITA");

  const startedAt = Date.now();
  let totalJpg = 0;
  let generated = 0;
  let skippedExisting = 0;
  let errors = 0;

  // Collect JPG sources: specific subfolder or full job (default behaviour)
  let sourceRoot: string;
  let jpgFiles: string[];
  try {
    fs.mkdirSync(bassaQualitaDir, { recursive: true });
    if (resolvedSourceRoot) {
      sourceRoot = resolvedSourceRoot;
      jpgFiles = [];
      for await (const srcFile of walkFiles(resolvedSourceRoot)) {
        if (JPG_EXT.has(path.extname(srcFile).toLowerCase())) {
          jpgFiles.push(srcFile);
        }
      }
    } else {
      ({ sourceRoot, jpgFiles } = await collectJpgSourcesForLowQuality(job.percorsoCartella));
    }
  } catch (error) {
    updateLowQualityProgress({
      active: false,
      phase: "error",
      error: `Impossibile leggere o preparare le cartelle: ${String(error)}`,
    });
    return void res.status(500).json({ error: `Impossibile leggere o preparare le cartelle: ${String(error)}` });
  }

  updateLowQualityProgress({ sourceRoot });
  if (jpgFiles.length === 0) {
    updateLowQualityProgress({
      active: false,
      phase: "error",
      error: rawSourceSubfolder
        ? `Nessun JPG trovato in "${rawSourceSubfolder}"`
        : "Nessun JPG trovato nella cartella lavoro per generare BASSA_QUALITA",
      totalJpg: 0,
      processedJpg: 0,
    });
    return void res.status(404).json({
      error: rawSourceSubfolder
        ? `Nessun JPG trovato in "${rawSourceSubfolder}"`
        : "Nessun JPG trovato nella cartella lavoro per generare BASSA_QUALITA",
    });
  }
  totalJpg = jpgFiles.length;

  let processedJpg = 0;
  updateLowQualityProgress({
    phase: "compressing",
    totalJpg,
    processedJpg: 0,
    generated: 0,
    skippedExisting: 0,
    errors: 0,
    error: null,
  });

  try {
    await runWithConcurrency(jpgFiles, JPG_CONCURRENCY, async (src) => {
      const relativeFromFotoSd = path.relative(sourceRoot, src);
      const destPath = path.join(bassaQualitaDir, relativeFromFotoSd);
      if (!overwrite) {
        if (await isUsableJpeg(destPath)) {
          skippedExisting += 1;
          processedJpg += 1;
          updateLowQualityProgress({
            processedJpg,
            generated,
            skippedExisting,
            errors,
          });
          return;
        }
      }

      try {
        await writeLowQualityJpeg(src, destPath);
        generated += 1;
      } catch {
        errors += 1;
      } finally {
        processedJpg += 1;
        updateLowQualityProgress({
          processedJpg,
          generated,
          skippedExisting,
          errors,
        });
      }
    });
  } catch (error) {
    updateLowQualityProgress({
      active: false,
      phase: "error",
      error: `Errore generazione BASSA_QUALITA: ${String(error)}`,
    });
    return void res.status(500).json({ error: `Errore generazione BASSA_QUALITA: ${String(error)}` });
  }

  updateLowQualityProgress({
    active: false,
    phase: "done",
    processedJpg,
    generated,
    skippedExisting,
    errors,
    error: null,
  });

  res.json({
    ok: true,
    jobId,
    totalJpg,
    generated,
    skippedExisting,
    errors,
    overwrite,
    sourceSubfolder: rawSourceSubfolder || null,
    preserveStructure: true,
    outputDir: bassaQualitaDir,
    durationMs: Date.now() - startedAt,
  });
};
app.post("/api/jobs/:id/generate-low-quality", generateLowQualityHandler);

/**
 * POST /api/open-folder
 * Opens a folder in Windows Explorer. Path must exist.
 */
const openFolderHandler = (req: Request, res: Response) => {
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
};
app.post("/api/open-folder", openFolderHandler);

function unwrapInvocationResult<T>(result: MockInvocationResult): T {
  if (result.statusCode >= 400) {
    const errorBody = result.body as { error?: string } | null;
    throw new Error(errorBody?.error || `Archivio Flow request failed (${result.statusCode})`);
  }
  return result.body as T;
}

export async function browseFolderService(): Promise<{ path: string | null }> {
  return unwrapInvocationResult(await invokeHandler(browseFolderHandler, {}));
}

export async function getSettingsService(): Promise<Settings> {
  return unwrapInvocationResult(await invokeHandler(getSettingsHandler, {}));
}

export async function saveSettingsService(input: Partial<Settings>): Promise<{ ok: true; settings: Settings }> {
  return unwrapInvocationResult(await invokeHandler(saveSettingsHandler, { body: input }));
}

export async function getImportProgressService(): Promise<ImportProgressState & {
  completedScheduled: number;
  knownTotal: number;
  progressPct: number;
  totalWorkItems: number;
  completedWorkItems: number;
  remainingWorkItems: number;
  overallProgressPct: number;
  currentPhaseLabel: string;
  currentSpeedFilesPerSec: number | null;
  currentSpeedBytesPerSec: number | null;
}> {
  return unwrapInvocationResult(await invokeHandler(getImportProgressHandler, {}));
}

export async function getLowQualityProgressService(): Promise<LowQualityProgressState & { progressPct: number }> {
  return unwrapInvocationResult(await invokeHandler(getLowQualityProgressHandler, {}));
}

export async function getSdCardsService(): Promise<{ sdCards: SdCard[] }> {
  return unwrapInvocationResult(await invokeHandler(getSdCardsHandler, {}));
}

export async function getSdPreviewService(sdPath: string): Promise<{ totalFiles: number; rawFiles: number; jpgFiles: number }> {
  return unwrapInvocationResult(await invokeHandler(getSdPreviewHandler, { query: { path: sdPath } }));
}

export async function getFilterPreviewService(input: {
  sdPath: string;
  fileNameIncludes?: string;
  mtimeFrom?: string;
  mtimeTo?: string;
  maxSamples?: number;
}): Promise<{
  ok: true;
  scannedFiles: number;
  matchedFiles: number;
  matchedRawFiles: number;
  matchedJpgFiles: number;
  minMtimeMs: number | null;
  maxMtimeMs: number | null;
  sampleFiles: Array<{ filePath: string; fileName: string; mtimeMs: number; size: number; ext: string; isJpg: boolean }>;
}> {
  return unwrapInvocationResult(await invokeHandler(getFilterPreviewHandler, { body: input }));
}

export async function getPreviewImageService(sdPath: string, filePath: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const result = await invokeHandler(getPreviewImageHandler, {
    query: { sdPath, filePath },
  });
  if (result.statusCode >= 400) {
    const errorBody = result.body as { error?: string } | null;
    throw new Error(errorBody?.error || `Preview generation failed (${result.statusCode})`);
  }
  return {
    bytes: Buffer.isBuffer(result.body) ? result.body : Buffer.from(result.body as Uint8Array),
    mimeType: result.headers["content-type"] || "image/jpeg",
  };
}

export async function importService(input: ImportRequest): Promise<{
  ok: true;
  incomplete: boolean;
  job: Job;
  reusedExistingJob: boolean;
  copiedFiles: number;
  skippedFiles: number;
  jpgGenerati: number;
  cartellaFotoFinale: string;
  performance: Record<string, number>;
  errors: string[];
  failedFiles: string[];
}> {
  importCancelRequested = false;
  return unwrapInvocationResult(await invokeHandler(importHandler, { body: input }));
}

export async function listJobsService(): Promise<Job[]> {
  return unwrapInvocationResult(await invokeHandler(listJobsHandler, {}));
}

export async function analyzeArchiveService(): Promise<ArchiveAnalysisResult> {
  return unwrapInvocationResult(await invokeHandler(analyzeArchiveHandler, {}));
}

export async function renameArchiveJobsService(requests: ArchiveRenameRequest[]): Promise<ArchiveRenameResult> {
  return unwrapInvocationResult(await invokeHandler(renameArchiveJobsHandler, { body: { requests } }));
}

export function getArchiveRenameProgressService(): ArchiveRenameProgress {
  return getArchiveRenameProgress();
}

export async function deleteJobService(jobId: string): Promise<{ ok: true }> {
  return unwrapInvocationResult(await invokeHandler(deleteJobHandler, { params: { id: jobId } }));
}

export async function listJobSubfoldersService(jobId: string): Promise<{ subfolders: string[] }> {
  return unwrapInvocationResult(await invokeHandler(listJobSubfoldersHandler, { params: { id: jobId } }));
}

export async function listJobSelectionCandidatesService(jobId: string): Promise<{
  candidates: JobSelectionCandidate[];
  preferredPath: string | null;
}> {
  return unwrapInvocationResult(await invokeHandler(listJobSelectionCandidatesHandler, { params: { id: jobId } }));
}

export async function updateJobContractLinkService(
  jobId: string,
  contrattoLink: string,
): Promise<{ ok: true; job: Job }> {
  return unwrapInvocationResult(await invokeHandler(updateJobContractLinkHandler, {
    params: { id: jobId },
    body: { contrattoLink },
  }));
}

export async function generateLowQualityService(
  jobId: string,
  overwrite: boolean,
  sourceSubfolder?: string,
): Promise<{
  ok: true;
  jobId: string;
  totalJpg: number;
  generated: number;
  skippedExisting: number;
  errors: number;
  overwrite: boolean;
  sourceSubfolder: string | null;
  preserveStructure: boolean;
  outputDir: string;
  durationMs: number;
}> {
  return unwrapInvocationResult(await invokeHandler(generateLowQualityHandler, {
    params: { id: jobId },
    body: { overwrite, sourceSubfolder },
  }));
}

export async function openFolderService(folderPath: string): Promise<{ ok: true }> {
  return unwrapInvocationResult(await invokeHandler(openFolderHandler, { body: { folderPath } }));
}

export async function resumeImportService(sessionId: string): Promise<Awaited<ReturnType<typeof importService>>> {
  importCancelRequested = false;
  return unwrapInvocationResult(await invokeHandler(resumeImportHandler, { params: { id: sessionId } }));
}

export async function checkSafeToFormatService(sdPath: string): Promise<{
  status: "SAFE" | "PARTIAL" | "UNSAFE" | "UNKNOWN";
  totalFiles: number;
  verifiedFiles: number;
  unknownFiles: number;
  reason?: string;
  sessions: string[];
}> {
  return unwrapInvocationResult(await invokeHandler(safeToFormatHandler, { body: { sdPath } }));
}

export async function getStudioFlowStatusService(): Promise<{
  health: ReturnType<StudioFlowStore["health"]>;
  archiveIndex: ArchiveIndexStatus;
  sessions: Array<Pick<ImportSessionRecord, "id" | "cardSnapshotId" | "jobId" | "archiveId" | "status" | "completedAt" | "verifiedAt" | "plannedFiles" | "verifiedFiles" | "duplicateFiles" | "failedFiles">>;
  resumable: ImportSessionRecord[];
}> {
  return unwrapInvocationResult(await invokeHandler(studioFlowStatusHandler, {}));
}

export async function reconcileArchiveIndexService(): Promise<ArchiveIndexStatus> {
  return unwrapInvocationResult(await invokeHandler(reconcileArchiveIndexHandler, {}));
}

export async function getDriveRegistryBatchService(): Promise<{
  schemaVersion: 1;
  app: "studioflow";
  generatedAt: string;
  outbox: ReturnType<StudioFlowStore["listPendingOutbox"]>;
  sessions: ImportSessionRecord[];
  cardSnapshots: Array<Pick<ReturnType<StudioFlowStore["listCardSnapshots"]>[number], "id" | "cardId" | "contentFingerprint" | "fileCount" | "totalBytes" | "captureSignature" | "createdAt" | "lastSeenAt">>;
  fingerprintBloom: ReturnType<typeof createBloomFilter>;
}> {
  return unwrapInvocationResult(await invokeHandler(driveRegistryBatchHandler, {}));
}

export function completeDriveRegistrySyncService(ids: number[], errorMessage?: string): { ok: true } {
  const safeIds = ids.filter((id) => Number.isInteger(id) && id > 0);
  if (errorMessage) studioFlowStore.markOutboxRetry(safeIds, errorMessage);
  else studioFlowStore.markOutboxSynced(safeIds);
  return { ok: true };
}

/** Test/controlled-shutdown hook: flush and close the local SQLite store. */
export function closeStudioFlowStore(): void {
  archiveWatcher?.close();
  if (archiveWatchDebounce) clearTimeout(archiveWatchDebounce);
  if (archiveReconcileInterval) clearInterval(archiveReconcileInterval);
  studioFlowStore.close();
}

// ── Start ──────────────────────────────────────────────────────────────────────
configureArchiveWatcher();
const isDirectRun = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (isDirectRun || process.env.ARCHIVIO_FLOW_HTTP_SERVER === "1") {
app.listen(PORT, () => {
  console.log(`\n🗂️  Archivio Flow Server  →  http://localhost:${PORT}\n`);
});
}
