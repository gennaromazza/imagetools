import type { SetId, SlideTemplate, Tone } from "../types";
import { CINEMA } from "./cinema";
import { EDITORIALE } from "./editoriale";
import { GALLERIA } from "./galleria";
import { MODA } from "./moda";
import { SHARED } from "./shared";
import { mulberry32 } from "../../engine/rng";
import { CINEMA_MORE, EDITORIALE_MORE, GALLERIA_MORE, MODA_MORE } from "./more";
import { FLEX_TONE_IDS, UNIVERSAL } from "./universal";

export { FLEX_TONE_IDS };

export interface SetInfo {
  id: SetId;
  label: string;
  note: string;
  /** Tavolozza e font consigliati per partire. */
  paletteId: string;
  fontPairId: string;
  /** Fondo dei modelli universali: sempre scuro, sempre chiaro oppure alternato per dare ritmo. */
  flexTone: "dark" | "light" | "alternate";
  /** La «trama» del carosello: apertura, slide di mezzo (si ripetono se ne servono di più), chiusura. */
  arc: { open: string; middle: readonly string[]; close: string };
  /** Chiusure alternative: con un seme diverso da 0 se ne può scegliere una al posto di quella di base. */
  closeAlt?: readonly string[];
}

export const SETS: readonly SetInfo[] = [
  {
    id: "editoriale", label: "Editoriale", note: "Titoli giganti, fondi scuri e crema, testo dietro la foto",
    paletteId: "bosco", fontPairId: "moda", flexTone: "alternate",
    arc: { open: "ed-cover", middle: ["ed-hero", "ed-sandwich", "sh-mosaic4", "ed-quote", "ed-list", "sh-hero3", "sh-grid", "sh-polaroid", "sh-polaroid3", "sh-full", "sh-statement", "sh-wall4", "sh-split", "sh-arch", "sh-duo", "sh-trio", "ed-numbers", "ed-caption", "ed-triptych", "sh-faq", "sh-checklist", "sh-polaroid-duo", "sh-book", "sh-date", "sh-strips", "sh-columns4", "sh-polaroid4", "sh-film4", "sh-row3", "sh-circles3", "sh-stack4", "sh-arches3", "sh-lead3", "sh-letter3", "sh-solo-full", "sh-solo-inset", "sh-solo-mat", "sh-solo-frame", "sh-solo-caption", "sh-solo-circle", "sh-solo-band", "sh-solo-card"], close: "ed-cta" },
  },
  {
    id: "galleria", label: "Galleria", note: "Carta chiara, cornice sottile, foto sfalsate con bordo bianco",
    paletteId: "avorio", fontPairId: "galleria", flexTone: "light",
    arc: { open: "ga-collage", middle: ["ga-solo", "ga-savedate", "sh-hero3", "ga-editorial", "ga-pair", "sh-polaroid3", "sh-grid", "sh-polaroid", "sh-arch", "sh-stack4", "sh-statement", "sh-columns4", "sh-split", "sh-duo", "sh-full", "sh-trio", "ga-film", "ga-letter", "ga-stack", "sh-faq", "sh-checklist", "sh-polaroid-duo", "sh-book", "sh-date", "sh-strips", "sh-mosaic4", "sh-polaroid4", "sh-film4", "sh-row3", "sh-circles3", "sh-arches3", "sh-lead3", "sh-wall4", "sh-letter3", "sh-solo-full", "sh-solo-inset", "sh-solo-mat", "sh-solo-frame", "sh-solo-caption", "sh-solo-circle", "sh-solo-band", "sh-solo-card"], close: "sh-closing" },
  },
  {
    id: "moda", label: "Moda", note: "Riquadri colorati, ritagli tondi, badge e pulsanti",
    paletteId: "salvia", fontPairId: "classico", flexTone: "dark",
    arc: { open: "mo-cover", middle: ["mo-offset", "mo-circle", "sh-circles3", "mo-lookbook", "mo-panel", "sh-mosaic4", "sh-grid", "sh-arch", "sh-arches3", "sh-polaroid", "sh-statement", "sh-lead3", "sh-split", "sh-duo", "sh-full", "sh-trio", "mo-stripes", "mo-sticker", "mo-duo-circle", "sh-faq", "sh-checklist", "sh-polaroid-duo", "sh-book", "sh-date", "sh-strips", "sh-columns4", "sh-hero3", "sh-polaroid3", "sh-polaroid4", "sh-film4", "sh-row3", "sh-stack4", "sh-wall4", "sh-letter3", "sh-solo-full", "sh-solo-inset", "sh-solo-mat", "sh-solo-frame", "sh-solo-caption", "sh-solo-circle", "sh-solo-band", "sh-solo-card"], close: "sh-closing" },
  },
  {
    id: "cinema", label: "Cinema", note: "Sfondi sfocati, strisce di foto, bande da pellicola",
    paletteId: "notte", fontPairId: "solenne", flexTone: "dark",
    arc: { open: "ci-full", middle: ["ci-strip", "sh-film4", "ci-scope", "ci-duo", "sh-lead3", "ci-quote", "sh-statement", "sh-letter3", "sh-split", "sh-row3", "sh-grid", "sh-arch", "sh-trio", "sh-polaroid", "sh-duo", "sh-full", "ci-letterbox", "ci-diptych", "sh-faq", "sh-checklist", "sh-polaroid-duo", "sh-book", "sh-date", "sh-strips", "sh-mosaic4", "sh-columns4", "sh-hero3", "sh-polaroid3", "sh-polaroid4", "sh-circles3", "sh-stack4", "sh-arches3", "sh-wall4", "sh-solo-full", "sh-solo-inset", "sh-solo-mat", "sh-solo-frame", "sh-solo-caption", "sh-solo-circle", "sh-solo-band", "sh-solo-card"], close: "sh-closing" },
    closeAlt: ["ci-credits"],
  },
];

export const TEMPLATES: readonly SlideTemplate[] = [...EDITORIALE, ...EDITORIALE_MORE, ...GALLERIA, ...GALLERIA_MORE, ...MODA, ...MODA_MORE, ...CINEMA, ...CINEMA_MORE, ...SHARED, ...UNIVERSAL];

/**
 * La trama di uno stile per un dato seme. Con 0 (o senza seme) è quella di base, sempre uguale; con un altro numero i modelli di mezzo
 * si dispongono in un ordine diverso (e a volte la chiusura cambia): due caroselli creati in momenti diversi non escono uguali.
 */
export function arcFor(set: SetInfo, seed = 0): { open: string; middle: string[]; close: string } {
  const middle = [...set.arc.middle];
  if (!seed) return { open: set.arc.open, middle, close: set.arc.close };
  const random = mulberry32(seed);
  const shuffle = (list: string[]) => {
    for (let index = list.length - 1; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      [list[index], list[other]] = [list[other], list[index]];
    }
    return list;
  };
  // I modelli propri dello stile e quelli universali si mescolano a parte e poi si alternano: lo stile resta riconoscibile.
  const own = shuffle(middle.filter((id) => !id.startsWith("sh-")));
  const common = shuffle(middle.filter((id) => id.startsWith("sh-")));
  middle.length = 0;
  while (own.length || common.length) {
    if (own.length) middle.push(own.shift()!);
    if (common.length) middle.push(common.shift()!);
  }
  const alternatives = set.closeAlt ?? [];
  const close = alternatives.length > 0 && random() < 0.5 ? alternatives[Math.floor(random() * alternatives.length)] : set.arc.close;
  return { open: set.arc.open, middle, close };
}

/** Il fondo di un modello universale nella posizione indicata, secondo lo stile. */
export function toneForFlex(set: SetInfo, position: number): Tone {
  return set.flexTone === "alternate" ? (position % 2 === 0 ? "dark" : "light") : set.flexTone;
}

const BY_ID = new Map(TEMPLATES.map((template) => [template.id, template]));

export function templateOf(id: string): SlideTemplate | undefined {
  return BY_ID.get(id);
}

export function setInfo(id: SetId): SetInfo {
  return SETS.find((set) => set.id === id) ?? SETS[0];
}

/** Modelli tra cui scegliere in uno stile: i suoi, poi quelli comuni (panorama, album, chiusura). */
export function templatesForSet(id: SetId): SlideTemplate[] {
  const own = TEMPLATES.filter((template) => template.set === id || template.set === "shared");
  // I modelli più semplici (una foto, quasi senza testo) stanno in testa: sono quelli che si cercano per primi.
  return [...own.filter((template) => template.id.startsWith("sh-solo-")), ...own.filter((template) => !template.id.startsWith("sh-solo-"))];
}
