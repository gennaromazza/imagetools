import type { AlbumAssetV2, AlbumItem } from "@photo-tools/shared-types";
import {
  findMoments, findSimilarGroups, isMonochrome, rankForSpread, rankGroup,
  type Moment, type PhotoFingerprint, type SimilarGroup, type SimilarityPhoto,
} from "@photo-tools/photo-similarity";
import { replaceItemAsset } from "./items";
import { assetUsage, sortAssets } from "./library";
import type { PreflightIssue } from "./preflight";
import { alignChanged, findItem, findSpread, itemAspect, mapSpread, replaceArea, type Project } from "./project";

/**
 * Momenti e foto simili in Album Flow: funzioni pure sopra il pacchetto condiviso `@photo-tools/photo-similarity`.
 * L'analisi dipende solo dalle foto della libreria (e dalle correzioni del fotografo), non dagli spread: si ricalcola
 * quando cambia la libreria. Tutto ciò che dipende da quali foto sono già nell'album riceve la mappa d'uso.
 */

/** Dati letti dalle foto fuori dal progetto (impronta delle miniature, modello della fotocamera), per id della foto. */
export interface PhotoSignals {
  fingerprints: ReadonlyMap<string, PhotoFingerprint>;
  cameras: ReadonlyMap<string, string>;
}

export const NO_SIGNALS: PhotoSignals = { fingerprints: new Map(), cameras: new Map() };

export interface AnalyzedGroup extends SimilarGroup {
  /** Dalla foto consigliata all'ultima. */
  ranked: string[];
  /** Perché la prima è consigliata («5 stelle», «più nitida»). */
  reason: string;
}

export interface LibraryAnalysis {
  moments: Moment[];
  momentOf: ReadonlyMap<string, string>;
  momentById: ReadonlyMap<string, Moment>;
  groups: AnalyzedGroup[];
  groupOf: ReadonlyMap<string, AnalyzedGroup>;
  photos: ReadonlyMap<string, SimilarityPhoto>;
}

type Usage = ReadonlyMap<string, readonly unknown[]>;

export function similarityPhoto(asset: AlbumAssetV2, signals: PhotoSignals): SimilarityPhoto {
  return {
    id: asset.id,
    fileName: asset.fileName,
    captureTimeMs: asset.captureTimeMs,
    cameraModel: signals.cameras.get(asset.id),
    aspect: itemAspect(asset),
    rating: asset.rating,
    fingerprint: signals.fingerprints.get(asset.id),
  };
}

/** Momenti e gruppi di foto simili della libreria. */
export function analyzeLibrary(project: Pick<Project, "assets" | "similarity">, signals: PhotoSignals = NO_SIGNALS): LibraryAnalysis {
  const photos = project.assets.map((asset) => similarityPhoto(asset, signals));
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  const moments = findMoments(photos);
  const momentOf = new Map<string, string>();
  for (const moment of moments) for (const id of moment.photoIds) momentOf.set(id, moment.id);
  const groups = findSimilarGroups(photos, project.similarity ?? {}).map((group): AnalyzedGroup => {
    const ranked = rankGroup(group.photoIds.map((id) => byId.get(id)!));
    return { ...group, ranked: ranked.order, reason: ranked.reason };
  });
  const groupOf = new Map<string, AnalyzedGroup>();
  for (const group of groups) for (const id of group.photoIds) groupOf.set(id, group);
  return { moments, momentOf, momentById: new Map(moments.map((moment) => [moment.id, moment])), groups, groupOf, photos: byId };
}

/** La foto del gruppo che lo rappresenta: quella già usata nell'album, altrimenti la consigliata. */
export function groupPick(group: AnalyzedGroup, usage: Usage): string {
  return group.photoIds.find((id) => usage.has(id)) ?? group.ranked[0];
}

/** Vero se la foto non è usata ma un'altra del suo gruppo sì: è un'alternativa, non una foto da sistemare. */
export function isAlternative(analysis: LibraryAnalysis, usage: Usage, assetId: string): boolean {
  if (usage.has(assetId)) return false;
  const group = analysis.groupOf.get(assetId);
  return Boolean(group?.photoIds.some((id) => id !== assetId && usage.has(id)));
}

/**
 * Le foto ancora da mettere nell'album, nell'ordine d'album: le non usate, una sola per gruppo di simili (la consigliata),
 * e nessuna di un gruppo che ha già una foto nell'album.
 */
export function todoAssets(project: Project, analysis: LibraryAnalysis, usage: Usage = assetUsage(project)): AlbumAssetV2[] {
  return sortAssets(project.assets, project.settings.sortKey).filter((asset) => {
    if (usage.has(asset.id)) return false;
    const group = analysis.groupOf.get(asset.id);
    if (!group) return true;
    return !group.photoIds.some((id) => usage.has(id)) && group.ranked[0] === asset.id;
  });
}

// ---------------------------------------------------------------------------
// Libreria: pile e momenti
// ---------------------------------------------------------------------------

export interface LibraryEntry {
  asset: AlbumAssetV2;
  /** La foto rappresenta una pila chiusa o ne fa parte (pila aperta). `position` parte da 1, in ordine di scatto. */
  stack?: { groupId: string; size: number; position: number; open: boolean };
}

/**
 * Le miniature da mostrare: ogni gruppo con almeno due foto visibili diventa una pila (una sola miniatura, la foto usata
 * o la consigliata, al posto della prima del gruppo); le pile aperte mostrano tutte le loro foto.
 */
export function stackEntries(visible: readonly AlbumAssetV2[], analysis: LibraryAnalysis, usage: Usage, open: ReadonlySet<string>): LibraryEntry[] {
  const visibleIds = new Set(visible.map((asset) => asset.id));
  const byId = new Map(visible.map((asset) => [asset.id, asset]));
  const shown = new Set<string>();
  const entries: LibraryEntry[] = [];
  for (const asset of visible) {
    const group = analysis.groupOf.get(asset.id);
    const members = group ? group.photoIds.filter((id) => visibleIds.has(id)) : [];
    if (!group || members.length < 2) { entries.push({ asset }); continue; }
    if (open.has(group.id)) {
      entries.push({ asset, stack: { groupId: group.id, size: members.length, position: members.indexOf(asset.id) + 1, open: true } });
      continue;
    }
    if (shown.has(group.id)) continue;
    shown.add(group.id);
    const pick = groupPick(group, usage);
    const face = byId.get(visibleIds.has(pick) ? pick : members[0])!;
    entries.push({ asset: face, stack: { groupId: group.id, size: members.length, position: members.indexOf(face.id) + 1, open: false } });
  }
  return entries;
}

export interface MomentHeader {
  momentId: string;
  /** Indice della prima miniatura del momento tra quelle mostrate. */
  at: number;
  startMs: number;
  /** Foto del momento nella libreria. */
  photos: number;
  /** Foto del momento ancora da mettere nell'album (una per gruppo di simili). */
  todo: number;
}

/** Intestazioni dei momenti: dove cambia il momento tra due miniature consecutive (solo con l'ordine per ora di scatto ha senso). */
export function momentHeaders(entries: readonly LibraryEntry[], analysis: LibraryAnalysis, todo: ReadonlySet<string>): MomentHeader[] {
  const headers: MomentHeader[] = [];
  let previous: string | undefined;
  entries.forEach((entry, at) => {
    const momentId = analysis.momentOf.get(entry.asset.id);
    if (momentId && momentId !== previous) {
      const moment = analysis.momentById.get(momentId)!;
      headers.push({ momentId, at, startMs: moment.startMs, photos: moment.photoIds.length, todo: moment.photoIds.filter((id) => todo.has(id)).length });
    }
    previous = momentId;
  });
  return headers;
}

/** Clic sull'intestazione di un momento: le sue foto ancora da usare, una per gruppo di simili, in ordine di scatto. */
export function momentPicks(project: Project, analysis: LibraryAnalysis, usage: Usage, momentId: string): string[] {
  const moment = analysis.momentById.get(momentId);
  if (!moment) return [];
  const todo = new Set(todoAssets(project, analysis, usage).map((asset) => asset.id));
  return moment.photoIds.filter((id) => todo.has(id));
}

// ---------------------------------------------------------------------------
// Alternative dentro una cella dello spread
// ---------------------------------------------------------------------------

export interface CellAlternatives {
  groupId: string;
  /** Foto del gruppo che si possono mettere in questa cella, in ordine di scatto (quelle usate altrove sono escluse). */
  ids: string[];
  /** Posizione della foto attuale in `ids`. */
  index: number;
}

/** Le alternative della foto di una cella; null se la foto non ha varianti libere. */
export function alternativesForItem(project: Project, analysis: LibraryAnalysis, itemId: string, usage: Usage = assetUsage(project)): CellAlternatives | null {
  const found = findItem(project, itemId);
  if (!found) return null;
  return alternativesForAsset(analysis, usage, found.item.assetId);
}

function alternativesForAsset(analysis: LibraryAnalysis, usage: Usage, assetId: string): CellAlternatives | null {
  const group = analysis.groupOf.get(assetId);
  if (!group) return null;
  const ids = group.photoIds.filter((id) => id === assetId || !usage.has(id));
  if (ids.length < 2) return null;
  return { groupId: group.id, ids, index: ids.indexOf(assetId) };
}

/** Alternative di tutte le foto di uno spread, per id dell'elemento (per il segnalino «2/3» sulle celle). */
export function spreadAlternatives(project: Project, analysis: LibraryAnalysis, spreadId: string, usage: Usage = assetUsage(project)): Map<string, CellAlternatives> {
  const result = new Map<string, CellAlternatives>();
  const found = findSpread(project, spreadId);
  if (!found || analysis.groups.length === 0) return result;
  for (const area of found.spread.areas) {
    for (const item of area.items) {
      const alternatives = alternativesForAsset(analysis, usage, item.assetId);
      if (alternatives) result.set(item.id, alternatives);
    }
  }
  return result;
}

const sameShape = (a: AlbumAssetV2 | undefined, b: AlbumAssetV2 | undefined) => Boolean(a && b) && Math.abs(itemAspect(a) / itemAspect(b) - 1) < 0.01;

/**
 * Mette nella cella un'altra foto del gruppo. Se ha la stessa forma (come negli scatti in raffica) l'inquadratura scelta resta
 * (zoom, centro, raddrizzamento); altrimenti si riparte dall'inquadratura piena. Una foto bloccata non cambia.
 */
export function chooseAlternative(project: Project, analysis: LibraryAnalysis, itemId: string, assetId: string): Project {
  const found = findItem(project, itemId);
  if (!found || found.item.locked || found.item.assetId === assetId) return project;
  const alternatives = alternativesForAsset(analysis, assetUsage(project), found.item.assetId);
  if (!alternatives || !alternatives.ids.includes(assetId)) return project;
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  if (!sameShape(assets.get(found.item.assetId), assets.get(assetId))) return replaceItemAsset(project, itemId, assetId);
  const items = found.area.items.map((item): AlbumItem => (item.id === itemId ? { ...item, assetId } : item));
  const next = mapSpread(project, found.spread.id, (spread) => replaceArea(spread, found.areaIndex, { ...found.area, items }));
  return alignChanged(project, next);
}

/** Tasto A (avanti) e Maiusc+A (indietro): la variante successiva o precedente nella cella, in giro. */
export function cycleAlternative(project: Project, analysis: LibraryAnalysis, itemId: string, step: 1 | -1): Project {
  const alternatives = alternativesForItem(project, analysis, itemId);
  if (!alternatives) return project;
  const next = alternatives.ids[(alternatives.index + step + alternatives.ids.length) % alternatives.ids.length];
  return chooseAlternative(project, analysis, itemId, next);
}

// ---------------------------------------------------------------------------
// Foto adatte a uno spread
// ---------------------------------------------------------------------------

export interface SpreadSuggestion {
  asset: AlbumAssetV2;
  reasons: string[];
}

/** Le foto ancora da usare che stanno meglio con quelle già sullo spread; vuoto se lo spread non ha ancora foto. */
export function suggestForSpread(project: Project, analysis: LibraryAnalysis, spreadId: string, limit = 24, usage: Usage = assetUsage(project)): SpreadSuggestion[] {
  const found = findSpread(project, spreadId);
  if (!found) return [];
  const placedIds = [...new Set(found.spread.areas.flatMap((area) => area.items.map((item) => item.assetId)))];
  const placed = placedIds.map((id) => analysis.photos.get(id)).filter((photo): photo is SimilarityPhoto => Boolean(photo));
  if (placed.length === 0) return [];
  const pool = todoAssets(project, analysis, usage);
  const byId = new Map(pool.map((asset) => [asset.id, asset]));
  const ranked = rankForSpread(pool.map((asset) => analysis.photos.get(asset.id)!), { spreadPhotos: placed, momentOf: analysis.momentOf }, limit);
  return ranked.map((entry) => ({ asset: byId.get(entry.id)!, reasons: entry.reasons }));
}

// ---------------------------------------------------------------------------
// Controlli prima dell'esportazione
// ---------------------------------------------------------------------------

export function formatClock(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

const shortName = (asset: AlbumAssetV2 | undefined) => (asset ? asset.fileName.replace(/\.[^.]+$/, "") : "una foto");

/**
 * Avvisi sui momenti e sulle foto simili: due foto quasi uguali sullo stesso spread, un momento sparso in spread lontani,
 * bianco e nero accanto al colore sulla stessa pagina.
 */
export function similarityIssues(project: Project, analysis: LibraryAnalysis): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const spreadsOfMoment = new Map<string, Set<number>>();
  project.spreads.forEach((spread, spreadIndex) => {
    const label = `Spread ${spreadIndex + 1}`;
    const seen = new Map<string, AlbumItem>();
    let warned = false;
    spread.areas.forEach((area, areaIndex) => {
      let mono = 0;
      let color = 0;
      for (const item of area.items) {
        const moment = analysis.momentOf.get(item.assetId);
        if (moment) { const set = spreadsOfMoment.get(moment) ?? new Set<number>(); set.add(spreadIndex); spreadsOfMoment.set(moment, set); }
        const look = analysis.photos.get(item.assetId)?.fingerprint;
        if (look) { if (isMonochrome(look)) mono += 1; else color += 1; }
        const group = analysis.groupOf.get(item.assetId);
        if (!group) continue;
        const twin = seen.get(group.id);
        if (twin && twin.assetId !== item.assetId && !warned) {
          warned = true;
          issues.push({ level: "warning", message: `${label}: ${shortName(assets.get(twin.assetId))} e ${shortName(assets.get(item.assetId))} sono quasi uguali (premi A sulla foto per scegliere un'altra variante).`, spreadIndex, itemId: item.id });
        }
        if (!twin) seen.set(group.id, item);
      }
      if (mono > 0 && color > 0) {
        const where = spread.areas.length === 1 ? "" : areaIndex === 0 ? " (pagina sinistra)" : " (pagina destra)";
        issues.push({ level: "info", message: `${label}: foto in bianco e nero accanto a foto a colori${where}.`, spreadIndex });
      }
    });
  });
  for (const [momentId, set] of spreadsOfMoment) {
    const indexes = [...set].sort((a, b) => a - b);
    const gap = indexes.findIndex((value, position) => position > 0 && value - indexes[position - 1] >= 2);
    if (gap < 0) continue;
    const moment = analysis.momentById.get(momentId)!;
    issues.push({ level: "info", message: `Il momento delle ${formatClock(moment.startMs)} è diviso tra gli spread ${indexes[gap - 1] + 1} e ${indexes[gap] + 1}.`, spreadIndex: indexes[gap] });
  }
  return issues;
}
