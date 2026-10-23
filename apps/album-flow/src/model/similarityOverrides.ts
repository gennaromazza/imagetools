import type { AlbumSimilarityOverrides } from "@photo-tools/shared-types";
import { touch, type Project } from "./project";

/**
 * Correzioni del fotografo ai gruppi di foto simili, salvate nel progetto (`project.similarity`): «Separa il gruppo»,
 * «Togli dal gruppo» e «Unisci come simili». Funzioni pure; il progetto resta lo stesso oggetto se non cambia nulla.
 */

const sortedPair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

/** Toglie i riferimenti a foto che non esistono più, i doppioni e i gruppi rimasti con una foto; unisce i gruppi che si toccano. */
export function normalizeOverrides(overrides: AlbumSimilarityOverrides | undefined, assetIds: ReadonlySet<string>): AlbumSimilarityOverrides | undefined {
  if (!overrides) return undefined;
  const pairs = new Map<string, [string, string]>();
  for (const [a, b] of overrides.apart) {
    if (a === b || !assetIds.has(a) || !assetIds.has(b)) continue;
    const pair = sortedPair(a, b);
    pairs.set(pair.join("\u0000"), pair);
  }
  const groups: Array<Set<string>> = [];
  for (const raw of overrides.together) {
    const members = new Set(raw.filter((id) => assetIds.has(id)));
    if (members.size < 2) continue;
    const touching = groups.filter((group) => [...members].some((id) => group.has(id)));
    for (const group of touching) { group.forEach((id) => members.add(id)); groups.splice(groups.indexOf(group), 1); }
    groups.push(members);
  }
  const apart = [...pairs.values()].sort((x, y) => (x[0] + x[1] < y[0] + y[1] ? -1 : x[0] + x[1] > y[0] + y[1] ? 1 : 0));
  const together = groups.map((group) => [...group].sort()).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return apart.length || together.length ? { apart, together } : undefined;
}

function withOverrides(project: Project, next: AlbumSimilarityOverrides | undefined): Project {
  const normalized = normalizeOverrides(next, new Set(project.assets.map((asset) => asset.id)));
  if (JSON.stringify(normalized) === JSON.stringify(project.similarity)) return project;
  const { similarity: _old, ...rest } = project;
  return normalized ? { ...rest, similarity: normalized } : rest;
}

/** Riallinea le correzioni alle foto presenti (dopo una rimozione o un nuovo invio dal Selector). */
export function withSimilarityCleaned(project: Project): Project {
  return project.similarity ? withOverrides(project, project.similarity) : project;
}

const current = (project: Project): AlbumSimilarityOverrides => project.similarity ?? { apart: [], together: [] };

/** «Separa il gruppo»: nessuna di queste foto sta più nello stesso gruppo di un'altra. */
export function separatePhotos(project: Project, assetIds: readonly string[]): Project {
  const ids = [...new Set(assetIds)];
  if (ids.length < 2) return project;
  const base = current(project);
  const apart = [...base.apart];
  for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) apart.push(sortedPair(ids[i], ids[j]));
  const drop = new Set(ids);
  const together = base.together.map((group) => group.filter((id) => !drop.has(id)));
  const next = withOverrides(project, { apart, together });
  return next === project ? project : touch(next);
}

/** «Togli dal gruppo»: la foto non è più simile alle altre del suo gruppo, che restano insieme. */
export function detachPhoto(project: Project, assetId: string, groupIds: readonly string[]): Project {
  const others = groupIds.filter((id) => id !== assetId);
  if (others.length === 0) return project;
  const base = current(project);
  const apart = [...base.apart, ...others.map((id) => sortedPair(assetId, id))];
  const together = base.together.map((group) => (group.includes(assetId) && others.some((id) => group.includes(id)) ? group.filter((id) => id !== assetId) : group));
  const next = withOverrides(project, { apart, together });
  return next === project ? project : touch(next);
}

/** «Unisci come simili»: le foto formano un gruppo (anche se scattate lontane); le coppie «non simili» tra loro si annullano. */
export function joinPhotos(project: Project, assetIds: readonly string[]): Project {
  const ids = [...new Set(assetIds)];
  if (ids.length < 2) return project;
  const chosen = new Set(ids);
  const base = current(project);
  const apart = base.apart.filter(([a, b]) => !(chosen.has(a) && chosen.has(b)));
  const next = withOverrides(project, { apart, together: [...base.together, ids] });
  return next === project ? project : touch(next);
}

/** «Ripristina i gruppi automatici»: dimentica tutte le correzioni. */
export function clearSimilarityOverrides(project: Project): Project {
  if (!project.similarity) return project;
  const { similarity: _old, ...rest } = project;
  return touch(rest);
}
