import type { Rect } from "./geometry";

/** Linea guida mostrata durante lo spostamento: `axis: "x"` è una linea verticale alla coordinata `at` (mm), `"y"` orizzontale. */
export interface SnapGuide {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
}

export interface SnapResult {
  rect: Rect;
  guides: SnapGuide[];
}

const EPSILON = 1e-6;

const xs = (rect: Rect): number[] => [rect.x, rect.x + rect.w / 2, rect.x + rect.w];
const ys = (rect: Rect): number[] => [rect.y, rect.y + rect.h / 2, rect.y + rect.h];

interface Hit {
  delta: number;
  at: number;
  target: Rect;
}

/** Il candidato più vicino (entro la soglia) tra i punti `mine` e i punti dei `targets`; parità entro EPSILON restano tutte. */
function nearest(mine: readonly number[], targets: readonly Rect[], pick: (rect: Rect) => number[], threshold: number): Hit[] {
  let best = Infinity;
  const hits: Hit[] = [];
  for (const target of targets) {
    for (const at of pick(target)) {
      for (const point of mine) {
        const delta = at - point;
        const distance = Math.abs(delta);
        if (distance > threshold) continue;
        if (distance < best - EPSILON) { best = distance; hits.length = 0; }
        if (distance <= best + EPSILON) hits.push({ delta, at, target });
      }
    }
  }
  return hits.filter((hit) => Math.abs(Math.abs(hit.delta) - best) <= EPSILON);
}

const guidesFor = (rect: Rect, hits: readonly Hit[], axis: "x" | "y"): SnapGuide[] => {
  const seen = new Set<string>();
  const guides: SnapGuide[] = [];
  for (const hit of hits) {
    const key = `${axis}:${hit.at.toFixed(3)}`;
    // una sola linea per posizione, estesa a tutte le foto che si allineano lì
    const same = hits.filter((other) => Math.abs(other.at - hit.at) < EPSILON);
    if (seen.has(key)) continue;
    seen.add(key);
    const rects = [rect, ...same.map((other) => other.target)];
    guides.push(axis === "x"
      ? { axis, at: hit.at, from: Math.min(...rects.map((r) => r.y)), to: Math.max(...rects.map((r) => r.y + r.h)) }
      : { axis, at: hit.at, from: Math.min(...rects.map((r) => r.x)), to: Math.max(...rects.map((r) => r.x + r.w)) });
  }
  return guides;
};

/**
 * Aggancio (calamita) durante lo spostamento: bordo sinistro/centro/destro e alto/centro/basso della foto si attaccano a quelli
 * delle altre foto e dei bordi dell'area (`targets`) entro `threshold` mm. Restituisce il rettangolo agganciato e le linee guida.
 */
export function snapMove(rect: Rect, targets: readonly Rect[], threshold: number): SnapResult {
  const hitsX = nearest(xs(rect), targets, xs, threshold);
  const hitsY = nearest(ys(rect), targets, ys, threshold);
  const snapped: Rect = { ...rect, x: rect.x + (hitsX[0]?.delta ?? 0), y: rect.y + (hitsY[0]?.delta ?? 0) };
  return { rect: snapped, guides: [...guidesFor(snapped, hitsX, "x"), ...guidesFor(snapped, hitsY, "y")] };
}

/**
 * Aggancio durante il ridimensionamento con le proporzioni bloccate: il bordo destro o quello in basso si attacca al più vicino
 * (il resto della foto segue per mantenere le proporzioni).
 */
export function snapResize(rect: Rect, targets: readonly Rect[], threshold: number): SnapResult {
  const aspect = rect.w / rect.h;
  const right = nearest([rect.x + rect.w], targets, xs, threshold);
  const bottom = nearest([rect.y + rect.h], targets, ys, threshold);
  const dx = right[0] ? Math.abs(right[0].delta) : Infinity;
  const dy = bottom[0] ? Math.abs(bottom[0].delta) : Infinity;
  if (!Number.isFinite(dx) && !Number.isFinite(dy)) return { rect, guides: [] };
  if (dx <= dy) {
    const w = right[0].at - rect.x;
    const snapped = { ...rect, w, h: w / aspect };
    return { rect: snapped, guides: guidesFor(snapped, right, "x") };
  }
  const h = bottom[0].at - rect.y;
  const snapped = { ...rect, h, w: h * aspect };
  return { rect: snapped, guides: guidesFor(snapped, bottom, "y") };
}
