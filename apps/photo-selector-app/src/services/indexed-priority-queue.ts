interface QueueToken {
  key: string;
  version: number;
}

interface QueueEntry<T> {
  value: T;
  priority: number;
  version: number;
}

export class IndexedPriorityQueue<T> {
  private buckets: QueueToken[][];
  private readonly bucketHeads: number[];
  private readonly entries = new Map<string, QueueEntry<T>>();
  private readonly maxPriority: number;

  constructor(maxPriority = 4) {
    this.maxPriority = Math.max(0, Math.round(maxPriority));
    this.buckets = Array.from({ length: this.maxPriority + 1 }, () => []);
    this.bucketHeads = Array.from({ length: this.maxPriority + 1 }, () => 0);
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): T | undefined {
    return this.entries.get(key)?.value;
  }

  set(key: string, value: T, priority: number): void {
    const normalizedPriority = this.normalizePriority(priority);
    const current = this.entries.get(key);
    if (current && current.priority === normalizedPriority) {
      current.value = value;
      return;
    }

    const version = (current?.version ?? 0) + 1;
    this.entries.set(key, { value, priority: normalizedPriority, version });
    this.buckets[normalizedPriority].push({ key, version });
  }

  updatePriority(key: string, priority: number): boolean {
    const current = this.entries.get(key);
    if (!current) return false;
    const normalizedPriority = this.normalizePriority(priority);
    if (current.priority === normalizedPriority) return false;
    this.set(key, current.value, normalizedPriority);
    return true;
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  peek(): T | undefined {
    return this.findNext()?.entry.value;
  }

  dequeue(): T | undefined {
    const next = this.findNext();
    if (!next) return undefined;
    this.bucketHeads[next.priority] += 1;
    this.entries.delete(next.token.key);
    this.compactBucket(next.priority);
    return next.entry.value;
  }

  clear(): void {
    this.entries.clear();
    for (let priority = 0; priority < this.buckets.length; priority += 1) {
      this.buckets[priority] = [];
      this.bucketHeads[priority] = 0;
    }
  }

  private normalizePriority(priority: number): number {
    if (!Number.isFinite(priority)) return this.maxPriority;
    return Math.max(0, Math.min(this.maxPriority, Math.round(priority)));
  }

  private findNext(): { token: QueueToken; entry: QueueEntry<T>; priority: number } | undefined {
    for (let priority = 0; priority < this.buckets.length; priority += 1) {
      const bucket = this.buckets[priority];
      let head = this.bucketHeads[priority];
      while (head < bucket.length) {
        const token = bucket[head];
        const entry = this.entries.get(token.key);
        if (entry && entry.version === token.version && entry.priority === priority) {
          this.bucketHeads[priority] = head;
          return { token, entry, priority };
        }
        head += 1;
      }
      this.bucketHeads[priority] = head;
      this.compactBucket(priority);
    }
    return undefined;
  }

  private compactBucket(priority: number): void {
    const bucket = this.buckets[priority];
    const head = this.bucketHeads[priority];
    if (head < 256 || head * 2 < bucket.length) return;
    this.buckets[priority] = bucket.slice(head);
    this.bucketHeads[priority] = 0;
  }
}
