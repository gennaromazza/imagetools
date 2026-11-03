import { Scene, type Frame } from "../kit";
import type { SlideTemplate } from "../types";

/**
 * Stile «Minimal»: solo foto, su fondo a tinta unita. Nessun testo, nessuna forma, nessun ritaglio: ogni foto si vede intera, centrata nel suo spazio
 * (con il fondo della slide attorno quando le proporzioni non coincidono). Sono i modelli per chi vuole che la foto parli da sola.
 */

const MARGIN = 72;
const GAP = 24;

/** Una foto intera, centrata nello spazio dato. */
function whole(s: Scene, slot: number, frame: Frame) {
  return s.photo(slot, frame, {}, true);
}

const single: SlideTemplate = {
  id: "mn-single", set: "minimal", role: "hero", label: "Una foto", note: "Una foto intera, con un margine uguale su ogni lato", tone: "light", slots: ["any"],
  fields: [],
  build(ctx) {
    const s = new Scene(ctx);
    whole(s, 0, { x: MARGIN, y: MARGIN, w: ctx.width - 2 * MARGIN, h: ctx.height - 2 * MARGIN });
    return { background: s.ground, layers: s.layers };
  },
};

const full: SlideTemplate = {
  id: "mn-full", set: "minimal", role: "hero", label: "Foto a tutta slide", note: "Una foto intera, la più grande possibile, senza margine", tone: "light", slots: ["any"],
  fields: [],
  build(ctx) {
    const s = new Scene(ctx);
    whole(s, 0, { x: 0, y: 0, w: ctx.width, h: ctx.height });
    return { background: s.ground, layers: s.layers };
  },
};

const airy: SlideTemplate = {
  id: "mn-airy", set: "minimal", role: "hero", label: "Foto con grande margine", note: "Una foto intera con molto fondo attorno, come una stampa incorniciata", tone: "light", slots: ["any"],
  fields: [],
  build(ctx) {
    const s = new Scene(ctx);
    const m = 190;
    whole(s, 0, { x: m, y: m, w: ctx.width - 2 * m, h: ctx.height - 2 * m });
    return { background: s.ground, layers: s.layers };
  },
};

const duo: SlideTemplate = {
  id: "mn-duo", set: "minimal", role: "collage", label: "Due foto affiancate", note: "Due foto intere una accanto all'altra", tone: "light", slots: ["any", "any"],
  fields: [],
  build(ctx) {
    const s = new Scene(ctx);
    const w = (ctx.width - 2 * MARGIN - GAP) / 2;
    const h = ctx.height - 2 * MARGIN;
    whole(s, 0, { x: MARGIN, y: MARGIN, w, h });
    whole(s, 1, { x: MARGIN + w + GAP, y: MARGIN, w, h });
    return { background: s.ground, layers: s.layers };
  },
};

const stack: SlideTemplate = {
  id: "mn-stack", set: "minimal", role: "collage", label: "Due foto in colonna", note: "Due foto intere una sopra l'altra", tone: "light", slots: ["any", "any"],
  fields: [],
  build(ctx) {
    const s = new Scene(ctx);
    const w = ctx.width - 2 * MARGIN;
    const h = (ctx.height - 2 * MARGIN - GAP) / 2;
    whole(s, 0, { x: MARGIN, y: MARGIN, w, h });
    whole(s, 1, { x: MARGIN, y: MARGIN + h + GAP, w, h });
    return { background: s.ground, layers: s.layers };
  },
};

const rows3: SlideTemplate = {
  id: "mn-rows3", set: "minimal", role: "collage", label: "Tre foto in colonna", note: "Tre foto intere una sopra l'altra", tone: "light", slots: ["any", "any", "any"],
  fields: [],
  build(ctx) {
    const s = new Scene(ctx);
    const w = ctx.width - 2 * MARGIN;
    const h = (ctx.height - 2 * MARGIN - 2 * GAP) / 3;
    for (let slot = 0; slot < 3; slot += 1) whole(s, slot, { x: MARGIN, y: MARGIN + slot * (h + GAP), w, h });
    return { background: s.ground, layers: s.layers };
  },
};

const quad: SlideTemplate = {
  id: "mn-quad", set: "minimal", role: "collage", label: "Quattro foto", note: "Quattro foto intere in una griglia due per due", tone: "light", slots: ["any", "any", "any", "any"],
  fields: [],
  build(ctx) {
    const s = new Scene(ctx);
    const w = (ctx.width - 2 * MARGIN - GAP) / 2;
    const h = (ctx.height - 2 * MARGIN - GAP) / 2;
    for (let slot = 0; slot < 4; slot += 1) {
      whole(s, slot, { x: MARGIN + (slot % 2) * (w + GAP), y: MARGIN + Math.floor(slot / 2) * (h + GAP), w, h });
    }
    return { background: s.ground, layers: s.layers };
  },
};

export const MINIMAL: readonly SlideTemplate[] = [single, full, airy, duo, stack, rows3, quad];
