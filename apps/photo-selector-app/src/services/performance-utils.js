export async function measureAsync(label, run) {
    if (typeof performance === "undefined") {
        return run();
    }
    const startMark = `${label}:start`;
    const endMark = `${label}:end`;
    performance.mark(startMark);
    try {
        return await run();
    }
    finally {
        performance.mark(endMark);
        performance.measure(label, startMark, endMark);
    }
}
//# sourceMappingURL=performance-utils.js.map