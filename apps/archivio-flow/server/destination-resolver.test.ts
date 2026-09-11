import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import { resolveDestination } from "./destination-resolver.js";

test("DestinationResolver applica mapping e pattern senza uscire dall'archivio", () => {
  const root = path.resolve("D:/Archivio");
  const result = resolveDestination({
    archiveId:"main", archiveRoot:root, categoryKey:"wedding", eventDate:"2026-09-12", jobName:"Mario e Anna",
    mappings:[{ id:"wedding", categoryKey:"wedding", displayName:"Matrimonio", relativePathPattern:"MATRIMONI/{year}", jobFolderPattern:"{date} - {client}", enabled:true }],
  });
  assert.equal(result.relativeParentPath, path.join("MATRIMONI", "2026"));
  assert.equal(result.folderName, "2026-09-12 - Mario e Anna");
  assert.equal(result.usedOverride, false);
});

test("DestinationResolver tratta il percorso manuale come override esplicito", () => {
  const result = resolveDestination({ archiveId:"main", archiveRoot:"D:/Archivio", eventDate:"2026-01-02", jobName:"Test", mappings:[], overrideParent:"E:/Eccezione" });
  assert.equal(result.usedOverride, true);
  assert.equal(result.absoluteParentPath, path.resolve("E:/Eccezione"));
});

test("DestinationResolver riusa la cartella plurale già presente", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archivio-flow-"));
  fs.mkdirSync(path.join(root, "2026", "Matrimoni"), { recursive: true });
  const result = resolveDestination({
    archiveId:"main", archiveRoot:root, categoryKey:"matrimonio", eventDate:"2026-09-12", jobName:"Mario e Anna",
    mappings:[{ id:"matrimonio", categoryKey:"matrimonio", displayName:"Matrimonio", relativePathPattern:"{year}\\Matrimonio", jobFolderPattern:"{date} - {client}", enabled:true }],
  });
  assert.equal(result.absoluteParentPath, path.join(root, "2026", "Matrimoni"));
  fs.rmSync(root, { recursive:true, force:true });
});

test("DestinationResolver preferisce la categoria esistente con prefisso numerico", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archivio-flow-"));
  fs.mkdirSync(path.join(root, "2026", "01 - MATRIMONI"), { recursive: true });
  const result = resolveDestination({ archiveId:"main", archiveRoot:root, categoryKey:"wedding", eventDate:"2026-09-12", jobName:"Test", mappings:[{ id:"wedding", categoryKey:"wedding", displayName:"Matrimonio", relativePathPattern:"{year}\\Matrimoni", jobFolderPattern:"{date} - {client}", enabled:true }] });
  assert.equal(result.absoluteParentPath, path.join(root, "2026", "01 - MATRIMONI"));
  fs.rmSync(root, { recursive:true, force:true });
});

test("DestinationResolver ignora un vecchio override quando la categoria è selezionata", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archivio-flow-"));
  fs.mkdirSync(path.join(root, "2026", "Matrimoni"), { recursive: true });
  const result = resolveDestination({ archiveId:"main", archiveRoot:root, categoryKey:"wedding", eventDate:"2026-09-10", jobName:"Pasquale e Anita", overrideParent:path.join(root, "2025", "01 - MATRIMONI"), mappings:[{ id:"wedding", categoryKey:"wedding", displayName:"Matrimoni", relativePathPattern:"{year}\\Matrimoni", jobFolderPattern:"{date} - {client}", enabled:true }] });
  assert.equal(result.absoluteParentPath, path.join(root, "2026", "Matrimoni"));
  assert.equal(result.usedOverride, false);
  fs.rmSync(root, { recursive:true, force:true });
});

test("DestinationResolver non confonde due anni diversi durante il matching", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archivio-flow-"));
  fs.mkdirSync(path.join(root, "2025", "01 - MATRIMONI"), { recursive: true });
  fs.mkdirSync(path.join(root, "2026", "MATRIMONI"), { recursive: true });
  const result = resolveDestination({ archiveId:"main", archiveRoot:root, categoryKey:"wedding", eventDate:"2026-09-10", jobName:"Test", mappings:[{ id:"wedding", categoryKey:"wedding", displayName:"Matrimonio", relativePathPattern:"{year}\\Matrimoni", jobFolderPattern:"{date} - {client}", enabled:true }] });
  assert.equal(result.absoluteParentPath, path.join(root, "2026", "MATRIMONI"));
  fs.rmSync(root, { recursive:true, force:true });
});
