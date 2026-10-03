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
export const TEXT_PRESETS: readonly TextPreset[] = [
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

export function textPreset(id: string): TextPreset {
  return TEXT_PRESETS.find((preset) => preset.id === id) ?? TEXT_PRESETS.find((preset) => preset.id === "body")!;
}
