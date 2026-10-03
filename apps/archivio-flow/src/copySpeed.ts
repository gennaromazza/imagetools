import { DEFAULT_COPY_BYTES_PER_SECOND } from "./wizardModel";

const STORAGE_KEY = "filex.archivio-flow.copy-speed";
type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "setItem" | "getItem">;

function browserStorage(): WriteStorage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/** Velocita' di copia imparata dalle importazioni precedenti (byte al secondo), o quella di partenza. */
export function loadCopySpeed(storage: ReadStorage | null = browserStorage()): number {
  try {
    const value = Number(storage?.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value >= 1_000_000 && value <= 5_000_000_000 ? value : DEFAULT_COPY_BYTES_PER_SECOND;
  } catch {
    return DEFAULT_COPY_BYTES_PER_SECOND;
  }
}

/**
 * Aggiorna la velocita' con la media tra quella nota e quella appena misurata. Le importazioni troppo piccole
 * o troppo brevi non contano: sarebbero soltanto rumore.
 */
export function saveCopySpeed(bytes: number, elapsedMs: number, storage: WriteStorage | null = browserStorage()): number | null {
  if (!storage || !Number.isFinite(bytes) || !Number.isFinite(elapsedMs) || bytes < 50_000_000 || elapsedMs < 5_000) return null;
  const measured = bytes / (elapsedMs / 1000);
  if (!Number.isFinite(measured) || measured < 1_000_000 || measured > 5_000_000_000) return null;
  const hasPrevious = Number.isFinite(Number(storage.getItem(STORAGE_KEY))) && storage.getItem(STORAGE_KEY) !== null;
  const next = hasPrevious ? Math.round((loadCopySpeed(storage) + measured) / 2) : Math.round(measured);
  try { storage.setItem(STORAGE_KEY, String(next)); } catch { return null; }
  return next;
}
