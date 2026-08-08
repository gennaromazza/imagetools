import { extname } from "node:path";
import { ExifTool } from "exiftool-vendored";

const EMBEDDED_XMP_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".dng",
  ".tif",
  ".tiff",
  ".psd",
]);

const metadataExifTool = new ExifTool({
  maxProcs: 2,
  spawnTimeoutMillis: 60_000,
  taskTimeoutMillis: 60_000,
});

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function extractStandardXmpProperties(xml: string): { rating: number; label: string | null } | null {
  const ratingMatch = /\bxmp:Rating\s*=\s*["']\s*(-?\d+(?:\.\d+)?)\s*["']/i.exec(xml);
  if (!ratingMatch) {
    return null;
  }

  const parsedRating = Number(ratingMatch[1]);
  if (!Number.isFinite(parsedRating) || parsedRating < -1 || parsedRating > 5) {
    return null;
  }

  const labelMatch = /\bxmp:Label\s*=\s*["']([^"']*)["']/i.exec(xml);
  return {
    rating: parsedRating < 0 ? -1 : Math.round(parsedRating),
    label: labelMatch ? decodeXmlAttribute(labelMatch[1].trim()) : null,
  };
}

export async function writeEmbeddedStandardXmp(absolutePath: string, xml: string): Promise<boolean> {
  if (!EMBEDDED_XMP_EXTENSIONS.has(extname(absolutePath).toLowerCase())) {
    return true;
  }

  const properties = extractStandardXmpProperties(xml);
  if (!properties) {
    return false;
  }

  try {
    await metadataExifTool.write(
      absolutePath,
      {},
      {
        ignoreMinorErrors: true,
        useMWG: false,
        writeArgs: [
          `-XMP-xmp:Rating=${properties.rating}`,
          `-XMP-xmp:Label=${properties.label ?? ""}`,
          "-XMP-microsoft:RatingPercent=",
          "-EXIF:Rating=",
          "-EXIF:RatingPercent=",
          "-overwrite_original",
        ],
      },
    );
    return true;
  } catch {
    return false;
  }
}

export async function readEmbeddedStandardRating(absolutePath: string): Promise<number | null> {
  const tags = await metadataExifTool.read(absolutePath);
  return typeof tags.Rating === "number" ? tags.Rating : null;
}

export async function shutdownXmpCompatibilityService(): Promise<void> {
  await metadataExifTool.end().catch(() => {});
}
