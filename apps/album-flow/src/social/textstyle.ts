import { TEXT_SCALE, type TextColorChoice, type TextFontChoice, type TextStyleChoice } from "./types";

export const TEXT_COLORS: readonly TextColorChoice[] = ["ink", "accent", "light", "dark", "soft"];
export const TEXT_FONTS: readonly TextFontChoice[] = ["display", "script", "body"];
const ALIGNS = ["left", "center", "right"] as const;

/**
 * Rende valido lo stile di un testo e toglie ciò che non cambia nulla: il corpo va da 0,6 a 1,5 (un valore vicino a 1 vale «come il
 * modello»), colori, caratteri e allineamenti solo tra quelli noti. Se non resta nessuna scelta restituisce `null`.
 */
export function normalizeTextStyle(style: Partial<TextStyleChoice> | null | undefined): TextStyleChoice | null {
  if (!style || typeof style !== "object") return null;
  const result: TextStyleChoice = {};
  if (typeof style.scale === "number" && Number.isFinite(style.scale)) {
    const scale = Math.round(Math.min(TEXT_SCALE.max, Math.max(TEXT_SCALE.min, style.scale)) * 20) / 20;
    if (Math.abs(scale - 1) > 0.001) result.scale = scale;
  }
  if (style.color && TEXT_COLORS.includes(style.color)) result.color = style.color;
  if (style.font && TEXT_FONTS.includes(style.font)) result.font = style.font;
  if (style.align && (ALIGNS as readonly string[]).includes(style.align)) result.align = style.align;
  if (typeof style.uppercase === "boolean") result.uppercase = style.uppercase;
  return Object.keys(result).length ? result : null;
}

/** Lo stile di tutti i campi di una slide, solo per i campi del modello e solo se valido. */
export function normalizeTextStyles(styles: unknown, fieldKeys: readonly string[]): Record<string, TextStyleChoice> | undefined {
  if (!styles || typeof styles !== "object" || Array.isArray(styles)) return undefined;
  const result: Record<string, TextStyleChoice> = {};
  for (const key of fieldKeys) {
    const style = normalizeTextStyle((styles as Record<string, Partial<TextStyleChoice>>)[key]);
    if (style) result[key] = style;
  }
  return Object.keys(result).length ? result : undefined;
}
