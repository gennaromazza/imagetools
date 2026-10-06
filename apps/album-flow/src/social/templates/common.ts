import type { BrandKit, TextField } from "../types";

export function field(key: string, label: string, fallback: string | ((context: { brand: BrandKit; albumName: string }) => string), multiline = false): TextField {
  return { key, label, fallback: typeof fallback === "function" ? fallback : () => fallback, multiline };
}

/** Nome da mostrare per lo studio: quello della marca, altrimenti il nome dell'album. */
export const studioOf = (brand: BrandKit, albumName: string): string => brand.name.trim() || albumName.trim() || "Il tuo studio";

export const handleOf = (brand: BrandKit): string => brand.handle.trim() || "@iltuostudio";

/** Vero se il testo ha contenuto: chi svuota un campo vuole che l'elemento sparisca. */
export const has = (value: string | undefined): value is string => Boolean(value && value.trim());

export const FEED_HEIGHT = 1350;
