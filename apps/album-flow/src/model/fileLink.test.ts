import { test } from "node:test";
import assert from "node:assert/strict";
import type { AlbumProjectV2 } from "@photo-tools/shared-types";
import {
  FILE_LINKS_KEY, albumFingerprint, closeSaveTargets, decideOpen, decideSave, fileStatus, loadFileLinks, removeFileLink, setFileLink, stampOf, type FileLink,
} from "./fileLink";
import { makeProject } from "./fixtures";
import { parseAlbumProject, serializeAlbumProject } from "./portability";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data };
}

const album = (id: string): AlbumProjectV2 => ({ ...makeProject(3), projectId: id, projectName: id });
const roundTrip = (project: AlbumProjectV2) => parseAlbumProject(serializeAlbumProject(project));

test("collegamenti: si salvano, si rileggono, i valori rovinati si ignorano", () => {
  const storage = memoryStorage();
  const link: FileLink = { path: "E:\\Album\\a.filex-album.json", stamp: "10:1", savedHash: "h" };
  setFileLink("a", link, storage);
  assert.deepEqual(loadFileLinks(storage), { a: link });
  removeFileLink("a", storage);
  assert.deepEqual(loadFileLinks(storage), {});
  const broken = memoryStorage({ [FILE_LINKS_KEY]: JSON.stringify({ a: { path: 1 }, b: link, c: null }) });
  assert.deepEqual(loadFileLinks(broken), { b: link });
  assert.deepEqual(loadFileLinks(memoryStorage({ [FILE_LINKS_KEY]: "{non json" })), {});
  assert.deepEqual(loadFileLinks(null), {});
  assert.doesNotThrow(() => setFileLink("a", link, { getItem: () => null, setItem: () => { throw new Error("pieno"); } }));
});

test("fingerprint stabile dopo serialize → parse", () => {
  const loaded = roundTrip(album("a"));
  assert.equal(albumFingerprint(loaded), albumFingerprint(roundTrip(loaded)));
  assert.notEqual(albumFingerprint(loaded), albumFingerprint({ ...loaded, projectName: "Altro nome" }));
});

test("stampOf usa dimensione e data di modifica", () => {
  assert.equal(stampOf({ size: 120, lastModified: 1700000000000 }), "120:1700000000000");
});

test("fileStatus: salvato, non salvato, cambiato altrove, conflitto, non raggiungibile", () => {
  const link: FileLink = { path: "E:\\a.json", stamp: "1:1", savedHash: "h1" };
  assert.equal(fileStatus(link, "1:1", "h1"), "saved");
  assert.equal(fileStatus(link, "1:1", "h2"), "unsaved");
  assert.equal(fileStatus(link, "2:2", "h1"), "changed-elsewhere");
  assert.equal(fileStatus(link, "2:2", "h2"), "conflict");
  assert.equal(fileStatus(link, null, "h1"), "unreachable");
});

test("decideSave con stamp cambiato chiede conferma", () => {
  const link: FileLink = { path: "E:\\a.json", stamp: "1:1", savedHash: "h1" };
  assert.equal(decideSave(link, "1:1"), "write");
  assert.equal(decideSave(link, "2:2"), "ask-overwrite");
  assert.equal(decideSave(link, null), "unreachable");
});

test("decideOpen: album nuovo, invariato, cambiato senza o con modifiche locali, mai collegato", () => {
  const link: FileLink = { path: "E:\\a.json", stamp: "1:1", savedHash: "h1" };
  assert.equal(decideOpen(null, undefined, "1:1", "h1"), "load");
  assert.equal(decideOpen({ fingerprint: "h1" }, link, "1:1", "h1"), "keep");
  assert.equal(decideOpen({ fingerprint: "h1" }, link, "2:2", "h3"), "ask-load");
  assert.equal(decideOpen({ fingerprint: "h2" }, link, "2:2", "h3"), "ask-load-losing");
  assert.equal(decideOpen({ fingerprint: "h5" }, undefined, "2:2", "h3"), "ask-load-losing");
  assert.equal(decideOpen({ fingerprint: "h3" }, undefined, "2:2", "h3"), "load");
});

test("decideOpen: aprendo apposta il file invariato, se l'album di questo PC è diverso si chiede", () => {
  const link: FileLink = { path: "E:\\a.json", stamp: "1:1", savedHash: "h1" };
  assert.equal(decideOpen({ fingerprint: "h2" }, link, "1:1", "h1"), "ask-load-losing", "«Apri progetto…» sul file: le modifiche locali non si tengono in silenzio");
  assert.equal(decideOpen({ fingerprint: "h1" }, link, "1:1", "h1"), "keep");
  assert.equal(decideOpen({ fingerprint: "h2" }, link, "1:1"), "keep", "dalla Home (file non letto) si apre l'album di questo PC");
});

test("closeSaveTargets esclude i file cambiati e i non raggiungibili", () => {
  const a = album("a"); const b = album("b"); const c = album("c"); const d = album("d");
  const links: Record<string, FileLink> = {
    a: { path: "E:\\a.json", stamp: "1:1", savedHash: "vecchia" },
    b: { path: "E:\\b.json", stamp: "1:1", savedHash: "vecchia" },
    c: { path: "E:\\c.json", stamp: "1:1", savedHash: "vecchia" },
  };
  const targets = closeSaveTargets([a, b, c, d], links, { a: "1:1", b: "9:9", c: null, d: "1:1" });
  assert.deepEqual(targets.map((project) => project.projectId), ["a"]);
  const saved = { ...links, a: { ...links.a, savedHash: albumFingerprint(a) } };
  assert.deepEqual(closeSaveTargets([a], saved, { a: "1:1" }), [], "un album già salvato non si riscrive");
});
