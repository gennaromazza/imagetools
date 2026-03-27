/**
 * RAW → Embedded JPEG Extractor
 *
 * Most camera RAW formats (CR2, CR3, NEF, ARW, RAF, DNG, RW2, ORF, PEF, SRW)
 * contain one or more embedded JPEG previews. This module extracts the largest
 * one from the binary data and returns it as an ArrayBuffer.
 *
 * Strategy:
 *   1. Try format-specific fast paths (TIFF-based IFD parsing, RAF header)
 *   2. Fallback: scan for JPEG SOI/EOI markers and return the largest segment
 *
 * Runs inside a Web Worker — no DOM or main-thread dependencies.
 */

// ── JPEG marker constants ──────────────────────────────────────────────
const JPEG_SOI_0 = 0xff;
const JPEG_SOI_1 = 0xd8;
const JPEG_EOI_1 = 0xd9;

// ── TIFF tag IDs we care about ─────────────────────────────────────────
const TAG_STRIP_OFFSETS = 0x0111;
const TAG_STRIP_BYTE_COUNTS = 0x0117;
const TAG_JPEG_OFFSET = 0x0201; // JPEGInterchangeFormat
const TAG_JPEG_LENGTH = 0x0202; // JPEGInterchangeFormatLength
const TAG_SUB_IFD = 0x014a;

// ── Public API ─────────────────────────────────────────────────────────

export interface EmbeddedJpegRange {
  offset: number;
  length: number;
}

export function locateEmbeddedJpegRange(buffer: ArrayBuffer): EmbeddedJpegRange | null {
  const data = new Uint8Array(buffer);
  if (data.length < 12) return null;

  const candidates: EmbeddedJpegRange[] = [];

  const tiffCandidate = tryTiffLocate(data);
  if (tiffCandidate && tiffCandidate.length > 10_000) candidates.push(tiffCandidate);

  const rafCandidate = tryRafLocate(data);
  if (rafCandidate && rafCandidate.length > 10_000) candidates.push(rafCandidate);

  const bmffCandidate = tryBmffLocate(data);
  if (bmffCandidate && bmffCandidate.length > 10_000) candidates.push(bmffCandidate);

  if (candidates.length === 0) return null;

  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].length > best.length) {
      best = candidates[i];
    }
  }

  return best;
}

/**
 * Extract the largest embedded JPEG preview from a RAW file.
 * Returns the JPEG as an ArrayBuffer, or null if none found.
 */
export function extractEmbeddedJpeg(buffer: ArrayBuffer): ArrayBuffer | null {
  const data = new Uint8Array(buffer);
  if (data.length < 12) return null;

  // Evaluate all extraction strategies and keep the largest decodable JPEG.
  // Some RAW files expose a small preview in TIFF tags while a much larger
  // embedded JPEG is only discoverable via marker scans.
  const candidates: ArrayBuffer[] = [];

  const tiffResult = tryTiffExtract(data, buffer);
  if (tiffResult && tiffResult.byteLength > 10_000) candidates.push(tiffResult);

  const cr3Result = tryBmffExtract(data, buffer);
  if (cr3Result && cr3Result.byteLength > 10_000) candidates.push(cr3Result);

  const rafResult = tryRafExtract(data, buffer);
  if (rafResult && rafResult.byteLength > 10_000) candidates.push(rafResult);

  const structured = scanForLargestJpeg(data, buffer);
  if (structured && structured.byteLength > 10_000) candidates.push(structured);

  const markerFallback = scanForLargestJpegByMarkers(data, buffer);
  if (markerFallback && markerFallback.byteLength > 10_000) {
    candidates.push(markerFallback);
  }

  const normalized = candidates
    .map((candidate) => normalizeJpegCandidate(candidate))
    .filter((candidate): candidate is ArrayBuffer => candidate !== null && candidate.byteLength > 10_000);

  if (normalized.length === 0) return null;

  let best = normalized[0];
  for (let i = 1; i < normalized.length; i++) {
    const candidate = normalized[i];
    const candidatePixels = getJpegPixelCount(candidate);
    const bestPixels = getJpegPixelCount(best);

    if (
      candidatePixels > bestPixels ||
      (candidatePixels === bestPixels && candidate.byteLength > best.byteLength)
    ) {
      best = candidate;
    }
  }
  return best;
}

function normalizeJpegCandidate(candidate: ArrayBuffer): ArrayBuffer | null {
  const candidateData = new Uint8Array(candidate);
  return extractJpegSliceAtOffset(candidateData, candidate, 0, candidate.byteLength);
}

function getJpegPixelCount(candidate: ArrayBuffer): number {
  const data = new Uint8Array(candidate);
  let i = 2;

  while (i < data.length - 9) {
    if (data[i] !== 0xff) {
      i++;
      continue;
    }

    while (i < data.length && data[i] === 0xff) i++;
    if (i >= data.length) break;

    const marker = data[i++];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (i + 1 >= data.length) break;
    const segLen = (data[i] << 8) | data[i + 1];
    if (segLen < 2 || i + segLen > data.length) break;

    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const height = (data[i + 3] << 8) | data[i + 4];
      const width = (data[i + 5] << 8) | data[i + 6];
      return width * height;
    }

    if (marker === 0xda || marker === 0xd9) {
      break;
    }

    i += segLen;
  }

  return 0;
}

function extractJpegSliceAtOffset(
  data: Uint8Array,
  buffer: ArrayBuffer,
  start: number,
  maxEndExclusive: number,
): ArrayBuffer | null {
  if (
    start < 0 ||
    start + 2 >= data.length ||
    data[start] !== JPEG_SOI_0 ||
    data[start + 1] !== JPEG_SOI_1
  ) {
    return null;
  }

  const end = Math.min(data.length, Math.max(start + 2, maxEndExclusive));
  let i = start + 2;
  let foundDecodableSof = false;

  while (i < end - 1) {
    if (data[i] !== 0xff) {
      i++;
      continue;
    }

    while (i < end && data[i] === 0xff) i++;
    if (i >= end) break;

    const marker = data[i++];

    if (marker === 0xd9) {
      return foundDecodableSof ? buffer.slice(start, i) : null;
    }

    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (i + 1 >= end) break;
    const segLen = (data[i] << 8) | data[i + 1];
    if (segLen < 2 || i + segLen > end) break;

    if (marker === 0xc3) {
      return null;
    }

    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      foundDecodableSof = true;
    }

    if (marker === 0xda) {
      i += segLen;

      while (i < end - 1) {
        if (data[i] !== 0xff) {
          i++;
          continue;
        }

        const next = data[i + 1];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          i += 2;
          continue;
        }

        if (next === 0xff) {
          i++;
          continue;
        }

        if (next === 0xd9) {
          return foundDecodableSof ? buffer.slice(start, i + 2) : null;
        }

        break;
      }

      continue;
    }

    i += segLen;
  }

  return null;
}

// ── TIFF-based extraction ──────────────────────────────────────────────

function pushCandidateRange(
  candidates: EmbeddedJpegRange[],
  offset: number,
  length: number,
): void {
  if (offset > 0 && length > 10_000) {
    candidates.push({ offset, length });
  }
}

function tryTiffLocate(data: Uint8Array): EmbeddedJpegRange | null {
  const b0 = data[0];
  const b1 = data[1];
  let le: boolean;

  if (b0 === 0x49 && b1 === 0x49) {
    le = true;
  } else if (b0 === 0x4d && b1 === 0x4d) {
    le = false;
  } else {
    return null;
  }

  const magic = readU16(data, 2, le);
  if (magic !== 42 && magic !== 0x4f52) return null;

  const firstIfdOffset = readU32(data, 4, le);
  if (firstIfdOffset === 0 || firstIfdOffset >= data.length) return null;

  const candidates: EmbeddedJpegRange[] = [];
  let ifdOffset = firstIfdOffset;
  let ifdCount = 0;
  const maxIfdChain = 10;

  while (
    ifdOffset > 0 &&
    ifdOffset < data.length - 2 &&
    ifdCount < maxIfdChain
  ) {
    ifdCount++;
    const result = parseIfd(data, new ArrayBuffer(0), ifdOffset, le);

    pushCandidateRange(candidates, result.jpegOffset, result.jpegLength);
    pushCandidateRange(candidates, result.stripOffset, result.stripLength);

    for (const subOffset of result.subIfdOffsets) {
      if (subOffset <= 0 || subOffset >= data.length - 2) {
        continue;
      }

      const sub = parseIfd(data, new ArrayBuffer(0), subOffset, le);
      pushCandidateRange(candidates, sub.jpegOffset, sub.jpegLength);
      pushCandidateRange(candidates, sub.stripOffset, sub.stripLength);
    }

    ifdOffset = result.nextIfdOffset;
  }

  if (candidates.length === 0) return null;

  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].length > best.length) {
      best = candidates[i];
    }
  }

  return best;
}

function tryTiffExtract(
  data: Uint8Array,
  buffer: ArrayBuffer,
): ArrayBuffer | null {
  // Check for TIFF header: "II" (little-endian) or "MM" (big-endian) + magic 42
  const b0 = data[0];
  const b1 = data[1];
  let le: boolean;

  if (b0 === 0x49 && b1 === 0x49) {
    le = true; // Intel byte order
  } else if (b0 === 0x4d && b1 === 0x4d) {
    le = false; // Motorola byte order
  } else {
    return null; // Not TIFF
  }

  const magic = readU16(data, 2, le);
  if (magic !== 42 && magic !== 0x4f52) return null; // 42 = standard TIFF, 0x4f52 = ORF variant

  const firstIfdOffset = readU32(data, 4, le);
  if (firstIfdOffset === 0 || firstIfdOffset >= data.length) return null;

  // Walk all IFDs and their SubIFDs looking for the largest JPEG
  let bestJpeg: ArrayBuffer | null = null;
  let bestSize = 0;

  let ifdOffset = firstIfdOffset;
  let ifdCount = 0;
  const maxIfdChain = 10; // safety limit

  while (
    ifdOffset > 0 &&
    ifdOffset < data.length - 2 &&
    ifdCount < maxIfdChain
  ) {
    ifdCount++;
    const result = parseIfd(data, buffer, ifdOffset, le);

    // Check JPEG from this IFD
    if (result.jpegOffset > 0 && result.jpegLength > 0) {
      const candidate = extractJpegSliceAtOffset(
        data,
        buffer,
        result.jpegOffset,
        result.jpegOffset + result.jpegLength,
      );
      if (candidate && candidate.byteLength > bestSize) {
        bestJpeg = candidate;
        bestSize = candidate.byteLength;
      }
    }

    // Check JPEG from strips (some RAW formats store preview this way)
    if (result.stripOffset > 0 && result.stripLength > 0) {
      const candidate = extractJpegSliceAtOffset(
        data,
        buffer,
        result.stripOffset,
        result.stripOffset + result.stripLength,
      );
      if (candidate && candidate.byteLength > bestSize) {
        bestJpeg = candidate;
        bestSize = candidate.byteLength;
      }
    }

    // Recurse into SubIFDs
    for (const subOffset of result.subIfdOffsets) {
      if (subOffset > 0 && subOffset < data.length - 2) {
        const sub = parseIfd(data, buffer, subOffset, le);
        if (sub.jpegOffset > 0 && sub.jpegLength > 0) {
          const candidate = extractJpegSliceAtOffset(
            data,
            buffer,
            sub.jpegOffset,
            sub.jpegOffset + sub.jpegLength,
          );
          if (candidate && candidate.byteLength > bestSize) {
            bestJpeg = candidate;
            bestSize = candidate.byteLength;
          }
        }
        if (sub.stripOffset > 0 && sub.stripLength > 0) {
          const candidate = extractJpegSliceAtOffset(
            data,
            buffer,
            sub.stripOffset,
            sub.stripOffset + sub.stripLength,
          );
          if (candidate && candidate.byteLength > bestSize) {
            bestJpeg = candidate;
            bestSize = candidate.byteLength;
          }
        }
      }
    }

    // Next IFD in the chain
    ifdOffset = result.nextIfdOffset;
  }

  return bestJpeg;
}

interface IfdResult {
  jpegOffset: number;
  jpegLength: number;
  stripOffset: number;
  stripLength: number;
  subIfdOffsets: number[];
  nextIfdOffset: number;
}

function parseIfd(
  data: Uint8Array,
  _buffer: ArrayBuffer,
  offset: number,
  le: boolean,
): IfdResult {
  const result: IfdResult = {
    jpegOffset: 0,
    jpegLength: 0,
    stripOffset: 0,
    stripLength: 0,
    subIfdOffsets: [],
    nextIfdOffset: 0,
  };

  if (offset + 2 > data.length) return result;
  const entryCount = readU16(data, offset, le);
  if (entryCount > 500) return result; // sanity check

  for (let i = 0; i < entryCount; i++) {
    const entryOffset = offset + 2 + i * 12;
    if (entryOffset + 12 > data.length) break;

    const tag = readU16(data, entryOffset, le);
    const type = readU16(data, entryOffset + 2, le);
    const count = readU32(data, entryOffset + 4, le);
    const valueOffset = entryOffset + 8;

    switch (tag) {
      case TAG_JPEG_OFFSET:
        result.jpegOffset = readValueU32(data, valueOffset, type, count, le);
        break;
      case TAG_JPEG_LENGTH:
        result.jpegLength = readValueU32(data, valueOffset, type, count, le);
        break;
      case TAG_STRIP_OFFSETS:
        result.stripOffset = readValueU32(data, valueOffset, type, count, le);
        break;
      case TAG_STRIP_BYTE_COUNTS:
        result.stripLength = readValueU32(data, valueOffset, type, count, le);
        break;
      case TAG_SUB_IFD: {
        // SubIFD can contain multiple offsets
        if (count === 1) {
          result.subIfdOffsets.push(
            readValueU32(data, valueOffset, type, count, le),
          );
        } else if (count > 1 && count <= 10) {
          const ptrOffset = readU32(data, valueOffset, le);
          for (let s = 0; s < count; s++) {
            const off = ptrOffset + s * 4;
            if (off + 4 <= data.length) {
              result.subIfdOffsets.push(readU32(data, off, le));
            }
          }
        }
        break;
      }
    }
  }

  // Next IFD offset is right after all entries
  const nextOff = offset + 2 + entryCount * 12;
  if (nextOff + 4 <= data.length) {
    result.nextIfdOffset = readU32(data, nextOff, le);
  }

  return result;
}

// ── Fujifilm RAF extraction ────────────────────────────────────────────

function tryRafLocate(data: Uint8Array): EmbeddedJpegRange | null {
  if (data.length < 160) return null;

  const magic = String.fromCharCode(...data.slice(0, 16));
  if (!magic.startsWith("FUJIFILMCCD-RAW")) return null;

  const jpegOffset = readU32BE(data, 84);
  const jpegLength = readU32BE(data, 88);
  if (jpegOffset === 0 || jpegLength === 0) return null;

  return {
    offset: jpegOffset,
    length: jpegLength,
  };
}

function tryRafExtract(
  data: Uint8Array,
  buffer: ArrayBuffer,
): ArrayBuffer | null {
  // RAF magic: "FUJIFILMCCD-RAW " (16 bytes)
  if (data.length < 160) return null;

  const magic = String.fromCharCode(...data.slice(0, 16));
  if (!magic.startsWith("FUJIFILMCCD-RAW")) return null;

  // JPEG offset at byte 84 (big-endian u32), length at byte 88 (big-endian u32)
  const jpegOffset = readU32BE(data, 84);
  const jpegLength = readU32BE(data, 88);

  if (jpegOffset === 0 || jpegLength === 0) return null;
  return extractJpegSliceAtOffset(data, buffer, jpegOffset, jpegOffset + jpegLength);
}

// ── Canon CR3 / ISO BMFF extraction ───────────────────────────────────

/**
 * CR3 is based on ISO Base Media File Format (ISOBMFF / MP4 boxes).
 * Walk the top-level boxes. The JPEG preview is usually inside an `mdat`
 * box or inside `uuid` boxes. We scan each box's payload for JPEG SOI.
 */
function tryBmffLocate(data: Uint8Array): EmbeddedJpegRange | null {
  if (data.length < 8) return null;

  const b4 = data[4];
  const b5 = data[5];
  const b6 = data[6];
  const b7 = data[7];
  const isFtyp = b4 === 0x66 && b5 === 0x74 && b6 === 0x79 && b7 === 0x70;
  if (!isFtyp) return null;

  let best: EmbeddedJpegRange | null = null;
  let pos = 0;
  const len = data.length;

  while (pos + 8 <= len) {
    const boxSize = readU32(data, pos, false);
    const boxEnd = boxSize === 0 ? len : pos + boxSize;
    if (boxSize < 8 || boxEnd > len) break;

    const type = String.fromCharCode(
      data[pos + 4],
      data[pos + 5],
      data[pos + 6],
      data[pos + 7],
    );

    if ((type === "mdat" || type === "uuid") && boxEnd - (pos + 8) > 10_000) {
      const candidate = {
        offset: pos + 8,
        length: boxEnd - (pos + 8),
      };
      if (!best || candidate.length > best.length) {
        best = candidate;
      }
    }

    pos = boxEnd;
  }

  return best;
}

function tryBmffExtract(
  data: Uint8Array,
  buffer: ArrayBuffer,
): ArrayBuffer | null {
  if (data.length < 8) return null;
  // CR3 `ftyp` box: bytes 4-7 == "ftyp" and brand at 8-11 contains "crx"
  const b4 = data[4];
  const b5 = data[5];
  const b6 = data[6];
  const b7 = data[7];
  const isFtyp = b4 === 0x66 && b5 === 0x74 && b6 === 0x79 && b7 === 0x70; // "ftyp"
  if (!isFtyp) return null;

  let bestJpeg: ArrayBuffer | null = null;
  let bestSize = 0;
  let pos = 0;
  const len = data.length;

  while (pos + 8 <= len) {
    const boxSize = readU32(data, pos, false); // big-endian
    const boxEnd = boxSize === 0 ? len : pos + boxSize;
    if (boxSize < 8 || boxEnd > len) break;

    const type = String.fromCharCode(
      data[pos + 4],
      data[pos + 5],
      data[pos + 6],
      data[pos + 7],
    );

    // mdat and uuid boxes may contain JPEG data
    if (type === "mdat" || type === "uuid") {
      const payload = pos + 8;
      const payloadSize = boxEnd - payload;
      if (payloadSize > 10_000) {
        const result = scanForJpegInRange(data, buffer, payload, boxEnd);
        if (result && result.byteLength > bestSize) {
          bestJpeg = result;
          bestSize = result.byteLength;
        }
      }
    }

    pos = boxEnd;
  }

  return bestJpeg;
}

// ── Generic JPEG scan (fallback) ───────────────────────────────────────

/**
 * Walk a range of bytes looking for valid JPEG streams.
 * Uses proper segment-length navigation (no fragile depth tracking).
 * Returns the largest JPEG found that is > 10 KB.
 */
function scanForJpegInRange(
  data: Uint8Array,
  buffer: ArrayBuffer,
  rangeStart: number,
  rangeEnd: number,
): ArrayBuffer | null {
  const len = Math.min(rangeEnd, data.length);
  let bestStart = -1;
  let bestSize = 0;

  let i = rangeStart;
  while (i < len - 3) {
    // Find FF D8 FF — valid JPEG start
    if (
      data[i] !== JPEG_SOI_0 ||
      data[i + 1] !== JPEG_SOI_1 ||
      data[i + 2] !== 0xff
    ) {
      i++;
      continue;
    }

    const start = i;
    let j = i + 2; // position at first marker after SOI
    let jpegEnd = -1;

    while (j < len - 1) {
      // Skip fill bytes (0xFF 0xFF …)
      if (data[j] !== 0xff) {
        j++;
        continue;
      }
      while (j < len - 1 && data[j] === 0xff) j++;
      if (j >= len) break;

      const marker = data[j++]; // consume marker byte

      if (marker === 0xd9) {
        // EOI — end of JPEG
        jpegEnd = j;
        break;
      }
      if (marker === 0xd8) continue; // extra SOI — skip
      if (marker === 0x00) continue; // byte stuffing
      if (marker >= 0xd0 && marker <= 0xd7) continue; // RST0-RST7, no length

      if (marker === 0xda) {
        // SOS — has a header with length, followed by compressed scan data.
        if (j + 1 >= len) break;
        const hdrLen = (data[j] << 8) | data[j + 1];
        if (hdrLen < 2) break;
        j += hdrLen; // skip the SOS header (component selector bytes etc.)

        // Now in entropy-coded scan data.  Advance until we find a real
        // (non-stuffed, non-RST) 0xFF marker — that is either EOI or the
        // start of the next segment (progressive JPEG has multiple scans).
        while (j < len - 1) {
          if (data[j] !== 0xff) {
            j++;
            continue;
          }
          const next = data[j + 1];
          if (next === 0x00) {
            j += 2;
            continue;
          } // byte stuffing
          if (next >= 0xd0 && next <= 0xd7) {
            j += 2;
            continue;
          } // RST
          if (next === 0xff) {
            j++;
            continue;
          } // fill byte
          break; // real marker — continue parsing markers at this position
        }
        continue;
      }

      // Any other marker has a 2-byte length field
      if (j + 1 >= len) break;
      const segLen = (data[j] << 8) | data[j + 1];
      if (segLen < 2) break; // malformed
      j += segLen;
    }

    if (jpegEnd > 0) {
      const size = jpegEnd - start;
      if (size > bestSize && size > 10_000 && isDecodableJpeg(data, start, size)) {
        bestStart = start;
        bestSize = size;
      }
      i = jpegEnd;
    } else {
      i += 2;
    }
  }

  return bestStart >= 0 ? buffer.slice(bestStart, bestStart + bestSize) : null;
}

function scanForLargestJpeg(
  data: Uint8Array,
  buffer: ArrayBuffer,
): ArrayBuffer | null {
  return scanForJpegInRange(data, buffer, 0, data.length);
}

/**
 * Very tolerant fallback: find largest range between FF D8 and FF D9 markers.
 * Used only when the structured parser could not locate a complete JPEG stream.
 */
function scanForLargestJpegByMarkers(
  data: Uint8Array,
  buffer: ArrayBuffer,
): ArrayBuffer | null {
  let bestStart = -1;
  let bestSize = 0;

  for (let i = 0; i < data.length - 1; i++) {
    if (data[i] !== JPEG_SOI_0 || data[i + 1] !== JPEG_SOI_1) continue;

    for (let j = i + 2; j < data.length - 1; j++) {
      if (data[j] === JPEG_SOI_0 && data[j + 1] === JPEG_EOI_1) {
        const end = j + 2;
        const size = end - i;
        if (size > 10_000 && size > bestSize && isDecodableJpeg(data, i, size)) {
          bestStart = i;
          bestSize = size;
        }
      }
    }
  }

  return bestStart >= 0 ? buffer.slice(bestStart, bestStart + bestSize) : null;
}

// ── Binary helpers ─────────────────────────────────────────────────────

function readU16(data: Uint8Array, offset: number, le: boolean): number {
  if (offset + 2 > data.length) return 0;
  return le
    ? data[offset] | (data[offset + 1] << 8)
    : (data[offset] << 8) | data[offset + 1];
}

function readU32(data: Uint8Array, offset: number, le: boolean): number {
  if (offset + 4 > data.length) return 0;
  return le
    ? data[offset] |
        (data[offset + 1] << 8) |
        (data[offset + 2] << 16) |
        ((data[offset + 3] << 24) >>> 0)
    : ((data[offset] << 24) |
        (data[offset + 1] << 16) |
        (data[offset + 2] << 8) |
        data[offset + 3]) >>>
        0;
}

function readU32BE(data: Uint8Array, offset: number): number {
  return readU32(data, offset, false);
}

/** Read a TIFF value as u32 — handles SHORT (u16) and LONG (u32) types. */
function readValueU32(
  data: Uint8Array,
  valueOffset: number,
  type: number,
  count: number,
  le: boolean,
): number {
  if (count !== 1) {
    // Value is a pointer to the actual data
    return readU32(data, valueOffset, le);
  }
  // type 3 = SHORT (u16), type 4 = LONG (u32)
  if (type === 3) return readU16(data, valueOffset, le);
  return readU32(data, valueOffset, le);
}

/**
 * Checks if a byte array contains a decodable JPEG (Baseline/Progressive).
 * Explicitly rejects Lossless JPEG (SOF3 = 0xC3) used for CR2/DNG raw sensor data.
 */
function isDecodableJpeg(data: Uint8Array, offset: number, length: number): boolean {
  if (length < 10) return false;
  if (data[offset] !== 0xFF || data[offset + 1] !== 0xD8) return false;
  
  let i = offset + 2;
  const end = Math.min(offset + length, data.length);
  
  while (i < end - 1) {
    if (data[i] !== 0xFF) { i++; continue; }
    while (i < end - 1 && data[i] === 0xFF) i++; // skip fill bytes
    if (i >= end) break;
    
    const marker = data[i++];
    if (marker === 0xD9 || marker === 0xDA) break; // EOI or SOS
    
    // SOF markers: 0xC0 to 0xC2 (Baseline, Extended, Progressive)
    if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
      return true; // We found a decodable SOF
    }
    // 0xC3 is Lossless (RAW data sensor bits).
    if (marker === 0xC3) return false;
    
    // Standalone markers
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) continue;
    
    // Segments with length
    if (i + 1 >= end) break;
    const segLen = (data[i] << 8) | data[i + 1];
    if (segLen < 2) break;
    i += segLen;
  }
  return false;
}
