import type { TextMeasure } from "../render/text-layout";
import { boundsOf, type Box } from "./hit";
import type { Layer, PhotoLayer } from "./types";

/**
 * Calamite: mentre si sposta o si ridimensiona un elemento, i suoi bordi e il suo centro si agganciano al centro della slide, ai margini
 * e ai bordi e centri degli altri elementi. Funzioni pure, in pixel della tela (1080 di larghezza).
 */

export interface Guide { axis: "x" | "y"; pos: number }

/** Margine esterno dei modelli. */
export const SNAP_MARGIN = 72;

/** L'ingombro di una foto (senza rotazione), come lo vede chi la sposta. */
export function photoBox(layer: PhotoLayer): Box {
  return { x: layer.x + (layer.dx ?? 0), y: layer.y + (layer.dy ?? 0), w: layer.w, h: layer.h };
}

export function unionBox(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  const x1 = Math.min(...boxes.map((box) => box.x)), y1 = Math.min(...boxes.map((box) => box.y));
  const x2 = Math.max(...boxes.map((box) => box.x + box.w)), y2 = Math.max(...boxes.map((box) => box.y + box.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Gli ingombri a cui agganciarsi: tutti i livelli che hanno un ingombro utile, tranne quelli indicati. */
export function snapTargets(layers: readonly Layer[], skip: (layer: Layer) => boolean, measure: TextMeasure, width: number, height: number): Box[] {
  const boxes: Box[] = [];
  for (const layer of layers) {
    if (skip(layer)) continue;
    if (layer.kind === "photo") { if (!layer.blur && !layer.rotation) boxes.push(photoBox(layer)); continue; }
    const box = boundsOf(layer, measure, width, height);
    if (box && box.w > 2 && box.h > 2) boxes.push(box);
  }
  return boxes;
}

/** Le linee (verticali e orizzontali) a cui ci si può agganciare. */
export function snapLines(targets: readonly Box[], width: number, height: number): { xs: number[]; ys: number[] } {
  const xs = [0, width / 2, width, SNAP_MARGIN, width - SNAP_MARGIN];
  const ys = [0, height / 2, height, SNAP_MARGIN, height - SNAP_MARGIN];
  for (const box of targets) {
    xs.push(box.x, box.x + box.w / 2, box.x + box.w);
    ys.push(box.y, box.y + box.h / 2, box.y + box.h);
  }
  return { xs, ys };
}

/** Il valore agganciato alla linea più vicina entro `threshold`, oppure `null`. */
export function snapValue(value: number, lines: readonly number[], threshold: number): number | null {
  let best: number | null = null;
  let bestDistance = threshold;
  for (const line of lines) {
    const distance = Math.abs(line - value);
    if (distance <= bestDistance) { best = line; bestDistance = distance; }
  }
  return best;
}

/**
 * Aggancia una scatola che si sta spostando: sinistra, centro e destra (e alto, centro, basso) alle linee più vicine.
 * Restituisce lo scostamento da aggiungere e le linee guida da mostrare.
 */
export function snapBox(box: Box, targets: readonly Box[], width: number, height: number, threshold: number): { dx: number; dy: number; guides: Guide[] } {
  const { xs, ys } = snapLines(targets, width, height);
  const guides: Guide[] = [];
  let dx = 0, dy = 0;
  let bestX = threshold + 1, bestY = threshold + 1;
  for (const ref of [box.x, box.x + box.w / 2, box.x + box.w]) {
    const line = snapValue(ref, xs, threshold);
    if (line !== null && Math.abs(line - ref) < bestX) { bestX = Math.abs(line - ref); dx = line - ref; }
  }
  for (const ref of [box.y, box.y + box.h / 2, box.y + box.h]) {
    const line = snapValue(ref, ys, threshold);
    if (line !== null && Math.abs(line - ref) < bestY) { bestY = Math.abs(line - ref); dy = line - ref; }
  }
  if (bestX <= threshold) for (const ref of [box.x + dx, box.x + dx + box.w / 2, box.x + dx + box.w]) { const line = snapValue(ref, xs, 0.5); if (line !== null) guides.push({ axis: "x", pos: line }); }
  if (bestY <= threshold) for (const ref of [box.y + dy, box.y + dy + box.h / 2, box.y + dy + box.h]) { const line = snapValue(ref, ys, 0.5); if (line !== null) guides.push({ axis: "y", pos: line }); }
  return { dx, dy, guides };
}
