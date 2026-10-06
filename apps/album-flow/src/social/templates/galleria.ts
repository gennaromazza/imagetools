import { Scene, sprigPath } from "../kit";
import type { SlideTemplate } from "../types";
import { field, handleOf, has, studioOf } from "./common";

/**
 * Stile «Galleria»: carta chiara con una cornice sottile, collage sfalsati, foto con bordo bianco che si sovrappongono,
 * titoli in maiuscolo con parole calligrafiche e una firma con ramoscello. Pensato per far respirare le foto.
 */

/** Cornice sottile attorno alla pagina. */
export function frame(s: Scene): void {
  s.rect({ x: 40, y: 40, w: s.width - 80, h: s.height - 80, stroke: s.ink, strokeW: 1.5, opacity: 0.35 });
}

/** Firma in fondo: nome dello studio tra due filetti, con un ramoscello sotto. */
export function signature(s: Scene, label: string, field?: string): void {
  const { width: W, height: H } = s;
  const y = H - s.v(118);
  const size = 17;
  const tracking = 0.5;
  const textW = s.textWidth(label, "body", size, { trackingEm: tracking, uppercase: true });
  s.caps({ ...(field ? { field } : {}), x: W / 2 - 300, y, w: 600, text: label, color: s.ink, align: "center", sizePx: size, trackingEm: tracking, opacity: 0.8 });
  const lineY = y + size * 0.62;
  const gap = textW / 2 + 28;
  s.line({ x1: W / 2 - gap - 190, y1: lineY, x2: W / 2 - gap, y2: lineY, stroke: s.ink, strokeW: 1.2, opacity: 0.35 });
  s.line({ x1: W / 2 + gap, y1: lineY, x2: W / 2 + gap + 190, y2: lineY, stroke: s.ink, strokeW: 1.2, opacity: 0.35 });
  const sprig = sprigPath(W / 2, y + 62, 92);
  s.path({ d: sprig.stem, stroke: s.ink, strokeW: 1.6, opacity: 0.7 });
  s.path({ d: sprig.leaves, fill: s.ink, opacity: 0.7 });
}

const collage: SlideTemplate = {
  id: "ga-collage", set: "galleria", role: "cover", label: "Copertina collage", note: "Titolo e cinque foto sfalsate nella cornice", tone: "light", slots: ["any", "any", "portrait", "landscape", "portrait"],
  fields: [
    field("title", "Titolo", ({ albumName }) => albumName || "Noi"),
    field("sub", "Sottotitolo", "il motivo per cui sorrido, amo, respiro, vivo"),
    field("foot", "Firma", ({ brand, albumName }) => studioOf(brand, albumName)),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W } = ctx;
    const t = ctx.texts;
    frame(s);
    let cursor = s.v(104);
    if (has(t.title)) {
      const title = s.headline({ field: "title", x: 140, y: cursor, w: W - 280, text: t.title, font: "display", max: 124, min: 44, weight: 700, color: s.ink, align: "center", lineHeight: 1, uppercase: true });
      cursor = title.bottom + 10;
    }
    if (has(t.sub)) s.text({ x: 200, y: cursor, w: W - 400, text: t.sub, font: "body", sizePx: 21, color: s.ink, align: "center", lineHeight: 1.4, opacity: 0.8 });
    const tiles = [
      { x: 262, y: 286, w: 396, h: 436 }, { x: 690, y: 470, w: 214, h: 240 }, { x: 160, y: 752, w: 296, h: 346 },
      { x: 486, y: 752, w: 418, h: 208 }, { x: 486, y: 986, w: 268, h: 196 },
    ];
    tiles.forEach((tile, slot) => s.photo(slot, { x: tile.x, y: s.v(tile.y), w: tile.w, h: s.v(tile.h) }));
    signature(s, t.foot ?? "", "foot");
    return { background: s.ground, layers: s.layers };
  },
};

const saveDate: SlideTemplate = {
  id: "ga-savedate", set: "galleria", role: "collage", label: "Invito a quattro foto", note: "Foto con bordo bianco sovrapposte e data in basso", tone: "light", slots: ["portrait", "landscape", "portrait", "landscape"],
  variants: [{ script: "Ricordatevi", title: "La festa", invite: "vi aspettano per festeggiare", date: "Domenica 14 giugno 2026", place: "Masseria Il Fico, Lecce" }],
  fields: [
    field("script", "Parola calligrafica", "Segnatevi"),
    field("title", "Titolo", "Il giorno"),
    field("names", "Nomi", ({ albumName }) => albumName || "Marta & Luca"),
    field("invite", "Invito", "vi invitano a festeggiare con loro"),
    field("date", "Data", "Sabato 22 marzo 2028"),
    field("place", "Luogo", "Villa dei Cipressi, Firenze"),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { height: H, pal } = ctx;
    const t = ctx.texts;
    frame(s);
    const white = { w: 12, color: "#ffffff" };
    s.photo(0, { x: 566, y: s.v(118), w: 410, h: s.v(560) });
    s.photo(1, { x: 92, y: s.v(392), w: 480, h: s.v(330) }, { border: white, shadow: true });
    s.photo(2, { x: 92, y: s.v(752), w: 338, h: s.v(450) });
    s.photo(3, { x: 456, y: s.v(700), w: 520, h: s.v(344) }, { border: white, shadow: true });
    if (has(t.script)) s.text({ x: 92, y: s.v(124), w: 440, text: t.script, font: "script", sizePx: 98, color: pal.accent, lineHeight: 1, rotation: -5 });
    if (has(t.title)) s.headline({ x: 92, y: s.v(214), w: 440, text: t.title, font: "display", max: 112, min: 44, color: s.ink, uppercase: true, lineHeight: 1 });
    let cursor = s.v(1074);
    if (has(t.names)) {
      const names = s.headline({ x: 456, y: cursor, w: 520, text: t.names, font: "display", max: 42, min: 22, color: s.ink, align: "center", uppercase: true, trackingEm: 0.05 });
      cursor = names.bottom + 6;
    }
    if (has(t.invite)) {
      const invite = s.text({ x: 456, y: cursor, w: 520, text: t.invite, font: "script", sizePx: 40, color: s.ink, align: "center", lineHeight: 1.1 });
      cursor = invite.bottom + 12;
    }
    if (has(t.date)) {
      const date = s.caps({ x: 456, y: cursor, w: 520, text: t.date, color: s.ink, align: "center", sizePx: 18, trackingEm: 0.2, weight: 600 });
      cursor = date.bottom + 6;
    }
    if (has(t.place) && cursor < H - 80) s.caps({ x: 456, y: cursor, w: 520, text: t.place, color: s.ink, align: "center", sizePx: 16, trackingEm: 0.18, opacity: 0.8 });
    return { background: s.ground, layers: s.layers };
  },
};

const editorial: SlideTemplate = {
  id: "ga-editorial", set: "galleria", role: "collage", label: "Racconto in tre foto", note: "Tre foto larghe, testo a bandiera e titolo che le sovrappone", tone: "light", slots: ["landscape", "landscape", "landscape"],
  variants: [{ words: "Sguardi   Silenzi   Risate   Abbracci", body: "Tra una posa e l'altra succede la vita: noi stiamo lì, a un passo, e aspettiamo che accada.", title: "Piccoli\nistanti", foot: "Il giorno, visto da vicino" }],
  fields: [
    field("words", "Quattro parole sulla prima foto", "Romanticismo   Dedizione   Tenerezza   Complicità"),
    field("body", "Paragrafo", "Dal primo momento in cui ci siamo incontrati ho capito che c'era qualcosa di straordinario in te. Insieme abbiamo costruito fiducia e rispetto.", true),
    field("title", "Titolo", "Sussurri\nd'amore", true),
    field("foot", "Piè di pagina", "Una raccolta di emozioni, fotografata con calma"),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const p1 = { x: 48, y: s.v(60), w: W - 96, h: s.v(360) };
    s.photo(0, p1);
    const words = (t.words ?? "").split(/\s{2,}|\n/).map((word) => word.trim()).filter(Boolean).slice(0, 4);
    words.forEach((word, index) => {
      const slot = (p1.w - 120) / Math.max(words.length, 1);
      s.caps({ x: p1.x + 60 + index * slot, y: p1.y + p1.h / 2 - 10, w: slot, text: word, color: "#ffffff", sizePx: 19, trackingEm: 0.22, align: "center" });
    });
    const p2 = { x: 440, y: s.v(446), w: W - 440 - 48, h: s.v(310) };
    s.photo(1, p2);
    if (has(t.body)) s.text({ x: 72, y: p2.y + 24, w: 330, text: t.body, font: "display", sizePx: 20, color: s.ink, align: "right", lineHeight: 1.62, opacity: 0.92 });
    const p3 = { x: 92, y: s.v(782), w: W - 92 - 48, h: s.v(300) };
    s.photo(2, p3);
    if (has(t.title)) {
      let title = s.headline({ x: 60, y: 0, w: W - 120, text: t.title, font: "display", max: 140, min: 50, color: pal.accent, align: "center", uppercase: true, lineHeight: 0.86, trackingEm: 0.01 });
      title = s.move(title, p3.y + p3.h - title.layer.sizePx * 0.5);
      if (title.bottom > H - 96) s.move(title, H - 96 - title.height);
    }
    if (has(t.foot)) s.caps({ x: 60, y: H - 78, w: W - 120, text: t.foot, color: s.ink, align: "center", sizePx: 15, trackingEm: 0.22, opacity: 0.75 });
    return { background: s.ground, layers: s.layers };
  },
};

const solo: SlideTemplate = {
  id: "ga-solo", set: "galleria", role: "moment", label: "Una foto, un momento", note: "Foto grande con bordo bianco e una parola calligrafica", tone: "light", slots: ["any"],
  variants: [{ script: "un sorriso", label: "I preparativi" }, { script: "tra le mani", label: "I dettagli" }, { script: "per sempre", label: "Il brindisi" }],
  fields: [
    field("script", "Parola calligrafica", "un attimo per sempre"),
    field("label", "Didascalia", "La cerimonia"),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    frame(s);
    const w = W - 230;
    const h = Math.min(H * 0.62, w * 1.18);
    const x = (W - w) / 2;
    const y = s.v(150);
    s.photo(0, { x, y, w, h }, { border: { w: 14, color: "#ffffff" }, shadow: true });
    s.pageMark({ x: x, y: s.v(92), w: 300, align: "left", color: s.ink });
    if (has(t.label)) s.caps({ x: x + w - 400, y: s.v(92), w: 400, text: t.label, color: s.ink, align: "right", sizePx: 18, trackingEm: 0.3, opacity: 0.75 });
    if (has(t.script)) s.text({ x: 80, y: y + h + s.v(28), w: W - 160, text: t.script, font: "script", sizePx: 86, color: pal.accent, align: "center", lineHeight: 1.05, rotation: -2 });
    s.caps({ x: 80, y: H - s.v(104), w: W - 160, text: handleOf(ctx.brand), color: s.ink, align: "center", sizePx: 16, trackingEm: 0.4, opacity: 0.7 });
    return { background: s.ground, layers: s.layers };
  },
};

const pair: SlideTemplate = {
  id: "ga-pair", set: "galleria", role: "collage", label: "Due foto in dialogo", note: "Due ritratti verticali sfalsati con titolo e parola calligrafica", tone: "light", slots: ["portrait", "portrait"],
  variants: [{ title: "Due mani", script: "un solo passo", caption: "Il giorno intero" }],
  fields: [
    field("title", "Titolo", "Due sguardi"),
    field("script", "Parola calligrafica", "e un solo cuore"),
    field("caption", "Didascalia", "Il momento prima del sì"),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    frame(s);
    const white = { w: 12, color: "#ffffff" };
    s.photo(1, { x: 566, y: s.v(236), w: 418, h: s.v(640) }, { border: white, shadow: true });
    s.photo(0, { x: 96, y: s.v(404), w: 418, h: s.v(660) }, { border: white, shadow: true });
    if (has(t.title)) s.headline({ x: 96, y: s.v(108), w: W * 0.44, text: t.title, font: "display", max: 82, min: 34, color: s.ink, lineHeight: 1.04 });
    if (has(t.script)) {
      const script = s.text({ x: 540, y: s.v(930), w: 460, text: t.script, font: "script", sizePx: 72, color: pal.accent, align: "center", lineHeight: 1.05, rotation: -3 });
      if (has(t.caption)) s.caps({ x: 540, y: script.bottom + 26, w: 460, text: t.caption, color: s.ink, align: "center", sizePx: 16, trackingEm: 0.3, opacity: 0.75 });
    }
    s.pageMark({ x: 96, y: H - s.v(116), w: 300, align: "left", color: s.ink });
    return { background: s.ground, layers: s.layers };
  },
};

export const GALLERIA: readonly SlideTemplate[] = [collage, saveDate, editorial, pair, solo];
