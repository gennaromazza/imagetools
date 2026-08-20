import express from "express";
import cors from "cors";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEV_TOOLS, SUITE_TOOL, type DevTool } from "./tools.js";
import { PKG_DIR, ROOT, getPortProcess, readLog, startProcess, stopProcess, stopAllProcesses, stopPortProcess, isPortOpen, isRunning, listRunning } from "./processes.js";

const execFileP = promisify(execFile);
const NODE = process.execPath;
const PORT = Number(process.env.FILEX_CONSOLE_PORT ?? 4390);
const HOST = "127.0.0.1";
const NPM_COMMAND = process.platform === "win32" ? "npm.cmd" : "npm";
const SUITE_RELEASE_ID = "release-suite";
const SUITE_RELEASE_BAT = join(ROOT, "release-filex-suite.bat");

function workspaceScript(workspace: string, script: string) {
  return { file: NPM_COMMAND, args: ["--workspace", workspace, "run", script] };
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/tools", async (_req, res) => {
  const runningList = await listRunning(DEV_TOOLS);
  res.json({
    tools: await Promise.all(
      DEV_TOOLS.map(async (tool) => {
        const running = runningList.includes(tool.id);
        const portOpen = await isPortOpen(tool.port);
        const portProcess = !running && portOpen ? await getPortProcess(tool.port) : null;
        const status = running
          ? portOpen ? "running" : "starting"
          : portOpen ? portProcess?.recognized ? "external" : "occupied" : "stopped";
        return {
          id: tool.id,
          displayName: tool.displayName,
          port: tool.port,
          kind: tool.kind,
          rendererUrl: tool.rendererUrl,
          workspace: tool.workspace,
          url: tool.rendererUrl,
          running,
          portOpen,
          status,
          canStart: !running && !portOpen,
          canStop: running || Boolean(portProcess?.recognized),
          processId: portProcess?.pid ?? null,
        };
      }),
    ),
  });
});

app.get("/api/tools/:id/log", async (req, res) => {
  const { id } = req.params;
  if (!DEV_TOOLS.some((t) => t.id === id) && id !== SUITE_TOOL.id) {
    res.status(404).json({ error: `Tool sconosciuto: ${id}` });
    return;
  }
  const log = await readLog(id);
  res.json({ id, log });
});

app.get("/api/logs/:id", async (req, res) => {
  const { id } = req.params;
  if (!/^[a-z0-9-]+$/.test(id)) {
    res.status(400).json({ error: "Identificativo log non valido." });
    return;
  }
  res.json({ id, log: await readLog(id) });
});

app.post("/api/tools/:id/start", async (req, res) => {
  const tool = DEV_TOOLS.find((t) => t.id === req.params.id);
  if (!tool) {
    res.status(404).json({ error: `Tool sconosciuto: ${req.params.id}` });
    return;
  }
  if (!await isRunning(tool.id) && await isPortOpen(tool.port)) {
    res.status(409).json({ ok: false, error: `La porta ${tool.port} è già occupata da un processo non gestito.` });
    return;
  }
  const result = await startProcess(tool.id, tool.displayName, workspaceScript(tool.workspace, tool.devScript), { cwd: ROOT });
  const url = tool.rendererUrl;
  res.json({ ok: result.ok, error: result.error, id: tool.id, url, kind: tool.kind });
});

app.post("/api/tools/:id/stop", async (req, res) => {
  const tool = DEV_TOOLS.find((t) => t.id === req.params.id);
  if (!tool) {
    res.status(404).json({ error: `Tool sconosciuto: ${req.params.id}` });
    return;
  }
  const result = await isRunning(tool.id)
    ? await stopProcess(tool.id)
    : await stopPortProcess(tool.port);
  res.json({ ok: result.ok, error: result.error });
});

app.post("/api/tools/:id/check", async (req, res) => {
  const tool = DEV_TOOLS.find((item) => item.id === req.params.id);
  if (!tool) {
    res.status(404).json({ error: `Tool sconosciuto: ${req.params.id}` });
    return;
  }

  const logId = `check-${tool.id}`;
  const result = await startProcess(
    logId,
    `Verifica ${tool.displayName}`,
    workspaceScript(tool.workspace, `build:${tool.id}`),
    { cwd: ROOT },
  );
  res.json({ ok: result.ok, error: result.error, id: logId, toolId: tool.id });
});

app.post("/api/tools/stop-all", async (_req, res) => {
  // Oltre ai processi registrati dalla console, includi i server Vite FileX
  // avviati da terminali esterni. Processi sconosciuti restano intatti.
  const externalPorts: number[] = [];
  for (const tool of DEV_TOOLS) {
    if (await isRunning(tool.id) || !await isPortOpen(tool.port)) continue;
    if ((await getPortProcess(tool.port))?.recognized) externalPorts.push(tool.port);
  }

  const managed = await stopAllProcesses();
  const externalResults = await Promise.all(externalPorts.map((port) => stopPortProcess(port)));
  const externalStopped = externalResults.filter((result) => result.ok).length;
  const failure = externalResults.find((result) => !result.ok);
  res.json({
    ok: managed.ok && !failure,
    stopped: managed.stopped + externalStopped,
    error: managed.error ?? failure?.error,
  });
});

app.post("/api/suite/start", async (_req, res) => {
  const result = await startProcess(
    SUITE_TOOL.id,
    SUITE_TOOL.displayName,
    workspaceScript(SUITE_TOOL.workspace, SUITE_TOOL.startScript),
    { cwd: ROOT },
  );
  res.json({ ok: result.ok, error: result.error, id: SUITE_TOOL.id });
});

app.post("/api/suite/stop", async (_req, res) => {
  const result = await stopProcess(SUITE_TOOL.id);
  res.json({ ok: result.ok, error: result.error });
});

app.post("/api/license/create", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const days = Number(req.body?.days ?? 30);
  if (!name) {
    res.status(400).json({ error: "Il nome è obbligatorio." });
    return;
  }
  if (!Number.isInteger(days) || days < 1 || days > 366) {
    res.status(400).json({ error: "I giorni devono essere un numero tra 1 e 366." });
    return;
  }
  const label = name.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+$/g, "").slice(0, 40) || "prova";
  try {
    const { stdout, stderr } = await execFileP(
      NODE,
      ["scripts/filex-license-admin.mjs", "create-support-license", String(days), label],
      { cwd: ROOT, timeout: 120_000 },
    );
    const match = stdout.match(/FILEX-[A-F0-9-]+/);
    if (!match) throw new Error(stderr || stdout);
    res.json({ ok: true, key: match[0], name, days });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: String((error as { message?: string })?.message ?? error),
      hint: "Verifica di essere autenticati con `firebase login`.",
    });
  }
});

app.get("/api/license/status", async (_req, res) => {
  try {
    const { stdout } = await execFileP(NODE, ["scripts/filex-license-admin.mjs", "status"], {
      cwd: ROOT,
      timeout: 60_000,
    });
    res.json({ ok: true, data: stdout.trim() });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: String((error as { message?: string })?.message ?? error),
      hint: "Verifica di essere autenticati con `firebase login`.",
    });
  }
});

app.get("/api/tests", async (_req, res) => {
  try {
    const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
    const tests = Object.entries(pkg.scripts ?? {})
      .filter(([name]) => name.startsWith("test:"))
      .map(([name, value]) => ({ name, command: value }));
    res.json({ ok: true, tests });
  } catch (error) {
    res.status(500).json({ ok: false, error: String((error as { message?: string })?.message ?? error) });
  }
});

app.post("/api/tests/run", async (req, res) => {
  const scripts = Array.isArray(req.body?.scripts) ? req.body.scripts.map(String) : [];
  if (scripts.length === 0) {
    res.status(400).json({ error: "Nessun test selezionato." });
    return;
  }
  if (scripts.length > 1) {
    res.status(400).json({ error: "Avvia un test alla volta per ottenere un log affidabile." });
    return;
  }
  try {
    const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
    if (!(scripts[0] in (pkg.scripts ?? {})) || !scripts[0].startsWith("test:")) {
      res.status(400).json({ error: "Test non consentito." });
      return;
    }
  } catch {
    res.status(500).json({ error: "Impossibile verificare i test disponibili." });
    return;
  }
  const id = `tests-${Date.now()}`;
  const result = await startProcess(id, "Test", { file: NPM_COMMAND, args: ["run", scripts[0]] }, { cwd: ROOT });
  res.json({ ok: result.ok, error: result.error, id });
});

app.get("/api/processes", async (_req, res) => {
  const running = await listRunning(DEV_TOOLS);
  res.json({ running });
});

app.get("/api/release/suite/status", async (_req, res) => {
  try {
    const pkg = JSON.parse(await readFile(join(ROOT, "apps", "filex-desktop", "package.json"), "utf8")) as { version?: string };
    const currentVersion = String(pkg.version ?? "0.0.0");
    const [major, minor, patch] = currentVersion.split(".").map(Number);
    const [{ stdout: branch }, { stdout: changes }, currentTag] = await Promise.all([
      execFileP("git", ["branch", "--show-current"], { cwd: ROOT, timeout: 5_000 }),
      execFileP("git", ["status", "--short"], { cwd: ROOT, timeout: 5_000 }),
      execFileP("git", ["tag", "--list", `suite-v${currentVersion}`], { cwd: ROOT, timeout: 5_000 }),
    ]);
    const currentVersionAlreadyPublished = currentTag.stdout.trim() === `suite-v${currentVersion}`;
    res.json({
      ok: true,
      currentVersion,
      // Se il pacchetto è stato già aggiornato da una pubblicazione interrotta,
      // il tag non esiste ancora: riproponiamo quella stessa versione, senza
      // saltare una patch e senza obbligare l'utente a intervenire a mano.
      suggestedVersion: currentVersionAlreadyPublished ? `${major}.${minor}.${patch + 1}` : currentVersion,
      branch: branch.trim(),
      clean: changes.trim().length === 0,
      changedFiles: changes.trim() ? changes.trim().split(/\r?\n/u).length : 0,
      changesSummary: changes.trim() || "Nessuna modifica in attesa.",
      running: await isRunning(SUITE_RELEASE_ID),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: String((error as Error)?.message ?? error) });
  }
});

function validSuiteVersion(value: unknown): string | null {
  const version = String(value ?? "").trim();
  return /^\d+\.\d+\.\d+$/u.test(version) ? version : null;
}

app.post("/api/release/suite/preflight", async (req, res) => {
  const version = validSuiteVersion(req.body?.version);
  if (!version) {
    res.status(400).json({ ok: false, error: "Versione non valida. Usa il formato X.Y.Z." });
    return;
  }
  const result = await startProcess(
    SUITE_RELEASE_ID,
    `Preflight FileX Suite ${version}`,
    { file: SUITE_RELEASE_BAT, args: [version, "--preflight"] },
    { cwd: ROOT },
  );
  res.json({ ...result, id: SUITE_RELEASE_ID });
});

app.post("/api/release/suite/publish", async (req, res) => {
  const version = validSuiteVersion(req.body?.version);
  if (!version) {
    res.status(400).json({ ok: false, error: "Versione non valida. Usa il formato X.Y.Z." });
    return;
  }
  if (req.body?.confirmed !== true) {
    res.status(400).json({ ok: false, error: "Conferma la pubblicazione dalla dashboard prima di procedere." });
    return;
  }
  const result = await startProcess(
    SUITE_RELEASE_ID,
    `Release FileX Suite ${version}`,
    { file: SUITE_RELEASE_BAT, args: [version, "--publish", `PUBBLICA-suite-v${version}`] },
    { cwd: ROOT },
  );
  res.json({ ...result, id: SUITE_RELEASE_ID });
});

app.post("/api/release/suite/stop", async (_req, res) => {
  res.json(await stopProcess(SUITE_RELEASE_ID));
});

app.use(express.static(join(PKG_DIR, "public")));

app.listen(PORT, HOST, () => {
  console.log(`\n  FILEX DEV CONSOLE`);
  console.log(`  Dashboard: http://${HOST}:${PORT}`);
  console.log(`  Root repo : ${ROOT}\n`);
});
