import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { getCompositeImageData, initializeCanvas, readPsd } from "ag-psd";
import type { DesktopRenderedImage } from "@photo-tools/desktop-contracts";

const PSD_EXTENSION = ".psd";
const MAX_PSD_INPUT_BYTES = 512 * 1024 * 1024;
const MAX_PSD_PIXELS = 80_000_000;
const MAX_PSD_DECODE_BYTES = 384 * 1024 * 1024;
const DEFAULT_JPEG_QUALITY = 100;

let sharpModule: typeof import("sharp") | null | undefined;

// ag-psd usa Canvas solo per allocare ImageData durante la decodifica. Nel
// main process non c'è un DOM: forniamo il minimo necessario e passiamo poi i
// pixel RGBA direttamente a sharp, senza dipendenza da node-canvas.
initializeCanvas(
  () => {
    throw new Error("Canvas non richiesto per la lettura del composito PSD.");
  },
  (width, height) => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  }) as ImageData,
);

async function getSharp(): Promise<typeof import("sharp") | null> {
  if (sharpModule !== undefined) {
    return sharpModule;
  }

  try {
    sharpModule = (await import("sharp")).default as unknown as typeof import("sharp");
  } catch {
    sharpModule = null;
  }
  return sharpModule;
}

export function isPsdPath(absolutePath: string): boolean {
  return extname(absolutePath).toLowerCase() === PSD_EXTENSION;
}

function clampJpegQuality(quality: number): number {
  return Math.max(80, Math.min(100, Math.round(quality)));
}

function validatePsdDocument(document: {
  width: number;
  height: number;
  bitsPerChannel?: number;
  colorMode?: number;
}): void {
  const width = Math.round(document.width);
  const height = Math.round(document.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Il PSD non dichiara dimensioni valide.");
  }
  if (width * height > MAX_PSD_PIXELS) {
    throw new Error("Il PSD supera il limite di sicurezza di 80 megapixel.");
  }
  if (document.bitsPerChannel !== 8 || document.colorMode !== 3) {
    throw new Error("Sono supportati PSD RGB a 8 bit per canale.");
  }
}

/**
 * Decodifica esclusivamente il composito già salvato nel PSD. Non interpreta o
 * ricompone i livelli e quindi restituisce esattamente l'aspetto visibile
 * dell'ultimo salvataggio in Photoshop.
 */
export async function renderPsdCompositeToJpeg(
  absolutePath: string,
  options: { maxDimension?: number; quality?: number } = {},
): Promise<DesktopRenderedImage | null> {
  if (!isPsdPath(absolutePath)) {
    return null;
  }

  const source = await readFile(absolutePath);
  if (source.byteLength <= 0 || source.byteLength > MAX_PSD_INPUT_BYTES) {
    throw new Error("Il PSD supera il limite di lettura sicura di 512 MB.");
  }

  const document = readPsd(source, {
    skipLayerImageData: true,
    skipThumbnail: true,
    useRawData: true,
    totalMemoryLimit: MAX_PSD_DECODE_BYTES,
  });
  validatePsdDocument(document);

  const composite = getCompositeImageData(document);
  if (!composite || composite.data.byteLength === 0) {
    throw new Error("Il PSD non contiene un composito visibile esportabile.");
  }
  if (composite.data.BYTES_PER_ELEMENT !== 1 || composite.data.length !== composite.width * composite.height * 4) {
    throw new Error("Il composito PSD non usa il formato RGBA a 8 bit previsto.");
  }

  const sharp = await getSharp();
  if (!sharp) {
    throw new Error("Il motore immagine locale non è disponibile.");
  }

  const maxDimension = Math.max(0, Math.round(options.maxDimension ?? 0));
  let pipeline = sharp(
    Buffer.from(composite.data.buffer, composite.data.byteOffset, composite.data.byteLength),
    { raw: { width: composite.width, height: composite.height, channels: 4 } },
  )
    .flatten({ background: "#ffffff" });

  if (maxDimension > 0) {
    pipeline = pipeline.resize(maxDimension, maxDimension, {
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  const { data, info } = await pipeline
    .jpeg({
      quality: clampJpegQuality(options.quality ?? DEFAULT_JPEG_QUALITY),
      chromaSubsampling: "4:4:4",
    })
    .toBuffer({ resolveWithObject: true });

  if (!info.width || !info.height) {
    throw new Error("Il composito PSD non ha prodotto un JPEG valido.");
  }

  return {
    bytes: new Uint8Array(data),
    mimeType: "image/jpeg",
    width: info.width,
    height: info.height,
  };
}
