const PERF_ENABLED = typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);

type ByteReadKind = "raw" | "standard";

type ByteReadStats = {
  totalBytes: number;
  totalImages: number;
  rawBytes: number;
  rawImages: number;
  standardBytes: number;
  standardImages: number;
};

type ReactBatchMetric = {
  token: number;
  updatedCount: number;
  totalCount: number;
  renderedIds: Set<string>;
};

const activeTimers = new Set<string>();

let byteReadStats: ByteReadStats = {
  totalBytes: 0,
  totalImages: 0,
  rawBytes: 0,
  rawImages: 0,
  standardBytes: 0,
  standardImages: 0,
};

let nextReactBatchToken = 1;
let activeReactBatch: ReactBatchMetric | null = null;

function toKb(bytes: number): number {
  return bytes / 1024;
}

function getAverageKb(bytes: number, images: number): number {
  if (images <= 0) {
    return 0;
  }

  return toKb(bytes / images);
}

export function isPerfEnabled(): boolean {
  return PERF_ENABLED;
}

export function perfTime(label: string): void {
  if (!PERF_ENABLED || activeTimers.has(label)) {
    return;
  }

  activeTimers.add(label);
  console.time(label);
}

export function perfTimeEnd(label: string): void {
  if (!PERF_ENABLED || !activeTimers.has(label)) {
    return;
  }

  activeTimers.delete(label);
  console.timeEnd(label);
}

export function perfLog(message: string, ...args: unknown[]): void {
  if (!PERF_ENABLED) {
    return;
  }

  console.log(message, ...args);
}

export async function measureAsync<T>(label: string, run: () => Promise<T>): Promise<T> {
  if (!PERF_ENABLED) {
    return run();
  }

  perfTime(label);
  try {
    return await run();
  } finally {
    perfTimeEnd(label);
  }
}

export function resetPerfByteReadStats(): void {
  if (!PERF_ENABLED) {
    return;
  }

  byteReadStats = {
    totalBytes: 0,
    totalImages: 0,
    rawBytes: 0,
    rawImages: 0,
    standardBytes: 0,
    standardImages: 0,
  };
}

export function recordBytesRead(kind: ByteReadKind, bytes: number): void {
  if (!PERF_ENABLED || bytes <= 0) {
    return;
  }

  byteReadStats.totalBytes += bytes;
  byteReadStats.totalImages += 1;

  if (kind === "raw") {
    byteReadStats.rawBytes += bytes;
    byteReadStats.rawImages += 1;
  } else {
    byteReadStats.standardBytes += bytes;
    byteReadStats.standardImages += 1;
  }

  const overallAverageKb = getAverageKb(byteReadStats.totalBytes, byteReadStats.totalImages);
  const rawAverageKb = getAverageKb(byteReadStats.rawBytes, byteReadStats.rawImages);
  const standardAverageKb = getAverageKb(byteReadStats.standardBytes, byteReadStats.standardImages);
  const rawFlag = byteReadStats.rawImages > 0 && rawAverageKb > 512 ? " [FLAG raw > 512KB]" : "";
  const standardFlag = byteReadStats.standardImages > 0 && standardAverageKb > 200
    ? " [FLAG standard > 200KB]"
    : "";

  console.log(
    `[PERF] avg bytes-read per image                 : ${overallAverageKb.toFixed(1)}KB` +
      ` (raw ${rawAverageKb.toFixed(1)}KB${rawFlag}, standard ${standardAverageKb.toFixed(1)}KB${standardFlag})`,
  );
}

export function beginReactBatchMetric(updatedCount: number, totalCount: number): number | null {
  if (!PERF_ENABLED) {
    return null;
  }

  if (activeReactBatch) {
    finishReactBatchMetric(activeReactBatch.token);
  }

  const token = nextReactBatchToken++;
  activeReactBatch = {
    token,
    updatedCount,
    totalCount,
    renderedIds: new Set<string>(),
  };
  return token;
}

export function notePhotoCardRender(assetId: string): void {
  if (!PERF_ENABLED || !activeReactBatch) {
    return;
  }

  activeReactBatch.renderedIds.add(assetId);
}

export function finishReactBatchMetric(token: number | null): void {
  if (!PERF_ENABLED || token === null || !activeReactBatch || activeReactBatch.token !== token) {
    return;
  }

  console.log(
    `[PERF] react-renders per batch                 : ${activeReactBatch.renderedIds.size}` +
      ` cards re-rendered / ${activeReactBatch.totalCount} total` +
      ` (updated ${activeReactBatch.updatedCount})`,
  );
  activeReactBatch = null;
}

export function cancelReactBatchMetric(): void {
  if (!PERF_ENABLED) {
    return;
  }

  activeReactBatch = null;
}
