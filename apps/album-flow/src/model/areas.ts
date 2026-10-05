import type { AlbumArea, AlbumSpread, AreaStyle, AreaTemplate, FavoriteLayout, LayoutNode } from "@photo-tools/shared-types";
import { MAX_RATIO, MIN_RATIO, clampRatio } from "../engine/geometry";
import { generateLayoutsCached, type LayoutCandidate } from "../engine/generate";
import { applyShape, countLeaves, leafIds, mirrorHorizontal, mirrorVertical, naturalRatios, nodeAt, setRatioAt, shapeOfTree } from "../engine/tree";
import { STYLE_LIMITS, clampNumber } from "./defaults";
import { newId } from "./ids";
import { orientationOf } from "./import";
import { matchTemplates, templateArea, type TemplateMatch } from "./templates";
import { alignedForFit, areaGeometry, areaPhotos, assetMap, hasFreeLayout, itemAspect, mapSpread, normalizeArea, replaceArea, touch, findSpread, type Project } from "./project";

const MAX_CANDIDATES = 24;

/** Layout candidati (dal migliore) per un'area, calcolati sulle foto attuali e sullo stile dell'area. */
export function areaCandidates(project: Project, spread: AlbumSpread, areaIndex: number, limit = MAX_CANDIDATES): LayoutCandidate[] {
  const area = spread.areas[areaIndex];
  if (!area || area.items.length === 0) return [];
  const geometry = areaGeometry(project, spread, areaIndex);
  const candidates = generateLayoutsCached(areaPhotos(project, area), { rect: geometry.inner, gapMm: geometry.gapMm, limit });
  if (area.style.mode !== "fit") return candidates;
  // «Foto intera»: stessa disposizione, ma con le divisioni regolate perché le foto risultino allineate.
  const assets = assetMap(project);
  const byItem = new Map(area.items.map((item) => [item.id, itemAspect(assets.get(item.assetId))]));
  return candidates.map((candidate) => ({ ...candidate, tree: naturalRatios(candidate.tree, (id) => byItem.get(id) ?? 1.5, geometry.inner, geometry.gapMm) }));
}

/** Rigenera il layout di un'area con il candidato `index` (0 = il migliore). Non cambia le foto. */
export function relayoutArea(project: Project, spread: AlbumSpread, areaIndex: number, index = 0): AlbumArea {
  const area = spread.areas[areaIndex];
  if (area.items.length === 0) return area.layout === null && area.seed === 0 ? area : { ...area, layout: null, seed: 0 };
  const candidates = areaCandidates(project, spread, areaIndex);
  if (candidates.length === 0) return area;
  const chosen = Math.min(Math.max(index, 0), candidates.length - 1);
  return normalizeArea({ ...area, layout: candidates[chosen].tree, seed: chosen, free: undefined });
}

/** I template dell'utente hanno un seme a parte: 1000 + posizione tra i template adatti. */
export const TEMPLATE_SEED_BASE = 1000;

/** Una scelta di layout per un'area: calcolata dal motore oppure un template dell'utente riconosciuto per quel contesto. */
export type LayoutChoice =
  | { kind: "calculated"; candidate: LayoutCandidate; seed: number }
  | { kind: "template"; match: TemplateMatch; seed: number };

/**
 * Elenco unico di layout per un'area, usato da Mescola, dalle frecce, dai tasti 1-9 e dal browser dei layout: il migliore
 * calcolato, poi i template dell'utente adatti (stesso tipo di area e numero di foto, dal migliore), poi gli altri calcolati.
 */
export function layoutChoices(project: Project, spread: AlbumSpread, areaIndex: number, templates: readonly AreaTemplate[] = [], limit = MAX_CANDIDATES): LayoutChoice[] {
  const calculated: LayoutChoice[] = areaCandidates(project, spread, areaIndex, limit).map((candidate, index) => ({ kind: "calculated", candidate, seed: index }));
  const own: LayoutChoice[] = matchTemplates(project, spread, areaIndex, templates).map((match, index) => ({ kind: "template", match, seed: TEMPLATE_SEED_BASE + index }));
  return [...calculated.slice(0, 1), ...own, ...calculated.slice(1)];
}

function choiceAsArea(area: AlbumArea, choice: LayoutChoice): AlbumArea | null {
  if (choice.kind === "calculated") return normalizeArea({ ...area, layout: choice.candidate.tree, seed: choice.seed, free: undefined });
  const applied = templateArea(area, choice.match.template, choice.match.order);
  return applied ? { ...applied, seed: choice.seed } : null;
}

/** Posizione del layout attuale nell'elenco (dal seme), 0 se non si riconosce. */
function currentPosition(area: AlbumArea, choices: readonly LayoutChoice[]): number {
  const found = choices.findIndex((choice) => choice.seed === area.seed);
  return found >= 0 ? found : 0;
}

/**
 * Passa al layout successivo (o precedente) dell'elenco unico, senza cambiare le foto. Con i template dell'utente
 * l'elenco li include dove il contesto coincide.
 */
export function shuffleArea(project: Project, spreadId: string, areaIndex: number, direction: 1 | -1 = 1, templates: readonly AreaTemplate[] = []): Project {
  return mapSpread(project, spreadId, (spread) => {
    const area = spread.areas[areaIndex];
    if (spread.done || !area || area.items.length < 1) return spread;
    const choices = layoutChoices(project, spread, areaIndex, templates);
    if (choices.length < 2) return spread;
    const next = (currentPosition(area, choices) + direction + choices.length * 2) % choices.length;
    const result = choiceAsArea(area, choices[next]);
    return result ? replaceArea(spread, areaIndex, result) : spread;
  });
}

/** Shuffle di tutte le aree dello spread (ognuna rispetta la propria divisione). */
export function shuffleSpread(project: Project, spreadId: string, direction: 1 | -1 = 1, templates: readonly AreaTemplate[] = []): Project {
  const found = findSpread(project, spreadId);
  if (!found) return project;
  let result = project;
  found.spread.areas.forEach((_, areaIndex) => { result = shuffleArea(result, spreadId, areaIndex, direction, templates); });
  return result;
}

export function applyCandidate(project: Project, spreadId: string, areaIndex: number, candidateIndex: number, templates: readonly AreaTemplate[] = []): Project {
  return mapSpread(project, spreadId, (spread) => {
    const area = spread.areas[areaIndex];
    if (spread.done || !area) return spread;
    const choice = layoutChoices(project, spread, areaIndex, templates)[candidateIndex];
    if (!choice) return spread;
    const result = choiceAsArea(area, choice);
    return result ? replaceArea(spread, areaIndex, result) : spread;
  });
}

/** Applica uno dei primi nove layout con i tasti numerici (come il Quick Design Picker di Fundy). */
export function applyCandidateByNumber(project: Project, spreadId: string, areaIndex: number, number: number, templates: readonly AreaTemplate[] = []): Project {
  return applyCandidate(project, spreadId, areaIndex, number - 1, templates);
}

// ---------------------------------------------------------------------------
// Stile
// ---------------------------------------------------------------------------

export function sanitizeStyle(style: AreaStyle): AreaStyle {
  return {
    ...style,
    gapCm: clampNumber(style.gapCm, STYLE_LIMITS.gapCm.min, STYLE_LIMITS.gapCm.max),
    paddingCm: clampNumber(style.paddingCm, STYLE_LIMITS.paddingCm.min, STYLE_LIMITS.paddingCm.max),
    borderCm: clampNumber(style.borderCm, STYLE_LIMITS.borderCm.min, STYLE_LIMITS.borderCm.max),
    mode: style.mode === "fit" ? "fit" : "fill",
    align: style.align === "start" || style.align === "end" ? style.align : "center",
    mono: Boolean(style.mono),
  };
}

/**
 * Quando cambia il modo (riempi ↔ foto intera) la disposizione resta la stessa: con «riempi» le celle occupano tutto lo
 * spazio (spariscono i bordi vuoti sopra e sotto), con la foto intera le divisioni si regolano sulle proporzioni delle foto.
 */
function adaptToMode(project: Project, spread: AlbumSpread, before: AlbumSpread): AlbumSpread {
  if (spread.done) return spread;
  const areas = spread.areas.map((area, index) => {
    if (!before.areas[index] || before.areas[index].style.mode === area.style.mode || area.items.length === 0) return area;
    const geometry = areaGeometry(project, spread, index);
    return alignedForFit(project, area, geometry.inner, geometry.gapMm);
  });
  return areas.some((area, index) => area !== spread.areas[index]) ? { ...spread, areas } : spread;
}

/** Cambia lo stile di un'area; con "linked" la modifica vale per tutte le aree dello spread. */
export function setAreaStyle(project: Project, spreadId: string, areaIndex: number, changes: Partial<AreaStyle>): Project {
  return mapSpread(project, spreadId, (spread) => {
    if (!spread.areas[areaIndex]) return spread;
    const targets = spread.linked ? spread.areas.map((_, index) => index) : [areaIndex];
    let changed = false;
    const areas = spread.areas.map((area, index) => {
      if (!targets.includes(index)) return area;
      const style = sanitizeStyle({ ...area.style, ...changes });
      if (JSON.stringify(style) === JSON.stringify(area.style)) return area;
      changed = true;
      return { ...area, style };
    });
    if (!changed) return spread;
    const next = { ...spread, areas };
    return adaptToMode(project, next, spread);
  });
}

export function setLinked(project: Project, spreadId: string, linked: boolean): Project {
  return mapSpread(project, spreadId, (spread) => {
    if (spread.linked === linked) return spread;
    if (!linked || spread.areas.length < 2) return { ...spread, linked };
    // Collegando gli stili, la seconda area adotta quello della prima.
    const style = spread.areas[0].style;
    const next = { ...spread, linked, areas: spread.areas.map((area, index) => (index === 0 ? area : { ...area, style: { ...style } })) };
    return adaptToMode(project, next, spread);
  });
}

/** Copia lo stile di un'area su tutte le aree dello spread. */
export function applyStyleToSpread(project: Project, spreadId: string, areaIndex: number): Project {
  return mapSpread(project, spreadId, (spread) => {
    const source = spread.areas[areaIndex]?.style;
    if (!source) return spread;
    return adaptToMode(project, { ...spread, areas: spread.areas.map((area) => ({ ...area, style: { ...source } })) }, spread);
  });
}

/** Copia lo stile di un'area su tutte le aree di tutti gli spread e lo imposta come stile predefinito. */
export function applyStyleToAlbum(project: Project, spreadId: string, areaIndex: number): Project {
  const source = findSpread(project, spreadId)?.spread.areas[areaIndex]?.style;
  if (!source) return project;
  return touch({
    ...project,
    settings: { ...project.settings, defaultStyle: { ...source } },
    spreads: project.spreads.map((spread) => adaptToMode(project, { ...spread, areas: spread.areas.map((area) => ({ ...area, style: { ...source } })) }, spread)),
  });
}

// ---------------------------------------------------------------------------
// Separatori e specchi
// ---------------------------------------------------------------------------

export function setDividerRatio(project: Project, spreadId: string, areaIndex: number, path: string, ratio: number): Project {
  return mapSpread(project, spreadId, (spread) => {
    const area = spread.areas[areaIndex];
    if (!area?.layout) return spread;
    const node = nodeAt(area.layout, path);
    if (!node || node.kind !== "split") return spread;
    const next = clampRatio(Number(ratio.toFixed(5)));
    if (Math.abs(next - node.ratio) < 1e-5) return spread;
    return replaceArea(spread, areaIndex, { ...area, layout: setRatioAt(area.layout, path, next) });
  });
}

/** Riporta un separatore al rapporto naturale tra le due parti (stessa altezza o larghezza delle foto). */
export function resetDividerRatio(project: Project, spreadId: string, areaIndex: number, path: string): Project {
  const found = findSpread(project, spreadId);
  const area = found?.spread.areas[areaIndex];
  if (!found || !area?.layout) return project;
  const node = nodeAt(area.layout, path);
  if (!node || node.kind !== "split") return project;
  const assets = assetMap(project);
  const aspectOf = (n: LayoutNode): number => {
    if (n.kind === "leaf") return itemAspect(assets.get(area.items.find((item) => item.id === n.itemId)?.assetId ?? ""));
    const a = aspectOf(n.first);
    const b = aspectOf(n.second);
    return n.dir === "row" ? a + b : 1 / (1 / a + 1 / b);
  };
  const a = aspectOf(node.first);
  const b = aspectOf(node.second);
  const natural = node.dir === "row" ? a / (a + b) : b / (a + b);
  return setDividerRatio(project, spreadId, areaIndex, path, clampNumber(natural, MIN_RATIO, MAX_RATIO));
}

export function mirrorArea(project: Project, spreadId: string, areaIndex: number, axis: "horizontal" | "vertical"): Project {
  return mapSpread(project, spreadId, (spread) => {
    const area = spread.areas[areaIndex];
    if (!area?.layout || countLeaves(area.layout) < 2) return spread;
    if (hasFreeLayout(area)) {
      const free = Object.fromEntries(Object.entries(area.free!).map(([id, f]) => [id, axis === "horizontal" ? { ...f, x: Number((1 - f.x - f.w).toFixed(6)), rotation: -f.rotation } : { ...f, y: Number((1 - f.y - f.h).toFixed(6)), rotation: -f.rotation }]));
      return replaceArea(spread, areaIndex, { ...area, free });
    }
    const layout = axis === "horizontal" ? mirrorHorizontal(area.layout) : mirrorVertical(area.layout);
    return replaceArea(spread, areaIndex, normalizeArea({ ...area, layout, free: undefined }));
  });
}

// ---------------------------------------------------------------------------
// Layout preferiti
// ---------------------------------------------------------------------------

export function saveFavoriteLayout(project: Project, spreadId: string, areaIndex: number, name?: string): Project {
  const area = findSpread(project, spreadId)?.spread.areas[areaIndex];
  if (!area?.layout) return project;
  const itemCount = countLeaves(area.layout);
  const shape = shapeOfTree(area.layout);
  const signature = JSON.stringify(shape);
  if (project.favoriteLayouts.some((favorite) => favorite.itemCount === itemCount && JSON.stringify(favorite.layout) === signature)) return project;
  const favorite: FavoriteLayout = { id: newId("fav"), itemCount, layout: shape, ...(name ? { name } : {}) };
  return touch({ ...project, favoriteLayouts: [...project.favoriteLayouts, favorite] });
}

export function removeFavoriteLayout(project: Project, favoriteId: string): Project {
  if (!project.favoriteLayouts.some((favorite) => favorite.id === favoriteId)) return project;
  return touch({ ...project, favoriteLayouts: project.favoriteLayouts.filter((favorite) => favorite.id !== favoriteId) });
}

export function isFavoriteLayout(project: Project, area: AlbumArea): boolean {
  if (!area.layout) return false;
  const signature = JSON.stringify(shapeOfTree(area.layout));
  return project.favoriteLayouts.some((favorite) => JSON.stringify(favorite.layout) === signature);
}

export function favoritesFor(project: Project, area: AlbumArea): FavoriteLayout[] {
  return project.favoriteLayouts.filter((favorite) => favorite.itemCount === area.items.length);
}

export function applyFavoriteLayout(project: Project, spreadId: string, areaIndex: number, favoriteId: string): Project {
  const favorite = project.favoriteLayouts.find((candidate) => candidate.id === favoriteId);
  if (!favorite) return project;
  return mapSpread(project, spreadId, (spread) => {
    const area = spread.areas[areaIndex];
    if (!area || area.items.length !== favorite.itemCount) return spread;
    const layout = applyShape(favorite.layout, leafIds(area.layout));
    return layout ? replaceArea(spread, areaIndex, normalizeArea({ ...area, layout, free: undefined })) : spread;
  });
}

/**
 * Allinea le foto delle aree in «foto intera» (stessa altezza in una riga, stessa larghezza in una colonna) per uno spread
 * o per tutto l'album; serve a sistemare layout fatti prima o ritoccati a mano. Gli spread finiti non cambiano.
 */
export function alignFitAreas(project: Project, spreadId?: string): Project {
  let changed = false;
  const spreads = project.spreads.map((spread) => {
    if (spread.done || (spreadId && spread.id !== spreadId)) return spread;
    const areas = spread.areas.map((area, index) => {
      const geometry = areaGeometry(project, spread, index);
      const next = alignedForFit(project, area, geometry.inner, geometry.gapMm);
      if (next !== area) changed = true;
      return next;
    });
    return areas.some((area, index) => area !== spread.areas[index]) ? { ...spread, areas } : spread;
  });
  return changed ? touch({ ...project, spreads }) : project;
}

/**
 * Aggiorna le misure delle foto il cui file è cambiato sul disco (per esempio ritagliato in Photoshop) e riallinea le aree
 * in «foto intera», dato che le proporzioni possono essere diverse. Restituisce lo stesso progetto se nulla cambia.
 */
export function refreshAssetShapes(project: Project, updates: ReadonlyArray<{ assetId: string; width: number; height: number }>): Project {
  const byId = new Map(updates.filter((update) => update.width > 0 && update.height > 0).map((update) => [update.assetId, update]));
  let changed = false;
  const assets = project.assets.map((asset) => {
    const update = byId.get(asset.id);
    if (!update || (update.width === asset.width && update.height === asset.height)) return asset;
    changed = true;
    return { ...asset, width: update.width, height: update.height, aspectRatio: update.width / update.height, orientation: orientationOf(update.width, update.height) };
  });
  if (!changed) return project;
  return alignFitAreas(touch({ ...project, assets }));
}
