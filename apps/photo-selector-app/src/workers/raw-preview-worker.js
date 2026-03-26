import { extractEmbeddedJpeg } from "./raw-jpeg-extractor";
const workerScope = self;
workerScope.onmessage = (event) => {
    const { id, buffer } = event.data;
    try {
        const jpegBuffer = extractEmbeddedJpeg(buffer);
        if (!jpegBuffer) {
            workerScope.postMessage({
                id,
                error: "No embedded preview found",
            });
            return;
        }
        workerScope.postMessage({
            id,
            jpegBuffer,
        }, [jpegBuffer]);
    }
    catch (error) {
        workerScope.postMessage({
            id,
            error: error instanceof Error ? error.message : String(error),
        });
    }
};
//# sourceMappingURL=raw-preview-worker.js.map