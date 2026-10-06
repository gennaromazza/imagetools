import type { SpreadTextOverlay } from "@photo-tools/shared-types";
import { layoutText, type TextLayout, type TextMeasure } from "../render/text-layout";
import { PT_TO_MM, fontInfo, nearestFace } from "../model/typography";
import { readableOn } from "./brand";
import type {
  TextStyleChoice, EllipseLayer, GradientLayer, Layer, LineLayer, PathLayer, PhotoLayer, RectLayer, SpreadLayer, SpreadRef, TemplateCtx, TextLayer,
} from "./types";

/** Strumenti per disegnare le slide: una scena raccoglie i livelli, misura il testo con i font veri e li dispone. */

export const round = (value: number) => Math.round(value * 100) / 100;

// ---------------------------------------------------------------------------
// Testo
// ---------------------------------------------------------------------------

/** Lo stesso calcolo di Album Flow per andare a capo: i pixel della slide fanno da «millimetri» (1 px = 1 unità). */
export function layoutOf(layer: TextLayer, measure: TextMeasure): TextLayout {
  const overlay: SpreadTextOverlay = {
    kind: "text", id: layer.id, x: 0, y: 0, w: 1, rotation: 0, z: 0, text: layer.text, font: layer.font,
    sizePt: layer.sizePx / PT_TO_MM, weight: layer.weight, italic: layer.italic, color: layer.color, align: layer.align,
    lineHeight: layer.lineHeight, trackingEm: layer.trackingEm, uppercase: layer.uppercase, paragraphSpacePt: 0, dropCapLines: 0, opacity: 1,
  };
  return layoutText(overlay, layer.w, measure, (id) => fontInfo(id).family);
}

/** Corpo massimo (entro `max`) con cui la riga più larga del testo sta in `width`; mai sotto `min`. */
export function fitSize(
  measure: TextMeasure,
  text: string,
  font: string,
  options: { width: number; max: number; min: number; weight?: 300 | 400 | 600 | 700; italic?: boolean; trackingEm?: number; uppercase?: boolean },
): number {
  const face = nearestFace(font, options.weight ?? 400, options.italic ?? false);
  const spec = { family: fontInfo(font).family, weight: face.weight, italic: face.italic };
  const tracking = options.trackingEm ?? 0;
  const folded = options.uppercase ? text.toLocaleUpperCase("it-IT") : text;
  let widest = 0;
  for (const line of folded.split("\n")) widest = Math.max(widest, measure(line, spec, 100) + tracking * 100 * [...line].length);
  if (widest <= 0) return options.max;
  return Math.max(options.min, Math.min(options.max, ((options.width * 0.985) / widest) * 100));
}

export interface TextBlock {
  layer: TextLayer;
  top: number;
  bottom: number;
  height: number;
}

export type FontRole = "display" | "script" | "body";

export interface TextSpec {
  x: number;
  y: number;
  w: number;
  text: string;
  font: FontRole | string;
  sizePx: number;
  color: string;
  weight?: TextLayer["weight"];
  italic?: boolean;
  align?: TextLayer["align"];
  lineHeight?: number;
  trackingEm?: number;
  uppercase?: boolean;
  rotation?: number;
  opacity?: number;
  /** Il campo del modello da cui viene il testo: serve solo quando due campi hanno lo stesso valore e non si distinguono dal contenuto. */
  field?: string;
}

// ---------------------------------------------------------------------------
// Foto
// ---------------------------------------------------------------------------

export interface Frame { x: number; y: number; w: number; h: number }

/** La finestra di forma `shape` più grande che sta dentro la cornice, centrata (come la «forma» delle foto nei fotolibri). */
export function fitWindow(frame: Frame, shape: number): Frame {
  if (!Number.isFinite(shape) || shape <= 0) return frame;
  const wide = shape > frame.w / frame.h;
  const w = wide ? frame.w : frame.h * shape;
  const h = wide ? frame.w / shape : frame.h;
  return { x: round(frame.x + (frame.w - w) / 2), y: round(frame.y + (frame.h - h) / 2), w: round(w), h: round(h) };
}

/** La disposizione speculare: ogni elemento passa dall'altra parte della tela (i testi restano leggibili, cambia solo dove stanno). */
export function mirrorLayers(layers: readonly Layer[], width: number): Layer[] {
  const flipX = (x: number, w: number) => round(width - x - w);
  const turn = (layer: Layer) => (layer.rotation ? { rotation: -layer.rotation } : {});
  return layers.map((layer): Layer => {
    switch (layer.kind) {
      case "rect": case "ellipse": case "photo": return { ...layer, x: flipX(layer.x, layer.w), ...turn(layer) };
      case "gradient": return { ...layer, x: flipX(layer.x, layer.w), direction: layer.direction === "left" ? "right" : layer.direction === "right" ? "left" : layer.direction, ...turn(layer) };
      case "spread": return { ...layer, x: flipX(layer.x, layer.w), ...turn(layer) };
      case "line": return { ...layer, x1: round(width - layer.x1), x2: round(width - layer.x2), ...turn(layer) };
      case "text": return { ...layer, x: flipX(layer.x, layer.w), align: layer.align === "left" ? "right" : layer.align === "right" ? "left" : layer.align, ...turn(layer) };
      default: return layer;
    }
  });
}

/**
 * Dove si disegna l'immagine perché copra la cornice: stessa regola dei ritagli dell'album (zoom e punto centrale, 0-1),
 * senza mai lasciare bordi vuoti.
 */
export function coverFit(frame: Frame, aspect: number, zoom = 1, cx = 0.5, cy = 0.5): Frame {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const safeZoom = Math.min(8, Math.max(1, Number.isFinite(zoom) ? zoom : 1));
  const focusX = Number.isFinite(cx) ? Math.min(1, Math.max(0, cx)) : 0.5;
  const focusY = Number.isFinite(cy) ? Math.min(1, Math.max(0, cy)) : 0.5;
  const frameAspect = frame.w / frame.h;
  const h = safeAspect > frameAspect ? frame.h * safeZoom : (frame.w * safeZoom) / safeAspect;
  const w = h * safeAspect;
  const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
  const x = clamp(frame.x + frame.w / 2 - focusX * w, frame.x + frame.w - w, frame.x);
  const y = clamp(frame.y + frame.h / 2 - focusY * h, frame.y + frame.h - h, frame.y);
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

// ---------------------------------------------------------------------------
// Forme
// ---------------------------------------------------------------------------

/** Stella a cinque punte, per le recensioni. */
export function starPath(cx: number, cy: number, radius: number): string {
  const points: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    const r = index % 2 === 0 ? radius : radius * 0.42;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    points.push(`${round(cx + Math.cos(angle) * r)} ${round(cy + Math.sin(angle) * r)}`);
  }
  return `M${points.join("L")}Z`;
}

/** Foglia: due curve dal punto di attacco alla punta. */
function leafPath(x: number, y: number, length: number, angleDeg: number): string {
  const angle = (angleDeg * Math.PI) / 180;
  const tip = { x: x + Math.cos(angle) * length, y: y + Math.sin(angle) * length };
  const mid = { x: x + Math.cos(angle) * length * 0.5, y: y + Math.sin(angle) * length * 0.5 };
  const side = { x: -Math.sin(angle) * length * 0.3, y: Math.cos(angle) * length * 0.3 };
  return `M${round(x)} ${round(y)}Q${round(mid.x + side.x)} ${round(mid.y + side.y)} ${round(tip.x)} ${round(tip.y)}Q${round(mid.x - side.x)} ${round(mid.y - side.y)} ${round(x)} ${round(y)}Z`;
}

/** Ramoscello d'ulivo stilizzato, largo circa `width`, per i piè di pagina. */
export function sprigPath(cx: number, cy: number, width: number): { stem: string; leaves: string } {
  const half = width / 2;
  const stem = `M${round(cx - half)} ${round(cy + width * 0.06)}Q${round(cx)} ${round(cy - width * 0.16)} ${round(cx + half)} ${round(cy - width * 0.04)}`;
  const leaves: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    const t = 0.18 + index * 0.17;
    const x = cx - half + width * t;
    const y = cy + width * 0.06 - (width * 0.1) * Math.sin(t * Math.PI) * 1.2 - t * width * 0.04;
    leaves.push(leafPath(x, y, width * 0.14, -52), leafPath(x, y, width * 0.14, 52));
  }
  return { stem, leaves: leaves.join("") };
}

// ---------------------------------------------------------------------------
// Scena
// ---------------------------------------------------------------------------

export class Scene {
  readonly layers: Layer[] = [];
  readonly width: number;
  readonly height: number;
  /** Colore di fondo e del testo secondo il tono della slide. */
  readonly ground: string;
  readonly ink: string;
  private counter = 0;

  constructor(readonly ctx: TemplateCtx) {
    this.width = ctx.width;
    this.height = ctx.height;
    this.ground = ctx.tone === "dark" ? ctx.pal.dark : ctx.pal.light;
    this.ink = ctx.tone === "dark" ? ctx.pal.light : ctx.pal.dark;
  }

  /** Misura verticale pensata per la tela del post (1350 px): si adatta agli altri formati. */
  v(value: number): number { return round((value * this.height) / 1350); }
  /** Margine esterno. */
  get margin(): number { return 72; }

  private id(): string { return `l${this.counter++}`; }
  private push<T extends Layer>(layer: T): T { this.layers.push(layer); return layer; }

  rect(spec: Omit<RectLayer, "kind" | "id">): RectLayer { return this.push({ kind: "rect", id: this.id(), ...spec }); }
  ellipse(spec: Omit<EllipseLayer, "kind" | "id">): EllipseLayer { return this.push({ kind: "ellipse", id: this.id(), ...spec }); }
  line(spec: Omit<LineLayer, "kind" | "id">): LineLayer { return this.push({ kind: "line", id: this.id(), ...spec }); }
  path(spec: Omit<PathLayer, "kind" | "id">): PathLayer { return this.push({ kind: "path", id: this.id(), ...spec }); }
  gradient(spec: Omit<GradientLayer, "kind" | "id">): GradientLayer { return this.push({ kind: "gradient", id: this.id(), ...spec }); }

  photo(slot: number, frame: Frame, extras: Partial<Omit<PhotoLayer, "kind" | "id" | "slot" | "x" | "y" | "w" | "h">> = {}): PhotoLayer {
    // Gli sfondi sfocati non si inquadrano: copiano solo la foto. Nei panorami non si cambia la forma (le parti devono combaciare).
    const framing = extras.blur ? null : this.ctx.framing[slot] ?? null;
    const target = framing?.shape && !this.ctx.span ? fitWindow(frame, framing.shape) : frame;
    return this.push({
      kind: "photo", id: this.id(), slot, assetId: this.ctx.photos[slot]?.assetId ?? null,
      x: round(target.x), y: round(target.y), w: round(target.w), h: round(target.h), mask: "rect",
      zoom: framing?.zoom ?? 1, cx: framing?.cx ?? 0.5, cy: framing?.cy ?? 0.5, ...extras,
    });
  }

  spread(frame: { x: number; y: number; w: number }, extras: Partial<Omit<SpreadLayer, "kind" | "id" | "x" | "y" | "w" | "spreadId" | "aspect">> = {}, ref: SpreadRef | null = this.ctx.spread): SpreadLayer {
    return this.push({ kind: "spread", id: this.id(), spreadId: ref?.spreadId ?? null, aspect: ref?.aspect ?? 2, x: round(frame.x), y: round(frame.y), w: round(frame.w), ...extras });
  }

  /** Il campo del modello a cui appartiene un testo (confronto senza maiuscole, spazi e punteggiatura; per i campi su più righe, una riga). */
  fieldOf(text: string): string | undefined {
    const key = normalizeText(text);
    if (!key) return undefined;
    for (const [field, value] of Object.entries(this.ctx.texts)) if (normalizeText(value) === key) return field;
    for (const [field, value] of Object.entries(this.ctx.texts)) if (value.includes("\n") && value.split("\n").some((line) => normalizeText(line) === key)) return field;
    return undefined;
  }

  private colorOf(choice: NonNullable<TextStyleChoice["color"]>): string {
    const { pal } = this.ctx;
    return choice === "ink" ? this.ink : choice === "accent" ? pal.accent : choice === "light" ? pal.light : choice === "dark" ? pal.dark : pal.soft;
  }

  /** Applica a una descrizione di testo le scelte di stile dell'utente per il suo campo; il corpo si moltiplica dopo, sul valore finale. */
  private styled(spec: TextSpec): { spec: TextSpec; scale: number; field: string | undefined } {
    const field = spec.field ?? this.fieldOf(spec.text);
    const style = field ? this.ctx.textStyle[field] : undefined;
    if (!style) return { spec, scale: 1, field };
    return {
      spec: {
        ...spec,
        ...(style.font ? { font: style.font } : {}), ...(style.color ? { color: this.colorOf(style.color) } : {}),
        ...(style.align ? { align: style.align } : {}), ...(style.uppercase !== undefined ? { uppercase: style.uppercase } : {}),
      },
      scale: style.scale ?? 1,
      field,
    };
  }

  /** Aggiunge un testo e ne restituisce l'ingombro (l'altezza dipende dal contenuto e dal font). */
  text(spec: TextSpec): TextBlock {
    const styled = this.styled(spec);
    return this.place({ ...styled.spec, sizePx: styled.spec.sizePx * styled.scale }, styled.field);
  }

  private place(spec: TextSpec, field?: string): TextBlock {
    const font = spec.font === "display" || spec.font === "script" || spec.font === "body" ? this.ctx.fonts[spec.font] : spec.font;
    const layer: TextLayer = {
      kind: "text", id: this.id(), x: round(spec.x), y: round(spec.y), w: round(spec.w), text: spec.text, font, sizePx: round(spec.sizePx),
      weight: spec.weight ?? 400, italic: spec.italic ?? false, color: spec.color, align: spec.align ?? "left",
      lineHeight: spec.lineHeight ?? 1.15, trackingEm: spec.trackingEm ?? 0, uppercase: spec.uppercase ?? false,
      ...(spec.rotation ? { rotation: spec.rotation } : {}), ...(spec.opacity !== undefined && spec.opacity < 1 ? { opacity: spec.opacity } : {}),
      ...(field ? { field } : {}),
    };
    // Un testo vuoto non genera nessun livello: chi svuota un campo vuole che l'elemento sparisca.
    if (!layer.text.trim()) return { layer, top: layer.y, bottom: layer.y, height: 0 };
    this.layers.push(layer);
    const height = layoutOf(layer, this.ctx.measure).height;
    return { layer, top: layer.y, bottom: round(layer.y + height), height };
  }

  /** Titolo adattato: il corpo è il più grande che fa stare la riga più larga nella larghezza data. */
  headline(spec: Omit<TextSpec, "sizePx"> & { max: number; min?: number }): TextBlock {
    const styled = this.styled({ ...spec, sizePx: spec.max });
    const chosen = styled.spec;
    const font = chosen.font === "display" || chosen.font === "script" || chosen.font === "body" ? this.ctx.fonts[chosen.font] : chosen.font;
    const fitted = fitSize(this.ctx.measure, chosen.text, font, {
      width: chosen.w, max: spec.max, min: spec.min ?? Math.min(24, spec.max), weight: chosen.weight, italic: chosen.italic, trackingEm: chosen.trackingEm, uppercase: chosen.uppercase,
    });
    return this.place({ ...chosen, sizePx: fitted * styled.scale }, styled.field);
  }

  /** Testo piccolo in maiuscolo con le lettere spaziate: didascalie, indirizzi, piè di pagina. */
  caps(spec: Omit<TextSpec, "sizePx" | "font"> & { sizePx?: number; font?: TextSpec["font"] }): TextBlock {
    return this.text({ font: "body", sizePx: 22, trackingEm: 0.28, uppercase: true, ...spec });
  }

  /** Pulsante a pillola con la scritta al centro; restituisce l'ingombro. */
  pill(spec: { cx: number; y: number; label: string; fill: string; color?: string; sizePx?: number; padX?: number; stroke?: string }): Frame {
    const sizePx = spec.sizePx ?? 22;
    const trackingEm = 0.22;
    const padX = spec.padX ?? 34;
    const height = Math.round(sizePx * 2.5);
    const font = this.ctx.fonts.body;
    const face = nearestFace(font, 400, false);
    const textWidth = this.ctx.measure(spec.label.toLocaleUpperCase("it-IT"), { family: fontInfo(font).family, weight: face.weight, italic: face.italic }, sizePx) + trackingEm * sizePx * [...spec.label].length;
    const width = Math.round(textWidth + padX * 2);
    const x = spec.cx - width / 2;
    this.rect({ x, y: spec.y, w: width, h: height, fill: spec.fill, radius: height / 2, ...(spec.stroke ? { stroke: spec.stroke, strokeW: 2 } : {}) });
    this.text({
      x, y: spec.y + (height - sizePx * 1.2) / 2, w: width, text: spec.label, font: "body", sizePx, color: spec.color ?? readableOn(spec.fill, this.ctx.pal.dark, this.ctx.pal.light),
      align: "center", trackingEm, uppercase: true, lineHeight: 1.2,
    });
    return { x, y: spec.y, w: width, h: height };
  }

  /** Tondo con una o due righe di testo (badge «NUOVO», «SALVA»). */
  badge(spec: { cx: number; cy: number; r: number; lines: string[]; fill: string; color: string; rotation?: number }): void {
    this.ellipse({ x: spec.cx - spec.r, y: spec.cy - spec.r, w: spec.r * 2, h: spec.r * 2, fill: spec.fill, ...(spec.rotation ? { rotation: spec.rotation } : {}) });
    const sizePx = Math.round(spec.r * 0.27);
    const lineHeight = 1.25;
    const total = sizePx * lineHeight * spec.lines.length;
    this.text({
      x: spec.cx - spec.r, y: spec.cy - total / 2 + sizePx * 0.05, w: spec.r * 2, text: spec.lines.join("\n"), font: "body", sizePx, color: spec.color, weight: 600,
      align: "center", trackingEm: 0.14, uppercase: true, lineHeight, ...(spec.rotation ? { rotation: spec.rotation } : {}),
    });
  }

  /** Fila di stelle centrate in `cx`. */
  stars(spec: { cx: number; y: number; count: number; radius: number; fill: string }): void {
    const gap = spec.radius * 2.5;
    const start = spec.cx - ((spec.count - 1) * gap) / 2;
    for (let index = 0; index < spec.count; index += 1) this.path({ d: starPath(start + index * gap, spec.y + spec.radius, spec.radius), fill: spec.fill });
  }

  /** Monogramma: iniziale in un cerchio sottile. */
  monogram(spec: { cx: number; cy: number; r: number; letter: string; color: string }): void {
    this.ellipse({ x: spec.cx - spec.r, y: spec.cy - spec.r, w: spec.r * 2, h: spec.r * 2, stroke: spec.color, strokeW: 2 });
    const sizePx = Math.round(spec.r * 1.15);
    this.text({ x: spec.cx - spec.r, y: spec.cy - sizePx * 0.62, w: spec.r * 2, text: spec.letter, font: "script", sizePx, color: spec.color, align: "center", lineHeight: 1.2 });
  }

  /** Larghezza in pixel di una riga di testo con quel font, corpo e spaziatura. */
  textWidth(text: string, font: FontRole | string, sizePx: number, options: { weight?: TextLayer["weight"]; italic?: boolean; trackingEm?: number; uppercase?: boolean } = {}): number {
    const fontId = font === "display" || font === "script" || font === "body" ? this.ctx.fonts[font] : font;
    const face = nearestFace(fontId, options.weight ?? 400, options.italic ?? false);
    const folded = options.uppercase ? text.toLocaleUpperCase("it-IT") : text;
    return this.ctx.measure(folded, { family: fontInfo(fontId).family, weight: face.weight, italic: face.italic }, sizePx) + (options.trackingEm ?? 0) * sizePx * [...folded].length;
  }

  /** Sposta in verticale un testo già aggiunto (serve a centrarlo dopo averne misurato l'altezza). */
  move(block: TextBlock, y: number): TextBlock {
    block.layer.y = round(y);
    return { layer: block.layer, top: block.layer.y, bottom: round(block.layer.y + block.height), height: block.height };
  }

  /** Freccia orizzontale disegnata (nessun glifo: i font non hanno tutti le frecce). */
  arrow(spec: { x: number; y: number; length: number; color: string; strokeW?: number; opacity?: number }): void {
    const strokeW = spec.strokeW ?? 2;
    const head = Math.min(14, spec.length * 0.3);
    const extra = spec.opacity !== undefined ? { opacity: spec.opacity } : {};
    this.line({ x1: spec.x, y1: spec.y, x2: spec.x + spec.length, y2: spec.y, stroke: spec.color, strokeW, ...extra });
    this.line({ x1: spec.x + spec.length - head, y1: spec.y - head * 0.7, x2: spec.x + spec.length, y2: spec.y, stroke: spec.color, strokeW, ...extra });
    this.line({ x1: spec.x + spec.length - head, y1: spec.y + head * 0.7, x2: spec.x + spec.length, y2: spec.y, stroke: spec.color, strokeW, ...extra });
  }

  /** Numero della slide («02 / 08») in un angolo. */
  pageMark(spec: { x: number; y: number; w: number; align: "left" | "right" | "center"; color: string; opacity?: number }): void {
    const pad = (value: number) => String(value).padStart(2, "0");
    this.caps({ x: spec.x, y: spec.y, w: spec.w, text: `${pad(this.ctx.index + 1)} / ${pad(this.ctx.total)}`, color: spec.color, align: spec.align, sizePx: 18, trackingEm: 0.3, opacity: spec.opacity ?? 0.7 });
  }
}

/** Testi con righe `a\nb`: rimuove righe vuote ai bordi e restituisce l'elenco. */
export function linesOf(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

/** Per confrontare due testi senza badare a maiuscole, spazi, a capo e punteggiatura. */
export function normalizeText(value: string): string {
  return value.toLocaleLowerCase("it-IT").replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Un titolo di più parole va su due righe bilanciate (il punto di rottura più vicino alla metà); se chi scrive ha già
 * messo un a capo, non si tocca. Le parole singole e i titoli brevi restano su una riga.
 */
export function balance(text: string, minLength = 11): string {
  const clean = text.trim();
  if (clean.includes("\n") || clean.length < minLength) return clean;
  const words = clean.split(/\s+/);
  if (words.length < 2) return clean;
  let best = 1;
  let bestGap = Infinity;
  for (let index = 1; index < words.length; index += 1) {
    const gap = Math.abs(words.slice(0, index).join(" ").length - words.slice(index).join(" ").length);
    if (gap < bestGap) { bestGap = gap; best = index; }
  }
  return `${words.slice(0, best).join(" ")}\n${words.slice(best).join(" ")}`;
}
