import { IndexedPriorityQueue } from "./indexed-priority-queue";
import {
  createPerformanceWorkKey,
  performanceWorkCoordinator,
  schedulePerformanceWork,
} from "./performance-work-coordinator";

interface PreviewWarmupTask {
  cacheKey: string;
  assetId: string;
  maxDimension: number;
  priority: number;
}

type WarmPreviewFn = (assetId: string, maxDimension: number, priority: number) => Promise<boolean>;

interface PreviewWarmupPipelineOptions {
  shouldDefer?: (priority: number) => boolean;
  deferDelayMs?: number;
}

export class PreviewWarmupPipeline {
  private readonly queue = new IndexedPriorityQueue<PreviewWarmupTask>(4);
  private active = new Map<string, { workKey: string; priority: number }>();
  private destroyed = false;
  private readonly concurrency: number;
  private readonly warmPreview: WarmPreviewFn;
  private readonly shouldDefer: ((priority: number) => boolean) | undefined;
  private readonly deferDelayMs: number;
  private deferTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(warmPreview: WarmPreviewFn, options?: PreviewWarmupPipelineOptions) {
    const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
    this.concurrency = Math.max(3, Math.min(8, cores));
    this.warmPreview = warmPreview;
    this.shouldDefer = options?.shouldDefer;
    this.deferDelayMs = options?.deferDelayMs ?? 260;
  }

  enqueue(
    items: Array<{ assetId: string; maxDimension: number }>,
    priority = 2,
  ): void {
    for (const item of items) {
      const cacheKey = `${item.assetId}::${Math.max(0, Math.round(item.maxDimension))}`;
      const active = this.active.get(cacheKey);
      if (active) {
        const nextPriority = Math.min(active.priority, priority);
        if (nextPriority !== active.priority) {
          active.priority = nextPriority;
          performanceWorkCoordinator.reprioritize(active.workKey, nextPriority);
        }
        continue;
      }

      const existing = this.queue.get(cacheKey);
      if (existing) {
        existing.priority = Math.min(existing.priority, priority);
        this.queue.set(cacheKey, existing, existing.priority);
        continue;
      }

      const queuedTask: PreviewWarmupTask = {
        cacheKey,
        assetId: item.assetId,
        maxDimension: item.maxDimension,
        priority,
      };
      this.queue.set(cacheKey, queuedTask, priority);
    }

    this.schedule();
  }

  destroy(): void {
    this.destroyed = true;
    this.queue.clear();
    for (const task of this.active.values()) {
      performanceWorkCoordinator.cancel(task.workKey);
    }
    this.active.clear();
    if (this.deferTimer) {
      clearTimeout(this.deferTimer);
      this.deferTimer = null;
    }
  }

  private schedule(): void {
    if (this.destroyed) {
      return;
    }

    while (this.active.size < this.concurrency && this.queue.size > 0) {
      const task = this.queue.peek();
      if (!task) {
        return;
      }

      if (this.shouldDefer?.(task.priority)) {
        if (!this.deferTimer) {
          this.deferTimer = setTimeout(() => {
            this.deferTimer = null;
            this.schedule();
          }, this.deferDelayMs);
        }
        return;
      }
      this.queue.dequeue();
      const workKey = createPerformanceWorkKey(`preview:${task.cacheKey}`);
      this.active.set(task.cacheKey, { workKey, priority: task.priority });

      void schedulePerformanceWork(
        workKey,
        task.priority,
        () => this.warmPreview(task.assetId, task.maxDimension, task.priority),
      )
        .catch(() => false)
        .finally(() => {
          this.active.delete(task.cacheKey);
          this.schedule();
        });
    }
  }
}
