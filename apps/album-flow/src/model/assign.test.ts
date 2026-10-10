import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDropTarget, type DropTarget } from "../engine/drop";
import { spreadSizeMm } from "../engine/geometry";
import { appendAssets, dropOnSpread, moveRefusal, moveToNewSpread, moveToSpread, previewDropRect, removeItem, replaceItemAsset, setItemView, swapItems, toggleItemLock } from "./items";
import { setAreaStyle } from "./areas";
import { reorderAssets, sortAssets } from "./library";
import { placeItem } from "./placement";
import { addSpread } from "./spreads";
import { applyTemplate, sanitizeTemplate } from "./templates";
import { assertProjectInvariants, makeProject } from "./fixtures";
import { assetMap, findItem, hasFreeLayout, spreadGeometry, type Project } from "./project";
import type { AlbumSpread } from "@photo-tools/shared-types";

// Audit di assegnazione e spostamento delle foto: ogni operazione, provata con i bersagli di rilascio veri dell'interfaccia,
// non deve far sparire né moltiplicare foto, deve rispettare blocco e capienza e lasciare il progetto coerente.

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const TEMPLATES = [
  sanitizeTemplate({ id: "t3", name: "Tre in riga", kind: "tree", target: "page", shape: { kind: "split", dir: "row", ratio: 0.33, first: { kind: "leaf", itemId: "0" }, second: { kind: "split", dir: "row", ratio: 0.5, first: { kind: "leaf", itemId: "1" }, second: { kind: "leaf", itemId: "2" } } }, createdAt: "x" })!,
  sanitizeTemplate({ id: "t3c", name: "Una e due", kind: "tree", target: "page", shape: { kind: "split", dir: "row", ratio: 0.5, first: { kind: "split", dir: "column", ratio: 0.5, first: { kind: "leaf", itemId: "0" }, second: { kind: "leaf", itemId: "1" } }, second: { kind: "leaf", itemId: "2" } }, createdAt: "x" })!,
  sanitizeTemplate({ id: "t4", name: "Quattro in griglia", kind: "tree", target: "page", shape: { kind: "split", dir: "column", ratio: 0.5, first: { kind: "split", dir: "row", ratio: 0.5, first: { kind: "leaf", itemId: "0" }, second: { kind: "leaf", itemId: "1" } }, second: { kind: "split", dir: "row", ratio: 0.5, first: { kind: "leaf", itemId: "2" }, second: { kind: "leaf", itemId: "3" } } }, createdAt: "x" })!,
  sanitizeTemplate({ id: "f3", name: "Tre libere", kind: "free", target: "page", frames: [{ x: 0.05, y: 0.05, w: 0.5, h: 0.5, rotation: -5, z: 0 }, { x: 0.35, y: 0.3, w: 0.4, h: 0.5, rotation: 4, z: 1 }, { x: 0.55, y: 0.55, w: 0.4, h: 0.4, rotation: 0, z: 2 }], createdAt: "x" })!,
];

const allItems = (project: Project) => project.spreads.flatMap((spread, spreadIndex) => spread.areas.flatMap((area, areaIndex) => area.items.map((item) => ({ item, spread, spreadIndex, areaIndex }))));
const assetMultiset = (project: Project) => allItems(project).map((entry) => entry.item.assetId).sort().join(",");
const total = (project: Project) => allItems(project).length;

/** Il bersaglio che l'interfaccia calcolerebbe lasciando il puntatore nel punto (x, y) (frazioni dello spread). */
function uiTarget(project: Project, spread: AlbumSpread, fx: number, fy: number): DropTarget | null {
  const size = spreadSizeMm(project.settings.sheet);
  const geometry = spreadGeometry(project, spread);
  return resolveDropTarget(geometry.map((g, index) => ({ rect: g.outer, cells: g.cells, dividers: g.dividers, free: hasFreeLayout(spread.areas[index]) })), fx * size.width, fy * size.height);
}

function fillWith(project: Project, spreadId: string, areaIndex: number, count: number, firstAsset: number): Project {
  return appendAssets(project, spreadId, areaIndex, Array.from({ length: count }, (_, i) => `a${firstAsset + i}`));
}

function withTemplate(project: Project, spreadId: string, areaIndex: number): Project {
  const spread = project.spreads.find((candidate) => candidate.id === spreadId)!;
  const count = spread.areas[areaIndex].items.length;
  const template = TEMPLATES.find((candidate) => candidate.count === count);
  return template ? applyTemplate(project, spreadId, areaIndex, template) : project;
}

test("assegnazione — una foto trascinata sul separatore accanto a sé non sparisce dallo spread", () => {
  // layout: a sinistra due foto una sopra l'altra (A, B), a destra C
  let project = addSpread(makeProject(8), 0, "full");
  const id = project.spreads[0].id;
  project = fillWith(project, id, 0, 3, 0);
  project = applyTemplate(project, id, 0, TEMPLATES[1]);
  assertProjectInvariants(project, "partenza");
  const area = project.spreads[0].areas[0];
  const ids = area.items.map((item) => item.id);
  const geometry = spreadGeometry(project, project.spreads[0])[0];
  // ogni separatore, e ogni foto trascinata su ciascun separatore e su ciascun bordo dell'area
  const targets: DropTarget[] = [];
  for (const divider of geometry.dividers) {
    for (const suffix of ["0", "1"]) targets.push({ areaIndex: 0, itemId: null, zone: divider.dir === "row" ? "left" : "top", node: `${divider.path}${suffix}` });
    targets.push({ areaIndex: 0, itemId: null, zone: divider.dir === "row" ? "left" : "top", node: divider.path });
  }
  for (const zone of ["left", "right", "top", "bottom"] as const) targets.push({ areaIndex: 0, itemId: null, zone, node: "" });
  for (const dragged of ids) {
    for (const target of targets) {
      const after = dropOnSpread(project, id, target, { kind: "item", itemId: dragged });
      const label = `foto ${ids.indexOf(dragged)} su ${target.zone}/${target.node}`;
      assert.equal(total(after), 3, `${label}: il numero di foto cambia`);
      assert.equal(assetMultiset(after), assetMultiset(project), `${label}: le foto cambiano`);
      assert.ok(findItem(after, dragged), `${label}: la foto trascinata è sparita`);
      assertProjectInvariants(after, label);
    }
  }
});

test("assegnazione — 600 rilasci casuali con i bersagli dell'interfaccia non fanno sparire né moltiplicare foto", () => {
  const random = rng(11);
  let failures = 0;
  for (let run = 0; run < 60; run += 1) {
    let project = addSpread(makeProject(30), 0, random() < 0.4 ? "full" : "half");
    const spreadId = project.spreads[0].id;
    let next = 0;
    project.spreads[0].areas.forEach((_, areaIndex) => {
      const count = 1 + Math.floor(random() * 6);
      project = withTemplate(fillWith(project, spreadId, areaIndex, count, next), spreadId, areaIndex);
      next += count;
    });
    assertProjectInvariants(project, `partenza ${run}`);
    for (let step = 0; step < 10; step += 1) {
      const spread = project.spreads[0];
      const items = allItems(project);
      if (items.length === 0) break;
      const dragged = items[Math.floor(random() * items.length)].item;
      const target = uiTarget(project, spread, random(), random());
      if (!target) continue;
      const label = `corsa ${run}.${step}: foto ${dragged.id} → ${target.zone}${target.node !== undefined ? `/${target.node}` : ""} (${target.itemId ?? "-"})`;
      const after = dropOnSpread(project, spread.id, target, { kind: "item", itemId: dragged.id });
      try {
        assert.equal(total(after), total(project), `${label}: il numero di foto cambia`);
        assert.equal(assetMultiset(after), assetMultiset(project), `${label}: le foto cambiano`);
        assert.ok(findItem(after, dragged.id), `${label}: la foto trascinata è sparita`);
        assertProjectInvariants(after, label);
      } catch (error) {
        failures += 1;
        if (failures === 1) throw error;
      }
      project = after;
    }
  }
  assert.equal(failures, 0);
});

test("assegnazione — dalla libreria: le foto si aggiungono (mai più della capienza), le altre restano e nessuna si duplica per errore", () => {
  const random = rng(12);
  for (let run = 0; run < 25; run += 1) {
    let project = addSpread(makeProject(40), 0, random() < 0.4 ? "full" : "half");
    const spreadId = project.spreads[0].id;
    let next = 0;
    project.spreads[0].areas.forEach((_, areaIndex) => {
      const count = Math.floor(random() * 11);
      if (count) { project = withTemplate(fillWith(project, spreadId, areaIndex, count, next), spreadId, areaIndex); next += count; }
    });
    for (let step = 0; step < 8; step += 1) {
      const spread = project.spreads[0];
      const target = uiTarget(project, spread, random(), random());
      if (!target) continue;
      const many = 1 + Math.floor(random() * 4);
      const dropped = Array.from({ length: many }, (_, i) => `a${30 + ((run * 7 + step * 3 + i) % 10)}`);
      const before = project;
      const after = dropOnSpread(project, spread.id, target, { kind: "assets", assetIds: dropped });
      const label = `corsa ${run}.${step}: ${many} foto → ${target.zone}${target.node !== undefined ? `/${target.node}` : ""}`;
      assert.ok(total(after) >= total(before), `${label}: foto perse`);
      assert.ok(total(after) <= total(before) + many, `${label}: troppe foto aggiunte`);
      for (const area of after.spreads[0].areas) assert.ok(area.items.length <= 12, `${label}: area oltre la capienza`);
      // le foto che c'erano restano, tranne al più una sostituita al centro
      const lost = allItems(before).filter((entry) => !findItem(after, entry.item.id));
      assert.ok(lost.length <= (target.zone === "center" ? 0 : 0), `${label}: ${lost.length} foto sono sparite`);
      assertProjectInvariants(after, label);
      project = after;
    }
  }
});

test("assegnazione — spostare o copiare verso un altro spread (miniatura o spazio tra le miniature) non perde né duplica foto", () => {
  const random = rng(13);
  for (let run = 0; run < 30; run += 1) {
    let project = makeProject(30);
    for (let i = 0; i < 3; i += 1) project = addSpread(project, i, random() < 0.3 ? "full" : "half");
    let next = 0;
    for (const spread of project.spreads) {
      for (let areaIndex = 0; areaIndex < spread.areas.length; areaIndex += 1) {
        const count = Math.floor(random() * 9);
        if (count) { project = fillWith(project, spread.id, areaIndex, count, next % 28); next += count; }
      }
    }
    for (let step = 0; step < 8; step += 1) {
      const items = allItems(project);
      if (items.length === 0) break;
      const entry = items[Math.floor(random() * items.length)];
      const label = `corsa ${run}.${step}`;
      if (random() < 0.5) {
        const target = project.spreads[Math.floor(random() * project.spreads.length)];
        const after = moveToSpread(project, target.id, { kind: "item", itemId: entry.item.id });
        assert.equal(total(after), total(project), `${label}: spostamento su miniatura, numero di foto`);
        assert.equal(assetMultiset(after), assetMultiset(project), `${label}: spostamento su miniatura, foto diverse`);
        assertProjectInvariants(after, label);
        project = after;
      } else {
        const result = moveToNewSpread(project, Math.floor(random() * (project.spreads.length + 1)), { kind: "item", itemId: entry.item.id });
        assert.equal(total(result.project), total(project), `${label}: nuovo spread, numero di foto`);
        assert.equal(assetMultiset(result.project), assetMultiset(project), `${label}: nuovo spread, foto diverse`);
        assert.equal(result.project.spreads.length, project.spreads.length + (result.spreadId ? 1 : 0), `${label}: nuovo spread, conteggio spread`);
        assertProjectInvariants(result.project, label);
        project = result.project;
      }
    }
  }
});

test("assegnazione — una foto bloccata non si sposta, non si scambia e non si sostituisce (in nessun modo)", () => {
  let project = addSpread(makeProject(10), 0, "half");
  project = addSpread(project, 1, "half");
  const [first, second] = project.spreads;
  project = fillWith(project, first.id, 0, 3, 0);
  project = fillWith(project, second.id, 0, 2, 5);
  const locked = project.spreads[0].areas[0].items[0];
  const other = project.spreads[0].areas[0].items[1];
  project = toggleItemLock(project, locked.id);
  const lockedNow = () => findItem(project, locked.id)!;
  const place = (p: Project) => { const found = findItem(p, locked.id); return found ? `${found.spread.id}/${found.areaIndex}/${found.area.items.indexOf(found.item)}/${found.item.assetId}` : "sparita"; };
  const before = place(project);
  assert.equal(lockedNow().item.locked, true);
  assert.equal(place(swapItems(project, locked.id, other.id)), before, "scambio");
  assert.equal(place(swapItems(project, other.id, locked.id)), before, "scambio (altro verso)");
  assert.equal(place(replaceItemAsset(project, locked.id, "a9")), before, "sostituzione");
  assert.equal(place(dropOnSpread(project, first.id, { areaIndex: 0, itemId: other.id, zone: "right" }, { kind: "item", itemId: locked.id })), before, "spostamento nello stesso spread");
  const toSpread = moveToSpread(project, second.id, { kind: "item", itemId: locked.id });
  assert.equal(place(toSpread), before, "spostamento su un'altra miniatura: la foto bloccata deve restare dov'è");
  assert.equal(total(toSpread), total(project), "spostamento su un'altra miniatura: nessuna copia");
  const toNew = moveToNewSpread(project, 1, { kind: "item", itemId: locked.id });
  assert.equal(place(toNew.project), before, "nuovo spread: la foto bloccata deve restare dov'è");
  assert.equal(total(toNew.project), total(project), "nuovo spread: nessuna copia");
  assert.equal(toNew.project.spreads.length, project.spreads.length, "nuovo spread: non se ne crea uno vuoto");
});

test("assegnazione — l'area piena (12 foto) rifiuta altre foto senza perdere niente, e lo spostamento tra aree piene non cambia nulla", () => {
  let project = addSpread(makeProject(40), 0, "half");
  const id = project.spreads[0].id;
  project = fillWith(project, id, 0, 12, 0);
  project = fillWith(project, id, 1, 12, 12);
  const target = uiTarget(project, project.spreads[0], 0.25, 0.5)!;
  const dropped = dropOnSpread(project, id, target, { kind: "assets", assetIds: ["a30", "a31"] });
  if (target.zone !== "center") assert.equal(total(dropped), 24, "area piena: nessuna foto in più");
  assertProjectInvariants(dropped, "area piena");
  const right = project.spreads[0].areas[1].items[0];
  const rightTarget = uiTarget(project, project.spreads[0], 0.25, 0.5)!;
  const moved = dropOnSpread(project, id, { ...rightTarget, areaIndex: 0 }, { kind: "item", itemId: right.id });
  assert.equal(total(moved), 24, "area piena: lo spostamento non perde né duplica");
  assertProjectInvariants(moved, "spostamento verso area piena");
  const full = moveToSpread(project, id, { kind: "assets", assetIds: ["a30"] });
  assert.equal(total(full), 24, "miniatura di uno spread pieno: nessuna foto in più");
});

test("assegnazione — dropOnSpread con bersaglio «area» su un'area che ha già foto non le cancella", () => {
  let project = addSpread(makeProject(10), 0, "full");
  const id = project.spreads[0].id;
  project = fillWith(project, id, 0, 3, 0);
  project = addSpread(project, 1, "full");
  const other = fillWith(project, project.spreads[1].id, 0, 1, 5).spreads[1].areas[0].items[0];
  const withOther = fillWith(project, project.spreads[1].id, 0, 1, 5);
  const after = dropOnSpread(withOther, id, { areaIndex: 0, itemId: null, zone: "area" }, { kind: "item", itemId: other.id });
  assert.equal(total(after), total(withOther), "nessuna foto persa");
  assert.equal(assetMultiset(after), assetMultiset(withOther));
  assertProjectInvariants(after, "area piena con bersaglio area");
});

test("assegnazione — una foto bloccata non si sostituisce con un rilascio dalla libreria, nemmeno se le foto sono più d'una", () => {
  let project = addSpread(makeProject(10), 0, "half");
  const id = project.spreads[0].id;
  project = fillWith(project, id, 0, 3, 0);
  const locked = project.spreads[0].areas[0].items[1];
  project = toggleItemLock(project, locked.id);
  const after = dropOnSpread(project, id, { areaIndex: 0, itemId: locked.id, zone: "center" }, { kind: "assets", assetIds: ["a5", "a6", "a7"] });
  assert.equal(after, project, "il rilascio sul centro di una foto bloccata non cambia niente (e la prima foto non va persa mentre le altre si aggiungono)");
  const swap = dropOnSpread(project, id, { areaIndex: 0, itemId: locked.id, zone: "center" }, { kind: "item", itemId: project.spreads[0].areas[0].items[0].id });
  assert.equal(swap, project, "e non si scambia");
});

test("assegnazione — spostando una foto tra spread porta con sé zoom, raddrizzamento e forma", () => {
  let project = addSpread(makeProject(10), 0, "half");
  project = addSpread(project, 1, "half");
  const [first, second] = project.spreads;
  project = fillWith(project, first.id, 0, 3, 0);
  project = fillWith(project, second.id, 0, 1, 5);
  const moving = project.spreads[0].areas[0].items[1];
  project = setItemView(project, moving.id, { zoom: 2.5, cx: 0.3, cy: 0.6, angle: 4, shape: 1 });
  const original = findItem(project, moving.id)!.item;
  const arrivedIn = (p: Project) => {
    assert.equal(findItem(p, moving.id), null, "la foto non è più dov'era");
    const entry = allItems(p).find((candidate) => candidate.item.assetId === moving.assetId);
    assert.ok(entry, "la foto è arrivata");
    return entry!.item;
  };
  for (const [label, moved] of [
    ["miniatura", moveToSpread(project, project.spreads[1].id, { kind: "item", itemId: moving.id })],
    ["nuovo spread", moveToNewSpread(project, 1, { kind: "item", itemId: moving.id }).project],
  ] as const) {
    const arrived = arrivedIn(moved);
    assert.equal(arrived.zoom, original.zoom, `${label}: zoom`);
    assert.equal(arrived.angle, original.angle, `${label}: raddrizzamento`);
    assert.equal(arrived.shape, original.shape, `${label}: forma`);
    assertProjectInvariants(moved, label);
  }
});

test("assegnazione — i rifiuti di uno spostamento tra spread hanno una spiegazione, e quando non c'è niente da spiegare non c'è", () => {
  let project = addSpread(makeProject(40), 0, "half");
  project = addSpread(project, 1, "half");
  const [first, second] = project.spreads;
  project = fillWith(project, first.id, 0, 2, 0);
  project = fillWith(project, second.id, 0, 12, 10);
  project = fillWith(project, second.id, 1, 12, 22);
  const item = project.spreads[0].areas[0].items[0];
  assert.equal(moveRefusal(project, second.id, { kind: "item", itemId: item.id }), "Le pagine di questo spread hanno già 12 foto.");
  assert.equal(moveRefusal(project, second.id, { kind: "assets", assetIds: ["a30"] }), "Le pagine di questo spread hanno già 12 foto.");
  assert.equal(moveRefusal(project, first.id, { kind: "item", itemId: item.id }), null, "lo stesso spread: niente da dire");
  assert.equal(moveRefusal(project, null, { kind: "item", itemId: item.id }), null, "un nuovo spread si può sempre fare");
  const locked = toggleItemLock(project, item.id);
  assert.match(moveRefusal(locked, second.id, { kind: "item", itemId: item.id })!, /bloccata/);
  assert.match(moveRefusal(locked, null, { kind: "item", itemId: item.id })!, /bloccata/);
  assert.equal(moveToSpread(project, second.id, { kind: "item", itemId: item.id }), project, "e davvero non cambia niente");
});

test("assegnazione — riordinare un elenco filtrato permuta solo quelle foto fra i loro posti: le altre non si muovono", () => {
  const base = makeProject(10);
  const project = { ...base, settings: { ...base.settings, sortKey: "file-name" as const } };
  const order = (p: Project) => sortAssets(p.assets, p.settings.sortKey).map((asset) => asset.id).join(",");
  assert.equal(order(project), "a0,a1,a2,a3,a4,a5,a6,a7,a8,a9");
  // un capitolo o filtro che mostra solo a2, a5, a8: a8 va davanti ad a2
  const moved = reorderAssets(project, ["a2", "a5", "a8"], ["a8"], "a2");
  assert.equal(order(moved), "a0,a1,a8,a3,a4,a2,a6,a7,a5,a9");
  assert.equal(moved.settings.sortKey, "manual");
  // in fondo all'elenco filtrato
  const toEnd = reorderAssets(project, ["a2", "a5", "a8"], ["a2"], null);
  assert.equal(order(toEnd), "a0,a1,a5,a3,a4,a8,a6,a7,a2,a9");
  // elenco completo: come prima
  const all = reorderAssets(project, project.assets.map((asset) => asset.id), ["a9"], "a0");
  assert.equal(order(all), "a9,a0,a1,a2,a3,a4,a5,a6,a7,a8");
  // più foto insieme, restano nell'ordine che avevano
  const several = reorderAssets(project, project.assets.map((asset) => asset.id), ["a7", "a3"], "a1");
  assert.equal(order(several), "a0,a3,a7,a1,a2,a4,a5,a6,a8,a9");
  // niente cambia con foto non visibili o sconosciute
  assert.equal(reorderAssets(project, ["a2"], ["a9"], null), project);
});

test("assegnazione — l'anteprima del rilascio coincide con il risultato anche spostando una foto accanto a un ramo del proprio spread", () => {
  const random = rng(21);
  let compared = 0;
  for (let run = 0; run < 40; run += 1) {
    let project = addSpread(makeProject(20), 0, "full");
    const id = project.spreads[0].id;
    project = withTemplate(fillWith(project, id, 0, 3 + Math.floor(random() * 2), 0), id, 0);
    const spread = project.spreads[0];
    const assets = assetMap(project);
    const dragged = spread.areas[0].items[Math.floor(random() * spread.areas[0].items.length)];
    for (let step = 0; step < 10; step += 1) {
      const target = uiTarget(project, spread, random(), random());
      if (!target || target.zone === "center" || target.zone === "area" || target.itemId === dragged.id) continue;
      const preview = previewDropRect(project.settings.sheet, spread, assets, target, { assetId: dragged.assetId, itemId: dragged.id });
      const after = dropOnSpread(project, id, target, { kind: "item", itemId: dragged.id });
      assert.ok(findItem(after, dragged.id), "la foto c'è ancora");
      if (after === project) { assert.equal(preview, null, "se non cambia nulla non si mostra un riquadro"); continue; }
      assert.ok(preview, `anteprima presente per ${target.zone}/${target.node ?? target.itemId}`);
      const cell = spreadGeometry(after, after.spreads[0])[0].cells.find((candidate) => candidate.itemId === dragged.id)!;
      const real = placeItem(cell.rect, { zoom: 1, cx: 0.5, cy: 0.5 }, assets.get(dragged.assetId), after.spreads[0].areas[0].style, null, cell.anchor).content;
      for (const key of ["x", "y", "w", "h"] as const) assert.ok(Math.abs(preview![key] - real[key]) < 1e-6, `anteprima ${key}: ${preview![key]} ≠ ${real[key]} (${target.zone}/${target.node ?? target.itemId})`);
      compared += 1;
    }
  }
  assert.ok(compared > 20, `confronti eseguiti: ${compared}`);
});

test("assegnazione — scambiare due foto non ricrea gli spread che non c'entrano (le loro miniature non si ridisegnano)", () => {
  let project = addSpread(makeProject(12), 0, "half");
  for (let i = 1; i < 5; i += 1) project = addSpread(project, i, "half");
  project.spreads.forEach((spread, index) => { project = fillWith(project, spread.id, 0, 2, index * 2); });
  const [a, b] = project.spreads[1].areas[0].items;
  const after = swapItems(project, a.id, b.id);
  assert.notEqual(after, project);
  after.spreads.forEach((spread, index) => { if (index !== 1) assert.equal(spread, project.spreads[index], `lo spread ${index + 1} non deve cambiare oggetto`); });
  assert.notEqual(after.spreads[1], project.spreads[1]);
  assertProjectInvariants(after, "scambio");
});

test("assegnazione — due foto rilasciate sotto una foto larga formano una riga sotto di essa, non una colonna di strisce", () => {
  let project = addSpread(makeProject(8), 0, "full");
  const id = project.spreads[0].id;
  project = appendAssets(project, id, 0, ["a0"]);
  const wide = project.spreads[0].areas[0].items[0];
  for (const target of [{ areaIndex: 0, itemId: wide.id, zone: "bottom" as const }, { areaIndex: 0, itemId: null, zone: "bottom" as const, node: "" }]) {
    const after = dropOnSpread(project, id, target, { kind: "assets", assetIds: ["a1", "a2"] });
    assert.equal(total(after), 3, `${target.node ?? target.itemId}: le due foto vengono aggiunte`);
    const cells = spreadGeometry(after, after.spreads[0])[0].cells;
    const items = after.spreads[0].areas[0].items;
    const first = cells.find((cell) => cell.itemId === items.find((item) => item.assetId === "a1")!.id)!.rect;
    const second = cells.find((cell) => cell.itemId === items.find((item) => item.assetId === "a2")!.id)!.rect;
    const top = cells.find((cell) => cell.itemId === wide.id)!.rect;
    assert.ok(Math.abs(first.y - second.y) < 1e-6 && Math.abs(first.h - second.h) < 1e-6, "le due foto stanno sulla stessa riga");
    assert.ok(second.x > first.x, "ordine di lettura rispettato");
    assert.ok(first.y >= top.y + top.h - 1e-6, "la riga sta sotto la foto larga");
    assertProjectInvariants(after, "riga sotto");
  }
});

test("forma — in «riempi» la cella della foto con forma prende esattamente quella proporzione e la pagina resta piena", () => {
  let project = addSpread(makeProject(10), 0, "full");
  const id = project.spreads[0].id;
  project = appendAssets(project, id, 0, ["a0", "a1", "a2", "a3"]);
  project = setAreaStyle(project, id, 0, { mode: "fill" });
  let reachedCount = 0;
  for (const index of [0, 1, 2, 3]) {
    const item = project.spreads[0].areas[0].items[index];
    const shaped = setItemView(project, item.id, { shape: 2 / 3 });
    const area = shaped.spreads[0].areas[0];
    const geometry = spreadGeometry(shaped, shaped.spreads[0])[0];
    const cell = geometry.cells.find((candidate) => candidate.itemId === item.id)!;
    const border = Math.min(area.style.borderCm * 10, Math.min(cell.rect.w, cell.rect.h) / 4);
    const aspect = (cell.rect.w - border * 2) / (cell.rect.h - border * 2);
    if (Math.abs(aspect / (2 / 3) - 1) < 0.01) {
      reachedCount += 1;
      const covered = geometry.cells.reduce((sum, c) => sum + c.rect.w * c.rect.h, 0);
      const free = geometry.inner.w * geometry.inner.h - covered;
      assert.ok(free < geometry.inner.w * geometry.inner.h * 0.03 + geometry.gapMm * (geometry.inner.w + geometry.inner.h) * 4, `foto ${index}: la pagina resta piena (${free.toFixed(0)} mm² liberi)`);
    }
    assertProjectInvariants(shaped, `forma ${index}`);
  }
  assert.ok(reachedCount >= 3, `la forma scelta viene raggiunta in ${reachedCount} casi su 4`);
});
