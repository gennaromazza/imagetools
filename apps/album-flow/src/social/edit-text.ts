import { mapGroup, spanRange } from "./edit";
import { suggestForTemplate, suggestKindOf, suggestText } from "./suggest";
import { normalizeTextStyle } from "./textstyle";
import { templateOf } from "./templates";
import type { Carousel, TextStyleChoice } from "./types";

/** Operazioni sui testi: stile (carattere, corpo, colore, allineamento, maiuscole) e suggerimenti. Funzioni pure come quelle di `edit.ts`. */

/** Cambia lo stile di un testo; `null` torna a quello del modello. In un panorama vale per tutte le parti. */
export function setSlideTextStyle(carousel: Carousel, slideId: string, key: string, patch: Partial<TextStyleChoice> | null): Carousel {
  return mapGroup(carousel, slideId, (slide) => {
    const template = templateOf(slide.templateId);
    if (!template?.fields.some((field) => field.key === key)) return slide;
    const next = patch === null ? null : normalizeTextStyle({ ...(slide.textStyle?.[key] ?? {}), ...patch });
    if (JSON.stringify(next) === JSON.stringify(slide.textStyle?.[key] ?? null)) return slide;
    const { textStyle: _old, ...rest } = slide;
    const merged = { ...(slide.textStyle ?? {}) };
    if (next) merged[key] = next; else delete merged[key];
    return Object.keys(merged).length ? { ...rest, textStyle: merged } : rest;
  });
}

/** I testi già scritti nel carosello, per non riproporli. */
function usedTexts(carousel: Carousel, exceptSlideId?: string): Set<string> {
  const used = new Set<string>();
  for (const slide of carousel.slides) if (slide.id !== exceptSlideId) for (const value of Object.values(slide.texts)) if (value.trim()) used.add(value);
  return used;
}

/** Propone un testo nuovo per un campo (a ogni `attempt` successivo ne esce un altro). Restituisce lo stesso carosello se il campo non è suggeribile. */
export function suggestFieldText(carousel: Carousel, slideId: string, key: string, attempt: number): Carousel {
  const index = carousel.slides.findIndex((slide) => slide.id === slideId);
  const slide = carousel.slides[index];
  const kind = suggestKindOf(key);
  const field = slide ? templateOf(slide.templateId)?.fields.find((candidate) => candidate.key === key) : undefined;
  if (!slide || !kind || !field) return carousel;
  const text = suggestText(kind, { seed: `${slide.id}:${key}`, attempt, current: slide.texts[key] ?? field.fallback({ brand: carousel.brand, albumName: "" }), avoid: usedTexts(carousel), setId: carousel.setId, multiline: field.multiline });
  if (!text) return carousel;
  return mapGroup(carousel, slideId, (target) => (target.texts[key] === text ? target : { ...target, texts: { ...target.texts, [key]: text } }));
}

/** Propone i testi di tutti i campi suggeribili di una slide. */
export function suggestSlideTexts(carousel: Carousel, slideId: string, attempt: number): Carousel {
  const slide = carousel.slides.find((candidate) => candidate.id === slideId);
  const template = slide ? templateOf(slide.templateId) : undefined;
  if (!slide || !template) return carousel;
  const proposals = suggestForTemplate(template, { slideId, attempt, setId: carousel.setId, avoid: usedTexts(carousel, slideId), texts: slide.texts });
  if (Object.keys(proposals).length === 0) return carousel;
  return mapGroup(carousel, slideId, (target) => ({ ...target, texts: { ...target.texts, ...proposals } }));
}

/** Propone i testi per tutto il carosello, senza ripetere la stessa frase due volte. Le slide di un panorama si trattano una volta sola. */
export function suggestCarouselTexts(carousel: Carousel, attempt: number): Carousel {
  let next = carousel;
  let index = 0;
  while (index < carousel.slides.length) {
    const [, to] = spanRange(carousel, index);
    next = suggestSlideTexts(next, carousel.slides[index].id, attempt);
    index = to + 1;
  }
  return next;
}
