import { test } from "node:test";
import assert from "node:assert/strict";
import { readCaptureTimeFromBlob, readExifSummary } from "./exif";

/** Costruisce un JPEG minimo con un EXIF (Intel o Motorola) contenente orientamento e data di scatto. */
function jpegWithExif(options: { little?: boolean; original?: string | null; modified?: string | null; orientation?: number | null }): Uint8Array {
  const little = options.little ?? true;
  const dv = (size: number) => { const buf = new ArrayBuffer(size); return { buf, view: new DataView(buf) }; };
  const ascii = (text: string) => Uint8Array.from([...text].map((c) => c.charCodeAt(0)).concat(0));

  const original = options.original === undefined ? "2026:06:05 08:15:30" : options.original;
  const modified = options.modified ?? null;
  const orientation = options.orientation === undefined ? 6 : options.orientation;

  // Layout: [header 8][IFD0][dati di IFD0][ExifIFD][dati di ExifIFD]
  const ifd0Entries: Array<{ tag: number; type: number; count: number; value: number | Uint8Array }> = [];
  if (orientation !== null) ifd0Entries.push({ tag: 0x0112, type: 3, count: 1, value: orientation });
  if (modified) ifd0Entries.push({ tag: 0x0132, type: 2, count: modified.length + 1, value: ascii(modified) });
  const hasExif = original !== null;
  if (hasExif) ifd0Entries.push({ tag: 0x8769, type: 4, count: 1, value: 0 }); // puntatore da sistemare

  const ifd0Size = 2 + ifd0Entries.length * 12 + 4;
  const ifd0Start = 8;
  let dataCursor = ifd0Start + ifd0Size;
  const placed: Array<{ at: number; bytes: Uint8Array }> = [];
  const place = (bytes: Uint8Array) => { const at = dataCursor; placed.push({ at, bytes }); dataCursor += bytes.length + (bytes.length % 2); return at; };

  const exifStart = (() => {
    // Riserva dopo i dati di IFD0 (calcolati sotto): due passate.
    return -1;
  })();
  void exifStart;

  const entryValues = ifd0Entries.map((entry) => (entry.value instanceof Uint8Array && entry.value.length > 4 ? place(entry.value) : null));
  const exifIfdStart = dataCursor;
  const exifEntries = hasExif ? [{ tag: 0x9003, type: 2, count: (original as string).length + 1, bytes: ascii(original as string) }] : [];
  const exifIfdSize = hasExif ? 2 + exifEntries.length * 12 + 4 : 0;
  dataCursor += exifIfdSize;
  const exifValueAt = hasExif ? place(exifEntries[0].bytes) : 0;

  const total = dataCursor;
  const { buf, view } = dv(total);
  const u16 = (pos: number, value: number) => view.setUint16(pos, value, little);
  const u32 = (pos: number, value: number) => view.setUint32(pos, value, little);
  u16(0, little ? 0x4949 : 0x4d4d);
  u16(2, 42);
  u32(4, ifd0Start);
  u16(ifd0Start, ifd0Entries.length);
  ifd0Entries.forEach((entry, index) => {
    const pos = ifd0Start + 2 + index * 12;
    u16(pos, entry.tag); u16(pos + 2, entry.type); u32(pos + 4, entry.count);
    if (entry.tag === 0x8769) u32(pos + 8, exifIfdStart);
    else if (entry.value instanceof Uint8Array) {
      if (entry.value.length > 4) u32(pos + 8, entryValues[index] as number);
      else new Uint8Array(buf).set(entry.value, pos + 8);
    } else if (entry.type === 3) u16(pos + 8, entry.value);
    else u32(pos + 8, entry.value);
  });
  u32(ifd0Start + 2 + ifd0Entries.length * 12, 0);
  if (hasExif) {
    u16(exifIfdStart, 1);
    const pos = exifIfdStart + 2;
    u16(pos, 0x9003); u16(pos + 2, 2); u32(pos + 4, exifEntries[0].count); u32(pos + 8, exifValueAt);
    u32(pos + 12, 0);
  }
  for (const { at, bytes } of placed) new Uint8Array(buf).set(bytes, at);

  const tiff = new Uint8Array(buf);
  const app1Length = 2 + 6 + tiff.length;
  const out = new Uint8Array(2 + 2 + 2 + 6 + tiff.length + 2);
  out.set([0xff, 0xd8, 0xff, 0xe1, (app1Length >> 8) & 0xff, app1Length & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0], 0);
  out.set(tiff, 12);
  out.set([0xff, 0xd9], 12 + tiff.length);
  return out;
}

const local = (y: number, mo: number, d: number, h: number, mi: number, s: number) => new Date(y, mo - 1, d, h, mi, s).getTime();

test("EXIF: ora di scatto e orientamento, in entrambe le codifiche dei byte", () => {
  for (const little of [true, false]) {
    const summary = readExifSummary(jpegWithExif({ little }));
    assert.equal(summary.captureTimeMs, local(2026, 6, 5, 8, 15, 30), little ? "Intel" : "Motorola");
    assert.equal(summary.orientation, 6);
  }
});

test("EXIF: se manca la data originale si usa la data del file nell'IFD principale", () => {
  const summary = readExifSummary(jpegWithExif({ original: null, modified: "2026:06:05 09:00:00" }));
  assert.equal(summary.captureTimeMs, local(2026, 6, 5, 9, 0, 0));
  assert.equal(readExifSummary(jpegWithExif({ original: null })).captureTimeMs, null);
  assert.equal(readExifSummary(jpegWithExif({ orientation: null })).orientation, null);
});

test("EXIF: file che non sono JPEG con EXIF, troncati o con date assurde non fanno errori", () => {
  assert.deepEqual(readExifSummary(new Uint8Array(0)), { captureTimeMs: null, orientation: null });
  assert.equal(readExifSummary(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])).captureTimeMs, null);
  assert.equal(readExifSummary(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 0, 0, 0, 0, 0, 0])).captureTimeMs, null, "inizio dati: nessun EXIF");
  const whole = jpegWithExif({});
  for (const cut of [5, 14, 20, 30, 40]) assert.doesNotThrow(() => readExifSummary(whole.subarray(0, cut)));
  assert.equal(readExifSummary(jpegWithExif({ original: "0000:00:00 00:00:00" })).captureTimeMs, null, "data nulla");
  assert.equal(readExifSummary(jpegWithExif({ original: "1899:01:01 00:00:00" })).captureTimeMs, null, "data impossibile");
  const corrupt = jpegWithExif({});
  corrupt[12] = 0x00; // intestazione TIFF illeggibile
  assert.equal(readExifSummary(corrupt).captureTimeMs, null);
});

test("EXIF: lettura da un file del browser (solo i primi byte)", async () => {
  const bytes = jpegWithExif({});
  const blob = new Blob([bytes as BlobPart]);
  assert.equal((await readCaptureTimeFromBlob(blob)).captureTimeMs, local(2026, 6, 5, 8, 15, 30));
  assert.equal((await readCaptureTimeFromBlob(new Blob(["non è una foto"]))).captureTimeMs, null);
});
