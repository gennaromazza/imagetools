import type { AlbumAssetV2, AlbumItem, AreaStyle } from "@photo-tools/shared-types";
import type { Rect } from "../engine/geometry";
import { MAX_ANGLE, MAX_SHAPE, MAX_ZOOM, MIN_SHAPE, MIN_ZOOM, clampNumber } from "./defaults";
import { itemAspect } from "./project";
import { cropForView, imageRectInSlot, type CropRect } from "../slot-geometry";

/** Come una foto sta dentro la sua cella: cornice, area visibile e posizione dell'immagine intera (millimetri). */
export interface Placement {
  /** La cella assegnata dal layout. */
  frame: Rect;
  /** La cella meno il bordo: qui si vede la foto. */
  content: Rect;
  borderMm: number;
  /** Rettangolo dell'immagine intera, che con "fill" sporge e va ritagliata dal contenuto. */
  image: Rect;
  crop: CropRect;
  /** Risoluzione effettiva (dpi) della foto in questa cella. */
  dpi: number;
  /** Zoom realmente applicato (con la foto raddrizzata può superare quello salvato per non lasciare angoli vuoti). */
  zoom: number;
  /** Raddrizzamento in gradi: l'immagine ruota attorno al centro di `content`. */
  angle: number;
}

export interface ItemView {
  zoom: number;
  cx: number;
  cy: number;
  angle: number;
  /** Rapporto larghezza/altezza scelto per la foto; `null` toglie la forma e la foto torna a seguire la cella. */
  shape: number | null;
}

export const clampAngle = (angle: number | undefined): number => {
  const value = clampNumber(Number.isFinite(angle) ? (angle as number) : 0, -MAX_ANGLE, MAX_ANGLE);
  return Math.abs(value) < 0.005 ? 0 : Number(value.toFixed(2));
};

/**
 * Raddrizzamento: l'area visibile (cella) ruotata di -angle deve restare dentro l'immagine.
 * Restituisce lo zoom minimo, l'ingombro (frazione dell'immagine) dell'area visibile ruotata e il rettangolo dell'immagine.
 */
function straightView(content: Rect, aspect: number, zoom: number, cx: number, cy: number, angle: number): { zoom: number; crop: CropRect; image: Rect } {
  const base = cropForView(aspect, content.w / content.h, 1, 0.5, 0.5);
  const w1 = content.w / base.cropWidth;
  const h1 = content.h / base.cropHeight;
  const rad = (Math.abs(angle) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const boxW = content.w * cos + content.h * sin;
  const boxH = content.w * sin + content.h * cos;
  const z = Math.max(zoom, boxW / w1, boxH / h1);
  const W = w1 * z;
  const H = h1 * z;
  const cropWidth = Math.min(1, boxW / W);
  const cropHeight = Math.min(1, boxH / H);
  const crop: CropRect = {
    cropLeft: clampNumber(cx - cropWidth / 2, 0, 1 - cropWidth),
    cropTop: clampNumber(cy - cropHeight / 2, 0, 1 - cropHeight),
    cropWidth,
    cropHeight,
  };
  const centerX = crop.cropLeft + cropWidth / 2;
  const centerY = crop.cropTop + cropHeight / 2;
  return { zoom: z, crop, image: { x: content.x + content.w / 2 - centerX * W, y: content.y + content.h / 2 - centerY * H, w: W, h: H } };
}

/** Scarto relativo (0,1%, cioè gli arrotondamenti del calcolo) sotto il quale la cella conta già come «della forma scelta»: oltre, la foto è una finestra esatta di quella forma. */
export const SHAPE_SNAP = 0.001;

/**
 * Quanto di un rettangolo (percentuali delle sue misure) esce dai limiti del contenitore, per tagliare la parte fuori: una foto libera più grande
 * del foglio si vede solo dentro il foglio. Null se sta tutta dentro.
 */
export function overflowInset(bounds: Rect, rect: Rect): { top: number; right: number; bottom: number; left: number } | null {
  if (rect.w <= 0 || rect.h <= 0) return null;
  const top = (Math.max(0, bounds.y - rect.y) / rect.h) * 100;
  const right = (Math.max(0, rect.x + rect.w - (bounds.x + bounds.w)) / rect.w) * 100;
  const bottom = (Math.max(0, rect.y + rect.h - (bounds.y + bounds.h)) / rect.h) * 100;
  const left = (Math.max(0, bounds.x - rect.x) / rect.w) * 100;
  return top || right || bottom || left ? { top, right, bottom, left } : null;
}

/** Lato più corto (px sullo schermo) sotto il quale i comandi di una foto diventano un solo pulsante «⋯» (minuscola) o due colonne (piccola). */
export const TOOLBAR_TINY_PX = 150;
export const TOOLBAR_COMPACT_PX = 260;

/** Come si mostrano i comandi della foto selezionata in base alla sua grandezza sullo schermo: quattro barre, due colonne o un solo «⋯». */
export function toolbarModeFor(minSidePx: number): "full" | "compact" | "tiny" {
  if (minSidePx < TOOLBAR_TINY_PX) return "tiny";
  return minSidePx < TOOLBAR_COMPACT_PX ? "compact" : "full";
}

/** Colore del bordo di una foto: il suo, se l'ha, altrimenti quello dell'area. */
export const itemBorderColor = (item: Pick<AlbumItem, "borderColor">, style: Pick<AreaStyle, "borderColor">): string => item.borderColor ?? style.borderColor;

export function placeItem(frame: Rect, item: Pick<AlbumItem, "zoom" | "cx" | "cy" | "angle"> & { shape?: number; borderCm?: number }, asset: AlbumAssetV2 | undefined, style: Pick<AreaStyle, "borderCm" | "mode" | "align">, view?: Partial<ItemView> | null, anchor?: { x: number; y: number }): Placement {
  const borderMm = Math.max(0, Math.min((item.borderCm ?? style.borderCm) * 10, Math.min(frame.w, frame.h) / 4));
  const content: Rect = { x: frame.x + borderMm, y: frame.y + borderMm, w: Math.max(frame.w - borderMm * 2, 0.1), h: Math.max(frame.h - borderMm * 2, 0.1) };
  const aspect = itemAspect(asset);
  const zoom = clampNumber(view?.zoom ?? item.zoom, MIN_ZOOM, MAX_ZOOM);
  const cx = clampNumber(view?.cx ?? item.cx, 0, 1);
  const cy = clampNumber(view?.cy ?? item.cy, 0, 1);
  const requestedAngle = clampAngle(view?.angle ?? item.angle);
  const rawShape = view?.shape !== undefined ? view.shape : item.shape;
  const shape = rawShape ? clampNumber(rawShape, MIN_SHAPE, MAX_SHAPE) : 0;
  // «Foto intera» vale per le foto lasciate com'erano: una foto con una forma scelta, ingrandita o raddrizzata diventa una finestra
  // ritagliata (zoom e raddrizzamento lavorano dentro la finestra), come negli altri programmi di impaginazione.
  const fitted = style.mode === "fit" && !shape && zoom <= MIN_ZOOM + 1e-6 && requestedAngle === 0;
  const angle = fitted ? 0 : requestedAngle;
  const factor = style.align === "start" ? 0 : style.align === "end" ? 1 : 0.5;
  // Posiziona nella cella un rettangolo con le proporzioni date (la foto intera, oppure la forma scelta).
  const inside = (ratio: number): Rect => {
    const w = ratio > content.w / content.h ? content.w : content.h * ratio;
    const h = ratio > content.w / content.h ? content.w / ratio : content.h;
    return { x: content.x + (content.w - w) * (anchor ? anchor.x : factor), y: content.y + (content.h - h) * (anchor ? anchor.y : factor), w, h };
  };
  // La finestra: la parte della cella in cui si vede la foto (la foto la riempie).
  // - forma scelta: una finestra di quella forma; se la cella ha già (quasi) quella forma la foto riempie tutta la cella (niente fasce bianche sottili);
  // - «foto intera»: il rettangolo della foto intera, uguale con o senza zoom, così ingrandire non fa saltare la foto a riempire la cella;
  // - «riempi»: tutta la cella.
  const view2 = shape
    ? (Math.abs(content.w / content.h / shape - 1) >= SHAPE_SNAP ? inside(shape) : content)
    : style.mode === "fit" ? inside(aspect) : content;
  const viewAspect = view2.w / view2.h;

  let image: Rect;
  let crop: CropRect;
  let appliedZoom = zoom;
  if (fitted) {
    crop = { cropLeft: 0, cropTop: 0, cropWidth: 1, cropHeight: 1 };
    image = view2;
  } else if (angle !== 0) {
    const straight = straightView(view2, aspect, zoom, cx, cy, angle);
    appliedZoom = straight.zoom;
    crop = straight.crop;
    image = straight.image;
  } else {
    crop = cropForView(aspect, viewAspect, zoom, cx, cy);
    image = imageRectInSlot(view2, crop, "fill", aspect);
  }
  // Risoluzione vera: pixel dell'originale per pollice dell'immagine così com'è disposta (vale anche con la foto raddrizzata e ingrandita).
  const widthPx = asset && asset.width > 0 && asset.height > 0 ? (isRotatedQuarter(asset) ? asset.height : asset.width) : 0;
  const dpi = widthPx > 0 && image.w > 0 ? widthPx / (image.w / 25.4) : Infinity;
  // La parte visibile è la finestra: il bordo le sta attorno e non attorno all'intera cella.
  return { frame, content: view2, borderMm, image, crop, dpi, zoom: appliedZoom, angle };
}

/**
 * Angolo di raddrizzamento che rende orizzontale (o verticale, se la linea è più verticale che orizzontale) una linea tracciata
 * sullo schermo sopra la foto, per esempio lungo l'orizzonte. `start` e `end` sono punti dello schermo (y verso il basso);
 * `currentAngle` è il raddrizzamento già applicato, perché la linea è disegnata sulla foto così com'è adesso.
 * Restituisce null se i due punti coincidono.
 */
export function angleFromLine(start: { x: number; y: number }, end: { x: number; y: number }, currentAngle: number): number | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 1e-9) return null;
  const screen = (Math.atan2(dy, dx) * 180) / Math.PI;
  // scarto dall'asse più vicino (orizzontale o verticale), in gradi tra -45 e 45; tracciare la linea da destra a sinistra non cambia nulla
  const off = screen - 90 * Math.round(screen / 90);
  return clampAngle(currentAngle - off);
}

/** Passo dello zoom con la rotella. */
export const WHEEL_ZOOM_STEP = 1.1;

/**
 * Zoom richiesto dopo uno scatto di rotella. Ingrandendo si parte da ciò che si vede (con la foto raddrizzata lo zoom applicato
 * può superare quello salvato per coprire gli angoli); riducendo si parte dallo zoom salvato, così tornando a 0° ricompare
 * l'inquadratura di prima e lo zoom salvato non si gonfia con il raddrizzamento.
 */
export function nextWheelZoom(storedZoom: number, appliedZoom: number, zoomIn: boolean, notches = 1): number {
  const base = zoomIn ? Math.max(storedZoom, appliedZoom) : storedZoom;
  const step = WHEEL_ZOOM_STEP ** clampNumber(notches, 0.05, 1);
  return clampNumber(base * (zoomIn ? step : 1 / step), MIN_ZOOM, MAX_ZOOM);
}

/**
 * Quanto vale un evento della rotella in «scatti»: un classico scatto del mouse (spostamento di 100) vale 1, un touchpad o un
 * mouse a scorrimento fluido, che mandano molti eventi piccoli, valgono una frazione, così lo zoom per scatto resta lo stesso.
 */
export function wheelNotches(delta: number): number {
  const magnitude = Math.abs(delta);
  if (!Number.isFinite(magnitude) || magnitude === 0) return 1;
  return clampNumber(magnitude / 100, 0.05, 1);
}

function isRotatedQuarter(asset: AlbumAssetV2): boolean {
  return asset.rotationDegrees === 90 || asset.rotationDegrees === 270;
}

/** Stile CSS (percentuali relative alla cella) per posizionare e ruotare l'immagine nel suo contenitore. */
export function imageBox(container: Rect, image: Rect, rotation: number | undefined): { left: number; top: number; width: number; height: number; rotate: number } {
  const turn = ((Math.round((rotation ?? 0) / 90) * 90) % 360 + 360) % 360;
  const cx = ((image.x + image.w / 2 - container.x) / container.w) * 100;
  const cy = ((image.y + image.h / 2 - container.y) / container.h) * 100;
  const quarter = turn === 90 || turn === 270;
  const w = ((quarter ? image.h : image.w) / container.w) * 100;
  const h = ((quarter ? image.w : image.h) / container.h) * 100;
  return { left: cx - w / 2, top: cy - h / 2, width: w, height: h, rotate: turn };
}

/** Misura di una foto sulla pagina (cm, la parte visibile) e giudizio sulla risoluzione per la stampa. */
export function describeSize(placement: Pick<Placement, "content" | "dpi">): { widthCm: number; heightCm: number; dpi: number; level: "ok" | "warn" | "bad" } {
  const dpi = Number.isFinite(placement.dpi) ? placement.dpi : 0;
  return {
    widthCm: Number((placement.content.w / 10).toFixed(1)),
    heightCm: Number((placement.content.h / 10).toFixed(1)),
    dpi: Math.round(dpi),
    level: dpi >= 240 ? "ok" : dpi >= 150 ? "warn" : "bad",
  };
}
