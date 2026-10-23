import { computeFingerprint } from "./fingerprint";
import type { PhotoFingerprint, SimilarityPhoto } from "./types";

/** Immagini sintetiche e foto di prova per i test del pacchetto (non usato dalle app). */

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SceneOptions {
  width?: number;
  height?: number;
  /** Spostamento del contenuto in pixel (come un passo della fotocamera tra due scatti). */
  shiftX?: number;
  shiftY?: number;
  /** Rumore casuale ± in livelli (0-255). */
  noise?: number;
  /** Livelli aggiunti a tutti i canali. */
  brightness?: number;
  /** Bianco e nero. */
  mono?: boolean;
  /** Raggio della sfocatura a scatola (foto mossa o fuori fuoco). */
  blur?: number;
  /** Tutto bianco o tutto nero (esposizione sbagliata). */
  fill?: number;
}

/** Una «scena»: sfondo sfumato e qualche rettangolo colorato, diversa per ogni `seed`. */
export function sceneRgba(seed: number, options: SceneOptions = {}): { rgba: Uint8ClampedArray; width: number; height: number } {
  const width = options.width ?? 96;
  const height = options.height ?? 64;
  const rnd = random(seed);
  const base = [rnd() * 255, rnd() * 255, rnd() * 255];
  const tilt = [rnd() * 120 - 60, rnd() * 120 - 60, rnd() * 120 - 60];
  const boxes = Array.from({ length: 6 }, () => ({
    x: rnd() * width, y: rnd() * height, w: 8 + rnd() * width * 0.4, h: 8 + rnd() * height * 0.4,
    color: [rnd() * 255, rnd() * 255, rnd() * 255],
  }));
  const noise = random(seed * 7919 + 13);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = x - (options.shiftX ?? 0);
      const sy = y - (options.shiftY ?? 0);
      let color = base.map((value, channel) => value + tilt[channel] * (sx / width - 0.5) + tilt[(channel + 1) % 3] * (sy / height - 0.5));
      for (const box of boxes) if (sx >= box.x && sx < box.x + box.w && sy >= box.y && sy < box.y + box.h) color = box.color;
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const jitter = options.noise ? (noise() * 2 - 1) * options.noise : 0;
        rgba[offset + channel] = options.fill ?? color[channel] + (options.brightness ?? 0) + jitter;
      }
      rgba[offset + 3] = 255;
    }
  }
  if (options.mono) {
    for (let offset = 0; offset < rgba.length; offset += 4) {
      const gray = 0.299 * rgba[offset] + 0.587 * rgba[offset + 1] + 0.114 * rgba[offset + 2];
      rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = gray;
    }
  }
  if (options.blur) return { rgba: boxBlur(rgba, width, height, options.blur), width, height };
  return { rgba, width, height };
}

function boxBlur(rgba: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sums = [0, 0, 0];
      let count = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const px = Math.min(width - 1, Math.max(0, x + dx));
          const py = Math.min(height - 1, Math.max(0, y + dy));
          const offset = (py * width + px) * 4;
          sums[0] += rgba[offset]; sums[1] += rgba[offset + 1]; sums[2] += rgba[offset + 2];
          count += 1;
        }
      }
      const offset = (y * width + x) * 4;
      out[offset] = sums[0] / count; out[offset + 1] = sums[1] / count; out[offset + 2] = sums[2] / count; out[offset + 3] = 255;
    }
  }
  return out;
}

export function sceneFingerprint(seed: number, options: SceneOptions = {}): PhotoFingerprint {
  const { rgba, width, height } = sceneRgba(seed, options);
  return computeFingerprint(rgba, width, height);
}

export const BASE_TIME = Date.UTC(2026, 5, 5, 15, 0, 0);

export function photo(id: string, seconds: number | null, overrides: Partial<SimilarityPhoto> = {}): SimilarityPhoto {
  return { id, fileName: `${id}.jpg`, aspect: 1.5, ...(seconds === null ? {} : { captureTimeMs: BASE_TIME + Math.round(seconds * 1000) }), ...overrides };
}

/** Membri dei gruppi come insiemi ordinati, per confronti che non dipendono dall'ordine. */
export const groupSets = (groups: ReadonlyArray<{ photoIds: readonly string[] }>) => groups.map((group) => [...group.photoIds].sort().join(",")).sort();
