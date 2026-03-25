import type { ThumbnailError, ThumbnailResult } from "../workers/thumbnail-worker";

const THUMBNAIL_MAX = 420;
const THUMBNAIL_QUALITY = 0.72;
const BATCH_INTERVAL_MS = 120;

export interface ThumbnailUpdate {
  id: string;
  url: string;
  width: number;
  height: number;
  sourceFileKey?: string;
}

type BatchCallback = (batch: ThumbnailUpdate[]) => void;
type ErrorCallback = (failedCount: number, failedId: string) => void;

interface QueueItem {
  id: string;
  file?: File;
  loadFile?: () => Promise<File | null>;
  absolutePath?: string;
  sourceFileKey?: string;
  createSourceFileKey?: (file: File) => string;
  priority: number;
}

interface ActiveTask {
  id: string;
  sourceFileKey?: string;
  createSourceFileKey?: (file: File) => string;
}

function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export class ThumbnailPipeline {
  private workers: Worker[] = [];
  private busyWorkers = new Map<Worker, ActiveTask>();
  private queue: QueueItem[] = [];
  private processing = new Set<string>();
  private completed = new Set<string>();
  private failedIds = new Set<string>();
  private pendingBatch: ThumbnailUpdate[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private onBatch: BatchCallback;
  private onError: ErrorCallback | null;

  constructor(onBatch: BatchCallback, onError?: ErrorCallback) {
    this.onBatch = onBatch;
    this.onError = onError ?? null;

    const cores = navigator.hardwareConcurrency || 4;
    const poolSize = Math.max(2, Math.min(cores - 1, 8));

    for (let i = 0; i < poolSize; i += 1) {
      const worker = new Worker(
        new URL("../workers/thumbnail-worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (ev: MessageEvent<ThumbnailResult | ThumbnailError>) =>
        this.handleWorkerResult(worker, ev.data);
      worker.onerror = () => this.handleWorkerCrash(worker);
      this.workers.push(worker);
    }
  }

  enqueue(
    items: Array<Omit<QueueItem, "priority">>,
    priority = 2,
  ): void {
    for (const item of items) {
      if (this.completed.has(item.id) || this.processing.has(item.id)) {
        continue;
      }

      const existing = this.queue.find((queued) => queued.id === item.id);
      if (existing) {
        existing.priority = Math.min(existing.priority, priority);
        if (!existing.file && item.file) existing.file = item.file;
        if (!existing.loadFile && item.loadFile) existing.loadFile = item.loadFile;
        if (!existing.absolutePath && item.absolutePath) existing.absolutePath = item.absolutePath;
        if (!existing.sourceFileKey && item.sourceFileKey) existing.sourceFileKey = item.sourceFileKey;
        if (!existing.createSourceFileKey && item.createSourceFileKey) {
          existing.createSourceFileKey = item.createSourceFileKey;
        }
        continue;
      }

      this.queue.push({
        ...item,
        priority,
      });
    }

    this.sortQueue();
    this.schedule();
  }

  updateViewport(visibleIds: Set<string>): void {
    let changed = false;
    for (const item of this.queue) {
      const nextPriority = visibleIds.has(item.id) ? 0 : 2;
      if (item.priority !== nextPriority) {
        item.priority = nextPriority;
        changed = true;
      }
    }

    if (changed) {
      this.sortQueue();
      this.schedule();
    }
  }

  get pendingCount(): number {
    return this.queue.length + this.processing.size;
  }

  get completedCount(): number {
    return this.completed.size;
  }

  get failedCount(): number {
    return this.failedIds.size;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.flushBatch();
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.busyWorkers.clear();
    this.queue = [];
    this.processing.clear();
  }

  private sortQueue(): void {
    this.queue.sort((left, right) => left.priority - right.priority);
  }

  private schedule(): void {
    if (this.destroyed) {
      return;
    }

    while (this.queue.length > 0) {
      const worker = this.workers.find((candidate) => !this.busyWorkers.has(candidate));
      if (!worker) {
        return;
      }

      const nextItem = this.queue.shift();
      if (!nextItem) {
        return;
      }
      if (this.completed.has(nextItem.id) || this.processing.has(nextItem.id)) {
        continue;
      }

      this.processing.add(nextItem.id);
      this.busyWorkers.set(worker, {
        id: nextItem.id,
        sourceFileKey: nextItem.sourceFileKey,
        createSourceFileKey: nextItem.createSourceFileKey,
      });
      void this.dispatch(worker, nextItem);
    }
  }

  private async dispatch(worker: Worker, item: QueueItem): Promise<void> {
    if (
      item.absolutePath &&
      typeof window !== "undefined" &&
      typeof window.filexDesktop?.getThumbnail === "function"
    ) {
      try {
        const rendered = await window.filexDesktop.getThumbnail(
          item.absolutePath,
          THUMBNAIL_MAX,
          THUMBNAIL_QUALITY,
        );
        const task = this.releaseWorker(worker) ?? { id: item.id, sourceFileKey: item.sourceFileKey };
        if (!rendered) {
          this.markFailed(task.id);
          return;
        }

        const blob = new Blob([toOwnedArrayBuffer(rendered.bytes)], { type: rendered.mimeType });
        this.markCompleted({
          id: task.id,
          thumbnailBlob: blob,
          width: rendered.width,
          height: rendered.height,
        }, task.sourceFileKey);
        return;
      } catch {
        const task = this.releaseWorker(worker) ?? { id: item.id, sourceFileKey: item.sourceFileKey };
        this.markFailed(task.id);
        return;
      }
    }

    const file = item.file ?? await item.loadFile?.() ?? null;
    if (!file) {
      this.releaseWorker(worker);
      this.markFailed(item.id);
      return;
    }

    const task = this.busyWorkers.get(worker);
    if (task && !task.sourceFileKey && item.createSourceFileKey) {
      task.sourceFileKey = item.createSourceFileKey(file);
    }

    try {
      const buffer = await file.arrayBuffer();
      worker.postMessage(
        {
          id: item.id,
          buffer,
          maxDimension: THUMBNAIL_MAX,
          quality: THUMBNAIL_QUALITY,
        },
        [buffer],
      );
    } catch {
      this.releaseWorker(worker);
      this.markFailed(item.id);
    }
  }

  private handleWorkerResult(worker: Worker, data: ThumbnailResult | ThumbnailError): void {
    const task = this.releaseWorker(worker) ?? { id: data.id };
    if ("error" in data) {
      this.markFailed(task.id);
      return;
    }

    this.markCompleted(data, task.sourceFileKey);
  }

  private handleWorkerCrash(worker: Worker): void {
    const task = this.releaseWorker(worker);
    if (task) {
      this.markFailed(task.id);
    }
  }

  private releaseWorker(worker: Worker): ActiveTask | undefined {
    const task = this.busyWorkers.get(worker);
    this.busyWorkers.delete(worker);
    if (task) {
      this.processing.delete(task.id);
    }
    this.schedule();
    return task;
  }

  private markCompleted(result: ThumbnailResult, sourceFileKey?: string): void {
    if (this.destroyed) {
      return;
    }

    this.completed.add(result.id);
    const url = URL.createObjectURL(result.thumbnailBlob);
    this.pendingBatch.push({
      id: result.id,
      url,
      width: result.width,
      height: result.height,
      sourceFileKey,
    });

    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => this.flushBatch(), BATCH_INTERVAL_MS);
    }

    this.schedule();
  }

  private markFailed(id: string): void {
    if (this.destroyed) {
      return;
    }

    this.processing.delete(id);
    this.failedIds.add(id);
    if (this.onError) {
      this.onError(this.failedIds.size, id);
    }
    this.schedule();
  }

  private flushBatch(): void {
    this.batchTimer = null;
    if (this.pendingBatch.length === 0) {
      return;
    }

    const batch = this.pendingBatch;
    this.pendingBatch = [];
    this.onBatch(batch);
  }
}
