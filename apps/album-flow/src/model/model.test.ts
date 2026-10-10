import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDropTarget, type DropTarget } from "../engine/drop";
import { leafIds } from "../engine/tree";
import { TEMPLATE_SEED_BASE, layoutChoices, alignFitAreas, refreshAssetShapes, applyCandidate, applyCandidateByNumber, applyFavoriteLayout, applyStyleToAlbum, applyStyleToSpread, areaCandidates, favoritesFor, isFavoriteLayout, mirrorArea, removeFavoriteLayout, resetDividerRatio, saveFavoriteLayout, setAreaStyle, setDividerRatio, setLinked, shuffleArea, shuffleSpread } from "./areas";
import { alignArea, appendAssets, dropOnSpread, moveToNewSpread, moveToSpread, previewDropRect, removeItem, replaceItemAsset, resetItemView, setItemView, swapItems, toggleItemLock } from "./items";
import { addSpread, clearSpread, duplicateSpread, moveSpread, moveSpreads, removeSpread, setSplitMode, swapAreas } from "./spreads";
import { findItem, itemAspect, placementStyle, spreadGeometry, type Project } from "./project";
import { assertProjectInvariants, makeAsset, makeProject } from "./fixtures";
import { setItemBorder } from "./items";
import { itemBorderColor, placeItem as placeItemForBorder } from "./placement";
import { TEMPLATE_STORAGE_KEY, applyTemplate, frameForAspect, restackFrames, applyTemplatesToAlbum, bestAssignment, loadTemplates, matchTemplates, removeTemplate, reorderFrame, saveTemplates, sanitizeTemplate, setFrame, templateFromArea, templateTarget, upsertTemplate } from "./templates";
import { hasFreeLayout } from "./project";
import { setAlbumGap } from "./areas";
import { setSpreadDone } from "./spreads";
import { areaIndexesOf, isScopeLocked, makeAreaFree, restoreAutomatic, setAreaLocked, setSpreadLock } from "./layoutLock";
import { areaGeometry } from "./project";
import { coverAssetOf, hoverPreviewSize, removeAssets, setCoverAsset } from "./library";
import { placeItem } from "./placement";
import { DEFAULT_AUTO_BUILD, autoBuildAlbum } from "./autobuild";
import { parseAlbumProject, serializeAlbumProject } from "./portability";

const firstSpreadId = (project: Project) => project.spreads[0].id;

function withSpread(photos: number, split: "half" | "full" | "third" | "two-thirds" = "half"): Project {
  return addSpread(makeProject(photos), 0, split);
}

/** Spread 0 con le prime `left` foto a sinistra e le successive `right` a destra. */
function filled(left: number, right: number, split: "half" | "third" | "two-thirds" = "half"): Project {
  let project = withSpread(left + right + 4, split);
  const id = firstSpreadId(project);
  if (left) project = appendAssets(project, id, 0, Array.from({ length: left }, (_, i) => `a${i}`));
  if (right) project = appendAssets(project, id, 1, Array.from({ length: right }, (_, i) => `a${left + i}`));
  return project;
}

const itemsOf = (project: Project, areaIndex: number, spreadIndex = 0) => project.spreads[spreadIndex].areas[areaIndex].items;

// ------------------------------------------------------------------- spread

test("spread: aggiungere in posizione, con divisione e stile predefiniti", () => {
  let project = makeProject(4);
  project = addSpread(project);
  project = addSpread(project, 0, "full");
  assert.equal(project.spreads.length, 2);
  assert.equal(project.spreads[0].split, "full");
  assert.equal(project.spreads[0].areas.length, 1);
  assert.equal(project.spreads[1].areas.length, 2);
  assert.deepEqual(project.spreads[1].areas[0].style, project.settings.defaultStyle);
  assert.equal(project.spreads[1].linked, false);
  assert.equal(addSpread(project, 99).spreads.length, 3, "indice oltre la fine: in coda");
  assertProjectInvariants(project, "addSpread");
});

test("spread: elimina, sposta, duplica con identificativi nuovi e svuota", () => {
  let project = filled(2, 1);
  const original = project.spreads[0];
  project = duplicateSpread(project, original.id);
  assert.equal(project.spreads.length, 2);
  const copy = project.spreads[1];
  assert.notEqual(copy.id, original.id);
  assert.deepEqual(copy.areas.map((a) => a.items.map((i) => i.assetId)), original.areas.map((a) => a.items.map((i) => i.assetId)));
  const originalIds = new Set(original.areas.flatMap((a) => [a.id, ...a.items.map((i) => i.id)]));
  assert.ok(copy.areas.every((a) => !originalIds.has(a.id) && a.items.every((i) => !originalIds.has(i.id))), "nessun id in comune");
  assert.equal(copy.areas[0].layout?.kind, original.areas[0].layout?.kind);
  assertProjectInvariants(project, "duplica");

  project = addSpread(project);
  const ids = project.spreads.map((s) => s.id);
  const moved = moveSpread(project, 0, 2);
  assert.deepEqual(moved.spreads.map((s) => s.id), [ids[1], ids[2], ids[0]]);
  assert.equal(moveSpread(project, 0, 9), project);
  assert.equal(moveSpread(project, 1, 1), project);

  const cleared = clearSpread(project, ids[0]);
  assert.ok(cleared.spreads[0].areas.every((a) => a.items.length === 0 && a.layout === null));
  assert.equal(clearSpread(cleared, ids[0]), cleared, "già vuoto: nessun cambiamento");
  assert.equal(removeSpread(project, ids[1]).spreads.length, 2);
  assert.equal(removeSpread(project, "x"), project);
  assertProjectInvariants(cleared, "svuota");
});

test("divisione: passare a foglio intero unisce le foto nell'ordine, e tornare indietro le ridistribuisce per posizione", () => {
  let project = filled(3, 2);
  const id = firstSpreadId(project);
  const before = [...itemsOf(project, 0), ...itemsOf(project, 1)].map((i) => i.assetId);
  project = setSplitMode(project, id, "full");
  assert.equal(project.spreads[0].split, "full");
  assert.equal(project.spreads[0].areas.length, 1);
  assert.deepEqual(itemsOf(project, 0).map((i) => i.assetId), before, "ordine globale invariato");
  assertProjectInvariants(project, "full");

  project = setSplitMode(project, id, "half");
  const left = itemsOf(project, 0).map((i) => i.assetId);
  const right = itemsOf(project, 1).map((i) => i.assetId);
  assert.equal(left.length + right.length, 5);
  assert.deepEqual([...left, ...right].sort(), [...before].sort(), "nessuna foto persa");
  const geometry = spreadGeometry(project, project.spreads[0]);
  for (const cell of geometry[0].cells) assert.ok(cell.rect.x + cell.rect.w <= 300 + 1e-6, "a sinistra restano le foto della metà sinistra");
  assertProjectInvariants(project, "di nuovo half");
  assert.equal(setSplitMode(project, id, "half"), project, "stessa divisione: nessun cambiamento");
});

test("divisione: un terzo e due terzi spostano il confine tra le aree senza perdere foto", () => {
  let project = filled(2, 2);
  const id = firstSpreadId(project);
  for (const mode of ["third", "two-thirds", "half", "third"] as const) {
    project = setSplitMode(project, id, mode);
    assert.equal(project.spreads[0].split, mode);
    assert.equal(itemsOf(project, 0).length + itemsOf(project, 1).length, 4, mode);
    assertProjectInvariants(project, mode);
  }
  const rects = spreadGeometry(project, project.spreads[0]);
  assert.ok(Math.abs(rects[0].outer.w - 200) < 1e-6 && Math.abs(rects[1].outer.x - 200) < 1e-6, "un terzo: confine a 200 mm");
});

test("divisione: lo stile resta alla pagina e un'area vuota resta vuota", () => {
  let project = filled(2, 0);
  const id = firstSpreadId(project);
  project = setAreaStyle(project, id, 0, { paddingCm: 2, background: "#000000" });
  project = setSplitMode(project, id, "third");
  assert.equal(project.spreads[0].areas[0].style.paddingCm, 2);
  assert.equal(project.spreads[0].areas[0].style.background, "#000000");
  assert.equal(itemsOf(project, 1).length + itemsOf(project, 0).length, 2);
});

test("scambia le due aree: foto e layout si invertono, lo stile resta a posto", () => {
  let project = filled(2, 3);
  const id = firstSpreadId(project);
  project = setAreaStyle(project, id, 0, { background: "#000000" });
  const left = itemsOf(project, 0).map((i) => i.assetId);
  const right = itemsOf(project, 1).map((i) => i.assetId);
  const swapped = swapAreas(project, id);
  assert.deepEqual(itemsOf(swapped, 0).map((i) => i.assetId), right);
  assert.deepEqual(itemsOf(swapped, 1).map((i) => i.assetId), left);
  assert.equal(swapped.spreads[0].areas[0].style.background, "#000000");
  assertProjectInvariants(swapped, "scambio aree");
  const full = setSplitMode(swapped, id, "full");
  assert.equal(swapAreas(full, id), full, "foglio intero: niente da scambiare");
});

// -------------------------------------------------------------------- foto

test("aggiunta di foto: ricalcola il layout, rispetta ordine, limite e foto inesistenti", () => {
  let project = withSpread(20);
  const id = firstSpreadId(project);
  project = appendAssets(project, id, 0, ["a0", "a1", "a2"]);
  assert.deepEqual(itemsOf(project, 0).map((i) => i.assetId), ["a0", "a1", "a2"]);
  project = appendAssets(project, id, 0, ["a3"], itemsOf(project, 0)[0].id);
  assert.deepEqual(itemsOf(project, 0).map((i) => i.assetId), ["a0", "a3", "a1", "a2"], "dopo la foto indicata");
  assert.equal(appendAssets(project, id, 0, ["inesistente"]), project);
  assert.equal(appendAssets(project, "x", 0, ["a5"]), project);
  const big = appendAssets(project, id, 1, Array.from({ length: 15 }, (_, i) => `a${i + 4}`));
  assert.equal(itemsOf(big, 1).length, 12, "massimo 12 foto per area");
  assert.equal(appendAssets(big, id, 1, ["a19"]), big, "area piena");
  assertProjectInvariants(big, "append");
});

test("rilascio dalla libreria: area vuota, sostituzione al centro, inserimento sul bordo", () => {
  let project = withSpread(12);
  const id = firstSpreadId(project);
  project = dropOnSpread(project, id, { areaIndex: 0, itemId: null, zone: "area" }, { kind: "assets", assetIds: ["a0", "a1"] });
  assert.equal(itemsOf(project, 0).length, 2);

  const [first, second] = itemsOf(project, 0);
  const replaced = dropOnSpread(project, id, { areaIndex: 0, itemId: first.id, zone: "center" }, { kind: "assets", assetIds: ["a5"] });
  assert.equal(itemsOf(replaced, 0)[0].id, first.id, "l'elemento resta lo stesso");
  assert.equal(itemsOf(replaced, 0)[0].assetId, "a5");
  assert.equal(itemsOf(replaced, 0)[0].zoom, 1);
  assert.deepEqual(leafIds(replaced.spreads[0].areas[0].layout), leafIds(project.spreads[0].areas[0].layout), "stesso layout");

  const left = dropOnSpread(project, id, { areaIndex: 0, itemId: second.id, zone: "left" }, { kind: "assets", assetIds: ["a7"] });
  const order = itemsOf(left, 0).map((i) => i.assetId);
  assert.equal(order.length, 3);
  assert.equal(order[order.indexOf("a1") - 1], "a7", "inserita subito prima");
  const bottom = dropOnSpread(project, id, { areaIndex: 0, itemId: first.id, zone: "bottom" }, { kind: "assets", assetIds: ["a7", "a8"] });
  assert.deepEqual(itemsOf(bottom, 0).map((i) => i.assetId).slice(0, 3), ["a0", "a7", "a8"], "più foto inserite nell'ordine dato");
  assertProjectInvariants(bottom, "rilascio bordo");
  assertProjectInvariants(left, "rilascio sinistra");
});

test("rilascio: più foto sul centro sostituiscono la prima e aggiungono le altre; foto bloccata non cambia", () => {
  let project = withSpread(12);
  const id = firstSpreadId(project);
  project = appendAssets(project, id, 0, ["a0", "a1"]);
  const [first] = itemsOf(project, 0);
  const multi = dropOnSpread(project, id, { areaIndex: 0, itemId: first.id, zone: "center" }, { kind: "assets", assetIds: ["a5", "a6", "a7"] });
  assert.deepEqual(itemsOf(multi, 0).map((i) => i.assetId), ["a5", "a6", "a7", "a1"]);
  const locked = toggleItemLock(project, first.id);
  assert.equal(replaceItemAsset(locked, first.id, "a9"), locked);
  assert.equal(dropOnSpread(locked, id, { areaIndex: 0, itemId: first.id, zone: "center" }, { kind: "assets", assetIds: ["a9"] }), locked);
  assert.equal(dropOnSpread(project, id, { areaIndex: 5, itemId: null, zone: "area" }, { kind: "assets", assetIds: ["a1"] }), project, "area inesistente");
  assert.equal(dropOnSpread(project, id, { areaIndex: 0, itemId: null, zone: "area" }, { kind: "assets", assetIds: [] }), project);
});

test("rilascio di una foto già nello spread: scambio al centro, spostamento sul bordo, anche tra aree", () => {
  const project = filled(3, 2);
  const id = firstSpreadId(project);
  const [l1, l2, l3] = itemsOf(project, 0);
  const [r1, r2] = itemsOf(project, 1);

  const swapped = dropOnSpread(project, id, { areaIndex: 1, itemId: r1.id, zone: "center" }, { kind: "item", itemId: l1.id });
  assert.equal(findItem(swapped, l1.id)!.item.assetId, r1.assetId);
  assert.equal(findItem(swapped, r1.id)!.item.assetId, l1.assetId);
  assert.equal(findItem(swapped, l1.id)!.areaIndex, 0, "gli elementi restano dove sono, cambiano le foto");
  assert.equal(dropOnSpread(project, id, { areaIndex: 0, itemId: l1.id, zone: "center" }, { kind: "item", itemId: l1.id }), project, "su sé stessa: niente");

  const moved = dropOnSpread(project, id, { areaIndex: 0, itemId: l3.id, zone: "right" }, { kind: "item", itemId: l1.id });
  assert.deepEqual(itemsOf(moved, 0).map((i) => i.id), [l2.id, l3.id, l1.id]);

  const across = dropOnSpread(project, id, { areaIndex: 1, itemId: r2.id, zone: "top" }, { kind: "item", itemId: l2.id });
  assert.equal(itemsOf(across, 0).length, 2);
  assert.equal(itemsOf(across, 1).length, 3);
  assert.equal(findItem(across, l2.id)!.areaIndex, 1);
  assert.equal(findItem(across, l2.id)!.item.id, l2.id, "stessa identità dopo lo spostamento");

  const base = filled(2, 0);
  const toEmpty = dropOnSpread(base, firstSpreadId(base), { areaIndex: 1, itemId: null, zone: "area" }, { kind: "item", itemId: itemsOf(base, 0)[0].id });
  assert.equal(itemsOf(toEmpty, 1).length, 1);
  assert.equal(itemsOf(toEmpty, 0).length, 1);
  for (const result of [swapped, moved, across, toEmpty]) assertProjectInvariants(result, "spostamenti");

  const locked = toggleItemLock(project, l1.id);
  assert.equal(swapItems(locked, l1.id, r1.id), locked);
  assert.equal(dropOnSpread(locked, id, { areaIndex: 0, itemId: l3.id, zone: "right" }, { kind: "item", itemId: l1.id }), locked, "una foto bloccata non si sposta");
});

test("rimozione: il layout si richiude e l'ultima foto lascia l'area vuota", () => {
  let project = filled(3, 0);
  const [a, b, c] = itemsOf(project, 0);
  project = removeItem(project, b.id);
  assert.deepEqual(itemsOf(project, 0).map((i) => i.id), [a.id, c.id]);
  project = removeItem(project, a.id);
  project = removeItem(project, c.id);
  assert.equal(project.spreads[0].areas[0].layout, null);
  assert.equal(removeItem(project, "x"), project);
  assertProjectInvariants(project, "rimozione");
});

test("inquadratura: zoom e centro restano entro l'immagine, il blocco impedisce le modifiche", () => {
  let project = filled(1, 0);
  project = setAreaStyle(project, firstSpreadId(project), 0, { mode: "fill" });
  const item = itemsOf(project, 0)[0];
  const zoomed = setItemView(project, item.id, { zoom: 2, cx: 0.99, cy: 0.5 });
  const view = itemsOf(zoomed, 0)[0];
  assert.equal(view.zoom, 2);
  assert.ok(view.cx < 0.99 && view.cx > 0.5, `centro limitato ai bordi: ${view.cx}`);
  assert.equal(itemsOf(setItemView(project, item.id, { zoom: 99 }), 0)[0].zoom, 6);
  assert.equal(itemsOf(setItemView(project, item.id, { zoom: -3 }), 0)[0].zoom, 1);
  assert.equal(setItemView(project, item.id, { zoom: 1 }), project, "nessun cambiamento");
  const reset = resetItemView(zoomed, item.id);
  assert.equal(itemsOf(reset, 0)[0].zoom, 1);
  assert.ok(Math.abs(itemsOf(reset, 0)[0].cx - 0.5) < 1e-6);
  project = toggleItemLock(zoomed, item.id);
  assert.equal(setItemView(project, item.id, { zoom: 3 }), project);
  assert.equal(setItemView(project, "x", { zoom: 3 }), project);
  assertProjectInvariants(zoomed, "zoom");
});

// -------------------------------------------------------------------- aree

test("shuffle: passa da un layout all'altro mantenendo l'ordine, torna al punto di partenza e agisce sulle aree", () => {
  let project = filled(4, 3);
  const id = firstSpreadId(project);
  project = setAreaStyle(project, id, 0, { mode: "fill" });
  project = applyCandidate(project, id, 0, 0);
  const order = itemsOf(project, 0).map((i) => i.id);
  const candidates = areaCandidates(project, project.spreads[0], 0);
  assert.ok(candidates.length >= 5, `candidati: ${candidates.length}`);
  const seen = new Set<string>([JSON.stringify(project.spreads[0].areas[0].layout)]);
  let current = project;
  for (let i = 0; i < candidates.length; i += 1) {
    current = shuffleArea(current, id, 0);
    seen.add(JSON.stringify(current.spreads[0].areas[0].layout));
    assert.deepEqual(itemsOf(current, 0).map((item) => item.id), order, "l'ordine delle foto non cambia");
    assertProjectInvariants(current, `shuffle ${i}`);
  }
  assert.equal(seen.size, candidates.length, "uno shuffle completo tocca tutti i candidati");
  const back = shuffleArea(shuffleArea(project, id, 0), id, 0, -1);
  assert.deepEqual(back.spreads[0].areas[0].layout, project.spreads[0].areas[0].layout);

  const both = shuffleSpread(project, id);
  assert.notDeepEqual(both.spreads[0].areas[0].layout, project.spreads[0].areas[0].layout);
  assert.notDeepEqual(both.spreads[0].areas[1].layout, project.spreads[0].areas[1].layout);
  const empty = withSpread(4);
  assert.equal(shuffleArea(empty, firstSpreadId(empty), 0), empty, "area vuota: nulla");
});

test("candidati: applicare un candidato per indice o per numero (tasti 1-9)", () => {
  const project = filled(3, 0);
  const id = firstSpreadId(project);
  const candidates = areaCandidates(project, project.spreads[0], 0);
  assert.ok(candidates.length >= 2, "in «foto intera» restano solo i layout davvero diversi");
  const last = candidates.length - 1;
  const picked = applyCandidate(project, id, 0, last);
  assert.deepEqual(picked.spreads[0].areas[0].layout, candidates[last].tree);
  assert.equal(picked.spreads[0].areas[0].seed, last);
  assert.deepEqual(applyCandidateByNumber(project, id, 0, last + 1).spreads[0].areas[0].layout, candidates[last].tree);
  assert.equal(applyCandidate(project, id, 0, 99), project);
  assert.equal(applyCandidate(project, id, 4, 0), project);
});

test("stile: limiti, collegamento tra le aree e copia su spread e album", () => {
  let project = filled(2, 2);
  const id = firstSpreadId(project);
  project = setAreaStyle(project, id, 0, { gapCm: 99, paddingCm: -5, borderCm: 0.4, borderColor: "#112233", mode: "fit", align: "end", mono: true });
  const style = project.spreads[0].areas[0].style;
  assert.equal(style.gapCm, 3);
  assert.equal(style.paddingCm, 0);
  assert.equal(style.borderCm, 0.4);
  assert.equal(style.mode, "fit");
  assert.equal(style.mono, true);
  assert.notDeepEqual(project.spreads[0].areas[1].style, style, "non collegate: l'altra area non cambia");
  assert.equal(setAreaStyle(project, id, 0, {}), project);

  const linked = setLinked(project, id, true);
  assert.deepEqual(linked.spreads[0].areas[1].style, linked.spreads[0].areas[0].style, "collegando, la seconda adotta lo stile della prima");
  const changed = setAreaStyle(linked, id, 1, { paddingCm: 1.2 });
  assert.equal(changed.spreads[0].areas[0].style.paddingCm, 1.2, "collegate: la modifica vale per entrambe");
  assert.equal(setLinked(changed, id, true), changed);
  assert.equal(setLinked(changed, id, false).spreads[0].linked, false);

  const onSpread = applyStyleToSpread(project, id, 0);
  assert.deepEqual(onSpread.spreads[0].areas[1].style, onSpread.spreads[0].areas[0].style);
  let album = addSpread(project);
  album = applyStyleToAlbum(album, id, 0);
  assert.ok(album.spreads.every((spread) => spread.areas.every((area) => area.style.mono)));
  assert.equal(album.settings.defaultStyle.mono, true, "diventa lo stile predefinito dei nuovi spread");
  assert.equal(setAreaStyle(project, "x", 0, { gapCm: 1 }), project);
  assertProjectInvariants(album, "stile");
});

test("separatori: rapporto limitato, riportato al naturale e specchi del layout (in «foto intera» le divisioni non si spostano a mano)", () => {
  let project = filled(2, 0);
  const id = firstSpreadId(project);
  assert.equal(setDividerRatio(project, id, 0, "", 0.37), project, "foto allineate: il separatore non si trascina");
  project = setAreaStyle(project, id, 0, { mode: "fill" });
  const layout = project.spreads[0].areas[0].layout!;
  assert.equal(layout.kind, "split");
  const moved = setDividerRatio(project, id, 0, "", 0.37);
  assert.equal((moved.spreads[0].areas[0].layout as { ratio: number }).ratio, 0.37);
  assert.equal((setDividerRatio(project, id, 0, "", 5).spreads[0].areas[0].layout as { ratio: number }).ratio, 0.92);
  assert.equal(setDividerRatio(project, id, 0, "0", 0.4), project, "una foglia non ha rapporto");
  assert.equal(setDividerRatio(project, id, 0, "", (layout as { ratio: number }).ratio), project, "stesso valore: nessun cambiamento");
  const reset = resetDividerRatio(moved, id, 0, "");
  assert.ok(Math.abs((reset.spreads[0].areas[0].layout as { ratio: number }).ratio - (layout as { ratio: number }).ratio) < 0.35);
  const order = itemsOf(project, 0).map((i) => i.id);
  const mirrored = mirrorArea(project, id, 0, "horizontal");
  assertProjectInvariants(mirrored, "specchio");
  assert.equal(itemsOf(mirrored, 0).length, order.length);
  assert.equal(mirrorArea(filled(1, 0), id, 0, "horizontal").spreads[0].areas[0].items.length, 1);
  project = filled(1, 0);
  assert.equal(mirrorArea(project, firstSpreadId(project), 0, "vertical"), project, "una sola foto: niente da specchiare");
});

test("layout preferiti: salva la forma, non duplica, si riapplica a foto diverse con lo stesso numero", () => {
  let project = filled(3, 3);
  const id = firstSpreadId(project);
  project = shuffleArea(project, id, 0);
  project = saveFavoriteLayout(project, id, 0);
  assert.equal(project.favoriteLayouts.length, 1);
  assert.equal(project.favoriteLayouts[0].itemCount, 3);
  assert.equal(saveFavoriteLayout(project, id, 0), project, "stessa forma: nessun duplicato");
  assert.equal(isFavoriteLayout(project, project.spreads[0].areas[0]), true);
  assert.equal(favoritesFor(project, project.spreads[0].areas[1]).length, 1, "stesso numero di foto");
  const favoriteId = project.favoriteLayouts[0].id;
  const applied = applyFavoriteLayout(project, id, 1, favoriteId);
  assert.deepEqual(leafIds(applied.spreads[0].areas[1].layout), itemsOf(applied, 1).map((i) => i.id));
  assert.equal(JSON.stringify(applied.spreads[0].areas[1].layout).replaceAll(/"itemId":"[^"]+"/g, ""), JSON.stringify(project.spreads[0].areas[0].layout).replaceAll(/"itemId":"[^"]+"/g, ""), "stessa struttura");
  const two = filled(2, 0);
  assert.equal(applyFavoriteLayout({ ...two, favoriteLayouts: project.favoriteLayouts }, firstSpreadId(two), 0, favoriteId).spreads[0].areas[0].layout, two.spreads[0].areas[0].layout, "numero di foto diverso: nulla");
  assert.equal(removeFavoriteLayout(project, favoriteId).favoriteLayouts.length, 0);
  assert.equal(removeFavoriteLayout(project, "x"), project);
  const blank = withSpread(3);
  assert.equal(saveFavoriteLayout(blank, firstSpreadId(blank), 0), blank, "area vuota: nulla da salvare");
});

test("sostituire una foto senza cambiarne la posizione: asset nuovo, inquadratura azzerata", () => {
  let project = filled(2, 0);
  const [first] = itemsOf(project, 0);
  project = setItemView(project, first.id, { zoom: 3 });
  const replaced = replaceItemAsset(project, first.id, "a5");
  const item = findItem(replaced, first.id)!.item;
  assert.equal(item.assetId, "a5");
  assert.equal(item.zoom, 1);
  assert.equal(replaceItemAsset(project, first.id, first.assetId), project);
  assert.equal(replaceItemAsset(project, first.id, "inesistente"), project);
  assert.ok(makeAsset(1).fileName.startsWith("DSC"));
});

test("allinea: con «foto intera» cambia lo stile, con «riempi» ancora il ritaglio senza toccare le foto bloccate", () => {
  let project = filled(2, 0);
  const id = firstSpreadId(project);
  project = setAreaStyle(project, id, 0, { mode: "fill" });
  const [first, second] = itemsOf(project, 0);
  project = setItemView(project, first.id, { zoom: 3 });
  project = setItemView(project, second.id, { zoom: 3 });
  const start = alignArea(project, id, 0, "start");
  assert.equal(start.spreads[0].areas[0].style.align, "start");
  assert.ok(findItem(start, first.id)!.item.cx < 0.5 || findItem(start, first.id)!.item.cy < 0.5, "il ritaglio si sposta verso l'inizio");
  const end = alignArea(project, id, 0, "end");
  assert.ok(findItem(end, first.id)!.item.cx > 0.5 || findItem(end, first.id)!.item.cy > 0.5, "e verso la fine");
  const back = alignArea(end, id, 0, "center");
  assert.ok(Math.abs(findItem(back, first.id)!.item.cx - 0.5) < 1e-3 && Math.abs(findItem(back, first.id)!.item.cy - 0.5) < 1e-3);
  const locked = toggleItemLock(project, first.id);
  const keep = findItem(locked, first.id)!.item;
  const aligned = alignArea(locked, id, 0, "start");
  assert.equal(findItem(aligned, first.id)!.item.cx, keep.cx, "foto bloccata: nessuna modifica");

  const fit = setAreaStyle(project, id, 0, { mode: "fit" });
  const fitEnd = alignArea(fit, id, 0, "end");
  assert.equal(fitEnd.spreads[0].areas[0].style.align, "end");
  assert.equal(findItem(fitEnd, first.id)!.item.cx, findItem(fit, first.id)!.item.cx, "in «foto intera» le inquadrature non cambiano");
  assert.equal(alignArea(project, "x", 0, "start"), project);
  assert.equal(alignArea(project, id, 9, "start"), project);
  assertProjectInvariants(aligned, "allinea");
});

test("nuovo spread dal trascinamento: dalla libreria copia, da uno spread sposta, nella posizione scelta", () => {
  let project = makeProject(6);
  project = addSpread(project);
  project = dropOnSpread(project, project.spreads[0].id, { areaIndex: 0, itemId: null, zone: "area" }, { kind: "assets", assetIds: ["a0", "a1"] });
  const first = project.spreads[0].areas[0].items[0];
  const fromLibrary = moveToNewSpread(project, 1, { kind: "assets", assetIds: ["a4"] });
  assert.equal(fromLibrary.project.spreads.length, 2);
  assert.equal(fromLibrary.project.spreads[1].id, fromLibrary.spreadId);
  assert.equal(fromLibrary.project.spreads[1].areas[0].items[0].assetId, "a4");
  assert.equal(fromLibrary.project.spreads[0].areas[0].items.length, 2, "la libreria copia: lo spread di partenza non cambia");
  assertProjectInvariants(fromLibrary.project, "da libreria");
  const moved = moveToNewSpread(project, 0, { kind: "item", itemId: first.id });
  assert.equal(moved.project.spreads[0].areas[0].items[0].assetId, first.assetId, "il nuovo spread è in testa");
  assert.equal(moved.project.spreads[1].areas[0].items.length, 1, "la foto è stata tolta dallo spread di partenza");
  assertProjectInvariants(moved.project, "spostata");
  assert.equal(moveToNewSpread(project, 5, { kind: "assets", assetIds: ["inesistente"] }).spreadId, null);
  assert.equal(moveToNewSpread(project, 99, { kind: "assets", assetIds: ["a3"] }).project.spreads.length, 2, "posizione oltre la fine: in coda");
});

test("foto su un altro spread: da uno spread successivo a uno precedente sposta, dalla libreria copia", () => {
  let project = addSpread(addSpread(makeProject(6)));
  project = dropOnSpread(project, project.spreads[1].id, { areaIndex: 0, itemId: null, zone: "area" }, { kind: "assets", assetIds: ["a0", "a1"] });
  const later = project.spreads[1].areas[0].items[0];
  const moved = moveToSpread(project, project.spreads[0].id, { kind: "item", itemId: later.id });
  assert.equal(moved.spreads[0].areas[0].items[0].assetId, later.assetId, "finisce nello spread vuoto");
  assert.equal(moved.spreads[1].areas[0].items.length, 1, "e viene tolta dallo spread di partenza");
  assertProjectInvariants(moved, "spostata indietro");
  assert.equal(moveToSpread(project, project.spreads[1].id, { kind: "item", itemId: later.id }), project, "sullo stesso spread: nessun cambio");
  const copied = moveToSpread(project, project.spreads[0].id, { kind: "assets", assetIds: ["a4"] });
  assert.equal(copied.spreads[0].areas[0].items[0].assetId, "a4");
  const again = moveToSpread(copied, copied.spreads[0].id, { kind: "assets", assetIds: ["a5"] });
  assert.equal(again.spreads[0].areas[1].items.length, 1, "con la prima pagina piena va nell'altra pagina vuota");
  assertProjectInvariants(again, "seconda pagina");
});

test("rilascio intelligente: sul bordo dell'area nasce una colonna o riga intera, tra due foto si infila in mezzo", () => {
  let project = addSpread(makeProject(8));
  const id = project.spreads[0].id;
  project = dropOnSpread(project, id, { areaIndex: 0, itemId: null, zone: "area" }, { kind: "assets", assetIds: ["a0", "a1", "a2"] });
  const area = () => { const g = spreadGeometry(project, project.spreads[0])[0]; return [{ rect: g.outer, cells: g.cells, dividers: g.dividers }]; };
  const g0 = spreadGeometry(project, project.spreads[0])[0];

  // bordo sinistro dell'area: colonna intera
  const edge = resolveDropTarget(area(), g0.outer.x + 3, g0.outer.y + g0.outer.h / 2)!;
  assert.deepEqual([edge.zone, edge.node], ["left", ""]);
  const withColumn = dropOnSpread(project, id, edge, { kind: "assets", assetIds: ["a5"] });
  const tree = withColumn.spreads[0].areas[0].layout!;
  assert.equal(tree.kind === "split" && tree.dir === "row", true, "la radice diventa una divisione in colonne");
  assert.equal(withColumn.spreads[0].areas[0].items.length, 4);
  assert.equal(withColumn.spreads[0].areas[0].items[0].assetId, "a5", "la foto nuova è la prima in lettura (a sinistra)");
  assertProjectInvariants(withColumn, "colonna intera");
  const bottom = resolveDropTarget(area(), g0.outer.x + g0.outer.w / 2, g0.outer.y + g0.outer.h - 3)!;
  assert.deepEqual([bottom.zone, bottom.node], ["bottom", ""]);
  assertProjectInvariants(dropOnSpread(project, id, bottom, { kind: "assets", assetIds: ["a5", "a6"] }), "riga intera con due foto");

  // tra due foto: sul separatore
  const divider = g0.dividers[0];
  const px = divider.dir === "row" ? divider.line.x + divider.line.w / 2 : g0.outer.x + g0.outer.w / 2;
  const py = divider.dir === "row" ? g0.outer.y + g0.outer.h / 2 : divider.line.y + divider.line.h / 2;
  const between = resolveDropTarget(area(), px, py);
  assert.ok(between && between.node === `${divider.path}1`, "il punto sul separatore è un rilascio tra due rami");
  const inserted = dropOnSpread(project, id, between!, { kind: "assets", assetIds: ["a6"] });
  assert.equal(inserted.spreads[0].areas[0].items.length, 4);
  assertProjectInvariants(inserted, "tra due foto");

  // trascinare una foto dello spread lungo il bordo la sposta
  const lastItem = project.spreads[0].areas[0].items[2];
  const moved = dropOnSpread(project, id, edge, { kind: "item", itemId: lastItem.id });
  assert.equal(moved.spreads[0].areas[0].items.length, 3);
  assert.equal(moved.spreads[0].areas[0].items[0].id, lastItem.id);
  assertProjectInvariants(moved, "spostata sul bordo");
  // con una sola foto non ci sono zone intelligenti: resta il comportamento classico
  const one = dropOnSpread(addSpread(makeProject(3)), addSpread(makeProject(3)).spreads[0].id, { areaIndex: 0, itemId: null, zone: "area" }, { kind: "assets", assetIds: ["a0"] });
  const g1 = spreadGeometry(one, one.spreads[0])[0];
  assert.notEqual(resolveDropTarget([{ rect: g1.outer, cells: g1.cells, dividers: g1.dividers }], g1.outer.x + 2, g1.outer.y + 40)!.node, "");
});

test("anteprima del rilascio: il riquadro mostrato coincide con il posto che la foto occupa davvero", () => {
  let project = addSpread(makeProject(9));
  const id = project.spreads[0].id;
  project = dropOnSpread(project, id, { areaIndex: 0, itemId: null, zone: "area" }, { kind: "assets", assetIds: ["a0", "a1", "a2"] });
  const g = spreadGeometry(project, project.spreads[0])[0];
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const targets: DropTarget[] = [
    ...(["left", "right", "top", "bottom"] as const).map((zone) => ({ areaIndex: 0, itemId: project.spreads[0].areas[0].items[1].id, zone })),
    { areaIndex: 0, itemId: null, zone: "left", node: "" },
    { areaIndex: 0, itemId: null, zone: "bottom", node: "" },
    { areaIndex: 0, itemId: null, zone: g.dividers[0].dir === "row" ? "left" : "top", node: `${g.dividers[0].path}1` },
  ];
  for (const target of targets) {
    for (const asset of ["a3", "a4", "a7"]) {   // 6000x4000, 4000x6000, 4000x6000
      const preview = previewDropRect(project.settings.sheet, project.spreads[0], assets, target, { assetId: asset });
      assert.ok(preview, `anteprima per ${target.zone}/${target.node}`);
      const after = dropOnSpread(project, id, target, { kind: "assets", assetIds: [asset] });
      const added = after.spreads[0].areas[0].items.find((item) => !project.spreads[0].areas[0].items.some((old) => old.id === item.id))!;
      const realCell = spreadGeometry(after, after.spreads[0])[0].cells.find((cell) => cell.itemId === added.id)!;
      const areaAfter = after.spreads[0].areas[0];
      // In «foto intera» l'anteprima mostra lo spazio della foto, non quello dell'intera cella.
      const real = placeItem(realCell.rect, added, after.assets.find((candidate) => candidate.id === added.assetId), areaAfter.style, null, realCell.anchor).content;
      for (const key of ["x", "y", "w", "h"] as const) assert.ok(Math.abs(preview[key] - real[key]) < 1e-6, `${target.zone}/${target.node} ${asset}: ${key} ${preview[key]} ≠ ${real[key]}`);
    }
  }
  // Al centro di una foto l'anteprima è la finestra che la nuova foto occuperà davvero (non l'intera cella di prima).
  const centerId = project.spreads[0].areas[0].items[0].id;
  for (const asset of ["a3", "a4", "a7"]) {
    const preview = previewDropRect(project.settings.sheet, project.spreads[0], assets, { areaIndex: 0, itemId: centerId, zone: "center" }, { assetId: asset });
    assert.ok(preview, `anteprima al centro con ${asset}`);
    const after = dropOnSpread(project, id, { areaIndex: 0, itemId: centerId, zone: "center" }, { kind: "assets", assetIds: [asset] });
    const replaced = after.spreads[0].areas[0].items.find((item) => item.id === centerId)!;
    const cell = spreadGeometry(after, after.spreads[0])[0].cells.find((candidate) => candidate.itemId === centerId)!;
    const real = placeItem(cell.rect, replaced, after.assets.find((candidate) => candidate.id === replaced.assetId), after.spreads[0].areas[0].style, null, cell.anchor).content;
    for (const key of ["x", "y", "w", "h"] as const) assert.ok(Math.abs(preview[key] - real[key]) < 1e-6, `centro ${asset}: ${key} ${preview[key]} ≠ ${real[key]}`);
  }
});

test("foto intera: cambiando il modo la disposizione resta e i bordi vuoti non aumentano", () => {
  let project = addSpread(makeProject(10));
  const id = project.spreads[0].id;
  project = dropOnSpread(project, id, { areaIndex: 0, itemId: null, zone: "area" }, { kind: "assets", assetIds: ["a0", "a1", "a2", "a3", "a4"] });
  const waste = (p: Project) => {
    const area = p.spreads[0].areas[0];
    const cells = spreadGeometry(p, p.spreads[0])[0].cells;
    const assets = new Map(p.assets.map((a) => [a.id, a]));
    return cells.reduce((sum, cell) => {
      const item = area.items.find((i) => i.id === cell.itemId)!;
      const c = cell.rect.w / cell.rect.h;
      const a = itemAspect(assets.get(item.assetId));
      return sum + (1 - Math.min(c / a, a / c)) * cell.rect.w * cell.rect.h;
    }, 0);
  };
  // un layout volutamente poco adatto (l'ultimo dell'elenco)
  project = setAreaStyle(project, id, 0, { mode: "fill" });
  const bad = applyCandidate(project, id, 0, areaCandidates(project, project.spreads[0], 0, 24).length - 1);
  const fitted = setAreaStyle(bad, id, 0, { mode: "fit" });
  assert.equal(fitted.spreads[0].areas[0].style.mode, "fit");
  assert.equal(fitted.spreads[0].areas[0].seed, bad.spreads[0].areas[0].seed, "la disposizione scelta resta");
  assert.ok(waste(fitted) <= waste(bad) + 1e-6, `bordi vuoti: ${waste(bad)} → ${waste(fitted)}`);
  assertProjectInvariants(fitted, "foto intera");
  const back = setAreaStyle(fitted, id, 0, { mode: "fill" });
  assert.equal(back.spreads[0].areas[0].seed, bad.spreads[0].areas[0].seed, "tornando a «riempi» la disposizione non cambia");
  // se il modo non cambia, il layout scelto a mano resta
  const kept = setAreaStyle(bad, id, 0, { gapCm: 0.5 });
  assert.deepEqual(kept.spreads[0].areas[0].layout !== null && JSON.stringify(kept.spreads[0].areas[0].layout) === JSON.stringify(bad.spreads[0].areas[0].layout), true);
  // su tutto l'album
  const album = applyStyleToAlbum(setAreaStyle(bad, id, 0, { mode: "fit" }), id, 0);
  assertProjectInvariants(album, "album in foto intera");
});

test("foto intera: una foto ingrandita o raddrizzata riempie la sua cella, le altre restano intere", () => {
  let project = addSpread(makeProject(10));
  const id = project.spreads[0].id;
  project = dropOnSpread(project, id, { areaIndex: 0, itemId: null, zone: "area" }, { kind: "assets", assetIds: ["a0", "a1"] });
  project = setAreaStyle(project, id, 0, { mode: "fit" });
  const [first, second] = itemsOf(project, 0);
  const place = (p: Project, itemId: string) => {
    const area = p.spreads[0].areas[0];
    const cell = spreadGeometry(p, p.spreads[0])[0].cells.find((c) => c.itemId === itemId)!;
    return placeItem(cell.rect, area.items.find((i) => i.id === itemId)!, p.assets.find((a) => a.id === area.items.find((i) => i.id === itemId)!.assetId), area.style, null, cell.anchor);
  };
  const zoomed = setItemView(project, first.id, { zoom: 2 });
  assert.equal(itemsOf(zoomed, 0)[0].zoom, 2, "lo zoom si memorizza anche in foto intera");
  assert.ok(place(zoomed, first.id).crop.cropWidth < 1 || place(zoomed, first.id).crop.cropHeight < 1, "la foto ingrandita è ritagliata");
  assert.equal(place(zoomed, second.id).crop.cropWidth, 1, "l'altra resta intera");
  const turned = setItemView(project, first.id, { angle: 3 });
  assert.equal(place(turned, first.id).angle, 3, "il raddrizzamento vale anche in foto intera");
  assertProjectInvariants(turned, "raddrizzata in foto intera");
});

test("Modo con Alt + clic: ridisegna la disposizione migliore, il clic semplice la tiene", () => {
  let project = addSpread(makeProject(10));
  const id = project.spreads[0].id;
  project = dropOnSpread(project, id, { areaIndex: 0, itemId: null, zone: "area" }, { kind: "assets", assetIds: ["a0", "a1", "a2", "a3", "a4"] });
  project = setAreaStyle(project, id, 0, { mode: "fill" });
  const last = areaCandidates(project, project.spreads[0], 0, 24).length - 1;
  const manual = applyCandidate(project, id, 0, last);
  const kept = setAreaStyle(manual, id, 0, { mode: "fit" });
  assert.equal(kept.spreads[0].areas[0].seed, last, "clic semplice: la disposizione scelta resta");
  const redone = setAreaStyle(manual, id, 0, { mode: "fit" }, true);
  assert.equal(redone.spreads[0].areas[0].seed, 0, "Alt + clic: ricalcolata con la migliore");
  assertProjectInvariants(redone, "Alt + clic su Modo");
});

test("provino: spostare più spread insieme davanti a una posizione tiene l'ordine e non perde né duplica nulla", () => {
  let project = makeProject(4);
  for (let i = 0; i < 7; i += 1) project = addSpread(project);
  const ids = project.spreads.map((spread) => spread.id);
  const order = (p: Project) => p.spreads.map((spread) => ids.indexOf(spread.id));
  assert.deepEqual(order(moveSpreads(project, [4, 5], 1)), [0, 4, 5, 1, 2, 3, 6]);
  assert.deepEqual(order(moveSpreads(project, [1, 3], 7)), [0, 2, 4, 5, 6, 1, 3]);
  assert.deepEqual(order(moveSpreads(project, [2], 0)), [2, 0, 1, 3, 4, 5, 6]);
  assert.deepEqual(order(moveSpreads(project, [5, 1], 3)), [0, 2, 1, 5, 3, 4, 6], "gli spostati tengono l'ordine reciproco");
  // lasciare gli spread dove sono non cambia nulla
  assert.equal(moveSpreads(project, [2], 2), project);
  assert.equal(moveSpreads(project, [2], 3), project);
  assert.equal(moveSpreads(project, [], 1), project);
  assert.equal(moveSpreads(project, [99], 1), project);
  assert.equal(moveSpreads(project, [1], 99), project);
  for (const move of [[0, 1, 2], [3], [6, 0], [2, 4, 5]]) {
    for (let before = 0; before <= 7; before += 1) {
      const result = moveSpreads(project, move, before);
      assert.equal(new Set(result.spreads.map((spread) => spread.id)).size, 7);
      assertProjectInvariants(result, `provino ${move}→${before}`);
    }
  }
});

test("provino: 300 riordini casuali coincidono con il calcolo di riferimento e non perdono né duplicano spread", () => {
  let project = makeProject(4);
  for (let i = 0; i < 12; i += 1) project = addSpread(project);
  let seed = 12345;
  const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  let expected = project.spreads.map((spread) => spread.id);
  for (let step = 0; step < 300; step += 1) {
    const count = 1 + Math.floor(random() * 4);
    const indices = Array.from({ length: count }, () => Math.floor(random() * expected.length));
    const before = Math.floor(random() * (expected.length + 1));
    const moving = [...new Set(indices)].sort((x, y) => x - y);
    const rest = expected.filter((_, index) => !moving.includes(index));
    const at = expected.slice(0, before).filter((_, index) => !moving.includes(index)).length;
    expected = [...rest.slice(0, at), ...moving.map((index) => expected[index]), ...rest.slice(at)];
    project = moveSpreads(project, indices, before);
    assert.deepEqual(project.spreads.map((spread) => spread.id), expected, `passo ${step}`);
  }
  assertProjectInvariants(project, "dopo 300 riordini");
});

test("copertina del progetto: si sceglie una foto, si toglie, segue il salvataggio e sparisce se la foto viene tolta dall'album", () => {
  let project = withSpread(5);
  project = appendAssets(project, firstSpreadId(project), 0, ["a2", "a3"]);
  assert.equal(coverAssetOf(project)?.id, "a2", "senza scelta: la prima foto impaginata");
  const chosen = setCoverAsset(project, "a4");
  assert.equal(chosen.coverAssetId, "a4");
  assert.equal(coverAssetOf(chosen)?.id, "a4", "la copertina scelta vince, anche se non è impaginata");
  assert.equal(setCoverAsset(chosen, "a4"), chosen, "stessa foto: nessun cambiamento");
  assert.equal(setCoverAsset(project, "inesistente"), project);
  assert.equal("coverAssetId" in setCoverAsset(chosen, null), false);
  assert.equal(setCoverAsset(project, null), project);
  assertProjectInvariants(chosen, "copertina");
  assert.equal(parseAlbumProject(serializeAlbumProject(chosen)).coverAssetId, "a4", "salvataggio e riapertura");
  assert.throws(() => parseAlbumProject(serializeAlbumProject({ ...chosen, coverAssetId: "x" })), "copertina verso una foto inesistente");
  const removed = removeAssets(chosen, ["a4"]);
  assert.equal(removed.coverAssetId, undefined, "tolta la foto, la copertina torna automatica");
  assert.equal(removeAssets(chosen, ["a0"]).coverAssetId, "a4", "togliere altre foto non la tocca");
  assertProjectInvariants(removed, "copertina rimossa");
});

// ------------------------------------------------------------------ template dell'utente

const frame = (x: number, y: number, w: number, h: number, z = 0, rotation = 0) => ({ x, y, w, h, z, rotation });

function threePhotoProject(): Project {
  let project = addSpread(addSpread(makeProject(12)));
  project = dropOnSpread(project, project.spreads[0].id, { areaIndex: 0, itemId: null, zone: "area" }, { kind: "assets", assetIds: ["a0", "a1", "a2"] });
  project = dropOnSpread(project, project.spreads[1].id, { areaIndex: 0, itemId: null, zone: "area" }, { kind: "assets", assetIds: ["a8", "a3", "a4"] });
  return project;
}

function areaGeometryOf(project: Project) {
  return spreadGeometry(project, project.spreads[0])[0].cells;
}

test("template ad albero: dal layout di un'area a un'altra con lo stesso numero di foto, foto abbinate alle celle giuste", () => {
  const project = threePhotoProject();
  const first = project.spreads[0];
  const template = templateFromArea(project, first.id, 0, "Tre foto")!;
  assert.deepEqual([template.kind, template.target, template.count, template.name], ["tree", "page", 3, "Tre foto"]);
  const matches = matchTemplates(project, project.spreads[1], 0, [template]);
  assert.equal(matches.length, 1);
  assert.equal(matchTemplates(project, project.spreads[1], 1, [template]).length, 0, "pagina vuota: niente da abbinare");
  assert.equal(matchTemplates(project, project.spreads[1], 0, [{ ...template, target: "full" }]).length, 0, "tipo di area diverso");
  assert.equal(matchTemplates(project, project.spreads[1], 0, [{ ...template, count: 2 }]).length, 0, "numero di foto diverso");
  const before = project.spreads[1].areas[0].items.map((i) => i.assetId);
  const applied = applyTemplate(project, project.spreads[1].id, 0, template, matches[0].order);
  const area = applied.spreads[1].areas[0];
  assert.deepEqual(area.items.map((i) => i.assetId).sort(), [...before].sort(), "stesse foto, forse in altro ordine");
  assert.ok(!hasFreeLayout(area));
  assert.equal(JSON.stringify(leafIds(area.layout)), JSON.stringify(area.items.map((i) => i.id)));
  assertProjectInvariants(applied, "template ad albero");
  assert.equal(applyTemplate(project, project.spreads[1].id, 0, { ...template, count: 4 }), project, "numero di foto diverso: nessun cambio");
});

test("abbinamento: la foto verticale va nella cella verticale, a parità resta l'ordine", () => {
  const cells = [1.5, 0.667, 1.5];
  const photos = [0.667, 1.5, 1.5];
  const best = bestAssignment(cells, photos);
  assert.deepEqual(best.order, [1, 0, 2], "la verticale (foto 0) va nella cella 1");
  assert.ok(best.cost < 0.01);
  assert.deepEqual(bestAssignment([1.5, 1.5], [1.5, 1.5]).order, [0, 1], "tutte uguali: ordine invariato");
  assert.deepEqual(bestAssignment(cells, photos, true).order, [0, 1, 2], "con foto bloccate l'ordine non cambia");
  assert.deepEqual(bestAssignment(Array(9).fill(1.5), Array(9).fill(0.7)).order, [0, 1, 2, 3, 4, 5, 6, 7, 8], "oltre il limite resta l'ordine");
});

test("template libero: foto che si sovrappongono, rotazione e livelli, e cosa lo fa decadere", () => {
  let project = threePhotoProject();
  const free = sanitizeTemplate({ id: "t-free", name: "Grande con due appoggiate", kind: "free", target: "page", frames: [frame(0.02, 0.02, 0.96, 0.96, 0), frame(0.5, 0.55, 0.4, 0.4, 2, 6), frame(0.08, 0.05, 0.3, 0.3, 1, -4)], createdAt: "2026-10-01" })!;
  assert.equal(free.count, 3);
  const id = project.spreads[0].id;
  const match = matchTemplates(project, project.spreads[0], 0, [free])[0];
  project = applyTemplate(project, id, 0, free, match.order);
  let area = project.spreads[0].areas[0];
  assert.ok(hasFreeLayout(area));
  assertProjectInvariants(project, "libero");
  const cells = areaGeometryOf(project);
  assert.ok(cells.some((c, i) => cells.some((d, j) => i < j && c.rect.x < d.rect.x + d.rect.w && d.rect.x < c.rect.x + c.rect.w && c.rect.y < d.rect.y + d.rect.h && d.rect.y < c.rect.y + c.rect.h)), "le foto si sovrappongono davvero");
  assert.deepEqual(cells.map((c) => [c.rotation, c.z]).sort(), [[-4, 1], [0, 0], [6, 2]].sort());

  assert.ok(hasFreeLayout(setAreaStyle(project, id, 0, { gapCm: 1, borderCm: 0.2 }).spreads[0].areas[0]));
  const itemId = area.items[0].id;
  assert.ok(hasFreeLayout(setItemView(project, itemId, { zoom: 2 }).spreads[0].areas[0]));
  const removed = removeItem(project, area.items[2].id);
  assert.ok(hasFreeLayout(removed.spreads[0].areas[0]) && removed.spreads[0].areas[0].items.length === 2);
  assertProjectInvariants(removed, "foto tolta");
  const appended = appendAssets(project, id, 0, ["a9"]).spreads[0].areas[0];
  assert.ok(hasFreeLayout(appended), "aggiungere una foto non azzera le posizioni libere");
  for (const item of area.items) assert.deepEqual(appended.free![item.id], area.free![item.id], "le foto già presenti restano dove sono");
  assert.equal(appended.items.length, area.items.length + 1);
  assert.ok(!hasFreeLayout(shuffleArea(project, id, 0).spreads[0].areas[0]));
  assert.ok(!hasFreeLayout(applyCandidateByNumber(project, id, 0, 1).spreads[0].areas[0]));
  assertProjectInvariants(shuffleArea(project, id, 0), "dopo mescola");
  const mirrored = mirrorArea(project, id, 0, "horizontal").spreads[0].areas[0];
  assert.ok(hasFreeLayout(mirrored));
  assert.equal(mirrored.free![itemId].x, Number((1 - area.free![itemId].x - area.free![itemId].w).toFixed(6)));
  assert.equal(mirrored.free![area.items[1].id].rotation, -area.free![area.items[1].id].rotation);
  const moved = setFrame(project, itemId, { x: 5, y: -3, rotation: 400 });
  const f = moved.spreads[0].areas[0].free![itemId];
  assert.ok(f.x <= 1 - 0.25 * f.w + 1e-9 && f.y >= -0.75 * f.h - 1e-9 && f.rotation === 180, "la cornice può uscire in parte, ma almeno un quarto resta nell'area");
  assert.ok(f.x + f.w > 1 && f.y < 0, "uscire in parte dal margine è consentito");
  const front = reorderFrame(project, itemId, "front").spreads[0].areas[0];
  assert.ok(Math.max(...Object.values(front.free!).map((x) => x.z)) === front.free![itemId].z);
  assert.equal(setFrame(project, itemId, {}), project, "nessun cambio");
  assert.deepEqual(parseAlbumProject(serializeAlbumProject(project)), JSON.parse(JSON.stringify(project)));
  assert.equal(setFrame(toggleItemLock(project, itemId), itemId, { x: 0.2 }).spreads[0].areas[0].free![itemId].x, area.free![itemId].x, "bloccata: non si sposta");
  const back = templateFromArea(project, id, 0, "Copia")!;
  assert.equal(back.kind, "free");
  area = project.spreads[0].areas[0];
  assert.deepEqual(back.frames, area.items.map((i) => area.free![i.id]));
});

test("template salvati: validazione, nomi unici, ordine e archivio locale", () => {
  const good = sanitizeTemplate({ id: "a", name: "  Due colonne ", kind: "tree", target: "page", shape: { kind: "split", dir: "row", ratio: 0.5, first: { kind: "leaf", itemId: "x" }, second: { kind: "leaf", itemId: "y" } }, createdAt: "2026-10-01" })!;
  assert.equal(good.name, "Due colonne");
  assert.equal(good.count, 2);
  assert.equal(sanitizeTemplate({ id: "b", name: "", kind: "tree", target: "page", shape: good.shape }), null, "senza nome");
  assert.equal(sanitizeTemplate({ id: "b", name: "x", kind: "free", target: "page", frames: [] }), null, "senza cornici");
  assert.equal(sanitizeTemplate({ id: "b", name: "x", kind: "tree", target: "altro", shape: good.shape }), null, "tipo sconosciuto");
  assert.equal(sanitizeTemplate("rotto"), null);
  let list = upsertTemplate([], good);
  list = upsertTemplate(list, { ...good, id: "c" });
  assert.deepEqual(list.map((t) => t.name), ["Due colonne", "Due colonne (2)"], "nomi unici per tipo di area");
  list = upsertTemplate(list, { ...good, id: "a", name: "Rinominato" });
  assert.deepEqual(list.map((t) => t.name), ["Rinominato", "Due colonne (2)"], "stesso id: sostituisce");
  assert.equal(removeTemplate(list, "a").length, 1);
  assert.throws(() => upsertTemplate([], { ...good, name: "" }), /non valido/);
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
  assert.deepEqual(loadTemplates(), []);
  assert.ok(saveTemplates(list));
  assert.deepEqual(loadTemplates().map((t) => t.id), ["a", "c"]);
  store.set(TEMPLATE_STORAGE_KEY, JSON.stringify([good, { rotto: true }, "x"]));
  assert.equal(loadTemplates().length, 1, "le voci non valide si scartano");
  store.set(TEMPLATE_STORAGE_KEY, "{non json");
  assert.deepEqual(loadTemplates(), []);
  assert.equal(templateTarget({ split: "third" }, 0), "third");
  assert.equal(templateTarget({ split: "third" }, 1), "two-thirds");
  assert.equal(templateTarget({ split: "two-thirds" }, 0), "two-thirds");
  assert.equal(templateTarget({ split: "full" }, 0), "full");
});

test("template e Auto Build: si usano dove il numero di foto coincide e il ritaglio è paragonabile", () => {
  const project = autoBuildAlbum(makeProject(24), { ...DEFAULT_AUTO_BUILD, photosPerArea: 3 });
  const tpl = sanitizeTemplate({ id: "t1", name: "Tre in riga", kind: "tree", target: "page", shape: { kind: "split", dir: "row", ratio: 0.33, first: { kind: "leaf", itemId: "0" }, second: { kind: "split", dir: "row", ratio: 0.5, first: { kind: "leaf", itemId: "1" }, second: { kind: "leaf", itemId: "2" } } }, createdAt: "2026-10-01" })!;
  assert.equal(applyTemplatesToAlbum(project, [], 0.2).applied, 0);
  assert.equal(applyTemplatesToAlbum(project, [tpl], -1).applied, 0, "con tolleranza negativa nessun template è abbastanza buono");
  const loose = applyTemplatesToAlbum(project, [tpl], 5);
  const threes = project.spreads.flatMap((s) => s.areas).filter((a) => a.items.length === 3).length;
  assert.equal(loose.applied, threes, "tutte le aree da tre foto usano il template");
  assertProjectInvariants(loose.project, "template su tutto l'album");
  const done = { ...project, spreads: project.spreads.map((s, i) => (i === 0 ? { ...s, done: true } : s)) };
  assert.equal(JSON.stringify(applyTemplatesToAlbum(done, [tpl], 5).project.spreads[0]), JSON.stringify(done.spreads[0]), "gli spread finiti non cambiano");
});

// ------------------------------------------------------------------ allineamento in «foto intera»

function photoRects(project: Project, spreadIndex = 0, areaIndex = 0) {
  const spread = project.spreads[spreadIndex];
  const area = spread.areas[areaIndex];
  const assets = new Map(project.assets.map((a) => [a.id, a]));
  return spreadGeometry(project, spread)[areaIndex].cells.map((cell) => {
    const item = area.items.find((i) => i.id === cell.itemId)!;
    return placeItem(cell.rect, item, assets.get(item.assetId), area.style, null, cell.anchor).content;
  });
}

test("foto intera: una verticale e una orizzontale affiancate hanno la stessa altezza, sempre", () => {
  let project = addSpread(makeProject(9));
  const id = project.spreads[0].id;
  // a0 orizzontale (3:2), a1 verticale (2:3)
  project = dropOnSpread(project, id, { areaIndex: 0, itemId: null, zone: "area" }, { kind: "assets", assetIds: ["a0"] });
  project = setAreaStyle(project, id, 0, { mode: "fit" });
  project = dropOnSpread(project, id, { areaIndex: 0, itemId: project.spreads[0].areas[0].items[0].id, zone: "right" }, { kind: "assets", assetIds: ["a1"] });
  const heights = (p: Project) => photoRects(p).map((r) => Number(r.h.toFixed(4)));
  const two = heights(project);
  assert.equal(two.length, 2);
  assert.ok(Math.abs(two[0] - two[1]) < 0.01, `stessa altezza: ${two}`);
  assertProjectInvariants(project, "due foto allineate");

  // una terza foto affiancata a sinistra, poi a destra: tutta la riga resta allineata
  const first = () => project.spreads[0].areas[0].items[0].id;
  project = dropOnSpread(project, id, { areaIndex: 0, itemId: first(), zone: "left" }, { kind: "assets", assetIds: ["a3"] });
  let h = heights(project);
  assert.ok(Math.max(...h) - Math.min(...h) < 0.01, `tre foto: ${h}`);
  // scambio di due foto, sostituzione, rimozione: l'allineamento si mantiene
  const items = project.spreads[0].areas[0].items;
  h = heights(swapItems(project, items[0].id, items[1].id));
  assert.ok(Math.max(...h) - Math.min(...h) < 0.01, `dopo lo scambio: ${h}`);
  h = heights(replaceItemAsset(project, items[1].id, "a6"));
  assert.ok(Math.max(...h) - Math.min(...h) < 0.01, `dopo la sostituzione: ${h}`);
  h = heights(removeItem(project, items[0].id));
  assert.ok(Math.max(...h) - Math.min(...h) < 0.01, `dopo aver tolto una foto: ${h}`);
  h = heights(appendAssets(project, id, 0, ["a7"]));
  assert.ok(h.length === 4, "quattro foto");

  // in «riempi» nulla cambia: le divisioni non vengono regolate
  const fillProject = setAreaStyle(project, id, 0, { mode: "fill" });
  assert.equal(fillProject.spreads[0].areas[0].style.mode, "fill");
});

test("foto intera: Auto Build, mescola e layout alternativi producono aree allineate", () => {
  const project = autoBuildAlbum(makeProject(24), { ...DEFAULT_AUTO_BUILD, photosPerArea: 2, fitMode: "fit", splitMode: "half" });
  let checked = 0;
  project.spreads.forEach((spread, spreadIndex) => spread.areas.forEach((area, areaIndex) => {
    if (area.items.length !== 2 || !area.layout || area.layout.kind !== "split") return;
    const rects = photoRects(project, spreadIndex, areaIndex);
    const same = area.layout.dir === "row" ? Math.abs(rects[0].h - rects[1].h) < 0.01 : Math.abs(rects[0].w - rects[1].w) < 0.01;
    assert.ok(same, `spread ${spreadIndex + 1}: ${JSON.stringify(rects)}`);
    checked += 1;
  }));
  assert.ok(checked >= 6, `controllate ${checked} aree`);
  const spreadId = project.spreads[0].id;
  for (let step = 0; step < 6; step += 1) {
    const shuffled = shuffleArea(project, spreadId, 0, 1);
    const area = shuffled.spreads[0].areas[0];
    if (area.items.length === 2 && area.layout?.kind === "split" && area.layout.dir === "row") {
      const rects = photoRects(shuffled);
      assert.ok(Math.abs(rects[0].h - rects[1].h) < 0.01, "dopo Mescola");
    }
  }
});

test("foto intera: due orizzontali impilate accanto a una verticale formano un blocco allineato, senza spazi laterali", () => {
  let project = addSpread(makeProject(9));
  const id = project.spreads[0].id;
  project = dropOnSpread(project, id, { areaIndex: 0, itemId: null, zone: "area" }, { kind: "assets", assetIds: ["a0"] });
  project = setAreaStyle(project, id, 0, { mode: "fit" });
  const first = project.spreads[0].areas[0].items[0].id;
  project = dropOnSpread(project, id, { areaIndex: 0, itemId: first, zone: "bottom" }, { kind: "assets", assetIds: ["a2"] });
  project = dropOnSpread(project, id, { areaIndex: 0, itemId: null, zone: "right", node: "" }, { kind: "assets", assetIds: ["a1"] });
  const rects = photoRects(project);
  const [top, bottom, tall] = rects;
  assert.ok(Math.abs(top.y - tall.y) < 0.01, "il bordo alto coincide");
  assert.ok(Math.abs(bottom.y + bottom.h - (tall.y + tall.h)) < 0.01, "il bordo basso coincide");
  const cells = spreadGeometry(project, project.spreads[0])[0].cells;
  assert.ok(Math.abs(top.w - cells[0].rect.w) < 0.01 && Math.abs(bottom.w - cells[1].rect.w) < 0.01, "le orizzontali riempiono la larghezza della loro colonna");
  assert.ok(Math.abs(tall.h - cells[2].rect.h) < 0.5 || tall.h <= cells[2].rect.h + 1e-6);
  assertProjectInvariants(project, "blocco allineato");
});

test("allinea le foto: sistema layout vecchi in «foto intera», non tocca «riempi» né gli spread finiti", () => {
  let project = addSpread(addSpread(makeProject(9)));
  const [a, b] = project.spreads.map((s) => s.id);
  for (const id of [a, b]) project = dropOnSpread(project, id, { areaIndex: 0, itemId: null, zone: "area" }, { kind: "assets", assetIds: ["a0", "a1", "a2"] });
  // un layout poco allineato: separatori spostati a mano, poi «foto intera» senza ricalcolo (stile impostato direttamente)
  const tilt = (p: Project, id: string): Project => ({ ...p, spreads: p.spreads.map((s) => (s.id !== id ? s : { ...s, areas: s.areas.map((area, i) => (i === 0 ? { ...area, style: { ...area.style, mode: "fit" as const }, layout: area.layout!.kind === "split" ? { ...area.layout, ratio: 0.8 } : area.layout } : area)) })) }) as Project;
  project = tilt(tilt(project, a), b);
  const spreadA = alignFitAreas(project, a);
  assert.notEqual(spreadA.spreads[0].areas[0].layout, project.spreads[0].areas[0].layout, "lo spread A cambia");
  assert.equal(spreadA.spreads[1], project.spreads[1], "lo spread B no");
  const album = alignFitAreas(project);
  assert.notEqual(album.spreads[1].areas[0].layout, project.spreads[1].areas[0].layout);
  assert.equal(alignFitAreas(album), album, "già allineato: nessun cambio");
  const frozen = alignFitAreas({ ...project, spreads: project.spreads.map((s) => (s.id === b ? { ...s, done: true } : s)) });
  assert.equal(frozen.spreads[1].areas[0].layout, project.spreads[1].areas[0].layout, "gli spread finiti non cambiano");
  const fill = alignFitAreas(setAreaStyle(project, a, 0, { mode: "fill" }), a);
  assert.equal(fill.spreads[0].areas[0].style.mode, "fill");
  assertProjectInvariants(album, "allineato");
});

test("template dentro Mescola, frecce e tasti 1-9: compaiono dopo il layout migliore, solo dove il contesto coincide", () => {
  let project = threePhotoProject();
  const id = project.spreads[0].id;
  const tree = sanitizeTemplate({ id: "m1", name: "Tre in riga", kind: "tree", target: "page", shape: { kind: "split", dir: "row", ratio: 0.33, first: { kind: "leaf", itemId: "0" }, second: { kind: "split", dir: "row", ratio: 0.5, first: { kind: "leaf", itemId: "1" }, second: { kind: "leaf", itemId: "2" } } }, createdAt: "x" })!;
  const free = sanitizeTemplate({ id: "m2", name: "Libero", kind: "free", target: "page", frames: [frame(0.02, 0.02, 0.9, 0.9, 0), frame(0.5, 0.5, 0.4, 0.4, 2, 6), frame(0.1, 0.1, 0.3, 0.3, 1)], createdAt: "x" })!;
  const other = { ...tree, id: "m3", count: 4, shape: undefined, kind: "free" as const, frames: [frame(0, 0, 0.5, 0.5), frame(0.5, 0, 0.5, 0.5), frame(0, 0.5, 0.5, 0.5), frame(0.5, 0.5, 0.5, 0.5)] };
  const templates = [tree, free, other];
  const choices = layoutChoices(project, project.spreads[0], 0, templates);
  assert.deepEqual(choices.slice(0, 3).map((c) => c.kind), ["calculated", "template", "template"], "migliore calcolato, poi i template adatti");
  assert.ok(!choices.some((c) => c.kind === "template" && c.match.template.id === "m3"), "il template per 4 foto non compare con 3 foto");
  assert.equal(layoutChoices(project, project.spreads[1], 1, templates).length, 0, "pagina vuota: nessuna scelta");

  const once = shuffleArea(project, id, 0, 1, templates).spreads[0].areas[0];
  assert.equal(once.seed >= TEMPLATE_SEED_BASE, true, "il primo Mescola propone un template");
  const twice = shuffleArea(shuffleArea(project, id, 0, 1, templates), id, 0, 1, templates).spreads[0].areas[0];
  assert.equal(twice.seed >= TEMPLATE_SEED_BASE, true, "il secondo propone l'altro template");
  assertProjectInvariants(shuffleArea(shuffleArea(project, id, 0, 1, templates), id, 0, 1, templates), "due Mescola");
  const third = shuffleArea(shuffleArea(shuffleArea(project, id, 0, 1, templates), id, 0, 1, templates), id, 0, 1, templates).spreads[0].areas[0];
  assert.ok(third.seed < TEMPLATE_SEED_BASE && !hasFreeLayout(third), "poi si torna ai layout calcolati");
  const back = shuffleArea(project, id, 0, -1, templates).spreads[0].areas[0];
  assert.ok(back.seed < TEMPLATE_SEED_BASE, "all'indietro dal primo si va all'ultimo calcolato");
  // senza template tutto come prima
  assert.deepEqual(JSON.stringify(shuffleArea(project, id, 0, 1, []).spreads[0].areas[0].layout), JSON.stringify(shuffleArea(project, id, 0, 1).spreads[0].areas[0].layout));
  // tasti 1-9: il 2 è il primo template, il 3 il secondo (libero)
  const two = applyCandidateByNumber(project, id, 0, 2, templates).spreads[0].areas[0];
  const three = applyCandidateByNumber(project, id, 0, 3, templates).spreads[0].areas[0];
  assert.deepEqual([two.seed, three.seed], [TEMPLATE_SEED_BASE, TEMPLATE_SEED_BASE + 1], "2 e 3 sono i due template, dal migliore");
  assert.notEqual(hasFreeLayout(two), hasFreeLayout(three), "uno ad albero e uno libero");
  project = applyCandidate(project, id, 0, hasFreeLayout(two) ? 1 : 2, templates);
  assertProjectInvariants(project, "libero da numero");
  assert.ok(hasFreeLayout(project.spreads[0].areas[0]));
  // da un layout libero, il successivo Mescola passa al prossimo e il libero decade
  const next = shuffleArea(project, id, 0, 1, templates).spreads[0].areas[0];
  assert.ok(!hasFreeLayout(next), "il libero decade al layout successivo");
  // spread finito: non cambia
  assert.equal(shuffleArea({ ...project, spreads: project.spreads.map((s, i) => (i === 0 ? { ...s, done: true } : s)) }, id, 0, 1, templates).spreads[0].areas[0], project.spreads[0].areas[0]);
});

test("file modificato sul disco: le misure della foto si aggiornano e le aree in «foto intera» si riallineano", () => {
  let project = addSpread(makeProject(6));
  const id = project.spreads[0].id;
  project = dropOnSpread(project, id, { areaIndex: 0, itemId: null, zone: "area" }, { kind: "assets", assetIds: ["a0", "a1"] });
  project = setAreaStyle(project, id, 0, { mode: "fit" });
  const asset = project.assets.find((a) => a.id === "a0")!;
  const same = refreshAssetShapes(project, [{ assetId: "a0", width: asset.width, height: asset.height }]);
  assert.equal(same, project, "misure invariate: stesso progetto");
  assert.equal(refreshAssetShapes(project, [{ assetId: "a0", width: 0, height: 0 }, { assetId: "inesistente", width: 10, height: 10 }]), project);
  // la foto viene ritagliata a quadrato in Photoshop
  const edited = refreshAssetShapes(project, [{ assetId: "a0", width: 2000, height: 2000 }]);
  const after = edited.assets.find((a) => a.id === "a0")!;
  assert.equal(after.aspectRatio, 1);
  assert.equal(after.orientation, "square");
  const rects = photoRects(edited);
  assert.ok(Math.abs(rects[0].h - rects[1].h) < 0.01, `foto ancora allineate: ${rects.map((r) => r.h)}`);
  assertProjectInvariants(edited, "misure aggiornate");
});

test("raddrizzamento: la cella resta sempre coperta dalla foto, anche ai bordi e con zoom diversi", () => {
  let project = filled(1, 0);
  project = setAreaStyle(project, firstSpreadId(project), 0, { mode: "fill" });
  const item = itemsOf(project, 0)[0];
  const cell = spreadGeometry(project, project.spreads[0])[0].cells[0];
  const asset = project.assets.find((candidate) => candidate.id === item.assetId);
  for (const angle of [-45, -12.5, 0.4, 3, 20, 45]) {
    for (const [zoom, cx, cy] of [[1, 0.5, 0.5], [1, 0, 0], [2.5, 1, 1], [6, 0.02, 0.97]] as const) {
      const turned = setItemView(project, item.id, { zoom, cx, cy, angle });
      const next = itemsOf(turned, 0)[0];
      assert.equal(next.angle, angle);
      const placement = placeItem(cell.rect, next, asset, project.spreads[0].areas[0].style);
      const rad = (angle * Math.PI) / 180;
      const centerX = placement.content.x + placement.content.w / 2;
      const centerY = placement.content.y + placement.content.h / 2;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const dx = (sx * placement.content.w) / 2;
        const dy = (sy * placement.content.h) / 2;
        // Angolo della cella riportato nel riferimento dell'immagine (ruotata di `angle`).
        const x = centerX + dx * Math.cos(rad) + dy * Math.sin(rad);
        const y = centerY - dx * Math.sin(rad) + dy * Math.cos(rad);
        const eps = 1e-6;
        assert.ok(x >= placement.image.x - eps && x <= placement.image.x + placement.image.w + eps && y >= placement.image.y - eps && y <= placement.image.y + placement.image.h + eps, `angolo scoperto (angolo ${angle}, zoom ${zoom})`);
      }
      assert.ok(placement.zoom >= 1 && placement.angle === angle);
    }
  }
  assertProjectInvariants(setItemView(project, item.id, { angle: 30 }), "raddrizzamento");
});

test("raddrizzamento: limiti, azzeramento, blocco e conservazione dello zoom", () => {
  let project = filled(1, 0);
  project = setAreaStyle(project, firstSpreadId(project), 0, { mode: "fill" });
  const item = itemsOf(project, 0)[0];
  assert.equal(itemsOf(setItemView(project, item.id, { angle: 99 }), 0)[0].angle, 45);
  assert.equal(itemsOf(setItemView(project, item.id, { angle: -99 }), 0)[0].angle, -45);
  const tilted = setItemView(project, item.id, { angle: 8 });
  assert.equal(setItemView(tilted, item.id, { angle: 8 }), tilted, "nessun cambiamento");
  assert.equal(itemsOf(tilted, 0)[0].zoom, 1, "lo zoom salvato non cambia: la copertura degli angoli la calcola il posizionamento");
  const straight = setItemView(tilted, item.id, { angle: 0 });
  assert.ok(!("angle" in itemsOf(straight, 0)[0]), "a 0° la chiave sparisce");
  assert.deepEqual({ ...straight, updatedAt: "" }, { ...project, updatedAt: "" }); // updatedAt può differire di 1 ms
  assert.ok(!("angle" in itemsOf(resetItemView(tilted, item.id), 0)[0]));
  const locked = toggleItemLock(tilted, item.id);
  assert.equal(setItemView(locked, item.id, { angle: 20 }), locked);
  let pair = filled(2, 0);
  pair = setAreaStyle(pair, firstSpreadId(pair), 0, { mode: "fill" });
  const [first, second] = itemsOf(pair, 0);
  pair = setItemView(pair, first.id, { angle: 10 });
  const swapped = swapItems(pair, first.id, second.id);
  assert.equal(itemsOf(swapped, 0)[1].angle, 10, "scambiando le foto il raddrizzamento le segue");
  assert.ok(!("angle" in itemsOf(swapped, 0)[0]));
});

test("raddrizzamento: sopravvive al salvataggio e il file con un angolo fuori scala viene rifiutato", () => {
  let project = filled(1, 0);
  project = setAreaStyle(project, firstSpreadId(project), 0, { mode: "fill" });
  const item = itemsOf(project, 0)[0];
  project = setItemView(project, item.id, { angle: -7.5 });
  const restored = parseAlbumProject(serializeAlbumProject(project));
  assert.equal(itemsOf(restored, 0)[0].angle, -7.5);
  const broken = JSON.parse(serializeAlbumProject(project));
  broken.project.spreads[0].areas[0].items[0].angle = 120;
  assert.throws(() => parseAlbumProject(JSON.stringify(broken)));
});

test("anteprima al passaggio del mouse: la foto intera, con le sue proporzioni e la rotazione, entro il lato massimo", () => {
  const base = { width: 6000, height: 4000, aspectRatio: 1.5 };
  assert.deepEqual(hoverPreviewSize(base), { width: 440, height: 293 });
  assert.deepEqual(hoverPreviewSize({ width: 4000, height: 6000, aspectRatio: 2 / 3 }), { width: 293, height: 440 });
  assert.deepEqual(hoverPreviewSize({ ...base, rotationDegrees: 90 }), { width: 293, height: 440 }, "ruotata di 90°: scambia le proporzioni");
  assert.deepEqual(hoverPreviewSize({ ...base, rotationDegrees: 180 }), { width: 440, height: 293 });
  assert.deepEqual(hoverPreviewSize({ width: 5000, height: 5000, aspectRatio: 1 }, 300), { width: 300, height: 300 });
  assert.deepEqual(hoverPreviewSize({ width: 0, height: 0, aspectRatio: 0 }), { width: 440, height: 293 }, "misure ignote: proporzione 3:2");
  const panorama = hoverPreviewSize({ width: 7000, height: 1000, aspectRatio: 7 });
  assert.ok(panorama.width === 440 && panorama.height >= 60 && panorama.height <= 64);
});

// ------------------------------------------------------------------ layout libero e bloccato

test("nuovo spread: eredita divisione e stile (spazio, margine, bordo, modo) dello spread precedente, non foto né layout", () => {
  let project = filled(4, 3);
  const id = firstSpreadId(project);
  project = setSplitMode(project, id, "full");
  const style = { ...project.spreads[0].areas[0].style, gapCm: 0.5, paddingCm: 1.2, borderCm: 0.3, mode: "fit" as const };
  project = { ...project, spreads: project.spreads.map((spread, index) => (index === 0 ? { ...spread, areas: spread.areas.map((area) => ({ ...area, style })) } : spread)) };
  const after = addSpread(project, 1);
  const created = after.spreads[1];
  assert.equal(created.split, "full", "stessa divisione: foglio intero");
  assert.equal(created.areas.length, 1);
  assert.deepEqual(created.areas[0].style, style, "stessi spazi, margini e bordo");
  assert.equal(created.areas[0].items.length, 0);
  assert.equal(created.areas[0].layout, null);
  assert.equal(addSpread(project, 1, "half").spreads[1].areas.length, 2, "una divisione esplicita vince");
  assert.deepEqual(addSpread(project, 1, "half").spreads[1].areas[1].style, style, "gli stili si ereditano anche con un'altra divisione");
  // in testa eredita dallo spread che segue
  assert.equal(addSpread(project, 0).spreads[0].split, "full");
  assertProjectInvariants(after, "nuovo spread ereditato");
});

test("layout libero e divisione dello spread: le foto restano dove sono, una foto libera può diventare più grande della sua pagina", () => {
  const project = filled(4, 3);
  const id = firstSpreadId(project);
  const freed = makeAreaFree(makeAreaFree(project, id, 0), id, 1);
  assert.ok(hasFreeLayout(freed.spreads[0].areas[0]) && hasFreeLayout(freed.spreads[0].areas[1]));
  const rects = (p: Project) => p.spreads[0].areas.flatMap((_, index) => areaGeometry(p, p.spreads[0], index).cells).map((cell) => ({ id: cell.itemId, rect: cell.rect }));
  const before = rects(freed);
  for (const mode of ["full", "half", "third"] as const) {
    const changed = setSplitMode(freed, id, mode);
    assertProjectInvariants(changed, `divisione ${mode} con layout libero`);
    assert.ok(changed.spreads[0].areas.filter((area) => area.items.length > 0).every((area) => hasFreeLayout(area)), `${mode}: il layout libero resta libero`);
    for (const cell of before) {
      const now = rects(changed).find((candidate) => candidate.id === cell.id)!;
      for (const key of ["x", "y", "w", "h"] as const) assert.ok(Math.abs(now.rect[key] - cell.rect[key]) < 0.1, `${mode}: ${cell.id} si è spostata (${key})`);
    }
  }
  // Una foto libera si può ingrandire oltre la sua pagina (sfondo che passa anche sull'altra metà) e portare dietro le foto dell'altra pagina.
  const itemId = freed.spreads[0].areas[0].items[0].id;
  const big = setFrame(freed, itemId, { x: 0, y: 0, w: 2.1, h: 1.05 });
  const frame = big.spreads[0].areas[0].free![itemId];
  assert.ok(frame.w > 2 && frame.h > 1, "più grande della pagina");
  assertProjectInvariants(big, "foto più grande della pagina");
  assert.ok(reorderFrame(big, itemId, "back").spreads[0].areas[0].free![itemId].z <= -9, "dietro anche alle foto dell'altra pagina");
});

test("layout libero: una pagina automatica diventa libera senza cambiare a vista, le foto si spostano e si può tornare indietro", () => {
  const project = filled(4, 3);
  const id = firstSpreadId(project);
  const spread = project.spreads[0];
  const windowsOf = (p: Project) => {
    const sp = p.spreads[0];
    const area0 = sp.areas[0];
    return areaGeometry(p, sp, 0).cells.map((cell) => {
      const item = area0.items.find((candidate) => candidate.id === cell.itemId)!;
      return { id: cell.itemId, rect: placeItem(cell.rect, item, p.assets.find((asset) => asset.id === item.assetId), placementStyle(area0, cell), null, cell.anchor).content };
    });
  };
  const before = windowsOf(project);

  const free = makeAreaFree(project, id, 0);
  assert.notEqual(free, project);
  const area = free.spreads[0].areas[0];
  assert.ok(hasFreeLayout(area), "ogni foto ha la sua cornice");
  assert.ok(area.layout, "il layout ad albero resta come riserva");
  assertProjectInvariants(free, "pagina resa libera");
  const after = windowsOf(free);
  for (const window of before) {
    const now = after.find((candidate) => candidate.id === window.id)!;
    for (const key of ["x", "y", "w", "h"] as const) assert.ok(Math.abs(now.rect[key] - window.rect[key]) < 0.05, `${window.id}: ${key} cambiata a vista`);
  }
  assert.equal(makeAreaFree(free, id, 0), free, "già libera: nessun cambiamento");
  assert.equal(makeAreaFree(project, id, 7), project);
  const sparse = filled(2, 0);
  assert.equal(makeAreaFree(sparse, firstSpreadId(sparse), 1), sparse, "pagina vuota: niente da liberare");

  const itemId = area.items[0].id;
  const moved = setFrame(free, itemId, { x: 0.3, y: 0.2 });
  assert.equal(moved.spreads[0].areas[0].free![itemId].x, 0.3, "la foto si sposta a piacere");
  assertProjectInvariants(moved, "foto spostata");

  const back = restoreAutomatic(moved, id, 0);
  assert.ok(!hasFreeLayout(back.spreads[0].areas[0]));
  const restored = areaGeometry(back, back.spreads[0], 0).cells;
  for (const cell of before) {
    const now = restored.find((candidate) => candidate.itemId === cell.id)!;
    assert.ok(Math.abs(now.rect.x - cell.rect.x) < 1e-6 && Math.abs(now.rect.w - cell.rect.w) < 1e-6, "tornata al layout di prima");
  }
  assert.equal(restoreAutomatic(project, id, 0), project, "non era libera: nessun cambiamento");
});

test("layout bloccato: Mescola, layout proposti, template e Auto Build non lo toccano; sbloccato torna tutto come prima", () => {
  const project = filled(4, 4);
  const id = firstSpreadId(project);
  const locked = setSpreadLock(project, id, "left", true);
  assert.ok(locked.spreads[0].areas[0].locked && !locked.spreads[0].areas[1].locked, "solo la pagina sinistra");
  assert.equal(shuffleArea(locked, id, 0), locked, "Mescola non tocca una pagina bloccata");
  assert.equal(applyCandidate(locked, id, 0, 1), locked, "neanche un layout proposto");
  assert.notEqual(shuffleArea(locked, id, 1), locked, "l'altra pagina si mescola");
  assert.equal(makeAreaFree(locked, id, 0), locked, "una pagina bloccata non si rende libera: prima si sblocca");
  const open = setAreaLocked(locked, id, 0, false);
  assert.ok(!("locked" in open.spreads[0].areas[0]), "sbloccata: il campo sparisce");
  assert.notEqual(shuffleArea(open, id, 0), open, "sbloccata si mescola di nuovo");
  assert.equal(setAreaLocked(project, id, 0, false), project);

  const built = autoBuildAlbum(makeProject(24), { ...DEFAULT_AUTO_BUILD, respectChapters: false });
  const protectedBuilt = setSpreadLock(built, built.spreads[1].id, "all", true);
  const rebuilt = autoBuildAlbum(protectedBuilt, { ...DEFAULT_AUTO_BUILD, respectChapters: false, scope: "all", photosPerArea: 5 });
  assert.deepEqual(rebuilt.spreads[1], protectedBuilt.spreads[1], "lo spread con pagine bloccate resta uguale");
  assertProjectInvariants(rebuilt, "dopo Auto Build con spread bloccato");
});

test("blocco: pagina sinistra, destra o tutto il foglio, e salvataggio nel file", () => {
  const project = filled(2, 2);
  const id = firstSpreadId(project);
  assert.deepEqual(areaIndexesOf(project.spreads[0], "left"), [0]);
  assert.deepEqual(areaIndexesOf(project.spreads[0], "right"), [1]);
  assert.deepEqual(areaIndexesOf(project.spreads[0], "all"), [0, 1]);
  const full = setSplitMode(project, id, "full");
  assert.deepEqual(areaIndexesOf(full.spreads[0], "right"), [0], "con un foglio intero c'è una sola pagina");

  const right = setSpreadLock(project, id, "right", true);
  assert.ok(isScopeLocked(right.spreads[0], "right") && !isScopeLocked(right.spreads[0], "left") && !isScopeLocked(right.spreads[0], "all"));
  const all = setSpreadLock(right, id, "all", true);
  assert.ok(isScopeLocked(all.spreads[0], "all"));
  assert.ok(!isScopeLocked(setSpreadLock(all, id, "all", false).spreads[0], "right"));
  assert.equal(setSpreadLock(project, "x", "all", true), project);

  const reread = parseAlbumProject(serializeAlbumProject(all));
  assert.ok(reread.spreads[0].areas.every((area) => area.locked), "il blocco resta dopo il salvataggio");
  const broken = JSON.parse(serializeAlbumProject(all));
  broken.project.spreads[0].areas[0].locked = "sì";
  assert.throws(() => parseAlbumProject(JSON.stringify(broken)), /locked/);
});

test("spazio tra le foto dell'album: cambia dove non l'hai toccato a mano, conserva i fogli personalizzati e gli spread finiti", () => {
  const built = autoBuildAlbum(makeProject(24), { ...DEFAULT_AUTO_BUILD, respectChapters: false });
  const before = built.settings.defaultStyle.gapCm;
  const manual = setAreaStyle(built, built.spreads[1].id, 0, { gapCm: 1 });
  const finished = setSpreadDone(manual, manual.spreads[2].id, true);
  const result = setAlbumGap(finished, 0.6);
  assert.equal(result.project.settings.defaultStyle.gapCm, 0.6, "diventa il valore predefinito");
  assert.equal(result.project.spreads[1].areas[0].style.gapCm, 1, "il foglio personalizzato resta com'è");
  assert.equal(result.project.spreads[2].areas[0].style.gapCm, before, "lo spread finito non cambia");
  assert.equal(result.project.spreads[0].areas[0].style.gapCm, 0.6);
  assert.ok(result.updated > 0);
  const total = finished.spreads.reduce((sum, spread) => sum + spread.areas.length, 0);
  assert.equal(result.updated, total - 1 - finished.spreads[2].areas.length, "tutte tranne il foglio a mano e lo spread finito");
  assert.equal(setAlbumGap(finished, before).updated, 0);
  assert.equal(setAlbumGap(finished, before).project, finished, "stesso valore: nessun cambiamento");
  assert.equal(setAlbumGap(finished, 99).project.settings.defaultStyle.gapCm, 3, "entro i limiti");
  // un nuovo spread nasce con lo spazio dell'album
  assert.equal(addSpread(result.project).spreads.at(-1)!.areas[0].style.gapCm, 0.6);
  assertProjectInvariants(result.project, "spazio dell'album");
});

test("una cornice libera aggiunta nel template ha le proporzioni chieste anche su un foglio molto largo", () => {
  for (const canvasRatio of [0.7, 1, 1.4, 2.82, 4]) {
    for (const aspect of [3 / 2, 2 / 3, 4 / 3, 3 / 4, 1, 16 / 9]) {
      const { w, h } = frameForAspect(aspect, canvasRatio);
      assert.ok(Math.abs((w * canvasRatio) / h / aspect - 1) < 1e-9, `rapporto ${aspect} su tela ${canvasRatio}`);
      assert.ok(w <= 0.6 + 1e-9 && h <= 0.9, `dentro l'area: ${w} x ${h}`);
    }
  }
});

test("il bordo di una sola foto non cambia le altre e si toglie tornando a quello dell'area", () => {
  const base = filled(3, 3);
  const items = base.spreads[0].areas[0].items;
  const [first, second] = items;
  assert.ok(items.length >= 2, "servono almeno due foto");
  const style = base.spreads[0].areas[0].style;
  const edited = setItemBorder(base, first.id, { cm: 0.5, color: "#aa2233" });
  const area = edited.spreads[0].areas[0];
  assert.equal(area.items[0].borderCm, 0.5);
  assert.equal(area.items[0].borderColor, "#aa2233");
  assert.equal(area.items[1].borderCm, undefined, "le altre foto restano com'erano");
  assert.equal(area.style.borderCm, style.borderCm, "lo stile dell'area non cambia");
  const cell = (project: typeof base, id: string) => areaGeometry(project, project.spreads[0], 0).cells.find((candidate) => candidate.itemId === id)!;
  const asset = (id: string) => base.assets.find((candidate) => candidate.id === items.find((item) => item.id === id)!.assetId);
  const placed = placeItemForBorder(cell(edited, first.id).rect, area.items[0], asset(first.id), area.style);
  assert.ok(Math.abs(placed.borderMm - 5) < 1e-9, "il bordo della foto vale 5 mm");
  assert.equal(itemBorderColor(area.items[0], area.style), "#aa2233");
  assert.equal(itemBorderColor(area.items[1], area.style), style.borderColor);
  assert.equal(setItemBorder(edited, first.id, { cm: 99 }).spreads[0].areas[0].items[0].borderCm, 1.5, "entro i limiti");
  const cleared = setItemBorder(edited, first.id, { cm: null, color: null });
  assert.equal("borderCm" in cleared.spreads[0].areas[0].items[0], false);
  assert.equal("borderColor" in cleared.spreads[0].areas[0].items[0], false);
  assert.equal(setItemBorder(base, second.id, { cm: null }), base, "nessun cambiamento = stesso progetto");
  assertProjectInvariants(edited, "bordo di una foto");
});

test("template libero: la sovrapposizione si cambia un livello alla volta e i livelli restano 0…n-1", () => {
  const frames = [{ id: "a", z: 5 }, { id: "b", z: -3 }, { id: "c", z: 9 }];
  const order = (list: { id: string; z: number }[]) => [...list].sort((x, y) => x.z - y.z).map((frame) => frame.id).join("");
  assert.equal(order(frames), "bac");
  assert.equal(order(restackFrames(frames, "b", "front")), "acb");
  assert.equal(order(restackFrames(frames, "c", "back")), "cba");
  assert.equal(order(restackFrames(frames, "b", "forward")), "abc");
  assert.equal(order(restackFrames(frames, "a", "backward")), "abc");
  assert.equal(order(restackFrames(frames, "b", "backward")), "bac", "già in fondo: resta com'è");
  assert.equal(order(restackFrames(frames, "c", "forward")), "bac", "già davanti: resta com'è");
  let moving = frames;
  for (let step = 0; step < 6; step += 1) moving = restackFrames(moving, "a", "back");
  assert.deepEqual(moving.map((frame) => frame.z).sort(), [0, 1, 2], "ripetere «porta dietro» non fa scendere i livelli sotto zero");
});
