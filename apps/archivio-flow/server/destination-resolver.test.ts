import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
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
