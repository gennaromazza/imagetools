import { spawn } from "node:child_process";

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  exitCode: number | null;
}

export function runCommand(command: string, args: string[], timeoutMs = 5000): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      resolve({ ok: false, stdout, stderr, timedOut: true, exitCode: null });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: error.message, timedOut: false, exitCode: null });
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: exitCode === 0,
        stdout,
        stderr,
        timedOut: false,
        exitCode,
      });
    });
  });
}

export function launchDetached(command: string, args: string[]): void {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
  });
  child.unref();
}

export async function getMappedUncPath(driveLetter: string): Promise<string | null> {
  const escapedDrive = driveLetter.replace(/'/g, "''");
  const script = [
    `$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${escapedDrive}'"`,
    "if ($null -eq $disk) { exit 2 }",
    "$disk.ProviderName",
  ].join("; ");
  const result = await runCommand("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], 5000);
  if (!result.ok) {
    return null;
  }
  const value = result.stdout.trim();
  return value.startsWith("\\\\") ? value : null;
}

export async function getMappedNetworkDrives(): Promise<Array<{ driveLetter: string; uncPath: string }>> {
  const script = [
    "$items = Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 4 } | Select-Object DeviceID,ProviderName",
    "$items | ConvertTo-Json -Compress",
  ].join("; ");
  const result = await runCommand("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], 5000);
  if (!result.ok || !result.stdout.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(result.stdout.trim()) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .map((row) => {
        const record = row as { DeviceID?: unknown; ProviderName?: unknown };
        const driveLetter = typeof record.DeviceID === "string" ? record.DeviceID : "";
        const uncPath = typeof record.ProviderName === "string" ? record.ProviderName : "";
        return { driveLetter, uncPath };
      })
      .filter((row) => row.driveLetter && row.uncPath.startsWith("\\\\"));
  } catch {
    return [];
  }
}

export function getLocalComputerName(): string {
  return (process.env.COMPUTERNAME || process.env.HOSTNAME || "").trim();
}

export async function getLocalSmbShares(): Promise<Array<{
  name: string;
  path: string;
  description: string;
}>> {
  const script = [
    "$shares = Get-SmbShare | Where-Object { -not $_.Special -and $_.Name -notmatch '\\$$' } | Select-Object Name,Path,Description",
    "$shares | ConvertTo-Json -Compress",
  ].join("; ");
  const result = await runCommand("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], 5000);
  if (!result.ok || !result.stdout.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(result.stdout.trim()) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .map((row) => {
        const record = row as { Name?: unknown; Path?: unknown; Description?: unknown };
        return {
          name: typeof record.Name === "string" ? record.Name : "",
          path: typeof record.Path === "string" ? record.Path : "",
          description: typeof record.Description === "string" ? record.Description : "",
        };
      })
      .filter((row) => row.name && row.path);
  } catch {
    return [];
  }
}

export async function pingHost(host: string): Promise<CommandResult> {
  return await runCommand("ping.exe", ["-n", "1", "-w", "1500", host], 3000);
}

export async function refreshDriveMapping(driveLetter: string): Promise<CommandResult> {
  return await runCommand("net.exe", ["use", driveLetter], 5000);
}

export async function deleteDriveMapping(driveLetter: string): Promise<CommandResult> {
  return await runCommand("net.exe", ["use", driveLetter, "/delete", "/y"], 5000);
}

export async function mapDrive(driveLetter: string, uncPath: string): Promise<CommandResult> {
  return await runCommand("net.exe", ["use", driveLetter, uncPath, "/persistent:yes"], 8000);
}

export function extractUncHost(uncPath: string): string | null {
  const match = uncPath.match(/^\\\\([^\\]+)\\[^\\]+/);
  return match?.[1] ?? null;
}
