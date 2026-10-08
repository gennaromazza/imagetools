import type { TextMeasure } from "../render/text-layout";
import { fontPairOf, paletteOf } from "./brand";
import { mirrorLayers } from "./kit";
import { TEMPLATES, setInfo, templateOf } from "./templates";
import { formatOf, type BrandKit, type Carousel, type FreeFrame, type Layer, type PhotoRef, type Slide, type SlideBuild, type SlideTemplate, type SpreadRef, type TemplateCtx } from "./types";

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

/** Al posto degli spazi foto del modello ci sono le cornici libere, nello stesso punto dell'ordine di disegno (le decorazioni e i testi restano). */
export function withFreeFrames(layers: Layer[], frames: readonly FreeFrame[], width: number, height: number): Layer[] {
  const free: Layer[] = frames.map((frame, index) => ({
    kind: "photo", id: `free-${frame.id}`, slot: index, assetId: frame.assetId,
    x: frame.x * width, y: frame.y * height, w: frame.w * width, h: frame.h * height, mask: frame.mask,
    zoom: frame.zoom, cx: frame.cx, cy: frame.cy,
    ...(frame.rotation ? { rotation: frame.rotation } : {}),
    ...(frame.border ? { border: { w: Math.max(8, Math.round(Math.min(frame.w * width, frame.h * height) * 0.04)), color: "#ffffff" } } : {}),
    ...(frame.shadow ? { shadow: true } : {}),
  }));
  const at = layers.findIndex((layer) => layer.kind === "photo");
  const rest = layers.filter((layer) => layer.kind !== "photo");
  if (at < 0) {
    const firstText = rest.findIndex((layer) => layer.kind === "text");
    const insert = firstText < 0 ? rest.length : firstText;
    return [...rest.slice(0, insert), ...free, ...rest.slice(insert)];
  }
  const before = layers.slice(0, at).filter((layer) => layer.kind !== "photo").length;
  return [...rest.slice(0, before), ...free, ...rest.slice(before)];
}

/** I testi spostati a mano: tutti i livelli di quel campo si muovono insieme. */
export function withTextOffsets(layers: Layer[], offsets: Readonly<Record<string, { dx: number; dy: number }>>, width: number, height: number): Layer[] {
  return layers.map((layer) => {
    if (layer.kind !== "text" || !layer.field) return layer;
    const offset = offsets[layer.field];
    return offset ? { ...layer, x: layer.x + offset.dx * width, y: layer.y + offset.dy * height } : layer;
  });
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
  let layers = slide.flip && !slide.span ? mirrorLayers(built.layers, format.width) : built.layers;
  if (slide.free && !slide.span) layers = withFreeFrames(layers, slide.free, format.width, format.height);
  if (slide.textOffset && !slide.span) layers = withTextOffsets(layers, slide.textOffset, format.width, format.height);
  return { ...built, layers, template };
}
