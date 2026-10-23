import { test } from "node:test";
import assert from "node:assert/strict";
import { fillSpread, nextUnusedAssets } from "./autobuild";
import { appendAssets } from "./items";
import { addSpread } from "./spreads";
import { assertProjectInvariants } from "./fixtures";
import { analyzeLibrary, suggestForSpread } from "./similar";
import { CAKE, DANCE, look, signals, weddingProject } from "./similarFixtures";
import type { Project } from "./project";

function withPage(project: Project, assetIds: string[], areaIndex = 0): Project {
  const withSpread = addSpread(project);
  return assetIds.length ? appendAssets(withSpread, withSpread.spreads[withSpread.spreads.length - 1].id, areaIndex, assetIds) : withSpread;
}
const ids = (assets: ReadonlyArray<{ id: string }>) => assets.map((asset) => asset.id);

test("adatte allo spread: prima le foto dello stesso momento, una per raffica, con i motivi", () => {
  const project = withPage(weddingProject(), ["k0"]);
  const analysis = analyzeLibrary(project);
  const suggestions = suggestForSpread(project, analysis, project.spreads[0].id);
  const order = suggestions.map((entry) => entry.asset.id);
  assert.deepEqual(order.slice(0, 3).sort(), ["k1", "k2", "t1"], "il resto della torta per primo");
  assert.ok(!order.includes("t2"), "della raffica solo la consigliata");
  assert.ok(!order.includes("k0"), "non la foto già nello spread");
  assert.ok(suggestions.slice(0, 3).every((entry) => entry.reasons.includes("stesso momento")));
  assert.ok(suggestions[0].reasons.includes("4 stelle") && suggestions[0].asset.id === "t1", "a parità di momento vincono le stelle");
  // 18 foto: meno k0 (nello spread), t2 (alternativa di t1) e b1, b3 (della raffica si propone solo b2).
  assert.equal(suggestions.length, 14, "tutte le altre da usare, nessuna esclusa");
  assert.equal(suggestForSpread(project, analysis, project.spreads[0].id, 2).length, 2, "rispetta il limite");
});

test("adatte allo spread: niente alternative di un gruppo già usato, niente contesto senza foto", () => {
  let project = withPage(weddingProject(), ["b1"]);
  project = withPage(project, []);
  const analysis = analyzeLibrary(project);
  const order = suggestForSpread(project, analysis, project.spreads[0].id).map((entry) => entry.asset.id);
  assert.ok(!order.includes("b2") && !order.includes("b3"), "b1 della raffica è già nell'album");
  assert.deepEqual(suggestForSpread(project, analysis, project.spreads[1].id), [], "spread vuoto: nessun suggerimento");
  assert.deepEqual(suggestForSpread(project, analysis, "inesistente"), []);
});

test("adatte allo spread: bianco e nero con bianco e nero", () => {
  const project = withPage(weddingProject(), ["d0"]);
  // Impronte molto diverse tra loro: sono foto diverse dello stesso momento, non varianti.
  const analysis = analyzeLibrary(project, signals({
    d0: look({ chroma: 1, hash: "0000000000000000" }), d1: look({ chroma: 30, hash: "ffffffffffffffff" }), d2: look({ chroma: 2, hash: "00000000ffffffff" }),
    d3: look({ chroma: 28, hash: "ffffffff00000000" }), d4: look({ chroma: 1.5, hash: "0f0f0f0f0f0f0f0f" }), d5: look({ chroma: 31, hash: "f0f0f0f0f0f0f0f0" }),
  }));
  assert.equal(analysis.groups.filter((group) => group.photoIds.some((id) => id.startsWith("d"))).length, 0);
  const order = suggestForSpread(project, analysis, project.spreads[0].id).map((entry) => entry.asset.id);
  assert.deepEqual(order.slice(0, 2).sort(), ["d2", "d4"]);
});

test("U: la prossima foto viene dal momento dello spread e salta le alternative", () => {
  const project = withPage(weddingProject(), ["k0", "t2"]);
  const analysis = analyzeLibrary(project);
  const hint = ["k0", "t2"];
  assert.deepEqual(ids(nextUnusedAssets(project, 3, hint, analysis)), ["k1", "k2", "c0"], "prima la torta (senza t1, alternativa di t2), poi l'ordine d'album");
  assert.deepEqual(ids(nextUnusedAssets(project, 2, hint)), ["c0", "c1"], "senza analisi resta l'ordine d'album di sempre");
  assert.deepEqual(ids(nextUnusedAssets(project, 0, hint, analysis)), []);
});

test("F: riempie la pagina vuota con un solo momento e una foto per raffica", () => {
  let project = weddingProject();
  project = withPage(project, ["d0"]);
  const analysis = analyzeLibrary(project);
  const filled = fillSpread(project, project.spreads[0].id, 3, analysis);
  assertProjectInvariants(filled, "riempi con i momenti");
  const right = filled.spreads[0].areas[1].items.map((item) => item.assetId);
  assert.ok(right.length >= 1);
  assert.ok(right.every((id) => DANCE.includes(id)), `la pagina resta nei balli: ${right.join(",")}`);

  // Spread vuoto: si parte dalla cerimonia, una sola foto della raffica, e la pagina non sconfina nella torta.
  const empty = withPage(weddingProject(), []);
  const emptyAnalysis = analyzeLibrary(empty);
  const first = fillSpread(empty, empty.spreads[0].id, 4, emptyAnalysis);
  const pages = first.spreads[0].areas.map((area) => area.items.map((item) => item.assetId));
  const all = pages.flat();
  assert.ok(all.filter((id) => id.startsWith("b")).length <= 1, `una sola foto della raffica: ${all.join(",")}`);
  for (const page of pages) assert.ok(page.every((id) => !CAKE.includes(id)) || page.every((id) => CAKE.includes(id)), `una pagina non mescola cerimonia e torta: ${page.join(",")}`);
  assertProjectInvariants(first, "riempi uno spread vuoto");
});
