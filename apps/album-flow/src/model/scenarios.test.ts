import { test } from "node:test";
import assert from "node:assert/strict";
import type { AlbumAssetTag, AlbumSortKey, AlbumSplitMode, AreaStyle } from "@photo-tools/shared-types";
import type { DropTarget } from "../engine/drop";
import { mulberry32 } from "../engine/rng";
import { applyFavoriteLayout, applyCandidateByNumber, applyStyleToAlbum, applyStyleToSpread, favoritesFor, mirrorArea, resetDividerRatio, saveFavoriteLayout, setAreaStyle, setDividerRatio, setLinked, shuffleArea, shuffleSpread } from "./areas";
import { DEFAULT_AUTO_BUILD, autoBuildAlbum, fillSpread } from "./autobuild";
import { applyTemplate, matchTemplates, reorderFrame, sanitizeTemplate, setFrame } from "./templates";
import { applyChapterPreset, assignAssets, BUILTIN_CHAPTER_PRESETS, createChapter, moveChapter, removeChapter } from "./chapters";
import { assertProjectInvariants, makeProject } from "./fixtures";
import { applyImport, dedupeRawJpgPairs, planImport, type ImportCandidate } from "./import";
import { alignArea, appendAssets, dropOnSpread, moveToNewSpread, moveToSpread, removeItem, replaceItemAsset, resetItemView, setItemView, swapItems, toggleItemLock } from "./items";
import { assetUsage, duplicatedAssetIds, removeAssets, reorderAssets, setRating, setSortKey, sortAssets, toggleAssetTag, unusedAssets } from "./library";
import { parseAlbumProject, serializeAlbumProject } from "./portability";
import { preflightReport } from "./preflight";
import { areaGeometry, createEmptyProject, type Project } from "./project";
import { addSpread, clearSpread, duplicateSpread, moveSpread, removeSpread, setSpreadDone, setSplitMode, swapAreas } from "./spreads";
import { suggestStoryForSpread } from "./story";

/**
 * Casi d'uso dell'intero modello di Album Flow, dalla cartella di foto all'album pronto da esportare.
 * Sono scritti come storie di un fotografo: ognuna mescola importazione, capitoli, Auto Build e ritocchi a mano,
 * e dopo ogni passo verifica gli invarianti (nessuna foto deformata, celle che non si sovrappongono, salvataggio fedele).
 */

const MODES: AlbumSplitMode[] = ["full", "half", "third", "two-thirds"];
const SHOT_SHAPES: ReadonlyArray<readonly [number, number, number]> = [
  // [larghezza, altezza, peso]: proporzioni tipiche di un reportage di nozze
  [6000, 4000, 38], [7008, 4672, 14], [7728, 5152, 8],
  [4000, 6000, 20], [3072, 4608, 8],
  [6000, 6000, 4], [4800, 3600, 3], [3600, 4800, 2], [9000, 3000, 2], [3200, 3200, 1],
];

function shapeFor(random: () => number): readonly [number, number] {
  const total = SHOT_SHAPES.reduce((sum, shape) => sum + shape[2], 0);
  let pick = random() * total;
  for (const shape of SHOT_SHAPES) { pick -= shape[2]; if (pick < 0) return [shape[0], shape[1]]; }
  return [SHOT_SHAPES[0][0], SHOT_SHAPES[0][1]];
}

/** Foto di una cartella di reportage: raffiche ravvicinate, pause tra le scene, formati misti. */
function shoot(prefix: string, count: number, seed: number, startMs: number): ImportCandidate[] {
  const random = mulberry32(seed);
  const out: ImportCandidate[] = [];
  let time = startMs;
  for (let i = 0; i < count; i += 1) {
    time += random() < 0.12 ? (5 + random() * 35) * 60_000 : (3 + random() * 17) * 1000;
    const [width, height] = shapeFor(random);
    const name = `${prefix}${String(i + 1).padStart(4, "0")}.jpg`;
    out.push({ fileName: name, absolutePath: `/Volumes/Foto/${prefix}/${name}`, size: 6_000_000 + Math.floor(random() * 9_000_000), width, height, captureTimeMs: Math.round(time), lastModified: Math.round(time) });
  }
  return out;
}

const shuffled = <T,>(list: readonly T[], seed: number): T[] => {
  const random = mulberry32(seed);
  return list.map((item) => [random(), item] as const).sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
};

function importInto(project: Project, title: string, candidates: ImportCandidate[], duplicates: "skip" | "add" = "skip"): { project: Project; added: string[]; skipped: number } {
  let next = project;
  let chapter = next.chapters.find((candidate) => candidate.title === title);
  if (!chapter) { next = createChapter(next, title); chapter = next.chapters[next.chapters.length - 1]; }
  const result = applyImport(next, planImport(next, candidates), { chapterId: chapter.id, duplicates });
  return { project: result.project, added: result.addedAssetIds, skipped: result.skipped };
}

const itemsOf = (project: Project) => project.spreads.flatMap((spread, spreadIndex) => spread.areas.flatMap((area, areaIndex) => area.items.map((item) => ({ spread, spreadIndex, area, areaIndex, item }))));

// ------------------------------------------------------------------ Storia 1: il matrimonio completo

test("storia: matrimonio completo, dalle cartelle all'album pronto per la stampa", () => {
  let project = createEmptyProject("Luigi e Carolina");
  assertProjectInvariants(project, "vuoto");

  // 1) Tre gruppi di foto arrivano in disordine; coppie RAW+JPG e ripetizioni vengono ripulite.
  const sposo = shoot("DSC", 40, 11, Date.UTC(2026, 5, 5, 8, 0));
  const sposa = shoot("IMG", 40, 12, Date.UTC(2026, 5, 5, 9, 30));
  const chiesa = shoot("CHI", 60, 13, Date.UTC(2026, 5, 5, 11, 0));
  const raw = sposo.slice(0, 6).map((candidate) => ({ ...candidate, fileName: candidate.fileName.replace(".jpg", ".CR3"), absolutePath: candidate.absolutePath!.replace(".jpg", ".CR3") }));
  const paired = dedupeRawJpgPairs([...shuffled(sposo, 1), ...raw]);
  assert.equal(paired.ignored, 6, "sei RAW con il JPG gemello non si importano");
  assert.equal(paired.kept.length, 40);

  let result = importInto(project, "Casa sposo", paired.kept);
  project = result.project;
  result = importInto(project, "Casa sposa", shuffled(sposa, 2));
  project = result.project;
  result = importInto(project, "Chiesa", shuffled(chiesa, 3));
  project = result.project;
  assert.equal(project.assets.length, 140);
  assert.deepEqual(project.chapters.map((chapter) => chapter.assetIds.length), [40, 40, 60]);
  assertProjectInvariants(project, "importato");

  // 2) Gli ordini: per ora di scatto di default, poi per nome, poi di nuovo per ora.
  const byTime = sortAssets(project.assets, "capture-time");
  for (let i = 1; i < byTime.length; i += 1) assert.ok((byTime[i - 1].captureTimeMs ?? 0) <= (byTime[i].captureTimeMs ?? 0), "ordine per ora di scatto");
  const byName = sortAssets(project.assets, "file-name");
  assert.equal(byName[0].fileName.startsWith("CHI"), true, "in ordine alfabetico CHI viene prima di DSC e IMG");

  // 3) Stelle: il fotografo valuta; le foto già nell'album restano invariate dopo un secondo import con duplicati.
  project = setRating(project, byTime[0].id, 5);
  project = setRating(project, byTime[1].id, 3);
  const again = importInto(project, "Casa sposo", shuffled(sposo.slice(0, 10), 7));
  assert.equal(again.added.length, 0, "tutte già presenti");
  assert.equal(again.skipped, 10);
  assert.equal(again.project.assets.length, 140);
  const forced = importInto(project, "Casa sposo", sposo.slice(0, 2), "add");
  assert.equal(forced.added.length, 2, "con «aggiungile comunque» i duplicati diventano foto nuove");
  assert.equal(forced.project.assets.length, 142);
  assert.equal(setRating(project, "inesistente", 4), project, "valutare una foto inesistente non cambia nulla");

  // 4) Auto Build rispettando i capitoli: ogni foto una volta sola, capitoli separati.
  assert.equal(unusedAssets(project).length, 140);
  project = autoBuildAlbum(project, { ...DEFAULT_AUTO_BUILD, photosPerArea: 3 });
  assertProjectInvariants(project, "auto build");
  assert.equal(unusedAssets(project).length, 0);
  for (const [id, uses] of assetUsage(project)) assert.equal(uses.length, 1, `${id} usata una volta`);
  const chapterOfSpread = project.spreads.map((spread) => {
    const chapters = new Set(spread.areas.flatMap((area) => area.items.map((item) => project.chapters.find((chapter) => chapter.assetIds.includes(item.assetId))?.title)));
    return chapters;
  });
  chapterOfSpread.forEach((set, index) => assert.equal(set.size, 1, `spread ${index + 1} mescola capitoli`));
  const sequence = chapterOfSpread.map((set) => [...set][0]);
  const compact = sequence.filter((title, index) => index === 0 || sequence[index - 1] !== title);
  assert.deepEqual(compact, ["Casa sposo", "Casa sposa", "Chiesa"], "capitoli in ordine, ciascuno in un blocco unico");
  const report = preflightReport(project);
  assert.equal(report.issues.filter((issue) => issue.level === "error").length, 0, "nessun errore bloccante");

  // 5) Ritocchi a mano su alcuni spread.
  const first = project.spreads[0];
  project = setSplitMode(project, first.id, "third");
  assertProjectInvariants(project, "un terzo");
  project = setAreaStyle(project, first.id, 0, { gapCm: 0.8, paddingCm: 1, borderCm: 0.15, borderColor: "#ffffff" });
  project = setLinked(project, first.id, true);
  project = setAreaStyle(project, first.id, 1, { gapCm: 0.3 });
  const linked = project.spreads[0].areas;
  assert.equal(linked[0].style.gapCm, 0.3, "stile collegato: la modifica a destra arriva a sinistra");
  assert.equal(linked[0].style.borderCm, linked[1].style.borderCm);
  project = shuffleSpread(project, first.id);
  project = mirrorArea(project, first.id, 1, "horizontal");
  assertProjectInvariants(project, "ritocchi");

  // 6) Layout preferito: si salva da uno spread e si riapplica a un altro con lo stesso numero di foto.
  const donor = project.spreads.find((spread) => spread.areas[0].items.length === 3 && spread.id !== first.id);
  const receiver = project.spreads.filter((spread) => spread.id !== donor?.id).find((spread) => spread.areas.some((area) => area.items.length === 3));
  if (donor && receiver) {
    project = saveFavoriteLayout(project, donor.id, 0, "Tre in riga");
    const receiverIndex = receiver.areas.findIndex((area) => area.items.length === 3);
    const fav = favoritesFor(project, project.spreads.find((spread) => spread.id === receiver.id)!.areas[receiverIndex]);
    assert.equal(fav.length, 1);
    project = applyFavoriteLayout(project, receiver.id, receiverIndex, fav[0].id);
    assertProjectInvariants(project, "preferito");
  }

  // 7) Stile dell'album intero dallo spread corrente, poi una pagina bianca e nera.
  project = applyStyleToAlbum(project, project.spreads[2].id, 0);
  const gaps = new Set(project.spreads.flatMap((spread) => spread.areas.map((area) => area.style.gapCm)));
  assert.equal(gaps.size, 1, "lo stesso spazio ovunque dopo «applica a tutto l'album»");
  project = setAreaStyle(project, project.spreads[3].id, 0, { mono: true });
  assert.equal(project.spreads[3].areas[0].style.mono, true);

  // 8) Il cliente toglie cinque foto dall'album: gli spread si richiudono, i capitoli si aggiornano.
  const doomed = byTime.slice(10, 15).map((asset) => asset.id);
  const before = project.assets.length;
  project = removeAssets(project, doomed);
  assert.equal(project.assets.length, before - 5);
  for (const id of doomed) assert.ok(!project.chapters.some((chapter) => chapter.assetIds.includes(id)));
  assertProjectInvariants(project, "foto tolte");

  // 9) Si riempie un nuovo spread a mano con foto già usate: compaiono come duplicate nei controlli.
  project = addSpread(project, project.spreads.length);
  const lastSpread = project.spreads[project.spreads.length - 1];
  const reused = project.assets.slice(0, 3).map((asset) => asset.id);
  project = dropOnSpread(project, lastSpread.id, { areaIndex: 0, itemId: null, zone: "area" }, { kind: "assets", assetIds: reused });
  assert.equal(duplicatedAssetIds(project).length >= 3, true);
  assert.ok(preflightReport(project).issues.some((issue) => /più di una volta/i.test(issue.message)), "il controllo segnala le foto ripetute");
  assertProjectInvariants(project, "foto ripetute");

  // 10) Salvataggio e riapertura identici, anche dopo aver cambiato l'ordine delle schede.
  project = setSortKey(project, "manual");
  const visible = sortAssets(project.assets, "manual").map((asset) => asset.id);
  project = reorderAssets(project, visible, [visible[5]], visible[0]);
  assert.equal(sortAssets(project.assets, "manual")[0].id, visible[5]);
  const reopened = parseAlbumProject(serializeAlbumProject(project));
  assert.deepEqual(reopened, JSON.parse(JSON.stringify(project)));
  assertProjectInvariants(reopened, "riaperto");
});

// ------------------------------------------------------------------ Storia 2: foto «difficili»

test("storia: panorami, quadrati, foto minuscole e ruotate non rompono nessuna impaginazione", () => {
  const odd: ImportCandidate[] = [
    { fileName: "PANO_01.jpg", absolutePath: "/f/PANO_01.jpg", width: 12000, height: 3000, captureTimeMs: 1000 },
    { fileName: "PANO_02.jpg", absolutePath: "/f/PANO_02.jpg", width: 16000, height: 3200, captureTimeMs: 2000 },
    { fileName: "SQ_01.jpg", absolutePath: "/f/SQ_01.jpg", width: 4000, height: 4000, captureTimeMs: 3000 },
    { fileName: "TINY_01.jpg", absolutePath: "/f/TINY_01.jpg", width: 640, height: 480, captureTimeMs: 4000 },
    { fileName: "TALL_01.jpg", absolutePath: "/f/TALL_01.jpg", width: 2000, height: 8000, captureTimeMs: 5000 },
    { fileName: "MISSING_01.jpg", absolutePath: "/f/MISSING_01.jpg", captureTimeMs: 6000 },
    ...shoot("N", 18, 5, 10_000),
  ];
  let project = importInto(createEmptyProject("Difficili"), "Prova", odd).project;
  assertProjectInvariants(project, "importato");
  for (const splitMode of ["mixed", "half", "full"] as const) {
    for (const fitMode of ["fill", "fit"] as const) {
      const built = autoBuildAlbum(project, { ...DEFAULT_AUTO_BUILD, splitMode, fitMode, photosPerArea: splitMode === "full" ? 4 : 2 });
      assertProjectInvariants(built, `${splitMode}/${fitMode}`);
      assert.equal(unusedAssets(built).length, 0, `${splitMode}/${fitMode}: tutte le foto sono state usate`);
    }
  }
  project = autoBuildAlbum(project, DEFAULT_AUTO_BUILD);
  const issues = preflightReport(project).issues;
  assert.ok(issues.some((issue) => /risoluzione|dpi/i.test(issue.message)), "la foto da 640 px viene segnalata come a bassa risoluzione");
  // Ruotare di un quarto di giro scambia le proporzioni e l'album resta valido.
  const tall = project.assets.find((asset) => asset.fileName === "TALL_01.jpg")!;
  project = { ...project, assets: project.assets.map((asset) => (asset.id === tall.id ? { ...asset, rotationDegrees: 90 } : asset)) };
  assertProjectInvariants(project, "ruotata");
});

// ------------------------------------------------------------------ Storia 3: album grande

test("storia: un reportage da 320 foto si impagina in pochi secondi e si riordina senza perdere nulla", () => {
  const candidates = [...shoot("A", 120, 21, Date.UTC(2026, 5, 5, 8)), ...shoot("B", 120, 22, Date.UTC(2026, 5, 5, 12)), ...shoot("C", 80, 23, Date.UTC(2026, 5, 5, 18))];
  let project = createEmptyProject("Grande");
  project = importInto(project, "Mattina", candidates.slice(0, 120)).project;
  project = importInto(project, "Pomeriggio", candidates.slice(120, 240)).project;
  project = importInto(project, "Sera", candidates.slice(240)).project;
  const started = Date.now();
  project = autoBuildAlbum(project, { ...DEFAULT_AUTO_BUILD, photosPerArea: 3 });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 8000, `Auto Build di 320 foto in ${elapsed} ms`);
  assert.equal(unusedAssets(project).length, 0);
  assertProjectInvariants(project, "grande");

  const count = project.spreads.length;
  assert.ok(count >= 35 && count <= 90, `numero di spread plausibile: ${count}`);
  const ids = project.spreads.map((spread) => spread.id);
  project = moveSpread(project, 0, count - 1);
  assert.equal(project.spreads[count - 1].id, ids[0]);
  project = duplicateSpread(project, project.spreads[3].id);
  assert.equal(project.spreads.length, count + 1);
  project = removeSpread(project, project.spreads[4].id);
  assert.equal(project.spreads.length, count);
  assertProjectInvariants(project, "riordinato");
  assert.equal(new Set(project.spreads.map((spread) => spread.id)).size, project.spreads.length);

  // Aggiungere altre foto e costruire solo quelle: l'album esistente non cambia.
  const extra = importInto(project, "Extra", shoot("X", 12, 31, Date.UTC(2026, 5, 6)));
  const before = JSON.stringify(extra.project.spreads);
  const grown = autoBuildAlbum(extra.project, { ...DEFAULT_AUTO_BUILD, scope: "unused" });
  assert.equal(grown.spreads.length > extra.project.spreads.length, true);
  assert.equal(JSON.stringify(grown.spreads.slice(0, extra.project.spreads.length)), before, "gli spread esistenti non vengono toccati");
  assertProjectInvariants(grown, "con le aggiunte");
});

// ------------------------------------------------------------------ Storia 4: capitoli

test("storia: capitoli rimaneggiati dopo l'impaginazione non perdono foto né spread", () => {
  let project = createEmptyProject("Capitoli");
  project = applyChapterPreset(project, BUILTIN_CHAPTER_PRESETS[0]);
  assert.ok(project.chapters.length >= 3);
  const photos = shoot("P", 54, 41, Date.UTC(2026, 5, 5, 8));
  const base = applyImport(project, planImport(project, photos), { chapterId: null, duplicates: "skip" });
  project = base.project;
  // Le foto si distribuiscono a blocchi sui capitoli, come farebbe l'utente trascinandole sulle schede.
  const ids = sortAssets(project.assets, "capture-time").map((asset) => asset.id);
  const per = Math.ceil(ids.length / project.chapters.length);
  project.chapters.forEach((chapter, index) => { project = assignAssets(project, ids.slice(index * per, (index + 1) * per), chapter.id); });
  project = autoBuildAlbum(project, DEFAULT_AUTO_BUILD);
  assertProjectInvariants(project, "costruito");
  const spreadsBefore = project.spreads.length;

  project = moveChapter(project, project.chapters[0].id, 1);
  assertProjectInvariants(project, "capitolo spostato");
  const removed = project.chapters[1];
  project = removeChapter(project, removed.id);
  assert.equal(project.spreads.length, spreadsBefore, "togliere un capitolo non tocca l'impaginazione");
  assert.equal(unusedAssets(project).length, 0);
  assert.ok(project.assets.some((asset) => removed.assetIds.includes(asset.id)), "le foto del capitolo tolto restano nell'album");
  assertProjectInvariants(project, "capitolo tolto");
  // Ricostruire ora mette le foto senza capitolo in fondo.
  const rebuilt = autoBuildAlbum(project, DEFAULT_AUTO_BUILD);
  assert.equal(unusedAssets(rebuilt).length, 0);
  assertProjectInvariants(rebuilt, "ricostruito");
});

// ------------------------------------------------------------------ Storia 5: cambio di formato

test("storia: cambiare il formato del foglio mantiene valide tutte le impaginazioni", () => {
  let project = makeProject(30);
  project = autoBuildAlbum(project, DEFAULT_AUTO_BUILD);
  for (const [widthCm, heightCm] of [[20, 20], [30, 20], [20, 30], [40, 30], [25, 35]] as const) {
    project = { ...project, settings: { ...project.settings, sheet: { ...project.settings.sheet, widthCm, heightCm } } };
    assertProjectInvariants(project, `${widthCm}x${heightCm}`);
    const spread = project.spreads[0];
    const geometry = areaGeometry(project, spread, 0);
    assert.ok(geometry.cells.every((cell) => cell.rect.w > 0 && cell.rect.h > 0));
    // Lo Shuffle usa le proporzioni del nuovo formato.
    assertProjectInvariants(shuffleSpread(project, spread.id), `${widthCm}x${heightCm} shuffle`);
  }
});

// ------------------------------------------------------------------ Fuzz delle operazioni

interface Operation { name: string; run: (project: Project, random: () => number) => Project }
const pick = <T,>(random: () => number, list: readonly T[]): T => list[Math.floor(random() * list.length)];
const maybe = <T,>(random: () => number, list: readonly T[]): T | undefined => (list.length ? pick(random, list) : undefined);

const FUZZ_TEMPLATES = [
  sanitizeTemplate({ id: "f1", name: "Tre in riga", kind: "tree", target: "page", shape: { kind: "split", dir: "row", ratio: 0.33, first: { kind: "leaf", itemId: "0" }, second: { kind: "split", dir: "row", ratio: 0.5, first: { kind: "leaf", itemId: "1" }, second: { kind: "leaf", itemId: "2" } } }, createdAt: "x" })!,
  sanitizeTemplate({ id: "f2", name: "Due appoggiate", kind: "free", target: "page", frames: [{ x: 0.02, y: 0.02, w: 0.96, h: 0.96, rotation: 0, z: 0 }, { x: 0.5, y: 0.5, w: 0.4, h: 0.4, rotation: 7, z: 2 }], createdAt: "x" })!,
  sanitizeTemplate({ id: "f3", name: "Tre libere", kind: "free", target: "page", frames: [{ x: 0.05, y: 0.05, w: 0.5, h: 0.5, rotation: -5, z: 0 }, { x: 0.35, y: 0.3, w: 0.4, h: 0.5, rotation: 4, z: 1 }, { x: 0.55, y: 0.55, w: 0.4, h: 0.4, rotation: 0, z: 2 }], createdAt: "x" })!,
  sanitizeTemplate({ id: "f4", name: "Quattro in griglia", kind: "tree", target: "page", shape: { kind: "split", dir: "column", ratio: 0.5, first: { kind: "split", dir: "row", ratio: 0.5, first: { kind: "leaf", itemId: "0" }, second: { kind: "leaf", itemId: "1" } }, second: { kind: "split", dir: "row", ratio: 0.5, first: { kind: "leaf", itemId: "2" }, second: { kind: "leaf", itemId: "3" } } }, createdAt: "x" })!,
];

const OPERATIONS: Operation[] = [
  { name: "applica un template", run: (p, r) => { const spread = maybe(r, p.spreads); if (!spread) return p; const areaIndex = Math.floor(r() * spread.areas.length); const match = pick(r, [undefined, ...matchTemplates(p, spread, areaIndex, FUZZ_TEMPLATES)]); return match ? applyTemplate(p, spread.id, areaIndex, match.template, match.order) : p; } },
  { name: "sposta una cornice", run: (p, r) => { const entry = maybe(r, itemsOf(p)); return entry ? setFrame(p, entry.item.id, { x: r(), y: r(), w: 0.1 + r() * 0.8, h: 0.1 + r() * 0.8, rotation: (r() - 0.5) * 90 }) : p; } },
  { name: "cornice davanti o dietro", run: (p, r) => { const entry = maybe(r, itemsOf(p)); return entry ? reorderFrame(p, entry.item.id, r() < 0.5 ? "front" : "back") : p; } },
  { name: "riempi spread", run: (p, r) => { const spread = maybe(r, p.spreads); return spread ? fillSpread(p, spread.id, 1 + Math.floor(r() * 4)) : p; } },
  { name: "segna finito", run: (p, r) => { const spread = maybe(r, p.spreads); return spread ? setSpreadDone(p, spread.id, r() < 0.5) : p; } },
  { name: "foto in uno spread nuovo", run: (p, r) => { const entry = maybe(r, itemsOf(p)); return entry && p.spreads.length < 60 ? moveToNewSpread(p, Math.floor(r() * (p.spreads.length + 1)), { kind: "item", itemId: entry.item.id }).project : p; } },
  { name: "foto su un altro spread", run: (p, r) => { const entry = maybe(r, itemsOf(p)); const spread = maybe(r, p.spreads); return entry && spread ? moveToSpread(p, spread.id, { kind: "item", itemId: entry.item.id }) : p; } },
  { name: "aggiungi spread", run: (p, r) => addSpread(p, Math.floor(r() * (p.spreads.length + 1)), pick(r, MODES)) },
  { name: "elimina spread", run: (p, r) => (p.spreads.length > 1 ? removeSpread(p, pick(r, p.spreads).id) : p) },
  { name: "sposta spread", run: (p, r) => (p.spreads.length > 1 ? moveSpread(p, Math.floor(r() * p.spreads.length), Math.floor(r() * p.spreads.length)) : p) },
  { name: "duplica spread", run: (p, r) => (p.spreads.length > 0 && p.spreads.length < 60 ? duplicateSpread(p, pick(r, p.spreads).id) : p) },
  { name: "svuota spread", run: (p, r) => (p.spreads.length ? clearSpread(p, pick(r, p.spreads).id) : p) },
  { name: "scambia pagine", run: (p, r) => (p.spreads.length ? swapAreas(p, pick(r, p.spreads).id) : p) },
  { name: "divisione", run: (p, r) => (p.spreads.length ? setSplitMode(p, pick(r, p.spreads).id, pick(r, MODES)) : p) },
  {
    name: "testo narrativo",
    run: (p, r) => {
      const spread = maybe(r, p.spreads);
      if (!spread) return p;
      const first = suggestStoryForSpread(p, spread.id, Math.floor(r() * spread.areas.length), { attempt: Math.floor(r() * 4) });
      // «Rigenera»: sostituisce la proposta appena fatta con un'altra, senza lasciare elementi orfani.
      const again = first && r() < 0.5 ? suggestStoryForSpread(first.project, spread.id, Math.floor(r() * spread.areas.length), { attempt: 1, replace: first.overlayIds }) : null;
      return again?.project ?? first?.project ?? p;
    },
  },
  {
    name: "aggiungi foto",
    run: (p, r) => {
      const spread = maybe(r, p.spreads);
      if (!spread || p.assets.length === 0) return p;
      const ids = Array.from({ length: 1 + Math.floor(r() * 3) }, () => pick(r, p.assets).id);
      return appendAssets(p, spread.id, Math.floor(r() * spread.areas.length), [...new Set(ids)]);
    },
  },
  {
    name: "rilascia dalla libreria",
    run: (p, r) => {
      const spread = maybe(r, p.spreads);
      if (!spread || p.assets.length === 0) return p;
      const areaIndex = Math.floor(r() * spread.areas.length);
      const area = spread.areas[areaIndex];
      const target: DropTarget = area.items.length === 0 ? { areaIndex, itemId: null, zone: "area" } : { areaIndex, itemId: pick(r, area.items).id, zone: pick(r, ["center", "left", "right", "top", "bottom"] as const) };
      return dropOnSpread(p, spread.id, target, { kind: "assets", assetIds: [pick(r, p.assets).id] });
    },
  },
  {
    name: "rilascia una foto dello spread",
    run: (p, r) => {
      const spread = maybe(r, p.spreads);
      if (!spread) return p;
      const sources = spread.areas.flatMap((area) => area.items);
      const source = maybe(r, sources);
      if (!source) return p;
      const areaIndex = Math.floor(r() * spread.areas.length);
      const area = spread.areas[areaIndex];
      const target: DropTarget = area.items.length === 0 ? { areaIndex, itemId: null, zone: "area" } : { areaIndex, itemId: pick(r, area.items).id, zone: pick(r, ["center", "left", "right", "top", "bottom"] as const) };
      return dropOnSpread(p, spread.id, target, { kind: "item", itemId: source.id });
    },
  },
  { name: "togli foto", run: (p, r) => { const entry = maybe(r, itemsOf(p)); return entry ? removeItem(p, entry.item.id) : p; } },
  {
    name: "scambia due foto",
    run: (p, r) => {
      const spread = maybe(r, p.spreads.filter((candidate) => candidate.areas.flatMap((area) => area.items).length >= 2));
      if (!spread) return p;
      const items = spread.areas.flatMap((area) => area.items);
      const a = pick(r, items);
      const b = pick(r, items.filter((item) => item.id !== a.id));
      return swapItems(p, a.id, b.id);
    },
  },
  { name: "inquadratura", run: (p, r) => { const entry = maybe(r, itemsOf(p)); return entry ? setItemView(p, entry.item.id, { zoom: 1 + r() * 4, cx: r(), cy: r() }) : p; } },
  { name: "forma della foto", run: (p, r) => { const entry = maybe(r, itemsOf(p)); return entry ? setItemView(p, entry.item.id, { shape: r() < 0.3 ? null : 0.2 + r() * 4.8 }) : p; } },
  { name: "raddrizzamento", run: (p, r) => { const entry = maybe(r, itemsOf(p)); return entry ? setItemView(p, entry.item.id, { angle: (r() - 0.5) * 100 }) : p; } },
  { name: "reimposta inquadratura", run: (p, r) => { const entry = maybe(r, itemsOf(p)); return entry ? resetItemView(p, entry.item.id) : p; } },
  { name: "blocca foto", run: (p, r) => { const entry = maybe(r, itemsOf(p)); return entry ? toggleItemLock(p, entry.item.id) : p; } },
  { name: "sostituisci foto", run: (p, r) => { const entry = maybe(r, itemsOf(p)); return entry && p.assets.length ? replaceItemAsset(p, entry.item.id, pick(r, p.assets).id) : p; } },
  { name: "mescola area", run: (p, r) => { const spread = maybe(r, p.spreads); return spread ? shuffleArea(p, spread.id, Math.floor(r() * spread.areas.length), r() < 0.5 ? 1 : -1) : p; } },
  { name: "mescola spread", run: (p, r) => { const spread = maybe(r, p.spreads); return spread ? shuffleSpread(p, spread.id, r() < 0.5 ? 1 : -1) : p; } },
  { name: "layout n.", run: (p, r) => { const spread = maybe(r, p.spreads); return spread ? applyCandidateByNumber(p, spread.id, Math.floor(r() * spread.areas.length), 1 + Math.floor(r() * 9)) : p; } },
  {
    name: "stile",
    run: (p, r) => {
      const spread = maybe(r, p.spreads);
      if (!spread) return p;
      const changes: Partial<AreaStyle> = { gapCm: Number((r() * 2).toFixed(2)), paddingCm: Number((r() * 3).toFixed(2)), borderCm: Number((r() * 0.5).toFixed(2)), mode: r() < 0.5 ? "fill" : "fit", mono: r() < 0.2 };
      return setAreaStyle(p, spread.id, Math.floor(r() * spread.areas.length), changes);
    },
  },
  { name: "stile collegato", run: (p, r) => { const spread = maybe(r, p.spreads); return spread ? setLinked(p, spread.id, r() < 0.5) : p; } },
  { name: "stile sullo spread", run: (p, r) => { const spread = maybe(r, p.spreads); return spread ? applyStyleToSpread(p, spread.id, Math.floor(r() * spread.areas.length)) : p; } },
  { name: "stile sull'album", run: (p, r) => { const spread = maybe(r, p.spreads); return spread && r() < 0.3 ? applyStyleToAlbum(p, spread.id, Math.floor(r() * spread.areas.length)) : p; } },
  {
    name: "sposta separatore",
    run: (p, r) => {
      const spread = maybe(r, p.spreads);
      if (!spread) return p;
      const areaIndex = Math.floor(r() * spread.areas.length);
      const divider = maybe(r, areaGeometry(p, spread, areaIndex).dividers);
      return divider ? setDividerRatio(p, spread.id, areaIndex, divider.path, 0.05 + r() * 0.9) : p;
    },
  },
  {
    name: "reimposta separatore",
    run: (p, r) => {
      const spread = maybe(r, p.spreads);
      if (!spread) return p;
      const areaIndex = Math.floor(r() * spread.areas.length);
      const divider = maybe(r, areaGeometry(p, spread, areaIndex).dividers);
      return divider ? resetDividerRatio(p, spread.id, areaIndex, divider.path) : p;
    },
  },
  { name: "specchia", run: (p, r) => { const spread = maybe(r, p.spreads); return spread ? mirrorArea(p, spread.id, Math.floor(r() * spread.areas.length), r() < 0.5 ? "horizontal" : "vertical") : p; } },
  { name: "allinea", run: (p, r) => { const spread = maybe(r, p.spreads); return spread ? alignArea(p, spread.id, Math.floor(r() * spread.areas.length), pick(r, ["start", "center", "end"] as const)) : p; } },
  {
    name: "layout preferito",
    run: (p, r) => {
      const spread = maybe(r, p.spreads.filter((candidate) => candidate.areas.some((area) => area.items.length > 0)));
      if (!spread) return p;
      const areaIndex = spread.areas.findIndex((area) => area.items.length > 0);
      const saved = saveFavoriteLayout(p, spread.id, areaIndex);
      const target = maybe(r, saved.spreads);
      if (!target) return saved;
      const targetArea = Math.floor(r() * target.areas.length);
      const options = favoritesFor(saved, target.areas[targetArea]);
      return options.length ? applyFavoriteLayout(saved, target.id, targetArea, pick(r, options).id) : saved;
    },
  },
  { name: "stelle", run: (p, r) => { const asset = maybe(r, p.assets); return asset ? setRating(p, asset.id, Math.floor(r() * 6)) : p; } },
  { name: "tag", run: (p, r) => { const asset = maybe(r, p.assets); return asset ? toggleAssetTag(p, asset.id, pick(r, ["cover", "panorama", "main"] as AlbumAssetTag[])) : p; } },
  { name: "ordine libreria", run: (p, r) => setSortKey(p, pick(r, ["capture-time", "file-name", "selector-order", "manual"] as AlbumSortKey[])) },
  {
    name: "riordina libreria",
    run: (p, r) => {
      const visible = sortAssets(p.assets, p.settings.sortKey).map((asset) => asset.id);
      if (visible.length < 3) return p;
      return reorderAssets(p, visible, [pick(r, visible)], r() < 0.2 ? null : pick(r, visible));
    },
  },
  { name: "capitolo nuovo", run: (p, r) => (p.chapters.length < 8 ? createChapter(p, `Capitolo ${Math.floor(r() * 1000)}`) : p) },
  { name: "assegna a capitolo", run: (p, r) => { const chapter = maybe(r, p.chapters); const asset = maybe(r, p.assets); return asset ? assignAssets(p, [asset.id], chapter && r() < 0.8 ? chapter.id : null) : p; } },
  { name: "sposta capitolo", run: (p, r) => { const chapter = maybe(r, p.chapters); return chapter ? moveChapter(p, chapter.id, r() < 0.5 ? -1 : 1) : p; } },
  { name: "elimina capitolo", run: (p, r) => { const chapter = maybe(r, p.chapters); return chapter && r() < 0.4 ? removeChapter(p, chapter.id) : p; } },
  { name: "togli foto dall'album", run: (p, r) => (p.assets.length > 12 ? removeAssets(p, [pick(r, p.assets).id]) : p) },
  { name: "auto build sulle non usate", run: (p) => (unusedAssets(p).length ? autoBuildAlbum(p, { ...DEFAULT_AUTO_BUILD, scope: "unused" }) : p) },
  { name: "auto build completo", run: (p, r) => (r() < 0.15 ? autoBuildAlbum(p, { ...DEFAULT_AUTO_BUILD, photosPerArea: 2 + Math.floor(r() * 4), splitMode: pick(r, ["half", "full", "mixed"] as const), varyLayouts: r() < 0.5 }) : p) },
];

function fuzz(seed: number, steps: number) {
  const random = mulberry32(seed);
  let project = makeProject(26);
  project = autoBuildAlbum(project, { ...DEFAULT_AUTO_BUILD, photosPerArea: 2 });
  let rejected = 0;
  let imported = 0;
  const used = new Map<string, number>();
  const changed = new Map<string, number>();
  for (let step = 0; step < steps; step += 1) {
    if (step % 45 === 44) {
      const more = importInto(project, "Altre", shoot(`F${seed}_${step}_`, 8, seed + step, Date.UTC(2026, 5, 6) + step * 3_600_000));
      project = more.project;
      imported += more.added.length;
    }
    const operation = pick(random, OPERATIONS);
    let next: Project;
    try { next = operation.run(project, random); } catch (error) {
      rejected += 1;
      assert.ok(error instanceof Error && !(error instanceof TypeError) && !(error instanceof RangeError) && !(error instanceof ReferenceError), `${operation.name}: errore interno ${String(error)}`);
      next = project;
    }
    used.set(operation.name, (used.get(operation.name) ?? 0) + 1);
    if (next !== project) changed.set(operation.name, (changed.get(operation.name) ?? 0) + 1);
    assertProjectInvariants(next, `seed ${seed} passo ${step + 1} (${operation.name})`);
    project = next;
  }
  return { project, rejected, imported, used, changed };
}

for (const seed of [101, 202, 303]) {
  test(`fuzz: 200 operazioni casuali (seme ${seed}) mantengono ogni invariante`, () => {
    const { project, rejected, used } = fuzz(seed, 200);
    assert.ok(rejected <= 40, `troppe operazioni rifiutate: ${rejected}`);
    assert.ok(used.size >= 35, `il fuzz ha provato solo ${used.size} operazioni diverse`);
    // Dopo tutto il rumore l'album resta ricostruibile da zero e utilizzabile.
    const rebuilt = autoBuildAlbum(project, { ...DEFAULT_AUTO_BUILD, scope: "all" });
    assertProjectInvariants(rebuilt, "ricostruito");
    assert.equal(unusedAssets(rebuilt).length, 0);
  });
}

test("fuzz: stessi semi, stesso risultato (il motore è deterministico)", () => {
  const shape = (node: Project["spreads"][number]["areas"][number]["layout"]): unknown => (node === null ? null : node.kind === "leaf" ? "L" : [node.dir, node.ratio, shape(node.first), shape(node.second)]);
  const strip = (project: Project) => {
    const name = new Map(project.assets.map((asset) => [asset.id, asset.fileName]));
    return JSON.stringify({
      assets: project.assets.map((asset) => asset.fileName),
      chapters: project.chapters.map((chapter) => [chapter.title, chapter.assetIds.map((id) => name.get(id))]),
      spreads: project.spreads.map((spread) => ({ split: spread.split, linked: spread.linked, areas: spread.areas.map((area) => ({ items: area.items.map((item) => [name.get(item.assetId), item.zoom, item.cx, item.cy, item.locked]), layout: shape(area.layout), style: area.style })) })),
    });
  };
  assert.equal(strip(fuzz(77, 60).project), strip(fuzz(77, 60).project));
});

test("fuzz: le operazioni cambiano davvero l'album (il fuzz non gira a vuoto)", () => {
  const { project, used, changed } = fuzz(404, 400);
  const total = [...used.values()].reduce((sum, value) => sum + value, 0);
  const effective = [...changed.values()].reduce((sum, value) => sum + value, 0);
  assert.ok(effective / total > 0.5, `solo ${effective} operazioni su ${total} hanno cambiato l'album`);
  assert.ok(changed.size >= 28, `hanno cambiato l'album solo ${changed.size} tipi di operazione`);
  assert.ok(project.spreads.length > 0 && itemsOf(project).length > 0, "alla fine l'album non è vuoto");
});

test("spostare una foto da uno spread all'altro non la duplica mai", () => {
  const random = mulberry32(909);
  let project = autoBuildAlbum(makeProject(30), { ...DEFAULT_AUTO_BUILD, photosPerArea: 2 });
  for (let step = 0; step < 150; step += 1) {
    const entry = pick(random, itemsOf(project));
    const before = itemsOf(project).map((e) => e.item.assetId).sort();
    const next = random() < 0.5
      ? moveToNewSpread(project, Math.floor(random() * (project.spreads.length + 1)), { kind: "item", itemId: entry.item.id }).project
      : moveToSpread(project, pick(random, project.spreads).id, { kind: "item", itemId: entry.item.id });
    assert.deepEqual(itemsOf(next).map((e) => e.item.assetId).sort(), before, `passo ${step + 1}: le foto devono restare le stesse`);
    assert.ok(next.spreads.length <= 400);
    project = next;
  }
  assertProjectInvariants(project, "dopo 150 spostamenti");
  assert.equal(duplicatedAssetIds(project).length, 0);
});
