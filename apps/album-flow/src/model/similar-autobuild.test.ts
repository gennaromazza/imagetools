import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_AUTO_BUILD, autoBuildAlbum, heroIndex, momentSegments, onePerGroupPool, type AutoBuildOptions } from "./autobuild";
import { appendAssets } from "./items";
import { addSpread, setSpreadDone } from "./spreads";
import { assertProjectInvariants } from "./fixtures";
import { areaGeometry, type Project } from "./project";
import { analyzeLibrary } from "./similar";
import { pagesOf, shot, weddingProject } from "./similarFixtures";

const OPTIONS: AutoBuildOptions = { ...DEFAULT_AUTO_BUILD, splitMode: "half", respectChapters: false, photosPerArea: 3, onePerGroup: true };
const placedIds = (project: Project) => pagesOf(project).flat();

test("Auto Build: «una per gruppo» è spenta di default, così entrano tutte le foto scelte", () => {
  // Sulle 626 foto di un matrimonio reale un gruppo univa due foto all'altare con persone diverse:
  // con l'opzione accesa di default una delle due sarebbe rimasta fuori dall'album senza avviso.
  assert.equal(DEFAULT_AUTO_BUILD.onePerGroup, false);
  const project = weddingProject();
  const built = autoBuildAlbum(project, { ...DEFAULT_AUTO_BUILD, splitMode: "half", respectChapters: false, photosPerArea: 3 }, analyzeLibrary(project));
  assert.equal(placedIds(built).length, project.assets.length, "di default entrano tutte, raffiche comprese");
});

test("Auto Build: una sola foto per raffica (la consigliata), tutte le altre una volta", () => {
  const project = weddingProject();
  const analysis = analyzeLibrary(project);
  const built = autoBuildAlbum(project, OPTIONS, analysis);
  assertProjectInvariants(built, "una per gruppo");
  const used = placedIds(built);
  assert.equal(new Set(used).size, used.length, "nessuna foto due volte");
  assert.ok(used.includes("b2") && !used.includes("b1") && !used.includes("b3"), "della raffica solo b2 (5 stelle)");
  assert.ok(used.includes("t1") && !used.includes("t2"));
  assert.equal(used.length, project.assets.length - 3);

  const everything = placedIds(autoBuildAlbum(project, { ...OPTIONS, onePerGroup: false }, analysis));
  assert.equal(everything.length, project.assets.length, "con l'opzione spenta entrano tutte");
});

test("Auto Build: una pagina non mescola due momenti (con l'ordine per ora di scatto)", () => {
  const project = weddingProject();
  const analysis = analyzeLibrary(project);
  const momentOf = (id: string) => analysis.momentOf.get(id);
  const mixed = (built: Project) => pagesOf(built).filter((page) => new Set(page.map(momentOf)).size > 1).length;
  const byMoment = autoBuildAlbum(project, OPTIONS, analysis);
  assert.equal(mixed(byMoment), 0, `pagine: ${JSON.stringify(pagesOf(byMoment))}`);
  assert.ok(mixed(autoBuildAlbum(project, { ...OPTIONS, followMoments: false }, analysis)) > 0, "senza l'opzione questo album mescola i momenti");

  // Con un altro ordine della libreria i momenti non si seguono: si impagina come senza l'opzione.
  const byName: Project = { ...project, settings: { ...project.settings, sortKey: "file-name" } };
  assert.deepEqual(pagesOf(autoBuildAlbum(byName, OPTIONS, analysis)), pagesOf(autoBuildAlbum(byName, { ...OPTIONS, followMoments: false }, analysis)));
});

test("Auto Build: senza l'analisi della libreria tutto resta come prima", () => {
  const project = weddingProject();
  const plain = autoBuildAlbum(project, { ...OPTIONS, heroLargest: false });
  const off = autoBuildAlbum(project, { ...OPTIONS, heroLargest: false, onePerGroup: false, followMoments: false }, analyzeLibrary(project));
  assert.deepEqual(pagesOf(plain), pagesOf(off));
  assert.equal(placedIds(plain).length, project.assets.length);
});

test("Auto Build: gruppi già nell'album (solo foto non usate, spread finiti) non rientrano", () => {
  let project = weddingProject();
  project = addSpread(project);
  project = appendAssets(project, project.spreads[0].id, 0, ["b3", "t2"]);
  const analysis = analyzeLibrary(project);
  const added = autoBuildAlbum(project, { ...OPTIONS, scope: "unused" }, analysis);
  assertProjectInvariants(added, "solo non usate");
  const fresh = placedIds(added).slice(2);
  assert.ok(!fresh.some((id) => ["b1", "b2", "t1"].includes(id)), `alternative rientrate: ${fresh.join(",")}`);

  const done = setSpreadDone(project, project.spreads[0].id, true);
  const rebuilt = autoBuildAlbum(done, { ...OPTIONS, scope: "all" }, analysis);
  assertProjectInvariants(rebuilt, "ricostruisci con spread finito");
  const all = placedIds(rebuilt);
  assert.equal(all.filter((id) => ["b1", "b2", "b3"].includes(id)).length, 1, "lo spread finito tiene b3, le altre restano fuori");
  assert.equal(all.filter((id) => ["t1", "t2"].includes(id)).length, 1);
  assert.deepEqual(onePerGroupPool(done.assets, analysis, new Set(["b3"])).map((asset) => asset.id).filter((id) => id.startsWith("b")), []);
});

test("Auto Build: tratti per momento e protagonista della pagina", () => {
  const project = weddingProject();
  const analysis = analyzeLibrary(project);
  const segments = momentSegments(project.assets, analysis).map((segment) => segment.length);
  assert.deepEqual(segments, [7, 5, 6]);
  const undated = [...project.assets.slice(0, 2), { ...project.assets[2], captureTimeMs: undefined }, project.assets[3]];
  assert.deepEqual(momentSegments(undated, analyzeLibrary({ assets: undated })).map((segment) => segment.length), [2, 1, 1], "una foto senza ora fa tratto a sé");

  assert.equal(heroIndex([shot("a", 0, { rating: 3 }), shot("b", 1, { rating: 5 }), shot("c", 2, { rating: 3 })]), 1);
  assert.equal(heroIndex([shot("a", 0, { rating: 5 }), shot("b", 1, { rating: 5 })]), -1, "due a pari merito: nessuna protagonista");
  assert.equal(heroIndex([shot("a", 0, { rating: 3 }), shot("b", 1, { rating: 2 })]), -1, "almeno 4 stelle");
  assert.equal(heroIndex([shot("a", 0, { rating: 5 })]), -1, "da sola non serve");
});

test("Auto Build: la foto con più stelle prende la cella più grande", () => {
  // Senza la regola il layout migliore dà alla prima foto la cella più piccola: con la regola diventa la più grande.
  const vertical = { width: 4000, height: 6000, aspectRatio: 4000 / 6000, orientation: "vertical" as const };
  const assets = [shot("p3", 0, { rating: 5 }), shot("p1", 30, { rating: 3, ...vertical }), shot("p2", 60, { rating: 3 })];
  const project: Project = { ...weddingProject(), assets };
  const options: AutoBuildOptions = { ...OPTIONS, photosPerArea: 3, splitMode: "full", fitMode: "fill" };
  const cellArea = (built: Project, assetId: string) => {
    const spread = built.spreads[0];
    const item = spread.areas[0].items.find((candidate) => candidate.assetId === assetId)!;
    const cell = areaGeometry(built, spread, 0).cells.find((candidate) => candidate.itemId === item.id)!;
    return cell.rect.w * cell.rect.h;
  };
  const withHero = autoBuildAlbum(project, options);
  const without = autoBuildAlbum(project, { ...options, heroLargest: false });
  assertProjectInvariants(withHero, "protagonista");
  assert.ok(cellArea(without, "p3") < Math.max(cellArea(without, "p1"), cellArea(without, "p2")), "il caso di partenza: senza la regola non è la più grande");
  assert.ok(cellArea(withHero, "p3") > cellArea(without, "p3") * 2, "la protagonista guadagna spazio");
  assert.ok(cellArea(withHero, "p3") >= Math.max(cellArea(withHero, "p1"), cellArea(withHero, "p2")) - 1e-6, "ed è la più grande della pagina");
  assert.deepEqual(withHero.spreads[0].areas[0].items.map((item) => item.assetId), ["p3", "p1", "p2"], "l'ordine di lettura resta quello di scatto");
});
