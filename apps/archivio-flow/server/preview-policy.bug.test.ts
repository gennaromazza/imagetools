import assert from "node:assert/strict";
import test from "node:test";
import type { PreviewMediaFile } from "../src/previewPolicy.js";
import { buildPreviewSourceKey, filterMediaForDate, isPreviewableMedia, localIsoDate } from "../src/previewPolicy.js";
import { findSimilarFolderNames } from "../src/folderSuggestions.js";

function sample(fileName: string, date: string, mediaType: PreviewMediaFile["mediaType"], isJpg: boolean): PreviewMediaFile {
  return {
    filePath: `I:\\DCIM\\${fileName}`,
    fileName,
    mtimeMs: new Date(`${date}T12:00:00`).getTime(),
    size: fileName.length * 1_000,
    ext: `.${fileName.split(".").pop()!.toLowerCase()}`,
    isJpg,
    mediaType,
  };
}

test("bug hunt: cambiando data vengono selezionati soltanto i file del giorno richiesto", () => {
  const firstRaw = sample("DSCF1000.RAF", "2026-08-24", "photo", false);
  const secondRaw = sample("DSCF2000.RAF", "2026-08-25", "photo", false);
  const secondVideo = sample("DSCF2001.MOV", "2026-08-25", "video", false);
  const files = [firstRaw, secondRaw, secondVideo];

  assert.deepEqual(filterMediaForDate(files, localIsoDate(firstRaw.mtimeMs)), [firstRaw]);
  assert.deepEqual(filterMediaForDate(files, localIsoDate(secondRaw.mtimeMs)), [secondRaw, secondVideo]);
});

test("bug hunt: RAW e video sono eleggibili per l'anteprima e la cache cambia col file", () => {
  const raw = sample("DSCF1000.RAF", "2026-08-25", "photo", false);
  const video = sample("DSCF1001.MOV", "2026-08-25", "video", false);
  const other = sample("NOTE.TXT", "2026-08-25", "other", false);

  assert.equal(isPreviewableMedia(raw), true);
  assert.equal(isPreviewableMedia(video), true);
  assert.equal(isPreviewableMedia(other), false);
  assert.notEqual(buildPreviewSourceKey(raw), buildPreviewSourceKey({ ...raw, size: raw.size + 1 }));
  assert.notEqual(buildPreviewSourceKey(raw), buildPreviewSourceKey({ ...raw, mtimeMs: raw.mtimeMs + 1_000 }));
});

test("bug hunt: suggerisce cartelle esistenti con nomi uguali o molto simili", () => {
  const existing = ["Cerimonia", "Promesse", "Ricevimento\\Drone"];
  assert.deepEqual(findSimilarFolderNames("cerimonia", existing), ["Cerimonia"]);
  assert.deepEqual(findSimilarFolderNames("Promessa", existing), ["Promesse"]);
  assert.deepEqual(findSimilarFolderNames("drone", existing), ["Ricevimento\\Drone"]);
  assert.deepEqual(findSimilarFolderNames("Preparativi", existing), []);
});
