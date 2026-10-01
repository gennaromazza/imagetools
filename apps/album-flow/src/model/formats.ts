import type { SheetSpec } from "@photo-tools/shared-types";
import { DEFAULT_SHEET } from "./defaults";

/** Formato di una singola pagina (lo spread è formato da due pagine affiancate). */
export interface SheetFormat {
  widthCm: number;
  heightCm: number;
  label?: string;
}

export const COMMON_FORMATS: SheetFormat[] = [
  { widthCm: 20, heightCm: 20 },
  { widthCm: 25, heightCm: 25 },
  { widthCm: 30, heightCm: 30 },
  { widthCm: 35, heightCm: 35 },
  { widthCm: 30, heightCm: 20 },
  { widthCm: 40, heightCm: 30 },
  { widthCm: 35, heightCm: 25 },
  { widthCm: 20, heightCm: 30 },
  { widthCm: 30, heightCm: 40 },
  { widthCm: 25, heightCm: 35 },
];

export type LengthUnit = "cm" | "mm" | "in";
export const UNIT_LABELS: Record<LengthUnit, string> = { cm: "cm", mm: "mm", in: "pollici" };

export function toCm(value: number, unit: LengthUnit): number {
  return unit === "mm" ? value / 10 : unit === "in" ? value * 2.54 : value;
}

export function fromCm(value: number, unit: LengthUnit): number {
  const converted = unit === "mm" ? value * 10 : unit === "in" ? value / 2.54 : value;
  return Number(converted.toFixed(unit === "in" ? 3 : 2));
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function formatKey(format: Pick<SheetFormat, "widthCm" | "heightCm">): string {
  return `${round1(format.widthCm)}x${round1(format.heightCm)}`;
}

export function formatLabel(format: Pick<SheetFormat, "widthCm" | "heightCm">): string {
  return `${round1(format.widthCm)} × ${round1(format.heightCm)} cm`;
}

/** Orientamento di una pagina, per mostrare l'anteprima del formato. */
export function formatShape(format: Pick<SheetFormat, "widthCm" | "heightCm">): "square" | "landscape" | "portrait" {
  return Math.abs(format.widthCm - format.heightCm) < 0.05 ? "square" : format.widthCm > format.heightCm ? "landscape" : "portrait";
}

export function sheetFromFormat(format: SheetFormat, base: SheetSpec = DEFAULT_SHEET): SheetSpec {
  const label = format.label ?? `${formatShape(format) === "square" ? "Quadrato" : formatShape(format) === "landscape" ? "Orizzontale" : "Verticale"} ${formatLabel(format)}`;
  return { ...base, presetId: `fmt-${formatKey(format)}`, label, widthCm: format.widthCm, heightCm: format.heightCm };
}

export function isValidFormat(format: Pick<SheetFormat, "widthCm" | "heightCm">): boolean {
  return [format.widthCm, format.heightCm].every((value) => Number.isFinite(value) && value >= 5 && value <= 100);
}

// ---------------------------------------------------------------------------
// Recenti e preferiti (preferenze locali dell'utente)
// ---------------------------------------------------------------------------

const RECENTS_KEY = "filex.albumFlow.formatRecents";
const FAVORITES_KEY = "filex.albumFlow.formatFavorites";
const MAX_RECENTS = 8;

function read(key: string): SheetFormat[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is SheetFormat => Boolean(item) && isValidFormat(item as SheetFormat)) : [];
  } catch {
    return [];
  }
}

function write(key: string, formats: SheetFormat[]): SheetFormat[] {
  try { localStorage.setItem(key, JSON.stringify(formats)); } catch { /* preferenza non critica */ }
  return formats;
}

export const loadRecentFormats = () => read(RECENTS_KEY);
export const loadFavoriteFormats = () => read(FAVORITES_KEY);

export function pushRecentFormat(format: SheetFormat): SheetFormat[] {
  const next = [format, ...read(RECENTS_KEY).filter((item) => formatKey(item) !== formatKey(format))].slice(0, MAX_RECENTS);
  return write(RECENTS_KEY, next);
}

export function toggleFavoriteFormat(format: SheetFormat): SheetFormat[] {
  const favorites = read(FAVORITES_KEY);
  const exists = favorites.some((item) => formatKey(item) === formatKey(format));
  return write(FAVORITES_KEY, exists ? favorites.filter((item) => formatKey(item) !== formatKey(format)) : [...favorites, format]);
}

export function isFavoriteFormat(format: SheetFormat): boolean {
  return read(FAVORITES_KEY).some((item) => formatKey(item) === formatKey(format));
}
