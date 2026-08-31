import { createHash } from "node:crypto";
import { createReadStream, type Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import type { DesktopFileFingerprint } from "@photo-tools/desktop-contracts";

export interface FingerprintFilesDesktopOptions {
  timeoutMs?: number;
  statFile?: (absolutePath: string) => Promise<Stats>;
}

const DEFAULT_BATCH_TIMEOUT_MS = 10_000;

function batchTimeoutError(): Error & { code: string } {
  return Object.assign(new Error("Tempo massimo superato durante la verifica dei file esportati."), {
    code: "ETIMEDOUT",
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error ? signal.reason : batchTimeoutError();
}

function awaitWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolveValue, rejectValue) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => rejectValue(abortReason(signal)));
    signal.addEventListener("abort", onAbort, { once: true });
    void operation.then(
      (value) => finish(() => resolveValue(value)),
      (error) => finish(() => rejectValue(error)),
    );
  });
}

async function sha256File(absolutePath: string, signal: AbortSignal): Promise<string> {
  if (signal.aborted) throw abortReason(signal);
  const hash = createHash("sha256");
  const stream = createReadStream(absolutePath);
  const cancelRead = () => stream.destroy(abortReason(signal) as Error);
  signal.addEventListener("abort", cancelRead, { once: true });
  try {
    for await (const chunk of stream) {
      hash.update(chunk);
    }
    if (signal.aborted) throw abortReason(signal);
    return hash.digest("hex");
  } catch (error) {
    if (signal.aborted) throw abortReason(signal);
    throw error;
  } finally {
    signal.removeEventListener("abort", cancelRead);
    stream.destroy();
  }
}

export async function fingerprintFilesDesktop(
  absolutePathsInput: string[],
  options: FingerprintFilesDesktopOptions = {},
): Promise<DesktopFileFingerprint[]> {
  if (!Array.isArray(absolutePathsInput) || absolutePathsInput.length === 0 || absolutePathsInput.length > 500) {
    throw new Error("La verifica richiede da 1 a 500 file.");
  }

  const absolutePaths = Array.from(new Map(absolutePathsInput.map((pathInput) => {
    if (typeof pathInput !== "string" || pathInput.length === 0 || pathInput.length > 32_000 || !isAbsolute(pathInput)) {
      throw new Error("Percorso di verifica non valido.");
    }
    const absolutePath = resolve(pathInput);
    return [process.platform === "win32" ? absolutePath.toLocaleLowerCase("en-US") : absolutePath, absolutePath];
  })).values());

  const timeoutMs = options.timeoutMs ?? DEFAULT_BATCH_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Timeout di verifica non valido.");
  }
  const statFile = options.statFile ?? ((absolutePath: string) => stat(absolutePath));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(batchTimeoutError()), timeoutMs);
  const fingerprints: DesktopFileFingerprint[] = [];
  try {
    for (const absolutePath of absolutePaths) {
      try {
        const before = await awaitWithAbort(Promise.resolve().then(() => statFile(absolutePath)), controller.signal);
        if (!before.isFile()) continue;
        const sha256 = await sha256File(absolutePath, controller.signal);
        const after = await awaitWithAbort(Promise.resolve().then(() => statFile(absolutePath)), controller.signal);
        if (
          before.size !== after.size
          || before.mtimeMs !== after.mtimeMs
          || before.ctimeMs !== after.ctimeMs
          || before.dev !== after.dev
          || before.ino !== after.ino
        ) {
          throw new Error(`Il file è cambiato durante la verifica: ${basename(absolutePath)}.`);
        }
        fingerprints.push({
          name: basename(absolutePath),
          absolutePath,
          size: after.size,
          lastModified: after.mtimeMs,
          sha256,
        });
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
          continue;
        }
        throw error;
      }
    }
    return fingerprints;
  } finally {
    clearTimeout(timeout);
  }
}
