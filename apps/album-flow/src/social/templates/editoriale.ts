import { monogramOf, readableOn } from "../brand";
import { Scene, balance, fitSize, linesOf } from "../kit";
import type { SlideTemplate } from "../types";
import { field, handleOf, has, studioOf } from "./common";

/**
 * Stile «Editoriale»: titoli giganti in maiuscolo, fondi scuri e crema che si alternano, testo che passa dietro e davanti alle foto,
 * recensioni, liste numerate e pulsanti. Ispirato ai caroselli dei fotografi di matrimonio: composizione, non copia.
 */

const cover: SlideTemplate = {
  id: "ed-cover", set: "editoriale", role: "cover", label: "Copertina titolo", note: "Titolo gigante su fondo pieno, senza foto", tone: "dark", slots: [],
  fields: [
    field("kicker", "Sopra il titolo", ({ brand, albumName }) => studioOf(brand, albumName).toUpperCase()),
    field("title", "Titolo", ({ albumName }) => albumName || "Il nostro giorno"),
    field("subtitle", "Sottotitolo", "Ogni storia comincia con un momento da ricordare"),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    s.monogram({ cx: W / 2, cy: s.v(150), r: 44, letter: monogramOf(ctx.brand.name || t.title), color: pal.accent });
    if (has(t.kicker)) s.caps({ field: "kicker", x: m, y: s.v(232), w: W - 2 * m, text: t.kicker, color: pal.accent, align: "center", sizePx: 20, trackingEm: 0.42 });
    let title = s.headline({ field: "title", x: m, y: 0, w: W - 2 * m, text: balance(t.title), font: "display", max: 240, min: 56, color: s.ink, align: "center", lineHeight: 0.95, uppercase: true, trackingEm: -0.005 });
    title = s.move(title, H * 0.47 - title.height / 2);
    const lineY = title.bottom + s.v(54);
    s.line({ x1: W / 2, y1: lineY, x2: W / 2, y2: lineY + s.v(96), stroke: pal.accent, strokeW: 2 });
    if (has(t.subtitle)) s.text({ x: W * 0.19, y: lineY + s.v(96) + s.v(34), w: W * 0.62, text: t.subtitle, font: "body", sizePx: 26, color: s.ink, align: "center", lineHeight: 1.45, opacity: 0.8 });
    s.caps({ x: m, y: H - m - s.v(62), w: W - 2 * m, text: "Scorri", color: s.ink, align: "center", sizePx: 18, trackingEm: 0.5, opacity: 0.75 });
    s.arrow({ x: W / 2 - 42, y: H - m - s.v(14), length: 84, color: pal.accent });
    return { background: s.ground, layers: s.layers };
  },
};

const hero: SlideTemplate = {
  id: "ed-hero", set: "editoriale", role: "hero", label: "Foto a tutta pagina", note: "Foto a bordo pieno con titolo grande in basso", tone: "dark", slots: ["portrait"],
  variants: [
    { script: "ogni", title: "Dettagli\nche restano", body: "Le piccole cose raccontano più di mille parole: uno sguardo, una mano, un sorriso." },
    { script: "solo", title: "Un giorno\nsolo nostro", body: "Il tempo si ferma e resta quello che conta davvero: le persone che amiamo." },
  ],
  fields: [
    field("script", "Parola calligrafica", "il nostro"),
    field("title", "Titolo", "Per sempre\ninizia qui", true),
    field("body", "Testo", "Ogni storia d'amore comincia con un momento, e ogni momento merita di essere ricordato.", true),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    s.photo(0, { x: 0, y: 0, w: W, h: H });
    s.gradient({ x: 0, y: H * 0.38, w: W, h: H * 0.62, from: pal.dark, fromOpacity: 0, to: pal.dark, toOpacity: 0.94, direction: "top" });
    const footY = H - m - s.v(6);
    s.line({ x1: m, y1: footY - s.v(34), x2: W - m, y2: footY - s.v(34), stroke: pal.light, strokeW: 1.5, opacity: 0.3 });
    s.caps({ x: m, y: footY - s.v(14), w: 220, text: "Salva", color: pal.light, sizePx: 17, opacity: 0.8 });
    s.caps({ x: W / 2 - 220, y: footY - s.v(14), w: 440, text: handleOf(ctx.brand), color: pal.light, align: "center", sizePx: 17, opacity: 0.8 });
    s.caps({ x: W - m - 220, y: footY - s.v(14), w: 220, text: "Condividi", color: pal.light, align: "right", sizePx: 17, opacity: 0.8 });
    let cursor = footY - s.v(34) - s.v(36);
    if (has(t.body)) {
      const body = s.text({ x: W * 0.12, y: 0, w: W * 0.76, text: t.body, font: "body", sizePx: 25, color: pal.light, align: "center", lineHeight: 1.45, opacity: 0.88 });
      cursor = s.move(body, cursor - body.height).top - s.v(34);
    }
    if (has(t.title)) {
      let title = s.headline({ x: m, y: 0, w: W - 2 * m, text: t.title, font: "display", max: 132, min: 44, color: pal.light, align: "center", lineHeight: 0.98, uppercase: true });
      title = s.move(title, cursor - title.height);
      if (has(t.script)) s.text({ x: m, y: title.top - 92, w: W - 2 * m, text: t.script, font: "script", sizePx: 104, color: pal.accent, align: "center", lineHeight: 1, rotation: -4 });
    }
    return { background: s.ground, layers: s.layers };
  },
};

const sandwich: SlideTemplate = {
  id: "ed-sandwich", set: "editoriale", role: "hero", label: "Foto tra due parole", note: "Una parola passa dietro la foto, l'altra davanti", tone: "dark", slots: ["portrait"],
  variants: [{ top: "Ogni", bottom: "Istante" }],
  fields: [
    field("top", "Parola in alto (dietro la foto)", "Per"),
    field("bottom", "Parola in basso (davanti)", "Sempre"),
    field("side1", "Scritta laterale sinistra", "Servizio fotografico completo"),
    field("side2", "Scritta laterale destra", ({ brand, albumName }) => studioOf(brand, albumName)),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const pw = W * 0.6;
    const ph = H * 0.6;
    const px = (W - pw) / 2;
    const py = (H - ph) / 2 + s.v(6);
    const wordWidth = W * 0.94;
    const sizes = [t.top, t.bottom].filter(has).map((value) => fitSize(ctx.measure, value, ctx.fonts.display, { width: wordWidth, max: 400, min: 80, uppercase: true }));
    const big = sizes.length ? Math.min(...sizes) : 200;
    if (has(t.top)) s.text({ x: (W - wordWidth) / 2, y: py - big * 0.56, w: wordWidth, text: t.top, font: "display", sizePx: big, color: s.ink, align: "center", lineHeight: 0.9, uppercase: true });
    s.photo(0, { x: px, y: py, w: pw, h: ph }, { shadow: true });
    if (has(t.bottom)) s.text({ x: (W - wordWidth) / 2, y: py + ph - big * 0.3, w: wordWidth, text: t.bottom, font: "display", sizePx: big, color: s.ink, align: "center", lineHeight: 0.9, uppercase: true });
    const sideW = H * 0.5;
    if (has(t.side1)) s.caps({ x: 46 - sideW / 2, y: H / 2 - 12, w: sideW, text: t.side1, color: s.ink, align: "center", sizePx: 15, trackingEm: 0.36, rotation: -90, opacity: 0.7 });
    if (has(t.side2)) s.caps({ x: W - 46 - sideW / 2, y: H / 2 - 12, w: sideW, text: t.side2, color: s.ink, align: "center", sizePx: 15, trackingEm: 0.36, rotation: 90, opacity: 0.7 });
    s.ellipse({ x: px + pw - 56, y: py + 38, w: 92, h: 92, fill: pal.light });
    s.text({ x: px + pw - 56, y: py + 38 + 22, w: 92, text: monogramOf(ctx.brand.name || t.side2), font: "script", sizePx: 52, color: pal.dark, align: "center", lineHeight: 1.1 });
    return { background: s.ground, layers: s.layers };
  },
};

const quote: SlideTemplate = {
  id: "ed-quote", set: "editoriale", role: "quote", label: "Recensione su foto", note: "Foto in bianco e nero con riquadro, stelle e frase", tone: "dark", slots: ["any"],
  variants: [{ heading: "Parole\ndi chi c'era", quote: "Ci avete fatto emozionare", body: "Ogni foto ci ha riportato lì, con il cuore in gola come quel giorno.", who: "Giulia e Marco" }],
  fields: [
    field("heading", "Titolo calligrafico", "Cosa dicono\ngli sposi", true),
    field("quote", "Frase", "Un giorno che non dimenticheremo"),
    field("body", "Testo", "Le foto hanno catturato ogni emozione, anche quelle che noi non avevamo visto.", true),
    field("who", "Firma", "Sofia e Luca"),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    s.photo(0, { x: 0, y: 0, w: W, h: H }, { mono: true, dim: 0.38 });
    const cardW = W * 0.78;
    const cardX = (W - cardW) / 2;
    const cardY = H * 0.43;
    const pad = 54;
    const card = s.rect({ x: cardX, y: cardY, w: cardW, h: 100, fill: pal.dark, opacity: 0.86, radius: 4 });
    s.stars({ cx: W / 2, y: cardY + pad, count: 5, radius: 15, fill: pal.accent });
    let cursor = cardY + pad + 30 + 40;
    if (has(t.quote)) {
      const quoteBlock = s.headline({ x: cardX + pad, y: cursor, w: cardW - 2 * pad, text: t.quote, font: "display", max: 58, min: 28, color: pal.light, align: "center", lineHeight: 1.12 });
      cursor = quoteBlock.bottom + 26;
    }
    if (has(t.body)) {
      const body = s.text({ x: cardX + pad, y: cursor, w: cardW - 2 * pad, text: t.body, font: "body", sizePx: 22, color: pal.light, align: "center", lineHeight: 1.5, opacity: 0.82 });
      cursor = body.bottom + 30;
    }
    if (has(t.who)) {
      const who = s.caps({ x: cardX + pad, y: cursor, w: cardW - 2 * pad, text: `— ${t.who}`, color: pal.accent, align: "center", sizePx: 19, trackingEm: 0.3 });
      cursor = who.bottom;
    }
    card.h = Math.round(cursor + pad - cardY);
    if (has(t.heading)) {
      const heading = s.text({ x: 40, y: 0, w: W - 80, text: t.heading, font: "script", sizePx: 92, color: pal.light, align: "center", lineHeight: 0.95 });
      s.move(heading, cardY - heading.height - s.v(26));
    }
    return { background: s.ground, layers: s.layers };
  },
};

const list: SlideTemplate = {
  id: "ed-list", set: "editoriale", role: "list", label: "Titolo, foto e lista", note: "Elenco numerato accanto a una foto verticale", tone: "light", slots: ["portrait"],
  variants: [{ kicker: "Consigli", title: "Cinque cose\nda sapere", items: "Scegli la luce giusta\nDai tempo alle emozioni\nNon rincorrere la posa\nCura i dettagli\nGoditi il giorno", foot: "Il resto lo facciamo noi" }],
  fields: [
    field("kicker", "Sopra il titolo", "Fotografia · Matrimonio"),
    field("title", "Titolo", "Come scegliere\nil fotografo\ngiusto", true),
    field("items", "Elenco (una voce per riga)", "Guarda l'album intero\nChiedi i tempi di consegna\nParla con chi ti fotografa\nControlla gli stili\nLeggi le recensioni\nFidati dell'istinto", true),
    field("foot", "Piè di pagina", "Ogni coppia merita foto che restano"),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    if (has(t.kicker)) s.caps({ x: m, y: s.v(70), w: W * 0.6, text: t.kicker, color: pal.accent, sizePx: 19, trackingEm: 0.34 });
    s.pageMark({ x: W - m - 200, y: s.v(70), w: 200, align: "right", color: s.ink });
    let cursor = s.v(120);
    if (has(t.title)) {
      const title = s.headline({ x: m, y: cursor, w: W - 2 * m, text: t.title, font: "display", max: 92, min: 40, color: s.ink, lineHeight: 1.02 });
      cursor = title.bottom;
    }
    const top = Math.max(cursor + s.v(50), s.v(430));
    const photoH = Math.min(H - top - s.v(150), s.v(660));
    const photoW = W * 0.38;
    s.photo(0, { x: m, y: top, w: photoW, h: photoH });
    const listX = m + photoW + 46;
    const items = linesOf(t.items ?? "").slice(0, 7);
    // Ogni voce si impila sotto la precedente (anche se va a capo), con uno spazio costante.
    let itemY = top + 8;
    for (const [index, item] of items.entries()) {
      s.caps({ x: listX, y: itemY + 8, w: 90, text: `${String(index + 1).padStart(2, "0")} //`, color: pal.accent, sizePx: 17, trackingEm: 0.12 });
      const line = s.text({ x: listX + 84, y: itemY, w: W - m - listX - 84, text: item, font: "display", sizePx: 31, color: s.ink, lineHeight: 1.15 });
      itemY = line.bottom + 34;
    }
    if (has(t.foot)) {
      s.line({ x1: m, y1: H - m - s.v(46), x2: W - m, y2: H - m - s.v(46), stroke: s.ink, strokeW: 1.5, opacity: 0.25 });
      s.caps({ x: m, y: H - m - s.v(24), w: W - 2 * m, text: t.foot, color: s.ink, align: "center", sizePx: 17, trackingEm: 0.3, opacity: 0.75 });
    }
    return { background: s.ground, layers: s.layers };
  },
};

const cta: SlideTemplate = {
  id: "ed-cta", set: "editoriale", role: "cta", label: "Chiusura con pulsante", note: "Nome gigante, foto che lo sovrappone e pulsante", tone: "light", slots: ["portrait"],
  fields: [
    field("kicker", "Sopra il nome", "Fotografia · Video"),
    field("title", "Nome", ({ brand, albumName }) => studioOf(brand, albumName)),
    field("button", "Pulsante", "Prenota una data"),
    field("foot", "Piè di pagina", "Scrivimi per un preventivo"),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    s.monogram({ cx: W / 2, cy: s.v(110), r: 38, letter: monogramOf(ctx.brand.name || t.title), color: s.ink });
    if (has(t.kicker)) s.caps({ x: m, y: s.v(176), w: W - 2 * m, text: t.kicker, color: pal.accent, align: "center", sizePx: 18, trackingEm: 0.42 });
    let titleBottom = s.v(280);
    let titleSize = 120;
    if (has(t.title)) {
      const title = s.headline({ x: m, y: s.v(225), w: W - 2 * m, text: balance(t.title, 9), font: "display", max: 190, min: 56, color: s.ink, align: "center", lineHeight: 0.92, uppercase: true });
      titleBottom = title.bottom;
      titleSize = title.layer.sizePx;
    }
    const buttonH = 60;
    const photoY = titleBottom - titleSize * 0.18;
    const photoH = Math.min(H - photoY - s.v(300), s.v(520));
    const photoW = Math.min(W * 0.36, photoH * 0.78);
    s.photo(0, { x: (W - photoW) / 2, y: photoY, w: photoW, h: photoH }, { shadow: true });
    let cursor = photoY + photoH + s.v(52);
    if (has(t.button)) {
      const button = s.pill({ cx: W / 2, y: cursor, label: t.button, fill: pal.accent, color: readableOn(pal.accent, pal.dark, pal.light), sizePx: 23 });
      cursor = button.y + Math.max(button.h, buttonH) + s.v(30);
    }
    if (has(t.foot)) s.caps({ x: m, y: cursor, w: W - 2 * m, text: t.foot, color: s.ink, align: "center", sizePx: 17, trackingEm: 0.32, opacity: 0.7 });
    s.caps({ x: m, y: H - m - s.v(6), w: W - 2 * m, text: handleOf(ctx.brand), color: s.ink, align: "center", sizePx: 17, trackingEm: 0.34, opacity: 0.7 });
    return { background: s.ground, layers: s.layers };
  },
};

export const EDITORIALE: readonly SlideTemplate[] = [cover, hero, sandwich, quote, list, cta];
