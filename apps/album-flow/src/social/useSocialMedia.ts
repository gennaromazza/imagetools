import { useEffect, useMemo, useRef, useState } from "react";
import { spreadSizeMm } from "../engine/geometry";
import { assetToDataUrl } from "../hooks/useAssetSrc";
import type { Project } from "../model/project";
import { canvasMeasure, loadFonts } from "../render/fonts";
import { designForExport, embedSpreadAssets } from "../render/export";
import { renderSpreadSvg } from "../render/spread-svg";
import { brandFontIds } from "./brand";
import { envFor } from "./plan";
import type { RenderMedia } from "./render";
import type { BrandKit } from "./types";

/**
 * Immagini per l'anteprima: foto ridotte e pagine dell'album come indirizzi a oggetto (blob), così l'SVG a schermo resta leggero.
 * L'esportazione usa invece immagini incorporate (`prepareMedia`) perché un JPG si ricava da un SVG autonomo.
 */

const photoCache = new Map<string, string>();
const spreadCache = new Map<string, string>();

async function toObjectUrl(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith("data:")) return dataUrl;
  const blob = await (await fetch(dataUrl)).blob();
  return URL.createObjectURL(blob);
}

/** Libera gli indirizzi a oggetto quando la finestra si chiude. */
export function clearPreviewCache(): void {
  for (const url of [...photoCache.values(), ...spreadCache.values()]) if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  photoCache.clear();
  spreadCache.clear();
}

export function usePreviewMedia(project: Project, assetIds: readonly string[], spreadIds: readonly string[], dimension = 1000): RenderMedia {
  const [version, setVersion] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const wanted = assetIds.join("|");
  const wantedSpreads = spreadIds.join("|");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let changed = false;
      for (const id of wanted ? wanted.split("|") : []) {
        const key = `${project.projectId}:${id}:${dimension}`;
        if (photoCache.has(key)) continue;
        const asset = project.assets.find((candidate) => candidate.id === id);
        if (!asset) continue;
        const url = await assetToDataUrl(asset, dimension);
        if (!url || cancelled) continue;
        photoCache.set(key, await toObjectUrl(url));
        changed = true;
      }
      for (const id of wantedSpreads ? wantedSpreads.split("|") : []) {
        const key = `${project.projectId}:${id}:${project.updatedAt}`;
        if (spreadCache.has(key)) continue;
        const index = project.spreads.findIndex((candidate) => candidate.id === id);
        if (index < 0) continue;
        const spread = project.spreads[index];
        const { width, height } = spreadSizeMm(project.settings.sheet);
        const assets = await embedSpreadAssets(project, spread, 1200);
        const design = await designForExport(spread);
        const svg = renderSpreadSvg(project, spread, assets, { forPrint: true, design }, index)
          .replace(/viewBox="[^"]*"/, `viewBox="0 0 ${width} ${height}"`)
          .replace(/width="[^"]*mm" height="[^"]*mm"/, `width="${width}mm" height="${height}mm"`);
        if (cancelled) continue;
        spreadCache.set(key, URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })));
        changed = true;
      }
      if (changed && !cancelled && alive.current) setVersion((value) => value + 1);
    })();
    return () => { cancelled = true; };
  }, [project, wanted, wantedSpreads, dimension]);

  return useMemo(() => {
    const photos = new Map<string, { url: string; rotation?: 0 | 90 | 180 | 270 }>();
    for (const id of wanted ? wanted.split("|") : []) {
      const url = photoCache.get(`${project.projectId}:${id}:${dimension}`);
      const asset = project.assets.find((candidate) => candidate.id === id);
      if (url) photos.set(id, { url, ...(asset?.rotationDegrees ? { rotation: asset.rotationDegrees as 90 | 180 | 270 } : {}) });
    }
    const spreads = new Map<string, string>();
    for (const id of wantedSpreads ? wantedSpreads.split("|") : []) {
      const url = spreadCache.get(`${project.projectId}:${id}:${project.updatedAt}`);
      if (url) spreads.set(id, url);
    }
    return { photos, spreads };
    // `version` cambia quando arriva un'immagine nuova nella cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, wanted, wantedSpreads, dimension, version]);
}

/** Carica i font della marca e restituisce un numero che cambia quando sono pronti (per rimisurare i testi). */
export function useBrandFonts(brand: BrandKit): number {
  const [ready, setReady] = useState(0);
  const key = brandFontIds(brand).join("|");
  useEffect(() => {
    let cancelled = false;
    void loadFonts(key.split("|")).then(() => { if (!cancelled) setReady((value) => value + 1); });
    return () => { cancelled = true; };
  }, [key]);
  return ready;
}

/** Ambiente di disegno per l'anteprima: misura del testo con i font veri. */
export function usePreviewEnv(project: Project) {
  return useMemo(() => envFor(project, canvasMeasure), [project]);
}
