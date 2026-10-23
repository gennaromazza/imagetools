import type { AlbumAssetV2 } from "@photo-tools/shared-types";
import { computeFingerprint, type PhotoFingerprint } from "@photo-tools/photo-similarity";
import { getDesktop, requestImage } from "./api";

/** Lato lungo della miniatura da cui si legge l'impronta: la stessa misura delle miniature della libreria (cache condivisa). */
export const FINGERPRINT_PIXELS = 200;

/** URL della miniatura: dal desktop (cache condivisa con la libreria) o dall'anteprima incorporata nel browser. */
function thumbnailUrl(asset: AlbumAssetV2): Promise<string | null> {
  const path = asset.absolutePath;
  if (path && getDesktop()) return new Promise((resolve) => { requestImage(path, FINGERPRINT_PIXELS, resolve); });
  return Promise.resolve(asset.thumbnailUrl ?? asset.previewUrl ?? null);
}

async function pixelsOf(url: string): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  const longSide = Math.max(image.naturalWidth, image.naturalHeight);
  if (!longSide) return null;
  const scale = Math.min(1, FINGERPRINT_PIXELS / longSide);
  const width = Math.max(3, Math.round(image.naturalWidth * scale));
  const height = Math.max(3, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  return { data: context.getImageData(0, 0, width, height).data, width, height };
}

/** Impronta visiva di una foto dalla sua miniatura; null se la miniatura non si legge (file mancante, formato non supportato). */
export async function fingerprintAsset(asset: AlbumAssetV2): Promise<PhotoFingerprint | null> {
  try {
    const url = await thumbnailUrl(asset);
    if (!url) return null;
    const pixels = await pixelsOf(url);
    return pixels ? computeFingerprint(pixels.data, pixels.width, pixels.height) : null;
  } catch {
    return null;
  }
}

/** Modello della fotocamera dai dati di scatto (solo app desktop): serve a non unire in una raffica due corpi diversi. */
export async function readCameraModels(assets: readonly AlbumAssetV2[]): Promise<Map<string, string>> {
  const api = getDesktop();
  const result = new Map<string, string>();
  if (!api?.readCaptureTimes) return result;
  const withPath = assets.filter((asset) => asset.absolutePath);
  for (let offset = 0; offset < withPath.length; offset += 60) {
    const chunk = withPath.slice(offset, offset + 60);
    const readings = await api.readCaptureTimes(chunk.map((asset) => asset.absolutePath!)).catch(() => []);
    const byPath = new Map(readings.map((reading) => [reading.absolutePath, reading.cameraModel]));
    for (const asset of chunk) {
      const model = byPath.get(asset.absolutePath!);
      if (model) result.set(asset.id, model);
    }
  }
  return result;
}
