import { test } from "node:test";
import assert from "node:assert/strict";
import type { Rect } from "../engine/geometry";
import { setAreaStyle } from "./areas";
import { DEFAULT_AUTO_BUILD, autoBuildAlbum } from "./autobuild";
import { assertProjectInvariants, makeProject } from "./fixtures";
import { cropFrameTo, planFrameCrop, visibleFrame } from "./freeCrop";
import { appendAssets, setItemView, toggleItemLock } from "./items";
import { placeItem, type Placement } from "./placement";
import { areaGeometry, assetMap, findItem, hasFreeLayout, placementStyle, type Project } from "./project";
import { addSpread } from "./spreads";

// Ritaglio libero: i bordi della cornice si spostano a piacere e la foto resta ferma dov'è.

function album(photos = 3): { project: Project; spreadId: string; itemId: string } {
  let project = addSpread(makeProject(photos + 3), 0, "half");
  const spreadId = project.spreads[0].id;
  project = appendAssets(project, spreadId, 0, Array.from({ length: photos }, (_, index) => `a${index}`));
  return { project, spreadId, itemId: project.spreads[0].areas[0].items[0].id };
}

/** Dove sta davvero la foto sul foglio: posizione e misure dell'immagine e suo centro dopo il raddrizzamento (ruota attorno al centro della finestra). */
function shown(project: Project, itemId: string): { w: number; h: number; x: number; y: number; angle: number; window: Rect } {
  const found = findItem(project, itemId)!;
  const cell = areaGeometry(project, found.spread, found.areaIndex).cells.find((candidate) => candidate.itemId === itemId)!;
  const placement: Placement = placeItem(cell.rect, found.item, assetMap(project).get(found.item.assetId), placementStyle(found.area, cell), null, cell.anchor);
  const pivot = { x: placement.content.x + placement.content.w / 2, y: placement.content.y + placement.content.h / 2 };
  const center = { x: placement.image.x + placement.image.w / 2, y: placement.image.y + placement.image.h / 2 };
  const rad = (placement.angle * Math.PI) / 180;
  const dx = center.x - pivot.x;
  const dy = center.y - pivot.y;
  return { w: placement.image.w, h: placement.image.h, x: pivot.x + dx * Math.cos(rad) - dy * Math.sin(rad), y: pivot.y + dx * Math.sin(rad) + dy * Math.cos(rad), angle: placement.angle, window: placement.content };
}

/** La cornice com'è adesso (da dove partono le maniglie). */
const cellOf = (project: Project, itemId: string): Rect => {
  const found = findItem(project, itemId)!;
  return visibleFrame(project.settings.sheet, found.spread, found.areaIndex, itemId, assetMap(project).get(found.item.assetId))!;
};

function assertSamePhoto(before: ReturnType<typeof shown>, after: ReturnType<typeof shown>, label: string) {
  for (const key of ["w", "h", "x", "y"] as const) assert.ok(Math.abs(before[key] - after[key]) < 0.06, `${label}: ${key} ${before[key]} → ${after[key]}`);
  assert.equal(after.angle, before.angle, `${label}: raddrizzamento`);
}

test("ritaglio libero: un lato si accorcia, la pagina diventa libera e la foto non si sposta né si deforma", () => {
  const { project, itemId } = album(3);
  const before = shown(project, itemId);
  const cell = cellOf(project, itemId);
  // taglia un quarto da destra e un sesto dall'alto, senza vincoli di proporzione
  const rect: Rect = { x: cell.x, y: cell.y + cell.h / 6, w: cell.w * 0.75, h: (cell.h * 5) / 6 };
  const cropped = cropFrameTo(project, itemId, rect);
  assert.notEqual(cropped, project);
  assert.ok(hasFreeLayout(cropped.spreads[0].areas[0]), "la pagina è ora libera");
  assertProjectInvariants(cropped, "ritaglio libero");
  const after = shown(cropped, itemId);
  assertSamePhoto(before, after, "dopo il ritaglio");
  const newCell = cellOf(cropped, itemId);
  for (const key of ["x", "y", "w", "h"] as const) assert.ok(Math.abs(newCell[key] - rect[key]) < 0.1, `cornice ${key}`);
  assert.ok(after.window.w < before.window.w - 1 && after.window.h < before.window.h - 1, "la finestra è più piccola");
  // le altre foto della pagina non si sono mosse
  for (const other of project.spreads[0].areas[0].items.slice(1)) assertSamePhoto(shown(project, other.id), shown(cropped, other.id), other.id);
});

test("ritaglio libero: si può riprendere più volte, riallargare fino ai limiti della foto e tornare al layout automatico", () => {
  const { project, itemId } = album(2);
  const before = shown(project, itemId);
  const cell = cellOf(project, itemId);
  const once = cropFrameTo(project, itemId, { x: cell.x + cell.w * 0.2, y: cell.y, w: cell.w * 0.8, h: cell.h });
  const twice = cropFrameTo(once, itemId, { x: cell.x + cell.w * 0.2, y: cell.y + cell.h * 0.3, w: cell.w * 0.5, h: cell.h * 0.7 });
  assertSamePhoto(before, shown(twice, itemId), "secondo ritaglio");
  // riallarga allo stato iniziale: la foto è ancora la stessa
  const again = cropFrameTo(twice, itemId, cell);
  assertSamePhoto(before, shown(again, itemId), "riallargato");
  assertProjectInvariants(again, "riallargato");
});

test("ritaglio libero: non si può mostrare ciò che la foto non ha, né rimpicciolire sotto il minimo", () => {
  const { project, itemId } = album(2);
  const cell = cellOf(project, itemId);
  // la foto riempie la cella: un lato più largo della foto non è possibile
  assert.equal(cropFrameTo(project, itemId, { ...cell, w: cell.w * 1.6, h: cell.h * 1.6 }), project, "oltre la foto: nessun cambiamento");
  assert.equal(cropFrameTo(project, itemId, { ...cell, w: 2, h: 2 }), project, "troppo piccola");
  assert.equal(cropFrameTo(project, itemId, { ...cell, w: Number.NaN }), project, "misure non valide");
  assert.equal(cropFrameTo(project, "inesistente", cell), project);
});

test("ritaglio libero: con la foto raddrizzata resta ferma anche l'inclinazione", () => {
  const { project, itemId } = album(3);
  const tilted = setItemView(project, itemId, { angle: 7, zoom: 1.4 });
  const before = shown(tilted, itemId);
  assert.equal(before.angle, 7);
  const cell = cellOf(tilted, itemId);
  const cropped = cropFrameTo(tilted, itemId, { x: cell.x + cell.w * 0.1, y: cell.y + cell.h * 0.05, w: cell.w * 0.6, h: cell.h * 0.7 });
  assert.notEqual(cropped, tilted, "il ritaglio si applica");
  assertSamePhoto(before, shown(cropped, itemId), "foto inclinata");
  assertProjectInvariants(cropped, "ritaglio con raddrizzamento");
});

test("ritaglio libero: foto intera — la forma della cornice disegnata diventa la forma della foto", () => {
  const { project, spreadId, itemId } = album(3);
  const fit = setAreaStyle(project, spreadId, 0, { mode: "fit" });
  const before = shown(fit, itemId);
  const window = before.window;
  const cropped = cropFrameTo(fit, itemId, { x: window.x, y: window.y, w: window.w * 0.6, h: window.h * 0.9 });
  assert.notEqual(cropped, fit);
  assertSamePhoto(before, shown(cropped, itemId), "foto intera");
  const item = findItem(cropped, itemId)!.item;
  assert.ok(item.shape && Math.abs(item.shape - (window.w * 0.6) / (window.h * 0.9)) < 0.01, "la forma segue la cornice");
  assertProjectInvariants(cropped, "ritaglio in foto intera");
});

test("ritaglio libero: foto o pagina bloccate non si toccano e il piano non c'è", () => {
  const { project, spreadId, itemId } = album(3);
  const cell = cellOf(project, itemId);
  const rect: Rect = { x: cell.x, y: cell.y, w: cell.w * 0.8, h: cell.h };
  const lockedPhoto = toggleItemLock(project, itemId);
  assert.equal(cropFrameTo(lockedPhoto, itemId, rect), lockedPhoto, "foto bloccata");
  const area = project.spreads[0].areas[0];
  const lockedArea: Project = { ...project, spreads: project.spreads.map((spread) => (spread.id === spreadId ? { ...spread, areas: spread.areas.map((candidate, index) => (index === 0 ? { ...candidate, locked: true } : candidate)) } : spread)) };
  assert.equal(cropFrameTo(lockedArea, itemId, rect), lockedArea, "pagina bloccata");
  const asset = assetMap(project).get(area.items[0].assetId);
  assert.equal(planFrameCrop(project.settings.sheet, project.spreads[0], 0, itemId, asset, rect) !== null, true, "il piano esiste per una foto libera di muoversi");
  assert.equal(planFrameCrop(lockedPhoto.settings.sheet, lockedPhoto.spreads[0], 0, itemId, asset, rect), null, "…e non per una bloccata");
});

test("ritaglio libero: «riempi lo spazio» — taglia da ogni lato e la foto resta ferma", () => {
  const { project, spreadId, itemId } = album(3);
  const fill = setAreaStyle(project, spreadId, 0, { mode: "fill" });
  const before = shown(fill, itemId);
  const frame = cellOf(fill, itemId);
  const cropped = cropFrameTo(fill, itemId, { x: frame.x + frame.w * 0.15, y: frame.y + frame.h * 0.1, w: frame.w * 0.6, h: frame.h * 0.75 });
  assert.notEqual(cropped, fill);
  assertSamePhoto(before, shown(cropped, itemId), "riempi");
  assert.equal(findItem(cropped, itemId)!.item.shape, undefined, "senza forma: la finestra è la cornice");
  assertProjectInvariants(cropped, "ritaglio in riempi");
});

test("ritaglio libero: in un album impaginato da Auto Build ogni foto si ritaglia (le cornici libere arrotondate non bloccano il gesto)", () => {
  const built = autoBuildAlbum(makeProject(36), { ...DEFAULT_AUTO_BUILD });
  for (const spread of built.spreads.slice(0, 4)) {
    for (const [areaIndex, area] of spread.areas.entries()) {
      for (const item of area.items) {
        const frame = visibleFrame(built.settings.sheet, spread, areaIndex, item.id, assetMap(built).get(item.assetId))!;
        const before = shown(built, item.id);
        const cropped = cropFrameTo(built, item.id, { ...frame, x: frame.x + frame.w * 0.1, w: frame.w * 0.7, h: frame.h * 0.85 });
        assert.notEqual(cropped, built, `${item.id} si ritaglia`);
        assertSamePhoto(before, shown(cropped, item.id), item.id);
        assertProjectInvariants(cropped, `ritaglio di ${item.id}`);
      }
    }
  }
});
