import type { PhotoColorAdjust } from "@photo-tools/shared-types";
import { colorTransform, sameAdjust, sanitizeAdjust } from "./colorAdjust";
import { averageStats, computeStats, solveMatch, type ColorStats } from "./colorMatch";
import { touch, type Project } from "./project";

/** Campioni di pixel RGBA (0-255) delle foto, uno per foto: una miniatura piccola basta per misurarne l'aspetto. */
export type ColorSamples = ReadonlyMap<string, ArrayLike<number>>;

/** Le foto dello spread, senza ripetizioni e nell'ordine in cui compaiono. */
export function spreadAssetIds(project: Project, spreadId: string): string[] {
  const spread = project.spreads.find((candidate) => candidate.id === spreadId);
  if (!spread) return [];
  return Array.from(new Set(spread.areas.flatMap((area) => area.items.map((item) => item.assetId))));
}

/** Imposta (o toglie, con `undefined`) la correzione colore di una o più foto. Lo stesso progetto se non cambia nulla. */
export function setColorAdjust(project: Project, assetIds: readonly string[], adjust: PhotoColorAdjust | undefined): Project {
  const next = sanitizeAdjust(adjust);
  const ids = new Set(assetIds);
  if (!project.assets.some((asset) => ids.has(asset.id) && !sameAdjust(asset.colorAdjust, next))) return project;
  return touch({
    ...project,
    assets: project.assets.map((asset) => {
      if (!ids.has(asset.id) || sameAdjust(asset.colorAdjust, next)) return asset;
      const { colorAdjust: _old, ...rest } = asset;
      return next ? { ...rest, colorAdjust: next } : rest;
    }),
  });
}

/** La stessa foto senza correzione, senza toccare l'ora di modifica: dopo la scrittura sul file la correzione è già dentro il file. */
export function withoutColorAdjust(project: Project, assetId: string): Project {
  if (!project.assets.some((asset) => asset.id === assetId && asset.colorAdjust)) return project;
  return { ...project, assets: project.assets.map((asset) => { if (asset.id !== assetId) return asset; const { colorAdjust: _gone, ...rest } = asset; return rest; }) };
}

const looksOf = (project: Project, ids: readonly string[], samples: ColorSamples): Array<ColorStats | null> => ids.map((id) => {
  const sample = samples.get(id);
  const asset = project.assets.find((candidate) => candidate.id === id);
  return sample && asset ? computeStats(sample, colorTransform(asset.colorAdjust)) : null;
});

/**
 * Avvicina una foto all'aspetto delle altre dello spread (così come si vedono adesso, con le loro correzioni).
 * Senza campioni o senza altre foto non cambia nulla.
 */
export function matchToOthers(project: Project, spreadId: string, assetId: string, samples: ColorSamples): Project {
  const sample = samples.get(assetId);
  if (!sample) return project;
  const others = spreadAssetIds(project, spreadId).filter((id) => id !== assetId);
  const target = averageStats(looksOf(project, others, samples));
  if (!target) return project;
  return setColorAdjust(project, [assetId], solveMatch(sample, target));
}

/**
 * Uniforma le foto dello spread: ognuna, partendo dal file com'è, si avvicina all'aspetto medio di tutte. Le correzioni fatte prima
 * a mano vengono sostituite. Servono almeno due foto con campione.
 */
export function matchSpread(project: Project, spreadId: string, samples: ColorSamples): Project {
  const ids = spreadAssetIds(project, spreadId).filter((id) => samples.has(id));
  if (ids.length < 2) return project;
  const target = averageStats(ids.map((id) => computeStats(samples.get(id)!)));
  if (!target) return project;
  let next = project;
  for (const id of ids) next = setColorAdjust(next, [id], solveMatch(samples.get(id)!, target));
  return next;
}
