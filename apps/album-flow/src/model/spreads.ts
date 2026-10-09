import type { AlbumItem, AlbumSpread, AlbumSplitMode } from "@photo-tools/shared-types";
import { areaOuterRects, type Rect } from "../engine/geometry";
import { MAX_ITEMS_PER_AREA, MAX_SPREADS } from "./defaults";
import { relayoutArea } from "./areas";
import { newId } from "./ids";
import { areaGeometry, areaGeometryFor, createArea, createSpread, findSpread, hasFreeLayout, mapSpread, normalizeArea, replaceArea, touch, type Project } from "./project";
import { sanitizeFrame } from "./templates";

export function addSpread(project: Project, atIndex?: number, split: AlbumSplitMode = "half"): Project {
  if (project.spreads.length >= MAX_SPREADS) return project;
  const index = Math.min(Math.max(atIndex ?? project.spreads.length, 0), project.spreads.length);
  const spreads = [...project.spreads];
  spreads.splice(index, 0, createSpread(project, split));
  return touch({ ...project, spreads });
}

export function removeSpread(project: Project, spreadId: string): Project {
  if (!findSpread(project, spreadId)) return project;
  return touch({ ...project, spreads: project.spreads.filter((spread) => spread.id !== spreadId) });
}

export function moveSpread(project: Project, from: number, to: number): Project {
  if (from === to || from < 0 || to < 0 || from >= project.spreads.length || to >= project.spreads.length) return project;
  const spreads = [...project.spreads];
  const [moved] = spreads.splice(from, 1);
  spreads.splice(to, 0, moved);
  return touch({ ...project, spreads });
}

/**
 * Sposta più spread insieme davanti alla posizione `before` (0 = in testa, numero di spread = in coda, indice dello spread
 * di partenza). Gli spread spostati mantengono tra loro l'ordine che avevano. Restituisce lo stesso progetto se nulla cambia.
 */
export function moveSpreads(project: Project, indices: readonly number[], before: number): Project {
  const total = project.spreads.length;
  const moving = [...new Set(indices)].filter((index) => Number.isInteger(index) && index >= 0 && index < total).sort((a, b) => a - b);
  if (moving.length === 0 || before < 0 || before > total) return project;
  const movingSet = new Set(moving);
  const rest = project.spreads.filter((_, index) => !movingSet.has(index));
  // posizione nella lista senza gli spostati: tanti spread rimasti quanti ne precedono `before`
  const at = project.spreads.slice(0, before).filter((_, index) => !movingSet.has(index)).length;
  const next = [...rest.slice(0, at), ...moving.map((index) => project.spreads[index]), ...rest.slice(at)];
  if (next.every((spread, index) => spread === project.spreads[index])) return project;
  return touch({ ...project, spreads: next });
}

/** Copia uno spread subito dopo: stesse foto e stesso layout, elementi con identificativi nuovi. */
export function duplicateSpread(project: Project, spreadId: string): Project {
  const found = findSpread(project, spreadId);
  if (!found || project.spreads.length >= MAX_SPREADS) return project;
  const clone: AlbumSpread = {
    ...found.spread,
    id: newId("spread"),
    areas: found.spread.areas.map((area) => {
      const mapping = new Map(area.items.map((item) => [item.id, newId("it")]));
      const rename = (node: NonNullable<typeof area.layout>): NonNullable<typeof area.layout> =>
        node.kind === "leaf" ? { kind: "leaf", itemId: mapping.get(node.itemId) ?? node.itemId } : { ...node, first: rename(node.first), second: rename(node.second) };
      // Le cornici delle disposizioni libere sono indicizzate per id della foto: vanno rinominate insieme alle foto.
      const free = area.free ? Object.fromEntries(Object.entries(area.free).map(([itemId, frame]) => [mapping.get(itemId) ?? itemId, frame])) : area.free;
      return { ...area, id: newId("area"), items: area.items.map((item) => ({ ...item, id: mapping.get(item.id)! })), layout: area.layout ? rename(area.layout) : null, ...(area.free ? { free } : {}) };
    }),
  };
  const spreads = [...project.spreads];
  spreads.splice(found.index + 1, 0, clone);
  return touch({ ...project, spreads });
}

/** Toglie tutte le foto dallo spread mantenendo divisione e stile. */
export function clearSpread(project: Project, spreadId: string): Project {
  return mapSpread(project, spreadId, (spread) => {
    if (spread.areas.every((area) => area.items.length === 0)) return spread;
    return { ...spread, areas: spread.areas.map((area) => ({ ...area, layout: null, items: [], seed: 0, free: undefined })) };
  });
}

export function swapAreas(project: Project, spreadId: string): Project {
  return mapSpread(project, spreadId, (spread) => {
    if (spread.areas.length < 2) return spread;
    const [a, b] = spread.areas;
    // Si scambiano foto e layout; lo stile resta legato alla posizione (sinistra/destra).
    return { ...spread, areas: [{ ...a, layout: b.layout, items: b.items, seed: b.seed, free: b.free }, { ...b, layout: a.layout, items: a.items, seed: a.seed, free: a.free }] };
  });
}

/** Foto di ogni area dopo il cambio di divisione, in ordine di lettura: il centro decide la pagina, con un foglio intero vanno tutte insieme. */
function splitBuckets(project: Project, spread: AlbumSpread, mode: AlbumSplitMode): AlbumItem[][] {
  const placed: Array<{ item: AlbumItem; centerX: number }> = [];
  spread.areas.forEach((area, areaIndex) => {
    const geometry = areaGeometry(project, spread, areaIndex);
    for (const item of area.items) {
      const cell = geometry.cells.find((candidate) => candidate.itemId === item.id);
      placed.push({ item, centerX: cell ? cell.rect.x + cell.rect.w / 2 : geometry.outer.x + geometry.outer.w / 2 });
    }
  });
  const rects = areaOuterRects(project.settings.sheet, mode);
  const buckets: AlbumItem[][] = rects.map(() => []);
  if (rects.length === 1) buckets[0] = placed.map((entry) => entry.item);
  else {
    const boundary = rects[0].w;
    for (const entry of placed) buckets[entry.centerX < boundary ? 0 : 1].push(entry.item);
  }
  return buckets;
}

/** Perché il cambio di divisione non avrebbe effetto, in una frase; null se si può fare. */
export function splitRefusal(project: Project, spreadId: string, mode: AlbumSplitMode): string | null {
  const found = findSpread(project, spreadId);
  if (!found || found.spread.split === mode) return null;
  const biggest = Math.max(...splitBuckets(project, found.spread, mode).map((bucket) => bucket.length));
  return biggest > MAX_ITEMS_PER_AREA ? `Con questa divisione una pagina avrebbe ${biggest} foto: il massimo è ${MAX_ITEMS_PER_AREA}. Togline qualcuna e riprova.` : null;
}

/**
 * Cambia la divisione dello spread. Le foto restano nell'area in cui cade il loro centro (o tutte in un'area con "full"),
 * l'ordine non cambia e i layout vengono rigenerati.
 */
export function setSplitMode(project: Project, spreadId: string, mode: AlbumSplitMode): Project {
  const found = findSpread(project, spreadId);
  if (!found || found.spread.split === mode) return project;
  const { spread } = found;

  const rects = areaOuterRects(project.settings.sheet, mode);
  const style = (index: number) => ({ ...(spread.areas[index] ?? spread.areas[0]).style });
  const buckets = splitBuckets(project, spread, mode);
  // Il tetto per area vale anche qui: con troppe foto in una sola pagina l'album non si riaprirebbe più.
  if (buckets.some((bucket) => bucket.length > MAX_ITEMS_PER_AREA)) return project;

  const areas = rects.map((_, index) => {
    const base = { ...createArea(style(index)), id: spread.areas[index]?.id ?? newId("area") };
    return { ...base, items: buckets[index] };
  });
  // Layout provvisorio perché relayoutArea parta con le foto nell'ordine giusto.
  const staged: AlbumSpread = {
    ...spread,
    split: mode,
    areas: areas.map((area) => ({
      ...area,
      layout: area.items.length === 0 ? null : area.items.slice(1).reduce<NonNullable<typeof area.layout>>((acc, item) => ({ kind: "split", dir: "row", ratio: 0.5, first: acc, second: { kind: "leaf", itemId: item.id } }), { kind: "leaf", itemId: area.items[0].id }),
    })),
  };
  let relaid: AlbumSpread = { ...staged, areas: staged.areas.map((_, index) => normalizeArea(relayoutArea(project, staged, index, 0))) };
  // Con la disposizione libera le foto restano dove sono: ogni cornice si ricalcola sulla nuova pagina in cui cade, a vista non si muove nulla.
  if (spread.areas.some((area) => hasFreeLayout(area))) {
    const placed = new Map<string, { rect: Rect; rotation: number; z: number }>();
    spread.areas.forEach((_, areaIndex) => areaGeometry(project, spread, areaIndex).cells.forEach((cell, index) => placed.set(cell.itemId, { rect: cell.rect, rotation: cell.rotation ?? 0, z: cell.z ?? index })));
    relaid.areas.forEach((area, areaIndex) => {
      if (area.items.length === 0) return;
      const { inner } = areaGeometryFor(project.settings.sheet, relaid, areaIndex);
      if (inner.w <= 0 || inner.h <= 0 || area.items.some((item) => !placed.has(item.id))) return;
      const free = Object.fromEntries(area.items.map((item) => {
        const old = placed.get(item.id)!;
        return [item.id, sanitizeFrame({ x: (old.rect.x - inner.x) / inner.w, y: (old.rect.y - inner.y) / inner.h, w: old.rect.w / inner.w, h: old.rect.h / inner.h, rotation: old.rotation, z: old.z })];
      }));
      relaid = replaceArea(relaid, areaIndex, { ...area, free });
    });
  }
  return touch({ ...project, spreads: project.spreads.map((candidate) => (candidate.id === spreadId ? relaid : candidate)) });
}

/** Segna uno spread come finito (o lo riapre): Auto Build, Mescola e i layout automatici lo lasciano com'è. */
export function setSpreadDone(project: Project, spreadId: string, done: boolean): Project {
  return mapSpread(project, spreadId, (spread) => ((spread.done ?? false) === done ? spread : { ...spread, done }));
}
