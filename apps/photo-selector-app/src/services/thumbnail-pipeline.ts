import type { ThumbnailError, ThumbnailResult, ThumbnailRetry } from "../workers/thumbnail-worker";
import { perfLog, recordBytesRead } from "./performance-utils";

const THUMBNAIL_MAX = 420;
const THUMBNAIL_QUALITY = 0.72;
const EARLY_BATCH_INTERVAL_MS = 16;
const STEADY_BATCH_INTERVAL_MS = 72;
const EARLY_BATCH_COUNT = 48;
const MAX_PENDING_BATCH_SIZE = 10;
const RAW_PREVIEW_SCAN_BYTES = 512 * 1024;
const MIN_EMBEDDED_PREVIEW_SHORT_SIDE = 800;
const RAW_EXTENSIONS = new Set([
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

export interface ThumbnailUpdate {
  id: string;
  url: string;
  blob: Blob;
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
  forceFullFile?: boolean;
}

interface ActiveTask {
  id: string;
  sourceFileKey?: string;
  createSourceFileKey?: (file: File) => string;
  item: QueueItem;
}

function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function isLikelyRawFile(fileName: string): boolean {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0) {
    return false;
  }

  return RAW_EXTENSIONS.has(fileName.slice(dotIndex).toLowerCase());
}

let rawExtractorModulePromise: Promise<typeof import("../workers/raw-jpeg-extractor")> | null = null;

async function getRawExtractorModule() {
  rawExtractorModulePromise ??= import("../workers/raw-jpeg-extractor");
  return rawExtractorModulePromise;
}

async function tryReadEmbeddedPreview(file: File): Promise<ArrayBuffer | null> {
  const headerBuffer = await file.slice(0, RAW_PREVIEW_SCAN_BYTES).arrayBuffer();
  recordBytesRead("raw", headerBuffer.byteLength);

  const { locateEmbeddedJpegRange } = await getRawExtractorModule();
  const previewRange = locateEmbeddedJpegRange(headerBuffer);
  if (!previewRange) {
    return null;
  }

  const previewEnd = previewRange.offset + previewRange.length;
  if (previewRange.offset < 0 || previewEnd > file.size || previewRange.length <= 10_000) {
    return null;
  }

  if (previewEnd <= headerBuffer.byteLength) {
    return headerBuffer.slice(previewRange.offset, previewEnd);
  }

  const previewBuffer = await file.slice(previewRange.offset, previewEnd).arrayBuffer();
  recordBytesRead("raw", previewBuffer.byteLength);
  return previewBuffer;
}

export class ThumbnailPipeline {
  private workers: Worker[] = [];
  private busyWorkers = new Map<Worker, ActiveTask>();
  private queue: QueueItem[] = [];
  private queuedItems = new Map<string, QueueItem>();
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
    const poolSize = Math.max(1, Math.min(cores, 8));

    perfLog(`[PERF] thumbnail worker pool size            : ${poolSize}`);

    for (let i = 0; i < poolSize; i += 1) {
      const worker = new Worker(
        new URL("../workers/thumbnail-worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (ev: MessageEvent<ThumbnailResult | ThumbnailError | ThumbnailRetry>) =>
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

      const existing = this.queuedItems.get(item.id);
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

      const queuedItem = {
        ...item,
        priority,
      };
      this.queue.push(queuedItem);
      this.queuedItems.set(queuedItem.id, queuedItem);
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
    this.queuedItems.clear();
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
      this.queuedItems.delete(nextItem.id);
      if (this.completed.has(nextItem.id) || this.processing.has(nextItem.id)) {
        continue;
      }

      this.processing.add(nextItem.id);
      this.busyWorkers.set(worker, {
        id: nextItem.id,
        sourceFileKey: nextItem.sourceFileKey,
        createSourceFileKey: nextItem.createSourceFileKey,
        item: nextItem,
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
          item.sourceFileKey,
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
      if (!item.forceFullFile && isLikelyRawFile(file.name)) {
        const previewBuffer = await tryReadEmbeddedPreview(file);
        if (previewBuffer) {
          worker.postMessage(
            {
              id: item.id,
              buffer: previewBuffer,
              maxDimension: THUMBNAIL_MAX,
              quality: THUMBNAIL_QUALITY,
              isEmbeddedPreview: true,
              minimumPreviewShortSide: MIN_EMBEDDED_PREVIEW_SHORT_SIDE,
            },
            [previewBuffer],
          );
          return;
        }
      }

      const buffer = await file.arrayBuffer();
      recordBytesRead(isLikelyRawFile(file.name) ? "raw" : "standard", buffer.byteLength);
      worker.postMessage(
        {
          id: item.id,
          buffer,
          maxDimension: THUMBNAIL_MAX,
          quality: THUMBNAIL_QUALITY,
          isEmbeddedPreview: false,
          minimumPreviewShortSide: MIN_EMBEDDED_PREVIEW_SHORT_SIDE,
        },
        [buffer],
      );
    } catch {
      this.releaseWorker(worker);
      this.markFailed(item.id);
    }
  }

  private handleWorkerResult(worker: Worker, data: ThumbnailResult | ThumbnailError | ThumbnailRetry): void {
    const task = this.releaseWorker(worker);
    if ("retryWithFullBuffer" in data) {
      const retryItem = task
        ? { ...task.item, forceFullFile: true, priority: 0 }
        : null;
      if (retryItem) {
        this.queue.unshift(retryItem);
        this.sortQueue();
        this.schedule();
      } else {
        this.markFailed(data.id);
      }
      return;
    }

    if ("error" in data) {
      this.markFailed(task?.id ?? data.id);
      return;
    }

    if (!task) {
      this.markFailed(data.id);
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
      blob: result.thumbnailBlob,
      width: result.width,
      height: result.height,
      sourceFileKey,
    });

    if (this.pendingBatch.length >= MAX_PENDING_BATCH_SIZE) {
      this.flushBatch();
      this.schedule();
      return;
    }

    if (!this.batchTimer) {
      const interval = this.completed.size <= EARLY_BATCH_COUNT
        ? EARLY_BATCH_INTERVAL_MS
        : STEADY_BATCH_INTERVAL_MS;
      this.batchTimer = setTimeout(() => this.flushBatch(), interval);
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
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    if (this.pendingBatch.length === 0) {
      return;
    }

    const batch = this.pendingBatch;
    this.pendingBatch = [];
    this.onBatch(batch);
  }
}
