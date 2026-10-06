import type { SpreadBackground, SpreadBackgroundScope, SpreadGraphicOverlay, SpreadOverlay, SpreadTextOverlay, TextStyleSpec } from "@photo-tools/shared-types";
import { newId } from "./ids";
import { mapSpread, findSpread, type Project } from "./project";
import { spreadSizeMm } from "../engine/geometry";
import { approximateMeasure, layoutText } from "../render/text-layout";
import { TEXT_LIMITS, fontInfo, readableOn, sanitizeTextStyle, textPreset } from "./typography";

/** Testi, grafiche e sfondi a immagine degli spread: tutte le funzioni restituiscono lo stesso progetto se non cambia nulla. */

export const MAX_OVERLAYS_PER_SPREAD = 60;
export const MAX_TILE_CM = 40;
export const MIN_TILE_CM = 0.5;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);
const round = (value: number, digits = 5) => Number(value.toFixed(digits));

export const overlaysOf = (spread: { overlays?: SpreadOverlay[] }): SpreadOverlay[] => spread.overlays ?? [];
export const backgroundsOf = (spread: { backgrounds?: SpreadBackground[] }): SpreadBackground[] => spread.backgrounds ?? [];

function withOverlays<T extends { overlays?: SpreadOverlay[] }>(spread: T, overlays: SpreadOverlay[]): T {
  const { overlays: _old, ...rest } = spread;
  return (overlays.length ? { ...rest, overlays } : rest) as T;
}

function withBackgrounds<T extends { backgrounds?: SpreadBackground[] }>(spread: T, backgrounds: SpreadBackground[]): T {
  const { backgrounds: _old, ...rest } = spread;
  return (backgrounds.length ? { ...rest, backgrounds } : rest) as T;
}

const topZ = (overlays: readonly SpreadOverlay[]) => overlays.reduce((max, overlay) => Math.max(max, overlay.z), 0);

/** Frazione dello spread che deve restare visibile: un elemento non si può portare del tutto fuori pagina, dove non si riprenderebbe più. */
const KEEP_VISIBLE = 0.05;

/** Dove può stare l'angolo in alto a sinistra di un elemento largo `w` (frazioni dello spread). */
export function overlayLimits(overlay: { w: number }): { minX: number; maxX: number; minY: number; maxY: number } {
  return { minX: KEEP_VISIBLE - overlay.w, maxX: 1 - KEEP_VISIBLE, minY: -0.1, maxY: 0.97 };
}

/** Testo incollato da altrove: a capo uniformi e niente caratteri di controllo (romperebbero l'esportazione SVG/JPG). */
export function cleanText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

export function overlayById(project: Project, spreadId: string, overlayId: string): SpreadOverlay | undefined {
  const found = findSpread(project, spreadId);
  return found ? overlaysOf(found.spread).find((overlay) => overlay.id === overlayId) : undefined;
}

// ---------------------------------------------------------------------------
// Testi
// ---------------------------------------------------------------------------

export interface NewTextOptions {
  presetId?: string;
  text?: string;
  /** Sostituisce lo stile del preset (es. l'ultimo usato o uno stile personale). */
  style?: Partial<TextStyleSpec>;
  styleName?: string;
  /** Centro del testo, in frazione dello spread. */
  at?: { x: number; y: number };
  width?: number;
  /** Gli elementi con lo stesso gruppo si spostano insieme. */
  groupId?: string;
  /** Colore dello sfondo dove finisce il testo: se il colore dello stile non si leggerebbe, ne usa uno chiaro o scuro. */
  backdrop?: string;
}

/** Aggiunge un testo sopra le foto. Restituisce il progetto e l'identificativo del nuovo elemento (null se rifiutato). */
export function addTextOverlay(project: Project, spreadId: string, options: NewTextOptions = {}): { project: Project; overlayId: string | null } {
  const found = findSpread(project, spreadId);
  if (!found) return { project, overlayId: null };
  const current = overlaysOf(found.spread);
  if (current.length >= MAX_OVERLAYS_PER_SPREAD) return { project, overlayId: null };
  const preset = textPreset(options.presetId ?? "body");
  const merged = sanitizeTextStyle({ ...preset.style, ...options.style });
  const style = { ...merged, color: readableOn(merged.color, options.backdrop) };
  const width = clamp(options.width ?? preset.width, TEXT_LIMITS.width.min, TEXT_LIMITS.width.max);
  const center = options.at ?? { x: 0.5, y: 0.5 };
  const overlay: SpreadTextOverlay = {
    ...style,
    kind: "text",
    id: newId("tx"),
    x: round(clamp(center.x - width / 2, 0, 1 - width)),
    y: round(clamp(center.y, 0, 0.95)),
    w: round(width),
    rotation: 0,
    z: topZ(current) + 1,
    text: cleanText(options.text ?? preset.sample).slice(0, TEXT_LIMITS.textLength),
    ...(options.styleName ?? preset.name ? { styleName: options.styleName ?? preset.name } : {}),
    ...(options.groupId ? { groupId: options.groupId } : {}),
  };
  return { project: mapSpread(project, spreadId, (spread) => withOverlays(spread, [...current, overlay])), overlayId: overlay.id };
}

export interface TextPartInput {
  presetId: string;
  text: string;
  style?: Partial<TextStyleSpec>;
}

export interface TextPartsOptions {
  /** Larghezza della cornice, in frazione dello spread. */
  width: number;
  /** Centro orizzontale del blocco; l'ordinata è il bordo alto (o il centro, con `centerY`). */
  at?: { x: number; y: number };
  /** Con true `at.y` è il centro verticale del blocco intero: serve a metterlo a metà pagina senza conoscerne l'altezza. */
  centerY?: boolean;
  backdrop?: string;
  /** Il pezzo con questo stile è quello principale e resta selezionato. */
  mainPresetId?: string;
}

/**
 * Aggiunge più testi uno sotto l'altro, agganciati in un gruppo (si spostano insieme). Altezza di ogni pezzo stimata con una misura
 * approssimata, in eccesso, così i pezzi non si sovrappongono. Se un pezzo non entra (troppi elementi) non si aggiunge nulla.
 */
export function addTextParts(project: Project, spreadId: string, parts: readonly TextPartInput[], options: TextPartsOptions): { project: Project; overlayIds: string[]; mainId: string | null } {
  const found = findSpread(project, spreadId);
  if (!found || parts.length === 0) return { project, overlayIds: [], mainId: null };
  const { width: spreadW, height: spreadH } = spreadSizeMm(project.settings.sheet);
  const boxMm = clamp(options.width, TEXT_LIMITS.width.min, TEXT_LIMITS.width.max) * spreadW;
  const gap = 0.018;
  const measured = parts.map((part) => {
    const partPreset = textPreset(part.presetId);
    const style = sanitizeTextStyle({ ...partPreset.style, ...part.style });
    const probe = { ...style, kind: "text" as const, id: "probe", x: 0, y: 0, w: 1, rotation: 0, z: 0, text: part.text };
    const heightMm = layoutText(probe, boxMm, approximateMeasure, (id) => fontInfo(id).family).height;
    return { part, heightFraction: heightMm / spreadH };
  });
  const total = measured.reduce((sum, entry) => sum + entry.heightFraction, 0) + gap * (measured.length - 1);
  const center = options.at ?? { x: 0.5, y: 0.5 };
  let y = options.centerY ? clamp(center.y - total / 2, 0.02, Math.max(0.02, 0.96 - total)) : clamp(Math.min(center.y, 0.96 - total), 0.02, 0.9);
  let next = project;
  const groupId = newId("grp");
  const overlayIds: string[] = [];
  let mainId: string | null = null;
  for (const { part, heightFraction } of measured) {
    const made = addTextOverlay(next, spreadId, { presetId: part.presetId, text: part.text, style: part.style, styleName: textPreset(part.presetId).name, at: { x: center.x, y }, width: options.width, backdrop: options.backdrop, groupId });
    if (!made.overlayId) return { project, overlayIds: [], mainId: null };
    next = made.project;
    overlayIds.push(made.overlayId);
    if (part.presetId === options.mainPresetId) mainId = made.overlayId;
    y += heightFraction + gap;
  }
  return { project: next, overlayIds, mainId };
}

/**
 * Aggiunge uno stile con la sua composizione (titolo, riga piccola, paragrafo…) come testi separati, uno sotto l'altro.
 * Resta selezionato il pezzo principale (il titolo dello stile scelto). Gli stili senza composizione si comportano come `addTextOverlay`.
 */
export function addTextStack(project: Project, spreadId: string, options: NewTextOptions = {}): { project: Project; overlayId: string | null } {
  const preset = textPreset(options.presetId ?? "body");
  const found = findSpread(project, spreadId);
  if (!preset.stack || preset.stack.length < 2 || options.text !== undefined || options.style || !found) return addTextOverlay(project, spreadId, options);
  const made = addTextParts(project, spreadId, preset.stack, { width: options.width ?? preset.width, at: options.at, backdrop: options.backdrop, mainPresetId: preset.id });
  if (made.overlayIds.length === 0) return { project, overlayId: null };
  return { project: made.project, overlayId: made.mainId ?? made.overlayIds[made.overlayIds.length - 1] };
}

export interface NewGraphicOptions {
  mediaId: string;
  aspect: number;
  at?: { x: number; y: number };
  width?: number;
}

export function addGraphicOverlay(project: Project, spreadId: string, options: NewGraphicOptions): { project: Project; overlayId: string | null } {
  const found = findSpread(project, spreadId);
  if (!found) return { project, overlayId: null };
  const current = overlaysOf(found.spread);
  if (current.length >= MAX_OVERLAYS_PER_SPREAD || !options.mediaId) return { project, overlayId: null };
  const aspect = Number.isFinite(options.aspect) && options.aspect > 0 ? options.aspect : 1;
  const width = clamp(options.width ?? 0.18, 0.01, 1);
  const center = options.at ?? { x: 0.5, y: 0.5 };
  const overlay: SpreadGraphicOverlay = {
    kind: "graphic",
    id: newId("gr"),
    mediaId: options.mediaId,
    aspect,
    x: round(clamp(center.x - width / 2, -0.2, 1)),
    y: round(clamp(center.y - width / aspect / 2, -0.2, 1)),
    w: round(width),
    rotation: 0,
    z: topZ(current) + 1,
    opacity: 1,
  };
  return { project: mapSpread(project, spreadId, (spread) => withOverlays(spread, [...current, overlay])), overlayId: overlay.id };
}

export type OverlayPatch = Partial<Omit<SpreadTextOverlay, "kind" | "id">> & Partial<Pick<SpreadGraphicOverlay, "mediaId" | "aspect">>;

/** Cambia le proprietà di un testo o di una grafica; ogni valore viene riportato entro limiti sensati. */
export function updateOverlay(project: Project, spreadId: string, overlayId: string, patch: OverlayPatch): Project {
  const found = findSpread(project, spreadId);
  const target = found ? overlaysOf(found.spread).find((overlay) => overlay.id === overlayId) : undefined;
  if (!found || !target) return project;
  let next: SpreadOverlay;
  if (target.kind === "text") {
    const style = sanitizeTextStyle({ ...target, ...patch });
    const w = round(clamp(patch.w ?? target.w, TEXT_LIMITS.width.min, TEXT_LIMITS.width.max));
    const limits = overlayLimits({ w });
    next = {
      ...target,
      ...style,
      x: round(clamp(patch.x ?? target.x, limits.minX, limits.maxX)),
      y: round(clamp(patch.y ?? target.y, limits.minY, limits.maxY)),
      w,
      rotation: round(clamp(patch.rotation ?? target.rotation, -180, 180), 2),
      z: Math.round(clamp(patch.z ?? target.z, -1000, 1000)),
      text: cleanText(patch.text ?? target.text).slice(0, TEXT_LIMITS.textLength),
    };
    if (patch.styleName !== undefined) next = { ...next, styleName: patch.styleName };
  } else {
    const w = round(clamp(patch.w ?? target.w, 0.01, 2));
    const limits = overlayLimits({ w });
    next = {
      ...target,
      x: round(clamp(patch.x ?? target.x, limits.minX, limits.maxX)),
      y: round(clamp(patch.y ?? target.y, limits.minY, limits.maxY)),
      w,
      rotation: round(clamp(patch.rotation ?? target.rotation, -180, 180), 2),
      z: Math.round(clamp(patch.z ?? target.z, -1000, 1000)),
      opacity: round(clamp(patch.opacity ?? target.opacity, 0.05, 1), 3),
    };
  }
  if (JSON.stringify(next) === JSON.stringify(target)) return project;
  return mapSpread(project, spreadId, (spread) => withOverlays(spread, overlaysOf(spread).map((overlay) => (overlay.id === overlayId ? next : overlay))));
}

/** Un gruppo con un solo elemento non ha senso: l'ultimo rimasto torna libero. */
function dropLoneGroups(overlays: SpreadOverlay[]): SpreadOverlay[] {
  const counts = new Map<string, number>();
  for (const overlay of overlays) if (overlay.groupId) counts.set(overlay.groupId, (counts.get(overlay.groupId) ?? 0) + 1);
  return overlays.map((overlay) => {
    if (!overlay.groupId || (counts.get(overlay.groupId) ?? 0) > 1) return overlay;
    const { groupId: _alone, ...rest } = overlay;
    return rest as SpreadOverlay;
  });
}

export function removeOverlay(project: Project, spreadId: string, overlayId: string): Project {
  const found = findSpread(project, spreadId);
  if (!found || !overlaysOf(found.spread).some((overlay) => overlay.id === overlayId)) return project;
  return mapSpread(project, spreadId, (spread) => withOverlays(spread, dropLoneGroups(overlaysOf(spread).filter((overlay) => overlay.id !== overlayId))));
}

/** Elementi che si spostano insieme a questo (lui compreso). */
export function groupMembers(spread: { overlays?: SpreadOverlay[] }, overlayId: string): SpreadOverlay[] {
  const target = overlaysOf(spread).find((overlay) => overlay.id === overlayId);
  if (!target) return [];
  return target.groupId ? overlaysOf(spread).filter((overlay) => overlay.groupId === target.groupId) : [target];
}

/** Sposta un elemento e, se è in un gruppo, tutto il gruppo dello stesso scarto (frazioni dello spread). */
export function moveOverlayGroup(project: Project, spreadId: string, overlayId: string, dx: number, dy: number): Project {
  const found = findSpread(project, spreadId);
  if (!found || (!dx && !dy)) return project;
  const members = new Set(groupMembers(found.spread, overlayId).map((overlay) => overlay.id));
  if (!members.size) return project;
  // Il limite vale per il gruppo intero: se un compagno arriva al bordo tutti si fermano, così le distanze tra loro non si deformano.
  // Chi è già oltre il limite non viene risucchiato dentro: può solo muoversi verso l'interno.
  const moving = overlaysOf(found.spread).filter((overlay) => members.has(overlay.id));
  let loX = -Infinity;
  let hiX = Infinity;
  let loY = -Infinity;
  let hiY = Infinity;
  for (const overlay of moving) {
    const limits = overlayLimits(overlay);
    loX = Math.max(loX, Math.min(0, limits.minX - overlay.x));
    hiX = Math.min(hiX, Math.max(0, limits.maxX - overlay.x));
    loY = Math.max(loY, Math.min(0, limits.minY - overlay.y));
    hiY = Math.min(hiY, Math.max(0, limits.maxY - overlay.y));
  }
  const stepX = clamp(dx, loX, hiX);
  const stepY = clamp(dy, loY, hiY);
  if (!stepX && !stepY) return project;
  let next = project;
  for (const overlay of moving) next = updateOverlay(next, spreadId, overlay.id, { x: overlay.x + stepX, y: overlay.y + stepY });
  return next;
}

/** Aggancia più elementi (con Maiusc o Ctrl+clic) in un unico gruppo; chi era già in un gruppo porta con sé i suoi compagni. */
export function groupOverlays(project: Project, spreadId: string, overlayIds: readonly string[]): Project {
  const found = findSpread(project, spreadId);
  if (!found) return project;
  const all = overlaysOf(found.spread);
  const chosen = all.filter((overlay) => overlayIds.includes(overlay.id));
  if (chosen.length < 2) return project;
  const involved = new Set(chosen.flatMap((overlay) => (overlay.groupId ? all.filter((other) => other.groupId === overlay.groupId) : [overlay]).map((member) => member.id)));
  const groupId = newId("grp");
  return mapSpread(project, spreadId, (spread) => withOverlays(spread, overlaysOf(spread).map((overlay) => (involved.has(overlay.id) ? ({ ...overlay, groupId } as SpreadOverlay) : overlay))));
}

/** Stacca un elemento dal suo gruppo: da quel momento si sposta da solo. */
export function ungroupOverlay(project: Project, spreadId: string, overlayId: string): Project {
  const found = findSpread(project, spreadId);
  const target = found ? overlaysOf(found.spread).find((overlay) => overlay.id === overlayId) : undefined;
  if (!found || !target?.groupId) return project;
  return mapSpread(project, spreadId, (spread) => withOverlays(spread, dropLoneGroups(overlaysOf(spread).map((overlay) => {
    if (overlay.id !== overlayId) return overlay;
    const { groupId: _gone, ...rest } = overlay;
    return rest as SpreadOverlay;
  }))));
}

export function duplicateOverlay(project: Project, spreadId: string, overlayId: string): { project: Project; overlayId: string | null } {
  const found = findSpread(project, spreadId);
  const source = found ? overlaysOf(found.spread).find((overlay) => overlay.id === overlayId) : undefined;
  if (!found || !source || overlaysOf(found.spread).length >= MAX_OVERLAYS_PER_SPREAD) return { project, overlayId: null };
  const { groupId: _inherited, ...plain } = source;
  const copy: SpreadOverlay = { ...plain, id: newId(source.kind === "text" ? "tx" : "gr"), x: round(Math.min(overlayLimits(source).maxX, source.x + 0.02)), y: round(Math.min(overlayLimits(source).maxY, source.y + 0.03)), z: topZ(overlaysOf(found.spread)) + 1 };
  return { project: mapSpread(project, spreadId, (spread) => withOverlays(spread, [...overlaysOf(spread), copy])), overlayId: copy.id };
}

/** Porta un elemento davanti o dietro agli altri. */
export function orderOverlay(project: Project, spreadId: string, overlayId: string, where: "front" | "back"): Project {
  const found = findSpread(project, spreadId);
  const overlays = found ? overlaysOf(found.spread) : [];
  const target = overlays.find((overlay) => overlay.id === overlayId);
  if (!found || !target || overlays.length < 2) return project;
  const others = overlays.filter((overlay) => overlay.id !== overlayId);
  const z = where === "front" ? Math.max(...others.map((overlay) => overlay.z)) + 1 : Math.min(...others.map((overlay) => overlay.z)) - 1;
  if (where === "front" ? target.z > Math.max(...others.map((overlay) => overlay.z)) : target.z < Math.min(...others.map((overlay) => overlay.z))) return project;
  return updateOverlay(project, spreadId, overlayId, { z });
}

/** Elementi nell'ordine in cui si disegnano (dal livello più basso). */
export function overlaysInPaintOrder(overlays: readonly SpreadOverlay[]): SpreadOverlay[] {
  return overlays.map((overlay, index) => ({ overlay, index })).sort((a, b) => a.overlay.z - b.overlay.z || a.index - b.index).map((entry) => entry.overlay);
}

// ---------------------------------------------------------------------------
// Sfondi a immagine
// ---------------------------------------------------------------------------

export interface BackgroundChoice {
  mediaId: string;
  aspect: number;
  fit?: SpreadBackground["fit"];
  opacity?: number;
  tileCm?: number;
}

function makeBackground(scope: SpreadBackgroundScope, choice: BackgroundChoice): SpreadBackground {
  const background: SpreadBackground = {
    scope,
    mediaId: choice.mediaId,
    aspect: Number.isFinite(choice.aspect) && choice.aspect > 0 ? choice.aspect : 1,
    fit: choice.fit ?? "cover",
    opacity: round(clamp(choice.opacity ?? 1, 0.05, 1), 3),
  };
  if (background.fit === "tile") background.tileCm = round(clamp(choice.tileCm ?? 6, MIN_TILE_CM, MAX_TILE_CM), 2);
  return background;
}

/** Imposta lo sfondo di una pagina o di tutto lo spread: uno sfondo «spread» sostituisce quelli delle pagine e viceversa. */
export function setSpreadBackground(project: Project, spreadId: string, scope: SpreadBackgroundScope, choice: BackgroundChoice | null): Project {
  const found = findSpread(project, spreadId);
  if (!found) return project;
  const current = backgroundsOf(found.spread);
  const kept = current.filter((background) => background.scope !== scope && (scope === "spread" ? false : background.scope !== "spread"));
  const next = choice ? [...kept, makeBackground(scope, choice)] : kept;
  if (JSON.stringify(next) === JSON.stringify(current)) return project;
  return mapSpread(project, spreadId, (spread) => withBackgrounds(spread, next));
}

/** Cambia fit, opacità o piastrella di uno sfondo già impostato. */
export function updateSpreadBackground(project: Project, spreadId: string, scope: SpreadBackgroundScope, patch: Partial<Pick<SpreadBackground, "fit" | "opacity" | "tileCm">>): Project {
  const found = findSpread(project, spreadId);
  const current = found ? backgroundsOf(found.spread).find((background) => background.scope === scope) : undefined;
  if (!found || !current) return project;
  return setSpreadBackground(project, spreadId, scope, { ...current, ...patch });
}

/** Applica uno sfondo a tutti gli spread (o toglie gli sfondi a immagine). Gli spread finiti non vengono toccati. */
export function setAlbumBackground(project: Project, scope: SpreadBackgroundScope, choice: BackgroundChoice | null): Project {
  let next = project;
  for (const spread of project.spreads) {
    if (spread.done) continue;
    next = setSpreadBackground(next, spread.id, scope, choice);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Riferimenti ai file della libreria
// ---------------------------------------------------------------------------

/** Identificativi dei file multimediali usati da uno spread (sfondi e grafiche). */
export function mediaIdsOfSpread(spread: { backgrounds?: SpreadBackground[]; overlays?: SpreadOverlay[] }): string[] {
  const ids = new Set<string>();
  for (const background of backgroundsOf(spread)) ids.add(background.mediaId);
  for (const overlay of overlaysOf(spread)) if (overlay.kind === "graphic") ids.add(overlay.mediaId);
  return [...ids];
}

export function mediaIdsOfProject(project: Project): string[] {
  return [...new Set(project.spreads.flatMap((spread) => mediaIdsOfSpread(spread)))];
}

/** Font usati dai testi di uno spread (per caricarli e incorporarli). */
export function fontIdsOfSpread(spread: { overlays?: SpreadOverlay[] }): string[] {
  return [...new Set(overlaysOf(spread).flatMap((overlay) => (overlay.kind === "text" ? [overlay.font] : [])))];
}
