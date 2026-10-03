import { test } from "node:test";
import assert from "node:assert/strict";
import { ALBUM_FLOW_MAX_BACKUP_BYTES, albumBackupFileName, albumFolderName, checkAlbumBackupContent, parseAlbumBackupName } from "./album-flow-drive-names.js";

test("nomi dei backup: cartella pulita, data nel nome e lettura di ritorno", () => {
  assert.equal(albumFolderName("Gianluca e Michela"), "Gianluca e Michela");
  assert.equal(albumFolderName('  Rossi/Bianchi: "Matrimonio"? '), "Rossi-Bianchi- -Matrimonio");
  assert.equal(albumFolderName("..."), "Album senza nome");
  assert.equal(albumFolderName("x".repeat(300)).length, 80);
  assert.ok(!/[\\/:*?"<>|]/.test(albumFolderName("a\\b/c:d*e?f\"g<h>i|j")));

  const when = "2026-10-03T09:15:42.123Z";
  const name = albumBackupFileName("Gianluca e Michela", when, 59, 630);
  assert.equal(name, "2026-10-03T09-15-42-123Z__Gianluca e Michela__59s-630f.json");
  assert.deepEqual(parseAlbumBackupName(name), { createdAt: when, projectName: "Gianluca e Michela", spreads: 59, photos: 630 });
  assert.equal(parseAlbumBackupName("2026-10-03T09-15-42-123Z__a__b__1s-2f.json")?.projectName, "a__b", "il nome può contenere doppio trattino basso");
  assert.equal(parseAlbumBackupName("manifest.json"), null);
  assert.equal(parseAlbumBackupName("2026-99-99T99-99-99-999Z__x__1s-1f.json")?.createdAt, null, "data impossibile: ignorata, non inventata");
  assert.equal(albumBackupFileName("x", when, -4, Number.NaN), "2026-10-03T09-15-42-123Z__x__0s-0f.json");
  // L'ordine dei nomi è anche l'ordine cronologico.
  const older = albumBackupFileName("x", "2026-01-01T00:00:00.000Z", 1, 1);
  assert.ok(older < albumBackupFileName("x", "2026-01-02T00:00:00.000Z", 1, 1));
});

test("backup: si carica solo un progetto di Album Flow, non altro", () => {
  const good = JSON.stringify({ format: "filex-album-project", version: 2, project: { projectId: "a" } });
  assert.equal(checkAlbumBackupContent(good).ok, true);
  assert.equal(checkAlbumBackupContent("").ok, false);
  assert.equal(checkAlbumBackupContent(undefined).ok, false);
  assert.equal(checkAlbumBackupContent("{non json").ok, false);
  assert.equal(checkAlbumBackupContent(JSON.stringify({ format: "altro", version: 2, project: {} })).ok, false);
  assert.equal(checkAlbumBackupContent(JSON.stringify({ format: "filex-album-project", version: "2", project: {} })).ok, false);
  assert.equal(checkAlbumBackupContent(JSON.stringify({ format: "filex-album-project", version: 2 })).ok, false);
  assert.equal(checkAlbumBackupContent(JSON.stringify({ app: "image-select-pro", assets: [] })).ok, false, "un manifest del Selector non è un album");
  assert.ok(ALBUM_FLOW_MAX_BACKUP_BYTES >= 100 * 1024 * 1024);
});
