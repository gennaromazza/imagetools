import type { DesktopDiskCacheBudgetPreset } from "@photo-tools/desktop-contracts";

const GIBIBYTE = 1024 * 1024 * 1024;

export const DEFAULT_DISK_CACHE_BUDGET_PRESET: DesktopDiskCacheBudgetPreset = "balanced";

const DISK_CACHE_BUDGET_BYTES: Record<Exclude<DesktopDiskCacheBudgetPreset, "unlimited">, number> = {
  compact: 2 * GIBIBYTE,
  balanced: 8 * GIBIBYTE,
  performance: 24 * GIBIBYTE,
};

export interface DiskCacheEntryStat {
  name: string;
  size: number;
  mtimeMs: number;
}

export function normalizeDiskCacheBudgetPreset(value: unknown): DesktopDiskCacheBudgetPreset {
  return value === "compact"
    || value === "balanced"
    || value === "performance"
    || value === "unlimited"
    ? value
    : DEFAULT_DISK_CACHE_BUDGET_PRESET;
}

export function getDiskCacheBudgetBytes(preset: DesktopDiskCacheBudgetPreset): number | null {
  return preset === "unlimited" ? null : DISK_CACHE_BUDGET_BYTES[preset];
}

export function selectDiskCacheEntriesToPrune(
  entries: DiskCacheEntryStat[],
  budgetBytes: number | null,
  targetRatio = 0.9,
): DiskCacheEntryStat[] {
  if (budgetBytes === null || budgetBytes < 0) {
    return [];
  }

  let retainedBytes = entries.reduce((total, entry) => total + Math.max(0, entry.size), 0);
  if (retainedBytes <= budgetBytes) {
    return [];
  }

  const targetBytes = Math.floor(budgetBytes * Math.max(0, Math.min(1, targetRatio)));
  const oldestFirst = [...entries].sort((left, right) => (
    left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name)
  ));
  const selected: DiskCacheEntryStat[] = [];

  for (const entry of oldestFirst) {
    if (retainedBytes <= targetBytes) {
      break;
    }
    selected.push(entry);
    retainedBytes -= Math.max(0, entry.size);
  }

  return selected;
}

export class AsyncReadWriteGate {
  private activeShared = 0;
  private exclusiveActive = false;
  private waitingExclusive = 0;
  private readonly waiters = new Set<() => void>();

  private async waitForChange(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.waiters.add(resolve);
    });
  }

  private notifyWaiters(): void {
    const pending = Array.from(this.waiters);
    this.waiters.clear();
    pending.forEach((resolve) => resolve());
  }

  async runShared<T>(task: () => Promise<T> | T): Promise<T> {
    while (this.exclusiveActive || this.waitingExclusive > 0) {
      await this.waitForChange();
    }

    this.activeShared += 1;
    try {
      return await task();
    } finally {
      this.activeShared = Math.max(0, this.activeShared - 1);
      this.notifyWaiters();
    }
  }

  async runExclusive<T>(task: () => Promise<T> | T): Promise<T> {
    this.waitingExclusive += 1;
    try {
      while (this.exclusiveActive || this.activeShared > 0) {
        await this.waitForChange();
      }
      this.exclusiveActive = true;
    } finally {
      this.waitingExclusive = Math.max(0, this.waitingExclusive - 1);
    }

    try {
      return await task();
    } finally {
      this.exclusiveActive = false;
      this.notifyWaiters();
    }
  }
}
