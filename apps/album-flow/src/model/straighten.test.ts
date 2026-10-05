import { test } from "node:test";
import assert from "node:assert/strict";
import { angleFromLine, placeItem } from "./placement";
import { rotateAssetQuarter } from "./library";
import { appendAssets, setItemView, toggleItemLock } from "./items";
import { addSpread } from "./spreads";
import { setAreaStyle } from "./areas";
import { assertProjectInvariants, makeProject } from "./fixtures";
import { findItem, itemAspect, spreadGeometry, type Project } from "./project";

// Strumenti per raddrizzare e ruotare le foto: la linea sull'orizzonte e la rotazione di 90°.

const near = (a: number, b: number, eps = 0.011) => Math.abs(a - b) < eps;

test("raddrizza con la linea — un orizzonte inclinato diventa orizzontale, in qualunque verso lo si tracci", () => {
  // linea da sinistra a destra che scende di 3°: la foto va ruotata di 3° in senso antiorario (-3°)
  const slope = (deg: number, length = 400) => ({ start: { x: 100, y: 100 }, end: { x: 100 + length * Math.cos((deg * Math.PI) / 180), y: 100 + length * Math.sin((deg * Math.PI) / 180) } });
  for (const deg of [-12, -3, -0.5, 0.5, 1, 3, 12, 30]) {
    const { start, end } = slope(deg);
    assert.ok(near(angleFromLine(start, end, 0)!, -deg), `${deg}°: ${angleFromLine(start, end, 0)}`);
    // tracciata da destra a sinistra dà lo stesso risultato
    assert.ok(near(angleFromLine(end, start, 0)!, -deg), `${deg}° al contrario`);
  }
});

test("raddrizza con la linea — una linea quasi verticale (un edificio) diventa verticale", () => {
  // dall'alto verso il basso e inclinata di 2° verso sinistra: dx < 0
  const top = { x: 200, y: 50 };
  const bottom = { x: 200 - 400 * Math.tan((2 * Math.PI) / 180), y: 450 };
  const a = angleFromLine(top, bottom, 0)!;
  const b = angleFromLine(bottom, top, 0)!;
  assert.ok(near(a, b), "stesso risultato nei due versi");
  assert.ok(Math.abs(a) > 1.9 && Math.abs(a) < 2.1, `circa 2°: ${a}`);
  // verso opposto di inclinazione: segno opposto
  const bottom2 = { x: 200 + 400 * Math.tan((2 * Math.PI) / 180), y: 450 };
  assert.ok(near(angleFromLine(top, bottom2, 0)!, -a), "inclinata dall'altra parte");
});

test("raddrizza con la linea — parte dal raddrizzamento già applicato, resta nei limiti e ignora i punti coincidenti", () => {
  // la foto è già ruotata di 5° e residua un'inclinazione di 2° visibile: il nuovo angolo è 3°
  assert.ok(near(angleFromLine({ x: 0, y: 0 }, { x: 400, y: 400 * Math.tan((2 * Math.PI) / 180) }, 5)!, 3));
  // una linea già orizzontale non cambia nulla
  assert.equal(angleFromLine({ x: 0, y: 10 }, { x: 300, y: 10 }, 7), 7);
  // oltre i limiti si ferma a 45
  assert.equal(angleFromLine({ x: 0, y: 0 }, { x: 400, y: 400 * Math.tan((40 * Math.PI) / 180) }, 30), -10);
  assert.equal(angleFromLine({ x: 0, y: 0 }, { x: 400, y: -400 * Math.tan((40 * Math.PI) / 180) }, 30), 45, "30 + 40 = 70 → 45");
  assert.equal(angleFromLine({ x: 5, y: 5 }, { x: 5, y: 5 }, 3), null);
  assert.equal(angleFromLine({ x: 0, y: 0 }, { x: Number.NaN, y: 1 }, 3), null);
});

function album(photos = 4, mode: "fit" | "fill" = "fill"): Project {
  let project = addSpread(makeProject(photos + 2), 0, "half");
  const id = project.spreads[0].id;
  project = appendAssets(project, id, 0, Array.from({ length: photos }, (_, i) => `a${i}`));
  project = setAreaStyle(project, id, 0, { mode });
  return project;
}
const itemsOf = (project: Project) => project.spreads.flatMap((spread) => spread.areas.flatMap((area) => area.items));

test("ruota la foto di 90° — l'aspetto si scambia, ovunque la foto compaia, e quattro giri riportano tutto com'era", () => {
  for (const mode of ["fill", "fit"] as const) {
    let project = album(4, mode);
    const target = itemsOf(project)[1];
    project = setItemView(project, target.id, { zoom: 2.2, cx: 0.8, cy: 0.3, angle: 3, shape: 1 });
    const original = project;
    const stored = findItem(project, target.id)!.item;
    const asset = (p: Project) => p.assets.find((candidate) => candidate.id === target.assetId)!;
    const aspectBefore = itemAspect(asset(project));

    let turned = project;
    for (let i = 0; i < 4; i += 1) {
      turned = rotateAssetQuarter(turned, target.assetId, 1);
      assertProjectInvariants(turned, `${mode}: giro ${i + 1}`);
      const expected = i % 2 === 0 ? 1 / aspectBefore : aspectBefore;
      assert.ok(Math.abs(itemAspect(asset(turned)) - expected) < 1e-9, `${mode}: aspetto dopo ${i + 1} giri`);
      // zoom, raddrizzamento e forma restano quelli scelti
      const item = findItem(turned, target.id)!.item;
      assert.equal(item.zoom, 2.2);
      assert.equal(item.angle, 3);
      assert.equal(item.shape, 1);
    }
    assert.equal(asset(turned).rotationDegrees, 0, "quattro giri: di nuovo dritta");
    const back = findItem(turned, target.id)!.item;
    assert.ok(Math.abs(back.cx - stored.cx) < 1e-4 && Math.abs(back.cy - stored.cy) < 1e-4, `${mode}: il centro torna dov'era (${back.cx}, ${back.cy}) invece di (${stored.cx}, ${stored.cy})`);

    // a sinistra e poi a destra: identico
    const there = rotateAssetQuarter(original, target.assetId, -1);
    const again = rotateAssetQuarter(there, target.assetId, 1);
    const item = findItem(again, target.id)!.item;
    assert.ok(Math.abs(item.cx - stored.cx) < 1e-4 && Math.abs(item.cy - stored.cy) < 1e-4);
    assert.equal(asset(again).rotationDegrees, 0);
  }
});

test("ruota la foto di 90° — il centro dell'inquadratura ruota con l'immagine (angoli e bordi)", () => {
  const project = album(2);
  const id = itemsOf(project)[0].id;
  const set = (cx: number, cy: number) => setItemView(project, id, { zoom: 2, cx, cy });
  const rotated = (p: Project, quarter: 1 | -1) => {
    const item = findItem(rotateAssetQuarter(p, itemsOf(p)[0].assetId, quarter), id)!.item;
    return [item.cx, item.cy].map((value) => Number(value.toFixed(3)));
  };
  // in alto a sinistra → in alto a destra (senso orario) / in basso a sinistra (antiorario)
  const topLeft = set(0.2, 0.1);
  const stored = findItem(topLeft, id)!.item;
  const [sx, sy] = [stored.cx, stored.cy];
  assert.deepEqual(rotated(topLeft, 1), [Number((1 - sy).toFixed(3)), Number(sx.toFixed(3))]);
  assert.deepEqual(rotated(topLeft, -1), [Number(sy.toFixed(3)), Number((1 - sx).toFixed(3))]);
});

test("ruota la foto di 90° — la foto resta valida ovunque (cella, copertura, risoluzione), anche in «Foto intera» e con la foto bloccata", () => {
  for (const mode of ["fill", "fit"] as const) {
    let project = album(5, mode);
    const first = itemsOf(project)[0];
    project = toggleItemLock(project, first.id);
    for (const quarter of [1, -1, 1, 1] as const) {
      project = rotateAssetQuarter(project, first.assetId, quarter);
      assertProjectInvariants(project, `${mode}: ${quarter}`);
    }
    // la cella e la posizione nello spread non cambiano per una rotazione di tutta la foto
    const cells = spreadGeometry(project, project.spreads[0])[0].cells;
    assert.equal(cells.length, 5);
    const item = findItem(project, first.id)!.item;
    assert.equal(item.locked, true, "la foto resta bloccata");
    const area = project.spreads[0].areas[0];
    const cell = cells.find((candidate) => candidate.itemId === first.id)!;
    const placement = placeItem(cell.rect, item, project.assets.find((asset) => asset.id === first.assetId), area.style, null, cell.anchor);
    assert.ok(placement.dpi > 0);
  }
  // foto inesistente: nessun cambiamento
  const project = album(2);
  assert.equal(rotateAssetQuarter(project, "non-esiste", 1), project);
});

test("ruota la foto di 90° — le altre foto non cambiano e l'orientamento della foto si scambia", () => {
  const project = album(3);
  const [first, second] = itemsOf(project);
  const after = rotateAssetQuarter(project, first.assetId, 1);
  const otherBefore = itemsOf(project).find((item) => item.id === second.id);
  const otherAfter = itemsOf(after).find((item) => item.id === second.id);
  assert.deepEqual(otherAfter, otherBefore, "le altre foto restano come sono");
  const asset = (p: Project, id: string) => p.assets.find((candidate) => candidate.id === id)!;
  assert.notEqual(asset(after, first.assetId).orientation, asset(project, first.assetId).orientation === "square" ? "x" : asset(project, first.assetId).orientation);
  assert.equal(asset(after, second.assetId), asset(project, second.assetId), "le altre foto della libreria non vengono ricreate");
});
