import { test } from "node:test";
import assert from "node:assert/strict";
import type { AlbumProject } from "@photo-tools/shared-types";
import { addChapter, setChapterMembership } from "./chapters";

// Only chapter operations consume this fixture; unrelated settings are opaque.
function fixture() {
  return { projectId: "selector1", selectorRevision: "rev1", assets: [{ id: "a", rating: 5, labelIds: ["l"] }, { id: "b" }],
    chapters: [{ id: "selector", title: "Cerimonia", source: "selector-label", labelIds: ["l"], orderedAssetIds: ["b", "a"] }] } as AlbumProject;
}
test("creazione manuale persistibile conserva dati Selector e progetto originale", () => {
  const original = fixture();
  const next = addChapter(original, "  Ricevimento  ", "manual1");
  assert.equal(next.chapters[1].title, "Ricevimento");
  assert.equal(next.chapters[1].source, "manual");
  assert.equal(original.chapters.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(next)).chapters, next.chapters);
  assert.equal(next.assets, original.assets);
  assert.equal(next.selectorRevision, original.selectorRevision);
});
test("rifiuta nome vuoto e identità duplicata", () => {
  assert.throws(() => addChapter(fixture(), "  ", "new"));
  assert.throws(() => addChapter(fixture(), "Nuovo", "selector"));
});
test("assegnazioni multiple, rimozione e ripetizione preservano ordine e metadati", () => {
  const original = fixture();
  let next = addChapter(original, "Altro", "new");
  next = setChapterMembership(next, "new", "a", true);
  next = setChapterMembership(next, "new", "b", true);
  next = setChapterMembership(next, "new", "a", true);
  assert.deepEqual(next.chapters[1].orderedAssetIds, ["a", "b"]);
  assert.deepEqual(next.chapters[0], original.chapters[0]);
  next = setChapterMembership(next, "new", "a", false);
  assert.deepEqual(next.chapters[1].orderedAssetIds, ["b"]);
  assert.equal(next.assets, original.assets);
});
test("rifiuta riferimenti inesistenti", () => {
  assert.throws(() => setChapterMembership(fixture(), "missing", "a", true));
  assert.throws(() => setChapterMembership(fixture(), "selector", "missing", true));
});
