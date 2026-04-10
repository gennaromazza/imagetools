import { perfLog } from "./performance-utils";
const DEFAULT_THUMBNAIL_MAX = 320;
const DEFAULT_THUMBNAIL_QUALITY = 0.72;
const EARLY_BATCH_INTERVAL_MS = 16;
const STEADY_BATCH_INTERVAL_MS = 72;
const EARLY_BATCH_COUNT = 48;
const MAX_PENDING_BATCH_SIZE = 10;
function toOwnedArrayBuffer(bytes) {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
}
export class ThumbnailPipeline {
    queue = [];
    queuedItems = new Map();
    activeDesktopTasks = new Map();
    completed = new Set();
    failedIds = new Set();
    pendingBatch = [];
    batchTimer = null;
    destroyed = false;
    onBatch;
    onError;
    maxDimension;
    quality;
    desktopTaskLimit;
    constructor(onBatch, onError, options) {
        this.onBatch = onBatch;
        this.onError = onError ?? null;
        this.maxDimension = options?.maxDimension ?? DEFAULT_THUMBNAIL_MAX;
        this.quality = options?.quality ?? DEFAULT_THUMBNAIL_QUALITY;
        const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
        this.desktopTaskLimit = Math.max(4, Math.min(12, cores));
        perfLog(`[PERF] desktop thumbnail task limit          : ${this.desktopTaskLimit}`);
    }
    enqueue(items, priority = 2) {
        for (const item of items) {
            if (this.completed.has(item.id) || this.activeDesktopTasks.has(item.id)) {
                continue;
            }
            const existing = this.queuedItems.get(item.id);
            if (existing) {
                existing.priority = Math.min(existing.priority, priority);
                if (!existing.absolutePath && item.absolutePath)
                    existing.absolutePath = item.absolutePath;
                if (!existing.sourceFileKey && item.sourceFileKey)
                    existing.sourceFileKey = item.sourceFileKey;
                if (!existing.file && item.file)
                    existing.file = item.file;
                if (!existing.loadFile && item.loadFile)
                    existing.loadFile = item.loadFile;
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
    updateViewport(visibleIds, prioritizedIds) {
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
    get pendingCount() {
        return this.queue.length + this.activeDesktopTasks.size;
    }
    get completedCount() {
        return this.completed.size;
    }
    get failedCount() {
        return this.failedIds.size;
    }
    updateOptions(options) {
        this.maxDimension = options?.maxDimension ?? DEFAULT_THUMBNAIL_MAX;
        this.quality = options?.quality ?? DEFAULT_THUMBNAIL_QUALITY;
    }
    invalidate(ids) {
        for (const id of ids) {
            this.completed.delete(id);
            this.failedIds.delete(id);
        }
    }
    destroy() {
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
    sortQueue() {
        this.queue.sort((left, right) => left.priority - right.priority);
    }
    schedule() {
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
                id: nextItem.id,
                sourceFileKey: nextItem.sourceFileKey,
            });
            void this.dispatchDesktop(nextItem);
        }
    }
    async dispatchDesktop(item) {
        if (!item.absolutePath || typeof window === "undefined" || typeof window.filexDesktop?.getThumbnail !== "function") {
            this.releaseDesktopTask(item.id);
            this.markFailed(item.id);
            return;
        }
        try {
            const rendered = await window.filexDesktop.getThumbnail(item.absolutePath, this.maxDimension, this.quality, item.sourceFileKey);
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
        }
        catch {
            const task = this.releaseDesktopTask(item.id) ?? { id: item.id, sourceFileKey: item.sourceFileKey };
            this.markFailed(task.id);
        }
    }
    releaseDesktopTask(id) {
        const task = this.activeDesktopTasks.get(id);
        this.activeDesktopTasks.delete(id);
        this.schedule();
        return task;
    }
    markCompleted(result, sourceFileKey) {
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
    markFailed(id) {
        if (this.destroyed) {
            return;
        }
        this.failedIds.add(id);
        if (this.onError) {
            this.onError(this.failedIds.size, id);
        }
        this.schedule();
    }
    flushBatch() {
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
//# sourceMappingURL=thumbnail-pipeline.js.map