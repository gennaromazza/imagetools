import { useEffect, useState, useSyncExternalStore } from "react";
import type { AlbumAssetV2 } from "@photo-tools/shared-types";
import { bucketFor, cachedImage, getDesktop, imageAsDataUrl, imagesVersion, requestImage, subscribeImages } from "../desktop/api";

/**
 * Sorgente immagine di una foto, della dimensione richiesta (pixel sul lato lungo):
 * dal processo desktop con cache condivisa se c'è un percorso, altrimenti anteprima incorporata (browser, demo).
 */
export function useAssetSrc(asset: AlbumAssetV2 | undefined, pixels: number): string {
  const embedded = asset?.previewUrl ?? asset?.thumbnailUrl ?? "";
  const path = asset?.absolutePath;
  const desktop = Boolean(path) && Boolean(getDesktop());
  // Cambia quando un file è stato modificato sul disco: l'immagine si rilegge.
  const version = useSyncExternalStore(subscribeImages, imagesVersion);
  const [src, setSrc] = useState<string>(() => (desktop && path ? cachedImage(path, pixels) ?? "" : embedded));

  useEffect(() => {
    if (!desktop || !path) { setSrc(embedded); return; }
    const hit = cachedImage(path, pixels);
    if (hit) { setSrc(hit); return; }
    setSrc("");
    return requestImage(path, bucketFor(pixels), (url) => setSrc(url ?? embedded));
  }, [desktop, path, pixels, embedded, version]);

  return src;
}

/** Immagine come data URL per esportare SVG/JPG autonomi: dal desktop se possibile, altrimenti dall'anteprima incorporata. */
export async function assetToDataUrl(asset: AlbumAssetV2, maxDimension: number): Promise<string | null> {
  if (asset.absolutePath && getDesktop()) {
    const fromDesktop = await imageAsDataUrl(asset.absolutePath, maxDimension);
    if (fromDesktop) return fromDesktop;
  }
  const source = asset.previewUrl ?? asset.thumbnailUrl;
  if (!source) return null;
  if (source.startsWith("data:image/")) return source;
  try {
    const blob = await (await fetch(source)).blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
