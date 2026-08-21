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
const PROJECT_AUDIT_ID = "project-health";

const COMPONENT_RELEASES = [
  { id: "photo-selector-app", label: "Image Select Pro", packagePath: "apps/photo-selector-app/package.json", artifactPrefix: "Image-Select-Pro", minSuiteVersion: "0.1.26" },
  { id: "image-party-frame", label: "Image Party Frame", packagePath: "apps/image-party-frame/package.json", artifactPrefix: "Image-Party-Frame", minSuiteVersion: "0.1.26" },
  { id: "batch-print-layout", label: "Batch Print Layout", packagePath: "apps/batch-print-layout/package.json", artifactPrefix: "Batch-Print-Layout", minSuiteVersion: "0.1.26" },
  { id: "archivio-flow", label: "Archivio Flow", packagePath: "apps/archivio-flow/package.json", artifactPrefix: "Archivio-Flow", minSuiteVersion: "0.1.26" },
  { id: "image-converter", label: "Image Converter", packagePath: "apps/image-converter/package.json", artifactPrefix: "Image-Converter", minSuiteVersion: "0.1.26" },
  { id: "image-file-finder", label: "Trova Foto da Lista", packagePath: "apps/image-file-finder/package.json", artifactPrefix: "Trova-Foto-da-Lista", minSuiteVersion: "0.1.26" },
  { id: "cache-sweep", label: "FileX Adobe Cleaner", packagePath: "apps/cache-sweep/package.json", artifactPrefix: "FileX-Adobe-Cleaner", minSuiteVersion: "0.1.28" },
  { id: "filex-send", label: "FileX Send", packagePath: "apps/filex-send/package.json", artifactPrefix: "FileX-Send", minSuiteVersion: "0.1.31" },
  { id: "backup-guard", label: "FileX Backup Guard", packagePath: "apps/backup-guard/package.json", artifactPrefix: "FileX-Backup-Guard", minSuiteVersion: "0.1.33" },
] as const;

type ComponentReleaseId = typeof COMPONENT_RELEASES[number]["id"];

interface ComponentWorkflowRun {
  id: string;
  url: string | null;
  status: string;
  conclusion: string | null;
}

const componentWorkflowRuns = new Map<ComponentReleaseId, { requestedAt: number; runId: string | null }>();

function componentReleaseById(value: string): typeof COMPONENT_RELEASES[number] | null {
  return COMPONENT_RELEASES.find((component) => component.id === value) ?? null;
}

function validComponentVersion(value: unknown): string | null {
  const version = String(value ?? "").trim();
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version) ? version : null;
}

function releaseBlockingChanges(statusOutput: string): string[] {
  return statusOutput
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    // Il pannello locale non viene incluso nell'artefatto di un tool: una sua
    // modifica non deve impedire di distribuire il codice gia' su origin/main.
    .filter((path) => !path.startsWith("apps/filex-dev-console/"));
}

async function componentVersionAlreadyPublished(
  component: typeof COMPONENT_RELEASES[number],
  version: string | null,
): Promise<boolean> {
  if (!version) return false;
  const { stdout: componentTag } = await execFileP(
    "git",
    ["ls-remote", "--tags", "origin", `refs/tags/${component.id}-v${version}`],
    { cwd: ROOT, timeout: 15_000 },
  );
  if (componentTag.trim()) return true;

  // Le primissime release usavano tag generici vX.Y.Z. Non basta il nome del
  // tag: controlliamo l'asset, altrimenti un vecchio tag della Suite blocca un
  // tool mai pubblicato a quella stessa versione.
  try {
    const { stdout: assets } = await execFileP(
      "gh",
      ["release", "view", `v${version}`, "--repo", "gennaromazza/imagetools", "--json", "assets", "--jq", ".assets[].name"],
      { cwd: ROOT, timeout: 15_000 },
    );
    return assets.split(/\r?\n/u).some((asset) => asset.startsWith(`${component.artifactPrefix}-${version}-`));
  } catch {
    return false;
  }
}

async function readComponentWorkflowRun(componentId: ComponentReleaseId): Promise<ComponentWorkflowRun | null> {
  const requested = componentWorkflowRuns.get(componentId);
  if (!requested) return null;
  if (!requested.runId) {
    const { stdout } = await execFileP(
      "gh",
      ["run", "list", "--repo", "gennaromazza/imagetools", "--workflow", "windows-release.yml", "--branch", "main", "--event", "workflow_dispatch", "--limit", "10", "--json", "databaseId,createdAt,url,status,conclusion"],
      { cwd: ROOT, timeout: 15_000 },
    );
    const candidates = JSON.parse(stdout) as Array<{ databaseId?: unknown; createdAt?: unknown; url?: unknown; status?: unknown; conclusion?: unknown }>;
    const found = candidates.find((candidate) => Date.parse(String(candidate.createdAt ?? "")) >= requested.requestedAt - 10_000);
    if (!found?.databaseId) return null;
    requested.runId = String(found.databaseId);
    componentWorkflowRuns.set(componentId, requested);
    return {
      id: requested.runId,
      url: typeof found.url === "string" ? found.url : null,
      status: String(found.status ?? "queued"),
      conclusion: typeof found.conclusion === "string" ? found.conclusion : null,
    };
  }
  const { stdout } = await execFileP(
    "gh",
    ["run", "view", requested.runId, "--repo", "gennaromazza/imagetools", "--json", "databaseId,url,status,conclusion"],
    { cwd: ROOT, timeout: 15_000 },
  );
  const run = JSON.parse(stdout) as { databaseId: unknown; url?: unknown; status?: unknown; conclusion?: unknown };
  return {
    id: String(run.databaseId),
    url: typeof run.url === "string" ? run.url : null,
    status: String(run.status ?? "queued"),
    conclusion: typeof run.conclusion === "string" ? run.conclusion : null,
  };
}

function workspaceScript(workspace: string, script: string) {
  return { file: NPM_COMMAND, args: ["--workspace", workspace, "run", script] };
}

interface TestCategory {
  id: string;
  title: string;
  description: string;
}

const TEST_CATEGORIES: TestCategory[] = [
  { id: "photo-selector", title: "Image Select Pro", description: "Flusso lavoro, spostamenti e metadati XMP." },
  { id: "image-party-frame", title: "Image Party Frame — Caccia bug", description: "Persistenza progetto, immagini, crop e template." },
  { id: "batch-print-layout", title: "Batch Print Layout — Caccia bug", description: "Impaginazione, rotazioni, crop e paginazione senza duplicati." },
  { id: "archivio-flow", title: "Archivio Flow — Caccia bug", description: "Casi avversariali su percorsi, nomi Windows, fingerprint e stati di importazione." },
  { id: "image-converter", title: "Image Converter — Caccia bug", description: "Limiti export e riconoscimento sicuro delle cartelle generate." },
  { id: "image-file-finder", title: "Trova Foto da Lista — Caccia bug", description: "Parsing di liste, percorsi, virgolette e duplicati." },
  { id: "cache-sweep", title: "FileX Adobe Cleaner — Caccia bug", description: "Confini dei percorsi e pulizia sicura delle sole cache." },
  { id: "filex-send", title: "FileX Send — Caccia bug", description: "Trasferimenti, autenticazione anonima e rilevamento rete locale." },
  { id: "backup-guard", title: "FileX Backup Guard — Caccia bug", description: "Conflitti, cancellazioni, rinomine, checksum e recupero." },
  { id: "suite", title: "FileX Suite e aggiornamenti", description: "Protezione updater, cataloghi e release indipendenti." },
  { id: "licenses", title: "Licenze FileX", description: "Copertura dei controlli licenza nei tool." },
  { id: "cloud", title: "Servizi cloud", description: "Funzioni Firebase e servizi FileX Cloud." },
  { id: "other", title: "Altri controlli", description: "Test non ancora associati a una categoria di prodotto." },
];

function testCategoryId(name: string): TestCategory["id"] {
  if (name.startsWith("test:photo-selector-")) return "photo-selector";
  if (name === "test:archivio-flow-bug-hunt") return "archivio-flow";
  if (name === "test:image-party-frame-bug-hunt") return "image-party-frame";
  if (name === "test:batch-print-layout-bug-hunt") return "batch-print-layout";
  if (name === "test:image-converter-bug-hunt") return "image-converter";
  if (name === "test:image-file-finder-bug-hunt") return "image-file-finder";
  if (name === "test:cache-sweep-bug-hunt") return "cache-sweep";
  if (name === "test:filex-send-bug-hunt") return "filex-send";
  if (name === "test:backup-guard-bug-hunt") return "backup-guard";
  if (name === "test:filex-updater-lock" || name === "test:filex-independent-releases") return "suite";
  if (name === "test:filex-license-coverage") return "licenses";
  if (name === "test:filex-cloud") return "cloud";
  return "other";
}

function testDescription(name: string): string {
  const descriptions: Record<string, string> = {
    "test:photo-selector-workflow": "Controlla il flusso principale di Image Select Pro.",
    "test:photo-selector-relocation": "Verifica lo spostamento sicuro dei progetti e delle relative risorse.",
    "test:photo-selector-xmp": "Controlla lettura e aggiornamento dei metadati XMP.",
    "test:archivio-flow-bug-hunt": "Cerca regressioni con input generati, percorsi ostili e transizioni di importazione vietate.",
    "test:image-party-frame-bug-hunt": "Cerca dati progetto obsoleti e valori crop capaci di corrompere il layout.",
    "test:batch-print-layout-bug-hunt": "Stressa impaginazione, orientamento, crop e ultima pagina.",
    "test:image-converter-bug-hunt": "Verifica limiti numerici e riconoscimento multipiattaforma degli output.",
    "test:image-file-finder-bug-hunt": "Stressa il parser con virgolette, separatori, percorsi e duplicati.",
    "test:cache-sweep-bug-hunt": "Verifica che la pulizia resti confinata alle directory cache consentite.",
    "test:filex-send-bug-hunt": "Verifica trasferimenti, autenticazione e rete con casi di errore.",
    "test:backup-guard-bug-hunt": "Verifica che sincronizzazione e rinomine non perdano o sovrascrivano file.",
    "test:filex-updater-lock": "Verifica che gli archivi dell'updater non restino bloccati su Windows.",
    "test:filex-independent-releases": "Controlla feed, manifest e release indipendenti dei componenti FileX.",
    "test:filex-license-coverage": "Verifica che i percorsi di licenza richiesti siano coperti.",
    "test:filex-cloud": "Esegue i test delle funzioni cloud FileX.",
  };
  return descriptions[name] ?? "Esegue il controllo dichiarato nello script npm del progetto.";
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
      .map(([name, value]) => ({ name, command: value, description: testDescription(name) }));
    const categories = TEST_CATEGORIES
      .map((category) => ({
        ...category,
        tests: tests.filter((test) => testCategoryId(test.name) === category.id),
      }))
      .filter((category) => category.tests.length > 0);
    res.json({ ok: true, categories });
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

app.get("/api/tests/:id/status", async (req, res) => {
  const { id } = req.params;
  if (!/^tests-\d+$/u.test(id)) {
    res.status(400).json({ error: "Identificativo test non valido." });
    return;
  }
  res.json({ id, running: await isRunning(id) });
});

app.post("/api/project-health/run", async (_req, res) => {
  const result = await startProcess(
    PROJECT_AUDIT_ID,
    "Audit qualità progetto",
    { file: NODE, args: ["scripts/audit-project-health.mjs"] },
    { cwd: ROOT },
  );
  res.json({ ...result, id: PROJECT_AUDIT_ID });
});

app.get("/api/project-health/status", async (_req, res) => {
  res.json({ running: await isRunning(PROJECT_AUDIT_ID) });
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
    const [{ stdout: branch }, { stdout: changes }, currentTag, publishedTag] = await Promise.all([
      execFileP("git", ["branch", "--show-current"], { cwd: ROOT, timeout: 5_000 }),
      execFileP("git", ["status", "--short"], { cwd: ROOT, timeout: 5_000 }),
      execFileP("git", ["tag", "--list", `suite-v${currentVersion}`], { cwd: ROOT, timeout: 5_000 }),
      execFileP("git", ["tag", "--merged", "HEAD", "--list", "suite-v*", "--sort=-version:refname"], { cwd: ROOT, timeout: 5_000 }),
    ]);
    const currentVersionAlreadyPublished = currentTag.stdout.trim() === `suite-v${currentVersion}`;
    const latestPublishedTag = publishedTag.stdout.trim().split(/\r?\n/u).find(Boolean) ?? null;
    const latestPublishedVersion = latestPublishedTag?.replace(/^suite-v/u, "") ?? null;
    res.json({
      ok: true,
      currentVersion,
      latestPublishedVersion,
      currentVersionAlreadyPublished,
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

app.get("/api/release/tools", async (_req, res) => {
  try {
    const [{ stdout: branch }, { stdout: changes }, tools] = await Promise.all([
      execFileP("git", ["branch", "--show-current"], { cwd: ROOT, timeout: 5_000 }),
      execFileP("git", ["status", "--short"], { cwd: ROOT, timeout: 5_000 }),
      Promise.all(COMPONENT_RELEASES.map(async (component) => {
        const pkg = JSON.parse(await readFile(join(ROOT, component.packagePath), "utf8")) as { version?: unknown };
        const version = validComponentVersion(pkg.version);
        const workflow = await readComponentWorkflowRun(component.id).catch(() => null);
        return {
          ...component,
          version,
          versionAlreadyPublished: await componentVersionAlreadyPublished(component, version),
          workflow,
        };
      })),
    ]);
    const blockingChanges = releaseBlockingChanges(changes);
    res.json({
      ok: true,
      branch: branch.trim(),
      clean: changes.trim().length === 0,
      changedFiles: changes.trim() ? changes.trim().split(/\r?\n/u).length : 0,
      releaseAllowed: blockingChanges.length === 0,
      blockingChanges,
      tools,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: String((error as Error)?.message ?? error) });
  }
});

app.post("/api/release/tools/:id/publish", async (req, res) => {
  const component = componentReleaseById(req.params.id);
  if (!component) {
    res.status(404).json({ ok: false, error: "Tool non supportato per la release." });
    return;
  }
  if (req.body?.confirmed !== true) {
    res.status(400).json({ ok: false, error: "Conferma la pubblicazione dalla dashboard prima di procedere." });
    return;
  }

  try {
    const [{ stdout: branch }, { stdout: changes }, pkg] = await Promise.all([
      execFileP("git", ["branch", "--show-current"], { cwd: ROOT, timeout: 5_000 }),
      execFileP("git", ["status", "--short"], { cwd: ROOT, timeout: 5_000 }),
      readFile(join(ROOT, component.packagePath), "utf8").then((raw) => JSON.parse(raw) as { version?: unknown }),
    ]);
    const version = validComponentVersion(pkg.version);
    if (!version) throw new Error(`Versione non valida in ${component.packagePath}.`);
    if (branch.trim() !== "main") throw new Error("La release di un tool e' consentita solo dal branch main.");
    const blockingChanges = releaseBlockingChanges(changes);
    if (blockingChanges.length) {
      throw new Error("Ci sono modifiche che possono cambiare la release: effettua prima commit e push.");
    }

    if (await componentVersionAlreadyPublished(component, version)) {
      throw new Error(`Esiste gia' una release del tool alla versione ${version}. Incrementa la versione prima di pubblicare.`);
    }

    componentWorkflowRuns.set(component.id, { requestedAt: Date.now(), runId: null });
    await execFileP(
      "gh",
      [
        "workflow", "run", "windows-release.yml", "--repo", "gennaromazza/imagetools", "--ref", "main",
        "-f", `component=${component.id}`,
        "-f", "channel=stable",
        "-f", `version=${version}`,
        "-f", `min_suite_version=${component.minSuiteVersion}`,
      ],
      { cwd: ROOT, timeout: 30_000 },
    );
    res.json({ ok: true, component: component.id, version, message: "Workflow GitHub avviato: attendi l'aggiornamento dello stato." });
  } catch (error) {
    res.status(400).json({ ok: false, error: String((error as Error)?.message ?? error) });
  }
});

app.post("/api/release/tools/:id/stop", async (req, res) => {
  const component = componentReleaseById(req.params.id);
  const requested = component ? componentWorkflowRuns.get(component.id) : null;
  if (!component || !requested?.runId) {
    res.status(400).json({ ok: false, error: "Nessun workflow GitHub del tool individuato da arrestare." });
    return;
  }
  try {
    await execFileP("gh", ["run", "cancel", requested.runId, "--repo", "gennaromazza/imagetools"], { cwd: ROOT, timeout: 30_000 });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: String((error as Error)?.message ?? error) });
  }
});

app.use(express.static(join(PKG_DIR, "public")));

app.listen(PORT, HOST, () => {
  console.log(`\n  FILEX DEV CONSOLE`);
  console.log(`  Dashboard: http://${HOST}:${PORT}`);
  console.log(`  Root repo : ${ROOT}\n`);
});
