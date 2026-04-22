import type { LayoutSlot, LayoutTemplate } from "@photo-tools/shared-types";

function mirrorSlotsHorizontally(slots: LayoutSlot[]): LayoutSlot[] {
  return slots.map((slot) => ({
    ...slot,
    x: Number((1 - slot.x - slot.width).toFixed(4))
  }));
}

function createVariantTemplate(
  template: Omit<LayoutTemplate, "slots"> & { slots: LayoutSlot[] }
): LayoutTemplate {
  return {
    ...template,
    supportsPageSide: true
  };
}

function buildGridSlots(count: number, columns: number, rows: number): LayoutSlot[] {
  const gap = 0.02;
  const cellWidth = (1 - gap * (columns - 1)) / columns;
  const cellHeight = (1 - gap * (rows - 1)) / rows;

  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;

    return {
      id: String(index + 1),
      x: Number((column * (cellWidth + gap)).toFixed(4)),
      y: Number((row * (cellHeight + gap)).toFixed(4)),
      width: Number(cellWidth.toFixed(4)),
      height: Number(cellHeight.toFixed(4)),
      expectedOrientation: "any",
      priority: Math.max(1, 120 - index)
    };
  });
}

function getGridDimensions(count: number): { columns: number; rows: number } {
  // Grid dimensions strategy:
  // - Prefer wider layouts (more columns, fewer rows) for better visual balance
  // - Limit rows to max 5 to avoid overly tall layouts
  // - Each cell should be substantial in size

  if (count <= 3) {
    return { columns: count, rows: 1 };
  }

  if (count <= 6) {
    const columns = Math.ceil(count / 3) || 2;
    return { columns, rows: Math.ceil(count / columns) };
  }

  if (count <= 8) {
    return { columns: 4, rows: 2 };
  }

  if (count <= 12) {
    const columns = 3;
    return { columns, rows: Math.ceil(count / columns) };
  }

  if (count <= 15) {
    // Prefer 3 columns with 5 rows instead of 4 columns with 4 rows
    return { columns: 3, rows: 5 };
  }

  if (count <= 18) {
    // 6 columns with 3 rows = better proportions than 4x5
    return { columns: 6, rows: 3 };
  }

  if (count <= 20) {
    // 5 columns with 4 rows = better proportions than 4x5
    return { columns: 5, rows: 4 };
  }

  // For > 20: use wider format but cap at reasonable width
  const columns = Math.min(6, Math.ceil(Math.sqrt(count * 1.5)));
  const rows = Math.ceil(count / columns);
  return { columns, rows: Math.min(rows, 6) };
}

function createDenseGridTemplate(count: number): LayoutTemplate {
  const { columns, rows } = getGridDimensions(count);

  return {
    id: `grid-${count}-balanced`,
    label: `Griglia ${count} Bilanciata`,
    description: `Griglia ${columns}x${rows} per ${count} foto.`,
    style: "balanced-grid",
    affinity: "any",
    targetSheetOrientation: "portrait",
    minPhotos: count,
    maxPhotos: count,
    slots: buildGridSlots(count, columns, rows)
  };
}

const DENSE_GRID_TEMPLATES: LayoutTemplate[] = Array.from(
  { length: 16 },
  (_, index) => createDenseGridTemplate(index + 5)
);

const EARLY_STORY_TEMPLATES_2_TO_8: LayoutTemplate[] = [
  {
    id: "duo-cinema-landscape",
    label: "Doppio Cinema",
    description: "Due fasce ampie per panoramiche, location e scene larghe.",
    style: "paired",
    affinity: "landscape-heavy",
    targetSheetOrientation: "landscape",
    minPhotos: 2,
    maxPhotos: 2,
    slots: [
      { id: "top-cinema", x: 0, y: 0, width: 1, height: 0.46, expectedOrientation: "horizontal", priority: 100 },
      { id: "bottom-cinema", x: 0, y: 0.54, width: 1, height: 0.46, expectedOrientation: "horizontal", priority: 92 }
    ]
  },
  {
    id: "duo-portrait-stage",
    label: "Doppio Stage",
    description: "Due ritratti protagonisti con respiro laterale su fogli piu larghi.",
    style: "paired",
    affinity: "portrait-heavy",
    targetSheetOrientation: "landscape",
    minPhotos: 2,
    maxPhotos: 2,
    slots: [
      { id: "left-stage", x: 0.07, y: 0, width: 0.4, height: 1, expectedOrientation: "vertical", priority: 98 },
      { id: "right-stage", x: 0.53, y: 0, width: 0.4, height: 1, expectedOrientation: "vertical", priority: 96 }
    ]
  },
  {
    id: "trio-cinema-strips",
    label: "Trio Cinema Strips",
    description: "Tre bande orizzontali per racconti lineari e immagini widescreen.",
    style: "editorial",
    affinity: "landscape-heavy",
    targetSheetOrientation: "any",
    minPhotos: 3,
    maxPhotos: 3,
    slots: [
      { id: "strip-1", x: 0, y: 0, width: 1, height: 0.3, expectedOrientation: "horizontal", priority: 100 },
      { id: "strip-2", x: 0, y: 0.35, width: 1, height: 0.3, expectedOrientation: "horizontal", priority: 92 },
      { id: "strip-3", x: 0, y: 0.7, width: 1, height: 0.3, expectedOrientation: "horizontal", priority: 84 }
    ]
  },
  {
    id: "trio-hero-band-inverse",
    label: "Trio Hero Inverso",
    description: "Hero largo in alto e coppia finale sotto per una chiusura pulita.",
    style: "editorial",
    affinity: "mixed",
    targetSheetOrientation: "portrait",
    minPhotos: 3,
    maxPhotos: 3,
    slots: [
      { id: "hero-top", x: 0, y: 0, width: 1, height: 0.4, expectedOrientation: "horizontal", priority: 100 },
      { id: "bottom-left", x: 0, y: 0.48, width: 0.49, height: 0.52, expectedOrientation: "vertical", priority: 88 },
      { id: "bottom-right", x: 0.51, y: 0.48, width: 0.49, height: 0.52, expectedOrientation: "vertical", priority: 87 }
    ]
  },
  {
    id: "four-portrait-runway",
    label: "Quattro Portrait Runway",
    description: "Un ritratto guida con tre supporti per set verticali e storytelling umano.",
    style: "collage",
    affinity: "portrait-heavy",
    targetSheetOrientation: "portrait",
    minPhotos: 4,
    maxPhotos: 4,
    slots: [
      { id: "hero-left", x: 0, y: 0, width: 0.34, height: 1, expectedOrientation: "vertical", priority: 100 },
      { id: "top-mid", x: 0.38, y: 0, width: 0.29, height: 0.48, expectedOrientation: "vertical", priority: 91 },
      { id: "top-right", x: 0.71, y: 0, width: 0.29, height: 0.48, expectedOrientation: "vertical", priority: 90 },
      { id: "bottom-wide", x: 0.38, y: 0.52, width: 0.62, height: 0.48, expectedOrientation: "horizontal", priority: 89 }
    ]
  },
  {
    id: "four-cinema-mosaic",
    label: "Quattro Cinema Mosaic",
    description: "Due bande protagoniste e due pannelli centrali per immagini larghe.",
    style: "editorial",
    affinity: "landscape-heavy",
    targetSheetOrientation: "any",
    minPhotos: 4,
    maxPhotos: 4,
    slots: [
      { id: "hero-top", x: 0, y: 0, width: 1, height: 0.3, expectedOrientation: "horizontal", priority: 100 },
      { id: "mid-left", x: 0, y: 0.35, width: 0.49, height: 0.29, expectedOrientation: "horizontal", priority: 92 },
      { id: "mid-right", x: 0.51, y: 0.35, width: 0.49, height: 0.29, expectedOrientation: "horizontal", priority: 91 },
      { id: "bottom-band", x: 0, y: 0.69, width: 1, height: 0.31, expectedOrientation: "horizontal", priority: 88 }
    ]
  },
  {
    id: "seven-cinema-ribbon",
    label: "Sette Cinema Ribbon",
    description: "Hero superiore con doppia fascia di supporto per reportage ricchi.",
    style: "editorial",
    affinity: "landscape-heavy",
    targetSheetOrientation: "portrait",
    minPhotos: 7,
    maxPhotos: 7,
    slots: [
      { id: "hero-top", x: 0, y: 0, width: 1, height: 0.33, expectedOrientation: "horizontal", priority: 100 },
      { id: "mid-1", x: 0, y: 0.37, width: 0.32, height: 0.28, expectedOrientation: "vertical", priority: 90 },
      { id: "mid-2", x: 0.34, y: 0.37, width: 0.32, height: 0.28, expectedOrientation: "vertical", priority: 89 },
      { id: "mid-3", x: 0.68, y: 0.37, width: 0.32, height: 0.28, expectedOrientation: "vertical", priority: 88 },
      { id: "bot-1", x: 0, y: 0.71, width: 0.235, height: 0.29, expectedOrientation: "any", priority: 87 },
      { id: "bot-2", x: 0.255, y: 0.71, width: 0.235, height: 0.29, expectedOrientation: "any", priority: 86 },
      { id: "bot-3", x: 0.51, y: 0.71, width: 0.235, height: 0.29, expectedOrientation: "any", priority: 85 }
    ]
  },
  {
    id: "eight-portrait-runway",
    label: "Otto Portrait Runway",
    description: "Hero verticale e mosaico laterale per selezioni ricche di ritratti.",
    style: "collage",
    affinity: "portrait-heavy",
    targetSheetOrientation: "portrait",
    minPhotos: 8,
    maxPhotos: 8,
    slots: [
      { id: "hero-left", x: 0, y: 0, width: 0.34, height: 1, expectedOrientation: "vertical", priority: 100 },
      { id: "top-1", x: 0.37, y: 0, width: 0.305, height: 0.23, expectedOrientation: "horizontal", priority: 92 },
      { id: "top-2", x: 0.695, y: 0, width: 0.305, height: 0.23, expectedOrientation: "horizontal", priority: 91 },
      { id: "mid-1", x: 0.37, y: 0.27, width: 0.305, height: 0.23, expectedOrientation: "horizontal", priority: 90 },
      { id: "mid-2", x: 0.695, y: 0.27, width: 0.305, height: 0.23, expectedOrientation: "horizontal", priority: 89 },
      { id: "bot-1", x: 0.37, y: 0.54, width: 0.19, height: 0.46, expectedOrientation: "vertical", priority: 88 },
      { id: "bot-2", x: 0.59, y: 0.54, width: 0.19, height: 0.46, expectedOrientation: "vertical", priority: 87 },
      { id: "bot-3", x: 0.81, y: 0.54, width: 0.19, height: 0.46, expectedOrientation: "vertical", priority: 86 }
    ]
  }
];

const STORY_TEMPLATES_5_TO_8: LayoutTemplate[] = [
  {
    id: "five-hero-cascade",
    label: "Cinque Hero Cascade",
    description: "Hero verticale con quattro supporti per racconto dinamico.",
    style: "editorial",
    affinity: "portrait-heavy",
    targetSheetOrientation: "portrait",
    minPhotos: 5,
    maxPhotos: 5,
    slots: [
      { id: "hero", x: 0, y: 0, width: 0.56, height: 1, expectedOrientation: "vertical", priority: 100 },
      { id: "r1", x: 0.6, y: 0, width: 0.4, height: 0.235, expectedOrientation: "horizontal", priority: 88 },
      { id: "r2", x: 0.6, y: 0.255, width: 0.4, height: 0.235, expectedOrientation: "horizontal", priority: 86 },
      { id: "r3", x: 0.6, y: 0.51, width: 0.4, height: 0.235, expectedOrientation: "horizontal", priority: 84 },
      { id: "r4", x: 0.6, y: 0.765, width: 0.4, height: 0.235, expectedOrientation: "horizontal", priority: 82 }
    ]
  },
  {
    id: "five-landscape-ribbon",
    label: "Cinque Ribbon",
    description: "Banda hero orizzontale con base a quattro tasselli.",
    style: "collage",
    affinity: "landscape-heavy",
    targetSheetOrientation: "portrait",
    minPhotos: 5,
    maxPhotos: 5,
    slots: [
      { id: "hero-top", x: 0, y: 0, width: 1, height: 0.4, expectedOrientation: "horizontal", priority: 100 },
      { id: "b1", x: 0, y: 0.44, width: 0.49, height: 0.27, expectedOrientation: "any", priority: 86 },
      { id: "b2", x: 0.51, y: 0.44, width: 0.49, height: 0.27, expectedOrientation: "any", priority: 84 },
      { id: "b3", x: 0, y: 0.73, width: 0.49, height: 0.27, expectedOrientation: "any", priority: 82 },
      { id: "b4", x: 0.51, y: 0.73, width: 0.49, height: 0.27, expectedOrientation: "any", priority: 80 }
    ]
  },
  {
    id: "six-triptych-double",
    label: "Sei Triptych Double",
    description: "Doppia fascia da tre slot per composizioni bilanciate.",
    style: "balanced-grid",
    affinity: "mixed",
    targetSheetOrientation: "portrait",
    minPhotos: 6,
    maxPhotos: 6,
    slots: [
      { id: "t1", x: 0, y: 0, width: 0.32, height: 0.48, expectedOrientation: "vertical", priority: 95 },
      { id: "t2", x: 0.34, y: 0, width: 0.32, height: 0.48, expectedOrientation: "vertical", priority: 94 },
      { id: "t3", x: 0.68, y: 0, width: 0.32, height: 0.48, expectedOrientation: "vertical", priority: 93 },
      { id: "b1", x: 0, y: 0.52, width: 0.32, height: 0.48, expectedOrientation: "vertical", priority: 92 },
      { id: "b2", x: 0.34, y: 0.52, width: 0.32, height: 0.48, expectedOrientation: "vertical", priority: 91 },
      { id: "b3", x: 0.68, y: 0.52, width: 0.32, height: 0.48, expectedOrientation: "vertical", priority: 90 }
    ]
  },
  {
    id: "six-hero-plus-strip",
    label: "Sei Hero Plus Strip",
    description: "Un hero alto e una strip inferiore a cinque immagini.",
    style: "editorial",
    affinity: "mixed",
    targetSheetOrientation: "portrait",
    minPhotos: 6,
    maxPhotos: 6,
    slots: [
      { id: "hero", x: 0, y: 0, width: 1, height: 0.56, expectedOrientation: "horizontal", priority: 100 },
      { id: "s1", x: 0, y: 0.6, width: 0.19, height: 0.4, expectedOrientation: "any", priority: 88 },
      { id: "s2", x: 0.2025, y: 0.6, width: 0.19, height: 0.4, expectedOrientation: "any", priority: 87 },
      { id: "s3", x: 0.405, y: 0.6, width: 0.19, height: 0.4, expectedOrientation: "any", priority: 86 },
      { id: "s4", x: 0.6075, y: 0.6, width: 0.19, height: 0.4, expectedOrientation: "any", priority: 85 },
      { id: "s5", x: 0.81, y: 0.6, width: 0.19, height: 0.4, expectedOrientation: "any", priority: 84 }
    ]
  },
  {
    id: "seven-story-bridge",
    label: "Sette Story Bridge",
    description: "Composizione a ponte con slot ampio centrale.",
    style: "editorial",
    affinity: "mixed",
    targetSheetOrientation: "portrait",
    minPhotos: 7,
    maxPhotos: 7,
    slots: [
      { id: "top-left", x: 0, y: 0, width: 0.32, height: 0.3, expectedOrientation: "vertical", priority: 96 },
      { id: "top-mid", x: 0.34, y: 0, width: 0.32, height: 0.3, expectedOrientation: "vertical", priority: 95 },
      { id: "top-right", x: 0.68, y: 0, width: 0.32, height: 0.3, expectedOrientation: "vertical", priority: 94 },
      { id: "bridge", x: 0.16, y: 0.34, width: 0.68, height: 0.32, expectedOrientation: "horizontal", priority: 100 },
      { id: "bot-left", x: 0, y: 0.7, width: 0.32, height: 0.3, expectedOrientation: "vertical", priority: 93 },
      { id: "bot-mid", x: 0.34, y: 0.7, width: 0.32, height: 0.3, expectedOrientation: "vertical", priority: 92 },
      { id: "bot-right", x: 0.68, y: 0.7, width: 0.32, height: 0.3, expectedOrientation: "vertical", priority: 91 }
    ]
  },
  {
    id: "eight-magazine-mix",
    label: "Otto Magazine Mix",
    description: "Layout magazine con mix verticale/orizzontale.",
    style: "collage",
    affinity: "mixed",
    targetSheetOrientation: "portrait",
    minPhotos: 8,
    maxPhotos: 8,
    slots: [
      { id: "hero-left", x: 0, y: 0, width: 0.48, height: 0.62, expectedOrientation: "vertical", priority: 100 },
      { id: "top-right-a", x: 0.52, y: 0, width: 0.48, height: 0.19, expectedOrientation: "horizontal", priority: 90 },
      { id: "top-right-b", x: 0.52, y: 0.215, width: 0.48, height: 0.19, expectedOrientation: "horizontal", priority: 89 },
      { id: "top-right-c", x: 0.52, y: 0.43, width: 0.48, height: 0.19, expectedOrientation: "horizontal", priority: 88 },
      { id: "bottom-1", x: 0, y: 0.66, width: 0.235, height: 0.34, expectedOrientation: "any", priority: 87 },
      { id: "bottom-2", x: 0.255, y: 0.66, width: 0.235, height: 0.34, expectedOrientation: "any", priority: 86 },
      { id: "bottom-3", x: 0.52, y: 0.66, width: 0.235, height: 0.34, expectedOrientation: "any", priority: 85 },
      { id: "bottom-4", x: 0.765, y: 0.66, width: 0.235, height: 0.34, expectedOrientation: "any", priority: 84 }
    ]
  }
];

const SIDE_AWARE_TEMPLATES: LayoutTemplate[] = [
  createVariantTemplate({
    id: "duo-hero-focus-left",
    label: "Doppio Hero Left",
    description: "Hero verticale a sinistra con supporto laterale per aperture dinamiche.",
    style: "editorial",
    affinity: "portrait-heavy",
    targetSheetOrientation: "portrait",
    variantGroupId: "duo-hero-focus",
    variantRole: "mirror-left",
    minPhotos: 2,
    maxPhotos: 2,
    slots: [
      { id: "hero-left", x: 0, y: 0, width: 0.58, height: 1, expectedOrientation: "vertical", priority: 100 },
      { id: "support-right", x: 0.63, y: 0.12, width: 0.37, height: 0.76, expectedOrientation: "vertical", priority: 84 }
    ]
  }),
  createVariantTemplate({
    id: "duo-hero-focus-right",
    label: "Doppio Hero Right",
    description: "Versione specchiata per spread coerenti sul lato destro.",
    style: "editorial",
    affinity: "portrait-heavy",
    targetSheetOrientation: "portrait",
    variantGroupId: "duo-hero-focus",
    variantRole: "mirror-right",
    minPhotos: 2,
    maxPhotos: 2,
    slots: mirrorSlotsHorizontally([
      { id: "hero-left", x: 0, y: 0, width: 0.58, height: 1, expectedOrientation: "vertical", priority: 100 },
      { id: "support-right", x: 0.63, y: 0.12, width: 0.37, height: 0.76, expectedOrientation: "vertical", priority: 84 }
    ])
  }),
  createVariantTemplate({
    id: "trio-asymmetric-story-left",
    label: "Trio Story Left",
    description: "Hero alto a sinistra e doppia colonna di supporto per spread editoriali.",
    style: "editorial",
    affinity: "mixed",
    targetSheetOrientation: "portrait",
    variantGroupId: "trio-asymmetric-story",
    variantRole: "companion-left",
    minPhotos: 3,
    maxPhotos: 3,
    slots: [
      { id: "hero-left", x: 0, y: 0, width: 0.57, height: 1, expectedOrientation: "vertical", priority: 100 },
      { id: "top-right", x: 0.61, y: 0, width: 0.39, height: 0.45, expectedOrientation: "horizontal", priority: 88 },
      { id: "bottom-right", x: 0.61, y: 0.51, width: 0.39, height: 0.49, expectedOrientation: "horizontal", priority: 82 }
    ]
  }),
  createVariantTemplate({
    id: "trio-asymmetric-story-right",
    label: "Trio Story Right",
    description: "Companion non speculare con peso narrativo verso il lato destro.",
    style: "editorial",
    affinity: "mixed",
    targetSheetOrientation: "portrait",
    variantGroupId: "trio-asymmetric-story",
    variantRole: "companion-right",
    minPhotos: 3,
    maxPhotos: 3,
    slots: [
      { id: "top-left", x: 0, y: 0, width: 0.39, height: 0.45, expectedOrientation: "horizontal", priority: 88 },
      { id: "bottom-left", x: 0, y: 0.51, width: 0.39, height: 0.49, expectedOrientation: "horizontal", priority: 82 },
      { id: "hero-right", x: 0.43, y: 0, width: 0.57, height: 1, expectedOrientation: "vertical", priority: 100 }
    ]
  }),
  createVariantTemplate({
    id: "four-cascade-opening-left",
    label: "Quattro Cascade Left",
    description: "Hero verticale con tre supporti a cascata, pensato per la pagina sinistra.",
    style: "collage",
    affinity: "portrait-heavy",
    targetSheetOrientation: "portrait",
    variantGroupId: "four-cascade-opening",
    variantRole: "mirror-left",
    minPhotos: 4,
    maxPhotos: 4,
    slots: [
      { id: "hero-left", x: 0, y: 0, width: 0.46, height: 1, expectedOrientation: "vertical", priority: 100 },
      { id: "top-right", x: 0.5, y: 0, width: 0.5, height: 0.28, expectedOrientation: "horizontal", priority: 88 },
      { id: "mid-right", x: 0.56, y: 0.34, width: 0.44, height: 0.28, expectedOrientation: "horizontal", priority: 84 },
      { id: "bottom-right", x: 0.62, y: 0.68, width: 0.38, height: 0.32, expectedOrientation: "vertical", priority: 80 }
    ]
  }),
  createVariantTemplate({
    id: "four-cascade-opening-right",
    label: "Quattro Cascade Right",
    description: "Versione specchiata per chiudere lo spread mantenendo la gerarchia.",
    style: "collage",
    affinity: "portrait-heavy",
    targetSheetOrientation: "portrait",
    variantGroupId: "four-cascade-opening",
    variantRole: "mirror-right",
    minPhotos: 4,
    maxPhotos: 4,
    slots: mirrorSlotsHorizontally([
      { id: "hero-left", x: 0, y: 0, width: 0.46, height: 1, expectedOrientation: "vertical", priority: 100 },
      { id: "top-right", x: 0.5, y: 0, width: 0.5, height: 0.28, expectedOrientation: "horizontal", priority: 88 },
      { id: "mid-right", x: 0.56, y: 0.34, width: 0.44, height: 0.28, expectedOrientation: "horizontal", priority: 84 },
      { id: "bottom-right", x: 0.62, y: 0.68, width: 0.38, height: 0.32, expectedOrientation: "vertical", priority: 80 }
    ])
  }),
  createVariantTemplate({
    id: "five-ribbon-companion-left",
    label: "Cinque Ribbon Left",
    description: "Hero orizzontale con supporti sbilanciati per lato sinistro.",
    style: "editorial",
    affinity: "landscape-heavy",
    targetSheetOrientation: "portrait",
    variantGroupId: "five-ribbon-companion",
    variantRole: "companion-left",
    minPhotos: 5,
    maxPhotos: 5,
    slots: [
      { id: "hero-top", x: 0, y: 0, width: 1, height: 0.34, expectedOrientation: "horizontal", priority: 100 },
      { id: "left-stack-1", x: 0, y: 0.4, width: 0.43, height: 0.28, expectedOrientation: "vertical", priority: 90 },
      { id: "left-stack-2", x: 0, y: 0.72, width: 0.43, height: 0.28, expectedOrientation: "vertical", priority: 86 },
      { id: "right-wide-1", x: 0.49, y: 0.4, width: 0.51, height: 0.26, expectedOrientation: "horizontal", priority: 84 },
      { id: "right-wide-2", x: 0.49, y: 0.72, width: 0.51, height: 0.28, expectedOrientation: "horizontal", priority: 82 }
    ]
  }),
  createVariantTemplate({
    id: "five-ribbon-companion-right",
    label: "Cinque Ribbon Right",
    description: "Companion per lato destro con massa visiva invertita ma non speculare.",
    style: "editorial",
    affinity: "landscape-heavy",
    targetSheetOrientation: "portrait",
    variantGroupId: "five-ribbon-companion",
    variantRole: "companion-right",
    minPhotos: 5,
    maxPhotos: 5,
    slots: [
      { id: "hero-top", x: 0, y: 0, width: 1, height: 0.34, expectedOrientation: "horizontal", priority: 100 },
      { id: "left-wide-1", x: 0, y: 0.4, width: 0.51, height: 0.26, expectedOrientation: "horizontal", priority: 84 },
      { id: "left-wide-2", x: 0, y: 0.72, width: 0.51, height: 0.28, expectedOrientation: "horizontal", priority: 82 },
      { id: "right-stack-1", x: 0.57, y: 0.4, width: 0.43, height: 0.28, expectedOrientation: "vertical", priority: 90 },
      { id: "right-stack-2", x: 0.57, y: 0.72, width: 0.43, height: 0.28, expectedOrientation: "vertical", priority: 86 }
    ]
  }),
  createVariantTemplate({
    id: "six-mosaic-spread-left",
    label: "Sei Mosaic Left",
    description: "Mosaico arioso con hero e tasselli di supporto, variante lato sinistro.",
    style: "collage",
    affinity: "mixed",
    targetSheetOrientation: "portrait",
    variantGroupId: "six-mosaic-spread",
    variantRole: "mirror-left",
    minPhotos: 6,
    maxPhotos: 6,
    slots: [
      { id: "hero-left", x: 0, y: 0, width: 0.43, height: 1, expectedOrientation: "vertical", priority: 100 },
      { id: "top-right-a", x: 0.47, y: 0, width: 0.24, height: 0.31, expectedOrientation: "horizontal", priority: 90 },
      { id: "top-right-b", x: 0.75, y: 0, width: 0.25, height: 0.31, expectedOrientation: "horizontal", priority: 88 },
      { id: "mid-right", x: 0.47, y: 0.37, width: 0.53, height: 0.27, expectedOrientation: "horizontal", priority: 86 },
      { id: "bottom-right-a", x: 0.47, y: 0.7, width: 0.24, height: 0.3, expectedOrientation: "vertical", priority: 82 },
      { id: "bottom-right-b", x: 0.75, y: 0.7, width: 0.25, height: 0.3, expectedOrientation: "vertical", priority: 80 }
    ]
  }),
  createVariantTemplate({
    id: "six-mosaic-spread-right",
    label: "Sei Mosaic Right",
    description: "Mosaico specchiato per spread più leggibili e meno ripetitivi.",
    style: "collage",
    affinity: "mixed",
    targetSheetOrientation: "portrait",
    variantGroupId: "six-mosaic-spread",
    variantRole: "mirror-right",
    minPhotos: 6,
    maxPhotos: 6,
    slots: mirrorSlotsHorizontally([
      { id: "hero-left", x: 0, y: 0, width: 0.43, height: 1, expectedOrientation: "vertical", priority: 100 },
      { id: "top-right-a", x: 0.47, y: 0, width: 0.24, height: 0.31, expectedOrientation: "horizontal", priority: 90 },
      { id: "top-right-b", x: 0.75, y: 0, width: 0.25, height: 0.31, expectedOrientation: "horizontal", priority: 88 },
      { id: "mid-right", x: 0.47, y: 0.37, width: 0.53, height: 0.27, expectedOrientation: "horizontal", priority: 86 },
      { id: "bottom-right-a", x: 0.47, y: 0.7, width: 0.24, height: 0.3, expectedOrientation: "vertical", priority: 82 },
      { id: "bottom-right-b", x: 0.75, y: 0.7, width: 0.25, height: 0.3, expectedOrientation: "vertical", priority: 80 }
    ])
  })
];

const STORY_TEMPLATES_9_TO_12: LayoutTemplate[] = [
  {
    id: "nine-magazine-ladder",
    label: "Nove Magazine Ladder",
    description: "Hero centrale con colonne laterali per narrazione ritmo-alto.",
    style: "editorial",
    affinity: "mixed",
    targetSheetOrientation: "portrait",
    minPhotos: 9,
    maxPhotos: 9,
    slots: [
      { id: "left-1", x: 0, y: 0, width: 0.22, height: 0.32, expectedOrientation: "vertical", priority: 88 },
      { id: "left-2", x: 0, y: 0.34, width: 0.22, height: 0.32, expectedOrientation: "vertical", priority: 86 },
      { id: "left-3", x: 0, y: 0.68, width: 0.22, height: 0.32, expectedOrientation: "vertical", priority: 84 },
      { id: "hero", x: 0.25, y: 0, width: 0.5, height: 0.66, expectedOrientation: "horizontal", priority: 100 },
      { id: "bottom-center-1", x: 0.25, y: 0.69, width: 0.24, height: 0.31, expectedOrientation: "any", priority: 83 },
      { id: "bottom-center-2", x: 0.51, y: 0.69, width: 0.24, height: 0.31, expectedOrientation: "any", priority: 82 },
      { id: "right-1", x: 0.78, y: 0, width: 0.22, height: 0.32, expectedOrientation: "vertical", priority: 87 },
      { id: "right-2", x: 0.78, y: 0.34, width: 0.22, height: 0.32, expectedOrientation: "vertical", priority: 85 },
      { id: "right-3", x: 0.78, y: 0.68, width: 0.22, height: 0.32, expectedOrientation: "vertical", priority: 81 }
    ]
  },
  {
    id: "nine-ribbon-plus-grid",
    label: "Nove Ribbon Plus",
    description: "Fascia hero superiore e base 4x2 per ritmo regolare.",
    style: "collage",
    affinity: "landscape-heavy",
    targetSheetOrientation: "portrait",
    minPhotos: 9,
    maxPhotos: 9,
    slots: [
      { id: "hero-top", x: 0, y: 0, width: 1, height: 0.3, expectedOrientation: "horizontal", priority: 100 },
      { id: "g1", x: 0, y: 0.34, width: 0.24, height: 0.31, expectedOrientation: "any", priority: 90 },
      { id: "g2", x: 0.2533, y: 0.34, width: 0.24, height: 0.31, expectedOrientation: "any", priority: 89 },
      { id: "g3", x: 0.5066, y: 0.34, width: 0.24, height: 0.31, expectedOrientation: "any", priority: 88 },
      { id: "g4", x: 0.7599, y: 0.34, width: 0.24, height: 0.31, expectedOrientation: "any", priority: 87 },
      { id: "g5", x: 0, y: 0.69, width: 0.24, height: 0.31, expectedOrientation: "any", priority: 86 },
      { id: "g6", x: 0.2533, y: 0.69, width: 0.24, height: 0.31, expectedOrientation: "any", priority: 85 },
      { id: "g7", x: 0.5066, y: 0.69, width: 0.24, height: 0.31, expectedOrientation: "any", priority: 84 },
      { id: "g8", x: 0.7599, y: 0.69, width: 0.24, height: 0.31, expectedOrientation: "any", priority: 83 }
    ]
  },
  {
    id: "ten-two-heroes",
    label: "Dieci Double Hero",
    description: "Due hero orizzontali separati con colonne di supporto.",
    style: "editorial",
    affinity: "mixed",
    targetSheetOrientation: "portrait",
    minPhotos: 10,
    maxPhotos: 10,
    slots: [
      { id: "top-left", x: 0, y: 0, width: 0.24, height: 0.28, expectedOrientation: "vertical", priority: 90 },
      { id: "hero-top", x: 0.27, y: 0, width: 0.46, height: 0.28, expectedOrientation: "horizontal", priority: 100 },
      { id: "top-right", x: 0.76, y: 0, width: 0.24, height: 0.28, expectedOrientation: "vertical", priority: 89 },
      { id: "mid-left-1", x: 0, y: 0.31, width: 0.24, height: 0.335, expectedOrientation: "vertical", priority: 88 },
      { id: "mid-left-2", x: 0.27, y: 0.31, width: 0.22, height: 0.335, expectedOrientation: "vertical", priority: 87 },
      { id: "mid-right-1", x: 0.51, y: 0.31, width: 0.22, height: 0.335, expectedOrientation: "vertical", priority: 86 },
      { id: "mid-right-2", x: 0.76, y: 0.31, width: 0.24, height: 0.335, expectedOrientation: "vertical", priority: 85 },
      { id: "bottom-left", x: 0, y: 0.675, width: 0.24, height: 0.325, expectedOrientation: "vertical", priority: 84 },
      { id: "hero-bottom", x: 0.27, y: 0.675, width: 0.46, height: 0.325, expectedOrientation: "horizontal", priority: 96 },
      { id: "bottom-right", x: 0.76, y: 0.675, width: 0.24, height: 0.325, expectedOrientation: "vertical", priority: 83 }
    ]
  },
  {
    id: "ten-staggered-columns",
    label: "Dieci Staggered Columns",
    description: "Tre colonne sfalsate per un look magazine contemporaneo.",
    style: "collage",
    affinity: "portrait-heavy",
    targetSheetOrientation: "portrait",
    minPhotos: 10,
    maxPhotos: 10,
    slots: [
      { id: "c1-1", x: 0, y: 0, width: 0.31, height: 0.24, expectedOrientation: "horizontal", priority: 92 },
      { id: "c1-2", x: 0, y: 0.27, width: 0.31, height: 0.36, expectedOrientation: "vertical", priority: 91 },
      { id: "c1-3", x: 0, y: 0.66, width: 0.31, height: 0.34, expectedOrientation: "vertical", priority: 90 },
      { id: "c2-1", x: 0.345, y: 0, width: 0.31, height: 0.34, expectedOrientation: "vertical", priority: 95 },
      { id: "c2-2", x: 0.345, y: 0.37, width: 0.31, height: 0.26, expectedOrientation: "horizontal", priority: 94 },
      { id: "c2-3", x: 0.345, y: 0.66, width: 0.31, height: 0.34, expectedOrientation: "vertical", priority: 93 },
      { id: "c3-1", x: 0.69, y: 0, width: 0.31, height: 0.24, expectedOrientation: "horizontal", priority: 89 },
      { id: "c3-2", x: 0.69, y: 0.27, width: 0.31, height: 0.36, expectedOrientation: "vertical", priority: 88 },
      { id: "c3-3", x: 0.69, y: 0.66, width: 0.31, height: 0.17, expectedOrientation: "horizontal", priority: 87 },
      { id: "c3-4", x: 0.69, y: 0.85, width: 0.31, height: 0.15, expectedOrientation: "horizontal", priority: 86 }
    ]
  },
  {
    id: "eleven-story-bands",
    label: "Undici Story Bands",
    description: "Due bande narrative con fascia centrale protagonista.",
    style: "editorial",
    affinity: "mixed",
    targetSheetOrientation: "portrait",
    minPhotos: 11,
    maxPhotos: 11,
    slots: [
      { id: "top-1", x: 0, y: 0, width: 0.24, height: 0.24, expectedOrientation: "any", priority: 90 },
      { id: "top-2", x: 0.2533, y: 0, width: 0.24, height: 0.24, expectedOrientation: "any", priority: 89 },
      { id: "top-3", x: 0.5066, y: 0, width: 0.24, height: 0.24, expectedOrientation: "any", priority: 88 },
      { id: "top-4", x: 0.7599, y: 0, width: 0.24, height: 0.24, expectedOrientation: "any", priority: 87 },
      { id: "hero-mid", x: 0, y: 0.275, width: 1, height: 0.42, expectedOrientation: "horizontal", priority: 100 },
      { id: "bot-1", x: 0, y: 0.73, width: 0.19, height: 0.27, expectedOrientation: "vertical", priority: 86 },
      { id: "bot-2", x: 0.2025, y: 0.73, width: 0.19, height: 0.27, expectedOrientation: "vertical", priority: 85 },
      { id: "bot-3", x: 0.405, y: 0.73, width: 0.19, height: 0.27, expectedOrientation: "vertical", priority: 84 },
      { id: "bot-4", x: 0.6075, y: 0.73, width: 0.19, height: 0.27, expectedOrientation: "vertical", priority: 83 },
      { id: "bot-5", x: 0.81, y: 0.73, width: 0.19, height: 0.27, expectedOrientation: "vertical", priority: 82 },
      { id: "mid-overlay", x: 0.38, y: 0.31, width: 0.24, height: 0.22, expectedOrientation: "vertical", priority: 91 }
    ]
  },
  {
    id: "eleven-grid-hero-left",
    label: "Undici Hero Left",
    description: "Hero verticale a sinistra con mosaico a destra.",
    style: "collage",
    affinity: "portrait-heavy",
    targetSheetOrientation: "portrait",
    minPhotos: 11,
    maxPhotos: 11,
    slots: [
      { id: "hero-left", x: 0, y: 0, width: 0.34, height: 1, expectedOrientation: "vertical", priority: 100 },
      { id: "r1", x: 0.37, y: 0, width: 0.305, height: 0.24, expectedOrientation: "horizontal", priority: 90 },
      { id: "r2", x: 0.695, y: 0, width: 0.305, height: 0.24, expectedOrientation: "horizontal", priority: 89 },
      { id: "r3", x: 0.37, y: 0.26, width: 0.305, height: 0.24, expectedOrientation: "horizontal", priority: 88 },
      { id: "r4", x: 0.695, y: 0.26, width: 0.305, height: 0.24, expectedOrientation: "horizontal", priority: 87 },
      { id: "r5", x: 0.37, y: 0.52, width: 0.305, height: 0.24, expectedOrientation: "horizontal", priority: 86 },
      { id: "r6", x: 0.695, y: 0.52, width: 0.305, height: 0.24, expectedOrientation: "horizontal", priority: 85 },
      { id: "r7", x: 0.37, y: 0.78, width: 0.149, height: 0.22, expectedOrientation: "vertical", priority: 84 },
      { id: "r8", x: 0.528, y: 0.78, width: 0.149, height: 0.22, expectedOrientation: "vertical", priority: 83 },
      { id: "r9", x: 0.695, y: 0.78, width: 0.149, height: 0.22, expectedOrientation: "vertical", priority: 82 },
      { id: "r10", x: 0.853, y: 0.78, width: 0.147, height: 0.22, expectedOrientation: "vertical", priority: 81 }
    ]
  },
  {
    id: "twelve-editorial-matrix",
    label: "Dodici Editorial Matrix",
    description: "Matrice ricca con doppio hero per album completi.",
    style: "editorial",
    affinity: "mixed",
    targetSheetOrientation: "portrait",
    minPhotos: 12,
    maxPhotos: 12,
    slots: [
      { id: "hero-top", x: 0, y: 0, width: 0.66, height: 0.3, expectedOrientation: "horizontal", priority: 100 },
      { id: "top-right", x: 0.69, y: 0, width: 0.31, height: 0.3, expectedOrientation: "vertical", priority: 90 },
      { id: "mid-left-1", x: 0, y: 0.33, width: 0.24, height: 0.31, expectedOrientation: "vertical", priority: 89 },
      { id: "mid-left-2", x: 0.26, y: 0.33, width: 0.24, height: 0.31, expectedOrientation: "vertical", priority: 88 },
      { id: "mid-left-3", x: 0.52, y: 0.33, width: 0.24, height: 0.31, expectedOrientation: "vertical", priority: 87 },
      { id: "mid-right", x: 0.78, y: 0.33, width: 0.22, height: 0.31, expectedOrientation: "vertical", priority: 86 },
      { id: "hero-bottom", x: 0, y: 0.67, width: 0.5, height: 0.33, expectedOrientation: "horizontal", priority: 95 },
      { id: "bottom-1", x: 0.52, y: 0.67, width: 0.153, height: 0.33, expectedOrientation: "vertical", priority: 85 },
      { id: "bottom-2", x: 0.6835, y: 0.67, width: 0.153, height: 0.33, expectedOrientation: "vertical", priority: 84 },
      { id: "bottom-3", x: 0.847, y: 0.67, width: 0.153, height: 0.33, expectedOrientation: "vertical", priority: 83 },
      { id: "floating-1", x: 0.69, y: 0.16, width: 0.14, height: 0.14, expectedOrientation: "any", priority: 82 },
      { id: "floating-2", x: 0.85, y: 0.16, width: 0.14, height: 0.14, expectedOrientation: "any", priority: 81 }
    ]
  },
  {
    id: "twelve-clean-columns",
    label: "Dodici Clean Columns",
    description: "Tre colonne editoriali con cadenza regolare e pulita.",
    style: "balanced-grid",
    affinity: "any",
    targetSheetOrientation: "portrait",
    minPhotos: 12,
    maxPhotos: 12,
    slots: [
      { id: "l1", x: 0, y: 0, width: 0.32, height: 0.24, expectedOrientation: "horizontal", priority: 90 },
      { id: "l2", x: 0, y: 0.26, width: 0.32, height: 0.24, expectedOrientation: "horizontal", priority: 89 },
      { id: "l3", x: 0, y: 0.52, width: 0.32, height: 0.24, expectedOrientation: "horizontal", priority: 88 },
      { id: "l4", x: 0, y: 0.78, width: 0.32, height: 0.22, expectedOrientation: "horizontal", priority: 87 },
      { id: "m1", x: 0.34, y: 0, width: 0.32, height: 0.32, expectedOrientation: "vertical", priority: 95 },
      { id: "m2", x: 0.34, y: 0.34, width: 0.32, height: 0.32, expectedOrientation: "vertical", priority: 94 },
      { id: "m3", x: 0.34, y: 0.68, width: 0.32, height: 0.32, expectedOrientation: "vertical", priority: 93 },
      { id: "r1", x: 0.68, y: 0, width: 0.32, height: 0.24, expectedOrientation: "horizontal", priority: 86 },
      { id: "r2", x: 0.68, y: 0.26, width: 0.32, height: 0.24, expectedOrientation: "horizontal", priority: 85 },
      { id: "r3", x: 0.68, y: 0.52, width: 0.32, height: 0.24, expectedOrientation: "horizontal", priority: 84 },
      { id: "r4", x: 0.68, y: 0.78, width: 0.156, height: 0.22, expectedOrientation: "vertical", priority: 83 },
      { id: "r5", x: 0.844, y: 0.78, width: 0.156, height: 0.22, expectedOrientation: "vertical", priority: 82 }
    ]
  }
];

const STORY_TEMPLATES_13_TO_16: LayoutTemplate[] = [
  {
    id: "thirteen-ribbon-matrix",
    label: "Tredici Ribbon Matrix",
    description: "Fascia hero centrale con corona di supporto per sequenze ricche.",
    style: "editorial",
    affinity: "landscape-heavy",
    targetSheetOrientation: "portrait",
    minPhotos: 13,
    maxPhotos: 13,
    slots: [
      { id: "top-1", x: 0, y: 0, width: 0.235, height: 0.17, expectedOrientation: "vertical", priority: 91 },
      { id: "top-2", x: 0.255, y: 0, width: 0.235, height: 0.17, expectedOrientation: "vertical", priority: 90 },
      { id: "top-3", x: 0.51, y: 0, width: 0.235, height: 0.17, expectedOrientation: "vertical", priority: 89 },
      { id: "top-4", x: 0.765, y: 0, width: 0.235, height: 0.17, expectedOrientation: "vertical", priority: 88 },
      { id: "hero-band", x: 0, y: 0.21, width: 1, height: 0.27, expectedOrientation: "horizontal", priority: 100 },
      { id: "mid-1", x: 0, y: 0.52, width: 0.235, height: 0.22, expectedOrientation: "any", priority: 87 },
      { id: "mid-2", x: 0.255, y: 0.52, width: 0.235, height: 0.22, expectedOrientation: "any", priority: 86 },
      { id: "mid-3", x: 0.51, y: 0.52, width: 0.235, height: 0.22, expectedOrientation: "any", priority: 85 },
      { id: "mid-4", x: 0.765, y: 0.52, width: 0.235, height: 0.22, expectedOrientation: "any", priority: 84 },
      { id: "bot-1", x: 0, y: 0.78, width: 0.235, height: 0.22, expectedOrientation: "any", priority: 83 },
      { id: "bot-2", x: 0.255, y: 0.78, width: 0.235, height: 0.22, expectedOrientation: "any", priority: 82 },
      { id: "bot-3", x: 0.51, y: 0.78, width: 0.235, height: 0.22, expectedOrientation: "any", priority: 81 },
      { id: "bot-4", x: 0.765, y: 0.78, width: 0.235, height: 0.22, expectedOrientation: "any", priority: 80 }
    ]
  },
  {
    id: "fourteen-hero-column-grid",
    label: "Quattordici Hero Column Grid",
    description: "Hero verticale, tre bande narrative e una base da dieci immagini.",
    style: "collage",
    affinity: "mixed",
    targetSheetOrientation: "portrait",
    minPhotos: 14,
    maxPhotos: 14,
    slots: [
      { id: "hero-left", x: 0, y: 0, width: 0.32, height: 0.58, expectedOrientation: "vertical", priority: 100 },
      { id: "story-1", x: 0.35, y: 0, width: 0.65, height: 0.17, expectedOrientation: "horizontal", priority: 94 },
      { id: "story-2", x: 0.35, y: 0.2, width: 0.65, height: 0.17, expectedOrientation: "horizontal", priority: 93 },
      { id: "story-3", x: 0.35, y: 0.4, width: 0.65, height: 0.18, expectedOrientation: "horizontal", priority: 92 },
      { id: "g1", x: 0, y: 0.62, width: 0.184, height: 0.16, expectedOrientation: "any", priority: 89 },
      { id: "g2", x: 0.204, y: 0.62, width: 0.184, height: 0.16, expectedOrientation: "any", priority: 88 },
      { id: "g3", x: 0.408, y: 0.62, width: 0.184, height: 0.16, expectedOrientation: "any", priority: 87 },
      { id: "g4", x: 0.612, y: 0.62, width: 0.184, height: 0.16, expectedOrientation: "any", priority: 86 },
      { id: "g5", x: 0.816, y: 0.62, width: 0.184, height: 0.16, expectedOrientation: "any", priority: 85 },
      { id: "g6", x: 0, y: 0.82, width: 0.184, height: 0.16, expectedOrientation: "any", priority: 84 },
      { id: "g7", x: 0.204, y: 0.82, width: 0.184, height: 0.16, expectedOrientation: "any", priority: 83 },
      { id: "g8", x: 0.408, y: 0.82, width: 0.184, height: 0.16, expectedOrientation: "any", priority: 82 },
      { id: "g9", x: 0.612, y: 0.82, width: 0.184, height: 0.16, expectedOrientation: "any", priority: 81 },
      { id: "g10", x: 0.816, y: 0.82, width: 0.184, height: 0.16, expectedOrientation: "any", priority: 80 }
    ]
  },
  {
    id: "fifteen-hero-ladder-wall",
    label: "Quindici Hero Ladder",
    description: "Hero verticale a sinistra con parete narrativa destra in piu livelli.",
    style: "editorial",
    affinity: "portrait-heavy",
    targetSheetOrientation: "portrait",
    minPhotos: 15,
    maxPhotos: 15,
    slots: [
      { id: "hero-left", x: 0, y: 0, width: 0.29, height: 1, expectedOrientation: "vertical", priority: 100 },
      { id: "top-1", x: 0.32, y: 0, width: 0.32, height: 0.15, expectedOrientation: "horizontal", priority: 94 },
      { id: "top-2", x: 0.68, y: 0, width: 0.32, height: 0.15, expectedOrientation: "horizontal", priority: 93 },
      { id: "top-3", x: 0.32, y: 0.18, width: 0.32, height: 0.15, expectedOrientation: "horizontal", priority: 92 },
      { id: "top-4", x: 0.68, y: 0.18, width: 0.32, height: 0.15, expectedOrientation: "horizontal", priority: 91 },
      { id: "hero-band-right", x: 0.32, y: 0.36, width: 0.68, height: 0.18, expectedOrientation: "horizontal", priority: 97 },
      { id: "grid-1", x: 0.32, y: 0.58, width: 0.214, height: 0.126, expectedOrientation: "any", priority: 89 },
      { id: "grid-2", x: 0.553, y: 0.58, width: 0.214, height: 0.126, expectedOrientation: "any", priority: 88 },
      { id: "grid-3", x: 0.786, y: 0.58, width: 0.214, height: 0.126, expectedOrientation: "any", priority: 87 },
      { id: "grid-4", x: 0.32, y: 0.727, width: 0.214, height: 0.126, expectedOrientation: "any", priority: 86 },
      { id: "grid-5", x: 0.553, y: 0.727, width: 0.214, height: 0.126, expectedOrientation: "any", priority: 85 },
      { id: "grid-6", x: 0.786, y: 0.727, width: 0.214, height: 0.126, expectedOrientation: "any", priority: 84 },
      { id: "grid-7", x: 0.32, y: 0.874, width: 0.214, height: 0.126, expectedOrientation: "any", priority: 83 },
      { id: "grid-8", x: 0.553, y: 0.874, width: 0.214, height: 0.126, expectedOrientation: "any", priority: 82 },
      { id: "grid-9", x: 0.786, y: 0.874, width: 0.214, height: 0.126, expectedOrientation: "any", priority: 81 }
    ]
  },
  {
    id: "sixteen-double-ribbon-wall",
    label: "Sedici Double Ribbon",
    description: "Due bande hero e una parete ritmica per selezioni molto corpose.",
    style: "editorial",
    affinity: "mixed",
    targetSheetOrientation: "portrait",
    minPhotos: 16,
    maxPhotos: 16,
    slots: [
      { id: "top-1", x: 0, y: 0, width: 0.32, height: 0.16, expectedOrientation: "horizontal", priority: 92 },
      { id: "top-2", x: 0.34, y: 0, width: 0.32, height: 0.16, expectedOrientation: "horizontal", priority: 91 },
      { id: "top-3", x: 0.68, y: 0, width: 0.32, height: 0.16, expectedOrientation: "horizontal", priority: 90 },
      { id: "hero-upper", x: 0, y: 0.2, width: 1, height: 0.2, expectedOrientation: "horizontal", priority: 100 },
      { id: "mid-1", x: 0, y: 0.44, width: 0.32, height: 0.135, expectedOrientation: "any", priority: 89 },
      { id: "mid-2", x: 0.34, y: 0.44, width: 0.32, height: 0.135, expectedOrientation: "any", priority: 88 },
      { id: "mid-3", x: 0.68, y: 0.44, width: 0.32, height: 0.135, expectedOrientation: "any", priority: 87 },
      { id: "mid-4", x: 0, y: 0.595, width: 0.32, height: 0.135, expectedOrientation: "any", priority: 86 },
      { id: "mid-5", x: 0.34, y: 0.595, width: 0.32, height: 0.135, expectedOrientation: "any", priority: 85 },
      { id: "mid-6", x: 0.68, y: 0.595, width: 0.32, height: 0.135, expectedOrientation: "any", priority: 84 },
      { id: "hero-lower", x: 0, y: 0.75, width: 1, height: 0.1, expectedOrientation: "horizontal", priority: 97 },
      { id: "bot-1", x: 0, y: 0.89, width: 0.184, height: 0.11, expectedOrientation: "any", priority: 83 },
      { id: "bot-2", x: 0.204, y: 0.89, width: 0.184, height: 0.11, expectedOrientation: "any", priority: 82 },
      { id: "bot-3", x: 0.408, y: 0.89, width: 0.184, height: 0.11, expectedOrientation: "any", priority: 81 },
      { id: "bot-4", x: 0.612, y: 0.89, width: 0.184, height: 0.11, expectedOrientation: "any", priority: 80 },
      { id: "bot-5", x: 0.816, y: 0.89, width: 0.184, height: 0.11, expectedOrientation: "any", priority: 79 }
    ]
  }
];

export const DEFAULT_LAYOUT_TEMPLATES: LayoutTemplate[] = [
  ...SIDE_AWARE_TEMPLATES,
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
  },
  ...EARLY_STORY_TEMPLATES_2_TO_8,
  ...STORY_TEMPLATES_5_TO_8,
  ...STORY_TEMPLATES_9_TO_12,
  ...STORY_TEMPLATES_13_TO_16,
  ...DENSE_GRID_TEMPLATES
];
