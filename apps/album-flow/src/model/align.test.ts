import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutCells } from "../engine/geometry";
import { resolveDropTarget } from "../engine/drop";
import { appendAssets, dropOnSpread, moveFrameToArea, moveItemToArea, moveRefusal, moveToNewSpread, moveToSpread, removeItem, replaceItemAsset, setItemBorder, setItemView, swapItems, alignArea } from "./items";
import { addSpread, setSpreadDone, setSplitMode, splitRefusal, swapAreas, swapRefusal } from "./spreads";
import { applyCandidate, applyFavoriteLayout, areaCandidates, isFavoriteLayout, layoutChoices, mirrorArea, resetDividerRatio, saveFavoriteLayout, setAlbumGap, setAreaStyle, setDividerRatio, shuffleArea, shuffleSpread } from "./areas";
import { areaGeometry, hasFreeLayout, placementStyle, type Project } from "./project";
import { assertProjectInvariants, makeAsset, makeProject } from "./fixtures";
import { makeAreaFree, restoreAutomatic, setAreaLocked } from "./layoutLock";
import { applyTemplate, applyTemplatesToAlbum, reorderFrame, sanitizeTemplate, setFrame } from "./templates";
import { applyShape, treeKind } from "../engine/tree";
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
  assert.deepEqual(hit, { areaIndex: 0, itemId: null, zone: "area", point: { x: geometry.inner.x + geometry.inner.w - 5, y: geometry.inner.y + geometry.inner.h - 5 } });
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

// ------------------------------------------------------------------ Due pagine: una libera e una automatica

/** Spread a metà con `left` foto a sinistra e `right` a destra, stesso stile sulle due pagine. */
function twoPages(left: number[], right: number[], mode: "fit" | "fill" = "fill"): { project: Project; id: string } {
  const all = [...left, ...right];
  let project = makeProject(all.length + 6);
  project = { ...project, assets: Array.from({ length: all.length + 6 }, (_, i) => { const a = i < all.length ? all[i] : ASPECTS[i % ASPECTS.length]; return makeAsset(i, { width: Math.round(a * 4000), height: 4000, aspectRatio: a }); }) };
  project = addSpread(project, 0, "half");
  const id = project.spreads[0].id;
  project = appendAssets(project, id, 0, left.map((_, i) => `a${i}`));
  project = appendAssets(project, id, 1, right.map((_, i) => `a${left.length + i}`));
  for (const index of [0, 1]) project = setAreaStyle(project, id, index, { mode, gapCm: 0.3, paddingCm: 0.6 });
  return { project, id };
}

/** Cornici (mm nello spread) delle foto di una pagina, per controllare che non si muovano. */
const cellRects = (project: Project, areaIndex: number) => new Map(areaGeometry(project, project.spreads[0], areaIndex).cells.map((cell) => [cell.itemId, cell.rect] as const));
const sameRect = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, tolerance = 0.05) => (["x", "y", "w", "h"] as const).every((key) => Math.abs(a[key] - b[key]) < tolerance);

test("pagina libera e pagina automatica: le foto passano da sinistra a destra e viceversa, le altre restano ferme", () => {
  for (const mode of ["fill", "fit"] as const) {
    const { project, id } = twoPages([1.5, 0.667, 1.333], [1, 1.5, 0.75], mode);
    const free = makeAreaFree(project, id, 0);
    const stay = cellRects(free, 0);
    const leaving = area0(free).items[0].id;
    // sinistra (libera) → destra (automatica), sul bordo di una foto: entra nel layout della destra
    const toRight = dropOnSpread(free, id, { areaIndex: 1, itemId: area0(free, 1).items[0].id, zone: "left" }, { kind: "item", itemId: leaving });
    assert.equal(area0(toRight, 1).items.length, 4, `${mode}: la foto è arrivata a destra`);
    assert.ok(hasFreeLayout(area0(toRight)) && area0(toRight).items.length === 2, `${mode}: la sinistra resta libera con le altre due`);
    for (const [itemId, rect] of cellRects(toRight, 0)) assert.ok(sameRect(rect, stay.get(itemId)!), `${mode}: una foto rimasta a sinistra si è mossa`);
    assert.ok(alignmentError(toRight, 1) < EPS, `${mode}: la destra resta allineata`);
    assertProjectInvariants(toRight, `${mode} sinistra libera → destra`);
    // dal menu «Sposta nella pagina destra»: stesso risultato senza mirare
    const byMenu = moveItemToArea(free, leaving, 1);
    assert.ok(area0(byMenu, 1).items.some((item) => item.id === leaving) && hasFreeLayout(area0(byMenu)), `${mode}: menu verso destra`);
    assert.ok(alignmentError(byMenu, 1) < EPS);
    assertProjectInvariants(byMenu, `${mode} menu verso destra`);
    // destra (automatica) → sinistra (libera), su uno spazio vuoto: arriva centrata nel punto del rilascio
    const arriving = area0(free, 1).items[0].id;
    const inner = areaGeometry(free, free.spreads[0], 0).inner;
    const point = { x: inner.x + inner.w * 0.5, y: inner.y + inner.h * 0.5 };
    const toLeft = dropOnSpread(free, id, { areaIndex: 0, itemId: null, zone: "area", point }, { kind: "item", itemId: arriving });
    const arrived = cellRects(toLeft, 0).get(arriving)!;
    assert.ok(Math.abs(arrived.x + arrived.w / 2 - point.x) < 0.5 && Math.abs(arrived.y + arrived.h / 2 - point.y) < 0.5, `${mode}: la foto arriva dove la si lascia`);
    for (const [itemId, rect] of stay) assert.ok(sameRect(cellRects(toLeft, 0).get(itemId)!, rect), `${mode}: una foto già presente si è mossa`);
    assert.ok(alignmentError(toLeft, 1) < EPS, `${mode}: la destra si richiude allineata`);
    assertProjectInvariants(toLeft, `${mode} destra → sinistra libera`);
  }
});

test("due pagine libere: una foto trascinata sull'altra pagina passa lì restando dove è stata lasciata", () => {
  const { project, id } = twoPages([1.5, 0.667], [1, 1.333]);
  const both = makeAreaFree(makeAreaFree(project, id, 0), id, 1);
  const itemId = area0(both).items[0].id;
  const target = areaGeometry(both, both.spreads[0], 1).inner;
  const rect = { x: target.x + 20, y: target.y + 30, w: 90, h: 60 };
  const moved = moveFrameToArea(both, itemId, 1, rect);
  assert.ok(area0(moved, 1).items.some((item) => item.id === itemId), "la foto appartiene alla pagina destra");
  assert.ok(sameRect(cellRects(moved, 1).get(itemId)!, rect), "e sta esattamente dove è stata lasciata");
  for (const [other, place] of cellRects(both, 1)) assert.ok(sameRect(cellRects(moved, 1).get(other)!, place), "le foto della destra non si muovono");
  assert.ok(hasFreeLayout(area0(moved)) && hasFreeLayout(area0(moved, 1)));
  assertProjectInvariants(moved, "cornice sull'altra pagina");
  const lockedRight = setAreaLocked(both, id, 1, true);
  assert.equal(moveFrameToArea(lockedRight, itemId, 1, rect), lockedRight, "non su una pagina bloccata");
  assert.equal(moveFrameToArea(project, area0(project).items[0].id, 1, rect), project, "solo verso una pagina libera");
});

test("«Torna al layout automatico»: dopo una foto arrivata o un template libero si ottiene un layout vero, allineato in «foto intera»", () => {
  const { project, id } = twoPages([1.5, 0.667, 1.333, 1], [0.75], "fit");
  let free = makeAreaFree(project, id, 0);
  free = dropOnSpread(free, id, { areaIndex: 0, itemId: null, zone: "area" }, { kind: "item", itemId: area0(free, 1).items[0].id });
  const back = restoreAutomatic(free, id, 0);
  assert.ok(!hasFreeLayout(area0(back)) && area0(back).items.length === 5);
  assert.equal(treeKind(area0(back).layout!), treeKind(areaCandidates(back, back.spreads[0], 0)[0].tree), "è il layout calcolato migliore per le cinque foto");
  assert.ok(alignmentError(back, 0) < EPS, "in «foto intera» le foto sono allineate");
  assertProjectInvariants(back, "ritorno dopo foto arrivata");
  // senza cambi in mezzo si torna esattamente al layout di prima
  assert.equal(JSON.stringify(area0(restoreAutomatic(makeAreaFree(project, id, 0), id, 0)).layout), JSON.stringify(area0(project).layout));
  // template libero: l'albero di riserva non è più una fila di strisce
  const frames = [[0.02, 0.02, 0.5, 0.5], [0.5, 0.02, 0.45, 0.45], [0.02, 0.5, 0.45, 0.45], [0.5, 0.5, 0.45, 0.45]].map(([x, y, w, h], z) => ({ x, y, w, h, rotation: 0, z }));
  const template = sanitizeTemplate({ id: "lib4", name: "Libero", kind: "free", target: "page", frames, createdAt: "x" })!;
  const restored = restoreAutomatic(applyTemplate(project, id, 0, template), id, 0);
  assert.equal(treeKind(area0(restored).layout!), treeKind(areaCandidates(restored, restored.spreads[0], 0)[0].tree));
  assert.ok(alignmentError(restored, 0) < EPS);
});

test("template e preferiti in «foto intera»: la forma resta, le divisioni si regolano e le foto restano allineate", () => {
  const { project, id } = twoPages([1.5, 0.667, 1.333], [1.5, 1, 0.75], "fit");
  const template = sanitizeTemplate({ id: "t3", name: "Tre", kind: "tree", target: "page", shape: { kind: "split", dir: "row", ratio: 0.33, first: { kind: "leaf", itemId: "0" }, second: { kind: "split", dir: "column", ratio: 0.5, first: { kind: "leaf", itemId: "1" }, second: { kind: "leaf", itemId: "2" } } }, createdAt: "x" })!;
  const at = layoutChoices(project, project.spreads[0], 0, [template]).findIndex((choice) => choice.kind === "template");
  assert.ok(at > 0, "il template è tra le scelte");
  const results: Array<[string, Project]> = [
    ["layout n.", applyCandidate(project, id, 0, at, [template])],
    ["Mescola", shuffleArea(project, id, 0, 1, [template])],
    ["template applicato", applyTemplate(project, id, 0, template)],
    ["Auto Build con i template", applyTemplatesToAlbum(project, [template], 5).project],
  ];
  for (const [name, result] of results) {
    assert.equal(treeKind(area0(result).layout!), treeKind(applyShape(template.shape!, ["a", "b", "c"])!), `${name}: la forma del template resta`);
    assert.ok(alignmentError(result, 0) < EPS, `${name}: foto allineate`);
    assertProjectInvariants(result, name);
  }
  let fav = setAreaStyle(project, id, 0, { mode: "fill" });
  fav = setDividerRatio(fav, id, 0, "", 0.3);
  fav = saveFavoriteLayout(fav, id, 0);
  fav = setAreaStyle(fav, id, 0, { mode: "fit" });
  const favorite = applyFavoriteLayout(fav, id, 1, fav.favoriteLayouts[0].id);
  assert.ok(alignmentError(favorite, 1) < EPS, "preferito: foto allineate");
});

test("cambio di divisione con una sola pagina libera: diventa libera solo la pagina che riceve foto libere, e il ritaglio non cambia", () => {
  const { project, id } = twoPages([1.5, 0.667, 1.333], [1, 1.5, 0.75]);
  const cropped = setItemView(project, area0(project).items[0].id, { zoom: 2, cx: 0.3, cy: 0.4 });
  const free = makeAreaFree(cropped, id, 0);
  const freeIds = new Set(area0(free).items.map((item) => item.id));
  for (const mode of ["third", "two-thirds", "full"] as const) {
    const changed = setSplitMode(free, id, mode);
    assertProjectInvariants(changed, `divisione ${mode}`);
    changed.spreads[0].areas.forEach((area, index) => {
      if (area.items.length === 0) return;
      assert.equal(hasFreeLayout(area), area.items.some((item) => freeIds.has(item.id)), `${mode}: pagina ${index} libera solo se riceve foto della pagina libera`);
    });
    const kept = changed.spreads[0].areas.flatMap((area) => area.items).find((item) => item.id === area0(free).items[0].id)!;
    assert.deepEqual([kept.zoom, kept.cx, kept.cy], [2, 0.3, 0.4], `${mode}: il ritaglio della foto libera non cambia`);
  }
});

test("aggiungere una foto a una pagina libera non cambia il ritaglio né la posizione delle altre", () => {
  const { project, id } = twoPages([1.5, 0.667, 1.333], [1]);
  const cropped = makeAreaFree(setItemView(project, area0(project).items[0].id, { zoom: 2, cx: 0.3, cy: 0.4 }), id, 0);
  const spare = cropped.assets.find((asset) => !cropped.spreads[0].areas.some((area) => area.items.some((item) => item.assetId === asset.id)))!;
  const added = appendAssets(cropped, id, 0, [spare.id]);
  for (const item of area0(cropped).items) {
    const now = area0(added).items.find((candidate) => candidate.id === item.id)!;
    assert.deepEqual([now.zoom, now.cx, now.cy], [item.zoom, item.cx, item.cy], "ritaglio invariato");
    assert.deepEqual(area0(added).free![item.id], area0(cropped).free![item.id], "posizione invariata");
  }
});

test("«Scambia le pagine»: niente con il lucchetto o su uno spread finito, cornici libere senza deformarsi, foto allineate", () => {
  const { project, id } = twoPages([1.5, 0.667], [1, 1.5, 0.75], "fit");
  const locked = setAreaLocked(project, id, 0, true);
  assert.equal(swapAreas(locked, id), locked, "il layout bloccato non passa all'altra pagina");
  assert.match(swapRefusal(locked, id) ?? "", /bloccato/);
  const done = setSpreadDone(project, id, true);
  assert.equal(swapAreas(done, id), done);
  assert.match(swapRefusal(done, id) ?? "", /finito/);
  // margini diversi: le foto restano allineate
  const margins = setAreaStyle(project, id, 1, { paddingCm: 2.5 });
  const swapped = swapAreas(margins, id);
  assert.ok(alignmentError(swapped, 0) < EPS && alignmentError(swapped, 1) < EPS, "allineate dopo lo scambio");
  assertProjectInvariants(swapped, "scambio con margini diversi");
  // un terzo / due terzi: le cornici libere tengono le loro proporzioni
  const third = makeAreaFree(setSplitMode(project, id, "third"), id, 1);
  const before = [...cellRects(third, 1).values()].map((rect) => rect.w / rect.h);
  const thirdSwapped = swapAreas(third, id);
  const after = [...cellRects(thirdSwapped, 0).values()].map((rect) => rect.w / rect.h);
  before.forEach((ratio, index) => assert.ok(Math.abs(after[index] / ratio - 1) < 0.01, "la cornice non si deforma"));
  assertProjectInvariants(thirdSwapped, "scambio un terzo / due terzi");
});

test("Mescola di tutto lo spread salta la pagina libera; Mescola della pagina la riporta ai layout automatici", () => {
  const { project, id } = twoPages([1.5, 0.667, 1.333], [1, 1.5, 0.75]);
  const free = makeAreaFree(project, id, 0);
  const shuffled = shuffleSpread(free, id);
  assert.deepEqual(area0(shuffled).free, area0(free).free, "le posizioni scelte a mano restano");
  assert.notEqual(JSON.stringify(area0(shuffled, 1).layout), JSON.stringify(area0(free, 1).layout), "l'altra pagina si mescola");
  assert.ok(!hasFreeLayout(area0(shuffleArea(free, id, 0))), "Mescola della pagina: torna ai layout automatici");
});

test("lucchetto: su una pagina bloccata le foto restano ferme (cornici, livelli, separatori, specchio), ma si possono sostituire e scambiare", () => {
  const { project, id } = twoPages([1.5, 0.667, 1.333], [1, 1.5]);
  const free = setAreaLocked(makeAreaFree(project, id, 0), id, 0, true);
  const itemId = area0(free).items[0].id;
  assert.equal(setFrame(free, itemId, { x: 0.4 }), free, "la cornice non si sposta");
  assert.equal(reorderFrame(free, itemId, "front"), free, "il livello non cambia");
  assert.equal(mirrorArea(free, id, 0, "horizontal"), free, "niente specchio");
  const auto = setAreaLocked(project, id, 0, true);
  assert.equal(setDividerRatio(auto, id, 0, "", 0.3), auto, "i separatori non si spostano");
  const spare = free.assets.find((asset) => !free.spreads[0].areas.some((area) => area.items.some((item) => item.assetId === asset.id)))!;
  assert.notEqual(dropOnSpread(free, id, { areaIndex: 0, itemId, zone: "center" }, { kind: "assets", assetIds: [spare.id] }), free, "sostituire si può");
  assert.notEqual(swapItems(free, itemId, area0(free, 1).items[0].id), free, "scambiare si può");
});

test("preferiti e pagine libere: il cuore non salva l'albero di riserva che non si vede", () => {
  const { project, id } = twoPages([1.5, 0.667, 1.333], [1]);
  const free = makeAreaFree(project, id, 0);
  assert.equal(saveFavoriteLayout(free, id, 0), free);
  const saved = saveFavoriteLayout(project, id, 0);
  assert.equal(isFavoriteLayout(saved, area0(makeAreaFree(saved, id, 0))), false, "una pagina libera non risulta «nei preferiti»");
});
