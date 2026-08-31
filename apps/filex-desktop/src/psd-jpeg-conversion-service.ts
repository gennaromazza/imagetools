import { open, lstat, mkdir, unlink, type FileHandle } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type {
  DesktopPsdJpegConversionProgress,
  DesktopPsdJpegConversionRequest,
} from "@photo-tools/desktop-contracts";
import { isPsdPath, renderPsdCompositeToJpeg } from "./psd-image-service.js";

const OUTPUT_FOLDER_NAME = "JPEG da PSD";
const PRINT_JPEG_QUALITY = 100;
const IDLE_PROGRESS: DesktopPsdJpegConversionProgress = {
  jobId: null,
  status: "idle",
  total: 0,
  completed: 0,
  generated: 0,
  skipped: 0,
  errors: 0,
  currentFile: null,
  outputDirectories: [],
  startedAt: null,
  finishedAt: null,
  error: null,
  results: [],
};

let progress: DesktopPsdJpegConversionProgress = { ...IDLE_PROGRESS, results: [] };
let cancelRequested = false;

async function reserveOutputPath(sourcePath: string): Promise<{ outputPath: string; handle: FileHandle }> {
  const outputDirectory = join(dirname(sourcePath), OUTPUT_FOLDER_NAME);
  await mkdir(outputDirectory, { recursive: true });
  const stem = basename(sourcePath, extname(sourcePath));

  for (let index = 0; index < 10_000; index += 1) {
    const suffix = index === 0 ? "" : ` (${index + 1})`;
    const candidate = join(outputDirectory, `${stem}${suffix}.jpg`);
    try {
      const reservation = await open(candidate, "wx");
      return { outputPath: candidate, handle: reservation };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }

  throw new Error("Non è stato possibile riservare un nome JPEG libero.");
}

function resetProgress(total: number): string {
  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  progress = {
    jobId,
    status: "running",
    total,
    completed: 0,
    generated: 0,
    skipped: 0,
    errors: 0,
    currentFile: null,
    outputDirectories: [],
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
    results: [],
  };
  cancelRequested = false;
  return jobId;
}

async function runConversion(
  jobId: string,
  inputPaths: string[],
): Promise<void> {
  const outputDirectories = new Set<string>();
  for (const sourcePath of inputPaths) {
    if (cancelRequested || progress.jobId !== jobId) {
      break;
    }

    progress = { ...progress, currentFile: basename(sourcePath) };
    try {
      const stats = await lstat(sourcePath);
      if (!stats.isFile() || !isPsdPath(sourcePath)) {
        progress = {
          ...progress,
          completed: progress.completed + 1,
          skipped: progress.skipped + 1,
          results: [...progress.results, { sourcePath, status: "skipped", error: "File PSD non disponibile." }],
        };
        continue;
      }

      const rendered = await renderPsdCompositeToJpeg(sourcePath, { quality: PRINT_JPEG_QUALITY });
      if (!rendered) {
        throw new Error("Il composito PSD non è disponibile.");
      }

      const reservation = await reserveOutputPath(sourcePath);
      let writeError: unknown;
      try {
        await reservation.handle.writeFile(rendered.bytes);
      } catch (error) {
        writeError = error;
      } finally {
        await reservation.handle.close().catch(() => undefined);
      }
      if (writeError) {
        await unlink(reservation.outputPath).catch(() => undefined);
        throw writeError;
      }
      outputDirectories.add(dirname(reservation.outputPath));
      progress = {
        ...progress,
        completed: progress.completed + 1,
        generated: progress.generated + 1,
        outputDirectories: Array.from(outputDirectories).sort((a, b) => a.localeCompare(b)),
        results: [...progress.results, { sourcePath, outputPath: reservation.outputPath, status: "generated" }],
      };
    } catch (error) {
      progress = {
        ...progress,
        completed: progress.completed + 1,
        errors: progress.errors + 1,
        results: [...progress.results, {
          sourcePath,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  }

  const cancelled = cancelRequested || progress.jobId !== jobId;
  progress = {
    ...progress,
    status: cancelled ? "cancelled" : "completed",
    currentFile: null,
    finishedAt: Date.now(),
    error: null,
  };
}

export function getPsdJpegConversionProgressDesktop(): DesktopPsdJpegConversionProgress {
  return progress;
}

export function cancelPsdJpegConversionDesktop(): void {
  cancelRequested = true;
}

export function startPsdJpegConversionDesktop(
  request: DesktopPsdJpegConversionRequest,
): DesktopPsdJpegConversionProgress {
  if (progress.status === "running") {
    return {
      ...progress,
      error: "Una conversione PSD è già in corso.",
    };
  }

  const inputPaths = Array.from(new Set((request.inputPaths ?? []).filter(isPsdPath)));
  if (inputPaths.length === 0) {
    progress = {
      ...IDLE_PROGRESS,
      status: "error",
      error: "Seleziona almeno un file PSD.",
      finishedAt: Date.now(),
      results: [],
    };
    return progress;
  }

  const jobId = resetProgress(inputPaths.length);
  void runConversion(jobId, inputPaths);
  return progress;
}
