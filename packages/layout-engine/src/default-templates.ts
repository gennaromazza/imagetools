import type { LayoutTemplate } from "@photo-tools/shared-types";

export const DEFAULT_LAYOUT_TEMPLATES: LayoutTemplate[] = [
  {
    id: "single-hero",
    label: "Singola Protagonista",
    description: "Una foto protagonista a piena area utile.",
    style: "hero",
    affinity: "any",
    targetSheetOrientation: "any",
    minPhotos: 1,
    maxPhotos: 1,
    slots: [
      { id: "hero", x: 0, y: 0, width: 1, height: 1, expectedOrientation: "any", priority: 100 }
    ]
  },
  {
    id: "single-editorial-band",
    label: "Hero con Banda",
    description: "Una foto a piena pagina con taglio editoriale piu' guidato.",
    style: "hero",
    affinity: "landscape-heavy",
    targetSheetOrientation: "portrait",
    minPhotos: 1,
    maxPhotos: 1,
    slots: [
      { id: "hero-band", x: 0, y: 0.04, width: 1, height: 0.92, expectedOrientation: "horizontal", priority: 100 }
    ]
  },
  {
    id: "duo-vertical-columns",
    label: "Doppia Colonna Verticale",
    description: "Due foto affiancate, ideale per ritratti e coppie.",
    style: "paired",
    affinity: "portrait-heavy",
    targetSheetOrientation: "portrait",
    minPhotos: 2,
    maxPhotos: 2,
    slots: [
      { id: "left", x: 0, y: 0, width: 0.49, height: 1, expectedOrientation: "vertical", priority: 90 },
      { id: "right", x: 0.51, y: 0, width: 0.49, height: 1, expectedOrientation: "vertical", priority: 80 }
    ]
  },
  {
    id: "duo-horizontal-stack",
    label: "Doppia Fascia Orizzontale",
    description: "Due foto impilate verticalmente, adatto a immagini orizzontali.",
    style: "paired",
    affinity: "landscape-heavy",
    targetSheetOrientation: "portrait",
    minPhotos: 2,
    maxPhotos: 2,
    slots: [
      { id: "top", x: 0, y: 0, width: 1, height: 0.49, expectedOrientation: "horizontal", priority: 90 },
      { id: "bottom", x: 0, y: 0.51, width: 1, height: 0.49, expectedOrientation: "horizontal", priority: 80 }
    ]
  },
  {
    id: "duo-balanced-split",
    label: "Doppio Taglio Bilanciato",
    description: "Due slot bilanciati, utile per mix verticale e orizzontale.",
    style: "collage",
    affinity: "mixed",
    targetSheetOrientation: "portrait",
    minPhotos: 2,
    maxPhotos: 2,
    slots: [
      { id: "primary", x: 0, y: 0, width: 0.58, height: 1, expectedOrientation: "any", priority: 95 },
      { id: "secondary", x: 0.62, y: 0, width: 0.38, height: 1, expectedOrientation: "any", priority: 70 }
    ]
  },
  {
    id: "duo-top-story",
    label: "Doppio Storyboard",
    description: "Una foto ampia sopra e un ritratto di supporto sotto.",
    style: "collage",
    affinity: "mixed",
    targetSheetOrientation: "portrait",
    minPhotos: 2,
    maxPhotos: 2,
    slots: [
      { id: "hero-top", x: 0, y: 0, width: 1, height: 0.58, expectedOrientation: "horizontal", priority: 100 },
      { id: "support-bottom", x: 0.22, y: 0.63, width: 0.56, height: 0.37, expectedOrientation: "vertical", priority: 72 }
    ]
  },
  {
    id: "trio-editorial",
    label: "Trio Editoriale",
    description: "Una foto forte e due di supporto in colonna.",
    style: "editorial",
    affinity: "mixed",
    targetSheetOrientation: "portrait",
    minPhotos: 3,
    maxPhotos: 3,
    slots: [
      { id: "feature", x: 0, y: 0, width: 0.62, height: 1, expectedOrientation: "vertical", priority: 100 },
      { id: "top-right", x: 0.66, y: 0, width: 0.34, height: 0.48, expectedOrientation: "horizontal", priority: 75 },
      { id: "bottom-right", x: 0.66, y: 0.52, width: 0.34, height: 0.48, expectedOrientation: "horizontal", priority: 70 }
    ]
  },
  {
    id: "trio-columns",
    label: "Trio a Colonne",
    description: "Tre riquadri verticali regolari per ritratti e sequenze.",
    style: "balanced-grid",
    affinity: "portrait-heavy",
    targetSheetOrientation: "portrait",
    minPhotos: 3,
    maxPhotos: 3,
    slots: [
      { id: "left", x: 0, y: 0, width: 0.31, height: 1, expectedOrientation: "vertical", priority: 92 },
      { id: "center", x: 0.345, y: 0, width: 0.31, height: 1, expectedOrientation: "vertical", priority: 90 },
      { id: "right", x: 0.69, y: 0, width: 0.31, height: 1, expectedOrientation: "vertical", priority: 88 }
    ]
  },
  {
    id: "trio-story-grid",
    label: "Trio Story Grid",
    description: "Due foto in alto e una base ampia per chiudere la storia.",
    style: "editorial",
    affinity: "mixed",
    targetSheetOrientation: "portrait",
    minPhotos: 3,
    maxPhotos: 3,
    slots: [
      { id: "top-left", x: 0, y: 0, width: 0.49, height: 0.46, expectedOrientation: "vertical", priority: 85 },
      { id: "top-right", x: 0.51, y: 0, width: 0.49, height: 0.46, expectedOrientation: "vertical", priority: 84 },
      { id: "bottom-wide", x: 0, y: 0.52, width: 1, height: 0.48, expectedOrientation: "horizontal", priority: 94 }
    ]
  },
  {
    id: "grid-four-balanced",
    label: "Griglia Quattro Bilanciata",
    description: "Griglia 2x2 pulita e rapida per gruppi o momenti chiave.",
    style: "balanced-grid",
    affinity: "any",
    targetSheetOrientation: "portrait",
    minPhotos: 4,
    maxPhotos: 4,
    slots: [
      { id: "top-left", x: 0, y: 0, width: 0.49, height: 0.49, expectedOrientation: "any", priority: 90 },
      { id: "top-right", x: 0.51, y: 0, width: 0.49, height: 0.49, expectedOrientation: "any", priority: 85 },
      { id: "bottom-left", x: 0, y: 0.51, width: 0.49, height: 0.49, expectedOrientation: "any", priority: 80 },
      { id: "bottom-right", x: 0.51, y: 0.51, width: 0.49, height: 0.49, expectedOrientation: "any", priority: 75 }
    ]
  },
  {
    id: "four-hero-strip",
    label: "Quattro con Hero",
    description: "Una foto principale larga e tre secondarie in sequenza.",
    style: "editorial",
    affinity: "mixed",
    targetSheetOrientation: "portrait",
    minPhotos: 4,
    maxPhotos: 4,
    slots: [
      { id: "hero-top", x: 0, y: 0, width: 1, height: 0.44, expectedOrientation: "horizontal", priority: 100 },
      { id: "bottom-left", x: 0, y: 0.5, width: 0.31, height: 0.5, expectedOrientation: "vertical", priority: 83 },
      { id: "bottom-center", x: 0.345, y: 0.5, width: 0.31, height: 0.5, expectedOrientation: "vertical", priority: 82 },
      { id: "bottom-right", x: 0.69, y: 0.5, width: 0.31, height: 0.5, expectedOrientation: "vertical", priority: 81 }
    ]
  },
  {
    id: "four-landscape-board",
    label: "Quattro Panorama",
    description: "Struttura pensata per fogli orizzontali con foto miste.",
    style: "collage",
    affinity: "mixed",
    targetSheetOrientation: "landscape",
    minPhotos: 4,
    maxPhotos: 4,
    slots: [
      { id: "left-tall", x: 0, y: 0, width: 0.34, height: 1, expectedOrientation: "vertical", priority: 94 },
      { id: "top-right", x: 0.39, y: 0, width: 0.61, height: 0.31, expectedOrientation: "horizontal", priority: 90 },
      { id: "middle-right", x: 0.39, y: 0.345, width: 0.295, height: 0.655, expectedOrientation: "vertical", priority: 82 },
      { id: "bottom-right", x: 0.705, y: 0.345, width: 0.295, height: 0.655, expectedOrientation: "vertical", priority: 81 }
    ]
  }
];
