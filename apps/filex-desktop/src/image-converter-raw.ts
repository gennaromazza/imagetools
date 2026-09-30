import { ExifTool } from "exiftool-vendored";
import sharp from "sharp";

/**
 * Conversione RAW "look fotocamera": il JPEG incorporato dalla macchina contiene
 * gia' Picture Style / Picture Control / Creative Style, bilanciamento del bianco
 * e ottimizzazioni applicate dal motore della fotocamera. Lo estraiamo alla piu'
 * alta risoluzione disponibile e copiamo i metadati completi dal RAW.
 */

export const RAW_PREVIEW_TAGS = ["JpgFromRaw", "PreviewImage", "OtherImage"] as const;
type RawPreviewTag = (typeof RAW_PREVIEW_TAGS)[number] | "ThumbnailImage";

/** Tag che descrivono il RAW e non devono finire nel file convertito. */
const COPY_EXCLUDED_TAGS = [
  "ThumbnailImage", "PreviewImage", "JpgFromRaw", "OtherImage", "ThumbnailTIFF",
  "Orientation", "ImageWidth", "ImageHeight", "ExifImageWidth", "ExifImageHeight",
  "PixelXDimension", "PixelYDimension", "RawImageWidth", "RawImageHeight",
  "Compression", "PhotometricInterpretation", "StripOffsets", "StripByteCounts",
  "RowsPerStrip", "SamplesPerPixel", "BitsPerSample", "PlanarConfiguration",
  "SubfileType", "NewSubfileType", "PreviewIFD", "SubIFD", "CFAPattern", "CFARepeatPatternDim",
  "BlackLevel", "WhiteLevel", "ColorMatrix1", "ColorMatrix2", "CameraCalibration1", "CameraCalibration2",
  "DNGVersion", "DNGBackwardVersion", "OpcodeList1", "OpcodeList2", "OpcodeList3",
];

export interface EmbeddedPreview {
  buffer: Buffer;
  tag: RawPreviewTag;
  width: number;
  height: number;
}

export interface RawLookSummary {
  camera: string | null;
  look: string | null;
  whiteBalance: string | null;
  rawWidth: number | null;
  rawHeight: number | null;
  orientation: number | null;
}

let exifTool: ExifTool | null = null;

function getExifTool(): ExifTool {
  exifTool ??= new ExifTool({ maxProcs: 2, spawnTimeoutMillis: 60_000, taskTimeoutMillis: 120_000 });
  return exifTool;
}

export async function disposeImageConverterExifTool(): Promise<void> {
  const current = exifTool;
  exifTool = null;
  await current?.end().catch(() => undefined);
}

/** Sceglie l'anteprima con piu' pixel; a parita' quella con piu' byte. */
export function pickLargestPreview(candidates: EmbeddedPreview[]): EmbeddedPreview | null {
  let best: EmbeddedPreview | null = null;
  for (const candidate of candidates) {
    const pixels = candidate.width * candidate.height;
    const bestPixels = best ? best.width * best.height : -1;
    if (!best || pixels > bestPixels || (pixels === bestPixels && candidate.buffer.byteLength > best.buffer.byteLength)) {
      best = candidate;
    }
  }
  return best;
}

/** Vero se la preview e' nettamente piu' piccola di quanto richiesto dall'export. */
export function isPreviewTooSmall(
  preview: { width: number; height: number },
  raw: { width: number | null; height: number | null },
  requestedLongEdge: number,
): boolean {
  const previewLong = Math.max(preview.width, preview.height);
  const rawLong = Math.max(raw.width ?? 0, raw.height ?? 0);
  const target = rawLong > 0 ? Math.min(requestedLongEdge > 0 ? requestedLongEdge : rawLong, rawLong) : requestedLongEdge;
  return target > 0 && previewLong < target * 0.95;
}

export async function extractLargestEmbeddedPreview(rawPath: string): Promise<EmbeddedPreview | null> {
  const tool = getExifTool();
  const candidates: EmbeddedPreview[] = [];
  for (const tag of [...RAW_PREVIEW_TAGS, "ThumbnailImage"] as const) {
    if (tag === "ThumbnailImage" && candidates.length > 0) break;
    try {
      const buffer = await tool.extractBinaryTagToBuffer(tag as "PreviewImage", rawPath);
      if (buffer.byteLength < 2048) continue;
      const meta = await sharp(buffer, { failOn: "none" }).metadata();
      if (!meta.width || !meta.height) continue;
      candidates.push({ buffer, tag, width: meta.width, height: meta.height });
    } catch {
      // tag assente in questo formato RAW
    }
  }
  return pickLargestPreview(candidates);
}

export function largestDimension(...values: unknown[]): number {
  let best = 0;
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > best) best = numeric;
  }
  return best;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim() && value.trim() !== "0") return value.trim();
  }
  return null;
}

export async function readRawLookSummary(rawPath: string): Promise<RawLookSummary> {
  try {
    const tags = (await getExifTool().read(rawPath)) as unknown as Record<string, unknown>;
    const make = firstString(tags.Make);
    const model = firstString(tags.Model);
    // Alcuni RAW (es. NEF) riportano in ImageWidth la miniatura: vale la dimensione maggiore dichiarata.
    const width = largestDimension(tags.ImageWidth, tags.ExifImageWidth, tags.RawImageWidth, tags.SourceImageWidth);
    const height = largestDimension(tags.ImageHeight, tags.ExifImageHeight, tags.RawImageHeight, tags.SourceImageHeight);
    const orientation = Number(tags.Orientation);
    return {
      camera: [make, model].filter(Boolean).join(" ") || null,
      look: firstString(
        tags.PictureControlName, tags.PictureStyle, tags.PictureProfile, tags.CreativeStyle,
        tags.FilmMode, tags.PictureMode, tags.ArtFilter, tags.ColorMode,
      ),
      whiteBalance: firstString(tags.WhiteBalance),
      rawWidth: Number.isFinite(width) && width > 0 ? width : null,
      rawHeight: Number.isFinite(height) && height > 0 ? height : null,
      orientation: Number.isInteger(orientation) && orientation >= 1 && orientation <= 8 ? orientation : null,
    };
  } catch {
    return { camera: null, look: null, whiteBalance: null, rawWidth: null, rawHeight: null, orientation: null };
  }
}

export function formatRawLookSummary(summary: RawLookSummary): string {
  const parts = [
    summary.camera,
    summary.look ? `look ${summary.look}` : null,
    summary.whiteBalance ? `WB ${summary.whiteBalance}` : null,
  ].filter(Boolean);
  return parts.join(" | ");
}

/** Argomenti ExifTool per trasferire i metadati dal RAW al file convertito. */
export function buildMetadataCopyArgs(rawPath: string, sidecarPath: string | null, orientation = 1): string[] {
  const args = ["-overwrite_original", "-m", "-TagsFromFile", rawPath, "-all:all"];
  for (const tag of COPY_EXCLUDED_TAGS) args.push(`--${tag}`);
  if (sidecarPath) {
    args.push("-TagsFromFile", sidecarPath, "-XMP-xmp:Rating", "-XMP-xmp:Label", "-XMP-dc:all", "-XMP-photoshop:all", "-XMP-iptcCore:all");
  }
  args.push(`-Orientation#=${orientation}`);
  return args;
}

/** Copia EXIF/MakerNotes/GPS/IPTC/XMP dal RAW (e dall'XMP affiancato) sul file convertito. */
export async function copyRawMetadata(rawPath: string, outputPath: string, sidecarPath: string | null, orientation = 1): Promise<void> {
  await getExifTool().write(outputPath, {}, { writeArgs: buildMetadataCopyArgs(rawPath, sidecarPath, orientation) });
}
