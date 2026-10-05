import type { AlbumAssetV2, AlbumItem, AreaStyle } from "@photo-tools/shared-types";
import type { Rect } from "../engine/geometry";
import { MAX_ANGLE, MAX_SHAPE, MAX_ZOOM, MIN_SHAPE, MIN_ZOOM, clampNumber } from "./defaults";
import { itemAspect } from "./project";
import { cropForView, effectiveDpi, imageRectInSlot, type CropRect } from "../slot-geometry";

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

/** Scarto relativo sotto il quale la cella conta già come «della forma scelta». */
export const SHAPE_SNAP = 0.12;

export function placeItem(frame: Rect, item: Pick<AlbumItem, "zoom" | "cx" | "cy" | "angle"> & { shape?: number }, asset: AlbumAssetV2 | undefined, style: Pick<AreaStyle, "borderCm" | "mode" | "align">, view?: Partial<ItemView> | null, anchor?: { x: number; y: number }): Placement {
  const borderMm = Math.max(0, Math.min(style.borderCm * 10, Math.min(frame.w, frame.h) / 4));
  const content: Rect = { x: frame.x + borderMm, y: frame.y + borderMm, w: Math.max(frame.w - borderMm * 2, 0.1), h: Math.max(frame.h - borderMm * 2, 0.1) };
  const aspect = itemAspect(asset);
  const zoom = clampNumber(view?.zoom ?? item.zoom, MIN_ZOOM, MAX_ZOOM);
  const cx = clampNumber(view?.cx ?? item.cx, 0, 1);
  const cy = clampNumber(view?.cy ?? item.cy, 0, 1);
  const requestedAngle = clampAngle(view?.angle ?? item.angle);
  const rawShape = view?.shape !== undefined ? view.shape : item.shape;
  const shape = rawShape ? clampNumber(rawShape, MIN_SHAPE, MAX_SHAPE) : 0;
  // «Foto intera» vale per le foto lasciate com'erano: una foto con una forma scelta, ingrandita o raddrizzata riempie il suo spazio, come negli altri programmi di impaginazione.
  const fitted = style.mode === "fit" && !shape && zoom <= MIN_ZOOM + 1e-6 && requestedAngle === 0;
  const angle = fitted ? 0 : requestedAngle;
  const factor = style.align === "start" ? 0 : style.align === "end" ? 1 : 0.5;
  const auto = !style.align || style.align === "center";
  // Posiziona nella cella un rettangolo con le proporzioni date (la foto intera, oppure la forma scelta).
  const inside = (ratio: number): Rect => {
    const w = ratio > content.w / content.h ? content.w : content.h * ratio;
    const h = ratio > content.w / content.h ? content.w / ratio : content.h;
    return { x: content.x + (content.w - w) * (auto && anchor ? anchor.x : factor), y: content.y + (content.h - h) * (auto && anchor ? anchor.y : factor), w, h };
  };
  // Con una forma scelta la parte visibile è una finestra di quella forma dentro la cella; la foto la riempie.
  // Se la cella ha già (quasi) quella forma la foto la riempie tutta: niente sottili fasce bianche sopra e sotto.
  const view2 = shape && Math.abs(content.w / content.h / shape - 1) >= SHAPE_SNAP ? inside(shape) : content;
  const viewAspect = view2.w / view2.h;

  let image: Rect;
  let crop: CropRect;
  let appliedZoom = zoom;
  if (fitted) {
    crop = { cropLeft: 0, cropTop: 0, cropWidth: 1, cropHeight: 1 };
    image = inside(aspect);
  } else if (angle !== 0) {
    const straight = straightView(view2, aspect, zoom, cx, cy, angle);
    appliedZoom = straight.zoom;
    crop = straight.crop;
    image = straight.image;
  } else {
    crop = cropForView(aspect, viewAspect, zoom, cx, cy);
    image = imageRectInSlot(view2, crop, "fill", aspect);
  }
  const visible = fitted ? image : view2;
  const dpi = asset && asset.width > 0 && asset.height > 0
    ? effectiveDpi(isRotatedQuarter(asset) ? asset.height : asset.width, isRotatedQuarter(asset) ? asset.width : asset.height, crop, visible)
    : Infinity;
  // «Foto intera» o forma scelta: la parte visibile è la foto stessa, così il bordo le sta attorno e non attorno all'intera cella.
  return { frame, content: visible, borderMm, image, crop, dpi, zoom: appliedZoom, angle };
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
