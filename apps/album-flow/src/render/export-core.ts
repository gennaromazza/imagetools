import type { AlbumAssetV2, AlbumProjectV2, AlbumSpread } from "@photo-tools/shared-types";
import { renderSpreadSvg, spreadSizeWithBleedMm, type RenderOptions } from "./spread-svg";

export function safeFileName(name: string): string {
  return name.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "") || "album";
}

/** Il numero nel nome del file è la posizione dello spread nell'ordine attuale dell'album. */
export function spreadFileName(project: AlbumProjectV2, index: number, extension: string): string {
  return `${safeFileName(project.projectName)}-spread-${String(index + 1).padStart(2, "0")}.${extension}`;
}

export interface ExportWriter {
  /** Scrive un file e restituisce il percorso finale, se noto. */
  write(fileName: string, bytes: Uint8Array, mime: string): Promise<string | null>;
  /** Descrizione di dove sono finiti i file, per il messaggio finale. */
  where(): string;
}

export interface ExportOptions {
  kind: "jpg" | "svg";
  dpi: number;
  quality: number;
  /** Indici degli spread da esportare. */
  spreads: number[];
  onProgress?: (done: number, total: number) => void;
  signal?: { cancelled: boolean };
}

/** Dimensioni in pixel di uno spread (abbondanza compresa) a una data risoluzione, limitate al lato massimo. */
export function spreadPixelSize(project: AlbumProjectV2, dpi: number, maxSide = 12000): { width: number; height: number } {
  const { width, height } = spreadSizeWithBleedMm(project);
  const wanted = Math.max((width / 25.4) * dpi, (height / 25.4) * dpi);
  const scale = Math.min(1, maxSide / wanted);
  return { width: Math.round((width / 25.4) * dpi * scale), height: Math.round((height / 25.4) * dpi * scale) };
}

/** Lato lungo delle foto da incorporare in base alla risoluzione richiesta. */
export interface ExportDeps {
  /** Foto incorporate e grafica dello spread da esportare. */
  prepare: (spread: AlbumSpread) => Promise<{ assets: Map<string, AlbumAssetV2>; design?: RenderOptions["design"] }>;
  toJpeg: (svg: string, width: number, height: number, quality: number) => Promise<Uint8Array>;
}

/** Il ciclo di esportazione, senza dipendenze dal browser: gli spread escono nell'ordine dell'album, con la loro posizione nel nome. */
export async function exportSpreadsWith(project: AlbumProjectV2, writer: ExportWriter, options: ExportOptions, deps: ExportDeps): Promise<{ written: string[]; count: number }> {
  const written: string[] = [];
  const size = spreadPixelSize(project, options.dpi);
  let done = 0;
  for (const index of options.spreads) {
    if (options.signal?.cancelled) break;
    const spread = project.spreads[index];
    if (!spread) continue;
    const { assets, design } = await deps.prepare(spread);
    const svg = renderSpreadSvg(project, spread, assets, { forPrint: true, design }, index);
    if (options.kind === "svg") {
      const path = await writer.write(spreadFileName(project, index, "svg"), new TextEncoder().encode(svg), "image/svg+xml");
      if (path) written.push(path);
    } else {
      const bytes = await deps.toJpeg(svg, size.width, size.height, options.quality);
      const path = await writer.write(spreadFileName(project, index, "jpg"), bytes, "image/jpeg");
      if (path) written.push(path);
    }
    done += 1;
    options.onProgress?.(done, options.spreads.length);
  }
  return { written, count: done };
}
