import type { DesktopFolderEntry } from "@photo-tools/desktop-contracts";
import { getDesktop, readSidecar } from "./api";
import { readCaptureTimeFromBlob } from "../model/exif";
import { dedupeRawJpgPairs, isImageFileName, type ImportCandidate } from "../model/import";

/** Foto trovate da una cartella o da file trascinati, già ripulite dalle coppie RAW+JPG. */
export interface ScanResult {
  candidates: ImportCandidate[];
  /** Nome della cartella scelta, se la sorgente è una cartella. */
  sourceName?: string;
  /** Versioni RAW ignorate perché esiste il JPG corrispondente. */
  ignoredRaw: number;
  folders: number;
}

/** Cartella di una foto: nome della cartella scelta e, se c'è, la sottocartella (per poter escludere interi gruppi). */
function folderLabel(rootName: string, relativePath: string): string {
  const unified = relativePath.replaceAll("\\", "/");
  const index = unified.lastIndexOf("/");
  return index > 0 ? `${rootName}/${unified.slice(0, index)}` : rootName;
}

function fromEntries(entries: readonly DesktopFolderEntry[], rootName: string): ImportCandidate[] {
  return entries
    .filter((entry) => isImageFileName(entry.name))
    .map((entry) => ({ fileName: entry.name, absolutePath: entry.absolutePath, size: entry.size, lastModified: entry.lastModified, folder: folderLabel(rootName, entry.relativePath) }));
}

function finish(candidates: ImportCandidate[], extra: Partial<ScanResult> = {}): ScanResult {
  const { kept, ignored } = dedupeRawJpgPairs(candidates);
  return { candidates: kept, ignoredRaw: ignored, folders: 0, ...extra };
}

/** Apre la finestra di scelta cartella del sistema e legge anche le sottocartelle. Annullando restituisce null. */
export async function chooseFolderAndScan(): Promise<ScanResult | null> {
  const api = getDesktop();
  if (!api?.openFolder) return null;
  const result = await api.openFolder({ recursive: true, relativePathMode: "project-relative", includeExtendedImages: true });
  if (!result) return null;
  return finish(fromEntries(result.entries, result.name), { sourceName: result.name, folders: 1 });
}

/** Percorsi trascinati sulla finestra: ogni cartella viene letta, ogni altro percorso è considerato un file. */
export async function scanDroppedPaths(paths: readonly string[]): Promise<ScanResult> {
  const api = getDesktop();
  const candidates: ImportCandidate[] = [];
  let folders = 0;
  let sourceName: string | undefined;
  for (const path of paths) {
    const folder = api?.reopenFolder ? await api.reopenFolder(path, { recursive: true, relativePathMode: "project-relative", includeExtendedImages: true }).catch(() => null) : null;
    if (folder) {
      folders += 1;
      sourceName ??= folder.name;
      candidates.push(...fromEntries(folder.entries, folder.name));
    } else if (isImageFileName(path)) {
      candidates.push({ fileName: path.split(/[\\/]/).pop() ?? path, absolutePath: path });
    }
  }
  return finish(candidates, { folders, sourceName });
}

/** File scelti con il selettore o trascinati: con l'app desktop si conserva il percorso, nel browser un'anteprima temporanea. */
export function candidatesFromFiles(files: readonly File[]): ImportCandidate[] {
  const api = getDesktop();
  return files.filter((file) => file.type.startsWith("image/") || isImageFileName(file.name)).map((file) => {
    let absolutePath: string | undefined;
    try { absolutePath = api?.getPathForFile?.(file) || undefined; } catch { absolutePath = undefined; }
    return {
      fileName: file.name,
      absolutePath,
      size: file.size,
      lastModified: file.lastModified,
      ...(absolutePath ? {} : { previewUrl: URL.createObjectURL(file) }),
    };
  });
}

function readImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = url;
  });
}

async function inBatches<T>(items: readonly T[], size: number, work: (item: T, index: number) => Promise<void>, onProgress?: (done: number) => void): Promise<void> {
  let next = 0;
  let done = 0;
  const lane = async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      await work(items[index], index);
      done += 1;
      onProgress?.(done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
}

export type EnrichPhase = "misure" | "ora di scatto" | "valutazioni";

/**
 * Completa le foto con misure reali, ora di scatto e stelle prima di importarle.
 * Desktop: dimensioni e ora dal processo nativo, stelle dal sidecar XMP; browser: dimensioni dall'immagine e ora dall'EXIF.
 */
export async function enrichCandidates(
  candidates: readonly ImportCandidate[],
  originals: ReadonlyMap<string, File> | null,
  onProgress?: (phase: EnrichPhase, done: number, total: number) => void,
): Promise<ImportCandidate[]> {
  const api = getDesktop();
  const result = candidates.map((candidate) => ({ ...candidate }));
  const total = result.length;

  if (api && result.every((candidate) => candidate.absolutePath)) {
    await inBatches(result, 6, async (candidate) => {
      const size = await api.getImageDimensions(candidate.absolutePath!).catch(() => null);
      if (size) { candidate.width = size.width; candidate.height = size.height; }
    }, (done) => onProgress?.("misure", done, total));

    const paths = result.map((candidate) => candidate.absolutePath!);
    for (let offset = 0; offset < paths.length; offset += 60) {
      const chunk = paths.slice(offset, offset + 60);
      const readings = await api.readCaptureTimes(chunk).catch(() => []);
      const byPath = new Map(readings.map((reading) => [reading.absolutePath, reading]));
      for (const candidate of result.slice(offset, offset + 60)) {
        const reading = byPath.get(candidate.absolutePath!);
        if (reading && typeof reading.captureTimeMs === "number") candidate.captureTimeMs = reading.captureTimeMs;
      }
      onProgress?.("ora di scatto", Math.min(offset + 60, total), total);
    }

    await inBatches(result, 8, async (candidate) => {
      const info = await readSidecar(candidate.absolutePath!);
      if (info?.rating !== null && info?.rating !== undefined) candidate.rating = info.rating;
    }, (done) => onProgress?.("valutazioni", done, total));
    return result;
  }

  // Browser: nessun percorso su disco.
  await inBatches(result, 6, async (candidate) => {
    if (candidate.previewUrl) {
      const size = await readImageSize(candidate.previewUrl);
      if (size.width) { candidate.width = size.width; candidate.height = size.height; }
    }
    const file = originals?.get(`${candidate.fileName}|${candidate.size ?? 0}`);
    if (file) {
      const exif = await readCaptureTimeFromBlob(file);
      if (exif.captureTimeMs !== null) candidate.captureTimeMs = exif.captureTimeMs;
    }
  }, (done) => onProgress?.("misure", done, total));
  return result;
}

/** Chiave per ritrovare il file originale di un candidato del browser. */
export const fileKey = (file: { name: string; size: number }) => `${file.name}|${file.size}`;
