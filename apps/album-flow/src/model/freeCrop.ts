import type { AlbumAssetV2, AlbumItem, AlbumSpread, SheetSpec } from "@photo-tools/shared-types";
import type { Rect } from "../engine/geometry";
import { cropForView } from "../slot-geometry";
import { MAX_SHAPE, MAX_ZOOM, MIN_SHAPE, MIN_ZOOM } from "./defaults";
import { makeAreaFree } from "./layoutLock";
import { placeItem } from "./placement";
import { areaGeometryFor, findItem, hasFreeLayout, itemAspect, mapSpread, placementStyle, replaceArea, touch, type Project } from "./project";
import { sanitizeFrame } from "./templates";

/**
 * Ritaglio libero: i bordi della cornice di una foto si spostano dove si vuole (senza vincoli di proporzione) e la foto resta ferma dov'è,
 * quindi si taglia soltanto la parte che esce dalla cornice. L'inquadratura (zoom e centro) si ricalcola perché l'immagine occupi
 * esattamente lo stesso posto sul foglio; la foto non si deforma mai.
 */

/** Lato minimo (mm) di una cornice ritagliata. */
export const MIN_CROP_SIDE_MM = 8;

export interface FrameCrop {
  /** La cornice nella nuova posizione (mm nello spread). */
  rect: Rect;
  /** Inquadratura che lascia la foto ferma. */
  view: { zoom: number; cx: number; cy: number; shape: number | null };
}

const EPSILON_MM = 0.05;
/** Le cornici libere sono salvate con 5 decimali: lo zoom che tiene ferma una foto intera può risultare appena sotto 1. */
const ZOOM_TOLERANCE = 1e-3;

/**
 * La cornice come si vede adesso: la parte visibile della foto più il suo bordo. È da qui che partono le maniglie del ritaglio, perché
 * in «foto intera» la cella del layout è più grande della foto e il ritaglio libero lavora su ciò che si vede (come `makeAreaFree`).
 */
export function visibleFrame(sheet: SheetSpec, spread: AlbumSpread, areaIndex: number, itemId: string, asset: AlbumAssetV2 | undefined): Rect | null {
  const area = spread.areas[areaIndex];
  const item = area?.items.find((candidate) => candidate.id === itemId);
  const cell = area ? areaGeometryFor(sheet, spread, areaIndex).cells.find((candidate) => candidate.itemId === itemId) : undefined;
  if (!area || !item || !cell) return null;
  const placement = placeItem(cell.rect, item, asset, placementStyle(area, cell), null, cell.anchor);
  const b = placement.borderMm;
  return { x: placement.content.x - b, y: placement.content.y - b, w: placement.content.w + b * 2, h: placement.content.h + b * 2 };
}

/**
 * Cosa serve per portare la cornice di una foto in `rect` senza muovere l'immagine. Null se non si può (cornice troppo piccola, bloccata,
 * ruotata, oppure il bordo uscirebbe dalla foto: non si può mostrare ciò che la foto non ha). Funziona con la foto raddrizzata:
 * l'immagine ruota attorno al centro della finestra visibile, quindi un cambio di finestra sposta anche il perno.
 */
export function planFrameCrop(sheet: SheetSpec, spread: AlbumSpread, areaIndex: number, itemId: string, asset: AlbumAssetV2 | undefined, rect: Rect): FrameCrop | null {
  const area = spread.areas[areaIndex];
  const item = area?.items.find((candidate) => candidate.id === itemId);
  if (!area || !item || item.locked || area.locked) return null;
  if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) || rect.w < MIN_CROP_SIDE_MM || rect.h < MIN_CROP_SIDE_MM) return null;
  const cell = areaGeometryFor(sheet, spread, areaIndex).cells.find((candidate) => candidate.itemId === itemId);
  if (!cell || (cell.rotation ?? 0) !== 0) return null;
  const before = placeItem(cell.rect, item, asset, placementStyle(area, cell), null, cell.anchor);
  // Dopo il ritaglio la pagina è libera: vale lo stile dell'area, senza le finestre esatte dei layout automatici.
  const style = area.style;
  const aspect = itemAspect(asset);
  const angle = before.angle;
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Finestra visibile della nuova cornice (tutta la cella meno il bordo).
  const probe = placeItem(rect, { ...item, zoom: MIN_ZOOM, cx: 0.5, cy: 0.5, angle: 0, shape: undefined }, asset, { ...style, mode: "fill" }, null);
  const window = probe.content;
  const oldPivot = { x: before.content.x + before.content.w / 2, y: before.content.y + before.content.h / 2 };
  const newPivot = { x: window.x + window.w / 2, y: window.y + window.h / 2 };
  // Centro dell'immagine come appare sul foglio (ruotata attorno al perno): deve restare lo stesso.
  const oldCenter = { x: before.image.x + before.image.w / 2, y: before.image.y + before.image.h / 2 };
  const shown = { x: oldPivot.x + (oldCenter.x - oldPivot.x) * cos - (oldCenter.y - oldPivot.y) * sin, y: oldPivot.y + (oldCenter.x - oldPivot.x) * sin + (oldCenter.y - oldPivot.y) * cos };
  // Stesso punto, visto dal nuovo perno e con la rotazione tolta.
  const dx = shown.x - newPivot.x;
  const dy = shown.y - newPivot.y;
  const center = { x: newPivot.x + dx * cos + dy * sin, y: newPivot.y - dx * sin + dy * cos };
  const base = cropForView(aspect, window.w / window.h, 1, 0.5, 0.5);
  const zoom = before.image.w / (window.w / base.cropWidth);
  if (!Number.isFinite(zoom) || zoom < MIN_ZOOM - ZOOM_TOLERANCE || zoom > MAX_ZOOM + ZOOM_TOLERANCE) return null;
  // In «foto intera» la finestra segue le proporzioni della foto: la forma della cornice disegnata va fissata come forma della foto.
  const shape = style.mode === "fit" ? window.w / window.h : null;
  if (shape !== null && (shape < MIN_SHAPE || shape > MAX_SHAPE)) return null;
  const view = {
    shape,
    zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)),
    cx: (newPivot.x - (center.x - before.image.w / 2)) / before.image.w,
    cy: (newPivot.y - (center.y - before.image.h / 2)) / before.image.h,
  };
  if (view.cx < -1e-6 || view.cx > 1 + 1e-6 || view.cy < -1e-6 || view.cy > 1 + 1e-6) return null;
  // Prova: con questa inquadratura l'immagine deve occupare lo stesso posto di prima.
  const moved: Pick<AlbumItem, "zoom" | "cx" | "cy" | "angle"> & { shape?: number; borderCm?: number } = { ...item, zoom: view.zoom, cx: view.cx, cy: view.cy, shape: view.shape ?? undefined };
  const after = placeItem(rect, moved, asset, style, null, undefined);
  const sameSize = Math.abs(after.image.w - before.image.w) < EPSILON_MM && Math.abs(after.image.h - before.image.h) < EPSILON_MM;
  const afterCenter = { x: after.image.x + after.image.w / 2, y: after.image.y + after.image.h / 2 };
  const afterShown = { x: newPivot.x + (afterCenter.x - newPivot.x) * cos - (afterCenter.y - newPivot.y) * sin, y: newPivot.y + (afterCenter.x - newPivot.x) * sin + (afterCenter.y - newPivot.y) * cos };
  if (!sameSize || Math.abs(afterShown.x - shown.x) > EPSILON_MM || Math.abs(afterShown.y - shown.y) > EPSILON_MM || after.angle !== angle) return null;
  return { rect, view };
}

/**
 * Applica il ritaglio libero: la cornice della foto va in `rect` (mm nello spread) e la foto resta ferma. Se la pagina non è ancora libera
 * lo diventa (ogni foto parte dalla finestra che ha già, quindi a vista non cambia nulla); «Torna al layout automatico» la riporta com'era.
 * Non fa nulla su foto o pagine bloccate, foto ruotate a mano o se la foto non copre la nuova cornice.
 */
export function cropFrameTo(project: Project, itemId: string, rect: Rect): Project {
  const found = findItem(project, itemId);
  if (!found || found.item.locked || found.area.locked) return project;
  const spreadId = found.spread.id;
  let base = project;
  if (!hasFreeLayout(found.area)) {
    base = makeAreaFree(project, spreadId, found.areaIndex);
    if (base === project) return project;
  }
  const now = findItem(base, itemId);
  if (!now) return project;
  const { sheet } = base.settings;
  const asset = base.assets.find((candidate) => candidate.id === now.item.assetId);
  const { inner } = areaGeometryFor(sheet, now.spread, now.areaIndex);
  if (inner.w <= 0 || inner.h <= 0) return project;
  const old = now.area.free![itemId];
  // Il ritaglio può solo stare dentro i limiti ammessi per una cornice: si pianifica sulla cornice già «pulita».
  const clean = sanitizeFrame({ ...old, x: (rect.x - inner.x) / inner.w, y: (rect.y - inner.y) / inner.h, w: rect.w / inner.w, h: rect.h / inner.h });
  const cleanRect: Rect = { x: inner.x + clean.x * inner.w, y: inner.y + clean.y * inner.h, w: clean.w * inner.w, h: clean.h * inner.h };
  const plan = planFrameCrop(sheet, now.spread, now.areaIndex, itemId, asset, cleanRect);
  if (!plan) return project;
  const { shape: _shape, ...rest } = now.item;
  const item: AlbumItem = { ...rest, ...(plan.view.shape !== null ? { shape: Number(plan.view.shape.toFixed(4)) } : {}), zoom: Number(plan.view.zoom.toFixed(4)), cx: Number(Math.min(1, Math.max(0, plan.view.cx)).toFixed(4)), cy: Number(Math.min(1, Math.max(0, plan.view.cy)).toFixed(4)) };
  return touch(mapSpread(base, spreadId, (spread) => replaceArea(spread, now.areaIndex, {
    ...now.area,
    items: now.area.items.map((candidate) => (candidate.id === itemId ? item : candidate)),
    free: { ...now.area.free!, [itemId]: { ...old, x: clean.x, y: clean.y, w: clean.w, h: clean.h } },
  })));
}
