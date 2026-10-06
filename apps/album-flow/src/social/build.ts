import type { TextMeasure } from "../render/text-layout";
import { fontPairOf, paletteOf } from "./brand";
import { mirrorLayers } from "./kit";
import { TEMPLATES, setInfo, templateOf } from "./templates";
import { formatOf, type BrandKit, type Carousel, type PhotoRef, type Slide, type SlideBuild, type SlideTemplate, type SpreadRef, type TemplateCtx } from "./types";

export interface BuildEnv {
  albumName: string;
  photos: ReadonlyMap<string, PhotoRef>;
  spreads: ReadonlyMap<string, SpreadRef>;
  measure: TextMeasure;
}

/** Il modello di una slide; se il file ne cita uno che non esiste più si usa l'apertura dello stile. */
export function templateForSlide(carousel: Carousel, slide: Slide): SlideTemplate {
  return templateOf(slide.templateId) ?? templateOf(setInfo(carousel.setId).arc.open) ?? TEMPLATES[0];
}

/** Testi della slide: quelli scritti dall'utente, oppure il valore proposto dal modello. Un campo svuotato resta vuoto. */
export function resolveTexts(template: SlideTemplate, slide: Slide, brand: BrandKit, albumName: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of template.fields) result[field.key] = slide.texts[field.key] ?? field.fallback({ brand, albumName });
  return result;
}

export function buildSlide(carousel: Carousel, index: number, env: BuildEnv): SlideBuild & { template: SlideTemplate } {
  const slide = carousel.slides[index];
  const template = templateForSlide(carousel, slide);
  const format = formatOf(carousel.format);
  const ctx: TemplateCtx = {
    width: format.width,
    height: format.height,
    brand: carousel.brand,
    pal: paletteOf(carousel.brand.paletteId),
    fonts: fontPairOf(carousel.brand.fontPairId),
    tone: slide.tone ?? template.tone,
    photos: template.slots.map((_, slot) => {
      const id = slide.photos[slot];
      return id ? env.photos.get(id) ?? null : null;
    }),
    framing: template.slots.map((_, slot) => slide.framing?.[slot] ?? null),
    texts: resolveTexts(template, slide, carousel.brand, env.albumName),
    textStyle: slide.textStyle ?? {},
    spread: slide.spreadId ? env.spreads.get(slide.spreadId) ?? null : null,
    spread2: slide.spreadId2 ? env.spreads.get(slide.spreadId2) ?? null : null,
    span: slide.span ?? null,
    index,
    total: carousel.slides.length,
    measure: env.measure,
  };
  const built = template.build(ctx);
  // Un panorama non si specchia: le sue parti devono continuare l'una nell'altra.
  const layers = slide.flip && !slide.span ? mirrorLayers(built.layers, format.width) : built.layers;
  return { ...built, layers, template };
}
