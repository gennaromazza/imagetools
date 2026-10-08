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
