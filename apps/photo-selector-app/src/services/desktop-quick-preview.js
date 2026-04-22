const QUICK_PREVIEW_FRAME_CACHE_MAX_ENTRIES = 64;
const quickPreviewFrameCache = new Map();
const quickPreviewFramePromiseCache = new Map();
function buildRequestKey(request) {
    return [
        request.absolutePath,
        request.stage,
        Math.max(0, Math.round(request.maxDimension)),
        request.sourceFileKey ?? "",
    ].join("::");
}
function touchQuickPreviewFrameCacheEntry(cacheKey, frame) {
    quickPreviewFrameCache.delete(cacheKey);
    quickPreviewFrameCache.set(cacheKey, frame);
    return frame;
}
function trimQuickPreviewFrameCache() {
    while (quickPreviewFrameCache.size > QUICK_PREVIEW_FRAME_CACHE_MAX_ENTRIES) {
        const oldest = quickPreviewFrameCache.entries().next().value;
        if (!oldest) {
            break;
        }
        quickPreviewFrameCache.delete(oldest[0]);
        void releaseDesktopQuickPreviewFrames([oldest[1].token]);
    }
}
function getDesktopApi() {
    if (typeof window === "undefined") {
        return null;
    }
    return window.filexDesktop ?? null;
}
export function hasDesktopQuickPreviewApi() {
    const api = getDesktopApi();
    return Boolean(typeof api?.getQuickPreviewFrame === "function"
        && typeof api?.warmQuickPreviewFrames === "function"
        && typeof api?.releaseQuickPreviewFrames === "function");
}
export async function getDesktopQuickPreviewFrame(request) {
    const api = getDesktopApi();
    if (!api?.getQuickPreviewFrame) {
        return null;
    }
    const cacheKey = buildRequestKey(request);
    const cached = quickPreviewFrameCache.get(cacheKey);
    if (cached) {
        return touchQuickPreviewFrameCacheEntry(cacheKey, cached);
    }
    const pending = quickPreviewFramePromiseCache.get(cacheKey);
    if (pending) {
        return pending;
    }
    const task = (async () => {
        try {
            const frame = await api.getQuickPreviewFrame(request);
            if (frame) {
                const previous = quickPreviewFrameCache.get(cacheKey);
                if (previous && previous.token !== frame.token) {
                    // Rilascia il token nativo del frame che stiamo per sovrascrivere
                    // per evitare leak di handle nel processo desktop.
                    void releaseDesktopQuickPreviewFrames([previous.token]);
                }
                quickPreviewFrameCache.delete(cacheKey);
                quickPreviewFrameCache.set(cacheKey, frame);
                trimQuickPreviewFrameCache();
            }
            return frame;
        }
        catch {
            return null;
        }
        finally {
            quickPreviewFramePromiseCache.delete(cacheKey);
        }
    })();
    quickPreviewFramePromiseCache.set(cacheKey, task);
    return task;
}
export function getCachedDesktopQuickPreviewFrame(request) {
    const cached = quickPreviewFrameCache.get(buildRequestKey(request));
    return cached ? touchQuickPreviewFrameCacheEntry(buildRequestKey(request), cached) : null;
}
export function peekDesktopQuickPreviewFrame(request) {
    return quickPreviewFrameCache.get(buildRequestKey(request)) ?? null;
}
export function clearDesktopQuickPreviewFrameCache() {
    const tokens = Array.from(quickPreviewFrameCache.values()).map((frame) => frame.token);
    quickPreviewFrameCache.clear();
    quickPreviewFramePromiseCache.clear();
    void releaseDesktopQuickPreviewFrames(tokens);
}
export async function invalidateDesktopQuickPreviewFrame(request) {
    const cacheKey = buildRequestKey(request);
    const existing = quickPreviewFrameCache.get(cacheKey);
    quickPreviewFrameCache.delete(cacheKey);
    quickPreviewFramePromiseCache.delete(cacheKey);
    if (existing) {
        await releaseDesktopQuickPreviewFrames([existing.token]);
    }
}
export async function warmDesktopQuickPreviewFrames(requests) {
    const api = getDesktopApi();
    if (!api?.warmQuickPreviewFrames) {
        return null;
    }
    try {
        return await api.warmQuickPreviewFrames(requests);
    }
    catch {
        return null;
    }
}
export async function releaseDesktopQuickPreviewFrames(tokens) {
    const api = getDesktopApi();
    if (!api?.releaseQuickPreviewFrames || tokens.length === 0) {
        return;
    }
    try {
        await api.releaseQuickPreviewFrames(tokens);
    }
    catch {
        // Ignore release failures: tokens are best-effort.
    }
}
//# sourceMappingURL=desktop-quick-preview.js.map