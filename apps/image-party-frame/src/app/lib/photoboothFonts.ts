/**
 * Curated photobooth font palette. Families are bundled locally with Fontsource
 * (see styles/fonts.css) and used both for the builder preview and for the
 * export-time text-to-PNG rendering (canvas 2D), so the output is WYSIWYG.
 */
export interface PhotoboothFont {
  key: string;
  label: string;
  family: string;
  /** Suggested use shown in the picker. */
  hint: string;
}

export const PHOTOBOOTH_FONTS: PhotoboothFont[] = [
  { key: "bebas", label: "Bebas Neue", family: "'Bebas Neue', 'Arial Narrow', sans-serif", hint: "Titoli moderni" },
  { key: "anton", label: "Anton", family: "'Anton', 'Arial Black', sans-serif", hint: "Titoli d'impatto" },
  { key: "montserrat", label: "Montserrat", family: "'Montserrat', 'Segoe UI', sans-serif", hint: "Pulito ed elegante" },
  { key: "playfair", label: "Playfair Display", family: "'Playfair Display', Georgia, serif", hint: "Matrimoni chic" },
  { key: "cinzel", label: "Cinzel", family: "'Cinzel', 'Times New Roman', serif", hint: "Lusso / classico" },
  { key: "great-vibes", label: "Great Vibes", family: "'Great Vibes', cursive", hint: "Corsivo nozze" },
  { key: "dancing", label: "Dancing Script", family: "'Dancing Script', cursive", hint: "Corsivo festa" },
  { key: "pacifico", label: "Pacifico", family: "'Pacifico', cursive", hint: "Party / compleanni" },
];

export const DEFAULT_PHOTOBOOTH_FONT_KEY = "montserrat";

export function getPhotoboothFont(key: string | undefined): PhotoboothFont {
  return PHOTOBOOTH_FONTS.find((font) => font.key === key)
    ?? PHOTOBOOTH_FONTS.find((font) => font.key === DEFAULT_PHOTOBOOTH_FONT_KEY)!;
}

export function isPhotoboothFontKey(key: unknown): key is string {
  return typeof key === "string" && PHOTOBOOTH_FONTS.some((font) => font.key === key);
}

/** Ensure webfonts are ready before measuring/drawing text on canvas. */
let ready: Promise<void> | undefined;
export async function ensurePhotoboothFontsReady(): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  ready ??= Promise.all(PHOTOBOOTH_FONTS.flatMap((font) =>
    ["normal 400", "normal 700", "italic 400", "italic 700"].map(async (style) => {
      const faces = await document.fonts.load(`${style} 16px ${font.family}`);
      if (faces.length === 0) throw new Error(`Font ${font.label} non disponibile nell'app.`);
    })
  )).then(() => undefined).catch((error) => { ready = undefined; throw error; });
  await ready;
}
