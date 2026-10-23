import { computeFingerprint, type PhotoFingerprint } from "@photo-tools/photo-similarity";

/** Lato lungo della miniatura usata per l'impronta: basta per raffiche e foto quasi uguali. */
export const FINGERPRINT_MAX_SIDE = 200;

/** Dimensioni ridotte mantenendo le proporzioni; mai ingrandire, mai sotto 1 px. */
export function fingerprintSize(width: number, height: number, maxSide = FINGERPRINT_MAX_SIDE): { width: number; height: number } {
  if (!(width > 0 && height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Chiave della cache: lo stesso file (id + identità sorgente) non si ricalcola nella sessione. */
export const fingerprintCacheKey = (id: string, sourceFileKey?: string) => `${id}|${sourceFileKey ?? ""}`;

function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Impronta di una miniatura già caricata dal Selector (URL blob:), ridotta a 200 px sul lato lungo. */
export async function fingerprintFromThumbnailUrl(url: string): Promise<PhotoFingerprint> {
  const response = await fetch(url);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const { width, height } = fingerprintSize(bitmap.width, bitmap.height);
    if (width === 0) throw new Error("Miniatura vuota.");
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true }) as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;
    if (!context) throw new Error("Canvas 2D non disponibile.");
    context.imageSmoothingQuality = "medium";
    context.drawImage(bitmap, 0, 0, width, height);
    return computeFingerprint(context.getImageData(0, 0, width, height).data, width, height);
  } finally {
    bitmap.close();
  }
}
