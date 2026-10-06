import { readableOn } from "../brand";
import { Scene } from "../kit";
import type { SlideTemplate } from "../types";
import { field, handleOf, has, studioOf } from "./common";

/**
 * Stile «Moda»: riquadri di colore sfalsati dietro le foto, cornici sottili che le sfiorano, ritagli circolari che escono dal bordo,
 * badge e pulsanti a pillola con l'accento. Per cataloghi, presentazioni di servizi e promozioni.
 */

const cover: SlideTemplate = {
  id: "mo-cover", set: "moda", role: "cover", label: "Copertina con cornice", note: "Nome in alto, foto larga con una cornice sfalsata", tone: "dark", slots: ["landscape"],
  fields: [
    field("title", "Nome", ({ brand, albumName }) => studioOf(brand, albumName)),
    field("script", "Parola calligrafica", "storie da ricordare"),
    field("caption", "Didascalia", "Sfoglia il portfolio"),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    let cursor = s.v(190);
    if (has(t.title)) {
      const title = s.headline({ x: m, y: cursor, w: W - 2 * m, text: t.title, font: "display", max: 104, min: 40, color: s.ink, align: "center", lineHeight: 1.05 });
      cursor = title.bottom - 14;
    }
    if (has(t.script)) {
      const script = s.text({ x: m, y: cursor, w: W - 2 * m, text: t.script, font: "script", sizePx: 70, color: pal.accent, align: "center", lineHeight: 1.1, rotation: -2 });
      cursor = script.bottom;
    }
    const px = W * 0.1;
    const pw = W * 0.8;
    const ph = Math.min(s.v(660), H - cursor - s.v(300));
    const py = cursor + s.v(70);
    s.rect({ x: px - 22, y: py + 22, w: pw, h: ph, stroke: pal.accent, strokeW: 2 });
    s.photo(0, { x: px, y: py, w: pw, h: ph }, { shadow: true });
    if (has(t.caption)) s.caps({ x: m, y: py + ph + s.v(72), w: W - 2 * m, text: t.caption, color: s.ink, align: "center", sizePx: 19, trackingEm: 0.4, opacity: 0.8 });
    s.ellipse({ x: W / 2 - 5, y: H - s.v(110), w: 10, h: 10, fill: pal.accent });
    return { background: s.ground, layers: s.layers };
  },
};

const offset: SlideTemplate = {
  id: "mo-offset", set: "moda", role: "hero", label: "Riquadro e colonna colorata", note: "Foto verticale su una colonna di colore con riquadro informativo", tone: "dark", slots: ["portrait"],
  variants: [{ label: "Il nostro metodo", body: "Ascolto, osservazione e tempo: così nasce una foto che somiglia davvero alle persone." }],
  fields: [
    field("label", "Etichetta", "Chi siamo"),
    field("body", "Testo", "Raccontiamo storie vere con uno sguardo discreto: niente pose forzate, solo il momento giusto, al posto giusto.", true),
    field("button", "Pulsante", ({ brand }) => handleOf(brand)),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    s.rect({ x: W * 0.6, y: 0, w: W * 0.4, h: H * 0.9, fill: pal.soft, opacity: 0.55 });
    s.rect({ x: W * 0.06, y: s.v(110), w: W * 0.56, h: H - s.v(260), stroke: s.ink, strokeW: 2, opacity: 0.55 });
    s.photo(0, { x: W * 0.46, y: s.v(190), w: W * 0.42, h: H - s.v(420) }, { shadow: true });
    const boxW = W * 0.36;
    const box = s.rect({ x: W * 0.1, y: s.v(330), w: boxW, h: 100, fill: pal.accent });
    const onAccent = readableOn(pal.accent, pal.dark, pal.light);
    let cursor = s.v(330) + 40;
    if (has(t.label)) {
      const label = s.caps({ x: W * 0.1 + 34, y: cursor, w: boxW - 68, text: t.label, color: onAccent, sizePx: 19, trackingEm: 0.3, weight: 600 });
      cursor = label.bottom + 18;
    }
    if (has(t.body)) {
      const body = s.text({ x: W * 0.1 + 34, y: cursor, w: boxW - 68, text: t.body, font: "body", sizePx: 21, color: onAccent, lineHeight: 1.5 });
      cursor = body.bottom + 30;
    }
    if (has(t.button)) {
      const button = s.pill({ cx: W * 0.1 + boxW / 2, y: cursor, label: t.button, fill: onAccent, color: pal.accent, sizePx: 16, padX: 26 });
      cursor = button.y + button.h;
    }
    box.h = Math.round(cursor + 40 - box.y);
    return { background: s.ground, layers: s.layers };
  },
};

const circle: SlideTemplate = {
  id: "mo-circle", set: "moda", role: "moment", label: "Cerchio che esce dal bordo", note: "Foto tonda tagliata dal bordo, badge e titolo in basso", tone: "dark", slots: ["any", "any"],
  variants: [{ title: "Luce\ndi stagione", badge: "Edizione\nspeciale", body: "Dal tramonto alla sera, ogni scena ha la sua luce." }],
  fields: [
    field("title", "Titolo", "Momenti\nspeciali", true),
    field("badge", "Badge", "Nuovo\nalbum", true),
    field("body", "Testo", "Dalla preparazione al brindisi finale.", true),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    const d = W * 1.02;
    s.photo(0, { x: -W * 0.22, y: -s.v(190), w: d, h: d }, { mask: "ellipse" });
    if (has(t.badge)) s.badge({ cx: W * 0.82, cy: s.v(360), r: 78, lines: t.badge.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 3), fill: pal.accent, color: readableOn(pal.accent, pal.dark, pal.light), rotation: 10 });
    const thumbW = W * 0.27;
    s.photo(1, { x: W - m - thumbW, y: H - s.v(430), w: thumbW, h: thumbW * 1.25 }, { border: { w: 8, color: pal.light }, shadow: true });
    let bottom = H - m - s.v(40);
    if (has(t.body)) {
      const body = s.text({ x: m, y: 0, w: W * 0.54, text: t.body, font: "body", sizePx: 23, color: s.ink, lineHeight: 1.5, opacity: 0.85 });
      bottom = s.move(body, bottom - body.height).top - s.v(24);
    }
    if (has(t.title)) {
      const title = s.headline({ x: m, y: 0, w: W * 0.58, text: t.title, font: "display", max: 96, min: 38, color: s.ink, lineHeight: 1.02 });
      s.move(title, bottom - title.height);
    }
    return { background: s.ground, layers: s.layers };
  },
};

const lookbook: SlideTemplate = {
  id: "mo-lookbook", set: "moda", role: "collage", label: "Titolo e due foto sfalsate", note: "Due foto verticali, titolo e pulsante con l'accento", tone: "dark", slots: ["portrait", "portrait"],
  variants: [{ title: "Atelier", script: "fatto a mano", body: "Ogni album nasce da una selezione lenta, foto per foto, con la stessa cura di un abito." }],
  fields: [
    field("title", "Titolo", "Portfolio"),
    field("script", "Parola calligrafica", "scelte dello studio"),
    field("body", "Testo", "Una selezione di ritratti e momenti vissuti, scelti uno a uno.", true),
    field("button", "Pulsante", ({ brand }) => handleOf(brand)),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    s.photo(0, { x: W * 0.54, y: s.v(60), w: W * 0.4, h: s.v(470) });
    if (has(t.title)) {
      const title = s.headline({ x: m, y: s.v(150), w: W * 0.44, text: t.title, font: "display", max: 84, min: 36, color: s.ink, lineHeight: 1.05 });
      if (has(t.script)) s.text({ x: m, y: title.bottom - 10, w: W * 0.44, text: t.script, font: "script", sizePx: 54, color: pal.accent, lineHeight: 1.1, rotation: -3 });
    }
    const p2 = { x: W * 0.07, y: s.v(470), w: W * 0.48, h: s.v(720) };
    s.photo(1, p2, { shadow: true });
    let cursor = s.v(700);
    const textX = p2.x + p2.w + 40;
    const textW = W - textX - m;
    s.line({ x1: textX, y1: cursor - 26, x2: textX + 60, y2: cursor - 26, stroke: pal.accent, strokeW: 3 });
    if (has(t.body)) {
      const body = s.text({ x: textX, y: cursor, w: textW, text: t.body, font: "body", sizePx: 20, color: s.ink, lineHeight: 1.55, opacity: 0.85 });
      cursor = body.bottom + 30;
    }
    if (has(t.button)) s.pill({ cx: textX + Math.min(textW / 2, 120), y: cursor, label: t.button, fill: pal.accent, color: readableOn(pal.accent, pal.dark, pal.light), sizePx: 15, padX: 24 });
    return { background: s.ground, layers: s.layers };
  },
};

const panel: SlideTemplate = {
  id: "mo-panel", set: "moda", role: "hero", label: "Colonna colorata e titolo", note: "Foto su una colonna tenue con titolo e pulsante a destra", tone: "dark", slots: ["portrait"],
  variants: [{ title: "I nostri\ndettagli", body: "Mani, tessuti, luce di traverso: sono i particolari a far somigliare le foto a chi le guarda.", badge: "Da\nvedere" }],
  fields: [
    field("title", "Titolo", "Il nostro\nstile", true),
    field("body", "Testo", "Luce naturale, pose spontanee e una cura quasi sartoriale per ogni dettaglio.", true),
    field("button", "Pulsante", "Scopri di più"),
    field("badge", "Badge", "Su\nmisura", true),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    s.rect({ x: 0, y: s.v(150), w: W * 0.46, h: H - s.v(300), fill: pal.soft, opacity: 0.5 });
    s.photo(0, { x: W * 0.1, y: s.v(270), w: W * 0.4, h: H - s.v(540) }, { shadow: true });
    const textX = W * 0.56;
    const textW = W - textX - m;
    let cursor = s.v(360);
    if (has(t.title)) {
      const title = s.headline({ x: textX, y: cursor, w: textW, text: t.title, font: "display", max: 84, min: 34, color: s.ink, lineHeight: 1.04 });
      cursor = title.bottom + 28;
    }
    if (has(t.body)) {
      const body = s.text({ x: textX, y: cursor, w: textW, text: t.body, font: "body", sizePx: 21, color: s.ink, lineHeight: 1.55, opacity: 0.85 });
      cursor = body.bottom + 34;
    }
    if (has(t.button)) s.pill({ cx: textX + Math.min(textW / 2, 130), y: cursor, label: t.button, fill: pal.accent, color: readableOn(pal.accent, pal.dark, pal.light), sizePx: 16, padX: 26 });
    if (has(t.badge)) s.badge({ cx: W * 0.47, cy: s.v(300), r: 62, lines: t.badge.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 3), fill: pal.accent, color: readableOn(pal.accent, pal.dark, pal.light), rotation: -10 });
    s.pageMark({ x: m, y: s.v(70), w: 220, align: "left", color: s.ink });
    return { background: s.ground, layers: s.layers };
  },
};

export const MODA: readonly SlideTemplate[] = [cover, offset, circle, lookbook, panel];
