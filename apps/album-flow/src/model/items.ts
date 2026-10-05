import type { AlbumArea, AlbumAssetV2, AlbumItem, AlbumSpread, LayoutNode, SheetSpec } from "@photo-tools/shared-types";
import { areaOuterRects, insetRect, layoutCells, type Rect } from "../engine/geometry";
import type { DropTarget } from "../engine/drop";
import { insertAtNode, insertBeside, leaf, naturalRatios, removeLeaf, type InsertSide } from "../engine/tree";
import { MAX_ITEMS_PER_AREA, MAX_SHAPE, MAX_ZOOM, MIN_SHAPE, MIN_ZOOM, clampNumber } from "./defaults";
import { relayoutArea } from "./areas";
import { clampAngle, placeItem } from "./placement";
import { alignChanged, areaGeometry, assetMap, createItem, findItem, effectiveAspect, findSpread, itemAspect, mapSpread, normalizeArea, replaceArea, touch, type Project } from "./project";
import { cropCenter } from "../slot-geometry";
import { addSpread } from "./spreads";

/** Da dove arriva una foto trascinata sullo spread. */
export type DropSource = { kind: "assets"; assetIds: string[] } | { kind: "item"; itemId: string };

const assetExists = (project: Project, assetId: string) => project.assets.some((asset) => asset.id === assetId);

function updateArea(project: Project, spreadId: string, areaIndex: number, fn: (area: AlbumArea, spread: AlbumSpread) => AlbumArea): Project {
  return mapSpread(project, spreadId, (spread) => {
    const area = spread.areas[areaIndex];
    if (!area) return spread;
    const next = fn(area, spread);
    return next === area ? spread : replaceArea(spread, areaIndex, next);
  });
}

/** Quota che resta alla foto già presente quando se ne affianca un'altra, in base alle proporzioni (celle alte uguali o larghe uguali). */
function keepRatio(assets: ReadonlyMap<string, AlbumAssetV2>, existingAssetId: string, newAssetId: string, side: InsertSide): number {
  const a = itemAspect(assets.get(existingAssetId));
  const b = itemAspect(assets.get(newAssetId));
  const natural = side === "left" || side === "right" ? a / (a + b) : b / (a + b);
  return clampNumber(natural, 0.3, 0.7);
}

function capacity(area: AlbumArea): number {
  return Math.max(0, MAX_ITEMS_PER_AREA - area.items.length);
}

/**
 * Aggiunge foto a un'area e ricalcola il layout migliore (Invio, rilascio di più foto, rilascio su un'area vuota).
 * Con `afterItemId` le nuove foto seguono quella nell'ordine di lettura, altrimenti vanno in fondo.
 */
function appendAssetsRaw(project: Project, spreadId: string, areaIndex: number, assetIds: readonly string[], afterItemId?: string): Project {
  const valid = assetIds.filter((id) => assetExists(project, id));
  if (valid.length === 0) return project;
  return updateArea(project, spreadId, areaIndex, (area, spread) => {
    const room = capacity(area);
    if (room === 0) return area;
    const created = valid.slice(0, room).map(createItem);
    const at = afterItemId ? area.items.findIndex((item) => item.id === afterItemId) : -1;
    const items = at >= 0 ? [...area.items.slice(0, at + 1), ...created, ...area.items.slice(at + 1)] : [...area.items, ...created];
    // Layout provvisorio (catena di foglie) per far partire la rigenerazione con le foto nell'ordine giusto.
    const layout = items.slice(1).reduce((acc, item) => ({ kind: "split" as const, dir: "row" as const, ratio: 0.5, first: acc, second: leaf(item.id) }), leaf(items[0].id));
    const probe = replaceArea(spread, areaIndex, { ...area, items, layout });
    return relayoutArea(project, probe, areaIndex, 0);
  });
}

/** Sostituisce la foto di un elemento mantenendo la posizione nel layout. */
function replaceItemAssetRaw(project: Project, itemId: string, assetId: string): Project {
  const found = findItem(project, itemId);
  if (!found || found.item.locked || found.item.assetId === assetId || !assetExists(project, assetId)) return project;
  const spread = found.spread;
  const items = found.area.items.map((item) => (item.id === itemId ? withAngle({ ...item, assetId, zoom: 1, cx: 0.5, cy: 0.5 }, 0, item.shape) : item));
  return mapSpread(project, spread.id, (s) => replaceArea(s, found.areaIndex, { ...found.area, items }));
}

/** Toglie una foto dallo spread (non dal disco né dalla libreria): il layout si richiude attorno al vuoto. */
function removeItemRaw(project: Project, itemId: string): Project {
  const found = findItem(project, itemId);
  if (!found) return project;
  const layout = removeLeaf(found.area.layout, itemId);
  return mapSpread(project, found.spread.id, (spread) =>
    replaceArea(spread, found.areaIndex, normalizeArea({ ...found.area, layout, items: found.area.items.filter((item) => item.id !== itemId) })));
}

function removeItemsRaw(project: Project, itemIds: readonly string[]): Project {
  return itemIds.reduce((current, id) => removeItem(current, id), project);
}

function exchange(a: AlbumItem, b: AlbumItem): [AlbumItem, AlbumItem] {
  return [
    withAngle({ ...a, assetId: b.assetId, zoom: b.zoom, cx: b.cx, cy: b.cy, locked: b.locked }, b.angle, b.shape),
    withAngle({ ...b, assetId: a.assetId, zoom: a.zoom, cx: a.cx, cy: a.cy, locked: a.locked }, a.angle, a.shape),
  ];
}

/** Imposta il raddrizzamento di un elemento; a 0 la chiave sparisce, così i progetti senza inclinazione restano identici. */
function withAngle(item: AlbumItem, angle: number | undefined, shape: number | undefined): AlbumItem {
  const { angle: _previous, shape: _shape, ...rest } = item;
  return { ...rest, ...(angle ? { angle } : {}), ...(shape ? { shape } : {}) };
}

/** Scambia due foto (anche tra aree e spread diversi): ognuna porta con sé inquadratura e blocco. */
function swapItemsRaw(project: Project, itemIdA: string, itemIdB: string): Project {
  if (itemIdA === itemIdB) return project;
  const a = findItem(project, itemIdA);
  const b = findItem(project, itemIdB);
  if (!a || !b || a.item.locked || b.item.locked) return project;
  const [nextA, nextB] = exchange(a.item, b.item);
  const spreads = project.spreads.map((spread) => ({
    ...spread,
    areas: spread.areas.map((area) =>
      area.items.some((item) => item.id === itemIdA || item.id === itemIdB)
        ? { ...area, items: area.items.map((item) => (item.id === itemIdA ? nextA : item.id === itemIdB ? nextB : item)) }
        : area),
  }));
  return touch({ ...project, spreads });
}

/** Mette una foto già presente nel bersaglio indicato (spostamento: sparisce dal posto di partenza). */
function moveItem(project: Project, itemId: string, spreadId: string, target: DropTarget): Project {
  const source = findItem(project, itemId);
  const targetSpread = findSpread(project, spreadId)?.spread;
  if (!source || !targetSpread || source.item.locked) return project;
  const targetArea = targetSpread.areas[target.areaIndex];
  if (!targetArea) return project;
  if (target.itemId === itemId || (target.zone === "center" && target.node === undefined)) return project;
  const sameArea = source.spread.id === spreadId && source.areaIndex === target.areaIndex;
  if (!sameArea && capacity(targetArea) === 0) return project;

  // 1) toglie la foto dall'origine
  const next = removeItem(project, itemId);
  // 2) la reinserisce nel bersaglio mantenendone identità e inquadratura
  const side = target.zone;
  return updateArea(next, spreadId, target.areaIndex, (area) => {
    if (target.zone === "area" || (!target.itemId && target.node === undefined) || !area.layout) {
      return normalizeArea({ ...area, layout: leaf(source.item.id), items: [source.item], seed: 0 });
    }
    if (target.node !== undefined) {
      const layout = insertAtNode(area.layout, target.node, source.item.id, side as InsertSide);
      return normalizeArea({ ...area, layout, items: [...area.items, source.item] });
    }
    if (target.zone === "center") return area;
    const targetItem = area.items.find((item) => item.id === target.itemId);
    if (!targetItem) return area;
    const layout = insertBeside(area.layout, targetItem.id, source.item.id, side as InsertSide, keepRatio(assetMap(project), targetItem.assetId, source.item.assetId, side as InsertSide));
    const items = [...area.items, source.item];
    return normalizeArea({ ...area, layout, items });
  });
}

/** Foto dalla libreria rilasciate lungo il bordo dell'area o tra due foto: la prima si infila accanto al ramo, le altre la seguono. */
function insertAssetsAtNode(project: Project, spreadId: string, target: DropTarget, assetIds: string[]): Project {
  const area = findSpread(project, spreadId)?.spread.areas[target.areaIndex];
  if (!area?.layout || target.node === undefined || target.zone === "area" || target.zone === "center") return project;
  const side = target.zone;
  const room = capacity(area);
  if (room === 0) return project;
  let layout = area.layout;
  const created: AlbumItem[] = [];
  for (const assetId of assetIds.slice(0, room)) {
    const item = createItem(assetId);
    const before = layout;
    layout = created.length === 0 ? insertAtNode(layout, target.node, item.id, side) : insertBeside(layout, created[created.length - 1].id, item.id, side, 0.5);
    if (layout === before) return project;
    created.push(item);
  }
  return updateArea(project, spreadId, target.areaIndex, (current) => normalizeArea({ ...current, layout, items: [...current.items, ...created] }));
}

/**
 * Rilascio di foto sullo spread, secondo la zona (vedi AF-002, sezione Gesti):
 * centro = sostituisce (dalla libreria) o scambia (da un'altra foto); bordo = inserisce accanto; area vuota = aggiunge.
 */
function dropOnSpreadRaw(project: Project, spreadId: string, target: DropTarget, source: DropSource): Project {
  const found = findSpread(project, spreadId);
  const area = found?.spread.areas[target.areaIndex];
  if (!found || !area) return project;

  if (source.kind === "item") {
    if (target.zone === "center" && target.itemId) return swapItems(project, source.itemId, target.itemId);
    return moveItem(project, source.itemId, spreadId, target);
  }

  const assetIds = source.assetIds.filter((id) => assetExists(project, id));
  if (assetIds.length === 0) return project;

  if (target.zone === "area" || (!target.itemId && target.node === undefined) || !area.layout) return appendAssets(project, spreadId, target.areaIndex, assetIds);

  if (target.node !== undefined) return insertAssetsAtNode(project, spreadId, target, assetIds);

  if (target.zone === "center" && target.itemId) {
    const replaced = replaceItemAsset(project, target.itemId, assetIds[0]);
    return assetIds.length > 1 ? appendAssets(replaced, spreadId, target.areaIndex, assetIds.slice(1), target.itemId) : replaced;
  }

  if (target.zone === "center" || !target.itemId) return project;
  const side = target.zone;
  if (capacity(area) === 0) return project;
  const reverse = side === "left" || side === "top";
  const room = capacity(area);
  const targetItem = area.items.find((item) => item.id === target.itemId);
  if (!targetItem) return project;
  let layout = area.layout;
  const created: AlbumItem[] = [];
  let anchor = targetItem;
  for (const assetId of assetIds.slice(0, room)) {
    const item = createItem(assetId);
    layout = insertBeside(layout, anchor.id, item.id, side, keepRatio(assetMap(project), anchor.assetId, assetId, side));
    created.push(item);
    if (!reverse) anchor = item;
  }
  return updateArea(project, spreadId, target.areaIndex, (current) => normalizeArea({ ...current, layout, items: [...current.items, ...created] }));
}

// ---------------------------------------------------------------------------
// Inquadratura e blocco
// ---------------------------------------------------------------------------

export interface ItemViewChange {
  zoom?: number;
  cx?: number;
  cy?: number;
  /** Raddrizzamento in gradi (-45…45). */
  angle?: number;
  /** Rapporto larghezza/altezza della foto nella cella (0,2…5); `null` la fa tornare alla forma della cella. */
  shape?: number | null;
}

/** Cambia zoom, centro, raddrizzamento e forma di una foto; il centro resta sempre entro i bordi possibili dell'immagine. */
export function setItemView(project: Project, itemId: string, change: ItemViewChange): Project {
  const found = findItem(project, itemId);
  if (!found || found.item.locked) return project;
  const geometry = areaGeometry(project, found.spread, found.areaIndex);
  const cell = geometry.cells.find((candidate) => candidate.itemId === itemId);
  if (!cell) return project;
  const asset = assetMap(project).get(found.item.assetId);
  const angle = clampAngle(change.angle ?? found.item.angle);
  const requested = clampNumber(change.zoom ?? found.item.zoom, MIN_ZOOM, MAX_ZOOM);
  const shape = change.shape === undefined ? found.item.shape : change.shape === null ? undefined : clampNumber(Number(change.shape.toFixed(4)), MIN_SHAPE, MAX_SHAPE);
  const placement = placeItem(cell.rect, found.item, asset, found.area.style, { zoom: requested, cx: change.cx, cy: change.cy, angle, shape: shape ?? null }, cell.anchor);
  const center = cropCenter(placement.crop);
  // Si memorizza lo zoom chiesto: con la foto raddrizzata `placeItem` lo alza da solo quanto basta a coprire gli angoli,
  // e tornando a 0° l'inquadratura di prima ricompare.
  const next = withAngle({ ...found.item, zoom: requested, cx: Number(center.x.toFixed(5)), cy: Number(center.y.toFixed(5)) }, angle, shape);
  if (next.zoom === found.item.zoom && next.cx === found.item.cx && next.cy === found.item.cy && (next.angle ?? 0) === (found.item.angle ?? 0) && next.shape === found.item.shape) return project;
  return mapSpread(project, found.spread.id, (spread) =>
    replaceArea(spread, found.areaIndex, { ...found.area, items: found.area.items.map((item) => (item.id === itemId ? next : item)) }));
}

export function resetItemView(project: Project, itemId: string): Project {
  return setItemView(project, itemId, { zoom: 1, cx: 0.5, cy: 0.5, angle: 0, shape: null });
}

export function toggleItemLock(project: Project, itemId: string): Project {
  const found = findItem(project, itemId);
  if (!found) return project;
  return mapSpread(project, found.spread.id, (spread) =>
    replaceArea(spread, found.areaIndex, { ...found.area, items: found.area.items.map((item) => (item.id === itemId ? { ...item, locked: !item.locked } : item)) }));
}

/**
 * Allinea le foto di un'area: con «Foto intera» decide dove sta la foto nella cella;
 * con «Riempi» ancora il ritaglio all'inizio, al centro o alla fine dell'immagine (le foto bloccate restano come sono).
 */
export function alignArea(project: Project, spreadId: string, areaIndex: number, align: "start" | "center" | "end"): Project {
  const found = findSpread(project, spreadId);
  const area = found?.spread.areas[areaIndex];
  if (!found || !area) return project;
  let next = mapSpread(project, spreadId, (spread) => replaceArea(spread, areaIndex, { ...area, style: { ...area.style, align } }));
  if (area.style.mode === "fill") {
    const target = align === "start" ? 0 : align === "end" ? 1 : 0.5;
    for (const item of area.items) next = setItemView(next, item.id, { cx: target, cy: target });
  }
  return next;
}

/**
 * Crea un nuovo spread in posizione `atIndex` con la foto trascinata: dalla libreria (copia) o da uno spread (spostamento).
 * Restituisce anche l'id del nuovo spread.
 */
export function moveToNewSpread(project: Project, atIndex: number, source: DropSource): { project: Project; spreadId: string | null } {
  const assetIds = source.kind === "assets"
    ? source.assetIds.filter((id) => assetExists(project, id))
    : (() => { const found = findItem(project, source.itemId); return found ? [found.item.assetId] : []; })();
  if (assetIds.length === 0) return { project, spreadId: null };
  const at = Math.max(0, Math.min(atIndex, project.spreads.length));
  const created = addSpread(project, at);
  const spreadId = created.spreads[at]?.id;
  if (!spreadId || created === project) return { project, spreadId: null };
  let next = dropOnSpread(created, spreadId, { areaIndex: 0, itemId: null, zone: "area" }, { kind: "assets", assetIds });
  if (source.kind === "item") next = removeItem(next, source.itemId);
  return { project: alignChanged(project, next), spreadId };
}

/**
 * Aggiunge una foto a un altro spread (rilasciata sulla sua miniatura): va nella pagina vuota o, se sono entrambe piene, in quella con meno foto.
 * Dalla libreria copia, da uno spread sposta. Rilasciata sullo spread da cui parte, non cambia nulla.
 */
function moveToSpreadRaw(project: Project, spreadId: string, source: DropSource): Project {
  const spread = findSpread(project, spreadId)?.spread;
  if (!spread) return project;
  let assetIds: string[];
  if (source.kind === "assets") assetIds = source.assetIds.filter((id) => assetExists(project, id));
  else {
    const found = findItem(project, source.itemId);
    if (!found || spread.areas.some((area) => area.items.some((item) => item.id === source.itemId))) return project;
    assetIds = [found.item.assetId];
  }
  if (assetIds.length === 0) return project;
  const areaIndex = spread.areas.reduce((best, area, index) => (area.items.length < spread.areas[best].items.length ? index : best), 0);
  const area = spread.areas[areaIndex];
  let next = area.items.length === 0
    ? dropOnSpread(project, spreadId, { areaIndex, itemId: null, zone: "area" }, { kind: "assets", assetIds })
    : appendAssets(project, spreadId, areaIndex, assetIds);
  if (next === project) return project;
  if (source.kind === "item") next = removeItem(next, source.itemId);
  return next;
}

/**
 * Rettangolo che la foto trascinata occuperà davvero dopo il rilascio (stesse proporzioni e stessa divisione del rilascio vero),
 * per mostrarlo mentre si trascina. Restituisce null quando non c'è nulla di meglio da mostrare (centro di una foto, spread senza layout).
 */
export function previewDropRect(
  sheet: Pick<SheetSpec, "widthCm" | "heightCm">,
  spread: AlbumSpread,
  assets: ReadonlyMap<string, AlbumAssetV2>,
  target: DropTarget,
  dragged: { assetId: string; itemId?: string },
): Rect | null {
  const area = spread.areas[target.areaIndex];
  const outer = areaOuterRects(sheet, spread.split)[target.areaIndex];
  if (!area || !outer) return null;
  const inner = insetRect(outer, area.style.paddingCm * 10);
  if (target.zone === "area") return inner;
  if (!area.layout || target.zone === "center") return null;
  const TMP = "__anteprima__";
  let layout: LayoutNode | null = area.layout;
  if (dragged.itemId && area.items.some((item) => item.id === dragged.itemId)) {
    if (dragged.itemId === target.itemId) return null;
    layout = removeLeaf(layout, dragged.itemId);
  }
  if (!layout) return inner;
  const side = target.zone;
  if (target.node !== undefined) layout = insertAtNode(layout, target.node, TMP, side);
  else if (target.itemId) {
    const targetItem = area.items.find((item) => item.id === target.itemId);
    if (!targetItem) return null;
    layout = insertBeside(layout, target.itemId, TMP, side, keepRatio(assets, targetItem.assetId, dragged.assetId, side));
  } else return null;
  if (area.style.mode === "fit") {
    // Come nel rilascio vero: con «foto intera» le divisioni si regolano perché le foto risultino allineate.
    const aspects = new Map(area.items.map((item) => [item.id, effectiveAspect(item, assets.get(item.assetId))] as const));
    aspects.set(TMP, itemAspect(assets.get(dragged.assetId)));
    layout = naturalRatios(layout, (id) => aspects.get(id) ?? 1.5, inner, Math.max(0, area.style.gapCm * 10));
  }
  const leaf = layoutCells(layout, inner, Math.max(0, area.style.gapCm * 10)).cells.find((candidate) => candidate.itemId === TMP);
  if (!leaf) return null;
  // «Foto intera»: la foto non riempie la cella, quindi si mostra lo spazio che occuperà davvero (non l'intera cella).
  if (area.style.mode === "fit") return placeItem(leaf.rect, { zoom: 1, cx: 0.5, cy: 0.5 }, assets.get(dragged.assetId), area.style, null, leaf.anchor).content;
  return leaf.rect;
}

// Ogni operazione che cambia foto o disposizione riallinea le aree in «foto intera» (vedi alignedForFit).
const aligned = <Args extends unknown[]>(fn: (project: Project, ...args: Args) => Project) => (project: Project, ...args: Args): Project => alignChanged(project, fn(project, ...args));
export const appendAssets = aligned(appendAssetsRaw);
export const replaceItemAsset = aligned(replaceItemAssetRaw);
export const removeItem = aligned(removeItemRaw);
export const removeItems = aligned(removeItemsRaw);
export const swapItems = aligned(swapItemsRaw);
export const dropOnSpread = aligned(dropOnSpreadRaw);
export const moveToSpread = aligned(moveToSpreadRaw);
