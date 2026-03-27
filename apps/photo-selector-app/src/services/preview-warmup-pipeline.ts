interface PreviewWarmupTask {
  cacheKey: string;
  assetId: string;
  maxDimension: number;
  priority: number;
}

type WarmPreviewFn = (assetId: string, maxDimension: number, priority: number) => Promise<boolean>;

export class PreviewWarmupPipeline {
  private queue: PreviewWarmupTask[] = [];
  private queued = new Map<string, PreviewWarmupTask>();
  private active = new Set<string>();
  private destroyed = false;
  private readonly concurrency: number;
  private readonly warmPreview: WarmPreviewFn;

  constructor(warmPreview: WarmPreviewFn) {
    const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
    this.concurrency = Math.max(3, Math.min(8, cores));
    this.warmPreview = warmPreview;
  }

  enqueue(
    items: Array<{ assetId: string; maxDimension: number }>,
    priority = 2,
  ): void {
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

      const queuedTask: PreviewWarmupTask = {
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

  destroy(): void {
    this.destroyed = true;
    this.queue = [];
    this.queued.clear();
    this.active.clear();
  }

  private sortQueue(): void {
    this.queue.sort((left, right) => left.priority - right.priority);
  }

  private schedule(): void {
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
