import type { AlbumSplitMode, LayoutNode, SheetSpec } from "@photo-tools/shared-types";

/** Rettangolo in millimetri; origine in alto a sinistra dello spread (abbondanza esclusa). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Quota minima/massima del primo figlio di una divisione: nessuna cella può sparire. */
export const MIN_RATIO = 0.08;
export const MAX_RATIO = 1 - MIN_RATIO;

/** Larghezza dell'area sinistra rispetto all'intero spread. */
export const SPLIT_FRACTION: Record<AlbumSplitMode, number> = { full: 1, half: 1 / 2, third: 1 / 3, "two-thirds": 2 / 3 };
export const SPLIT_MODES: readonly AlbumSplitMode[] = ["full", "half", "third", "two-thirds"];

/** Dove va il blocco di foto «intere» quando avanza spazio: 0 = in alto a sinistra, 0,5 = al centro, 1 = in basso a destra. */
export const alignFactor = (align: string | undefined): number => (align === "start" ? 0 : align === "end" ? 1 : 0.5);

export function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(Math.max(value, MIN_RATIO), MAX_RATIO);
}

/** Lo spread è formato da due pagine affiancate. */
export function spreadSizeMm(sheet: Pick<SheetSpec, "widthCm" | "heightCm">): { width: number; height: number } {
  return { width: sheet.widthCm * 20, height: sheet.heightCm * 10 };
}

/** Rettangoli esterni delle aree di lavoro: una con "full", altrimenti sinistra e destra. */
export function areaOuterRects(sheet: Pick<SheetSpec, "widthCm" | "heightCm">, split: AlbumSplitMode): Rect[] {
  const { width, height } = spreadSizeMm(sheet);
  if (split === "full") return [{ x: 0, y: 0, w: width, h: height }];
  const left = width * SPLIT_FRACTION[split];
  return [
    { x: 0, y: 0, w: left, h: height },
    { x: left, y: 0, w: width - left, h: height },
  ];
}

/** Riduce un rettangolo di `pad` mm per lato, senza mai annullarlo. */
export function insetRect(rect: Rect, padMm: number): Rect {
  const pad = Math.max(0, Math.min(padMm, rect.w / 2 - 0.5, rect.h / 2 - 0.5));
  return { x: rect.x + pad, y: rect.y + pad, w: rect.w - pad * 2, h: rect.h - pad * 2 };
}

export interface LeafCell {
  itemId: string;
  /** Percorso nell'albero: "" è la radice, "0" il primo figlio, "1" il secondo, "01" il secondo del primo… */
  path: string;
  rect: Rect;
  /** Solo per le disposizioni libere: rotazione (gradi) e livello di sovrapposizione. */
  rotation?: number;
  z?: number;
  /** Ancoraggio della foto in «foto intera» (0 = a sinistra/in alto, 1 = a destra/in basso): le foto ai bordi si avvicinano al centro. */
  anchor?: { x: number; y: number };
  /** In «riempi» con forme scelte non raggiungibili: le foto di quest'area sono finestre esatte e allineate (come in «foto intera»). */
  windowed?: boolean;
}

export interface Divider {
  path: string;
  dir: "row" | "column";
  ratio: number;
  /** Rettangolo del nodo che si divide. */
  nodeRect: Rect;
  /** Striscia di separazione (larga quanto lo spazio tra le foto, anche zero). */
  line: Rect;
  /** Lunghezza assegnabile ai due figli lungo la direzione di divisione (esclude lo spazio). */
  span: number;
  /** Coordinata di inizio del nodo lungo la direzione di divisione. */
  start: number;
}

export type RatioOverrides = Readonly<Record<string, number>>;

/** Calcola le celle delle foto e i separatori di un albero dentro un rettangolo. */
export function layoutCells(
  tree: LayoutNode | null,
  rect: Rect,
  gapMm: number,
  overrides?: RatioOverrides,
  /** Per le celle che toccano due bordi opposti: dove sta la foto (vedi `alignFactor`). */
  align = 0.5,
): { cells: LeafCell[]; dividers: Divider[] } {
  const cells: LeafCell[] = [];
  const dividers: Divider[] = [];
  const gap = Math.max(0, gapMm);

  interface Edges { l: boolean; r: boolean; t: boolean; b: boolean }
  const pull = (near: boolean, far: boolean) => (near && !far ? 1 : far && !near ? 0 : near && far ? align : 0.5);
  const visit = (node: LayoutNode, area: Rect, path: string, edges: Edges = { l: true, r: true, t: true, b: true }) => {
    if (node.kind === "leaf") {
      cells.push({ itemId: node.itemId, path, rect: area, anchor: { x: pull(edges.l, edges.r), y: pull(edges.t, edges.b) } });
      return;
    }
    const ratio = clampRatio(overrides?.[path] ?? node.ratio);
    if (node.dir === "row") {
      const span = Math.max(0, area.w - gap);
      const firstW = span * ratio;
      const secondW = span - firstW;
      dividers.push({ path, dir: "row", ratio, nodeRect: area, line: { x: area.x + firstW, y: area.y, w: gap, h: area.h }, span, start: area.x });
      visit(node.first, { x: area.x, y: area.y, w: firstW, h: area.h }, `${path}0`, { ...edges, r: false });
      visit(node.second, { x: area.x + firstW + gap, y: area.y, w: secondW, h: area.h }, `${path}1`, { ...edges, l: false });
    } else {
      const span = Math.max(0, area.h - gap);
      const firstH = span * ratio;
      const secondH = span - firstH;
      dividers.push({ path, dir: "column", ratio, nodeRect: area, line: { x: area.x, y: area.y + firstH, w: area.w, h: gap }, span, start: area.y });
      visit(node.first, { x: area.x, y: area.y, w: area.w, h: firstH }, `${path}0`, { ...edges, b: false });
      visit(node.second, { x: area.x, y: area.y + firstH + gap, w: area.w, h: secondH }, `${path}1`, { ...edges, t: false });
    }
  };

  if (tree) visit(tree, rect, "");
  return { cells, dividers };
}

/** Una cella attraversa la piega centrale dello spread. */
export function crossesFold(rect: Rect, foldX: number, toleranceMm = 0.5): boolean {
  return rect.x < foldX - toleranceMm && rect.x + rect.w > foldX + toleranceMm;
}

export function pointInRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

export function rectCenter(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Celle di una disposizione libera: le cornici (frazioni) diventano rettangoli dentro l'area utile. */
export function freeCells(entries: ReadonlyArray<{ itemId: string; frame: { x: number; y: number; w: number; h: number; rotation: number; z: number } }>, inner: Rect): LeafCell[] {
  return entries.map(({ itemId, frame }) => ({
    itemId,
    path: "",
    rect: { x: inner.x + frame.x * inner.w, y: inner.y + frame.y * inner.h, w: Math.max(0.5, frame.w * inner.w), h: Math.max(0.5, frame.h * inner.h) },
    rotation: frame.rotation,
    z: frame.z,
  }));
}
