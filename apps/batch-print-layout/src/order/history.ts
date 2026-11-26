/** Cronologia dei lavori: resta anche se le cartelle esportate vengono spostate o cancellate. */
export interface HistoryEntry {
  id: string;
  /** Vuoto per un lavoro veloce. */
  customerName: string;
  createdAt: string;
  exportedAt?: string;
  /** Cartella da mostrare in Esplora file e un file che dimostra che c'è ancora. */
  folderPath?: string;
  checkFile?: string;
  prints?: number;
  formats?: string[];
}

export const HISTORY_KEY = "print-flow:history:v1";
const HISTORY_MAX = 500;

type KeyValue = Pick<Storage, "getItem" | "setItem">;

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

export function loadHistory(storage: KeyValue): HistoryEntry[] {
  try {
    const list: unknown = JSON.parse(storage.getItem(HISTORY_KEY) ?? "[]");
    if (!Array.isArray(list)) return [];
    return list.flatMap((item) => {
      if (!item || typeof item.id !== "string" || typeof item.customerName !== "string" || typeof item.createdAt !== "string") return [];
      return [{
        id: item.id,
        customerName: item.customerName,
        createdAt: item.createdAt,
        exportedAt: text(item.exportedAt),
        folderPath: text(item.folderPath),
        checkFile: text(item.checkFile),
        prints: typeof item.prints === "number" ? item.prints : undefined,
        formats: Array.isArray(item.formats) ? item.formats.filter((name: unknown) => typeof name === "string") : undefined,
      }];
    });
  } catch {
    return [];
  }
}

/** Aggiorna la voce del lavoro o la aggiunge in cima. La data di creazione non cambia più. */
export function upsertHistory(list: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const existing = list.find((item) => item.id === entry.id);
  if (!existing) return [entry, ...list].slice(0, HISTORY_MAX);
  return list.map((item) => (item === existing ? { ...existing, ...entry, createdAt: existing.createdAt } : item));
}

export function saveHistory(storage: KeyValue, list: HistoryEntry[]): boolean {
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function recordHistory(storage: KeyValue, entry: HistoryEntry): void {
  saveHistory(storage, upsertHistory(loadHistory(storage), entry));
}
