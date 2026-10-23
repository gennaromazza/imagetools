import { test } from "node:test";
import assert from "node:assert/strict";
import { appendAssets, setItemView, toggleItemLock } from "./items";
import { addSpread } from "./spreads";
import { assertProjectInvariants } from "./fixtures";
import { alternativesForItem, analyzeLibrary, chooseAlternative, cycleAlternative, spreadAlternatives } from "./similar";
import { shot, weddingProject } from "./similarFixtures";
import type { Project } from "./project";

function withPage(project: Project, assetIds: string[]): Project {
  const withSpread = addSpread(project);
  return appendAssets(withSpread, withSpread.spreads[withSpread.spreads.length - 1].id, 0, assetIds);
}
const itemOf = (project: Project, assetId: string) => project.spreads.flatMap((spread) => spread.areas.flatMap((area) => area.items)).find((item) => item.assetId === assetId)!;
const assetsOnPage = (project: Project, spreadIndex = 0) => project.spreads[spreadIndex].areas[0].items.map((item) => item.assetId);

test("alternative: la foto di una raffica ha le varianti, in ordine di scatto", () => {
  const project = withPage(weddingProject(), ["c0", "b2"]);
  const analysis = analyzeLibrary(project);
  const alternatives = alternativesForItem(project, analysis, itemOf(project, "b2").id);
  assert.deepEqual(alternatives, { groupId: "g:b1", ids: ["b1", "b2", "b3"], index: 1 });
  assert.equal(alternativesForItem(project, analysis, itemOf(project, "c0").id), null, "una foto senza simili non ne ha");
  assert.equal(alternativesForItem(project, analysis, "inesistente"), null);
  const map = spreadAlternatives(project, analysis, project.spreads[0].id);
  assert.deepEqual([...map.keys()], [itemOf(project, "b2").id]);
});

test("alternative: A avanza e Maiusc+A torna indietro, in giro, nella stessa cella", () => {
  let project = withPage(weddingProject(), ["c0", "b2", "c1"]);
  const analysis = analyzeLibrary(project);
  const itemId = itemOf(project, "b2").id;
  const layout = JSON.stringify(project.spreads[0].areas[0].layout);
  const sequence: string[] = [];
  for (let step = 0; step < 4; step += 1) {
    project = cycleAlternative(project, analysis, itemId, 1);
    sequence.push(assetsOnPage(project)[1]);
    assertProjectInvariants(project, `avanti ${step}`);
  }
  assert.deepEqual(sequence, ["b3", "b1", "b2", "b3"]);
  project = cycleAlternative(project, analysis, itemId, -1);
  assert.equal(assetsOnPage(project)[1], "b2");
  assert.deepEqual(assetsOnPage(project), ["c0", "b2", "c1"], "le altre foto restano dove sono");
  assert.equal(JSON.stringify(project.spreads[0].areas[0].layout), layout, "il layout non cambia: stessa forma della foto");
  assert.equal(itemOf(project, "b2").id, itemId, "è la stessa cella");
});

test("alternative: stessa forma = l'inquadratura scelta resta; forma diversa = si riparte", () => {
  let project = withPage(weddingProject(), ["b2"]);
  const analysis = analyzeLibrary(project);
  const itemId = itemOf(project, "b2").id;
  project = setItemView(project, itemId, { zoom: 1.6, cx: 0.3, cy: 0.62, angle: 2 });
  const before = itemOf(project, "b2");
  assert.equal(before.zoom, 1.6, "l'inquadratura è stata applicata");
  const kept = cycleAlternative(project, analysis, itemId, 1);
  const item = itemOf(kept, "b3");
  assert.deepEqual([item.zoom, item.cx, item.cy, item.angle], [before.zoom, before.cx, before.cy, before.angle]);

  // Una variante ruotata (verticale) unita a mano: l'inquadratura riparte da zero.
  const mixed: Project = { ...withPage({ ...weddingProject(), assets: [...weddingProject().assets, shot("v1", 61.5, { width: 4000, height: 6000, aspectRatio: 4000 / 6000, orientation: "vertical" })] }, ["b2"]), similarity: { apart: [], together: [["b1", "b2", "b3", "v1"]] } };
  const mixedAnalysis = analyzeLibrary(mixed);
  const mixedItem = itemOf(mixed, "b2").id;
  const zoomed = setItemView(mixed, mixedItem, { zoom: 2, cx: 0.2 });
  const turned = chooseAlternative(zoomed, mixedAnalysis, mixedItem, "v1");
  assert.equal(itemOf(turned, "v1").zoom, 1);
  assert.equal(itemOf(turned, "v1").cx, 0.5);
  assertProjectInvariants(turned, "variante di forma diversa");
});

test("alternative: una foto bloccata non cambia, le varianti già usate altrove non si propongono", () => {
  let project = withPage(weddingProject(), ["b2"]);
  project = withPage(project, ["b3"]);
  const analysis = analyzeLibrary(project);
  const itemId = itemOf(project, "b2").id;
  assert.deepEqual(alternativesForItem(project, analysis, itemId)?.ids, ["b1", "b2"], "b3 è già nello spread 2");
  assert.equal(assetsOnPage(cycleAlternative(project, analysis, itemId, 1))[0], "b1");
  assert.equal(chooseAlternative(project, analysis, itemId, "b3"), project, "non si duplica una foto già usata");
  assert.equal(chooseAlternative(project, analysis, itemId, "c0"), project, "non si sceglie una foto fuori dal gruppo");
  const locked = toggleItemLock(project, itemId);
  assert.equal(cycleAlternative(locked, analysis, itemId, 1), locked);

  const lonely = withPage(withPage(weddingProject(), ["t1"]), ["t2"]);
  const lonelyAnalysis = analyzeLibrary(lonely);
  const lonelyItem = itemOf(lonely, "t1").id;
  assert.equal(alternativesForItem(lonely, lonelyAnalysis, lonelyItem), null, "entrambe le foto della raffica sono già nell'album");
  assert.equal(cycleAlternative(lonely, lonelyAnalysis, lonelyItem, 1), lonely);
});

test("alternative: cento passi casuali su uno spread con due raffiche restano coerenti", () => {
  let project = addSpread(withPage(weddingProject(), ["b1", "t2", "c0"]));
  const analysis = analyzeLibrary(project);
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let step = 0; step < 100; step += 1) {
    const items = project.spreads[0].areas[0].items;
    const item = items[Math.floor(random() * items.length)];
    project = random() < 0.15 ? toggleItemLock(project, item.id) : cycleAlternative(project, analysis, item.id, random() < 0.5 ? 1 : -1);
    assertProjectInvariants(project, `passo ${step}`);
    const used = project.spreads.flatMap((spread) => spread.areas.flatMap((area) => area.items.map((candidate) => candidate.assetId)));
    assert.equal(new Set(used).size, used.length, "nessuna foto compare due volte");
    assert.equal(project.spreads[0].areas[0].items.length, 3, "il numero di foto non cambia");
  }
});
