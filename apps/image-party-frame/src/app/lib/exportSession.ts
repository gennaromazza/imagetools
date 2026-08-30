export interface BatchExportResult {
  success: Array<{ id: string; filename: string; size: number }>;
  failed: Array<{ id: string; error: string }>;
  totalTime: number;
  outputDir: string;
}

export type ExportJobStatus = "queued" | "running" | "cancelling" | "cancelled" | "completed" | "failed";
export type ExportJobPhase =
  | "queued"
  | "preparing"
  | "rendering"
  | "writing"
  | "cleaning"
  | "completed"
  | "cancelled"
  | "failed";

export interface ExportJobSnapshot {
  id: string;
  status: ExportJobStatus;
  createdAt: string;
  updatedAt: string;
  progress: {
    phase: ExportJobPhase;
    completed: number;
    total: number;
    percent: number;
    currentItemId: string | null;
  };
  result?: BatchExportResult;
  error?: { code: string; message: string };
}

export type ExportClientStatus =
  | "ready"
  | "uploading"
  | "connection-error"
  | ExportJobStatus;

export interface ExportSessionRecord {
  version: 1;
  intentId: string;
  idempotencyKey: string;
  projectId: string;
  itemIds: string[];
  itemNames: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  status: ExportClientStatus;
  jobId?: string;
  snapshot?: ExportJobSnapshot;
}

const ACTIVE_EXPORT_SESSION_KEY = "image-party-frame.active-export-session.v1";
const TERMINAL_EXPORT_STATUSES = new Set<ExportClientStatus>(["completed", "failed", "cancelled"]);
const EXPORT_CLIENT_STATUSES = new Set<ExportClientStatus>([
  "ready", "uploading", "connection-error", "queued", "running", "cancelling", "cancelled", "completed", "failed",
]);
const EXPORT_JOB_STATUSES = new Set<ExportJobStatus>(["queued", "running", "cancelling", "cancelled", "completed", "failed"]);
const EXPORT_JOB_PHASES = new Set<ExportJobPhase>([
  "queued", "preparing", "rendering", "writing", "cleaning", "completed", "cancelled", "failed",
]);
const MAX_EXPORT_ITEMS = 500;

function isBoundedString(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= maxLength && (allowEmpty || value.trim().length > 0);
}

function isFiniteRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function randomIntentId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid.replace(/-/g, "");
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
}

function safeSessionStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function isExportJobSnapshot(value: unknown): value is ExportJobSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ExportJobSnapshot>;
  if (
    !isBoundedString(candidate.id, 128)
    || !EXPORT_JOB_STATUSES.has(candidate.status as ExportJobStatus)
    || !isBoundedString(candidate.createdAt, 64)
    || !isBoundedString(candidate.updatedAt, 64)
    || !candidate.progress
    || !EXPORT_JOB_PHASES.has(candidate.progress.phase)
    || !isFiniteRange(candidate.progress.completed, 0, MAX_EXPORT_ITEMS)
    || !isFiniteRange(candidate.progress.total, 0, MAX_EXPORT_ITEMS)
    || candidate.progress.completed > candidate.progress.total
    || !isFiniteRange(candidate.progress.percent, 0, 100)
    || !(candidate.progress.currentItemId === null || isBoundedString(candidate.progress.currentItemId, 256))
  ) {
    return false;
  }

  if (candidate.error !== undefined && (
    !candidate.error
    || !isBoundedString(candidate.error.code, 128)
    || !isBoundedString(candidate.error.message, 2_000)
  )) {
    return false;
  }

  if (candidate.result !== undefined) {
    const result = candidate.result;
    if (
      !result
      || !Array.isArray(result.success)
      || !Array.isArray(result.failed)
      || result.success.length + result.failed.length > MAX_EXPORT_ITEMS
      || !isFiniteRange(result.totalTime, 0, Number.MAX_SAFE_INTEGER)
      || !isBoundedString(result.outputDir, 4_096)
      || !result.success.every((entry) => Boolean(entry)
        && isBoundedString(entry.id, 256)
        && isBoundedString(entry.filename, 1_024)
        && isFiniteRange(entry.size, 0, Number.MAX_SAFE_INTEGER))
      || !result.failed.every((entry) => Boolean(entry)
        && isBoundedString(entry.id, 256)
        && isBoundedString(entry.error, 2_000))
    ) {
      return false;
    }
  }

  return true;
}

export function normalizeExportSession(value: unknown): ExportSessionRecord | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ExportSessionRecord>;
  if (
    candidate.version !== 1
    || !isBoundedString(candidate.intentId, 128)
    || !isBoundedString(candidate.idempotencyKey, 128)
    || !/^[A-Za-z0-9._:-]+$/.test(candidate.idempotencyKey)
    || !isBoundedString(candidate.projectId, 256)
    || !Array.isArray(candidate.itemIds)
    || candidate.itemIds.length === 0
    || candidate.itemIds.length > MAX_EXPORT_ITEMS
    || !candidate.itemIds.every((item) => isBoundedString(item, 256))
    || new Set(candidate.itemIds).size !== candidate.itemIds.length
    || !candidate.itemNames
    || typeof candidate.itemNames !== "object"
    || !isBoundedString(candidate.createdAt, 64)
    || !isBoundedString(candidate.updatedAt, 64)
    || !EXPORT_CLIENT_STATUSES.has(candidate.status as ExportClientStatus)
  ) {
    return null;
  }

  const jobId = candidate.jobId === undefined
    ? undefined
    : isBoundedString(candidate.jobId, 128) ? candidate.jobId : null;
  if (jobId === null) return null;
  const snapshot = candidate.snapshot === undefined
    ? undefined
    : isExportJobSnapshot(candidate.snapshot) ? candidate.snapshot : null;
  if (snapshot === null || (snapshot && jobId !== snapshot.id)) return null;

  const itemIdSet = new Set(candidate.itemIds);
  return {
    version: 1,
    intentId: candidate.intentId,
    idempotencyKey: candidate.idempotencyKey,
    projectId: candidate.projectId,
    itemIds: [...candidate.itemIds],
    itemNames: Object.fromEntries(
      Object.entries(candidate.itemNames).filter((entry): entry is [string, string] =>
        itemIdSet.has(entry[0]) && isBoundedString(entry[1], 1_024)
      )
    ),
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    status: candidate.status as ExportClientStatus,
    ...(jobId ? { jobId } : {}),
    ...(snapshot ? { snapshot } : {}),
  };
}

export function loadExportSession(projectId?: string): ExportSessionRecord | null {
  const storage = safeSessionStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(ACTIVE_EXPORT_SESSION_KEY);
    const session = raw ? normalizeExportSession(JSON.parse(raw)) : null;
    return session && (!projectId || session.projectId === projectId) ? session : null;
  } catch {
    return null;
  }
}

function storeExportSession(session: ExportSessionRecord): ExportSessionRecord {
  try {
    safeSessionStorage()?.setItem(ACTIVE_EXPORT_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Export remains usable when browser storage is disabled, but cannot resume.
  }
  return session;
}

export function createExportIntent(
  projectId: string,
  itemNames: Record<string, string>,
  forceNew = false
): ExportSessionRecord {
  const current = loadExportSession(projectId);
  if (!forceNew && current && !TERMINAL_EXPORT_STATUSES.has(current.status)) {
    if (!current.jobId && current.status === "ready") {
      return storeExportSession({
        ...current,
        itemIds: Object.keys(itemNames),
        itemNames: { ...itemNames },
        updatedAt: new Date().toISOString(),
      });
    }
    return current;
  }

  const intentId = randomIntentId();
  const now = new Date().toISOString();
  return storeExportSession({
    version: 1,
    intentId,
    idempotencyKey: `partyframe.${intentId}`,
    projectId,
    itemIds: Object.keys(itemNames),
    itemNames: { ...itemNames },
    createdAt: now,
    updatedAt: now,
    status: "ready",
  });
}

export function updateExportSession(
  intentId: string,
  patch: Partial<Omit<ExportSessionRecord, "version" | "intentId" | "idempotencyKey" | "projectId" | "createdAt">>
): ExportSessionRecord | null {
  const current = loadExportSession();
  if (!current || current.intentId !== intentId) return null;
  return storeExportSession({
    ...current,
    ...patch,
    itemIds: patch.itemIds ? [...patch.itemIds] : current.itemIds,
    itemNames: patch.itemNames ? { ...patch.itemNames } : current.itemNames,
    updatedAt: new Date().toISOString(),
  });
}
