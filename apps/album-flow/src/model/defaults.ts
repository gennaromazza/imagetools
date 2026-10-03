import type { AreaStyle, SheetSpec } from "@photo-tools/shared-types";

/** Stile predefinito di un'area: foto quasi a pieno foglio con poco spazio tra l'una e l'altra. */
export const DEFAULT_AREA_STYLE: AreaStyle = {
  gapCm: 0.2,
  paddingCm: 0.6,
  borderCm: 0,
  borderColor: "#ffffff",
  background: "#ffffff",
  mode: "fit",
  align: "center",
  mono: false,
};

/** Formato predefinito: quadrato 30 × 30 cm per pagina, zona sicura di 1 cm, abbondanza di 3 mm. */
export const DEFAULT_SHEET: SheetSpec = {
  presetId: "square-30",
  label: "Quadrato 30 × 30 cm",
  widthCm: 30,
  heightCm: 30,
  dpi: 300,
  marginCm: 1,
  gapCm: 0.2,
  bleedCm: 0.3,
  backgroundColor: "#ffffff",
};

export const STYLE_LIMITS = {
  gapCm: { min: 0, max: 3, step: 0.05 },
  paddingCm: { min: 0, max: 10, step: 0.1 },
  borderCm: { min: 0, max: 1.5, step: 0.05 },
} as const;

export const BACKGROUND_SWATCHES = ["#000000", "#ffffff", "#f4efe6", "#2b312d"] as const;

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;
/** Raddrizzamento massimo della foto (gradi, per lato). */
export const MAX_ANGLE = 45;
export const MAX_ITEMS_PER_AREA = 12;
export const MAX_SPREADS = 400;

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
