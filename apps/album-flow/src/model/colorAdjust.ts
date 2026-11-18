import type { PhotoColorAdjust } from "@photo-tools/shared-types";

/**
 * Correzione colore di una foto: luminosità, contrasto, saturazione, temperatura e tinta (da -100 a 100, zero = nessun cambiamento).
 * Tutto si riduce a due passaggi sui valori sRGB di ogni pixel, sempre nello stesso ordine:
 *   1. la saturazione, con la matrice a pesi di luminanza di `feColorMatrix type="saturate"`;
 *   2. per ogni canale `uscita = pendenza × entrata + intercetta` (luminosità, bilanciamento del bianco e contrasto insieme).
 * Lo stesso calcolo si legge come filtro SVG (schermo ed esportazione) e come `recomb` + `linear` di sharp (scrittura sul file originale),
 * che esegue sempre `recomb` per primo: una sola matematica, quindi la foto salvata ha lo stesso aspetto di quella vista.
 */

export const ADJUST_KEYS = ["brightness", "contrast", "saturation", "temperature", "tint"] as const;
export type AdjustKey = (typeof ADJUST_KEYS)[number];

export const ADJUST_LIMIT = 100;

/** Etichette per l'interfaccia, con l'effetto dei due versi. */
export const ADJUST_LABELS: Record<AdjustKey, { label: string; low: string; high: string }> = {
  brightness: { label: "Luminosità", low: "più scura", high: "più chiara" },
  contrast: { label: "Contrasto", low: "più morbida", high: "più decisa" },
  saturation: { label: "Saturazione", low: "più spenta", high: "più viva" },
  temperature: { label: "Temperatura", low: "più fredda", high: "più calda" },
  tint: { label: "Tinta", low: "verso il verde", high: "verso il magenta" },
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(Number.isFinite(value) ? value : 0, min), max);
/** Mezzo punto di precisione: abbastanza per l'occhio, e due correzioni uguali hanno lo stesso filtro. */
const snap = (value: number) => Math.round(clamp(value, -ADJUST_LIMIT, ADJUST_LIMIT) * 2) / 2;

/** I valori riportati nei limiti e arrotondati; senza nessun valore diverso da zero restituisce `undefined` (foto com'è). */
export function sanitizeAdjust(value: PhotoColorAdjust | undefined | null): PhotoColorAdjust | undefined {
  if (!value) return undefined;
  const out: PhotoColorAdjust = {};
  for (const key of ADJUST_KEYS) {
    const next = snap(value[key] ?? 0);
    if (next !== 0) out[key] = next;
  }
  return Object.keys(out).length ? out : undefined;
}

export const isNeutralAdjust = (value: PhotoColorAdjust | undefined | null): boolean => sanitizeAdjust(value) === undefined;

export function sameAdjust(a: PhotoColorAdjust | undefined | null, b: PhotoColorAdjust | undefined | null): boolean {
  const left = sanitizeAdjust(a);
  const right = sanitizeAdjust(b);
  return ADJUST_KEYS.every((key) => (left?.[key] ?? 0) === (right?.[key] ?? 0));
}

/** Cambia un solo valore e restituisce la correzione ripulita (o `undefined` se torna neutra). */
export function withAdjustValue(current: PhotoColorAdjust | undefined, key: AdjustKey, value: number): PhotoColorAdjust | undefined {
  return sanitizeAdjust({ ...current, [key]: value });
}

export interface ColorTransform {
  /** Pendenza per canale R, G, B (valori 0-1). */
  slope: [number, number, number];
  /** Intercetta per canale R, G, B (valori 0-1). */
  intercept: [number, number, number];
  /** 1 = invariata, 0 = grigi, fino a 2. */
  saturation: number;
}

/** Il passaggio da una correzione ai numeri che servono a schermo, nell'esportazione e nel file. */
export function colorTransform(adjust: PhotoColorAdjust | undefined | null): ColorTransform {
  const a = sanitizeAdjust(adjust) ?? {};
  // Luminosità: ±1,5 stop di esposizione; sui valori sRGB uno stop vale 2^(1/2,2).
  const exposure = 2 ** (((a.brightness ?? 0) / ADJUST_LIMIT) * 1.5 / 2.2);
  // Bilanciamento del bianco: il caldo alza il rosso e abbassa il blu, il magenta abbassa il verde; la luminanza resta quella di prima.
  const warm = ((a.temperature ?? 0) / ADJUST_LIMIT) * 0.3;
  const magenta = ((a.tint ?? 0) / ADJUST_LIMIT) * 0.2;
  const gains: [number, number, number] = [2 ** warm, 2 ** -magenta, 2 ** -warm];
  const luma = 0.2126 * gains[0] + 0.7152 * gains[1] + 0.0722 * gains[2];
  const k = 1 + ((a.contrast ?? 0) / ADJUST_LIMIT) * 0.6;
  const slope = gains.map((gain) => (k * exposure * gain) / luma) as [number, number, number];
  const mid = 0.5 * (1 - k);
  return { slope, intercept: [mid, mid, mid], saturation: Math.max(0, 1 + (a.saturation ?? 0) / ADJUST_LIMIT) };
}

/** Matrice 3×3 della saturazione, con gli stessi pesi di `feColorMatrix type="saturate"`. */
export function saturationMatrix(saturation: number): [[number, number, number], [number, number, number], [number, number, number]] {
  const s = saturation;
  return [
    [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
  ];
}

const unit = (value: number) => Math.min(Math.max(value, 0), 1);

/** Un pixel (canali 0-1) attraverso i due passaggi, con il taglio a 0-1 dopo ciascuno come fanno filtro SVG e sharp. */
export function applyTransform(r: number, g: number, b: number, transform: ColorTransform): [number, number, number] {
  const m = saturationMatrix(transform.saturation);
  const sr = unit(m[0][0] * r + m[0][1] * g + m[0][2] * b);
  const sg = unit(m[1][0] * r + m[1][1] * g + m[1][2] * b);
  const sb = unit(m[2][0] * r + m[2][1] * g + m[2][2] * b);
  return [unit(transform.slope[0] * sr + transform.intercept[0]), unit(transform.slope[1] * sg + transform.intercept[1]), unit(transform.slope[2] * sb + transform.intercept[2])];
}

const num = (value: number) => Number(value.toFixed(5)).toString();

/** Nome stabile del filtro SVG di una correzione: due foto con la stessa correzione ne condividono uno. */
export function adjustFilterId(adjust: PhotoColorAdjust | undefined | null, mono = false): string {
  const a = sanitizeAdjust(adjust);
  const part = ADJUST_KEYS.map((key) => String(a?.[key] ?? 0).replace("-", "m").replace(".", "p")).join("_");
  return `af-adj-${part}${mono ? "-bn" : ""}`;
}

/** Il filtro SVG di una correzione (con il bianco e nero in coda se serve). `null` se la foto non cambia. */
export function adjustFilterSvg(adjust: PhotoColorAdjust | undefined | null, mono = false): string | null {
  if (!sanitizeAdjust(adjust)) return null;
  const t = colorTransform(adjust);
  const channel = (tag: string, index: number) => `<${tag} type="linear" slope="${num(t.slope[index])}" intercept="${num(t.intercept[index])}"/>`;
  const gray = mono ? '<feColorMatrix type="saturate" values="0"/>' : "";
  return `<filter id="${adjustFilterId(adjust, mono)}" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%"><feColorMatrix type="saturate" values="${num(t.saturation)}"/><feComponentTransfer>${channel("feFuncR", 0)}${channel("feFuncG", 1)}${channel("feFuncB", 2)}</feComponentTransfer>${gray}</filter>`;
}

/**
 * Valore della proprietà CSS `filter` per una foto a schermo (il bianco e nero a schermo è quello già usato dal resto del programma).
 * Il filtro SVG viaggia dentro l'indirizzo stesso: nessuna definizione da tenere nella pagina, e vale ovunque ci sia una foto.
 */
export function adjustCssFilter(adjust: PhotoColorAdjust | undefined | null, mono = false): string | undefined {
  const svg = adjustFilterSvg(adjust);
  if (!svg) return undefined;
  const document = `<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(document)}#${adjustFilterId(adjust)}")${mono ? " grayscale(1) contrast(1.04)" : ""}`;
}
