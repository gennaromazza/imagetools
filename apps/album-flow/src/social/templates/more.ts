import { readableOn } from "../brand";
import { Scene } from "../kit";
import type { SlideTemplate } from "../types";
import { field, handleOf, has, studioOf } from "./common";
import { frame } from "./galleria";

/**
 * Altri modelli per ogni stile (e alcuni universali): servono a far sì che due caroselli fatti a una settimana di distanza
 * non risultino uguali. Come gli altri, tutti i colori e i font vengono dalla marca.
 */

// ---------------------------------------------------------------------------
// Editoriale
// ---------------------------------------------------------------------------

const numbers: SlideTemplate = {
  id: "ed-numbers", set: "editoriale", role: "list", label: "Numero grande e foto", note: "Un numero gigante, un titolo e una foto alta a destra", tone: "light", slots: ["portrait"],
  variants: [{ number: "02", title: "Il secondo atto", body: "Quando la tensione si scioglie, restano i gesti piccoli: sono quelli che ricorderete." }],
  fields: [field("number", "Numero", "01"), field("title", "Titolo", "Il primo sguardo", true), field("body", "Testo", "Il momento in cui tutto si ferma, per un istante, e poi riparte più leggero.", true)],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    const left = W * 0.4 - m - 30;
    if (has(t.number)) s.headline({ x: m - 8, y: s.v(40), w: left + 40, text: t.number, font: "display", max: 300, min: 120, color: pal.accent, lineHeight: 0.95, opacity: 0.92 });
    const top = s.v(250);
    s.photo(0, { x: W * 0.4, y: top, w: W - m - W * 0.4, h: Math.min(H - top - s.v(200), s.v(860)) });
    let cursor = s.v(520);
    if (has(t.title)) cursor = s.headline({ x: m, y: cursor, w: left, text: t.title, font: "display", max: 60, min: 28, color: s.ink, lineHeight: 1.05 }).bottom + 24;
    s.line({ x1: m, y1: cursor, x2: m + 54, y2: cursor, stroke: pal.accent, strokeW: 3 });
    if (has(t.body)) s.text({ x: m, y: cursor + 26, w: left, text: t.body, font: "body", sizePx: 20, color: s.ink, lineHeight: 1.6, opacity: 0.85 });
    s.pageMark({ x: m, y: H - s.v(110), w: 240, align: "left", color: s.ink });
    return { background: s.ground, layers: s.layers };
  },
};

const caption: SlideTemplate = {
  id: "ed-caption", set: "editoriale", role: "hero", label: "Foto e didascalia", note: "Foto larga in alto e un titolo su fondo pieno", tone: "dark", slots: ["any"],
  variants: [{ kicker: "Reportage", title: "Come è andata davvero", body: "Niente regia: abbiamo seguito la giornata e lasciato che parlasse da sola." }],
  fields: [field("kicker", "Sopra il titolo", "Cerimonia"), field("title", "Titolo", "Quello che non si dice", true), field("body", "Testo", "Una parola sottovoce, una mano che stringe: è tutto qui.", true)],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    const ph = H * 0.62;
    s.photo(0, { x: 0, y: 0, w: W, h: ph });
    s.pageMark({ x: W - m - 200, y: s.v(84), w: 200, align: "right", color: "#ffffff" });
    let cursor = ph + s.v(50);
    if (has(t.kicker)) cursor = s.caps({ x: m, y: cursor, w: W - 2 * m, text: t.kicker, color: pal.accent, sizePx: 19, trackingEm: 0.4 }).bottom + 14;
    if (has(t.title)) cursor = s.headline({ x: m, y: cursor, w: W - 2 * m, text: t.title, font: "display", max: 72, min: 30, color: s.ink, lineHeight: 1.04 }).bottom + 18;
    if (has(t.body) && cursor < H - s.v(120)) s.text({ x: m, y: cursor, w: W * 0.72, text: t.body, font: "body", sizePx: 21, color: s.ink, lineHeight: 1.55, opacity: 0.8 });
    s.arrow({ x: W - m - 90, y: H - s.v(84), length: 70, color: pal.accent });
    return { background: s.ground, layers: s.layers };
  },
};

const triptych: SlideTemplate = {
  id: "ed-triptych", set: "editoriale", role: "collage", label: "Tre momenti numerati", note: "Tre foto verticali, ognuna con il suo numero e una parola", tone: "light", slots: ["portrait", "portrait", "portrait"],
  variants: [{ title: "Tre parole", c1: "Attesa", c2: "Sì", c3: "Festa" }],
  fields: [field("title", "Titolo", "Tre momenti"), field("c1", "Prima foto", "Preparativi"), field("c2", "Seconda foto", "Cerimonia"), field("c3", "Terza foto", "Festa")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    const gap = 14;
    const w = (W - 2 * m - 2 * gap) / 3;
    const y = s.v(300);
    const h = Math.min(H - y - s.v(210), w * 2.1);
    if (has(t.title)) s.headline({ x: m, y: s.v(86), w: W - 2 * m, text: t.title, font: "display", max: 76, min: 30, color: s.ink, lineHeight: 1.05 });
    [t.c1, t.c2, t.c3].forEach((label, index) => {
      const x = m + index * (w + gap);
      s.photo(index, { x, y, w, h });
      s.text({ x, y: y - s.v(86), w, text: `0${index + 1}`, font: "display", sizePx: 64, color: pal.accent, lineHeight: 1 });
      if (has(label)) s.caps({ x, y: y + h + s.v(26), w, text: label, color: s.ink, sizePx: 15, trackingEm: 0.26 });
    });
    return { background: s.ground, layers: s.layers };
  },
};

// ---------------------------------------------------------------------------
// Galleria
// ---------------------------------------------------------------------------

const film: SlideTemplate = {
  id: "ga-film", set: "galleria", role: "collage", label: "Pellicola", note: "Quattro foto in colonna come un rullino, con titolo verticale", tone: "light", slots: ["any", "any", "any", "any"],
  variants: [{ title: "Rullino due", caption: "alcuni scatti dalla giornata" }],
  fields: [field("title", "Titolo (verticale)", "Rullino"), field("caption", "Parola calligrafica", "fotogrammi")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    frame(s);
    const edge = 26;
    const gap = 14;
    const top = s.v(120);
    const cell = Math.min(250, (H - top - s.v(130) - 2 * edge - 3 * gap) / 4);
    const stripW = cell + 2 * edge;
    const stripH = 4 * cell + 3 * gap + 2 * edge;
    const x0 = (W - stripW) / 2;
    s.rect({ x: x0, y: top, w: stripW, h: stripH, fill: pal.dark });
    for (let row = 0; row < 4; row += 1) {
      const y = top + edge + row * (cell + gap);
      s.photo(row, { x: x0 + edge, y, w: cell, h: cell });
      for (const side of [x0 + 7, x0 + stripW - 19]) s.rect({ x: side, y: y + cell / 2 - 9, w: 12, h: 18, fill: pal.light, radius: 3 });
    }
    if (has(t.title)) s.caps({ x: W * 0.2 - 400, y: top + stripH / 2 - 14, w: 800, text: t.title, color: s.ink, align: "center", sizePx: 30, trackingEm: 0.5, rotation: -90, field: "title" });
    if (has(t.caption)) s.text({ x: W * 0.69, y: top + stripH / 2 - 60, w: W * 0.26, text: t.caption, font: "script", sizePx: 64, color: pal.accent, align: "center", lineHeight: 1.05, rotation: -4 });
    return { background: s.ground, layers: s.layers };
  },
};

const letter: SlideTemplate = {
  id: "ga-letter", set: "galleria", role: "quote", label: "Lettera", note: "Un biglietto scritto a mano con una foto inclinata in un angolo", tone: "light", slots: ["any"],
  variants: [{ greeting: "Carissimi,", body: "Vi scriviamo dopo aver rivisto ogni scatto: ci sono tornate in mente le voci, i profumi, le risate. Grazie per averci permesso di esserci.", signature: "con affetto" }],
  fields: [
    field("greeting", "Saluto", "Cari sposi,"),
    field("body", "Lettera", "Abbiamo guardato queste foto tante volte, e ogni volta ci fanno sorridere. Grazie per la fiducia, per l'emozione e per la giornata splendida che ci avete regalato.", true),
    field("signature", "Firma", ({ brand, albumName }) => studioOf(brand, albumName)),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin + 30;
    frame(s);
    s.photo(0, { x: W - m - 290, y: s.v(110), w: 260, h: 320 }, { border: { w: 14, color: "#ffffff" }, shadow: true, rotation: 4 });
    if (has(t.greeting)) s.headline({ x: m, y: s.v(150), w: W - 2 * m - 320, text: t.greeting, font: "script", max: 96, min: 44, color: pal.accent, lineHeight: 1 });
    let cursor = s.v(480);
    if (has(t.body)) cursor = s.text({ x: m, y: cursor, w: W - 2 * m, text: t.body, font: "display", italic: true, sizePx: 30, color: s.ink, lineHeight: 1.7, opacity: 0.92 }).bottom + s.v(40);
    if (has(t.signature) && cursor < H - s.v(150)) s.text({ x: m, y: cursor, w: W - 2 * m, text: t.signature, font: "script", sizePx: 64, color: pal.accent, align: "right", lineHeight: 1.1, rotation: -2 });
    return { background: s.ground, layers: s.layers };
  },
};

const stack: SlideTemplate = {
  id: "ga-stack", set: "galleria", role: "collage", label: "Una grande e due piccole", note: "Una foto alta a sinistra, due impilate a destra, con bordo bianco", tone: "light", slots: ["portrait", "any", "any"],
  variants: [{ title: "Poi, la festa", caption: "il resto della sera" }],
  fields: [field("title", "Titolo", "Un giorno intero"), field("caption", "Didascalia", "dalla mattina alla sera")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    frame(s);
    const top = s.v(120);
    const total = Math.min(H - top - s.v(280), s.v(900));
    const gap = 16;
    const bigW = W * 0.5;
    const white = { w: 12, color: "#ffffff" };
    s.photo(0, { x: m, y: top, w: bigW, h: total }, { border: white, shadow: true });
    const smallW = W - 2 * m - bigW - gap - 24;
    const smallH = (total - gap) / 2;
    s.photo(1, { x: m + bigW + gap + 12, y: top, w: smallW, h: smallH }, { border: white, shadow: true });
    s.photo(2, { x: m + bigW + gap + 12, y: top + smallH + gap, w: smallW, h: smallH }, { border: white, shadow: true });
    let cursor = top + total + s.v(60);
    if (has(t.title)) cursor = s.headline({ x: m, y: cursor, w: W - 2 * m, text: t.title, font: "display", max: 66, min: 28, color: s.ink, lineHeight: 1.05 }).bottom + 6;
    if (has(t.caption)) s.text({ x: m, y: cursor, w: W - 2 * m, text: t.caption, font: "script", sizePx: 54, color: pal.accent, lineHeight: 1.05 });
    return { background: s.ground, layers: s.layers };
  },
};

// ---------------------------------------------------------------------------
// Moda
// ---------------------------------------------------------------------------

const stripes: SlideTemplate = {
  id: "mo-stripes", set: "moda", role: "collage", label: "Tre foto su blocchi di colore", note: "Tre foto alte, ognuna con il suo riquadro colorato sfalsato", tone: "dark", slots: ["portrait", "portrait", "portrait"],
  variants: [{ title: "Tre storie", button: "Guarda tutto" }],
  fields: [field("title", "Titolo", "Tre sguardi"), field("button", "Pulsante", ({ brand }) => handleOf(brand))],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    const gap = 26;
    const w = (W - 2 * m - 2 * gap - 14) / 3;
    const y = s.v(190);
    const h = Math.min(H - y - s.v(300), w * 2.2);
    const blocks = [pal.accent, pal.soft, pal.light];
    for (let index = 0; index < 3; index += 1) {
      const x = m + index * (w + gap);
      s.rect({ x: x + 14, y: y + 14, w, h, fill: blocks[index], opacity: 0.85 });
      s.photo(index, { x, y, w, h }, { shadow: true });
    }
    if (has(t.title)) s.headline({ x: m, y: s.v(70), w: W - 2 * m, text: t.title, font: "display", max: 80, min: 30, color: s.ink, lineHeight: 1.05 });
    if (has(t.button)) s.pill({ cx: W / 2, y: y + h + s.v(70), label: t.button, fill: pal.accent, color: readableOn(pal.accent, pal.dark, pal.light), sizePx: 19 });
    return { background: s.ground, layers: s.layers };
  },
};

const sticker: SlideTemplate = {
  id: "mo-sticker", set: "moda", role: "hero", label: "Foto con bollino", note: "Foto a tutta pagina, un grande bollino colorato e un titolo", tone: "dark", slots: ["any"],
  variants: [{ badge: "Solo\nper\nvoi", title: "Edizione limitata", button: "Scrivici" }],
  fields: [field("badge", "Bollino", "Nuovo\nalbum", true), field("title", "Titolo", "Nuove storie"), field("button", "Pulsante", "Scopri di più")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    s.photo(0, { x: 0, y: 0, w: W, h: H }, { dim: 0.22 });
    s.gradient({ x: 0, y: H * 0.55, w: W, h: H * 0.45, from: "#000000", fromOpacity: 0, to: "#000000", toOpacity: 0.7, direction: "top" });
    if (has(t.badge)) s.badge({ cx: W * 0.76, cy: H * 0.26, r: 150, lines: t.badge.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 3), fill: pal.accent, color: readableOn(pal.accent, pal.dark, pal.light), rotation: -12 });
    let bottom = H - m - s.v(40);
    if (has(t.button)) { const button = s.pill({ cx: m + 130, y: bottom - 60, label: t.button, fill: pal.accent, color: readableOn(pal.accent, pal.dark, pal.light), sizePx: 19 }); bottom = button.y - 30; }
    if (has(t.title)) { const title = s.headline({ x: m, y: 0, w: W - 2 * m, text: t.title, font: "display", max: 100, min: 36, color: "#ffffff", lineHeight: 1.02 }); s.move(title, bottom - title.height); }
    return { background: s.ground, layers: s.layers };
  },
};

const duoCircle: SlideTemplate = {
  id: "mo-duo-circle", set: "moda", role: "collage", label: "Due cerchi", note: "Due foto tonde di misura diversa, sovrapposte, con un anello", tone: "dark", slots: ["any", "any"],
  variants: [{ title: "Dentro e fuori", script: "da vicino" }],
  fields: [field("title", "Titolo", "Due mondi"), field("script", "Parola calligrafica", "uno solo")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    const big = Math.min(W * 0.66, H * 0.46);
    const small = big * 0.62;
    s.ellipse({ x: m - 20, y: s.v(150) - 20, w: big + 40, h: big + 40, stroke: pal.accent, strokeW: 2, opacity: 0.7 });
    s.photo(0, { x: m, y: s.v(150), w: big, h: big }, { mask: "ellipse" });
    const sx = W - m - small;
    const sy = s.v(150) + big * 0.62;
    s.ellipse({ x: sx - 12, y: sy - 12, w: small + 24, h: small + 24, fill: pal.dark });
    s.photo(1, { x: sx, y: sy, w: small, h: small }, { mask: "ellipse", shadow: true });
    let bottom = H - m - s.v(30);
    if (has(t.script)) { const script = s.text({ x: m, y: 0, w: W * 0.5, text: t.script, font: "script", sizePx: 74, color: pal.accent, lineHeight: 1.05 }); bottom = s.move(script, bottom - script.height).top + 10; }
    if (has(t.title)) { const title = s.headline({ x: m, y: 0, w: W * 0.56, text: t.title, font: "display", max: 80, min: 30, color: s.ink, lineHeight: 1.02 }); s.move(title, bottom - title.height - 6); }
    return { background: s.ground, layers: s.layers };
  },
};

// ---------------------------------------------------------------------------
// Cinema
// ---------------------------------------------------------------------------

const letterbox: SlideTemplate = {
  id: "ci-letterbox", set: "cinema", role: "hero", label: "Sottotitolo", note: "Foto con grandi bande nere e una frase come un sottotitolo", tone: "dark", slots: ["any"],
  variants: [{ caption: "Poi tutto è tornato silenzio.", tc: "00:41:18" }],
  fields: [field("caption", "Sottotitolo", "Non ci credevo ancora."), field("tc", "Codice del tempo", "00:12:07")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    const bar = H * 0.13;
    s.photo(0, { x: 0, y: bar, w: W, h: H - 2 * bar });
    s.rect({ x: 0, y: 0, w: W, h: bar, fill: "#000000" });
    s.rect({ x: 0, y: H - bar, w: W, h: bar, fill: "#000000" });
    s.ellipse({ x: m, y: bar / 2 - 6, w: 12, h: 12, fill: pal.accent });
    s.caps({ x: m + 24, y: bar / 2 - 10, w: 200, text: "Rec", color: pal.light, sizePx: 16, trackingEm: 0.4, opacity: 0.85 });
    if (has(t.tc)) s.caps({ x: W - m - 320, y: bar / 2 - 10, w: 320, text: t.tc, color: pal.accent, align: "right", sizePx: 18, trackingEm: 0.25, field: "tc" });
    if (has(t.caption)) { const text = s.text({ x: m, y: 0, w: W - 2 * m, text: t.caption, font: "body", sizePx: 42, color: "#ffffff", align: "center", lineHeight: 1.2 }); s.move(text, H - bar / 2 - text.height / 2); }
    return { background: s.ground, layers: s.layers };
  },
};

const credits: SlideTemplate = {
  id: "ci-credits", set: "cinema", role: "cta", label: "Titoli di coda", note: "Il nome in grande e l'elenco di chi ha fatto cosa, come nei film", tone: "dark", slots: [],
  variants: [{ kicker: "Con la collaborazione di", items: "Luce naturale\nPazienza\nUn po' di fortuna\nMolta emozione" }],
  fields: [
    field("kicker", "Sopra", "Un film di"),
    field("name", "Nome", ({ brand, albumName }) => studioOf(brand, albumName)),
    field("items", "Elenco (una voce per riga)", "Fotografia\nSelezione e ritocco\nImpaginazione\nStampa", true),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    let cursor = H * 0.24;
    if (has(t.kicker)) cursor = s.caps({ x: m, y: cursor, w: W - 2 * m, text: t.kicker, color: pal.accent, align: "center", sizePx: 22, trackingEm: 0.5 }).bottom + s.v(36);
    if (has(t.name)) cursor = s.headline({ x: m, y: cursor, w: W - 2 * m, text: t.name, font: "display", max: 140, min: 36, color: s.ink, align: "center", lineHeight: 1, uppercase: true }).bottom + s.v(90);
    for (const line of (t.items ?? "").split("\n").map((item) => item.trim()).filter(Boolean).slice(0, 7)) {
      cursor = s.caps({ x: m, y: cursor, w: W - 2 * m, text: line, color: s.ink, align: "center", sizePx: 27, trackingEm: 0.34, opacity: 0.85, field: "items" }).bottom + s.v(40);
    }
    s.caps({ x: m, y: H - m - s.v(40), w: W - 2 * m, text: handleOf(ctx.brand), color: s.ink, align: "center", sizePx: 17, trackingEm: 0.4, opacity: 0.7 });
    return { background: s.ground, layers: s.layers };
  },
};

const diptych: SlideTemplate = {
  id: "ci-diptych", set: "cinema", role: "collage", label: "Due inquadrature", note: "Due foto larghe una sopra l'altra, con il codice del tempo", tone: "dark", slots: ["landscape", "landscape"],
  variants: [{ caption: "Controcampo", tc1: "00:20:44", tc2: "00:20:51" }],
  fields: [field("caption", "Didascalia", "Campo e controcampo"), field("tc1", "Tempo della prima", "00:08:12"), field("tc2", "Tempo della seconda", "00:08:19")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    const gap = 16;
    const top = s.v(110);
    const h = (H - top - s.v(220) - gap) / 2;
    s.photo(0, { x: m, y: top, w: W - 2 * m, h });
    s.photo(1, { x: m, y: top + h + gap, w: W - 2 * m, h });
    if (has(t.tc1)) s.caps({ x: m + 20, y: top + 18, w: 240, text: t.tc1, color: "#ffffff", sizePx: 16, trackingEm: 0.25, field: "tc1" });
    if (has(t.tc2)) s.caps({ x: m + 20, y: top + h + gap + 18, w: 240, text: t.tc2, color: "#ffffff", sizePx: 16, trackingEm: 0.25, field: "tc2" });
    s.line({ x1: W / 2 - 30, y1: H - s.v(150), x2: W / 2 + 30, y2: H - s.v(150), stroke: pal.accent, strokeW: 2 });
    if (has(t.caption)) s.caps({ x: m, y: H - s.v(120), w: W - 2 * m, text: t.caption, color: s.ink, align: "center", sizePx: 18, trackingEm: 0.4, opacity: 0.85 });
    return { background: s.ground, layers: s.layers };
  },
};

// ---------------------------------------------------------------------------
// Universali
// ---------------------------------------------------------------------------

const faq: SlideTemplate = {
  id: "sh-faq", set: "shared", role: "quote", label: "Domanda e risposta", note: "Una domanda frequente con la sua risposta, senza foto", tone: "dark", slots: [],
  variants: [{ question: "Quanto tempo serve per le foto?", answer: "Di solito le prime anteprime arrivano in una settimana, l'album finito dopo alcune settimane." }, { question: "Fate anche gli album?", answer: "Sì: dall'impaginazione alla stampa, con la stessa cura delle foto." }],
  fields: [
    field("kicker", "Sopra", "Domande frequenti"),
    field("question", "Domanda", "Con quanto anticipo bisogna prenotare?", true),
    field("answer", "Risposta", "Consigliamo da sei a dodici mesi prima, soprattutto per le date in alta stagione.", true),
    field("button", "Pulsante", "Scrivimi"),
  ],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin + 20;
    let cursor = s.v(260);
    if (has(t.kicker)) cursor = s.caps({ x: m, y: cursor, w: W - 2 * m, text: t.kicker, color: pal.accent, sizePx: 19, trackingEm: 0.42 }).bottom + s.v(36);
    s.text({ x: m, y: cursor, w: W - 2 * m, text: "Domanda", font: "script", sizePx: 64, color: pal.accent, lineHeight: 1 });
    cursor += s.v(84);
    if (has(t.question)) cursor = s.headline({ x: m, y: cursor, w: W - 2 * m, text: t.question, font: "display", max: 88, min: 30, color: s.ink, lineHeight: 1.08 }).bottom + s.v(44);
    s.line({ x1: m, y1: cursor, x2: m + 70, y2: cursor, stroke: pal.accent, strokeW: 3 });
    cursor += s.v(44);
    if (has(t.answer)) cursor = s.text({ x: m, y: cursor, w: W - 2 * m, text: t.answer, font: "body", sizePx: 31, color: s.ink, lineHeight: 1.55, opacity: 0.88 }).bottom + s.v(60);
    if (has(t.button) && cursor < H - s.v(150)) s.pill({ cx: m + 110, y: cursor, label: t.button, fill: pal.accent, color: readableOn(pal.accent, pal.dark, pal.light), sizePx: 20 });
    s.pageMark({ x: W - m - 200, y: s.v(84), w: 200, align: "right", color: s.ink });
    return { background: s.ground, layers: s.layers };
  },
};

const book: SlideTemplate = {
  id: "sh-book", set: "shared", role: "cta", label: "Prenota con foto", note: "Titolo e pulsante sopra, una foto arrotondata sotto", tone: "light", slots: ["any"],
  variants: [{ title: "Raccontiamo la vostra storia", script: "insieme", button: "Parliamone" }],
  fields: [field("title", "Titolo", "Prenota la tua data", true), field("script", "Parola calligrafica", "con noi"), field("button", "Pulsante", "Scrivimi ora")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    let cursor = s.v(110);
    if (has(t.title)) cursor = s.headline({ x: m, y: cursor, w: W - 2 * m, text: t.title, font: "display", max: 92, min: 34, color: s.ink, align: "center", lineHeight: 1.02 }).bottom;
    if (has(t.script)) cursor = s.text({ x: m, y: cursor - 6, w: W - 2 * m, text: t.script, font: "script", sizePx: 84, color: pal.accent, align: "center", lineHeight: 1.05, rotation: -2 }).bottom + s.v(18);
    if (has(t.button)) cursor = s.pill({ cx: W / 2, y: cursor, label: t.button, fill: pal.accent, color: readableOn(pal.accent, pal.dark, pal.light), sizePx: 21 }).y + 70;
    const top = cursor + s.v(34);
    s.photo(0, { x: m, y: top, w: W - 2 * m, h: H - top - m - s.v(40) }, { radius: 34, shadow: true });
    s.caps({ x: m, y: H - m - s.v(10), w: W - 2 * m, text: handleOf(ctx.brand), color: s.ink, align: "center", sizePx: 15, trackingEm: 0.4, opacity: 0.7 });
    return { background: s.ground, layers: s.layers };
  },
};

const checklist: SlideTemplate = {
  id: "sh-checklist", set: "shared", role: "list", label: "Elenco con spunte", note: "Un titolo e cinque voci con la loro spunta, senza foto", tone: "light", slots: [],
  variants: [{ title: "Prima del grande giorno", items: "Scegli l'orario della luce migliore\nPreparate i dettagli in un unico posto\nDelegate una persona di fiducia\nRespirate\nGodetevi ogni minuto" }],
  fields: [field("title", "Titolo", "Cosa preparare", true), field("items", "Elenco (una voce per riga)", "Gli anelli e i dettagli\nUna lista dei parenti\nScarpe comode\nIl programma della giornata\nUn sorriso", true)],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin + 20;
    let cursor = s.v(150);
    if (has(t.title)) cursor = s.headline({ x: m, y: cursor, w: W - 2 * m, text: t.title, font: "display", max: 96, min: 34, color: s.ink, lineHeight: 1.04 }).bottom + s.v(70);
    for (const item of (t.items ?? "").split("\n").map((value) => value.trim()).filter(Boolean).slice(0, 7)) {
      const line = s.text({ x: m + 70, y: cursor, w: W - 2 * m - 70, text: item, font: "display", sizePx: 38, color: s.ink, lineHeight: 1.2, field: "items" });
      const cy = cursor + 22;
      s.ellipse({ x: m, y: cy - 22, w: 44, h: 44, stroke: pal.accent, strokeW: 2.5 });
      s.path({ d: `M${m + 12} ${cy}L${m + 20} ${cy + 8}L${m + 33} ${cy - 9}`, stroke: pal.accent, strokeW: 3 });
      cursor = Math.max(line.bottom, cy + 26) + s.v(44);
    }
    s.pageMark({ x: m, y: H - s.v(96), w: 240, align: "left", color: s.ink });
    return { background: s.ground, layers: s.layers };
  },
};

const polaroidDuo: SlideTemplate = {
  id: "sh-polaroid-duo", set: "shared", role: "collage", label: "Due polaroid", note: "Due foto con cornice bianca, inclinate in versi opposti", tone: "light", slots: ["any", "any"],
  variants: [{ script: "e poi dopo", label: "Due ricordi" }],
  fields: [field("script", "Parola calligrafica", "prima e dopo"), field("label", "Didascalia", "Due fotogrammi dello stesso giorno")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const w = W * 0.52;
    const h = Math.min(w * 1.18, H * 0.34);
    const white = { w: 26, color: "#ffffff" };
    s.photo(0, { x: W * 0.08, y: s.v(150), w, h }, { border: white, shadow: true, rotation: -5 });
    s.photo(1, { x: W - W * 0.08 - w, y: s.v(150) + h * 0.74, w, h }, { border: white, shadow: true, rotation: 4 });
    let cursor = s.v(150) + h * 0.74 + h + s.v(70);
    if (has(t.script)) cursor = s.text({ x: 60, y: cursor, w: W - 120, text: t.script, font: "script", sizePx: 80, color: pal.accent, align: "center", lineHeight: 1.05 }).bottom + 6;
    if (has(t.label) && cursor < H - s.v(70)) s.caps({ x: 60, y: cursor, w: W - 120, text: t.label, color: s.ink, align: "center", sizePx: 16, trackingEm: 0.36, opacity: 0.75 });
    return { background: s.ground, layers: s.layers };
  },
};

const date: SlideTemplate = {
  id: "sh-date", set: "shared", role: "cta", label: "Data da segnare", note: "Foto in alto e la data in grande, come un invito", tone: "dark", slots: ["any"],
  variants: [{ script: "ci vediamo il", day: "14", month: "Giugno", year: "2027", place: "Villa dei Cipressi" }],
  fields: [field("script", "Parola calligrafica", "segnati la data"), field("day", "Giorno", "22"), field("month", "Mese", "Marzo"), field("year", "Anno", "2028"), field("place", "Luogo", "Villa dei Cipressi, Firenze")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const t = ctx.texts;
    const m = s.margin;
    const ph = H * 0.5;
    s.photo(0, { x: 0, y: 0, w: W, h: ph });
    s.gradient({ x: 0, y: ph * 0.55, w: W, h: ph * 0.45, from: pal.dark, fromOpacity: 0, to: pal.dark, toOpacity: 1, direction: "top" });
    let cursor = ph - s.v(40);
    if (has(t.script)) cursor = s.text({ x: m, y: cursor, w: W - 2 * m, text: t.script, font: "script", sizePx: 78, color: pal.accent, align: "center", lineHeight: 1, rotation: -3 }).bottom;
    if (has(t.day)) cursor = s.headline({ x: m, y: cursor - 10, w: W - 2 * m, text: t.day, font: "display", max: 230, min: 80, color: s.ink, align: "center", lineHeight: 0.95 }).bottom;
    // Mese e anno sono due testi affiancati ai lati del centro, così si possono modificare e ritoccare uno per uno.
    const rowY = cursor + 6;
    const month = has(t.month) ? s.caps({ x: m, y: rowY, w: W / 2 - m - 18, text: t.month, color: s.ink, align: "right", sizePx: 28, trackingEm: 0.4 }) : null;
    const year = has(t.year) ? s.caps({ x: W / 2 + 18, y: rowY, w: W / 2 - m - 18, text: t.year, color: s.ink, align: "left", sizePx: 28, trackingEm: 0.4 }) : null;
    if (month || year) cursor = Math.max(month?.bottom ?? 0, year?.bottom ?? 0) + s.v(26);
    if (has(t.place) && cursor < H - s.v(90)) s.caps({ x: m, y: cursor, w: W - 2 * m, text: t.place, color: pal.accent, align: "center", sizePx: 17, trackingEm: 0.34 });
    return { background: s.ground, layers: s.layers };
  },
};

const strips: SlideTemplate = {
  id: "sh-strips", set: "shared", role: "collage", label: "Tre strisce", note: "Tre foto a tutta altezza, affiancate senza spazi, con una parola in basso", tone: "dark", slots: ["portrait", "portrait", "portrait"],
  variants: [{ caption: "Attimi in fila" }],
  fields: [field("caption", "Parola", "Insieme")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H } = ctx;
    const w = W / 3;
    for (let index = 0; index < 3; index += 1) s.photo(index, { x: index * w, y: 0, w, h: H });
    s.gradient({ x: 0, y: H * 0.6, w: W, h: H * 0.4, from: "#000000", fromOpacity: 0, to: "#000000", toOpacity: 0.7, direction: "top" });
    for (const x of [w, 2 * w]) s.line({ x1: x, y1: 0, x2: x, y2: H, stroke: "#ffffff", strokeW: 2, opacity: 0.55 });
    if (has(ctx.texts.caption)) s.headline({ x: 60, y: H - s.margin - s.v(130), w: W - 120, text: ctx.texts.caption, font: "script", max: 140, min: 50, color: "#ffffff", align: "center", lineHeight: 1 });
    s.pageMark({ x: W - s.margin - 200, y: s.v(84), w: 200, align: "right", color: "#ffffff" });
    return { background: s.ground, layers: s.layers };
  },
};

export const EDITORIALE_MORE: readonly SlideTemplate[] = [numbers, caption, triptych];
export const GALLERIA_MORE: readonly SlideTemplate[] = [film, letter, stack];
export const MODA_MORE: readonly SlideTemplate[] = [stripes, sticker, duoCircle];
export const CINEMA_MORE: readonly SlideTemplate[] = [letterbox, credits, diptych];
export const UNIVERSAL_MORE: readonly SlideTemplate[] = [faq, book, checklist, polaroidDuo, date, strips];
