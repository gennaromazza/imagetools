import type { BatchCropState, ExportFormat } from "@photo-tools/batch-print-layout/print-engine";

export const ID_PHOTO_JOB_SCHEMA_VERSION = 1 as const;
export const ID_PHOTO_JOBS_STORAGE_KEY = "filex-id-photo.jobs.v1";
export const ID_PHOTO_ACTIVE_JOB_STORAGE_KEY = "filex-id-photo.active-job.v1";
export const ID_PHOTO_MAX_STORED_JOBS = 250;
export const ID_PHOTO_MAX_REGISTRY_CHARACTERS = 2_000_000;
export const ID_PHOTO_MAX_ASSETS_PER_JOB = 500;

export class IdPhotoStorageError extends Error {
  readonly code: "capacity" | "write-failed";

  constructor(code: "capacity" | "write-failed", message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "IdPhotoStorageError";
    this.code = code;
  }
}

export type IdPhotoJobStatus =
  | "draft"
  | "preparing"
  | "to-review"
  | "approved"
  | "laid-out"
  | "ready";

export interface PersistedIdPhotoRevision {
  kind: "original" | "photoshop";
  absolutePath: string;
  createdAt: string;
  size?: number;
  lastModified?: number;
}

export interface PersistedIdPhotoAsset {
  id: string;
  fileName: string;
  relativePath?: string;
  absolutePath?: string;
  originalAbsolutePath?: string;
  workingCopyPath?: string;
  backgroundProcessedPath?: string;
  backgroundSourcePath?: string;
  width: number;
  height: number;
  size?: number;
  lastModified?: number;
  revisions: PersistedIdPhotoRevision[];
}

export interface PersistedIdPhotoExport {
  completedAt: string;
  contextFingerprint: string;
  format: ExportFormat;
  files: string[];
  verifiedFiles: Array<{
    absolutePath: string;
    size: number;
    lastModified: number;
    sha256: string;
  }>;
  outputDirectoryPath: string | null;
  sheetId: string;
  copies: number;
}

export interface PersistedIdPhotoPendingExport {
  completedAt: string;
  contextFingerprint: string;
  atomicTransactionId: string | null;
  format: ExportFormat;
  files: string[];
  expectedFiles: Array<{
    fileName: string;
    size: number;
    sha256: string;
  }>;
  outputDirectoryPath: string;
  sheetId: string;
  copies: number;
}

export interface IdPhotoExportContext {
  contextFingerprint: string;
  format: ExportFormat;
  outputDirectoryPath: string | null;
  sheetId: string;
  copies: number;
}

export interface IdPhotoImageAdjustments {
  brightness: number;
  contrast: number;
  backgroundMode: "original" | "uniform" | "replace";
  backgroundColor: string;
  backgroundStrength: number;
  maskPath: string | null;
  maskSha256: string | null;
  modelVersion: string | null;
}

export const DEFAULT_ID_PHOTO_ADJUSTMENTS: IdPhotoImageAdjustments = {
  brightness: 0,
  contrast: 0,
  backgroundMode: "original",
  backgroundColor: "#ffffff",
  backgroundStrength: 70,
  maskPath: null,
  maskSha256: null,
  modelVersion: null,
};

export interface PersistedIdPhotoJob {
  schemaVersion: typeof ID_PHOTO_JOB_SCHEMA_VERSION;
  id: string;
  createdAt: string;
  updatedAt: string;
  customer: string;
  jobName: string;
  profileId: string;
  folderPath: string | null;
  selectedAssetId: string | null;
  assets: PersistedIdPhotoAsset[];
  crops: Record<string, BatchCropState>;
  manualChecks: { face: boolean; expression: boolean; accessories: boolean };
  technicalWarningsAccepted: boolean;
  imageAdjustments: Record<string, IdPhotoImageAdjustments>;
  sheetId: string;
  copies: number;
  format: ExportFormat;
  cutGuides: boolean;
  outputDirectoryPath: string | null;
  lastExport: PersistedIdPhotoExport | null;
  pendingExport: PersistedIdPhotoPendingExport | null;
  status: IdPhotoJobStatus;
}

interface PersistedJobRegistry {
  schemaVersion: 1;
  jobs: PersistedIdPhotoJob[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isExportFormat(value: unknown): value is ExportFormat {
  return value === "pdf" || value === "jpg" || value === "png" || value === "tif";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function parseCopies(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(Math.floor(value), 1, 500)
    : 1;
}

function parseCrop(value: unknown, assetId: string): BatchCropState | null {
  if (!isRecord(value)) return null;
  const cropLeft = typeof value.cropLeft === "number" && Number.isFinite(value.cropLeft) ? value.cropLeft : null;
  const cropTop = typeof value.cropTop === "number" && Number.isFinite(value.cropTop) ? value.cropTop : null;
  const cropWidth = typeof value.cropWidth === "number" && Number.isFinite(value.cropWidth) ? value.cropWidth : null;
  const cropHeight = typeof value.cropHeight === "number" && Number.isFinite(value.cropHeight) ? value.cropHeight : null;
  if (cropLeft === null || cropTop === null || cropWidth === null || cropHeight === null) return null;
  if (
    cropWidth < 0.02 || cropWidth > 1
    || cropHeight < 0.02 || cropHeight > 1
    || cropLeft < 0 || cropTop < 0
    || cropLeft + cropWidth > 1
    || cropTop + cropHeight > 1
  ) return null;
  const rawRotation = value.rotation === undefined ? 0 : value.rotation;
  if (typeof rawRotation !== "number" || !Number.isFinite(rawRotation) || rawRotation % 90 !== 0) return null;
  const rotation = ((rawRotation % 360) + 360) % 360;
  return {
    assetId,
    cropLeft,
    cropTop,
    cropWidth,
    cropHeight,
    rotation,
    reviewed: value.reviewed === true,
  };
}

function parseCrops(value: unknown): Record<string, BatchCropState> {
  if (!isRecord(value)) return {};
  const entries: Array<[string, BatchCropState]> = [];
  for (const [assetId, candidate] of Object.entries(value).slice(0, ID_PHOTO_MAX_ASSETS_PER_JOB)) {
    if (!assetId) continue;
    const crop = parseCrop(candidate, assetId);
    if (crop) entries.push([assetId, crop]);
  }
  return Object.fromEntries(entries);
}

function parseRevision(value: unknown): PersistedIdPhotoRevision | null {
  if (!isRecord(value)) return null;
  if (value.kind !== "original" && value.kind !== "photoshop") return null;
  if (typeof value.absolutePath !== "string" || typeof value.createdAt !== "string") return null;
  return {
    kind: value.kind,
    absolutePath: value.absolutePath,
    createdAt: value.createdAt,
    size: typeof value.size === "number" && Number.isFinite(value.size) ? Math.max(0, value.size) : undefined,
    lastModified: typeof value.lastModified === "number" && Number.isFinite(value.lastModified)
      ? Math.max(0, value.lastModified)
      : undefined,
  };
}

export function createIdPhotoJobId(now = new Date()): string {
  const randomPart = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `idp-${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomPart}`;
}

export function deriveIdPhotoJobStatus(input: {
  assetCount: number;
  hasCrop: boolean;
  manualReady: boolean;
  technicalFailures: number;
  warningsAccepted: boolean;
  technicalWarnings: number;
  pageCount: number;
  hasExport: boolean;
}): IdPhotoJobStatus {
  if (input.hasExport) return "ready";
  if (input.assetCount === 0) return "draft";
  if (!input.hasCrop) return "preparing";
  const warningsReady = input.technicalWarnings === 0 || input.warningsAccepted;
  if (!input.manualReady || input.technicalFailures > 0 || !warningsReady) return "to-review";
  if (input.pageCount > 0) return "laid-out";
  return "approved";
}

export function jobDisplayName(job: Pick<PersistedIdPhotoJob, "customer" | "jobName">): string {
  const customer = job.customer.trim();
  const name = job.jobName.trim();
  if (customer && name) return `${customer} · ${name}`;
  return customer || name || "Commessa senza nome";
}

function parseAsset(value: unknown): PersistedIdPhotoAsset | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.fileName !== "string") return null;
  const revisions = Array.isArray(value.revisions)
    ? value.revisions.map(parseRevision).filter((revision): revision is PersistedIdPhotoRevision => Boolean(revision))
    : [];
  return {
    id: value.id,
    fileName: value.fileName,
    relativePath: typeof value.relativePath === "string" ? value.relativePath : undefined,
    absolutePath: typeof value.absolutePath === "string" ? value.absolutePath : undefined,
    originalAbsolutePath: typeof value.originalAbsolutePath === "string" ? value.originalAbsolutePath : undefined,
    workingCopyPath: typeof value.workingCopyPath === "string" ? value.workingCopyPath : undefined,
    backgroundProcessedPath: typeof value.backgroundProcessedPath === "string" ? value.backgroundProcessedPath : undefined,
    backgroundSourcePath: typeof value.backgroundSourcePath === "string" ? value.backgroundSourcePath : undefined,
    width: typeof value.width === "number" && Number.isFinite(value.width) ? Math.max(0, value.width) : 0,
    height: typeof value.height === "number" && Number.isFinite(value.height) ? Math.max(0, value.height) : 0,
    size: typeof value.size === "number" && Number.isFinite(value.size) ? Math.max(0, value.size) : undefined,
    lastModified: typeof value.lastModified === "number" && Number.isFinite(value.lastModified) ? value.lastModified : undefined,
    revisions,
  };
}

function parsePendingExport(value: unknown): PersistedIdPhotoPendingExport | null {
  if (!isRecord(value)
    || typeof value.completedAt !== "string"
    || typeof value.contextFingerprint !== "string"
    || value.contextFingerprint.length === 0
    || !isExportFormat(value.format)
    || !Array.isArray(value.files)
    || typeof value.outputDirectoryPath !== "string"
    || value.outputDirectoryPath.length === 0
    || typeof value.sheetId !== "string"
    || value.sheetId.length === 0
  ) return null;
  if (
    value.atomicTransactionId !== undefined
    && value.atomicTransactionId !== null
    && (typeof value.atomicTransactionId !== "string" || !/^[a-f0-9]{32}$/.test(value.atomicTransactionId))
  ) return null;
  const files = value.files.slice(0, 100).filter((file): file is string => (
    typeof file === "string"
    && file.length > 0
    && file.length <= 220
    && file !== "."
    && file !== ".."
    && !/[\\/\u0000-\u001f]/.test(file)
  ));
  if (files.length === 0 || files.length !== value.files.length) return null;
  if (!Array.isArray(value.expectedFiles) || value.expectedFiles.length !== files.length) return null;
  const expectedFiles = value.expectedFiles.flatMap((file, index) => (
    isRecord(file)
    && file.fileName === files[index]
    && Number.isFinite(file.size)
    && Number(file.size) >= 0
    && typeof file.sha256 === "string"
    && /^[a-f0-9]{64}$/i.test(file.sha256)
      ? [{
        fileName: files[index],
        size: Number(file.size),
        sha256: file.sha256.toLocaleLowerCase(),
      }]
      : []
  ));
  if (expectedFiles.length !== files.length) return null;
  return {
    completedAt: value.completedAt,
    contextFingerprint: value.contextFingerprint,
    atomicTransactionId: typeof value.atomicTransactionId === "string"
      ? value.atomicTransactionId
      : null,
    format: value.format,
    files,
    expectedFiles,
    outputDirectoryPath: value.outputDirectoryPath,
    sheetId: value.sheetId,
    copies: parseCopies(value.copies),
  };
}

export function pendingIdPhotoExportMatchesContext(
  pendingExport: PersistedIdPhotoPendingExport,
  context: IdPhotoExportContext,
): boolean {
  return pendingExport.files.length > 0
    && pendingExport.expectedFiles.length === pendingExport.files.length
    && pendingExport.expectedFiles.every((file, index) => file.fileName === pendingExport.files[index])
    && pendingExport.contextFingerprint === context.contextFingerprint
    && pendingExport.format === context.format
    && pendingExport.outputDirectoryPath === context.outputDirectoryPath
    && pendingExport.sheetId === context.sheetId
    && pendingExport.copies === context.copies;
}

export function selectLastExportForSnapshot(input: {
  lastExport: PersistedIdPhotoExport | null;
  contextualLastExport: PersistedIdPhotoExport | null;
  assetCount: number;
  technicalCheckCount: number;
}): PersistedIdPhotoExport | null {
  if (input.contextualLastExport) return input.contextualLastExport;

  // Al ripristino le foto sono disponibili prima che l'analisi asincrona
  // ricostruisca i controlli e quindi il fingerprint completo. Conserviamo il
  // record verificato durante questa sola finestra transitoria: tutte le azioni
  // che cambiano davvero il contesto azzerano prima lastExport.
  if (input.lastExport && input.assetCount > 0 && input.technicalCheckCount === 0) {
    return input.lastExport;
  }

  return null;
}

export function recordPendingIdPhotoExport(
  job: PersistedIdPhotoJob,
  pendingExport: PersistedIdPhotoPendingExport,
  updatedAt = new Date().toISOString(),
): PersistedIdPhotoJob {
  return {
    ...job,
    updatedAt,
    outputDirectoryPath: pendingExport.outputDirectoryPath,
    lastExport: null,
    pendingExport,
    status: job.status === "ready" ? "laid-out" : job.status,
  };
}

export function parseIdPhotoJob(value: unknown): PersistedIdPhotoJob | null {
  if (!isRecord(value) || value.schemaVersion !== ID_PHOTO_JOB_SCHEMA_VERSION || typeof value.id !== "string") return null;
  if (typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") return null;
  const assets = Array.isArray(value.assets)
    ? value.assets.slice(0, ID_PHOTO_MAX_ASSETS_PER_JOB).map(parseAsset).filter((asset): asset is PersistedIdPhotoAsset => Boolean(asset))
    : [];
  const crops = parseCrops(value.crops);
  const manual = isRecord(value.manualChecks) ? value.manualChecks : {};
  const adjustmentRecords = isRecord(value.imageAdjustments) ? value.imageAdjustments : {};
  const imageAdjustments = Object.fromEntries(Object.entries(adjustmentRecords).flatMap(([assetId, raw]) => {
    if (!isRecord(raw)) return [];
    const color = typeof raw.backgroundColor === "string" && /^#[0-9a-f]{6}$/i.test(raw.backgroundColor)
      ? raw.backgroundColor
      : DEFAULT_ID_PHOTO_ADJUSTMENTS.backgroundColor;
    return [[assetId, {
      brightness: clamp(typeof raw.brightness === "number" ? raw.brightness : 0, -50, 50),
      contrast: clamp(typeof raw.contrast === "number" ? raw.contrast : 0, -50, 50),
      backgroundMode: raw.backgroundMode === "uniform" || raw.backgroundMode === "replace" ? raw.backgroundMode : "original",
      backgroundColor: color,
      backgroundStrength: clamp(typeof raw.backgroundStrength === "number" ? raw.backgroundStrength : 70, 0, 100),
      maskPath: typeof raw.maskPath === "string" ? raw.maskPath : null,
      maskSha256: typeof raw.maskSha256 === "string" && /^[a-f0-9]{64}$/i.test(raw.maskSha256) ? raw.maskSha256.toLowerCase() : null,
      modelVersion: typeof raw.modelVersion === "string" ? raw.modelVersion : null,
    } satisfies IdPhotoImageAdjustments]];
  }));
  const verifiedFiles = isRecord(value.lastExport) && Array.isArray(value.lastExport.verifiedFiles)
    ? value.lastExport.verifiedFiles.slice(0, 100).flatMap((file) => (
      isRecord(file)
      && typeof file.absolutePath === "string"
      && Number.isFinite(file.size)
      && Number.isFinite(file.lastModified)
      && typeof file.sha256 === "string"
      && /^[a-f0-9]{64}$/i.test(file.sha256)
        ? [{
          absolutePath: file.absolutePath,
          size: Number(file.size),
          lastModified: Number(file.lastModified),
          sha256: file.sha256.toLocaleLowerCase(),
        }]
        : []
    ))
    : [];
  const lastExport = isRecord(value.lastExport)
    && typeof value.lastExport.completedAt === "string"
    && isExportFormat(value.lastExport.format)
    && Array.isArray(value.lastExport.files)
      ? {
        completedAt: value.lastExport.completedAt,
        contextFingerprint: typeof value.lastExport.contextFingerprint === "string"
          ? value.lastExport.contextFingerprint
          : "",
        format: value.lastExport.format,
        files: value.lastExport.files.filter((file): file is string => typeof file === "string").slice(0, 100),
        verifiedFiles,
        outputDirectoryPath: typeof value.lastExport.outputDirectoryPath === "string" ? value.lastExport.outputDirectoryPath : null,
        sheetId: typeof value.lastExport.sheetId === "string" ? value.lastExport.sheetId : "10x15",
        copies: parseCopies(value.lastExport.copies),
      }
      : null;
  const pendingExport = parsePendingExport(value.pendingExport);
  return {
    schemaVersion: ID_PHOTO_JOB_SCHEMA_VERSION,
    id: value.id,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    customer: typeof value.customer === "string" ? value.customer.slice(0, 200) : "",
    jobName: typeof value.jobName === "string" ? value.jobName.slice(0, 200) : "Fototessera",
    profileId: typeof value.profileId === "string" ? value.profileId : "",
    folderPath: typeof value.folderPath === "string" ? value.folderPath : null,
    selectedAssetId: typeof value.selectedAssetId === "string" ? value.selectedAssetId : null,
    assets,
    crops,
    manualChecks: {
      face: manual.face === true,
      expression: manual.expression === true,
      accessories: manual.accessories === true,
    },
    technicalWarningsAccepted: value.technicalWarningsAccepted === true,
    imageAdjustments,
    sheetId: typeof value.sheetId === "string" ? value.sheetId : "10x15",
    copies: parseCopies(value.copies),
    format: isExportFormat(value.format) ? value.format : "pdf",
    cutGuides: value.cutGuides !== false,
    outputDirectoryPath: typeof value.outputDirectoryPath === "string" ? value.outputDirectoryPath : null,
    lastExport,
    pendingExport,
    status: value.status === "draft" || value.status === "preparing" || value.status === "to-review"
      || value.status === "approved" || value.status === "laid-out" || value.status === "ready"
      ? value.status
      : "draft",
  };
}

export function loadIdPhotoJobs(storage: Pick<Storage, "getItem">): PersistedIdPhotoJob[] {
  try {
    const parsed = JSON.parse(storage.getItem(ID_PHOTO_JOBS_STORAGE_KEY) || "null") as unknown;
    if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.jobs)) return [];
    return parsed.jobs
      .map(parseIdPhotoJob)
      .filter((job): job is PersistedIdPhotoJob => Boolean(job))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } catch {
    return [];
  }
}

export function loadActiveIdPhotoJob(storage: Pick<Storage, "getItem">): PersistedIdPhotoJob | null {
  const id = storage.getItem(ID_PHOTO_ACTIVE_JOB_STORAGE_KEY);
  return loadIdPhotoJobs(storage).find((job) => job.id === id) ?? null;
}

export function saveIdPhotoJob(
  storage: Pick<Storage, "getItem" | "setItem">,
  job: PersistedIdPhotoJob,
): PersistedIdPhotoJob[] {
  const parsed = parseIdPhotoJob(job);
  if (!parsed) throw new Error("Commessa ID Photo non valida.");
  const previousJobs = loadIdPhotoJobs(storage);
  const jobs = [parsed, ...previousJobs.filter((item) => item.id !== parsed.id)]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  if (jobs.length > ID_PHOTO_MAX_STORED_JOBS) {
    throw new IdPhotoStorageError(
      "capacity",
      `L’archivio locale ha raggiunto il limite di ${ID_PHOTO_MAX_STORED_JOBS} commesse. Elimina le commesse concluse prima di continuare.`,
    );
  }
  const serialized = JSON.stringify({ schemaVersion: 1, jobs } satisfies PersistedJobRegistry);
  if (serialized.length > ID_PHOTO_MAX_REGISTRY_CHARACTERS) {
    throw new IdPhotoStorageError(
      "capacity",
      "L’archivio locale di ID Photo è pieno. Elimina le commesse concluse o riduci le revisioni Photoshop prima di continuare.",
    );
  }
  try {
    storage.setItem(ID_PHOTO_JOBS_STORAGE_KEY, serialized);
    storage.setItem(ID_PHOTO_ACTIVE_JOB_STORAGE_KEY, parsed.id);
  } catch (error) {
    throw new IdPhotoStorageError(
      "write-failed",
      "FileX non può salvare la commessa nello spazio locale. La finestra resterà segnalata come non salvata: libera spazio prima di chiuderla.",
      { cause: error },
    );
  }
  return jobs;
}

export function deleteIdPhotoJob(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, jobId: string): PersistedIdPhotoJob[] {
  const jobs = loadIdPhotoJobs(storage).filter((job) => job.id !== jobId);
  storage.setItem(ID_PHOTO_JOBS_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, jobs } satisfies PersistedJobRegistry));
  if (storage.getItem(ID_PHOTO_ACTIVE_JOB_STORAGE_KEY) === jobId) storage.removeItem(ID_PHOTO_ACTIVE_JOB_STORAGE_KEY);
  return jobs;
}
