import type { FilterPreviewData } from "./types.js";

export type PreviewMediaFile = FilterPreviewData["sampleFiles"][number];

export function localIsoDate(timestamp: number): string {
  const value = new Date(timestamp);
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

export function filterMediaForDate(files: PreviewMediaFile[], selectedDate: string): PreviewMediaFile[] {
  return files.filter((file) => localIsoDate(file.mtimeMs) === selectedDate);
}

export function isPreviewableMedia(file: PreviewMediaFile): boolean {
  return file.mediaType === "photo" || file.mediaType === "video";
}

export function buildPreviewSourceKey(file: PreviewMediaFile): string {
  return `${file.size}:${Math.trunc(file.mtimeMs)}`;
}
