import { perfLog } from "./performance-utils";

const DEFAULT_THUMBNAIL_MAX = 320;
const DEFAULT_THUMBNAIL_QUALITY = 0.72;
const EARLY_BATCH_INTERVAL_MS = 16;
const STEADY_BATCH_INTERVAL_MS = 72;
const EARLY_BATCH_COUNT = 48;
const MAX_PENDING_BATCH_SIZE = 10;

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
}

interface ActiveTask extends QueueItem {
  version: number;
}

function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export class ThumbnailPipeline {
  private queue: QueueItem[] = [];
  private queuedItems = new Map<string, QueueItem>();
  private activeDesktopTasks = new Map<string, ActiveTask>();
  private completed = new Set<string>();
  private failedIds = new Set<string>();
  private pendingBatch: ThumbnailUpdate[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private onBatch: BatchCallback;
  private onError: ErrorCallback | null;
  private maxDimension: number;
  private quality: number;
  private desktopTaskLimit: number;
  private optionsVersion = 0;

  constructor(onBatch: BatchCallback, onError?: ErrorCallback, options?: ThumbnailPipelineOptions) {
    this.onBatch = onBatch;
    this.onError = onError ?? null;
    this.maxDimension = options?.maxDimension ?? DEFAULT_THUMBNAIL_MAX;
    this.quality = options?.quality ?? DEFAULT_THUMBNAIL_QUALITY;

    const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
    this.desktopTaskLimit = Math.max(4, Math.min(12, cores));
    perfLog(`[PERF] desktop thumbnail task limit          : ${this.desktopTaskLimit}`);
  }

  enqueue(
    items: Array<Omit<QueueItem, "priority">>,
    priority = 2,
  ): void {
    for (const item of items) {
      if (this.completed.has(item.id) || this.activeDesktopTasks.has(item.id)) {
        continue;
      }

      const existing = this.queuedItems.get(item.id);
      if (existing) {
        existing.priority = Math.min(existing.priority, priority);
        if (!existing.absolutePath && item.absolutePath) existing.absolutePath = item.absolutePath;
        if (!existing.sourceFileKey && item.sourceFileKey) existing.sourceFileKey = item.sourceFileKey;
        if (!existing.file && item.file) existing.file = item.file;
        if (!existing.loadFile && item.loadFile) existing.loadFile = item.loadFile;
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
    return this.queue.length + this.activeDesktopTasks.size;
  }

  get completedCount(): number {
    return this.completed.size;
  }

  get failedCount(): number {
    return this.failedIds.size;
  }

  updateOptions(options?: ThumbnailPipelineOptions): void {
    const nextMaxDimension = options?.maxDimension ?? DEFAULT_THUMBNAIL_MAX;
    const nextQuality = options?.quality ?? DEFAULT_THUMBNAIL_QUALITY;
    if (this.maxDimension === nextMaxDimension && this.quality === nextQuality) {
      return;
    }

    this.maxDimension = nextMaxDimension;
    this.quality = nextQuality;
    this.optionsVersion += 1;

    const activeItems = Array.from(this.activeDesktopTasks.values())
      .map(({ version: _version, ...item }) => item);
    this.activeDesktopTasks.clear();

    for (const item of activeItems) {
      if (this.completed.has(item.id) || this.queuedItems.has(item.id)) {
        continue;
      }
      this.queue.push(item);
      this.queuedItems.set(item.id, item);
    }

    this.sortQueue();
    this.schedule();
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
    this.activeDesktopTasks.clear();
    this.queue = [];
    this.queuedItems.clear();
  }

  private sortQueue(): void {
    this.queue.sort((left, right) => left.priority - right.priority);
  }

  private schedule(): void {
    if (this.destroyed) {
      return;
    }

    while (this.queue.length > 0 && this.activeDesktopTasks.size < this.desktopTaskLimit) {
      const nextItem = this.queue.shift();
      if (!nextItem) {
        return;
      }

      this.queuedItems.delete(nextItem.id);
      if (this.completed.has(nextItem.id) || this.activeDesktopTasks.has(nextItem.id)) {
        continue;
      }

      this.activeDesktopTasks.set(nextItem.id, {
        ...nextItem,
        version: this.optionsVersion,
      });
      void this.dispatchDesktop(nextItem, this.optionsVersion);
    }
  }

  private async dispatchDesktop(item: QueueItem, version: number): Promise<void> {
    if (!item.absolutePath || typeof window === "undefined" || typeof window.filexDesktop?.getThumbnail !== "function") {
      if (version !== this.optionsVersion) {
        return;
      }
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
      if (version !== this.optionsVersion) {
        return;
      }
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
      if (version !== this.optionsVersion) {
        return;
      }
      const task = this.releaseDesktopTask(item.id) ?? { id: item.id, sourceFileKey: item.sourceFileKey };
      this.markFailed(task.id);
    }
  }

  private releaseDesktopTask(id: string): ActiveTask | undefined {
    const task = this.activeDesktopTasks.get(id);
    this.activeDesktopTasks.delete(id);
    this.schedule();
    return task;
  }

  private markCompleted(result: { id: string; thumbnailBlob: Blob; width: number; height: number }, sourceFileKey?: string): void {
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
