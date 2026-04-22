export class RawPreviewPipeline {
    workers = [];
    busyWorkers = new Set();
    queue = [];
    currentJobByWorker = new Map();
    poolSize;
    constructor() {
        if (typeof Worker === "undefined") {
            this.poolSize = 0;
            return;
        }
        const cores = navigator.hardwareConcurrency || 4;
        this.poolSize = Math.max(2, Math.min(cores - 1, 6));
        for (let index = 0; index < this.poolSize; index += 1) {
            this.spawnWorker();
        }
    }
    spawnWorker() {
        const worker = new Worker(new URL("../workers/raw-preview-worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (event) => {
            this.handleWorkerMessage(worker, event.data);
        };
        worker.onerror = () => {
            this.handleWorkerCrash(worker);
        };
        this.workers.push(worker);
        return worker;
    }
    extract(id, buffer, priority = 0) {
        return new Promise((resolve) => {
            const queued = this.queue.find((item) => item.id === id);
            if (queued) {
                queued.priority = Math.min(queued.priority, priority);
                queued.resolvers.push(resolve);
                this.sortQueue();
                return;
            }
            const inFlight = this.findInFlightJob(id);
            if (inFlight) {
                inFlight.resolvers.push(resolve);
                return;
            }
            this.queue.push({
                id,
                buffer,
                priority,
                resolvers: [resolve],
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
    findInFlightJob(id) {
        for (const job of this.currentJobByWorker.values()) {
            if (job.id === id) {
                return job;
            }
        }
        return null;
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
    resolveJob(job, value) {
        for (const resolver of job.resolvers) {
            try {
                resolver(value);
            }
            catch {
                // Ignore resolver errors to avoid leaving siblings unresolved.
            }
        }
    }
    handleWorkerMessage(worker, data) {
        const job = this.releaseWorker(worker);
        if (!job) {
            return;
        }
        if ("error" in data) {
            this.resolveJob(job, null);
        }
        else {
            this.resolveJob(job, data.jpegBuffer);
        }
        this.dispatch();
    }
    handleWorkerCrash(worker) {
        const job = this.releaseWorker(worker);
        if (job) {
            this.resolveJob(job, null);
        }
        // Remove the crashed worker and try to spawn a replacement so the pool stays healthy.
        const index = this.workers.indexOf(worker);
        if (index >= 0) {
            this.workers.splice(index, 1);
        }
        try {
            worker.terminate();
        }
        catch {
            // Already dead.
        }
        if (typeof Worker !== "undefined" && this.workers.length < this.poolSize) {
            try {
                this.spawnWorker();
            }
            catch {
                // If spawning fails (e.g. resource exhaustion), continue with a smaller pool.
            }
        }
        this.dispatch();
    }
}
//# sourceMappingURL=raw-preview-pipeline.js.map