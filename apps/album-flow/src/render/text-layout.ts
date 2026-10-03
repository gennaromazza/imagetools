import type { SpreadTextOverlay } from "@photo-tools/shared-types";
import { PT_TO_MM, nearestFace } from "../model/typography";

/**
 * Impaginazione del testo: va a capo, giustifica e fa il capolettera. Lo stesso calcolo disegna il testo sullo schermo
 * e nell'esportazione, quindi quello che vedi è ciò che esce. Le misure sono in millimetri sullo spread.
 */

export interface FaceSpec {
  family: string;
  weight: number;
  italic: boolean;
}

/** Larghezza in mm di un testo al corpo indicato (senza spaziatura tra le lettere, che aggiunge il layout). */
export type TextMeasure = (text: string, face: FaceSpec, sizeMm: number) => number;

export interface LaidLine {
  text: string;
  /** Ascissa di partenza (o di centro / fine, secondo `anchor`), dal bordo sinistro della cornice. */
  x: number;
  baseline: number;
  anchor: "start" | "middle" | "end";
  /** Se presente la riga va allargata a questa larghezza (testo giustificato). */
  justifyTo?: number;
}

export interface LaidDropCap {
  char: string;
  x: number;
  baseline: number;
  sizeMm: number;
}

export interface TextLayout {
  lines: LaidLine[];
  dropCap: LaidDropCap | null;
  sizeMm: number;
  trackingMm: number;
  width: number;
  height: number;
}

/** Misura di ripiego (senza canvas): serve ai test e prima che i font siano caricati. */
export const approximateMeasure: TextMeasure = (text, _face, sizeMm) => [...text].length * sizeMm * 0.5;

const CAP_HEIGHT = 0.7;
const BASELINE = 0.78;

export function layoutText(overlay: SpreadTextOverlay, boxWidthMm: number, measure: TextMeasure, familyOf: (fontId: string) => string): TextLayout {
  const sizeMm = overlay.sizePt * PT_TO_MM;
  const lineMm = sizeMm * overlay.lineHeight;
  const trackingMm = overlay.trackingEm * sizeMm;
  const spaceAfterMm = overlay.paragraphSpacePt * PT_TO_MM;
  const face = nearestFace(overlay.font, overlay.weight, overlay.italic);
  const spec: FaceSpec = { family: familyOf(overlay.font), weight: face.weight, italic: face.italic };
  const wide = (text: string, size = sizeMm) => measure(text, spec, size) + trackingMm * (size / sizeMm) * [...text].length;
  const spaceWidth = wide(" ");
  const fold = (value: string) => (overlay.uppercase ? value.toLocaleUpperCase("it-IT") : value);

  const paragraphs = fold(overlay.text).split("\n");
  const lines: LaidLine[] = [];
  let dropCap: LaidDropCap | null = null;
  let top = 0;
  let dropLines = 0;
  let indent = 0;

  paragraphs.forEach((paragraph, paragraphIndex) => {
    let body = paragraph.trim();
    if (paragraphIndex === 0 && overlay.dropCapLines > 0 && body.length > 1) {
      const char = [...body][0];
      body = body.slice(char.length).trimStart();
      dropLines = overlay.dropCapLines;
      const capSize = ((dropLines - 1) * lineMm + CAP_HEIGHT * sizeMm) / CAP_HEIGHT;
      indent = wide(char, capSize) + sizeMm * 0.25;
      dropCap = { char, x: 0, baseline: top + (dropLines - 1) * lineMm + (lineMm - sizeMm) / 2 + sizeMm * BASELINE, sizeMm: capSize };
    }
    const words = body.length ? body.split(/\s+/) : [];
    const rows: string[] = [];
    let current = "";
    let currentWidth = 0;
    const available = (rowIndex: number) => Math.max(sizeMm, boxWidthMm - (paragraphIndex === 0 && rowIndex < dropLines ? indent : 0));
    const push = () => { rows.push(current); current = ""; currentWidth = 0; };
    for (const word of words) {
      const wordWidth = wide(word);
      const limit = available(rows.length);
      if (current && currentWidth + spaceWidth + wordWidth > limit) push();
      if (!current && wordWidth > available(rows.length)) {
        // Parola più larga della cornice: si spezza dove capita, meglio che uscire dalla pagina.
        let piece = "";
        for (const char of word) {
          if (piece && wide(piece + char) > available(rows.length)) { current = piece; push(); piece = ""; }
          piece += char;
        }
        current = piece;
        currentWidth = wide(piece);
        continue;
      }
      currentWidth = current ? currentWidth + spaceWidth + wordWidth : wordWidth;
      current = current ? `${current} ${word}` : word;
    }
    if (current || rows.length === 0) push();

    rows.forEach((row, rowIndex) => {
      const shifted = paragraphIndex === 0 && rowIndex < dropLines ? indent : 0;
      const room = Math.max(sizeMm, boxWidthMm - shifted);
      const last = rowIndex === rows.length - 1;
      const baseline = top + (lineMm - sizeMm) / 2 + sizeMm * BASELINE;
      if (overlay.align === "center") lines.push({ text: row, x: shifted + room / 2, baseline, anchor: "middle" });
      else if (overlay.align === "right") lines.push({ text: row, x: shifted + room, baseline, anchor: "end" });
      else lines.push({ text: row, x: shifted, baseline, anchor: "start", ...(overlay.align === "justify" && !last && row.includes(" ") ? { justifyTo: room } : {}) });
      top += lineMm;
    });
    if (paragraphIndex < paragraphs.length - 1) top += spaceAfterMm;
  });

  const height = Math.max(top, dropLines * lineMm);
  return { lines, dropCap, sizeMm, trackingMm, width: boxWidthMm, height };
}
