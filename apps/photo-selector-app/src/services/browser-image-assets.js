import { measureAsync } from "./performance-utils";
const SUPPORTED_EXTENSIONS = [".jpg", ".jpeg", ".png"];
const THUMBNAIL_MAX_DIMENSION = 420;
const PREVIEW_MAX_DIMENSION = 1600;
const THUMBNAIL_JPEG_QUALITY = 0.68;
const PREVIEW_JPEG_QUALITY = 0.8;
const LOAD_CONCURRENCY = 4;
function buildSourceFileKey(file) {
    const browserFile = file;
    const relativePath = browserFile.webkitRelativePath || file.name;
    return `${relativePath}::${file.size}::${file.lastModified}`;
}
function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}
function hasSupportedExtension(fileName) {
    const lowerFileName = fileName.toLowerCase();
    return SUPPORTED_EXTENSIONS.some((extension) => lowerFileName.endsWith(extension));
}
function detectOrientation(width, height) {
    if (width === height) {
        return "square";
    }
    return height > width ? "vertical" : "horizontal";
}
function sanitizeId(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
function loadImageFromUrl(url, fileName) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            resolve(image);
        };
        image.onerror = () => {
            reject(new Error(`Impossibile leggere l'immagine ${fileName}.`));
        };
        image.src = url;
    });
}
function canvasToBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error("Impossibile generare l'anteprima compressa."));
                return;
            }
            resolve(blob);
        }, "image/jpeg", quality);
    });
}
async function renderCompressedBlob(image, maxDimension, quality) {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    if (scale >= 1) {
        return { blob: null, width: targetWidth, height: targetHeight };
    }
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error("Canvas 2D non disponibile per comprimere le anteprime.");
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
    return {
        blob: await canvasToBlob(canvas, quality),
        width: targetWidth,
        height: targetHeight
    };
}
async function createCompressedPreview(file) {
    const sourceUrl = URL.createObjectURL(file);
    try {
        const image = await loadImageFromUrl(sourceUrl, file.name);
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        const thumbnailRender = await renderCompressedBlob(image, THUMBNAIL_MAX_DIMENSION, THUMBNAIL_JPEG_QUALITY);
        const previewRender = await renderCompressedBlob(image, PREVIEW_MAX_DIMENSION, PREVIEW_JPEG_QUALITY);
        const thumbnailUrl = thumbnailRender.blob ? URL.createObjectURL(thumbnailRender.blob) : sourceUrl;
        const previewUrl = previewRender.blob ? URL.createObjectURL(previewRender.blob) : sourceUrl;
        if (!thumbnailRender.blob && !previewRender.blob) {
            return {
                width,
                height,
                thumbnailUrl: sourceUrl,
                previewUrl: sourceUrl,
                sourceUrl
            };
        }
        return {
            width,
            height,
            thumbnailUrl,
            previewUrl,
            sourceUrl
        };
    }
    catch (error) {
        URL.revokeObjectURL(sourceUrl);
        throw error;
    }
}
async function mapWithConcurrency(items, limit, mapper, onItemProcessed) {
    const results = new Array(items.length);
    let cursor = 0;
    async function worker() {
        while (cursor < items.length) {
            const currentIndex = cursor;
            cursor += 1;
            results[currentIndex] = await mapper(items[currentIndex], currentIndex);
            onItemProcessed?.(currentIndex);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
    return results;
}
export async function loadImageAssetsFromFiles(files, options) {
    return measureAsync("load-image-assets", async () => {
        const supportedFiles = files.filter((file) => hasSupportedExtension(file.name));
        let processed = 0;
        options?.onProgress?.({
            supported: supportedFiles.length,
            ignored: files.length - supportedFiles.length,
            total: supportedFiles.length,
            processed,
            currentFile: supportedFiles[0]?.name ?? null
        });
        const assets = await mapWithConcurrency(supportedFiles, LOAD_CONCURRENCY, async (file) => {
            const browserFile = file;
            const relativePath = browserFile.webkitRelativePath || file.name;
            const sourceFileKey = buildSourceFileKey(file);
            const { width, height, thumbnailUrl, previewUrl, sourceUrl } = await createCompressedPreview(file);
            return {
                id: `asset-${hashString(sourceFileKey)}-${sanitizeId(relativePath)}`,
                fileName: file.name,
                path: relativePath,
                sourceFileKey,
                rating: 0,
                pickStatus: "unmarked",
                colorLabel: null,
                width,
                height,
                orientation: detectOrientation(width, height),
                aspectRatio: width / height,
                thumbnailUrl,
                previewUrl,
                sourceUrl
            };
        }, (index) => {
            processed += 1;
            options?.onProgress?.({
                supported: supportedFiles.length,
                ignored: files.length - supportedFiles.length,
                total: supportedFiles.length,
                processed,
                currentFile: supportedFiles[index + 1]?.name ?? supportedFiles[index]?.name ?? null
            });
        });
        return assets.sort((left, right) => left.fileName.localeCompare(right.fileName));
    });
}
export function revokeImageAssetUrls(assets) {
    const seen = new Set();
    assets.forEach((asset) => {
        [asset.thumbnailUrl, asset.previewUrl, asset.sourceUrl].forEach((url) => {
            if (!url || !url.startsWith("blob:") || seen.has(url)) {
                return;
            }
            seen.add(url);
            URL.revokeObjectURL(url);
        });
    });
}
export function inferFolderLabelFromFiles(files) {
    const firstFile = files[0];
    if (!firstFile) {
        return "";
    }
    if (firstFile.webkitRelativePath) {
        return firstFile.webkitRelativePath.split("/")[0];
    }
    return `${files.length} file selezionati`;
}
//# sourceMappingURL=browser-image-assets.js.map