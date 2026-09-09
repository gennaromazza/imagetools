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
export function buildSdRows(files: SdFile[], columns: number): SdGridRow[] {
  const dates = new Map<string, SdFile[]>();
  for (const file of orderSdFiles(files)) {
    const date = localIsoDate(file.mtimeMs);
    if (!dates.has(date)) dates.set(date, []);
    dates.get(date)!.push(file);
  }
  const rows: SdGridRow[] = [];
  for (const [date, items] of [...dates].sort(([a],[b]) => b.localeCompare(a))) {
    rows.push({ date, files: [], header: true });
    for (let index = 0; index < items.length; index += columns) rows.push({ date, files: items.slice(index, index + columns), header: false });
  }
  return rows;
}
export function virtualSdWindow(rows: SdGridRow[], scrollTop: number, height: number) {
  const offsets = [0];
  for (const row of rows) offsets.push(offsets[offsets.length - 1]! + (row.header ? 42 : 176));
  let start = 0;
  while (start < rows.length && offsets[start + 1]! < scrollTop - 352) start++;
  let end = start;
  while (end < rows.length && offsets[end]! < scrollTop + height + 352) end++;
  return { start, end, before: offsets[start]!, after: offsets[rows.length]! - offsets[end]! };
}
