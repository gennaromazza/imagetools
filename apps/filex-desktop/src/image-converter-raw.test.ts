import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ExifTool } from "exiftool-vendored";
import sharp from "sharp";
import {
  buildMetadataCopyArgs,
  copyRawMetadata,
  disposeImageConverterExifTool,
  isPreviewTooSmall,
  largestDimension,
  pickLargestPreview,
  type EmbeddedPreview,
} from "./image-converter-raw.js";

const preview = (tag: EmbeddedPreview["tag"], width: number, height: number, bytes: number): EmbeddedPreview => ({
  tag, width, height, buffer: Buffer.alloc(bytes),
});

test("raw: sceglie la preview incorporata con piu' pixel", () => {
  const best = pickLargestPreview([
    preview("ThumbnailImage", 160, 120, 9000),
    preview("PreviewImage", 1620, 1080, 200000),
    preview("JpgFromRaw", 6000, 4000, 4000000),
  ]);
  assert.equal(best?.tag, "JpgFromRaw");
  assert.equal(pickLargestPreview([]), null);
});

test("raw: segnala solo le preview davvero piu' piccole del richiesto", () => {
  const raw = { width: 6000, height: 4000 };
  assert.equal(isPreviewTooSmall({ width: 1620, height: 1080 }, raw, 2048), true);
  assert.equal(isPreviewTooSmall({ width: 1620, height: 1080 }, raw, 1600), false);
  assert.equal(isPreviewTooSmall({ width: 6000, height: 4000 }, raw, 4000), false);
});

test("raw: gli argomenti di copia escludono dati che descrivono il RAW e usano l'XMP affiancato", () => {
  const args = buildMetadataCopyArgs("a.cr3", "a.xmp");
  for (const tag of ["--Orientation", "--PreviewImage", "--JpgFromRaw", "--ExifImageWidth"]) assert.ok(args.includes(tag), tag);
  assert.ok(args.includes("a.xmp") && args.includes("-XMP-xmp:Rating"));
  assert.ok(!buildMetadataCopyArgs("a.cr3", null).includes("a.xmp"));
});

test("raw: la copia metadati conserva macchina/obiettivo/ISO ed evita orientamento e dimensioni errate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "filex-ic-raw-"));
  const exif = new ExifTool();
  try {
    const source = join(dir, "source.jpg");
    const output = join(dir, "output.jpg");
    await writeFile(source, await sharp({ create: { width: 400, height: 300, channels: 3, background: "#888" } }).jpeg().toBuffer());
    await writeFile(output, await sharp({ create: { width: 200, height: 150, channels: 3, background: "#888" } }).jpeg().toBuffer());
    await exif.write(source, { Make: "NIKON CORPORATION", Model: "Z 8", ISO: 800, LensModel: "NIKKOR Z 50mm", Orientation: 6 } as never, { writeArgs: ["-overwrite_original"] });
    await copyRawMetadata(source, output, null);
    const tags = await exif.read(output);
    assert.equal(tags.Make, "NIKON CORPORATION");
    assert.equal(tags.Model, "Z 8");
    assert.equal(tags.ISO, 800);
    assert.equal(tags.LensModel, "NIKKOR Z 50mm");
    assert.notEqual(tags.Orientation, 6);
    assert.equal(tags.ImageWidth, 200);
  } finally {
    await exif.end().catch(() => undefined);
    await disposeImageConverterExifTool();
    await rm(dir, { recursive: true, force: true });
  }
});

test("raw: usa la dimensione maggiore quando ImageWidth descrive la miniatura", () => {
  assert.equal(largestDimension(160, 8256, undefined, "n/a"), 8256);
  assert.equal(largestDimension(undefined), 0);
});
