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
/**
 * Extract the largest embedded JPEG preview from a RAW file.
 * Returns the JPEG as an ArrayBuffer, or null if none found.
 */
export declare function extractEmbeddedJpeg(buffer: ArrayBuffer): ArrayBuffer | null;
