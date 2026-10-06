import { DEFAULT_AUTO_BUILD, autoBuildAlbum } from "../model/autobuild";
import { makeAsset, makeProject } from "../model/fixtures";
import type { Project } from "../model/project";
import { approximateMeasure } from "../render/text-layout";
import { defaultBrand } from "./brand";
import { envFor, planCarousel } from "./plan";
import type { RenderMedia } from "./render";
import { templateOf } from "./templates";
import type { Carousel, Slide, SocialFormatId } from "./types";

/** Dati di prova condivisi dai test dei caroselli (non usato dall'app). */

/** Album con 40 foto di forme diverse, un panorama, una foto scartata e quattro doppie pagine. */
export function album(options: { photos?: number; panorama?: boolean; spreads?: boolean } = {}): Project {
  const count = options.photos ?? 40;
  let project = makeProject(count);
  const assets = project.assets.map((asset) => ({ ...asset }));
  if (options.panorama !== false && count > 7) assets[7] = makeAsset(7, { width: 7200, height: 3000, aspectRatio: 2.4, orientation: "horizontal", rating: 5 });
  if (count > 2) assets[2] = { ...assets[2], pickStatus: "rejected", rating: 5 };
  project = { ...project, assets };
  if (options.spreads !== false && count >= 8) project = autoBuildAlbum(project, { ...DEFAULT_AUTO_BUILD, photosPerArea: 3 });
  return project;
}

export const measure = approximateMeasure;
export const envOf = (project: Project) => envFor(project, measure);

export const plan = (project: Project, overrides: Partial<Parameters<typeof planCarousel>[1]> = {}): Carousel =>
  planCarousel(project, { setId: "editoriale", format: "feed", count: 8, brand: defaultBrand(project.projectName), ...overrides });

/** Una slide con quel modello, foto vere negli spazi e testi predefiniti. */
export function slideFor(templateId: string, project: Project, offset = 0): Slide {
  const template = templateOf(templateId)!;
  const photos = template.slots.map((_, index) => project.assets.filter((asset) => asset.pickStatus !== "rejected")[(offset + index) % 30].id);
  return { id: `s-${templateId}`, templateId, photos, texts: {}, ...(template.needsSpread ? { spreadId: project.spreads[0].id, spreadId2: project.spreads[1]?.id ?? null } : {}) };
}

export const withSlides = (carousel: Carousel, slides: Slide[], format: SocialFormatId = carousel.format): Carousel => ({ ...carousel, format, slides });

export function allMedia(project: Project): RenderMedia {
  return {
    photos: new Map(project.assets.map((asset) => [asset.id, { url: `blob:photo-${asset.id}`, ...(asset.rotationDegrees ? { rotation: asset.rotationDegrees } : {}) }])),
    spreads: new Map(project.spreads.map((spread) => [spread.id, `blob:spread-${spread.id}`])),
  };
}
