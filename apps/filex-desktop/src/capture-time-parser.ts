/**
 * Parser difensivo per le date EXIF lette da exiftool-vendored.
 * Non importa electron: testabile con tsx --test.
 */

export interface ParsedExifDateTime {
  timeMs: number;
  hasSubSeconds: boolean;
  offsetApplied: boolean;
}

const EXIF_DATE_PATTERN = /^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?\s*(Z|[+-]\d{2}:?\d{2})?$/;

function subSecondsToMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value) % 1000;
  }
  if (typeof value === "string") {
    const digits = value.trim().match(/^(\d{1,9})/);
    if (digits) {
      return Number((digits[1] + "000").slice(0, 3));
    }
  }
  return null;
}

function offsetToMinutes(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value * 60);
  }
  if (typeof value === "string") {
    const match = value.trim().match(/^([+-])(\d{2}):?(\d{2})?$/);
    if (match) {
      const sign = match[1] === "-" ? -1 : 1;
      return sign * (Number(match[2]) * 60 + Number(match[3] ?? "0"));
    }
  }
  return null;
}

/**
 * Converte una data EXIF in millisecondi UTC.
 * @param main DateTimeOriginal (o CreateDate) come arriva da exiftool
 * @param subSec SubSecTimeOriginal di scorta se mancano i decimali
 * @param offset OffsetTimeOriginal di scorta se manca la zona
 */
export function parseExifDateTime(
  main: unknown,
  subSec?: unknown,
  offset?: unknown,
): ParsedExifDateTime | null {
  if (typeof main === "number" && Number.isFinite(main) && main > 0) {
    return { timeMs: Math.round(main), hasSubSeconds: false, offsetApplied: false };
  }
  if (main instanceof Date && !Number.isNaN(main.getTime())) {
    return { timeMs: main.getTime(), hasSubSeconds: main.getMilliseconds() !== 0, offsetApplied: true };
  }
  if (main !== null && typeof main === "object" && typeof (main as { toMillis?: unknown }).toMillis === "function") {
    try {
      const millis = ((main as { toMillis: () => unknown }).toMillis)();
      if (typeof millis === "number" && Number.isFinite(millis) && millis > 0) {
        return { timeMs: Math.round(millis), hasSubSeconds: millis % 1000 !== 0, offsetApplied: true };
      }
    } catch {
      return null;
    }
    return null;
  }
  if (typeof main !== "string") {
    return null;
  }

  const match = main.trim().match(EXIF_DATE_PATTERN);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second, fraction, zone] = match as RegExpMatchArray & string[];
  const monthNum = Number(month);
  const dayNum = Number(day);
  const hourNum = Number(hour);
  const minuteNum = Number(minute);
  const secondNum = Number(second);
  if (
    monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31
    || hourNum > 23 || minuteNum > 59 || secondNum > 60
  ) {
    return null;
  }
  const wallMs = Date.UTC(
    Number(year), monthNum - 1, dayNum,
    hourNum, minuteNum, secondNum,
  );
  if (!Number.isFinite(wallMs)) {
    return null;
  }

  let fractionMs: number | null = null;
  if (fraction) {
    fractionMs = Number((fraction + "000").slice(0, 3));
  } else {
    fractionMs = subSecondsToMs(subSec);
  }

  let offsetMinutes: number | null = null;
  if (zone === "Z") {
    offsetMinutes = 0;
  } else if (zone) {
    offsetMinutes = offsetToMinutes(zone);
  } else {
    offsetMinutes = offsetToMinutes(offset);
  }

  return {
    timeMs: wallMs - (offsetMinutes ?? 0) * 60_000 + (fractionMs ?? 0),
    hasSubSeconds: (fractionMs ?? 0) !== 0,
    offsetApplied: offsetMinutes !== null,
  };
}
