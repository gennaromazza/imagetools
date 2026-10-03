import type { AlbumSpread, SpreadBackground, SpreadGraphicOverlay, SpreadOverlay, SpreadTextOverlay } from "@photo-tools/shared-types";
import { areaOuterRects, spreadSizeMm } from "../engine/geometry";
import { backgroundsOf, overlaysInPaintOrder, overlaysOf } from "../model/design";
import type { Project } from "../model/project";
import { fontInfo, fontStack } from "../model/typography";
import { layoutText, type TextMeasure } from "./text-layout";

/** Sfondi a immagine, testi e grafiche di uno spread come frammenti SVG (coordinate in mm, origine nell'angolo dello spread). */

export interface DesignContext {
  /** Immagini della libreria già caricate: identificativo → data URL. */
  media: ReadonlyMap<string, string>;
  measure: TextMeasure;
}

const n = (value: number) => Number(value.toFixed(3));
const attr = (value: string | number) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&apos;");
const safeId = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "_");
const familyOf = (fontId: string) => fontInfo(fontId).family;

export interface OverlayBox {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

/** Ingombro di un elemento in mm sullo spread (per selezionarlo e trascinarlo). */
export function overlayBox(project: Project, overlay: SpreadOverlay, measure: TextMeasure): OverlayBox {
  const { width, height } = spreadSizeMm(project.settings.sheet);
  const w = overlay.w * width;
  const h = overlay.kind === "graphic" ? w / overlay.aspect : layoutText(overlay, w, measure, familyOf).height;
  return { x: overlay.x * width, y: overlay.y * height, w, h: Math.max(h, 1), rotation: overlay.rotation };
}

function textSvg(project: Project, overlay: SpreadTextOverlay, measure: TextMeasure): string {
  const box = overlayBox(project, overlay, measure);
  const layout = layoutText(overlay, box.w, measure, familyOf);
  const common = `font-family="${attr(fontStack(overlay.font))}" font-size="${n(layout.sizeMm)}" font-weight="${overlay.weight}" font-style="${overlay.italic ? "italic" : "normal"}" fill="${attr(overlay.color)}"${layout.trackingMm ? ` letter-spacing="${n(layout.trackingMm)}"` : ""}`;
  const lines = layout.lines.filter((line) => line.text.length > 0).map((line) => {
    const justify = line.justifyTo ? ` textLength="${n(line.justifyTo)}" lengthAdjust="spacing"` : "";
    return `<text x="${n(line.x)}" y="${n(line.baseline)}" text-anchor="${line.anchor}"${justify} xml:space="preserve">${escapeText(line.text)}</text>`;
  }).join("");
  const cap = layout.dropCap
    ? `<text x="${n(layout.dropCap.x)}" y="${n(layout.dropCap.baseline)}" font-size="${n(layout.dropCap.sizeMm)}" text-anchor="start">${escapeText(layout.dropCap.char)}</text>`
    : "";
  const turn = overlay.rotation ? ` rotate(${n(overlay.rotation)} ${n(box.w / 2)} ${n(box.h / 2)})` : "";
  const opacity = overlay.opacity < 1 ? ` opacity="${n(overlay.opacity)}"` : "";
  return `<g transform="translate(${n(box.x)} ${n(box.y)})${turn}"${opacity} data-overlay-id="${attr(overlay.id)}"><g ${common}>${cap}${lines}</g></g>`;
}

const escapeText = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function graphicSvg(project: Project, overlay: SpreadGraphicOverlay, ctx: DesignContext): string {
  const url = ctx.media.get(overlay.mediaId);
  if (!url) return "";
  const box = overlayBox(project, overlay, ctx.measure);
  const turn = overlay.rotation ? ` transform="rotate(${n(overlay.rotation)} ${n(box.x + box.w / 2)} ${n(box.y + box.h / 2)})"` : "";
  const opacity = overlay.opacity < 1 ? ` opacity="${n(overlay.opacity)}"` : "";
  return `<image href="${attr(url)}" x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}" preserveAspectRatio="none"${turn}${opacity} data-overlay-id="${attr(overlay.id)}"/>`;
}

/** Testi e grafiche dal livello più basso al più alto. */
export function renderOverlaysSvg(project: Project, spread: AlbumSpread, ctx: DesignContext): string {
  return overlaysInPaintOrder(overlaysOf(spread)).map((overlay) => (overlay.kind === "text" ? textSvg(project, overlay, ctx.measure) : graphicSvg(project, overlay, ctx))).join("");
}

function backgroundRect(project: Project, spread: AlbumSpread, scope: SpreadBackground["scope"]): { x: number; y: number; w: number; h: number } {
  const { width, height } = spreadSizeMm(project.settings.sheet);
  const bleed = Math.max(0, (project.settings.sheet.bleedCm ?? 0) * 10);
  const outers = areaOuterRects(project.settings.sheet, spread.split);
  const first = outers[0];
  const left = scope === "spread" ? -bleed : scope === "left" ? -bleed : (outers[1] ?? first).x;
  const right = scope === "spread" ? width + bleed : scope === "left" ? first.x + first.w : width + bleed;
  return { x: left, y: -bleed, w: right - left, h: height + bleed * 2 };
}

/** Sfondi a immagine: stanno sopra la tinta delle aree e sotto le foto. */
export function renderBackgroundsSvg(project: Project, spread: AlbumSpread, ctx: DesignContext): string {
  return backgroundsOf(spread).map((background) => {
    const url = ctx.media.get(background.mediaId);
    if (!url) return "";
    const rect = backgroundRect(project, spread, background.scope);
    const opacity = background.opacity < 1 ? ` opacity="${n(background.opacity)}"` : "";
    if (background.fit === "tile") {
      const tile = Math.max(1, (background.tileCm ?? 6) * 10);
      const id = `bgp-${safeId(spread.id)}-${background.scope}`;
      return `<defs><pattern id="${id}" patternUnits="userSpaceOnUse" x="${n(rect.x)}" y="${n(rect.y)}" width="${n(tile)}" height="${n(tile / background.aspect)}"><image href="${attr(url)}" width="${n(tile)}" height="${n(tile / background.aspect)}" preserveAspectRatio="none"/></pattern></defs>`
        + `<rect x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.w)}" height="${n(rect.h)}" fill="url(#${id})"${opacity}/>`;
    }
    const aspect = background.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet";
    return `<image href="${attr(url)}" x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.w)}" height="${n(rect.h)}" preserveAspectRatio="${aspect}"${opacity}/>`;
  }).join("");
}
