import { spreadSizeMm } from "../engine/geometry";
import { PANORAMA_ASPECT } from "../model/autobuild";
import { itemAspect, nowIso, type Project } from "../model/project";
import { newId } from "../model/ids";
import type { TextMeasure } from "../render/text-layout";
import type { BuildEnv } from "./build";
import { mulberry32 } from "../engine/rng";
import { FLEX_TONE_IDS, arcFor, setInfo, templateOf, toneForFlex } from "./templates";
import { MAX_SLIDES, MIN_SLIDES, photosShown, type BrandKit, type Carousel, type PhotoRef, type Slide, type SlotKind, type SetId, type SocialFormatId, type SpreadRef } from "./types";

/** Ambiente di disegno ricavato dall'album: foto con le loro proporzioni, spread, nome. */
export function envFor(project: Project, measure: TextMeasure): BuildEnv {
  const photos = new Map<string, PhotoRef>(project.assets.map((asset) => [asset.id, { assetId: asset.id, aspect: itemAspect(asset) }]));
  const { width, height } = spreadSizeMm(project.settings.sheet);
  const spreads = new Map<string, SpreadRef>(project.spreads.map((spread) => [spread.id, { spreadId: spread.id, aspect: height > 0 ? width / height : 2 }]));
  return { albumName: project.projectName, photos, spreads, measure };
}

// ---------------------------------------------------------------------------
// Classifica delle foto
// ---------------------------------------------------------------------------

export interface RankedPhoto {
  assetId: string;
  aspect: number;
  score: number;
  chapterId: string | null;
}

/** Un panorama vero è molto più largo che alto: stessa soglia di Auto Build. */
export { PANORAMA_ASPECT };

/**
 * Le foto dell'album dalla più adatta in giù: stelle, scelte del Selector, copertina e foto principali, e quelle che il fotografo
 * ha già impaginato. Le foto scartate non entrano mai.
 */
export function rankPhotos(project: Project, only?: ReadonlySet<string>): RankedPhoto[] {
  const used = new Set<string>();
  for (const spread of project.spreads) for (const area of spread.areas) for (const item of area.items) used.add(item.assetId);
  const chapterOf = new Map<string, string>();
  for (const chapter of project.chapters) for (const id of chapter.assetIds) chapterOf.set(id, chapter.id);
  const ranked: RankedPhoto[] = [];
  project.assets.forEach((asset, index) => {
    if (asset.pickStatus === "rejected") return;
    if (only && !only.has(asset.id)) return;
    const rating = asset.rating ?? asset.selectorRating ?? 0;
    let score = rating * 10;
    if (asset.pickStatus === "picked") score += 8;
    if (asset.albumTags?.includes("cover")) score += 12;
    if (asset.albumTags?.includes("main")) score += 6;
    // «Per i social»: la scelta esplicita del fotografo vince su tutto, anche sulla forma dello spazio (peso della forma: 100):
    // una foto segnata non resta mai fuori solo perché è orizzontale e gli spazi liberi sono verticali.
    if (asset.albumTags?.includes("social")) score += 150;
    if (project.coverAssetId === asset.id) score += 10;
    if (used.has(asset.id)) score += 5;
    score -= index * 0.0001;
    ranked.push({ assetId: asset.id, aspect: itemAspect(asset), score, chapterId: chapterOf.get(asset.id) ?? null });
  });
  return ranked.sort((a, b) => b.score - a.score);
}

/** Quanto una foto va bene per uno spazio: 1 forma giusta, 0,5 accettabile, 0 sbagliata (si usa solo se non c'è di meglio). */
export function slotFit(slot: SlotKind, aspect: number): number {
  if (slot === "any") return 1;
  if (slot === "portrait") return aspect <= 0.95 ? 1 : aspect <= 1.15 ? 0.5 : 0;
  return aspect >= 1.15 ? 1 : aspect >= 0.95 ? 0.5 : 0;
}

/** Sceglie la miglior foto libera per uno spazio, evitando di prendere sempre dallo stesso capitolo. */
export function pickForSlot(slot: SlotKind, pool: readonly RankedPhoto[], taken: ReadonlySet<string>, perChapter: ReadonlyMap<string, number>, preferred: readonly string[] = []): RankedPhoto | null {
  let best: RankedPhoto | null = null;
  let bestValue = -Infinity;
  for (const photo of pool) {
    if (taken.has(photo.assetId)) continue;
    const prefer = preferred.indexOf(photo.assetId);
    const value = photo.score + 100 * slotFit(slot, photo.aspect) + (prefer >= 0 ? 1000 - prefer : 0) - (photo.chapterId ? (perChapter.get(photo.chapterId) ?? 0) * 6 : 0);
    if (value > bestValue) { bestValue = value; best = photo; }
  }
  return best;
}

/** Quando le foto nuove sono finite: la foto più adatta tra quelle già usate, preferendo le meno ripetute e mai due volte nella stessa slide. */
export function pickReused(slot: SlotKind, pool: readonly RankedPhoto[], uses: ReadonlyMap<string, number>, avoid: ReadonlySet<string>): RankedPhoto | null {
  let best: RankedPhoto | null = null;
  let bestValue = -Infinity;
  for (const photo of pool) {
    if (avoid.has(photo.assetId)) continue;
    const value = photo.score + 100 * slotFit(slot, photo.aspect) - 60 * (uses.get(photo.assetId) ?? 0);
    if (value > bestValue) { bestValue = value; best = photo; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Piano
// ---------------------------------------------------------------------------

export interface PlanOptions {
  setId: SetId;
  format: SocialFormatId;
  count: number;
  brand: BrandKit;
  name?: string;
  /** Limita la scelta a queste foto (per esempio la selezione fatta nella libreria). */
  assetIds?: readonly string[];
  /** Dà un ordine diverso ai modelli (e qualche specchio): senza, o con 0, esce sempre la trama di base dello stile. */
  seed?: number;
  /** Foto da mettere per prime, nell'ordine dato (per cambiare stile senza perdere le scelte). */
  prefer?: readonly string[];
}

export function clampCount(count: number): number {
  return Math.max(MIN_SLIDES, Math.min(MAX_SLIDES, Math.round(count)));
}

/** Foto molto larga abbastanza da diventare un panorama su due slide. */
export function bestPanorama(pool: readonly RankedPhoto[]): RankedPhoto | null {
  return pool.find((photo) => photo.aspect >= PANORAMA_ASPECT) ?? null;
}

/**
 * Le doppie pagine più adatte a farsi vedere, dalla migliore: prima quelle piene (ogni pagina ha almeno una foto), poi quelle con più
 * foto e foto più belle. Una pagina quasi vuota non fa buona figura in un mockup.
 */
export function rankSpreads(project: Project, pool: readonly RankedPhoto[]): string[] {
  const score = new Map(pool.map((photo) => [photo.assetId, photo.score]));
  return project.spreads
    .map((spread) => {
      const items = spread.areas.flatMap((area) => area.items);
      const filled = spread.areas.every((area) => area.items.length > 0);
      const average = items.length ? items.reduce((sum, item) => sum + (score.get(item.assetId) ?? 0), 0) / items.length : 0;
      return { id: spread.id, count: items.length, value: (filled ? 1000 : 0) + Math.min(items.length, 6) * 4 + average };
    })
    .filter((row) => row.count > 0)
    .sort((a, b) => b.value - a.value)
    .map((row) => row.id);
}

export function bestSpreadId(project: Project, pool: readonly RankedPhoto[]): string | null {
  return rankSpreads(project, pool)[0] ?? null;
}

function blankSlide(templateId: string): Slide {
  const template = templateOf(templateId);
  return { id: newId("sl"), templateId, photos: (template?.slots ?? []).map(() => null), texts: {} };
}

const NO_BRAND: BrandKit = { name: "", handle: "", paletteId: "", fontPairId: "" };

/** Quante delle foto date finiscono davvero nel carosello se ha `count` slide, e quante compaiono più di una volta. */
export function planCoverage(project: Project, assetIds: readonly string[], count: number, setId: SetId = "editoriale", seed = 0): { used: number; repeated: number } {
  const planned = planCarousel(project, { setId, format: "feed", count, brand: NO_BRAND, assetIds, seed });
  const wanted = new Set(assetIds);
  const uses = new Map<string, number>();
  for (const slide of planned.slides) if (!slide.span || slide.span.index === 0) for (const id of slide.photos) if (id && wanted.has(id)) uses.set(id, (uses.get(id) ?? 0) + 1);
  return { used: uses.size, repeated: [...uses.values()].filter((times) => times > 1).length };
}

export const photosUsedAt = (project: Project, assetIds: readonly string[], count: number, setId: SetId = "editoriale", seed = 0): number =>
  planCoverage(project, assetIds, count, setId, seed).used;

/**
 * Il numero di slide che serve perché tutte le foto scelte trovino posto: il più piccolo che le contiene tutte senza ripeterne,
 * oppure, se ripetere è inevitabile, il più piccolo che le contiene tutte (almeno `MIN_SLIDES`, al massimo `MAX_SLIDES`).
 */
export function suggestSlideCount(project: Project, assetIds: readonly string[], setId: SetId = "editoriale", seed = 0): number {
  const wanted = new Set(project.assets.filter((asset) => asset.pickStatus !== "rejected" && assetIds.includes(asset.id)).map((asset) => asset.id)).size;
  if (wanted <= MIN_SLIDES) return MIN_SLIDES;
  let firstFull = 0;
  for (let count = MIN_SLIDES; count <= MAX_SLIDES; count += 1) {
    const { used, repeated } = planCoverage(project, assetIds, count, setId, seed);
    if (used < wanted) continue;
    if (repeated === 0) return count;
    if (!firstFull) firstFull = count;
  }
  return firstFull || MAX_SLIDES;
}

/** Il carosello proposto: la trama dello stile, le foto migliori per ogni spazio, panorama e album quando l'album li offre. */
export function planCarousel(project: Project, options: PlanOptions): Carousel {
  const count = clampCount(options.count);
  const set = setInfo(options.setId);
  const pool = rankPhotos(project, options.assetIds ? new Set(options.assetIds) : undefined);
  const seed = options.seed && options.seed > 0 ? Math.floor(options.seed) : 0;
  const arc = arcFor(set, seed);
  const ids: string[] = [arc.open];
  for (let index = 0; index < count - 2; index += 1) ids.push(arc.middle[index % arc.middle.length]);
  if (count >= 2) ids.push(arc.close);
  const slides = ids.map((id) => blankSlide(id));

  // Un'immagine panoramica distesa su due slide, subito dopo l'apertura.
  const pano = count >= 6 ? bestPanorama(pool) : null;
  let panoId: string | null = null;
  if (pano) {
    const at = 2;
    for (let part = 0; part < 2; part += 1) slides[at + part] = { ...blankSlide("sh-pano"), photos: [pano.assetId], span: { index: part, count: 2 } };
    panoId = pano.assetId;
  }
  // Una doppia pagina vera dell'album, prima della chiusura.
  const spreadIds = count >= 5 ? rankSpreads(project, pool) : [];
  if (spreadIds.length > 0) slides[count - 2] = { ...blankSlide("sh-mockup"), spreadId: spreadIds[0], spreadId2: spreadIds[1] ?? null };

  // I modelli universali prendono il fondo dallo stile (scuro, chiaro o alternato).
  slides.forEach((slide, index) => { if (FLEX_TONE_IDS.has(slide.templateId)) slide.tone = toneForFlex(set, index + (seed % 2)); });

  // Un modello che compare più volte non ripete gli stessi testi: dalla seconda copia si usano le varianti.
  const seen = new Map<string, number>();
  for (const slide of slides) {
    const template = templateOf(slide.templateId);
    const occurrence = seen.get(slide.templateId) ?? 0;
    seen.set(slide.templateId, occurrence + 1);
    if (occurrence > 0 && template?.variants?.length) slide.texts = { ...template.variants[(occurrence - 1) % template.variants.length] };
  }

  // Con un seme, circa una slide su tre si specchia: lo stesso modello, con destra e sinistra scambiate.
  if (seed) {
    const random = mulberry32((seed ^ 0x9e3779b1) >>> 0);
    slides.forEach((slide, index) => { if (index > 0 && index < slides.length - 1 && !slide.span && slide.templateId !== "sh-mockup" && random() < 0.34) slide.flip = true; });
  }

  const taken = new Set<string>(panoId ? [panoId] : []);
  const perChapter = new Map<string, number>();
  const uses = new Map<string, number>(panoId ? [[panoId, 1]] : []);
  for (const slide of slides) {
    if (slide.span) continue;
    const template = templateOf(slide.templateId);
    if (!template) continue;
    template.slots.forEach((slot, index) => {
      // Finché ci sono foto nuove si usano quelle; solo dopo si riprendono le migliori, scegliendo le meno usate.
      const pick = pickForSlot(slot, pool, taken, perChapter, options.prefer)
        ?? pickReused(slot, pool, uses, new Set(slide.photos.filter((id): id is string => Boolean(id))));
      if (!pick) return;
      slide.photos[index] = pick.assetId;
      taken.add(pick.assetId);
      uses.set(pick.assetId, (uses.get(pick.assetId) ?? 0) + 1);
      if (pick.chapterId) perChapter.set(pick.chapterId, (perChapter.get(pick.chapterId) ?? 0) + 1);
    });
  }
  const now = nowIso();
  return { id: newId("car"), name: options.name?.trim() || "Carosello", format: options.format, setId: options.setId, brand: options.brand, slides, ...(seed ? { seed } : {}), basis: selectionBasis(project), caption: "", createdAt: now, updatedAt: now };
}

/** Impronta della scelta: le prime foto della classifica. Cambia quando cambiano stelle, segnalini «Per i social» o scarti. */
export function selectionBasis(project: Project): string {
  return rankPhotos(project).slice(0, 24).map((photo) => photo.assetId).join(",");
}

/** Il carosello non sa più quali sono le foto migliori: da quando è stato creato qualcosa è cambiato. */
export function selectionChanged(project: Project, carousel: Carousel): boolean {
  return carousel.basis !== undefined && carousel.basis !== selectionBasis(project);
}

/** Sceglie di nuovo le foto con le stelle e i segnalini di adesso, tenendo stile, colori, formato, numero di slide e testi scritti. */
export function reselectPhotos(project: Project, carousel: Carousel): Carousel {
  const next = planCarousel(project, { setId: carousel.setId, format: carousel.format, count: carousel.slides.length, brand: carousel.brand, name: carousel.name, seed: carousel.seed });
  const slides = next.slides.map((slide, index) => {
    const before = carousel.slides[index];
    const template = templateOf(slide.templateId);
    if (!before || !template || before.templateId !== slide.templateId) return slide;
    // Le foto si riscelgono; tutto il resto (testi e loro stile, fondo, specchio) resta com'era.
    const { flip: _flip, tone: _tone, ...clean } = slide;
    return { ...clean, texts: { ...before.texts }, ...(before.textStyle ? { textStyle: before.textStyle } : {}), ...(before.tone ? { tone: before.tone } : {}), ...(before.flip ? { flip: true } : {}), ...(before.free && !slide.span ? { free: before.free } : {}), ...(before.textOffset ? { textOffset: before.textOffset } : {}) };
  });
  return { ...next, id: carousel.id, createdAt: carousel.createdAt, caption: carousel.caption, slides };
}

/** Un seme nuovo per ogni carosello creato: due caroselli fatti in momenti diversi dallo stesso album non escono uguali. */
export function freshSeed(): number {
  return 1 + Math.floor(Math.random() * 2_000_000_000);
}

/**
 * Stesso stile, stesse foto e stessi testi, ma modelli in un altro ordine, con qualche specchio: «Altra variante».
 * I testi scritti passano alle slide che usano lo stesso modello nella nuova trama.
 */
export function variation(project: Project, carousel: Carousel, seed = freshSeed()): Carousel {
  const prefer: string[] = [];
  for (const slide of carousel.slides) for (const id of photosShown(slide)) if (!prefer.includes(id)) prefer.push(id);
  const next = planCarousel(project, { setId: carousel.setId, format: carousel.format, count: carousel.slides.length, brand: carousel.brand, name: carousel.name, seed, prefer });
  const byTemplate = new Map<string, Slide[]>();
  for (const slide of carousel.slides) byTemplate.set(slide.templateId, [...(byTemplate.get(slide.templateId) ?? []), slide]);
  const slides = next.slides.map((slide) => {
    const before = byTemplate.get(slide.templateId)?.shift();
    return before && Object.keys(before.texts).length ? { ...slide, texts: { ...before.texts }, ...(before.textStyle ? { textStyle: before.textStyle } : {}), ...(before.textOffset ? { textOffset: before.textOffset } : {}) } : slide;
  });
  const { basis: _basis, ...rest } = next;
  return { ...rest, ...(carousel.basis !== undefined ? { basis: carousel.basis } : {}), id: carousel.id, createdAt: carousel.createdAt, caption: carousel.caption, slides };
}

/** Cambia stile mantenendo foto e testi: le foto già scelte restano, nello stesso ordine; i testi passano alle slide nella stessa posizione. */
export function restyle(project: Project, carousel: Carousel, setId: SetId): Carousel {
  const prefer: string[] = [];
  for (const slide of carousel.slides) for (const id of photosShown(slide)) if (!prefer.includes(id)) prefer.push(id);
  const next = planCarousel(project, { setId, format: carousel.format, count: carousel.slides.length, brand: setBrand(carousel.brand, setId), name: carousel.name, prefer, seed: carousel.seed });
  const slides = next.slides.map((slide, index) => {
    const before = carousel.slides[index];
    const template = templateOf(slide.templateId);
    if (!before || !template) return slide;
    const texts: Record<string, string> = {};
    for (const field of template.fields) if (before.texts[field.key] !== undefined) texts[field.key] = before.texts[field.key];
    return { ...slide, texts, ...(before.free && !slide.span && !before.span ? { free: before.free } : {}), ...(before.textOffset && before.templateId === slide.templateId ? { textOffset: before.textOffset } : {}) };
  });
  // Cambiare stile non riscegle le foto: l'impronta resta quella di prima, così l'avviso «le stelle sono cambiate» non sparisce.
  const { basis: _basis, ...rest } = next;
  return { ...rest, ...(carousel.basis !== undefined ? { basis: carousel.basis } : {}), id: carousel.id, createdAt: carousel.createdAt, caption: carousel.caption, slides };
}

/** Per l'interfaccia: colori e font consigliati di uno stile. */
export function setBrand(brand: BrandKit, setId: SetId): BrandKit {
  const set = setInfo(setId);
  return { ...brand, paletteId: set.paletteId, fontPairId: set.fontPairId };
}
