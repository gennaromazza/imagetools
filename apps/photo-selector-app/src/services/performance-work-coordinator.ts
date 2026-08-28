import { IndexedPriorityQueue } from "./indexed-priority-queue";

interface ScheduledWork<T = unknown> {
  key: string;
  priority: number;
  task: () => Promise<T> | T;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

export class PerformanceWorkCoordinator {
  private readonly queue = new IndexedPriorityQueue<ScheduledWork>(4);
  private readonly activeKeys = new Set<string>();
  private activeBackground = 0;
  private readonly maxConcurrent: number;
  private readonly maxBackground: number;

  constructor(maxConcurrent: number, reservedInteractiveSlots = 2) {
    this.maxConcurrent = Math.max(1, Math.round(maxConcurrent));
    this.maxBackground = Math.max(1, this.maxConcurrent - Math.max(0, Math.round(reservedInteractiveSlots)));
  }

  run<T>(key: string, priority: number, task: () => Promise<T> | T): Promise<T> {
    if (this.activeKeys.has(key) || this.queue.get(key)) {
      return Promise.reject(new Error(`Performance work already scheduled: ${key}`));
    }
    return new Promise<T>((resolve, reject) => {
      this.queue.set(key, { key, priority, task, resolve, reject } as ScheduledWork, priority);
      this.schedule();
    });
  }

  reprioritize(key: string, priority: number): boolean {
    const work = this.queue.get(key);
    if (!work) return false;
    work.priority = priority;
    const changed = this.queue.updatePriority(key, priority);
    if (changed) this.schedule();
    return changed;
  }

  cancel(key: string): boolean {
    const work = this.queue.get(key);
    if (!work || !this.queue.delete(key)) return false;
    work.reject(new Error(`Performance work cancelled: ${key}`));
    return true;
  }

  getSnapshot() {
    return {
      active: this.activeKeys.size,
      activeBackground: this.activeBackground,
      queued: this.queue.size,
      maxConcurrent: this.maxConcurrent,
      maxBackground: this.maxBackground,
    };
  }

  private schedule(): void {
    while (this.activeKeys.size < this.maxConcurrent && this.queue.size > 0) {
      const next = this.queue.peek();
      if (!next) return;
      const isBackground = next.priority > 1;
      if (isBackground && this.activeBackground >= this.maxBackground) return;

      const work = this.queue.dequeue();
      if (!work) return;
      this.activeKeys.add(work.key);
      if (isBackground) this.activeBackground += 1;

      Promise.resolve()
        .then(work.task)
        .then(work.resolve, work.reject)
        .finally(() => {
          this.activeKeys.delete(work.key);
          if (isBackground) this.activeBackground = Math.max(0, this.activeBackground - 1);
          this.schedule();
        });
    }
  }
}

const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
export const performanceWorkCoordinator = new PerformanceWorkCoordinator(Math.max(4, Math.min(8, cores)), 2);
let workSequence = 0;

export function createPerformanceWorkKey(prefix: string): string {
  workSequence += 1;
  return `${prefix}:${workSequence}`;
}

export function schedulePerformanceWork<T>(key: string, priority: number, task: () => Promise<T> | T): Promise<T> {
  return performanceWorkCoordinator.run(key, priority, task);
}
