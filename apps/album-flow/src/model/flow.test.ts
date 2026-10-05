import { test } from "node:test";
import assert from "node:assert/strict";
import type { DesktopPhotoToolHandoff } from "@photo-tools/desktop-contracts";
import { DEFAULT_AUTO_BUILD, MAX_AUTO_PER_AREA, PANORAMA_ASPECT, autoBuildAlbum, chunkSequence, fillSpread, nextEmptySpread, nextUnusedAssets, orderedGroups } from "./autobuild";
import { BUILTIN_CHAPTER_PRESETS, CHAPTER_COLORS, applyChapterPreset, assignAssets, createChapter, moveChapter, recolorChapter, removeChapter, renameChapter, chapterOfAsset } from "./chapters";
import { COMMON_FORMATS, formatKey, formatLabel, fromCm, isValidFormat, loadFavoriteFormats, loadRecentFormats, pushRecentFormat, sheetFromFormat, toCm, toggleFavoriteFormat } from "./formats";
import { IMAGE_EXTENSIONS, applyImport, assetFromCandidate, candidateKey, folderGroups, isImageFileName, normalizePathKey, planImport, withoutFolders, type ImportCandidate } from "./import";
import { assetUsage, clearRatings, setRatingPolicy, assetsInTab, compareAssets, duplicatedAssetIds, filterAssets, locateAsset, removeAssets, reorderAssets, setRating, setSortKey, sortAssets, toggleAssetTag, unusedAssets } from "./library";
import { parseAlbumProject, projectProblem, repairOversizedAreas, serializeAlbumProject } from "./portability";
import { preflightReport } from "./preflight";
import { createDemoProject, loadProjects, mergeIncomingProject, projectFromHandoff, saveProjects, STAGES, stageLabel } from "./store";
import { appendAssets, toggleItemLock } from "./items";
import { addSpread, setSplitMode, setSpreadDone, splitRefusal } from "./spreads";
import { setAreaStyle, shuffleSpread, applyCandidateByNumber } from "./areas";
import { assertProjectInvariants, makeAsset, makeProject } from "./fixtures";
import { createItem, findItem, itemAspect, type Project } from "./project";

// Il salvataggio locale non esiste in Node: una memoria semplice basta per provare caricamento e salvataggio.
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) { return this.data.has(key) ? this.data.get(key)! : null; }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
  removeItem(key: string) { this.data.delete(key); }
  clear() { this.data.clear(); }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
const storage = () => (globalThis as unknown as { localStorage: MemoryStorage }).localStorage;

const used = (project: Project) => new Set([...assetUsage(project).keys()]);

// ------------------------------------------------------------------ Auto Build

test("Auto Build: usa ogni foto una sola volta, nell'ordine di scatto, con album coerente", () => {
  const project = makeProject(40);
  // Mescola l'ordine di scatto: l'ordine d'album deve seguire l'orario, non l'indice.
  const shuffled = { ...project, assets: project.assets.map((asset, index) => ({ ...asset, captureTimeMs: (asset.captureTimeMs ?? 0) + ((index * 7) % 13) * 5 * 60_000 })) };
  const built = autoBuildAlbum(shuffled, { ...DEFAULT_AUTO_BUILD, respectChapters: false });
  assertProjectInvariants(built, "auto build");
  const usage = assetUsage(built);
  assert.equal(usage.size, 40);
  assert.ok([...usage.values()].every((refs) => refs.length === 1));
  const order = built.spreads.flatMap((s) => s.areas.flatMap((a) => a.items.map((i) => shuffled.assets.find((x) => x.id === i.assetId)!.captureTimeMs!)));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "ordine di lettura = ordine di scatto");
  assert.equal(built.stage, "editing", "un album impaginato passa a «in lavorazione»");
  assert.equal(unusedAssets(built).length, 0);
});

test("Auto Build: ogni capitolo inizia su un nuovo spread, nell'ordine dei capitoli", () => {
  let project = makeProject(30);
  project = createChapter(project, "Casa sposo");
  project = createChapter(project, "Casa sposa");
  project = createChapter(project, "Chiesa");
  const [c1, c2, c3] = project.chapters;
  // La foto 25 sta nel primo capitolo anche se scattata dopo: l'ordine dei capitoli prevale.
  project = assignAssets(project, ["a25", "a0", "a1", "a2", "a3"], c1.id);
  project = assignAssets(project, ["a4", "a5", "a6", "a7", "a8", "a9", "a10"], c2.id);
  project = assignAssets(project, ["a11", "a12", "a13"], c3.id);
  const built = autoBuildAlbum(project, DEFAULT_AUTO_BUILD);
  assertProjectInvariants(built, "capitoli");
  const chapterOf = (assetId: string) => chapterOfAsset(built, assetId)?.title ?? "(nessuno)";
  const sequence: string[] = [];
  for (const spread of built.spreads) {
    const titles = new Set(spread.areas.flatMap((area) => area.items.map((item) => chapterOf(item.assetId))));
    assert.ok(titles.size <= 1, `uno spread non mescola capitoli: ${[...titles].join(", ")}`);
    if (titles.size === 1) sequence.push([...titles][0]);
  }
  const firstOf = (title: string) => sequence.indexOf(title);
  assert.ok(firstOf("Casa sposo") < firstOf("Casa sposa") && firstOf("Casa sposa") < firstOf("Chiesa") && firstOf("Chiesa") < firstOf("(nessuno)"), `ordine dei capitoli: ${sequence.join(" > ")}`);
  assert.equal(used(built).size, 30);
  const flat = autoBuildAlbum(project, { ...DEFAULT_AUTO_BUILD, respectChapters: false });
  assert.ok(flat.spreads.length <= built.spreads.length, "ignorando i capitoli servono meno spread");
});

test("Auto Build: il numero di foto per area scelto dall'utente viene rispettato", () => {
  const project = makeProject(60);
  for (const target of [1, 2, 3, 4, 5, 6]) {
    const built = autoBuildAlbum(project, { ...DEFAULT_AUTO_BUILD, photosPerArea: target, respectChapters: false, splitMode: "half" });
    const counts = built.spreads.flatMap((s) => s.areas.map((a) => a.items.length)).filter((n) => n > 0);
    const average = counts.reduce((a, b) => a + b, 0) / counts.length;
    assert.ok(Math.abs(average - target) <= 0.6, `obiettivo ${target}: media ${average.toFixed(2)}`);
    assert.ok(counts.every((n) => n <= Math.min(MAX_AUTO_PER_AREA, target + 1)), `obiettivo ${target}: massimo ${Math.max(...counts)}`);
    assertProjectInvariants(built, `target ${target}`);
  }
});

test("Auto Build: foto copertina/principale hanno un'area propria e i panorami un foglio intero", () => {
  let project = makeProject(14);
  project = toggleAssetTag(project, "a3", "main");
  project = toggleAssetTag(project, "a8", "panorama");
  project = { ...project, assets: project.assets.map((asset) => (asset.id === "a11" ? { ...asset, width: 7000, height: 3000, aspectRatio: 7000 / 3000 } : asset)) };
  assert.ok(itemAspect(project.assets.find((a) => a.id === "a11")) >= PANORAMA_ASPECT);
  const built = autoBuildAlbum(project, { ...DEFAULT_AUTO_BUILD, respectChapters: false });
  const locate = (assetId: string) => { const ref = assetUsage(built).get(assetId)![0]; return { ref, spread: built.spreads[ref.spreadIndex], area: built.spreads[ref.spreadIndex].areas[ref.areaIndex] }; };
  assert.equal(locate("a3").area.items.length, 1, "principale da sola");
  for (const id of ["a8", "a11"]) {
    const { spread, area } = locate(id);
    assert.equal(spread.split, "full", "panorama: foglio intero");
    assert.equal(area.items.length, 1);
  }
  const noMixed = autoBuildAlbum(project, { ...DEFAULT_AUTO_BUILD, respectChapters: false, splitMode: "half" });
  assert.ok(noMixed.spreads.every((s) => s.split === "half"));
  const allFull = autoBuildAlbum(project, { ...DEFAULT_AUTO_BUILD, respectChapters: false, splitMode: "full" });
  assert.ok(allFull.spreads.every((s) => s.split === "full" && s.areas.length === 1));
  assertProjectInvariants(built, "tag");
  assertProjectInvariants(allFull, "full");
});

test("Auto Build: solo foto non usate, album invariato se non c'è nulla da aggiungere, errori chiari", () => {
  const project = makeProject(12);
  const first = autoBuildAlbum(project, DEFAULT_AUTO_BUILD);
  const more = { ...first, assets: [...first.assets, makeAsset(50), makeAsset(51)] };
  const extended = autoBuildAlbum(more, { ...DEFAULT_AUTO_BUILD, scope: "unused", respectChapters: false });
  assert.equal(extended.spreads.length, first.spreads.length + 1);
  assert.deepEqual(extended.spreads.slice(0, first.spreads.length), first.spreads, "gli spread esistenti non cambiano");
  assert.equal(used(extended).size, 14);
  assert.equal(autoBuildAlbum(first, { ...DEFAULT_AUTO_BUILD, scope: "unused" }), first);
  assert.throws(() => autoBuildAlbum(makeProject(0), DEFAULT_AUTO_BUILD), /libreria è vuota/);
  const rebuilt = autoBuildAlbum(more, { ...DEFAULT_AUTO_BUILD, scope: "all" });
  assert.equal(used(rebuilt).size, 14, "ricostruire tutto usa tutte le foto");
});

test("Auto Build: stile predefinito del progetto e modo di inquadratura scelto", () => {
  let project = makeProject(8);
  project = { ...project, settings: { ...project.settings, defaultStyle: { ...project.settings.defaultStyle, gapCm: 0.5, paddingCm: 1.1, background: "#000000" } } };
  const built = autoBuildAlbum(project, { ...DEFAULT_AUTO_BUILD, fitMode: "fit", respectChapters: false });
  for (const spread of built.spreads) for (const area of spread.areas) {
    assert.equal(area.style.gapCm, 0.5);
    assert.equal(area.style.paddingCm, 1.1);
    assert.equal(area.style.background, "#000000");
    assert.equal(area.style.mode, "fit");
  }
});

test("Auto Build: variare i layout evita lo stesso disegno su pagine consecutive di pari numero di foto", () => {
  const built = autoBuildAlbum(makeProject(80), { ...DEFAULT_AUTO_BUILD, photosPerArea: 3, respectChapters: false, splitMode: "half", varyLayouts: true });
  const flat = built.spreads.flatMap((s) => s.areas).filter((a) => a.items.length === 3);
  const kinds = new Set(flat.map((a) => JSON.stringify(a.layout).replaceAll(/"itemId":"[^"]+"/g, "")));
  assert.ok(kinds.size >= 3, `servono layout vari, ne ho ${kinds.size}`);
  const seeds = new Set(flat.map((a) => a.seed));
  assert.ok(seeds.size >= 2);
});

test("Auto Build: 500 foto restano rapide e coerenti", () => {
  const project = makeProject(500);
  const started = performance.now();
  const built = autoBuildAlbum(project, { ...DEFAULT_AUTO_BUILD, photosPerArea: 4, respectChapters: false });
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 5000, `troppo lento: ${Math.round(elapsed)} ms`);
  assert.equal(used(built).size, 500);
  assertProjectInvariants(built, "500 foto");
  assert.ok(serializeAlbumProject(built).length < 6_000_000, "il file progetto resta gestibile");
});

test("Auto Build: suddivisione in gruppi con programmazione dinamica", () => {
  const rect = { x: 0, y: 0, w: 280, h: 280 };
  for (const n of [1, 2, 7, 23, 100]) {
    const aspects = Array.from({ length: n }, (_, i) => [1.5, 0.667, 1.5, 1][i % 4]);
    const sizes = chunkSequence(aspects, 3, rect, 2);
    assert.equal(sizes.reduce((a, b) => a + b, 0), n, `n=${n}: la somma dei gruppi è n`);
    assert.ok(sizes.every((size) => size >= 1 && size <= 4), `n=${n}: ${sizes.join(",")}`);
  }
  assert.deepEqual(chunkSequence([], 3, rect, 2), []);
  assert.deepEqual(chunkSequence([1.5], 3, rect, 2), [1]);
});

test("Auto Build: gruppi per capitolo con le foto senza capitolo in fondo", () => {
  let project = makeProject(10);
  project = createChapter(project, "B");
  project = createChapter(project, "A");
  project = assignAssets(project, ["a5", "a6"], project.chapters[0].id);
  project = assignAssets(project, ["a1", "a2"], project.chapters[1].id);
  const groups = orderedGroups(project, project.assets, true);
  assert.deepEqual(groups.map((g) => g.title), ["B", "A", "Senza capitolo"], "l'ordine è quello dei capitoli, non alfabetico");
  assert.deepEqual(groups[0].assets.map((a) => a.id), ["a5", "a6"]);
  assert.equal(groups[2].assets.length, 6);
  assert.deepEqual(orderedGroups(project, project.assets, false).map((g) => g.title), ["Album"]);
});

// ------------------------------------------------------------------ capitoli

test("capitoli: creazione, nomi unici, colori, rinomina, ordine e rimozione senza perdere le foto", () => {
  let project = makeProject(8);
  project = createChapter(project, "  Casa   sposo ");
  assert.equal(project.chapters[0].title, "Casa sposo");
  assert.equal(project.chapters[0].color, CHAPTER_COLORS[0]);
  assert.throws(() => createChapter(project, "casa sposo"), /Esiste già/);
  assert.throws(() => createChapter(project, "   "), /nome/);
  project = createChapter(project, "Chiesa", "#123456");
  assert.equal(project.chapters[1].color, "#123456");
  project = renameChapter(project, project.chapters[1].id, "Cerimonia");
  assert.equal(project.chapters[1].title, "Cerimonia");
  assert.throws(() => renameChapter(project, project.chapters[1].id, "casa sposo"), /Esiste già/);
  assert.throws(() => renameChapter(project, "x", "A"), /inesistente/);
  project = recolorChapter(project, project.chapters[0].id, "#ffffff");
  assert.equal(project.chapters[0].color, "#ffffff");
  const [a, b] = project.chapters;
  assert.deepEqual(moveChapter(project, b.id, -1).chapters.map((c) => c.id), [b.id, a.id]);
  assert.equal(moveChapter(project, a.id, -1), project);
  project = assignAssets(project, ["a0", "a1"], a.id);
  const removed = removeChapter(project, a.id);
  assert.equal(removed.assets.length, 8, "le foto restano nell'album");
  assert.equal(chapterOfAsset(removed, "a0"), undefined);
  assert.throws(() => removeChapter(project, "x"), /inesistente/);
});

test("capitoli: una foto sta in un solo capitolo e si può togliere con null", () => {
  let project = makeProject(6);
  project = createChapter(createChapter(project, "A"), "B");
  const [a, b] = project.chapters;
  project = assignAssets(project, ["a0", "a1", "a2"], a.id);
  project = assignAssets(project, ["a1"], b.id);
  assert.deepEqual(project.chapters[0].assetIds, ["a0", "a2"]);
  assert.deepEqual(project.chapters[1].assetIds, ["a1"]);
  assert.equal(assignAssets(project, ["a1"], b.id), project, "già lì: nessun cambiamento");
  project = assignAssets(project, ["a0", "a1"], null);
  assert.equal(chapterOfAsset(project, "a0"), undefined);
  assert.equal(chapterOfAsset(project, "a1"), undefined);
  assert.equal(assignAssets(project, ["inesistente"], a.id), project);
  assert.throws(() => assignAssets(project, ["a0"], "x"), /inesistente/);
  assertProjectInvariants(project, "capitoli");
});

test("capitoli: i gruppi predefiniti non duplicano quelli esistenti e il colore ruota", () => {
  let project = makeProject(2);
  project = createChapter(project, "chiesa");
  const wedding = BUILTIN_CHAPTER_PRESETS.find((p) => p.id === "wedding")!;
  project = applyChapterPreset(project, wedding);
  assert.equal(project.chapters.length, wedding.titles.length, "«Chiesa» esiste già (senza maiuscole)");
  assert.deepEqual(project.chapters.map((c) => c.title).slice(1), wedding.titles.filter((t) => t !== "Chiesa"));
  assert.equal(applyChapterPreset(project, wedding), project, "riapplicare non cambia nulla");
  assert.ok(new Set(project.chapters.map((c) => c.color)).size >= Math.min(project.chapters.length, CHAPTER_COLORS.length));
});

// ------------------------------------------------------------------ libreria

test("libreria: ordinamenti per ora di scatto, nome naturale, ordine del Selector e manuale", () => {
  const assets = [
    makeAsset(0, { fileName: "IMG_10.jpg", captureTimeMs: 300, selectionOrder: 2, manualOrder: 1 }),
    makeAsset(1, { fileName: "IMG_2.jpg", captureTimeMs: 100, selectionOrder: 0, manualOrder: 2 }),
    makeAsset(2, { fileName: "IMG_1.jpg", captureTimeMs: 200, selectionOrder: 1, manualOrder: 0 }),
    makeAsset(3, { fileName: "IMG_3.jpg", captureTimeMs: undefined, createdAt: 50 }),
  ];
  const names = (key: Parameters<typeof compareAssets>[0]) => sortAssets(assets, key).map((a) => a.fileName);
  assert.deepEqual(names("capture-time"), ["IMG_3.jpg", "IMG_2.jpg", "IMG_1.jpg", "IMG_10.jpg"], "senza data di scatto vale la data del file");
  assert.deepEqual(names("file-name"), ["IMG_1.jpg", "IMG_2.jpg", "IMG_3.jpg", "IMG_10.jpg"], "ordine naturale: 2 prima di 10");
  assert.deepEqual(names("selector-order").slice(0, 3), ["IMG_2.jpg", "IMG_1.jpg", "IMG_10.jpg"]);
  assert.deepEqual(names("manual").slice(0, 3), ["IMG_1.jpg", "IMG_10.jpg", "IMG_2.jpg"]);
  assert.equal(setSortKey(makeProject(1), "capture-time").settings.sortKey, "capture-time");
  assert.equal(setSortKey(makeProject(1), "file-name").settings.sortKey, "file-name");
});

test("libreria: schede, filtri, usi, duplicati, foto non usate e «Localizza»", () => {
  let project = makeProject(12);
  project = createChapter(project, "Festa");
  project = assignAssets(project, ["a2", "a3", "a4"], project.chapters[0].id);
  const chapterId = project.chapters[0].id;
  assert.deepEqual(assetsInTab(project, chapterId).map((a) => a.id), ["a2", "a3", "a4"]);
  assert.equal(assetsInTab(project, "none").length, 9);
  assert.equal(assetsInTab(project, "all").length, 12);
  assert.deepEqual(assetsInTab(project, "inesistente"), []);

  project = addSpread(project);
  const spreadId = project.spreads[0].id;
  project = appendAssets(project, spreadId, 0, ["a0", "a1"]);
  project = appendAssets(project, spreadId, 1, ["a1", "a5"]);
  assert.equal(unusedAssets(project).length, 12 - 3);
  assert.deepEqual(duplicatedAssetIds(project), ["a1"]);
  assert.equal(assetUsage(project).get("a1")!.length, 2);
  const located = locateAsset(project, "a5")!;
  assert.deepEqual([located.spreadIndex, located.areaIndex], [0, 1]);
  assert.equal(locateAsset(project, "a9"), null);

  const all = assetsInTab(project, "all");
  assert.equal(filterAssets(project, all, { usage: "used" }).length, 3);
  assert.equal(filterAssets(project, all, { usage: "unused" }).length, 9);
  assert.equal(filterAssets(project, all, { query: "01003" }).length, 1);
  assert.deepEqual(filterAssets(project, all, { minRating: 5 }).map((a) => a.rating), [5, 5]);
  assert.equal(filterAssets(project, all, {}).length, 12);
});

test("libreria: stelle, tag, ordine manuale e rimozione dall'album ripulisce spread e capitoli", () => {
  let project = makeProject(10);
  assert.equal(setRating(project, "a1", 4).assets.find((a) => a.id === "a1")!.rating, 4);
  assert.equal(setRating(project, "a1", 99).assets.find((a) => a.id === "a1")!.rating, 5);
  assert.equal(setRating(project, "a1", -2).assets.find((a) => a.id === "a1")!.rating, 0);
  assert.equal(setRating(project, "a1", project.assets[1].rating!), project, "stesso valore: nessun cambiamento");
  assert.equal(setRating(project, "x", 3), project);
  const tagged = toggleAssetTag(toggleAssetTag(project, "a2", "cover"), "a2", "main");
  assert.deepEqual(tagged.assets.find((a) => a.id === "a2")!.albumTags, ["cover", "main"]);
  assert.deepEqual(toggleAssetTag(tagged, "a2", "cover").assets.find((a) => a.id === "a2")!.albumTags, ["main"]);

  const visible = sortAssets(project.assets, "capture-time").map((a) => a.id);
  const reordered = reorderAssets(project, visible, ["a5", "a6"], "a1");
  assert.equal(reordered.settings.sortKey, "manual");
  assert.deepEqual(sortAssets(reordered.assets, "manual").map((a) => a.id).slice(0, 5), ["a0", "a5", "a6", "a1", "a2"]);
  assert.deepEqual(sortAssets(reorderAssets(project, visible, ["a0"], null).assets, "manual").map((a) => a.id).slice(-1), ["a0"]);
  assert.equal(reorderAssets(project, visible, [], "a1"), project);

  project = createChapter(project, "Festa");
  project = assignAssets(project, ["a0", "a1"], project.chapters[0].id);
  project = addSpread(project);
  project = appendAssets(project, project.spreads[0].id, 0, ["a0", "a1", "a2"]);
  const without = removeAssets(project, ["a1"]);
  assert.equal(without.assets.length, 9);
  assert.deepEqual(without.chapters[0].assetIds, ["a0"]);
  assert.deepEqual(without.spreads[0].areas[0].items.map((i) => i.assetId), ["a0", "a2"]);
  assertProjectInvariants(without, "rimozione dalla libreria");
  assert.equal(removeAssets(project, ["x"]), project);
});

// ------------------------------------------------------------------ importazione

const candidate = (name: string, extra: Partial<ImportCandidate> = {}): ImportCandidate => ({ fileName: name, absolutePath: `C:\\Foto\\${name}`, size: 1000, ...extra });

test("importazione: riconosce i duplicati per percorso (anche con separatori e maiuscole diversi) o per nome e peso", () => {
  const project = makeProject(3);
  assert.equal(normalizePathKey("C:\\Foto\\A.JPG"), normalizePathKey("c:/foto//a.jpg"));
  assert.notEqual(normalizePathKey("/Users/a/A.jpg"), normalizePathKey("/users/a/a.jpg"), "su macOS le maiuscole contano");
  const existing = project.assets[0].absolutePath!;
  const plan = planImport(project, [
    { fileName: "x.jpg", absolutePath: existing.toLowerCase().replaceAll("\\", "/") },
    candidate("nuova1.jpg"),
    candidate("nuova1.jpg"),
    candidate("nuova2.jpg"),
    { fileName: "senza-percorso.jpg", size: 42 },
    { fileName: "SENZA-percorso.jpg", size: 42 },
  ]);
  assert.equal(plan.duplicates.length, 1);
  assert.equal(plan.duplicates[0].existingAssetId, "a0");
  assert.equal(plan.fresh.length, 3, "nuove: due con percorso e una senza");
  assert.equal(plan.repeatedInBatch, 2);
  assert.notEqual(candidateKey({ fileName: "a.jpg", size: 1 }), candidateKey({ fileName: "a.jpg", size: 2 }));
  const again = planImport(applyImport(project, plan, { chapterId: null, duplicates: "skip" }).project, [{ fileName: "senza-percorso.jpg", size: 42 }]);
  assert.equal(again.duplicates.length, 1, "dopo l'importazione la stessa foto è un duplicato");
});

test("importazione: capitolo di destinazione, ordine manuale in coda e scelta sui duplicati", () => {
  let project = makeProject(3);
  project = createChapter(project, "Casa sposa");
  const chapterId = project.chapters[0].id;
  const existing = project.assets[1].absolutePath!;
  const plan = planImport(project, [candidate("a.jpg", { width: 4000, height: 6000, captureTimeMs: 5 }), candidate("b.jpg"), { fileName: "dup.jpg", absolutePath: existing }]);
  const skipped = applyImport(project, plan, { chapterId, duplicates: "skip" });
  assert.equal(skipped.project.assets.length, 5);
  assert.equal(skipped.skipped, 1);
  assert.deepEqual(skipped.project.chapters[0].assetIds, skipped.addedAssetIds);
  const added = skipped.project.assets.filter((a) => skipped.addedAssetIds.includes(a.id));
  assert.equal(added[0].orientation, "vertical");
  assert.equal(added[0].captureTimeMs, 5);
  assert.deepEqual(added.map((a) => a.manualOrder), [0, 1], "in coda all'ordine manuale (le foto già presenti non ne hanno uno)");

  const all = applyImport(project, plan, { chapterId: null, duplicates: "add" });
  assert.equal(all.project.assets.length, 6, "i duplicati vengono aggiunti come foto nuove");
  assert.equal(all.skipped, 0);
  const none = applyImport(project, { fresh: [], duplicates: [], repeatedInBatch: 0 }, { chapterId, duplicates: "skip" });
  assert.equal(none.project, project);
  assertProjectInvariants(all.project, "importazione");
});

test("importazione: foto senza misure ricevono proporzioni di riserva; estensioni riconosciute", () => {
  const asset = assetFromCandidate({ fileName: "x.jpg" }, 0);
  assert.equal(asset.aspectRatio, 1.5);
  assert.equal(asset.rating, 0);
  const square = assetFromCandidate({ fileName: "x.jpg", width: 100, height: 100, rating: 9 }, 0);
  assert.equal(square.orientation, "square");
  assert.equal(square.rating, 5);
  assert.ok(isImageFileName("A.CR3") && isImageFileName("b.JPeG") && isImageFileName("c.heic"));
  assert.ok(!isImageFileName("note.txt") && !isImageFileName("x.xmp"));
  assert.ok(IMAGE_EXTENSIONS.includes(".jpg"));
});

// ------------------------------------------------------------------ salvataggio

test("salvataggio: andata e ritorno fedeli, e file danneggiati o di versioni diverse rifiutati con un messaggio chiaro", () => {
  let project = autoBuildAlbum(makeProject(20), DEFAULT_AUTO_BUILD);
  project = createChapter(project, "Festa");
  const text = serializeAlbumProject(project);
  assert.deepEqual(parseAlbumProject(text), JSON.parse(JSON.stringify(project)));
  assert.equal(projectProblem(JSON.parse(text).project), null);

  assert.throws(() => parseAlbumProject("{non json"), /JSON corrotto/);
  assert.throws(() => parseAlbumProject("[]"), /Campo non valido/);
  assert.throws(() => parseAlbumProject(JSON.stringify({ format: "altro", version: 2, project })), /non è un progetto di Album Flow/);
  assert.throws(() => parseAlbumProject(JSON.stringify({ format: "filex-album-project", version: 1, project: {} })), /versione precedente/);
  assert.throws(() => parseAlbumProject(JSON.stringify({ format: "filex-album-project", version: 9, project })), /non supportata/);

  const mutate = (fn: (copy: any) => void) => { const copy = JSON.parse(text); fn(copy.project); return JSON.stringify({ format: "filex-album-project", version: 2, project: copy.project }); };
  assert.throws(() => parseAlbumProject(mutate((p) => { p.assets.push({ ...p.assets[0] }); })), /duplicata/);
  assert.throws(() => parseAlbumProject(mutate((p) => { p.spreads[0].areas[0].items[0].assetId = "inesistente"; })), /non esiste/);
  assert.throws(() => parseAlbumProject(mutate((p) => { p.spreads[0].areas.pop(); })), /numero di aree/);
  assert.throws(() => parseAlbumProject(mutate((p) => { p.spreads[0].areas[0].items[0].zoom = 40; })), /zoom/);
  assert.throws(() => parseAlbumProject(mutate((p) => { p.spreads[0].areas[0].layout = null; })), /non ha layout/);
  assert.throws(() => parseAlbumProject(mutate((p) => { p.spreads[0].areas[0].style.gapCm = 99; })), /gapCm/);
  assert.throws(() => parseAlbumProject(mutate((p) => { p.spreads[0].split = "quarter"; })), /Valore non supportato/);
  assert.throws(() => parseAlbumProject(mutate((p) => { p.chapters[0].assetIds = ["nessuna"]; })), /non esiste/);
  assert.throws(() => parseAlbumProject(mutate((p) => { p.stage = "boh"; })), /stage/);
  assert.throws(() => parseAlbumProject(mutate((p) => { p.spreads[1].id = p.spreads[0].id; })), /duplicato/);
});

test("salvataggio: l'ordine delle foto viene riallineato alle foglie in lettura", () => {
  const project = autoBuildAlbum(makeProject(8), { ...DEFAULT_AUTO_BUILD, respectChapters: false });
  const raw = JSON.parse(serializeAlbumProject(project));
  raw.project.spreads[0].areas[0].items.reverse();
  const loaded = parseAlbumProject(JSON.stringify(raw));
  assertProjectInvariants(loaded, "riallineato");
});

// ------------------------------------------------------------------ controlli

test("controlli prima dell'export: errori, bassa risoluzione, aree vuote, duplicati, piega", () => {
  const empty = preflightReport(makeProject(3));
  assert.equal(empty.errors, 1);
  assert.match(empty.issues[0].message, /nessuno spread/);

  const built = autoBuildAlbum(makeProject(12), { ...DEFAULT_AUTO_BUILD, respectChapters: false, splitMode: "half" });
  const ok = preflightReport(built);
  assert.equal(ok.errors, 0);
  assert.equal(ok.stats.photos, 12);
  assert.equal(ok.stats.lowResolution, 0);

  const lowRes = { ...built, assets: built.assets.map((asset, index) => (index === 0 ? { ...asset, width: 600, height: 400, aspectRatio: 1.5 } : asset)) };
  const low = preflightReport(lowRes);
  assert.equal(low.stats.lowResolution, 1);
  assert.ok(low.issues.some((issue) => issue.level === "warning" && issue.message.includes(lowRes.assets[0].fileName) && /dpi/.test(issue.message)));

  const withEmpty = addSpread(built);
  assert.ok(preflightReport(withEmpty).stats.emptyAreas >= 2);
  assert.ok(preflightReport(withEmpty).issues.some((issue) => /vuota/.test(issue.message)));

  const dup = appendAssets(withEmpty, withEmpty.spreads[withEmpty.spreads.length - 1].id, 0, ["a0"]);
  assert.equal(preflightReport(dup).stats.duplicates, 1);

  let panorama = addSpread(makeProject(2), 0, "full");
  panorama = appendAssets(panorama, panorama.spreads[0].id, 0, ["a0", "a1"]);
  const crossing = preflightReport(panorama);
  assert.ok(crossing.stats.foldCrossings >= 0);
  const fullSingle = appendAssets(setSplitMode(addSpread(makeProject(2)), addSpread(makeProject(2)).spreads[0]?.id ?? "", "full"), "x", 0, ["a0"]);
  assert.ok(fullSingle);
  const brokenAsset = { ...built, assets: built.assets.filter((asset) => asset.id !== "a0") };
  assert.ok(preflightReport(brokenAsset).errors >= 1, "una foto usata ma non più in libreria è un errore");
});

test("controlli: una foto a tutto foglio attraversa la piega e viene segnalata come informazione", () => {
  let project = addSpread(makeProject(3), 0, "full");
  project = appendAssets(project, project.spreads[0].id, 0, ["a0"]);
  const report = preflightReport(project);
  assert.equal(report.stats.foldCrossings, 1);
  assert.equal(report.issues.find((issue) => issue.level === "info" && /piega/.test(issue.message))?.level, "info");
  assert.equal(report.errors, 0);
});

// ------------------------------------------------------------------ Selector

function handoff(extra: Partial<{ selected: (i: number) => boolean }> = {}): DesktopPhotoToolHandoff {
  const assets = Array.from({ length: 12 }, (_, index) => ({
    assetId: `sel-${index}`, relativePath: `IMG_${index}.jpg`, absolutePath: `C:\\Foto\\Rossi\\IMG_${index}.jpg`, fileName: `IMG_${index}.jpg`,
    width: index % 3 === 0 ? 4000 : 6000, height: index % 3 === 0 ? 6000 : 4000, aspectRatio: index % 3 === 0 ? 2 / 3 : 1.5,
    orientation: index % 3 === 0 ? "vertical" : "horizontal", selected: (extra.selected ?? ((i) => i !== 11))(index), selectionOrder: index, rating: 3,
    pickStatus: "unmarked", colorLabel: null,
    customLabels: index < 4 ? ["Casa sposo"] : index < 8 ? ["Chiesa", "Casa sposo"] : [],
    labelIds: index < 4 ? ["l1"] : index < 8 ? ["l2", "l1"] : [],
  }));
  return {
    albumFlow: {
      schemaVersion: 1, handoffId: "h", sourceToolId: "photo-selector-app", sourceRoot: "C:\\Foto\\Rossi", projectId: "rossi", projectName: "Matrimonio Rossi",
      createdAt: "2026-10-01T10:00:00Z", expiresAt: "2026-10-01T11:00:00Z",
      labels: [{ id: "l1", name: "Casa sposo", source: "selector-custom" }, { id: "l2", name: "Chiesa", source: "selector-custom" }, { id: "c1", name: "Rosso", source: "selector-color" }],
      assets,
    },
  } as unknown as DesktopPhotoToolHandoff;
}

test("dal Selector: foto selezionate, ordine, percorsi e capitoli proposti dalle etichette", () => {
  const project = projectFromHandoff(handoff());
  assert.equal(project.projectId, "rossi");
  assert.equal(project.assets.length, 11, "le foto non selezionate non entrano");
  assert.equal(project.assets[0].absolutePath, "C:\\Foto\\Rossi\\IMG_0.jpg");
  assert.equal(project.assets[3].selectionOrder, 3);
  assert.deepEqual(project.chapters.map((c) => c.title), ["Casa sposo", "Chiesa"], "solo etichette personalizzate");
  assert.deepEqual(project.chapters[0].assetIds, ["sel-0", "sel-1", "sel-2", "sel-3"]);
  assert.deepEqual(project.chapters[1].assetIds, ["sel-4", "sel-5", "sel-6", "sel-7"], "una foto con più etichette va nel capitolo della prima");
  assert.equal(project.stage, "pending");
  assert.equal(project.sourceFolderPath, "C:\\Foto\\Rossi");
  assert.throws(() => projectFromHandoff({} as DesktopPhotoToolHandoff), /Album Flow/);
});

test("dal Selector: un reinvio conserva impaginazione, capitoli e tag, e toglie le foto scartate", () => {
  let first = projectFromHandoff(handoff());
  first = autoBuildAlbum(first, DEFAULT_AUTO_BUILD);
  first = toggleAssetTag(first, "sel-2", "panorama");
  const manual = { ...first, assets: [...first.assets, makeAsset(77)] };
  const resent = projectFromHandoff(handoff({ selected: (i) => i !== 11 && i !== 5 }));
  const merged = mergeIncomingProject(manual, resent);
  assertProjectInvariants(merged, "dopo reinvio");
  assert.ok(!merged.assets.some((asset) => asset.id === "sel-5"), "la foto scartata esce dall'album");
  assert.ok(!assetUsage(merged).has("sel-5"));
  assert.ok(merged.assets.some((asset) => asset.id === "a77"), "le foto importate a mano restano");
  assert.deepEqual(merged.assets.find((asset) => asset.id === "sel-2")!.albumTags, ["panorama"]);
  assert.equal(merged.spreads.length > 0, true);
  assert.equal(merged.stage, "editing");
  assert.equal(mergeIncomingProject(undefined, resent), resent);
  const renamed = mergeIncomingProject({ ...manual, projectName: "Nome scelto da me" }, resent);
  assert.equal(renamed.projectName, "Nome scelto da me");
});

// ------------------------------------------------------------------ salvataggio locale e formati

test("salvataggio locale: legge e scrive, mette in quarantena i progetti non validi e conta quelli del formato precedente", () => {
  storage().clear();
  assert.deepEqual(loadProjects(), { projects: [], skipped: 0, legacy: 0 });
  const good = autoBuildAlbum(makeProject(6), DEFAULT_AUTO_BUILD);
  assert.equal(saveProjects([good]), true);
  assert.equal(loadProjects().projects.length, 1);
  assert.equal(loadProjects().projects[0].projectId, good.projectId);

  storage().setItem("filex.albumFlow.v2.projects", JSON.stringify([good, { schemaVersion: 2, rotto: true }]));
  storage().setItem("filex.albumFlow.projects", JSON.stringify([{ vecchio: 1 }, { vecchio: 2 }]));
  const loaded = loadProjects();
  assert.equal(loaded.projects.length, 1);
  assert.equal(loaded.skipped, 1);
  assert.equal(loaded.legacy, 2);
  assert.equal(JSON.parse(storage().getItem("filex.albumFlow.v2.quarantine")!).length, 1, "l'originale è conservato a parte");
  assert.equal(storage().getItem("filex.albumFlow.projects"), JSON.stringify([{ vecchio: 1 }, { vecchio: 2 }]), "il salvataggio precedente non viene toccato");

  storage().setItem("filex.albumFlow.v2.projects", "{rotto");
  assert.deepEqual(loadProjects().projects, []);
  storage().setItem("filex.albumFlow.v2.projects.pending", JSON.stringify([good]));
  assert.equal(loadProjects().projects.length, 1, "l'istantanea pendente viene promossa");
  assert.equal(storage().getItem("filex.albumFlow.v2.projects.pending"), null);
});

test("salvataggio locale: un album con troppe foto in una pagina viene riparato e resta nella Home, con l'originale in quarantena", () => {
  storage().clear();
  let project = addSpread(makeProject(30), 0, "full");
  const id = project.spreads[0].id;
  project = appendAssets(project, id, 0, Array.from({ length: 12 }, (_, index) => `a${index}`));
  const area = project.spreads[0].areas[0];
  const extra = ["a12", "a13", "a14"].map(createItem);
  let layout = area.layout!;
  for (const item of extra) layout = { kind: "split", dir: "row", ratio: 0.5, first: layout, second: { kind: "leaf", itemId: item.id } };
  const broken = { ...project, spreads: [{ ...project.spreads[0], areas: [{ ...area, layout, items: [...area.items, ...extra] }] }] } as Project;
  assert.match(projectProblem(broken) ?? "", /Troppe foto/);
  assert.equal(repairOversizedAreas(project), null, "un album in regola non si tocca");

  storage().setItem("filex.albumFlow.v2.projects", JSON.stringify([broken]));
  const loaded = loadProjects();
  assert.equal(loaded.projects.length, 1, "l'album non sparisce");
  assert.equal(loaded.skipped, 0);
  const fixed = loaded.projects[0];
  assert.equal(fixed.spreads[0].areas[0].items.length, 12);
  assert.deepEqual(fixed.spreads[0].areas[0].items.map((item) => item.assetId), area.items.map((item) => item.assetId), "restano le prime 12 foto, in ordine");
  assert.equal(projectProblem(fixed), null);
  assertProjectInvariants(fixed, "album riparato");
  assert.equal(fixed.assets.length, 30, "le foto in eccesso restano nella libreria");
  const quarantine = () => JSON.parse(storage().getItem("filex.albumFlow.v2.quarantine")!) as unknown[];
  assert.equal(quarantine().length, 1, "l'originale è conservato a parte");
  assert.equal(loadProjects().projects.length, 1);
  assert.equal(quarantine().length, 1, "la riparazione è stata salvata: non si ripete a ogni avvio");
});

test("divisione: se le foto non stanno in una pagina il cambio si rifiuta con un messaggio e non supera mai il tetto", () => {
  let project = addSpread(makeProject(30));
  const id = project.spreads[0].id;
  project = appendAssets(project, id, 0, Array.from({ length: 7 }, (_, index) => `a${index}`));
  project = appendAssets(project, id, 1, Array.from({ length: 8 }, (_, index) => `a${index + 7}`));
  assert.equal(setSplitMode(project, id, "full"), project, "7 + 8 foto non stanno in un foglio solo");
  assert.match(splitRefusal(project, id, "full") ?? "", /15 foto.*12/);
  assert.equal(splitRefusal(project, id, "half"), null, "stessa divisione: niente da dire");

  let small = addSpread(makeProject(30));
  const smallId = small.spreads[0].id;
  small = appendAssets(small, smallId, 0, Array.from({ length: 6 }, (_, index) => `a${index}`));
  small = appendAssets(small, smallId, 1, Array.from({ length: 6 }, (_, index) => `a${index + 6}`));
  assert.equal(splitRefusal(small, smallId, "full"), null, "6 + 6 = 12 stanno");
  const merged = setSplitMode(small, smallId, "full");
  assert.equal(merged.spreads[0].areas[0].items.length, 12);
  assertProjectInvariants(merged, "dodici in un foglio");
});

test("formati: conversioni di unità, chiavi, recenti e preferiti", () => {
  assert.equal(toCm(300, "mm"), 30);
  assert.ok(Math.abs(toCm(11.811, "in") - 30) < 0.01);
  assert.equal(fromCm(30, "mm"), 300);
  assert.equal(fromCm(30, "cm"), 30);
  assert.ok(Math.abs(fromCm(30, "in") - 11.811) < 0.001);
  assert.equal(formatLabel({ widthCm: 30, heightCm: 20 }), "30 × 20 cm");
  assert.equal(formatKey({ widthCm: 30.04, heightCm: 20 }), "30x20");
  assert.ok(COMMON_FORMATS.every(isValidFormat));
  assert.equal(isValidFormat({ widthCm: 2, heightCm: 30 }), false);
  assert.equal(sheetFromFormat({ widthCm: 30, heightCm: 20 }).label, "Orizzontale 30 × 20 cm");
  assert.equal(sheetFromFormat({ widthCm: 30, heightCm: 30 }).label, "Quadrato 30 × 30 cm");

  storage().clear();
  pushRecentFormat({ widthCm: 30, heightCm: 30 });
  pushRecentFormat({ widthCm: 25, heightCm: 25 });
  const recents = pushRecentFormat({ widthCm: 30, heightCm: 30 });
  assert.deepEqual(recents.map(formatKey), ["30x30", "25x25"], "senza duplicati, l'ultimo usato in cima");
  for (let i = 0; i < 12; i += 1) pushRecentFormat({ widthCm: 10 + i, heightCm: 20 });
  assert.equal(loadRecentFormats().length, 8);
  assert.equal(toggleFavoriteFormat({ widthCm: 40, heightCm: 30 }).length, 1);
  assert.equal(toggleFavoriteFormat({ widthCm: 40, heightCm: 30 }).length, 0);
  assert.equal(loadFavoriteFormats().length, 0);
});

test("album di prova e fasi del progetto", () => {
  const demo = createDemoProject();
  assert.equal(demo.assets.length, 36);
  assert.equal(demo.chapters.length, 4);
  assert.equal(demo.chapters.reduce((sum, chapter) => sum + chapter.assetIds.length, 0), 36);
  assert.equal(projectProblem(JSON.parse(JSON.stringify(demo))), null);
  const built = autoBuildAlbum(demo, DEFAULT_AUTO_BUILD);
  assertProjectInvariants(built, "demo");
  assert.ok(built.spreads.some((s) => s.split === "full"), "il demo contiene un panorama a foglio intero");
  assert.deepEqual(STAGES.map((s) => s.id), ["pending", "editing", "proofing", "complete"]);
  assert.equal(stageLabel("proofing"), "In revisione");
  assert.equal(findItem(built, "x"), null);
});

test("stile e blocco restano dopo un nuovo Auto Build sulle sole foto non usate", () => {
  let project = autoBuildAlbum(makeProject(8), { ...DEFAULT_AUTO_BUILD, respectChapters: false });
  const spreadId = project.spreads[0].id;
  project = setAreaStyle(project, spreadId, 0, { paddingCm: 2.2 });
  const item = project.spreads[0].areas[0].items[0];
  project = toggleItemLock(project, item.id);
  const more = { ...project, assets: [...project.assets, makeAsset(90)] };
  const extended = autoBuildAlbum(more, { ...DEFAULT_AUTO_BUILD, scope: "unused", respectChapters: false });
  assert.equal(extended.spreads[0].areas[0].style.paddingCm, 2.2);
  assert.equal(findItem(extended, item.id)!.item.locked, true);
});

test("importazione: le sottocartelle si possono escludere prima di importare", () => {
  const photo = (folder: string, index: number): ImportCandidate => ({ fileName: `${folder.split("/").pop()}_${index}.jpg`, absolutePath: `/foto/${folder}/${index}.jpg`, size: 1000 + index, folder });
  const candidates = [
    ...Array.from({ length: 5 }, (_, i) => photo("selezione", i)),
    ...Array.from({ length: 3 }, (_, i) => photo("selezione/chiesa", i)),
    ...Array.from({ length: 4 }, (_, i) => photo("selezione/NON METTERE", i)),
    ...Array.from({ length: 2 }, (_, i) => photo("selezione/Sposi 10", i)),
    ...Array.from({ length: 2 }, (_, i) => photo("selezione/Sposi 2", i)),
    { fileName: "senza.jpg", absolutePath: "/foto/senza.jpg", size: 5 },
  ];
  const groups = folderGroups(candidates);
  assert.deepEqual(groups.map((group) => [group.folder, group.count]), [["", 1], ["selezione", 5], ["selezione/chiesa", 3], ["selezione/NON METTERE", 4], ["selezione/Sposi 2", 2], ["selezione/Sposi 10", 2]], "ordine naturale: Sposi 2 prima di Sposi 10, foto senza cartella per prima");
  const project = makeProject(0);
  assert.equal(planImport(project, candidates).fresh.length, 17);
  const kept = withoutFolders(candidates, new Set(["selezione/NON METTERE"]));
  assert.equal(kept.length, 13);
  assert.equal(planImport(project, kept).fresh.length, 13);
  assert.equal(withoutFolders(candidates, new Set()).length, 17, "nessuna esclusione: tutte le foto");
  assert.equal(withoutFolders(candidates, new Set(groups.map((group) => group.folder))).length, 0, "escluse tutte le cartelle: nessuna foto");
  const result = applyImport(project, planImport(project, kept), { chapterId: null, duplicates: "skip" });
  assert.equal(result.project.assets.length, 13);
  assert.ok(result.project.assets.every((asset) => !asset.fileName.startsWith("NON METTERE")));
  assertProjectInvariants(result.project, "importato senza cartelle escluse");
});

test("stelle: filtro esatto, per etichetta e per origine; le stelle del Selector si rispettano o si lasciano al progetto", () => {
  let project = makeProject(8);
  project = { ...project, labels: [{ id: "l1", name: "Cerimonia", source: "selector-custom" }], assets: project.assets.map((asset, i) => ({ ...asset, rating: i % 4, selectorRating: i % 4, ...(i < 5 ? { selectionOrder: i, labelIds: i % 2 ? ["l1"] : [] } : {}) })) };
  const all = project.assets;
  assert.deepEqual(filterAssets(project, all, { exactRating: 1 }).map((a) => a.id), ["a1", "a5"], "solo ★1, non le più alte");
  assert.equal(filterAssets(project, all, { exactRating: 0 }).length, 2, "senza stelle");
  assert.equal(filterAssets(project, all, { minRating: 1 }).length, 6, "almeno ★1");
  assert.deepEqual(filterAssets(project, all, { labelId: "l1" }).map((a) => a.id), ["a1", "a3"]);
  assert.equal(filterAssets(project, all, { origin: "selector" }).length, 5);
  assert.equal(filterAssets(project, all, { origin: "manual" }).length, 3);
  assert.equal(filterAssets(project, all, { exactRating: 1, origin: "selector" }).length, 1, "i filtri si combinano");

  // L'utente cambia le stelle in questo album, poi il Selector reinvia con altri valori.
  const mine = setRating(project, "a0", 5);
  const incoming = { ...project, assets: project.assets.map((asset) => (asset.id === "a0" ? { ...asset, rating: 2, selectorRating: 2 } : asset)) };
  const followed = mergeIncomingProject(mine, incoming);
  assert.equal(followed.assets.find((a) => a.id === "a0")!.rating, 2, "di default segue il Selector");
  const kept = mergeIncomingProject(setRatingPolicy(mine, "project"), incoming);
  const a0 = kept.assets.find((a) => a.id === "a0")!;
  assert.equal(a0.rating, 5, "stelle solo di questo album: non sovrascritte");
  assert.equal(a0.selectorRating, 2, "ma il valore del Selector resta noto");
  // Tornando a «Selector» le stelle si riallineano; azzerare le toglie tutte.
  assert.equal(setRatingPolicy(kept, "selector").assets.find((a) => a.id === "a0")!.rating, 2);
  assert.equal(setRatingPolicy(project, "selector"), project, "già su selector: nessun cambio");
  assert.ok(clearRatings(project).assets.every((a) => (a.rating ?? 0) === 0));
  assert.equal(clearRatings(clearRatings(project)).assets.length, 8);
});

test("riempi lo spread: usa le prossime foto non usate del capitolo, solo nelle pagine vuote", () => {
  let project = makeProject(24);
  project = createChapter(project, "Prima");
  project = createChapter(project, "Seconda");
  project = assignAssets(project, project.assets.slice(0, 12).map((a) => a.id), project.chapters[0].id);
  project = assignAssets(project, project.assets.slice(12).map((a) => a.id), project.chapters[1].id);
  project = addSpread(addSpread(project));
  const [first, second] = project.spreads;
  project = appendAssets(project, first.id, 0, ["a0", "a1"]);
  assert.deepEqual(nextUnusedAssets(project, 2).map((a) => a.id), ["a2", "a3"]);
  const filled = fillSpread(project, first.id, 3);
  assert.equal(filled.spreads[0].areas[0].items.length, 2, "la pagina già piena non cambia");
  assert.ok(filled.spreads[0].areas[1].items.length >= 1, "la pagina vuota si riempie");
  assert.ok(filled.spreads[0].areas[1].items.every((item) => Number(item.assetId.slice(1)) < 12), "dal capitolo dello spread");
  assertProjectInvariants(filled, "riempito");
  const second1 = fillSpread(filled, second.id, 3);
  assert.ok(second1.spreads[1].areas.every((area) => area.items.length > 0), "riempie entrambe le pagine di uno spread vuoto");
  assert.equal(duplicatedAssetIds(second1).length, 0, "non usa mai due volte la stessa foto");
  assert.equal(fillSpread(second1, first.id, 3), second1, "niente da riempire: nessun cambio");
  assert.equal(nextEmptySpread(project, 0), 1, "dopo lo spread 1 il prossimo con pagine vuote è il 2");
  assert.equal(nextEmptySpread(project, 1), 0, "si ricomincia dall'inizio");
  assert.equal(nextEmptySpread(second1, 0), -1, "nessuno spread con pagine vuote");
});

test("spread finiti: Mescola e Auto Build non li toccano e restano al loro posto", () => {
  let project = autoBuildAlbum(makeProject(30), { ...DEFAULT_AUTO_BUILD, photosPerArea: 3 });
  const keepId = project.spreads[1].id;
  project = setSpreadDone(project, keepId, true);
  const frozen = JSON.stringify(project.spreads[1]);
  assert.equal(shuffleSpread(project, keepId), project, "Mescola non cambia uno spread finito");
  assert.equal(applyCandidateByNumber(project, keepId, 0, 2), project);
  const rebuilt = autoBuildAlbum(project, { ...DEFAULT_AUTO_BUILD, photosPerArea: 2 });
  assert.equal(JSON.stringify(rebuilt.spreads[1]), frozen, "stesso spread, stessa posizione");
  assert.equal(duplicatedAssetIds(rebuilt).length, 0, "le sue foto non vengono rimesse altrove");
  assert.equal(unusedAssets(rebuilt).length, 0);
  assertProjectInvariants(rebuilt, "ricostruito con uno spread finito");
  assert.equal(setSpreadDone(setSpreadDone(project, keepId, false), keepId, false).spreads[1].done, false);
  assert.equal(parseAlbumProject(serializeAlbumProject(project)).spreads[1].done, true, "il segno si salva");
});
