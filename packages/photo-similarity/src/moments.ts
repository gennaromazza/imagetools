import type { Moment, SimilarityPhoto } from "./types";

export interface MomentOptions {
  /** Una pausa più corta di così non separa mai due momenti. */
  minGapMs: number;
  /** Una pausa separa due momenti se è più lunga di questo multiplo della pausa tipica dei dintorni. */
  gapFactor: number;
  /** Una pausa più lunga di così separa sempre. */
  maxGapMs: number;
  /** Quante pause prima e dopo formano «i dintorni» per la pausa tipica. */
  window: number;
}

export const DEFAULT_MOMENT_OPTIONS: MomentOptions = { minGapMs: 90_000, gapFactor: 4, maxGapMs: 20 * 60_000, window: 8 };

const hasTime = (photo: SimilarityPhoto): photo is SimilarityPhoto & { captureTimeMs: number } =>
  typeof photo.captureTimeMs === "number" && Number.isFinite(photo.captureTimeMs);

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Foto con ora di scatto, in ordine di scatto (a parità, nell'ordine ricevuto). */
export function byCaptureTime<T extends SimilarityPhoto>(photos: readonly T[]): Array<T & { captureTimeMs: number }> {
  return photos.map((photo, index) => ({ photo, index })).filter((entry) => hasTime(entry.photo))
    .sort((a, b) => a.photo.captureTimeMs! - b.photo.captureTimeMs! || a.index - b.index)
    .map((entry) => entry.photo as T & { captureTimeMs: number });
}

/**
 * Divide le foto in momenti dove c'è una pausa lunga tra due scatti. La soglia si adatta al ritmo di quel tratto:
 * durante la festa si scatta di continuo, durante i ritratti con calma, quindi «lunga» è relativo ai dintorni.
 * Le foto senza ora di scatto non appartengono a nessun momento.
 */
export function findMoments(photos: readonly SimilarityPhoto[], options: Partial<MomentOptions> = {}): Moment[] {
  const settings = { ...DEFAULT_MOMENT_OPTIONS, ...options };
  const timed = byCaptureTime(photos);
  if (timed.length === 0) return [];
  const gaps = timed.slice(1).map((photo, index) => photo.captureTimeMs - timed[index].captureTimeMs);
  const moments: Moment[] = [];
  let start = 0;
  const close = (end: number) => {
    const members = timed.slice(start, end + 1);
    moments.push({ id: `m:${members[0].id}`, photoIds: members.map((photo) => photo.id), startMs: members[0].captureTimeMs, endMs: members[members.length - 1].captureTimeMs });
    start = end + 1;
  };
  gaps.forEach((gap, index) => {
    const around = gaps.slice(Math.max(0, index - settings.window), index).concat(gaps.slice(index + 1, index + 1 + settings.window));
    const threshold = Math.min(settings.maxGapMs, Math.max(settings.minGapMs, settings.gapFactor * median(around)));
    if (gap > threshold) close(index);
  });
  close(timed.length - 1);
  return moments;
}
