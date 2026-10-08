import { Scene } from "../kit";
import type { SlideTemplate } from "../types";
import { field, has } from "./common";

/**
 * Modelli semplici a una sola foto: la foto intera, con un margine, con il bordo bianco, in cornice, tonda…
 * Quasi senza testo, per quando la foto deve parlare da sola. Si vestono dei colori di qualsiasi stile.
 */

const full: SlideTemplate = {
  id: "sh-solo-full", set: "shared", role: "hero", label: "Foto intera", note: "Solo la foto, a tutta slide, senza nient'altro", tone: "dark", slots: ["any"],
  fields: [],
  build(ctx) {
    const s = new Scene(ctx);
    s.photo(0, { x: 0, y: 0, w: ctx.width, h: ctx.height });
    return { background: s.ground, layers: s.layers };
  },
};

const inset: SlideTemplate = {
  id: "sh-solo-inset", set: "shared", role: "hero", label: "Foto con margine", note: "La foto a tutta slide con un margine uguale su ogni lato", tone: "light", slots: ["any"],
  fields: [],
  build(ctx) {
    const s = new Scene(ctx);
    const m = 56;
    s.photo(0, { x: m, y: m, w: ctx.width - 2 * m, h: ctx.height - 2 * m });
    return { background: s.ground, layers: s.layers };
  },
};

const mat: SlideTemplate = {
  id: "sh-solo-mat", set: "shared", role: "hero", label: "Bordo bianco", note: "Una foto al centro con il bordo bianco di una stampa, su fondo a tinta unita", tone: "dark", slots: ["any"],
  fields: [],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H } = ctx;
    const border = 30;
    const w = Math.min(W * 0.78, (H * 0.8 - 2 * border) / 1.25);
    const h = Math.min(w * 1.25, H - 2 * (border + 90));
    s.photo(0, { x: (W - w) / 2, y: (H - h) / 2, w, h }, { border: { w: border, color: "#ffffff" }, shadow: true });
    return { background: s.ground, layers: s.layers };
  },
};

const frame: SlideTemplate = {
  id: "sh-solo-frame", set: "shared", role: "hero", label: "Cornice sottile", note: "La foto con una linea sottile tutt'intorno, su carta chiara", tone: "light", slots: ["any"],
  fields: [],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const m = 96;
    s.photo(0, { x: m, y: m, w: W - 2 * m, h: H - 2 * m });
    s.rect({ x: m - 26, y: m - 26, w: W - 2 * m + 52, h: H - 2 * m + 52, stroke: pal.accent, strokeW: 2 });
    return { background: s.ground, layers: s.layers };
  },
};

const caption: SlideTemplate = {
  id: "sh-solo-caption", set: "shared", role: "hero", label: "Foto e didascalia", note: "La foto grande e una riga di testo sotto", tone: "light", slots: ["any"],
  variants: [{ caption: "Il momento che racconta tutto" }],
  fields: [field("caption", "Didascalia", "Un momento, per sempre")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H } = ctx;
    const m = 56;
    const textH = s.v(170);
    s.photo(0, { x: m, y: m, w: W - 2 * m, h: H - 2 * m - textH });
    if (has(ctx.texts.caption)) s.caps({ x: m, y: H - m - textH + s.v(70), w: W - 2 * m, text: ctx.texts.caption, color: s.ink, align: "center", sizePx: 20, trackingEm: 0.36, opacity: 0.85 });
    return { background: s.ground, layers: s.layers };
  },
};

const circle: SlideTemplate = {
  id: "sh-solo-circle", set: "shared", role: "hero", label: "Foto tonda", note: "Una foto ritagliata a cerchio, con un filo d'accento", tone: "dark", slots: ["any"],
  fields: [],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const d = Math.min(W * 0.8, H * 0.74);
    const x = (W - d) / 2, y = (H - d) / 2;
    s.ellipse({ x: x - 26, y: y - 26, w: d + 52, h: d + 52, stroke: pal.accent, strokeW: 2 });
    s.photo(0, { x, y, w: d, h: d }, { mask: "ellipse", shadow: true });
    return { background: s.ground, layers: s.layers };
  },
};

const band: SlideTemplate = {
  id: "sh-solo-band", set: "shared", role: "hero", label: "Foto con banda", note: "La foto in alto e una banda a tinta unita con una parola", tone: "dark", slots: ["any"],
  variants: [{ script: "ancora" }],
  fields: [field("script", "Parola calligrafica", "per sempre")],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const bandH = s.v(260);
    s.photo(0, { x: 0, y: 0, w: W, h: H - bandH });
    if (has(ctx.texts.script)) s.text({ x: 40, y: H - bandH + s.v(70), w: W - 80, text: ctx.texts.script, font: "script", sizePx: 92, color: pal.accent, align: "center", lineHeight: 1.05 });
    return { background: s.ground, layers: s.layers };
  },
};

const card: SlideTemplate = {
  id: "sh-solo-card", set: "shared", role: "hero", label: "Foto su riquadro", note: "La foto appoggiata su un grande riquadro colorato", tone: "light", slots: ["any"],
  fields: [],
  build(ctx) {
    const s = new Scene(ctx);
    const { width: W, height: H, pal } = ctx;
    const m = 70;
    s.rect({ x: m, y: m, w: W - 2 * m, h: H - 2 * m, fill: pal.soft, opacity: ctx.tone === "dark" ? 0.3 : 0.65 });
    const inner = 150;
    s.photo(0, { x: inner, y: inner, w: W - 2 * inner, h: H - 2 * inner }, { shadow: true });
    return { background: s.ground, layers: s.layers };
  },
};

export const SOLO: readonly SlideTemplate[] = [full, inset, mat, frame, caption, circle, band, card];
