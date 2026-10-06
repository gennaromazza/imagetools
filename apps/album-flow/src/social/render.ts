import { fontStack } from "../model/typography";
import { buildSlide, type BuildEnv } from "./build";
import { coverFit, layoutOf, round } from "./kit";
import { formatOf, type Carousel, type EllipseLayer, type GradientLayer, type Layer, type LineLayer, type PathLayer, type PhotoLayer, type PhotoMask, type RectLayer, type SpreadLayer, type TextLayer } from "./types";

/** Immagini pronte da incorporare (data URL o indirizzo locale) e come ruotarle. */
export interface RenderMedia {
  photos: ReadonlyMap<string, { url: string; rotation?: 0 | 90 | 180 | 270 }>;
  /** Pagine dell'album già disegnate (data URL di un SVG). */
  spreads: ReadonlyMap<string, string>;
  /** Regole @font-face per un SVG autonomo (esportazione). */
  fontCss?: string;
}

export interface RenderOptions {
  /** Prefisso per gli identificativi interni: deve essere unico se più slide stanno nella stessa pagina. */
  idPrefix: string;
  /** Mostra gli spazi foto vuoti come segnaposto; in esportazione restano grigi. */
  placeholders?: boolean;
}

const n = (value: number) => String(round(value));
const attr = (value: string | number) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&apos;");
const text = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const safe = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "_");

/** Tracciato di una forma di ritaglio, allargata di `grow` pixel da ogni lato (serve a bordo e ombra). */
export function maskPath(mask: PhotoMask, x: number, y: number, w: number, h: number, radius = 0, grow = 0): string {
  const gx = x - grow, gy = y - grow, gw = w + grow * 2, gh = h + grow * 2;
  if (mask === "ellipse") {
    const rx = gw / 2, ry = gh / 2;
    return `M${n(gx)} ${n(gy + ry)}a${n(rx)} ${n(ry)} 0 1 0 ${n(gw)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-gw)} 0Z`;
  }
  if (mask === "arch") {
    const r = gw / 2;
    return `M${n(gx)} ${n(gy + gh)}V${n(gy + r)}a${n(r)} ${n(r)} 0 0 1 ${n(gw)} 0V${n(gy + gh)}Z`;
  }
  const r = Math.min(Math.max(0, radius + (radius > 0 ? grow : 0)), gw / 2, gh / 2);
  if (r <= 0) return `M${n(gx)} ${n(gy)}H${n(gx + gw)}V${n(gy + gh)}H${n(gx)}Z`;
  return `M${n(gx + r)} ${n(gy)}H${n(gx + gw - r)}a${n(r)} ${n(r)} 0 0 1 ${n(r)} ${n(r)}V${n(gy + gh - r)}a${n(r)} ${n(r)} 0 0 1 ${n(-r)} ${n(r)}H${n(gx + r)}a${n(r)} ${n(r)} 0 0 1 ${n(-r)} ${n(-r)}V${n(gy + r)}a${n(r)} ${n(r)} 0 0 1 ${n(r)} ${n(-r)}Z`;
}

interface Box { x: number; y: number; w: number; h: number }

/** Racchiude un elemento con rotazione e trasparenza proprie, attorno al suo centro. */
function wrap(layer: Layer, box: Box, inner: string): string {
  const turn = layer.rotation ? ` transform="rotate(${n(layer.rotation)} ${n(box.x + box.w / 2)} ${n(box.y + box.h / 2)})"` : "";
  const opacity = layer.opacity !== undefined && layer.opacity < 1 ? ` opacity="${n(layer.opacity)}"` : "";
  return turn || opacity ? `<g${turn}${opacity}>${inner}</g>` : inner;
}

class Renderer {
  private defs: string[] = [];

  constructor(private readonly env: BuildEnv, private readonly media: RenderMedia, private readonly options: RenderOptions) {}

  private id(layer: Layer, kind: string): string { return `${safe(this.options.idPrefix)}-${kind}-${safe(layer.id)}`; }

  drawAll(layers: readonly Layer[]): { body: string; defs: string } {
    const body = layers.map((layer) => this.draw(layer)).join("");
    return { body, defs: this.defs.join("") };
  }

  private draw(layer: Layer): string {
    switch (layer.kind) {
      case "rect": return this.rect(layer);
      case "ellipse": return this.ellipse(layer);
      case "line": return this.line(layer);
      case "path": return this.path(layer);
      case "gradient": return this.gradient(layer);
      case "photo": return this.photo(layer);
      case "text": return this.textLayer(layer);
      case "spread": return this.spread(layer);
    }
  }

  private paint(layer: { fill?: string; stroke?: string; strokeW?: number }): string {
    const fill = layer.fill ? `fill="${attr(layer.fill)}"` : 'fill="none"';
    const stroke = layer.stroke ? ` stroke="${attr(layer.stroke)}" stroke-width="${n(layer.strokeW ?? 1)}"` : "";
    return `${fill}${stroke}`;
  }

  private rect(layer: RectLayer): string {
    const radius = layer.radius ? ` rx="${n(layer.radius)}"` : "";
    return wrap(layer, layer, `<rect x="${n(layer.x)}" y="${n(layer.y)}" width="${n(layer.w)}" height="${n(layer.h)}"${radius} ${this.paint(layer)}/>`);
  }

  private ellipse(layer: EllipseLayer): string {
    return wrap(layer, layer, `<ellipse cx="${n(layer.x + layer.w / 2)}" cy="${n(layer.y + layer.h / 2)}" rx="${n(layer.w / 2)}" ry="${n(layer.h / 2)}" ${this.paint(layer)}/>`);
  }

  private line(layer: LineLayer): string {
    const box = { x: Math.min(layer.x1, layer.x2), y: Math.min(layer.y1, layer.y2), w: Math.abs(layer.x2 - layer.x1), h: Math.abs(layer.y2 - layer.y1) };
    const dash = layer.dash ? ` stroke-dasharray="${attr(layer.dash)}"` : "";
    return wrap(layer, box, `<line x1="${n(layer.x1)}" y1="${n(layer.y1)}" x2="${n(layer.x2)}" y2="${n(layer.y2)}" stroke="${attr(layer.stroke)}" stroke-width="${n(layer.strokeW)}" stroke-linecap="round"${dash}/>`);
  }

  private path(layer: PathLayer): string {
    return wrap(layer, { x: 0, y: 0, w: 0, h: 0 }, `<path d="${attr(layer.d)}" ${this.paint(layer)} stroke-linejoin="round" stroke-linecap="round"/>`);
  }

  private gradient(layer: GradientLayer): string {
    const id = this.id(layer, "g");
    const vector = { top: ["0", "0", "0", "1"], bottom: ["0", "1", "0", "0"], left: ["0", "0", "1", "0"], right: ["1", "0", "0", "0"] }[layer.direction];
    this.defs.push(`<linearGradient id="${id}" x1="${vector[0]}" y1="${vector[1]}" x2="${vector[2]}" y2="${vector[3]}"><stop offset="0" stop-color="${attr(layer.from)}" stop-opacity="${n(layer.fromOpacity)}"/><stop offset="1" stop-color="${attr(layer.to)}" stop-opacity="${n(layer.toOpacity)}"/></linearGradient>`);
    return wrap(layer, layer, `<rect x="${n(layer.x)}" y="${n(layer.y)}" width="${n(layer.w)}" height="${n(layer.h)}" fill="url(#${id})"/>`);
  }

  private shadow(layer: Layer, d: string): string {
    const id = this.id(layer, "sh");
    this.defs.push(`<filter id="${id}" x="-30%" y="-30%" width="160%" height="170%"><feGaussianBlur stdDeviation="16"/></filter>`);
    return `<path d="${attr(d)}" fill="#000000" opacity="0.4" filter="url(#${id})" transform="translate(0 18)"/>`;
  }

  private photo(layer: PhotoLayer): string {
    const shape = maskPath(layer.mask, layer.x, layer.y, layer.w, layer.h, layer.radius ?? 0);
    const border = layer.border && layer.border.w > 0 ? maskPath(layer.mask, layer.x, layer.y, layer.w, layer.h, layer.radius ?? 0, layer.border.w) : null;
    const outer = border ?? shape;
    const parts: string[] = [];
    if (layer.shadow) parts.push(this.shadow(layer, outer));
    if (border) parts.push(`<path d="${attr(border)}" fill="${attr(layer.border!.color)}"/>`);
    const ref = layer.assetId ? this.env.photos.get(layer.assetId) : undefined;
    const media = layer.assetId ? this.media.photos.get(layer.assetId) : undefined;
    if (!ref || !media) {
      parts.push(`<path d="${attr(shape)}" fill="#8f897d" fill-opacity="0.45" data-empty-slot="${layer.slot}"/>`);
      if (this.options.placeholders && layer.w > 120 && layer.h > 90) {
        parts.push(`<text x="${n(layer.x + layer.w / 2)}" y="${n(layer.y + layer.h / 2)}" text-anchor="middle" font-family="sans-serif" font-size="${n(Math.min(30, layer.w / 7))}" fill="#ffffff" fill-opacity="0.85">Aggiungi una foto</text>`);
      }
      return wrap(layer, layer, parts.join(""));
    }
    const fit = coverFit(layer, ref.aspect, layer.zoom, layer.cx, layer.cy);
    const rotation = media.rotation ?? 0;
    const quarter = rotation === 90 || rotation === 270;
    const cx = fit.x + fit.w / 2;
    const cy = fit.y + fit.h / 2;
    const elementW = quarter ? fit.h : fit.w;
    const elementH = quarter ? fit.w : fit.h;
    const turn = rotation ? ` transform="rotate(${rotation} ${n(cx)} ${n(cy)})"` : "";
    const filters: string[] = [];
    if (layer.mono) filters.push('<feColorMatrix type="saturate" values="0"/>');
    if (layer.blur && layer.blur > 0) filters.push(`<feGaussianBlur stdDeviation="${n(layer.blur)}"/>`);
    let filter = "";
    if (filters.length) {
      const id = this.id(layer, "f");
      this.defs.push(`<filter id="${id}" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">${filters.join("")}</filter>`);
      filter = ` filter="url(#${id})"`;
    }
    const clip = this.id(layer, "c");
    this.defs.push(`<clipPath id="${clip}"><path d="${attr(shape)}"/></clipPath>`);
    const dim = layer.dim && layer.dim > 0 ? `<path d="${attr(shape)}" fill="#000000" opacity="${n(layer.dim)}"/>` : "";
    parts.push(`<g clip-path="url(#${clip})" data-photo-slot="${layer.slot}"><image href="${attr(media.url)}" x="${n(cx - elementW / 2)}" y="${n(cy - elementH / 2)}" width="${n(elementW)}" height="${n(elementH)}" preserveAspectRatio="none"${turn}${filter}/>${dim}</g>`);
    return wrap(layer, layer, parts.join(""));
  }

  private textLayer(layer: TextLayer): string {
    const laid = layoutOf(layer, this.env.measure);
    const common = `font-family="${attr(fontStack(layer.font))}" font-size="${n(laid.sizeMm)}" font-weight="${layer.weight}" font-style="${layer.italic ? "italic" : "normal"}" fill="${attr(layer.color)}"${laid.trackingMm ? ` letter-spacing="${n(laid.trackingMm)}"` : ""}`;
    const lines = laid.lines.filter((line) => line.text.length > 0)
      .map((line) => `<text x="${n(line.x)}" y="${n(line.baseline)}" text-anchor="${line.anchor}" xml:space="preserve">${text(line.text)}</text>`).join("");
    const box = { x: layer.x, y: layer.y, w: layer.w, h: laid.height };
    const field = layer.field ? ` data-field="${attr(layer.field)}"` : "";
    return wrap(layer, box, `<g transform="translate(${n(layer.x)} ${n(layer.y)})"${field}><g ${common}>${lines}</g></g>`);
  }

  private spread(layer: SpreadLayer): string {
    const h = layer.w / layer.aspect;
    const url = layer.spreadId ? this.media.spreads.get(layer.spreadId) : undefined;
    const d = `M${n(layer.x)} ${n(layer.y)}H${n(layer.x + layer.w)}V${n(layer.y + h)}H${n(layer.x)}Z`;
    const parts: string[] = [];
    if (layer.shadow) parts.push(this.shadow(layer, d));
    if (!url) {
      parts.push(`<path d="${attr(d)}" fill="#ffffff" fill-opacity="0.6" stroke="#8f897d" stroke-width="2" stroke-dasharray="10 8" data-empty-spread="true"/>`);
      if (this.options.placeholders) parts.push(`<text x="${n(layer.x + layer.w / 2)}" y="${n(layer.y + h / 2)}" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#6f695f">Scegli una doppia pagina dell'album</text>`);
    } else {
      parts.push(`<image href="${attr(url)}" x="${n(layer.x)}" y="${n(layer.y)}" width="${n(layer.w)}" height="${n(h)}" preserveAspectRatio="none"/>`);
    }
    return wrap(layer, { x: layer.x, y: layer.y, w: layer.w, h }, parts.join(""));
  }
}

/** SVG di una slide, alla dimensione del formato. Lo stesso disegno serve all'anteprima e all'esportazione. */
export function renderSlideSvg(carousel: Carousel, index: number, env: BuildEnv, media: RenderMedia, options: RenderOptions): string {
  const { width, height } = formatOf(carousel.format);
  const built = buildSlide(carousel, index, env);
  const { body, defs } = new Renderer(env, media, options).drawAll(built.layers);
  const clip = `${safe(options.idPrefix)}-canvas`;
  const fonts = media.fontCss ? `<style>${media.fontCss}</style>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Slide ${index + 1}">`
    + `<defs>${fonts}<clipPath id="${clip}"><rect width="${width}" height="${height}"/></clipPath>${defs}</defs>`
    + `<rect width="${width}" height="${height}" fill="${attr(built.background)}"/><g clip-path="url(#${clip})">${body}</g></svg>`;
}
