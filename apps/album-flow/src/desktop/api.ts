import type { DesktopRenderedImage, FileXDesktopApi } from "@photo-tools/desktop-contracts";
import { parseXmpState, readXmpRating, upsertXmpRating } from "@photo-tools/photo-metadata";

/** Accesso all'app desktop FileX. Ogni funzione ha un comportamento sensato anche senza (browser, test, anteprima web). */
export function getDesktop(): FileXDesktopApi | null {
  return typeof window === "undefined" ? null : (window.filexDesktop ?? null);
}

export const hasDesktop = (): boolean => Boolean(getDesktop());

// ---------------------------------------------------------------------------
// Immagini: miniature a lotti con cache condivisa con il Selector
// ---------------------------------------------------------------------------

/** Dimensioni standard richieste al processo desktop, così le stesse miniature si riusano da una vista all'altra. */
export const IMAGE_BUCKETS = [200, 360, 720, 1400, 2400] as const;

export function bucketFor(pixels: number): number {
  return IMAGE_BUCKETS.find((bucket) => bucket >= pixels) ?? IMAGE_BUCKETS[IMAGE_BUCKETS.length - 1];
}

interface Job {
  key: string;
  path: string;
  size: number;
  waiters: Set<(url: string | null) => void>;
}

const THUMB_LIMIT = 2500;
const PREVIEW_LIMIT = 80;
const BATCH_SIZE = 16;
const MAX_PARALLEL_BATCHES = 3;

const urls = new Map<string, string>();
const jobs = new Map<string, Job>();
let queue: Job[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let running = 0;

const keyOf = (path: string, size: number) => `${path}@${size}`;

// ---------------------------------------------------------------------------
// Freschezza: se un file cambia sul disco (per esempio salvato da Photoshop) le immagini si rigenerano
// ---------------------------------------------------------------------------

/** Impronta (dimensione + data di modifica) di ogni file visto: entra nella chiave delle cache del processo desktop. */
const fileStamps = new Map<string, string>();
let imageVersion = 0;
const imageListeners = new Set<() => void>();

const stampOf = (stat: { size: number; lastModified: number }) => `${stat.size}:${stat.lastModified}`;
const sourceKeyFor = (path: string): string | undefined => { const stamp = fileStamps.get(path); return stamp ? `${path}|${stamp}` : undefined; };

/** Contatore che cambia quando qualche immagine va riletta: serve a far aggiornare le viste. */
export const subscribeImages = (listener: () => void): (() => void) => { imageListeners.add(listener); return () => { imageListeners.delete(listener); }; };
export const imagesVersion = (): number => imageVersion;

async function learnStamps(api: FileXDesktopApi, paths: string[]): Promise<void> {
  const unknown = Array.from(new Set(paths)).filter((path) => !fileStamps.has(path));
  if (unknown.length === 0 || !api.statFiles) return;
  try {
    for (const stat of await api.statFiles(unknown)) fileStamps.set(stat.absolutePath, stampOf(stat));
  } catch { /* senza impronta la cache usa solo il percorso */ }
}

function dropCachedImages(path: string) {
  for (const key of [...urls.keys()]) {
    if (!key.startsWith(`${path}@`)) continue;
    const stale = urls.get(key);
    urls.delete(key);
    if (stale) URL.revokeObjectURL(stale);
  }
}

/**
 * Controlla se qualcuno dei file noti è cambiato sul disco. Per quelli cambiati scarta le immagini in cache, avvisa le viste
 * e restituisce i percorsi, così il chiamante può aggiornare anche le misure.
 */
export async function refreshChangedFiles(paths: string[]): Promise<string[]> {
  const api = getDesktop();
  if (!api?.statFiles) return [];
  const known = Array.from(new Set(paths)).filter((path) => fileStamps.has(path));
  if (known.length === 0) return [];
  let stats: Awaited<ReturnType<NonNullable<FileXDesktopApi["statFiles"]>>>;
  try { stats = await api.statFiles(known); } catch { return []; }
  const changed: string[] = [];
  for (const stat of stats) {
    const next = stampOf(stat);
    if (fileStamps.get(stat.absolutePath) === next) continue;
    fileStamps.set(stat.absolutePath, next);
    dropCachedImages(stat.absolutePath);
    changed.push(stat.absolutePath);
  }
  if (changed.length) { imageVersion += 1; for (const listener of [...imageListeners]) listener(); }
  return changed;
}

function remember(key: string, size: number, url: string) {
  urls.set(key, url);
  const limit = size >= 1400 ? PREVIEW_LIMIT : THUMB_LIMIT;
  const same = [...urls.keys()].filter((candidate) => (Number(candidate.slice(candidate.lastIndexOf("@") + 1)) >= 1400) === (size >= 1400));
  while (same.length > limit) {
    const oldest = same.shift()!;
    const stale = urls.get(oldest);
    urls.delete(oldest);
    if (stale) URL.revokeObjectURL(stale);
  }
}

function toUrl(image: DesktopRenderedImage): string {
  return URL.createObjectURL(new Blob([new Uint8Array(image.bytes)], { type: image.mimeType }));
}

function finish(job: Job, url: string | null) {
  jobs.delete(job.key);
  if (url) remember(job.key, job.size, url);
  for (const waiter of job.waiters) waiter(url);
}

async function runBatch(api: FileXDesktopApi, batch: Job[]) {
  running += 1;
  try {
    await learnStamps(api, batch.map((job) => job.path));
    const small = batch.filter((job) => job.size < 1400);
    const large = batch.filter((job) => job.size >= 1400);
    if (small.length && api.getThumbnails) {
      try {
        const results = await api.getThumbnails(small.map((job) => ({ id: job.key, absolutePath: job.path, maxDimension: job.size, quality: 80, sourceFileKey: sourceKeyFor(job.path) })));
        const byId = new Map(results.map((result) => [result.id, result.image]));
        for (const job of small) { const image = byId.get(job.key); finish(job, image ? toUrl(image) : null); }
      } catch { small.forEach((job) => finish(job, null)); }
    } else small.forEach((job) => finish(job, null));
    for (const job of large) {
      try {
        const image = await api.getPreview(job.path, { maxDimension: job.size, sourceFileKey: sourceKeyFor(job.path) });
        finish(job, image ? toUrl(image) : null);
      } catch { finish(job, null); }
    }
  } finally {
    running -= 1;
    pump();
  }
}

function pump() {
  const api = getDesktop();
  if (!api) { queue.forEach((job) => finish(job, null)); queue = []; return; }
  while (running < MAX_PARALLEL_BATCHES && queue.length) {
    // Le richieste più recenti (quelle visibili ora) passano per prime.
    const batch = queue.splice(Math.max(0, queue.length - BATCH_SIZE), BATCH_SIZE);
    void runBatch(api, batch);
  }
}

function schedule() {
  if (timer !== undefined) return;
  timer = setTimeout(() => { timer = undefined; pump(); }, 12);
}

/** Immagine già in cache (senza richiederla). */
export function cachedImage(path: string, size: number): string | undefined {
  return urls.get(keyOf(path, bucketFor(size)));
}

/** Richiede l'immagine di un file; restituisce la funzione per annullare l'attesa (es. la miniatura esce dallo schermo). */
export function requestImage(path: string, pixels: number, onReady: (url: string | null) => void): () => void {
  const size = bucketFor(pixels);
  const key = keyOf(path, size);
  const hit = urls.get(key);
  if (hit) { onReady(hit); return () => undefined; }
  if (!getDesktop()) { onReady(null); return () => undefined; }
  let job = jobs.get(key);
  if (!job) { job = { key, path, size, waiters: new Set() }; jobs.set(key, job); queue.push(job); schedule(); }
  job.waiters.add(onReady);
  const current = job;
  return () => {
    current.waiters.delete(onReady);
    // Se nessuno la aspetta più e non è partita, la richiesta viene lasciata cadere.
    if (current.waiters.size === 0 && queue.includes(current)) { queue = queue.filter((candidate) => candidate !== current); jobs.delete(current.key); }
  };
}

/** Immagine come data URL (per esportare SVG/JPG autonomi). */
export async function imageAsDataUrl(path: string, maxDimension: number): Promise<string | null> {
  const api = getDesktop();
  if (!api) return null;
  await learnStamps(api, [path]);
  const image = await api.getPreview(path, { maxDimension, sourceFileKey: sourceKeyFor(path) }).catch(() => null);
  if (!image) return null;
  const bytes = new Uint8Array(image.bytes);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return `data:${image.mimeType};base64,${btoa(binary)}`;
}

// ---------------------------------------------------------------------------
// File: mostra nella cartella, modifica, stelle
// ---------------------------------------------------------------------------

export async function revealInFolder(path: string): Promise<boolean> {
  try { return (await getDesktop()?.revealInFolder?.(path)) ?? false; } catch { return false; }
}

const EDITOR_KEY = "filex.albumFlow.editorPath";

/** Apre la foto nell'editor esterno (Photoshop o altro). Chiede quale usare la prima volta. */
export async function openInEditor(path: string): Promise<{ ok: boolean; message: string }> {
  const api = getDesktop();
  if (!api) return { ok: false, message: "La modifica in un editor richiede l'app desktop FileX." };
  let editor = "";
  try { editor = localStorage.getItem(EDITOR_KEY) ?? ""; } catch { /* nessuna preferenza */ }
  if (!editor) {
    const candidates = await api.getInstalledEditorCandidates().catch(() => []);
    editor = candidates[0]?.path ?? (await api.chooseEditorExecutable().catch(() => null)) ?? "";
    if (!editor) return { ok: false, message: "Nessun editor scelto." };
    try { localStorage.setItem(EDITOR_KEY, editor); } catch { /* preferenza non critica */ }
  }
  const result = await api.openWithEditor(editor, [path]).catch((error: unknown) => ({ ok: false, error: String(error) }));
  const ok = Boolean((result as { ok?: boolean }).ok);
  return { ok, message: ok ? "Foto aperta nell'editor." : "Non sono riuscito ad aprire l'editor." };
}

export function forgetEditor(): void {
  try { localStorage.removeItem(EDITOR_KEY); } catch { /* preferenza non critica */ }
}

/** Scrive le stelle nel file XMP accanto alla foto (stesso formato del Selector). Restituisce false se non è possibile. */
export async function writeRatingToXmp(path: string, rating: number): Promise<boolean> {
  const api = getDesktop();
  if (!api?.readSidecarXmp || !api.writeSidecarXmp) return false;
  try {
    const existing = await api.readSidecarXmp(path);
    return await api.writeSidecarXmp(path, upsertXmpRating(existing, rating));
  } catch {
    return false;
  }
}

export interface SidecarInfo {
  rating: number | null;
  selected: boolean | null;
  labels: string[];
}

export async function readSidecar(path: string): Promise<SidecarInfo | null> {
  const api = getDesktop();
  if (!api?.readSidecarXmp) return null;
  try {
    const xml = await api.readSidecarXmp(path);
    if (!xml) return null;
    const state = parseXmpState(xml);
    return { rating: readXmpRating(xml), selected: state.selected ?? null, labels: state.customLabels ?? [] };
  } catch {
    return null;
  }
}
