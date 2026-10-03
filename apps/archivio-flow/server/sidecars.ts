import fs from "fs";
import path from "path";

/** File che accompagnano una foto o un video (metadati di sviluppo, miniature della fotocamera). */
export const SIDECAR_EXTENSIONS: ReadonlySet<string> = new Set([".xmp", ".thm", ".aae", ".dop", ".pp3", ".acr"]);

export function isSidecarPath(filePath: string): boolean {
  return SIDECAR_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Aggiunge alla selezione i sidecar di ogni foto/video scelto: stessa cartella e stesso nome
 * (`DSC01815.xmp`) oppure nome completo + estensione (`DSC01815.ARW.xmp`). Un sidecar senza il suo
 * file principale selezionato non viene mai aggiunto. L'ordine resta quello della selezione, con
 * ogni sidecar subito dopo il suo file.
 */
export async function expandWithSidecars(selected: readonly string[]): Promise<string[]> {
  const caseInsensitive = process.platform === "win32";
  const keyOf = (value: string) => (caseInsensitive ? value.toLowerCase() : value);
  const seen = new Set(selected.map(keyOf));
  const directoryCache = new Map<string, Array<{ name: string; lower: string }>>();

  async function sidecarsInDirectory(directory: string): Promise<Array<{ name: string; lower: string }>> {
    const cached = directoryCache.get(directory);
    if (cached) return cached;
    let entries: Array<{ name: string; lower: string }> = [];
    try {
      entries = (await fs.promises.readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && isSidecarPath(entry.name))
        .map((entry) => ({ name: entry.name, lower: entry.name.toLowerCase() }));
    } catch {
      entries = [];
    }
    directoryCache.set(directory, entries);
    return entries;
  }

  const result: string[] = [];
  for (const filePath of selected) {
    result.push(filePath);
    if (isSidecarPath(filePath)) continue;
    const directory = path.dirname(filePath);
    const fileName = path.basename(filePath).toLowerCase();
    const stem = path.basename(fileName, path.extname(fileName));
    for (const candidate of await sidecarsInDirectory(directory)) {
      const sidecarStem = path.basename(candidate.lower, path.extname(candidate.lower));
      if (sidecarStem !== stem && sidecarStem !== fileName) continue;
      const full = path.join(directory, candidate.name);
      if (seen.has(keyOf(full))) continue;
      seen.add(keyOf(full));
      result.push(full);
    }
  }
  return result;
}
