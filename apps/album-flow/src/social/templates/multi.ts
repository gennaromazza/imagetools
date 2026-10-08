import { Scene } from "../kit";
import type { SlideTemplate } from "../types";
import { field, has } from "./common";

/**
 * Modelli con tre o quattro foto: servono quando le foto scelte per i social sono tante e le slide poche.
 * Come gli altri modelli universali si vestono dei colori e dei font di qualsiasi stile; il fondo lo decide lo stile.
 */

/** Il titolo piccolo in maiuscolo sotto le foto. */
function footer(s: Scene, text: string | undefined, y: number): void {
  if (!has(text)) return;
  s.caps({ x: s.margin, y, w: s.width - 2 * s.margin, text: text!, color: s.ink, align: "center", sizePx: 18, trackingEm: 0.38, opacity: 0.8 });
}

const mosaic4: SlideTemplate = {
  id: "sh-mosaic4", set: "shared", role: "collage", label: "Mosaico a quattro", note: "Una foto alta e tre piccole, senza spazi", tone: "dark", slots: ["portrait", "any", "any", "any"],
  variants: [{ caption: "Un giorno, mille istanti" }],
  fields: [field("caption", "Didascalia", "Il giorno in quattro scatti")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H } = ctx;
    const m = 40;
    const gap = 10;
    const top = m;
    const bottom = H - s.v(150);
    const colW = (W - 2 * m - gap) * 0.56;
    const rightW = W - 2 * m - gap - colW;
    const cellH = (bottom - top - 2 * gap) / 3;
    s.photo(0, { x: m, y: top, w: colW, h: bottom - top });
    for (let index = 0; index < 3; index += 1) s.photo(index + 1, { x: m + colW + gap, y: top + index * (cellH + gap), w: rightW, h: cellH });
    footer(s, ctx.texts.caption, bottom + s.v(52));
    return { background: s.ground, layers: s.layers };
  },
};

const columns4: SlideTemplate = {
  id: "sh-columns4", set: "shared", role: "collage", label: "Quattro colonne", note: "Quattro foto verticali affiancate, a quote sfalsate", tone: "light", slots: ["portrait", "portrait", "portrait", "portrait"],
  variants: [{ script: "passo dopo passo", caption: "Quattro momenti" }],
  fields: [field("script", "Parola calligrafica", "momenti"), field("caption", "Didascalia", "Uno dopo l'altro")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = 44;
    const gap = 12;
    const w = (W - 2 * m - 3 * gap) / 4;
    const h = Math.min(H - s.v(430), w * 3.1);
    const top = s.v(120);
    for (let index = 0; index < 4; index += 1) s.photo(index, { x: m + index * (w + gap), y: top + (index % 2) * s.v(50), w, h });
    let cursor = top + h + s.v(84);
    if (has(t.script)) cursor = s.text({ x: m, y: cursor, w: W - 2 * m, text: t.script, font: "script", sizePx: 84, color: pal.accent, align: "center", lineHeight: 1.05 }).bottom + 4;
    footer(s, t.caption, cursor);
    return { background: s.ground, layers: s.layers };
  },
};

const hero3: SlideTemplate = {
  id: "sh-hero3", set: "shared", role: "collage", label: "Una grande, due piccole", note: "Una foto larga in alto e due sotto", tone: "light", slots: ["landscape", "any", "any"],
  variants: [{ kicker: "Dettagli", caption: "Quello che non si dimentica" }],
  fields: [field("kicker", "Sopra", "Il racconto"), field("caption", "Didascalia", "Il momento e quello che lo circonda")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    const gap = 12;
    if (has(t.kicker)) s.caps({ x: m, y: s.v(84), w: W - 2 * m, text: t.kicker, color: pal.accent, align: "center", sizePx: 19, trackingEm: 0.42 });
    const top = s.v(140);
    const bigH = (H - s.v(420)) * 0.58;
    s.photo(0, { x: m, y: top, w: W - 2 * m, h: bigH });
    const smallH = H - s.v(420) - bigH - gap;
    const w = (W - 2 * m - gap) / 2;
    s.photo(1, { x: m, y: top + bigH + gap, w, h: smallH });
    s.photo(2, { x: m + w + gap, y: top + bigH + gap, w, h: smallH });
    footer(s, t.caption, top + bigH + gap + smallH + s.v(56));
    return { background: s.ground, layers: s.layers };
  },
};

const polaroid3: SlideTemplate = {
  id: "sh-polaroid3", set: "shared", role: "moment", label: "Tre polaroid", note: "Tre foto con cornice bianca, sparse e inclinate", tone: "light", slots: ["any", "any", "any"],
  variants: [{ script: "ricordi sparsi", label: "Sul tavolo" }],
  fields: [field("script", "Parola calligrafica", "ricordi"), field("label", "Didascalia", "Dal nostro archivio")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const w = W * 0.5;
    const h = Math.min(w * 1.05, H * 0.27);
    const border = { w: 22, color: "#ffffff" };
    s.photo(0, { x: W * 0.07, y: s.v(110), w, h }, { border, shadow: true, rotation: -5 });
    s.photo(1, { x: W * 0.42, y: s.v(110) + h * 0.55, w, h }, { border, shadow: true, rotation: 4 });
    s.photo(2, { x: W * 0.12, y: s.v(110) + h * 1.2, w, h }, { border, shadow: true, rotation: -2 });
    const bottom = s.v(110) + h * 2.2 + s.v(60);
    if (has(t.script)) s.text({ x: 60, y: Math.min(bottom, H - s.v(250)), w: W - 120, text: t.script, font: "script", sizePx: 84, color: pal.accent, align: "center", lineHeight: 1.05, rotation: -2 });
    footer(s, t.label, H - s.v(110));
    return { background: s.ground, layers: s.layers };
  },
};

const polaroid4: SlideTemplate = {
  id: "sh-polaroid4", set: "shared", role: "moment", label: "Quattro polaroid", note: "Quattro stampe con cornice bianca, due per due", tone: "dark", slots: ["any", "any", "any", "any"],
  variants: [{ script: "tutti insieme", label: "Una pila di ricordi" }],
  fields: [field("script", "Parola calligrafica", "insieme"), field("label", "Didascalia", "Una pila di ricordi")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const w = W * 0.42;
    const h = Math.min(w * 1.1, (H - s.v(380)) / 2);
    const border = { w: 20, color: "#ffffff" };
    const tilt = [-4, 3, 2, -3];
    for (let index = 0; index < 4; index += 1) {
      s.photo(index, { x: W * 0.06 + (index % 2) * W * 0.46, y: s.v(110) + Math.floor(index / 2) * (h + s.v(36)), w, h }, { border, shadow: true, rotation: tilt[index] });
    }
    const y = s.v(110) + 2 * h + s.v(120);
    if (has(t.script)) s.text({ x: 60, y, w: W - 120, text: t.script, font: "script", sizePx: 84, color: pal.accent, align: "center", lineHeight: 1.05 });
    footer(s, t.label, H - s.v(100));
    return { background: s.ground, layers: s.layers };
  },
};

const film4: SlideTemplate = {
  id: "sh-film4", set: "shared", role: "collage", label: "Pellicola a quattro", note: "Quattro fotogrammi in fila su una striscia scura", tone: "dark", slots: ["any", "any", "any", "any"],
  variants: [{ caption: "Fotogramma dopo fotogramma" }],
  fields: [field("caption", "Didascalia", "Quattro fotogrammi")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const stripW = W * 0.62;
    const x = (W - stripW) / 2;
    s.rect({ x: x - 26, y: 0, w: stripW + 52, h: H, fill: "#000000", opacity: ctx.tone === "dark" ? 0.55 : 0.88 });
    const top = s.v(96);
    const gap = 14;
    const h = (H - top - s.v(210) - 3 * gap) / 4;
    for (let index = 0; index < 4; index += 1) s.photo(index, { x, y: top + index * (h + gap), w: stripW, h });
    for (let index = 0; index < 14; index += 1) {
      const y = s.v(40) + index * ((H - s.v(80)) / 13);
      s.rect({ x: x - 18, y, w: 8, h: 16, fill: pal.light, opacity: 0.5, radius: 2 });
      s.rect({ x: x + stripW + 10, y, w: 8, h: 16, fill: pal.light, opacity: 0.5, radius: 2 });
    }
    if (has(ctx.texts.caption)) s.caps({ x: 40, y: H - s.v(120), w: W - 80, text: ctx.texts.caption, color: s.ink, align: "center", sizePx: 18, trackingEm: 0.4, opacity: 0.85 });
    return { background: s.ground, layers: s.layers };
  },
};

const row3: SlideTemplate = {
  id: "sh-row3", set: "shared", role: "collage", label: "Tre ritratti e un titolo", note: "Un titolo grande e tre foto verticali sotto", tone: "dark", slots: ["portrait", "portrait", "portrait"],
  variants: [{ title: "Il tuo\nmomento", caption: "Tre volti" }],
  fields: [field("title", "Titolo", "Tre\nvolti", true), field("caption", "Didascalia", "Gli sguardi che restano")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = 48;
    const gap = 12;
    let cursor = s.v(96);
    if (has(t.title)) {
      const title = s.headline({ x: m, y: cursor, w: W - 2 * m, text: t.title, font: "display", max: 120, min: 40, color: s.ink, align: "center", lineHeight: 0.98, uppercase: true });
      cursor = title.bottom + s.v(36);
    }
    const w = (W - 2 * m - 2 * gap) / 3;
    const h = Math.max(w * 1.2, H - cursor - s.v(200));
    for (let index = 0; index < 3; index += 1) s.photo(index, { x: m + index * (w + gap), y: cursor + (index === 1 ? s.v(40) : 0), w, h: index === 1 ? h - s.v(40) : h });
    s.line({ x1: W / 2 - 30, y1: cursor + h + s.v(34), x2: W / 2 + 30, y2: cursor + h + s.v(34), stroke: pal.accent, strokeW: 2 });
    footer(s, t.caption, cursor + h + s.v(60));
    return { background: s.ground, layers: s.layers };
  },
};

const circles3: SlideTemplate = {
  id: "sh-circles3", set: "shared", role: "collage", label: "Tre cerchi", note: "Tre foto tonde, una più grande, intrecciate", tone: "light", slots: ["any", "any", "any"],
  variants: [{ script: "a cerchio", caption: "Tre sguardi" }],
  fields: [field("script", "Parola calligrafica", "insieme"), field("caption", "Didascalia", "Tre momenti che girano intorno")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const big = W * 0.58;
    const small = W * 0.4;
    const top = s.v(110);
    s.ellipse({ x: W * 0.06 - 18, y: top - 18, w: big + 36, h: big + 36, stroke: pal.accent, strokeW: 2, opacity: 0.7 });
    s.photo(0, { x: W * 0.06, y: top, w: big, h: big }, { mask: "ellipse", shadow: true });
    s.photo(1, { x: W - small - W * 0.06, y: top + big * 0.62, w: small, h: small }, { mask: "ellipse", border: { w: 14, color: "#ffffff" }, shadow: true });
    s.photo(2, { x: W * 0.12, y: top + big + small * 0.25, w: small * 0.82, h: small * 0.82 }, { mask: "ellipse", border: { w: 14, color: "#ffffff" }, shadow: true });
    const y = Math.min(H - s.v(250), top + big + small * 0.25 + small * 0.82 + s.v(20));
    if (has(t.script)) s.text({ x: W * 0.46, y, w: W * 0.5, text: t.script, font: "script", sizePx: 78, color: pal.accent, align: "center", lineHeight: 1.05, rotation: -3 });
    footer(s, t.caption, H - s.v(96));
    return { background: s.ground, layers: s.layers };
  },
};

const stack4: SlideTemplate = {
  id: "sh-stack4", set: "shared", role: "collage", label: "Collage sovrapposto", note: "Quattro foto una sull'altra, con bordo e ombra", tone: "light", slots: ["any", "any", "any", "any"],
  variants: [{ kicker: "Un po' di tutto", caption: "Le cose belle si accumulano" }],
  fields: [field("kicker", "Sopra", "Un po' di tutto"), field("caption", "Didascalia", "Le cose belle si accumulano")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    if (has(t.kicker)) s.caps({ x: s.margin, y: s.v(84), w: W - 2 * s.margin, text: t.kicker, color: pal.accent, align: "center", sizePx: 19, trackingEm: 0.42 });
    const border = { w: 18, color: "#ffffff" };
    const w = W * 0.52;
    const h = Math.min(w * 1.05, (H - s.v(330)) * 0.52);
    const top = s.v(150);
    s.photo(0, { x: W * 0.06, y: top, w, h }, { border, shadow: true, rotation: -4 });
    s.photo(1, { x: W * 0.42, y: top + h * 0.28, w, h }, { border, shadow: true, rotation: 3 });
    s.photo(2, { x: W * 0.08, y: top + h * 0.95, w, h }, { border, shadow: true, rotation: 2 });
    s.photo(3, { x: W * 0.4, y: top + h * 1.2, w: w * 0.92, h: h * 0.92 }, { border, shadow: true, rotation: -3 });
    footer(s, t.caption, H - s.v(96));
    return { background: s.ground, layers: s.layers };
  },
};

const arches3: SlideTemplate = {
  id: "sh-arches3", set: "shared", role: "collage", label: "Tre archi", note: "Tre foto verticali ad arco, a quote diverse", tone: "light", slots: ["portrait", "portrait", "portrait"],
  variants: [{ script: "sotto l'arco", kicker: "Tre ritratti" }],
  fields: [field("script", "Parola calligrafica", "sotto l'arco"), field("kicker", "Sotto", "Ritratti")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = 50;
    const gap = 18;
    const w = (W - 2 * m - 2 * gap) / 3;
    const h = Math.min(w * 1.9, H - s.v(470));
    const top = s.v(200);
    const lift = [s.v(40), 0, s.v(80)];
    for (let index = 0; index < 3; index += 1) s.photo(index, { x: m + index * (w + gap), y: top + lift[index], w, h }, { mask: "arch", shadow: true });
    if (has(t.script)) s.text({ x: 40, y: s.v(60), w: W - 80, text: t.script, font: "script", sizePx: 92, color: pal.accent, align: "center", lineHeight: 1, rotation: -2 });
    footer(s, t.kicker, top + h + s.v(130));
    return { background: s.ground, layers: s.layers };
  },
};

const lead3: SlideTemplate = {
  id: "sh-lead3", set: "shared", role: "collage", label: "Una alta e due basse", note: "Foto verticale a sinistra, due foto a destra e una frase", tone: "dark", slots: ["portrait", "any", "any"],
  variants: [{ title: "Piccole\ncose", body: "Quello che resta, alla fine, sono i dettagli." }],
  fields: [field("title", "Titolo", "Il resto\nè luce", true), field("body", "Testo", "Tra una posa e l'altra, quello che conta succede da solo.", true)],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = 44;
    const gap = 12;
    const left = (W - 2 * m - gap) * 0.54;
    const right = W - 2 * m - gap - left;
    const top = m;
    const bottom = H - s.v(110);
    s.photo(0, { x: m, y: top, w: left, h: bottom - top });
    const photoH = (bottom - top - s.v(260) - 2 * gap) / 2;
    s.photo(1, { x: m + left + gap, y: top, w: right, h: photoH });
    s.photo(2, { x: m + left + gap, y: top + photoH + gap, w: right, h: photoH });
    let cursor = top + 2 * photoH + 2 * gap + s.v(30);
    const x = m + left + gap + 8;
    const w = right - 16;
    if (has(t.title)) cursor = s.headline({ x, y: cursor, w, text: t.title, font: "display", max: 56, min: 24, color: s.ink, lineHeight: 1.05 }).bottom + 14;
    s.line({ x1: x, y1: cursor, x2: x + 44, y2: cursor, stroke: pal.accent, strokeW: 3 });
    if (has(t.body)) s.text({ x, y: cursor + 20, w, text: t.body, font: "body", sizePx: 19, color: s.ink, lineHeight: 1.5, opacity: 0.85 });
    return { background: s.ground, layers: s.layers };
  },
};

const wall4: SlideTemplate = {
  id: "sh-wall4", set: "shared", role: "collage", label: "Quattro cornici", note: "Quattro foto in cornice sottile su un fondo a pannello", tone: "light", slots: ["landscape", "portrait", "portrait", "landscape"],
  variants: [{ kicker: "La parete", caption: "Come quadri appesi" }],
  fields: [field("kicker", "Sopra", "La parete"), field("caption", "Didascalia", "Come quadri appesi")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = 60;
    s.rect({ x: m - 16, y: s.v(130) - 16, w: W - 2 * m + 32, h: H - s.v(130) - s.v(210) + 32, fill: pal.soft, opacity: ctx.tone === "dark" ? 0.22 : 0.5 });
    if (has(t.kicker)) s.caps({ x: m, y: s.v(80), w: W - 2 * m, text: t.kicker, color: pal.accent, align: "center", sizePx: 19, trackingEm: 0.42 });
    const gap = 16;
    const top = s.v(130);
    const innerH = H - s.v(130) - s.v(210);
    const wide = (innerH - gap) * 0.4;
    const tall = innerH - gap - wide;
    const leftW = (W - 2 * m - gap) * 0.5;
    const rightW = W - 2 * m - gap - leftW;
    const border = { w: 8, color: "#ffffff" };
    s.photo(0, { x: m, y: top, w: leftW, h: wide }, { border });
    s.photo(1, { x: m + leftW + gap, y: top, w: rightW, h: tall }, { border });
    s.photo(2, { x: m, y: top + wide + gap, w: leftW, h: tall }, { border });
    s.photo(3, { x: m + leftW + gap, y: top + tall + gap, w: rightW, h: wide }, { border });
    footer(s, t.caption, H - s.v(150));
    return { background: s.ground, layers: s.layers };
  },
};

const cinema3: SlideTemplate = {
  id: "sh-letter3", set: "shared", role: "collage", label: "Tre fotogrammi larghi", note: "Tre foto panoramiche a tutta larghezza con bande scure", tone: "dark", slots: ["landscape", "landscape", "landscape"],
  variants: [{ caption: "Scena dopo scena" }],
  fields: [field("caption", "Didascalia", "Tre scene"), field("kicker", "Sopra", "Atto I")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const h = (H - s.v(360)) / 3;
    const top = s.v(150);
    for (let index = 0; index < 3; index += 1) s.photo(index, { x: 0, y: top + index * (h + 8), w: W, h });
    if (has(t.kicker)) s.caps({ x: s.margin, y: s.v(80), w: W - 2 * s.margin, text: t.kicker, color: pal.accent, align: "center", sizePx: 19, trackingEm: 0.42 });
    footer(s, t.caption, top + 3 * h + 16 + s.v(50));
    return { background: s.ground, layers: s.layers };
  },
};

export const MULTI: readonly SlideTemplate[] = [mosaic4, columns4, hero3, polaroid3, polaroid4, film4, row3, circles3, stack4, arches3, lead3, wall4, cinema3];
