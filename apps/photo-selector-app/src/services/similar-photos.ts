import {
  rankGroup,
  type PhotoFingerprint,
  type SimilarGroup,
  type SimilarGroupKind,
  type SimilarityPhoto,
} from "@photo-tools/photo-similarity";
import type { ImageAsset } from "@photo-tools/shared-types";
import type { CaptureTimeInfo } from "./photo-sort-cache";

/**
 * Raffiche e foto quasi uguali in Image Select Pro: il riconoscimento è quello del pacchetto
 * condiviso con Album Flow (`@photo-tools/photo-similarity`); qui ci sono solo l'adattamento
 * ai dati del Selector, la foto consigliata di ogni gruppo e le correzioni del fotografo,
 * che valgono per la sessione (non vengono salvate).
 */

export type SimilarityAsset = Pick<ImageAsset, "id" | "fileName" | "width" | "height" | "aspectRatio" | "rating" | "rotationDegrees" | "sourceFileKey">;

/** Larghezza / altezza come appare nella griglia: la rotazione di un quarto di giro le scambia. */
function displayedAspect(asset: SimilarityAsset): number {
  const ratio = asset.width > 0 && asset.height > 0
    ? asset.width / asset.height
    : asset.aspectRatio > 0 ? asset.aspectRatio : 1;
  const quarterTurn = Math.abs(Math.round((asset.rotationDegrees ?? 0) / 90)) % 2 === 1;
  return quarterTurn ? 1 / ratio : ratio;
}

/** Foto del Selector nel formato del pacchetto: ora di scatto e fotocamera dall'EXIF già letto, impronta se pronta. */
export function toSimilarityPhotos(
  assets: readonly SimilarityAsset[],
  captureById: ReadonlyMap<string, CaptureTimeInfo>,
  fingerprintOf: (asset: SimilarityAsset) => PhotoFingerprint | undefined,
): SimilarityPhoto[] {
  return assets.map((asset) => {
    const capture = captureById.get(asset.id);
    return {
      id: asset.id,
      fileName: asset.fileName,
      captureTimeMs: capture?.timeMs,
      cameraModel: capture?.cameraModel ?? undefined,
      aspect: displayedAspect(asset),
      rating: asset.rating ?? 0,
      fingerprint: fingerprintOf(asset),
    };
  });
}

/**
 * Vero se i gruppi non possono cambiare: stesse foto, stesso ordine, stessi dati di scatto e
 * stesse impronte. Le stelle non contano (cambiano solo la consigliata), così classificare
 * non ricalcola i gruppi a ogni tasto.
 */
export function isSameGroupingInput(previous: readonly SimilarityPhoto[], next: readonly SimilarityPhoto[]): boolean {
  if (previous.length !== next.length) return false;
  for (let index = 0; index < next.length; index += 1) {
    const a = previous[index]!;
    const b = next[index]!;
    if (a.id !== b.id || a.fileName !== b.fileName || a.aspect !== b.aspect
      || a.captureTimeMs !== b.captureTimeMs || a.cameraModel !== b.cameraModel || a.fingerprint !== b.fingerprint) {
      return false;
    }
  }
  return true;
}

export interface SimilarGroupView {
  id: string;
  kind: SimilarGroupKind;
  /** In ordine di scatto. */
  photoIds: string[];
  /** Dalla consigliata all'ultima. */
  ranked: string[];
  recommendedId: string;
  /** Perché è consigliata («5 stelle», «più nitida»…). */
  reason: string;
}

export interface SimilarMembership {
  groupId: string;
  /** Posizione in ordine di scatto, da 1. */
  position: number;
  size: number;
  recommended: boolean;
}

export interface SimilarPhotosView {
  groups: SimilarGroupView[];
  membershipById: Map<string, SimilarMembership>;
}

/** Ordina ogni gruppo con `rankGroup` (stelle, poi nitidezza ed esposizione) e indicizza le foto per il badge della griglia. */
export function buildSimilarPhotosView(groups: readonly SimilarGroup[], photos: readonly SimilarityPhoto[]): SimilarPhotosView {
  const photoById = new Map(photos.map((photo) => [photo.id, photo]));
  const membershipById = new Map<string, SimilarMembership>();
  const views = groups.map((group): SimilarGroupView => {
    const members = group.photoIds
      .map((id) => photoById.get(id))
      .filter((photo): photo is SimilarityPhoto => Boolean(photo));
    const { order, reason } = rankGroup(members);
    const recommendedId = order[0] ?? group.photoIds[0]!;
    group.photoIds.forEach((id, index) => {
      membershipById.set(id, { groupId: group.id, position: index + 1, size: group.photoIds.length, recommended: id === recommendedId });
    });
    return { id: group.id, kind: group.kind, photoIds: group.photoIds, ranked: order, recommendedId, reason };
  });
  return { groups: views, membershipById };
}

export const SIMILAR_KIND_LABELS: Record<SimilarGroupKind, string> = {
  burst: "Raffica",
  similar: "Quasi uguali",
  manual: "Unite a mano",
};

/** «Tieni questa»: la foto scelta diventa Pick, le altre varianti Scartate (i file non si toccano). */
export function planKeepOne(photoIds: readonly string[], keepId: string): { pick: string; reject: string[] } {
  if (!photoIds.includes(keepId)) throw new Error("La foto scelta non fa parte del gruppo.");
  return { pick: keepId, reject: photoIds.filter((id) => id !== keepId) };
}

/** Un gruppo è da decidere finché nessuna variante è Pick. */
export function isGroupDecided(photoIds: readonly string[], pickStatusById: (id: string) => ImageAsset["pickStatus"]): boolean {
  return photoIds.some((id) => pickStatusById(id) === "picked");
}

/** Correzioni del fotografo, solo per la sessione: coppie «non simili» e gruppi uniti a mano. */
export interface SessionSimilarityOverrides {
  apart: Array<[string, string]>;
  together: string[][];
}

export const EMPTY_SIMILARITY_OVERRIDES: SessionSimilarityOverrides = { apart: [], together: [] };

const sortedPair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);
const pairKey = ([a, b]: readonly [string, string]) => `${a}\u0000${b}`;

/** Niente doppioni, niente gruppi di una sola foto; i gruppi uniti a mano che condividono una foto diventano uno. */
function normalize(overrides: SessionSimilarityOverrides): SessionSimilarityOverrides {
  const pairs = new Map<string, [string, string]>();
  for (const [a, b] of overrides.apart) {
    if (a === b) continue;
    const pair = sortedPair(a, b);
    pairs.set(pairKey(pair), pair);
  }
  const groups: Array<Set<string>> = [];
  for (const raw of overrides.together) {
    const members = new Set(raw);
    if (members.size < 2) continue;
    for (const group of groups.filter((candidate) => [...members].some((id) => candidate.has(id)))) {
      group.forEach((id) => members.add(id));
      groups.splice(groups.indexOf(group), 1);
    }
    groups.push(members);
  }
  return { apart: [...pairs.values()], together: groups.map((group) => [...group]) };
}

/** «Separa»: nessuna di queste foto sta più nello stesso gruppo di un'altra. */
export function separatePhotos(overrides: SessionSimilarityOverrides, photoIds: readonly string[]): SessionSimilarityOverrides {
  const ids = [...new Set(photoIds)];
  if (ids.length < 2) return overrides;
  const apart = [...overrides.apart];
  for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) apart.push(sortedPair(ids[i]!, ids[j]!));
  const drop = new Set(ids);
  return normalize({ apart, together: overrides.together.map((group) => group.filter((id) => !drop.has(id))) });
}

/** «Togli dal gruppo»: la foto non è più simile alle altre, che restano insieme. */
export function detachPhoto(overrides: SessionSimilarityOverrides, photoId: string, groupIds: readonly string[]): SessionSimilarityOverrides {
  const others = groupIds.filter((id) => id !== photoId);
  if (others.length === 0) return overrides;
  return normalize({
    apart: [...overrides.apart, ...others.map((id) => sortedPair(photoId, id))],
    together: overrides.together.map((group) => (group.includes(photoId) ? group.filter((id) => id !== photoId) : group)),
  });
}

/** «Unisci come simili»: le foto formano un gruppo anche se scattate lontane; le coppie «non simili» tra loro si annullano. */
export function joinPhotos(overrides: SessionSimilarityOverrides, photoIds: readonly string[]): SessionSimilarityOverrides {
  const ids = [...new Set(photoIds)];
  if (ids.length < 2) return overrides;
  const chosen = new Set(ids);
  return normalize({
    apart: overrides.apart.filter(([a, b]) => !(chosen.has(a) && chosen.has(b))),
    together: [...overrides.together, ids],
  });
}

export const hasSimilarityOverrides = (overrides: SessionSimilarityOverrides) => overrides.apart.length > 0 || overrides.together.length > 0;
