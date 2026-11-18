import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, extname, join } from "node:path";

/**
 * Scrittura della correzione colore di Album Flow sul file JPG della foto.
 * Il programma manda i numeri già pronti (matrice di saturazione, pendenza e intercetta per canale): qui non c'è nessuna scelta di stile,
 * si esegue soltanto `recomb` e poi `linear` di sharp, nell'ordine in cui li esegue sempre sharp e che il filtro SVG a schermo ripete.
 * Prima di toccare il file l'originale viene messo al sicuro (una volta sola) per poterlo ripristinare.
 */

export interface PhotoColorTransform {
  /** Matrice 3×3 della saturazione, per righe (9 numeri). */
  matrix: number[];
  /** Pendenza per canale R, G, B. */
  slope: number[];
  /** Intercetta per canale R, G, B, sulla scala 0-1. */
  intercept: number[];
}

export interface PhotoColorWriteResult {
  ok: boolean;
  message: string;
}

const JPEG_EXTENSIONS = new Set([".jpg", ".jpeg"]);

export const isJpegPath = (filePath: string): boolean => JPEG_EXTENSIONS.has(extname(filePath).toLowerCase());

const finite = (values: unknown, count: number, min: number, max: number): values is number[] =>
  Array.isArray(values) && values.length === count && values.every((value) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max);

/** Controlla i numeri ricevuti dal programma: fuori scala vuol dire un errore, non un'esigenza. */
export function parseColorTransform(input: unknown): PhotoColorTransform | null {
  const value = input as Partial<PhotoColorTransform> | null;
  if (!value || typeof value !== "object") return null;
  if (!finite(value.matrix, 9, -3, 3) || !finite(value.slope, 3, 0, 4) || !finite(value.intercept, 3, -1, 1)) return null;
  return { matrix: value.matrix, slope: value.slope, intercept: value.intercept };
}

let sharpModule: typeof import("sharp") | null | undefined;
async function getSharp(): Promise<typeof import("sharp") | null> {
  if (sharpModule !== undefined) return sharpModule;
  try { sharpModule = (await import("sharp")).default as unknown as typeof import("sharp"); } catch { sharpModule = null; }
  return sharpModule;
}

/** Dove sta la copia di sicurezza di una foto: nella cartella del programma, con un nome che dipende dal percorso. */
export function originalBackupPath(filePath: string, backupDir: string): string {
  const key = createHash("sha1").update(filePath.toLowerCase()).digest("hex").slice(0, 16);
  return join(backupDir, `${key}-${basename(filePath)}`);
}

const exists = async (target: string): Promise<boolean> => { try { await fs.access(target); return true; } catch { return false; } };

export const hasOriginalBackup = (filePath: string, backupDir: string): Promise<boolean> => exists(originalBackupPath(filePath, backupDir));

/**
 * Scrive la correzione sul file: copia di sicurezza (se non c'è già), nuova immagine in un file temporaneo accanto all'originale,
 * poi sostituzione. Metadati (EXIF, profilo colore, XMP) e orientamento restano quelli del file; la foto non viene ruotata.
 */
export async function applyColorToJpeg(filePath: string, transformInput: unknown, backupDir: string): Promise<PhotoColorWriteResult> {
  const transform = parseColorTransform(transformInput);
  if (!transform) return { ok: false, message: "I valori della correzione non sono validi." };
  if (!isJpegPath(filePath)) return { ok: false, message: "Per ora si possono salvare sul file solo le foto JPG." };
  const sharp = await getSharp();
  if (!sharp) return { ok: false, message: "Il motore di elaborazione delle immagini non è disponibile su questo computer." };

  let source: Buffer;
  try { source = await fs.readFile(filePath); } catch { return { ok: false, message: "Non riesco a leggere il file della foto." }; }

  const temp = `${filePath}.afcolor.tmp`;
  try {
    const meta = await sharp(source, { failOn: "none" }).metadata();
    if (meta.format !== "jpeg") return { ok: false, message: "Il file non è un vero JPG." };
    if ((meta.channels ?? 3) < 3) return { ok: false, message: "Le foto in scala di grigi non si correggono." };

    const backup = originalBackupPath(filePath, backupDir);
    if (!(await exists(backup))) {
      await fs.mkdir(backupDir, { recursive: true });
      await fs.writeFile(backup, source, { flag: "wx" });
      await fs.writeFile(`${backup}.json`, JSON.stringify({ originalPath: filePath, savedAt: new Date().toISOString() }), "utf8");
    }

    const m = transform.matrix;
    const matrix: [[number, number, number], [number, number, number], [number, number, number]] = [[m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]]];
    await sharp(source, { failOn: "none" })
      .recomb(matrix)
      .linear(transform.slope, transform.intercept.map((value) => value * 255))
      .keepMetadata()
      .jpeg({ quality: 95, chromaSubsampling: "4:4:4", mozjpeg: false })
      .toFile(temp);
    await fs.rename(temp, filePath);
    return { ok: true, message: "Correzione scritta sul file. L'originale resta al sicuro e si può ripristinare." };
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "EBUSY" || code === "EPERM" || code === "EACCES") return { ok: false, message: "Il file è aperto in un altro programma (per esempio Photoshop): chiudilo e riprova." };
    return { ok: false, message: "Non sono riuscito a scrivere la correzione sul file." };
  }
}

/** Rimette al suo posto l'originale messo al sicuro prima della prima correzione scritta. */
export async function restoreOriginalJpeg(filePath: string, backupDir: string): Promise<PhotoColorWriteResult> {
  const backup = originalBackupPath(filePath, backupDir);
  if (!(await exists(backup))) return { ok: false, message: "Non c'è un originale da ripristinare per questa foto." };
  const temp = `${filePath}.afrestore.tmp`;
  try {
    await fs.copyFile(backup, temp);
    await fs.rename(temp, filePath);
    return { ok: true, message: "Originale ripristinato." };
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "EBUSY" || code === "EPERM" || code === "EACCES") return { ok: false, message: "Il file è aperto in un altro programma: chiudilo e riprova." };
    return { ok: false, message: "Non sono riuscito a ripristinare l'originale." };
  }
}
