import { BUILTIN_BACKGROUNDS, builtinDataUrl, isBuiltinMedia } from "./builtinMedia";
import { newId } from "./ids";

/**
 * Libreria personale di sfondi e grafiche: sta nel database del browser (IndexedDB), non nei progetti, perché le immagini
 * sono grandi e i progetti vivono nel salvataggio locale. I progetti ne citano solo l'identificativo; quando si esporta
 * il file di un album le immagini usate vengono incluse, così si riapre ovunque.
 */

export type MediaKind = "background" | "graphic";

export interface MediaRecord {
  id: string;
  name: string;
  kind: MediaKind;
  mime: string;
  dataUrl: string;
  width: number;
  height: number;
  createdAt: string;
}

export const MAX_MEDIA_FILE_BYTES = 30 * 1024 * 1024;
const DB_NAME = "filex-album-flow-library";
const STORE = "media";

const memory = new Map<string, MediaRecord>();
const listeners = new Set<() => void>();
let version = 0;
let dbPromise: Promise<IDBDatabase | null> | null = null;

function database(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: "id" }); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export const mediaVersion = () => version;
export function subscribeMedia(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const changed = () => { version += 1; listeners.forEach((listener) => listener()); };

export async function listMedia(kind?: MediaKind): Promise<MediaRecord[]> {
  const db = await database();
  const stored = db ? ((await run(db, "readonly", (store) => store.getAll())) as MediaRecord[] | null) ?? [] : [];
  const byId = new Map<string, MediaRecord>(stored.map((record) => [record.id, record]));
  for (const record of memory.values()) byId.set(record.id, record);
  return [...byId.values()].filter((record) => !kind || record.kind === kind).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getMedia(id: string): Promise<MediaRecord | null> {
  const builtin = BUILTIN_BACKGROUNDS.find((entry) => entry.id === id);
  if (builtin) return { id, name: builtin.name, kind: "background", mime: "image/svg+xml", dataUrl: builtinDataUrl(builtin), width: 1500, height: 1000, createdAt: "" };
  const cached = memory.get(id);
  if (cached) return cached;
  const db = await database();
  return db ? ((await run(db, "readonly", (store) => store.get(id))) as MediaRecord | undefined) ?? null : null;
}

export async function saveMedia(record: MediaRecord): Promise<void> {
  if (isBuiltinMedia(record.id)) return;
  const db = await database();
  const ok = db ? (await run(db, "readwrite", (store) => store.put(record))) !== null : false;
  if (!ok) memory.set(record.id, record);
  changed();
}

export async function removeMedia(id: string): Promise<void> {
  memory.delete(id);
  const db = await database();
  if (db) await run(db, "readwrite", (store) => store.delete(id));
  changed();
}

// ---------------------------------------------------------------------------
// Caricamento di un file dell'utente
// ---------------------------------------------------------------------------

const MAX_SIDE: Record<MediaKind, number> = { background: 3200, graphic: 1800 };

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Immagine non leggibile."));
    image.src = url;
  });
}

const readAsDataUrl = (file: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error("File non leggibile."));
  reader.readAsDataURL(file);
});

/** Legge un'immagine caricata dall'utente: la riduce a una misura ragionevole (le SVG restano vettoriali) e la mette in libreria. */
export async function importMediaFile(file: File, kind: MediaKind): Promise<MediaRecord> {
  if (file.size > MAX_MEDIA_FILE_BYTES) throw new Error(`«${file.name}» supera i 30 MB.`);
  const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  if (!isSvg && !file.type.startsWith("image/")) throw new Error(`«${file.name}» non è un'immagine.`);
  const original = await readAsDataUrl(file);
  const image = await loadImage(original);
  let width = image.naturalWidth || 1000;
  let height = image.naturalHeight || 1000;
  let dataUrl = original;
  let mime = isSvg ? "image/svg+xml" : file.type;
  if (!isSvg) {
    const scale = Math.min(1, MAX_SIDE[kind] / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas non disponibile.");
    // Le grafiche tengono la trasparenza (PNG); gli sfondi sono fotografici e restano leggeri (JPEG).
    mime = kind === "graphic" ? "image/png" : "image/jpeg";
    if (mime === "image/jpeg") { context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    dataUrl = canvas.toDataURL(mime, 0.9);
    width = canvas.width;
    height = canvas.height;
  }
  const record: MediaRecord = { id: newId("media"), name: file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Immagine", kind, mime, dataUrl, width, height, createdAt: new Date().toISOString() };
  await saveMedia(record);
  return record;
}

/** Immagini incluse nel file di un album, da rimettere in libreria all'apertura. */
export type EmbeddedMedia = Record<string, Pick<MediaRecord, "name" | "kind" | "mime" | "dataUrl" | "width" | "height">>;

export async function collectEmbeddedMedia(ids: readonly string[]): Promise<EmbeddedMedia> {
  const result: EmbeddedMedia = {};
  for (const id of ids) {
    if (isBuiltinMedia(id)) continue;
    const record = await getMedia(id);
    if (record) result[id] = { name: record.name, kind: record.kind, mime: record.mime, dataUrl: record.dataUrl, width: record.width, height: record.height };
  }
  return result;
}

export async function restoreEmbeddedMedia(media: unknown): Promise<number> {
  if (!media || typeof media !== "object") return 0;
  let restored = 0;
  for (const [id, raw] of Object.entries(media as Record<string, unknown>)) {
    const entry = raw as Partial<MediaRecord> | null;
    if (!entry || typeof entry.dataUrl !== "string" || !entry.dataUrl.startsWith("data:image/") || !/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || isBuiltinMedia(id)) continue;
    if (await getMedia(id)) continue;
    await saveMedia({ id, name: String(entry.name ?? "Immagine").slice(0, 60), kind: entry.kind === "graphic" ? "graphic" : "background", mime: String(entry.mime ?? "image/png"), dataUrl: entry.dataUrl, width: Number(entry.width) || 1, height: Number(entry.height) || 1, createdAt: new Date().toISOString() });
    restored += 1;
  }
  return restored;
}
