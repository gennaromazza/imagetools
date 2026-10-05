import type { TextStyleSpec } from "@photo-tools/shared-types";

/**
 * Font dell'editor di testo. Sono tutti con licenza SIL Open Font License 1.1 (uso libero anche commerciale,
 * incorporabili nei file esportati) e i file stanno in `src/assets/fonts` (vedi FONTS.md). Non si usano font di sistema:
 * il testo deve risultare identico qui, nell'esportazione e in tipografia.
 */
export interface FontFamilyInfo {
  id: string;
  /** Nome della famiglia nel CSS e nell'SVG. */
  family: string;
  label: string;
  category: "didone" | "serif" | "display" | "sans" | "script";
  /** Come lo descriviamo a chi impagina. */
  note: string;
  weights: ReadonlyArray<300 | 400 | 600 | 700>;
  italic: boolean;
  /** Come ripiegare se il font non fosse ancora caricato. */
  fallback: string;
}

export const FONT_FAMILIES: readonly FontFamilyInfo[] = [
  { id: "bodoni-moda", family: "Bodoni Moda", label: "Bodoni Moda", category: "didone", note: "Contrasto altissimo: il look delle testate di moda", weights: [400, 700], italic: true, fallback: "serif" },
  { id: "playfair-display", family: "Playfair Display", label: "Playfair Display", category: "didone", note: "Titoli eleganti e citazioni", weights: [400, 700], italic: true, fallback: "serif" },
  { id: "abril-fatface", family: "Abril Fatface", label: "Abril Fatface", category: "didone", note: "Titolo nero e imponente", weights: [400], italic: false, fallback: "serif" },
  { id: "dm-serif-display", family: "DM Serif Display", label: "DM Serif Display", category: "display", note: "Titoli morbidi e leggibili", weights: [400], italic: true, fallback: "serif" },
  { id: "cormorant-garamond", family: "Cormorant Garamond", label: "Cormorant Garamond", category: "serif", note: "Corpo del testo raffinato, ottimo in corsivo", weights: [400, 700], italic: true, fallback: "serif" },
  { id: "libre-baskerville", family: "Libre Baskerville", label: "Libre Baskerville", category: "serif", note: "Paragrafi lunghi, molto leggibile", weights: [400, 700], italic: true, fallback: "serif" },
  { id: "italiana", family: "Italiana", label: "Italiana", category: "display", note: "Capitali sottili da galleria d'arte", weights: [400], italic: false, fallback: "serif" },
  { id: "cinzel", family: "Cinzel", label: "Cinzel", category: "display", note: "Capitali romane, solenni", weights: [400, 700], italic: false, fallback: "serif" },
  { id: "jost", family: "Jost", label: "Jost", category: "sans", note: "Geometrico alla Futura: sottotitoli e didascalie", weights: [300, 400, 600], italic: false, fallback: "sans-serif" },
  { id: "tenor-sans", family: "Tenor Sans", label: "Tenor Sans", category: "sans", note: "Sans umanista, sobrio", weights: [400], italic: false, fallback: "sans-serif" },
  { id: "montserrat", family: "Montserrat", label: "Montserrat", category: "sans", note: "Sans moderno per testi brevi", weights: [400, 700], italic: false, fallback: "sans-serif" },
  { id: "inter", family: "Inter", label: "Inter", category: "sans", note: "Sans neutro, ottimo a corpi piccoli", weights: [400, 700], italic: false, fallback: "sans-serif" },
  { id: "bebas-neue", family: "Bebas Neue", label: "Bebas Neue", category: "display", note: "Titoli alti e compatti, tutto maiuscolo", weights: [400], italic: false, fallback: "sans-serif" },
  { id: "pinyon-script", family: "Pinyon Script", label: "Pinyon Script", category: "script", note: "Corsivo calligrafico formale: firme e dediche", weights: [400], italic: false, fallback: "cursive" },
  { id: "great-vibes", family: "Great Vibes", label: "Great Vibes", category: "script", note: "Calligrafia morbida e fluida", weights: [400], italic: false, fallback: "cursive" },
];

export const FONT_CATEGORY_LABEL: Record<FontFamilyInfo["category"], string> = {
  didone: "Didone (moda)", serif: "Con grazie", display: "Titoli", sans: "Senza grazie", script: "Calligrafici",
};

export const DEFAULT_FONT_ID = "cormorant-garamond";

export function fontInfo(id: string): FontFamilyInfo {
  return FONT_FAMILIES.find((font) => font.id === id) ?? FONT_FAMILIES.find((font) => font.id === DEFAULT_FONT_ID)!;
}

/** Valore per `font-family` (nome + ripiego), già racchiuso tra apici. */
export function fontStack(id: string): string {
  const font = fontInfo(id);
  return `'${font.family}', ${font.fallback}`;
}

/** Peso e corsivo realmente disponibili per un font: si sceglie il più vicino a quello chiesto. */
export function nearestFace(id: string, weight: number, italic: boolean): { weight: 300 | 400 | 600 | 700; italic: boolean } {
  const font = fontInfo(id);
  const available = [...font.weights].sort((a, b) => Math.abs(a - weight) - Math.abs(b - weight) || b - a);
  return { weight: available[0] ?? 400, italic: italic && font.italic };
}

export const PT_TO_MM = 25.4 / 72;

export const TEXT_LIMITS = {
  sizePt: { min: 4, max: 400 },
  lineHeight: { min: 0.8, max: 3 },
  trackingEm: { min: -0.1, max: 1 },
  paragraphSpacePt: { min: 0, max: 80 },
  dropCapLines: { min: 0, max: 6 },
  opacity: { min: 0.05, max: 1 },
  /** Larghezza minima di una cornice di testo, in frazione dello spread. */
  width: { min: 0.03, max: 1 },
  textLength: 6000,
} as const;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);

/** Porta uno stile entro limiti sensati: le impostazioni della libreria e dei file non sono mai da fidarsi. */
export function sanitizeTextStyle(spec: Partial<TextStyleSpec> & { font?: string }): TextStyleSpec {
  const base = spec.font && FONT_FAMILIES.some((font) => font.id === spec.font) ? spec.font : DEFAULT_FONT_ID;
  const face = nearestFace(base, spec.weight ?? 400, spec.italic ?? false);
  const align = spec.align === "center" || spec.align === "right" || spec.align === "justify" ? spec.align : "left";
  return {
    font: base,
    sizePt: clamp(spec.sizePt ?? 12, TEXT_LIMITS.sizePt.min, TEXT_LIMITS.sizePt.max),
    weight: face.weight,
    italic: face.italic,
    color: typeof spec.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(spec.color) ? spec.color : "#1c1c1c",
    align,
    lineHeight: clamp(spec.lineHeight ?? 1.3, TEXT_LIMITS.lineHeight.min, TEXT_LIMITS.lineHeight.max),
    trackingEm: clamp(spec.trackingEm ?? 0, TEXT_LIMITS.trackingEm.min, TEXT_LIMITS.trackingEm.max),
    uppercase: spec.uppercase === true,
    paragraphSpacePt: clamp(spec.paragraphSpacePt ?? 0, TEXT_LIMITS.paragraphSpacePt.min, TEXT_LIMITS.paragraphSpacePt.max),
    dropCapLines: Math.round(clamp(spec.dropCapLines ?? 0, TEXT_LIMITS.dropCapLines.min, TEXT_LIMITS.dropCapLines.max)),
    opacity: clamp(spec.opacity ?? 1, TEXT_LIMITS.opacity.min, TEXT_LIMITS.opacity.max),
  };
}

const channel = (value: number) => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };

/** Luminanza relativa (0 nero … 1 bianco) di un colore #rgb / #rrggbb; null se non è leggibile. */
export function luminanceOf(color: string): number | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color.trim());
  if (!hex) return null;
  const full = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join("") : hex[1];
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number | null {
  const la = luminanceOf(a);
  const lb = luminanceOf(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Se il testo non si leggerebbe sullo sfondo (contrasto sotto 3:1) restituisce un colore chiaro o scuro che si legge; altrimenti lo stesso. */
export function readableOn(color: string, backdrop: string | undefined): string {
  if (!backdrop) return color;
  const ratio = contrastRatio(color, backdrop);
  if (ratio === null || ratio >= 3) return color;
  const back = luminanceOf(backdrop) ?? 1;
  return back < 0.4 ? "#f5f1ea" : "#1c1c1c";
}

export interface TextPreset {
  id: string;
  name: string;
  /** Per cosa si usa, in una riga. */
  use: string;
  /** Sezione dell'elenco in cui compare (es. «Capitoli del matrimonio»). Senza, sta in «Stili di base». */
  group?: string;
  /** Testo d'esempio che compare quando lo si aggiunge. */
  sample: string;
  /** Larghezza proposta, in frazione dello spread. */
  width: number;
  /**
   * Composizione: lo stile si aggiunge con i pezzi sotto (titolo, riga piccola, paragrafo…), uno sotto l'altro, ciascuno
   * come testo a sé. Il primo è lo stile stesso. Senza `stack` si aggiunge il solo `sample`.
   */
  stack?: ReadonlyArray<{ presetId: string; text: string; style?: Partial<TextStyleSpec> }>;
  style: TextStyleSpec;
}

const style = (spec: Partial<TextStyleSpec>) => sanitizeTextStyle(spec);

/** Stili editoriali di partenza, pensati per comporre una pagina come in una rivista. */
const BASE_TEXT_PRESETS: readonly TextPreset[] = [
  { id: "masthead", name: "Testata", use: "Il titolo grande della copertina", sample: "IL TUO ALBUM", width: 0.5,
    stack: [{ presetId: "masthead", text: "IL TUO ALBUM" }, { presetId: "kicker", text: "Matrimonio · Primavera 2026", style: { align: "center" } }],
    style: style({ font: "bodoni-moda", sizePt: 96, weight: 700, color: "#111111", align: "center", lineHeight: 1, trackingEm: 0.04, uppercase: true }) },
  { id: "headline", name: "Titolo", use: "Il titolo di un servizio fotografico", sample: "Il giorno più bello", width: 0.42,
    stack: [{ presetId: "kicker", text: "Matrimonio · Primavera 2026" }, { presetId: "headline", text: "Il giorno più bello" }, { presetId: "deck", text: "Una storia di luce, di mani intrecciate e di una giornata che non vorremmo finisse mai." }, { presetId: "body", text: "Il sole filtrava tra le tende quando tutto è cominciato. Ogni sguardo raccontava più di quanto le parole potessero dire, e nessuno aveva fretta di arrivare altrove." }],
    style: style({ font: "playfair-display", sizePt: 54, weight: 700, color: "#151515", align: "left", lineHeight: 1.05, trackingEm: -0.01 }) },
  { id: "kicker", name: "Sottotitolo", use: "Riga piccola, tutta maiuscola, sopra o sotto il titolo", sample: "Matrimonio · Primavera 2026", width: 0.4,
    style: style({ font: "jost", sizePt: 11, weight: 400, color: "#3a3a3a", align: "left", lineHeight: 1.4, trackingEm: 0.32, uppercase: true }) },
  { id: "deck", name: "Occhiello", use: "Due righe che introducono la storia", sample: "Una storia di luce, di mani intrecciate e di una giornata che non vorremmo finisse mai.", width: 0.32,
    style: style({ font: "cormorant-garamond", sizePt: 20, weight: 400, italic: true, color: "#222222", align: "left", lineHeight: 1.25 }) },
  { id: "body", name: "Testo", use: "Paragrafi del racconto, giustificati", sample: "Il sole filtrava tra le tende quando tutto è cominciato. Ogni sguardo raccontava più di quanto le parole potessero dire, e nessuno aveva fretta di arrivare altrove.\nLa festa è andata avanti fino a tardi, tra risate e brindisi.", width: 0.3,
    style: style({ font: "cormorant-garamond", sizePt: 11.5, weight: 400, color: "#1c1c1c", align: "justify", lineHeight: 1.4, paragraphSpacePt: 6 }) },
  { id: "dropcap", name: "Testo con capolettera", use: "Apertura di un articolo, con la prima lettera grande", sample: "Tutto è iniziato con un sorriso. Poi sono arrivati gli abbracci, la musica, il profumo dei fiori sulle sedie del giardino, e quella sensazione rara di essere nel posto giusto.", width: 0.3,
    style: style({ font: "libre-baskerville", sizePt: 10, weight: 400, color: "#1c1c1c", align: "justify", lineHeight: 1.5, dropCapLines: 3 }) },
  { id: "pullquote", name: "Citazione", use: "Una frase in evidenza, centrata", sample: "«Per sempre inizia oggi.»", width: 0.34,
    stack: [{ presetId: "pullquote", text: "«Per sempre inizia oggi.»" }, { presetId: "kicker", text: "Elena & Marco", style: { align: "center" } }],
    style: style({ font: "playfair-display", sizePt: 30, weight: 400, italic: true, color: "#1c1c1c", align: "center", lineHeight: 1.2 }) },
  { id: "caption", name: "Didascalia", use: "Nota piccola accanto a una foto", sample: "La cerimonia, ore 16.30 — Villa Adriana", width: 0.2,
    style: style({ font: "jost", sizePt: 7, weight: 400, color: "#555555", align: "left", lineHeight: 1.5, trackingEm: 0.14, uppercase: true }) },
  { id: "signature", name: "Firma", use: "Dedica o firma calligrafica", sample: "Elena & Marco", width: 0.3,
    style: style({ font: "pinyon-script", sizePt: 48, weight: 400, color: "#2a2a2a", align: "center", lineHeight: 1.1 }) },
  { id: "folio", name: "Numero di pagina", use: "Piccolo, in fondo alla pagina", sample: "— 12 —", width: 0.1,
    style: style({ font: "cinzel", sizePt: 8, weight: 400, color: "#444444", align: "center", lineHeight: 1.2, trackingEm: 0.2 }) },
  { id: "poster", name: "Titolo compatto", use: "Parole alte e strette, tutto maiuscolo", sample: "SI SPOSANO", width: 0.5,
    style: style({ font: "bebas-neue", sizePt: 84, weight: 400, color: "#111111", align: "left", lineHeight: 0.95, trackingEm: 0.02, uppercase: true }) },
];

// ---------------------------------------------------------------------------
// Modelli già composti per il matrimonio: titolo, riga piccola e occhiello con le frasi già scritte
// ---------------------------------------------------------------------------

type StackPart = { presetId: string; text: string; style?: Partial<TextStyleSpec> };
type Align = "left" | "center";

const kickerPart = (text: string, align: Align): StackPart => ({ presetId: "kicker", text, style: { align } });
const deckPart = (text: string, align: Align): StackPart => ({ presetId: "deck", text, style: { align } });
const captionPart = (text: string, align: Align): StackPart => ({ presetId: "caption", text, style: { align } });

function template(group: string, id: string, name: string, use: string, width: number, main: Partial<TextStyleSpec>, parts: readonly StackPart[]): TextPreset {
  const principal = parts.find((part) => part.presetId === id);
  return { id, name, use, group, sample: (principal ?? parts[0]).text, width, stack: parts, style: style(main) };
}

/** Cinque «voci» per i titoli di capitolo: cambiano carattere e allineamento, così le pagine di un album non sembrano tutte uguali. */
const CHAPTER_LOOKS: ReadonlyArray<{ align: Align; width: number; main: Partial<TextStyleSpec> }> = [
  { align: "left", width: 0.42, main: { font: "playfair-display", sizePt: 58, weight: 700, color: "#151515", lineHeight: 1.05, trackingEm: -0.01 } },
  { align: "center", width: 0.4, main: { font: "bodoni-moda", sizePt: 38, weight: 700, color: "#111111", lineHeight: 1.1, trackingEm: 0.12, uppercase: true } },
  { align: "center", width: 0.42, main: { font: "cormorant-garamond", sizePt: 58, weight: 400, italic: true, color: "#1f1a16", lineHeight: 1.05 } },
  { align: "center", width: 0.4, main: { font: "italiana", sizePt: 42, weight: 400, color: "#1c1c1c", lineHeight: 1.1, trackingEm: 0.16, uppercase: true } },
  { align: "left", width: 0.42, main: { font: "dm-serif-display", sizePt: 54, weight: 400, color: "#1a1a1a", lineHeight: 1.05 } },
];

const GROUP_CHAPTERS = "Capitoli del matrimonio";
const GROUP_COVERS = "Copertine e titoli";
const GROUP_QUOTES = "Citazioni";
const GROUP_DETAILS = "Dettagli e didascalie";
const GROUP_ENDINGS = "Dediche e chiusura";

function chapter(index: number, id: string, kicker: string, title: string, deck: string): TextPreset {
  const look = CHAPTER_LOOKS[index % CHAPTER_LOOKS.length];
  return template(GROUP_CHAPTERS, id, title, `Apre il capitolo «${title}»`, look.width, { ...look.main, align: look.align },
    [kickerPart(kicker, look.align), { presetId: id, text: title }, deckPart(deck, look.align)]);
}

/** Più di trenta modelli in stile rivista per un album di matrimonio: ognuno si aggiunge con tutti i suoi pezzi, già scritti e modificabili. */
export const WEDDING_TEXT_TEMPLATES: readonly TextPreset[] = [
  // Capitoli
  chapter(0, "cap-storia", "Capitolo primo", "La storia", "Tutto comincia da uno sguardo, e da due persone che hanno smesso di cercare."),
  chapter(1, "cap-dettagli", "Capitolo secondo", "I dettagli", "Quello che non si dice a voce alta vive nelle piccole cose."),
  chapter(2, "cap-mani", "Capitolo terzo", "Le mani", "Si riconoscono dai gesti: una carezza, una stretta, un anello che passa da una mano all'altra."),
  chapter(3, "cap-risveglio", "Prima di tutto", "Il risveglio", "La luce entra piano, il cuore va più veloce del tempo."),
  chapter(4, "cap-cerimonia", "Il momento", "La cerimonia", "Pochi minuti per dirsi tutto. Il silenzio, poi un sì."),
  chapter(0, "cap-promesse", "Parole date", "Le promesse", "Non servono grandi discorsi: basta dirlo guardandosi negli occhi."),
  chapter(1, "cap-anelli", "Un cerchio senza fine", "Gli anelli", "Due piccoli cerchi per una promessa che non ha scadenza."),
  chapter(2, "cap-festa", "Si brinda", "La festa", "Risate, tavoli apparecchiati e nessuno che guarda l'orologio."),
  chapter(3, "cap-ballo", "Prima danza", "Il primo ballo", "Il mondo intorno si ferma. Esistono solo la musica e loro due."),
  chapter(4, "cap-sera", "Sul far della sera", "La luce dorata", "Il sole scende, ma la giornata non vuole ancora finire."),

  // Copertine
  template(GROUP_COVERS, "cover-nomi", "Nomi e data", "Copertina sobria: i nomi in maiuscole sottili, data e luogo", 0.5,
    { font: "italiana", sizePt: 64, weight: 400, color: "#151515", align: "center", lineHeight: 1.05, trackingEm: 0.14, uppercase: true },
    [{ presetId: "cover-nomi", text: "Elena & Marco" }, kickerPart("26 settembre 2026", "center"), captionPart("Villa Adriana · Roma", "center")]),
  template(GROUP_COVERS, "cover-corsivo", "Nomi in corsivo", "Copertina romantica con i nomi calligrafici", 0.5,
    { font: "pinyon-script", sizePt: 84, weight: 400, color: "#2a2a2a", align: "center", lineHeight: 1.05 },
    [{ presetId: "cover-corsivo", text: "Elena & Marco" }, kickerPart("Il nostro giorno · 26.09.2026", "center")]),
  template(GROUP_COVERS, "cover-poster", "Si sposano", "Titolo alto e deciso, da poster", 0.5,
    { font: "bebas-neue", sizePt: 110, weight: 400, color: "#111111", align: "left", lineHeight: 0.92, trackingEm: 0.02, uppercase: true },
    [kickerPart("Elena e Marco", "left"), { presetId: "cover-poster", text: "Si sposano" }, captionPart("26 settembre 2026 · Roma", "left")]),
  template(GROUP_COVERS, "cover-storia", "Una storia d'amore", "Copertina da rivista, con occhiello", 0.44,
    { font: "playfair-display", sizePt: 52, weight: 700, color: "#151515", align: "left", lineHeight: 1.05, trackingEm: -0.01 },
    [kickerPart("Numero unico · Matrimonio", "left"), { presetId: "cover-storia", text: "Una storia d'amore" }, deckPart("Elena e Marco, 26 settembre 2026.", "left")]),
  template(GROUP_COVERS, "cover-minimale", "Solo i nomi", "Pagina quasi vuota: due nomi e un anno", 0.4,
    { font: "tenor-sans", sizePt: 26, weight: 400, color: "#222222", align: "center", lineHeight: 1.2, trackingEm: 0.4, uppercase: true },
    [{ presetId: "cover-minimale", text: "Elena · Marco" }, kickerPart("Matrimonio 2026", "center")]),

  // Citazioni
  template(GROUP_QUOTES, "quote-scelta", "Citazione: la scelta", "Frase in corsivo grande, centrata", 0.36,
    { font: "cormorant-garamond", sizePt: 36, weight: 400, italic: true, color: "#1c1c1c", align: "center", lineHeight: 1.15 },
    [{ presetId: "quote-scelta", text: "«Mi hai scelto ogni giorno, di nuovo.»" }, kickerPart("Elena & Marco", "center")]),
  template(GROUP_QUOTES, "quote-casa", "Citazione: casa", "Citazione elegante su due righe", 0.34,
    { font: "playfair-display", sizePt: 30, weight: 400, italic: true, color: "#1c1c1c", align: "center", lineHeight: 1.2 },
    [{ presetId: "quote-casa", text: "«Casa, per me, è dove ci sei tu.»" }, kickerPart("Il giorno delle nozze", "center")]),
  template(GROUP_QUOTES, "quote-luce", "Citazione: la luce", "Frase breve, carattere pieno", 0.36,
    { font: "dm-serif-display", sizePt: 34, weight: 400, color: "#151515", align: "center", lineHeight: 1.12 },
    [{ presetId: "quote-luce", text: "«Tutta la luce del mondo in un solo sguardo.»" }, kickerPart("Dal diario di un giorno", "center")]),
  template(GROUP_QUOTES, "quote-insieme", "Citazione: insieme", "Frase in evidenza, allineata a sinistra", 0.36,
    { font: "bodoni-moda", sizePt: 38, weight: 400, italic: true, color: "#111111", align: "left", lineHeight: 1.1 },
    [{ presetId: "quote-insieme", text: "«Insieme è la parola più bella.»" }, kickerPart("Elena & Marco", "left")]),
  template(GROUP_QUOTES, "quote-sempre", "Citazione: per sempre", "Frase calligrafica con la data", 0.34,
    { font: "pinyon-script", sizePt: 46, weight: 400, color: "#2a2a2a", align: "center", lineHeight: 1.15 },
    [{ presetId: "quote-sempre", text: "Sei il mio per sempre" }, kickerPart("26 settembre 2026", "center")]),
  template(GROUP_QUOTES, "quote-finalmente", "Citazione: finalmente", "Frase decisa, per un momento di festa", 0.34,
    { font: "abril-fatface", sizePt: 40, weight: 400, color: "#151515", align: "center", lineHeight: 1.1 },
    [{ presetId: "quote-finalmente", text: "«Finalmente marito e moglie.»" }, kickerPart("Villa Adriana, ore 17.10", "center")]),

  // Dettagli e didascalie
  template(GROUP_DETAILS, "det-luogo", "Luogo e orario", "Piccolo titolo con luogo e orario, accanto a una foto", 0.22,
    { font: "tenor-sans", sizePt: 13, weight: 400, color: "#1c1c1c", align: "left", lineHeight: 1.3, trackingEm: 0.28, uppercase: true },
    [{ presetId: "det-luogo", text: "La cerimonia" }, captionPart("Ore 16.30 · Villa Adriana", "left")]),
  template(GROUP_DETAILS, "det-numero", "Numero e titolo", "Un grande numero e il nome della sezione", 0.3,
    { font: "cormorant-garamond", sizePt: 84, weight: 400, color: "#1c1c1c", align: "left", lineHeight: 0.95 },
    [{ presetId: "det-numero", text: "01" }, kickerPart("La storia", "left")]),
  template(GROUP_DETAILS, "det-data", "La data", "La data del giorno in grande", 0.4,
    { font: "bebas-neue", sizePt: 72, weight: 400, color: "#111111", align: "left", lineHeight: 0.95, trackingEm: 0.04, uppercase: true },
    [kickerPart("Il giorno", "left"), { presetId: "det-data", text: "26.09.2026" }]),
  template(GROUP_DETAILS, "det-credito", "Fotografie di", "Il tuo nome, in fondo a una pagina", 0.3,
    { font: "jost", sizePt: 8, weight: 400, color: "#555555", align: "center", lineHeight: 1.4, trackingEm: 0.3, uppercase: true },
    [{ presetId: "det-credito", text: "Fotografie di" }, { presetId: "headline", text: "Il tuo studio", style: { sizePt: 22, align: "center", weight: 400, italic: true } }]),
  template(GROUP_DETAILS, "det-programma", "Il programma", "L'elenco degli orari della giornata", 0.28,
    { font: "tenor-sans", sizePt: 12, weight: 400, color: "#1c1c1c", align: "center", lineHeight: 1.3, trackingEm: 0.3, uppercase: true },
    [{ presetId: "det-programma", text: "Il programma" }, { presetId: "body", text: "16.30 · La cerimonia\n17.30 · L'aperitivo\n19.30 · La cena\n22.00 · Il taglio della torta", style: { align: "center", sizePt: 12, lineHeight: 1.9, paragraphSpacePt: 0 } }]),

  // Dediche e chiusura
  template(GROUP_ENDINGS, "end-grazie", "Grazie", "L'ultima pagina, con un ringraziamento", 0.46,
    { font: "great-vibes", sizePt: 92, weight: 400, color: "#2a2a2a", align: "center", lineHeight: 1.05 },
    [{ presetId: "end-grazie", text: "Grazie" }, deckPart("Per aver vissuto con noi il giorno più bello.", "center")]),
  template(GROUP_ENDINGS, "end-firma", "Firma con data", "Dedica firmata dagli sposi", 0.3,
    { font: "pinyon-script", sizePt: 52, weight: 400, color: "#2a2a2a", align: "center", lineHeight: 1.1 },
    [{ presetId: "end-firma", text: "Elena & Marco" }, kickerPart("Con amore · 2026", "center")]),
  template(GROUP_ENDINGS, "end-fine", "Fine del capitolo", "Chiusura dell'album, con una frase che resta", 0.4,
    { font: "playfair-display", sizePt: 36, weight: 400, italic: true, color: "#1c1c1c", align: "center", lineHeight: 1.15 },
    [kickerPart("Fine del primo capitolo", "center"), { presetId: "end-fine", text: "Il resto è una bellissima storia" }]),
  template(GROUP_ENDINGS, "end-dedica", "Dedica ai genitori", "Pagina di dedica, su tre righe", 0.4,
    { font: "cormorant-garamond", sizePt: 44, weight: 400, italic: true, color: "#1f1a16", align: "center", lineHeight: 1.05 },
    [kickerPart("Con gratitudine", "center"), { presetId: "end-dedica", text: "Ai nostri genitori" }, deckPart("Che ci hanno insegnato cos'è l'amore, ogni giorno, senza dirlo.", "center")]),
  template(GROUP_ENDINGS, "end-ringraziamenti", "Un grazie speciale", "Ringraziamenti ai fornitori e agli amici", 0.34,
    { font: "tenor-sans", sizePt: 14, weight: 400, color: "#1c1c1c", align: "center", lineHeight: 1.3, trackingEm: 0.3, uppercase: true },
    [{ presetId: "end-ringraziamenti", text: "Un grazie speciale" }, { presetId: "body", text: "Alla famiglia, agli amici e a tutti quelli che hanno reso possibile questo giorno.", style: { align: "center", sizePt: 12.5, lineHeight: 1.5 } }]),
];

export const BASE_GROUP = "Stili di base";

/** Gli stili di base e i modelli per il matrimonio, in questo ordine. */
export const TEXT_PRESETS: readonly TextPreset[] = [...BASE_TEXT_PRESETS.map((preset) => ({ ...preset, group: BASE_GROUP })), ...WEDDING_TEXT_TEMPLATES];

export function textPreset(id: string): TextPreset {
  return TEXT_PRESETS.find((preset) => preset.id === id) ?? TEXT_PRESETS.find((preset) => preset.id === "body")!;
}
