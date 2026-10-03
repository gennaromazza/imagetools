import { createHash } from "crypto";
import path from "path";

/**
 * Suffisso stabile per distinguere file con lo stesso nome in cartelle diverse della scheda.
 * Si calcola sul percorso SENZA estensione: foto, RAW e sidecar dello stesso scatto
 * (DSC01815.ARW, DSC01815.JPG, DSC01815.xmp) ottengono lo stesso nome base, così
 * Lightroom e Bridge continuano ad abbinare il file .xmp alla sua foto.
 */
export function shortStableSuffix(sourceRelativePath: string): string {
  const withoutExtension = sourceRelativePath.slice(0, sourceRelativePath.length - path.extname(sourceRelativePath).length);
  return createHash("sha1").update(withoutExtension).digest("hex").slice(0, 8);
}

export function buildDestinationFileName(params: {
  originalName: string;
  sourceRelativePath: string;
  rinominaFile: boolean;
  safeNome: string;
  safeData: string;
  safeAutore: string;
}): string {
  const { originalName, sourceRelativePath, rinominaFile, safeNome, safeData, safeAutore } = params;
  const ext = path.extname(originalName);
  const stem = path.basename(originalName, ext);
  const suffix = shortStableSuffix(sourceRelativePath);
  const base = rinominaFile
    ? `${safeNome}_${safeData}_${safeAutore}_${stem}`
    : stem;
  return rinominaFile ? `${base}_${suffix}${ext}` : `${base}${ext}`;
}
