const MAX_IMAGE_CACHE_SIZE = 64;
const imageCache = new Map();
function touch(url, promise) {
    imageCache.delete(url);
    imageCache.set(url, promise);
    while (imageCache.size > MAX_IMAGE_CACHE_SIZE) {
        const oldestKey = imageCache.keys().next().value;
        if (!oldestKey) {
            break;
        }
        imageCache.delete(oldestKey);
    }
}
export function loadDecodedImage(url) {
    const cached = imageCache.get(url);
    if (cached) {
        touch(url, cached);
        return cached;
    }
    const promise = new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.loading = "eager";
        image.onload = async () => {
            try {
                if (typeof image.decode === "function") {
                    await image.decode();
                }
            }
            catch {
                // Ignore decode failures and continue with the loaded image.
            }
            resolve(image);
        };
        image.onerror = () => {
            imageCache.delete(url);
            reject(new Error(`Impossibile caricare l'immagine ${url}.`));
        };
        image.src = url;
    });
    touch(url, promise);
    return promise;
}
export function preloadImageUrls(urls) {
    urls.forEach((url) => {
        if (!url) {
            return;
        }
        void loadDecodedImage(url);
    });
}
export function clearImageCache() {
    imageCache.clear();
}
//# sourceMappingURL=image-cache.js.map