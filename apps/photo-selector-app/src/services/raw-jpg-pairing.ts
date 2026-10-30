import { JPEG_EXTENSIONS, RAW_EXTENSIONS } from "./photo-classification";

export interface PairableEntry {
  name: string;
  relativePath: string;
  lastModified: number;
}

export interface EntryGroup<T extends PairableEntry = PairableEntry> {
  primary: T;
  companion?: T;
}

/**
 * Un JPG e un RAW con lo stesso nome in cartelle diverse (tipico: «RAW/» e
 * «JPG/») si accoppiano solo se sono stati scritti quasi insieme. La
 * fotocamera li salva a pochi secondi di distanza; un contatore riusato
 * (IMG_0001 di un altro servizio) cade molto più lontano nel tempo.
 */
export const CROSS_FOLDER_MAX_MTIME_GAP_MS = 60_000;

interface NameBucket<T> {
  base: string;
  jpgs: T[];
  raws: T[];
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function baseNameOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot >= 0 ? name.slice(0, dot) : name).toLowerCase();
}

function parentPathOf(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(0, slash) : "";
}

function wereSavedTogether(left: PairableEntry, right: PairableEntry): boolean {
  if (!(left.lastModified > 0) || !(right.lastModified > 0)) {
    return false;
  }
  return Math.abs(left.lastModified - right.lastModified) <= CROSS_FOLDER_MAX_MTIME_GAP_MS;
}

/**
 * Raggruppa la stessa foto scattata in RAW + JPG: il JPG è la voce principale,
 * il RAW la sua compagna. Due passaggi:
 *  1. stessa cartella e stesso nome (senza maiuscole): sempre un'unica foto;
 *  2. cartelle diverse e stesso nome: solo se il legame è univoco (un solo
 *     candidato per parte) e i due file sono stati scritti quasi insieme.
 * Le voci non accoppiate restano singole; l'ordine è quello di ingresso.
 */
export function groupEntriesByBaseName<T extends PairableEntry>(entries: readonly T[]): EntryGroup<T>[] {
  const sameFolder = new Map<string, NameBucket<T>>();
  for (const entry of entries) {
    const ext = extensionOf(entry.name);
    const isJpeg = JPEG_EXTENSIONS.has(ext);
    if (!isJpeg && !RAW_EXTENSIONS.has(ext)) {
      continue;
    }
    const base = baseNameOf(entry.name);
    const key = `${parentPathOf(entry.relativePath).toLowerCase()}::${base}`;
    let bucket = sameFolder.get(key);
    if (!bucket) {
      bucket = { base, jpgs: [], raws: [] };
      sameFolder.set(key, bucket);
    }
    (isJpeg ? bucket.jpgs : bucket.raws).push(entry);
  }

  const rawByJpeg = new Map<T, T>();
  const pairedRaws = new Set<T>();

  for (const bucket of sameFolder.values()) {
    for (const jpeg of bucket.jpgs) {
      const raw = bucket.raws.find((candidate) => !pairedRaws.has(candidate));
      if (raw) {
        rawByJpeg.set(jpeg, raw);
        pairedRaws.add(raw);
      }
    }
  }

  const looseByBase = new Map<string, { jpgs: T[]; raws: T[] }>();
  for (const bucket of sameFolder.values()) {
    const jpgs = bucket.jpgs.filter((jpeg) => !rawByJpeg.has(jpeg));
    const raws = bucket.raws.filter((raw) => !pairedRaws.has(raw));
    if (jpgs.length === 0 && raws.length === 0) {
      continue;
    }
    const loose = looseByBase.get(bucket.base);
    if (loose) {
      loose.jpgs.push(...jpgs);
      loose.raws.push(...raws);
    } else {
      looseByBase.set(bucket.base, { jpgs, raws });
    }
  }

  for (const { jpgs, raws } of looseByBase.values()) {
    if (jpgs.length === 0 || raws.length === 0) {
      continue;
    }
    const rawsOfJpeg = new Map<T, T[]>();
    const jpgsOfRaw = new Map<T, T[]>();
    for (const jpeg of jpgs) {
      for (const raw of raws) {
        if (!wereSavedTogether(jpeg, raw)) {
          continue;
        }
        rawsOfJpeg.set(jpeg, [...(rawsOfJpeg.get(jpeg) ?? []), raw]);
        jpgsOfRaw.set(raw, [...(jpgsOfRaw.get(raw) ?? []), jpeg]);
      }
    }
    for (const [jpeg, candidates] of rawsOfJpeg) {
      const raw = candidates[0]!;
      if (candidates.length === 1 && jpgsOfRaw.get(raw)?.length === 1) {
        rawByJpeg.set(jpeg, raw);
        pairedRaws.add(raw);
      }
    }
  }

  const groups: EntryGroup<T>[] = [];
  const emitted = new Set<T>();
  for (const entry of entries) {
    if (pairedRaws.has(entry) || emitted.has(entry)) {
      continue;
    }
    emitted.add(entry);
    const companion = rawByJpeg.get(entry);
    groups.push(companion ? { primary: entry, companion } : { primary: entry });
  }
  return groups;
}
