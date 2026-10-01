/**
 * Lettura minimale dell'EXIF di un JPEG: ora di scatto (DateTimeOriginal) e dimensioni dichiarate.
 * Serve quando non c'è l'app desktop (browser) e come riserva; è sola lettura e guarda solo i primi byte del file.
 */

export const EXIF_READ_BYTES = 262_144;

export interface ExifSummary {
  /** Millisecondi dall'epoca, ora locale interpretata come scritta dalla fotocamera. */
  captureTimeMs: number | null;
  /** Orientamento EXIF (1-8) se presente. */
  orientation: number | null;
}

const NONE: ExifSummary = { captureTimeMs: null, orientation: null };

function parseExifDate(text: string): number | null {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number) as unknown as number[];
  if (year < 1990 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const time = new Date(year, month - 1, day, hour, minute, second).getTime();
  return Number.isFinite(time) ? time : null;
}

/** Legge i campi utili dall'inizio di un file JPEG. Restituisce valori nulli se non è un JPEG con EXIF leggibile. */
export function readExifSummary(bytes: Uint8Array): ExifSummary {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return NONE;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return NONE;
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) return NONE; // fine immagine o inizio dati: nessun EXIF prima
    const length = view.getUint16(offset + 2);
    if (length < 2) return NONE;
    if (marker === 0xe1 && offset + 10 <= bytes.length
      && bytes[offset + 4] === 0x45 && bytes[offset + 5] === 0x78 && bytes[offset + 6] === 0x69 && bytes[offset + 7] === 0x66 && bytes[offset + 8] === 0 && bytes[offset + 9] === 0) {
      return readTiff(view, offset + 10, Math.min(bytes.length, offset + 2 + length));
    }
    offset += 2 + length;
  }
  return NONE;
}

function readTiff(view: DataView, base: number, end: number): ExifSummary {
  if (base + 8 > end) return NONE;
  const little = view.getUint16(base) === 0x4949;
  if (!little && view.getUint16(base) !== 0x4d4d) return NONE;
  if (view.getUint16(base + 2, little) !== 42) return NONE;
  const u16 = (pos: number) => view.getUint16(pos, little);
  const u32 = (pos: number) => view.getUint32(pos, little);
  const ascii = (pos: number, length: number) => {
    let text = "";
    for (let index = 0; index < length && pos + index < end; index += 1) {
      const code = view.getUint8(pos + index);
      if (code === 0) break;
      text += String.fromCharCode(code);
    }
    return text;
  };

  const readIfd = (ifdOffset: number, wanted: Record<number, "ascii" | "short" | "long">): Map<number, string | number> => {
    const result = new Map<number, string | number>();
    const start = base + ifdOffset;
    if (start + 2 > end) return result;
    const count = u16(start);
    for (let index = 0; index < Math.min(count, 256); index += 1) {
      const entry = start + 2 + index * 12;
      if (entry + 12 > end) break;
      const tag = u16(entry);
      const kind = wanted[tag];
      if (!kind) continue;
      const type = u16(entry + 2);
      const size = u32(entry + 4);
      if (kind === "ascii" && type === 2) {
        const valuePos = size > 4 ? base + u32(entry + 8) : entry + 8;
        result.set(tag, ascii(valuePos, size));
      } else if (kind === "short" && type === 3) result.set(tag, u16(entry + 8));
      else if (kind === "long" && (type === 4 || type === 3)) result.set(tag, type === 3 ? u16(entry + 8) : u32(entry + 8));
    }
    return result;
  };

  try {
    const ifd0 = readIfd(u32(base + 4), { 0x0112: "short", 0x0132: "ascii", 0x8769: "long" });
    const orientation = typeof ifd0.get(0x0112) === "number" ? (ifd0.get(0x0112) as number) : null;
    let captured: number | null = null;
    const exifPointer = ifd0.get(0x8769);
    if (typeof exifPointer === "number") {
      const exif = readIfd(exifPointer, { 0x9003: "ascii", 0x9004: "ascii" });
      const text = (exif.get(0x9003) ?? exif.get(0x9004)) as string | undefined;
      if (text) captured = parseExifDate(text);
    }
    if (captured === null && typeof ifd0.get(0x0132) === "string") captured = parseExifDate(ifd0.get(0x0132) as string);
    return { captureTimeMs: captured, orientation };
  } catch {
    return NONE;
  }
}

/** Legge l'ora di scatto di un file scelto nel browser (solo i primi byte). */
export async function readCaptureTimeFromBlob(blob: Blob): Promise<ExifSummary> {
  try {
    const head = await blob.slice(0, EXIF_READ_BYTES).arrayBuffer();
    return readExifSummary(new Uint8Array(head));
  } catch {
    return NONE;
  }
}
