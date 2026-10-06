import type { AlbumSpread, FreeFrame } from "@photo-tools/shared-types";
import { areaGeometryFor, findSpread, hasFreeLayout, mapSpread, normalizeArea, replaceArea, touch, type Project } from "./project";
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
  return touch(mapSpread(project, spreadId, (spread) => replaceArea(spread, areaIndex, locked ? { ...rest, locked: true } : rest)));
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
 * La disposizione attuale della pagina diventa libera: ogni foto parte dalla cornice che ha già, quindi a vista non cambia nulla.
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
  for (const [index, item] of area.items.entries()) {
    const cell = geometry.cells.find((candidate) => candidate.itemId === item.id);
    if (!cell) return project;
    free[item.id] = sanitizeFrame({ x: (cell.rect.x - inner.x) / inner.w, y: (cell.rect.y - inner.y) / inner.h, w: cell.rect.w / inner.w, h: cell.rect.h / inner.h, rotation: 0, z: index });
  }
  return touch(mapSpread(project, spreadId, (spread) => replaceArea(spread, areaIndex, { ...area, free })));
}

/** Torna al layout automatico che c'era prima di renderla libera (le posizioni scelte a mano si perdono). */
export function restoreAutomatic(project: Project, spreadId: string, areaIndex: number): Project {
  const found = findSpread(project, spreadId);
  const area = found?.spread.areas[areaIndex];
  if (!found || !area || !hasFreeLayout(area) || isAreaLocked(area)) return project;
  return touch(mapSpread(project, spreadId, (spread) => replaceArea(spread, areaIndex, normalizeArea({ ...area, free: undefined }))));
}
