import { resolveTexts, templateForSlide } from "./build";
import { mapGroup, spanRange } from "./edit";
import { normalizeText } from "./kit";
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

export interface TextRepeat {
  /** Slide (da 0) dove la frase compare di nuovo. */
  slideIndex: number;
  key: string;
  /** Prima slide (da 0) dove compare. */
  firstIndex: number;
  text: string;
}

/**
 * Le frasi che compaiono più volte nel carosello (titoli, parole, frasi e testi: non nomi, date o luoghi, che è giusto ripetere).
 * Si conta ciò che si vede, compresi i testi proposti dal modello; le parti di un panorama contano una volta sola.
 */
export function repeatedTexts(carousel: Carousel, albumName: string): TextRepeat[] {
  const first = new Map<string, number>();
  const repeats: TextRepeat[] = [];
  // Nome dello studio, profilo e nome dell'album compaiono in più slide per scelta: non sono ripetizioni.
  const identity = new Set([carousel.brand.name, carousel.brand.handle, albumName].map(normalizeText).filter(Boolean));
  carousel.slides.forEach((slide, slideIndex) => {
    if (slide.span && slide.span.index > 0) return;
    const template = templateForSlide(carousel, slide);
    const shown = resolveTexts(template, slide, carousel.brand, albumName);
    for (const field of template.fields) {
      if (suggestKindOf(field.key) === null || slide.hidden?.includes(`f:${field.key}`)) continue;
      const text = shown[field.key] ?? "";
      const key = normalizeText(text);
      if (key.length < 6 || identity.has(key)) continue;
      const before = first.get(key);
      if (before === undefined) first.set(key, slideIndex);
      else if (before !== slideIndex) repeats.push({ slideIndex, key: field.key, firstIndex: before, text });
    }
  });
  return repeats;
}

/** Sostituisce ogni frase ripetuta (dalla seconda volta in poi) con un'altra proposta dalla libreria, diversa da tutte quelle del carosello. */
export function dedupeTexts(carousel: Carousel, albumName: string): Carousel {
  let next = carousel;
  for (let round = 0; round < 3; round += 1) {
    const repeats = repeatedTexts(next, albumName);
    if (repeats.length === 0) break;
    const before = next;
    for (const repeat of repeats) {
      const slide = next.slides[repeat.slideIndex];
      const field = templateOf(slide.templateId)?.fields.find((candidate) => candidate.key === repeat.key);
      const kind = suggestKindOf(repeat.key);
      if (!field || !kind) continue;
      const avoid = usedTexts(next);
      for (const other of next.slides) { const template = templateOf(other.templateId); if (template) for (const value of Object.values(resolveTexts(template, other, next.brand, albumName))) if (value.trim()) avoid.add(value); }
      const text = suggestText(kind, { seed: `${slide.id}:${repeat.key}:dedupe:${round}`, attempt: 0, current: repeat.text, avoid, setId: next.setId, multiline: field.multiline });
      if (!text) continue;
      next = mapGroup(next, slide.id, (target) => ({ ...target, texts: { ...target.texts, [repeat.key]: text } }));
    }
    if (next === before) break;
  }
  return next;
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
