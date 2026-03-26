export class RawPreviewPipeline {
    workers = [];
    busyWorkers = new Set();
    queue = [];
    currentJobByWorker = new Map();
    constructor() {
        if (typeof Worker === "undefined") {
            return;
        }
        const cores = navigator.hardwareConcurrency || 4;
        const poolSize = Math.max(2, Math.min(cores - 1, 6));
        for (let index = 0; index < poolSize; index += 1) {
            const worker = new Worker(new URL("../workers/raw-preview-worker.ts", import.meta.url), { type: "module" });
            worker.onmessage = (event) => {
                this.handleWorkerMessage(worker, event.data);
            };
            worker.onerror = () => {
                this.handleWorkerCrash(worker);
            };
            this.workers.push(worker);
        }
    }
    extract(id, buffer, priority = 0) {
        return new Promise((resolve) => {
            const existing = this.queue.find((item) => item.id === id);
            if (existing) {
                existing.priority = Math.min(existing.priority, priority);
                this.sortQueue();
                return;
            }
            this.queue.push({
                id,
                buffer,
                priority,
                resolve,
            });
            this.sortQueue();
            this.dispatch();
        });
    }
    bumpPriority(id, priority = 0) {
        const queued = this.queue.find((item) => item.id === id);
        if (!queued) {
            return;
        }
        queued.priority = Math.min(queued.priority, priority);
        this.sortQueue();
    }
    sortQueue() {
        this.queue.sort((left, right) => left.priority - right.priority);
    }
    dispatch() {
        while (this.queue.length > 0) {
            const worker = this.workers.find((candidate) => !this.busyWorkers.has(candidate));
            if (!worker) {
                return;
            }
            const job = this.queue.shift();
            if (!job) {
                return;
            }
            this.busyWorkers.add(worker);
            this.currentJobByWorker.set(worker, job);
            worker.postMessage({
                id: job.id,
                buffer: job.buffer,
            }, [job.buffer]);
        }
    }
    releaseWorker(worker) {
        this.busyWorkers.delete(worker);
        const job = this.currentJobByWorker.get(worker) ?? null;
        this.currentJobByWorker.delete(worker);
        return job;
    }
    handleWorkerMessage(worker, data) {
        const job = this.releaseWorker(worker);
        if (!job) {
            return;
        }
        if ("error" in data) {
            job.resolve(null);
        }
        else {
            job.resolve(data.jpegBuffer);
        }
        this.dispatch();
    }
    handleWorkerCrash(worker) {
        const job = this.releaseWorker(worker);
        if (job) {
            job.resolve(null);
        }
        this.dispatch();
    }
}
//# sourceMappingURL=raw-preview-pipeline.js.map