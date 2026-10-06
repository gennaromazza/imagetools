import type { AlbumSpread } from "@photo-tools/shared-types";
import { areaOuterRects, spreadSizeMm } from "../engine/geometry";
import { addTextParts, overlaysOf, removeOverlay, updateOverlay, type TextPartInput } from "./design";
import { findSpread, type Project } from "./project";
import {
  STORY_LIBRARY, STORY_CATEGORIES, storyDisplayText, storyKey,
  type StoryCategory, type StoryIntensity, type StoryLength, type StoryPlacement, type StoryTone, type StoryType, type StoryUnit,
} from "./storyLibrary";

/**
 * Selezione e inserimento dei testi narrativi. Funzioni pure: il motore sceglie il testo in base a ciò che l'album sta raccontando
 * in quel punto (fase, spazio libero, foto, intensità, posizione) e a ciò che c'è già, invece di pescare a caso.
 */

export type StorySpace = "micro" | "small" | "medium" | "large";
export type StoryPosition = "opening" | "middle" | "closing";

export interface StoryContext {
  /** Fase narrativa della sequenza, se la si riconosce. */
  phase: StoryCategory | null;
  position: StoryPosition;
  space: StorySpace;
  /** Tipi di foto o di sequenza riconosciuti (dai capitoli e dalle etichette), da confrontare con `recommendedFor`. */
  tags: readonly string[];
  intensity: StoryIntensity;
  /** Chiavi (`storyKey`) dei testi già presenti nell'album: non si ripetono. */
  used: ReadonlySet<string>;
  /** Testi delle pagine vicine: se uno è troppo simile a quello proposto, si scarta. */
  nearby: readonly string[];
  /** Categoria del testo narrativo più vicino, per non ripetere lo stesso tipo di seguito. */
  lastCategory: StoryCategory | null;
  /** Le citazioni d'autore non si propongono da sole: solo se lo si chiede. */
  includeQuotes: boolean;
  seed: number;
}

export const STORY_SPACE_LABEL: Record<StorySpace, string> = {
  micro: "spazio minimo", small: "poco spazio", medium: "spazio medio", large: "pagina libera",
};

/** Categorie che vanno bene in qualunque punto dell'album. */
const UNIVERSAL: ReadonlySet<StoryCategory> = new Set(["universali", "poetici", "microcopy", "cinematografici", "citazioni"]);
const OPENING_ONLY: ReadonlySet<StoryCategory> = new Set(["aperture"]);
const CLOSING_ONLY: ReadonlySet<StoryCategory> = new Set(["finale", "chiusure"]);

/** Intensità tipica di ogni fase: un'apertura è delicata, la cerimonia e il finale sono intensi. */
const PHASE_INTENSITY: Partial<Record<StoryCategory, StoryIntensity>> = {
  aperture: 2, preparativi: 2, casa: 2, famiglia: 3, amici: 2, attesa: 3, incontro: 4, cerimonia: 4, sguardi: 3, ritratto_coppia: 3,
  intimita: 3, dettagli: 2, invitati: 2, ricevimento: 3, festa: 4, spontaneita: 2, tramonto: 3, notte: 3, finale: 4,
};

// ---------------------------------------------------------------------------
// Filtri (per sfogliare la libreria)
// ---------------------------------------------------------------------------

export interface StoryFilters {
  categories?: readonly StoryCategory[];
  lengths?: readonly StoryLength[];
  types?: readonly StoryType[];
  tones?: readonly StoryTone[];
  intensities?: readonly StoryIntensity[];
  /** «original» = frasi originali, «quote» = citazioni d'autore. */
  origin?: "all" | "original" | "quote";
  query?: string;
}

export function filterStories(filters: StoryFilters, library: readonly StoryUnit[] = STORY_LIBRARY): StoryUnit[] {
  const query = filters.query?.trim().toLowerCase() ?? "";
  return library.filter((unit) => {
    if (filters.categories?.length && !filters.categories.includes(unit.category)) return false;
    if (filters.lengths?.length && !filters.lengths.includes(unit.length)) return false;
    if (filters.types?.length && !filters.types.includes(unit.type)) return false;
    if (filters.tones?.length && !filters.tones.includes(unit.tone)) return false;
    if (filters.intensities?.length && !filters.intensities.includes(unit.emotionalIntensity)) return false;
    if (filters.origin === "original" && !unit.original) return false;
    if (filters.origin === "quote" && unit.original) return false;
    if (query && !`${unit.title ?? ""} ${unit.text ?? ""} ${unit.author ?? ""}`.toLowerCase().includes(query)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Che cosa c'è già nell'album
// ---------------------------------------------------------------------------

/** Chiavi di tutti i testi presenti sugli spread (un testo della libreria è «usato» se compare uguale in una pagina). */
export function usedTextKeys(project: Project): Set<string> {
  const keys = new Set<string>();
  for (const spread of project.spreads) {
    for (const overlay of overlaysOf(spread)) if (overlay.kind === "text" && overlay.text.trim()) keys.add(storyKey(overlay.text));
  }
  return keys;
}

export function isStoryUsed(unit: StoryUnit, used: ReadonlySet<string>): boolean {
  return [unit.title, unit.text].some((value) => Boolean(value) && used.has(storyKey(value!)));
}

/** Le unità della libreria già usate nell'album. */
export function usedStories(project: Project, library: readonly StoryUnit[] = STORY_LIBRARY): StoryUnit[] {
  const used = usedTextKeys(project);
  return library.filter((unit) => isStoryUsed(unit, used));
}

const words = (text: string): Set<string> => new Set(storyKey(text).replace(/[^a-zàèéìòù' ]/g, " ").split(" ").filter((word) => word.length >= 4));

/** Somiglianza tra due testi (0-1): parole importanti in comune su quelle totali. */
export function textSimilarity(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

// ---------------------------------------------------------------------------
// Contesto: fase, spazio, foto
// ---------------------------------------------------------------------------

/** Parole nei nomi dei capitoli e delle etichette che dicono in che momento della giornata siamo. In ordine di priorità. */
const PHASE_KEYWORDS: ReadonlyArray<readonly [RegExp, StoryCategory]> = [
  [/prepar|vestizione|trucco|acconciatura|getting|abito|bouquet/i, "preparativi"],
  [/\bcasa\b/i, "casa"],
  [/attesa|arrivo/i, "attesa"],
  [/chiesa|cerimonia|rito\b|municipio|altare|promesse|nozze/i, "cerimonia"],
  [/sguard/i, "sguardi"],
  [/ritratt|coppia|shooting|servizio|sposi/i, "ritratto_coppia"],
  [/dettagl|particolar|allestiment/i, "dettagli"],
  [/famigli|parenti|genitori|nonni/i, "famiglia"],
  [/amic/i, "amici"],
  [/invitat|ospit/i, "invitati"],
  [/tramonto|golden|ora d'oro/i, "tramonto"],
  [/notte|fuochi/i, "notte"],
  [/festa|ballo|danz|musica|party|\bdj\b/i, "festa"],
  [/ricevimento|banchetto|pranzo|cena|torta|location|villa|brindisi/i, "ricevimento"],
  [/final|chiusura|saluti|addio/i, "finale"],
];

function categoriesIn(text: string): StoryCategory[] {
  return PHASE_KEYWORDS.filter(([pattern]) => pattern.test(text)).map(([, category]) => category);
}

/** Nomi (capitoli ed etichette) collegati alle foto di uno spread. */
function namesOfSpread(project: Project, spread: AlbumSpread): string[] {
  const assetIds = new Set(spread.areas.flatMap((area) => area.items.map((item) => item.assetId)));
  const names: string[] = [];
  for (const chapter of project.chapters) if (chapter.assetIds.some((id) => assetIds.has(id))) names.push(chapter.title);
  const labelName = new Map(project.labels.map((label) => [label.id, label.name]));
  for (const asset of project.assets) {
    if (!assetIds.has(asset.id)) continue;
    for (const label of asset.customLabels ?? []) names.push(label);
    for (const id of asset.labelIds ?? []) { const name = labelName.get(id); if (name) names.push(name); }
  }
  return names;
}

/** Fase e tipi di foto di uno spread, dai nomi dei capitoli e delle etichette; se mancano, dalla posizione nell'album. */
export function inferPhase(project: Project, spreadIndex: number): { phase: StoryCategory | null; tags: string[] } {
  const spread = project.spreads[spreadIndex];
  if (!spread) return { phase: null, tags: [] };
  const tags = new Set<string>();
  const votes = new Map<StoryCategory, number>();
  for (const name of namesOfSpread(project, spread)) {
    const found = categoriesIn(name);
    found.forEach((category, rank) => { tags.add(category); votes.set(category, (votes.get(category) ?? 0) + (rank === 0 ? 2 : 1)); });
  }
  const assetIds = new Set(spread.areas.flatMap((area) => area.items.map((item) => item.assetId)));
  if (project.assets.some((asset) => assetIds.has(asset.id) && ((asset.albumTags ?? []).includes("panorama") || asset.aspectRatio >= 2.1))) { tags.add("paesaggio"); tags.add("luogo"); }
  const best = [...votes].sort((a, b) => b[1] - a[1] || PHASE_KEYWORDS.findIndex(([, c]) => c === a[0]) - PHASE_KEYWORDS.findIndex(([, c]) => c === b[0]))[0];
  if (best) return { phase: best[0], tags: [...tags] };
  const last = project.spreads.length - 1;
  if (last <= 0) return { phase: null, tags: [...tags] };
  const progress = spreadIndex / last;
  const phase: StoryCategory = spreadIndex === 0 ? "aperture"
    : spreadIndex === last ? "finale"
      : progress < 0.12 ? "preparativi" : progress < 0.22 ? "attesa" : progress < 0.4 ? "cerimonia"
        : progress < 0.55 ? "ritratto_coppia" : progress < 0.75 ? "ricevimento" : progress < 0.9 ? "festa" : "finale";
  return { phase, tags: [...tags] };
}

/** Quanto spazio c'è nella pagina: libera = una pagina intera per il testo; con foto resta poco spazio (titoli e frasi brevi). */
export function spaceOfArea(spread: AlbumSpread, areaIndex: number): StorySpace {
  const area = spread.areas[areaIndex];
  if (!area) return "micro";
  return area.items.length === 0 ? "large" : "small";
}

export interface ContextOptions {
  space?: StorySpace;
  includeQuotes?: boolean;
  seed?: number;
}

export function storyContextFor(project: Project, spreadId: string, areaIndex: number, options: ContextOptions = {}): StoryContext | null {
  const spreadIndex = project.spreads.findIndex((spread) => spread.id === spreadId);
  if (spreadIndex < 0) return null;
  const spread = project.spreads[spreadIndex];
  const { phase, tags } = inferPhase(project, spreadIndex);
  const last = project.spreads.length - 1;
  const position: StoryPosition = spreadIndex === 0 ? "opening" : spreadIndex === last && last > 0 ? "closing" : "middle";
  // Testi sulle pagine vicine (due prima e due dopo): servono a evitare frasi troppo simili di seguito.
  const nearby: string[] = [];
  let lastCategory: StoryCategory | null = null;
  const known = new Map<string, StoryUnit>();
  for (const unit of STORY_LIBRARY) for (const value of [unit.text, unit.title]) if (value) known.set(value, unit);
  for (let offset = -2; offset <= 2; offset += 1) {
    const neighbour = project.spreads[spreadIndex + offset];
    if (!neighbour || offset === 0) continue;
    for (const overlay of overlaysOf(neighbour)) {
      if (overlay.kind !== "text" || !overlay.text.trim()) continue;
      nearby.push(overlay.text);
      const match = known.get(overlay.text);
      if (match && Math.abs(offset) === 1) lastCategory = match.category;
    }
  }
  return {
    phase,
    position,
    space: options.space ?? spaceOfArea(spread, areaIndex),
    tags,
    intensity: (phase && PHASE_INTENSITY[phase]) || 3,
    used: usedTextKeys(project),
    nearby,
    lastCategory,
    includeQuotes: options.includeQuotes ?? false,
    seed: options.seed ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Punteggio e scelta
// ---------------------------------------------------------------------------

/** Pezzi di variazione ripetibili: stesso seme, stesso ordine; seme diverso, ordine diverso tra testi di punteggio simile. */
function jitter(seed: number, id: string): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < id.length; index += 1) { hash ^= id.charCodeAt(index); hash = Math.imul(hash, 16777619) >>> 0; }
  return ((hash % 1000) / 1000) * 5;
}

/** Spazio richiesto dal testo che sta in cima alla scelta: le unità che non entrano non si propongono. */
function fitsSpace(unit: StoryUnit, space: StorySpace): boolean {
  if (unit.type === "quote") return space === "micro" ? false : space === "small" ? unit.length === "short" || unit.length === "micro" : true;
  switch (space) {
    case "micro": return unit.type === "title" || unit.type === "microcopy";
    case "small": return (unit.type === "title" || unit.type === "microcopy" || unit.type === "short") && !(unit.title && unit.text) && unit.length !== "medium" && unit.length !== "long";
    case "medium": return (unit.type === "short" || unit.type === "medium") && unit.length !== "long";
    case "large": return unit.type === "medium" || unit.type === "long" || (unit.type === "short" && unit.length !== "micro");
  }
}

const WANTED_PLACEMENT: Record<StorySpace, readonly StoryPlacement[]> = {
  micro: ["small_space", "image_overlay"],
  small: ["image_overlay", "small_space", "text_block"],
  medium: ["text_block"],
  large: ["full_page", "double_page"],
};

const IDEAL_LENGTH: Record<StorySpace, readonly StoryLength[]> = {
  micro: ["micro"], small: ["short"], medium: ["medium", "short"], large: ["long", "medium"],
};

/** Punteggio di un'unità nel contesto; null se non è adatta (già usata, non entra, troppo simile, citazione non richiesta…). */
export function scoreStory(unit: StoryUnit, ctx: StoryContext): number | null {
  if (unit.type === "quote" && !ctx.includeQuotes) return null;
  if (!fitsSpace(unit, ctx.space)) return null;
  if (isStoryUsed(unit, ctx.used)) return null;
  const shown = storyDisplayText(unit);
  const similarity = Math.max(0, ...ctx.nearby.map((text) => textSimilarity(shown, text)));
  if (similarity >= 0.5) return null;

  let score = 0;
  if (ctx.phase) {
    if (unit.category === ctx.phase) score += 40;
    else if (unit.recommendedFor.includes(ctx.phase)) score += 22;
    else if (UNIVERSAL.has(unit.category)) score += 8;
    else score -= 6;
  } else if (UNIVERSAL.has(unit.category)) score += 8;

  if (ctx.position === "opening") {
    if (OPENING_ONLY.has(unit.category)) score += 24;
    if (unit.placement.includes("opening")) score += 8;
    if (CLOSING_ONLY.has(unit.category)) score -= 35;
  } else if (ctx.position === "closing") {
    if (CLOSING_ONLY.has(unit.category)) score += 24;
    if (unit.placement.includes("closing")) score += 8;
    if (OPENING_ONLY.has(unit.category)) score -= 35;
  } else if (OPENING_ONLY.has(unit.category) || CLOSING_ONLY.has(unit.category)) {
    score -= 35;
  }

  score += Math.min(18, unit.recommendedFor.filter((tag) => ctx.tags.includes(tag)).length * 6);
  if (unit.placement.some((placement) => WANTED_PLACEMENT[ctx.space].includes(placement))) score += 6;
  const ideal = IDEAL_LENGTH[ctx.space];
  score += unit.length === ideal[0] ? 10 : ideal.includes(unit.length) ? 4 : 0;
  score -= 3 * Math.abs(unit.emotionalIntensity - ctx.intensity);
  if (similarity >= 0.3) score -= 20;
  if (ctx.lastCategory && unit.category === ctx.lastCategory) score -= 8;
  return score + jitter(ctx.seed, unit.id);
}

export interface ScoredStory { unit: StoryUnit; score: number }

export function rankStories(ctx: StoryContext, library: readonly StoryUnit[] = STORY_LIBRARY): ScoredStory[] {
  const ranked: ScoredStory[] = [];
  for (const unit of library) {
    const score = scoreStory(unit, ctx);
    if (score !== null) ranked.push({ unit, score });
  }
  return ranked.sort((a, b) => b.score - a.score || a.unit.id.localeCompare(b.unit.id));
}

export type StoryKind = "title" | "microcopy" | "paragraph" | "pair" | "quote";

export interface StoryProposal {
  kind: StoryKind;
  title?: string;
  text?: string;
  author?: string | null;
  category: StoryCategory;
  tone: StoryTone;
  /** Unità della libreria da cui nasce (una, o due se titolo e paragrafo vengono da voci diverse). */
  unitIds: string[];
}

const CANDIDATES = 14;

/** Un titolo adatto da mettere sopra un paragrafo: della stessa categoria, non usato, non troppo simile. */
function companionTitle(main: StoryUnit, ctx: StoryContext, library: readonly StoryUnit[], attempt: number): StoryUnit | null {
  const text = main.text ?? "";
  const options = library
    .filter((unit) => unit.type === "title" && unit.category === main.category && !isStoryUsed(unit, ctx.used) && textSimilarity(unit.title ?? "", text) < 0.5 && !ctx.nearby.some((near) => storyKey(near) === storyKey(unit.title ?? "")))
    .map((unit) => ({ unit, score: jitter(ctx.seed, unit.id) }))
    .sort((a, b) => b.score - a.score || a.unit.id.localeCompare(b.unit.id));
  // Con «Rigenera» i titoli scorrono in ordine: due tentativi di fila non propongono mai lo stesso.
  return options.length ? options[((attempt % options.length) + options.length) % options.length].unit : null;
}

/**
 * Propone un testo per il contesto. `attempt` scorre le alternative in ordine di punteggio (0 = la migliore): serve a «Rigenera testo».
 * Con spazio sufficiente un paragrafo si accompagna a un titolo della stessa categoria; con poco spazio si propone solo la frase breve,
 * con pochissimo un titolo o una parola.
 */
export function proposeStory(ctx: StoryContext, attempt = 0, library: readonly StoryUnit[] = STORY_LIBRARY): StoryProposal | null {
  const ranked = rankStories(ctx, library).slice(0, CANDIDATES);
  if (ranked.length === 0) return null;
  const main = ranked[((attempt % ranked.length) + ranked.length) % ranked.length].unit;
  const base = { category: main.category, tone: main.tone };
  if (main.type === "quote") return { ...base, kind: "quote", text: main.text, author: main.author, unitIds: [main.id] };
  if (main.type === "microcopy") return { ...base, kind: "microcopy", text: main.text, unitIds: [main.id] };
  if (main.type === "title") return { ...base, kind: "title", title: main.title, unitIds: [main.id] };
  if (main.title && main.text) return { ...base, kind: "pair", title: main.title, text: main.text, unitIds: [main.id] };
  if ((ctx.space === "medium" || ctx.space === "large") && main.text) {
    const title = companionTitle(main, ctx, library, attempt);
    if (title) return { ...base, kind: "pair", title: title.title, text: main.text, unitIds: [title.id, main.id] };
  }
  return { ...base, kind: "paragraph", text: main.text, unitIds: [main.id] };
}

/** Il testo di una singola unità come proposta (per inserirla a mano dalla libreria). */
export function proposalFromUnit(unit: StoryUnit): StoryProposal {
  const base = { category: unit.category, tone: unit.tone, unitIds: [unit.id] };
  if (unit.type === "quote") return { ...base, kind: "quote", text: unit.text, author: unit.author };
  if (unit.type === "microcopy") return { ...base, kind: "microcopy", text: unit.text };
  if (unit.type === "title") return { ...base, kind: "title", title: unit.title };
  if (unit.title && unit.text) return { ...base, kind: "pair", title: unit.title, text: unit.text };
  return { ...base, kind: "paragraph", text: unit.text };
}

// ---------------------------------------------------------------------------
// Inserimento nello spread
// ---------------------------------------------------------------------------

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Come si compone il testo a pagina: carattere e misura dipendono dal tono e dalla larghezza della cornice. */
export function partsForProposal(proposal: StoryProposal, boxMm: number): TextPartInput[] {
  const parts: TextPartInput[] = [];
  const centered = { align: "center" as const };
  if (proposal.title) {
    const sans = proposal.tone === "cinematic" || proposal.tone === "minimal";
    const serifItalic = proposal.tone === "poetic" || proposal.tone === "intimate" || proposal.tone === "elegant" || proposal.tone === "reflective";
    parts.push({
      presetId: "headline",
      text: proposal.title,
      style: sans
        ? { ...centered, font: "italiana", weight: 400, uppercase: true, trackingEm: 0.14, sizePt: clamp(Math.round(boxMm * 0.14), 14, 40), lineHeight: 1.1 }
        : serifItalic
          ? { ...centered, font: "cormorant-garamond", weight: 400, italic: true, sizePt: clamp(Math.round(boxMm * 0.22), 20, 56), lineHeight: 1.05 }
          : { ...centered, sizePt: clamp(Math.round(boxMm * 0.2), 18, 54) },
    });
  }
  if (proposal.text) {
    if (proposal.kind === "microcopy") {
      parts.push({ presetId: "kicker", text: proposal.text, style: { ...centered, sizePt: clamp(Math.round(boxMm * 0.07), 8, 16) } });
    } else if (proposal.kind === "quote") {
      parts.push({ presetId: "pullquote", text: `«${proposal.text}»`, style: { sizePt: clamp(Math.round(boxMm * 0.12), 14, 34) } });
      if (proposal.author) parts.push({ presetId: "kicker", text: proposal.author, style: { ...centered, sizePt: clamp(Math.round(boxMm * 0.05), 7, 11) } });
    } else {
      const long = (proposal.text.length > 300) || proposal.text.split("\n").length > 4;
      const sentence = proposal.text.length <= 130 && !proposal.title;
      parts.push(sentence
        ? { presetId: "deck", text: proposal.text, style: { ...centered, sizePt: clamp(Math.round(boxMm * 0.1), 11, 24) } }
        : { presetId: "body", text: proposal.text, style: { align: long ? "left" : "center", sizePt: clamp(Math.round(boxMm * 0.07), 9, 16), lineHeight: 1.5, paragraphSpacePt: 4 } });
    }
  }
  return parts;
}

function boxFractionFor(space: StorySpace, pageFraction: number): number {
  const wanted = space === "large" ? 0.36 : space === "medium" ? 0.3 : 0.24;
  return Math.min(wanted, pageFraction * 0.8);
}

/** Aggiunge il testo a una pagina dello spread: a metà pagina se è libera, in basso se ci sono foto. Restituisce gli elementi creati. */
export function insertStory(project: Project, spreadId: string, areaIndex: number, proposal: StoryProposal, space?: StorySpace): { project: Project; overlayIds: string[] } | null {
  const found = findSpread(project, spreadId);
  const area = found?.spread.areas[areaIndex];
  if (!found || !area) return null;
  const sheet = project.settings.sheet;
  const { width } = spreadSizeMm(sheet);
  const page = areaOuterRects(sheet, found.spread.split)[areaIndex] ?? areaOuterRects(sheet, "full")[0];
  const resolved = space ?? spaceOfArea(found.spread, areaIndex);
  const fraction = boxFractionFor(resolved, page.w / width);
  const parts = partsForProposal(proposal, fraction * width);
  if (parts.length === 0) return null;
  const free = area.items.length === 0;
  const made = addTextParts(project, spreadId, parts, {
    width: fraction,
    at: { x: (page.x + page.w / 2) / width, y: free ? 0.5 : 0.8 },
    centerY: free,
    backdrop: free ? area.style.background : undefined,
    mainPresetId: parts[0].presetId,
  });
  return made.overlayIds.length ? { project: made.project, overlayIds: made.overlayIds } : null;
}

export interface SuggestOptions extends ContextOptions {
  /** 0 = la proposta migliore; ogni «Rigenera» passa alla successiva. */
  attempt?: number;
  /** Elementi della proposta precedente da togliere prima di inserire la nuova. */
  replace?: readonly string[];
}

export interface SuggestResult {
  project: Project;
  overlayIds: string[];
  proposal: StoryProposal;
  context: StoryContext;
}

/** Propone e inserisce un testo per una pagina; con `replace` sostituisce la proposta precedente in un solo passaggio. null se non c'è nulla di adatto. */
export function suggestStoryForSpread(project: Project, spreadId: string, areaIndex: number, options: SuggestOptions = {}): SuggestResult | null {
  let base = project;
  for (const id of options.replace ?? []) base = removeOverlay(base, spreadId, id);
  const context = storyContextFor(base, spreadId, areaIndex, options);
  if (!context) return null;
  const proposal = proposeStory(context, options.attempt ?? 0);
  if (!proposal) return null;
  const inserted = insertStory(base, spreadId, areaIndex, proposal, context.space);
  return inserted ? { project: inserted.project, overlayIds: inserted.overlayIds, proposal, context } : null;
}

/** Cambia il testo di un elemento già sullo spread con quello di una voce della libreria (sceglie il paragrafo, o il titolo se non c'è). */
export function replaceWithStory(project: Project, spreadId: string, overlayId: string, unit: StoryUnit): Project {
  const text = unit.type === "quote" && unit.text ? `«${unit.text}»` : storyDisplayText(unit);
  return text ? updateOverlay(project, spreadId, overlayId, { text }) : project;
}

// ---------------------------------------------------------------------------
// Tutto l'album
// ---------------------------------------------------------------------------

export interface PlanOptions {
  /** Quanti testi al massimo (di base uno ogni quattro spread). */
  maxTexts?: number;
  /** Spread senza testo tra un testo e il successivo. */
  minGap?: number;
}

export interface PlannedStory { spreadId: string; spreadNumber: number; proposal: StoryProposal }

function chapterStarts(project: Project): Set<number> {
  const starts = new Set<number>();
  for (const chapter of project.chapters) {
    const ids = new Set(chapter.assetIds);
    const index = project.spreads.findIndex((spread) => spread.areas.some((area) => area.items.some((item) => ids.has(item.assetId))));
    if (index >= 0) starts.add(index);
  }
  return starts;
}

const hasText = (spread: AlbumSpread) => overlaysOf(spread).some((overlay) => overlay.kind === "text");

/**
 * Sceglie dove mettere i testi: solo sulle pagine libere (senza foto), in apertura, all'inizio dei capitoli e in chiusura, mai a ogni
 * pagina (di base uno ogni quattro spread, con almeno due spread vuoti di testo in mezzo). Ogni scelta vede i testi già inseriti,
 * quindi non si ripete nulla. Gli spread segnati come finiti e quelli che hanno già un testo non si toccano.
 */
export function planAlbumStories(project: Project, options: PlanOptions = {}): { project: Project; planned: PlannedStory[] } {
  const count = project.spreads.length;
  const maxTexts = options.maxTexts ?? Math.max(1, Math.ceil(count / 4));
  const minGap = options.minGap ?? 2;
  const starts = chapterStarts(project);
  const wanted = (index: number) => index === 0 || index === count - 1 || starts.has(index);
  let next = project;
  const planned: PlannedStory[] = [];
  const freeAreaOf = (spread: AlbumSpread): number => {
    const empty = spread.areas.map((area, index) => (area.items.length === 0 ? index : -1)).filter((index) => index >= 0);
    return empty.length ? empty[empty.length - 1] : -1;
  };
  // Prima le posizioni che contano (apertura, capitoli, chiusura), poi le altre pagine libere in ordine, finché c'è posto.
  const order = [...Array(count).keys()].sort((a, b) => Number(wanted(b)) - Number(wanted(a)) || a - b);
  const chosen: number[] = [];
  for (const index of order) {
    if (chosen.length >= maxTexts) break;
    const spread = project.spreads[index];
    if (spread.done || hasText(spread) || freeAreaOf(spread) < 0) continue;
    if (chosen.some((other) => Math.abs(other - index) <= minGap && !(wanted(index) && wanted(other)))) continue;
    chosen.push(index);
  }
  chosen.sort((a, b) => a - b);
  for (const index of chosen) {
    const spread = project.spreads[index];
    const areaIndex = freeAreaOf(spread);
    const made = suggestStoryForSpread(next, spread.id, areaIndex, { attempt: 0 });
    if (!made) continue;
    next = made.project;
    planned.push({ spreadId: spread.id, spreadNumber: index + 1, proposal: made.proposal });
  }
  return { project: next, planned };
}

/** Categorie in ordine, per i menu. */
export const STORY_CATEGORY_ORDER: readonly StoryCategory[] = STORY_CATEGORIES;
