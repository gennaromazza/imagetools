import { crossesFold } from "../engine/geometry";
import { duplicatedAssetIds, unusedAssets } from "./library";
import { placeItem } from "./placement";
import { areaGeometry, assetMap, placementStyle, type Project } from "./project";

export const MIN_EFFECTIVE_DPI = 150;

export interface PreflightIssue {
  level: "error" | "warning" | "info";
  message: string;
  spreadIndex?: number;
  itemId?: string;
}

export interface PreflightReport {
  issues: PreflightIssue[];
  errors: number;
  warnings: number;
  stats: { spreads: number; photos: number; emptyAreas: number; unused: number; duplicates: number; lowResolution: number; foldCrossings: number };
}

/** Controlli prima dell'export: bloccanti (errori), da valutare (avvisi) e informativi. */
export function preflightReport(project: Project): PreflightReport {
  const issues: PreflightIssue[] = [];
  const sheet = project.settings.sheet;
  if (![sheet.widthCm, sheet.heightCm].every((value) => Number.isFinite(value) && value > 0)) issues.push({ level: "error", message: "Formato pagina non valido." });
  if (!Number.isFinite(sheet.dpi) || sheet.dpi < 72) issues.push({ level: "error", message: "Risoluzione minima per l'export: 72 dpi." });
  if (project.spreads.length === 0) issues.push({ level: "error", message: "L'album non ha ancora nessuno spread." });

  const assets = assetMap(project);
  let photos = 0;
  let emptyAreas = 0;
  let lowResolution = 0;
  let foldCrossings = 0;

  project.spreads.forEach((spread, spreadIndex) => {
    const label = `Spread ${spreadIndex + 1}`;
    const foldX = project.settings.sheet.widthCm * 10;
    spread.areas.forEach((area, areaIndex) => {
      if (area.items.length === 0) {
        emptyAreas += 1;
        issues.push({ level: "warning", message: `${label}: ${spread.areas.length === 1 ? "foglio vuoto" : areaIndex === 0 ? "pagina sinistra vuota" : "pagina destra vuota"}.`, spreadIndex });
        return;
      }
      const geometry = areaGeometry(project, spread, areaIndex);
      for (const item of area.items) {
        photos += 1;
        const asset = assets.get(item.assetId);
        if (!asset) { issues.push({ level: "error", message: `${label}: una foto non è più nella libreria.`, spreadIndex, itemId: item.id }); continue; }
        const cell = geometry.cells.find((candidate) => candidate.itemId === item.id);
        if (!cell) continue;
        const placement = placeItem(cell.rect, item, asset, placementStyle(area, cell), null, cell.anchor);
        if (placement.dpi < MIN_EFFECTIVE_DPI) {
          lowResolution += 1;
          issues.push({ level: "warning", message: `${label}: ${asset.fileName} a ${Math.round(placement.dpi)} dpi effettivi (consigliati almeno ${MIN_EFFECTIVE_DPI}).`, spreadIndex, itemId: item.id });
        }
        if (crossesFold(cell.rect, foldX)) {
          foldCrossings += 1;
          issues.push({ level: "info", message: `${label}: ${asset.fileName} attraversa la piega centrale.`, spreadIndex, itemId: item.id });
        }
      }
    });
  });

  const duplicates = duplicatedAssetIds(project).length;
  if (duplicates > 0) issues.push({ level: "warning", message: `${duplicates} ${duplicates === 1 ? "foto è usata" : "foto sono usate"} più di una volta.` });
  const unused = unusedAssets(project).length;
  if (unused > 0 && project.spreads.length > 0) issues.push({ level: "info", message: `${unused} ${unused === 1 ? "foto della libreria non è usata" : "foto della libreria non sono usate"} nell'album.` });

  return {
    issues,
    errors: issues.filter((issue) => issue.level === "error").length,
    warnings: issues.filter((issue) => issue.level === "warning").length,
    stats: { spreads: project.spreads.length, photos, emptyAreas, unused, duplicates, lowResolution, foldCrossings },
  };
}
