import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureOutputSubfolder } from "./output-subfolder.js";

test("crea e riusa la sottocartella, senza uscire dalla cartella scelta", async () => {
  const root = await mkdtemp(join(tmpdir(), "filex-subfolder-"));
  try {
    const first = await ensureOutputSubfolder(root, "10x15_bordo5mm");
    assert.equal(first, join(root, "10x15_bordo5mm"));
    assert.equal((await stat(first)).isDirectory(), true);
    assert.equal(await ensureOutputSubfolder(root, "10x15_bordo5mm"), first);
    for (const name of ["", ".", "..", "a/b", "a\\b", "C:x", "finale.", ".filex-stage-1"]) {
      await assert.rejects(ensureOutputSubfolder(root, name), /non valido/, name);
    }
    await writeFile(join(root, "occupato"), "x");
    await assert.rejects(ensureOutputSubfolder(root, "occupato"), /Esiste già/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
