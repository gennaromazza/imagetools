/**
 * Nomi dei backup di Album Flow su Google Drive. Sono puri (nessun accesso a Drive) per poterli provare:
 * ogni versione è un file JSON nella cartella dell'album, con data, spread e foto già nel nome, così l'elenco
 * si legge senza scaricare i progetti (che possono pesare molti MB).
 */

export const ALBUM_FLOW_DRIVE_ROOT = "FileX Album Flow";
export const ALBUM_FLOW_PROJECT_FORMAT = "filex-album-project";
/** Un backup più grande di così viene rifiutato (il progetto è solo testo e piccole immagini; le foto non ci sono mai). */
export const ALBUM_FLOW_MAX_BACKUP_BYTES = 250 * 1024 * 1024;

const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]+/g;

/** Nome della cartella di un album su Drive: senza caratteri vietati, mai vuoto, al massimo 80 caratteri. */
export function albumFolderName(projectName: string): string {
  const clean = projectName.replace(FORBIDDEN, "-").replace(/\s+/g, " ").trim().replace(/^[-.\s]+|[-.\s]+$/g, "").slice(0, 80);
  return clean || "Album senza nome";
}

export function albumBackupFileName(projectName: string, createdAtIso: string, spreads: number, photos: number): string {
  const stamp = createdAtIso.replace(/[:.]/g, "-");
  const safe = (n: number) => Math.max(0, Math.min(99999, Math.round(Number.isFinite(n) ? n : 0)));
  return `${stamp}__${albumFolderName(projectName)}__${safe(spreads)}s-${safe(photos)}f.json`;
}

export interface ParsedAlbumBackupName {
  createdAt: string | null;
  projectName: string;
  spreads: number | null;
  photos: number | null;
}

/** Legge data, nome, spread e foto dal nome di un file di backup; se il nome non è nel nostro formato restituisce null. */
export function parseAlbumBackupName(fileName: string): ParsedAlbumBackupName | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)__(.+)__(\d{1,5})s-(\d{1,5})f\.json$/.exec(fileName);
  if (!match) return null;
  const [, stamp, projectName, spreads, photos] = match;
  const createdAt = stamp.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");
  return { createdAt: Number.isNaN(Date.parse(createdAt)) ? null : createdAt, projectName, spreads: Number(spreads), photos: Number(photos) };
}

export interface AlbumBackupCheck {
  ok: boolean;
  message: string;
}

/** Controlla che il contenuto sia davvero un progetto di Album Flow prima di caricarlo o di consegnarlo all'app. */
export function checkAlbumBackupContent(content: unknown): AlbumBackupCheck {
  if (typeof content !== "string" || content.length === 0) return { ok: false, message: "Il progetto da salvare è vuoto." };
  if (Buffer.byteLength(content, "utf8") > ALBUM_FLOW_MAX_BACKUP_BYTES) return { ok: false, message: "Il progetto è troppo grande per il backup." };
  try {
    const parsed = JSON.parse(content) as { format?: unknown; version?: unknown; project?: unknown };
    if (parsed.format !== ALBUM_FLOW_PROJECT_FORMAT || typeof parsed.version !== "number" || !parsed.project || typeof parsed.project !== "object") {
      return { ok: false, message: "Il file non è un progetto di Album Flow." };
    }
    return { ok: true, message: "" };
  } catch {
    return { ok: false, message: "Il progetto non è un JSON valido." };
  }
}
