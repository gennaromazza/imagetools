import type { AlbumArea, AlbumAssetV2, AlbumItem, AlbumProjectV2, AlbumSpread, AreaStyle, LayoutNode, SheetSpec } from "@photo-tools/shared-types";
import { MAX_RATIO, MIN_RATIO, alignFactor, areaOuterRects, freeCells, insetRect, layoutCells, type Divider, type LeafCell, type RatioOverrides, type Rect } from "../engine/geometry";
import type { LayoutPhoto } from "../engine/generate";
import { leafIds, removeLeaf, naturalRatios, pathOfLeaf, setRatioAt, type NaturalOptions } from "../engine/tree";
import { DEFAULT_AREA_STYLE, DEFAULT_SHEET } from "./defaults";
import { newId } from "./ids";

export type Project = AlbumProjectV2;

export const nowIso = () => new Date().toISOString();

/** Rinnova la data di modifica senza altre differenze. */
export function touch(project: Project): Project {
  return { ...project, updatedAt: nowIso() };
}

export function createEmptyProject(name = "Nuovo album", sheet: SheetSpec = DEFAULT_SHEET, style: AreaStyle = DEFAULT_AREA_STYLE): Project {
  const now = nowIso();
  return {
    schemaVersion: 2,
    projectId: newId("album"),
    projectName: name.trim() || "Nuovo album",
    sourceFolderPath: "",
    createdAt: now,
    updatedAt: now,
    stage: "pending",
    assets: [],
    labels: [],
    chapters: [],
    spreads: [],
    favoriteLayouts: [],
    settings: { sheet: { ...sheet }, sortKey: "capture-time", defaultStyle: { ...style } },
  };
}

// ---------------------------------------------------------------------------
// Foto
// ---------------------------------------------------------------------------

export function assetMap(project: Project): Map<string, AlbumAssetV2> {
  return new Map(project.assets.map((asset) => [asset.id, asset]));
}

export const isQuarterTurn = (asset: Pick<AlbumAssetV2, "rotationDegrees">) => asset.rotationDegrees === 90 || asset.rotationDegrees === 270;

/** Proporzione (larghezza / altezza) della foto come appare nel foglio, rotazione dell'utente inclusa. */
export function itemAspect(asset: AlbumAssetV2 | undefined): number {
  if (!asset) return 1;
  const base = asset.aspectRatio > 0 ? asset.aspectRatio : asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 1;
  const safe = Number.isFinite(base) && base > 0 ? base : 1;
  return isQuarterTurn(asset) ? 1 / safe : safe;
}

/** Proporzioni con cui una foto conta per i layout: la forma scelta per la foto, altrimenti quelle dell'originale. */
export function effectiveAspect(item: Pick<AlbumItem, "shape">, asset: AlbumAssetV2 | undefined): number {
  return item.shape && item.shape > 0 ? item.shape : itemAspect(asset);
}

// ---------------------------------------------------------------------------
// Aree e spread
// ---------------------------------------------------------------------------

export function createArea(style: AreaStyle): AlbumArea {
  return { id: newId("area"), style: { ...style }, layout: null, items: [], seed: 0 };
}

export function createItem(assetId: string): AlbumItem {
  return { id: newId("it"), assetId, zoom: 1, cx: 0.5, cy: 0.5 };
}

/** Rende coerenti albero e foto: l'ordine delle foto segue le foglie, le foglie senza foto spariscono. */
/** L'area usa una disposizione libera: ogni foto ha la sua cornice. */
export function hasFreeLayout(area: AlbumArea): boolean {
  return Boolean(area.free) && area.items.length > 0 && area.items.every((item) => area.free![item.id] !== undefined);
}

/** Toglie le cornici che non servono più; se a una foto manca la cornice la disposizione libera decade (resta l'albero). */
function cleanFree(area: AlbumArea): AlbumArea {
  if (!("free" in area)) return area;
  if (!area.free || area.items.length === 0 || !area.items.every((item) => area.free![item.id] !== undefined)) {
    const { free: _free, ...rest } = area;
    return rest;
  }
  const ids = new Set(area.items.map((item) => item.id));
  const keys = Object.keys(area.free);
  if (keys.every((key) => ids.has(key))) return area;
  return { ...area, free: Object.fromEntries(keys.filter((key) => ids.has(key)).map((key) => [key, area.free![key]])) };
}

export function normalizeArea(area: AlbumArea): AlbumArea {
  return cleanFree(normalizeTree(area));
}

function normalizeTree(area: AlbumArea): AlbumArea {
  if (!area.layout) return area.items.length === 0 ? area : { ...area, items: [] };
  const byId = new Map(area.items.map((item) => [item.id, item]));
  let layout = area.layout;
  for (const id of leafIds(layout)) if (!byId.has(id)) layout = removeLeaf(layout, id) as typeof layout;
  if (!layout) return { ...area, layout: null, items: [] };
  const items = leafIds(layout).map((id) => byId.get(id)!);
  const same = layout === area.layout && items.length === area.items.length && items.every((item, index) => item === area.items[index]);
  return same ? area : { ...area, layout, items };
}

export function areasForSplit(split: AlbumSpread["split"]): number {
  return split === "full" ? 1 : 2;
}

export function createSpread(project: Project, split: AlbumSpread["split"] = "half"): AlbumSpread {
  const style = project.settings.defaultStyle;
  return {
    id: newId("spread"),
    split,
    linked: false,
    areas: Array.from({ length: areasForSplit(split) }, () => createArea(style)),
  };
}

export function findSpread(project: Project, spreadId: string): { spread: AlbumSpread; index: number } | null {
  const index = project.spreads.findIndex((spread) => spread.id === spreadId);
  return index < 0 ? null : { spread: project.spreads[index], index };
}

export interface ItemLocation {
  spread: AlbumSpread;
  spreadIndex: number;
  area: AlbumArea;
  areaIndex: number;
  item: AlbumItem;
}

export function findItem(project: Project, itemId: string): ItemLocation | null {
  for (let spreadIndex = 0; spreadIndex < project.spreads.length; spreadIndex += 1) {
    const spread = project.spreads[spreadIndex];
    for (let areaIndex = 0; areaIndex < spread.areas.length; areaIndex += 1) {
      const area = spread.areas[areaIndex];
      const item = area.items.find((candidate) => candidate.id === itemId);
      if (item) return { spread, spreadIndex, area, areaIndex, item };
    }
  }
  return null;
}

/** Sostituisce uno spread; restituisce lo stesso progetto se la funzione non lo cambia. */
export function mapSpread(project: Project, spreadId: string, fn: (spread: AlbumSpread) => AlbumSpread): Project {
  let changed = false;
  const spreads = project.spreads.map((spread) => {
    if (spread.id !== spreadId) return spread;
    const next = fn(spread);
    if (next !== spread) changed = true;
    return next;
  });
  return changed ? touch({ ...project, spreads }) : project;
}

export function replaceArea(spread: AlbumSpread, areaIndex: number, area: AlbumArea): AlbumSpread {
  if (spread.areas[areaIndex] === area) return spread;
  return { ...spread, areas: spread.areas.map((candidate, index) => (index === areaIndex ? area : candidate)) };
}

// ---------------------------------------------------------------------------
// Geometria di un'area
// ---------------------------------------------------------------------------

export interface AreaGeometry {
  outer: Rect;
  inner: Rect;
  gapMm: number;
  cells: LeafCell[];
  dividers: Divider[];
}

/** Geometria di un'area a partire dal solo formato: serve ai componenti che non hanno l'intero progetto. */
export function areaGeometryFor(sheet: SheetSpec, spread: AlbumSpread, areaIndex: number, overrides?: RatioOverrides): AreaGeometry {
  const outer = areaOuterRects(sheet, spread.split)[areaIndex] ?? areaOuterRects(sheet, "full")[0];
  const area = spread.areas[areaIndex];
  const inner = insetRect(outer, area.style.paddingCm * 10);
  const gapMm = Math.max(0, area.style.gapCm * 10);
  if (hasFreeLayout(area)) return { outer, inner, gapMm, cells: freeCells(area.items.map((item) => ({ itemId: item.id, frame: area.free![item.id] })), inner), dividers: [] };
  const { cells: raw, dividers } = layoutCells(area.layout, inner, gapMm, overrides, alignFactor(area.style.align));
  const cells = isWindowedArea(area, raw) ? raw.map((cell) => ({ ...cell, windowed: true })) : raw;
  return { outer, inner, gapMm, cells, dividers };
}

export function areaGeometry(project: Project, spread: AlbumSpread, areaIndex: number, overrides?: RatioOverrides): AreaGeometry {
  return areaGeometryFor(project.settings.sheet, spread, areaIndex, overrides);
}

export function spreadGeometry(project: Project, spread: AlbumSpread, overrides?: Record<number, RatioOverrides>): AreaGeometry[] {
  return spread.areas.map((_, index) => areaGeometry(project, spread, index, overrides?.[index]));
}

/** Foto di un'area, nell'ordine di lettura, con le proporzioni per il generatore di layout. */
export function areaPhotos(project: Project, area: AlbumArea): LayoutPhoto[] {
  const assets = assetMap(project);
  return area.items.map((item) => ({ id: item.id, aspect: effectiveAspect(item, assets.get(item.assetId)) }));
}

/** Tutte le foto (assetId) usate nello spread, con il numero di comparse. */
export function spreadAssetIds(spread: AlbumSpread): string[] {
  return spread.areas.flatMap((area) => area.items.map((item) => item.assetId));
}

export function countItems(project: Project): number {
  return project.spreads.reduce((total, spread) => total + spread.areas.reduce((sum, area) => sum + area.items.length, 0), 0);
}

/** Le celle seguono le proporzioni delle foto: in «foto intera», oppure in «riempi» quando una foto ha una forma scelta (così la sua cella ha quella forma). */
export function needsShapeAlignment(area: AlbumArea): boolean {
  return area.style.mode === "fit" || area.items.some((item) => Boolean(item.shape));
}

/**
 * Stile con cui le foto dell'area stanno nelle celle. Se una foto ha una forma scelta, l'area funziona come «foto intera» anche in «riempi»:
 * le foto sono finestre esatte e allineate tra loro (le celle seguono le proporzioni), invece di una finestra più piccola accanto a foto che
 * riempiono tutta la cella, che non risulterebbero a filo.
 */
export function placementStyle(area: AlbumArea, cell?: { windowed?: boolean }): AreaStyle {
  if (area.style.mode !== "fill" || hasFreeLayout(area)) return area.style;
  // Con la cella (o l'area) segnata «a finestre» le foto sono finestre esatte; senza indicazione si assume che con una forma scelta lo siano.
  const windowed = cell ? Boolean(cell.windowed) : area.items.some((item) => Boolean(item.shape));
  return windowed ? { ...area.style, mode: "fit" } : area.style;
}

/**
 * In «riempi» con forme scelte: se la cella di ogni foto con forma ha già quella proporzione (al netto del bordo), le altre foto riempiono le loro
 * celle e la pagina resta piena. Se una forma non è raggiungibile con questa disposizione, l'area funziona come «foto intera» (finestre esatte
 * e allineate): vero quando almeno una cella con forma non ha la sua proporzione.
 */
export function isWindowedArea(area: Pick<AlbumArea, "style" | "items">, cells: readonly LeafCell[]): boolean {
  if (area.style.mode !== "fill") return false;
  return area.items.some((item) => {
    if (!item.shape) return false;
    const cell = cells.find((candidate) => candidate.itemId === item.id);
    if (!cell) return false;
    const border = Math.max(0, Math.min((item.borderCm ?? area.style.borderCm) * 10, Math.min(cell.rect.w, cell.rect.h) / 4));
    const h = cell.rect.h - border * 2;
    return !(h > 0.01) || Math.abs((cell.rect.w - border * 2) / h / item.shape - 1) >= 0.002;
  });
}

/** Bordo e allineamento che entrano nel calcolo dei rapporti «naturali» di un'area. */
export function naturalOptions(area: { style: AreaStyle; items: readonly Pick<AlbumItem, "id" | "borderCm">[] }): NaturalOptions {
  const border = new Map(area.items.map((item) => [item.id, Math.max(0, (item.borderCm ?? area.style.borderCm) * 10)]));
  return { borderMmOf: (id) => border.get(id) ?? Math.max(0, area.style.borderCm * 10), align: alignFactor(area.style.align) };
}

/**
 * Regola i rapporti delle divisioni perché la cella di ogni foto con una forma scelta abbia esattamente quella proporzione
 * (al netto del bordo): si prova prima la divisione più vicina alla foto, poi quelle più in alto. Restituisce il nuovo albero
 * (lo stesso se non cambia nulla) oppure `null` se una forma non è raggiungibile con questa disposizione.
 */
export function fitShapedCells(area: AlbumArea, inner: { w: number; h: number }, gapMm: number): LayoutNode | null {
  if (!area.layout) return null;
  const shapedItems = area.items.filter((item) => item.shape);
  if (shapedItems.length === 0) return null;
  const size: Rect = { x: 0, y: 0, w: inner.w, h: inner.h };
  let tree: LayoutNode = area.layout;
  for (const item of shapedItems) {
    const shape = item.shape!;
    const borderOf = (rect: Rect) => Math.max(0, Math.min((item.borderCm ?? area.style.borderCm) * 10, Math.min(rect.w, rect.h) / 4));
    const aspectIn = (candidate: LayoutNode): number | null => {
      const rect = layoutCells(candidate, size, gapMm).cells.find((cell) => cell.itemId === item.id)?.rect;
      if (!rect) return null;
      const border = borderOf(rect);
      const h = rect.h - border * 2;
      return h > 0.01 ? (rect.w - border * 2) / h : null;
    };
    const reached = (candidate: LayoutNode) => { const aspect = aspectIn(candidate); return aspect !== null && Math.abs(aspect / shape - 1) < 0.002; };
    if (reached(tree)) continue;
    const path = pathOfLeaf(tree, item.id);
    if (path === null) return null;
    let work = tree;
    let done = false;
    for (let depth = path.length - 1; depth >= 0 && !done; depth -= 1) {
      const prefix = path.slice(0, depth);
      const at = (ratio: number) => setRatioAt(work, prefix, ratio);
      const gap = (candidate: LayoutNode) => (aspectIn(candidate) ?? shape) - shape;
      const low = gap(at(MIN_RATIO));
      const high = gap(at(MAX_RATIO));
      if (low * high > 0) { work = at(Math.abs(low) < Math.abs(high) ? MIN_RATIO : MAX_RATIO); continue; }
      let lo = MIN_RATIO;
      let hi = MAX_RATIO;
      for (let step = 0; step < 40; step += 1) {
        const mid = (lo + hi) / 2;
        const value = gap(at(mid));
        // la larghezza della cella cresce con il rapporto di una divisione in riga e cala in una in colonna; si segue il segno agli estremi
        if ((value < 0) === (low < 0)) lo = mid; else hi = mid;
      }
      work = at(Number(((lo + hi) / 2).toFixed(6)));
      done = reached(work);
    }
    if (!done) return null;
    tree = work;
  }
  return tree;
}

/**
 * Regola di impaginazione: con «foto intera» le foto devono risultare allineate (stessa altezza in una riga, stessa larghezza
 * in una colonna), anche con bordo, spazio tra le foto e allineamento scelti. L'area si regola sulle proporzioni reali delle foto;
 * le aree libere, quelle con il layout bloccato e il modo «riempi» (senza forme) non cambiano.
 */
export function alignedForFit(project: Project, area: AlbumArea, inner: { w: number; h: number }, gapMm: number, fitShapes = true): AlbumArea {
  if (!needsShapeAlignment(area) || !area.layout || area.items.length < 2 || hasFreeLayout(area) || area.locked) return area;
  // «Riempi» con foto di forma scelta: le foto con forma prendono esattamente la loro proporzione e le altre riempiono lo spazio
  // ritagliandosi, così i bordi restano allineati e non avanzano fasce bianche (come nei programmi di impaginazione).
  // (non quando si sta solo passando da «foto intera» a «riempi»: con un clic la disposizione non deve cambiare)
  if (fitShapes && area.style.mode !== "fit") {
    const shaped = fitShapedCells(area, inner, gapMm);
    if (shaped) return shaped === area.layout ? area : { ...area, layout: shaped };
  }
  const assets = assetMap(project);
  const byItem = new Map(area.items.map((item) => [item.id, effectiveAspect(item, assets.get(item.assetId))]));
  const layout = naturalRatios(area.layout, (id) => byItem.get(id) ?? 1.5, inner, gapMm, naturalOptions(area));
  return layout === area.layout ? area : { ...area, layout };
}

/** Dopo un'operazione: le aree in «foto intera» che sono cambiate si riallineano. */
export function alignChanged(before: Project, after: Project): Project {
  if (after === before) return after;
  let changed = false;
  const spreads = after.spreads.map((spread) => {
    const old = before.spreads.find((candidate) => candidate.id === spread.id);
    const areas = spread.areas.map((area, index) => {
      if (old?.areas[index] === area) return area;
      const geometry = areaGeometryFor(after.settings.sheet, spread, index);
      const next = alignedForFit(after, area, geometry.inner, geometry.gapMm, old?.areas[index]?.style.mode === area.style.mode);
      if (next !== area) changed = true;
      return next;
    });
    return areas.some((area, index) => area !== spread.areas[index]) ? { ...spread, areas } : spread;
  });
  return changed ? { ...after, spreads } : after;
}
