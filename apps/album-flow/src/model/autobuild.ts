import type { AlbumAssetV2, AlbumItem, AlbumSpread, AreaFitMode } from "@photo-tools/shared-types";
import { areaOuterRects, insetRect } from "../engine/geometry";
import { estimateCost, generateLayoutsCached } from "../engine/generate";
import { naturalRatios } from "../engine/tree";
import { sortAssets, unusedAssets } from "./library";
import { appendAssets } from "./items";
import { newId } from "./ids";
import { createArea, createItem, itemAspect, nowIso, normalizeArea, type Project } from "./project";

export interface AutoBuildOptions {
  /** Foto per area (1-8): è un obiettivo, il motore può scostarsi di una per ottenere impaginazioni migliori. */
  photosPerArea: number;
  /** Ogni capitolo inizia su un nuovo spread, nell'ordine dei capitoli. */
  respectChapters: boolean;
  /** "half": due pagine indipendenti; "full": ogni spread è un foglio intero; "mixed": pagine separate, foglio intero per i panorami. */
  splitMode: "half" | "full" | "mixed";
  /** "all" ricostruisce tutto l'album; "unused" aggiunge spread solo con le foto non ancora usate. */
  scope: "all" | "unused";
  /** Alterna le strutture dei layout per un ritmo più vario. */
  varyLayouts: boolean;
  fitMode: AreaFitMode;
}

export const DEFAULT_AUTO_BUILD: AutoBuildOptions = {
  photosPerArea: 3,
  respectChapters: true,
  splitMode: "mixed",
  scope: "all",
  varyLayouts: true,
  fitMode: "fit",
};

export const MAX_AUTO_PER_AREA = 8;
/** Soglia di proporzione oltre la quale una foto è considerata panoramica per la modalità "mixed". */
export const PANORAMA_ASPECT = 2.1;

interface Unit {
  assets: AlbumAssetV2[];
  /** Occupa da solo un intero spread (foglio intero). */
  fullSpread: boolean;
}

const isSolo = (asset: AlbumAssetV2) => (asset.albumTags ?? []).some((tag) => tag === "cover" || tag === "main");
const isPanorama = (asset: AlbumAssetV2, mode: AutoBuildOptions["splitMode"]) =>
  mode === "mixed" && ((asset.albumTags ?? []).includes("panorama") || itemAspect(asset) >= PANORAMA_ASPECT);

/** Divide una sequenza di foto in gruppi, scegliendo le dimensioni che ritagliano meno (programmazione dinamica). */
export function chunkSequence(aspects: readonly number[], target: number, rect: { x: number; y: number; w: number; h: number }, gapMm: number): number[] {
  const n = aspects.length;
  if (n === 0) return [];
  const goal = Math.min(Math.max(Math.round(target), 1), MAX_AUTO_PER_AREA);
  const maxK = Math.min(MAX_AUTO_PER_AREA, goal + 1);
  const best = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
  const pick = new Array<number>(n + 1).fill(1);
  best[0] = 0;
  for (let end = 1; end <= n; end += 1) {
    for (let k = 1; k <= Math.min(maxK, end); k += 1) {
      const start = end - k;
      if (!Number.isFinite(best[start])) continue;
      const chunk = aspects.slice(start, end);
      // Il costo cresce se il gruppo si discosta dall'obiettivo e per le foto lasciate sole in mezzo a una serie.
      const cost = estimateCost(chunk, rect, gapMm) + 1.2 * Math.abs(k - goal) + (k === 1 && n > 1 && goal > 1 ? 0.2 : 0);
      if (best[start] + cost < best[end] - 1e-12) { best[end] = best[start] + cost; pick[end] = k; }
    }
  }
  const sizes: number[] = [];
  for (let end = n; end > 0; end -= pick[end]) sizes.unshift(pick[end]);
  return sizes;
}

/** Foto in ordine d'album: capitoli nell'ordine dei capitoli, foto di ogni capitolo nell'ordine scelto, poi le altre. */
export function orderedGroups(project: Project, pool: readonly AlbumAssetV2[], respectChapters: boolean): Array<{ title: string; assets: AlbumAssetV2[] }> {
  const sorted = sortAssets(pool, project.settings.sortKey);
  if (!respectChapters || project.chapters.length === 0) return sorted.length ? [{ title: "Album", assets: sorted }] : [];
  const left = new Map(sorted.map((asset) => [asset.id, asset]));
  const groups: Array<{ title: string; assets: AlbumAssetV2[] }> = [];
  for (const chapter of project.chapters) {
    const members = sorted.filter((asset) => chapter.assetIds.includes(asset.id) && left.has(asset.id));
    members.forEach((asset) => left.delete(asset.id));
    if (members.length) groups.push({ title: chapter.title, assets: members });
  }
  const rest = sorted.filter((asset) => left.has(asset.id));
  if (rest.length) groups.push({ title: "Senza capitolo", assets: rest });
  return groups;
}

/** Costruisce l'album: gruppi per capitolo, aree scelte con il costo minore e layout con ritmo vario. */
export function autoBuildAlbum(project: Project, options: AutoBuildOptions): Project {
  // Gli spread segnati come finiti non si toccano: le loro foto restano fuori dalla ricostruzione.
  const frozen = options.scope === "all" ? project.spreads.filter((spread) => spread.done) : [];
  const frozenAssets = new Set(frozen.flatMap((spread) => spread.areas.flatMap((area) => area.items.map((item) => item.assetId))));
  const pool = options.scope === "unused" ? unusedAssets(project) : project.assets.filter((asset) => !frozenAssets.has(asset.id));
  if (project.assets.length === 0) throw new Error("La libreria è vuota: importa delle foto prima di impaginare.");
  if (pool.length === 0) return project;

  const sheet = project.settings.sheet;
  const style = { ...project.settings.defaultStyle, mode: options.fitMode };
  const halfRect = insetRect(areaOuterRects(sheet, "half")[0], style.paddingCm * 10);
  const fullRect = insetRect(areaOuterRects(sheet, "full")[0], style.paddingCm * 10);
  const gapMm = style.gapCm * 10;
  const baseRect = options.splitMode === "full" ? fullRect : halfRect;

  const groups = orderedGroups(project, pool, options.respectChapters);
  const spreads: AlbumSpread[] = [];
  let pending: Unit | null = null;
  let lastKind = "";
  let lastCount = 0;

  const makeArea = (assets: AlbumAssetV2[], rect: typeof halfRect) => {
    const items: AlbumItem[] = assets.map((asset) => createItem(asset.id));
    const photos = items.map((item, index) => ({ id: item.id, aspect: itemAspect(assets[index]) }));
    const candidates = generateLayoutsCached(photos, { rect, gapMm, limit: 8 });
    let choice = 0;
    if (options.varyLayouts && candidates.length > 1 && assets.length === lastCount) {
      const alternative = candidates.slice(0, 4).findIndex((candidate) => candidate.kind !== lastKind);
      if (alternative > 0 && candidates[alternative].score <= candidates[0].score + 0.18) choice = alternative;
    }
    const picked = candidates[choice] ?? candidates[0];
    lastKind = picked?.kind ?? "";
    lastCount = assets.length;
    // «Foto intera»: le divisioni si regolano sulle foto, così risultano allineate.
    const aspects = new Map(items.map((item, index) => [item.id, itemAspect(assets[index])]));
    const tree = picked && options.fitMode === "fit" ? naturalRatios(picked.tree, (id) => aspects.get(id) ?? 1.5, rect, gapMm) : picked?.tree ?? null;
    return normalizeArea({ ...createArea(style), items, layout: tree, seed: choice });
  };

  const emitHalf = (left: Unit | null, right: Unit | null) => {
    const areas = [left, right].map((unit) => (unit ? makeArea(unit.assets, halfRect) : createArea(style)));
    spreads.push({ id: newId("spread"), split: "half", linked: false, areas });
  };
  const emitFull = (unit: Unit) => {
    spreads.push({ id: newId("spread"), split: "full", linked: false, areas: [makeArea(unit.assets, fullRect)] });
  };
  const flush = () => {
    if (pending) { emitHalf(pending, null); pending = null; }
  };
  const push = (unit: Unit) => {
    if (unit.fullSpread || options.splitMode === "full") { flush(); emitFull(unit); return; }
    if (!pending) pending = unit;
    else { emitHalf(pending, unit); pending = null; }
  };

  for (const group of groups) {
    if (options.respectChapters) flush();
    // Corse di foto consecutive senza tag che le isolino.
    let run: AlbumAssetV2[] = [];
    const closeRun = () => {
      if (run.length === 0) return;
      const sizes = chunkSequence(run.map((asset) => itemAspect(asset)), options.photosPerArea, baseRect, gapMm);
      let offset = 0;
      for (const size of sizes) { push({ assets: run.slice(offset, offset + size), fullSpread: false }); offset += size; }
      run = [];
    };
    for (const asset of group.assets) {
      if (isPanorama(asset, options.splitMode)) { closeRun(); push({ assets: [asset], fullSpread: true }); }
      else if (isSolo(asset)) { closeRun(); push({ assets: [asset], fullSpread: false }); }
      else run.push(asset);
    }
    closeRun();
  }
  flush();

  const existing = options.scope === "unused" ? project.spreads : [];
  let result = [...existing, ...spreads];
  if (frozen.length) {
    // Gli spread finiti tornano nella posizione di prima; quelli nuovi riempiono gli altri posti, il resto in coda.
    const keep = project.spreads.map((spread, index) => ({ spread, index })).filter((entry) => entry.spread.done);
    const queue = [...spreads];
    result = [];
    let k = 0;
    for (let position = 0; queue.length > 0 || k < keep.length; position += 1) {
      if (k < keep.length && (keep[k].index === position || queue.length === 0)) result.push(keep[k++].spread);
      else result.push(queue.shift()!);
    }
  }
  return {
    ...project,
    spreads: result,
    stage: project.stage === "pending" ? "editing" : project.stage,
    updatedAt: nowIso(),
  };
}

/** Foto non ancora usate nell'ordine d'album, partendo dal capitolo indicato (se ha ancora foto libere). */
export function nextUnusedAssets(project: Project, count: number, preferChapterOfAssetIds: readonly string[] = []): AlbumAssetV2[] {
  const groups = orderedGroups(project, unusedAssets(project), true);
  if (groups.length === 0 || count <= 0) return [];
  const preferred = project.chapters.find((chapter) => preferChapterOfAssetIds.some((id) => chapter.assetIds.includes(id)));
  const group = (preferred && groups.find((candidate) => candidate.title === preferred.title)) || groups[0];
  return group.assets.slice(0, count);
}

/**
 * Riempie le pagine vuote di uno spread con le prossime foto non usate (del capitolo dello spread, se possibile),
 * scegliendo quante per pagina come fa Auto Build. Non cambia le pagine già piene.
 */
export function fillSpread(project: Project, spreadId: string, photosPerArea = 3): Project {
  const spread = project.spreads.find((candidate) => candidate.id === spreadId);
  if (!spread || spread.done) return project;
  let next = project;
  const hint = spread.areas.flatMap((area) => area.items.map((item) => item.assetId));
  const style = project.settings.defaultStyle;
  spread.areas.forEach((area, areaIndex) => {
    if (area.items.length > 0) return;
    const candidates = nextUnusedAssets(next, photosPerArea * 2, hint);
    if (candidates.length === 0) return;
    const rect = insetRect(areaOuterRects(project.settings.sheet, spread.split)[areaIndex], style.paddingCm * 10);
    const sizes = chunkSequence(candidates.map((asset) => itemAspect(asset)), photosPerArea, rect, style.gapCm * 10);
    const chosen = candidates.slice(0, Math.max(1, sizes[0] ?? 1));
    next = appendAssets(next, spreadId, areaIndex, chosen.map((asset) => asset.id));
    hint.push(...chosen.map((asset) => asset.id));
  });
  return next;
}

/** Indice del prossimo spread (dopo `from`, in giro) con una pagina vuota, o -1. */
export function nextEmptySpread(project: Project, from: number): number {
  const count = project.spreads.length;
  for (let step = 1; step <= count; step += 1) {
    const index = (from + step) % count;
    if (project.spreads[index].areas.some((area) => area.items.length === 0)) return index;
  }
  return -1;
}
