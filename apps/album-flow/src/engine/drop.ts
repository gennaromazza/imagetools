import { pointInRect, rectCenter, type Divider, type LeafCell, type Rect } from "./geometry";
import type { InsertSide } from "./tree";

/** Dove cade una foto trascinata sullo spread e cosa deve succedere (vedi AF-002, sezione Gesti). */
export type DropZone = "center" | InsertSide;

export interface DropTarget {
  areaIndex: number;
  /** Foto bersaglio; null se l'area è vuota o il punto è fuori da ogni cella. */
  itemId: string | null;
  /** "center" sostituisce/scambia, un lato inserisce accanto, "area" aggiunge in un'area vuota. */
  zone: DropZone | "area";
  /**
   * Se presente, la foto si infila accanto a un intero ramo del layout: "" = lungo tutto il bordo dell'area (nuova colonna o riga),
   * altrimenti il percorso del nodo (rilascio tra due foto o gruppi).
   */
  node?: string;
  /** Zona da evidenziare per i rilasci su un ramo (mm nello spread). */
  highlight?: Rect;
}

export interface DropArea {
  rect: Rect;
  cells: readonly LeafCell[];
  dividers?: readonly Divider[];
  /** Disposizione libera (foto sovrapposte): si può solo sostituire o scambiare la foto sotto il puntatore. */
  free?: boolean;
}

/** Quota del lato di una cella (per lato) che vale come bordo di inserimento. */
export const EDGE_FRACTION = 0.28;

function zoneInCell(rect: Rect, x: number, y: number): DropZone {
  const u = (x - rect.x) / Math.max(rect.w, 0.001);
  const v = (y - rect.y) / Math.max(rect.h, 0.001);
  const dx = Math.min(u, 1 - u);
  const dy = Math.min(v, 1 - v);
  if (Math.min(dx, dy) >= EDGE_FRACTION) return "center";
  // Con celle molto allungate conta la distanza relativa, così si può sempre scegliere il lato lungo.
  if (dx <= dy) return u < 0.5 ? "left" : "right";
  return v < 0.5 ? "top" : "bottom";
}

/** Fascia lungo il bordo dell'area (quota della dimensione, con un massimo in mm) dove il rilascio vale per tutta la riga o colonna. */
const OUTER_BAND = 0.07;
const OUTER_BAND_MAX_MM = 22;

/** Rilasci «intelligenti»: sul bordo dell'area (nuova colonna o riga intera) e tra due foto (si infila in mezzo al gruppo). */
function smartTarget(area: DropArea, areaIndex: number, x: number, y: number): DropTarget | null {
  const r = area.rect;
  const bandX = Math.min(r.w * OUTER_BAND, OUTER_BAND_MAX_MM);
  const bandY = Math.min(r.h * OUTER_BAND, OUTER_BAND_MAX_MM);
  const edges: Array<[InsertSide, number, number]> = [["left", x - r.x, bandX], ["right", r.x + r.w - x, bandX], ["top", y - r.y, bandY], ["bottom", r.y + r.h - y, bandY]];
  const hit = edges.filter(([, distance, band]) => distance < band).sort((a, b) => a[1] / a[2] - b[1] / b[2])[0];
  if (hit) {
    const side = hit[0];
    const highlight: Rect = side === "left" ? { x: r.x, y: r.y, w: r.w * 0.22, h: r.h } : side === "right" ? { x: r.x + r.w * 0.78, y: r.y, w: r.w * 0.22, h: r.h } : side === "top" ? { x: r.x, y: r.y, w: r.w, h: r.h * 0.22 } : { x: r.x, y: r.y + r.h * 0.78, w: r.w, h: r.h * 0.22 };
    return { areaIndex, itemId: null, zone: side, node: "", highlight };
  }
  // Tra due foto: sullo spazio che le separa (con un po' di tolleranza).
  let best: { divider: Divider; distance: number } | null = null;
  for (const divider of area.dividers ?? []) {
    const line = divider.line;
    const tolerance = 5;
    const inside = divider.dir === "row"
      ? Math.abs(x - (line.x + line.w / 2)) <= line.w / 2 + tolerance && y >= divider.nodeRect.y && y <= divider.nodeRect.y + divider.nodeRect.h
      : Math.abs(y - (line.y + line.h / 2)) <= line.h / 2 + tolerance && x >= divider.nodeRect.x && x <= divider.nodeRect.x + divider.nodeRect.w;
    if (!inside) continue;
    const distance = divider.dir === "row" ? Math.abs(x - (line.x + line.w / 2)) : Math.abs(y - (line.y + line.h / 2));
    if (!best || distance < best.distance) best = { divider, distance };
  }
  if (!best) return null;
  const { divider } = best;
  const pad = 6;
  const highlight: Rect = divider.dir === "row"
    ? { x: divider.line.x + divider.line.w / 2 - pad, y: divider.nodeRect.y, w: pad * 2, h: divider.nodeRect.h }
    : { x: divider.nodeRect.x, y: divider.line.y + divider.line.h / 2 - pad, w: divider.nodeRect.w, h: pad * 2 };
  // La nuova foto va davanti al secondo ramo: cioè proprio tra i due.
  return { areaIndex, itemId: null, zone: divider.dir === "row" ? "left" : "top", node: `${divider.path}1`, highlight };
}

/** Risolve il punto (mm nello spread) nel bersaglio del rilascio. Restituisce null fuori da ogni area. */
export function resolveDropTarget(areas: readonly DropArea[], x: number, y: number): DropTarget | null {
  for (let areaIndex = 0; areaIndex < areas.length; areaIndex += 1) {
    const area = areas[areaIndex];
    if (!pointInRect(x, y, area.rect)) continue;
    if (area.cells.length === 0) return { areaIndex, itemId: null, zone: "area" };
    if (area.free) {
      const top = area.cells.filter((cell) => pointInRect(x, y, cell.rect)).sort((a, b) => (b.z ?? 0) - (a.z ?? 0))[0];
      // Sopra una foto la si sostituisce; su uno spazio vuoto della pagina la foto nuova si aggiunge senza spostare le altre.
      return top ? { areaIndex, itemId: top.itemId, zone: "center" } : { areaIndex, itemId: null, zone: "area" };
    }
    if (area.cells.length >= 2 && area.dividers) {
      const smart = smartTarget(area, areaIndex, x, y);
      if (smart) return smart;
    }
    const inside = area.cells.find((cell) => pointInRect(x, y, cell.rect));
    if (inside) return { areaIndex, itemId: inside.itemId, zone: zoneInCell(inside.rect, x, y) };
    // Nello spazio tra le foto o nel margine: la cella più vicina, inserendo dal lato del punto.
    let nearest = area.cells[0];
    let nearestDistance = Infinity;
    for (const cell of area.cells) {
      const c = rectCenter(cell.rect);
      const distance = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (distance < nearestDistance) { nearest = cell; nearestDistance = distance; }
    }
    const c = rectCenter(nearest.rect);
    const ox = (x - c.x) / Math.max(nearest.rect.w, 0.001);
    const oy = (y - c.y) / Math.max(nearest.rect.h, 0.001);
    const side: InsertSide = Math.abs(ox) >= Math.abs(oy) ? (ox < 0 ? "left" : "right") : oy < 0 ? "top" : "bottom";
    return { areaIndex, itemId: nearest.itemId, zone: side };
  }
  return null;
}

/** Rettangolo da evidenziare per un bersaglio: mezza cella dal lato di inserimento, tutta la cella per il centro. */
export function dropHighlight(target: DropTarget, cell: Rect | null, area: Rect): Rect {
  if (target.highlight) return target.highlight;
  if (target.zone === "area" || !cell) return area;
  if (target.zone === "center") return cell;
  const half = { w: cell.w / 2, h: cell.h / 2 };
  switch (target.zone) {
    case "left": return { x: cell.x, y: cell.y, w: half.w, h: cell.h };
    case "right": return { x: cell.x + half.w, y: cell.y, w: half.w, h: cell.h };
    case "top": return { x: cell.x, y: cell.y, w: cell.w, h: half.h };
    default: return { x: cell.x, y: cell.y + half.h, w: cell.w, h: half.h };
  }
}
