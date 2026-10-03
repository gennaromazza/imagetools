import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { applyExifOrientation, orientationTransform } from "./exif-orientation.js";

/** Immagine 3x2 a blocchi di colore netto (16 px per cella): resiste alla compressione JPEG. */
async function asymmetricJpeg(): Promise<Buffer> {
  const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255], [255, 0, 255]];
  const width = 48; const height = 32;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = colors[Math.floor(y / 16) * 3 + Math.floor(x / 16)]!;
    raw.set(color, (y * width + x) * 3);
  }
  return await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toBuffer();
}

async function pixels(buffer: Buffer) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

test("orientamento EXIF: raddrizza le miniature come farebbe sharp leggendo il tag, per tutti gli 8 orientamenti", async () => {
  const base = await asymmetricJpeg();
  for (let orientation = 1; orientation <= 8; orientation++) {
    const tagged = await sharp(base).withMetadata({ orientation }).jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toBuffer();
    const expected = await pixels(await sharp(tagged).rotate().jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toBuffer());
    const actual = await pixels(await applyExifOrientation(sharp, base, orientation, 100));
    assert.deepEqual([actual.width, actual.height], [expected.width, expected.height], `dimensioni, orientamento ${orientation}`);
    let difference = 0;
    for (let i = 0; i < expected.data.length; i++) difference += Math.abs(expected.data[i]! - actual.data[i]!);
    assert.ok(difference / expected.data.length < 12, `orientamento ${orientation}: differenza media ${(difference / expected.data.length).toFixed(1)}`);
  }
});

test("orientamento EXIF: le foto verticali (6 e 8) scambiano larghezza e altezza, quelle dritte restano identiche", async () => {
  const base = await asymmetricJpeg();
  const portrait = await sharp(await applyExifOrientation(sharp, base, 8)).metadata();
  assert.deepEqual([portrait.width, portrait.height], [32, 48]);
  const upsideDown = await sharp(await applyExifOrientation(sharp, base, 3)).metadata();
  assert.deepEqual([upsideDown.width, upsideDown.height], [48, 32]);
  assert.equal(await applyExifOrientation(sharp, base, 1), base, "orientamento 1: nessuna ricodifica");
  assert.equal(await applyExifOrientation(sharp, base, 0), base);
  assert.equal(await applyExifOrientation(sharp, base, 99), base, "valori assurdi: nessun cambiamento");
});

test("orientamento EXIF: la tabella delle trasformazioni", () => {
  assert.deepEqual(orientationTransform(1), { rotate: 0, flop: false });
  assert.deepEqual(orientationTransform(6), { rotate: 90, flop: false });
  assert.deepEqual(orientationTransform(8), { rotate: 270, flop: false });
  assert.deepEqual(orientationTransform(3), { rotate: 180, flop: false });
  assert.deepEqual(orientationTransform(2), { rotate: 0, flop: true });
  assert.deepEqual(orientationTransform(5), { rotate: 270, flop: true });
  assert.deepEqual(orientationTransform(7), { rotate: 90, flop: true });
  assert.deepEqual(orientationTransform(undefined as unknown as number), { rotate: 0, flop: false });
});
