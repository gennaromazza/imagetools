import type { TextMeasure } from "../render/text-layout";

/**
 * Caroselli e storie per i social, ricavati da un album finito.
 * Si salvano le scelte (stile, foto, testi), mai le coordinate: ogni slide si ricostruisce da un modello (`SlideTemplate`)
 * misurando il testo con i font veri, quindi cambiare formato, colori o font ridisegna tutto in modo coerente.
 * Le misure sono in pixel sulla tela della slide (sempre 1080 px di larghezza).
 */

export type SocialFormatId = "feed" | "square" | "story";

export interface SocialFormat {
  id: SocialFormatId;
  label: string;
  width: number;
  height: number;
  note: string;
}

export const SOCIAL_FORMATS: readonly SocialFormat[] = [
  { id: "feed", label: "Post 4:5", width: 1080, height: 1350, note: "Il formato che occupa più spazio nel feed" },
  { id: "square", label: "Quadrato 1:1", width: 1080, height: 1080, note: "Classico: si vede intero anche nel profilo" },
  { id: "story", label: "Storia 9:16", width: 1080, height: 1920, note: "A tutto schermo per le Storie" },
];

export const MIN_SLIDES = 2;
/** Limite di Instagram per un carosello. */
export const MAX_SLIDES = 20;

export function formatOf(id: SocialFormatId): SocialFormat {
  return SOCIAL_FORMATS.find((format) => format.id === id) ?? SOCIAL_FORMATS[0];
}

// ---------------------------------------------------------------------------
// Marca
// ---------------------------------------------------------------------------

/** Quattro colori bastano a un set intero: fondo scuro, fondo chiaro, colore d'accento, tinta di mezzo per i riquadri. */
export interface Palette {
  id: string;
  label: string;
  dark: string;
  light: string;
  accent: string;
  soft: string;
}

export interface FontPair {
  id: string;
  label: string;
  /** Titoli giganti. */
  display: string;
  /** Parole calligrafiche sovrapposte. */
  script: string;
  /** Testi piccoli, didascalie, pulsanti. */
  body: string;
}

export interface BrandKit {
  /** Nome dello studio, mostrato nei piè di pagina e nel monogramma. */
  name: string;
  /** Profilo social («@nomestudio»). */
  handle: string;
  paletteId: string;
  fontPairId: string;
}

// ---------------------------------------------------------------------------
// Livelli
// ---------------------------------------------------------------------------

interface LayerBase {
  id: string;
  /** Spostamento a mano dell'elemento, in pixel della tela (non cambia le sue misure). */
  dx?: number;
  dy?: number;
  /** Gradi, attorno al centro dell'elemento. */
  rotation?: number;
  opacity?: number;
}

export interface RectLayer extends LayerBase {
  kind: "rect";
  x: number; y: number; w: number; h: number;
  fill?: string;
  stroke?: string;
  strokeW?: number;
  radius?: number;
}

export interface EllipseLayer extends LayerBase {
  kind: "ellipse";
  x: number; y: number; w: number; h: number;
  fill?: string;
  stroke?: string;
  strokeW?: number;
}

export interface LineLayer extends LayerBase {
  kind: "line";
  x1: number; y1: number; x2: number; y2: number;
  stroke: string;
  strokeW: number;
  dash?: string;
}

/** Tracciato libero (stelle, ornamenti): coordinate già in pixel della tela. */
export interface PathLayer extends LayerBase {
  kind: "path";
  d: string;
  fill?: string;
  stroke?: string;
  strokeW?: number;
}

/** Sfumatura lineare tra due colori (anche trasparente), per scurire una foto sotto il testo. */
export interface GradientLayer extends LayerBase {
  kind: "gradient";
  x: number; y: number; w: number; h: number;
  from: string; fromOpacity: number;
  to: string; toOpacity: number;
  /** Verso: da dove parte il primo colore. */
  direction: "top" | "bottom" | "left" | "right";
}

export type PhotoMask = "rect" | "ellipse" | "arch";

export interface PhotoLayer extends LayerBase {
  kind: "photo";
  /** Posizione nell'elenco delle foto della slide. */
  slot: number;
  assetId: string | null;
  x: number; y: number; w: number; h: number;
  mask: PhotoMask;
  radius?: number;
  zoom: number;
  cx: number;
  cy: number;
  /** Cornice bianca (o di altro colore) attorno alla foto. */
  border?: { w: number; color: string };
  shadow?: boolean;
  /** Sfocatura in pixel (sfondi). */
  blur?: number;
  /** Scurisce la foto: 0-1. */
  dim?: number;
  mono?: boolean;
}

export interface TextLayer extends LayerBase {
  kind: "text";
  x: number; y: number; w: number;
  text: string;
  font: string;
  sizePx: number;
  weight: 300 | 400 | 600 | 700;
  italic: boolean;
  color: string;
  align: "left" | "center" | "right";
  lineHeight: number;
  trackingEm: number;
  uppercase: boolean;
  /** Il campo del modello da cui viene il testo (per modificarlo cliccandolo nell'anteprima). */
  field?: string;
}

/** Pagina vera dell'album mostrata come in una scena (immagine già disegnata, passata dal chiamante). */
export interface SpreadLayer extends LayerBase {
  kind: "spread";
  spreadId: string | null;
  x: number; y: number; w: number;
  /** Proporzioni larghezza / altezza dello spread. */
  aspect: number;
  shadow?: boolean;
}

export type Layer = RectLayer | EllipseLayer | LineLayer | PathLayer | GradientLayer | PhotoLayer | TextLayer | SpreadLayer;

// ---------------------------------------------------------------------------
// Modelli di slide
// ---------------------------------------------------------------------------

export type SlideRole = "cover" | "hero" | "collage" | "quote" | "list" | "pano" | "mockup" | "cta" | "moment";
export type SlotKind = "portrait" | "landscape" | "any";
export type Tone = "dark" | "light";
export type SetId = "editoriale" | "galleria" | "moda" | "cinema";

export type TextColorChoice = "ink" | "accent" | "light" | "dark" | "soft";
export type TextFontChoice = "display" | "script" | "body";

/** Ritocchi allo stile di un testo del modello: restano solo le scelte fatte, il resto lo decide il modello. */
export interface TextStyleChoice {
  /** Moltiplica il corpo deciso dal modello (0,6-1,5). */
  scale?: number;
  color?: TextColorChoice;
  font?: TextFontChoice;
  align?: "left" | "center" | "right";
  uppercase?: boolean;
}

export const TEXT_SCALE = { min: 0.6, max: 1.5 } as const;

/** Come una foto è inquadrata nel suo spazio: zoom, punto centrale (0-1) e, se serve, la forma della finestra. */
export interface PhotoFraming {
  zoom: number;
  cx: number;
  cy: number;
  /** Proporzioni (larghezza / altezza) della finestra dentro lo spazio del modello; assente = la forma dello spazio. */
  shape?: number;
}

export const DEFAULT_FRAMING: PhotoFraming = { zoom: 1, cx: 0.5, cy: 0.5 };
export const MAX_ZOOM = 4;
/** Forme tra cui scegliere (come nei fotolibri): la finestra della foto assume queste proporzioni dentro lo spazio. */
export const SHAPE_CHOICES: ReadonlyArray<{ label: string; value: number | undefined }> = [
  { label: "Come lo spazio", value: undefined }, { label: "1:1", value: 1 }, { label: "4:5", value: 0.8 }, { label: "2:3", value: 2 / 3 },
  { label: "3:2", value: 1.5 }, { label: "16:9", value: 16 / 9 },
];

export interface PhotoRef {
  assetId: string;
  /** Proporzioni larghezza / altezza come appaiono (rotazione dell'utente inclusa). */
  aspect: number;
}

export interface SpreadRef {
  spreadId: string;
  aspect: number;
}

export interface TemplateCtx {
  width: number;
  height: number;
  brand: BrandKit;
  pal: Palette;
  fonts: FontPair;
  tone: Tone;
  photos: ReadonlyArray<PhotoRef | null>;
  /** Inquadratura scelta per ogni spazio (nulla = quella predefinita). */
  framing: ReadonlyArray<PhotoFraming | null>;
  /** Testi già completati con i valori predefiniti. */
  texts: Readonly<Record<string, string>>;
  /** Ritocchi di stile ai testi, per campo. */
  textStyle: Readonly<Record<string, TextStyleChoice>>;
  spread: SpreadRef | null;
  /** Seconda doppia pagina (il mockup ne mostra due impilate sui formati alti). */
  spread2: SpreadRef | null;
  span: { index: number; count: number } | null;
  /** Posizione della slide e numero totale (per «02/08»). */
  index: number;
  total: number;
  measure: TextMeasure;
}

export interface TextField {
  key: string;
  label: string;
  /** Valore proposto: può dipendere dalla marca e dall'album. */
  fallback: (context: { brand: BrandKit; albumName: string }) => string;
  multiline?: boolean;
}

export interface SlideBuild {
  background: string;
  layers: Layer[];
}

export interface SlideTemplate {
  id: string;
  set: SetId | "shared";
  role: SlideRole;
  label: string;
  /** Una riga per chi sceglie il modello. */
  note: string;
  tone: Tone;
  /** Forma delle foto richieste, nell'ordine degli spazi. */
  slots: readonly SlotKind[];
  fields: readonly TextField[];
  needsSpread?: boolean;
  /** Testi alternativi per quando lo stesso modello compare più volte nel carosello: la seconda copia non ripete la prima. */
  variants?: ReadonlyArray<Readonly<Record<string, string>>>;
  build(ctx: TemplateCtx): SlideBuild;
}

// ---------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------

/**
 * Una foto in «modo libero»: si mette dove si vuole nella slide, anche sovrapposta alle altre.
 * Le misure sono frazioni della tela (0-1), così cambiando formato la disposizione si adatta.
 */
export interface FreeFrame {
  id: string;
  assetId: string | null;
  x: number; y: number; w: number; h: number;
  /** Gradi, attorno al centro. */
  rotation?: number;
  zoom: number;
  cx: number;
  cy: number;
  mask: PhotoMask;
  /** Cornice bianca, come una stampa. */
  border?: boolean;
  shadow?: boolean;
}

export const FREE_MIN_SIZE = 0.06;
export const MAX_FREE_FRAMES = 12;

export interface Slide {
  id: string;
  templateId: string;
  /** Una voce per spazio foto del modello; `null` = spazio vuoto. */
  photos: Array<string | null>;
  /** Inquadratura di ogni foto (stessa posizione di `photos`); assente o nulla = predefinita. */
  framing?: Array<PhotoFraming | null>;
  texts: Record<string, string>;
  /** Stile dei testi scelto dall'utente, per campo (carattere, dimensione, colore, allineamento, maiuscole). */
  textStyle?: Record<string, TextStyleChoice>;
  tone?: Tone;
  /** Disposizione speculare: destra e sinistra si scambiano (stesso modello, aspetto diverso). */
  flip?: boolean;
  spreadId?: string | null;
  spreadId2?: string | null;
  /** Altri elementi del modello spostati a mano (riquadri, linee, ornamenti, numero di pagina…), per identificativo del livello: scostamento in frazioni della tela. */
  layerOffset?: Record<string, { dx: number; dy: number }>;
  /** Testi spostati a mano: scostamento dal posto del modello, in frazioni della larghezza (dx) e dell'altezza (dy) della tela. */
  textOffset?: Record<string, { dx: number; dy: number }>;
  /**
   * Modo libero: se presente, le foto del modello non si mostrano e al loro posto ci sono queste cornici (l'ultima sta sopra).
   * I testi e il resto del modello restano; `photos` conserva le foto del modello per quando si torna indietro.
   */
  free?: FreeFrame[];
  /** Panorama: questa slide mostra la parte `index` di un'immagine distesa su `count` slide. */
  span?: { index: number; count: number };
}

export interface Carousel {
  id: string;
  name: string;
  format: SocialFormatId;
  setId: SetId;
  brand: BrandKit;
  slides: Slide[];
  /** Numero che dà un ordine diverso ai modelli (e qualche specchio) a ogni carosello; 0 o assente = l'ordine di base dello stile. */
  seed?: number;
  /** Le foto in testa alla classifica quando il carosello è stato creato: se cambiano (stelle, segnalini) si propone di riscegliere. */
  basis?: string;
  /** Testo del post, salvato accanto alle immagini quando si esporta. */
  caption: string;
  createdAt: string;
  updatedAt: string;
}

/** Le foto che una slide mostra davvero: quelle delle cornici libere se e in modo libero, altrimenti quelle del modello. */
export function photosShown(slide: Slide): string[] {
  const ids = slide.free ? slide.free.map((frame) => frame.assetId) : slide.photos;
  return ids.filter((id): id is string => Boolean(id));
}
