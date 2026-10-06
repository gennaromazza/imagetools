import type { AlbumSpread, SpreadOverlay } from "@photo-tools/shared-types";
import { areaOuterRects, spreadSizeMm, type Rect } from "../engine/geometry";
import { overlayBox } from "../render/design-svg";
import type { TextMeasure } from "../render/text-layout";
import { groupMembers, moveOverlayGroup, overlaysOf } from "./design";
import { areaGeometryFor, findSpread, type Project } from "./project";

/**
 * Allineamenti e calamite dei testi e delle grafiche: tutto in millimetri sullo spread, senza DOM.
 * La misura del testo arriva da fuori (`measure`) perché nel browser si misura con il carattere vero.
 */

type Sheet = Project["settings"]["sheet"];

const sheetProject = (sheet: Sheet) => ({ settings: { sheet } }) as unknown as Project;

/** Ingombro di un elemento sullo spread, con la rotazione: il più piccolo rettangolo dritto che lo contiene. */
export function overlayFrame(sheet: Sheet, overlay: SpreadOverlay, measure: TextMeasure): Rect {
  const box = overlayBox(sheetProject(sheet), overlay, measure);
  if (!box.rotation) return { x: box.x, y: box.y, w: box.w, h: box.h };
  const rad = (box.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const corners = [[-box.w / 2, -box.h / 2], [box.w / 2, -box.h / 2], [box.w / 2, box.h / 2], [-box.w / 2, box.h / 2]]
    .map(([dx, dy]) => ({ x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }));
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** Ingombro dell'elemento e dei suoi compagni di gruppo: quello che si sposta e si allinea insieme. */
export function groupFrame(sheet: Sheet, spread: { overlays?: SpreadOverlay[] }, overlayId: string, measure: TextMeasure): Rect | null {
  const frames = groupMembers(spread, overlayId).map((member) => overlayFrame(sheet, member, measure));
  if (frames.length === 0) return null;
  const left = Math.min(...frames.map((frame) => frame.x));
  const top = Math.min(...frames.map((frame) => frame.y));
  return { x: left, y: top, w: Math.max(...frames.map((frame) => frame.x + frame.w)) - left, h: Math.max(...frames.map((frame) => frame.y + frame.h)) - top };
}

export type AlignTo = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** La pagina in cui cade il centro dell'ingombro, ristretta al margine di sicurezza: il riferimento degli allineamenti. */
export function pageForFrame(sheet: Sheet, spread: Pick<AlbumSpread, "split">, frame: Rect): Rect {
  const pages = areaOuterRects(sheet, spread.split);
  const centerX = frame.x + frame.w / 2;
  const page = pages.find((candidate) => centerX >= candidate.x && centerX <= candidate.x + candidate.w) ?? pages[pages.length - 1];
  const margin = Math.max(0, sheet.marginCm * 10);
  return { x: page.x + margin, y: page.y + margin, w: Math.max(0, page.w - margin * 2), h: Math.max(0, page.h - margin * 2) };
}

/** Allinea l'elemento (e il suo gruppo) al margine o al centro della pagina in cui si trova. */
export function alignOverlayToPage(project: Project, spreadId: string, overlayId: string, where: AlignTo, measure: TextMeasure): Project {
  const found = findSpread(project, spreadId);
  if (!found) return project;
  const sheet = project.settings.sheet;
  const frame = groupFrame(sheet, found.spread, overlayId, measure);
  if (!frame) return project;
  const page = pageForFrame(sheet, found.spread, frame);
  const { width, height } = spreadSizeMm(sheet);
  let dx = 0;
  let dy = 0;
  if (where === "left") dx = page.x - frame.x;
  else if (where === "center") dx = page.x + page.w / 2 - (frame.x + frame.w / 2);
  else if (where === "right") dx = page.x + page.w - (frame.x + frame.w);
  else if (where === "top") dy = page.y - frame.y;
  else if (where === "middle") dy = page.y + page.h / 2 - (frame.y + frame.h / 2);
  else dy = page.y + page.h - (frame.y + frame.h);
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return project;
  return moveOverlayGroup(project, spreadId, overlayId, dx / width, dy / height);
}

/**
 * Nuova larghezza di un testo mantenendo ferma la sua posizione sulla pagina. Un testo ruotato gira attorno al proprio centro:
 * se cambia la larghezza (e quindi anche l'altezza, perché va a capo in modo diverso) il centro si sposta e il testo «scappa».
 * Qui si tiene fermo l'angolo in alto a sinistra, come si aspetta chi trascina la maniglia.
 */
export function resizeKeepingCorner(sheet: Sheet, overlay: SpreadOverlay, nextW: number, measure: TextMeasure): { x: number; y: number; w: number } {
  const { width, height } = spreadSizeMm(sheet);
  if (!overlay.rotation) return { x: overlay.x, y: overlay.y, w: nextW };
  const before = overlayBox(sheetProject(sheet), overlay, measure);
  const after = overlayBox(sheetProject(sheet), { ...overlay, w: nextW }, measure);
  const rad = (overlay.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const turn = (dx: number, dy: number) => ({ x: dx * cos - dy * sin, y: dx * sin + dy * cos });
  const centerBefore = { x: before.x + before.w / 2, y: before.y + before.h / 2 };
  const cornerOffset = turn(-before.w / 2, -before.h / 2);
  const corner = { x: centerBefore.x + cornerOffset.x, y: centerBefore.y + cornerOffset.y };
  const offsetAfter = turn(after.w / 2, after.h / 2);
  const centerAfter = { x: corner.x + offsetAfter.x, y: corner.y + offsetAfter.y };
  return { x: (centerAfter.x - after.w / 2) / width, y: (centerAfter.y - after.h / 2) / height, w: nextW };
}

/**
 * Cosa può attirare un elemento mentre lo trascini: i bordi e il centro dello spread, di ogni pagina e dell'area utile, la piega,
 * il margine di sicurezza, le foto e gli altri testi. Gli elementi in `exclude` (quello che sposti e il suo gruppo) non contano.
 */
export function overlaySnapTargets(sheet: Sheet, spread: AlbumSpread, exclude: ReadonlySet<string>, measure: TextMeasure): Rect[] {
  const { width, height } = spreadSizeMm(sheet);
  const margin = Math.max(0, sheet.marginCm * 10);
  const targets: Rect[] = [{ x: 0, y: 0, w: width, h: height }, { x: width / 2, y: 0, w: 0, h: height }];
  areaOuterRects(sheet, spread.split).forEach((page, index) => {
    targets.push(page);
    targets.push({ x: page.x + margin, y: page.y + margin, w: Math.max(0, page.w - margin * 2), h: Math.max(0, page.h - margin * 2) });
    const area = spread.areas[index];
    if (!area) return;
    const geometry = areaGeometryFor(sheet, spread, index);
    targets.push(geometry.inner);
    for (const cell of geometry.cells) targets.push(cell.rect);
  });
  for (const overlay of overlaysOf(spread)) if (!exclude.has(overlay.id)) targets.push(overlayFrame(sheet, overlay, measure));
  return targets;
}
