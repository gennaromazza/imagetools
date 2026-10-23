import type { PhotoFingerprint } from "./types";

/** Croma medio sotto cui una foto è in bianco e nero (o quasi, come un viraggio leggero). */
export const MONOCHROME_CHROMA = 6;
/** Massimo di campioni per colore ed esposizione: oltre non cambia il risultato, solo il tempo. */
const MAX_SAMPLES = 16_384;

const toLinear = (channel: number) => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const LINEAR = Array.from({ length: 256 }, (_, index) => toLinear(index));
const labF = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

/** sRGB (0-255) in Lab con il bianco D65. */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lr = LINEAR[r] ?? toLinear(r);
  const lg = LINEAR[g] ?? toLinear(g);
  const lb = LINEAR[b] ?? toLinear(b);
  const x = (0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.95047;
  const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  const z = (0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.08883;
  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Luminanza (0-255) di ogni pixel di un'immagine RGBA. */
function luminance(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
  const gray = new Float32Array(width * height);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    gray[index] = 0.299 * rgba[offset] + 0.587 * rgba[offset + 1] + 0.114 * rgba[offset + 2];
  }
  return gray;
}

/** Media dei pixel di una griglia `cols` × `rows` (riduzione per aree, senza scalettature). */
function boxDownsample(gray: Float32Array, width: number, height: number, cols: number, rows: number): Float32Array {
  const out = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    const y0 = Math.floor((row * height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * height) / rows));
    for (let col = 0; col < cols; col += 1) {
      const x0 = Math.floor((col * width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * width) / cols));
      let sum = 0;
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) sum += gray[y * width + x];
      out[row * cols + col] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

/** dHash: per ogni riga di una griglia 9×8, un bit per «il pixel è più chiaro del vicino a destra». */
function differenceHash(gray: Float32Array, width: number, height: number): string {
  const grid = boxDownsample(gray, width, height, 9, 8);
  let hex = "";
  let nibble = 0;
  let bits = 0;
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      nibble = (nibble << 1) | (grid[row * 9 + col] > grid[row * 9 + col + 1] ? 1 : 0);
      bits += 1;
      if (bits === 4) { hex += nibble.toString(16); nibble = 0; bits = 0; }
    }
  }
  return hex;
}

/** Varianza del laplaciano: alta se ci sono bordi netti, bassa se la foto è mossa o fuori fuoco. */
function laplacianVariance(gray: Float32Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = y * width + x;
      const value = 4 * gray[at] - gray[at - 1] - gray[at + 1] - gray[at - width] - gray[at + width];
      sum += value;
      sumSq += value * value;
      count += 1;
    }
  }
  const mean = sum / count;
  return Math.max(0, sumSq / count - mean * mean);
}

/** Impronta di una miniatura RGBA (`width` × `height`, 4 byte per pixel). */
export function computeFingerprint(rgba: ArrayLike<number>, width: number, height: number): PhotoFingerprint {
  if (!(width > 0 && height > 0) || rgba.length < width * height * 4) throw new Error("Immagine non valida per l'impronta.");
  const gray = luminance(rgba, width, height);
  const step = Math.max(1, Math.floor((width * height) / MAX_SAMPLES));
  let l = 0;
  let a = 0;
  let b = 0;
  let chroma = 0;
  let high = 0;
  let low = 0;
  let samples = 0;
  for (let index = 0; index < width * height; index += step) {
    const offset = index * 4;
    const [pl, pa, pb] = rgbToLab(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
    l += pl; a += pa; b += pb;
    chroma += Math.hypot(pa, pb);
    if (gray[index] >= 250) high += 1;
    else if (gray[index] <= 5) low += 1;
    samples += 1;
  }
  return {
    hash: differenceHash(gray, width, height),
    lab: [l / samples, a / samples, b / samples],
    chroma: chroma / samples,
    sharpness: laplacianVariance(gray, width, height),
    clipHigh: high / samples,
    clipLow: low / samples,
  };
}

const POPCOUNT = Array.from({ length: 16 }, (_, value) => (value & 1) + ((value >> 1) & 1) + ((value >> 2) & 1) + ((value >> 3) & 1));

/** Bit diversi tra due impronte (0 = identiche, 64 = opposte). Impronte non confrontabili valgono 64. */
export function hashDistance(a: string, b: string): number {
  if (a.length !== b.length || a.length === 0) return 64;
  let distance = 0;
  for (let index = 0; index < a.length; index += 1) {
    const x = Number.parseInt(a[index], 16);
    const y = Number.parseInt(b[index], 16);
    if (Number.isNaN(x) || Number.isNaN(y)) return 64;
    distance += POPCOUNT[x ^ y];
  }
  return distance;
}

/** Differenza tra i colori medi (ΔE 1976): sotto 10 i toni sono molto vicini, oltre 30 molto diversi. */
export function colorDistance(a: Pick<PhotoFingerprint, "lab">, b: Pick<PhotoFingerprint, "lab">): number {
  return Math.hypot(a.lab[0] - b.lab[0], a.lab[1] - b.lab[1], a.lab[2] - b.lab[2]);
}

export const isMonochrome = (fingerprint: Pick<PhotoFingerprint, "chroma">) => fingerprint.chroma < MONOCHROME_CHROMA;
