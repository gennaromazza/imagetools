import type { AlbumArea, AlbumItem, AlbumSpread, AreaStyle, AreaTemplate, FavoriteLayout, LayoutNode } from "@photo-tools/shared-types";
import { MAX_RATIO, MIN_RATIO, alignFactor, clampRatio, layoutCells, type LeafCell } from "../engine/geometry";
import { generateLayoutsCached, type LayoutCandidate } from "../engine/generate";
import { applyShape, countLeaves, leafIds, mirrorHorizontal, mirrorVertical, naturalRatios, nodeAt, setRatioAt, shapeOfTree } from "../engine/tree";
import { MAX_ZOOM, STYLE_LIMITS, clampNumber } from "./defaults";
import { baseCrop, cropCenter, cropForView } from "../slot-geometry";
import { newId } from "./ids";
import { placeItem } from "./placement";
import { orientationOf } from "./import";
import { finishTemplateArea, matchTemplates, templateArea, type TemplateMatch } from "./templates";
import { alignChanged, alignedForFit, areaGeometry, fitShapedCells, areaPhotos, assetMap, effectiveAspect, hasFreeLayout, itemAspect, mapSpread, naturalOptions, needsShapeAlignment, normalizeArea, placementStyle, replaceArea, touch, findSpread, type Project } from "./project";

const MAX_CANDIDATES = 24;

/** Layout candidati (dal migliore) per un'area, calcolati sulle foto attuali e sullo stile dell'area. */
export function areaCandidates(project: Project, spread: AlbumSpread, areaIndex: number, limit = MAX_CANDIDATES): LayoutCandidate[] {
  const area = spread.areas[areaIndex];
  if (!area || area.items.length === 0) return [];
  const geometry = areaGeometry(project, spread, areaIndex);
  const candidates = generateLayoutsCached(areaPhotos(project, area), { rect: geometry.inner, gapMm: geometry.gapMm, limit });
  if (!needsShapeAlignment(area)) return candidates;
  // «Foto intera» (o foto con una forma scelta): stessa disposizione, ma con le divisioni regolate perché le foto risultino allineate.
  const assets = assetMap(project);
  const byItem = new Map(area.items.map((item) => [item.id, effectiveAspect(item, assets.get(item.assetId))]));
  const options = naturalOptions(area);
  const align = alignFactor(area.style.align);
  const seen = new Set<string>();
  const alignAll = (list: readonly LayoutCandidate[]): LayoutCandidate[] => list
    // In «riempi» con forme scelte si cerca prima la cella esatta (le altre foto riempiono); altrimenti rapporti naturali (finestre allineate).
    .map((candidate) => ({ ...candidate, tree: (area.style.mode !== "fit" ? fitShapedCells({ ...area, layout: candidate.tree }, geometry.inner, geometry.gapMm) : null) ?? naturalRatios(candidate.tree, (id) => byItem.get(id) ?? 1.5, geometry.inner, geometry.gapMm, options) }))
    // Con i rapporti naturali le varianti che differivano solo per le divisioni diventano identiche: ogni layout proposto resta una volta sola.
    .filter((candidate) => {
      const signature = layoutCells(candidate.tree, geometry.inner, geometry.gapMm, undefined, align).cells
        .map((cell) => `${cell.itemId}:${Math.round(cell.rect.x)},${Math.round(cell.rect.y)},${Math.round(cell.rect.w)},${Math.round(cell.rect.h)}`).join(";");
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });
  const result = alignAll(candidates);
  // Con una forma scelta il motore, che disegna le disposizioni su quella proporzione, può proporne poche (e tutte uguali una volta allineate):
  // Mescola restava ferma. Si aggiungono allora le disposizioni calcolate sulle foto intere, con la forma applicata nelle loro celle.
  if (result.length < 2 && area.items.some((item) => item.shape)) {
    const whole = area.items.map((item) => ({ id: item.id, aspect: itemAspect(assets.get(item.assetId)) }));
    result.push(...alignAll(generateLayoutsCached(whole, { rect: geometry.inner, gapMm: geometry.gapMm, limit })));
  }
  return result;
}

/**
 * Rigenera il layout di un'area con il candidato `index` (0 = il migliore). Non cambia le foto.
 * `from`: lo spread com'era davvero prima dell'operazione, se `spread` contiene un layout provvisorio (per esempio la catena di foglie con cui
 * partono l'aggiunta di foto e il cambio di divisione): il ritaglio fatto a mano si conserva rispetto a ciò che si vedeva lì, non alla catena.
 */
export function relayoutArea(project: Project, spread: AlbumSpread, areaIndex: number, index = 0, from: AlbumSpread = spread): AlbumArea {
  const area = spread.areas[areaIndex];
  if (area.items.length === 0) return area.layout === null && area.seed === 0 ? area : { ...area, layout: null, seed: 0 };
  const candidates = areaCandidates(project, spread, areaIndex);
  if (candidates.length === 0) return area;
  const chosen = Math.min(Math.max(index, 0), candidates.length - 1);
  return keepCrops(project, spread, areaIndex, normalizeArea({ ...area, layout: candidates[chosen].tree, seed: chosen, free: undefined }), from);
}

/**
 * Il ritaglio fatto a mano resta lo stesso quando il layout cambia (Mescola, layout proposti, tasti 1-9): per ogni foto ingrandita o spostata
 * si calcola la parte che si vedeva e, nella nuova cella, si sceglie lo zoom più alto che la contiene tutta, attorno allo stesso centro.
 * Senza questo, una cella di altra proporzione mostrava un'altra porzione della foto e il taglio andava rifatto dopo ogni cambio.
 * Le foto bloccate, con una forma scelta o raddrizzate, e quelle lasciate com'erano, non cambiano.
 * La parte che si vedeva si cerca nello spread `from` (di base `spread`), in qualunque pagina: una foto può arrivare dall'altra pagina.
 */
export function keepCrops(project: Project, spread: AlbumSpread, areaIndex: number, next: AlbumArea, from: AlbumSpread = spread): AlbumArea {
  if (!spread.areas[areaIndex] || hasFreeLayout(next) || next.items.length === 0) return next;
  const assets = assetMap(project);
  const ids = new Set(next.items.map((item) => item.id));
  const seenBefore = new Map<string, { item: AlbumItem; area: AlbumArea; cell: LeafCell }>();
  from.areas.forEach((area, index) => {
    if (!area.items.some((item) => ids.has(item.id))) return;
    const cells = areaGeometry(project, from, index).cells;
    for (const item of area.items) {
      const cell = cells.find((candidate) => candidate.itemId === item.id);
      if (cell && ids.has(item.id)) seenBefore.set(item.id, { item, area, cell });
    }
  });
  const newCells = areaGeometry(project, replaceArea(spread, areaIndex, next), areaIndex).cells;
  let changed = false;
  const items = next.items.map((item) => {
    const previous = seenBefore.get(item.id);
    const asset = assets.get(item.assetId);
    const newCell = newCells.find((cell) => cell.itemId === item.id);
    if (!previous || !asset || !newCell || item.locked || item.shape || (item.angle ?? 0) !== 0 || previous.item.shape) return item;
    const { item: old, area: before, cell: oldCell } = previous;
    const fitted = before.style.mode === "fit" && old.zoom <= 1 + 1e-6;
    if (fitted) return item;
    const seen = placeItem(oldCell.rect, old, asset, placementStyle(before, oldCell), null, oldCell.anchor);
    const plain = placeItem(oldCell.rect, { ...old, zoom: 1, cx: 0.5, cy: 0.5 }, asset, placementStyle(before, oldCell), null, oldCell.anchor);
    const same = (a: number, b: number) => Math.abs(a - b) < 0.002;
    if (same(seen.crop.cropLeft, plain.crop.cropLeft) && same(seen.crop.cropTop, plain.crop.cropTop) && same(seen.crop.cropWidth, plain.crop.cropWidth) && same(seen.crop.cropHeight, plain.crop.cropHeight)) return item;
    const window = placeItem(newCell.rect, { ...item, zoom: 1, cx: 0.5, cy: 0.5 }, asset, placementStyle(next, newCell), null, newCell.anchor).content;
    const imageAspect = itemAspect(asset);
    const viewAspect = window.w / window.h;
    const base = baseCrop(imageAspect, viewAspect);
    const needWidth = Math.max(seen.crop.cropWidth, seen.crop.cropHeight * (viewAspect / Math.max(imageAspect, 0.01)));
    const zoom = Number(clampNumber(base.cropWidth / Math.min(needWidth, base.cropWidth), 1, MAX_ZOOM).toFixed(4));
    const center = cropCenter(seen.crop);
    const crop = cropForView(imageAspect, viewAspect, zoom, center.x, center.y);
    const kept = cropCenter(crop);
    changed = true;
    return { ...item, zoom, cx: Number(kept.x.toFixed(5)), cy: Number(kept.y.toFixed(5)) };
  });
  return changed ? { ...next, items } : next;
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

function choiceAsArea(project: Project, spread: AlbumSpread, areaIndex: number, choice: LayoutChoice): AlbumArea | null {
  const area = spread.areas[areaIndex];
  if (choice.kind === "calculated") return normalizeArea({ ...area, layout: choice.candidate.tree, seed: choice.seed, free: undefined });
  const applied = templateArea(area, choice.match.template, choice.match.order);
  return applied ? { ...finishTemplateArea(project, spread, areaIndex, applied), seed: choice.seed } : null;
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
    if (spread.done || !area || area.locked || area.items.length < 1) return spread;
    const choices = layoutChoices(project, spread, areaIndex, templates);
    if (choices.length < 2) return spread;
    const next = (currentPosition(area, choices) + direction + choices.length * 2) % choices.length;
    const result = choiceAsArea(project, spread, areaIndex, choices[next]);
    return result ? replaceArea(spread, areaIndex, keepCrops(project, spread, areaIndex, result)) : spread;
  });
}

/**
 * Shuffle di tutte le aree dello spread (ognuna rispetta la propria divisione). Le pagine a disposizione libera restano come sono: le posizioni
 * scelte a mano non si perdono per rimescolare l'altra pagina (Mescola della singola pagina, invece, le riporta ai layout automatici).
 */
export function shuffleSpread(project: Project, spreadId: string, direction: 1 | -1 = 1, templates: readonly AreaTemplate[] = []): Project {
  const found = findSpread(project, spreadId);
  if (!found) return project;
  let result = project;
  found.spread.areas.forEach((area, areaIndex) => { if (!hasFreeLayout(area)) result = shuffleArea(result, spreadId, areaIndex, direction, templates); });
  return result;
}

export function applyCandidate(project: Project, spreadId: string, areaIndex: number, candidateIndex: number, templates: readonly AreaTemplate[] = []): Project {
  return mapSpread(project, spreadId, (spread) => {
    const area = spread.areas[areaIndex];
    if (spread.done || !area || area.locked) return spread;
    const choice = layoutChoices(project, spread, areaIndex, templates)[candidateIndex];
    if (!choice) return spread;
    const result = choiceAsArea(project, spread, areaIndex, choice);
    return result ? replaceArea(spread, areaIndex, keepCrops(project, spread, areaIndex, result)) : spread;
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
 * Quando cambia lo stile la disposizione resta la stessa, ma le foto restano allineate: con «riempi» le celle occupano tutto lo
 * spazio, con la foto intera le divisioni si regolano sulle proporzioni delle foto e dipendono anche da spazio tra le foto, margine,
 * bordo e allineamento, quindi si ricalcolano quando uno di questi cambia (non solo il modo).
 */
const ALIGNMENT_KEYS = ["mode", "gapCm", "paddingCm", "borderCm", "align"] as const;
function adaptToMode(project: Project, spread: AlbumSpread, before: AlbumSpread, relayout = false): AlbumSpread {
  if (spread.done) return spread;
  const areas = spread.areas.map((area, index) => {
    const old = before.areas[index];
    if (!old || ALIGNMENT_KEYS.every((key) => old.style[key] === area.style[key]) || area.items.length === 0) return area;
    // Con `relayout` (Alt + clic su «Modo») si sceglie anche la disposizione migliore per il nuovo modo.
    if (relayout && old.style.mode !== area.style.mode && !area.locked) return relayoutArea(project, spread, index, 0);
    const geometry = areaGeometry(project, spread, index);
    // Solo il modo cambia: la disposizione resta (le forme non si rifanno); se cambiano spazio, margine o bordo si riallinea tutto.
    return alignedForFit(project, area, geometry.inner, geometry.gapMm, old.style.mode === area.style.mode);
  });
  return areas.some((area, index) => area !== spread.areas[index]) ? { ...spread, areas } : spread;
}

/** Cambia lo stile di un'area; con "linked" la modifica vale per tutte le aree dello spread. */
export function setAreaStyle(project: Project, spreadId: string, areaIndex: number, changes: Partial<AreaStyle>, relayout = false): Project {
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
    return adaptToMode(project, next, spread, relayout);
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
    // Con le foto allineate («foto intera» o forme scelte) le divisioni seguono le proporzioni delle foto: non si spostano a mano.
    // Con il layout bloccato (lucchetto) le divisioni restano ferme.
    if (!area?.layout || area.locked || hasFreeLayout(area) || needsShapeAlignment(area)) return spread;
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
  if (!found || !area?.layout || area.locked || hasFreeLayout(area)) return project;
  const node = nodeAt(area.layout, path);
  if (!node || node.kind !== "split") return project;
  const geometry = areaGeometry(project, found.spread, areaIndex);
  // Aree allineate: si riallinea tutta l'area (è l'unico stato valido).
  if (needsShapeAlignment(area)) {
    const next = alignedForFit(project, area, geometry.inner, geometry.gapMm);
    return next === area ? project : mapSpread(project, spreadId, (spread) => replaceArea(spread, areaIndex, next));
  }
  // «Riempi»: rapporto naturale di quel separatore, con spazio tra le foto e bordo come nel calcolo dell'allineamento.
  const assets = assetMap(project);
  const aspects = new Map(area.items.map((item) => [item.id, effectiveAspect(item, assets.get(item.assetId))]));
  const natural = naturalRatios(area.layout, (id) => aspects.get(id) ?? 1.5, geometry.inner, geometry.gapMm, naturalOptions(area));
  const target = nodeAt(natural, path);
  if (!target || target.kind !== "split") return project;
  return setDividerRatio(project, spreadId, areaIndex, path, clampNumber(target.ratio, MIN_RATIO, MAX_RATIO));
}

export function mirrorArea(project: Project, spreadId: string, areaIndex: number, axis: "horizontal" | "vertical"): Project {
  return mapSpread(project, spreadId, (spread) => {
    const area = spread.areas[areaIndex];
    if (!area?.layout || area.locked || countLeaves(area.layout) < 2) return spread;
    if (hasFreeLayout(area)) {
      const free = Object.fromEntries(Object.entries(area.free!).map(([id, f]) => [id, axis === "horizontal" ? { ...f, x: Number((1 - f.x - f.w).toFixed(6)), rotation: -f.rotation } : { ...f, y: Number((1 - f.y - f.h).toFixed(6)), rotation: -f.rotation }]));
      return replaceArea(spread, areaIndex, { ...area, free });
    }
    const layout = axis === "horizontal" ? mirrorHorizontal(area.layout) : mirrorVertical(area.layout);
    const mirrored = normalizeArea({ ...area, layout, free: undefined });
    const { inner, gapMm } = areaGeometry(project, spread, areaIndex);
    // Specchiando cambiano i vicini di ogni foto: in «foto intera» le divisioni si riallineano.
    return replaceArea(spread, areaIndex, alignedForFit(project, mirrored, inner, gapMm));
  });
}

// ---------------------------------------------------------------------------
// Layout preferiti
// ---------------------------------------------------------------------------

/**
 * Salva la forma del layout di un'area tra i preferiti. Una disposizione libera non è un albero: si salva come template
 * («Salva come template»), qui non si salva l'albero di riserva che a schermo non si vede.
 */
export function saveFavoriteLayout(project: Project, spreadId: string, areaIndex: number, name?: string): Project {
  const area = findSpread(project, spreadId)?.spread.areas[areaIndex];
  if (!area?.layout || hasFreeLayout(area)) return project;
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
  if (!area.layout || hasFreeLayout(area)) return false;
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
    if (!area || spread.done || area.locked || area.items.length !== favorite.itemCount) return spread;
    const layout = applyShape(favorite.layout, leafIds(area.layout));
    if (!layout) return spread;
    // Come i layout calcolati e i template: in «foto intera» la forma resta, le divisioni si regolano perché le foto risultino allineate.
    const { inner, gapMm } = areaGeometry(project, spread, areaIndex);
    return replaceArea(spread, areaIndex, keepCrops(project, spread, areaIndex, alignedForFit(project, normalizeArea({ ...area, layout, free: undefined }), inner, gapMm)));
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

/**
 * Spazio tra le foto predefinito di tutto l'album. Si applica alle pagine che hanno ancora lo spazio di prima: chi lo ha cambiato a mano
 * (foglio per foglio) lo conserva. Gli spread finiti non cambiano. Restituisce anche quante pagine sono state aggiornate.
 */
export function setAlbumGap(project: Project, gapCm: number): { project: Project; updated: number } {
  const next = clampNumber(gapCm, STYLE_LIMITS.gapCm.min, STYLE_LIMITS.gapCm.max);
  const previous = project.settings.defaultStyle.gapCm;
  if (next === previous) return { project, updated: 0 };
  let updated = 0;
  const spreads = project.spreads.map((spread) => {
    if (spread.done) return spread;
    let changed = false;
    const areas = spread.areas.map((area) => {
      if (Math.abs(area.style.gapCm - previous) > 1e-9) return area;
      changed = true;
      updated += 1;
      return { ...area, style: { ...area.style, gapCm: next } };
    });
    return changed ? { ...spread, areas } : spread;
  });
  const changed = touch({ ...project, settings: { ...project.settings, defaultStyle: { ...project.settings.defaultStyle, gapCm: next } }, spreads });
  return { project: alignChanged(project, changed), updated };
}
