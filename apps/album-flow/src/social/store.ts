import { PALETTES, FONT_PAIRS } from "./brand";
import { normalizeFramingList } from "./framing";
import { normalizeTextStyles } from "./textstyle";
import { SETS, templateOf } from "./templates";
import { MAX_SLIDES, SOCIAL_FORMATS, type BrandKit, type Carousel, type PhotoFraming, type Slide } from "./types";

/**
 * Archivio locale dei caroselli di un album (come i template dell'utente): non tocca lo schema del progetto.
 * Si salvano solo le scelte; tutto ciò che non è valido viene scartato in lettura, mai l'intero archivio.
 */

const KEY = (projectId: string) => `filex.albumFlow.social.${projectId}`;
const BRAND_KEY = "filex.albumFlow.social.brand";
const VERSION = 1;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown, fallback = "", max = 600): string => (typeof value === "string" ? value.slice(0, max) : fallback);

function parseSlide(raw: unknown): Slide | null {
  if (!isRecord(raw)) return null;
  const template = templateOf(str(raw.templateId, "", 60));
  if (!template) return null;
  const photos = Array.isArray(raw.photos) ? raw.photos.slice(0, template.slots.length).map((id) => (typeof id === "string" && id ? id : null)) : [];
  while (photos.length < template.slots.length) photos.push(null);
  const texts: Record<string, string> = {};
  if (isRecord(raw.texts)) for (const field of template.fields) if (typeof raw.texts[field.key] === "string") texts[field.key] = raw.texts[field.key] as string;
  const slide: Slide = { id: str(raw.id, "", 80) || `sl-${Math.random().toString(36).slice(2, 10)}`, templateId: template.id, photos, texts };
  const span = isRecord(raw.span) && Number.isInteger(raw.span.count) && (raw.span.count as number) >= 2;
  const framing = Array.isArray(raw.framing) ? normalizeFramingList(raw.framing.map((item) => (isRecord(item) ? (item as Partial<PhotoFraming>) : null)), template.slots.length, !span) : undefined;
  if (framing) slide.framing = framing;
  if (raw.flip === true && !span) slide.flip = true;
  const textStyle = normalizeTextStyles(raw.textStyle, template.fields.map((field) => field.key));
  if (textStyle) slide.textStyle = textStyle;
  if (raw.tone === "dark" || raw.tone === "light") slide.tone = raw.tone;
  if (typeof raw.spreadId === "string" && raw.spreadId) slide.spreadId = raw.spreadId;
  if (typeof raw.spreadId2 === "string" && raw.spreadId2) slide.spreadId2 = raw.spreadId2;
  if (isRecord(raw.span) && Number.isInteger(raw.span.index) && Number.isInteger(raw.span.count) && (raw.span.count as number) >= 2 && (raw.span.count as number) <= 4
    && (raw.span.index as number) >= 0 && (raw.span.index as number) < (raw.span.count as number)) slide.span = { index: raw.span.index as number, count: raw.span.count as number };
  return slide;
}

export function parseBrand(raw: unknown): BrandKit | null {
  if (!isRecord(raw)) return null;
  return {
    name: str(raw.name, "", 40),
    handle: str(raw.handle, "", 40),
    paletteId: PALETTES.some((palette) => palette.id === raw.paletteId) ? (raw.paletteId as string) : PALETTES[0].id,
    fontPairId: FONT_PAIRS.some((pair) => pair.id === raw.fontPairId) ? (raw.fontPairId as string) : FONT_PAIRS[0].id,
  };
}

export function parseCarousel(raw: unknown): Carousel | null {
  if (!isRecord(raw)) return null;
  const brand = parseBrand(raw.brand);
  if (!brand || !Array.isArray(raw.slides)) return null;
  const slides = raw.slides.map(parseSlide).filter((slide): slide is Slide => slide !== null).slice(0, MAX_SLIDES);
  // Un panorama a cui manca un pezzo non si può mostrare: lo si scarta tutto.
  const complete = slides.filter((slide, index) => {
    if (!slide.span) return true;
    const start = index - slide.span.index;
    return Array.from({ length: slide.span.count }, (_, k) => slides[start + k]).every((other, k) => other?.span?.index === k && other.span.count === slide.span!.count);
  });
  if (complete.length < 2) return null;
  const setId = SETS.some((set) => set.id === raw.setId) ? (raw.setId as Carousel["setId"]) : SETS[0].id;
  const now = new Date().toISOString();
  return {
    id: str(raw.id, "", 80) || `car-${Math.random().toString(36).slice(2, 10)}`,
    name: str(raw.name, "Carosello", 60) || "Carosello",
    format: SOCIAL_FORMATS.some((format) => format.id === raw.format) ? (raw.format as Carousel["format"]) : "feed",
    setId,
    brand,
    slides: complete,
    ...(typeof raw.basis === "string" ? { basis: raw.basis.slice(0, 600) } : {}),
    ...(Number.isInteger(raw.seed) && (raw.seed as number) > 0 && (raw.seed as number) < 2 ** 31 ? { seed: raw.seed as number } : {}),
    caption: str(raw.caption, "", 2200),
    createdAt: str(raw.createdAt, now, 40),
    updatedAt: str(raw.updatedAt, now, 40),
  };
}

export function parseCarousels(text: string | null): Carousel[] {
  if (!text) return [];
  try {
    const data: unknown = JSON.parse(text);
    if (!isRecord(data) || data.version !== VERSION || !Array.isArray(data.carousels)) return [];
    return data.carousels.map(parseCarousel).filter((carousel): carousel is Carousel => carousel !== null);
  } catch {
    return [];
  }
}

export function serializeCarousels(carousels: readonly Carousel[]): string {
  return JSON.stringify({ version: VERSION, carousels });
}

export function loadCarousels(projectId: string): Carousel[] {
  try { return parseCarousels(localStorage.getItem(KEY(projectId))); } catch { return []; }
}

/** Salva; restituisce falso se lo spazio locale è esaurito o non disponibile. */
export function saveCarousels(projectId: string, carousels: readonly Carousel[]): boolean {
  try {
    if (carousels.length === 0) localStorage.removeItem(KEY(projectId));
    else localStorage.setItem(KEY(projectId), serializeCarousels(carousels));
    return true;
  } catch {
    return false;
  }
}

/** Nome, profilo, colori e font si ricordano da un album all'altro: si scrivono una volta sola. */
export function loadBrand(): BrandKit | null {
  try {
    const text = localStorage.getItem(BRAND_KEY);
    return text ? parseBrand(JSON.parse(text)) : null;
  } catch { return null; }
}

export function saveBrand(brand: BrandKit): void {
  try { localStorage.setItem(BRAND_KEY, JSON.stringify(brand)); } catch { /* preferenza non salvata */ }
}
