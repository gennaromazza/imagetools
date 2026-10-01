import type { AlbumAssetV2, AlbumItem, AreaStyle } from "@photo-tools/shared-types";
import type { Rect } from "../engine/geometry";
import { MAX_ZOOM, MIN_ZOOM, clampNumber } from "./defaults";
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
}

export interface ItemView {
  zoom: number;
  cx: number;
  cy: number;
}

export function placeItem(frame: Rect, item: Pick<AlbumItem, "zoom" | "cx" | "cy">, asset: AlbumAssetV2 | undefined, style: Pick<AreaStyle, "borderCm" | "mode" | "align">, view?: Partial<ItemView> | null, anchor?: { x: number; y: number }): Placement {
  const borderMm = Math.max(0, Math.min(style.borderCm * 10, Math.min(frame.w, frame.h) / 4));
  const content: Rect = { x: frame.x + borderMm, y: frame.y + borderMm, w: Math.max(frame.w - borderMm * 2, 0.1), h: Math.max(frame.h - borderMm * 2, 0.1) };
  const aspect = itemAspect(asset);
  const contentAspect = content.w / content.h;
  const zoom = clampNumber(view?.zoom ?? item.zoom, MIN_ZOOM, MAX_ZOOM);
  const cx = clampNumber(view?.cx ?? item.cx, 0, 1);
  const cy = clampNumber(view?.cy ?? item.cy, 0, 1);

  let image: Rect;
  let crop: CropRect;
  if (style.mode === "fit") {
    crop = { cropLeft: 0, cropTop: 0, cropWidth: 1, cropHeight: 1 };
    const fitW = aspect > contentAspect ? content.w : content.h * aspect;
    const fitH = aspect > contentAspect ? content.w / aspect : content.h;
    const freeX = content.w - fitW;
    const freeY = content.h - fitH;
    const factor = style.align === "start" ? 0 : style.align === "end" ? 1 : 0.5;
    const auto = !style.align || style.align === "center";
    image = { x: content.x + freeX * (auto && anchor ? anchor.x : factor), y: content.y + freeY * (auto && anchor ? anchor.y : factor), w: fitW, h: fitH };
  } else {
    crop = cropForView(aspect, contentAspect, zoom, cx, cy);
    image = imageRectInSlot(content, crop, "fill", aspect);
  }
  const dpi = asset && asset.width > 0 && asset.height > 0
    ? effectiveDpi(isRotatedQuarter(asset) ? asset.height : asset.width, isRotatedQuarter(asset) ? asset.width : asset.height, crop, style.mode === "fit" ? image : content)
    : Infinity;
  // «Foto intera»: la parte visibile è la foto stessa, così il bordo le sta attorno e non attorno all'intera cella.
  return { frame, content: style.mode === "fit" ? image : content, borderMm, image, crop, dpi };
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
