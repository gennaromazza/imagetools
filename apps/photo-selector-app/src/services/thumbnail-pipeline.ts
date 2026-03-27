import type { ThumbnailError, ThumbnailResult, ThumbnailRetry } from "../workers/thumbnail-worker";
import { perfLog, recordBytesRead } from "./performance-utils";

const DEFAULT_THUMBNAIL_MAX = 320;
const DEFAULT_THUMBNAIL_QUALITY = 0.72;
const EARLY_BATCH_INTERVAL_MS = 16;
const STEADY_BATCH_INTERVAL_MS = 72;
const EARLY_BATCH_COUNT = 48;
const MAX_PENDING_BATCH_SIZE = 10;
const RAW_PREVIEW_SCAN_BYTES = 512 * 1024;
const DEFAULT_MIN_EMBEDDED_PREVIEW_SHORT_SIDE = 800;
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

export interface ThumbnailPipelineOptions {
  maxDimension?: number;
  quality?: number;
  minimumPreviewShortSide?: number;
}

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
  private activeDesktopTasks = new Map<string, ActiveTask>();
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
  private maxDimension: number;
  private quality: number;
  private minimumPreviewShortSide: number;
  private desktopTaskLimit: number;

  constructor(onBatch: BatchCallback, onError?: ErrorCallback, options?: ThumbnailPipelineOptions) {
    this.onBatch = onBatch;
    this.onError = onError ?? null;
    this.maxDimension = options?.maxDimension ?? DEFAULT_THUMBNAIL_MAX;
    this.quality = options?.quality ?? DEFAULT_THUMBNAIL_QUALITY;
    this.minimumPreviewShortSide = options?.minimumPreviewShortSide ?? DEFAULT_MIN_EMBEDDED_PREVIEW_SHORT_SIDE;

    const cores = navigator.hardwareConcurrency || 4;
    const poolSize = Math.max(2, Math.min(6, Math.max(2, cores - 1)));
    this.desktopTaskLimit = Math.max(4, Math.min(12, cores));

    perfLog(`[PERF] thumbnail worker pool size            : ${poolSize}`);
    perfLog(`[PERF] desktop thumbnail task limit          : ${this.desktopTaskLimit}`);

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

  updateViewport(visibleIds: Set<string>, prioritizedIds?: Set<string>): void {
    let changed = false;
    for (const item of this.queue) {
      const nextPriority = visibleIds.has(item.id)
        ? 0
        : prioritizedIds?.has(item.id)
          ? 1
          : item.priority <= 1
            ? 2
          : item.priority;
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

  updateOptions(options?: ThumbnailPipelineOptions): void {
    this.maxDimension = options?.maxDimension ?? DEFAULT_THUMBNAIL_MAX;
    this.quality = options?.quality ?? DEFAULT_THUMBNAIL_QUALITY;
    this.minimumPreviewShortSide = options?.minimumPreviewShortSide ?? DEFAULT_MIN_EMBEDDED_PREVIEW_SHORT_SIDE;
  }

  invalidate(ids: Iterable<string>): void {
    for (const id of ids) {
      this.completed.delete(id);
      this.failedIds.delete(id);
    }
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
    this.activeDesktopTasks.clear();
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
      const canDispatchDesktopTask =
        typeof window !== "undefined" &&
        typeof window.filexDesktop?.getThumbnail === "function" &&
        this.activeDesktopTasks.size < this.desktopTaskLimit;

      let nextIndex = -1;
      let dispatchMode: "desktop" | "worker" | null = null;

      for (let index = 0; index < this.queue.length; index += 1) {
        const candidate = this.queue[index];
        const canUseDesktopPath = Boolean(candidate.absolutePath && typeof window !== "undefined" && typeof window.filexDesktop?.getThumbnail === "function");

        if (canUseDesktopPath && canDispatchDesktopTask) {
          nextIndex = index;
          dispatchMode = "desktop";
          break;
        }

        if (!canUseDesktopPath && worker) {
          nextIndex = index;
          dispatchMode = "worker";
          break;
        }
      }

      if (nextIndex < 0 || !dispatchMode) {
        return;
      }

      const [nextItem] = this.queue.splice(nextIndex, 1);
      if (!nextItem) {
        return;
      }
      this.queuedItems.delete(nextItem.id);
      if (this.completed.has(nextItem.id) || this.processing.has(nextItem.id)) {
        continue;
      }

      this.processing.add(nextItem.id);
      const activeTask: ActiveTask = {
        id: nextItem.id,
        sourceFileKey: nextItem.sourceFileKey,
        createSourceFileKey: nextItem.createSourceFileKey,
        item: nextItem,
      };

      if (dispatchMode === "desktop") {
        this.activeDesktopTasks.set(nextItem.id, activeTask);
        void this.dispatchDesktop(nextItem);
        continue;
      }

      if (!worker) {
        this.processing.delete(nextItem.id);
        this.queue.unshift(nextItem);
        this.queuedItems.set(nextItem.id, nextItem);
        return;
      }

      this.busyWorkers.set(worker, activeTask);
      void this.dispatch(worker, nextItem);
    }
  }

  private async dispatchDesktop(item: QueueItem): Promise<void> {
    if (!item.absolutePath || typeof window === "undefined" || typeof window.filexDesktop?.getThumbnail !== "function") {
      this.releaseDesktopTask(item.id);
      this.markFailed(item.id);
      return;
    }

    try {
      const rendered = await window.filexDesktop.getThumbnail(
        item.absolutePath,
        this.maxDimension,
        this.quality,
        item.sourceFileKey,
      );
      const task = this.releaseDesktopTask(item.id) ?? { id: item.id, sourceFileKey: item.sourceFileKey };
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
    } catch {
      const task = this.releaseDesktopTask(item.id) ?? { id: item.id, sourceFileKey: item.sourceFileKey };
      this.markFailed(task.id);
    }
  }

  private async dispatch(worker: Worker, item: QueueItem): Promise<void> {
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
              maxDimension: this.maxDimension,
              quality: this.quality,
              isEmbeddedPreview: true,
              minimumPreviewShortSide: this.minimumPreviewShortSide,
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
          maxDimension: this.maxDimension,
          quality: this.quality,
          isEmbeddedPreview: false,
          minimumPreviewShortSide: this.minimumPreviewShortSide,
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

  private releaseDesktopTask(id: string): ActiveTask | undefined {
    const task = this.activeDesktopTasks.get(id);
    this.activeDesktopTasks.delete(id);
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
