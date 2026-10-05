import type { AlbumProjectV2, LayoutNode } from "@photo-tools/shared-types";
import { SPLIT_MODES } from "../engine/geometry";
import { leafIds, validateTree } from "../engine/tree";
import { MAX_ANGLE, MAX_ITEMS_PER_AREA, MAX_SHAPE, MAX_ZOOM, MIN_SHAPE, MIN_ZOOM, STYLE_LIMITS } from "./defaults";
import { normalizeArea, type Project } from "./project";

export const PROJECT_FORMAT = "filex-album-project";
export const PROJECT_VERSION = 2;

type Rec = Record<string, unknown>;

class Invalid extends Error {}

const fail = (message: string): never => { throw new Invalid(message); };
const record = (value: unknown, path: string): Rec => (!value || typeof value !== "object" || Array.isArray(value) ? fail(`Campo non valido: ${path}.`) : (value as Rec));
const list = (value: unknown, path: string): unknown[] => (Array.isArray(value) ? value : fail(`Elenco mancante: ${path}.`));
const text = (value: unknown, path: string, allowEmpty = false): string =>
  typeof value !== "string" || (!allowEmpty && !value.trim()) ? fail(`Testo non valido: ${path}.`) : value;
const num = (value: unknown, path: string, min: number, max = Number.POSITIVE_INFINITY): number =>
  typeof value !== "number" || !Number.isFinite(value) || value < min || value > max ? fail(`Numero non valido: ${path}.`) : value;
const oneOf = <T,>(value: unknown, options: readonly T[], path: string): T => (options.includes(value as T) ? (value as T) : fail(`Valore non supportato: ${path}.`));
const optionalNumber = (value: unknown, path: string, min: number, max?: number) => (value === undefined ? undefined : num(value, path, min, max));

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const TEXT_ALIGNS = ["left", "center", "right", "justify"] as const;

/** Sfondi a immagine, testi e grafiche di uno spread: i valori numerici fuori scala fanno rifiutare il file. */
function validateDesign(spread: Rec, path: string): void {
  const seenScopes = new Set<string>();
  if (spread.backgrounds !== undefined) {
    const backgrounds = list(spread.backgrounds, `${path}.backgrounds`);
    if (backgrounds.length > 2) fail(`${path}: troppi sfondi.`);
    for (const raw of backgrounds) {
      const background = record(raw, `${path}.backgrounds[]`);
      const scope = oneOf(background.scope, ["spread", "left", "right"] as const, `${path}.backgrounds[].scope`);
      if (seenScopes.has(scope)) fail(`${path}: sfondo duplicato (${scope}).`);
      seenScopes.add(scope);
      if (!SAFE_ID.test(text(background.mediaId, `${path}.backgrounds[].mediaId`))) fail(`Identificativo non valido: ${path}.backgrounds[].mediaId.`);
      num(background.aspect, `${path}.backgrounds[].aspect`, 0.001, 1000);
      oneOf(background.fit, ["cover", "contain", "tile"] as const, `${path}.backgrounds[].fit`);
      num(background.opacity, `${path}.backgrounds[].opacity`, 0, 1);
      if (background.tileCm !== undefined) num(background.tileCm, `${path}.backgrounds[].tileCm`, 0.1, 100);
    }
    if (seenScopes.has("spread") && seenScopes.size > 1) fail(`${path}: uno sfondo su tutto lo spread non convive con quelli delle pagine.`);
  }
  if (spread.overlays !== undefined) {
    const overlays = list(spread.overlays, `${path}.overlays`);
    if (overlays.length > 200) fail(`${path}: troppi elementi.`);
    const ids = new Set<string>();
    for (const raw of overlays) {
      const overlay = record(raw, `${path}.overlays[]`);
      const id = text(overlay.id, `${path}.overlays[].id`);
      if (ids.has(id)) fail(`Elemento duplicato: ${id}.`);
      ids.add(id);
      num(overlay.x, `${path}.overlays[].x`, -2, 3); num(overlay.y, `${path}.overlays[].y`, -2, 3);
      num(overlay.w, `${path}.overlays[].w`, 0.001, 3);
      if (overlay.groupId !== undefined && !SAFE_ID.test(text(overlay.groupId, `${path}.overlays[].groupId`))) fail(`Identificativo non valido: ${path}.overlays[].groupId.`);
      num(overlay.rotation, `${path}.overlays[].rotation`, -360, 360); num(overlay.z, `${path}.overlays[].z`, -100000, 100000);
      const kind = oneOf(overlay.kind, ["text", "graphic"] as const, `${path}.overlays[].kind`);
      if (kind === "graphic") {
        if (!SAFE_ID.test(text(overlay.mediaId, `${path}.overlays[].mediaId`))) fail(`Identificativo non valido: ${path}.overlays[].mediaId.`);
        num(overlay.aspect, `${path}.overlays[].aspect`, 0.001, 1000); num(overlay.opacity, `${path}.overlays[].opacity`, 0, 1);
      } else {
        const body = text(overlay.text, `${path}.overlays[].text`, true);
        if (body.length > 20000) fail(`${path}: testo troppo lungo.`);
        text(overlay.font, `${path}.overlays[].font`);
        num(overlay.sizePt, `${path}.overlays[].sizePt`, 1, 1000);
        oneOf(overlay.weight, [300, 400, 600, 700] as const, `${path}.overlays[].weight`);
        oneOf(overlay.italic, [true, false], `${path}.overlays[].italic`);
        if (!/^#[0-9a-fA-F]{3,8}$/.test(text(overlay.color, `${path}.overlays[].color`))) fail(`Colore non valido: ${path}.overlays[].color.`);
        oneOf(overlay.align, TEXT_ALIGNS, `${path}.overlays[].align`);
        num(overlay.lineHeight, `${path}.overlays[].lineHeight`, 0.3, 6); num(overlay.trackingEm, `${path}.overlays[].trackingEm`, -1, 3);
        oneOf(overlay.uppercase, [true, false], `${path}.overlays[].uppercase`);
        num(overlay.paragraphSpacePt, `${path}.overlays[].paragraphSpacePt`, 0, 500); num(overlay.dropCapLines, `${path}.overlays[].dropCapLines`, 0, 12);
        num(overlay.opacity, `${path}.overlays[].opacity`, 0, 1);
      }
    }
  }
}

function validateStyle(value: unknown, path: string): void {
  const style = record(value, path);
  num(style.gapCm, `${path}.gapCm`, STYLE_LIMITS.gapCm.min, STYLE_LIMITS.gapCm.max);
  num(style.paddingCm, `${path}.paddingCm`, STYLE_LIMITS.paddingCm.min, STYLE_LIMITS.paddingCm.max);
  num(style.borderCm, `${path}.borderCm`, STYLE_LIMITS.borderCm.min, STYLE_LIMITS.borderCm.max);
  text(style.borderColor, `${path}.borderColor`);
  text(style.background, `${path}.background`);
  oneOf(style.mode, ["fill", "fit"], `${path}.mode`);
  oneOf(style.align, ["start", "center", "end"], `${path}.align`);
  oneOf(style.mono, [true, false], `${path}.mono`);
}

function validateSheet(value: unknown): void {
  const sheet = record(value, "settings.sheet");
  text(sheet.presetId, "sheet.presetId");
  text(sheet.label, "sheet.label");
  num(sheet.widthCm, "sheet.widthCm", 1, 200);
  num(sheet.heightCm, "sheet.heightCm", 1, 200);
  num(sheet.dpi, "sheet.dpi", 1, 4800);
  num(sheet.marginCm, "sheet.marginCm", 0, 50);
  num(sheet.gapCm, "sheet.gapCm", 0, 50);
  optionalNumber(sheet.bleedCm, "sheet.bleedCm", 0, 20);
}

function walkTree(node: unknown, path: string, depth = 0): void {
  if (depth > 64) fail(`Layout troppo profondo: ${path}.`);
  const n = record(node, path);
  if (n.kind === "leaf") { text(n.itemId, `${path}.itemId`); return; }
  oneOf(n.kind, ["split"], `${path}.kind`);
  oneOf(n.dir, ["row", "column"], `${path}.dir`);
  num(n.ratio, `${path}.ratio`, 0.0001, 0.9999);
  walkTree(n.first, `${path}.first`, depth + 1);
  walkTree(n.second, `${path}.second`, depth + 1);
}

/** Verifica struttura e coerenza di un progetto v2; lancia un errore comprensibile se qualcosa non va. */
function validateProject(value: unknown): asserts value is AlbumProjectV2 {
  const p = record(value, "project");
  if (p.schemaVersion !== 2) fail("Versione dello schema non supportata.");
  for (const key of ["projectId", "projectName", "createdAt", "updatedAt"]) text(p[key], key);
  text(p.sourceFolderPath, "sourceFolderPath", true);
  oneOf(p.stage, ["pending", "editing", "proofing", "complete"], "stage");

  const settings = record(p.settings, "settings");
  validateSheet(settings.sheet);
  oneOf(settings.sortKey, ["capture-time", "file-name", "selector-order", "manual"], "settings.sortKey");
  validateStyle(settings.defaultStyle, "settings.defaultStyle");

  const assetIds = new Set<string>();
  for (const [index, raw] of list(p.assets, "assets").entries()) {
    const asset = record(raw, `assets[${index}]`);
    const id = text(asset.id, `assets[${index}].id`);
    if (assetIds.has(id)) fail(`Foto duplicata: ${id}.`);
    assetIds.add(id);
    text(asset.fileName, `assets[${index}].fileName`);
    text(asset.path, `assets[${index}].path`, true);
    num(asset.width, `assets[${index}].width`, 1);
    num(asset.height, `assets[${index}].height`, 1);
    num(asset.aspectRatio, `assets[${index}].aspectRatio`, 0.01, 100);
    oneOf(asset.orientation, ["horizontal", "vertical", "square"], `assets[${index}].orientation`);
    optionalNumber(asset.rating, `assets[${index}].rating`, 0, 5);
    if (asset.rotationDegrees !== undefined) oneOf(asset.rotationDegrees, [0, 90, 180, 270], `assets[${index}].rotationDegrees`);
    optionalNumber(asset.captureTimeMs, `assets[${index}].captureTimeMs`, 0);
    if (asset.albumTags !== undefined) for (const tag of list(asset.albumTags, `assets[${index}].albumTags`)) oneOf(tag, ["cover", "panorama", "main"], "albumTags");
    if (asset.labelIds !== undefined) list(asset.labelIds, `assets[${index}].labelIds`).forEach((label) => text(label, "labelIds"));
  }

  const labelIds = new Set<string>();
  for (const raw of list(p.labels, "labels")) {
    const label = record(raw, "labels[]");
    const id = text(label.id, "labels[].id");
    if (labelIds.has(id)) fail(`Etichetta duplicata: ${id}.`);
    labelIds.add(id);
    text(label.name, "labels[].name");
    oneOf(label.source, ["album", "selector-custom", "selector-color"], "labels[].source");
  }

  const chapterIds = new Set<string>();
  const assigned = new Set<string>();
  for (const raw of list(p.chapters, "chapters")) {
    const chapter = record(raw, "chapters[]");
    const id = text(chapter.id, "chapters[].id");
    if (chapterIds.has(id)) fail(`Capitolo duplicato: ${id}.`);
    chapterIds.add(id);
    text(chapter.title, "chapters[].title");
    text(chapter.color, "chapters[].color");
    for (const assetId of list(chapter.assetIds, "chapters[].assetIds")) {
      const asset = text(assetId, "chapters[].assetIds[]");
      if (!assetIds.has(asset)) fail("Un capitolo cita una foto che non esiste.");
      if (assigned.has(asset)) fail("Una foto appartiene a più capitoli.");
      assigned.add(asset);
    }
  }

  const itemIds = new Set<string>();
  const areaIds = new Set<string>();
  const spreadIds = new Set<string>();
  for (const [spreadIndex, raw] of list(p.spreads, "spreads").entries()) {
    const spread = record(raw, `spreads[${spreadIndex}]`);
    const spreadId = text(spread.id, `spreads[${spreadIndex}].id`);
    if (spreadIds.has(spreadId)) fail(`Spread duplicato: ${spreadId}.`);
    spreadIds.add(spreadId);
    const split = oneOf(spread.split, SPLIT_MODES, `spreads[${spreadIndex}].split`);
    oneOf(spread.linked, [true, false], `spreads[${spreadIndex}].linked`);
    if (spread.done !== undefined) oneOf(spread.done, [true, false], `spreads[${spreadIndex}].done`);
    validateDesign(spread, `spreads[${spreadIndex}]`);
    const areas = list(spread.areas, `spreads[${spreadIndex}].areas`);
    if (areas.length !== (split === "full" ? 1 : 2)) fail(`Lo spread ${spreadIndex + 1} ha un numero di aree incoerente con la divisione.`);
    for (const [areaIndex, rawArea] of areas.entries()) {
      const path = `spreads[${spreadIndex}].areas[${areaIndex}]`;
      const area = record(rawArea, path);
      const areaId = text(area.id, `${path}.id`);
      if (areaIds.has(areaId)) fail(`Area duplicata: ${areaId}.`);
      areaIds.add(areaId);
      validateStyle(area.style, `${path}.style`);
      num(area.seed, `${path}.seed`, 0, 5000);
      const items = list(area.items, `${path}.items`);
      if (items.length > MAX_ITEMS_PER_AREA) fail(`Troppe foto in un'area (massimo ${MAX_ITEMS_PER_AREA}).`);
      const ids: string[] = [];
      for (const rawItem of items) {
        const item = record(rawItem, `${path}.items[]`);
        const id = text(item.id, `${path}.items[].id`);
        if (itemIds.has(id)) fail(`Elemento duplicato: ${id}.`);
        itemIds.add(id);
        ids.push(id);
        if (!assetIds.has(text(item.assetId, `${path}.items[].assetId`))) fail("Un layout usa una foto che non esiste nella libreria.");
        num(item.zoom, `${path}.items[].zoom`, MIN_ZOOM, MAX_ZOOM);
        num(item.cx, `${path}.items[].cx`, 0, 1);
        num(item.cy, `${path}.items[].cy`, 0, 1);
        if (item.angle !== undefined) num(item.angle, `${path}.items[].angle`, -MAX_ANGLE, MAX_ANGLE);
        if (item.shape !== undefined) num(item.shape, `${path}.items[].shape`, MIN_SHAPE, MAX_SHAPE);
        if (item.locked !== undefined) oneOf(item.locked, [true, false], `${path}.items[].locked`);
      }
      if (area.free !== undefined) {
        const free = record(area.free, `${path}.free`);
        for (const [key, rawFrame] of Object.entries(free)) {
          if (!ids.includes(key)) fail(`${path}.free: cornice per una foto che non c'è.`);
          const frame = record(rawFrame, `${path}.free.${key}`);
          num(frame.x, `${path}.free.x`, -1, 2); num(frame.y, `${path}.free.y`, -1, 2);
          num(frame.w, `${path}.free.w`, 0.01, 3); num(frame.h, `${path}.free.h`, 0.01, 3);
          num(frame.rotation, `${path}.free.rotation`, -360, 360); num(frame.z, `${path}.free.z`, -1000, 1000);
        }
      }
      if (area.layout === null) { if (ids.length > 0) fail("Un'area con foto non ha layout."); }
      else {
        walkTree(area.layout, `${path}.layout`);
        const errors = validateTree(area.layout as LayoutNode, ids);
        if (errors.length) fail(`Layout non coerente nello spread ${spreadIndex + 1}: ${errors[0]}`);
      }
    }
  }

  for (const raw of list(p.favoriteLayouts, "favoriteLayouts")) {
    const favorite = record(raw, "favoriteLayouts[]");
    text(favorite.id, "favoriteLayouts[].id");
    const count = num(favorite.itemCount, "favoriteLayouts[].itemCount", 1, MAX_ITEMS_PER_AREA);
    walkTree(favorite.layout, "favoriteLayouts[].layout");
    if (leafIds(favorite.layout as LayoutNode).length !== count) fail("Un layout preferito ha un numero di foto incoerente.");
  }
}

/** Rende coerente l'ordine delle foto con le foglie dei layout. */
export function normalizeProject(project: Project): Project {
  let changed = false;
  const spreads = project.spreads.map((spread) => {
    const areas = spread.areas.map((area) => {
      const next = normalizeArea(area);
      if (next !== area) changed = true;
      return next;
    });
    return areas.some((area, index) => area !== spread.areas[index]) ? { ...spread, areas } : spread;
  });
  return changed ? { ...project, spreads } : project;
}

/** `media`: le immagini della libreria usate dall'album (sfondi e grafiche), incluse perché il file si apra anche altrove. */
export function serializeAlbumProject(project: Project, media?: Record<string, unknown>): string {
  const withMedia = media && Object.keys(media).length > 0;
  return JSON.stringify({ format: PROJECT_FORMAT, version: PROJECT_VERSION, project, ...(withMedia ? { media } : {}) }, null, 2);
}

/** Le immagini incluse in un file album, se ci sono (da controllare prima di usarle). */
export function readEmbeddedMedia(raw: string): unknown {
  try { return (JSON.parse(raw) as { media?: unknown }).media; } catch { return undefined; }
}

/** Legge un file progetto; un progetto del formato precedente viene rifiutato con un messaggio chiaro. */
export function parseAlbumProject(raw: string): Project {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("File progetto non valido: JSON corrotto."); }
  try {
    const envelope = record(parsed, "file");
    if (envelope.format !== PROJECT_FORMAT) fail("Questo file non è un progetto di Album Flow.");
    if (envelope.version === 1) fail("Questo progetto è stato creato con una versione precedente di Album Flow (formato 1) e non può essere aperto: il nuovo motore di impaginazione usa un formato diverso.");
    if (envelope.version !== PROJECT_VERSION) fail(`Versione del progetto non supportata (${String(envelope.version)}).`);
    validateProject(envelope.project);
    return normalizeProject(envelope.project);
  } catch (error) {
    if (error instanceof Invalid) throw new Error(error.message);
    throw error;
  }
}

/** Verifica un progetto già in memoria o letto dal salvataggio locale. Restituisce l'errore, o null se valido. */
export function projectProblem(value: unknown): string | null {
  try { validateProject(value); return null; } catch (error) { return error instanceof Invalid ? error.message : "Progetto non valido."; }
}
