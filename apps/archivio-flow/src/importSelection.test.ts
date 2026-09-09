import assert from "node:assert/strict";
import test from "node:test";
import { selectImportRange, suggestImportJobs } from "./importSelection.js";
import { buildSdRows, groupSdFiles, virtualSdWindow } from "./sdBrowserModel.js";
import { buildPreviewSourceKey } from "./previewPolicy.js";
import type { Job, StudioFlowStatus } from "./types.js";
import type { PreviewMediaFile } from "./previewPolicy.js";

test("Shift seleziona esattamente gli elementi in entrambe le direzioni, anche con timestamp uguali", () => {
  const paths = ["first.jpg", "same-time-a.jpg", "same-time-b.jpg", "last.jpg"];
  assert.deepEqual([...selectImportRange(new Set([paths[0]!]), paths, paths[0]!, paths[2]!, true)], paths.slice(0, 3));
  assert.deepEqual([...selectImportRange(new Set(), paths, paths[3]!, paths[1]!, true)], paths.slice(1));
  assert.deepEqual([...selectImportRange(new Set(), paths, null, paths[1]!, false)], [paths[1]]);
  assert.deepEqual([...selectImportRange(new Set([paths[1]!]), paths, paths[1]!, paths[1]!, false)], []);
});

test("Shift segue l’ordine corrente e non attraversa un’ancora rimossa dal filtro", () => {
  const selected = new Set(["a"]);
  assert.deepEqual([...selectImportRange(selected, ["d", "c", "b", "a"], "d", "b", true)], ["a", "d", "c", "b"]);
  assert.deepEqual([...selectImportRange(selected, ["c", "d"], "a", "d", true)], ["a", "d"]);
  const pageOne = ["a", "b"];
  const nextPage = [...pageOne, "c", "d"];
  assert.deepEqual([...selectImportRange(selected, nextPage, "a", "d", true)], nextPage);
});

function photo(iso: string): PreviewMediaFile {
  return { filePath: iso, fileName: "test.jpg", mtimeMs: Date.parse(iso), size: 1, ext: ".jpg", isJpg: true, mediaType: "photo" };
}

test("cache anteprime: distingue schede con stessi file e conserva le frazioni di millisecondo", () => {
  const file = { ...photo("2026-09-06T21:00:00"), mtimeMs: 1788721200000.125 };
  assert.notEqual(buildPreviewSourceKey(file, "serial-A"), buildPreviewSourceKey(file, "serial-B"));
  assert.notEqual(buildPreviewSourceKey(file, "serial-A"), buildPreviewSourceKey({ ...file, mtimeMs: file.mtimeMs + .5 }, "serial-A"));
});

test("SD grande: righe limitate, selezione oltre viewport e gruppi modificabili oltre mezzanotte", () => {
  const files = Array.from({ length: 20_000 }, (_, i) => ({ ...photo("2026-09-06T21:00:00"), filePath: `photo-${i}.jpg`, mtimeMs: Date.parse("2026-09-06T21:00:00") + i * 1000 }));
  const rows = buildSdRows(files, 4);
  for (const position of [0, 100_000, 700_000]) {
    const window = virtualSdWindow(rows, position, 560);
    assert.ok(window.end - window.start < 15, "DOM resta limitato anche lontano dall’inizio");
    assert.ok(window.before >= 0 && window.after >= 0);
  }
  const ordered = rows.flatMap(row => row.files.map(file => file.filePath));
  assert.equal(selectImportRange(new Set(), ordered, ordered[0]!, ordered[8000]!, true).size, 8001);
  assert.equal(new Set(ordered).size, files.length);
  const events = [photo("2026-09-06T23:30:00"), photo("2026-09-07T01:00:00"), photo("2026-09-07T10:00:00")];
  assert.deepEqual(groupSdFiles(events, 6, new Set(), new Set()).map(group => group.files.length), [2,1]);
  assert.equal(groupSdFiles(events, 6, new Set(), new Set([events[2]!.filePath])).length, 1);
  assert.equal(groupSdFiles(events, 6, new Set([events[1]!.filePath]), new Set()).length, 3);
});
function job(id: string, date: string): Job {
  return { id, nomeLavoro: id, dataLavoro: date, autore: "Tester", percorsoCartella: `D:/Archive/${id}`, nomeCartella: id, dataCreazione: "2026-09-07", numeroFile: 2, folderExists: true };
}
function session(jobId: string, from: string, to: string): StudioFlowStatus["sessions"][number] {
  return { id: jobId, jobId, sourceRoot: "I:/", destinationRoot: `D:/Archive/${jobId}`, status: "COMPLETED", startedAt: Date.parse("2026-09-07T12:00:00"), updatedAt: 1, completedAt: Date.parse("2026-09-07T13:00:00"), verifiedAt: 1, plannedFiles: 2, verifiedFiles: 2, failedFiles: 0, errorMessage: null, mediaStartMs: Date.parse(from), mediaEndMs: Date.parse(to) };
}

test("suggerimenti: matrimonio oltre mezzanotte e altro evento nello stesso giorno restano distinti", () => {
  const jobs = [job("Matrimonio", "2026-09-06"), job("Comunioni", "2026-09-07")];
  const sessions = [session("Matrimonio", "2026-09-06T20:00", "2026-09-07T03:00"), session("Comunioni", "2026-09-07T09:00", "2026-09-07T12:00")];
  const night = suggestImportJobs(jobs, sessions, [photo("2026-09-07T01:30")]);
  assert.equal(night[0]?.job.id, "Matrimonio");
  assert.match(night[0]!.reason, /orari.*sovrappongono/);
  assert.equal(suggestImportJobs(jobs, sessions, [photo("2026-09-07T10:00")])[0]?.job.id, "Comunioni");
  assert.equal(suggestImportJobs(jobs, sessions, [photo("2026-09-07T18:00")]).length, 2);
  assert.equal(suggestImportJobs(jobs.map((j) => ({ ...j, folderExists: false })), sessions, [photo("2026-09-07T01:30")]).length, 0);
  assert.equal(suggestImportJobs(jobs, sessions, []).length, 0);
});

test("Maiusc oltre mezzanotte esclude gli altri eventi: griglia globalmente cronologica", () => {
  const earlier = photo("2026-09-06T10:00");
  const wedding = photo("2026-09-06T21:00");
  const night = photo("2026-09-07T01:00");
  const later = photo("2026-09-07T10:00");
  const ordered = buildSdRows([earlier, wedding, night, later], 4).flatMap(row => row.files.map(file => file.filePath));
  assert.deepEqual(ordered, [later.filePath, night.filePath, wedding.filePath, earlier.filePath]);
  assert.deepEqual([...selectImportRange(new Set(), ordered, wedding.filePath, night.filePath, true)], [night.filePath, wedding.filePath]);
});

test("un lavoro della stessa giornata precede una vecchia importazione senza sovrapposizione", () => {
  const selected = [photo("2026-09-07T10:00")];
  const result = suggestImportJobs([job("Vecchio", "2025-01-01"), job("Oggi", "2026-09-07")], [session("Vecchio", "2025-01-01T10:00", "2025-01-01T11:00")], selected);
  assert.equal(result[0]?.job.id, "Oggi");
  assert.match(result[0]!.reason, /data del lavoro coincide/);
});
