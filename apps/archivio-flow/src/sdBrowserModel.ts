import type { FilterPreviewData } from "./types.js";
import { localIsoDate } from "./previewPolicy.js";

export type SdFile = FilterPreviewData["sampleFiles"][number];
export function orderSdFiles(files: SdFile[]): SdFile[] {
  return [...files].sort((a, b) => b.mtimeMs - a.mtimeMs || b.filePath.localeCompare(a.filePath));
}
export function groupSdFiles(files: SdFile[], gapHours: number, splitBefore: ReadonlySet<string>, joinedBefore: ReadonlySet<string>) {
  const groups: Array<{ files: SdFile[]; startMs: number; endMs: number }> = [];
  for (const file of [...files].sort((a,b) => a.mtimeMs - b.mtimeMs || a.filePath.localeCompare(b.filePath))) {
    const last = groups.at(-1);
    if (!last || splitBefore.has(file.filePath) || (file.mtimeMs - last.endMs >= gapHours * 3_600_000 && !joinedBefore.has(file.filePath))) {
      groups.push({ files: [file], startMs: file.mtimeMs, endMs: file.mtimeMs });
    } else { last.files.push(file); last.endMs = file.mtimeMs; }
  }
  return groups;
}
export type SdGridRow = { date: string; files: SdFile[]; header: boolean };
export const SD_HEADER_ROW_HEIGHT = 42;
export const SD_PHOTO_ROW_HEIGHT = 176;
const SD_OVERSCAN = 352;
/** Raggruppa per data file gia' ordinati (vedi orderSdFiles): niente secondo ordinamento. */
export function buildSdRowsFromOrdered(ordered: SdFile[], columns: number): SdGridRow[] {
  const dates = new Map<string, SdFile[]>();
  for (const file of ordered) {
    const date = localIsoDate(file.mtimeMs);
    let items = dates.get(date);
    if (!items) { items = []; dates.set(date, items); }
    items.push(file);
  }
  const rows: SdGridRow[] = [];
  for (const [date, items] of [...dates].sort(([a],[b]) => b.localeCompare(a))) {
    rows.push({ date, files: [], header: true });
    for (let index = 0; index < items.length; index += columns) rows.push({ date, files: items.slice(index, index + columns), header: false });
  }
  return rows;
}
export function buildSdRows(files: SdFile[], columns: number): SdGridRow[] {
  return buildSdRowsFromOrdered(orderSdFiles(files), columns);
}
/** offsets[i] = posizione verticale della riga i; l'ultimo valore e' l'altezza totale. */
export function buildSdRowOffsets(rows: SdGridRow[]): Float64Array {
  const offsets = new Float64Array(rows.length + 1);
  for (let index = 0; index < rows.length; index++) offsets[index + 1] = offsets[index]! + (rows[index]!.header ? SD_HEADER_ROW_HEIGHT : SD_PHOTO_ROW_HEIGHT);
  return offsets;
}
/** Primo indice con offsets[i] >= target (offsets e' crescente); length se nessuno. */
function lowerBound(offsets: ArrayLike<number>, target: number): number {
  let low = 0; let high = offsets.length;
  while (low < high) { const mid = (low + high) >>> 1; if (offsets[mid]! >= target) high = mid; else low = mid + 1; }
  return low;
}
export type SdWindow = { start: number; end: number; before: number; after: number };
/** Finestra visibile con ricerca binaria: costo O(log n) per evento di scroll. */
export function virtualSdWindowFromOffsets(offsets: ArrayLike<number>, scrollTop: number, height: number): SdWindow {
  const rowCount = offsets.length - 1;
  if (rowCount <= 0) return { start: 0, end: 0, before: 0, after: 0 };
  const start = Math.max(0, lowerBound(offsets, scrollTop - SD_OVERSCAN) - 1);
  const end = Math.max(start, Math.min(rowCount, lowerBound(offsets, scrollTop + height + SD_OVERSCAN)));
  return { start, end, before: offsets[start]!, after: offsets[rowCount]! - offsets[end]! };
}
export function virtualSdWindow(rows: SdGridRow[], scrollTop: number, height: number): SdWindow {
  return virtualSdWindowFromOffsets(buildSdRowOffsets(rows), scrollTop, height);
}
export function sameSdWindow(a: SdWindow, b: SdWindow): boolean {
  return a.start === b.start && a.end === b.end && a.before === b.before && a.after === b.after;
}
/** Confronto O(n) tra due elenchi di file: evita di rifare ordinamenti quando la lettura SD restituisce la stessa pagina. */
export function sameSdFileList(a: readonly SdFile[], b: readonly SdFile[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    const left = a[index]!; const right = b[index]!;
    if (left.filePath !== right.filePath || left.mtimeMs !== right.mtimeMs || left.size !== right.size) return false;
  }
  return true;
}
/**
 * La griglia mostra solo foto e video. I file di accompagnamento (.xmp, .thm...) e gli altri file della
 * scheda restano fuori; i sidecar vengono copiati dal server insieme alla loro foto.
 */
export function mediaOnly(files: readonly SdFile[]): SdFile[] {
  return files.filter(file => file.mediaType !== "other");
}
/** Foto + video sulla scheda, esclusi i file non multimediali (dai conteggi dell'inventario). */
export function mediaCount(inventory: { matchedFiles: number; matchedOtherFiles?: number }): number {
  return Math.max(0, inventory.matchedFiles - (inventory.matchedOtherFiles ?? 0));
}

export interface QuickSelection {
  id: "all" | "new" | "today" | "latestDay" | "last";
  label: string;
  /** Giorno (AAAA-MM-GG) da mostrare nella griglia quando si applica la scelta. */
  day?: string;
  paths: string[];
}

function dayLabel(day: string): string {
  return new Date(`${day}T12:00`).toLocaleDateString("it-IT", { day: "numeric", month: "long" });
}

/**
 * Scelte rapide per il caso piu' comune: "prendo tutto", "solo oggi", "solo l'ultimo giorno", "gli ultimi scatti".
 * Non propone mai due scelte che portano allo stesso insieme di foto.
 */
export function quickSelections(files: readonly SdFile[], now: Date = new Date(), lastCount = 100, archivedPaths?: ReadonlySet<string>): QuickSelection[] {
  if (files.length === 0) return [];
  const ordered = orderSdFiles([...files]);
  const result: QuickSelection[] = [{ id: "all", label: `Tutte (${ordered.length.toLocaleString("it-IT")})`, paths: ordered.map(file => file.filePath) }];
  if (archivedPaths && archivedPaths.size > 0) {
    const fresh = ordered.filter(file => !archivedPaths.has(file.filePath));
    if (fresh.length > 0 && fresh.length < ordered.length) result.push({ id: "new", label: `Solo le nuove (${fresh.length.toLocaleString("it-IT")})`, paths: fresh.map(file => file.filePath) });
  }
  const today = localIsoDate(now.getTime());
  const days = new Map<string, SdFile[]>();
  for (const file of ordered) {
    const day = localIsoDate(file.mtimeMs);
    let list = days.get(day);
    if (!list) { list = []; days.set(day, list); }
    list.push(file);
  }
  const todayFiles = days.get(today);
  if (todayFiles && days.size > 1) result.push({ id: "today", label: `Solo oggi (${todayFiles.length.toLocaleString("it-IT")})`, day: today, paths: todayFiles.map(file => file.filePath) });
  const latestDay = [...days.keys()].sort().at(-1)!;
  if (days.size > 1 && latestDay !== today) {
    const latestFiles = days.get(latestDay)!;
    result.push({ id: "latestDay", label: `Solo ${dayLabel(latestDay)} (${latestFiles.length.toLocaleString("it-IT")})`, day: latestDay, paths: latestFiles.map(file => file.filePath) });
  }
  if (ordered.length > lastCount) {
    const alreadyCovered = [...days.values()].some(list => list.length === lastCount);
    if (!alreadyCovered) result.push({ id: "last", label: `Ultimi ${lastCount.toLocaleString("it-IT")} scatti`, paths: ordered.slice(0, lastCount).map(file => file.filePath) });
  }
  return result;
}
