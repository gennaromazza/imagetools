import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { BackupGuardConfiguration, BackupGuardDifference, BackupGuardHistoryEntry, BackupGuardScanResult } from "../src/contracts.js";

interface EntrySnapshot { type: "file" | "directory"; bytes: number; mtimeMs: number; }
interface StoredState { configuration: BackupGuardConfiguration | null; history: BackupGuardHistoryEntry[]; baseline: Record<string, EntrySnapshot> | null; }

const EMPTY: StoredState = { configuration: null, history: [], baseline: null };
let dataFile = "";

export function configureBackupGuardStorage(userDataPath: string): void {
  dataFile = resolve(userDataPath, "backup-guard", "state.json");
}

async function readState(): Promise<StoredState> {
  if (!dataFile) throw new Error("Storage Backup Guard non configurato.");
  try {
    const parsed = JSON.parse(await fs.readFile(dataFile, "utf8")) as Partial<StoredState>;
    return { configuration: parsed.configuration ?? null, history: Array.isArray(parsed.history) ? parsed.history : [], baseline: parsed.baseline ?? null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY);
    throw error;
  }
}

async function writeState(state: StoredState): Promise<void> {
  await fs.mkdir(dirname(dataFile), { recursive: true });
  const temporary = `${dataFile}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(temporary, dataFile);
}

async function canonicalDirectory(input: string): Promise<string> {
  if (!input.trim() || !isAbsolute(input)) throw new Error("Seleziona un percorso assoluto valido.");
  const canonical = await fs.realpath(resolve(input));
  const stat = await fs.stat(canonical);
  if (!stat.isDirectory()) throw new Error("Il percorso selezionato non e' una cartella.");
  return canonical;
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export async function saveBackupGuardConfiguration(masterInput: string, cloneInput: string): Promise<BackupGuardConfiguration> {
  const masterPath = await canonicalDirectory(masterInput);
  const clonePath = await canonicalDirectory(cloneInput);
  if (masterPath.toLowerCase() === clonePath.toLowerCase() || isInside(masterPath, clonePath) || isInside(clonePath, masterPath)) {
    throw new Error("Archivio principale e clone devono essere cartelle separate e non contenute una nell'altra.");
  }
  const state = await readState();
  const now = new Date().toISOString();
  const configuration = { masterPath, clonePath, createdAt: state.configuration?.createdAt ?? now, updatedAt: now };
  await writeState({ ...state, configuration, baseline: state.configuration?.masterPath === masterPath && state.configuration?.clonePath === clonePath ? state.baseline : null });
  return configuration;
}

export async function getBackupGuardConfiguration(): Promise<BackupGuardConfiguration | null> { return (await readState()).configuration; }
export async function listBackupGuardHistory(): Promise<BackupGuardHistoryEntry[]> { return (await readState()).history.slice(0, 100); }

async function snapshotTree(root: string): Promise<Map<string, EntrySnapshot>> {
  const entries = new Map<string, EntrySnapshot>();
  const queue = [root];
  while (queue.length) {
    const directory = queue.pop()!;
    const children = await fs.readdir(directory, { withFileTypes: true });
    for (const child of children) {
      if (child.name === ".filex-backup-guard") continue;
      const absolute = resolve(directory, child.name);
      const rel = relative(root, absolute).split(sep).join("/");
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) { entries.set(rel, { type: "directory", bytes: 0, mtimeMs: stat.mtimeMs }); queue.push(absolute); }
      else if (stat.isFile()) entries.set(rel, { type: "file", bytes: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  return entries;
}

function same(a: EntrySnapshot, b: EntrySnapshot): boolean { return a.type === b.type && a.bytes === b.bytes && Math.abs(a.mtimeMs - b.mtimeMs) < 2; }

export function buildDifferencePlan(master: Map<string, EntrySnapshot>, clone: Map<string, EntrySnapshot>, baseline: Map<string, EntrySnapshot> | null): BackupGuardDifference[] {
  const paths = new Set([...master.keys(), ...clone.keys(), ...(baseline?.keys() ?? [])]);
  const differences: BackupGuardDifference[] = [];
  for (const path of [...paths].sort((a, b) => a.localeCompare(b))) {
    const m = master.get(path); const c = clone.get(path); const previous = baseline?.get(path);
    if (m && !c) {
      differences.push({ relativePath: path, kind: previous ? "restore-to-clone" : "copy-to-clone", entryType: m.type, masterBytes: m.bytes, cloneBytes: null, reason: previous ? "Elemento assente dal clone: verra' ripristinato dal principale." : "Nuovo elemento presente nell'archivio principale." });
    } else if (!m && c) {
      differences.push({ relativePath: path, kind: previous ? "delete-from-clone" : "import-from-clone", entryType: c.type, masterBytes: null, cloneBytes: c.bytes, reason: previous ? "Elemento eliminato dal principale dopo l'ultima baseline." : "Nuovo elemento trovato soltanto sul clone." });
    } else if (m && c && !same(m, c)) {
      const masterChanged = !previous || !same(m, previous); const cloneChanged = !previous || !same(c, previous);
      differences.push({ relativePath: path, kind: masterChanged && cloneChanged ? "conflict" : masterChanged ? "copy-to-clone" : "conflict", entryType: m.type, masterBytes: m.bytes, cloneBytes: c.bytes, reason: masterChanged && cloneChanged ? "Le due copie sono diverse: nessuna verra' sovrascritta." : "Il principale contiene una versione aggiornata." });
    }
  }
  return differences;
}

export async function scanBackupGuard(): Promise<BackupGuardScanResult> {
  const state = await readState();
  if (!state.configuration) throw new Error("Configura prima archivio principale e clone.");
  const startedAt = new Date().toISOString();
  try {
    const masterPath = await canonicalDirectory(state.configuration.masterPath);
    const clonePath = await canonicalDirectory(state.configuration.clonePath);
    const [master, clone] = await Promise.all([snapshotTree(masterPath), snapshotTree(clonePath)]);
    const baseline = state.baseline ? new Map(Object.entries(state.baseline)) : null;
    const differences = buildDifferencePlan(master, clone, baseline);
    const keys = ["copy-to-clone", "import-from-clone", "delete-from-clone", "restore-to-clone", "conflict"] as const;
    const totals = Object.fromEntries(keys.map((key) => [key, differences.filter((item) => item.kind === key).length])) as BackupGuardScanResult["totals"];
    const files = (map: Map<string, EntrySnapshot>) => [...map.values()].filter((v) => v.type === "file");
    const result: BackupGuardScanResult = { id: randomUUID(), startedAt, completedAt: new Date().toISOString(), masterPath, clonePath, masterFiles: files(master).length, cloneFiles: files(clone).length, masterBytes: files(master).reduce((n, v) => n + v.bytes, 0), cloneBytes: files(clone).reduce((n, v) => n + v.bytes, 0), differences, totals, readOnly: true };
    const history: BackupGuardHistoryEntry = { id: result.id, createdAt: result.completedAt, status: "completed", summary: `${differences.length} differenze rilevate in modalita' sicura`, result };
    const baselineForNextScan = differences.length === 0 ? Object.fromEntries(master) : state.baseline;
    await writeState({ ...state, baseline: baselineForNextScan, history: [history, ...state.history].slice(0, 100) });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure: BackupGuardHistoryEntry = { id: randomUUID(), createdAt: new Date().toISOString(), status: "failed", summary: "Controllo non completato", error: message };
    await writeState({ ...state, history: [failure, ...state.history].slice(0, 100) });
    throw error;
  }
}

export function testSnapshot(type: "file" | "directory", bytes: number, mtimeMs: number): EntrySnapshot { return { type, bytes, mtimeMs }; }
