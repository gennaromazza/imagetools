import type { Rect } from "../engine/geometry";
import { alignRects, distributeRects, translateRect, type AlignMode, type Boxed } from "../engine/arrange";
import { appendAssets } from "./items";
import { areaGeometryFor, findItem, hasFreeLayout, replaceArea, mapSpread, type Project } from "./project";
import { setFrame } from "./templates";

/**
 * Gesti su più foto di una disposizione libera (spostamento di gruppo, frecce, allinea, distribuisci).
 * Le foto bloccate e quelle delle pagine con il layout bloccato restano ferme, come nel gesto su una foto sola.
 */

/** Cornice (mm nello spread) di ogni foto libera e mobile tra gli id dati; le altre sono ignorate. */
export function movableFrames(project: Project, itemIds: readonly string[]): Boxed[] {
  const frames: Boxed[] = [];
  for (const id of new Set(itemIds)) {
    const found = findItem(project, id);
    if (!found || found.item.locked || found.area.locked || !hasFreeLayout(found.area)) continue;
    const cell = areaGeometryFor(project.settings.sheet, found.spread, found.areaIndex).cells.find((candidate) => candidate.itemId === id);
    if (cell) frames.push({ id, rect: cell.rect });
  }
  return frames;
}

/** Porta le cornici nei rettangoli dati (mm nello spread), ognuna nelle frazioni della propria pagina. */
export function applyFrameRects(project: Project, changes: readonly Boxed[]): Project {
  let next = project;
  for (const { id, rect } of changes) {
    const found = findItem(next, id);
    if (!found) continue;
    const { inner } = areaGeometryFor(next.settings.sheet, found.spread, found.areaIndex);
    if (inner.w <= 0 || inner.h <= 0) continue;
    next = setFrame(next, id, { x: (rect.x - inner.x) / inner.w, y: (rect.y - inner.y) / inner.h, w: rect.w / inner.w, h: rect.h / inner.h });
  }
  return next;
}

/** Sposta le foto libere di `dx`, `dy` mm (frecce da tastiera). */
export function nudgeFrames(project: Project, itemIds: readonly string[], dx: number, dy: number): Project {
  return applyFrameRects(project, movableFrames(project, itemIds).map(({ id, rect }) => ({ id, rect: translateRect(rect, dx, dy) })));
}

export function alignFrames(project: Project, itemIds: readonly string[], mode: AlignMode): Project {
  return applyFrameRects(project, alignRects(movableFrames(project, itemIds), mode));
}

export function distributeFrames(project: Project, itemIds: readonly string[], axis: "x" | "y"): Project {
  return applyFrameRects(project, distributeRects(movableFrames(project, itemIds), axis));
}

/**
 * Duplica le foto libere (Ctrl/⌘ + trascinamento): la copia nasce nel rettangolo dato (mm nello spread), con inquadratura, forma, bordo e
 * rotazione dell'originale, davanti alle altre; l'originale resta dov'è. Una pagina piena (12 foto) o bloccata non riceve copie.
 */
export function duplicateFrames(project: Project, copies: readonly Boxed[]): Project {
  let next = project;
  for (const { id, rect } of copies) {
    const found = findItem(next, id);
    if (!found || found.item.locked || found.area.locked || !hasFreeLayout(found.area)) continue;
    // Una copia esattamente sopra l'originale non serve a nessuno: resterebbe nascosta e raddoppierebbe la foto in stampa.
    const original = areaGeometryFor(next.settings.sheet, found.spread, found.areaIndex).cells.find((cell) => cell.itemId === id)?.rect;
    if (original && Math.abs(original.x - rect.x) < 2 && Math.abs(original.y - rect.y) < 2) continue;
    const spreadId = found.spread.id;
    const grown = appendAssets(next, spreadId, found.areaIndex, [found.item.assetId]);
    const area = grown.spreads.find((spread) => spread.id === spreadId)?.areas[found.areaIndex];
    const created = area && area.items.length > found.area.items.length ? area.items.find((item) => !found.area.items.some((old) => old.id === item.id)) : undefined;
    if (!area || !created) continue;
    const { id: _id, ...view } = found.item;
    const withView = { ...area, items: area.items.map((item) => (item.id === created.id ? { ...item, ...view } : item)) };
    next = mapSpread(grown, spreadId, (spread) => replaceArea(spread, found.areaIndex, withView));
    next = applyFrameRects(next, [{ id: created.id, rect }]);
    next = setFrame(next, created.id, { rotation: found.area.free![id]?.rotation ?? 0 });
  }
  return next;
}

export type { Rect };
