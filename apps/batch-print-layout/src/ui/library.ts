import { OrderGroup, OrderPhoto, PhotoSource, LogoSettings } from '../order/model';
import { contentSpec, cropFor } from '../order/geometry';
import { getPhotoContentRectCm } from '../print-engine';
import { renderPrintJpg } from '../order/render';
import { workingCopyName } from '../order/naming';
import { bytesToObjectUrl, hashString } from '../lib/assets';

export const browserUrls = new Map<string, string>();
export let browserLogoUrl: string | null = null;

export function setBrowserLogo(url: string) {
    if (browserLogoUrl) URL.revokeObjectURL(browserLogoUrl);
    browserLogoUrl = url;
    cachedLogoImage = null;
}

export function clearBrowserLogo() {
    if (browserLogoUrl) URL.revokeObjectURL(browserLogoUrl);
    browserLogoUrl = null;
    cachedLogoImage = null;
}

class ThumbStore {
    urls = new Map<string, string>();
    missing = new Set<string>();
    snapshot = { urls: new Map<string, string>(), missing: new Set<string>() };
    listeners = new Set<() => void>();

    subscribe = (l: () => void) => {
        this.listeners.add(l);
        return () => { this.listeners.delete(l); };
    }

    private emit() {
        this.snapshot = { urls: this.urls, missing: this.missing };
        this.listeners.forEach(l => l());
    }

    set(key: string, url: string) {
        if (this.urls.get(key) === url && !this.missing.has(key)) return;
        const previous = this.urls.get(key);
        if (previous && previous !== url) URL.revokeObjectURL(previous);
        this.urls = new Map(this.urls);
        this.missing = new Set(this.missing);
        this.urls.set(key, url);
        this.missing.delete(key);
        this.emit();
    }

    /** Libera le miniature delle foto non più presenti nell'ordine. */
    retain(keys: Set<string>) {
        const stale = [...this.urls].filter(([key]) => !keys.has(key));
        if (stale.length === 0) return;
        this.urls = new Map(this.urls);
        for (const [key, url] of stale) {
            URL.revokeObjectURL(url);
            this.urls.delete(key);
        }
        this.emit();
    }

    setMissing(key: string) {
        if (this.missing.has(key) && !this.urls.has(key)) return;
        this.urls = new Map(this.urls);
        this.missing = new Set(this.missing);
        this.missing.add(key);
        this.urls.delete(key);
        this.emit();
    }
}

export const thumbnailStore = new ThumbStore();

const THUMBNAIL_SIZE = 900;

async function runConcurrent<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
    let index = 0;
    const workers = Array(limit).fill(0).map(async () => {
        while (index < items.length) {
            const i = index++;
            await task(items[i]);
        }
    });
    await Promise.all(workers);
}

async function create900pxThumbnail(bitmap: ImageBitmap, mimeType: string): Promise<string> {
    const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Canvas non supportato");
    ctx.drawImage(bitmap, 0, 0, w, h);
    return new Promise<string>((resolve, reject) => {
        canvas.toBlob(b => {
            if (b) resolve(URL.createObjectURL(b));
            else reject(new Error("Errore toBlob"));
        }, mimeType === 'image/png' ? 'image/png' : 'image/jpeg', 0.8);
    });
}

export async function processDesktopFile(path: string, fileName: string): Promise<PhotoSource | null> {
    const api = window.filexDesktop;
    if (!api) return null;
    const [stat] = await api.statFiles([path]);
    if (!stat) return null;
    const { size, lastModified } = stat;
    const sourceKey = hashString(`${path}:${size}:${lastModified}`);

    // Le misure originali si leggono dall'intestazione: aprire ogni file in grande
    // rallentava gli ordini da centinaia di foto.
    const dimensions = await api.getImageDimensions(path);
    const preview = await api.getPreview(path, { maxDimension: THUMBNAIL_SIZE, sourceFileKey: `${size}:${lastModified}` });
    if (!dimensions || !preview) return null;
    thumbnailStore.set(sourceKey, bytesToObjectUrl(preview.bytes, preview.mimeType));

    return {
        sourceKey,
        fileName,
        absolutePath: path,
        size,
        lastModified,
        width: dimensions.width,
        height: dimensions.height
    };
}

export async function processBrowserFile(file: File): Promise<PhotoSource | null> {
    const sourceKey = hashString(file.name + file.size + file.lastModified);
    if (!browserUrls.has(sourceKey)) {
        browserUrls.set(sourceKey, URL.createObjectURL(file));
    }
    const bitmap = await createImageBitmap(file);
    const thumbUrl = await create900pxThumbnail(bitmap, file.type);
    thumbnailStore.set(sourceKey, thumbUrl);

    return {
        sourceKey,
        fileName: file.name,
        size: file.size,
        lastModified: file.lastModified,
        width: bitmap.width,
        height: bitmap.height
    };
}

export interface ImportResult {
    photos: PhotoSource[];
    unreadable: number;
}

async function importInOrder<T>(
    items: T[],
    load: (item: T) => Promise<PhotoSource | null>,
    onProgress: (done: number, total: number) => void
): Promise<ImportResult> {
    const results: Array<PhotoSource | null> = items.map(() => null);
    let done = 0;
    onProgress(0, items.length);
    await runConcurrent(items.map((_, index) => index), 4, async (index) => {
        try {
            results[index] = await load(items[index]);
        } catch {
            results[index] = null;
        }
        onProgress(++done, items.length);
    });
    const photos = results.filter((item): item is PhotoSource => item !== null);
    return { photos, unreadable: items.length - photos.length };
}

export function processFileArray(files: File[], onProgress: (done: number, total: number) => void): Promise<ImportResult> {
    return importInOrder(files, async (file) => {
        const path = window.filexDesktop?.getPathForFile(file);
        if (path) return processDesktopFile(path, file.name);
        return /^image\/(jpeg|png|webp)$/i.test(file.type) ? processBrowserFile(file) : null;
    }, onProgress);
}

export function processDesktopEntries(
    entries: Array<{ absolutePath: string; fileName: string }>,
    onProgress: (done: number, total: number) => void
): Promise<ImportResult> {
    return importInOrder(entries, (entry) => processDesktopFile(entry.absolutePath, entry.fileName), onProgress);
}

export async function processDesktopFolder(onProgress: (done: number, total: number) => void): Promise<ImportResult | null> {
    if (!window.filexDesktop) return null;
    const folder = await window.filexDesktop.openFolder({ includeExtendedImages: true });
    if (!folder) return null;
    const entries = folder.entries
        .filter(entry => /\.(jpe?g|png|webp|heic|heif|tiff?)$/i.test(entry.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
        .map(entry => ({ absolutePath: entry.absolutePath, fileName: entry.name }));
    return processDesktopEntries(entries, onProgress);
}

export async function checkMissingAndLoadThumbnails(photos: OrderPhoto[]) {
    const desktopPhotos = photos.filter(p => p.absolutePath);
    const browserPhotos = photos.filter(p => !p.absolutePath);

    if (window.filexDesktop) {
        for (let i = 0; i < desktopPhotos.length; i += 100) {
            const chunk = desktopPhotos.slice(i, i + 100);
            const paths = chunk.map(p => p.absolutePath!);
            const stats = await window.filexDesktop.statFiles(paths);
            const foundPaths = new Set(stats.map(s => s.absolutePath));
            const versions = new Map(stats.map(s => [s.absolutePath, `${s.size}:${s.lastModified}`]));

            const toLoad: OrderPhoto[] = [];
            for (const p of chunk) {
                if (!foundPaths.has(p.absolutePath!)) {
                    thumbnailStore.setMissing(p.sourceKey);
                } else if (!thumbnailStore.snapshot.urls.has(p.sourceKey)) {
                    toLoad.push(p);
                }
            }

            await runConcurrent(toLoad, 4, async (p) => {
                const preview = await window.filexDesktop!.getPreview(p.absolutePath!, {
                    maxDimension: THUMBNAIL_SIZE,
                    sourceFileKey: versions.get(p.absolutePath!)
                }).catch(() => null);
                if (preview) {
                    const url = bytesToObjectUrl(preview.bytes, preview.mimeType);
                    thumbnailStore.set(p.sourceKey, url);
                } else {
                    thumbnailStore.setMissing(p.sourceKey);
                }
            });
        }
    } else {
        for (const p of desktopPhotos) thumbnailStore.setMissing(p.sourceKey);
        for (const p of browserPhotos) {
            if (!browserUrls.has(p.sourceKey)) {
                thumbnailStore.setMissing(p.sourceKey);
            }
        }
    }
}

let cachedLogoPath: string | null = null;
let cachedLogoImage: HTMLImageElement | null = null;

/** Anteprima del logo com'è adesso su disco: la sola chiave del percorso restituirebbe quello vecchio. */
export async function loadLogoPreview(path: string, maxDimension: number) {
    const api = window.filexDesktop;
    if (!api) return null;
    const [stat] = await api.statFiles([path]);
    if (!stat) return null;
    return api.getPreview(path, { maxDimension, sourceFileKey: `${stat.size}:${stat.lastModified}` });
}

export async function getSharedLogoImage(logo: LogoSettings | undefined): Promise<HTMLImageElement | undefined> {
    if (!logo) return undefined;
    const [stat] = logo.path && window.filexDesktop ? await window.filexDesktop.statFiles([logo.path]) : [];
    const cacheId = logo.path ? `${logo.path}:${stat?.size}:${stat?.lastModified}` : 'browser';
    if (logo.path && cachedLogoPath === cacheId && cachedLogoImage) return cachedLogoImage;
    if (!logo.path && browserLogoUrl && cachedLogoPath === 'browser' && cachedLogoImage) return cachedLogoImage;

    let url: string | null = null;
    if (logo.path && window.filexDesktop) {
        const preview = await loadLogoPreview(logo.path, 3000);
        if (preview) url = bytesToObjectUrl(preview.bytes, preview.mimeType);
    } else if (browserLogoUrl) {
        url = browserLogoUrl;
    }

    if (!url) return undefined;

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            if (logo.path) URL.revokeObjectURL(url!);
            cachedLogoPath = cacheId;
            cachedLogoImage = img;
            resolve(img);
        };
        img.onerror = () => {
            if (logo.path) URL.revokeObjectURL(url!);
            reject(new Error("Impossibile caricare l'immagine del logo"));
        };
        img.src = url;
    });
}

function originalMimeType(fileName: string): string | null {
    if (/\.jpe?g$/i.test(fileName)) return "image/jpeg";
    if (/\.png$/i.test(fileName)) return "image/png";
    return /\.webp$/i.test(fileName) ? "image/webp" : null;
}

export async function renderPhotoForExport(
    group: OrderGroup,
    photo: OrderPhoto,
    logo: LogoSettings,
    logoImage: HTMLImageElement | null
): Promise<Uint8Array> {
    const rect = getPhotoContentRectCm(contentSpec(group, photo));
    const crop = cropFor(group, photo);
    const quarterTurn = Math.abs(crop.rotation) % 180 === 90;
    const widthPx = ((quarterTurn ? rect.height : rect.width) / 2.54) * 300;
    const heightPx = ((quarterTurn ? rect.width : rect.height) / 2.54) * 300;
    const needed = Math.ceil(Math.max(widthPx / crop.cropWidth, heightPx / crop.cropHeight));
    const maxDimension = Math.max(2400, Math.min(12000, needed));

    let url: string | null = null;
    if (photo.absolutePath && window.filexDesktop) {
        // La chiave della cache si calcola sul file com'è adesso, non com'era all'importazione.
        const [stat] = await window.filexDesktop.statFiles([photo.absolutePath]);
        if (!stat) throw new Error(`File non trovato: ${photo.fileName}`);
        const dimensions = await window.filexDesktop.getImageDimensions(photo.absolutePath);
        if (dimensions && Math.abs(dimensions.width / dimensions.height - photo.width / photo.height) > 0.01) {
            throw new Error(`${photo.fileName} è cambiata dopo l'importazione: rimuovila e aggiungila di nuovo.`);
        }
        const mimeType = originalMimeType(photo.fileName);
        if (mimeType) {
            // L'originale così com'è: il browser applica da sé orientamento EXIF e profilo colore.
            const file = await window.filexDesktop.readFile(photo.absolutePath);
            if (!file) throw new Error(`Immagine non trovata o illeggibile: ${photo.fileName}`);
            url = bytesToObjectUrl(file.bytes, mimeType);
        } else {
            // HEIC e TIFF il browser non li apre: passano dalla conversione del desktop.
            const preview = await window.filexDesktop.getPreview(photo.absolutePath, {
                maxDimension,
                sourceFileKey: `${stat.size}:${stat.lastModified}`
            });
            if (!preview) throw new Error(`Immagine non trovata o illeggibile: ${photo.fileName}`);
            url = bytesToObjectUrl(preview.bytes, preview.mimeType);
        }
    } else {
        url = browserUrls.get(photo.sourceKey) || null;
        if (!url) throw new Error(`File originale non trovato nel browser: ${photo.fileName}`);
    }

    try {
        return await renderPrintJpg({
            group,
            photo,
            url,
            width: photo.width,
            height: photo.height,
            logo,
            logoImage
        });
    } finally {
        if (photo.absolutePath && window.filexDesktop) {
            URL.revokeObjectURL(url);
        }
    }
}

/** La foto a piena risoluzione per la finestra di ritaglio; null se non si può leggere. */
export async function loadFullImage(photo: OrderPhoto): Promise<string | null> {
    const api = window.filexDesktop;
    if (!api || !photo.absolutePath) return null;
    const mimeType = originalMimeType(photo.fileName);
    if (mimeType) {
        const file = await api.readFile(photo.absolutePath);
        return file ? bytesToObjectUrl(file.bytes, mimeType) : null;
    }
    const preview = await api.getPreview(photo.absolutePath, {
        maxDimension: 6000,
        sourceFileKey: `${photo.size}:${photo.lastModified}`,
    });
    return preview ? bytesToObjectUrl(preview.bytes, preview.mimeType) : null;
}

/** Foto il cui file è cambiato su disco da quando è stata letta (per esempio salvata da Photoshop). */
export async function findChangedPhotos(photos: OrderPhoto[]): Promise<Array<{ sourceKey: string; source: PhotoSource }>> {
    const api = window.filexDesktop;
    if (!api) return [];
    const unique = new Map(photos.filter(p => p.absolutePath).map(p => [p.sourceKey, p]));
    const list = [...unique.values()];
    const changed: Array<{ sourceKey: string; source: PhotoSource }> = [];
    for (let i = 0; i < list.length; i += 100) {
        const chunk = list.slice(i, i + 100);
        const stats = new Map((await api.statFiles(chunk.map(p => p.absolutePath!))).map(s => [s.absolutePath, s]));
        for (const photo of chunk) {
            const stat = stats.get(photo.absolutePath!);
            if (!stat || (stat.size === photo.size && stat.lastModified === photo.lastModified)) continue;
            // Un salvataggio a metà non è leggibile: si riprova al prossimo controllo.
            const source = await processDesktopFile(photo.absolutePath!, photo.fileName).catch(() => null);
            if (source) changed.push({ sourceKey: photo.sourceKey, source });
        }
    }
    return changed;
}

const EDITOR_KEY = "print-flow:editor";

async function editorPath(): Promise<string | null> {
    const api = window.filexDesktop!;
    const saved = window.localStorage.getItem(EDITOR_KEY);
    if (saved && (await api.statFiles([saved])).length > 0) return saved;
    const candidates = await api.getInstalledEditorCandidates();
    const photoshops = candidates.filter(item => /photoshop/i.test(`${item.label} ${item.path}`));
    // Con più versioni installate si chiede quale: scegliere da soli ne avvierebbe una non voluta.
    return photoshops.length === 1 ? remember(photoshops[0].path) : chooseEditor(photoshops[0]?.path);
}

function remember(path: string): string {
    window.localStorage.setItem(EDITOR_KEY, path);
    return path;
}

/** Fa scegliere (o cambiare) il programma di ritocco e lo ricorda. */
export async function chooseEditor(startFrom?: string): Promise<string | null> {
    const current = startFrom ?? window.localStorage.getItem(EDITOR_KEY) ?? undefined;
    const chosen = await window.filexDesktop?.chooseEditorExecutable(current);
    return chosen ? remember(chosen) : null;
}

/** Apre in Photoshop una copia della foto accanto all'originale e restituisce la sorgente della copia. */
export async function openCopyInEditor(photo: OrderPhoto): Promise<PhotoSource> {
    const api = window.filexDesktop;
    if (!api || !photo.absolutePath) throw new Error("La modifica in Photoshop è disponibile solo nell'app desktop.");
    const editor = await editorPath();
    if (!editor) throw new Error("Nessun editor scelto.");

    const folder = photo.absolutePath.slice(0, photo.absolutePath.length - photo.fileName.length);
    let name = workingCopyName(photo.fileName);
    let copyPath = photo.absolutePath;
    if (name !== photo.fileName) {
        // Una copia già presente non si sovrascrive mai: potrebbe contenere un ritocco.
        for (let attempt = 2; (await api.statFiles([folder + name])).length > 0; attempt += 1) {
            if (attempt > 99) throw new Error("Troppe copie di ritocco per questa foto.");
            name = workingCopyName(photo.fileName, attempt);
        }
        const original = await api.readFile(photo.absolutePath);
        copyPath = folder + name;
        if (!original || !(await api.writeFile(copyPath, original.bytes))) {
            throw new Error("Impossibile creare la copia da ritoccare accanto alla foto (cartella o scheda in sola lettura?).");
        }
    }

    const source = await processDesktopFile(copyPath, name);
    if (!source) throw new Error("La copia da ritoccare non è leggibile.");
    const result = await api.openWithEditor(editor, [copyPath]);
    if (!result.ok) throw new Error(result.error || "Impossibile aprire Photoshop.");
    return source;
}
