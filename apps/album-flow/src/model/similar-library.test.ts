import { test } from "node:test";
import assert from "node:assert/strict";
import { appendAssets } from "./items";
import { assetUsage, removeAssets } from "./library";
import { parseAlbumProject, serializeAlbumProject } from "./portability";
import { addSpread } from "./spreads";
import { mergeIncomingProject } from "./store";
import { assertProjectInvariants } from "./fixtures";
import { analyzeLibrary, isAlternative, momentHeaders, momentPicks, stackEntries, todoAssets } from "./similar";
import { clearSimilarityOverrides, detachPhoto, joinPhotos, normalizeOverrides, separatePhotos } from "./similarityOverrides";
import { decodeSignals, encodeSignals, missingFingerprints, signalKey, signalsFor, emptySignalStore } from "./signalsStore";
import { CAKE, CEREMONY, DANCE, look, shot, signals, weddingProject } from "./similarFixtures";
import type { Project } from "./project";

const ids = (assets: ReadonlyArray<{ id: string }>) => assets.map((asset) => asset.id);
const groupsOf = (project: Project) => analyzeLibrary(project).groups.map((group) => group.photoIds.join(","));

function placed(project: Project, assetIds: string[]): Project {
  const withSpread = addSpread(project);
  return appendAssets(withSpread, withSpread.spreads[withSpread.spreads.length - 1].id, 0, assetIds);
}

test("libreria: momenti dalle pause e raffiche dall'ora di scatto, con la consigliata in cima", () => {
  const analysis = analyzeLibrary(weddingProject());
  assert.deepEqual(analysis.moments.map((moment) => moment.photoIds), [CEREMONY, CAKE, DANCE]);
  assert.deepEqual(analysis.groups.map((group) => group.photoIds), [["b1", "b2", "b3"], ["t1", "t2"]]);
  assert.equal(analysis.groupOf.get("b3")?.ranked[0], "b2", "5 stelle: consigliata");
  assert.equal(analysis.groupOf.get("b3")?.reason, "5 stelle");
  assert.equal(analysis.groupOf.get("t2")?.ranked[0], "t1");
  assert.equal(analysis.momentOf.get("t2"), analysis.moments[1].id);
});

test("libreria: due corpi macchina diversi nello stesso secondo non fanno una raffica", () => {
  const project = weddingProject();
  const cameras = { b1: "Nikon Z6", b2: "Canon R5", b3: "Nikon Z6" };
  const analysis = analyzeLibrary(project, signals({}, cameras));
  assert.deepEqual(analysis.groups.map((group) => group.photoIds), [["b1", "b3"], ["t1", "t2"]]);
});

test("libreria: pile chiuse e aperte, la foto in cima è quella usata o la consigliata", () => {
  const project = weddingProject();
  const analysis = analyzeLibrary(project);
  const closed = stackEntries(project.assets, analysis, new Map(), new Set());
  assert.deepEqual(ids(closed.map((entry) => entry.asset)), ["c0", "c1", "b2", "c2", "c3", "k0", "k1", "t1", "k2", ...DANCE]);
  assert.deepEqual(closed[2].stack, { groupId: "g:b1", size: 3, position: 2, open: false });
  assert.equal(closed[0].stack, undefined, "le foto singole non hanno pila");

  const used = placed(project, ["b3"]);
  const withUsed = stackEntries(used.assets, analysis, assetUsage(used), new Set());
  assert.equal(withUsed[2].asset.id, "b3", "in cima va la foto già nell'album");

  const open = stackEntries(project.assets, analysis, new Map(), new Set(["g:b1"]));
  assert.deepEqual(ids(open.slice(2, 5).map((entry) => entry.asset)), ["b1", "b2", "b3"]);
  assert.deepEqual(open.slice(2, 5).map((entry) => entry.stack?.position), [1, 2, 3]);
  assert.ok(open.slice(2, 5).every((entry) => entry.stack?.open));

  // Con un filtro che lascia una sola foto del gruppo non c'è pila.
  const filtered = stackEntries(project.assets.filter((asset) => asset.id !== "b1" && asset.id !== "b3"), analysis, new Map(), new Set());
  assert.equal(filtered.find((entry) => entry.asset.id === "b2")?.stack, undefined);
});

test("libreria: da usare = una per gruppo e niente alternative di un gruppo già nell'album", () => {
  const project = weddingProject();
  const analysis = analyzeLibrary(project);
  assert.deepEqual(ids(todoAssets(project, analysis)), ["c0", "c1", "b2", "c2", "c3", "k0", "k1", "t1", "k2", ...DANCE]);
  const used = placed(project, ["b1", "k0"]);
  const usage = assetUsage(used);
  const todo = ids(todoAssets(used, analysis, usage));
  assert.ok(!todo.includes("b1") && !todo.includes("b2") && !todo.includes("b3"), "il gruppo della raffica è già nell'album");
  assert.ok(!todo.includes("k0"));
  assert.ok(isAlternative(analysis, usage, "b2") && isAlternative(analysis, usage, "b3"));
  assert.ok(!isAlternative(analysis, usage, "b1"), "la foto usata non è un'alternativa");
  assert.ok(!isAlternative(analysis, usage, "c0"), "una foto senza gruppo non è un'alternativa");
});

test("libreria: intestazioni dei momenti e clic che seleziona le consigliate", () => {
  const project = placed(weddingProject(), ["c0"]);
  const analysis = analyzeLibrary(project);
  const usage = assetUsage(project);
  const entries = stackEntries(project.assets, analysis, usage, new Set());
  const todo = new Set(ids(todoAssets(project, analysis, usage)));
  const headers = momentHeaders(entries, analysis, todo);
  assert.deepEqual(headers.map((header) => header.at), [0, 5, 9]);
  assert.deepEqual(headers.map((header) => header.photos), [7, 5, 6]);
  assert.deepEqual(headers.map((header) => header.todo), [4, 4, 6], "cerimonia: c1, b2, c2, c3 (c0 è già usata, una per raffica)");
  assert.deepEqual(momentPicks(project, analysis, usage, analysis.moments[0].id), ["c1", "b2", "c2", "c3"]);
  assert.deepEqual(momentPicks(project, analysis, usage, analysis.moments[1].id), ["k0", "k1", "t1", "k2"]);
  assert.deepEqual(momentPicks(project, analysis, usage, "m:inesistente"), []);
});

test("correzioni: separa, togli dal gruppo, unisci, ripristina", () => {
  const project = weddingProject();
  const separated = separatePhotos(project, ["b1", "b2", "b3"]);
  assert.deepEqual(groupsOf(separated), ["t1,t2"]);
  assert.equal(separated.similarity?.apart.length, 3);

  const detached = detachPhoto(project, "b1", ["b1", "b2", "b3"]);
  assert.deepEqual(groupsOf(detached), ["b2,b3", "t1,t2"]);

  const joined = joinPhotos(project, ["c0", "d5"]);
  assert.deepEqual(groupsOf(joined), ["c0,d5", "b1,b2,b3", "t1,t2"]);
  assert.equal(analyzeLibrary(joined).groupOf.get("d5")?.kind, "manual");

  const rejoined = joinPhotos(separated, ["b1", "b2"]);
  assert.deepEqual(groupsOf(rejoined), ["b1,b2", "t1,t2"], "unire annulla il «non simili» tra le due, non con la terza");

  const reset = clearSimilarityOverrides(rejoined);
  assert.equal(reset.similarity, undefined);
  assert.deepEqual(groupsOf(reset), groupsOf(project));
  assert.equal(clearSimilarityOverrides(project), project, "niente da ripristinare: stesso progetto");
  assert.equal(separatePhotos(project, ["b1"]), project);
  assert.equal(joinPhotos(project, ["c0"]), project);
  for (const variant of [separated, detached, joined, rejoined, reset]) assertProjectInvariants(variant, "correzioni");
});

test("correzioni: normalizzazione (doppioni, foto mancanti, gruppi che si toccano)", () => {
  const all = new Set(["a", "b", "c", "d", "e"]);
  assert.deepEqual(normalizeOverrides({ apart: [["b", "a"], ["a", "b"], ["a", "a"], ["a", "zz"]], together: [["a", "b"], ["b", "c"], ["d"], ["e", "zz"]] }, all), { apart: [["a", "b"]], together: [["a", "b", "c"]] });
  assert.equal(normalizeOverrides({ apart: [["a", "zz"]], together: [["zz", "yy"]] }, all), undefined);
  assert.equal(normalizeOverrides(undefined, all), undefined);
});

test("correzioni: viaggiano nel file dell'album, i file rovinati sono rifiutati, i vecchi album si aprono", () => {
  const project = joinPhotos(separatePhotos(weddingProject(), ["b1", "b2", "b3"]), ["c0", "d5"]);
  const reopened = parseAlbumProject(serializeAlbumProject(project));
  assert.deepEqual(reopened.similarity, project.similarity);
  assert.deepEqual(groupsOf(reopened), groupsOf(project));

  const raw = JSON.parse(serializeAlbumProject(project));
  const broken = (similarity: unknown) => JSON.stringify({ ...raw, project: { ...raw.project, similarity } });
  assert.throws(() => parseAlbumProject(broken({ apart: [["b1", "nessuna"]], together: [] })), /foto che non esiste/);
  assert.throws(() => parseAlbumProject(broken({ apart: [["b1"]], together: [] })), /coppia/);
  assert.throws(() => parseAlbumProject(broken({ apart: [], together: [["c0"]] })), /non è valido/);
  assert.throws(() => parseAlbumProject(broken({ apart: [], together: [["c0", "c0"]] })), /non è valido/);
  assert.throws(() => parseAlbumProject(broken("sì")));

  const legacy = weddingProject();
  assert.equal(parseAlbumProject(serializeAlbumProject(legacy)).similarity, undefined, "un album senza correzioni resta senza");
});

test("correzioni: togliere foto dall'album o un nuovo invio dal Selector puliscono i riferimenti", () => {
  const project = joinPhotos(separatePhotos(weddingProject(), ["b1", "b2", "b3"]), ["c0", "d5"]);
  const removed = removeAssets(project, ["b2", "d5"]);
  assertProjectInvariants(removed, "dopo la rimozione");
  assert.deepEqual(removed.similarity, { apart: [["b1", "b3"]], together: [] });
  const empty = removeAssets(removed, ["b1"]);
  assert.equal(empty.similarity, undefined, "senza correzioni valide il campo sparisce");

  const fromSelector = (assets: Project["assets"]) => ({ ...weddingProject(), assets: assets.map((asset, index) => ({ ...asset, selectionOrder: index })) });
  const previous = fromSelector(project.assets.map((asset) => ({ ...asset })));
  const withOverrides = { ...previous, similarity: project.similarity };
  const incoming = fromSelector(previous.assets.filter((asset) => asset.id !== "d5"));
  const merged = mergeIncomingProject(withOverrides, incoming);
  assertProjectInvariants(merged, "dopo il reinvio");
  assert.ok(!merged.similarity?.together.some((group) => group.includes("d5")));
});

test("archivio locale delle impronte: chiave del file, dati rovinati scartati, foto da leggere", () => {
  const assets = [shot("x1", 0), shot("x2", 1)];
  const store = emptySignalStore();
  store.fingerprints.set("x1", { key: signalKey(assets[0]), value: look({ hash: "00000000000000ff" }) });
  store.fingerprints.set("x2", { key: "vecchio", value: look() });
  store.cameras.set("x1", "Nikon Z6");
  const decoded = decodeSignals(encodeSignals(store));
  assert.equal(decoded.fingerprints.get("x1")?.value.hash, "00000000000000ff");
  assert.equal(decoded.cameras.get("x1"), "Nikon Z6");
  const current = signalsFor(decoded, assets);
  assert.ok(current.fingerprints.has("x1"));
  assert.ok(!current.fingerprints.has("x2"), "l'impronta di un file cambiato non vale");
  assert.deepEqual(ids(missingFingerprints(decoded, assets)), ["x2"]);
  assert.notEqual(signalKey(assets[0]), signalKey({ ...assets[0], width: 4000, height: 6000 }), "misure diverse, chiave diversa");

  for (const raw of [null, "", "{", "[]", JSON.stringify({ v: 2 }), JSON.stringify({ v: 1, f: "no" })]) assert.equal(decodeSignals(raw).fingerprints.size, 0);
  const mixed = JSON.parse(encodeSignals(store));
  mixed.f.bad = { k: "x", h: "zz", l: [1, 2, 3], c: 1, s: 1, hi: 0, lo: 0 };
  mixed.f.nan = { k: "x", h: "0000000000000000", l: [1, "a", 3], c: 1, s: 1, hi: 0, lo: 0 };
  mixed.cam.empty = "  ";
  const tolerant = decodeSignals(JSON.stringify(mixed));
  assert.deepEqual([...tolerant.fingerprints.keys()].sort(), ["x1", "x2"], "le voci rovinate si scartano, le altre restano");
  assert.ok(!tolerant.cameras.has("empty"));
});
