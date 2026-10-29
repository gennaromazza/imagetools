import type { AlbumArea, AlbumSpread, FreeFrame } from "@photo-tools/shared-types";
import type { Rect } from "../engine/geometry";
import { alignedForFit, areaGeometryFor, assetMap, findSpread, hasFreeLayout, mapSpread, normalizeArea, placementStyle, replaceArea, touch, type Project } from "./project";
import { placeItem } from "./placement";
import { sanitizeFrame } from "./templates";

/**
 * Blocco del layout di una pagina e passaggio alla disposizione libera.
 * - «Libera»: ogni foto ha la sua cornice e si sposta e ridimensiona a piacere (come nei layout disegnati).
 * - «Bloccata»: la disposizione è protetta, Mescola, i layout proposti e Auto Build non la toccano.
 * Il layout ad albero resta sempre salvato come riserva, quindi si può tornare indietro.
 */

export type LockScope = "left" | "right" | "all";

/** Aree interessate da un comando «pagina sinistra / destra / tutto il foglio» (con un foglio intero c'è una sola pagina). */
export function areaIndexesOf(spread: Pick<AlbumSpread, "areas">, scope: LockScope): number[] {
  const count = spread.areas.length;
  if (scope === "all" || count < 2) return spread.areas.map((_, index) => index);
  return [scope === "left" ? 0 : 1];
}

export const isAreaLocked = (area: { locked?: boolean } | undefined): boolean => Boolean(area?.locked);

export function setAreaLocked(project: Project, spreadId: string, areaIndex: number, locked: boolean): Project {
  const found = findSpread(project, spreadId);
  const area = found?.spread.areas[areaIndex];
  if (!found || !area || isAreaLocked(area) === locked) return project;
  const { locked: _old, ...rest } = area;
  if (locked) return touch(mapSpread(project, spreadId, (spread) => replaceArea(spread, areaIndex, { ...rest, locked: true })));
  // Sbloccando, le foto si riallineano: con il lucchetto una forma scelta o un bordo cambiato non spostavano le altre foto (e l'interfaccia promette
  // che lo sblocco le sistema). Uno spread finito non si riadatta, come per lo stile.
  const { inner, gapMm } = areaGeometryFor(project.settings.sheet, replaceArea(found.spread, areaIndex, rest), areaIndex);
  const settled = found.spread.done ? rest : alignedForFit(project, rest, inner, gapMm);
  return touch(mapSpread(project, spreadId, (spread) => replaceArea(spread, areaIndex, settled)));
}

/** Blocca o sblocca la pagina sinistra, la destra o tutto il foglio. */
export function setSpreadLock(project: Project, spreadId: string, scope: LockScope, locked: boolean): Project {
  const found = findSpread(project, spreadId);
  if (!found) return project;
  return areaIndexesOf(found.spread, scope).reduce((current, index) => setAreaLocked(current, spreadId, index, locked), project);
}

/** Vero se tutte le pagine del gruppo sono già bloccate (il comando diventa «sblocca»). */
export function isScopeLocked(spread: Pick<AlbumSpread, "areas">, scope: LockScope): boolean {
  const indexes = areaIndexesOf(spread, scope);
  return indexes.length > 0 && indexes.every((index) => isAreaLocked(spread.areas[index]));
}

/**
 * Cornici per foto nuove in una pagina libera, con le proporzioni della foto, sopra le altre. Le foto già presenti restano dove sono
 * (aggiungere una foto non deve annullare le posizioni scelte a mano). Con `at` (punto del rilascio, mm nello spread) la prima foto si
 * centra lì e le altre la seguono a cascata; senza, partono dall'angolo in alto a sinistra.
 */
export function withNewFreeFrames(area: AlbumArea, created: ReadonlyArray<{ id: string; aspect: number }>, inner: Rect, at?: { x: number; y: number }): AlbumArea {
  const free: Record<string, FreeFrame> = { ...(area.free ?? {}) };
  const top = Math.max(-1, ...Object.values(free).map((frame) => frame.z)) + 1;
  created.forEach(({ id, aspect }, order) => {
    const w = 0.34;
    const h = Math.min(0.9, (w * inner.w) / Math.max(inner.h, 1) / Math.max(0.2, aspect));
    const step = 0.05 * (order % 6);
    const origin = at && inner.w > 0 && inner.h > 0
      ? { x: (at.x - inner.x) / inner.w - w / 2, y: (at.y - inner.y) / inner.h - h / 2 }
      : { x: 0.06, y: 0.06 };
    // Il punto del rilascio può essere vicino al bordo: la foto resta tutta nella pagina.
    const inside = (start: number, size: number) => (at ? Math.min(Math.max(start, 0), Math.max(0, 1 - size)) : start);
    free[id] = sanitizeFrame({ x: inside(origin.x + step, w), y: inside(origin.y + step, h), w, h, rotation: 0, z: top + order });
  });
  return { ...area, free };
}

/**
 * La disposizione attuale della pagina diventa libera: ogni foto parte dalla finestra che ha già (la parte visibile, bordo compreso),
 * quindi a vista non cambia nulla, nemmeno in «foto intera» dove la finestra è più piccola della cella.
 * Non si fa su una pagina bloccata né vuota; se è già libera non cambia niente.
 */
export function makeAreaFree(project: Project, spreadId: string, areaIndex: number): Project {
  const found = findSpread(project, spreadId);
  const area = found?.spread.areas[areaIndex];
  if (!found || !area || area.items.length === 0 || !area.layout || isAreaLocked(area) || hasFreeLayout(area)) return project;
  const geometry = areaGeometryFor(project.settings.sheet, found.spread, areaIndex);
  const { inner } = geometry;
  if (inner.w <= 0 || inner.h <= 0) return project;
  const free: Record<string, FreeFrame> = {};
  const assets = assetMap(project);
    for (const [index, item] of area.items.entries()) {
    const cell = geometry.cells.find((candidate) => candidate.itemId === item.id);
    if (!cell) return project;
    // La cornice è la finestra visibile allargata del bordo: nella pagina libera la foto occupa esattamente lo stesso posto.
    const placement = placeItem(cell.rect, item, assets.get(item.assetId), placementStyle(area, cell), null, cell.anchor);
    const b = placement.borderMm;
    const frame = { x: placement.content.x - b, y: placement.content.y - b, w: placement.content.w + b * 2, h: placement.content.h + b * 2 };
    free[item.id] = sanitizeFrame({ x: (frame.x - inner.x) / inner.w, y: (frame.y - inner.y) / inner.h, w: frame.w / inner.w, h: frame.h / inner.h, rotation: 0, z: index });
  }
  return touch(mapSpread(project, spreadId, (spread) => replaceArea(spread, areaIndex, { ...area, free })));
}

/**
 * Torna al layout automatico (le posizioni scelte a mano si perdono): quello che c'era prima di renderla libera oppure, se nel frattempo sono
 * arrivate foto o la pagina viene da un template libero, il layout calcolato per quelle foto (lo tengono aggiornato le operazioni sulla pagina).
 * In «foto intera» le foto tornano allineate.
 */
export function restoreAutomatic(project: Project, spreadId: string, areaIndex: number): Project {
  const found = findSpread(project, spreadId);
  const area = found?.spread.areas[areaIndex];
  if (!found || !area || !hasFreeLayout(area) || isAreaLocked(area)) return project;
  const plain = normalizeArea({ ...area, free: undefined });
  const { inner, gapMm } = areaGeometryFor(project.settings.sheet, replaceArea(found.spread, areaIndex, plain), areaIndex);
  return touch(mapSpread(project, spreadId, (spread) => replaceArea(spread, areaIndex, alignedForFit(project, plain, inner, gapMm))));
}
