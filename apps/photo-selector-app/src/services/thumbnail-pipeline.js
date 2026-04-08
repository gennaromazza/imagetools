import { perfLog, recordBytesRead } from "./performance-utils";
const DEFAULT_THUMBNAIL_MAX = 320;
const DEFAULT_THUMBNAIL_QUALITY = 0.72;
const EARLY_BATCH_INTERVAL_MS = 16;
const STEADY_BATCH_INTERVAL_MS = 72;
const EARLY_BATCH_COUNT = 48;
const MAX_PENDING_BATCH_SIZE = 10;
const DESKTOP_BACKGROUND_LIMIT_MIN = 2;
const DESKTOP_BACKGROUND_LIMIT_MAX = 4;
const DESKTOP_FOREGROUND_RESERVE_MIN = 2;
const DESKTOP_FOREGROUND_RESERVE_MAX = 6;
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
function toOwnedArrayBuffer(bytes) {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
}
function isLikelyRawFile(fileName) {
    const dotIndex = fileName.lastIndexOf(".");
    if (dotIndex < 0) {
        return false;
    }
    return RAW_EXTENSIONS.has(fileName.slice(dotIndex).toLowerCase());
}
let rawExtractorModulePromise = null;
async function getRawExtractorModule() {
    rawExtractorModulePromise ??= import("../workers/raw-jpeg-extractor");
    return rawExtractorModulePromise;
}
async function tryReadEmbeddedPreview(file) {
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
    workers = [];
    busyWorkers = new Map();
    activeDesktopTasks = new Map();
    queue = [];
    queuedItems = new Map();
    processing = new Set();
    completed = new Set();
    failedIds = new Set();
    pendingBatch = [];
    batchTimer = null;
    destroyed = false;
    onBatch;
    onError;
    maxDimension;
    quality;
    minimumPreviewShortSide;
    desktopTaskLimit;
    desktopBackgroundTaskLimit;
    desktopForegroundReserve;
    constructor(onBatch, onError, options) {
        this.onBatch = onBatch;
        this.onError = onError ?? null;
        this.maxDimension = options?.maxDimension ?? DEFAULT_THUMBNAIL_MAX;
        this.quality = options?.quality ?? DEFAULT_THUMBNAIL_QUALITY;
        this.minimumPreviewShortSide = options?.minimumPreviewShortSide ?? DEFAULT_MIN_EMBEDDED_PREVIEW_SHORT_SIDE;
        const cores = navigator.hardwareConcurrency || 4;
        const poolSize = Math.max(2, Math.min(6, Math.max(2, cores - 1)));
        this.desktopTaskLimit = Math.max(4, Math.min(12, cores));
        this.desktopBackgroundTaskLimit = Math.max(DESKTOP_BACKGROUND_LIMIT_MIN, Math.min(DESKTOP_BACKGROUND_LIMIT_MAX, Math.floor(this.desktopTaskLimit * 0.45)));
        this.desktopForegroundReserve = Math.max(DESKTOP_FOREGROUND_RESERVE_MIN, Math.min(DESKTOP_FOREGROUND_RESERVE_MAX, Math.floor(this.desktopTaskLimit * 0.35)));
        perfLog(`[PERF] thumbnail worker pool size            : ${poolSize}`);
        perfLog(`[PERF] desktop thumbnail task limit          : ${this.desktopTaskLimit}`);
        perfLog(`[PERF] desktop background task limit       : ${this.desktopBackgroundTaskLimit}`);
        perfLog(`[PERF] desktop foreground reserve slots    : ${this.desktopForegroundReserve}`);
        for (let i = 0; i < poolSize; i += 1) {
            const worker = new Worker(new URL("../workers/thumbnail-worker.ts", import.meta.url), { type: "module" });
            worker.onmessage = (ev) => this.handleWorkerResult(worker, ev.data);
            worker.onerror = () => this.handleWorkerCrash(worker);
            this.workers.push(worker);
        }
    }
    enqueue(items, priority = 2) {
        for (const item of items) {
            if (this.completed.has(item.id) || this.processing.has(item.id)) {
                continue;
            }
            const existing = this.queuedItems.get(item.id);
            if (existing) {
                existing.priority = Math.min(existing.priority, priority);
                if (!existing.file && item.file)
                    existing.file = item.file;
                if (!existing.loadFile && item.loadFile)
                    existing.loadFile = item.loadFile;
                if (!existing.absolutePath && item.absolutePath)
                    existing.absolutePath = item.absolutePath;
                if (!existing.sourceFileKey && item.sourceFileKey)
                    existing.sourceFileKey = item.sourceFileKey;
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
        return this.queue.length + this.processing.size;
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
        this.minimumPreviewShortSide = options?.minimumPreviewShortSide ?? DEFAULT_MIN_EMBEDDED_PREVIEW_SHORT_SIDE;
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
    sortQueue() {
        this.queue.sort((left, right) => left.priority - right.priority);
    }
    hasForegroundQueued() {
        for (const item of this.queue) {
            if (item.priority <= 1) {
                return true;
            }
        }
        return false;
    }
    countActiveDesktopBackgroundTasks() {
        let count = 0;
        for (const task of this.activeDesktopTasks.values()) {
            if (task.item.priority > 1) {
                count += 1;
            }
        }
        return count;
    }
    schedule() {
        if (this.destroyed) {
            return;
        }
        while (this.queue.length > 0) {
            const worker = this.workers.find((candidate) => !this.busyWorkers.has(candidate));
            const canUseDesktopBridge = typeof window !== "undefined" &&
                typeof window.filexDesktop?.getThumbnail === "function";
            const canDispatchDesktopTask = canUseDesktopBridge && this.activeDesktopTasks.size < this.desktopTaskLimit;
            const foregroundQueued = this.hasForegroundQueued();
            const activeDesktopBackgroundTasks = this.countActiveDesktopBackgroundTasks();
            const availableDesktopSlots = Math.max(0, this.desktopTaskLimit - this.activeDesktopTasks.size);
            let nextIndex = -1;
            let dispatchMode = null;
            for (let index = 0; index < this.queue.length; index += 1) {
                const candidate = this.queue[index];
                const canUseDesktopPath = Boolean(candidate.absolutePath && canUseDesktopBridge);
                if (canUseDesktopPath && canDispatchDesktopTask) {
                    const isBackgroundTask = candidate.priority > 1;
                    if (isBackgroundTask && foregroundQueued) {
                        if (activeDesktopBackgroundTasks >= this.desktopBackgroundTaskLimit) {
                            continue;
                        }
                        if (availableDesktopSlots <= this.desktopForegroundReserve) {
                            continue;
                        }
                    }
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
            const activeTask = {
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
    async dispatch(worker, item) {
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
                    worker.postMessage({
                        id: item.id,
                        buffer: previewBuffer,
                        maxDimension: this.maxDimension,
                        quality: this.quality,
                        isEmbeddedPreview: true,
                        minimumPreviewShortSide: this.minimumPreviewShortSide,
                    }, [previewBuffer]);
                    return;
                }
            }
            const buffer = await file.arrayBuffer();
            recordBytesRead(isLikelyRawFile(file.name) ? "raw" : "standard", buffer.byteLength);
            worker.postMessage({
                id: item.id,
                buffer,
                maxDimension: this.maxDimension,
                quality: this.quality,
                isEmbeddedPreview: false,
                minimumPreviewShortSide: this.minimumPreviewShortSide,
            }, [buffer]);
        }
        catch {
            this.releaseWorker(worker);
            this.markFailed(item.id);
        }
    }
    handleWorkerResult(worker, data) {
        const task = this.releaseWorker(worker);
        if ("retryWithFullBuffer" in data) {
            const retryItem = task
                ? { ...task.item, forceFullFile: true, priority: 0 }
                : null;
            if (retryItem) {
                this.queue.unshift(retryItem);
                this.sortQueue();
                this.schedule();
            }
            else {
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
    handleWorkerCrash(worker) {
        const task = this.releaseWorker(worker);
        if (task) {
            this.markFailed(task.id);
        }
    }
    releaseWorker(worker) {
        const task = this.busyWorkers.get(worker);
        this.busyWorkers.delete(worker);
        if (task) {
            this.processing.delete(task.id);
        }
        this.schedule();
        return task;
    }
    releaseDesktopTask(id) {
        const task = this.activeDesktopTasks.get(id);
        this.activeDesktopTasks.delete(id);
        if (task) {
            this.processing.delete(task.id);
        }
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
        this.processing.delete(id);
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