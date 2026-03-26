/**
 * Thumbnail generation Web Worker.
 *
 * Runs entirely off the main thread using OffscreenCanvas + createImageBitmap.
 * Receives an image ArrayBuffer (JPEG/PNG/WebP or any RAW format), outputs a
 * resized JPEG Blob.
 *
 * For RAW files (CR2, CR3, NEF, ARW, RAF, DNG, RW2, ORF):
 *   Falls back to extractEmbeddedJpeg() which locates the JPEG preview block
 *   that every commercial RAW format stores inside the file.
 *
 * Key design rule: the resolved sourceBlob is passed directly to
 * createImageBitmap(..., { resizeWidth, resizeHeight }) so the browser can
 * do hardware-accelerated decode + resize in ONE call.  We never create a
 * full-resolution OffscreenCanvas -- that caused OOM crashes for 24 MP files.
 */
import { extractEmbeddedJpeg } from "./raw-jpeg-extractor";
/**
 * Resolve the original buffer into a browser-decodable Blob plus dimensions.
 * - JPEG / PNG / WebP: returns the original blob.
 * - RAW: extracts the embedded JPEG preview and returns that blob.
 */
async function resolveSource(buffer) {
    const directBlob = new Blob([buffer]);
    try {
        const bm = await createImageBitmap(directBlob);
        const width = bm.width;
        const height = bm.height;
        bm.close();
        return { blob: directBlob, width, height };
    }
    catch {
        // not browser-decodable -- try RAW extraction
    }
    const jpegBuffer = extractEmbeddedJpeg(buffer);
    if (!jpegBuffer)
        throw new Error("No decodable content or embedded JPEG found");
    const jpegBlob = new Blob([jpegBuffer], { type: "image/jpeg" });
    const bm = await createImageBitmap(jpegBlob);
    const width = bm.width;
    const height = bm.height;
    bm.close();
    return { blob: jpegBlob, width, height };
}
self.onmessage = async (event) => {
    const { id, buffer, maxDimension, quality, isEmbeddedPreview, minimumPreviewShortSide } = event.data;
    try {
        const { blob: sourceBlob, width: origWidth, height: origHeight } = await resolveSource(buffer);
        const shortSide = Math.min(origWidth, origHeight);
        if (isEmbeddedPreview && shortSide < (minimumPreviewShortSide ?? 0)) {
            self.postMessage({
                id,
                retryWithFullBuffer: true,
                shortSide,
            });
            return;
        }
        const scale = Math.min(1, maxDimension / Math.max(origWidth, origHeight));
        const targetWidth = Math.max(1, Math.round(origWidth * scale));
        const targetHeight = Math.max(1, Math.round(origHeight * scale));
        // Hardware-accelerated decode + resize in one call -- no intermediate canvas.
        const renderBitmap = await createImageBitmap(sourceBlob, {
            resizeWidth: targetWidth,
            resizeHeight: targetHeight,
            resizeQuality: "medium",
        });
        const canvas = new OffscreenCanvas(targetWidth, targetHeight);
        const ctx = canvas.getContext("2d");
        if (!ctx)
            throw new Error("2d context unavailable in worker");
        ctx.drawImage(renderBitmap, 0, 0);
        renderBitmap.close();
        const thumbnailBlob = await canvas.convertToBlob({ type: "image/jpeg", quality });
        self.postMessage({
            id,
            thumbnailBlob,
            width: origWidth,
            height: origHeight,
        });
    }
    catch (err) {
        self.postMessage({
            id,
            error: err instanceof Error ? err.message : String(err),
        });
    }
};
//# sourceMappingURL=thumbnail-worker.js.map