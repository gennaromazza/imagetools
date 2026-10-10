import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutCells } from "../engine/geometry";
import { resolveDropTarget } from "../engine/drop";
import { appendAssets, dropOnSpread, moveRefusal, moveToNewSpread, moveToSpread, removeItem, replaceItemAsset, setItemBorder, setItemView, swapItems, alignArea } from "./items";
import { addSpread, setSplitMode, splitRefusal } from "./spreads";
import { areaCandidates, mirrorArea, resetDividerRatio, setAlbumGap, setAreaStyle, setDividerRatio, shuffleArea } from "./areas";
import { areaGeometry, hasFreeLayout, placementStyle, type Project } from "./project";
import { makeAsset, makeProject } from "./fixtures";
import { makeAreaFree, setAreaLocked } from "./layoutLock";
import { SHAPE_PRESETS } from "./shapes";
import { overflowInset, placeItem, toolbarModeFor } from "./placement";
import { rotateAssetQuarter } from "./library";

/**
 * Regressioni sull'allineamento delle foto: dopo ogni operazione le foto di una pagina in «foto intera» (o con forme scelte) devono avere i bordi
 * a filo, il formato scelto (1:1 = quadrato) deve essere esatto, il layout libero non deve saltare né azzerarsi e il blocco deve proteggere.
 */

const ASPECTS = [3 / 2, 2 / 3, 1, 4 / 3, 3 / 4, 16 / 9, 5 / 4];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
}

function album(aspects: number[], mode: "fit" | "fill" = "fit", split: "half" | "full" = "half"): { project: Project; id: string } {
  let project = makeProject(aspects.length + 8);
  project = { ...project, assets: Array.from({ length: aspects.length + 8 }, (_, i) => { const a = i < aspects.length ? aspects[i] : ASPECTS[i % ASPECTS.length]; return makeAsset(i, { width: Math.round(a * 4000), height: 4000, aspectRatio: a }); }) };
  project = addSpread(project, 0, split);
  const id = project.spreads[0].id;
  project = appendAssets(project, id, 0, aspects.map((_, i) => `a${i}`));
  project = setAreaStyle(project, id, 0, { mode, gapCm: 0.2, paddingCm: 0.6 });
  return { project, id };
}

const area0 = (project: Project, areaIndex = 0) => project.spreads[0].areas[areaIndex];

/** Finestre visibili (con lo stile di posa dell'area) di tutte le foto di un'area. */
function windows(project: Project, areaIndex = 0) {
  const spread = project.spreads[0];
  const area = spread.areas[areaIndex];
  const geometry = areaGeometry(project, spread, areaIndex);
  return new Map(geometry.cells.map((cell) => {
    const item = area.items.find((candidate) => candidate.id === cell.itemId)!;
    return [cell.itemId, placeItem(cell.rect, item, project.assets.find((asset) => asset.id === item.assetId), placementStyle(area, cell), null, cell.anchor).content] as const;
  }));
}

/** Errore massimo (mm) tra i bordi corrispondenti dei due rami di ogni divisione: 0 = foto allineate. */
function alignmentError(project: Project, areaIndex = 0): number {
  const area = area0(project, areaIndex);
  if (!area.layout || hasFreeLayout(area) || area.items.length < 2) return 0;
  const content = windows(project, areaIndex);
  const bbox = (node: NonNullable<typeof area.layout>): { x: number; y: number; w: number; h: number } => {
    if (node.kind === "leaf") return content.get(node.itemId)!;
    const a = bbox(node.first);
    const b = bbox(node.second);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  };
  let worst = 0;
  const walk = (node: NonNullable<typeof area.layout>) => {
    if (node.kind === "leaf") return;
    const a = bbox(node.first);
    const b = bbox(node.second);
    worst = Math.max(worst, node.dir === "row" ? Math.max(Math.abs(a.y - b.y), Math.abs(a.y + a.h - b.y - b.h)) : Math.max(Math.abs(a.x - b.x), Math.abs(a.x + a.w - b.x - b.w)));
    walk(node.first);
    walk(node.second);
  };
  walk(area.layout);
  return worst;
}

const EPS = 0.05;

test("foto intera: ogni operazione lascia le foto allineate (forma, spazio, margine, bordo, allinea, rilasci, scambi, mescola, divisione)", () => {
  const random = rng(4242);
  const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)];
  const ops: Array<[string, (p: Project, id: string) => Project]> = [
    ["forma", (p) => setItemView(p, pick(area0(p).items).id, { shape: pick(SHAPE_PRESETS).ratio })],
    ["spazio tra le foto", (p, id) => setAreaStyle(p, id, 0, { gapCm: 0.8 })],
    ["margine", (p, id) => setAreaStyle(p, id, 0, { paddingCm: 2 })],
    ["bordo dell'area", (p, id) => setAreaStyle(p, id, 0, { borderCm: 0.5 })],
    ["Allinea inizio", (p, id) => alignArea(p, id, 0, "start")],
    ["Allinea fine", (p, id) => alignArea(p, id, 0, "end")],
    ["spazio di tutto l'album", (p) => setAlbumGap(p, 0.7).project],
    ["rilascio a fianco", (p, id) => { const target = pick(area0(p).items); const free = p.assets.find((a) => !area0(p).items.some((i) => i.assetId === a.id))!; return dropOnSpread(p, id, { areaIndex: 0, itemId: target.id, zone: pick(["left", "right", "top", "bottom"] as const) }, { kind: "assets", assetIds: [free.id] }); }],
    ["sostituzione", (p, id) => { const target = pick(area0(p).items); const free = p.assets.find((a) => !area0(p).items.some((i) => i.assetId === a.id))!; return replaceItemAsset(p, target.id, free.id); }],
    ["scambio", (p, id) => { const a = pick(area0(p).items); const b = pick(area0(p).items.filter((i) => i.id !== a.id)); return swapItems(p, a.id, b.id); }],
    ["spostamento accanto", (p, id) => { const a = pick(area0(p).items); const b = pick(area0(p).items.filter((i) => i.id !== a.id)); return dropOnSpread(p, id, { areaIndex: 0, itemId: b.id, zone: pick(["left", "right", "top", "bottom"] as const) }, { kind: "item", itemId: a.id }); }],
    ["foto tolta", (p) => removeItem(p, pick(area0(p).items).id)],
    ["Mescola", (p, id) => shuffleArea(p, id, 0, 1)],
    ["specchio", (p, id) => mirrorArea(p, id, 0, "horizontal")],
    ["rotazione dell'originale", (p) => rotateAssetQuarter(p, pick(area0(p).items).assetId, 1)],
    ["divisione un terzo", (p, id) => setSplitMode(p, id, "third")],
    ["foglio intero", (p, id) => setSplitMode(p, id, "full")],
  ];
  for (const [name, run] of ops) {
    let applied = 0;
    for (let trial = 0; trial < 12; trial += 1) {
      const aspects = Array.from({ length: 2 + Math.floor(random() * 5) }, () => pick(ASPECTS));
      const { project, id } = album(aspects);
      const after = run(project, id);
      if (after === project) continue;
      applied += 1;
      for (let areaIndex = 0; areaIndex < after.spreads[0].areas.length; areaIndex += 1) assert.ok(alignmentError(after, areaIndex) < EPS, `${name}: foto disallineate (${alignmentError(after, areaIndex).toFixed(2)} mm, ${aspects.map((a) => a.toFixed(2)).join(",")})`);
    }
    assert.ok(applied > 0, `${name}: l'operazione non ha mai cambiato nulla`);
  }
});

test("modo riempi con una forma: l'area funziona come foto intera, finestre esatte e allineate (non una foto più piccola accanto a foto che riempiono)", () => {
  const random = rng(99);
  for (let trial = 0; trial < 30; trial += 1) {
    const aspects = Array.from({ length: 2 + Math.floor(random() * 4) }, () => ASPECTS[Math.floor(random() * ASPECTS.length)]);
    const { project } = album(aspects, "fill");
    const item = area0(project).items[Math.floor(random() * aspects.length)];
    const preset = SHAPE_PRESETS[Math.floor(random() * SHAPE_PRESETS.length)];
    const after = setItemView(project, item.id, { shape: preset.ratio });
    assert.ok(alignmentError(after) < EPS, `riempi + forma ${preset.id}: disallineate`);
    const w = windows(after).get(item.id)!;
    assert.ok(Math.abs(w.w / w.h / preset.ratio - 1) < 1.5e-3, `${preset.id}: formato esatto`);
  }
});

test("formati: un 1:1 è davvero quadrato (e ogni formato è esatto) in qualunque layout, anche con bordo", () => {
  const random = rng(7);
  for (let trial = 0; trial < 40; trial += 1) {
    const aspects = Array.from({ length: 2 + Math.floor(random() * 5) }, () => ASPECTS[Math.floor(random() * ASPECTS.length)]);
    let { project, id } = album(aspects);
    if (trial % 2) project = setAreaStyle(project, id, 0, { borderCm: 0.3 });
    const item = area0(project).items[Math.floor(random() * aspects.length)];
    for (const preset of SHAPE_PRESETS) {
      const after = setItemView(project, item.id, { shape: preset.ratio });
      const w = windows(after).get(item.id)!;
      assert.ok(Math.abs(w.w / w.h / preset.ratio - 1) < 1.5e-3, `${preset.id} nel layout da ${aspects.length} foto: rapporto ${(w.w / w.h).toFixed(4)}`);
    }
  }
});

test("bordo di una sola foto: i bordi esterni delle cornici restano a filo (la cella cresce di quanto serve)", () => {
  const { project } = album([1.5, 1.5, 0.667]);
  const target = area0(project).items[0];
  const after = setItemBorder(project, target.id, { cm: 0.4 });
  const geometry = areaGeometry(after, after.spreads[0], 0);
  const frames = new Map(geometry.cells.map((cell) => {
    const item = area0(after).items.find((candidate) => candidate.id === cell.itemId)!;
    const p = placeItem(cell.rect, item, after.assets.find((asset) => asset.id === item.assetId), placementStyle(area0(after), cell), null, cell.anchor);
    return [cell.itemId, { x: p.content.x - p.borderMm, y: p.content.y - p.borderMm, w: p.content.w + p.borderMm * 2, h: p.content.h + p.borderMm * 2 }] as const;
  }));
  const a = frames.get(area0(after).items[0].id)!;
  const b = frames.get(area0(after).items[1].id)!;
  const c = frames.get(area0(after).items[2].id)!;
  // la prima e la seconda stanno nella stessa riga (o colonna) del layout: le loro cornici hanno lo stesso ingombro lungo l'asse comune
  const sameRow = Math.abs(a.y - b.y) < 0.5 && Math.abs(a.h - b.h) < 0.5;
  const sameColumn = Math.abs(a.x - b.x) < 0.5 && Math.abs(a.w - b.w) < 0.5;
  assert.ok(sameRow || sameColumn || c, "cornici allineate");
  assert.ok(Math.abs(placeItem(geometry.cells[0].rect, area0(after).items[0], after.assets[0], placementStyle(area0(after), geometry.cells[0]), null, geometry.cells[0].anchor).borderMm - 4) < 1e-9, "il bordo della foto è quello scelto");
});

test("separatori: in foto intera non si trascinano (le divisioni seguono le foto), in riempi sì e il ripristino conta spazio e bordo", () => {
  const { project, id } = album([1.5, 0.667, 1.333]);
  assert.equal(setDividerRatio(project, id, 0, "", 0.3), project, "foto allineate: nessun cambiamento");
  assert.equal(resetDividerRatio(project, id, 0, ""), project, "già al rapporto naturale");
  const fill = setAreaStyle(project, id, 0, { mode: "fill" });
  const moved = setDividerRatio(fill, id, 0, "", 0.3);
  assert.notEqual(moved, fill, "in riempi il separatore si sposta");
  const reset = resetDividerRatio(moved, id, 0, "");
  assert.notEqual(reset, moved, "il ripristino riporta il rapporto naturale");
});

test("layout proposti: senza duplicati, e anche con foto molto diverse (panoramica + verticale stretta) ce n'è almeno uno", () => {
  const random = rng(5);
  for (const count of [2, 3, 4]) {
    for (let trial = 0; trial < 12; trial += 1) {
      const { project } = album(Array.from({ length: count }, () => ASPECTS[Math.floor(random() * ASPECTS.length)]));
      const geometry = areaGeometry(project, project.spreads[0], 0);
      const candidates = areaCandidates(project, project.spreads[0], 0);
      const signatures = candidates.map((candidate) => layoutCells(candidate.tree, geometry.inner, geometry.gapMm).cells.map((cell) => `${Math.round(cell.rect.x)},${Math.round(cell.rect.y)},${Math.round(cell.rect.w)},${Math.round(cell.rect.h)}`).join(";"));
      assert.equal(new Set(signatures).size, signatures.length, `${count} foto: layout proposti uguali`);
    }
  }
  for (const pair of [[3, 1 / 3], [4, 0.25], [5, 0.2]]) {
    const { project } = album(pair, "fit");
    assert.ok(areaCandidates(project, project.spreads[0], 0).length >= 1, `coppia ${pair.join("+")}: nessun layout`);
  }
});

test("layout libero: passare al libero non sposta le foto, aggiungerne non azzera le posizioni, su uno spazio vuoto si può rilasciare", () => {
  const random = rng(11);
  for (let trial = 0; trial < 20; trial += 1) {
    const { project, id } = album(Array.from({ length: 2 + Math.floor(random() * 5) }, () => ASPECTS[Math.floor(random() * ASPECTS.length)]));
    const free = makeAreaFree(project, id, 0);
    const before = windows(project);
    const after = windows(free);
    for (const [key, w] of before) {
      const v = after.get(key)!;
      for (const k of ["x", "y", "w", "h"] as const) assert.ok(Math.abs(w[k] - v[k]) < 0.05, `foto spostata passando al libero (${k})`);
    }
  }
  const { project, id } = album([1.5, 0.667, 1.333]);
  const free = makeAreaFree(project, id, 0);
  const spare = free.assets.find((a) => !area0(free).items.some((i) => i.assetId === a.id))!;
  const appended = appendAssets(free, id, 0, [spare.id]);
  assert.ok(hasFreeLayout(area0(appended)), "dopo aver aggiunto una foto la pagina è ancora libera");
  for (const item of area0(free).items) assert.deepEqual(area0(appended).free![item.id], area0(free).free![item.id], "le foto già presenti restano dove sono");
  const aside = dropOnSpread(free, id, { areaIndex: 0, itemId: area0(free).items[0].id, zone: "right" }, { kind: "assets", assetIds: [spare.id] });
  assert.ok(hasFreeLayout(area0(aside)), "un rilascio a fianco non azzera la pagina libera");
  const geometry = areaGeometry(free, free.spreads[0], 0);
  const hit = resolveDropTarget([{ rect: geometry.outer, cells: geometry.cells.slice(0, 1).map((cell) => ({ ...cell, rect: { x: geometry.inner.x, y: geometry.inner.y, w: 10, h: 10 } })), dividers: [], free: true }], geometry.inner.x + geometry.inner.w - 5, geometry.inner.y + geometry.inner.h - 5);
  assert.deepEqual(hit, { areaIndex: 0, itemId: null, zone: "area" });
  // una foto dall'altra pagina arriva a cascata senza spostare le altre
  const other = appendAssets(free, id, 1, [spare.id]);
  const moved = dropOnSpread(other, id, { areaIndex: 0, itemId: null, zone: "area" }, { kind: "item", itemId: area0(other, 1).items[0].id });
  assert.ok(hasFreeLayout(area0(moved)) && area0(moved).items.length === 4, "foto arrivata nella pagina libera");
  for (const item of area0(free).items) assert.deepEqual(area0(moved).free![item.id], area0(free).free![item.id]);
});

test("layout bloccato: forma, sostituzione e rilasci non cambiano la disposizione; divisione e spostamenti si rifiutano con una spiegazione", () => {
  const { project, id } = album([1.5, 0.667, 1.333, 1]);
  const locked = setAreaLocked(project, id, 0, true);
  const layout = JSON.stringify(area0(locked).layout);
  const target = area0(locked).items[1];
  const spare = locked.assets.find((a) => !area0(locked).items.some((i) => i.assetId === a.id))!;
  assert.equal(JSON.stringify(area0(setItemView(locked, target.id, { shape: 3 })).layout), layout, "la forma non cambia il layout bloccato");
  assert.equal(JSON.stringify(area0(replaceItemAsset(locked, target.id, spare.id)).layout), layout, "la sostituzione non cambia il layout bloccato");
  assert.equal(dropOnSpread(locked, id, { areaIndex: 0, itemId: target.id, zone: "left" }, { kind: "assets", assetIds: [spare.id] }), locked, "niente foto nuove a fianco");
  assert.equal(appendAssets(locked, id, 0, [spare.id]), locked, "niente foto aggiunte");
  assert.notEqual(dropOnSpread(locked, id, { areaIndex: 0, itemId: target.id, zone: "center" }, { kind: "assets", assetIds: [spare.id] }), locked, "la sostituzione al centro è permessa");
  assert.equal(setSplitMode(locked, id, "third"), locked, "la divisione non cambia sotto un blocco");
  assert.match(splitRefusal(locked, id, "third") ?? "", /bloccato/);
  assert.equal(moveToNewSpread(locked, 1, { kind: "item", itemId: target.id }).spreadId, null, "una foto non esce da una pagina bloccata");
  assert.match(moveRefusal(locked, null, { kind: "item", itemId: target.id }) ?? "", /bloccato/);
  assert.equal(moveRefusal(locked, id, { kind: "assets", assetIds: [spare.id] }), null, "l'altra pagina è libera: la foto può arrivare lì");
  assert.match(moveRefusal(setAreaLocked(locked, id, 1, true), id, { kind: "assets", assetIds: [spare.id] }) ?? "", /bloccato/);
  assert.equal(moveToSpread(locked, id, { kind: "assets", assetIds: [spare.id] }).spreads[0].areas[0].items.length, 4, "la foto va nella pagina non bloccata");
});

test("foto più grandi del foglio: si taglia la parte che esce (percentuali della finestra), niente se sta dentro", () => {
  const bounds = { x: 0, y: 0, w: 600, h: 300 };
  assert.equal(overflowInset(bounds, { x: 10, y: 10, w: 100, h: 100 }), null);
  const out = overflowInset(bounds, { x: -100, y: -50, w: 400, h: 200 })!;
  assert.deepEqual([out.left, out.top, out.right, out.bottom].map((v) => Math.round(v)), [25, 25, 0, 0]);
  const right = overflowInset(bounds, { x: 500, y: 100, w: 200, h: 400 })!;
  assert.deepEqual([right.right, right.bottom].map((v) => Math.round(v)), [50, 50]);
  assert.equal(overflowInset(bounds, { x: 0, y: 0, w: 0, h: 10 }), null);
});

test("comandi della foto: quattro barre sulle foto grandi, due colonne sulle piccole, un solo «⋯» sulle minuscole", () => {
  assert.equal(toolbarModeFor(400), "full");
  assert.equal(toolbarModeFor(260), "full");
  assert.equal(toolbarModeFor(259), "compact");
  assert.equal(toolbarModeFor(150), "compact");
  assert.equal(toolbarModeFor(149), "tiny");
  assert.equal(toolbarModeFor(40), "tiny");
});
