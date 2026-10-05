import type { AlbumArea, AlbumAssetV2, AlbumSpread, AreaTemplate, FreeFrame, LayoutNode, SheetSpec, TemplateTarget } from "@photo-tools/shared-types";
import { areaOuterRects, insetRect, layoutCells, type Rect } from "../engine/geometry";
import { cropFraction } from "../engine/generate";
import { applyShape, countLeaves, leaf, leafIds, shapeOfTree, split } from "../engine/tree";
import { newId } from "./ids";
import { MAX_ITEMS_PER_AREA } from "./defaults";
import { areaGeometry, assetMap, effectiveAspect, hasFreeLayout, mapSpread, nowIso, normalizeArea, replaceArea, touch, findItem, type Project } from "./project";

/**
 * Template disegnati dall'utente: si salvano nel computer (valgono per tutti gli album), si riconoscono dal numero di foto e
 * dal tipo di area, e il motore li propone scegliendo per ogni cella la foto che ritaglia meno.
 */

export const TEMPLATE_STORAGE_KEY = "filex.albumFlow.v2.templates";
export const MAX_TEMPLATES = 200;
/** Fino a questo numero di foto si provano tutte le assegnazioni foto → cella (7! = 5040). */
const PERMUTATION_LIMIT = 7;

export const TARGET_LABELS: Record<TemplateTarget, string> = { page: "Pagina", full: "Foglio intero", third: "Un terzo", "two-thirds": "Due terzi" };

/** Tipo di area di uno spread: pagina (metà), foglio intero, un terzo o due terzi. */
export function templateTarget(spread: Pick<AlbumSpread, "split">, areaIndex: number): TemplateTarget {
  switch (spread.split) {
    case "full": return "full";
    case "half": return "page";
    case "third": return areaIndex === 0 ? "third" : "two-thirds";
    default: return areaIndex === 0 ? "two-thirds" : "third";
  }
}

/** Rettangolo utile (mm) in cui si disegna e si applica un template di quel tipo, con lo stile dato. */
export function targetInner(sheet: Pick<SheetSpec, "widthCm" | "heightCm">, target: TemplateTarget, paddingCm: number): Rect {
  const outer = target === "full" ? areaOuterRects(sheet, "full")[0]
    : target === "page" ? areaOuterRects(sheet, "half")[0]
    : target === "third" ? areaOuterRects(sheet, "third")[0]
    : areaOuterRects(sheet, "third")[1];
  return insetRect(outer, paddingCm * 10);
}

// ---------------------------------------------------------------------------
// Controlli e salvataggio
// ---------------------------------------------------------------------------

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export function sanitizeFrame(frame: FreeFrame): FreeFrame {
  const w = clamp(frame.w, 0.04, 1);
  const h = clamp(frame.h, 0.04, 1);
  return {
    x: Number(clamp(frame.x, 0, 1 - w).toFixed(5)),
    y: Number(clamp(frame.y, 0, 1 - h).toFixed(5)),
    w: Number(w.toFixed(5)),
    h: Number(h.toFixed(5)),
    rotation: Number(clamp(frame.rotation, -180, 180).toFixed(2)),
    z: Math.round(clamp(frame.z, -1000, 1000)),
  };
}

/** Un template valido o null: nome, tipo, numero di foto coerente con la forma o con le cornici. */
export function sanitizeTemplate(raw: unknown): AreaTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Partial<AreaTemplate>;
  if (typeof t.id !== "string" || typeof t.name !== "string" || !t.name.trim()) return null;
  if (t.kind !== "tree" && t.kind !== "free") return null;
  if (!(["page", "full", "third", "two-thirds"] as const).includes(t.target as TemplateTarget)) return null;
  const base = { id: t.id, name: t.name.trim().slice(0, 60), target: t.target as TemplateTarget, createdAt: typeof t.createdAt === "string" ? t.createdAt : nowIso() };
  if (t.kind === "tree") {
    if (!t.shape) return null;
    const count = countLeaves(t.shape);
    if (count < 1 || count > MAX_ITEMS_PER_AREA) return null;
    return { ...base, kind: "tree", count, shape: shapeOfTree(t.shape) };
  }
  if (!Array.isArray(t.frames) || t.frames.length < 1 || t.frames.length > MAX_ITEMS_PER_AREA) return null;
  const frames = t.frames.map((frame) => sanitizeFrame(frame as FreeFrame));
  return { ...base, kind: "free", count: frames.length, frames };
}

function storage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export function loadTemplates(): AreaTemplate[] {
  try {
    const raw = storage()?.getItem(TEMPLATE_STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.map(sanitizeTemplate).filter((item): item is AreaTemplate => item !== null).slice(0, MAX_TEMPLATES) : [];
  } catch { return []; }
}

export function saveTemplates(list: readonly AreaTemplate[]): boolean {
  try { storage()?.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(list.slice(0, MAX_TEMPLATES))); return true; } catch { return false; }
}

/** Aggiunge o sostituisce (stesso id) un template; il nome è reso unico per tipo. */
export function upsertTemplate(list: readonly AreaTemplate[], template: AreaTemplate): AreaTemplate[] {
  const clean = sanitizeTemplate(template);
  if (!clean) throw new Error("Template non valido: servono un nome e almeno una foto.");
  const others = list.filter((item) => item.id !== clean.id);
  let name = clean.name;
  for (let n = 2; others.some((item) => item.target === clean.target && item.name.toLocaleLowerCase() === name.toLocaleLowerCase()); n += 1) name = `${clean.name} (${n})`;
  if (others.length >= MAX_TEMPLATES) throw new Error(`Puoi salvare al massimo ${MAX_TEMPLATES} template.`);
  const next = { ...clean, name };
  const index = list.findIndex((item) => item.id === clean.id);
  return index >= 0 ? list.map((item) => (item.id === clean.id ? next : item)) : [...list, next];
}

export function removeTemplate(list: readonly AreaTemplate[], templateId: string): AreaTemplate[] {
  return list.filter((item) => item.id !== templateId);
}

export function createTemplateId(): string {
  return newId("tpl");
}

// ---------------------------------------------------------------------------
// Celle di un template e abbinamento con le foto
// ---------------------------------------------------------------------------

/** Rettangoli (mm) delle celle di un template dentro l'area utile, nell'ordine di lettura. */
export function templateCells(template: AreaTemplate, inner: Rect, gapMm: number): Array<{ rect: Rect; rotation: number; z: number }> {
  if (template.kind === "free") {
    return (template.frames ?? []).map((frame) => ({ rect: { x: inner.x + frame.x * inner.w, y: inner.y + frame.y * inner.h, w: frame.w * inner.w, h: frame.h * inner.h }, rotation: frame.rotation, z: frame.z }));
  }
  if (!template.shape) return [];
  const ids = Array.from({ length: template.count }, (_, index) => `t${index}`);
  const tree = applyShape(template.shape, ids);
  return tree ? layoutCells(tree, inner, gapMm).cells.map((cell) => ({ rect: cell.rect, rotation: 0, z: 0 })) : [];
}

export interface TemplateMatch {
  template: AreaTemplate;
  /** order[i] = indice (nell'ordine attuale delle foto dell'area) della foto che va nella cella i. */
  order: number[];
  /** Perdita media di ritaglio (0 = nessuna): più basso è meglio. */
  cost: number;
}

function permutations(n: number): number[][] {
  const out: number[][] = [];
  const walk = (prefix: number[], rest: number[]) => {
    if (rest.length === 0) { out.push(prefix); return; }
    rest.forEach((value, index) => walk([...prefix, value], [...rest.slice(0, index), ...rest.slice(index + 1)]));
  };
  walk([], Array.from({ length: n }, (_, index) => index));
  return out;
}

/** Assegna a ogni cella la foto che ritaglia meno, a parità preferendo l'ordine attuale delle foto. */
export function bestAssignment(cellAspects: readonly number[], photoAspects: readonly number[], keepOrder = false): { order: number[]; cost: number } {
  const n = cellAspects.length;
  const identity = Array.from({ length: n }, (_, index) => index);
  const costOf = (order: readonly number[]) => order.reduce((sum, photo, cell) => sum + cropFraction(cellAspects[cell], photoAspects[photo]), 0) / Math.max(1, n);
  if (keepOrder || n > PERMUTATION_LIMIT || n !== photoAspects.length) return { order: identity, cost: n === photoAspects.length ? costOf(identity) : 1 };
  let best = identity;
  let bestScore = costOf(identity);
  for (const order of permutations(n)) {
    const displacement = order.reduce((sum, photo, cell) => sum + Math.abs(photo - cell), 0) / Math.max(1, n * n);
    const score = costOf(order) + displacement * 0.02;
    if (score < bestScore - 1e-9) { best = order; bestScore = score; }
  }
  return { order: best, cost: costOf(best) };
}

function itemAspects(area: AlbumArea, assets: ReadonlyMap<string, AlbumAssetV2>): number[] {
  return area.items.map((item) => effectiveAspect(item, assets.get(item.assetId)));
}

/** Template adatti a un'area (stesso tipo e numero di foto), dal migliore. */
export function matchTemplates(project: Project, spread: AlbumSpread, areaIndex: number, templates: readonly AreaTemplate[]): TemplateMatch[] {
  const area = spread.areas[areaIndex];
  if (!area || area.items.length === 0) return [];
  const target = templateTarget(spread, areaIndex);
  const geometry = areaGeometry(project, spread, areaIndex);
  const photos = itemAspects(area, assetMap(project));
  const locked = area.items.some((item) => item.locked);
  const matches: TemplateMatch[] = [];
  for (const template of templates) {
    if (template.target !== target || template.count !== area.items.length) continue;
    const cells = templateCells(template, geometry.inner, geometry.gapMm);
    if (cells.length !== photos.length) continue;
    const { order, cost } = bestAssignment(cells.map((cell) => cell.rect.w / Math.max(cell.rect.h, 0.001)), photos, locked);
    matches.push({ template, order, cost });
  }
  return matches.sort((a, b) => a.cost - b.cost);
}

/** Albero «di riserva» per una disposizione libera: una catena di foglie nell'ordine delle foto. */
function chainTree(ids: readonly string[]): LayoutNode {
  return ids.slice(1).reduce<LayoutNode>((acc, id) => split("row", 0.5, acc, leaf(id)), leaf(ids[0]));
}

/** Applica un template a un'area: foto riordinate secondo l'abbinamento, inquadrature conservate. */
export function templateArea(area: AlbumArea, template: AreaTemplate, order?: readonly number[]): AlbumArea | null {
  if (area.items.length !== template.count) return null;
  const chosen = order && order.length === area.items.length && new Set(order).size === order.length ? order : area.items.map((_, index) => index);
  const items = chosen.map((index) => area.items[index]);
  const ids = items.map((item) => item.id);
  if (template.kind === "tree") {
    const layout = template.shape ? applyShape(template.shape, ids) : null;
    return layout ? normalizeArea({ ...area, items, layout, seed: 0, free: undefined }) : null;
  }
  if (!template.frames || template.frames.length !== ids.length) return null;
  const free = Object.fromEntries(ids.map((id, index) => [id, sanitizeFrame(template.frames![index])]));
  return normalizeArea({ ...area, items, layout: chainTree(ids), seed: 0, free });
}

export function applyTemplate(project: Project, spreadId: string, areaIndex: number, template: AreaTemplate, order?: readonly number[]): Project {
  return mapSpread(project, spreadId, (spread) => {
    const area = spread.areas[areaIndex];
    if (!area || spread.done) return spread;
    const next = templateArea(area, template, order);
    return next ? replaceArea(spread, areaIndex, next) : spread;
  });
}

/** Il layout attuale di un'area diventa un template (ad albero, oppure libero se l'area lo è già). */
export function templateFromArea(project: Project, spreadId: string, areaIndex: number, name: string): AreaTemplate | null {
  const spread = project.spreads.find((candidate) => candidate.id === spreadId);
  const area = spread?.areas[areaIndex];
  if (!spread || !area?.layout || area.items.length === 0) return null;
  const base = { id: createTemplateId(), name: name.trim() || `Template ${area.items.length} foto`, target: templateTarget(spread, areaIndex), count: area.items.length, createdAt: nowIso() };
  if (hasFreeLayout(area)) return sanitizeTemplate({ ...base, kind: "free", frames: area.items.map((item) => area.free![item.id]) });
  return sanitizeTemplate({ ...base, kind: "tree", shape: shapeOfTree(area.layout) });
}

// ---------------------------------------------------------------------------
// Cornici libere dentro l'album
// ---------------------------------------------------------------------------

/** Cambia posizione, misure o rotazione della cornice di una foto in una disposizione libera. */
export function setFrame(project: Project, itemId: string, change: Partial<FreeFrame>): Project {
  const found = findItem(project, itemId);
  if (!found || !hasFreeLayout(found.area) || found.item.locked) return project;
  const old = found.area.free![itemId];
  const next = sanitizeFrame({ ...old, ...change });
  if (JSON.stringify(next) === JSON.stringify(old)) return project;
  return touch({
    ...project,
    spreads: project.spreads.map((spread) => (spread.id !== found.spread.id ? spread : replaceArea(spread, found.areaIndex, { ...found.area, free: { ...found.area.free!, [itemId]: next } }))),
  });
}

/** Porta una foto davanti a tutte le altre (o dietro) in una disposizione libera. */
export function reorderFrame(project: Project, itemId: string, where: "front" | "back"): Project {
  const found = findItem(project, itemId);
  if (!found || !hasFreeLayout(found.area)) return project;
  const levels = Object.values(found.area.free!).map((frame) => frame.z);
  const z = where === "front" ? Math.max(...levels) + 1 : Math.min(...levels) - 1;
  return setFrame(project, itemId, { z });
}

/** Foto della disposizione libera dalla più in primo piano alla più in fondo (per capire chi sta sopra). */
export function stackOrder(area: AlbumArea): string[] {
  if (!hasFreeLayout(area)) return leafIds(area.layout);
  return [...area.items].sort((a, b) => area.free![b.id].z - area.free![a.id].z).map((item) => item.id);
}

// ---------------------------------------------------------------------------
// Auto Build con i template dell'utente
// ---------------------------------------------------------------------------

/** Perdita media di ritaglio dell'area com'è ora. */
export function areaCost(project: Project, spread: AlbumSpread, areaIndex: number): number {
  const area = spread.areas[areaIndex];
  if (!area || area.items.length === 0) return 0;
  const photos = itemAspects(area, assetMap(project));
  const cells = areaGeometry(project, spread, areaIndex).cells;
  return cells.reduce((sum, cell, index) => sum + cropFraction(cell.rect.w / Math.max(cell.rect.h, 0.001), photos[index]), 0) / cells.length;
}

/**
 * Dopo l'impaginazione automatica, dove un template dell'utente si adatta (stesso tipo e numero di foto) e ritaglia quasi
 * quanto il layout calcolato (entro `tolerance`) lo si usa al posto del layout automatico.
 */
export function applyTemplatesToAlbum(project: Project, templates: readonly AreaTemplate[], tolerance = 0.1, onlySpreadIds?: ReadonlySet<string>): { project: Project; applied: number } {
  if (templates.length === 0) return { project, applied: 0 };
  let next = project;
  let applied = 0;
  for (const spread of project.spreads) {
    if (spread.done || (onlySpreadIds && !onlySpreadIds.has(spread.id))) continue;
    spread.areas.forEach((area, areaIndex) => {
      if (area.items.length === 0) return;
      const current = next.spreads.find((candidate) => candidate.id === spread.id)!;
      const [best] = matchTemplates(next, current, areaIndex, templates);
      if (!best || best.cost > areaCost(next, current, areaIndex) + tolerance) return;
      const after = applyTemplate(next, spread.id, areaIndex, best.template, best.order);
      if (after !== next) { next = after; applied += 1; }
    });
  }
  return { project: next, applied };
}
