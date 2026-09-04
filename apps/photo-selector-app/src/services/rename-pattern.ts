/**
 * Costruzione nomi batch stile Adobe Bridge, pura e testabile.
 * Le date sono già millisecondi UTC normalizzati (muro fotocamera):
 * si formattano in UTC per non introdurre fusi.
 */

export interface RenameSourceFile {
  id: string;
  fileName: string;
  captureTimeMs: number | null;
  fallbackTimeMs?: number;
}

export interface RenamePatternOptions {
  mode: "datetime" | "custom";
  customText?: string;
  keepOriginalName?: boolean;
  startNumber?: number;
  padWidth?: number;
}

export interface RenamePreviewItem {
  id: string;
  from: string;
  to: string;
  sequence: number;
  adjusted: boolean;
}

const WINDOWS_FORBIDDEN = /[<>:"/\\|?*\x00-\x1f]/g;

export function sanitizeFileName(value: string): string {
  return value
    .replace(WINDOWS_FORBIDDEN, "_")
    .replace(/[.\s]+$/, "")
    .trim();
}

function splitName(fileName: string): { stem: string; ext: string } {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) {
    return { stem: fileName, ext: "" };
  }
  return { stem: fileName.slice(0, dot), ext: fileName.slice(dot) };
}

function formatWallUtc(timeMs: number): { date: string; time: string } {
  const date = new Date(timeMs);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return {
    date: `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`,
    time: `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`,
  };
}

function padNumber(value: number, width: number): string {
  return String(Math.max(0, Math.trunc(value))).padStart(Math.max(1, Math.trunc(width)), "0");
}

export function buildBatchRenamePreview(
  files: readonly RenameSourceFile[],
  options: RenamePatternOptions,
): RenamePreviewItem[] {
  const keepOriginal = options.keepOriginalName !== false;
  const startNumber = Math.max(0, Math.trunc(options.startNumber ?? 1));
  const padWidth = Math.max(1, Math.min(6, Math.trunc(options.padWidth ?? 4)));
  const customBase = sanitizeFileName(options.customText ?? "").trim() || "Foto";

  const bases = files.map((file) => {
    const { stem, ext } = splitName(file.fileName);
    if (options.mode === "custom") {
      return { id: file.id, from: file.fileName, ext, base: keepOriginal ? `${customBase}_${stem}` : customBase };
    }
    const timeMs = file.captureTimeMs ?? file.fallbackTimeMs ?? null;
    if (timeMs === null || !(timeMs > 0)) {
      return { id: file.id, from: file.fileName, ext, base: keepOriginal ? stem : "Foto" };
    }
    const { date, time } = formatWallUtc(timeMs);
    return { id: file.id, from: file.fileName, ext, base: keepOriginal ? `${date}_${time}_${stem}` : `${date}_${time}` };
  });

  const seen = new Map<string, number>();
  for (const item of bases) {
    const key = `${item.base}${item.ext}`.toLocaleLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const needsSequence = !keepOriginal || [...seen.values()].some((count) => count > 1);

  return bases.map((item, position) => {
    const sequence = startNumber + position;
    const candidate = needsSequence
      ? `${item.base}_${padNumber(sequence, padWidth)}${item.ext}`
      : `${item.base}${item.ext}`;
    const sanitized = sanitizeFileName(candidate);
    return {
      id: item.id,
      from: item.from,
      to: sanitized,
      sequence,
      adjusted: needsSequence || sanitized !== candidate,
    };
  });
}
