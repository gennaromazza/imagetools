import { newId } from "../model/ids";
import { nowIso, type Project } from "../model/project";
import { framingEquals, normalizeFraming } from "./framing";
import { normalizeTextStyles } from "./textstyle";
import { pickForSlot, pickReused, rankPhotos, rankSpreads, type RankedPhoto } from "./plan";
import { FLEX_TONE_IDS, arcFor, setInfo, templateOf, toneForFlex } from "./templates";
import { MAX_SLIDES, MIN_SLIDES, type BrandKit, type Carousel, type PhotoFraming, type Slide, type SlotKind, type SocialFormatId, type Tone } from "./types";

/** Modifiche al carosello: funzioni pure `(carousel, …) => carousel`. Se non cambia nulla restituiscono lo stesso oggetto. */

export const touch = (carousel: Carousel): Carousel => ({ ...carousel, updatedAt: nowIso() });

export function mapSlide(carousel: Carousel, slideId: string, fn: (slide: Slide) => Slide): Carousel {
  let changed = false;
  const slides = carousel.slides.map((slide) => {
    if (slide.id !== slideId) return slide;
    const next = fn(slide);
    if (next !== slide) changed = true;
    return next;
  });
  return changed ? touch({ ...carousel, slides }) : carousel;
}

/** Come `mapSlide`, ma un panorama si modifica sempre per intero: le sue parti devono restare identiche per testi, tono e foto. */
export function mapGroup(carousel: Carousel, slideId: string, fn: (slide: Slide) => Slide): Carousel {
  const index = carousel.slides.findIndex((slide) => slide.id === slideId);
  if (index < 0) return carousel;
  const [from, to] = spanRange(carousel, index);
  let changed = false;
  const slides = carousel.slides.map((slide, at) => {
    if (at < from || at > to) return slide;
    const next = fn(slide);
    if (next !== slide) changed = true;
    return next;
  });
  return changed ? touch({ ...carousel, slides }) : carousel;
}

export function renameCarousel(carousel: Carousel, name: string): Carousel {
  const clean = name.trim().slice(0, 60);
  return clean && clean !== carousel.name ? touch({ ...carousel, name: clean }) : carousel;
}

/** «Tienilo così»: si prende atto che le stelle sono cambiate e non si chiede più. */
export function acceptSelection(carousel: Carousel, basis: string): Carousel {
  return carousel.basis === basis ? carousel : touch({ ...carousel, basis });
}

export function setCaption(carousel: Carousel, caption: string): Carousel {
  return caption === carousel.caption ? carousel : touch({ ...carousel, caption: caption.slice(0, 2200) });
}

export function setFormat(carousel: Carousel, format: SocialFormatId): Carousel {
  return format === carousel.format ? carousel : touch({ ...carousel, format });
}

export function updateBrand(carousel: Carousel, patch: Partial<BrandKit>): Carousel {
  const brand = { ...carousel.brand, ...patch };
  const same = (Object.keys(brand) as Array<keyof BrandKit>).every((key) => brand[key] === carousel.brand[key]);
  return same ? carousel : touch({ ...carousel, brand });
}

export function setSlideText(carousel: Carousel, slideId: string, key: string, value: string): Carousel {
  return mapGroup(carousel, slideId, (slide) => (slide.texts[key] === value ? slide : { ...slide, texts: { ...slide.texts, [key]: value.slice(0, 600) } }));
}

export function resetSlideText(carousel: Carousel, slideId: string, key: string): Carousel {
  return mapGroup(carousel, slideId, (slide) => {
    if (!(key in slide.texts)) return slide;
    const { [key]: _removed, ...texts } = slide.texts;
    return { ...slide, texts };
  });
}

export function setSlideTone(carousel: Carousel, slideId: string, tone: Tone | undefined): Carousel {
  return mapGroup(carousel, slideId, (slide) => {
    if (slide.tone === tone) return slide;
    const { tone: _old, ...rest } = slide;
    return tone ? { ...rest, tone } : rest;
  });
}

/** Mette una foto in uno spazio; se la stessa foto è già in un altro spazio della slide, le due si scambiano. */
export function setSlidePhoto(carousel: Carousel, slideId: string, slot: number, assetId: string | null): Carousel {
  const at = carousel.slides.findIndex((slide) => slide.id === slideId);
  if (at >= 0 && carousel.slides[at].span) return slot === 0 && carousel.slides[at].photos[0] !== assetId ? setSpanPhoto(carousel, at, assetId) : carousel;
  return mapSlide(carousel, slideId, (slide) => {
    if (slot < 0 || slot >= slide.photos.length || slide.photos[slot] === assetId) return slide;
    const photos = [...slide.photos];
    const framing = slide.framing ? [...slide.framing] : null;
    const other = assetId ? photos.findIndex((id, index) => index !== slot && id === assetId) : -1;
    if (other >= 0) { photos[other] = photos[slot]; if (framing) [framing[other], framing[slot]] = [framing[slot] ?? null, framing[other] ?? null]; }
    else if (framing) framing[slot] = null;
    photos[slot] = assetId;
    const { framing: _old, ...rest } = slide;
    return { ...rest, photos, ...(framing && framing.some(Boolean) ? { framing } : {}) };
  });
}

/** Le foto di una slide da usare per i panorami: tutte le slide dello stesso panorama devono mostrare la stessa foto. */
export function spanRange(carousel: Carousel, index: number): [number, number] {
  const slide = carousel.slides[index];
  if (!slide?.span) return [index, index];
  let start = index - slide.span.index;
  start = Math.max(0, start);
  return [start, Math.min(carousel.slides.length - 1, start + slide.span.count - 1)];
}

function setSpanPhoto(carousel: Carousel, index: number, assetId: string | null): Carousel {
  const [from, to] = spanRange(carousel, index);
  const slides = carousel.slides.map((slide, at) => {
    if (at < from || at > to) return slide;
    const { framing: _old, ...rest } = slide;
    return { ...rest, photos: [assetId] };
  });
  return touch({ ...carousel, slides });
}

/** Cambia la foto di una slide; in un panorama la cambia su tutte le slide che lo compongono. */
export function replacePhoto(carousel: Carousel, slideId: string, slot: number, assetId: string | null): Carousel {
  const index = carousel.slides.findIndex((slide) => slide.id === slideId);
  if (index < 0) return carousel;
  if (carousel.slides[index].span) return carousel.slides[index].photos[0] === assetId ? carousel : setSpanPhoto(carousel, index, assetId);
  return setSlidePhoto(carousel, slideId, slot, assetId);
}

export function usedAssetIds(carousel: Carousel): Set<string> {
  const used = new Set<string>();
  for (const slide of carousel.slides) for (const id of slide.photos) if (id) used.add(id);
  return used;
}

/** La foto per uno spazio: una nuova se c'è, altrimenti la migliore tra quelle già usate (meno ripetuta, mai due volte nella stessa slide). */
function choosePhoto(kind: SlotKind, pool: readonly RankedPhoto[], taken: ReadonlySet<string>, carousel: Carousel, current: ReadonlyArray<string | null>): RankedPhoto | null {
  const uses = new Map<string, number>();
  for (const slide of carousel.slides) for (const id of slide.photos) if (id) uses.set(id, (uses.get(id) ?? 0) + 1);
  return pickForSlot(kind, pool, taken, new Map()) ?? pickReused(kind, pool, uses, new Set(current.filter((id): id is string => Boolean(id))));
}

/** Foto dell'album non ancora usate nel carosello, dalla più adatta. */
export function unusedRanked(carousel: Carousel, project: Project): RankedPhoto[] {
  const used = usedAssetIds(carousel);
  return rankPhotos(project).filter((photo) => !used.has(photo.assetId));
}

/** Cambia il modello di una slide tenendo le foto negli stessi spazi, completando quelli nuovi con le foto migliori ancora libere. */
export function setSlideTemplate(carousel: Carousel, project: Project, slideId: string, templateId: string): Carousel {
  const template = templateOf(templateId);
  if (!template) return carousel;
  return mapSlide(carousel, slideId, (slide) => {
    // Un panorama non cambia modello a pezzi: per toglierlo si elimina e si aggiunge un'altra slide.
    if (slide.templateId === templateId || slide.span) return slide;
    const taken = new Set(usedAssetIds(carousel));
    const pool = rankPhotos(project);
    const photos = template.slots.map((kind, index) => {
      const keep = slide.photos[index];
      if (keep) return keep;
      const pick = choosePhoto(kind, pool, taken, carousel, slide.photos);
      if (pick) taken.add(pick.assetId);
      return pick?.assetId ?? null;
    });
    const texts: Record<string, string> = {};
    for (const field of template.fields) if (slide.texts[field.key] !== undefined) texts[field.key] = slide.texts[field.key];
    const ranked = template.needsSpread ? rankSpreads(project, pool) : [];
    const spreadId = template.needsSpread ? slide.spreadId ?? ranked[0] ?? null : null;
    const spreadId2 = template.needsSpread ? slide.spreadId2 ?? ranked.find((id) => id !== spreadId) ?? null : null;
    const { span: _span, spreadId: _spread, spreadId2: _spread2, framing: _framing, textStyle: _style, ...rest } = slide;
    const textStyle = normalizeTextStyles(slide.textStyle, template.fields.map((field) => field.key));
    return { ...rest, templateId, photos, texts, ...(textStyle ? { textStyle } : {}), ...(spreadId ? { spreadId } : {}), ...(spreadId2 ? { spreadId2 } : {}) };
  });
}

/** Sceglie la doppia pagina da mostrare: `which` 1 = la principale, 2 = la seconda (facoltativa). */
/**
 * Cambia l'inquadratura di una foto (zoom, punto centrale, forma). `null` torna a quella predefinita. In un panorama vale per tutte le parti
 * e la forma non si può cambiare.
 */
export function setSlideFraming(carousel: Carousel, slideId: string, slot: number, patch: Partial<PhotoFraming> | null): Carousel {
  return mapGroup(carousel, slideId, (slide) => {
    if (slot < 0 || slot >= slide.photos.length) return slide;
    const next = patch === null ? null : normalizeFraming({ ...(slide.framing?.[slot] ?? {}), ...patch }, !slide.span);
    if (framingEquals(slide.framing?.[slot], next)) return slide;
    const framing = Array.from({ length: slide.photos.length }, (_, index) => (index === slot ? next : slide.framing?.[index] ?? null));
    const { framing: _old, ...rest } = slide;
    return framing.some(Boolean) ? { ...rest, framing } : rest;
  });
}

/** Disposizione speculare (destra e sinistra si scambiano). Un panorama non si specchia. */
export function setSlideFlip(carousel: Carousel, slideId: string, flip: boolean): Carousel {
  return mapSlide(carousel, slideId, (slide) => {
    if (slide.span || Boolean(slide.flip) === flip) return slide;
    const { flip: _old, ...rest } = slide;
    return flip ? { ...rest, flip: true } : rest;
  });
}

export function setSlideSpread(carousel: Carousel, slideId: string, which: 1 | 2, spreadId: string | null): Carousel {
  const key = which === 1 ? "spreadId" : "spreadId2";
  return mapSlide(carousel, slideId, (slide) => ((slide[key] ?? null) === spreadId ? slide : { ...slide, [key]: spreadId }));
}

// ---------------------------------------------------------------------------
// Ordine e numero delle slide
// ---------------------------------------------------------------------------

/** Le slide raggruppate in blocchi: una slide sola, oppure tutte le parti di un panorama (che non si separano mai). */
function blocksOf(carousel: Carousel): Slide[][] {
  const blocks: Slide[][] = [];
  let index = 0;
  while (index < carousel.slides.length) {
    const [from, to] = spanRange(carousel, index);
    blocks.push(carousel.slides.slice(from, to + 1));
    index = to + 1;
  }
  return blocks;
}

/** Sposta una slide (o un intero panorama) di una posizione. */
export function moveSlide(carousel: Carousel, slideId: string, delta: -1 | 1): Carousel {
  const blocks = blocksOf(carousel);
  const at = blocks.findIndex((block) => block.some((slide) => slide.id === slideId));
  const to = at + delta;
  if (at < 0 || to < 0 || to >= blocks.length) return carousel;
  [blocks[at], blocks[to]] = [blocks[to], blocks[at]];
  return touch({ ...carousel, slides: blocks.flat() });
}

export function removeSlide(carousel: Carousel, slideId: string): Carousel {
  const index = carousel.slides.findIndex((slide) => slide.id === slideId);
  if (index < 0) return carousel;
  const [from, to] = spanRange(carousel, index);
  const remaining = carousel.slides.length - (to - from + 1);
  if (remaining < MIN_SLIDES) return carousel;
  return touch({ ...carousel, slides: [...carousel.slides.slice(0, from), ...carousel.slides.slice(to + 1)] });
}

export function duplicateSlide(carousel: Carousel, slideId: string): Carousel {
  const index = carousel.slides.findIndex((slide) => slide.id === slideId);
  if (index < 0 || carousel.slides[index].span || carousel.slides.length >= MAX_SLIDES) return carousel;
  const copy: Slide = { ...carousel.slides[index], id: newId("sl"), photos: [...carousel.slides[index].photos], texts: { ...carousel.slides[index].texts } };
  const slides = [...carousel.slides.slice(0, index + 1), copy, ...carousel.slides.slice(index + 1)];
  return touch({ ...carousel, slides });
}

/** Aggiunge una slide dopo quella indicata (o in fondo), con le foto migliori ancora libere. */
export function addSlide(carousel: Carousel, project: Project, templateId: string, afterSlideId?: string): Carousel {
  const template = templateOf(templateId);
  if (!template || carousel.slides.length >= MAX_SLIDES) return carousel;
  const taken = usedAssetIds(carousel);
  const pool = rankPhotos(project);
  const chosen: Array<string | null> = [];
  const photos = template.slots.map((kind) => {
    const pick = choosePhoto(kind, pool, taken, carousel, chosen);
    if (pick) taken.add(pick.assetId);
    chosen.push(pick?.assetId ?? null);
    return pick?.assetId ?? null;
  });
  const ranked = template.needsSpread ? rankSpreads(project, pool) : [];
  const slide: Slide = { id: newId("sl"), templateId, photos, texts: {}, ...(template.needsSpread ? { spreadId: ranked[0] ?? null, spreadId2: ranked[1] ?? null } : {}) };
  const after = afterSlideId ? carousel.slides.findIndex((candidate) => candidate.id === afterSlideId) : carousel.slides.length - 1;
  let at = after < 0 ? carousel.slides.length : after + 1;
  if (after >= 0) at = spanRange(carousel, after)[1] + 1;
  return touch({ ...carousel, slides: [...carousel.slides.slice(0, at), slide, ...carousel.slides.slice(at)] });
}

/**
 * Porta il carosello al numero di slide voluto (2-20) senza buttare il lavoro fatto. Si aggiunge e si toglie sempre
 * subito prima della chiusura: copertina, chiusura, panorami e mockup dell'album restano dove sono.
 * Le slide nuove seguono la trama dello stile, scegliendo ogni volta il modello meno usato e con testi diversi nelle ripetizioni.
 */
export function resizeCarousel(carousel: Carousel, project: Project, count: number): Carousel {
  const target = Math.max(MIN_SLIDES, Math.min(MAX_SLIDES, Math.round(count)));
  const set = setInfo(carousel.setId);
  let next = carousel;
  while (next.slides.length < target) {
    const counts = new Map<string, number>();
    for (const slide of next.slides) counts.set(slide.templateId, (counts.get(slide.templateId) ?? 0) + 1);
    const templateId = arcFor(set, carousel.seed ?? 0).middle.sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0))[0];
    const penultimate = next.slides[Math.max(0, next.slides.length - 2)];
    const added = addSlide(next, project, templateId, penultimate.id);
    if (added === next) break;
    const position = added.slides.findIndex((slide) => !next.slides.some((old) => old.id === slide.id));
    const template = templateOf(templateId)!;
    const occurrence = counts.get(templateId) ?? 0;
    const variant = occurrence > 0 && template.variants?.length ? template.variants[(occurrence - 1) % template.variants.length] : undefined;
    next = touch({
      ...added,
      slides: added.slides.map((slide, index) => (index === position
        ? { ...slide, ...(variant ? { texts: { ...variant } } : {}), ...(FLEX_TONE_IDS.has(templateId) ? { tone: toneForFlex(set, position) } : {}) }
        : slide)),
    });
  }
  while (next.slides.length > target) {
    let at = -1;
    for (let index = next.slides.length - 2; index >= 1; index -= 1) {
      const slide = next.slides[index];
      if (!slide.span && slide.templateId !== "sh-mockup") { at = index; break; }
    }
    if (at < 0) break;
    next = removeSlide(next, next.slides[at].id);
  }
  return next;
}

/** Distende una foto su 2-4 slide consecutive (il panorama che invita a scorrere). */
export function addPanorama(carousel: Carousel, assetId: string, count: number, afterSlideId?: string): Carousel {
  const parts = Math.max(2, Math.min(4, Math.round(count)));
  if (carousel.slides.length + parts > MAX_SLIDES) return carousel;
  const slides: Slide[] = Array.from({ length: parts }, (_, index) => ({ id: newId("sl"), templateId: "sh-pano", photos: [assetId], texts: {}, span: { index, count: parts } }));
  const after = afterSlideId ? carousel.slides.findIndex((candidate) => candidate.id === afterSlideId) : carousel.slides.length - 1;
  const at = after < 0 ? carousel.slides.length : spanRange(carousel, after)[1] + 1;
  return touch({ ...carousel, slides: [...carousel.slides.slice(0, at), ...slides, ...carousel.slides.slice(at)] });
}
