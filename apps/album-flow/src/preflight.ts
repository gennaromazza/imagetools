import type { AlbumProject } from "@photo-tools/shared-types";

export function validateAlbumPreflight(project: AlbumProject): string[] {
  const { sheet } = project.settings;
  const errors: string[] = [];
  if (!Number.isFinite(sheet.widthCm) || sheet.widthCm <= 0 || !Number.isFinite(sheet.heightCm) || sheet.heightCm <= 0) errors.push("Formato pagina non valido.");
  if (!Number.isFinite(sheet.dpi) || sheet.dpi < 72) errors.push("Risoluzione minima: 72 dpi.");
  if (sheet.marginCm < 0 || sheet.gapCm < 0 || (sheet.bleedCm ?? 0) < 0) errors.push("Margini, spaziatura e abbondanza non possono essere negativi.");
  if (2 * sheet.marginCm + (sheet.bleedCm ?? 0) >= Math.min(sheet.widthCm, sheet.heightCm)) errors.push("Margini e abbondanza occupano tutta la pagina.");
  if (!project.assets.some(asset => asset.selected)) errors.push("Nessuna foto selezionata.");
  if (project.pages.length === 0) errors.push("Nessuna pagina generata.");
  return errors;
}
