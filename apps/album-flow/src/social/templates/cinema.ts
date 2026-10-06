import { Scene } from "../kit";
import type { SlideTemplate } from "../types";
import { field, handleOf, has, studioOf } from "./common";

/**
 * Stile «Cinema»: sfondi sfocati ricavati dalla stessa foto, strisce di foto, bande da pellicola e poche parole tracciate sottili.
 * Il più sobrio: lascia parlare le immagini.
 */

const full: SlideTemplate = {
  id: "ci-full", set: "cinema", role: "cover", label: "Fotogramma", note: "Foto a bordo pieno con bande da pellicola e titolo calligrafico", tone: "dark", slots: ["portrait"],
  variants: [{ title: "senza fretta", caption: "La luce giusta arriva sempre" }, { title: "per sempre", caption: "Il resto è dettaglio" }],
  fields: [
    field("title", "Titolo", ({ albumName }) => albumName || "Per sempre"),
    field("kicker", "Banda in alto", ({ brand, albumName }) => studioOf(brand, albumName)),
    field("caption", "Didascalia", "Un film in pochi fotogrammi"),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    const bar = s.v(104);
    s.photo(0, { x: 0, y: 0, w: W, h: H });
    s.gradient({ x: 0, y: H * 0.5, w: W, h: H * 0.5, from: "#000000", fromOpacity: 0, to: "#000000", toOpacity: 0.78, direction: "top" });
    s.rect({ x: 0, y: 0, w: W, h: bar, fill: "#000000" });
    s.rect({ x: 0, y: H - bar, w: W, h: bar, fill: "#000000" });
    if (has(t.kicker)) s.caps({ field: "kicker", x: m, y: bar / 2 - 10, w: W * 0.6, text: t.kicker, color: pal.light, sizePx: 17, trackingEm: 0.4, opacity: 0.85 });
    s.pageMark({ x: W - m - 200, y: bar / 2 - 9, w: 200, align: "right", color: pal.light });
    if (has(t.caption)) s.caps({ x: m, y: H - bar / 2 - 10, w: W - 2 * m, text: t.caption, color: pal.light, align: "center", sizePx: 16, trackingEm: 0.42, opacity: 0.8 });
    if (has(t.title)) {
      let title = s.headline({ field: "title", x: m, y: 0, w: W - 2 * m, text: t.title, font: "script", max: 168, min: 56, color: pal.light, align: "center", lineHeight: 1 });
      title = s.move(title, H - bar - s.v(70) - title.height);
      s.line({ x1: W / 2 - 40, y1: title.bottom + s.v(24), x2: W / 2 + 40, y2: title.bottom + s.v(24), stroke: pal.accent, strokeW: 2 });
    }
    return { background: s.ground, layers: s.layers };
  },
};

const strip: SlideTemplate = {
  id: "ci-strip", set: "cinema", role: "collage", label: "Striscia di tre foto", note: "Tre foto affiancate su uno sfondo sfocato della prima", tone: "dark", slots: ["portrait", "portrait", "portrait"],
  variants: [{ caption: "Ogni attimo è un piccolo film" }],
  fields: [
    field("caption", "Frase", "Tu sei il mio oggi e tutti i miei domani"),
    field("foot", "Piè di pagina", ({ brand }) => handleOf(brand)),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    s.photo(0, { x: -90, y: -90, w: W + 180, h: H + 180 }, { blur: 46, dim: 0.5 });
    const totalW = W * 0.86;
    const gap = 8;
    const tileW = (totalW - 2 * gap) / 3;
    const tileH = Math.min(s.v(720), tileW * 2.4);
    const x0 = (W - totalW) / 2;
    const y0 = H / 2 - tileH / 2 - s.v(26);
    for (let index = 0; index < 3; index += 1) s.photo(index, { x: x0 + index * (tileW + gap), y: y0, w: tileW, h: tileH }, { shadow: true });
    if (has(t.caption)) s.caps({ x: x0, y: y0 + tileH + s.v(50), w: totalW, text: t.caption, color: pal.light, align: "center", sizePx: 18, trackingEm: 0.3, opacity: 0.85 });
    s.line({ x1: W / 2 - 30, y1: y0 - s.v(46), x2: W / 2 + 30, y2: y0 - s.v(46), stroke: pal.accent, strokeW: 2 });
    if (has(t.foot)) s.caps({ x: 60, y: H - s.v(110), w: W - 120, text: t.foot, color: pal.light, align: "center", sizePx: 16, trackingEm: 0.4, opacity: 0.7 });
    return { background: s.ground, layers: s.layers };
  },
};

const duo: SlideTemplate = {
  id: "ci-duo", set: "cinema", role: "collage", label: "Due foto in diagonale", note: "Due ritratti sovrapposti su sfondo sfocato, con una parola calligrafica", tone: "dark", slots: ["portrait", "portrait"],
  variants: [{ script: "vicini", caption: "Il resto è silenzio" }],
  fields: [
    field("script", "Parola calligrafica", "insieme"),
    field("caption", "Didascalia", "Il resto è dettaglio"),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    s.photo(1, { x: -90, y: -90, w: W + 180, h: H + 180 }, { blur: 50, dim: 0.55 });
    const border = { w: 7, color: pal.light };
    s.photo(0, { x: W * 0.09, y: s.v(190), w: W * 0.46, h: s.v(700) }, { border, shadow: true });
    s.photo(1, { x: W * 0.45, y: s.v(430), w: W * 0.46, h: s.v(700) }, { border, shadow: true });
    if (has(t.script)) s.text({ x: 40, y: s.v(80), w: W - 80, text: t.script, font: "script", sizePx: 120, color: pal.accent, align: "center", lineHeight: 1, rotation: -3 });
    if (has(t.caption)) s.caps({ x: 60, y: H - s.v(96), w: W - 120, text: t.caption, color: pal.light, align: "center", sizePx: 17, trackingEm: 0.42, opacity: 0.8 });
    return { background: s.ground, layers: s.layers };
  },
};

const scope: SlideTemplate = {
  id: "ci-scope", set: "cinema", role: "hero", label: "Formato cinemascope", note: "Una foto larga in una fascia da schermo cinematografico", tone: "dark", slots: ["landscape"],
  variants: [{ kicker: "Capitolo due", title: "la luce", caption: "Il tempo giusto non si forza" }],
  fields: [
    field("kicker", "Capitolo", "Capitolo uno"),
    field("title", "Titolo", "il nostro film"),
    field("caption", "Didascalia", "Luce naturale, nessuna posa"),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    s.photo(0, { x: -90, y: -90, w: W + 180, h: H + 180 }, { blur: 46, dim: 0.58 });
    const w = W - 96;
    const h = w / 2.39;
    const y = H * 0.4 - h / 2;
    s.photo(0, { x: 48, y, w, h }, { shadow: true });
    s.line({ x1: 48, y1: y - 30, x2: W - 48, y2: y - 30, stroke: pal.light, strokeW: 1.5, opacity: 0.35 });
    s.line({ x1: 48, y1: y + h + 30, x2: W - 48, y2: y + h + 30, stroke: pal.light, strokeW: 1.5, opacity: 0.35 });
    if (has(t.kicker)) s.caps({ x: 48, y: s.v(110), w: W * 0.6, text: t.kicker, color: pal.light, sizePx: 17, trackingEm: 0.42, opacity: 0.85 });
    s.pageMark({ x: W - 48 - 200, y: s.v(110), w: 200, align: "right", color: pal.light });
    let cursor = y + h + s.v(80);
    if (has(t.title)) {
      const title = s.headline({ x: m, y: cursor, w: W - 2 * m, text: t.title, font: "script", max: 150, min: 56, color: pal.accent, align: "center", lineHeight: 1 });
      cursor = title.bottom + title.layer.sizePx * 0.25;
    }
    if (has(t.caption)) s.caps({ x: m, y: cursor + s.v(10), w: W - 2 * m, text: t.caption, color: pal.light, align: "center", sizePx: 18, trackingEm: 0.4, opacity: 0.8 });
    s.caps({ x: m, y: H - s.v(110), w: W - 2 * m, text: handleOf(ctx.brand), color: pal.light, align: "center", sizePx: 16, trackingEm: 0.4, opacity: 0.7 });
    return { background: s.ground, layers: s.layers };
  },
};

const quote: SlideTemplate = {
  id: "ci-quote", set: "cinema", role: "quote", label: "Frase sul fotogramma", note: "Foto scurita con una frase calligrafica al centro", tone: "dark", slots: ["any"],
  variants: [{ quote: "Il tempo passa, le immagini restano" }],
  fields: [
    field("quote", "Frase", "Ogni giorno è un film, e noi siamo i protagonisti", true),
    field("who", "Firma", ({ brand, albumName }) => studioOf(brand, albumName)),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    s.photo(0, { x: 0, y: 0, w: W, h: H }, { dim: 0.52 });
    s.pageMark({ x: W - m - 200, y: s.v(86), w: 200, align: "right", color: pal.light });
    s.line({ x1: W / 2, y1: H * 0.3 - s.v(60), x2: W / 2, y2: H * 0.3, stroke: pal.accent, strokeW: 2 });
    let cursor = H * 0.3 + s.v(30);
    if (has(t.quote)) {
      const quoteBlock = s.text({ x: 90, y: cursor, w: W - 180, text: t.quote, font: "script", sizePx: 92, color: pal.light, align: "center", lineHeight: 1.08 });
      cursor = quoteBlock.bottom + s.v(54);
    }
    if (has(t.who)) s.caps({ x: m, y: cursor, w: W - 2 * m, text: t.who, color: pal.accent, align: "center", sizePx: 19, trackingEm: 0.42 });
    return { background: s.ground, layers: s.layers };
  },
};

export const CINEMA: readonly SlideTemplate[] = [full, strip, scope, duo, quote];
