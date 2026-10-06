import { DEFAULT_FRAMING, MAX_ZOOM, type PhotoFraming } from "./types";

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const third = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Rende valida un'inquadratura (zoom 1-4, centro 0-1, forma 0,2-5) e restituisce `null` quando coincide con quella predefinita,
 * così non si salvano scelte che non cambiano nulla. `allowShape` è falso nei panorami: le loro parti devono combaciare.
 */
export function normalizeFraming(framing: Partial<PhotoFraming> | null | undefined, allowShape = true): PhotoFraming | null {
  if (!framing) return null;
  const zoom = third(clamp(Number.isFinite(framing.zoom) ? (framing.zoom as number) : 1, 1, MAX_ZOOM));
  const cx = third(clamp(Number.isFinite(framing.cx) ? (framing.cx as number) : 0.5, 0, 1));
  const cy = third(clamp(Number.isFinite(framing.cy) ? (framing.cy as number) : 0.5, 0, 1));
  const shape = allowShape && Number.isFinite(framing.shape) && (framing.shape as number) >= 0.2 && (framing.shape as number) <= 5 ? third(framing.shape as number) : undefined;
  if (zoom === DEFAULT_FRAMING.zoom && cx === DEFAULT_FRAMING.cx && cy === DEFAULT_FRAMING.cy && shape === undefined) return null;
  return { zoom, cx, cy, ...(shape !== undefined ? { shape } : {}) };
}

/** Un elenco di inquadrature (una per spazio): se non c'è nulla da salvare restituisce `undefined`. */
export function normalizeFramingList(list: ReadonlyArray<Partial<PhotoFraming> | null | undefined> | undefined, slots: number, allowShape = true): Array<PhotoFraming | null> | undefined {
  if (!list) return undefined;
  const result = Array.from({ length: slots }, (_, index) => normalizeFraming(list[index], allowShape));
  return result.some(Boolean) ? result : undefined;
}

/** Il punto centrale (0-1) può muoversi solo finché l'immagine copre la cornice: oltre, la foto non si sposterebbe più. */
export function focusRange(frameSize: number, imageSize: number): [number, number] {
  if (!(imageSize > frameSize)) return [0.5, 0.5];
  const margin = frameSize / (2 * imageSize);
  return [margin, 1 - margin];
}

/**
 * Uno spostamento fatto sullo schermo, riportato nel sistema di una foto ruotata di `degrees` (come in SVG, in senso orario):
 * trascinando una foto inclinata, l'immagine segue il puntatore invece di scivolare di lato.
 */
export function rotateDelta(dx: number, dy: number, degrees: number): { dx: number; dy: number } {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { dx: dx * cos + dy * sin, dy: -dx * sin + dy * cos };
}

export const framingEquals = (a: PhotoFraming | null | undefined, b: PhotoFraming | null | undefined) =>
  (a?.zoom ?? 1) === (b?.zoom ?? 1) && (a?.cx ?? 0.5) === (b?.cx ?? 0.5) && (a?.cy ?? 0.5) === (b?.cy ?? 0.5) && (a?.shape ?? 0) === (b?.shape ?? 0);
