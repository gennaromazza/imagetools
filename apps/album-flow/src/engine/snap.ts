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
export function snapMove(rect: Rect, targets: readonly Rect[], threshold: number, options: { targetCenters?: boolean } = {}): SnapResult {
  // Senza i centri degli altri elementi l'aggancio resta ai soli bordi (e alla piega): meno scatti quando ci sono molte foto.
  const edgesX = options.targetCenters === false ? (r: Rect) => [r.x, r.x + r.w] : xs;
  const edgesY = options.targetCenters === false ? (r: Rect) => [r.y, r.y + r.h] : ys;
  const hitsX = nearest(xs(rect), targets, edgesX, threshold);
  const hitsY = nearest(ys(rect), targets, edgesY, threshold);
  const snapped: Rect = { ...rect, x: rect.x + (hitsX[0]?.delta ?? 0), y: rect.y + (hitsY[0]?.delta ?? 0) };
  return { rect: snapped, guides: [...guidesFor(snapped, hitsX, "x"), ...guidesFor(snapped, hitsY, "y")] };
}

/** Spazio minimo (mm) perché due foto vicine contino come «separate da uno spazio». */
const MIN_GAP_MM = 0.05;

interface EqualGapHit {
  /** Quanto spostare la foto su quell'asse (mm). */
  delta: number;
  /** Lo spazio uguale ottenuto (mm). */
  mm: number;
}

/** Su un asse: la foto si ferma dove lo spazio da una vicina è uguale all'altro lato o a uno spazio già presente tra due altre foto. */
function equalGapOnAxis(rect: Rect, others: readonly Rect[], threshold: number, axis: "x" | "y"): EqualGapHit | null {
  const pos = (r: Rect) => (axis === "x" ? r.x : r.y);
  const len = (r: Rect) => (axis === "x" ? r.w : r.h);
  const cross = (r: Rect) => (axis === "x" ? r.y : r.x);
  const crossLen = (r: Rect) => (axis === "x" ? r.h : r.w);
  const overlaps = (a: Rect, b: Rect) => Math.min(cross(a) + crossLen(a), cross(b) + crossLen(b)) - Math.max(cross(a), cross(b)) > EPSILON;
  const end = (r: Rect) => pos(r) + len(r);
  const mid = pos(rect) + len(rect) / 2;

  const facing = others.filter((other) => overlaps(rect, other) && len(other) > 0);
  const before = facing.filter((other) => pos(other) + len(other) / 2 < mid);
  const after = facing.filter((other) => pos(other) + len(other) / 2 >= mid);
  const left = before.length ? before.reduce((a, b) => (end(b) > end(a) ? b : a)) : null;
  const right = after.length ? after.reduce((a, b) => (pos(b) < pos(a) ? b : a)) : null;
  if (!left && !right) return null;

  // Gli spazi già presenti tra due foto vicine (in fila sullo stesso asse): quelli che si possono «ripetere».
  const known: number[] = [];
  for (const a of others) {
    for (const b of others) {
      if (a === b || !overlaps(a, b)) continue;
      const gap = pos(b) - end(a);
      if (gap <= MIN_GAP_MM || known.some((value) => Math.abs(value - gap) < 0.01)) continue;
      // Solo foto una accanto all'altra: se in mezzo ce n'è una terza, quello non è uno spazio da ripetere.
      if (others.some((between) => between !== a && between !== b && overlaps(a, between) && overlaps(b, between) && pos(between) >= end(a) - EPSILON && end(between) <= pos(b) + EPSILON)) continue;
      known.push(gap);
    }
  }

  const candidates: Array<{ at: number; mm: number }> = [];
  const free = (at: number): boolean => (!left || at - end(left) >= MIN_GAP_MM) && (!right || pos(right) - (at + len(rect)) >= MIN_GAP_MM);
  if (left && right) {
    const space = pos(right) - end(left) - len(rect);
    if (space >= 2 * MIN_GAP_MM) candidates.push({ at: end(left) + space / 2, mm: space / 2 });
  }
  for (const gap of known) {
    if (left) candidates.push({ at: end(left) + gap, mm: gap });
    if (right) candidates.push({ at: pos(right) - gap - len(rect), mm: gap });
  }
  let best: EqualGapHit | null = null;
  for (const candidate of candidates) {
    const delta = candidate.at - pos(rect);
    if (Math.abs(delta) > threshold || !free(candidate.at)) continue;
    if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, mm: candidate.mm };
  }
  return best;
}

export interface EqualGapSnap {
  rect: Rect;
  /** Per asse: lo spazio uguale ottenuto (mm), se la foto si è agganciata. */
  matched: { x?: number; y?: number };
}

/**
 * «Stessa distanza»: durante lo spostamento la foto si ferma dove lo spazio da una vicina è uguale a quello dall'altro lato (foto al centro tra
 * due) o a uno spazio già presente tra due altre foto, entro `threshold` mm. `axes` dice su quali assi provare (gli altri sono già agganciati ai bordi).
 */
export function snapEqualGaps(rect: Rect, others: readonly Rect[], threshold: number, axes: { x: boolean; y: boolean } = { x: true, y: true }): EqualGapSnap {
  const matched: EqualGapSnap["matched"] = {};
  let { x, y } = rect;
  if (axes.x) {
    const hit = equalGapOnAxis(rect, others, threshold, "x");
    if (hit) { x += hit.delta; matched.x = hit.mm; }
  }
  if (axes.y) {
    const hit = equalGapOnAxis({ ...rect, x }, others, threshold, "y");
    if (hit) { y += hit.delta; matched.y = hit.mm; }
  }
  return { rect: { ...rect, x, y }, matched };
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
