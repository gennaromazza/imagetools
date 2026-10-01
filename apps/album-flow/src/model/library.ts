import type { AlbumAssetTag, AlbumAssetV2, AlbumSortKey } from "@photo-tools/shared-types";
import { removeItems } from "./items";
import { touch, type Project } from "./project";

const collator = new Intl.Collator("it", { numeric: true, sensitivity: "base" });

const timeOf = (asset: AlbumAssetV2) => asset.captureTimeMs ?? asset.createdAt ?? Number.POSITIVE_INFINITY;

/** Confronto per l'ordinamento scelto; a parità si ricade su ora di scatto, nome e identificativo. */
export function compareAssets(sortKey: AlbumSortKey): (a: AlbumAssetV2, b: AlbumAssetV2) => number {
  const byName = (a: AlbumAssetV2, b: AlbumAssetV2) => collator.compare(a.fileName, b.fileName) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const byTime = (a: AlbumAssetV2, b: AlbumAssetV2) => {
    const ta = timeOf(a);
    const tb = timeOf(b);
    if (ta === tb) return byName(a, b);
    return ta < tb ? -1 : 1;
  };
  switch (sortKey) {
    case "file-name": return byName;
    case "selector-order": return (a, b) => (a.selectionOrder ?? Number.POSITIVE_INFINITY) - (b.selectionOrder ?? Number.POSITIVE_INFINITY) || byTime(a, b);
    case "manual": return (a, b) => (a.manualOrder ?? Number.POSITIVE_INFINITY) - (b.manualOrder ?? Number.POSITIVE_INFINITY) || byTime(a, b);
    default: return byTime;
  }
}

export function sortAssets(assets: readonly AlbumAssetV2[], sortKey: AlbumSortKey): AlbumAssetV2[] {
  return [...assets].sort(compareAssets(sortKey));
}

export type LibraryTab = "all" | "none" | string;

export interface AssetUsageRef {
  spreadIndex: number;
  spreadId: string;
  areaIndex: number;
  itemId: string;
}

/** Dove ogni foto è usata nell'album (una foto può comparire più volte). */
export function assetUsage(project: Project): Map<string, AssetUsageRef[]> {
  const usage = new Map<string, AssetUsageRef[]>();
  project.spreads.forEach((spread, spreadIndex) => {
    spread.areas.forEach((area, areaIndex) => {
      for (const item of area.items) {
        const refs = usage.get(item.assetId) ?? [];
        refs.push({ spreadIndex, spreadId: spread.id, areaIndex, itemId: item.id });
        usage.set(item.assetId, refs);
      }
    });
  });
  return usage;
}

export function unusedAssets(project: Project): AlbumAssetV2[] {
  const usage = assetUsage(project);
  return project.assets.filter((asset) => !usage.has(asset.id));
}

export function duplicatedAssetIds(project: Project): string[] {
  return [...assetUsage(project)].filter(([, refs]) => refs.length > 1).map(([id]) => id);
}

/** Foto di una scheda della libreria, nell'ordine scelto. "all" = tutte, "none" = senza capitolo, altrimenti id del capitolo. */
export function assetsInTab(project: Project, tab: LibraryTab): AlbumAssetV2[] {
  const sorted = sortAssets(project.assets, project.settings.sortKey);
  if (tab === "all") return sorted;
  const assigned = new Set(project.chapters.flatMap((chapter) => chapter.assetIds));
  if (tab === "none") return sorted.filter((asset) => !assigned.has(asset.id));
  const chapter = project.chapters.find((candidate) => candidate.id === tab);
  if (!chapter) return [];
  const members = new Set(chapter.assetIds);
  return sorted.filter((asset) => members.has(asset.id));
}

export interface LibraryFilter {
  query?: string;
  minRating?: number;
  /** Stelle esatte (0 = senza stelle); ha la precedenza su minRating. */
  exactRating?: number;
  /** Solo foto con questa etichetta del Selector. */
  labelId?: string;
  /** «selector»: solo foto arrivate dalla selezione di Image Select Pro; «manual»: solo quelle aggiunte qui. */
  origin?: "all" | "selector" | "manual";
  usage?: "all" | "unused" | "used";
}

export function filterAssets(project: Project, assets: readonly AlbumAssetV2[], filter: LibraryFilter): AlbumAssetV2[] {
  const needle = (filter.query ?? "").trim().toLocaleLowerCase();
  const usage = filter.usage && filter.usage !== "all" ? assetUsage(project) : null;
  return assets.filter((asset) => {
    if (needle && !asset.fileName.toLocaleLowerCase().includes(needle)) return false;
    if (filter.exactRating !== undefined) { if ((asset.rating ?? 0) !== filter.exactRating) return false; }
    else if (filter.minRating && (asset.rating ?? 0) < filter.minRating) return false;
    if (filter.labelId && !(asset.labelIds ?? []).includes(filter.labelId)) return false;
    if (filter.origin === "selector" && asset.selectionOrder === undefined) return false;
    if (filter.origin === "manual" && asset.selectionOrder !== undefined) return false;
    if (usage) {
      const used = usage.has(asset.id);
      if (filter.usage === "unused" && used) return false;
      if (filter.usage === "used" && !used) return false;
    }
    return true;
  });
}

export function setSortKey(project: Project, sortKey: AlbumSortKey): Project {
  if (project.settings.sortKey === sortKey) return project;
  return touch({ ...project, settings: { ...project.settings, sortKey } });
}

export function setRating(project: Project, assetId: string, rating: number): Project {
  const value = Math.max(0, Math.min(5, Math.round(rating)));
  const asset = project.assets.find((candidate) => candidate.id === assetId);
  if (!asset || (asset.rating ?? 0) === value) return project;
  return touch({ ...project, assets: project.assets.map((candidate) => (candidate.id === assetId ? { ...candidate, rating: value } : candidate)) });
}

export function toggleAssetTag(project: Project, assetId: string, tag: AlbumAssetTag): Project {
  if (!project.assets.some((asset) => asset.id === assetId)) return project;
  return touch({
    ...project,
    assets: project.assets.map((asset) => {
      if (asset.id !== assetId) return asset;
      const tags = asset.albumTags ?? [];
      return { ...asset, albumTags: tags.includes(tag) ? tags.filter((item) => item !== tag) : [...tags, tag] };
    }),
  });
}

/**
 * Porta le foto davanti a `beforeAssetId` nella lista corrente (null = in fondo) e passa all'ordine manuale.
 * `visibleIds` è l'elenco mostrato, nell'ordine attuale.
 */
export function reorderAssets(project: Project, visibleIds: readonly string[], movingIds: readonly string[], beforeAssetId: string | null): Project {
  const moving = visibleIds.filter((id) => movingIds.includes(id));
  if (moving.length === 0) return project;
  const rest = visibleIds.filter((id) => !moving.includes(id));
  const at = beforeAssetId === null ? rest.length : rest.indexOf(beforeAssetId);
  const ordered = [...rest.slice(0, at < 0 ? rest.length : at), ...moving, ...rest.slice(at < 0 ? rest.length : at)];
  // Le foto fuori dall'elenco visibile mantengono il loro ordine relativo, dopo quelle riordinate.
  const orderedSet = new Set(ordered);
  const others = sortAssets(project.assets, project.settings.sortKey).filter((asset) => !orderedSet.has(asset.id)).map((asset) => asset.id);
  const finalOrder = [...ordered, ...others];
  const rank = new Map(finalOrder.map((id, index) => [id, index]));
  return touch({
    ...project,
    settings: { ...project.settings, sortKey: "manual" },
    assets: project.assets.map((asset) => ({ ...asset, manualOrder: rank.get(asset.id) ?? asset.manualOrder })),
  });
}

/** Toglie foto dall'album: spariscono dalla libreria, dai capitoli e dagli spread (il layout si richiude). Mai dal disco. */
export function removeAssets(project: Project, assetIds: readonly string[]): Project {
  const doomed = new Set(assetIds);
  if (![...doomed].some((id) => project.assets.some((asset) => asset.id === id))) return project;
  const itemIds = project.spreads.flatMap((spread) => spread.areas.flatMap((area) => area.items.filter((item) => doomed.has(item.assetId)).map((item) => item.id)));
  const cleaned = removeItems(project, itemIds);
  return touch({
    ...cleaned,
    assets: cleaned.assets.filter((asset) => !doomed.has(asset.id)),
    chapters: cleaned.chapters.map((chapter) => ({ ...chapter, assetIds: chapter.assetIds.filter((id) => !doomed.has(id)) })),
  });
}

/** Primo spread (e foto) che usa questa foto, per «Localizza». */
export function locateAsset(project: Project, assetId: string): AssetUsageRef | null {
  return assetUsage(project).get(assetId)?.[0] ?? null;
}

/** Sceglie da dove vengono le stelle. Passando a «selector» le stelle tornano quelle ricevute da Image Select Pro (dove note). */
export function setRatingPolicy(project: Project, policy: "selector" | "project"): Project {
  if ((project.settings.ratingPolicy ?? "selector") === policy) return project;
  const assets = policy === "selector"
    ? project.assets.map((asset) => (asset.selectorRating !== undefined && asset.selectorRating !== asset.rating ? { ...asset, rating: asset.selectorRating } : asset))
    : project.assets;
  return touch({ ...project, assets, settings: { ...project.settings, ratingPolicy: policy } });
}

/** Azzera le stelle di tutte le foto: per ricominciare la scelta in questo album. */
export function clearRatings(project: Project): Project {
  if (project.assets.every((asset) => (asset.rating ?? 0) === 0)) return project;
  return touch({ ...project, assets: project.assets.map((asset) => ((asset.rating ?? 0) === 0 ? asset : { ...asset, rating: 0 })) });
}
