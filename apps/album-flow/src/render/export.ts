import type { AlbumAssetV2, AlbumProjectV2, AlbumSpread } from "@photo-tools/shared-types";
import { getDesktop } from "../desktop/api";
import { assetToDataUrl } from "../hooks/useAssetSrc";
import { mediaIdsOfSpread, mediaIdsOfProject, fontIdsOfSpread } from "../model/design";
import { collectEmbeddedMedia, getMedia } from "../model/mediaStore";
import { serializeAlbumProject } from "../model/portability";
import { canvasMeasure, embeddedFontCss, loadFonts } from "./fonts";
import { exportSpreadsWith, safeFileName, type ExportOptions, type ExportWriter } from "./export-core";

export { safeFileName, spreadFileName } from "./export-core";

export { spreadPixelSize } from "./export-core";

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

export type { ExportWriter, ExportOptions } from "./export-core";

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

/** Percorso completo di un file dentro la cartella scelta (il separatore è quello della cartella). */
function inFolder(directory: string, fileName: string): string {
  return `${directory}${directory.includes("\\") ? "\\" : "/"}${fileName}`;
}

/** Writer desktop: con `setReplace(true)` (dopo conferma) i file con lo stesso nome vengono sostituiti; altrimenti gli omonimi sono rinominati. */
export type DesktopWriter = ExportWriter & { directory: string; setReplace(replace: boolean): void };

/** Con l'app desktop si sceglie una cartella una volta sola. */
export async function chooseDesktopWriter(): Promise<DesktopWriter | null> {
  const api = getDesktop();
  if (!api?.chooseOutputFolder || !api.writeFilesAtomically) return null;
  const directory = await api.chooseOutputFolder();
  if (!directory) return null;
  let replace = false;
  return {
    directory,
    setReplace(value) { replace = value && Boolean(api.writeFilesReplacing); },
    async write(fileName, bytes) {
      if (replace && api.writeFilesReplacing) return (await api.writeFilesReplacing(directory, [{ fileName, bytes }]))[0] ?? null;
      const written = await api.writeFilesAtomically(directory, [{ fileName, bytes }]);
      // La scrittura atomica restituisce il solo nome del file: serve il percorso completo per aprire la cartella.
      return written[0] ? inFolder(directory, written[0]) : null;
    },
    where: () => directory,
  };
}

/** Quali di `names` esistono già nella cartella (maiuscole ignorate, come su Windows e macOS). */
export async function existingNamesIn(directory: string, names: readonly string[]): Promise<string[]> {
  const list = getDesktop()?.listOutputFolderFileNames;
  if (!list) return [];
  try {
    const present = new Set((await list(directory)).map((name) => name.toLocaleLowerCase()));
    return names.filter((name) => present.has(name.toLocaleLowerCase()));
  } catch { return []; }
}

/** Sfondi a immagine, testi e grafiche di uno spread, pronti per un SVG autonomo: immagini della libreria, font incorporati, testo misurato con i font veri. */
export async function designForExport(spread: AlbumSpread) {
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
  return exportSpreadsWith(project, writer, options, {
    prepare: async (spread) => ({ assets: await embedSpreadAssets(project, spread, embedDimensionFor(options.dpi)), design: await designForExport(spread) }),
    toJpeg: svgToJpegBytes,
  });
}

export async function exportProjectFile(project: AlbumProjectV2, writer: ExportWriter): Promise<string | null> {
  const media = await collectEmbeddedMedia(mediaIdsOfProject(project));
  return writer.write(`${safeFileName(project.projectName)}.filex-album.json`, new TextEncoder().encode(serializeAlbumProject(project, media)), "application/json");
}
