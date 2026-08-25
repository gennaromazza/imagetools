import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { promisify } from "node:util";
import type { DesktopToolId } from "@photo-tools/desktop-contracts";
import {
  desktopToolManifest,
  getSuiteManagedTools,
  type DesktopToolDescriptor,
} from "./tool-manifest.js";
import { ProcessSnapshotCache } from "./process-snapshot-cache.js";
import { InstallerLaunchError, runWindowsInstaller } from "./windows-installer-runner.js";
import { sendBoundedProcessSignal } from "./cooperative-process-signal.js";

const TOOL_COOPERATIVE_SHUTDOWN_TIMEOUT_MS = 9_000;
const TOOL_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 3_000;
const TOOL_FORCE_SHUTDOWN_TIMEOUT_MS = 3_000;
const TOOL_SHUTDOWN_POLL_INTERVAL_MS = 250;
const TOOL_POST_SHUTDOWN_SETTLE_MS = 2_500;
const UPDATE_SHUTDOWN_ARGUMENT = "--filex-update-shutdown";
const SAFE_PROCESS_NAME = /^[a-z0-9_.-]+$/i;
const execFileAsync = promisify(execFile);

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
        .filter((name) => {
          const valid = SAFE_PROCESS_NAME.test(name);
          if (!valid) {
            console.warn(`Nome processo non valido ignorato per ${toolId}: "${name}"`);
          }
          return valid;
        }),
    ),
  );
}

async function listRunningProcessNames(): Promise<Set<string>> {
  if (process.platform !== "win32") {
    return new Set();
  }

  try {
    const { stdout } = await execFileAsync(
      "tasklist.exe",
      ["/FO", "CSV", "/NH"],
      {
        windowsHide: true,
      },
    );

    const names = new Set<string>();
    for (const line of stdout.split(/\r?\n/)) {
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

/** Condivide uno snapshot del tasklist tra tutti i tool chiusi in parallelo. */
const processSnapshotCache = new ProcessSnapshotCache(TOOL_SHUTDOWN_POLL_INTERVAL_MS);

async function isAnyProcessRunning(processNames: readonly string[]): Promise<boolean> {
  const runningNames = await processSnapshotCache.get(listRunningProcessNames);
  return processNames.some((name) => runningNames.has(name));
}

/** Restituisce solo gli eseguibili FileX effettivamente in esecuzione. */
async function listRunningExecutablePaths(processNames: readonly string[]): Promise<string[]> {
  if (process.platform !== "win32" || processNames.length === 0) return [];
  if (processNames.some((name) => !SAFE_PROCESS_NAME.test(name))) return [];

  const quotedNames = processNames
    .map((name) => `'${name.replace(/'/g, "''")}'`)
    .join(", ");
  const command = [
    `$names = @(${quotedNames})`,
    "Get-Process -Name $names -ErrorAction SilentlyContinue",
    "| Select-Object -ExpandProperty Path",
    "| ConvertTo-Json -Compress",
  ].join(" ");

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { windowsHide: true },
    );
    const output = stdout.trim();
    if (!output) return [];
    const parsed: unknown = JSON.parse(output);
    const paths = Array.isArray(parsed) ? parsed : [parsed];
    return Array.from(new Set(
      paths
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .filter((executablePath) => processNames.includes(normalizeProcessName(basename(executablePath)))),
    ));
  } catch {
    // PowerShell puo' essere disabilitato da policy aziendali: taskkill resta
    // il fallback per le installazioni precedenti.
    return [];
  }
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
    if (!(await isAnyProcessRunning(processNames))) {
      return true;
    }
    await delay(TOOL_SHUTDOWN_POLL_INTERVAL_MS);
  }
  return !(await isAnyProcessRunning(processNames));
}

async function terminateProcess(processName: string, force: boolean): Promise<void> {
  const args = ["/IM", `${processName}.exe`, "/T"];
  if (force) {
    args.push("/F");
  }

  try {
    await execFileAsync("taskkill.exe", args, { windowsHide: true });
  } catch (error) {
    console.warn(
      `taskkill non riuscito per ${processName} (${force ? "forzato" : "ordinato"}):`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Le versioni correnti riconoscono questo argomento nel rispettivo handler
 * single-instance e invocano app.quit(), rilasciando prima le risorse native.
 */
async function requestCooperativeShutdown(processNames: readonly string[]): Promise<void> {
  const executablePaths = await listRunningExecutablePaths(processNames);
  await Promise.all(executablePaths.map(async (executablePath) => {
    try {
      await sendBoundedProcessSignal(executablePath, [UPDATE_SHUTDOWN_ARGUMENT]);
    } catch (error) {
      console.warn(
        `Chiusura cooperativa non riuscita per ${executablePath}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }));
}

async function stopFileXTool(toolId: DesktopToolId): Promise<void> {
  const processNames = executableNamesForTool(toolId);
  if (!(await isAnyProcessRunning(processNames))) {
    return;
  }

  await requestCooperativeShutdown(processNames);
  if (await waitUntilProcessesExit(processNames, TOOL_COOPERATIVE_SHUTDOWN_TIMEOUT_MS)) {
    return;
  }

  // Compatibilita' con le versioni che non conoscono ancora il comando
  // cooperativo. Sono terminati solo il tool selezionato e i suoi nomi legacy,
  // mai FileX Suite o altri prodotti FileX.
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
  await runWindowsInstaller(installerPath);
}

async function openInstallerWithRetry(installerPath: string): Promise<void> {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await openInstallerWithWindows(installerPath);
      return;
    } catch (error) {
      if (!(error instanceof InstallerLaunchError) || attempt === attempts) throw error;
      console.warn(`Apertura installer fallita (tentativo ${attempt}/${attempts}); nuovo tentativo.`);
      await delay(1_500);
    }
  }
}

export async function isFileXToolRunning(toolId: DesktopToolId): Promise<boolean> {
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

  // L'installer NSIS viene eseguito con /S e atteso fino all'exit code: non
  // consideriamo piu' riuscito un semplice inoltro a ShellExecute.
  await openInstallerWithRetry(installerPath);
}

/** Chiude soltanto il tool scelto dall'utente, inclusi i suoi processi figli. */
export async function forceCloseFileXTool(toolId: DesktopToolId): Promise<void> {
  if (process.platform !== "win32" || toolId === "suite-launcher") return;
  const processNames = executableNamesForTool(toolId);
  const runningNames = await listRunningProcessNames();
  await Promise.all(
    processNames
      .filter((name) => runningNames.has(name))
      .map((name) => terminateProcess(name, true)),
  );
  if (!(await waitUntilProcessesExit(processNames, TOOL_FORCE_SHUTDOWN_TIMEOUT_MS))) {
    throw new Error(`Non è stato possibile chiudere ${desktopToolManifest[toolId].displayName}.`);
  }
}

/** Tenta la chiusura ordinata dei tool prima dell'aggiornamento della Suite. */
export async function prepareFileXSuiteUpdate(): Promise<DesktopToolId[]> {
  const stillOpen = await Promise.all(
    getSuiteManagedTools().map(async (tool) => {
      try {
        await stopFileXTool(tool.id);
        return null;
      } catch {
        return tool.id;
      }
    }),
  );
  return stillOpen.filter((toolId): toolId is DesktopToolId => toolId !== null);
}
