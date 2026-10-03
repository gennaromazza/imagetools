export interface ArchivedEvidence {
  destinationPath: string;
  sessionId: string;
}

export interface DuplicateCheckDeps {
  /** Dimensioni dei file gia' archiviati e verificati: se la dimensione non c'e', il file e' nuovo e non si legge nulla. */
  knownSizes: ReadonlySet<number>;
  findEvidence(size: number, fingerprint: string): ArchivedEvidence[];
  /** Impronta veloce (testa, meta' e coda del file). */
  fingerprint(filePath: string): Promise<string>;
  stat(filePath: string): Promise<{ size: number; isFile(): boolean }>;
  /**
   * Se presente, conferma il contenuto completo prima di dichiarare un file gia' archiviato.
   * Serve quando la risposta decide cosa NON copiare; per la sola etichetta in griglia si puo' omettere.
   */
  fullHash?(filePath: string): Promise<string>;
  /** Scarta le prove fuori dall'archivio (es. cartelle spostate altrove). */
  isAllowedDestination?(destinationPath: string): boolean;
}

export interface ArchivedMatch {
  filePath: string;
  size: number;
  fingerprint: string;
  destinationPath: string;
  sessionId: string;
}

/**
 * Trova tra i file indicati quelli che risultano gia' archiviati (anche in un altro lavoro).
 * Fail-closed: qualunque dubbio (file illeggibile, destinazione sparita, contenuto diverso) = non e' un duplicato.
 */
export async function findArchivedFiles(
  filePaths: readonly string[],
  deps: DuplicateCheckDeps,
  options: { concurrency?: number; isCancelled?: () => boolean } = {},
): Promise<ArchivedMatch[]> {
  const { concurrency = 4, isCancelled = () => false } = options;
  const matches: Array<ArchivedMatch | null> = new Array(filePaths.length).fill(null);
  let cursor = 0;

  async function checkOne(filePath: string): Promise<ArchivedMatch | null> {
    try {
      const source = await deps.stat(filePath);
      if (!source.isFile() || !deps.knownSizes.has(source.size)) return null;
      const fingerprint = await deps.fingerprint(filePath);
      for (const evidence of deps.findEvidence(source.size, fingerprint)) {
        if (deps.isAllowedDestination && !deps.isAllowedDestination(evidence.destinationPath)) continue;
        try {
          const destination = await deps.stat(evidence.destinationPath);
          if (!destination.isFile() || destination.size !== source.size) continue;
          if (deps.fullHash) {
            const [sourceHash, destinationHash] = await Promise.all([deps.fullHash(filePath), deps.fullHash(evidence.destinationPath)]);
            if (sourceHash !== destinationHash) continue;
          }
          return { filePath, size: source.size, fingerprint, destinationPath: evidence.destinationPath, sessionId: evidence.sessionId };
        } catch {
          continue;
        }
      }
    } catch {
      /* file illeggibile: non e' una prova */
    }
    return null;
  }

  async function worker(): Promise<void> {
    for (;;) {
      if (isCancelled()) return;
      const index = cursor++;
      if (index >= filePaths.length) return;
      matches[index] = await checkOne(filePaths[index]!);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, filePaths.length || 1)) }, worker));
  return matches.filter((match): match is ArchivedMatch => match !== null);
}

/** Trova il lavoro a cui appartiene un percorso: la cartella piu' lunga che lo contiene. */
export function jobNameForPath(destinationPath: string, jobs: ReadonlyArray<{ nomeLavoro: string; percorsoCartella: string }>): string | null {
  const normalize = (value: string) => value.replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();
  const target = normalize(destinationPath);
  let best: { name: string; length: number } | null = null;
  for (const job of jobs) {
    const root = normalize(job.percorsoCartella);
    if (!root || (target !== root && !target.startsWith(`${root}/`))) continue;
    if (!best || root.length > best.length) best = { name: job.nomeLavoro, length: root.length };
  }
  return best?.name ?? null;
}
