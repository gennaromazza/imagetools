import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFileNameInput } from "../apps/image-file-finder/src/input-parser.js";
import {
  cancelImageFileFinderJobDesktop,
  getImageFileFinderProgressDesktop,
  parseImageFileFinderInput,
  startImageFileFinderJobDesktop,
  validateImageFileFinderFolderDesktop,
} from "../apps/filex-desktop/src/image-file-finder-service.js";

test("bug hunt: conserva virgole e separatori racchiusi tra virgolette", () => {
  const input = '"Mario, Anna 01.jpg"; "Luca; Sara.jpg"';
  const parsed = parseFileNameInput(input);
  assert.deepEqual(parsed.names, ["Mario, Anna 01.jpg", "Luca; Sara.jpg"]);
  assert.deepEqual(parseImageFileFinderInput(input), parsed, "L'anteprima e il job devono interpretare la stessa lista.");
});

test("bug hunt: estrae il basename e deduplica senza distinguere maiuscole", () => {
  const parsed = parseFileNameInput('C:\\Foto\\SCATTO.JPG\n"D:/Altro/scatto.jpg"\nritratto.raw');
  assert.deepEqual(parsed.names, ["SCATTO.JPG", "ritratto.raw"]);
  assert.deepEqual(parsed.ignoredDuplicates, ["scatto.jpg"]);
});

test("bug hunt: input vuoti o composti da separatori non producono nomi fantasma", () => {
  assert.deepEqual(parseFileNameInput("  \n,;\t  "), { names: [], ignoredDuplicates: [] });
});

test("bug hunt: la copia non sovrascrive un file comparso nella destinazione", async () => {
  const root = await mkdtemp(join(tmpdir(), "filex-image-file-finder-copy-"));
  const source = join(root, "source");
  const destination = join(root, "destination");
  try {
    await mkdir(source);
    await mkdir(destination);
    await writeFile(join(source, "IMG_001.JPG"), "sorgente");
    await writeFile(join(destination, "IMG_001.JPG"), "esistente");
    const started = startImageFileFinderJobDesktop({
      sourceFolder: source,
      destinationFolder: destination,
      rawInput: "IMG_001.JPG",
      matchMode: "exact",
      operation: "copy",
    });
    assert.equal(started.ok, true);
    const progress = await waitForImageFileFinderJob();
    assert.equal(progress.status, "completed");
    assert.equal(await readFile(join(destination, "IMG_001.JPG"), "utf8"), "esistente");
    assert.equal(await readFile(join(destination, "IMG_001 (2).JPG"), "utf8"), "sorgente");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bug hunt: copia solo la corrispondenza ambigua scelta nell'anteprima", async () => {
  const root = await mkdtemp(join(tmpdir(), "filex-image-file-finder-selection-"));
  const source = join(root, "source");
  const firstFolder = join(source, "prima-copia");
  const selectedFolder = join(source, "copia-corretta");
  const destination = join(root, "destination");
  const first = join(firstFolder, "IMG_001.JPG");
  const selected = join(selectedFolder, "IMG_001.JPG");
  try {
    await mkdir(firstFolder, { recursive: true });
    await mkdir(selectedFolder, { recursive: true });
    await mkdir(destination);
    await writeFile(first, "prima");
    await writeFile(selected, "scelta");
    const started = startImageFileFinderJobDesktop({
      sourceFolder: source,
      destinationFolder: destination,
      rawInput: "IMG_001.JPG",
      matchMode: "exact",
      operation: "copy",
      selectedFilePaths: [selected],
    });
    assert.equal(started.ok, true);
    assert.equal((await waitForImageFileFinderJob()).status, "completed");
    assert.equal(await readFile(join(destination, "IMG_001.JPG"), "utf8"), "scelta");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bug hunt: annulla anche mentre il job sta ancora scansionando", async () => {
  const root = await mkdtemp(join(tmpdir(), "filex-image-file-finder-cancel-"));
  const source = join(root, "source");
  const destination = join(root, "destination");
  try {
    await mkdir(source);
    await mkdir(destination);
    const started = startImageFileFinderJobDesktop({
      sourceFolder: source,
      destinationFolder: destination,
      rawInput: "inesistente.jpg",
      matchMode: "exact",
      operation: "copy",
    });
    assert.equal(started.ok, true);
    cancelImageFileFinderJobDesktop();
    assert.equal((await waitForImageFileFinderJob()).status, "cancelled");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bug hunt: il trascinamento accetta solo cartelle disponibili", async () => {
  const root = await mkdtemp(join(tmpdir(), "filex-image-file-finder-drop-"));
  const folder = join(root, "cartella");
  const file = join(root, "foto.jpg");
  try {
    await mkdir(folder);
    await writeFile(file, "foto");
    assert.deepEqual(await validateImageFileFinderFolderDesktop(folder), { ok: true, path: folder });
    assert.equal((await validateImageFileFinderFolderDesktop(file)).ok, false);
    assert.equal((await validateImageFileFinderFolderDesktop(join(root, "mancante"))).ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function waitForImageFileFinderJob() {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const progress = getImageFileFinderProgressDesktop();
    if (progress.status !== "scanning" && progress.status !== "running") return progress;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Il job Trova Foto da Lista non si è concluso entro 5 secondi.");
}
