import { spawn, execFile } from "node:child_process";
import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";
import { promisify } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
export const PKG_DIR = join(here, "..");
export const ROOT = join(PKG_DIR, "..", "..");
const RUNTIME_DIR = join(PKG_DIR, ".runtime");
const LOG_DIR = join(RUNTIME_DIR, "logs");
const REGISTRY_FILE = join(RUNTIME_DIR, "processes.json");

const execFileP = promisify(execFile);

export interface ProcessCommand {
  file: string;
  args: string[];
}

function quoteForCmd(value: string): string {
  return /[\s"]/u.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

interface ManagedProcess {
  id: string;
  title: string;
  pid: number;
  startedAt: string;
}

export interface PortProcessInfo {
  pid: number;
  killPid: number;
  recognized: boolean;
  name: string;
  commandLine: string;
}

export async function ensureDir() {
  await mkdir(LOG_DIR, { recursive: true });
}

async function readRegistry(): Promise<Record<string, ManagedProcess>> {
  try {
    return JSON.parse(await readFile(REGISTRY_FILE, "utf8")) as Record<string, ManagedProcess>;
  } catch {
    return {};
  }
}

async function writeRegistry(registry: Record<string, ManagedProcess>): Promise<void> {
  await mkdir(RUNTIME_DIR, { recursive: true });
  const tempFile = `${REGISTRY_FILE}.tmp`;
  await writeFile(tempFile, JSON.stringify(registry, null, 2), "utf8");
  await rename(tempFile, REGISTRY_FILE);
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function currentRecord(id: string): Promise<ManagedProcess | null> {
  const registry = await readRegistry();
  const record = registry[id];
  if (!record) return null;
  if (isPidRunning(record.pid)) return record;

  delete registry[id];
  await writeRegistry(registry);
  return null;
}

export async function readLog(id: string, maxBytes = 64_000): Promise<string> {
  try {
    const file = join(LOG_DIR, `${id}.log`);
    const { open } = await import("node:fs/promises");
    const fileStat = await stat(file);
    const start = Math.max(0, fileStat.size - maxBytes);
    const handle = await open(file, "r");
    try {
      const buffer = Buffer.alloc(fileStat.size - start);
      await handle.read(buffer, 0, buffer.length, start);
      return buffer.toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

export async function isPortOpen(port: number, timeoutMs = 1_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1", timeout: timeoutMs });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
  });
}

export async function getPortProcess(port: number): Promise<PortProcessInfo | null> {
  if (process.platform !== "win32" || !Number.isInteger(port) || port < 1 || port > 65_535) {
    return null;
  }

  const script = [
    `$connection = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1`,
    "if ($null -eq $connection) { exit 0 }",
    "$owner = Get-CimInstance Win32_Process -Filter \"ProcessId=$($connection.OwningProcess)\" -ErrorAction SilentlyContinue",
    "if ($null -eq $owner) { exit 0 }",
    "$kill = $owner",
    "$cursor = $owner",
    "for ($i = 0; $i -lt 8; $i++) {",
    "  $parent = Get-CimInstance Win32_Process -Filter \"ProcessId=$($cursor.ParentProcessId)\" -ErrorAction SilentlyContinue",
    "  if ($null -eq $parent) { break }",
    "  if ($parent.Name -eq 'node.exe' -and $parent.CommandLine -match 'npm-cli\\.js') { $kill = $parent; break }",
    "  $cursor = $parent",
    "}",
    "$recognized = $owner.Name -eq 'node.exe' -and $owner.CommandLine -match 'vite[\\\\/]bin[\\\\/]vite\\.js'",
    "[pscustomobject]@{ pid = [int]$owner.ProcessId; killPid = [int]$kill.ProcessId; recognized = [bool]$recognized; name = [string]$owner.Name; commandLine = [string]$owner.CommandLine } | ConvertTo-Json -Compress",
  ].join("; ");

  try {
    const { stdout } = await execFileP("powershell", ["-NoProfile", "-Command", script], { timeout: 5_000 });
    const value = stdout.trim();
    return value ? JSON.parse(value) as PortProcessInfo : null;
  } catch {
    return null;
  }
}

export async function isRunning(id: string): Promise<boolean> {
  return (await currentRecord(id)) !== null;
}

export async function listRunning(tools: { id: string }[]): Promise<string[]> {
  const running = await Promise.all(tools.map(async ({ id }) => ((await isRunning(id)) ? id : null)));
  return running.filter((id): id is string => id !== null);
}

export async function startProcess(
  id: string,
  title: string,
  command: ProcessCommand,
  opts: { cwd: string },
): Promise<{ ok: boolean; pid?: number; error?: string }> {
  if (await currentRecord(id)) {
    return { ok: false, error: `Il processo "${title}" è già gestito dalla console.` };
  }

  await ensureDir();
  const logFile = join(LOG_DIR, `${id}.log`);
  await writeFile(logFile, `[${new Date().toISOString()}] Avvio: ${command.file} ${command.args.join(" ")}\n`, "utf8");

  return new Promise((resolve) => {
    const runsThroughCmd = process.platform === "win32" && /\.(cmd|bat)$/iu.test(command.file);
    const executable = runsThroughCmd ? (process.env.ComSpec ?? "cmd.exe") : command.file;
    const args = runsThroughCmd
      ? ["/d", "/s", "/c", [quoteForCmd(command.file), ...command.args.map(quoteForCmd)].join(" ")]
      : command.args;

    const child = spawn(executable, args, {
      cwd: opts.cwd,
      // La console è proprietaria dei processi di sviluppo: mantenerli collegati
      // consente di catturare stdout/stderr e di interrompere l'intero albero.
      detached: false,
      // Su Windows npm è un file .cmd: lo eseguiamo tramite cmd.exe, ma senza
      // shell implicita. Gli argomenti arrivano solo dall'allowlist del server.
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let settled = false;
    const finish = (result: { ok: boolean; pid?: number; error?: string }) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    const append = (chunk: Buffer) => appendFile(logFile, chunk).catch(() => undefined);
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.once("error", (error) => finish({ ok: false, error: error.message }));
    child.once("spawn", async () => {
      const registry = await readRegistry();
      registry[id] = { id, title, pid: child.pid!, startedAt: new Date().toISOString() };
      await writeRegistry(registry);
      finish({ ok: true, pid: child.pid });
    });
    child.once("exit", async (code, signal) => {
      await appendFile(logFile, `\n[${new Date().toISOString()}] Processo terminato (codice ${code ?? "n/d"}, segnale ${signal ?? "n/d"}).\n`).catch(() => undefined);
      const registry = await readRegistry();
      if (registry[id]?.pid === child.pid) {
        delete registry[id];
        await writeRegistry(registry);
      }
    });
  });
}

export async function stopProcess(id: string): Promise<{ ok: boolean; error?: string }> {
  const record = await currentRecord(id);
  if (!record) return { ok: false, error: `Nessun processo gestito trovato per "${id}".` };

  try {
    if (process.platform === "win32") {
      await execFileP("taskkill", ["/pid", String(record.pid), "/t", "/f"], { timeout: 15_000 });
    } else {
      process.kill(-record.pid, "SIGTERM");
    }
  } catch (error) {
    return { ok: false, error: `Impossibile fermare "${record.title}": ${String(error)}` };
  }

  const registry = await readRegistry();
  delete registry[id];
  await writeRegistry(registry);
  return { ok: true };
}

export async function stopPortProcess(port: number): Promise<{ ok: boolean; error?: string }> {
  const info = await getPortProcess(port);
  if (!info) return { ok: false, error: `Nessun processo in ascolto sulla porta ${port}.` };
  if (!info.recognized) {
    return { ok: false, error: `La porta ${port} non appartiene a un dev server Vite riconosciuto.` };
  }

  try {
    await execFileP("taskkill", ["/pid", String(info.killPid), "/t", "/f"], { timeout: 15_000 });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Impossibile fermare il processo sulla porta ${port}: ${String(error)}` };
  }
}

export async function stopAllProcesses(): Promise<{ ok: boolean; stopped: number; error?: string }> {
  const registry = await readRegistry();
  const ids = Object.keys(registry);
  const results = await Promise.all(ids.map((id) => stopProcess(id)));
  const stopped = results.filter((result) => result.ok).length;
  const failure = results.find((result) => !result.ok);
  return failure
    ? { ok: false, stopped, error: failure.error }
    : { ok: true, stopped };
}
