import { createHash } from "crypto";
import fs from "fs";
import path from "path";

export type WarnFn = (event: string, details?: Record<string, unknown>) => void;

const noopWarn: WarnFn = () => undefined;

/** `<dest>.part.<pid>.<timestamp>.<random>` e `<dest>.backup.<pid>.<timestamp>.<random>` */
const TEMP_FILE_PATTERN = /^(.+)\.(part|backup)\.\d+\.\d+\.[a-z0-9]{1,8}$/i;
const RENAME_TEMP_DIR_PATTERN = /^\.archivio-flow-rename-\d+-[a-z0-9]+$/i;

const RETRYABLE_CODES = new Set(["EBUSY", "EAGAIN", "EIO", "EMFILE", "ENFILE", "EPERM", "ETIMEDOUT", "EVERIFY"]);

export function isTemporaryArtifactName(name: string): boolean {
  return TEMP_FILE_PATTERN.test(name) || RENAME_TEMP_DIR_PATTERN.test(name);
}

export function createTemporaryPath(destinationPath: string, kind: "part" | "backup"): string {
  return `${destinationPath}.${kind}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

/** Soltanto gli errori transitori (file bloccato, I/O momentaneo) meritano un nuovo tentativo. */
export function isRetryableFsError(error: unknown): boolean {
  const code = errorCode(error);
  return code !== undefined && RETRYABLE_CODES.has(code);
}

export function describeFsError(error: unknown): string {
  const code = errorCode(error);
  if (code === "ENOSPC") return "Spazio insufficiente sulla destinazione";
  if (code === "EACCES" || code === "EROFS") return "Permessi insufficienti sulla destinazione";
  return error instanceof Error ? error.message : String(error);
}

export async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

export async function filesHaveSameContent(firstPath: string, secondPath: string): Promise<boolean> {
  const [firstHash, secondHash] = await Promise.all([hashFile(firstPath), hashFile(secondPath)]);
  return firstHash === secondHash;
}

async function removeQuietly(filePath: string, onWarn: WarnFn, event: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    onWarn(event, { filePath, error: describeFsError(error) });
  }
}

export async function replaceFileAtomically(
  temporaryPath: string,
  destinationPath: string,
  onWarn: WarnFn = noopWarn,
): Promise<void> {
  let destinationExists = false;
  try {
    destinationExists = (await fs.promises.stat(destinationPath)).isFile();
  } catch {
    destinationExists = false;
  }

  if (!destinationExists) {
    await fs.promises.rename(temporaryPath, destinationPath);
    return;
  }

  const backupPath = createTemporaryPath(destinationPath, "backup");
  await fs.promises.rename(destinationPath, backupPath);
  try {
    await fs.promises.rename(temporaryPath, destinationPath);
  } catch (error) {
    try {
      await fs.promises.rename(backupPath, destinationPath);
    } catch (rollbackError) {
      // Il file originale resta nel backup: va segnalato, non nascosto.
      onWarn("replace_rollback_failed", { destinationPath, backupPath, error: describeFsError(rollbackError) });
      throw new Error(
        `${describeFsError(error)}. Il file originale è conservato in "${backupPath}" e non è stato ripristinato: ${describeFsError(rollbackError)}`,
      );
    }
    throw error;
  }
  await removeQuietly(backupPath, onWarn, "replace_backup_cleanup_failed");
}

export interface VerifiedCopyOptions {
  retries?: number;
  baseDelayMs?: number;
  copyFile?: (src: string, dest: string) => Promise<void>;
  onWarn?: WarnFn;
}

/**
 * Copia in un file temporaneo, verifica dimensione e contenuto (SHA-256) e solo allora
 * lo rende definitivo. Ritenta soltanto gli errori transitori.
 */
export async function copyFileVerified(
  src: string,
  dest: string,
  sourceSize: number,
  options: VerifiedCopyOptions = {},
): Promise<"copied" | "skipped"> {
  const { retries = 2, baseDelayMs = 150, onWarn = noopWarn } = options;
  const copyFile = options.copyFile ?? ((from, to) => fs.promises.copyFile(from, to));

  try {
    const destStat = await fs.promises.stat(dest);
    if (destStat.size === sourceSize && await filesHaveSameContent(src, dest)) {
      return "skipped";
    }
  } catch {
    /* la destinazione non esiste */
  }

  let attempt = 0;
  for (;;) {
    const tmp = createTemporaryPath(dest, "part");
    try {
      await copyFile(src, tmp);

      const tmpStat = await fs.promises.stat(tmp);
      if (tmpStat.size !== sourceSize) {
        throw Object.assign(new Error(`Verifica size fallita (${sourceSize} != ${tmpStat.size})`), { code: "EVERIFY" });
      }
      if (!await filesHaveSameContent(src, tmp)) {
        throw Object.assign(new Error("Verifica contenuto fallita: la copia non coincide con l'originale"), { code: "EVERIFY" });
      }

      await replaceFileAtomically(tmp, dest, onWarn);
      return "copied";
    } catch (error) {
      await removeQuietly(tmp, onWarn, "copy_temp_cleanup_failed");
      if (attempt >= retries || !isRetryableFsError(error)) {
        if (errorCode(error) === "ENOSPC") {
          throw Object.assign(new Error(describeFsError(error)), { code: "ENOSPC" });
        }
        throw error;
      }
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
}

export interface OrphanRecoveryResult {
  removed: string[];
  restored: string[];
  /** Cartelle di rinomina interrotta: contengono dati reali, vengono solo segnalate. */
  renameDirectories: string[];
}

/**
 * Pulisce i residui di un crash: i `.part` vengono eliminati, un `.backup` torna al
 * suo posto se l'originale manca (altrimenti è un avanzo e si elimina). Tocca solo file
 * più vecchi di `minAgeMs`, così non interferisce con una copia in corso.
 */
export async function recoverOrphanTemporaryFiles(
  root: string,
  options: { minAgeMs?: number; now?: number; onWarn?: WarnFn } = {},
): Promise<OrphanRecoveryResult> {
  const { minAgeMs = 15 * 60_000, now = Date.now(), onWarn = noopWarn } = options;
  const result: OrphanRecoveryResult = { removed: [], restored: [], renameDirectories: [] };

  async function visit(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (error) {
      onWarn("orphan_scan_unreadable", { dir, error: describeFsError(error) });
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (RENAME_TEMP_DIR_PATTERN.test(entry.name)) {
          result.renameDirectories.push(full);
          onWarn("orphan_rename_directory", { directory: full });
          continue;
        }
        await visit(full);
        continue;
      }
      const match = TEMP_FILE_PATTERN.exec(entry.name);
      if (!match) continue;
      try {
        const stat = await fs.promises.stat(full);
        if (now - stat.mtimeMs < minAgeMs) continue;
        if (match[2]!.toLowerCase() === "part") {
          await fs.promises.unlink(full);
          result.removed.push(full);
          continue;
        }
        const original = path.join(dir, match[1]!);
        let originalExists = true;
        try { await fs.promises.stat(original); } catch { originalExists = false; }
        if (originalExists) {
          await fs.promises.unlink(full);
          result.removed.push(full);
        } else {
          await fs.promises.rename(full, original);
          result.restored.push(original);
        }
      } catch (error) {
        onWarn("orphan_cleanup_failed", { filePath: full, error: describeFsError(error) });
      }
    }
  }

  await visit(root);
  return result;
}

/** Valida un percorso da aprire in Esplora risorse: deve essere una cartella reale, mai un file. */
export function resolveOpenableFolder(candidate: unknown): string {
  if (typeof candidate !== "string" || !candidate.trim() || candidate.includes("\0")) {
    throw new Error("Percorso vuoto");
  }
  const resolved = path.resolve(candidate);
  if (resolved.startsWith("\\\\")) throw new Error("UNC paths non supportati");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw Object.assign(new Error("Cartella non trovata"), { code: "ENOENT" });
  }
  if (!stat.isDirectory()) throw new Error("Il percorso non è una cartella");
  return resolved;
}
