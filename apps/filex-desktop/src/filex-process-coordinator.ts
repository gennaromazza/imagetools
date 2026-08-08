import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { DesktopToolId } from "@photo-tools/desktop-contracts";
import {
  desktopToolManifest,
  type DesktopToolDescriptor,
} from "./tool-manifest.js";

const TOOL_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 12_000;
const TOOL_FORCE_SHUTDOWN_TIMEOUT_MS = 3_000;
const TOOL_SHUTDOWN_POLL_INTERVAL_MS = 250;
const TOOL_POST_SHUTDOWN_SETTLE_MS = 2_500;
const INSTALLER_TIMEOUT_MS = 5 * 60_000;
const INSTALLER_RETRY_DELAYS_MS = [0, 3_000, 7_000] as const;

class InstallerExitError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
  ) {
    super(message);
    this.name = "InstallerExitError";
  }
}

function normalizeProcessName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.exe$/i, "");
}

function executableNamesForTool(toolId: DesktopToolId): string[] {
  const descriptor: DesktopToolDescriptor = desktopToolManifest[toolId];

  return Array.from(
    new Set(
      [
        descriptor.executableName,
        ...(descriptor.legacyExecutableNames ?? []),
      ]
        .map(normalizeProcessName)
        .filter(Boolean),
    ),
  );
}

function listRunningProcessNames(): Set<string> {
  if (process.platform !== "win32") {
    return new Set();
  }

  try {
    const output = execFileSync(
      "tasklist.exe",
      ["/FO", "CSV", "/NH"],
      {
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );

    const names = new Set<string>();
    for (const line of output.split(/\r?\n/)) {
      const match = line.match(/^"((?:[^"]|"")+)"/);
      if (match?.[1]) {
        names.add(normalizeProcessName(match[1].replace(/""/g, '"')));
      }
    }
    return names;
  } catch {
    return new Set();
  }
}

function isAnyProcessRunning(processNames: readonly string[]): boolean {
  const runningNames = listRunningProcessNames();
  return processNames.some((name) => runningNames.has(name));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntilProcessesExit(
  processNames: readonly string[],
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAnyProcessRunning(processNames)) {
      return true;
    }
    await delay(TOOL_SHUTDOWN_POLL_INTERVAL_MS);
  }
  return !isAnyProcessRunning(processNames);
}

function terminateProcess(processName: string, force: boolean): Promise<void> {
  const args = ["/IM", `${processName}.exe`, "/T"];
  if (force) {
    args.push("/F");
  }

  return new Promise((resolve) => {
    execFile(
      "taskkill.exe",
      args,
      { windowsHide: true },
      () => resolve(),
    );
  });
}

async function stopFileXTool(toolId: DesktopToolId): Promise<void> {
  const processNames = executableNamesForTool(toolId);
  if (!isAnyProcessRunning(processNames)) {
    return;
  }

  await Promise.all(processNames.map((name) => terminateProcess(name, false)));
  if (await waitUntilProcessesExit(processNames, TOOL_GRACEFUL_SHUTDOWN_TIMEOUT_MS)) {
    return;
  }

  const stillRunning = listRunningProcessNames();
  await Promise.all(
    processNames
      .filter((name) => stillRunning.has(name))
      .map((name) => terminateProcess(name, true)),
  );

  if (!(await waitUntilProcessesExit(processNames, TOOL_FORCE_SHUTDOWN_TIMEOUT_MS))) {
    throw new Error(
      `Impossibile chiudere ${desktopToolManifest[toolId].displayName}. ` +
        "Chiudi il tool manualmente e riprova.",
    );
  }
}

function runInstaller(installerPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const installer = spawn(installerPath, ["/S"], {
      detached: false,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });

    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      installer.kill();
      finish(() => reject(new Error("Installer FileX bloccato oltre 5 minuti.")));
    }, INSTALLER_TIMEOUT_MS);

    installer.once("error", (error) => finish(() => reject(error)));
    installer.once("close", (code, signal) => {
      if (code === 0) {
        finish(resolve);
        return;
      }

      const detail = signal ? `segnale ${signal}` : `codice ${code ?? "sconosciuto"}`;
      finish(() => reject(
        new InstallerExitError(`Installer FileX terminato con ${detail}.`, code),
      ));
    });
  });
}

export function isFileXToolRunning(toolId: DesktopToolId): boolean {
  if (process.platform !== "win32" || toolId === "suite-launcher") {
    return false;
  }
  return isAnyProcessRunning(executableNamesForTool(toolId));
}

export async function installFileXToolUpdate(
  toolId: DesktopToolId,
  installerPath: string,
): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("Gli aggiornamenti automatici dei tool sono supportati su Windows.");
  }
  if (toolId === "suite-launcher") {
    throw new Error("FileX Suite usa il proprio sistema di aggiornamento dedicato.");
  }
  if (!installerPath.toLowerCase().endsWith(".exe") || !existsSync(installerPath)) {
    throw new Error("Installer FileX non valido o non disponibile.");
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt < INSTALLER_RETRY_DELAYS_MS.length; attempt += 1) {
    const retryDelay = INSTALLER_RETRY_DELAYS_MS[attempt];
    if (retryDelay > 0) {
      await delay(retryDelay);
    }

    await stopFileXTool(toolId);
    // Electron puo' aver chiuso il processo principale mentre ExifTool o altri
    // helper nativi stanno ancora rilasciando handle dentro la cartella app.
    await delay(TOOL_POST_SHUTDOWN_SETTLE_MS);

    try {
      await runInstaller(installerPath);
      return;
    } catch (error) {
      lastError = error;
      const canRetry = error instanceof InstallerExitError && error.exitCode === 2;
      if (!canRetry || attempt === INSTALLER_RETRY_DELAYS_MS.length - 1) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Installazione FileX non completata.");
}
