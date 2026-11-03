import { test } from "node:test";
import assert from "node:assert/strict";
import { alignRects, distributeRects, gapMeasures, groupScaleFactor, marqueeHits, rectFromPoints, scaleRects, unionRect } from "../engine/arrange";
import { addSpread } from "./spreads";
import { appendAssets } from "./items";
import { makeAreaFree, setAreaLocked } from "./layoutLock";
import { alignFrames, distributeFrames, duplicateFrames, movableFrames, nudgeFrames } from "./freeGroup";
import { makeAsset, makeProject } from "./fixtures";
import { findItem, type Project } from "./project";
import { setItemBorder } from "./items";

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

test("selezione a rettangolo: basta sfiorare una foto, in qualunque direzione si trascini", () => {
  const items = [{ id: "a", rect: box(0, 0, 50, 50) }, { id: "b", rect: box(100, 0, 50, 50) }, { id: "c", rect: box(0, 100, 50, 50) }];
  assert.deepEqual(marqueeHits(rectFromPoints(40, 40, -10, -10), items), ["a"]);
  assert.deepEqual(marqueeHits(rectFromPoints(140, 10, 20, 20), items), ["a", "b"], "trascinando da destra a sinistra");
  assert.deepEqual(marqueeHits(rectFromPoints(60, 60, 90, 90), items), [], "spazio vuoto: nessuna foto");
  assert.deepEqual(marqueeHits(rectFromPoints(-5, -5, 200, 200), items), ["a", "b", "c"]);
});

test("allinea: bordi e centri del riquadro del gruppo, senza cambiare le misure", () => {
  const items = [{ id: "a", rect: box(10, 20, 40, 30) }, { id: "b", rect: box(100, 60, 20, 50) }];
  const union = unionRect(items.map((i) => i.rect));
  assert.deepEqual(union, box(10, 20, 110, 90));
  const by = (mode: Parameters<typeof alignRects>[1]) => new Map(alignRects(items, mode).map((i) => [i.id, i.rect]));
  assert.equal(by("left").get("b")!.x, 10);
  assert.equal(by("right").get("a")!.x, 80);
  assert.equal(by("hcenter").get("b")!.x, 55);
  assert.equal(by("top").get("b")!.y, 20);
  assert.equal(by("bottom").get("a")!.y, 80);
  assert.equal(by("vcenter").get("a")!.y, 50);
  for (const mode of ["left", "right", "hcenter", "top", "bottom", "vcenter"] as const) {
    for (const moved of alignRects(items, mode)) {
      const original = items.find((i) => i.id === moved.id)!.rect;
      assert.equal(moved.rect.w, original.w); assert.equal(moved.rect.h, original.h);
    }
  }
  assert.deepEqual(alignRects([items[0]], "left")[0].rect, items[0].rect, "con una foto sola non cambia nulla");
});

test("distribuisci: stesso spazio tra le foto, estremi fermi, ordine per posizione e non per selezione", () => {
  const items = [{ id: "c", rect: box(200, 0, 20, 10) }, { id: "a", rect: box(0, 0, 30, 10) }, { id: "b", rect: box(40, 0, 50, 10) }];
  const out = new Map(distributeRects(items, "x").map((i) => [i.id, i.rect]));
  assert.equal(out.get("a")!.x, 0);
  assert.equal(out.get("c")!.x, 200);
  const gapAB = out.get("b")!.x - (out.get("a")!.x + 30);
  const gapBC = out.get("c")!.x - (out.get("b")!.x + 50);
  assert.ok(Math.abs(gapAB - gapBC) < 1e-9, "spazi uguali");
  assert.equal(distributeRects(items.slice(0, 2), "x")[0].rect.x, 200, "con due foto non cambia nulla");
});

test("ridimensionamento di gruppo: tutto cresce insieme rispetto all'angolo opposto, proporzioni e disposizione relativa invariate", () => {
  const items = [{ id: "a", rect: box(10, 20, 40, 30) }, { id: "b", rect: box(60, 20, 30, 60) }];
  const anchor = { x: 10, y: 20 };
  const doubled = new Map(scaleRects(items, anchor, 2).map((i) => [i.id, i.rect]));
  assert.deepEqual(doubled.get("a"), box(10, 20, 80, 60), "la foto sull'angolo fermo resta lì e raddoppia");
  assert.deepEqual(doubled.get("b"), box(110, 20, 60, 120));
  const union = unionRect([...doubled.values()]);
  assert.deepEqual(union, box(10, 20, 160, 120), "il riquadro del gruppo raddoppia");
  for (const entry of scaleRects(items, anchor, 0.5)) {
    const original = items.find((i) => i.id === entry.id)!.rect;
    assert.ok(Math.abs(entry.rect.w / entry.rect.h - original.w / original.h) < 1e-9, "proporzioni invariate");
  }
  const group = unionRect(items.map((i) => i.rect));
  assert.equal(groupScaleFactor(group, 1, 1, 40, 0, 0.1), (group.w + 40) / group.w, "maniglia in basso a destra: trascinare a destra allarga");
  assert.equal(groupScaleFactor(group, -1, -1, 40, 40, 0.1), Math.max((group.w - 40) / group.w, (group.h - 40) / group.h), "maniglia in alto a sinistra: verso l'interno rimpicciolisce");
  assert.equal(groupScaleFactor(group, 1, 1, -1000, -1000, 0.25), 0.25, "mai sotto il minimo");
});

test("distanze: lo spazio con la foto più vicina in ogni direzione, solo tra foto che si fronteggiano", () => {
  const me = box(100, 100, 50, 50);
  const others = [box(200, 110, 30, 30), box(300, 120, 30, 10), box(10, 90, 40, 70), box(110, 200, 30, 30), box(120, 0, 10, 60), box(400, 400, 20, 20)];
  const gaps = gapMeasures(me, others);
  const by = (axis: "x" | "y", at: (g: ReturnType<typeof gapMeasures>[number]) => boolean) => gaps.find((g) => g.axis === axis && at(g));
  assert.equal(gaps.length, 4, "la foto in diagonale non conta; di due foto sullo stesso lato conta la più vicina");
  assert.equal(by("x", (g) => g.from === 150)!.mm, 50, "a destra: la più vicina, non la seconda");
  assert.equal(by("x", (g) => g.to === 100)!.mm, 50, "a sinistra");
  assert.equal(by("y", (g) => g.from === 150)!.mm, 50, "sotto");
  assert.equal(by("y", (g) => g.to === 100)!.mm, 40, "sopra");
  assert.equal(by("x", (g) => g.from === 150)!.at, 125, "il tratto passa a metà della parte in comune");
  assert.deepEqual(gapMeasures(me, [box(120, 120, 50, 50)]), [], "foto sovrapposte: nessuna distanza");
  assert.deepEqual(gapMeasures(me, [box(150, 100, 50, 50)]), [], "bordi a contatto: nessuna distanza da mostrare");
});

function freeAlbum(count: number): { project: Project; ids: string[] } {
  let project = makeProject(count + 2);
  project = { ...project, assets: Array.from({ length: count + 2 }, (_, i) => makeAsset(i)) };
  project = addSpread(project, 0, "half");
  const spreadId = project.spreads[0].id;
  project = appendAssets(project, spreadId, 0, Array.from({ length: count }, (_, i) => `a${i}`));
  project = makeAreaFree(project, spreadId, 0);
  return { project, ids: project.spreads[0].areas[0].items.map((item) => item.id) };
}

test("freccette e allinea sul progetto: spostano tutte le foto libere, rispettano il blocco di foto e pagina", () => {
  const { project, ids } = freeAlbum(4);
  const before = new Map(movableFrames(project, ids).map((f) => [f.id, f.rect]));
  assert.equal(before.size, 4);

  const nudged = nudgeFrames(project, ids, 5, -3);
  for (const frame of movableFrames(nudged, ids)) {
    const old = before.get(frame.id)!;
    assert.ok(Math.abs(frame.rect.x - old.x - 5) < 0.05 && Math.abs(frame.rect.y - old.y + 3) < 0.05, "spostata di 5 mm a destra e 3 in su");
    assert.ok(Math.abs(frame.rect.w - old.w) < 0.05, "misure invariate");
  }

  const aligned = alignFrames(project, ids, "left");
  const lefts = movableFrames(aligned, ids).map((f) => f.rect.x);
  assert.ok(Math.max(...lefts) - Math.min(...lefts) < 0.05, "bordi sinistri sulla stessa linea");

  const distributed = distributeFrames(project, ids, "y");
  const rows = movableFrames(distributed, ids).sort((a, b) => a.rect.y - b.rect.y);
  const gaps = rows.slice(1).map((frame, i) => frame.rect.y - (rows[i].rect.y + rows[i].rect.h));
  assert.ok(Math.max(...gaps) - Math.min(...gaps) < 0.1, "spazi verticali uguali");

  const spreadId = project.spreads[0].id;
  const locked = setAreaLocked(project, spreadId, 0, true);
  assert.equal(movableFrames(locked, ids).length, 0, "pagina con il layout bloccato: nessuna foto si muove");
  assert.equal(nudgeFrames(locked, ids, 20, 20), locked);
});

test("duplica trascinando: la copia nasce nel punto scelto con inquadratura, bordo e rotazione dell'originale; l'originale non si muove", () => {
  const { project: start, ids } = freeAlbum(3);
  const withBorder = setItemBorder(start, ids[0], { cm: 0.4, color: "#aa2233" });
  const original = movableFrames(withBorder, [ids[0]])[0].rect;
  const target = { ...original, x: original.x + 30, y: original.y + 20 };
  const duplicated = duplicateFrames(withBorder, [{ id: ids[0], rect: target }]);
  const spread = duplicated.spreads[0];
  assert.equal(spread.areas[0].items.length, 4, "una foto in più");
  const created = spread.areas[0].items.find((item) => !ids.includes(item.id))!;
  assert.equal(created.assetId, findItem(withBorder, ids[0])!.item.assetId, "stessa foto");
  assert.equal(created.borderCm, 0.4, "stesso bordo");
  const [moved] = movableFrames(duplicated, [created.id]);
  assert.ok(Math.abs(moved.rect.x - target.x) < 0.05 && Math.abs(moved.rect.y - target.y) < 0.05 && Math.abs(moved.rect.w - target.w) < 0.05, "nel rettangolo scelto");
  const again = movableFrames(duplicated, [ids[0]])[0].rect;
  assert.deepEqual(again, original, "l'originale resta dov'è");
  const z = (itemId: string) => spread.areas[0].free![itemId].z;
  assert.ok(z(created.id) > Math.max(...ids.map(z)), "la copia sta davanti alle altre");

  const locked = setAreaLocked(withBorder, withBorder.spreads[0].id, 0, true);
  assert.equal(duplicateFrames(locked, [{ id: ids[0], rect: target }]), locked, "pagina bloccata: nessuna copia");
  let full = freeAlbum(12).project;
  const fullIds = full.spreads[0].areas[0].items.map((item) => item.id);
  assert.equal(full.spreads[0].areas[0].items.length, 12);
  full = duplicateFrames(full, [{ id: fullIds[0], rect: target }]);
  assert.equal(full.spreads[0].areas[0].items.length, 12, "pagina piena: nessuna copia");
});

test("duplica: una copia sopra l'originale (Ctrl+clic con un tremito) non si crea", () => {
  const { project, ids } = freeAlbum(3);
  const original = movableFrames(project, [ids[0]])[0].rect;
  assert.equal(duplicateFrames(project, [{ id: ids[0], rect: { ...original, x: original.x + 1, y: original.y - 1 } }]), project);
  assert.notEqual(duplicateFrames(project, [{ id: ids[0], rect: { ...original, x: original.x + 5 } }]), project);
});
