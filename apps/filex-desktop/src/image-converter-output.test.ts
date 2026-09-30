import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ImageConverterInputEntry } from "@photo-tools/desktop-contracts";
import { claimOutputPath, dropJpegsPairedWithRaw, isValidOutputDirectory } from "./image-converter-output.js";

const entry = (absolutePath: string, sourceKind: "raw" | "bitmap"): ImageConverterInputEntry => ({
  sourceRoot: "D:/Foto", absolutePath, relativePath: absolutePath, size: 1, sourceKind,
});

test("output: conversioni parallele con lo stesso nome non si sovrascrivono", async () => {
  const dir = await mkdtemp(join(tmpdir(), "filex-ic-out-"));
  try {
    const claims = new Set<string>();
    const target = join(dir, "IMG_0001.jpg");
    const results = await Promise.all([claimOutputPath(target, claims), claimOutputPath(target, claims), claimOutputPath(target, claims)]);
    assert.equal(new Set(results.map((result) => result.path.toLowerCase())).size, 3);
    assert.ok(results.every((result) => !result.existing));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("output: un file di un lancio precedente viene riconosciuto e non duplicato", async () => {
  const dir = await mkdtemp(join(tmpdir(), "filex-ic-out-"));
  try {
    const target = join(dir, "IMG_0002.jpg");
    await writeFile(target, "dati");
    const result = await claimOutputPath(target, new Set());
    assert.deepEqual(result, { path: target, existing: true });
    await writeFile(join(dir, "IMG_0003.jpg"), "");
    assert.equal((await claimOutputPath(join(dir, "IMG_0003.jpg"), new Set())).existing, false, "un file vuoto e' un residuo, non un risultato");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("output: si ignora il JPG affiancato al RAW ma non gli altri", () => {
  const { kept, dropped } = dropJpegsPairedWithRaw([
    entry("D:/Foto/IMG_1.CR3", "raw"),
    entry("D:/Foto/IMG_1.JPG", "bitmap"),
    entry("D:/Foto/IMG_2.jpg", "bitmap"),
    entry("D:/Foto/Altra/IMG_1.jpg", "bitmap"),
    entry("D:/Foto/IMG_1.png", "bitmap"),
  ]);
  assert.equal(dropped, 1);
  assert.deepEqual(kept.map((item) => item.absolutePath).sort(), ["D:/Foto/Altra/IMG_1.jpg", "D:/Foto/IMG_1.CR3", "D:/Foto/IMG_1.png", "D:/Foto/IMG_2.jpg"].sort());
});

test("output: la cartella di destinazione deve essere un percorso assoluto", () => {
  assert.equal(isValidOutputDirectory(process.platform === "win32" ? "D:/Export" : "/export"), true);
  for (const value of ["", "  ", "export", "../export", null, 42]) assert.equal(isValidOutputDirectory(value), false, String(value));
});
