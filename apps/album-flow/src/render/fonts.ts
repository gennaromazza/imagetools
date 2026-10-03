import { fontInfo } from "../model/typography";
import { approximateMeasure, type FaceSpec, type TextMeasure } from "./text-layout";

/**
 * Font dell'editor (tutti open source, vedi FONTS.md). Sullo schermo si usano come file normali dell'app; per esportare
 * uno SVG autonomo si incorporano come data URL, così il testo si vede uguale anche fuori da Album Flow.
 */

interface FaceFile {
  fontId: string;
  weight: number;
  italic: boolean;
  path: string;
}

const urls = import.meta.glob("../assets/fonts/*.woff2", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const inlined = import.meta.glob("../assets/fonts/*.woff2", { query: "?inline", import: "default" }) as Record<string, () => Promise<string>>;

const faces: FaceFile[] = Object.keys(urls).flatMap((path) => {
  const match = /\/([a-z0-9-]+)-(\d{3})-(normal|italic)\.woff2$/.exec(path);
  return match ? [{ fontId: match[1], weight: Number(match[2]), italic: match[3] === "italic", path }] : [];
});

const faceRule = (face: FaceFile, source: string) =>
  `@font-face{font-family:'${fontInfo(face.fontId).family}';font-style:${face.italic ? "italic" : "normal"};font-weight:${face.weight};font-display:block;src:url("${source}") format("woff2");}`;

let installed = false;

/** Rende disponibili nel documento tutti i font dell'editor (una sola volta). */
export function installFonts(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const style = document.createElement("style");
  style.id = "album-flow-fonts";
  style.textContent = faces.map((face) => faceRule(face, urls[face.path])).join("");
  document.head.appendChild(style);
}

const loading = new Map<string, Promise<void>>();

/** Scarica i font indicati (i pesi e i corsivi che esistono) e risolve quando sono pronti per misurare e disegnare. */
export function loadFonts(fontIds: readonly string[]): Promise<void> {
  installFonts();
  if (typeof document === "undefined" || !document.fonts) return Promise.resolve();
  const wanted = faces.filter((face) => fontIds.includes(face.fontId));
  const jobs = wanted.map((face) => {
    const key = `${face.fontId}-${face.weight}-${face.italic}`;
    let job = loading.get(key);
    if (!job) {
      job = document.fonts.load(`${face.italic ? "italic " : ""}${face.weight} 24px "${fontInfo(face.fontId).family}"`, "AaÀè").then(() => undefined, () => undefined);
      loading.set(key, job);
    }
    return job;
  });
  return Promise.all(jobs).then(() => undefined);
}

/** Regole @font-face con i font come data URL, solo per le famiglie usate: per gli SVG autonomi dell'esportazione. */
export async function embeddedFontCss(fontIds: readonly string[]): Promise<string> {
  const rules: string[] = [];
  for (const face of faces.filter((candidate) => fontIds.includes(candidate.fontId))) {
    const load = inlined[face.path];
    if (!load) continue;
    rules.push(faceRule(face, await load()));
  }
  return rules.join("");
}

let context: CanvasRenderingContext2D | null | undefined;

/** Misura il testo con il canvas del browser, con lo stesso font che poi si disegna. */
export const canvasMeasure: TextMeasure = (text: string, face: FaceSpec, sizeMm: number) => {
  if (context === undefined) {
    try { context = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null; } catch { context = null; }
  }
  if (!context) return approximateMeasure(text, face, sizeMm);
  context.font = `${face.italic ? "italic " : ""}${face.weight} 100px "${face.family}"`;
  return (context.measureText(text).width / 100) * sizeMm;
};
