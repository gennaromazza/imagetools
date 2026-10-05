/** Forme predefinite per una foto: rapporto larghezza/altezza della finestra che la foto occupa nella cella. */
export interface ShapePreset {
  id: string;
  label: string;
  ratio: number;
}

export const SHAPE_PRESETS: readonly ShapePreset[] = [
  { id: "1:1", label: "Quadrata 1:1", ratio: 1 },
  { id: "5:4", label: "Orizzontale 5:4", ratio: 5 / 4 },
  { id: "4:3", label: "Orizzontale 4:3", ratio: 4 / 3 },
  { id: "3:2", label: "Orizzontale 3:2", ratio: 3 / 2 },
  { id: "16:9", label: "Orizzontale 16:9", ratio: 16 / 9 },
  { id: "2:1", label: "Panoramica 2:1", ratio: 2 },
  { id: "4:5", label: "Verticale 4:5", ratio: 4 / 5 },
  { id: "3:4", label: "Verticale 3:4", ratio: 3 / 4 },
  { id: "2:3", label: "Verticale 2:3", ratio: 2 / 3 },
  { id: "9:16", label: "Verticale 9:16", ratio: 9 / 16 },
];

/** Forma predefinita che corrisponde a un rapporto (tolleranza dell'1%), oppure null. */
export function presetForShape(shape: number | undefined): ShapePreset | null {
  if (!shape) return null;
  return SHAPE_PRESETS.find((preset) => Math.abs(preset.ratio / shape - 1) < 0.01) ?? null;
}
