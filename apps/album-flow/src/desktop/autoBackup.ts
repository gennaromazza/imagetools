import type { AlbumProjectV2 } from "@photo-tools/shared-types";

/**
 * Backup automatico su Google Drive alla chiusura del programma (se lo attivi). Le scelte stanno qui, senza rete,
 * così si possono provare: quali album salvare, entro quanto tempo e come ricordare cosa è già salvato.
 */

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const AUTO_BACKUP_KEYS = {
  enabled: "filex.albumFlow.autoBackupOnClose",
  marks: "filex.albumFlow.driveBackupMarks",
} as const;

/** Tempo massimo concesso alla chiusura: la shell aspetta al più 20 secondi, poi chiude comunque. */
export const CLOSE_BACKUP_BUDGET_MS = 15_000;
/** Un solo album modificato alla volta sarebbe poco, ma decine rallenterebbero la chiusura: i più recenti per primi. */
export const MAX_ALBUMS_PER_CLOSE = 3;

const defaultStorage = (): KeyValueStorage | null => {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
};

export function autoBackupEnabled(storage: KeyValueStorage | null = defaultStorage()): boolean {
  try { return storage?.getItem(AUTO_BACKUP_KEYS.enabled) === "1"; } catch { return false; }
}

export function setAutoBackupEnabled(on: boolean, storage: KeyValueStorage | null = defaultStorage()): void {
  try { storage?.setItem(AUTO_BACKUP_KEYS.enabled, on ? "1" : "0"); } catch { /* preferenza non salvata */ }
}

/** Per ogni album, la data di modifica dell'ultima versione salvata su Drive da questo computer. */
export function loadBackupMarks(storage: KeyValueStorage | null = defaultStorage()): Record<string, string> {
  try {
    const parsed = JSON.parse(storage?.getItem(AUTO_BACKUP_KEYS.marks) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch { return {}; }
}

export function markBackedUp(projectId: string, updatedAt: string, storage: KeyValueStorage | null = defaultStorage()): void {
  try { storage?.setItem(AUTO_BACKUP_KEYS.marks, JSON.stringify({ ...loadBackupMarks(storage), [projectId]: updatedAt })); } catch { /* si ripeterà al prossimo salvataggio */ }
}

/** Album modificati dopo l'ultimo backup (e con qualcosa dentro), dal più recente, al massimo `max`. */
export function projectsToBackup(projects: readonly AlbumProjectV2[], marks: Readonly<Record<string, string>>, max = MAX_ALBUMS_PER_CLOSE): AlbumProjectV2[] {
  return projects
    .filter((project) => (project.spreads.length > 0 || project.assets.length > 0) && (marks[project.projectId] ?? "") < project.updatedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, Math.max(0, max));
}

export interface CloseBackupDeps {
  connected: () => Promise<boolean>;
  backup: (project: AlbumProjectV2) => Promise<unknown>;
  now?: () => number;
}

export interface CloseBackupResult {
  saved: string[];
  failed: string[];
  skipped: "disattivato" | "non collegato" | "niente da salvare" | "tempo scaduto" | null;
}

/** Salva su Drive gli album modificati, restando nel tempo concesso. Non lancia mai: la chiusura non deve bloccarsi. */
export async function backupOnClose(projects: readonly AlbumProjectV2[], deps: CloseBackupDeps, budgetMs = CLOSE_BACKUP_BUDGET_MS, storage: KeyValueStorage | null = defaultStorage()): Promise<CloseBackupResult> {
  const result: CloseBackupResult = { saved: [], failed: [], skipped: null };
  if (!autoBackupEnabled(storage)) return { ...result, skipped: "disattivato" };
  const due = projectsToBackup(projects, loadBackupMarks(storage));
  if (due.length === 0) return { ...result, skipped: "niente da salvare" };
  try { if (!(await deps.connected())) return { ...result, skipped: "non collegato" }; } catch { return { ...result, skipped: "non collegato" }; }
  const now = deps.now ?? Date.now;
  const deadline = now() + budgetMs;
  for (const project of due) {
    const left = deadline - now();
    if (left < 1500) { result.skipped = "tempo scaduto"; break; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        deps.backup(project),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("tempo scaduto")), left); }),
      ]);
      markBackedUp(project.projectId, project.updatedAt, storage);
      result.saved.push(project.projectId);
    } catch {
      result.failed.push(project.projectId);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return result;
}
