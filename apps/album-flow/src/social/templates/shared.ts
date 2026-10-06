import { readableOn } from "../brand";
import { Scene, fitSize, sprigPath } from "../kit";
import type { SlideTemplate } from "../types";
import { field, handleOf, has, studioOf } from "./common";

/** Modelli disponibili in ogni stile: usano i colori e i font della marca. */

const pano: SlideTemplate = {
  id: "sh-pano", set: "shared", role: "pano", label: "Panorama", note: "Una sola immagine distesa su più slide: invita a scorrere", tone: "dark", slots: ["any"],
  fields: [
    field("word", "Parola gigante a cavallo delle slide", "Per sempre"),
    field("hint", "Invito", "Scorri"),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const span = ctx.span ?? { index: 0, count: 1 };
    const total = span.count * W;
    const offset = span.index * W;
    s.photo(0, { x: -offset, y: 0, w: total, h: H });
    s.gradient({ x: 0, y: H * 0.55, w: W, h: H * 0.45, from: "#000000", fromOpacity: 0, to: "#000000", toOpacity: 0.55, direction: "top" });
    if (has(t.word)) {
      const boxW = total * 0.8;
      const size = fitSize(ctx.measure, t.word, ctx.fonts.script, { width: boxW, max: 360, min: 90 });
      s.text({ x: total * 0.1 - offset, y: H * 0.56, w: boxW, text: t.word, font: "script", sizePx: size, color: pal.light, align: "center", lineHeight: 1 });
    }
    if (span.index === 0 && has(t.hint)) {
      s.caps({ x: s.margin, y: H - s.margin - s.v(30), w: 300, text: t.hint, color: pal.light, sizePx: 18, trackingEm: 0.5, opacity: 0.9 });
      s.arrow({ x: s.margin + 120, y: H - s.margin - s.v(18), length: 70, color: pal.accent });
    }
    if (span.index === span.count - 1) s.caps({ x: W - s.margin - 360, y: H - s.margin - s.v(30), w: 360, text: handleOf(ctx.brand), color: pal.light, align: "right", sizePx: 17, trackingEm: 0.4, opacity: 0.85 });
    return { background: s.ground, layers: s.layers };
  },
};

const mockup: SlideTemplate = {
  id: "sh-mockup", set: "shared", role: "mockup", label: "Le pagine dell'album", note: "Una doppia pagina vera dell'album in una scena", tone: "light", slots: [], needsSpread: true,
  fields: [
    field("kicker", "Sopra", "Dentro l'album"),
    field("title", "Titolo", "Sfoglia le pagine"),
    field("foot", "Piè di pagina", ({ brand, albumName }) => studioOf(brand, albumName)),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    s.ellipse({ x: W * 0.06, y: H / 2 - W * 0.44, w: W * 0.88, h: W * 0.88, fill: pal.soft, opacity: ctx.tone === "light" ? 0.5 : 0.22 });
    if (has(t.kicker)) s.caps({ x: m, y: s.v(110), w: W - 2 * m, text: t.kicker, color: pal.accent, align: "center", sizePx: 19, trackingEm: 0.42 });
    if (has(t.title)) s.headline({ x: m, y: s.v(160), w: W - 2 * m, text: t.title, font: "display", max: 74, min: 34, color: s.ink, align: "center", lineHeight: 1.05 });
    const first = ctx.spread?.aspect ?? 2;
    const second = ctx.spread2?.aspect ?? first;
    const stacked = H >= W * 1.2 && Boolean(ctx.spread && ctx.spread2);
    if (stacked) {
      // Due doppie pagine impilate e sfalsate, come un album appena aperto sul tavolo.
      const top = s.v(310);
      const gap = s.v(34);
      const room = H - top - m - s.v(110) - gap;
      const w = Math.min(W * 0.8, room / (1 / first + 1 / second));
      s.spread({ x: (W - w) / 2 - 22, y: top, w }, { shadow: true, rotation: -2 });
      s.spread({ x: (W - w) / 2 + 22, y: top + w / first + gap, w }, { shadow: true, rotation: 1.5 }, ctx.spread2);
    } else {
      const w = W * 0.9;
      const h = w / first;
      s.spread({ x: (W - w) / 2, y: Math.max(s.v(330), H / 2 - h / 2 + s.v(20)), w }, { shadow: true, rotation: -2 });
    }
    if (has(t.foot)) s.caps({ x: m, y: H - m - s.v(40), w: W - 2 * m, text: t.foot, color: s.ink, align: "center", sizePx: 17, trackingEm: 0.38, opacity: 0.75 });
    return { background: s.ground, layers: s.layers };
  },
};

const closing: SlideTemplate = {
  id: "sh-closing", set: "shared", role: "cta", label: "Chiusura con foto tonda", note: "Foto tonda, un grazie calligrafico e il pulsante per contattarti", tone: "dark", slots: ["portrait"],
  fields: [
    field("thanks", "Ringraziamento", "Grazie"),
    field("line", "Frase", "Per ogni sguardo, ogni dettaglio, ogni emozione", true),
    field("button", "Pulsante", "Scrivimi"),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    const d = Math.min(W * 0.5, H * 0.34);
    const cx = W / 2;
    const top = s.v(120);
    s.ellipse({ x: cx - d / 2 - 14, y: top - 14, w: d + 28, h: d + 28, stroke: pal.accent, strokeW: 2 });
    s.photo(0, { x: cx - d / 2, y: top, w: d, h: d }, { mask: "ellipse" });
    let cursor = top + d + s.v(34);
    if (has(t.thanks)) {
      const thanks = s.headline({ x: m, y: cursor, w: W - 2 * m, text: t.thanks, font: "script", max: 170, min: 60, color: pal.accent, align: "center", lineHeight: 1 });
      // Il corsivo calligrafico scende sotto la riga: si lascia spazio perché non tocchi la frase.
      cursor = thanks.bottom + thanks.layer.sizePx * 0.28 + s.v(10);
    }
    if (has(t.line)) {
      const line = s.text({ x: W * 0.14, y: cursor, w: W * 0.72, text: t.line, font: "body", sizePx: 24, color: s.ink, align: "center", lineHeight: 1.5, opacity: 0.85 });
      cursor = line.bottom + s.v(40);
    }
    if (has(t.button)) {
      const button = s.pill({ cx, y: cursor, label: t.button, fill: pal.accent, color: readableOn(pal.accent, pal.dark, pal.light), sizePx: 22 });
      cursor = button.y + button.h + s.v(30);
    }
    s.caps({ x: m, y: cursor, w: W - 2 * m, text: handleOf(ctx.brand), color: s.ink, align: "center", sizePx: 17, trackingEm: 0.4, opacity: 0.8 });
    const sprig = sprigPath(cx, H - m - s.v(10), 92);
    s.path({ d: sprig.stem, stroke: pal.accent, strokeW: 1.6, opacity: 0.8 });
    s.path({ d: sprig.leaves, fill: pal.accent, opacity: 0.8 });
    return { background: s.ground, layers: s.layers };
  },
};

export const SHARED: readonly SlideTemplate[] = [pano, mockup, closing];
