import type { AlbumArea, AlbumAssetV2, AlbumItem, AlbumProjectV2, AlbumSpread, AreaStyle, SheetSpec } from "@photo-tools/shared-types";
import { areaOuterRects, freeCells, insetRect, layoutCells, type Divider, type LeafCell, type RatioOverrides, type Rect } from "../engine/geometry";
import type { LayoutPhoto } from "../engine/generate";
import { leafIds, removeLeaf, naturalRatios } from "../engine/tree";
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
  const { cells, dividers } = layoutCells(area.layout, inner, gapMm, overrides);
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

/**
 * Regola di impaginazione: con «foto intera» le foto devono risultare allineate (stessa altezza in una riga, stessa larghezza
 * in una colonna). L'area si regola sulle proporzioni reali delle foto; le aree libere e il modo «riempi» non cambiano.
 */
export function alignedForFit(project: Project, area: AlbumArea, inner: { w: number; h: number }, gapMm: number): AlbumArea {
  if (area.style.mode !== "fit" || !area.layout || area.items.length < 2 || hasFreeLayout(area)) return area;
  const assets = assetMap(project);
  const byItem = new Map(area.items.map((item) => [item.id, effectiveAspect(item, assets.get(item.assetId))]));
  const layout = naturalRatios(area.layout, (id) => byItem.get(id) ?? 1.5, inner, gapMm);
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
      const next = alignedForFit(after, area, geometry.inner, geometry.gapMm);
      if (next !== area) changed = true;
      return next;
    });
    return areas.some((area, index) => area !== spread.areas[index]) ? { ...spread, areas } : spread;
  });
  return changed ? { ...after, spreads } : after;
}
