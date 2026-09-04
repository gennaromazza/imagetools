import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { ExifTool } from "exiftool-vendored";
import type { DesktopCaptureTimeReading } from "@photo-tools/desktop-contracts";
import { parseExifDateTime } from "./capture-time-parser.js";

const CAPTURE_TIME_CONCURRENCY = 4;

let captureTimeExifTool: ExifTool | null = null;

function getCaptureTimeExifTool(): ExifTool {
  if (!captureTimeExifTool) {
    captureTimeExifTool = new ExifTool({
      maxProcs: 2,
      spawnTimeoutMillis: 60_000,
      taskTimeoutMillis: 120_000,
    });
  }
  return captureTimeExifTool;
}

export async function shutdownCaptureTimeService(): Promise<void> {
  const tool = captureTimeExifTool;
  captureTimeExifTool = null;
  await tool?.end().catch(() => undefined);
}

function toDisplayString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function resolveReading(absolutePath: string, tags: Record<string, unknown>): DesktopCaptureTimeReading {
  const original = parseExifDateTime(
    tags["DateTimeOriginal"],
    tags["SubSecTimeOriginal"],
    tags["OffsetTimeOriginal"],
  );
  const created = original ?? parseExifDateTime(
    tags["CreateDate"],
    tags["SubSecTimeCreateDate"],
    tags["OffsetTimeCreateDate"],
  );
  const resolved = original ?? created;
  return {
    absolutePath,
    captureTimeMs: resolved?.timeMs ?? null,
    cameraModel: toDisplayString(tags["Model"]),
    hasExifDate: tags["DateTimeOriginal"] !== null && tags["DateTimeOriginal"] !== undefined,
  };
}

/**
 * Legge le date di scatto EXIF con un processo ExifTool persistente.
 * Letture singole in concorrenza limitata (l'API batch è stata rimossa
 * nelle versioni recenti di exiftool-vendored). Non lancia mai: i file
 * illeggibili tornano con captureTimeMs null.
 */
export async function readCaptureTimesDesktop(
  absolutePaths: string[],
): Promise<DesktopCaptureTimeReading[]> {
  const unique = [...new Set(
    absolutePaths.filter((candidate) => (
      typeof candidate === "string"
      && candidate.trim().length > 0
      && isAbsolute(candidate)
      && existsSync(candidate)
    )),
  )];
  const results = new Array<DesktopCaptureTimeReading>(unique.length);
  const tool = getCaptureTimeExifTool();
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < unique.length) {
      const index = cursor;
      cursor += 1;
      const absolutePath = unique[index]!;
      try {
        const tags = (await tool.read(absolutePath)) as Record<string, unknown>;
        results[index] = resolveReading(absolutePath, tags ?? {});
      } catch {
        results[index] = { absolutePath, captureTimeMs: null, cameraModel: null, hasExifDate: false };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(CAPTURE_TIME_CONCURRENCY, unique.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
