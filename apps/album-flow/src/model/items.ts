import type { AlbumArea, AlbumAssetV2, AlbumItem, AlbumSpread, LayoutNode, SheetSpec } from "@photo-tools/shared-types";
import { alignFactor, areaOuterRects, insetRect, layoutCells, type Rect } from "../engine/geometry";
import type { DropTarget } from "../engine/drop";
import { insertAtNode, insertBeside, leaf, leafIds, naturalRatios, removeLeaf, renameLeaf, type InsertSide } from "../engine/tree";
import { MAX_ITEMS_PER_AREA, MAX_SHAPE, MAX_SPREADS, MAX_ZOOM, MIN_SHAPE, MIN_ZOOM, STYLE_LIMITS, clampNumber } from "./defaults";
import { relayoutArea } from "./areas";
import { clampAngle, placeItem } from "./placement";
import { alignChanged, alignedForFit, areaGeometry, assetMap, createItem, findItem, effectiveAspect, hasFreeLayout, isWindowedArea, naturalOptions, needsShapeAlignment, findSpread, itemAspect, mapSpread, normalizeArea, placementStyle, replaceArea, touch, type Project } from "./project";
import { withNewFreeFrames } from "./layoutLock";
import { cropCenter, cropForView } from "../slot-geometry";
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
function keepRatio(assets: ReadonlyMap<string, AlbumAssetV2>, existing: Pick<AlbumItem, "assetId" | "shape">, newAssetId: string, side: InsertSide): number {
  const a = effectiveAspect(existing, assets.get(existing.assetId));
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
    // Layout bloccato: non si aggiungono foto (cambierebbe la disposizione protetta).
    if (room === 0 || area.locked) return area;
    const created = valid.slice(0, room).map(createItem);
    const at = afterItemId ? area.items.findIndex((item) => item.id === afterItemId) : -1;
    const items = at >= 0 ? [...area.items.slice(0, at + 1), ...created, ...area.items.slice(at + 1)] : [...area.items, ...created];
    // Layout provvisorio (catena di foglie) per far partire la rigenerazione con le foto nell'ordine giusto.
    const layout = items.slice(1).reduce((acc, item) => ({ kind: "split" as const, dir: "row" as const, ratio: 0.5, first: acc, second: leaf(item.id) }), leaf(items[0].id));
    const probe = replaceArea(spread, areaIndex, { ...area, items, layout });
    const relaid = relayoutArea(project, probe, areaIndex, 0);
    // Pagina libera: le foto già presenti restano dove sono, le nuove arrivano a cascata (prima si azzeravano tutte le posizioni).
    if (!hasFreeLayout(area)) return relaid;
    const assets = assetMap(project);
    const { inner } = areaGeometry(project, probe, areaIndex);
    return normalizeArea(withNewFreeFrames({ ...relaid, free: area.free }, created.map((item) => ({ id: item.id, aspect: itemAspect(assets.get(item.assetId)) })), inner));
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
  // Solo gli spread coinvolti cambiano oggetto: gli altri restano gli stessi e non vengono ridisegnati.
  const involves = (area: AlbumArea) => area.items.some((item) => item.id === itemIdA || item.id === itemIdB);
  const spreads = project.spreads.map((spread) => (spread.areas.some(involves)
    ? {
      ...spread,
      areas: spread.areas.map((area) => (involves(area)
        ? { ...area, items: area.items.map((item) => (item.id === itemIdA ? nextA : item.id === itemIdB ? nextB : item)) }
        : area)),
    }
    : spread));
  return touch({ ...project, spreads });
}

/**
 * Mette una foto già presente nel bersaglio indicato (spostamento: sparisce dal posto di partenza, mantiene identità e inquadratura).
 * L'operazione è «tutto o niente»: prima si costruisce la nuova area di arrivo e si controlla che la foto ci sia davvero, solo dopo la si
 * toglie dal posto di partenza. Così un bersaglio non più valido non può far sparire la foto.
 */
function moveItem(project: Project, itemId: string, spreadId: string, target: DropTarget): Project {
  const source = findItem(project, itemId);
  const targetSpread = findSpread(project, spreadId)?.spread;
  if (!source || !targetSpread || source.item.locked || source.area.locked) return project;
  const targetArea = targetSpread.areas[target.areaIndex];
  if (!targetArea || targetArea.locked) return project;
  if (target.itemId === itemId || (target.zone === "center" && target.node === undefined)) return project;
  const sameArea = source.spread.id === spreadId && source.areaIndex === target.areaIndex;
  if (!sameArea && capacity(targetArea) === 0) return project;

  const moved = source.item;
  const side = target.zone as InsertSide;
  // Nella stessa area la foto è ancora nel suo albero: va tolta dal vecchio posto (per id) prima di reinserirla accanto a un'altra foto.
  const others = sameArea ? targetArea.items.filter((item) => item.id !== moved.id) : targetArea.items;
  let arrival: AlbumArea;
  if (targetArea.items.length === 0 || !targetArea.layout) {
    arrival = normalizeArea({ ...targetArea, layout: leaf(moved.id), items: [moved], seed: 0 });
  } else if (target.zone === "area") {
    // Il bersaglio «area» vale per un'area vuota o per uno spazio vuoto di una pagina libera (la foto arriva a cascata, le altre restano ferme).
    if (!hasFreeLayout(targetArea) || sameArea) return project;
    const inner = areaGeometry(project, targetSpread, target.areaIndex).inner;
    const layout = insertAtNode(targetArea.layout, "", moved.id, "right");
    arrival = normalizeArea(withNewFreeFrames({ ...targetArea, layout, items: [...others, moved], free: targetArea.free }, [{ id: moved.id, aspect: effectiveAspect(moved, assetMap(project).get(moved.assetId)) }], inner));
  } else if (target.node !== undefined) {
    // Il percorso del ramo vale per l'albero com'è ADESSO: si inserisce prima (con un nome provvisorio) e si toglie dopo la foto dal vecchio posto.
    const TEMP = `${moved.id}~arrivo`;
    const inserted = insertAtNode(targetArea.layout, target.node, TEMP, side);
    if (inserted === targetArea.layout) return project;
    const cleaned = sameArea ? removeLeaf(inserted, moved.id) : inserted;
    if (!cleaned) return project;
    arrival = normalizeArea({ ...targetArea, layout: renameLeaf(cleaned, TEMP, moved.id), items: [...others, moved] });
  } else {
    const targetItem = others.find((item) => item.id === target.itemId);
    const base = sameArea ? removeLeaf(targetArea.layout, moved.id) : targetArea.layout;
    if (!targetItem || !base) return project;
    const layout = insertBeside(base, targetItem.id, moved.id, side, keepRatio(assetMap(project), targetItem, moved.assetId, side));
    if (layout === base) return project;
    arrival = normalizeArea({ ...targetArea, layout, items: [...others, moved] });
  }
  if (!leafIds(arrival.layout).includes(moved.id) || arrival.items.length !== others.length + 1) return project;

  if (sameArea) return mapSpread(project, spreadId, (spread) => replaceArea(spread, target.areaIndex, arrival));
  const departure = normalizeArea({ ...source.area, layout: removeLeaf(source.area.layout, moved.id), items: source.area.items.filter((item) => item.id !== moved.id) });
  const without = mapSpread(project, source.spread.id, (spread) => replaceArea(spread, source.areaIndex, departure));
  return mapSpread(without, spreadId, (spread) => replaceArea(spread, target.areaIndex, arrival));
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
    // Le foto successive stanno accanto alla prima sul lato perpendicolare (una riga sotto o sopra, una colonna a sinistra o a destra).
    const along: InsertSide = side === "top" || side === "bottom" ? "right" : "bottom";
    layout = created.length === 0 ? insertAtNode(layout, target.node, item.id, side) : insertBeside(layout, created[created.length - 1].id, item.id, along, 0.5);
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
  // Layout bloccato: si possono sostituire e scambiare foto (la disposizione resta), non aggiungerne né spostarne dentro o fuori.
  if (area.locked && !(target.zone === "center" && target.itemId)) return project;
  // Pagina libera: le foto non hanno zone di inserimento a fianco; fuori da una foto la nuova arriva a cascata e le altre restano ferme.
  if (hasFreeLayout(area) && !(target.zone === "center" && target.itemId)) target = { areaIndex: target.areaIndex, itemId: null, zone: "area" };

  if (source.kind === "item") {
    if (target.zone === "center" && target.itemId) return swapItems(project, source.itemId, target.itemId);
    return moveItem(project, source.itemId, spreadId, target);
  }

  const assetIds = source.assetIds.filter((id) => assetExists(project, id));
  if (assetIds.length === 0) return project;

  if (target.zone === "area" || (!target.itemId && target.node === undefined) || !area.layout) return appendAssets(project, spreadId, target.areaIndex, assetIds);

  if (target.node !== undefined) return insertAssetsAtNode(project, spreadId, target, assetIds);

  if (target.zone === "center" && target.itemId) {
    // Una foto bloccata non si sostituisce: il rilascio si rifiuta per intero (non finirebbe sola la prima foto fuori).
    if (area.items.find((item) => item.id === target.itemId)?.locked) return project;
    const replaced = replaceItemAsset(project, target.itemId, assetIds[0]);
    return assetIds.length > 1 ? appendAssets(replaced, spreadId, target.areaIndex, assetIds.slice(1), target.itemId) : replaced;
  }

  if (target.zone === "center" || !target.itemId) return project;
  const side = target.zone;
  if (capacity(area) === 0) return project;
  const room = capacity(area);
  const targetItem = area.items.find((item) => item.id === target.itemId);
  if (!targetItem) return project;
  let layout = area.layout;
  const created: AlbumItem[] = [];
  const assets = assetMap(project);
  for (const assetId of assetIds.slice(0, room)) {
    const item = createItem(assetId);
    if (created.length === 0) {
      layout = insertBeside(layout, targetItem.id, item.id, side, keepRatio(assets, targetItem, assetId, side));
    } else {
      // Più foto rilasciate insieme sul bordo di una foto stanno tra loro affiancate sul lato perpendicolare: due foto sotto una
      // foto larga formano una riga sotto di essa (non una colonna di strisce); sul lato sinistro o destro si impilano.
      const previous = created[created.length - 1];
      const along: InsertSide = side === "top" || side === "bottom" ? "right" : "bottom";
      layout = insertBeside(layout, previous.id, item.id, along, keepRatio(assets, previous, assetId, along));
    }
    created.push(item);
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
  // Con una forma scelta l'area funziona come «foto intera» (finestre esatte): lo stile di posa si calcola con la forma già applicata.
  const tentativeArea = { ...found.area, items: found.area.items.map((item) => (item.id === itemId ? { ...item, ...(shape ? { shape } : { shape: undefined }) } : item)) };
  const tentative = placementStyle(tentativeArea, { windowed: isWindowedArea(tentativeArea, geometry.cells) });
  const placement = placeItem(cell.rect, found.item, asset, tentative, { zoom: requested, cx: change.cx, cy: change.cy, angle, shape: shape ?? null }, cell.anchor);
  // Il centro si memorizza come per la foto dritta: il raddrizzamento restringe i centri possibili solo alla visualizzazione,
  // così tornando a 0° la foto è dov'era (non spostata dal limite che valeva da inclinata).
  const center = cropCenter(cropForView(itemAspect(asset), placement.content.w / placement.content.h, requested, change.cx ?? found.item.cx, change.cy ?? found.item.cy));
  // Si memorizza lo zoom chiesto: con la foto raddrizzata `placeItem` lo alza da solo quanto basta a coprire gli angoli,
  // e tornando a 0° l'inquadratura di prima ricompare.
  const next = withAngle({ ...found.item, zoom: requested, cx: Number(center.x.toFixed(5)), cy: Number(center.y.toFixed(5)) }, angle, shape);
  if (next.zoom === found.item.zoom && next.cx === found.item.cx && next.cy === found.item.cy && (next.angle ?? 0) === (found.item.angle ?? 0) && next.shape === found.item.shape) return project;
  const changedArea = { ...found.area, items: found.area.items.map((item) => (item.id === itemId ? next : item)) };
  // Cambiando la forma di una foto la sua cella segue la nuova proporzione e le altre si adattano: le foto restano allineate (la foto è una finestra
  // esatta di quella forma). Con il layout bloccato nulla si sposta: la forma vale solo dentro la cella della foto.
  const shapeChanged = next.shape !== found.item.shape;
  const area = shapeChanged ? alignedForFit(project, changedArea, geometry.inner, geometry.gapMm) : changedArea;
  return mapSpread(project, found.spread.id, (spread) => replaceArea(spread, found.areaIndex, area));
}

export function resetItemView(project: Project, itemId: string): Project {
  return setItemView(project, itemId, { zoom: 1, cx: 0.5, cy: 0.5, angle: 0, shape: null });
}

/**
 * Bordo di una sola foto: spessore (cm) e colore. `null` toglie la scelta e la foto torna a seguire il bordo dell'area.
 * Una foto bloccata non cambia.
 */
export function setItemBorder(project: Project, itemId: string, change: { cm?: number | null; color?: string | null }): Project {
  const found = findItem(project, itemId);
  if (!found || found.item.locked) return project;
  const { borderCm: _cm, borderColor: _color, ...rest } = found.item;
  const cm = change.cm === undefined ? found.item.borderCm : change.cm === null ? undefined : clampNumber(Number(change.cm.toFixed(2)), STYLE_LIMITS.borderCm.min, STYLE_LIMITS.borderCm.max);
  const color = change.color === undefined ? found.item.borderColor : change.color === null || !change.color.trim() ? undefined : change.color.trim();
  if (cm === found.item.borderCm && color === found.item.borderColor) return project;
  const next: AlbumItem = { ...rest, ...(cm !== undefined ? { borderCm: cm } : {}), ...(color !== undefined ? { borderColor: color } : {}) };
  // Il bordo restringe la parte visibile: le foto si riallineano (la cella deve crescere di quanto serve).
  return alignChanged(project, mapSpread(project, found.spread.id, (spread) => replaceArea(spread, found.areaIndex, { ...found.area, items: found.area.items.map((item) => (item.id === itemId ? next : item)) })));
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
  // «Foto intera»: l'allineamento sposta il blocco di foto nella pagina (non ogni foto nella propria cella).
  return alignChanged(project, next);
}

/**
 * Crea un nuovo spread in posizione `atIndex` con la foto trascinata: dalla libreria (copia) o da uno spread (spostamento).
 * Restituisce anche l'id del nuovo spread.
 */
export function moveToNewSpread(project: Project, atIndex: number, source: DropSource): { project: Project; spreadId: string | null } {
  const assetIds = source.kind === "assets"
    ? source.assetIds.filter((id) => assetExists(project, id))
    : (() => { const found = findItem(project, source.itemId); return found && !found.item.locked && !found.area.locked ? [found.item.assetId] : []; })();
  if (assetIds.length === 0) return { project, spreadId: null };
  const at = Math.max(0, Math.min(atIndex, project.spreads.length));
  const created = addSpread(project, at);
  const spreadId = created.spreads[at]?.id;
  if (!spreadId || created === project) return { project, spreadId: null };
  let next = dropOnSpread(created, spreadId, { areaIndex: 0, itemId: null, zone: "area" }, { kind: "assets", assetIds });
  if (source.kind === "item") {
    next = withMovedView(next, spreadId, new Set(), findItem(project, source.itemId)?.item);
    next = removeItem(next, source.itemId);
  }
  return { project: alignChanged(project, next), spreadId };
}

/**
 * La foto spostata in un altro spread tiene la sua inquadratura (zoom, centro, raddrizzamento e forma): si applica alla foto appena
 * arrivata nello spread di destinazione, che è l'unica con un id che prima non c'era.
 */
function withMovedView(project: Project, spreadId: string, before: ReadonlySet<string>, from: AlbumItem | undefined): Project {
  if (!from) return project;
  const added = findSpread(project, spreadId)?.spread.areas.flatMap((area) => area.items).find((item) => !before.has(item.id));
  if (!added) return project;
  if (from.zoom === 1 && !from.angle && !from.shape && from.cx === 0.5 && from.cy === 0.5) return project;
  return setItemView(project, added.id, { zoom: from.zoom, cx: from.cx, cy: from.cy, angle: from.angle ?? 0, shape: from.shape ?? null });
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
    if (!found || found.item.locked || found.area.locked || spread.areas.some((area) => area.items.some((item) => item.id === source.itemId))) return project;
    assetIds = [found.item.assetId];
  }
  if (assetIds.length === 0) return project;
  // Le pagine con il layout bloccato non ricevono foto: si sceglie tra le altre.
  const open = spread.areas.map((area, index) => ({ area, index })).filter((entry) => !entry.area.locked);
  if (open.length === 0) return project;
  const areaIndex = open.reduce((best, entry) => (entry.area.items.length < spread.areas[best].items.length ? entry.index : best), open[0].index);
  const area = spread.areas[areaIndex];
  const existing = new Set(spread.areas.flatMap((candidate) => candidate.items.map((item) => item.id)));
  let next = area.items.length === 0
    ? dropOnSpread(project, spreadId, { areaIndex, itemId: null, zone: "area" }, { kind: "assets", assetIds })
    : appendAssets(project, spreadId, areaIndex, assetIds);
  if (next === project) return project;
  if (source.kind === "item") {
    next = withMovedView(next, spreadId, existing, findItem(project, source.itemId)?.item);
    next = removeItem(next, source.itemId);
  }
  return next;
}

/**
 * Perché un trascinamento verso uno spread (miniatura o spazio tra le miniature) non ha avuto effetto, in una frase per chi lo ha
 * fatto; null se non c'è niente da spiegare (per esempio la foto è già in quello spread). `spreadId` null = nuovo spread.
 */
export function moveRefusal(project: Project, spreadId: string | null, source: DropSource): string | null {
  if (source.kind === "item") {
    const found = findItem(project, source.itemId);
    if (!found) return null;
    if (found.item.locked) return "La foto è bloccata: sbloccala per spostarla.";
    if (found.area.locked) return "Il layout della pagina da cui parte la foto è bloccato: sbloccalo (lucchetto) per spostarla.";
    if (spreadId !== null && found.spread.id === spreadId) return null;
  }
  if (spreadId === null) return project.spreads.length >= MAX_SPREADS ? `Un album può avere al massimo ${MAX_SPREADS} spread.` : null;
  const spread = findSpread(project, spreadId)?.spread;
  if (!spread) return null;
  const open = spread.areas.filter((area) => !area.locked);
  if (open.length === 0) return "Il layout di questo spread è bloccato: sbloccalo (lucchetto) per aggiungere foto.";
  return open.every((area) => capacity(area) === 0) ? `Le pagine di questo spread hanno già ${MAX_ITEMS_PER_AREA} foto.` : null;
}

/**
 * Sul centro di una foto la trascinata la sostituisce (o si scambia con lei): si mostra la finestra che la nuova foto occuperà,
 * già con le celle riallineate come dopo il rilascio vero, non l'intera cella di prima (che in «foto intera» o con una forma è più larga).
 */
function previewReplaceRect(area: AlbumArea, inner: Rect, assets: ReadonlyMap<string, AlbumAssetV2>, targetId: string, dragged: { assetId: string; itemId?: string }): Rect | null {
  const target = area.items.find((item) => item.id === targetId);
  if (!area.layout || !target || target.locked || dragged.itemId === targetId) return null;
  const source = dragged.itemId ? area.items.find((item) => item.id === dragged.itemId) : undefined;
  const fresh = (item: AlbumItem, assetId: string): AlbumItem => ({ ...item, assetId, zoom: 1, cx: 0.5, cy: 0.5, angle: undefined });
  const items = area.items.map((item) => (item.id === targetId ? fresh(item, dragged.assetId) : source && item.id === source.id ? fresh(item, target.assetId) : item));
  const gap = Math.max(0, area.style.gapCm * 10);
  const after = { ...area, items };
  let layout = area.layout;
  if (needsShapeAlignment(after) && !area.locked) {
    const aspects = new Map(items.map((item) => [item.id, effectiveAspect(item, assets.get(item.assetId))] as const));
    layout = naturalRatios(layout, (id) => aspects.get(id) ?? 1.5, inner, gap, naturalOptions(after));
  }
  const cells = layoutCells(layout, inner, gap, undefined, alignFactor(area.style.align)).cells;
  const cell = cells.find((candidate) => candidate.itemId === targetId);
  const placed = items.find((item) => item.id === targetId);
  if (!cell || !placed) return null;
  return placeItem(cell.rect, placed, assets.get(dragged.assetId), placementStyle(after, { windowed: isWindowedArea(after, cells) }), null, cell.anchor).content;
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
  if (target.zone === "center" && target.itemId && area.layout && !hasFreeLayout(area)) return previewReplaceRect(area, inner, assets, target.itemId, dragged);
  if (!area.layout || target.zone === "center") return null;
  const TMP = "__anteprima__";
  let layout: LayoutNode | null = area.layout;
  const draggedHere = Boolean(dragged.itemId && area.items.some((item) => item.id === dragged.itemId));
  if (draggedHere && dragged.itemId === target.itemId) return null;
  const side = target.zone;
  if (target.node !== undefined) {
    // Come nel rilascio vero: il percorso del ramo vale per l'albero com'è adesso, la foto trascinata si toglie dopo.
    const inserted = insertAtNode(layout, target.node, TMP, side);
    if (inserted === layout) return null;
    layout = draggedHere ? removeLeaf(inserted, dragged.itemId!) : inserted;
    if (!layout) return inner;
  } else if (target.itemId) {
    if (draggedHere) layout = removeLeaf(layout, dragged.itemId!);
    if (!layout) return inner;
    const targetItem = area.items.find((item) => item.id === target.itemId);
    if (!targetItem) return null;
    layout = insertBeside(layout, target.itemId, TMP, side, keepRatio(assets, targetItem, dragged.assetId, side));
  } else return null;
  if (needsShapeAlignment(area)) {
    // Come nel rilascio vero: con «foto intera» (o foto con una forma scelta) le divisioni si regolano perché le foto risultino allineate.
    const aspects = new Map(area.items.map((item) => [item.id, effectiveAspect(item, assets.get(item.assetId))] as const));
    aspects.set(TMP, itemAspect(assets.get(dragged.assetId)));
    if (!area.locked) layout = naturalRatios(layout, (id) => aspects.get(id) ?? 1.5, inner, Math.max(0, area.style.gapCm * 10), naturalOptions({ style: area.style, items: [...area.items, { id: TMP }] as Pick<AlbumItem, "id" | "borderCm">[] }));
  }
  const previewCells = layoutCells(layout, inner, Math.max(0, area.style.gapCm * 10), undefined, alignFactor(area.style.align)).cells;
  const leaf = previewCells.find((candidate) => candidate.itemId === TMP);
  if (!leaf) return null;
  // «Foto intera» (o area con forme): la foto non riempie la cella, quindi si mostra lo spazio che occuperà davvero (non l'intera cella).
  const style = placementStyle(area, { windowed: isWindowedArea(area, previewCells) });
  if (style.mode === "fit") return placeItem(leaf.rect, { zoom: 1, cx: 0.5, cy: 0.5 }, assets.get(dragged.assetId), style, null, leaf.anchor).content;
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
