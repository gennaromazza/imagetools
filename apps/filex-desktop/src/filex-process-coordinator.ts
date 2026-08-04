import * as electron from "electron";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DesktopToolId } from "@photo-tools/desktop-contracts";
import { desktopToolManifest, type DesktopToolDescriptor } from "./tool-manifest.js";

const { app } = electron;
const RESTART_PLAN_MAX_AGE_MS = 30 * 60 * 1000;

interface FileXRestartPlan {
  createdAt: number;
  toolIds: DesktopToolId[];
}

function normalizeProcessName(value: string): string {
  return value.trim().toLowerCase().replace(/\.exe$/i, "");
}

function executableNamesForTool(toolId: DesktopToolId): string[] {
  const descriptor: DesktopToolDescriptor = desktopToolManifest[toolId];
  return Array.from(new Set([
    descriptor.executableName,
    ...(descriptor.legacyExecutableNames ?? []),
  ].map(normalizeProcessName).filter(Boolean)));
}

function listRunningProcessNames(): Set<string> {
  if (process.platform !== "win32") return new Set();
  try {
    const output = execFileSync("tasklist.exe", ["/FO", "CSV", "/NH"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const names = new Set<string>();
    for (const line of output.split(/\r?\n/)) {
      const match = line.match(/^"((?:[^"]|"")+)"/);
      if (!match?.[1]) continue;
      names.add(normalizeProcessName(match[1].replace(/""/g, '"')));
    }
    return names;
  } catch {
    return new Set();
  }
}

function getRunningToolIds(): DesktopToolId[] {
  const runningNames = listRunningProcessNames();
  return (Object.keys(desktopToolManifest) as DesktopToolId[]).filter((toolId) =>
    executableNamesForTool(toolId).some((name) => runningNames.has(name)),
  );
}

function restartPlanPath(): string {
  const updateDirectory = join(app.getPath("userData"), "updates");
  mkdirSync(updateDirectory, { recursive: true });
  return join(updateDirectory, "filex-restart-plan.json");
}

export function saveFileXRestartPlan(): FileXRestartPlan {
  const plan: FileXRestartPlan = {
    createdAt: Date.now(),
    toolIds: getRunningToolIds().filter((toolId) => toolId !== "suite-launcher"),
  };
  writeFileSync(restartPlanPath(), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return plan;
}

export function consumeFileXRestartPlan(): DesktopToolId[] {
  const filePath = restartPlanPath();
  if (!existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as Partial<FileXRestartPlan>;
    const isFresh = typeof raw.createdAt === "number" && Date.now() - raw.createdAt <= RESTART_PLAN_MAX_AGE_MS;
    const toolIds = Array.isArray(raw.toolIds)
      ? raw.toolIds.filter((toolId): toolId is DesktopToolId =>
          typeof toolId === "string" && toolId in desktopToolManifest && toolId !== "suite-launcher",
        )
      : [];
    return isFresh ? Array.from(new Set(toolIds)) : [];
  } catch {
    return [];
  } finally {
    try {
      unlinkSync(filePath);
    } catch {
      // Il piano può essere già stato consumato da un'altra istanza della Suite.
    }
  }
}

export function terminateFileXToolsExceptSuite(): void {
  if (process.platform !== "win32") return;
  const toolIds = (Object.keys(desktopToolManifest) as DesktopToolId[])
    .filter((toolId) => toolId !== "suite-launcher");
  const processNames = new Set(toolIds.flatMap(executableNamesForTool));
  for (const processName of processNames) {
    try {
      execFileSync("taskkill.exe", ["/IM", `${processName}.exe`, "/T"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      // taskkill restituisce un errore anche quando il processo non è in esecuzione.
    }
  }
  for (const processName of processNames) {
    try {
      execFileSync("taskkill.exe", ["/IM", `${processName}.exe`, "/F", "/T"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      // Il processo si è già chiuso correttamente.
    }
  }
}

function writeToolUpdateOrchestrator(): string {
  const scriptPath = join(app.getPath("userData"), "updates", "run-filex-tool-update.ps1");
  const script = `param(
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [Parameter(Mandatory = $true)][string]$SuitePath
)
$ErrorActionPreference = 'Stop'
$installerExitCode = 1
try {
  $installer = Start-Process -FilePath $InstallerPath -PassThru -Wait
  if ($null -eq $installer.ExitCode) { $installerExitCode = 0 } else { $installerExitCode = $installer.ExitCode }
} finally {
  if (Test-Path -LiteralPath $SuitePath -PathType Leaf) {
    Start-Process -FilePath $SuitePath
  }
}
exit $installerExitCode
`;
  writeFileSync(scriptPath, script, "utf8");
  return scriptPath;
}

export async function launchToolUpdateAndRestartSuite(installerPath: string): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("Il riavvio coordinato degli aggiornamenti è supportato su Windows.");
  }
  saveFileXRestartPlan();
  const scriptPath = writeToolUpdateOrchestrator();
  await new Promise<void>((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-File", scriptPath,
      "-InstallerPath", installerPath,
      "-SuitePath", process.execPath,
    ], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
