import type { ImportSessionStatus } from "./studioflow-store.js";

const ALLOWED_TRANSITIONS: Record<ImportSessionStatus, ReadonlySet<ImportSessionStatus>> = {
  CREATED: new Set(["ANALYZING", "FAILED", "CANCELLED", "INTERRUPTED"]),
  ANALYZING: new Set(["READY", "FAILED", "CANCELLED", "INTERRUPTED"]),
  READY: new Set(["IMPORTING", "FAILED", "CANCELLED", "INTERRUPTED"]),
  IMPORTING: new Set(["VERIFYING", "PAUSED", "FAILED", "CANCELLED", "INTERRUPTED"]),
  VERIFYING: new Set(["COMPLETED", "PAUSED", "FAILED", "CANCELLED", "INTERRUPTED"]),
  PAUSED: new Set(["IMPORTING", "CANCELLED"]),
  FAILED: new Set(["CANCELLED"]),
  INTERRUPTED: new Set(["CANCELLED"]),
  COMPLETED: new Set(),
  CANCELLED: new Set(),
};

export function assertImportSessionTransition(from: ImportSessionStatus, to: ImportSessionStatus): void {
  if (from === to) return;
  if (!ALLOWED_TRANSITIONS[from].has(to)) {
    throw new Error(`Transizione sessione import non valida: ${from} -> ${to}`);
  }
}
