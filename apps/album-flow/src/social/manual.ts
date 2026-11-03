import type { AlbumAssetV2 } from "@photo-tools/shared-types";
import { newId } from "../model/ids";
import { sortAssets } from "../model/library";
import { nowIso, type Project } from "../model/project";
import { mapSlide, usedAssetIds } from "./edit";
import { carouselPoolIds, isPromoCarousel, setBrand, slotFit } from "./plan";
import { BLANK_ID, TEMPLATES, templateOf, templatesForSet } from "./templates";
import { MAX_FREE_FRAMES, formatOf, photosShown, type BrandKit, type Carousel, type FreeFrame, type SetId, type Slide, type SlideTemplate, type SocialFormatId } from "./types";

/**
 * Carosello fatto a mano («Da zero»): le slide partono vuote, le foto di ogni slide le sceglie l'utente e solo dopo si propongono i modelli,
 * in base a quante foto ci sono. Tutto puro, come il resto di `social/`.
 */

/** Margine e distanza tra le foto, in pixel della tela (come lo stile Minimal). */
const MARGIN = 72;
const GAP = 24;
const TOLERANCE = 0.003;
const round4 = (value: number) => Math.round(value * 10000) / 10000;

export type AspectOf = (assetId: string) => number | undefined;

interface Box { x: number; y: number; w: number; h: number }

/**
 * Come si dispongono `aspects.length` foto intere sulla tela, in frazioni della tela: sceglie la griglia (colonne per righe) in cui le foto,
 * senza ritaglio, occupano più superficie. Le foto di una riga incompleta restano centrate.
 */
export function tidyRects(aspects: readonly number[], width: number, height: number): Box[] {
  const count = aspects.length;
  if (count === 0) return [];
  let best: { area: number; rects: Box[] } | null = null;
  for (let cols = 1; cols <= count; cols += 1) {
    const rows = Math.ceil(count / cols);
    const cellW = (width - 2 * MARGIN - (cols - 1) * GAP) / cols;
    const cellH = (height - 2 * MARGIN - (rows - 1) * GAP) / rows;
    if (cellW <= 0 || cellH <= 0) continue;
    let area = 0;
    const rects = aspects.map((aspect, index): Box => {
      const row = Math.floor(index / cols);
      const inRow = row === rows - 1 ? count - (rows - 1) * cols : cols;
      const rowWidth = inRow * cellW + (inRow - 1) * GAP;
      const x0 = MARGIN + (width - 2 * MARGIN - rowWidth) / 2 + (index % cols) * (cellW + GAP);
      const y0 = MARGIN + row * (cellH + GAP);
      const shape = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
      const w = shape > cellW / cellH ? cellW : cellH * shape;
      const h = shape > cellW / cellH ? cellW / shape : cellH;
      area += w * h;
      return { x: round4((x0 + (cellW - w) / 2) / width), y: round4((y0 + (cellH - h) / 2) / height), w: round4(w / width), h: round4(h / height) };
    });
    if (!best || area > best.area * 1.0001) best = { area, rects };
  }
  return best?.rects ?? [];
}

const aspectsOf = (frames: readonly FreeFrame[], aspectOf: AspectOf) => frames.map((frame) => (frame.assetId ? aspectOf(frame.assetId) ?? 1 : 1));

/** Le cornici ordinate: stessa foto e stesso ordine, posizione e misura della griglia, foto intera, senza rotazione, bordo né ombra. */
function tidied(frames: readonly FreeFrame[], aspectOf: AspectOf, width: number, height: number): FreeFrame[] {
  const rects = tidyRects(aspectsOf(frames, aspectOf), width, height);
  return frames.map((frame, index) => ({ id: frame.id, assetId: frame.assetId, ...rects[index], zoom: 1, cx: 0.5, cy: 0.5, mask: "rect" as const }));
}

/** Vero se le foto stanno ancora dove le ha messe l'ordinamento automatico: solo allora una foto nuova riordina tutto, senza rovinare i tuoi spostamenti. */
export function isTidy(frames: readonly FreeFrame[], aspectOf: AspectOf, width: number, height: number): boolean {
  if (frames.length === 0) return true;
  const target = tidied(frames, aspectOf, width, height);
  return frames.every((frame, index) => {
    const wanted = target[index];
    return !frame.rotation && !frame.border && !frame.shadow && frame.mask === "rect" && frame.zoom === 1
      && Math.abs(frame.x - wanted.x) < TOLERANCE && Math.abs(frame.y - wanted.y) < TOLERANCE && Math.abs(frame.w - wanted.w) < TOLERANCE && Math.abs(frame.h - wanted.h) < TOLERANCE;
  });
}

/** Rimette in ordine le foto di una slide libera (griglia con foto intere). Le foto restano le stesse. */
export function tidySlide(carousel: Carousel, slideId: string, aspectOf: AspectOf): Carousel {
  const { width, height } = formatOf(carousel.format);
  return mapSlide(carousel, slideId, (slide) => (slide.free && slide.free.length > 0 && !slide.span ? { ...slide, free: tidied(slide.free, aspectOf, width, height) } : slide));
}

/**
 * Mette foto nella slide libera. Se le foto già presenti sono ancora in ordine (o la slide è vuota) tutte si riordinano nella griglia migliore;
 * altrimenti la foto nuova si aggiunge al centro, sopra le altre, e non si tocca niente di ciò che hai spostato. Una foto già nella slide non si ripete.
 */
export function addPhotosToSlide(carousel: Carousel, slideId: string, assetIds: readonly string[], aspectOf: AspectOf): Carousel {
  const { width, height } = formatOf(carousel.format);
  return mapSlide(carousel, slideId, (slide) => {
    if (slide.span || !slide.free) return slide;
    const present = new Set(slide.free.map((frame) => frame.assetId));
    const fresh = [...new Set(assetIds)].filter((id) => !present.has(id)).slice(0, Math.max(0, MAX_FREE_FRAMES - slide.free.length));
    if (fresh.length === 0) return slide;
    const wasTidy = isTidy(slide.free, aspectOf, width, height);
    const added = fresh.map((assetId, order): FreeFrame => {
      const aspect = Math.max(0.4, Math.min(2.5, aspectOf(assetId) ?? 1));
      const w = aspect >= 1 ? 0.55 : 0.4;
      const h = (w * width) / aspect / height;
      const step = ((slide.free!.length + order) % 5) * 0.03;
      return { id: newId("fr"), assetId, x: round4(0.5 - w / 2 + step), y: round4(0.5 - h / 2 + step), w: round4(w), h: round4(h), zoom: 1, cx: 0.5, cy: 0.5, mask: "rect" };
    });
    const frames = [...slide.free, ...added];
    return { ...slide, free: wasTidy ? tidied(frames, aspectOf, width, height) : frames };
  });
}

/** Le foto di una slide nell'ordine di lettura (dall'alto in basso, da sinistra a destra) se è libera, nell'ordine degli spazi altrimenti. */
function photosInReadingOrder(slide: Slide): string[] {
  if (!slide.free) return photosShown(slide);
  return [...slide.free]
    .filter((frame): frame is FreeFrame & { assetId: string } => Boolean(frame.assetId))
    .sort((a, b) => (Math.abs(a.y - b.y) > 0.12 ? a.y - b.y : a.x - b.x))
    .map((frame) => frame.assetId);
}

/**
 * I modelli adatti a una slide con `count` foto, esattamente quel numero di spazi: prima quelli dello stile del carosello e i comuni,
 * poi quelli degli altri stili (per divertirsi a provarli). Niente panorama né album; i modelli di vendita solo se il carosello li usa.
 */
export function templatesForCount(carousel: Pick<Carousel, "setId" | "promo" | "slides">, count: number): SlideTemplate[] {
  if (count < 1) return [];
  const promo = isPromoCarousel(carousel);
  const fits = (template: SlideTemplate) => template.slots.length === count && !template.needsSpread && template.id !== BLANK_ID && template.id !== "sh-pano" && (!template.promo || promo);
  const own = templatesForSet(carousel.setId).filter(fits);
  const taken = new Set(own.map((template) => template.id));
  return [...own, ...TEMPLATES.filter((template) => fits(template) && !taken.has(template.id))];
}

/** Il modello appartiene allo stile del carosello (o è comune a tutti): gli altri si mostrano a parte, come «Altri stili». */
export const isOwnTemplate = (carousel: Pick<Carousel, "setId">, template: SlideTemplate): boolean =>
  templatesForSet(carousel.setId).some((candidate) => candidate.id === template.id);

/** Quante foto ha una slide, contando anche quelle della disposizione libera. */
export const photoCountOf = (slide: Slide): number => photosShown(slide).length;

/**
 * Applica un modello alla slide con le sue foto, senza aggiungerne né toglierne: il modello deve avere tanti spazi quante sono le foto.
 * Ogni foto va nello spazio che le sta meglio (verticale in uno spazio verticale…); a parità resta nell'ordine di lettura.
 * Dopo l'applicazione la slide non è più libera (si può tornare alla disposizione libera dal pannello Foto).
 */
export function applyTemplateToPhotos(carousel: Carousel, slideId: string, templateId: string, aspectOf: AspectOf): Carousel {
  const template = templateOf(templateId);
  if (!template || template.needsSpread) return carousel;
  return mapSlide(carousel, slideId, (slide) => {
    const photos = photosInReadingOrder(slide);
    if (slide.span || photos.length === 0 || template.slots.length !== photos.length) return slide;
    const left = [...photos];
    const assigned = template.slots.map((kind): string => {
      let bestAt = 0;
      let bestFit = -Infinity;
      left.forEach((assetId, at) => {
        const fit = slotFit(kind, aspectOf(assetId) ?? 1);
        if (fit > bestFit) { bestFit = fit; bestAt = at; }
      });
      return left.splice(bestAt, 1)[0];
    });
    const { free: _free, span: _span, spreadId: _spread, spreadId2: _spread2, framing: _framing, textStyle: _style, textOffset: _offset, layerOffset: _layers, hidden: _hidden, ...rest } = slide;
    return { ...rest, templateId, photos: assigned, texts: {} };
  });
}

/**
 * Le foto del carosello che nessuna slide usa ancora, in ordine di scatto (come in libreria): è l'elenco da cui scegli per ogni slide.
 * Niente classifica automatica: l'ordine lo decide il momento dello scatto, non le stelle.
 */
export function availableInOrder(carousel: Carousel, project: Project): AlbumAssetV2[] {
  const used = usedAssetIds(carousel);
  // Nel carosello a mano le foto sono esattamente quelle scelte: niente ripiego sulle foto migliori se la lista è vuota.
  const pool = new Set(carousel.manual ? carousel.assetIds ?? [] : carouselPoolIds(project, carousel));
  return sortAssets(project.assets.filter((asset) => pool.has(asset.id) && !used.has(asset.id) && asset.pickStatus !== "rejected"), "capture-time");
}

/** Una slide vuota, in disposizione libera. */
export function blankSlide(): Slide {
  return { id: newId("sl"), templateId: BLANK_ID, photos: [], texts: {}, free: [] };
}

export interface BlankOptions {
  setId: SetId;
  format: SocialFormatId;
  brand: BrandKit;
  name?: string;
  /** Le foto del carosello: la lista da cui scegli, e solo queste. */
  assetIds: readonly string[];
  whole?: boolean;
  /** Quante slide vuote (almeno 2, il minimo di un carosello). */
  slides?: number;
}

/** Il carosello da zero: slide vuote e le foto da cui scegliere. Niente piano automatico, niente impronta delle foto migliori. */
export function blankCarousel(_project: Project, options: BlankOptions): Carousel {
  const count = Math.max(2, Math.min(20, Math.round(options.slides ?? 2)));
  const now = nowIso();
  return {
    id: newId("car"), name: options.name?.trim() || "Carosello", format: options.format, setId: options.setId, brand: setBrand(options.brand, options.setId),
    slides: Array.from({ length: count }, () => blankSlide()), assetIds: [...new Set(options.assetIds)],
    promo: false, ...(options.whole ? { whole: true } : {}), manual: true, caption: "", createdAt: now, updatedAt: now,
  };
}

/** Per i test e per l'interfaccia: tutti i modelli che esistono (anche degli altri stili) con quel numero di spazi. */
export function allTemplatesForCount(count: number): SlideTemplate[] {
  return TEMPLATES.filter((template) => template.slots.length === count && !template.needsSpread && template.id !== BLANK_ID && template.id !== "sh-pano");
}

