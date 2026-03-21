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
export interface ThumbnailRequest {
    id: string;
    buffer: ArrayBuffer;
    maxDimension: number;
    quality: number;
}
export interface ThumbnailResult {
    id: string;
    thumbnailBlob: Blob;
    width: number;
    height: number;
}
export interface ThumbnailError {
    id: string;
    error: string;
}
