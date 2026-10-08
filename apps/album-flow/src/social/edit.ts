import { newId } from "../model/ids";
import { nowIso, type Project } from "../model/project";
import { framingEquals, normalizeFraming } from "./framing";
import { normalizeTextStyles } from "./textstyle";
import { pickForSlot, pickReused, rankPhotos, rankSpreads, slotFit, type RankedPhoto } from "./plan";
import { FLEX_TONE_IDS, arcFor, setInfo, templateOf, toneForFlex } from "./templates";
import { FREE_MIN_SIZE, MAX_FREE_FRAMES, MAX_SLIDES, MIN_SLIDES, formatOf, photosShown, type BrandKit, type Carousel, type FreeFrame, type Layer, type PhotoFraming, type PhotoLayer, type Slide, type SlotKind, type SocialFormatId, type Tone } from "./types";

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

export interface PhotoSpot { slideId: string; slot: number }

/**
 * Scambia due foto, nella stessa slide o tra slide diverse; se la destinazione è vuota la foto ci si sposta.
 * Restituisce lo stesso carosello (nessuna modifica) se uno dei due spazi è in un panorama, se manca uno spazio, o se la slide di
 * arrivo avrebbe due volte la stessa foto. Tra slide diverse l'inquadratura torna quella predefinita (gli spazi hanno forme diverse).
 */
export function swapPhotos(carousel: Carousel, from: PhotoSpot, to: PhotoSpot): Carousel {
  const a = carousel.slides.findIndex((slide) => slide.id === from.slideId);
  const b = carousel.slides.findIndex((slide) => slide.id === to.slideId);
  if (a < 0 || b < 0) return carousel;
  const slideA = carousel.slides[a];
  const slideB = carousel.slides[b];
  if (slideA.span || slideB.span || slideA.free || slideB.free) return carousel;
  if (from.slot < 0 || from.slot >= slideA.photos.length || to.slot < 0 || to.slot >= slideB.photos.length) return carousel;
  if (a === b && from.slot === to.slot) return carousel;
  const idA = slideA.photos[from.slot];
  const idB = slideB.photos[to.slot];
  if (idA === idB) return carousel;
  if (a === b) {
    const photos = [...slideA.photos];
    const framing = slideA.framing ? [...slideA.framing] : null;
    [photos[from.slot], photos[to.slot]] = [idB, idA];
    if (framing) [framing[from.slot], framing[to.slot]] = [framing[to.slot] ?? null, framing[from.slot] ?? null];
    const { framing: _old, ...rest } = slideA;
    const slides = carousel.slides.map((slide, index) => (index === a ? { ...rest, photos, ...(framing && framing.some(Boolean) ? { framing } : {}) } : slide));
    return touch({ ...carousel, slides });
  }
  // La foto che arriva non deve già essere nella slide di destinazione (e viceversa).
  if ((idA && slideB.photos.some((id, slot) => slot !== to.slot && id === idA)) || (idB && slideA.photos.some((id, slot) => slot !== from.slot && id === idB))) return carousel;
  const place = (slide: Slide, slot: number, id: string | null): Slide => {
    const photos = [...slide.photos];
    photos[slot] = id;
    const framing = slide.framing ? slide.framing.map((item, index) => (index === slot ? null : item)) : null;
    const { framing: _old, ...rest } = slide;
    return { ...rest, photos, ...(framing && framing.some(Boolean) ? { framing } : {}) };
  };
  const slides = carousel.slides.map((slide, index) => (index === a ? place(slideA, from.slot, idB) : index === b ? place(slideB, to.slot, idA) : slide));
  return touch({ ...carousel, slides });
}

/** Lo spazio di una slide dove far cadere una foto: uno vuoto se c'è, altrimenti il più adatto alla sua forma. `null` per i panorami. */
export function bestSlotFor(carousel: Carousel, slideId: string, aspect?: number): number | null {
  const slide = carousel.slides.find((item) => item.id === slideId);
  const template = slide ? templateOf(slide.templateId) : undefined;
  if (!slide || !template || slide.span || slide.free || template.slots.length === 0) return null;
  const score = (slot: number) => (slide.photos[slot] ? 0 : 10) + (aspect ? slotFit(template.slots[slot], aspect) : 0);
  let best = 0;
  for (let slot = 1; slot < template.slots.length; slot += 1) if (score(slot) > score(best)) best = slot;
  return best;
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
  for (const slide of carousel.slides) for (const id of photosShown(slide)) used.add(id);
  return used;
}

/** La foto per uno spazio: una nuova se c'è, altrimenti la migliore tra quelle già usate (meno ripetuta, mai due volte nella stessa slide). */
function choosePhoto(kind: SlotKind, pool: readonly RankedPhoto[], taken: ReadonlySet<string>, carousel: Carousel, current: ReadonlyArray<string | null>): RankedPhoto | null {
  const uses = new Map<string, number>();
  for (const slide of carousel.slides) for (const id of photosShown(slide)) uses.set(id, (uses.get(id) ?? 0) + 1);
  return pickForSlot(kind, pool, taken, new Map()) ?? pickReused(kind, pool, uses, new Set(current.filter((id): id is string => Boolean(id))));
}

/**
 * Riscegli le foto di una sola slide: per ogni spazio la migliore foto non usata altrove nel carosello (e diversa da quelle di adesso, così
 * a ogni clic ne esce una nuova); se le foto nuove finiscono, la meno ripetuta. L'inquadratura torna quella predefinita. Un panorama non cambia.
 */
export function reselectSlidePhotos(carousel: Carousel, project: Project, slideId: string): Carousel {
  return mapSlide(carousel, slideId, (slide) => {
    const template = templateOf(slide.templateId);
    if (!template || slide.span || slide.free || template.slots.length === 0) return slide;
    const pool = rankPhotos(project);
    const taken = usedAssetIds(carousel);
    const before = new Set(slide.photos.filter((id): id is string => Boolean(id)));
    const chosen: Array<string | null> = [];
    const photos = template.slots.map((kind, index) => {
      const pick = pickForSlot(kind, pool, taken, new Map())
        ?? pickReused(kind, pool, new Map(), new Set([...chosen.filter((id): id is string => Boolean(id)), ...(index < slide.photos.length ? [] : before)]));
      chosen.push(pick?.assetId ?? slide.photos[index] ?? null);
      if (pick) taken.add(pick.assetId);
      return pick?.assetId ?? slide.photos[index] ?? null;
    });
    if (photos.every((id, index) => id === slide.photos[index])) return slide;
    const { framing: _framing, ...rest } = slide;
    return { ...rest, photos };
  });
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
    const { span: _span, spreadId: _spread, spreadId2: _spread2, framing: _framing, textStyle: _style, free: _free, textOffset: _offset, ...rest } = slide;
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
  const copy: Slide = { ...carousel.slides[index], id: newId("sl"), ...(carousel.slides[index].free ? { free: carousel.slides[index].free!.map((frame) => ({ ...frame, id: newId("fr") })) } : {}), photos: [...carousel.slides[index].photos], texts: { ...carousel.slides[index].texts } };
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

// ---------------------------------------------------------------------------
// Testi spostati a mano
// ---------------------------------------------------------------------------

/** Sposta un testo dal posto del modello (scostamento in frazioni della tela). `null` lo riporta al suo posto. Non vale per i panorami. */
export function setTextOffset(carousel: Carousel, slideId: string, key: string, offset: { dx: number; dy: number } | null): Carousel {
  return mapSlide(carousel, slideId, (slide) => {
    const template = templateOf(slide.templateId);
    if (slide.span || !template?.fields.some((field) => field.key === key)) return slide;
    const round4 = (value: number) => Math.max(-1, Math.min(1, Math.round(value * 10000) / 10000));
    const clean = offset ? { dx: round4(offset.dx), dy: round4(offset.dy) } : null;
    const next = clean && (Math.abs(clean.dx) > 0.0005 || Math.abs(clean.dy) > 0.0005) ? clean : null;
    const before = slide.textOffset?.[key];
    if ((before?.dx ?? 0) === (next?.dx ?? 0) && (before?.dy ?? 0) === (next?.dy ?? 0)) return slide;
    const merged = { ...(slide.textOffset ?? {}) };
    if (next) merged[key] = next; else delete merged[key];
    const { textOffset: _old, ...rest } = slide;
    return Object.keys(merged).length ? { ...rest, textOffset: merged } : rest;
  });
}

// ---------------------------------------------------------------------------
// Modo libero: le foto dove si vuole, anche sovrapposte
// ---------------------------------------------------------------------------

const clampFrame = (frame: FreeFrame): FreeFrame => {
  const w = Math.max(FREE_MIN_SIZE, Math.min(2, frame.w));
  const h = Math.max(FREE_MIN_SIZE, Math.min(2, frame.h));
  // Una parte della foto deve restare sempre dentro la slide, altrimenti non si potrebbe più riafferrare.
  const x = Math.max(-w * 0.7, Math.min(1 - w * 0.3, frame.x));
  const y = Math.max(-h * 0.7, Math.min(1 - h * 0.3, frame.y));
  const round4 = (value: number) => Math.round(value * 10000) / 10000;
  return { ...frame, x: round4(x), y: round4(y), w: round4(w), h: round4(h) };
};

/** Le cornici del modo libero ricavate dagli spazi foto del modello (come si vedono adesso): passare al modo libero non sposta nulla. */
export function framesFromLayers(layers: readonly Layer[], width: number, height: number): FreeFrame[] {
  return layers
    .filter((layer): layer is PhotoLayer => layer.kind === "photo" && !layer.blur)
    .slice(0, MAX_FREE_FRAMES)
    .map((layer, index) => clampFrame({
      id: `fr-${index}`, assetId: layer.assetId, x: layer.x / width, y: layer.y / height, w: layer.w / width, h: layer.h / height,
      ...(layer.rotation ? { rotation: layer.rotation } : {}), zoom: layer.zoom, cx: layer.cx, cy: layer.cy, mask: layer.mask,
      ...(layer.border ? { border: true } : {}), ...(layer.shadow ? { shadow: true } : {}),
    }));
}

export function enterFreeMode(carousel: Carousel, slideId: string, layers: readonly Layer[]): Carousel {
  const { width, height } = formatOf(carousel.format);
  return mapSlide(carousel, slideId, (slide) => (slide.span || slide.free ? slide : { ...slide, free: framesFromLayers(layers, width, height) }));
}

/** Torna al modello: le foto del modello (quelle che c'erano prima) tornano ai loro spazi. */
export function leaveFreeMode(carousel: Carousel, slideId: string): Carousel {
  return mapSlide(carousel, slideId, (slide) => {
    if (!slide.free) return slide;
    const { free: _free, ...rest } = slide;
    return rest;
  });
}

function mapFrames(carousel: Carousel, slideId: string, fn: (frames: FreeFrame[]) => FreeFrame[]): Carousel {
  return mapSlide(carousel, slideId, (slide) => {
    if (!slide.free) return slide;
    const next = fn(slide.free);
    return next === slide.free ? slide : { ...slide, free: next };
  });
}

/** Cambia una cornice (posizione, misura, rotazione, zoom, forma…). */
export function setFreeFrame(carousel: Carousel, slideId: string, frameId: string, patch: Partial<Omit<FreeFrame, "id">>): Carousel {
  return mapFrames(carousel, slideId, (frames) => {
    const at = frames.findIndex((frame) => frame.id === frameId);
    if (at < 0) return frames;
    const merged = clampFrame({ ...frames[at], ...patch, id: frameId });
    merged.zoom = Math.max(1, Math.min(4, merged.zoom));
    merged.cx = Math.max(0, Math.min(1, merged.cx));
    merged.cy = Math.max(0, Math.min(1, merged.cy));
    if (!merged.rotation) delete merged.rotation;
    if (!merged.border) delete merged.border;
    if (!merged.shadow) delete merged.shadow;
    if (JSON.stringify(merged) === JSON.stringify(frames[at])) return frames;
    return frames.map((frame, index) => (index === at ? merged : frame));
  });
}

/** Aggiunge una foto, al centro e sopra le altre. `aspect` = larghezza / altezza della foto. */
export function addFreePhoto(carousel: Carousel, slideId: string, assetId: string, aspect: number): Carousel {
  const { width, height } = formatOf(carousel.format);
  return mapFrames(carousel, slideId, (frames) => {
    if (frames.length >= MAX_FREE_FRAMES) return frames;
    const shown = Math.max(0.4, Math.min(2.5, Number.isFinite(aspect) && aspect > 0 ? aspect : 1));
    const w = shown >= 1 ? 0.55 : 0.4;
    const h = (w * width) / shown / height;
    const step = (frames.length % 5) * 0.03;
    return [...frames, clampFrame({ id: newId("fr"), assetId, x: 0.5 - w / 2 + step, y: 0.5 - h / 2 + step, w, h, zoom: 1, cx: 0.5, cy: 0.5, mask: "rect", border: true, shadow: true })];
  });
}

export function removeFreeFrame(carousel: Carousel, slideId: string, frameId: string): Carousel {
  return mapFrames(carousel, slideId, (frames) => (frames.some((frame) => frame.id === frameId) ? frames.filter((frame) => frame.id !== frameId) : frames));
}

/** Porta una cornice davanti o dietro alle altre. */
export function reorderFreeFrame(carousel: Carousel, slideId: string, frameId: string, to: "front" | "back" | "up" | "down"): Carousel {
  return mapFrames(carousel, slideId, (frames) => {
    const at = frames.findIndex((frame) => frame.id === frameId);
    if (at < 0) return frames;
    const target = to === "front" ? frames.length - 1 : to === "back" ? 0 : Math.max(0, Math.min(frames.length - 1, at + (to === "up" ? 1 : -1)));
    if (target === at) return frames;
    const next = [...frames];
    const [moved] = next.splice(at, 1);
    next.splice(target, 0, moved);
    return next;
  });
}

/** Metti una foto in una cornice (anche vuota); l'inquadratura riparte. */
export function setFreeFramePhoto(carousel: Carousel, slideId: string, frameId: string, assetId: string | null): Carousel {
  return setFreeFrame(carousel, slideId, frameId, { assetId, zoom: 1, cx: 0.5, cy: 0.5 });
}

export { photosShown };
