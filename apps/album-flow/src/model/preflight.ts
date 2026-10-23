import type { SpreadTextOverlay } from "@photo-tools/shared-types";
import { crossesFold, spreadSizeMm } from "../engine/geometry";
import { duplicatedAssetIds, unusedAssets } from "./library";
import { placeItem } from "./placement";
import { areaGeometry, assetMap, placementStyle, type Project } from "./project";
import { similarityIssues, type LibraryAnalysis } from "./similar";
import { PROVISIONAL_TEXT_COLOR, contrastRatio } from "./typography";

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
  stats: { spreads: number; photos: number; emptyAreas: number; unused: number; duplicates: number; lowResolution: number; foldCrossings: number; texts: number; textWarnings: number };
}

const PT_MM = 25.4 / 72;

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 40 ? `${flat.slice(0, 40)}…` : flat;
}

/** Altezza stimata di un testo in mm (l'altezza reale segue il contenuto e si misura solo con i font veri). */
function estimatedTextHeightMm(overlay: SpreadTextOverlay, widthMm: number): number {
  const lineMm = overlay.sizePt * PT_MM * overlay.lineHeight;
  const charMm = overlay.sizePt * PT_MM * 0.5;
  const lines = overlay.text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil((line.length * charMm) / Math.max(widthMm, 1))), 0);
  return lines * lineMm;
}

/**
 * Testi sopra lo spread: un testo che in stampa si vede e a schermo no (nero su foto scura, quasi trasparente,
 * minuscolo, fuori pagina) è l'errore più costoso. Ogni testo che finisce sopra una foto o che ha un difetto è segnalato.
 */
function textIssues(project: Project, spread: Project["spreads"][number], spreadIndex: number): { issues: PreflightIssue[]; texts: number; warned: number } {
  const issues: PreflightIssue[] = [];
  const label = `Spread ${spreadIndex + 1}`;
  const size = spreadSizeMm(project.settings.sheet);
  const geometries = spread.areas.map((_, index) => areaGeometry(project, spread, index));
  const photoRects = geometries.flatMap((geometry) => geometry.cells.map((cell) => cell.rect));
  let texts = 0;
  let warned = 0;
  for (const overlay of spread.overlays ?? []) {
    if (overlay.kind !== "text") continue;
    texts += 1;
    const shown = `«${preview(overlay.text)}»`;
    const problems: string[] = [];
    const widthMm = overlay.w * size.width;
    const box = { x: overlay.x * size.width, y: overlay.y * size.height, w: widthMm, h: estimatedTextHeightMm(overlay, widthMm) };
    if (!overlay.text.trim()) problems.push("è vuoto");
    if (overlay.color.toLowerCase() === PROVISIONAL_TEXT_COLOR) problems.push("ha ancora il colore rosso provvisorio");
    if (overlay.opacity < 0.5) problems.push(`è quasi trasparente (${Math.round(overlay.opacity * 100)}%)`);
    if (overlay.sizePt < 6) problems.push(`è minuscolo (${overlay.sizePt} pt)`);
    if (box.x + box.w < 0 || box.x > size.width || box.y + box.h < 0 || box.y > size.height) problems.push("è fuori dalla pagina");
    else if (box.x < 0 || box.x + box.w > size.width || box.y < 0 || box.y + box.h > size.height) problems.push("esce in parte dalla pagina");
    const overPhoto = photoRects.some((rect) => box.x < rect.x + rect.w && box.x + box.w > rect.x && box.y < rect.y + rect.h && box.y + box.h > rect.y);
    const areaIndex = spread.areas.length === 1 ? 0 : box.x + box.w / 2 < size.width / 2 ? 0 : 1;
    const page = spread.areas[areaIndex]?.style.background;
    if (overPhoto) problems.push("è sopra una foto, controlla che si legga anche dove la foto è scura o chiara");
    else if (page) {
      const ratio = contrastRatio(overlay.color, page);
      if (ratio !== null && ratio < 3) problems.push("ha lo stesso colore dello sfondo, quindi non si legge");
    }
    if (problems.length > 0) {
      warned += 1;
      issues.push({ level: "warning", message: `${label}: il testo ${shown} ${problems.join(" e ")}.`, spreadIndex });
    }
  }
  return { issues, texts, warned };
}

/** Controlli prima dell'export: bloccanti (errori), da valutare (avvisi) e informativi. Con l'analisi della libreria anche foto simili e momenti. */
export function preflightReport(project: Project, analysis?: LibraryAnalysis): PreflightReport {
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
  let texts = 0;
  let textWarnings = 0;

  project.spreads.forEach((spread, spreadIndex) => {
    const label = `Spread ${spreadIndex + 1}`;
    const found = textIssues(project, spread, spreadIndex);
    issues.push(...found.issues);
    texts += found.texts;
    textWarnings += found.warned;
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

  if (analysis) issues.push(...similarityIssues(project, analysis));

  const duplicates = duplicatedAssetIds(project).length;
  if (duplicates > 0) issues.push({ level: "warning", message: `${duplicates} ${duplicates === 1 ? "foto è usata" : "foto sono usate"} più di una volta.` });
  const unused = unusedAssets(project).length;
  if (unused > 0 && project.spreads.length > 0) issues.push({ level: "info", message: `${unused} ${unused === 1 ? "foto della libreria non è usata" : "foto della libreria non sono usate"} nell'album.` });

  return {
    issues,
    errors: issues.filter((issue) => issue.level === "error").length,
    warnings: issues.filter((issue) => issue.level === "warning").length,
    stats: { spreads: project.spreads.length, photos, emptyAreas, unused, duplicates, lowResolution, foldCrossings, texts, textWarnings },
  };
}
