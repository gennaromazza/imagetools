import {
  getCustomTemplateLogoFiles,
  type CustomTemplate,
  type TemplateTextOverlay,
} from "../contexts/ProjectContext";
import { ensurePhotoboothFontsReady, getPhotoboothFont } from "./photoboothFonts";

export interface PreparedTemplateOverlays {
  /** Per orientation, files ordered exactly like the overlay geometries (logos, then texts). */
  files: Partial<Record<"vertical" | "horizontal", File[]>>;
  /** Template copy with logos lacking an image file removed (keeps file/geometry alignment). */
  template: CustomTemplate;
  droppedLogoNames: string[];
}

/**
 * Build the ordered overlay image files for an export/preview request:
 * logo files from the session store first, then freshly rendered text PNGs.
 * Must be awaited before creating the multipart payload.
 */
export async function prepareTemplateOverlays(
  customTemplate: CustomTemplate
): Promise<PreparedTemplateOverlays> {
  const logoFiles = getCustomTemplateLogoFiles();
  const files: PreparedTemplateOverlays["files"] = {};
  const droppedLogoNames: string[] = [];
  const template: CustomTemplate = {
    ...customTemplate,
    variants: {
      vertical: { ...customTemplate.variants.vertical },
      horizontal: { ...customTemplate.variants.horizontal },
    },
  };

  for (const orientation of ["vertical", "horizontal"] as const) {
    const variant = template.variants[orientation];
    const orientationFiles: File[] = [];
    const keptLogos: typeof variant.logos = [];
    for (const logo of variant.logos) {
      const file = logoFiles[orientation].get(logo.id);
      if (!file) {
        droppedLogoNames.push(logo.fileName || "Logo");
        continue;
      }
      keptLogos.push(logo);
      orientationFiles.push(file);
    }
    variant.logos = keptLogos;
    for (const text of variant.texts) {
      orientationFiles.push(await renderTextOverlayPng(text, variant.heightPx - text.y));
    }
    if (orientationFiles.length > 0) {
      files[orientation] = orientationFiles;
    }
  }

  if (droppedLogoNames.length > 0) {
    throw new Error(`File del logo non disponibile: ${droppedLogoNames.join(", ")}. Riapri il template dalla libreria o ricarica il logo prima di esportare.`);
  }
  return { files, template, droppedLogoNames };
}

export const MAX_TEXT_OVERLAY_CHARS = 200;
export const MIN_TEXT_FONT_PX = 12;
export const MAX_TEXT_FONT_PX = 600;

/**
 * Render a text overlay to a transparent PNG at template resolution.
 * The canvas width matches overlay.width so the server can composite the
 * file 1:1 at (x, y) without rescaling (crisp output, WYSIWYG preview).
 */
export async function renderTextOverlayPng(overlay: TemplateTextOverlay, maxHeight = 16000): Promise<File> {
  await ensurePhotoboothFontsReady();
  const font = getPhotoboothFont(overlay.fontKey);
  const width = Math.max(8, Math.round(overlay.width));
  const fontSize = Math.min(MAX_TEXT_FONT_PX, Math.max(MIN_TEXT_FONT_PX, Math.round(overlay.fontSizePx)));
  const weight = overlay.bold ? "700" : "400";
  const style = overlay.italic ? "italic" : "normal";
  const fontSpec = `${style} ${weight} ${fontSize}px ${font.family}`;

  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) {
    throw new Error("Canvas 2D non disponibile per il rendering del testo.");
  }
  measure.font = fontSpec;
  const lineHeight = Math.round(fontSize * 1.18);
  const lines = wrapTextLines(measure, overlay.text.slice(0, MAX_TEXT_OVERLAY_CHARS), width);
  const padding = overlay.shadow ? Math.max(4, Math.round(fontSize * 0.12)) : 2;
  const height = lines.length * lineHeight + padding * 2;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.max(1, Math.min(Math.max(1, Math.round(maxHeight)), height));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D non disponibile per il rendering del testo.");
  }
  context.font = fontSpec;
  context.textBaseline = "top";
  context.fillStyle = overlay.color;
  // Opacity is applied once, by CSS in the editor and by Sharp in the export.
  context.globalAlpha = 1;
  if (overlay.shadow) {
    context.shadowColor = "rgba(0,0,0,0.55)";
    context.shadowBlur = Math.max(2, Math.round(fontSize * 0.08));
    context.shadowOffsetX = Math.max(1, Math.round(fontSize * 0.04));
    context.shadowOffsetY = Math.max(1, Math.round(fontSize * 0.04));
  }

  lines.forEach((line, index) => {
    const y = padding + index * lineHeight;
    if (overlay.align === "center") {
      context.textAlign = "center";
      context.fillText(line, width / 2, y, width - 2);
    } else if (overlay.align === "right") {
      context.textAlign = "right";
      context.fillText(line, width - 1, y, width - 2);
    } else {
      context.textAlign = "left";
      context.fillText(line, 1, y, width - 2);
    }
  });

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    throw new Error("Impossibile generare l'immagine del testo.");
  }
  const safeStem = `testo-${overlay.id}`.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 60) || "testo";
  return new File([blob], `${safeStem}.png`, { type: "image/png" });
}

function wrapTextLines(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    const boundedWords = words.flatMap((word) => {
      const chunks: string[] = [];
      let chunk = "";
      for (const char of Array.from(word)) {
        if (chunk && context.measureText(chunk + char).width > maxWidth - 2) { chunks.push(chunk); chunk = ""; }
        chunk += char;
      }
      if (chunk) chunks.push(chunk);
      return chunks;
    });
    for (const word of boundedWords) {
      const candidate = current ? `${current} ${word}` : word;
      if (context.measureText(candidate).width <= maxWidth - 2 || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}
