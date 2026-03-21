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
export interface ThumbnailUpdate {
    id: string;
    url: string;
    width: number;
    height: number;
}
type BatchCallback = (batch: ThumbnailUpdate[]) => void;
type ErrorCallback = (failedCount: number) => void;
export declare class ThumbnailPipeline {
    private workers;
    private busyWorkers;
    private workerItemId;
    private queue;
    private processing;
    private readingIds;
    private readyQueue;
    private completed;
    private failedIds;
    private pendingBatch;
    private batchTimer;
    private onBatch;
    private onError;
    private destroyed;
    constructor(onBatch: BatchCallback, onError?: ErrorCallback);
    enqueue(items: {
        id: string;
        file: File;
    }[], priority?: number): void;
    updateViewport(visibleIds: Set<string>): void;
    get pendingCount(): number;
    get completedCount(): number;
    get failedCount(): number;
    destroy(): void;
    private scheduleReads;
    private dispatchToWorkers;
    private releaseWorker;
    private handleResult;
    /** Called when a worker throws an uncaught exception (e.g. OOM on a large RAW). */
    private handleWorkerCrash;
    private sortQueue;
    private flushBatch;
}
export {};
