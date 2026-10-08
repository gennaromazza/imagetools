import { Scene } from "../kit";
import type { SlideTemplate } from "../types";
import { field, has, studioOf } from "./common";
import { UNIVERSAL_MORE } from "./more";
import { MULTI } from "./multi";
import { SOLO } from "./solo";

/**
 * Modelli universali: si vestono dei colori e dei font di qualsiasi stile. Il tono (scuro o chiaro) lo decide lo stile,
 * alternandolo dove serve per dare ritmo al carosello. Servono a non ripetere gli stessi layout quando le slide sono tante.
 */

const full: SlideTemplate = {
  id: "sh-full", set: "shared", role: "hero", label: "Foto a tutta pagina", note: "Solo la foto, con una frase breve in basso", tone: "dark", slots: ["any"],
  variants: [{ caption: "Quello che resta" }, { caption: "Senza parole" }],
  fields: [field("caption", "Frase", "Un attimo, per sempre")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const m = s.margin;
    s.photo(0, { x: 0, y: 0, w: W, h: H });
    s.gradient({ x: 0, y: H * 0.62, w: W, h: H * 0.38, from: "#000000", fromOpacity: 0, to: "#000000", toOpacity: 0.68, direction: "top" });
    s.pageMark({ x: W - m - 200, y: s.v(84), w: 200, align: "right", color: "#ffffff" });
    if (has(ctx.texts.caption)) {
      let caption = s.headline({ x: m, y: 0, w: W - 2 * m, text: ctx.texts.caption, font: "display", max: 62, min: 28, color: "#ffffff", italic: true, lineHeight: 1.1 });
      caption = s.move(caption, H - m - s.v(40) - caption.height);
      s.line({ x1: m, y1: caption.top - 22, x2: m + 64, y2: caption.top - 22, stroke: pal.accent, strokeW: 3 });
    }
    return { background: s.ground, layers: s.layers };
  },
};

const split: SlideTemplate = {
  id: "sh-split", set: "shared", role: "hero", label: "Metà foto, metà testo", note: "Foto verticale a sinistra e un testo a destra", tone: "light", slots: ["portrait"],
  variants: [{ title: "Luce\ne tempo", body: "Aspettare il momento giusto è metà del lavoro: l'altra metà è farsi dimenticare." }],
  fields: [
    field("title", "Titolo", "Il dettaglio\nfa la differenza", true),
    field("body", "Testo", "Non cerchiamo la posa perfetta: cerchiamo quello che di solito sfugge, e lo teniamo per voi.", true),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const half = W * 0.5;
    s.rect({ x: half, y: 0, w: half, h: H, fill: pal.soft, opacity: ctx.tone === "dark" ? 0.2 : 0.55 });
    s.photo(0, { x: 0, y: 0, w: half, h: H });
    const x = half + 52;
    const w = half - 52 - 56;
    let cursor = s.v(300);
    if (has(t.title)) {
      const title = s.headline({ x, y: cursor, w, text: t.title, font: "display", max: 66, min: 28, color: s.ink, lineHeight: 1.05 });
      cursor = title.bottom + 26;
    }
    s.line({ x1: x, y1: cursor, x2: x + 60, y2: cursor, stroke: pal.accent, strokeW: 3 });
    cursor += 34;
    if (has(t.body)) s.text({ x, y: cursor, w, text: t.body, font: "body", sizePx: 22, color: s.ink, lineHeight: 1.6, opacity: 0.85 });
    s.pageMark({ x, y: H - s.v(110), w, align: "left", color: s.ink });
    return { background: s.ground, layers: s.layers };
  },
};

const grid: SlideTemplate = {
  id: "sh-grid", set: "shared", role: "collage", label: "Quattro foto in griglia", note: "Griglia due per due con una parola sotto", tone: "light", slots: ["any", "any", "any", "any"],
  variants: [{ kicker: "Altri momenti", caption: "tutto il resto" }],
  fields: [field("kicker", "Sopra", "Selezione"), field("caption", "Parola calligrafica", "momenti scelti")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    if (has(t.kicker)) s.caps({ x: m, y: s.v(86), w: W - 2 * m, text: t.kicker, color: pal.accent, align: "center", sizePx: 19, trackingEm: 0.42 });
    const top = s.v(150);
    const gap = 12;
    const bottom = H - s.v(250);
    const cellW = (W - 2 * m - gap) / 2;
    const cellH = (bottom - top - gap) / 2;
    for (let index = 0; index < 4; index += 1) s.photo(index, { x: m + (index % 2) * (cellW + gap), y: top + Math.floor(index / 2) * (cellH + gap), w: cellW, h: cellH });
    if (has(t.caption)) s.text({ x: m, y: bottom + s.v(26), w: W - 2 * m, text: t.caption, font: "script", sizePx: 86, color: pal.accent, align: "center", lineHeight: 1.05 });
    s.pageMark({ x: m, y: H - s.v(96), w: 240, align: "left", color: s.ink });
    return { background: s.ground, layers: s.layers };
  },
};

const trio: SlideTemplate = {
  id: "sh-trio", set: "shared", role: "collage", label: "Tre fasce orizzontali", note: "Tre foto larghe una sotto l'altra", tone: "dark", slots: ["landscape", "landscape", "landscape"],
  variants: [{ caption: "Una dopo l'altra" }],
  fields: [field("caption", "Didascalia", "Tre momenti, una storia")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const m = s.margin;
    const top = s.v(110);
    const gap = 14;
    const bottom = H - s.v(190);
    const h = (bottom - top - 2 * gap) / 3;
    for (let index = 0; index < 3; index += 1) s.photo(index, { x: m, y: top + index * (h + gap), w: W - 2 * m, h });
    s.line({ x1: W / 2 - 30, y1: bottom + s.v(28), x2: W / 2 + 30, y2: bottom + s.v(28), stroke: pal.accent, strokeW: 2 });
    if (has(ctx.texts.caption)) s.caps({ x: m, y: bottom + s.v(52), w: W - 2 * m, text: ctx.texts.caption, color: s.ink, align: "center", sizePx: 19, trackingEm: 0.38, opacity: 0.85 });
    return { background: s.ground, layers: s.layers };
  },
};

const statement: SlideTemplate = {
  id: "sh-statement", set: "shared", role: "quote", label: "Solo parole", note: "Una frase grande, senza foto", tone: "dark", slots: [],
  variants: [{ kicker: "Il nostro modo", text: "Meno pose,\npiù verità", script: "sempre" }, { kicker: "Promessa", text: "Ogni foto\nè una promessa", script: "mantenuta" }],
  fields: [
    field("kicker", "Sopra", "Credo che"),
    field("text", "Frase", "Ogni dettaglio\nracconta una storia", true),
    field("script", "Parola calligrafica", "davvero"),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    let block = has(t.text) ? s.headline({ x: m, y: 0, w: W - 2 * m, text: t.text, font: "display", max: 150, min: 44, color: s.ink, align: "center", lineHeight: 0.98, uppercase: true }) : null;
    if (block) block = s.move(block, H * 0.46 - block.height / 2);
    if (has(t.kicker)) s.caps({ x: m, y: (block?.top ?? H * 0.4) - s.v(70), w: W - 2 * m, text: t.kicker, color: pal.accent, align: "center", sizePx: 20, trackingEm: 0.42 });
    if (has(t.script)) s.text({ x: m, y: (block?.bottom ?? H * 0.5) - 20, w: W - 2 * m, text: t.script, font: "script", sizePx: 110, color: pal.accent, align: "center", lineHeight: 1, rotation: -4 });
    s.pageMark({ x: W - m - 200, y: s.v(84), w: 200, align: "right", color: s.ink });
    return { background: s.ground, layers: s.layers };
  },
};

const duo: SlideTemplate = {
  id: "sh-duo", set: "shared", role: "collage", label: "Due ritratti", note: "Due foto verticali affiancate con una parola sotto", tone: "light", slots: ["portrait", "portrait"],
  variants: [{ script: "fianco a fianco", caption: "Due volti" }],
  fields: [field("script", "Parola calligrafica", "insieme"), field("caption", "Didascalia", "Sempre un passo avanti")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    const gap = 14;
    const w = (W - 2 * m - gap) / 2;
    const h = Math.min(H - s.v(420), w * 1.6);
    const y = s.v(120);
    s.photo(0, { x: m, y, w, h });
    s.photo(1, { x: m + w + gap, y: y + s.v(56), w, h: h - s.v(56) });
    let cursor = y + h + s.v(40);
    if (has(t.script)) cursor = s.text({ x: m, y: cursor, w: W - 2 * m, text: t.script, font: "script", sizePx: 84, color: pal.accent, align: "center", lineHeight: 1.05 }).bottom + 6;
    if (has(t.caption)) s.caps({ x: m, y: cursor, w: W - 2 * m, text: t.caption, color: s.ink, align: "center", sizePx: 18, trackingEm: 0.36, opacity: 0.8 });
    return { background: s.ground, layers: s.layers };
  },
};

const polaroid: SlideTemplate = {
  id: "sh-polaroid", set: "shared", role: "moment", label: "Polaroid", note: "Una foto con cornice bianca, leggermente inclinata", tone: "light", slots: ["any"],
  variants: [{ script: "come allora", label: "Un ricordo" }, { script: "ancora", label: "Un altro ricordo" }],
  fields: [field("script", "Parola calligrafica", "ricordi"), field("label", "Didascalia", "Dal nostro archivio")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    s.ellipse({ x: W * 0.08, y: H * 0.5 - W * 0.42, w: W * 0.84, h: W * 0.84, fill: pal.soft, opacity: ctx.tone === "dark" ? 0.18 : 0.45 });
    const w = W * 0.66;
    const h = Math.min(w * 1.12, H * 0.5);
    const x = (W - w) / 2;
    const y = s.v(190);
    s.photo(0, { x, y, w, h }, { border: { w: 30, color: "#ffffff" }, shadow: true, rotation: -3 });
    s.rect({ x: W / 2 - 70, y: y - 52, w: 140, h: 40, fill: pal.accent, opacity: 0.55, rotation: 4 });
    let cursor = y + h + s.v(110);
    if (has(t.script)) cursor = s.text({ x: 60, y: cursor, w: W - 120, text: t.script, font: "script", sizePx: 92, color: pal.accent, align: "center", lineHeight: 1.05, rotation: -2 }).bottom + 8;
    if (has(t.label)) s.caps({ x: 60, y: cursor, w: W - 120, text: t.label, color: s.ink, align: "center", sizePx: 17, trackingEm: 0.4, opacity: 0.75 });
    return { background: s.ground, layers: s.layers };
  },
};

const arch: SlideTemplate = {
  id: "sh-arch", set: "shared", role: "hero", label: "Foto ad arco", note: "Una foto verticale ritagliata ad arco, con una parola sopra", tone: "light", slots: ["portrait"],
  variants: [{ script: "benvenuti", kicker: "Il giorno" }, { script: "grazie", kicker: "A chi c'era" }],
  fields: [field("script", "Parola calligrafica", "il giorno"), field("kicker", "Sotto", ({ brand, albumName }) => studioOf(brand, albumName))],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const w = Math.min(W * 0.58, (H * 0.62) / 1.5);
    const h = w * 1.5;
    const x = (W - w) / 2;
    const y = H * 0.5 - h / 2 + s.v(20);
    s.ellipse({ x: x - 34, y: y - 34, w: w + 68, h: w + 68, stroke: pal.accent, strokeW: 2, opacity: 0.7 });
    s.photo(0, { x, y, w, h }, { mask: "arch", shadow: true });
    if (has(t.script)) s.text({ x: 40, y: y - 120, w: W - 80, text: t.script, font: "script", sizePx: 104, color: pal.accent, align: "center", lineHeight: 1, rotation: -3 });
    if (has(t.kicker)) s.caps({ x: 60, y: y + h + s.v(52), w: W - 120, text: t.kicker, color: s.ink, align: "center", sizePx: 18, trackingEm: 0.42, opacity: 0.8 });
    return { background: s.ground, layers: s.layers };
  },
};

export const UNIVERSAL: readonly SlideTemplate[] = [full, split, grid, trio, statement, duo, polaroid, arch, ...UNIVERSAL_MORE, ...MULTI, ...SOLO];

/** I modelli dove il tono lo sceglie lo stile (alternando fondo scuro e chiaro per dare ritmo). */
export const FLEX_TONE_IDS: ReadonlySet<string> = new Set(UNIVERSAL.map((template) => template.id));
