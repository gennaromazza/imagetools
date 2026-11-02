import type { Rect } from "./geometry";

/** Geometria dei gruppi di foto libere: selezione a rettangolo, allineamento e distribuzione (tutto in mm nello spread). */

export interface Boxed {
  id: string;
  rect: Rect;
}

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/** I due rettangoli si toccano (anche solo per un bordo): come nei programmi di grafica, basta sfiorare una foto per prenderla. */
export const rectsTouch = (a: Rect, b: Rect): boolean => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

/** Rettangolo tracciato trascinando tra due punti, in qualunque direzione. */
export const rectFromPoints = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) });

/** Gli id delle foto toccate dal rettangolo di selezione, nell'ordine in cui arrivano. */
export const marqueeHits = (marquee: Rect, items: readonly Boxed[]): string[] => items.filter((item) => rectsTouch(marquee, item.rect)).map((item) => item.id);

export function unionRect(rects: readonly Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
}

/** Allinea le foto al bordo (o al centro) del riquadro che le contiene tutte. Con una foto sola non cambia nulla. */
export function alignRects(items: readonly Boxed[], mode: AlignMode): Boxed[] {
  if (items.length < 2) return items.map((item) => ({ ...item }));
  const box = unionRect(items.map((item) => item.rect));
  return items.map(({ id, rect }) => {
    switch (mode) {
      case "left": return { id, rect: { ...rect, x: box.x } };
      case "hcenter": return { id, rect: { ...rect, x: box.x + (box.w - rect.w) / 2 } };
      case "right": return { id, rect: { ...rect, x: box.x + box.w - rect.w } };
      case "top": return { id, rect: { ...rect, y: box.y } };
      case "vcenter": return { id, rect: { ...rect, y: box.y + (box.h - rect.h) / 2 } };
      default: return { id, rect: { ...rect, y: box.y + box.h - rect.h } };
    }
  });
}

/**
 * Distribuisce le foto con lo stesso spazio tra l'una e l'altra: la prima e l'ultima restano dove sono, le altre si ripartiscono in mezzo.
 * Servono almeno tre foto; con meno non cambia nulla.
 */
export function distributeRects(items: readonly Boxed[], axis: "x" | "y"): Boxed[] {
  if (items.length < 3) return items.map((item) => ({ ...item }));
  const pos = (r: Rect) => (axis === "x" ? r.x : r.y);
  const size = (r: Rect) => (axis === "x" ? r.w : r.h);
  const sorted = [...items].sort((a, b) => pos(a.rect) - pos(b.rect));
  const first = sorted[0].rect;
  const last = sorted[sorted.length - 1].rect;
  const span = pos(last) + size(last) - pos(first);
  const gap = (span - sorted.reduce((sum, item) => sum + size(item.rect), 0)) / (sorted.length - 1);
  let cursor = pos(first);
  const moved = new Map<string, Rect>();
  for (const item of sorted) {
    moved.set(item.id, axis === "x" ? { ...item.rect, x: cursor } : { ...item.rect, y: cursor });
    cursor += size(item.rect) + gap;
  }
  return items.map((item) => ({ id: item.id, rect: moved.get(item.id)! }));
}

/** Scala tutte le foto di `factor` rispetto a un punto fermo (l'angolo opposto alla maniglia): posizioni e misure crescono insieme, le proporzioni di ognuna restano. */
export const scaleRects = (items: readonly Boxed[], anchor: { x: number; y: number }, factor: number): Boxed[] => items.map(({ id, rect }) => ({
  id,
  rect: { x: anchor.x + (rect.x - anchor.x) * factor, y: anchor.y + (rect.y - anchor.y) * factor, w: rect.w * factor, h: rect.h * factor },
}));

/** Fattore di scala per una maniglia d'angolo trascinata di `dx`, `dy` mm (`sx`, `sy` = lato della maniglia, ±1): non scende sotto `minFactor`. */
export function groupScaleFactor(box: Rect, sx: 1 | -1, sy: 1 | -1, dx: number, dy: number, minFactor: number): number {
  if (box.w <= 0 || box.h <= 0) return 1;
  return Math.max(minFactor, (box.w + sx * dx) / box.w, (box.h + sy * dy) / box.h);
}

/** Una distanza da mostrare durante lo spostamento: `axis: "x"` è un tratto orizzontale alla quota `at` (mm) da `from` a `to`, `"y"` verticale. `mm` è lo spazio misurato. */
export interface GapMeasure {
  axis: "x" | "y";
  from: number;
  to: number;
  at: number;
  mm: number;
}

const overlapMid = (aStart: number, aEnd: number, bStart: number, bEnd: number): number | null => {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  return end > start ? (start + end) / 2 : null;
};

/**
 * Le distanze tra la foto trascinata e le foto più vicine nelle quattro direzioni (come le misure in Canva): per ogni lato la foto che le sta
 * di fronte, con la parte in comune dell'altro asse, e lo spazio vuoto che le separa. Le foto che si sovrappongono non hanno distanza.
 */
export function gapMeasures(rect: Rect, others: readonly Rect[]): GapMeasure[] {
  const out: GapMeasure[] = [];
  const best = (candidates: GapMeasure[]) => { if (candidates.length) out.push(candidates.reduce((a, b) => (b.mm < a.mm ? b : a))); };
  const right: GapMeasure[] = [];
  const left: GapMeasure[] = [];
  const below: GapMeasure[] = [];
  const above: GapMeasure[] = [];
  for (const other of others) {
    const y = overlapMid(rect.y, rect.y + rect.h, other.y, other.y + other.h);
    if (y !== null) {
      if (other.x >= rect.x + rect.w) right.push({ axis: "x", from: rect.x + rect.w, to: other.x, at: y, mm: other.x - (rect.x + rect.w) });
      else if (other.x + other.w <= rect.x) left.push({ axis: "x", from: other.x + other.w, to: rect.x, at: y, mm: rect.x - (other.x + other.w) });
    }
    const x = overlapMid(rect.x, rect.x + rect.w, other.x, other.x + other.w);
    if (x !== null) {
      if (other.y >= rect.y + rect.h) below.push({ axis: "y", from: rect.y + rect.h, to: other.y, at: x, mm: other.y - (rect.y + rect.h) });
      else if (other.y + other.h <= rect.y) above.push({ axis: "y", from: other.y + other.h, to: rect.y, at: x, mm: rect.y - (other.y + other.h) });
    }
  }
  [right, left, below, above].forEach(best);
  return out.filter((gap) => gap.mm > 0.05);
}

export const translateRect = (rect: Rect, dx: number, dy: number): Rect => ({ ...rect, x: rect.x + dx, y: rect.y + dy });
