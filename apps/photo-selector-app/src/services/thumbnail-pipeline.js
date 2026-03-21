/**
 * Thumbnail generation pipeline -- two-stage design.
 *
 * Stage 1 -- File read: read file bytes into ArrayBuffer concurrently
 *            WITHOUT claiming a worker slot.  We pre-read up to
 *            (poolSize x READ_AHEAD) files so workers never wait for I/O.
 *
 * Stage 2 -- Worker dispatch: once a buffer is ready, hand it to a free
 *            worker immediately (zero-copy ArrayBuffer transfer).
 *
 * Crash safety: every worker has an onerror handler so a crash (e.g. OOM
 * while processing a 24 MP RAW preview) is recovered gracefully instead of
 * deadlocking the entire pipeline.
 *
 * Priority queue: viewport items (priority 0) are processed first.
 * Batched result delivery (~120 ms) to minimise React re-renders.
 */
const THUMBNAIL_MAX = 420;
const THUMBNAIL_QUALITY = 0.72;
const BATCH_INTERVAL_MS = 120;
const READ_AHEAD = 2; // read this many buffers per worker slot ahead
export class ThumbnailPipeline {
    workers = [];
    busyWorkers = new Set();
    workerItemId = new Map(); // worker -> current item id
    queue = [];
    processing = new Set(); // ids being read OR in a worker
    readingIds = new Set(); // ids currently being read from disk
    readyQueue = []; // buffers ready to send to a worker
    completed = new Set();
    failedIds = new Set();
    pendingBatch = [];
    batchTimer = null;
    onBatch;
    onError;
    destroyed = false;
    constructor(onBatch, onError) {
        this.onBatch = onBatch;
        this.onError = onError ?? null;
        const cores = navigator.hardwareConcurrency || 4;
        const poolSize = Math.max(2, Math.min(cores - 1, 8));
        for (let i = 0; i < poolSize; i++) {
            const worker = new Worker(new URL("../workers/thumbnail-worker.ts", import.meta.url), { type: "module" });
            worker.onmessage = (ev) => this.handleResult(worker, ev.data);
            worker.onerror = () => this.handleWorkerCrash(worker);
            this.workers.push(worker);
        }
    }
    enqueue(items, priority = 2) {
        for (const item of items) {
            if (this.completed.has(item.id) || this.processing.has(item.id))
                continue;
            const idx = this.queue.findIndex((q) => q.id === item.id);
            if (idx >= 0) {
                this.queue[idx].priority = Math.min(this.queue[idx].priority, priority);
            }
            else {
                this.queue.push({ id: item.id, file: item.file, priority });
            }
        }
        this.sortQueue();
        this.scheduleReads();
    }
    updateViewport(visibleIds) {
        let changed = false;
        for (const item of this.queue) {
            const newPri = visibleIds.has(item.id) ? 0 : 2;
            if (item.priority !== newPri) {
                item.priority = newPri;
                changed = true;
            }
        }
        if (changed) {
            this.sortQueue();
            this.scheduleReads();
        }
    }
    get pendingCount() { return this.queue.length + this.processing.size; }
    get completedCount() { return this.completed.size; }
    get failedCount() { return this.failedIds.size; }
    destroy() {
        this.destroyed = true;
        if (this.batchTimer)
            clearTimeout(this.batchTimer);
        this.flushBatch();
        for (const w of this.workers)
            w.terminate();
        this.workers = [];
        this.queue = [];
        this.readyQueue = [];
        this.processing.clear();
        this.readingIds.clear();
    }
    // -- Stage 1: read files into buffers -----------------------------------
    scheduleReads() {
        if (this.destroyed)
            return;
        const maxReading = this.workers.length * READ_AHEAD;
        while (this.queue.length > 0 && this.readingIds.size < maxReading) {
            const item = this.queue.shift();
            if (this.completed.has(item.id) || this.processing.has(item.id))
                continue;
            this.processing.add(item.id);
            this.readingIds.add(item.id);
            item.file
                .arrayBuffer()
                .then((buffer) => {
                if (this.destroyed) {
                    this.processing.delete(item.id);
                    return;
                }
                this.readingIds.delete(item.id);
                this.readyQueue.push({ id: item.id, buffer });
                this.dispatchToWorkers();
            })
                .catch(() => {
                this.readingIds.delete(item.id);
                this.processing.delete(item.id);
                this.failedIds.add(item.id);
                if (this.onError)
                    this.onError(this.failedIds.size);
                this.scheduleReads();
            });
        }
    }
    // -- Stage 2: dispatch ready buffers to free workers --------------------
    dispatchToWorkers() {
        if (this.destroyed)
            return;
        while (this.readyQueue.length > 0) {
            const worker = this.workers.find((w) => !this.busyWorkers.has(w));
            if (!worker)
                break;
            const item = this.readyQueue.shift();
            this.busyWorkers.add(worker);
            this.workerItemId.set(worker, item.id);
            worker.postMessage({ id: item.id, buffer: item.buffer, maxDimension: THUMBNAIL_MAX, quality: THUMBNAIL_QUALITY }, [item.buffer]);
            // A worker slot is now busy -- read one more file ahead
            this.scheduleReads();
        }
    }
    // -- Result / error handling --------------------------------------------
    releaseWorker(worker) {
        const id = this.workerItemId.get(worker);
        this.busyWorkers.delete(worker);
        this.workerItemId.delete(worker);
        if (id)
            this.processing.delete(id);
        return id;
    }
    handleResult(worker, data) {
        const id = this.releaseWorker(worker) ?? data.id;
        if ("error" in data) {
            this.failedIds.add(id);
            if (this.onError)
                this.onError(this.failedIds.size);
        }
        else {
            this.completed.add(id);
            const url = URL.createObjectURL(data.thumbnailBlob);
            this.pendingBatch.push({ id, url, width: data.width, height: data.height });
            if (!this.batchTimer) {
                this.batchTimer = setTimeout(() => this.flushBatch(), BATCH_INTERVAL_MS);
            }
        }
        this.dispatchToWorkers();
        this.scheduleReads();
    }
    /** Called when a worker throws an uncaught exception (e.g. OOM on a large RAW). */
    handleWorkerCrash(worker) {
        const id = this.releaseWorker(worker);
        if (id) {
            this.failedIds.add(id);
            if (this.onError)
                this.onError(this.failedIds.size);
        }
        this.dispatchToWorkers();
        this.scheduleReads();
    }
    // -- Internals -----------------------------------------------------------
    sortQueue() {
        this.queue.sort((a, b) => a.priority - b.priority);
    }
    flushBatch() {
        this.batchTimer = null;
        if (this.pendingBatch.length === 0)
            return;
        const batch = this.pendingBatch;
        this.pendingBatch = [];
        this.onBatch(batch);
    }
}
//# sourceMappingURL=thumbnail-pipeline.js.map