import { stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import type { ImageConverterInputEntry } from "@photo-tools/desktop-contracts";

const caseKey = (value: string): string => (process.platform === "win32" ? value.toLowerCase() : value);

/**
 * Riserva un percorso di output. Il controllo e la prenotazione avvengono in modo
 * sincrono sul Set del job, quindi due conversioni parallele non scelgono mai lo stesso
 * file. Se il file esiste gia' da un lancio precedente (e non e' stato prenotato in
 * questo job) va saltato invece di produrre duplicati `-1`, `-2`.
 */
export async function claimOutputPath(
  desiredPath: string,
  claims: Set<string>,
): Promise<{ path: string; existing: boolean }> {
  const folder = dirname(desiredPath);
  const extension = extname(desiredPath);
  const name = basename(desiredPath, extension);
  for (let index = 0; index < 10000; index += 1) {
    const candidate = index === 0 ? desiredPath : join(folder, `${name}-${index}${extension}`);
    const key = caseKey(candidate);
    if (claims.has(key)) continue;
    claims.add(key);
    const stats = await stat(candidate).catch(() => null);
    return { path: candidate, existing: Boolean(stats?.isFile() && stats.size > 0) };
  }
  throw new Error("Impossibile assegnare un nome file di output univoco.");
}

/**
 * Nelle cartelle con scatto RAW+JPG il JPG della macchina e' gia' il risultato: quando
 * si converte in JPG/WebP si tiene solo il RAW, evitando doppioni e ricompressioni.
 */
export function dropJpegsPairedWithRaw(entries: ImageConverterInputEntry[]): {
  kept: ImageConverterInputEntry[];
  dropped: number;
} {
  const rawKeys = new Set(
    entries
      .filter((entry) => entry.sourceKind === "raw")
      .map((entry) => caseKey(join(dirname(entry.absolutePath), basename(entry.absolutePath, extname(entry.absolutePath))))),
  );
  const kept = entries.filter((entry) => {
    if (entry.sourceKind !== "bitmap" || !/\.jpe?g$/iu.test(entry.absolutePath)) return true;
    const key = caseKey(join(dirname(entry.absolutePath), basename(entry.absolutePath, extname(entry.absolutePath))));
    return !rawKeys.has(key);
  });
  return { kept, dropped: entries.length - kept.length };
}

export function isValidOutputDirectory(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && isAbsolute(value.trim().replace(/^"+|"+$/g, ""));
}
