export type PartyFrameOrientation = "vertical" | "horizontal";

export type PartyFramePresetStyle = "classic" | "modern" | "floral";

export type PartyFramePresetTemplate = {
  id: string;
  name: string;
  width: number;
  height: number;
  dpi: number;
  photoAreaX: number;
  photoAreaY: number;
  photoAreaWidth: number;
  photoAreaHeight: number;
  frameBackground: string;
  framePrimary: string;
  frameSecondary: string;
  style: PartyFramePresetStyle;
};

export const PARTY_FRAME_PRESETS: Record<string, PartyFramePresetTemplate> = {
  "classic-gold": {
    id: "classic-gold",
    name: "Cornice Oro Classica",
    width: 1772,
    height: 1181,
    dpi: 300,
    photoAreaX: 120,
    photoAreaY: 95,
    photoAreaWidth: 1530,
    photoAreaHeight: 990,
    frameBackground: "#dcb464",
    framePrimary: "#6d4a18",
    frameSecondary: "#f7e5ae",
    style: "classic",
  },
  "modern-blue": {
    id: "modern-blue",
    name: "Bordo Blu Moderno",
    width: 1959,
    height: 1307,
    dpi: 300,
    photoAreaX: 150,
    photoAreaY: 120,
    photoAreaWidth: 1659,
    photoAreaHeight: 1067,
    frameBackground: "#294f73",
    framePrimary: "#0f263b",
    frameSecondary: "#9bc3df",
    style: "modern",
  },
  floral: {
    id: "floral",
    name: "Cornice Floreale",
    width: 1772,
    height: 1181,
    dpi: 300,
    photoAreaX: 140,
    photoAreaY: 105,
    photoAreaWidth: 1492,
    photoAreaHeight: 971,
    frameBackground: "#ead8d0",
    framePrimary: "#80515c",
    frameSecondary: "#fff7ef",
    style: "floral",
  },
};

export function getPartyFramePreset(templateId: string): PartyFramePresetTemplate {
  return PARTY_FRAME_PRESETS[templateId] ?? PARTY_FRAME_PRESETS["classic-gold"];
}

export function orientPartyFramePreset(
  template: PartyFramePresetTemplate,
  orientation: PartyFrameOrientation
): PartyFramePresetTemplate {
  if (orientation !== "vertical") {
    return template;
  }

  return {
    ...template,
    width: template.height,
    height: template.width,
    photoAreaX: template.height - (template.photoAreaY + template.photoAreaHeight),
    photoAreaY: template.photoAreaX,
    photoAreaWidth: template.photoAreaHeight,
    photoAreaHeight: template.photoAreaWidth,
  };
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] ?? character);
}

export function createPresetFrameSvg(template: PartyFramePresetTemplate): string {
  const width = Math.round(template.width);
  const height = Math.round(template.height);
  const primaryStroke = Math.max(4, Math.round(Math.min(width, height) * 0.008));
  const secondaryStroke = Math.max(2, Math.round(primaryStroke * 0.45));
  const outerInset = Math.max(18, Math.round(Math.min(width, height) * 0.022));
  const innerInset = outerInset + primaryStroke * 2;
  const styleDecoration = template.style === "modern"
    ? `<path d="M0 ${height * 0.22} L${width * 0.22} 0 M${width * 0.78} ${height} L${width} ${height * 0.78}" stroke="${escapeXml(template.frameSecondary)}" stroke-width="${primaryStroke * 2}" opacity="0.38"/>`
    : template.style === "floral"
      ? `<g fill="none" stroke="${escapeXml(template.framePrimary)}" stroke-width="${secondaryStroke}" opacity="0.72">
          <circle cx="${outerInset * 1.8}" cy="${outerInset * 1.8}" r="${outerInset * 0.55}"/>
          <circle cx="${width - outerInset * 1.8}" cy="${outerInset * 1.8}" r="${outerInset * 0.55}"/>
          <circle cx="${outerInset * 1.8}" cy="${height - outerInset * 1.8}" r="${outerInset * 0.55}"/>
          <circle cx="${width - outerInset * 1.8}" cy="${height - outerInset * 1.8}" r="${outerInset * 0.55}"/>
        </g>`
      : `<path d="M${outerInset} ${outerInset * 3} V${outerInset} H${outerInset * 3} M${width - outerInset * 3} ${outerInset} H${width - outerInset} V${outerInset * 3} M${outerInset} ${height - outerInset * 3} V${height - outerInset} H${outerInset * 3} M${width - outerInset * 3} ${height - outerInset} H${width - outerInset} V${height - outerInset * 3}" stroke="${escapeXml(template.frameSecondary)}" stroke-width="${primaryStroke}" fill="none"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${escapeXml(template.frameBackground)}"/>
    <rect x="${outerInset}" y="${outerInset}" width="${width - outerInset * 2}" height="${height - outerInset * 2}" rx="${primaryStroke}" fill="none" stroke="${escapeXml(template.framePrimary)}" stroke-width="${primaryStroke}"/>
    <rect x="${innerInset}" y="${innerInset}" width="${width - innerInset * 2}" height="${height - innerInset * 2}" rx="${secondaryStroke}" fill="none" stroke="${escapeXml(template.frameSecondary)}" stroke-width="${secondaryStroke}" opacity="0.9"/>
    ${styleDecoration}
  </svg>`;
}

export function presetFrameDataUrl(template: PartyFramePresetTemplate): string {
  return `data:image/svg+xml,${encodeURIComponent(createPresetFrameSvg(template))}`;
}
