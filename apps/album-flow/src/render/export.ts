import type { AlbumAssetV2, AlbumProjectV2, AlbumSpread } from "@photo-tools/shared-types";
import { getDesktop } from "../desktop/api";
import { assetToDataUrl } from "../hooks/useAssetSrc";
import { mediaIdsOfSpread, mediaIdsOfProject, fontIdsOfSpread } from "../model/design";
import { collectEmbeddedMedia, getMedia } from "../model/mediaStore";
import { serializeAlbumProject } from "../model/portability";
import { canvasMeasure, embeddedFontCss, loadFonts } from "./fonts";
import { renderSpreadSvg, spreadSizeWithBleedMm } from "./spread-svg";

export function safeFileName(name: string): string {
  return name.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "") || "album";
}

export function spreadFileName(project: AlbumProjectV2, index: number, extension: string): string {
  return `${safeFileName(project.projectName)}-spread-${String(index + 1).padStart(2, "0")}.${extension}`;
}

/** Dimensioni in pixel di uno spread (abbondanza compresa) a una data risoluzione, limitate al lato massimo. */
export function spreadPixelSize(project: AlbumProjectV2, dpi: number, maxSide = 12000): { width: number; height: number } {
  const { width, height } = spreadSizeWithBleedMm(project);
  const wanted = Math.max((width / 25.4) * dpi, (height / 25.4) * dpi);
  const scale = Math.min(1, maxSide / wanted);
  return { width: Math.round((width / 25.4) * dpi * scale), height: Math.round((height / 25.4) * dpi * scale) };
}

/** Lato lungo delle foto da incorporare in base alla risoluzione richiesta. */
export function embedDimensionFor(dpi: number): number {
  return Math.min(5000, Math.max(1600, Math.round((dpi / 300) * 4200)));
}

/** Foto di uno spread con l'immagine incorporata (data URL), pronta per un SVG autonomo. */
export async function embedSpreadAssets(project: AlbumProjectV2, spread: AlbumSpread, maxDimension: number): Promise<Map<string, AlbumAssetV2>> {
  const ids = new Set(spread.areas.flatMap((area) => area.items.map((item) => item.assetId)));
  const result = new Map<string, AlbumAssetV2>();
  for (const asset of project.assets) {
    if (!ids.has(asset.id)) continue;
    const url = await assetToDataUrl(asset, maxDimension);
    result.set(asset.id, url ? { ...asset, previewUrl: url } : { ...asset, previewUrl: undefined });
  }
  return result;
}

export async function svgToJpegBytes(svg: string, width: number, height: number, quality = 0.92): Promise<Uint8Array> {
  const image = new Image();
  image.decoding = "async";
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Impossibile disegnare lo spread."));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas non disponibile.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("Codifica JPEG non riuscita."))), "image/jpeg", quality));
  canvas.width = canvas.height = 0;
  return new Uint8Array(await blob.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Dove si scrivono i file
// ---------------------------------------------------------------------------

export interface ExportWriter {
  /** Scrive un file e restituisce il percorso finale, se noto. */
  write(fileName: string, bytes: Uint8Array, mime: string): Promise<string | null>;
  /** Descrizione di dove sono finiti i file, per il messaggio finale. */
  where(): string;
}

/** Nel browser ogni file è un download. */
export function browserWriter(): ExportWriter {
  return {
    async write(fileName, bytes, mime) {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 4000);
      return null;
    },
    where: () => "nella cartella dei download",
  };
}

/** Con l'app desktop si sceglie una cartella una volta sola; la scrittura è atomica e non sovrascrive. */
export async function chooseDesktopWriter(): Promise<(ExportWriter & { directory: string }) | null> {
  const api = getDesktop();
  if (!api?.chooseOutputFolder || !api.writeFilesAtomically) return null;
  const directory = await api.chooseOutputFolder();
  if (!directory) return null;
  return {
    directory,
    async write(fileName, bytes) {
      const written = await api.writeFilesAtomically(directory, [{ fileName, bytes }]);
      return written[0] ?? null;
    },
    where: () => directory,
  };
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

/** Sfondi a immagine, testi e grafiche di uno spread, pronti per un SVG autonomo: immagini della libreria, font incorporati, testo misurato con i font veri. */
async function designForExport(spread: AlbumSpread) {
  const fonts = fontIdsOfSpread(spread);
  await loadFonts(fonts);
  const media = new Map<string, string>();
  for (const id of mediaIdsOfSpread(spread)) {
    const record = await getMedia(id);
    if (record) media.set(id, record.dataUrl);
  }
  return { media, measure: canvasMeasure, fontCss: fonts.length ? await embeddedFontCss(fonts) : "" };
}

/** Esporta gli spread uno alla volta (incorporando le sole foto necessarie) per tenere bassa la memoria. */
export async function exportSpreads(project: AlbumProjectV2, writer: ExportWriter, options: ExportOptions): Promise<{ written: string[]; count: number }> {
  const written: string[] = [];
  const size = spreadPixelSize(project, options.dpi);
  let done = 0;
  for (const index of options.spreads) {
    if (options.signal?.cancelled) break;
    const spread = project.spreads[index];
    if (!spread) continue;
    const assets = await embedSpreadAssets(project, spread, embedDimensionFor(options.dpi));
    const design = await designForExport(spread);
    const svg = renderSpreadSvg(project, spread, assets, { forPrint: true, design }, index);
    if (options.kind === "svg") {
      const path = await writer.write(spreadFileName(project, index, "svg"), new TextEncoder().encode(svg), "image/svg+xml");
      if (path) written.push(path);
    } else {
      const bytes = await svgToJpegBytes(svg, size.width, size.height, options.quality);
      const path = await writer.write(spreadFileName(project, index, "jpg"), bytes, "image/jpeg");
      if (path) written.push(path);
    }
    done += 1;
    options.onProgress?.(done, options.spreads.length);
  }
  return { written, count: done };
}

export async function exportProjectFile(project: AlbumProjectV2, writer: ExportWriter): Promise<string | null> {
  const media = await collectEmbeddedMedia(mediaIdsOfProject(project));
  return writer.write(`${safeFileName(project.projectName)}.filex-album.json`, new TextEncoder().encode(serializeAlbumProject(project, media)), "application/json");
}
