import assert from "node:assert/strict";
import test from "node:test";
import { locateEmbeddedJpegRange, locateJpegExifThumbnailRange } from "./raw-jpeg-extractor.js";

/**
 * Riproduce la struttura vista su un RAF Fujifilm reale: JPEG incorporato con APP1 Exif da ~64 KB
 * e miniatura IFD1 di 9.426 byte (160x120) a offset 4304 dall'inizio del TIFF.
 */
function buildExifTiff(thumbnailLength: number, thumbnailOffset = 4304): Uint8Array {
  const tiff = new Uint8Array(thumbnailOffset + thumbnailLength + 16);
  const view = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49], 0); view.setUint16(2, 42, true); view.setUint32(4, 8, true);
  // IFD0: 1 voce (Make), poi puntatore a IFD1
  const ifd1 = 3910;
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x010f, true); view.setUint16(12, 2, true); view.setUint32(14, 6, true); view.setUint32(18, 170, true);
  view.setUint32(8 + 2 + 12, ifd1, true);
  // IFD1: compressione JPEG + offset/lunghezza miniatura
  view.setUint16(ifd1, 3, true);
  const entries: Array<[number, number]> = [[0x0103, 6], [0x0201, thumbnailOffset], [0x0202, thumbnailLength]];
  entries.forEach(([tag, value], i) => {
    const at = ifd1 + 2 + i * 12;
    view.setUint16(at, tag, true); view.setUint16(at + 2, tag === 0x0103 ? 3 : 4, true); view.setUint32(at + 4, 1, true); view.setUint32(at + 8, value, true);
  });
  tiff[thumbnailOffset] = 0xff; tiff[thumbnailOffset + 1] = 0xd8;
  tiff[thumbnailOffset + thumbnailLength - 2] = 0xff; tiff[thumbnailOffset + thumbnailLength - 1] = 0xd9;
  return tiff;
}

function buildJpegWithExif(tiff: Uint8Array): { jpeg: Uint8Array; tiffStart: number } {
  const segmentLength = 2 + 6 + tiff.length;
  const jpeg = new Uint8Array(2 + 2 + segmentLength + 4);
  jpeg.set([0xff, 0xd8, 0xff, 0xe1, segmentLength >> 8, segmentLength & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0], 0);
  jpeg.set(tiff, 12);
  jpeg.set([0xff, 0xda, 0, 2], 12 + tiff.length);
  return { jpeg, tiffStart: 12 };
}

const asArrayBuffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

test("miniatura EXIF Fujifilm da 9 KB: viene trovata (prima era scartata sotto i 10 KB)", () => {
  const { jpeg, tiffStart } = buildJpegWithExif(buildExifTiff(9426));
  assert.deepEqual(locateJpegExifThumbnailRange(asArrayBuffer(jpeg)), { offset: tiffStart + 4304, length: 9426 });
});

test("miniatura EXIF: soglie minime e JPEG senza Exif", () => {
  const tiny = buildJpegWithExif(buildExifTiff(900)).jpeg;
  assert.equal(locateJpegExifThumbnailRange(asArrayBuffer(tiny)), null, "sotto 1 KB non è una miniatura utilizzabile");
  assert.equal(locateJpegExifThumbnailRange(asArrayBuffer(new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 4, 0, 0, 0, 0]))), null);
  assert.equal(locateJpegExifThumbnailRange(asArrayBuffer(new Uint8Array(64))), null, "non è un JPEG");
  const large = buildJpegWithExif(buildExifTiff(32_000)).jpeg;
  assert.equal(locateJpegExifThumbnailRange(asArrayBuffer(large))?.length, 32_000);
});

test("anteprima RAW: una miniatura da 9 KB non viene scambiata per l'anteprima completa", () => {
  // Stessa struttura TIFF come header di un RAW: la ricerca dell'anteprima mantiene la soglia di 10 KB.
  assert.equal(locateEmbeddedJpegRange(asArrayBuffer(buildExifTiff(9426))), null);
  assert.deepEqual(locateEmbeddedJpegRange(asArrayBuffer(buildExifTiff(12_000))), { offset: 4304, length: 12_000 });
});
