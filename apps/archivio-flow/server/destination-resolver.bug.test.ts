import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveDestination, type CategoryMapping } from "./destination-resolver.js";

function mapping(relativePathPattern: string, jobFolderPattern = "{client}"): CategoryMapping {
  return {
    id: "hostile",
    categoryKey: "hostile",
    displayName: "Hostile",
    relativePathPattern,
    jobFolderPattern,
    enabled: true,
  };
}

test("bug hunt: mapping ostili non possono uscire dalla radice archivio", () => {
  const archiveRoot = path.resolve("D:/Archivio-Test");
  for (const hostilePattern of ["../../fuori", "..\\..\\fuori", "C:\\Windows\\Temp", "/tmp/fuori"]) {
    const result = resolveDestination({
      archiveId: "main",
      archiveRoot,
      mappings: [mapping(hostilePattern)],
      categoryKey: "hostile",
      eventDate: "2026-08-20",
      jobName: "Test",
    });
    const relative = path.relative(archiveRoot, result.absoluteJobPath);
    assert.equal(relative.startsWith("..") || path.isAbsolute(relative), false, hostilePattern);
  }
});

test("bug hunt: nomi riservati Windows e controlli bidi vengono neutralizzati", () => {
  const archiveRoot = path.resolve("D:/Archivio-Test");
  for (const hostileName of ["CON", "nul.txt", "COM1", "LPT9", "\u202Ecod.exe"]) {
    const result = resolveDestination({
      archiveId: "main",
      archiveRoot,
      mappings: [mapping("{year}")],
      categoryKey: "hostile",
      eventDate: "2026-08-20",
      jobName: hostileName,
    });
    assert.doesNotMatch(result.folderName, /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu);
    assert.doesNotMatch(result.folderName, /[\u202a-\u202e\u2066-\u2069]/u);
  }
});
