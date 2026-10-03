import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildDestinationFileName, shortStableSuffix } from "./destination-name.js";
import { expandWithSidecars, isSidecarPath } from "./sidecars.js";

function card(files: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archivio-sidecars-"));
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), "x");
  }
  return root;
}

const names = (root: string, paths: string[]) => paths.map((value) => path.relative(root, value).replace(/\\/g, "/"));

test("sidecar: la foto scelta porta con sé il suo .xmp, non quelli delle altre foto", async () => {
  const root = card(["DCIM/A/DSC01.ARW", "DCIM/A/DSC01.xmp", "DCIM/A/DSC02.ARW", "DCIM/A/DSC02.xmp", "DCIM/A/WPSettings.dat"]);
  const result = await expandWithSidecars([path.join(root, "DCIM/A/DSC01.ARW")]);
  assert.deepEqual(names(root, result), ["DCIM/A/DSC01.ARW", "DCIM/A/DSC01.xmp"]);
});

test("sidecar: maiuscole diverse, nome completo + estensione, più foto e ordine della selezione", async () => {
  const root = card(["DCIM/IMG_1.CR3", "DCIM/img_1.XMP", "DCIM/IMG_2.JPG", "DCIM/IMG_2.JPG.xmp", "DCIM/IMG_3.MP4", "DCIM/IMG_3.THM", "DCIM/IMG_9.xmp"]);
  const selected = ["DCIM/IMG_3.MP4", "DCIM/IMG_1.CR3", "DCIM/IMG_2.JPG"].map((file) => path.join(root, file));
  const result = names(root, await expandWithSidecars(selected));
  assert.deepEqual(result.map((value) => value.toLowerCase()), [
    "dcim/img_3.mp4", "dcim/img_3.thm", "dcim/img_1.cr3", "dcim/img_1.xmp", "dcim/img_2.jpg", "dcim/img_2.jpg.xmp",
  ]);
  assert.equal(result.some((value) => /IMG_9/i.test(value)), false, "uno .xmp orfano non viene aggiunto");
});

test("sidecar: RAW+JPG dello stesso scatto condividono un solo .xmp senza duplicarlo", async () => {
  const root = card(["A/DSC05.ARW", "A/DSC05.JPG", "A/DSC05.xmp"]);
  const result = names(root, await expandWithSidecars([path.join(root, "A/DSC05.ARW"), path.join(root, "A/DSC05.JPG")]));
  assert.equal(result.filter((value) => value.endsWith(".xmp")).length, 1);
  assert.equal(result.length, 3);
});

test("sidecar: cartelle illeggibili o selezione vuota non fanno fallire e altri .dat/.xml non si portano dietro", async () => {
  const root = card(["A/DSC07.ARW", "A/DSC07.dat", "A/DSC07.xml"]);
  assert.deepEqual(names(root, await expandWithSidecars([path.join(root, "A/DSC07.ARW")])), ["A/DSC07.ARW"]);
  assert.deepEqual(await expandWithSidecars([]), []);
  assert.deepEqual(await expandWithSidecars([path.join(root, "manca", "X.ARW")]), [path.join(root, "manca", "X.ARW")]);
  assert.equal(isSidecarPath("a/b.XMP"), true);
  assert.equal(isSidecarPath("a/b.dat"), false);
});

test("nome di destinazione: foto, RAW e .xmp dello stesso scatto hanno lo stesso nome base (Lightroom li abbina)", () => {
  const base = { rinominaFile: true, safeNome: "Rossi", safeData: "20261002", safeAutore: "Gennaro" };
  const name = (originalName: string, sourceRelativePath: string) => buildDestinationFileName({ ...base, originalName, sourceRelativePath });
  const raw = name("DSC01811.ARW", "DCIM/10061002/DSC01811.ARW");
  const jpg = name("DSC01811.JPG", "DCIM/10061002/DSC01811.JPG");
  const xmp = name("DSC01811.xmp", "DCIM/10061002/DSC01811.xmp");
  const stem = (value: string) => value.slice(0, value.lastIndexOf("."));
  assert.equal(stem(raw), stem(xmp));
  assert.equal(stem(raw), stem(jpg));
  assert.notEqual(raw, jpg, "estensioni diverse: nessuna collisione");
  assert.match(raw, /^Rossi_20261002_Gennaro_DSC01811_[0-9a-f]{8}\.ARW$/);
});

test("nome di destinazione: lo stesso nome in cartelle diverse resta distinguibile e il risultato è stabile", () => {
  const first = shortStableSuffix("DCIM/100/IMG_0001.JPG");
  const second = shortStableSuffix("DCIM/101/IMG_0001.JPG");
  assert.notEqual(first, second);
  assert.equal(first, shortStableSuffix("DCIM/100/IMG_0001.JPG"));
  const keep = buildDestinationFileName({ originalName: "IMG_0001.JPG", sourceRelativePath: "DCIM/100/IMG_0001.JPG", rinominaFile: false, safeNome: "x", safeData: "y", safeAutore: "z" });
  assert.equal(keep, "IMG_0001.JPG", "senza rinomina il nome non cambia");
});
