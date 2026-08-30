import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  executeExport,
  ExportCancelledError,
  HttpError,
  type BatchExportItem,
  type ExportExecutionPhase,
  type ExportResult,
  type PreparedExportRequest,
} from "./pipeline.js";

export type ExportJobStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "failed";

export type ExportJobPhase =
  | "queued"
  | ExportExecutionPhase
  | "completed"
  | "cancelled"
  | "failed";

export interface ExportJobProgress {
  phase: ExportJobPhase;
  completed: number;
  total: number;
  percent: number;
  currentItemId: string | null;
}

export interface ExportJobError {
  code: string;
  message: string;
}

export interface ExportJobSnapshot {
  id: string;
  status: ExportJobStatus;
  createdAt: string;
  updatedAt: string;
  progress: ExportJobProgress;
  result?: ExportResult;
  error?: ExportJobError;
}

interface ExportJobRecord extends ExportJobSnapshot {
  request: PreparedExportRequest;
  cleanupPaths: string[];
  controller: AbortController;
  idempotencyKey?: string;
  completion: Promise<ExportJobSnapshot>;
  resolveCompletion: (snapshot: ExportJobSnapshot) => void;
  retentionTimer?: NodeJS.Timeout;
}

export interface ExportJobManagerOptions {
  maxConcurrentJobs?: number;
  maxPendingJobs?: number;
  retentionMs?: number;
}

export interface CreateExportJobOptions {
  id?: string;
  request: PreparedExportRequest;
  cleanupPaths: string[];
  idempotencyKey?: string;
}

export interface CreateExportJobResult {
  snapshot: ExportJobSnapshot;
  reused: boolean;
}

const DEFAULT_MAX_CONCURRENT_JOBS = 2;
const DEFAULT_MAX_PENDING_JOBS = 8;
const DEFAULT_RETENTION_MS = 60 * 60 * 1_000;

function nowIso(): string {
  return new Date().toISOString();
}

function cloneResult(result: ExportResult | undefined): ExportResult | undefined {
  if (!result) return undefined;
  return {
    success: result.success.map((entry) => ({ ...entry })),
    failed: result.failed.map((entry) => ({ ...entry })),
    totalTime: result.totalTime,
    outputDir: result.outputDir,
  };
}

function snapshotOf(record: ExportJobRecord): ExportJobSnapshot {
  return {
    id: record.id,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    progress: { ...record.progress },
    ...(record.result ? { result: cloneResult(record.result) } : {}),
    ...(record.error ? { error: { ...record.error } } : {}),
  };
}

async function removeFiles(filePaths: string[]): Promise<void> {
  const uniquePaths = new Set(filePaths.filter(Boolean).map((filePath) => path.resolve(filePath)));
  await Promise.all([...uniquePaths].map(async (filePath) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await rm(filePath, { force: true });
        return;
      } catch (error) {
        if (attempt === 2) {
          console.warn("PartyFrame could not remove a temporary upload:", error);
          return;
        }
        await delay(25 * (attempt + 1));
      }
    }
  }));
}

function publicJobError(error: unknown): ExportJobError {
  if (error instanceof HttpError) {
    const messages: Record<string, string> = {
      INVALID_TEMPLATE_BACKGROUND: "Lo sfondo del template è danneggiato o non supportato",
      INVALID_TEMPLATE: "Il template selezionato non è valido",
      INVALID_GEOMETRY: "Il ritaglio o l'area foto non sono validi",
      INVALID_OUTPUT_PATH: "Il percorso di esportazione non è una cartella valida",
      OUTPUT_NOT_WRITABLE: "La cartella di esportazione non è scrivibile",
      WORKING_IMAGE_TOO_LARGE: "Il livello di zoom genera un'immagine troppo grande da elaborare",
    };
    return { code: error.code, message: messages[error.code] ?? "I dati dell'esportazione non sono validi" };
  }
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "ENOSPC") return { code: "DISK_FULL", message: "Spazio su disco insufficiente per completare l'esportazione" };
  if (code === "EACCES" || code === "EPERM") {
    return { code: "OUTPUT_NOT_WRITABLE", message: "La cartella di esportazione non è scrivibile" };
  }
  return { code: "EXPORT_FAILED", message: "L'esportazione non è stata completata" };
}

export class ExportJobManager {
  private readonly jobs = new Map<string, ExportJobRecord>();
  private readonly idempotencyIndex = new Map<string, string>();
  private readonly queue: string[] = [];
  private readonly maxConcurrentJobs: number;
  private readonly maxPendingJobs: number;
  private readonly retentionMs: number;
  private runningJobs = 0;
  private closed = false;

  constructor(options: ExportJobManagerOptions = {}) {
    this.maxConcurrentJobs = Math.max(1, Math.min(8, Math.floor(options.maxConcurrentJobs ?? DEFAULT_MAX_CONCURRENT_JOBS)));
    this.maxPendingJobs = Math.max(
      this.maxConcurrentJobs,
      Math.min(32, Math.floor(options.maxPendingJobs ?? DEFAULT_MAX_PENDING_JOBS)),
    );
    this.retentionMs = Math.max(1_000, options.retentionMs ?? DEFAULT_RETENTION_MS);
  }

  get(id: string): ExportJobSnapshot | null {
    const record = this.jobs.get(id);
    return record ? snapshotOf(record) : null;
  }

  getByIdempotencyKey(key: string): ExportJobSnapshot | null {
    const id = this.idempotencyIndex.get(key);
    return id ? this.get(id) : null;
  }

  hasCapacity(): boolean {
    return [...this.jobs.values()].filter((record) =>
      record.status === "queued" || record.status === "running" || record.status === "cancelling"
    ).length < this.maxPendingJobs;
  }

  async create(options: CreateExportJobOptions): Promise<CreateExportJobResult> {
    if (this.closed) throw new Error("Export job manager is closed");

    if (options.idempotencyKey) {
      const existing = this.getByIdempotencyKey(options.idempotencyKey);
      if (existing) {
        await removeFiles(options.cleanupPaths);
        return { snapshot: existing, reused: true };
      }
    }
    if (!this.hasCapacity()) {
      await removeFiles(options.cleanupPaths);
      throw new HttpError(429, "JOB_QUEUE_FULL", "The export queue is full; wait for a running job to finish");
    }

    const id = options.id ?? randomUUID();
    if (this.jobs.has(id)) throw new Error(`Export job already exists: ${id}`);

    const createdAt = nowIso();
    let resolveCompletion!: (snapshot: ExportJobSnapshot) => void;
    const completion = new Promise<ExportJobSnapshot>((resolve) => {
      resolveCompletion = resolve;
    });
    const record: ExportJobRecord = {
      id,
      status: "queued",
      createdAt,
      updatedAt: createdAt,
      progress: {
        phase: "queued",
        completed: 0,
        total: options.request.files.length,
        percent: 0,
        currentItemId: null,
      },
      request: options.request,
      cleanupPaths: [...options.cleanupPaths],
      controller: new AbortController(),
      idempotencyKey: options.idempotencyKey,
      completion,
      resolveCompletion,
    };

    this.jobs.set(id, record);
    if (options.idempotencyKey) this.idempotencyIndex.set(options.idempotencyKey, id);
    this.queue.push(id);
    queueMicrotask(() => this.drain());
    return { snapshot: snapshotOf(record), reused: false };
  }

  async wait(id: string): Promise<ExportJobSnapshot | null> {
    const record = this.jobs.get(id);
    return record ? record.completion : null;
  }

  async cancel(id: string): Promise<ExportJobSnapshot | null> {
    const record = this.jobs.get(id);
    if (!record) return null;

    if (record.status === "queued") {
      const queueIndex = this.queue.indexOf(id);
      if (queueIndex >= 0) this.queue.splice(queueIndex, 1);
      record.controller.abort();
      record.status = "cancelling";
      record.updatedAt = nowIso();
      record.progress.phase = "cleaning";
      await removeFiles(record.cleanupPaths);
      record.cleanupPaths = [];
      this.finish(record, "cancelled", "cancelled");
      return snapshotOf(record);
    }

    if (record.status === "running") {
      record.status = "cancelling";
      record.updatedAt = nowIso();
      record.controller.abort();
    }

    return snapshotOf(record);
  }

  async close(): Promise<void> {
    this.closed = true;
    const cancellations = [...this.jobs.values()]
      .filter((record) => record.status === "queued" || record.status === "running" || record.status === "cancelling")
      .map((record) => this.cancel(record.id));
    await Promise.all(cancellations);
    const activeCompletions = [...this.jobs.values()]
      .filter((record) => record.status === "cancelling")
      .map((record) => record.completion);
    await Promise.all(activeCompletions);
    for (const record of this.jobs.values()) {
      if (record.retentionTimer) clearTimeout(record.retentionTimer);
    }
  }

  private drain(): void {
    if (this.closed) return;
    while (this.runningJobs < this.maxConcurrentJobs && this.queue.length > 0) {
      const id = this.queue.shift()!;
      const record = this.jobs.get(id);
      if (!record || record.status !== "queued") continue;
      this.runningJobs += 1;
      void this.run(record);
    }
  }

  private async run(record: ExportJobRecord): Promise<void> {
    record.status = "running";
    record.updatedAt = nowIso();
    record.progress.phase = "preparing";

    let finalStatus: Extract<ExportJobStatus, "completed" | "cancelled" | "failed"> = "completed";
    let finalPhase: Extract<ExportJobPhase, "completed" | "cancelled" | "failed"> = "completed";

    try {
      record.result = await executeExport(record.request, {
        signal: record.controller.signal,
        onPhase: (phase, item) => this.updatePhase(record, phase, item),
        onItemSettled: (completed, total, item) => this.updateProgress(record, completed, total, item),
      });
    } catch (error) {
      if (error instanceof ExportCancelledError) {
        record.result = error.result;
        finalStatus = "cancelled";
        finalPhase = "cancelled";
      } else {
        record.error = publicJobError(error);
        finalStatus = "failed";
        finalPhase = "failed";
      }
    } finally {
      record.progress.phase = "cleaning";
      record.progress.currentItemId = null;
      record.updatedAt = nowIso();
      await removeFiles(record.cleanupPaths);
      record.cleanupPaths = [];
      this.finish(record, finalStatus, finalPhase);
      this.runningJobs -= 1;
      this.drain();
    }
  }

  private updatePhase(record: ExportJobRecord, phase: ExportExecutionPhase, item: BatchExportItem | null): void {
    record.progress.phase = phase;
    record.progress.currentItemId = item?.id ?? null;
    record.updatedAt = nowIso();
  }

  private updateProgress(record: ExportJobRecord, completed: number, total: number, item: BatchExportItem): void {
    record.progress.completed = completed;
    record.progress.total = total;
    record.progress.percent = total === 0 ? 100 : Math.round((completed / total) * 100);
    record.progress.currentItemId = item.id;
    record.updatedAt = nowIso();
  }

  private finish(
    record: ExportJobRecord,
    status: Extract<ExportJobStatus, "completed" | "cancelled" | "failed">,
    phase: Extract<ExportJobPhase, "completed" | "cancelled" | "failed">,
  ): void {
    record.status = status;
    record.progress.phase = phase;
    record.progress.currentItemId = null;
    record.updatedAt = nowIso();
    const snapshot = snapshotOf(record);
    record.resolveCompletion(snapshot);
    record.retentionTimer = setTimeout(() => this.expire(record.id), this.retentionMs);
    record.retentionTimer.unref?.();
  }

  private expire(id: string): void {
    const record = this.jobs.get(id);
    if (!record) return;
    if (record.idempotencyKey && this.idempotencyIndex.get(record.idempotencyKey) === id) {
      this.idempotencyIndex.delete(record.idempotencyKey);
    }
    this.jobs.delete(id);
  }
}

export async function cleanupUploadedFiles(filePaths: string[]): Promise<void> {
  await removeFiles(filePaths);
}
