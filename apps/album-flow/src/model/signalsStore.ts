import type { AlbumAssetV2 } from "@photo-tools/shared-types";
import type { PhotoFingerprint } from "@photo-tools/photo-similarity";
import type { PhotoSignals } from "./similar";

/**
 * Archivio locale dei dati letti dalle foto per riconoscere le simili (impronta della miniatura, modello della fotocamera).
 * Sono dati ricalcolabili: stanno sul computer, per album, e non entrano nel file del progetto. Un dato rovinato si scarta
 * da solo senza toccare gli altri; un file cambiato sul disco (misure diverse) si rilegge.
 */

export const SIGNALS_STORAGE_PREFIX = "filex.albumFlow.signals.";
/** Oltre questo numero di foto per album l'archivio non cresce (le più vecchie si rileggono quando servono). */
export const MAX_STORED_SIGNALS = 5000;

interface StoredFingerprint { k: string; h: string; l: [number, number, number]; c: number; s: number; hi: number; lo: number }
interface StoredSignals { v: 1; f: Record<string, StoredFingerprint>; cam: Record<string, string> }

export interface SignalStore {
  /** Impronte valide per id della foto, con la chiave del file da cui sono state lette. */
  fingerprints: Map<string, { key: string; value: PhotoFingerprint }>;
  cameras: Map<string, string>;
}

/** Chiave del file da cui si legge l'impronta: cambia se la foto viene sostituita o modificata nelle misure. */
export const signalKey = (asset: Pick<AlbumAssetV2, "absolutePath" | "fileName" | "width" | "height">) => `${asset.width}x${asset.height}|${asset.absolutePath ?? asset.fileName}`;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function emptySignalStore(): SignalStore {
  return { fingerprints: new Map(), cameras: new Map() };
}

export function decodeSignals(raw: string | null): SignalStore {
  const store = emptySignalStore();
  if (!raw) return store;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return store; }
  if (!parsed || typeof parsed !== "object" || (parsed as { v?: unknown }).v !== 1) return store;
  const { f, cam } = parsed as Partial<StoredSignals>;
  if (f && typeof f === "object") {
    for (const [id, entry] of Object.entries(f)) {
      if (!entry || typeof entry !== "object") continue;
      const { k, h, l, c, s, hi, lo } = entry as Partial<StoredFingerprint>;
      if (typeof k !== "string" || typeof h !== "string" || !/^[0-9a-f]{16}$/.test(h)) continue;
      if (!Array.isArray(l) || l.length !== 3 || !l.every(finite) || ![c, s, hi, lo].every(finite)) continue;
      store.fingerprints.set(id, { key: k, value: { hash: h, lab: [l[0], l[1], l[2]], chroma: c!, sharpness: s!, clipHigh: hi!, clipLow: lo! } });
    }
  }
  if (cam && typeof cam === "object") {
    for (const [id, model] of Object.entries(cam)) if (typeof model === "string" && model.trim()) store.cameras.set(id, model);
  }
  return store;
}

const round = (value: number, digits = 3) => Number(value.toFixed(digits));

export function encodeSignals(store: SignalStore): string {
  const f: Record<string, StoredFingerprint> = {};
  const entries = [...store.fingerprints].slice(-MAX_STORED_SIGNALS);
  for (const [id, { key, value }] of entries) {
    f[id] = { k: key, h: value.hash, l: [round(value.lab[0], 2), round(value.lab[1], 2), round(value.lab[2], 2)], c: round(value.chroma, 2), s: round(value.sharpness, 1), hi: round(value.clipHigh), lo: round(value.clipLow) };
  }
  const cam: Record<string, string> = {};
  for (const [id, model] of [...store.cameras].slice(-MAX_STORED_SIGNALS)) cam[id] = model;
  return JSON.stringify({ v: 1, f, cam } satisfies StoredSignals);
}

/** Dati utili per le foto attuali dell'album: le impronte lette da un file diverso (chiave cambiata) non valgono. */
export function signalsFor(store: SignalStore, assets: readonly AlbumAssetV2[]): PhotoSignals {
  const fingerprints = new Map<string, PhotoFingerprint>();
  const cameras = new Map<string, string>();
  for (const asset of assets) {
    const stored = store.fingerprints.get(asset.id);
    if (stored && stored.key === signalKey(asset)) fingerprints.set(asset.id, stored.value);
    const camera = store.cameras.get(asset.id);
    if (camera) cameras.set(asset.id, camera);
  }
  return { fingerprints, cameras };
}

/** Foto ancora senza impronta valida. */
export function missingFingerprints(store: SignalStore, assets: readonly AlbumAssetV2[]): AlbumAssetV2[] {
  return assets.filter((asset) => store.fingerprints.get(asset.id)?.key !== signalKey(asset));
}

export function loadSignalStore(projectId: string): SignalStore {
  try { return decodeSignals(localStorage.getItem(SIGNALS_STORAGE_PREFIX + projectId)); } catch { return emptySignalStore(); }
}

export function saveSignalStore(projectId: string, store: SignalStore): boolean {
  try { localStorage.setItem(SIGNALS_STORAGE_PREFIX + projectId, encodeSignals(store)); return true; } catch { return false; }
}
