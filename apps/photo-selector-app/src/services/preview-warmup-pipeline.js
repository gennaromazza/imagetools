export class PreviewWarmupPipeline {
    queue = [];
    queued = new Map();
    active = new Set();
    destroyed = false;
    concurrency;
    warmPreview;
    constructor(warmPreview) {
        const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
        this.concurrency = Math.max(3, Math.min(8, cores));
        this.warmPreview = warmPreview;
    }
    enqueue(items, priority = 2) {
        for (const item of items) {
            const cacheKey = `${item.assetId}::${Math.max(0, Math.round(item.maxDimension))}`;
            if (this.active.has(cacheKey)) {
                continue;
            }
            const existing = this.queued.get(cacheKey);
            if (existing) {
                existing.priority = Math.min(existing.priority, priority);
                continue;
            }
            const queuedTask = {
                cacheKey,
                assetId: item.assetId,
                maxDimension: item.maxDimension,
                priority,
            };
            this.queue.push(queuedTask);
            this.queued.set(cacheKey, queuedTask);
        }
        this.sortQueue();
        this.schedule();
    }
    destroy() {
        this.destroyed = true;
        this.queue = [];
        this.queued.clear();
        this.active.clear();
    }
    sortQueue() {
        this.queue.sort((left, right) => left.priority - right.priority);
    }
    schedule() {
        if (this.destroyed) {
            return;
        }
        while (this.active.size < this.concurrency && this.queue.length > 0) {
            const task = this.queue.shift();
            if (!task) {
                return;
            }
            this.queued.delete(task.cacheKey);
            this.active.add(task.cacheKey);
            void this.warmPreview(task.assetId, task.maxDimension, task.priority)
                .catch(() => false)
                .finally(() => {
                this.active.delete(task.cacheKey);
                this.schedule();
            });
        }
    }
}
//# sourceMappingURL=preview-warmup-pipeline.js.map