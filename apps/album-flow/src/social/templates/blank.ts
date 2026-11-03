import { Scene } from "../kit";
import type { SlideTemplate } from "../types";

/** Una tela vuota: nel carosello fatto a mano le foto le metti tu, dove vuoi, e il modello lo scegli dopo, in base a quante sono. */
export const BLANK_ID = "sh-blank";

const blank: SlideTemplate = {
  id: BLANK_ID, set: "shared", role: "hero", label: "Slide vuota", note: "Una tela vuota: scegli tu le foto e dove metterle", tone: "light", slots: [],
  fields: [],
  build(ctx) {
    const s = new Scene(ctx);
    return { background: s.ground, layers: s.layers };
  },
};

export const BLANK: readonly SlideTemplate[] = [blank];
