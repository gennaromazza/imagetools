import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { shell } from "electron";
import type { DesktopToolId } from "@photo-tools/desktop-contracts";
import {
  desktopToolManifest,
  type DesktopToolDescriptor,
} from "./tool-manifest.js";

const TOOL_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 12_000;
const TOOL_FORCE_SHUTDOWN_TIMEOUT_MS = 3_000;
const TOOL_SHUTDOWN_POLL_INTERVAL_MS = 250;
const TOOL_POST_SHUTDOWN_SETTLE_MS = 2_500;

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
  throw new Error(
    `${desktopToolManifest[toolId].displayName} non si è chiuso in tempo. ` +
      "Premi ‘Forza chiusura’ per chiuderlo qui e continuare l’aggiornamento.",
  );
}

async function openInstallerWithWindows(installerPath: string): Promise<void> {
  const errorMessage = await shell.openPath(installerPath);
  if (errorMessage) {
    throw new Error(`Windows non ha potuto aprire l'installer FileX: ${errorMessage}`);
  }
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

  await stopFileXTool(toolId);
  // Electron puo' aver chiuso il processo principale mentre ExifTool o altri
  // helper nativi stanno ancora rilasciando handle dentro la cartella app.
  await delay(TOOL_POST_SHUTDOWN_SETTLE_MS);

  // ShellExecute mostra SmartScreen/UAC e permette all'utente di scegliere
  // "Esegui comunque" anche quando l'installer non e' firmato.
  await openInstallerWithWindows(installerPath);
}

/** Chiude soltanto il tool scelto dall'utente, inclusi i suoi processi figli. */
export async function forceCloseFileXTool(toolId: DesktopToolId): Promise<void> {
  if (process.platform !== "win32" || toolId === "suite-launcher") return;
  const processNames = executableNamesForTool(toolId);
  const runningNames = listRunningProcessNames();
  await Promise.all(
    processNames
      .filter((name) => runningNames.has(name))
      .map((name) => terminateProcess(name, true)),
  );
  if (!(await waitUntilProcessesExit(processNames, TOOL_FORCE_SHUTDOWN_TIMEOUT_MS))) {
    throw new Error(`Non è stato possibile chiudere ${desktopToolManifest[toolId].displayName}.`);
  }
}
