import type { LayoutNode } from "@photo-tools/shared-types";
import { MIN_RATIO, clampRatio, layoutCells, type LeafCell, type Rect } from "./geometry";
import { hashString, mulberry32 } from "./rng";
import { leaf, nodeAt, setRatioAt, split, treeKind } from "./tree";

/**
 * Generatore di layout dinamici.
 *
 * Dato un elenco ORDINATO di foto (proporzioni) e un rettangolo, produce un elenco ordinato di layout candidati
 * (alberi di divisioni) che rispettano l'ordine di lettura. Il punteggio misura quanto ogni foto dovrebbe essere
 * ritagliata (o lasciata vuota) nella sua cella; più basso è meglio. Il risultato è deterministico.
 */

export interface LayoutPhoto {
  id: string;
  /** Larghezza / altezza della foto così come appare nel foglio. */
  aspect: number;
}

export interface GenerateOptions {
  /** Area utile in cui disporre le foto (millimetri). */
  rect: Rect;
  gapMm: number;
  /** Numero massimo di candidati restituiti (default 24). */
  limit?: number;
  /** Modalità veloce per le stime nei calcoli di Auto Build: meno candidati, nessun raffinamento. */
  fast?: boolean;
}

export interface LayoutCandidate {
  tree: LayoutNode;
  /** Più basso è meglio. */
  score: number;
  /** Perdita media di ritaglio (0 = nessuna, 1 = tutta). */
  cropLoss: number;
  /** Struttura (direzioni) del layout, per variare il ritmo dell'album. */
  kind: string;
}

interface Built {
  node: LayoutNode;
  /** Proporzione naturale (larghezza/altezza) del sottoalbero. */
  aspect: number;
}

const FULL_ENUMERATION_LIMIT = 7;
const PRUNE_SHARE = 0.12;
const DIVERSITY_DISTANCE = 0.045;
const VARIANT_TOLERANCE = 0.45;
/** Un candidato è accettabile se non peggiora troppo rispetto al migliore. */
const acceptableScore = (best: number) => Math.max(best * 2.2, best + 0.5);

export const MAX_AREA_PHOTOS = 12;

const clampAspect = (aspect: number) => (Number.isFinite(aspect) && aspect > 0.05 ? Math.min(aspect, 20) : 1);

/** Quota naturale del primo figlio, così che entrambi mantengano le proporzioni delle proprie foto. */
function naturalShare(dir: "row" | "column", a: number, b: number): number {
  return dir === "row" ? a / (a + b) : b / (a + b);
}

function combine(dir: "row" | "column", a: Built, b: Built, force = false): Built | null {
  const share = naturalShare(dir, a.aspect, b.aspect);
  if (!force && (share < PRUNE_SHARE || share > 1 - PRUNE_SHARE)) return null;
  const aspect = dir === "row" ? a.aspect + b.aspect : 1 / (1 / a.aspect + 1 / b.aspect);
  return { node: split(dir, share, a.node, b.node), aspect };
}

/** Frazione di foto non visibile (o di cella non coperta) quando la foto sta in una cella di proporzione diversa. */
export function cropFraction(cellAspect: number, photoAspect: number): number {
  const c = Math.max(cellAspect, 0.01);
  const p = Math.max(photoAspect, 0.01);
  return 1 - Math.min(c / p, p / c);
}

export function scoreCells(cells: readonly LeafCell[], aspects: ReadonlyMap<string, number>): { score: number; cropLoss: number } {
  if (cells.length === 0) return { score: 0, cropLoss: 0 };
  const totalArea = cells.reduce((sum, cell) => sum + Math.max(cell.rect.w, 0) * Math.max(cell.rect.h, 0), 0) || 1;
  let lossSum = 0;
  let penalty = 0;
  for (const cell of cells) {
    const cellAspect = cell.rect.w / Math.max(cell.rect.h, 0.001);
    const loss = cropFraction(cellAspect, aspects.get(cell.itemId) ?? 1);
    lossSum += loss;
    if (loss > 0.3) penalty += (loss - 0.3) * 2;
    if (cellAspect > 3.2 || cellAspect < 0.3) penalty += 0.25;
    const share = (cell.rect.w * cell.rect.h) / totalArea;
    if (cells.length > 1 && share < Math.min(0.05, 0.45 / cells.length)) penalty += 0.35;
  }
  const cropLoss = lossSum / cells.length;
  return { score: cropLoss + penalty, cropLoss };
}

export function scoreTree(tree: LayoutNode, aspects: ReadonlyMap<string, number>, rect: Rect, gapMm: number): { score: number; cropLoss: number } {
  return scoreCells(layoutCells(tree, rect, gapMm).cells, aspects);
}

// ---------------------------------------------------------------------------
// Enumerazione completa (fino a FULL_ENUMERATION_LIMIT foto)
// ---------------------------------------------------------------------------

function enumerateTrees(photos: readonly LayoutPhoto[]): Built[] {
  const n = photos.length;
  const memo = new Map<number, Built[]>();
  const trees = (i: number, j: number): Built[] => {
    const key = i * (n + 1) + j;
    const cached = memo.get(key);
    if (cached) return cached;
    let result: Built[];
    if (i === j) result = [{ node: leaf(photos[i].id), aspect: clampAspect(photos[i].aspect) }];
    else {
      result = [];
      for (let k = i; k < j; k += 1) {
        for (const a of trees(i, k)) {
          for (const b of trees(k + 1, j)) {
            for (const dir of ["row", "column"] as const) {
              const built = combine(dir, a, b);
              if (built) result.push(built);
            }
          }
        }
      }
    }
    memo.set(key, result);
    return result;
  };
  return trees(0, n - 1);
}

// ---------------------------------------------------------------------------
// Campionamento e forme strutturate (oltre FULL_ENUMERATION_LIMIT foto)
// ---------------------------------------------------------------------------

function randomTree(photos: readonly LayoutPhoto[], i: number, j: number, target: number, rng: () => number): Built {
  if (i === j) return { node: leaf(photos[i].id), aspect: clampAspect(photos[i].aspect) };
  const count = j - i + 1;
  const middle = i + Math.floor((count - 1) / 2);
  const k = rng() < 0.55 ? Math.min(j - 1, Math.max(i, middle + (rng() < 0.5 ? 0 : 1))) : i + Math.floor(rng() * (j - i));
  const preferRow = target > 1.15 ? 0.65 : target < 0.87 ? 0.35 : 0.5;
  const dir: "row" | "column" = rng() < preferRow ? "row" : "column";
  const childTarget = dir === "row" ? target / 2 : target * 2;
  const a = randomTree(photos, i, k, childTarget, rng);
  const b = randomTree(photos, k + 1, j, dir === "row" ? target / 2 : target * 2, rng);
  return combine(dir, a, b, true)!;
}

/** Righe (o colonne) di foto consecutive con larghezza naturale bilanciata. */
function structuredTrees(photos: readonly LayoutPhoto[]): Built[] {
  const n = photos.length;
  const result: Built[] = [];
  const leaves = photos.map((photo): Built => ({ node: leaf(photo.id), aspect: clampAspect(photo.aspect) }));
  const chain = (items: Built[], dir: "row" | "column"): Built => items.slice(1).reduce((acc, item) => combine(dir, acc, item, true)!, items[0]);
  for (const outer of ["column", "row"] as const) {
    const inner = outer === "column" ? "row" : "column";
    for (let groups = 1; groups <= Math.min(5, n); groups += 1) {
      const totalExtent = leaves.reduce((sum, item) => sum + (inner === "row" ? item.aspect : 1 / item.aspect), 0);
      const target = totalExtent / groups;
      const buckets: Built[][] = [[]];
      let acc = 0;
      for (const item of leaves) {
        const extent = inner === "row" ? item.aspect : 1 / item.aspect;
        if (buckets[buckets.length - 1].length > 0 && acc + extent / 2 > target * buckets.length && buckets.length < groups) buckets.push([]);
        buckets[buckets.length - 1].push(item);
        acc += extent;
      }
      result.push(chain(buckets.filter((bucket) => bucket.length > 0).map((bucket) => chain(bucket, inner)), outer));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Selezione
// ---------------------------------------------------------------------------

function signatureOf(cells: readonly LeafCell[], rect: Rect): string {
  const w = Math.max(rect.w, 0.001);
  const h = Math.max(rect.h, 0.001);
  return cells.map((cell) => `${Math.round(((cell.rect.x - rect.x) / w) * 50)},${Math.round(((cell.rect.y - rect.y) / h) * 50)},${Math.round((cell.rect.w / w) * 50)},${Math.round((cell.rect.h / h) * 50)}`).join(";");
}

/** Distanza massima (frazione dell'area) tra i bordi corrispondenti delle celle di due layout. */
function cellDistance(a: readonly LeafCell[], b: readonly LeafCell[], rect: Rect): number {
  let max = 0;
  const w = Math.max(rect.w, 0.001);
  const h = Math.max(rect.h, 0.001);
  for (let index = 0; index < a.length; index += 1) {
    const p = a[index].rect;
    const q = b[index].rect;
    max = Math.max(max, Math.abs(p.x - q.x) / w, Math.abs(p.y - q.y) / h, Math.abs(p.x + p.w - q.x - q.w) / w, Math.abs(p.y + p.h - q.y - q.h) / h);
  }
  return max;
}

interface Scored {
  tree: LayoutNode;
  score: number;
  cropLoss: number;
  cells: LeafCell[];
  signature: string;
}

function refineTree(tree: LayoutNode, aspects: ReadonlyMap<string, number>, rect: Rect, gap: number): LayoutNode {
  let current = tree;
  let best = scoreTree(current, aspects, rect, gap).score;
  const paths: string[] = [];
  const collect = (node: LayoutNode, path: string) => {
    if (node.kind === "split") { paths.push(path); collect(node.first, `${path}0`); collect(node.second, `${path}1`); }
  };
  collect(current, "");
  for (let pass = 0; pass < 2; pass += 1) {
    let improved = false;
    for (const path of paths) {
      const node = nodeAt(current, path);
      if (!node || node.kind !== "split") continue;
      for (const delta of [-0.12, -0.06, -0.025, 0.025, 0.06, 0.12]) {
        const ratio = clampRatio(node.ratio + delta);
        if (Math.abs(ratio - node.ratio) < 1e-6) continue;
        const candidate = setRatioAt(current, path, ratio);
        const score = scoreTree(candidate, aspects, rect, gap).score;
        if (score < best - 1e-9) { best = score; current = candidate; improved = true; break; }
      }
    }
    if (!improved) break;
  }
  return current;
}

/** Genera i layout candidati per un elenco ordinato di foto, dal migliore al peggiore. */
export function generateLayouts(photos: readonly LayoutPhoto[], options: GenerateOptions): LayoutCandidate[] {
  const n = photos.length;
  if (n === 0) return [];
  const { rect, gapMm } = options;
  const limit = Math.max(1, options.limit ?? 24);
  const fast = Boolean(options.fast);
  const aspects = new Map(photos.map((photo) => [photo.id, clampAspect(photo.aspect)]));

  if (n === 1) {
    const tree = leaf(photos[0].id);
    const { score, cropLoss } = scoreTree(tree, aspects, rect, gapMm);
    return [{ tree, score, cropLoss, kind: "o" }];
  }
  if (rect.w < 4 || rect.h < 4) {
    const built = structuredTrees(photos)[0];
    return [{ tree: built.node, score: 1, cropLoss: 1, kind: treeKind(built.node) }];
  }

  const pool: Built[] = [];
  if (n <= (fast ? 5 : FULL_ENUMERATION_LIMIT)) pool.push(...enumerateTrees(photos));
  else {
    pool.push(...structuredTrees(photos));
    const rng = mulberry32(hashString(`${n}|${photos.map((photo) => Math.round(photo.aspect * 20)).join(",")}`));
    const target = rect.w / rect.h;
    const samples = fast ? 80 : 2500;
    for (let index = 0; index < samples; index += 1) pool.push(randomTree(photos, 0, n - 1, target, rng));
  }

  const scoreAll = (trees: LayoutNode[]): Scored[] => {
    const seen = new Set<string>();
    const out: Scored[] = [];
    for (const tree of trees) {
      const { cells } = layoutCells(tree, rect, gapMm);
      const signature = signatureOf(cells, rect);
      if (seen.has(signature)) continue;
      seen.add(signature);
      const { score, cropLoss } = scoreCells(cells, aspects);
      out.push({ tree, score, cropLoss, cells, signature });
    }
    out.sort((a, b) => a.score - b.score || (a.signature < b.signature ? -1 : 1));
    return out;
  };

  let scored = scoreAll(pool.map((built) => built.node));

  if (!fast) {
    const refineCount = Math.min(scored.length, 60);
    const refined = scored.slice(0, refineCount).map((entry) => refineTree(entry.tree, aspects, rect, gapMm));
    scored = scoreAll([...refined, ...scored.slice(refineCount).map((entry) => entry.tree)]);
  }

  const picked: Scored[] = [];
  const accept = (entry: Scored) => {
    if (picked.every((other) => cellDistance(other.cells, entry.cells, rect) >= DIVERSITY_DISTANCE)) picked.push(entry);
  };
  for (const entry of scored) {
    if (picked.length >= limit) break;
    accept(entry);
  }

  // Niente layout assurdi: scarta ciò che ritaglia molto più del migliore.
  if (picked.length > 1) {
    const threshold = acceptableScore(picked[0].score);
    for (let index = picked.length - 1; index > 0; index -= 1) if (picked[index].score > threshold) picked.splice(index, 1);
  }

  // Poche forme possibili (2-3 foto): aggiunge varianti con rapporti diversi, per avere vera scelta con Shuffle.
  if (!fast && picked.length < Math.min(limit, 12) && picked.length > 0) {
    const bestScore = picked[0].score;
    const variants: LayoutNode[] = [];
    for (const entry of picked.slice(0, 6)) {
      const paths: string[] = [];
      const collect = (node: LayoutNode, path: string) => {
        if (node.kind === "split") { paths.push(path); collect(node.first, `${path}0`); collect(node.second, `${path}1`); }
      };
      collect(entry.tree, "");
      for (const path of paths) for (const ratio of [0.28, 0.36, 0.64, 0.72]) variants.push(setRatioAt(entry.tree, path, ratio));
    }
    for (const entry of scoreAll(variants)) {
      if (picked.length >= Math.min(limit, 12)) break;
      if (entry.score <= Math.min(bestScore + VARIANT_TOLERANCE, acceptableScore(bestScore))) accept(entry);
    }
  }

  picked.sort((a, b) => a.score - b.score || (a.signature < b.signature ? -1 : 1));
  return picked.map((entry) => ({ tree: entry.tree, score: entry.score, cropLoss: entry.cropLoss, kind: treeKind(entry.tree) }));
}

// ---------------------------------------------------------------------------
// Cache (le stesse foto e lo stesso rettangolo danno sempre la stessa lista)
// ---------------------------------------------------------------------------

const CACHE_LIMIT = 400;
const cache = new Map<string, LayoutCandidate[]>();

function cacheKey(photos: readonly LayoutPhoto[], options: GenerateOptions): string {
  const { rect } = options;
  return [
    photos.map((photo) => `${photo.id}:${photo.aspect.toFixed(4)}`).join(","),
    `${rect.w.toFixed(1)}x${rect.h.toFixed(1)}`,
    options.gapMm.toFixed(2),
    options.limit ?? 24,
    options.fast ? "f" : "",
  ].join("|");
}

export function generateLayoutsCached(photos: readonly LayoutPhoto[], options: GenerateOptions): LayoutCandidate[] {
  const key = cacheKey(photos, options);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const result = generateLayouts(photos, options);
  cache.set(key, result);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return result;
}

export function clearLayoutCache(): void {
  cache.clear();
}

/** Costo stimato (più basso è meglio) di disporre queste proporzioni in un'area: serve a Auto Build per scegliere i gruppi. */
const costCache = new Map<string, number>();
export function estimateCost(aspects: readonly number[], rect: Rect, gapMm: number): number {
  const key = `${aspects.map((a) => Math.round(Math.log(clampAspect(a)) / Math.log(1.1))).join(",")}|${Math.round(rect.w / 5)}x${Math.round(rect.h / 5)}|${gapMm.toFixed(1)}`;
  const hit = costCache.get(key);
  if (hit !== undefined) return hit;
  const photos = aspects.map((aspect, index) => ({ id: String(index), aspect }));
  const best = generateLayouts(photos, { rect, gapMm, limit: 1, fast: true })[0];
  const cost = best ? best.score : 1;
  costCache.set(key, cost);
  if (costCache.size > 5000) costCache.delete(costCache.keys().next().value as string);
  return cost;
}

export { MIN_RATIO };
