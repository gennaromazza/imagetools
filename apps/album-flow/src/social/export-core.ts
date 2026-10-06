import { safeFileName, type ExportWriter } from "../render/export-core";
import { formatOf, type Carousel } from "./types";

export interface SocialExportOptions {
  /** 1 = 1080 px di larghezza (quella di Instagram); 2 = il doppio, per archivio e stampa. */
  scale: 1 | 2;
  quality: number;
  /** Salva anche il testo del post accanto alle immagini. */
  withCaption: boolean;
  onProgress?: (done: number, total: number) => void;
  signal?: { cancelled: boolean };
}

export interface SocialExportDeps {
  renderSvg: (index: number) => Promise<string>;
  toJpeg: (svg: string, width: number, height: number, quality: number) => Promise<Uint8Array>;
}

/** «album-carosello-03.jpg»: il numero è la posizione, così le slide si ordinano da sole nel telefono. */
export function slideFileName(projectName: string, carousel: Carousel, index: number, extension = "jpg"): string {
  return `${safeFileName(projectName)}-${safeFileName(carousel.name)}-${String(index + 1).padStart(2, "0")}.${extension}`;
}

export function captionFileName(projectName: string, carousel: Carousel): string {
  return `${safeFileName(projectName)}-${safeFileName(carousel.name)}-testo-del-post.txt`;
}

/** Il ciclo di esportazione, senza dipendenze dal browser: una immagine per slide, nell'ordine del carosello. */
export async function exportCarouselWith(projectName: string, carousel: Carousel, writer: ExportWriter, options: SocialExportOptions, deps: SocialExportDeps): Promise<{ written: string[]; count: number }> {
  const format = formatOf(carousel.format);
  const written: string[] = [];
  let done = 0;
  for (let index = 0; index < carousel.slides.length; index += 1) {
    if (options.signal?.cancelled) break;
    const svg = await deps.renderSvg(index);
    const bytes = await deps.toJpeg(svg, format.width * options.scale, format.height * options.scale, options.quality);
    const path = await writer.write(slideFileName(projectName, carousel, index), bytes, "image/jpeg");
    if (path) written.push(path);
    done += 1;
    options.onProgress?.(done, carousel.slides.length);
  }
  if (options.withCaption && carousel.caption.trim() && !options.signal?.cancelled) {
    const path = await writer.write(captionFileName(projectName, carousel), new TextEncoder().encode(carousel.caption), "text/plain");
    if (path) written.push(path);
  }
  return { written, count: done };
}
