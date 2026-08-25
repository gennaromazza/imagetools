import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { shell } from "electron";
import type { DesktopToolId } from "@photo-tools/desktop-contracts";
import {
  desktopToolManifest,
  getSuiteManagedTools,
  type DesktopToolDescriptor,
} from "./tool-manifest.js";

const TOOL_COOPERATIVE_SHUTDOWN_TIMEOUT_MS = 9_000;
const TOOL_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 3_000;
const TOOL_FORCE_SHUTDOWN_TIMEOUT_MS = 3_000;
const TOOL_SHUTDOWN_POLL_INTERVAL_MS = 250;
const TOOL_POST_SHUTDOWN_SETTLE_MS = 2_500;
const UPDATE_SHUTDOWN_ARGUMENT = "--filex-update-shutdown";

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

/** Restituisce solo gli eseguibili FileX effettivamente in esecuzione. */
function listRunningExecutablePaths(processNames: readonly string[]): string[] {
  if (process.platform !== "win32" || processNames.length === 0) return [];

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
    const output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
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

/**
 * Le versioni correnti riconoscono questo argomento nel rispettivo handler
 * single-instance e invocano app.quit(), rilasciando prima le risorse native.
 */
function requestCooperativeShutdown(processNames: readonly string[]): void {
  for (const executablePath of listRunningExecutablePaths(processNames)) {
    execFile(executablePath, [UPDATE_SHUTDOWN_ARGUMENT], { windowsHide: true }, () => undefined);
  }
}

async function stopFileXTool(toolId: DesktopToolId): Promise<void> {
  const processNames = executableNamesForTool(toolId);
  if (!isAnyProcessRunning(processNames)) {
    return;
  }

  requestCooperativeShutdown(processNames);
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
