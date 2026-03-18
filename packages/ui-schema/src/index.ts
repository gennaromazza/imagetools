import type { ToolNavigationItem, ToolSectionSchema } from "@photo-tools/shared-types";

export const TOOL_NAVIGATION: ToolNavigationItem[] = [
  {
    id: "auto-layout",
    label: "Impaginazione Automatica",
    description: "Genera rapidamente fogli di stampa con piu foto.",
    isEnabled: true
  }
];

export const AUTO_LAYOUT_SECTIONS: ToolSectionSchema[] = [
  {
    id: "input",
    title: "Sorgente",
    description: "Cartella sorgente, conteggio immagini e panoramica orientamenti."
  },
  {
    id: "settings",
    title: "Impostazioni Layout",
    description: "Formato foglio, margini, spazio, DPI e strategia di impaginazione."
  },
  {
    id: "result",
    title: "Riepilogo Piano",
    description: "Fogli stimati, foto per pagina e immagini residue."
  },
  {
    id: "preview",
    title: "Anteprima Fogli",
    description: "Controlla le pagine, riordina le immagini e cambia template."
  },
  {
    id: "output",
    title: "Output",
    description: "Destinazione, nomenclatura file e formato di esportazione."
  }
];
