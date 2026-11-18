import type { AlbumAssetV2 } from "@photo-tools/shared-types";
import { assetToDataUrl } from "../hooks/useAssetSrc";

/** Lato lungo del campione: poche migliaia di pixel bastano per misurare l'aspetto di una foto e tengono veloce l'abbinamento. */
const SAMPLE_PIXELS = 64;

/**
 * Campione di pixel RGBA (0-255) di una foto così com'è nel file, senza la correzione colore: una miniatura ridotta.
 * Restituisce `null` se l'immagine non si può leggere (file mancante, browser senza canvas).
 */
export async function sampleAsset(asset: AlbumAssetV2): Promise<Uint8ClampedArray | null> {
  try {
    const url = await assetToDataUrl(asset, 200);
    if (!url || typeof document === "undefined") return null;
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = SAMPLE_PIXELS / Math.max(image.naturalWidth, image.naturalHeight, 1);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);
    return context.getImageData(0, 0, width, height).data;
  } catch {
    return null;
  }
}

/** I campioni di più foto in una volta; chi non si legge resta fuori. */
export async function sampleAssets(assets: readonly AlbumAssetV2[]): Promise<Map<string, Uint8ClampedArray>> {
  const out = new Map<string, Uint8ClampedArray>();
  const samples = await Promise.all(assets.map((asset) => sampleAsset(asset)));
  assets.forEach((asset, index) => { const sample = samples[index]; if (sample) out.set(asset.id, sample); });
  return out;
}
