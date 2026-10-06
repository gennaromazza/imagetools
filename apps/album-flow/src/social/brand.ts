import { FONT_FAMILIES } from "../model/typography";
import type { BrandKit, FontPair, Palette } from "./types";

/** Palette pensate per i quattro stili: ognuna ha un fondo scuro, uno chiaro, un accento e una tinta di mezzo. */
export const PALETTES: readonly Palette[] = [
  { id: "bosco", label: "Bosco", dark: "#1f2e25", light: "#f5f0e6", accent: "#c3a25f", soft: "#cdc4b0" },
  { id: "salvia", label: "Salvia e ocra", dark: "#3f4d3c", light: "#f3eee3", accent: "#e0a62c", soft: "#8f9e8a" },
  { id: "avorio", label: "Avorio e terracotta", dark: "#2c2522", light: "#fbf7f1", accent: "#b87a5c", soft: "#eadccd" },
  { id: "notte", label: "Notte blu", dark: "#14202e", light: "#eef0f2", accent: "#d6b36b", soft: "#a3b3c4" },
  { id: "bordeaux", label: "Bordeaux", dark: "#3a1620", light: "#f8f0e9", accent: "#d3a56e", soft: "#c79aa0" },
  { id: "grafite", label: "Grafite", dark: "#161616", light: "#f4f3ef", accent: "#cfc9bb", soft: "#8d8d8a" },
];

/** Coppie di font: tutti già presenti nella libreria di Album Flow (licenza aperta, incorporati nell'esportazione). */
export const FONT_PAIRS: readonly FontPair[] = [
  { id: "moda", label: "Moda", display: "bodoni-moda", script: "pinyon-script", body: "jost" },
  { id: "classico", label: "Classico", display: "playfair-display", script: "great-vibes", body: "tenor-sans" },
  { id: "galleria", label: "Galleria", display: "italiana", script: "pinyon-script", body: "jost" },
  { id: "editoriale", label: "Editoriale", display: "dm-serif-display", script: "great-vibes", body: "montserrat" },
  { id: "solenne", label: "Solenne", display: "cinzel", script: "pinyon-script", body: "cormorant-garamond" },
  { id: "impatto", label: "Impatto", display: "abril-fatface", script: "great-vibes", body: "inter" },
];

export const DEFAULT_PALETTE_ID = "bosco";
export const DEFAULT_FONT_PAIR_ID = "moda";

export function paletteOf(id: string): Palette {
  return PALETTES.find((palette) => palette.id === id) ?? PALETTES[0];
}

export function fontPairOf(id: string): FontPair {
  return FONT_PAIRS.find((pair) => pair.id === id) ?? FONT_PAIRS[0];
}

export function defaultBrand(albumName = ""): BrandKit {
  return { name: albumName.trim().slice(0, 40), handle: "", paletteId: DEFAULT_PALETTE_ID, fontPairId: DEFAULT_FONT_PAIR_ID };
}

/** Font da caricare per disegnare un carosello (i tre della coppia scelta). */
export function brandFontIds(brand: BrandKit): string[] {
  const pair = fontPairOf(brand.fontPairId);
  return [...new Set([pair.display, pair.script, pair.body])].filter((id) => FONT_FAMILIES.some((font) => font.id === id));
}

/** Iniziale per il monogramma: la prima lettera o cifra del nome, altrimenti un trattino. */
export function monogramOf(name: string): string {
  const match = /[\p{L}\p{N}]/u.exec(name);
  return match ? match[0].toLocaleUpperCase("it-IT") : "·";
}

/** Colore leggibile (scuro o chiaro) sopra uno sfondo dato: serve ai pulsanti con l'accento della marca. */
export function readableOn(background: string, dark: string, light: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(background.trim());
  if (!match) return dark;
  const value = parseInt(match[1], 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const unit = channel / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? dark : light;
}
