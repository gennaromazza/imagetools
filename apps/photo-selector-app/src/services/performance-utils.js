const PERF_ENABLED = typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);
const activeTimers = new Set();
let byteReadStats = {
    totalBytes: 0,
    totalImages: 0,
    rawBytes: 0,
    rawImages: 0,
    standardBytes: 0,
    standardImages: 0,
};
let nextReactBatchToken = 1;
let activeReactBatch = null;
function toKb(bytes) {
    return bytes / 1024;
}
function getAverageKb(bytes, images) {
    if (images <= 0) {
        return 0;
    }
    return toKb(bytes / images);
}
export function isPerfEnabled() {
    return PERF_ENABLED;
}
export function perfTime(label) {
    if (!PERF_ENABLED || activeTimers.has(label)) {
        return;
    }
    activeTimers.add(label);
    console.time(label);
}
export function perfTimeEnd(label) {
    if (!PERF_ENABLED || !activeTimers.has(label)) {
        return;
    }
    activeTimers.delete(label);
    console.timeEnd(label);
}
export function perfLog(message, ...args) {
    if (!PERF_ENABLED) {
        return;
    }
    console.log(message, ...args);
}
export async function measureAsync(label, run) {
    if (!PERF_ENABLED) {
        return run();
    }
    perfTime(label);
    try {
        return await run();
    }
    finally {
        perfTimeEnd(label);
    }
}
export function resetPerfByteReadStats() {
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
export function recordBytesRead(kind, bytes) {
    if (!PERF_ENABLED || bytes <= 0) {
        return;
    }
    byteReadStats.totalBytes += bytes;
    byteReadStats.totalImages += 1;
    if (kind === "raw") {
        byteReadStats.rawBytes += bytes;
        byteReadStats.rawImages += 1;
    }
    else {
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
    console.log(`[PERF] avg bytes-read per image                 : ${overallAverageKb.toFixed(1)}KB` +
        ` (raw ${rawAverageKb.toFixed(1)}KB${rawFlag}, standard ${standardAverageKb.toFixed(1)}KB${standardFlag})`);
}
export function beginReactBatchMetric(updatedCount, totalCount) {
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
        renderedIds: new Set(),
    };
    return token;
}
export function notePhotoCardRender(assetId) {
    if (!PERF_ENABLED || !activeReactBatch) {
        return;
    }
    activeReactBatch.renderedIds.add(assetId);
}
export function finishReactBatchMetric(token) {
    if (!PERF_ENABLED || token === null || !activeReactBatch || activeReactBatch.token !== token) {
        return;
    }
    console.log(`[PERF] react-renders per batch                 : ${activeReactBatch.renderedIds.size}` +
        ` cards re-rendered / ${activeReactBatch.totalCount} total` +
        ` (updated ${activeReactBatch.updatedCount})`);
    activeReactBatch = null;
}
export function cancelReactBatchMetric() {
    if (!PERF_ENABLED) {
        return;
    }
    activeReactBatch = null;
}
//# sourceMappingURL=performance-utils.js.map