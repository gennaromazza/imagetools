import assert from "node:assert/strict";
import test from "node:test";
import { locateJpegExifThumbnailWithOrientation, locateTiffRootThumbnail, readJpegExifOrientation } from "./raw-jpeg-extractor.js";

interface Entry { tag: number; type: 3 | 4; value: number }

/** TIFF minimale con IFD0, IFD1 e una miniatura JPEG: stessa struttura vista su un ARW Sony reale. */
function buildTiff(options: { le?: boolean; ifd0: Entry[]; ifd1: Entry[]; ifd1At: number; thumb?: { at: number; length: number }; size: number }): Uint8Array {
  const le = options.le ?? true;
  const bytes = new Uint8Array(options.size);
  const view = new DataView(bytes.buffer);
  bytes.set(le ? [0x49, 0x49] : [0x4d, 0x4d], 0);
  view.setUint16(2, 42, le); view.setUint32(4, 8, le);
  const writeIfd = (at: number, entries: Entry[], next: number) => {
    view.setUint16(at, entries.length, le);
    entries.forEach((entry, index) => {
      const o = at + 2 + index * 12;
      view.setUint16(o, entry.tag, le); view.setUint16(o + 2, entry.type, le); view.setUint32(o + 4, 1, le);
      if (entry.type === 3) view.setUint16(o + 8, entry.value, le); else view.setUint32(o + 8, entry.value, le);
    });
    view.setUint32(at + 2 + entries.length * 12, next, le);
  };
  writeIfd(8, options.ifd0, options.ifd1At);
  writeIfd(options.ifd1At, options.ifd1, 0);
  if (options.thumb) { bytes[options.thumb.at] = 0xff; bytes[options.thumb.at + 1] = 0xd8; bytes[options.thumb.at + options.thumb.length - 2] = 0xff; bytes[options.thumb.at + options.thumb.length - 1] = 0xd9; }
  return bytes;
}

const asArrayBuffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/** Offset e lunghezze misurati su un ARW reale (DSC00296.ARW): anteprima da 398 KB in IFD0, miniatura da 8.388 byte in IFD1. */
function sonyLike(orientation = 8, le = true) {
  return buildTiff({
    le, size: 131_072, ifd1At: 43_670,
    ifd0: [{ tag: 0x103, type: 3, value: 6 }, { tag: 0x112, type: 3, value: orientation }, { tag: 0x14a, type: 4, value: 138_478 }, { tag: 0x201, type: 4, value: 192_674 }, { tag: 0x202, type: 4, value: 398_362 }],
    ifd1: [{ tag: 0x103, type: 3, value: 6 }, { tag: 0x201, type: 4, value: 43_944 }, { tag: 0x202, type: 4, value: 8_388 }],
    thumb: { at: 43_944, length: 8_388 },
  });
}

test("miniatura RAW (ARW): sceglie i ~8 KB dell'IFD1 e non l'anteprima da 398 KB, con l'orientamento", () => {
  assert.deepEqual(locateTiffRootThumbnail(asArrayBuffer(sonyLike(8))), { offset: 43_944, length: 8_388, orientation: 8 });
  assert.deepEqual(locateTiffRootThumbnail(asArrayBuffer(sonyLike(1))), { offset: 43_944, length: 8_388, orientation: 1 });
});

test("miniatura RAW: funziona anche con byte order big-endian (Nikon, alcune Canon)", () => {
  assert.deepEqual(locateTiffRootThumbnail(asArrayBuffer(sonyLike(6, false))), { offset: 43_944, length: 8_388, orientation: 6 });
});

test("miniatura RAW: se la miniatura non è nei byte letti, o è troppo grande, o non è un JPEG, non si inventa nulla", () => {
  const truncated = sonyLike().subarray(0, 43_000);
  assert.equal(locateTiffRootThumbnail(asArrayBuffer(truncated)), null, "fuori dai byte letti: si ripiega sul percorso lento");
  const big = buildTiff({
    size: 200_000, ifd1At: 400,
    ifd0: [{ tag: 0x112, type: 3, value: 1 }],
    ifd1: [{ tag: 0x201, type: 4, value: 1_000 }, { tag: 0x202, type: 4, value: 150_000 }],
    thumb: { at: 1_000, length: 150_000 },
  });
  assert.equal(locateTiffRootThumbnail(asArrayBuffer(big)), null, "oltre 100 KB è un'anteprima, non una miniatura");
  const notJpeg = buildTiff({
    size: 20_000, ifd1At: 400,
    ifd0: [{ tag: 0x112, type: 3, value: 1 }],
    ifd1: [{ tag: 0x201, type: 4, value: 1_000 }, { tag: 0x202, type: 4, value: 8_000 }],
  });
  assert.equal(locateTiffRootThumbnail(asArrayBuffer(notJpeg)), null, "senza FF D8 non è un JPEG");
  assert.equal(locateTiffRootThumbnail(asArrayBuffer(new Uint8Array(64))), null);
  assert.equal(locateTiffRootThumbnail(asArrayBuffer(new Uint8Array([0xff, 0xd8, 0xff, 0xe1]))), null, "un JPEG non è un TIFF");
  const tiny = buildTiff({ size: 5_000, ifd1At: 400, ifd0: [{ tag: 0x112, type: 3, value: 1 }], ifd1: [{ tag: 0x201, type: 4, value: 1_000 }, { tag: 0x202, type: 4, value: 500 }], thumb: { at: 1_000, length: 500 } });
  assert.equal(locateTiffRootThumbnail(asArrayBuffer(tiny)), null, "sotto 1 KB non è utilizzabile");
});

/** JPEG con APP1 Exif che contiene un TIFF: come le foto della fotocamera e l'anteprima incorporata dei RAF. */
function jpegWithExif(tiff: Uint8Array): Uint8Array {
  const segmentLength = 2 + 6 + tiff.length;
  const jpeg = new Uint8Array(2 + 2 + segmentLength + 4);
  jpeg.set([0xff, 0xd8, 0xff, 0xe1, segmentLength >> 8, segmentLength & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0], 0);
  jpeg.set(tiff, 12);
  jpeg.set([0xff, 0xda, 0, 2], 12 + tiff.length);
  return jpeg;
}

function exifJpeg(orientation: number, ifd1Orientation?: number): Uint8Array {
  const tiff = buildTiff({
    size: 8_000, ifd1At: 400,
    ifd0: [{ tag: 0x112, type: 3, value: orientation }],
    ifd1: [{ tag: 0x103, type: 3, value: 6 }, ...(ifd1Orientation ? [{ tag: 0x112, type: 3 as const, value: ifd1Orientation }] : []), { tag: 0x201, type: 4, value: 1_000 }, { tag: 0x202, type: 4, value: 5_000 }],
    thumb: { at: 1_000, length: 5_000 },
  });
  return jpegWithExif(tiff);
}

test("foto JPG: miniatura EXIF e orientamento (le verticali hanno la miniatura in orizzontale e orientamento 8)", () => {
  const upright = locateJpegExifThumbnailWithOrientation(asArrayBuffer(exifJpeg(8)))!;
  assert.deepEqual([upright.length, upright.orientation, upright.offset], [5_000, 8, 12 + 1_000]);
  assert.equal(locateJpegExifThumbnailWithOrientation(asArrayBuffer(exifJpeg(1)))!.orientation, 1);
  assert.equal(locateJpegExifThumbnailWithOrientation(asArrayBuffer(exifJpeg(1, 6)))!.orientation, 6, "se l'immagine principale non lo dice, vale quello della miniatura");
  assert.equal(locateJpegExifThumbnailWithOrientation(asArrayBuffer(exifJpeg(3, 6)))!.orientation, 3, "vale quello dell'immagine principale");
  assert.equal(locateJpegExifThumbnailWithOrientation(asArrayBuffer(new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 4, 0, 0, 0, 0]))), null, "JPEG senza Exif");
  assert.equal(locateJpegExifThumbnailWithOrientation(asArrayBuffer(new Uint8Array(64))), null);
});

test("foto JPG: lettura dell'orientamento dai primi byte, 1 se il file non lo dice", () => {
  assert.equal(readJpegExifOrientation(asArrayBuffer(exifJpeg(8))), 8);
  assert.equal(readJpegExifOrientation(asArrayBuffer(exifJpeg(6))), 6);
  assert.equal(readJpegExifOrientation(asArrayBuffer(exifJpeg(1))), 1);
  assert.equal(readJpegExifOrientation(asArrayBuffer(new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 4, 0, 0, 0, 0]))), 1);
  assert.equal(readJpegExifOrientation(asArrayBuffer(new Uint8Array(0))), 1);
  assert.equal(readJpegExifOrientation(asArrayBuffer(exifJpeg(9))), 1, "valori fuori da 1-8 ignorati");
});
