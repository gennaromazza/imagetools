import { lstat, mkdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

/**
 * Crea (o riusa) una sottocartella diretta di una cartella di output.
 * Il nome non può uscire dalla cartella scelta e un collegamento esistente
 * non viene seguito: i file finirebbero altrove.
 */
export async function ensureOutputSubfolder(parentPath: string, name: string): Promise<string> {
  const parent = resolve(parentPath);
  const invalid = typeof name !== "string"
    || !name
    || name.length > 120
    || name === "."
    || name === ".."
    || name.startsWith(".filex-")
    // eslint-disable-next-line no-control-regex
    || /[<>:"/\\|?*\x00-\x1F]/.test(name)
    || /[. ]$/.test(name);
  const target = invalid ? "" : resolve(parent, name);
  if (!target || dirname(target) !== parent || basename(target) !== name) {
    throw new Error("Nome della sottocartella non valido.");
  }
  try {
    await mkdir(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!(await lstat(target)).isDirectory()) {
      throw new Error(`Esiste già un file o un collegamento chiamato «${name}» nella cartella scelta.`);
    }
  }
  return target;
}
