import type { TextMeasure } from "../render/text-layout";
import { layoutOf } from "./kit";
import type { Layer, PhotoLayer } from "./types";

/**
 * Quale foto sta sotto un punto della slide. Si ragiona sulla geometria dei livelli e non su ciò che il browser trova sotto il puntatore:
 * sfumature, riquadri e testi disegnati sopra una foto a tutta pagina non la nascondono più al trascinamento e allo zoom.
 */

/** Il punto, riportato nel sistema non ruotato del livello. */
function unrotate(layer: PhotoLayer, x: number, y: number): { x: number; y: number } {
  if (!layer.rotation) return { x, y };
  const cx = layer.x + layer.w / 2;
  const cy = layer.y + layer.h / 2;
  const angle = (-layer.rotation * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  return { x: cx + dx * Math.cos(angle) - dy * Math.sin(angle), y: cy + dx * Math.sin(angle) + dy * Math.cos(angle) };
}

export function photoContains(layer: PhotoLayer, x: number, y: number): boolean {
  const p = unrotate(layer, x, y);
  return p.x >= layer.x && p.x <= layer.x + layer.w && p.y >= layer.y && p.y <= layer.y + layer.h;
}

/** I livelli foto che si possono afferrare: gli sfondi sfocati restano fuori. */
export function grabbablePhotos(layers: readonly Layer[]): PhotoLayer[] {
  return layers.filter((layer): layer is PhotoLayer => layer.kind === "photo" && !layer.blur);
}

/** La foto (anche uno spazio vuoto) più in alto sotto il punto; `null` se il punto è fuori da ogni spazio foto. */
export function photoAt(layers: readonly Layer[], x: number, y: number): PhotoLayer | null {
  const photos = grabbablePhotos(layers);
  for (let index = photos.length - 1; index >= 0; index -= 1) if (photoContains(photos[index], x, y)) return photos[index];
  return null;
}

/** Il testo (campo del modello) più in alto sotto il punto, in base a un ingombro stimato dal chiamante. */
export function boxContains(box: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean {
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
}

// ---------------------------------------------------------------------------
// Elementi del modello che si possono spostare (modo «Testo/grafiche»)
// ---------------------------------------------------------------------------

export interface Box { x: number; y: number; w: number; h: number }

/** Ingombro di un livello sulla tela, compreso lo spostamento a mano; `null` se non ha un ingombro utile (sfumature, sfondi a tutta tela). */
export function boundsOf(layer: Layer, measure: TextMeasure, width: number, height: number): Box | null {
  const dx = layer.dx ?? 0;
  const dy = layer.dy ?? 0;
  let box: Box | null = null;
  switch (layer.kind) {
    case "rect": case "ellipse": box = { x: layer.x, y: layer.y, w: layer.w, h: layer.h }; break;
    case "line": box = { x: Math.min(layer.x1, layer.x2), y: Math.min(layer.y1, layer.y2), w: Math.abs(layer.x2 - layer.x1), h: Math.abs(layer.y2 - layer.y1) }; break;
    case "spread": box = { x: layer.x, y: layer.y, w: layer.w, h: layer.w / layer.aspect }; break;
    case "text": box = { x: layer.x, y: layer.y, w: layer.w, h: layoutOf(layer, measure).height }; break;
    case "path": {
      const numbers = (layer.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      if (numbers.length < 4) return null;
      const xs: number[] = [], ys: number[] = [];
      for (let index = 0; index + 1 < numbers.length; index += 2) { xs.push(numbers[index]); ys.push(numbers[index + 1]); }
      box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      break;
    }
    default: return null; // foto e sfumature non si afferrano come grafiche
  }
  // Uno sfondo a tutta tela non si sposta: coprirebbe ogni altro elemento.
  if (box.w >= width * 0.92 && box.h >= height * 0.92) return null;
  return { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
}

const GRAB = 14;

/** L'elemento (non foto) più in alto sotto il punto, con un po' di tolleranza per le linee sottili. */
export function graphicAt(layers: readonly Layer[], x: number, y: number, measure: TextMeasure, width: number, height: number): { layer: Layer; box: Box } | null {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const box = boundsOf(layers[index], measure, width, height);
    if (!box) continue;
    const padX = Math.max(0, GRAB - box.w / 2), padY = Math.max(0, GRAB - box.h / 2);
    if (x >= box.x - padX && x <= box.x + box.w + padX && y >= box.y - padY && y <= box.y + box.h + padY) return { layer: layers[index], box };
  }
  return null;
}
