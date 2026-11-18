import type { PhotoColorAdjust } from "@photo-tools/shared-types";
import { ADJUST_LIMIT, applyTransform, colorTransform, sanitizeAdjust, type ColorTransform } from "./colorAdjust";

/**
 * Abbinamento dei colori tra le foto di uno spread. Per ogni foto si guarda un campione piccolo di pixel (una miniatura) e se ne misura
 * l'aspetto in Lab: luminosità media e contrasto, dominante di colore (a, b) e intensità dei colori. Poi si cercano i cinque cursori
 * (luminosità, contrasto, temperatura, tinta, saturazione) che avvicinano quell'aspetto a quello delle altre foto. Il risultato è una
 * normale correzione modificabile, non una copia di stile: resta in mano al fotografo, che può ritoccarla o azzerarla.
 */

export interface ColorStats {
  /** Luminosità media (0-100). */
  meanL: number;
  /** Deviazione standard della luminosità: il contrasto. */
  stdL: number;
  /** Dominante verde-rosso e blu-giallo (medie di a e b). */
  meanA: number;
  meanB: number;
  /** Intensità media dei colori. */
  chroma: number;
}

const srgbToLinear = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const labF = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

/** Colore sRGB (canali 0-1) in Lab con bianco D65. */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883;
  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Aspetto di un campione di pixel RGBA (0-255), già passato per la correzione indicata. Un campione vuoto non ha statistiche. */
export function computeStats(rgba: ArrayLike<number>, transform?: ColorTransform): ColorStats | null {
  const count = Math.floor(rgba.length / 4);
  let used = 0;
  let sumL = 0;
  let sumL2 = 0;
  let sumA = 0;
  let sumB = 0;
  let sumC = 0;
  for (let i = 0; i < count; i += 1) {
    if (rgba[i * 4 + 3] < 8) continue;
    let r = rgba[i * 4] / 255;
    let g = rgba[i * 4 + 1] / 255;
    let b = rgba[i * 4 + 2] / 255;
    if (transform) [r, g, b] = applyTransform(r, g, b, transform);
    const [l, a, bb] = rgbToLab(r, g, b);
    used += 1;
    sumL += l;
    sumL2 += l * l;
    sumA += a;
    sumB += bb;
    sumC += Math.hypot(a, bb);
  }
  if (used === 0) return null;
  const meanL = sumL / used;
  return { meanL, stdL: Math.sqrt(Math.max(0, sumL2 / used - meanL * meanL)), meanA: sumA / used, meanB: sumB / used, chroma: sumC / used };
}

/** Media dell'aspetto di più foto: il bersaglio comune. */
export function averageStats(list: ReadonlyArray<ColorStats | null | undefined>): ColorStats | null {
  const valid = list.filter((entry): entry is ColorStats => Boolean(entry));
  if (valid.length === 0) return null;
  const mean = (pick: (entry: ColorStats) => number) => valid.reduce((sum, entry) => sum + pick(entry), 0) / valid.length;
  return { meanL: mean((e) => e.meanL), stdL: mean((e) => e.stdL), meanA: mean((e) => e.meanA), meanB: mean((e) => e.meanB), chroma: mean((e) => e.chroma) };
}

/** Quanto due aspetti si somigliano (0 = uguali): ogni differenza è pesata sulla soglia a cui l'occhio la nota. */
export function statsDistance(a: ColorStats, b: ColorStats): number {
  return ((a.meanL - b.meanL) / 5) ** 2 + ((a.stdL - b.stdL) / 6) ** 2 + ((a.meanA - b.meanA) / 3) ** 2 + ((a.meanB - b.meanB) / 3) ** 2 + ((a.chroma - b.chroma) / 6) ** 2;
}

type Knobs = Required<PhotoColorAdjust>;
const ORDER: ReadonlyArray<keyof Knobs> = ["brightness", "temperature", "tint", "contrast", "saturation"];

/**
 * Quanto lontano può spingersi l'abbinamento su ogni cursore: oltre, una foto non si «aggiusta» più, si snatura. La tinta e il contrasto
 * hanno i margini più stretti (una dominante o un contrasto sbagliati si notano subito), la luminosità i più larghi.
 */
export const MATCH_LIMITS: Readonly<Record<keyof Knobs, number>> = { brightness: 70, contrast: 45, saturation: 60, temperature: 50, tint: 30 };

/** Costo di ogni cursore nella ricerca: a parità di avvicinamento si preferisce toccare la luminosità e la saturazione, non tinta e contrasto. */
const EFFORT: Readonly<Record<keyof Knobs, number>> = { brightness: 0.5, contrast: 1.2, saturation: 0.7, temperature: 0.9, tint: 1.6 };

/**
 * I cursori che avvicinano `sample` all'aspetto `target`. Ricerca a passi che si dimezzano (da 32 a 1) su un cursore alla volta,
 * con un piccolo costo per i valori grandi: a parità di risultato vince la correzione più leggera. Restituisce `undefined`
 * quando la foto è già abbastanza vicina (nessuna correzione necessaria).
 */
export function solveMatch(sample: ArrayLike<number>, target: ColorStats, start?: PhotoColorAdjust): PhotoColorAdjust | undefined {
  const points: number[] = [];
  const total = Math.floor(sample.length / 4);
  // Al massimo 1600 pixel: la ricerca prova centinaia di combinazioni.
  const stride = Math.max(1, Math.floor(total / 1600));
  for (let i = 0; i < total; i += stride) points.push(sample[i * 4], sample[i * 4 + 1], sample[i * 4 + 2], sample[i * 4 + 3]);
  const knobs: Knobs = { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, ...start };
  const cost = (value: Knobs): number => {
    const stats = computeStats(points, colorTransform(value));
    if (!stats) return Infinity;
    const effort = ORDER.reduce((sum, key) => sum + EFFORT[key] * (value[key] / ADJUST_LIMIT) ** 2, 0);
    return statsDistance(stats, target) + effort;
  };
  const baseline = computeStats(points);
  if (!baseline) return undefined;
  // Già abbastanza simile (sotto la soglia di percezione di ogni misura): nessuna correzione.
  if (statsDistance(baseline, target) < 0.5) return sanitizeAdjust(start);
  let best = cost(knobs);
  for (let step = 32; step >= 1; step /= 2) {
    for (let pass = 0; pass < 3; pass += 1) {
      let improved = false;
      for (const key of ORDER) {
        for (const direction of [1, -1]) {
          const limit = MATCH_LIMITS[key];
          const candidate = { ...knobs, [key]: Math.min(limit, Math.max(-limit, knobs[key] + direction * step)) };
          if (candidate[key] === knobs[key]) continue;
          const value = cost(candidate);
          if (value < best - 1e-9) { best = value; knobs[key] = candidate[key]; improved = true; }
        }
      }
      if (!improved) break;
    }
  }
  return sanitizeAdjust(knobs);
}
