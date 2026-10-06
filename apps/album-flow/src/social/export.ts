import { assetToDataUrl } from "../hooks/useAssetSrc";
import type { Project } from "../model/project";
import { canvasMeasure, embeddedFontCss, loadFonts } from "../render/fonts";
import { designForExport, embedSpreadAssets, svgToJpegBytes } from "../render/export";
import { renderSpreadSvg } from "../render/spread-svg";
import type { ExportWriter } from "../render/export-core";
import { spreadSizeMm } from "../engine/geometry";
import { brandFontIds } from "./brand";
import { exportCarouselWith, type SocialExportOptions } from "./export-core";
import { renderSlideSvg, type RenderMedia } from "./render";
import { envFor, PANORAMA_ASPECT } from "./plan";
import { usedAssetIds } from "./edit";
import type { Carousel } from "./types";

export { slideFileName } from "./export-core";

/** Foto e doppie pagine del carosello come immagini incorporate; `maxDimension` è il lato lungo massimo di ogni foto. */
export async function prepareMedia(project: Project, carousel: Carousel, maxDimension: number, withFonts: boolean): Promise<RenderMedia> {
  const photos = new Map<string, { url: string; rotation?: 0 | 90 | 180 | 270 }>();
  for (const id of usedAssetIds(carousel)) {
    const asset = project.assets.find((candidate) => candidate.id === id);
    if (!asset) continue;
    const wide = asset.width / Math.max(1, asset.height) >= PANORAMA_ASPECT;
    const url = await assetToDataUrl(asset, wide ? Math.round(maxDimension * 1.5) : maxDimension);
    if (url) photos.set(id, { url, ...(asset.rotationDegrees ? { rotation: asset.rotationDegrees as 90 | 180 | 270 } : {}) });
  }
  const spreads = new Map<string, string>();
  const { width, height } = spreadSizeMm(project.settings.sheet);
  for (const spreadId of new Set(carousel.slides.flatMap((slide) => [slide.spreadId, slide.spreadId2]))) {
    if (!spreadId || spreads.has(spreadId)) continue;
    const index = project.spreads.findIndex((candidate) => candidate.id === spreadId);
    if (index < 0) continue;
    const spread = project.spreads[index];
    const assets = await embedSpreadAssets(project, spread, Math.min(2000, maxDimension));
    const design = await designForExport(spread);
    // Si mostra la pagina rifilata: via l'abbondanza, come uscirebbe dalla stampa.
    const svg = renderSpreadSvg(project, spread, assets, { forPrint: true, design }, index)
      .replace(/viewBox="[^"]*"/, `viewBox="0 0 ${width} ${height}"`)
      .replace(/width="[^"]*mm" height="[^"]*mm"/, `width="${width}mm" height="${height}mm"`);
    spreads.set(spreadId, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  }
  const fonts = brandFontIds(carousel.brand);
  return { photos, spreads, ...(withFonts ? { fontCss: await embeddedFontCss(fonts) } : {}) };
}

/** Esporta una immagine JPG per slide (e il testo del post, se c'è). */
export async function exportCarousel(project: Project, carousel: Carousel, writer: ExportWriter, options: SocialExportOptions): Promise<{ written: string[]; count: number }> {
  await loadFonts(brandFontIds(carousel.brand));
  const env = envFor(project, canvasMeasure);
  const media = await prepareMedia(project, carousel, options.scale === 2 ? 4000 : 2600, true);
  return exportCarouselWith(project.projectName, carousel, writer, options, {
    renderSvg: async (index) => renderSlideSvg(carousel, index, env, media, { idPrefix: `x${index}` }),
    toJpeg: svgToJpegBytes,
  });
}
