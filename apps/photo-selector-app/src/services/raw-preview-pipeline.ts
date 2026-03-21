import type { RawPreviewError, RawPreviewResult } from "../workers/raw-preview-worker";

interface QueueItem {
  id: string;
  buffer: ArrayBuffer;
  priority: number;
  resolve: (buffer: ArrayBuffer | null) => void;
}

export class RawPreviewPipeline {
  private workers: Worker[] = [];
  private busyWorkers = new Set<Worker>();
  private queue: QueueItem[] = [];
  private currentJobByWorker = new Map<Worker, QueueItem>();

  constructor() {
    if (typeof Worker === "undefined") {
      return;
    }

    const cores = navigator.hardwareConcurrency || 4;
    const poolSize = Math.max(2, Math.min(cores - 1, 6));

    for (let index = 0; index < poolSize; index += 1) {
      const worker = new Worker(
        new URL("../workers/raw-preview-worker.ts", import.meta.url),
        { type: "module" },
      );

      worker.onmessage = (event: MessageEvent<RawPreviewResult | RawPreviewError>) => {
        this.handleWorkerMessage(worker, event.data);
      };
      worker.onerror = () => {
        this.handleWorkerCrash(worker);
      };

      this.workers.push(worker);
    }
  }

  extract(id: string, buffer: ArrayBuffer, priority = 0): Promise<ArrayBuffer | null> {
    return new Promise<ArrayBuffer | null>((resolve) => {
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

  bumpPriority(id: string, priority = 0): void {
    const queued = this.queue.find((item) => item.id === id);
    if (!queued) {
      return;
    }

    queued.priority = Math.min(queued.priority, priority);
    this.sortQueue();
  }

  private sortQueue(): void {
    this.queue.sort((left, right) => left.priority - right.priority);
  }

  private dispatch(): void {
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
      worker.postMessage(
        {
          id: job.id,
          buffer: job.buffer,
        },
        [job.buffer],
      );
    }
  }

  private releaseWorker(worker: Worker): QueueItem | null {
    this.busyWorkers.delete(worker);
    const job = this.currentJobByWorker.get(worker) ?? null;
    this.currentJobByWorker.delete(worker);
    return job;
  }

  private handleWorkerMessage(worker: Worker, data: RawPreviewResult | RawPreviewError): void {
    const job = this.releaseWorker(worker);
    if (!job) {
      return;
    }

    if ("error" in data) {
      job.resolve(null);
    } else {
      job.resolve(data.jpegBuffer);
    }

    this.dispatch();
  }

  private handleWorkerCrash(worker: Worker): void {
    const job = this.releaseWorker(worker);
    if (job) {
      job.resolve(null);
    }
    this.dispatch();
  }
}
