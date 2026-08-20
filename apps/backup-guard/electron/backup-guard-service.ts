import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  BackupGuardConfiguration,
  BackupGuardDifference,
  BackupGuardConflictAction,
  BackupGuardDeepVerificationResult,
  BackupGuardExecutionProgress,
  BackupGuardExecutionResult,
  BackupGuardHistoryEntry,
  BackupGuardPendingProject,
  BackupGuardRecoveryResult,
  BackupGuardScanResult,
  BackupGuardTrashSession,
} from "../src/contracts.js";

interface EntrySnapshot { type: "file" | "directory"; bytes: number; mtimeMs: number; }
interface PendingPlan { result: BackupGuardScanResult; master: Record<string, EntrySnapshot>; clone: Record<string, EntrySnapshot>; }
interface JournalOperation { relativePath: string; kind: string; status: "pending" | "completed" | "failed"; sha256?: string; error?: string; }
interface Journal { sessionId: string; scanId: string; startedAt: string; status: "running" | "completed" | "failed"; operations: JournalOperation[]; }
interface StoredState {
  schemaVersion: 2;
  configuration: BackupGuardConfiguration | null;
  history: BackupGuardHistoryEntry[];
  baseline: Record<string, EntrySnapshot> | null;
  pendingPlan: PendingPlan | null;
  journal: Journal | null;
}

const EMPTY: StoredState = { schemaVersion: 2, configuration: null, history: [], baseline: null, pendingPlan: null, journal: null };
const INTERNAL_DIR = ".filex-backup-guard";
let dataFile = "";
let inboxFile = "";
let allowSameVolumeForTests = false;
let progress: BackupGuardExecutionProgress = idleProgress();
let operationStartedAt = 0;

function idleProgress(): BackupGuardExecutionProgress {
  return { active: false, sessionId: null, phase: "idle", completedOperations: 0, totalOperations: 0, bytesCompleted: 0, totalBytes: 0, currentPath: null, currentFileBytes: 0, currentFileTotalBytes: 0, bytesPerSecond: 0, etaSeconds: null, paused: false, cancelRequested: false, error: null };
}

export function configureBackupGuardStorage(userDataPath: string): void { dataFile = resolve(userDataPath, "backup-guard", "state.json"); }
export function configureBackupGuardTestMode(allowSameVolume: boolean): void { allowSameVolumeForTests = allowSameVolume; }
export function configureBackupGuardInbox(appDataPath: string): void { inboxFile = resolve(appDataPath, "FileX", "shared", "backup-guard-inbox.jsonl"); }

export async function listPendingBackupGuardProjects(): Promise<BackupGuardPendingProject[]> {
  if (!inboxFile) return [];
  try {
    const lines = (await fs.readFile(inboxFile, "utf8")).split(/\r?\n/).filter(Boolean);
    const byId = new Map<string, BackupGuardPendingProject>();
    for (const line of lines) {
      try {
        const value = JSON.parse(line) as BackupGuardPendingProject & { schemaVersion?: number };
        if (value.schemaVersion === 1 && value.eventId && value.absolutePath) byId.set(value.eventId, value);
      } catch { /* preserva le altre notifiche */ }
    }
    return [...byId.values()].sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function clearProtectedProjectEvents(masterPath: string): Promise<void> {
  if (!inboxFile) return;
  const pending = await listPendingBackupGuardProjects();
  const remaining = pending.filter((item) => { const path = resolve(item.absolutePath); return path !== masterPath && !isInside(masterPath, path); });
  await fs.mkdir(dirname(inboxFile), { recursive: true });
  await fs.writeFile(inboxFile, remaining.map((item) => JSON.stringify({ ...item, schemaVersion: 1 })).join("\n") + (remaining.length ? "\n" : ""), "utf8");
}

async function readState(): Promise<StoredState> {
  if (!dataFile) throw new Error("Storage Backup Guard non configurato.");
  try {
    const parsed = JSON.parse(await fs.readFile(dataFile, "utf8")) as Partial<StoredState>;
    return { ...EMPTY, ...parsed, schemaVersion: 2, history: Array.isArray(parsed.history) ? parsed.history : [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY);
    throw new Error("La cronologia Backup Guard non e' leggibile. Nessuna operazione e' stata eseguita.", { cause: error });
  }
}

async function writeState(state: StoredState): Promise<void> {
  await fs.mkdir(dirname(dataFile), { recursive: true });
  const temporary = `${dataFile}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(temporary, dataFile);
}

async function canonicalDirectory(input: string): Promise<string> {
  if (!input.trim() || !isAbsolute(input)) throw new Error("Seleziona un percorso assoluto valido.");
  const canonical = await fs.realpath(resolve(input));
  if (!(await fs.stat(canonical)).isDirectory()) throw new Error("Il percorso selezionato non e' una cartella.");
  return canonical;
}

async function volumeId(path: string): Promise<string> { return String((await fs.stat(path)).dev); }

async function writeCloneMarker(clonePath: string, pairId: string, cloneVolumeId: string): Promise<void> {
  const directory = join(clonePath, INTERNAL_DIR);
  const marker = join(directory, "volume.json");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(marker, JSON.stringify({ schemaVersion: 1, role: "clone", pairId, cloneVolumeId }, null, 2), { encoding: "utf8", flag: "w" });
}

async function verifyConfiguredVolumes(configuration: BackupGuardConfiguration): Promise<{ masterPath: string; clonePath: string }> {
  const masterPath = await canonicalDirectory(configuration.masterPath);
  const clonePath = await canonicalDirectory(configuration.clonePath);
  const [masterVolumeId, cloneVolumeId] = await Promise.all([volumeId(masterPath), volumeId(clonePath)]);
  if (masterVolumeId !== configuration.masterVolumeId) throw new Error("L'archivio principale collegato non corrisponde a quello configurato.");
  if (cloneVolumeId !== configuration.cloneVolumeId) throw new Error("Il clone collegato non corrisponde al disco configurato.");
  try {
    const marker = JSON.parse(await fs.readFile(join(clonePath, INTERNAL_DIR, "volume.json"), "utf8")) as { pairId?: string; role?: string };
    if (marker.pairId !== configuration.pairId || marker.role !== "clone") throw new Error("Identita' clone non corrispondente.");
  } catch (error) {
    if (error instanceof Error && error.message === "Identita' clone non corrispondente.") throw error;
    throw new Error("Il marcatore di sicurezza del clone e' assente o danneggiato.");
  }
  return { masterPath, clonePath };
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function safePath(root: string, relativePath: string): string {
  const target = resolve(root, ...relativePath.split("/"));
  if (target !== root && !isInside(root, target)) throw new Error(`Percorso non sicuro: ${relativePath}`);
  return target;
}

export async function saveBackupGuardConfiguration(masterInput: string, cloneInput: string): Promise<BackupGuardConfiguration> {
  const masterPath = await canonicalDirectory(masterInput);
  const clonePath = await canonicalDirectory(cloneInput);
  if (masterPath.toLowerCase() === clonePath.toLowerCase() || isInside(masterPath, clonePath) || isInside(clonePath, masterPath)) {
    throw new Error("Archivio principale e clone devono essere cartelle separate e non contenute una nell'altra.");
  }
  const state = await readState();
  const now = new Date().toISOString();
  const samePair = state.configuration?.masterPath === masterPath && state.configuration?.clonePath === clonePath;
  const [masterVolumeId, cloneVolumeId] = await Promise.all([volumeId(masterPath), volumeId(clonePath)]);
  if (masterVolumeId === cloneVolumeId && !allowSameVolumeForTests) throw new Error("Archivio principale e clone devono trovarsi su volumi fisici distinti.");
  const pairId = samePair && state.configuration?.pairId ? state.configuration.pairId : randomUUID();
  const configuration: BackupGuardConfiguration = {
    masterPath, clonePath, createdAt: samePair ? state.configuration!.createdAt : now, updatedAt: now,
    pairId, masterVolumeId, cloneVolumeId,
    trashRetentionDays: state.configuration?.trashRetentionDays ?? 30,
    deletionFileThreshold: state.configuration?.deletionFileThreshold ?? 1000,
    deletionByteThreshold: state.configuration?.deletionByteThreshold ?? 500_000_000_000,
  };
  await writeCloneMarker(clonePath, pairId, cloneVolumeId);
  await writeState({ ...state, configuration, baseline: samePair ? state.baseline : null, pendingPlan: null, journal: null });
  return configuration;
}

export async function getBackupGuardConfiguration(): Promise<BackupGuardConfiguration | null> { return (await readState()).configuration; }
export async function listBackupGuardHistory(): Promise<BackupGuardHistoryEntry[]> { return (await readState()).history.slice(0, 200); }
export function getBackupGuardProgress(): BackupGuardExecutionProgress { return { ...progress }; }
export function pauseBackupGuard(): BackupGuardExecutionProgress { if (progress.active) progress.paused = true; return getBackupGuardProgress(); }
export function resumeBackupGuard(): BackupGuardExecutionProgress { progress.paused = false; return getBackupGuardProgress(); }
export function cancelBackupGuard(): BackupGuardExecutionProgress { if (progress.active) progress.cancelRequested = true; return getBackupGuardProgress(); }

async function waitForOperationControl(): Promise<void> {
  while (progress.paused && !progress.cancelRequested) await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  if (progress.cancelRequested) throw new Error("Operazione annullata dall'utente in stato sicuro.");
}

function updateTransferProgress(bytes: number): void {
  progress.currentFileBytes += bytes;
  progress.bytesCompleted += bytes;
  const elapsedSeconds = Math.max((Date.now() - operationStartedAt) / 1000, 0.001);
  progress.bytesPerSecond = progress.bytesCompleted / elapsedSeconds;
  const remaining = Math.max(0, progress.totalBytes - progress.bytesCompleted);
  progress.etaSeconds = progress.bytesPerSecond > 0 ? remaining / progress.bytesPerSecond : null;
}

async function snapshotTree(root: string): Promise<Map<string, EntrySnapshot>> {
  const entries = new Map<string, EntrySnapshot>();
  const queue = [root];
  while (queue.length) {
    const directory = queue.pop()!;
    for (const child of await fs.readdir(directory, { withFileTypes: true })) {
      if (child.name === INTERNAL_DIR) continue;
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

async function recoverInterruptedTransfers(root: string): Promise<number> {
  let recovered = 0; const queue = [root];
  while (queue.length) {
    const directory = queue.pop()!;
    for (const child of await fs.readdir(directory, { withFileTypes: true })) {
      if (child.name === INTERNAL_DIR) continue;
      const absolute = join(directory, child.name);
      if (child.isDirectory()) { queue.push(absolute); continue; }
      const partMatch = child.name.match(/^\.(.+)\.([0-9a-f-]{36})\.filex-part$/i);
      if (partMatch) { await fs.rm(absolute, { force: false }); recovered++; continue; }
      const previousMatch = child.name.match(/^\.(.+)\.([0-9a-f-]{36})\.filex-previous$/i);
      if (!previousMatch) continue;
      const destination = join(directory, previousMatch[1]!);
      try { await fs.lstat(destination); await fs.rm(absolute, { force: false }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") await fs.rename(absolute, destination); else throw error; }
      recovered++;
    }
  }
  return recovered;
}

function same(a: EntrySnapshot, b: EntrySnapshot): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "directory") return true;
  return a.bytes === b.bytes && Math.abs(a.mtimeMs - b.mtimeMs) < 2;
}
function isLightroomLock(path: string): boolean { return path.toLowerCase().endsWith(".lrcat.lock"); }

function isAtOrBelow(path: string, root: string): boolean { return path === root || path.startsWith(`${root}/`); }
function relativeParent(path: string): string { const index = path.lastIndexOf("/"); return index < 0 ? "" : path.slice(0, index); }

function subtreeEntries(tree: Map<string, EntrySnapshot>, root: string): Array<[string, EntrySnapshot]> {
  return [...tree.entries()]
    .filter(([path]) => path.startsWith(`${root}/`) && !isLightroomLock(path))
    .map(([path, entry]) => [path.slice(root.length + 1), entry] as [string, EntrySnapshot])
    .sort(([a], [b]) => a.localeCompare(b));
}

function subtreeSignature(tree: Map<string, EntrySnapshot>, root: string): string | null {
  const entries = subtreeEntries(tree, root);
  if (!entries.some(([, entry]) => entry.type === "file")) return null;
  return JSON.stringify(entries.map(([path, entry]) => entry.type === "directory"
    ? [path, entry.type]
    : [path, entry.type, entry.bytes, Math.round(entry.mtimeMs)]));
}

function subtreeMatchesReference(tree: Map<string, EntrySnapshot>, reference: Map<string, EntrySnapshot>, root: string): boolean {
  const current = subtreeEntries(tree, root);
  const expected = subtreeEntries(reference, root);
  return current.length === expected.length && current.every(([path, entry], index) => {
    const referenceEntry = expected[index];
    return referenceEntry?.[0] === path && same(entry, referenceEntry[1]);
  });
}

function topLevelCandidates(paths: string[]): string[] {
  return paths
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))
    .filter((path, index, all) => !all.slice(0, index).some((parent) => path.startsWith(`${parent}/`)));
}

function inferFolderRenames(
  differences: BackupGuardDifference[],
  master: Map<string, EntrySnapshot>,
  clone: Map<string, EntrySnapshot>,
  baseline: Map<string, EntrySnapshot> | null,
): BackupGuardDifference[] {
  if (!baseline) return differences;
  const oldCandidates = topLevelCandidates(differences
    .filter((item) => item.kind === "delete-from-clone" && item.entryType === "directory")
    .map((item) => item.relativePath))
    .filter((root) => baseline.get(root)?.type === "directory" && clone.get(root)?.type === "directory" && !master.has(root) && subtreeMatchesReference(clone, baseline, root));
  const newCandidates = topLevelCandidates(differences
    .filter((item) => item.kind === "copy-to-clone" && item.entryType === "directory")
    .map((item) => item.relativePath))
    .filter((root) => master.get(root)?.type === "directory" && !clone.has(root) && !baseline.has(root));

  const oldByKey = new Map<string, string[]>();
  const newByKey = new Map<string, string[]>();
  for (const root of oldCandidates) {
    const signature = subtreeSignature(baseline, root);
    if (!signature) continue;
    const key = `${relativeParent(root)}\n${signature}`;
    oldByKey.set(key, [...(oldByKey.get(key) ?? []), root]);
  }
  for (const root of newCandidates) {
    const signature = subtreeSignature(master, root);
    if (!signature) continue;
    const key = `${relativeParent(root)}\n${signature}`;
    newByKey.set(key, [...(newByKey.get(key) ?? []), root]);
  }

  const matches: Array<{ oldRoot: string; newRoot: string; bytes: number }> = [];
  for (const [key, oldRoots] of oldByKey) {
    const newRoots = newByKey.get(key) ?? [];
    if (oldRoots.length !== 1 || newRoots.length !== 1) continue;
    const oldRoot = oldRoots[0]!; const newRoot = newRoots[0]!;
    const bytes = subtreeEntries(master, newRoot).reduce((sum, [, entry]) => sum + (entry.type === "file" ? entry.bytes : 0), 0);
    matches.push({ oldRoot, newRoot, bytes });
  }
  if (!matches.length) return differences;

  return [
    ...differences.filter((item) => !matches.some(({ oldRoot, newRoot }) => isAtOrBelow(item.relativePath, oldRoot) || isAtOrBelow(item.relativePath, newRoot))),
    ...matches.map(({ oldRoot, newRoot, bytes }): BackupGuardDifference => ({
      relativePath: newRoot,
      previousRelativePath: oldRoot,
      kind: "rename-on-clone",
      entryType: "directory",
      masterBytes: bytes,
      cloneBytes: bytes,
      reason: "La cartella e' stata rinominata nel principale. Dopo la verifica dei contenuti verra' rinominata direttamente anche sul clone.",
    })),
  ].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function buildDifferencePlan(master: Map<string, EntrySnapshot>, clone: Map<string, EntrySnapshot>, baseline: Map<string, EntrySnapshot> | null): BackupGuardDifference[] {
  const paths = new Set([...master.keys(), ...clone.keys(), ...(baseline?.keys() ?? [])]);
  const differences: BackupGuardDifference[] = [];
  for (const path of [...paths].sort((a, b) => a.localeCompare(b))) {
    const m = master.get(path); const c = clone.get(path); const previous = baseline?.get(path);
    if (isLightroomLock(path)) continue;
    if (m && !c) differences.push({ relativePath: path, kind: previous ? "restore-to-clone" : "copy-to-clone", entryType: m.type, masterBytes: m.bytes, cloneBytes: null, reason: previous ? "Elemento assente dal clone: verra' ripristinato dal principale." : "Nuovo elemento presente nell'archivio principale." });
    else if (!m && c) differences.push({ relativePath: path, kind: previous ? "delete-from-clone" : "import-from-clone", entryType: c.type, masterBytes: null, cloneBytes: c.bytes, reason: previous ? "Elemento eliminato dal principale dopo l'ultima baseline." : "Nuovo elemento trovato soltanto sul clone." });
    else if (m && c && !same(m, c)) {
      const masterChanged = !previous || !same(m, previous); const cloneChanged = !previous || !same(c, previous);
      differences.push({ relativePath: path, kind: masterChanged && cloneChanged ? "conflict" : masterChanged ? "copy-to-clone" : "conflict", entryType: m.type, masterBytes: m.bytes, cloneBytes: c.bytes, reason: masterChanged && cloneChanged ? "Le due copie sono diverse: nessuna verra' sovrascritta." : "Il principale contiene una versione aggiornata." });
    }
  }
  return inferFolderRenames(differences, master, clone, baseline);
}

function scanResult(masterPath: string, clonePath: string, master: Map<string, EntrySnapshot>, clone: Map<string, EntrySnapshot>, baseline: Map<string, EntrySnapshot> | null, startedAt: string): BackupGuardScanResult {
  const differences = buildDifferencePlan(master, clone, baseline);
  const keys = ["copy-to-clone", "import-from-clone", "delete-from-clone", "restore-to-clone", "rename-on-clone", "conflict"] as const;
  const totals = Object.fromEntries(keys.map((key) => [key, differences.filter((item) => item.kind === key).length])) as BackupGuardScanResult["totals"];
  const files = (map: Map<string, EntrySnapshot>) => [...map.values()].filter((v) => v.type === "file");
  const deleted = differences.filter((item) => item.kind === "delete-from-clone" && item.entryType === "file");
  const deletionBytes = deleted.reduce((sum, item) => sum + (item.cloneBytes ?? 0), 0);
  const lightroomLocks = [...new Set([...master.keys(), ...clone.keys()].filter(isLightroomLock))];
  return {
    id: randomUUID(), startedAt, completedAt: new Date().toISOString(), masterPath, clonePath,
    masterFiles: files(master).length, cloneFiles: files(clone).length,
    masterBytes: files(master).reduce((n, v) => n + v.bytes, 0), cloneBytes: files(clone).reduce((n, v) => n + v.bytes, 0),
    differences, totals, readOnly: true, deletionFiles: deleted.length, deletionBytes,
    requiresDeletionConfirmation: deleted.length > 0, lightroomLocks,
  };
}

export async function scanBackupGuard(): Promise<BackupGuardScanResult> {
  let state = await readState();
  if (!state.configuration) throw new Error("Configura prima archivio principale e clone.");
  const configuration = state.configuration;
  const startedAt = new Date().toISOString();
  try {
    const { masterPath, clonePath } = await verifyConfiguredVolumes(configuration);
    if (state.journal?.status === "running") {
      const recovered = (await recoverInterruptedTransfers(masterPath)) + (await recoverInterruptedTransfers(clonePath));
      const interrupted: BackupGuardHistoryEntry = { id: randomUUID(), createdAt: new Date().toISOString(), status: "failed", summary: `Sessione interrotta recuperata in sicurezza (${recovered} file temporanei gestiti)`, error: "Il nuovo controllo riprende dalle sole operazioni ancora necessarie." };
      state = { ...state, journal: { ...state.journal, status: "failed" }, history: [interrupted, ...state.history].slice(0, 200) };
      await writeState(state);
    }
    const [master, clone] = await Promise.all([snapshotTree(masterPath), snapshotTree(clonePath)]);
    const baseline = state.baseline ? new Map(Object.entries(state.baseline)) : null;
    const result = scanResult(masterPath, clonePath, master, clone, baseline, startedAt);
    if (result.deletionFiles > configuration.deletionFileThreshold || result.deletionBytes > configuration.deletionByteThreshold) result.requiresDeletionConfirmation = true;
    const history: BackupGuardHistoryEntry = { id: result.id, createdAt: result.completedAt, status: "completed", summary: `${result.differences.length} differenze rilevate`, result };
    const pendingPlan: PendingPlan = { result, master: Object.fromEntries(master), clone: Object.fromEntries(clone) };
    const baselineForIdenticalPair = result.differences.length === 0 ? Object.fromEntries(master) : state.baseline;
    await writeState({ ...state, baseline: baselineForIdenticalPair, pendingPlan, history: [history, ...state.history].slice(0, 200) });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure: BackupGuardHistoryEntry = { id: randomUUID(), createdAt: new Date().toISOString(), status: "failed", summary: "Controllo non completato", error: message };
    await writeState({ ...state, pendingPlan: null, history: [failure, ...state.history].slice(0, 200) });
    throw error;
  }
}

async function hashFile(path: string, onChunk?: (bytes: number) => void): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    await waitForOperationControl();
    const buffer = chunk as Buffer;
    hash.update(buffer);
    onChunk?.(buffer.byteLength);
  }
  return hash.digest("hex");
}

async function copyVerified(source: string, destination: string): Promise<string> {
  await fs.mkdir(dirname(destination), { recursive: true });
  const token = randomUUID(); const destinationName = basename(destination);
  const temporary = join(dirname(destination), `.${destinationName}.${token}.filex-part`);
  const previous = join(dirname(destination), `.${destinationName}.${token}.filex-previous`);
  let previousMoved = false;
  try {
    const sourceHashState = createHash("sha256");
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        void waitForOperationControl().then(() => {
          sourceHashState.update(chunk);
          updateTransferProgress(chunk.byteLength);
          callback(null, chunk);
        }, callback);
      },
    });
    await pipeline(createReadStream(source), meter, createWriteStream(temporary, { flags: "wx" }));
    const sourceHash = sourceHashState.digest("hex");
    const destinationHash = await hashFile(temporary);
    if (sourceHash !== destinationHash) throw new Error("Checksum SHA-256 non corrispondente.");
    const sourceStat = await fs.stat(source);
    await fs.utimes(temporary, sourceStat.atime, sourceStat.mtime);
    try {
      await fs.lstat(destination);
      await fs.rename(destination, previous);
      previousMoved = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await fs.rename(temporary, destination);
    if (previousMoved) await fs.rm(previous, { recursive: true, force: true }).catch(() => undefined);
    return sourceHash;
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    if (previousMoved) {
      try {
        await fs.lstat(destination);
      } catch (destinationError) {
        if ((destinationError as NodeJS.ErrnoException).code === "ENOENT") await fs.rename(previous, destination).catch(() => undefined);
      }
    }
    throw error;
  }
}

function operationSignature(items: BackupGuardDifference[]): string {
  return JSON.stringify(items.map(({ relativePath, previousRelativePath, kind, entryType, masterBytes, cloneBytes }) => ({ relativePath, previousRelativePath, kind, entryType, masterBytes, cloneBytes })));
}

function collapseDirectoryOperations(items: BackupGuardDifference[], kind: BackupGuardDifference["kind"]): BackupGuardDifference[] {
  const selected = items.filter((item) => item.kind === kind).sort((a, b) => a.relativePath.length - b.relativePath.length);
  const parents: string[] = [];
  return selected.filter((item) => {
    if (parents.some((parent) => item.relativePath.startsWith(`${parent}/`))) return false;
    if (item.entryType === "directory") parents.push(item.relativePath);
    return true;
  });
}

async function availableBytes(path: string): Promise<number> {
  const value = await fs.statfs(path);
  return Number(value.bavail) * Number(value.bsize);
}

async function requireFreeSpace(path: string, requiredBytes: number, label: string): Promise<void> {
  if (requiredBytes <= 0) return;
  const free = await availableBytes(path);
  const reserve = Math.min(1_000_000_000, Math.ceil(requiredBytes * 0.05));
  if (free < requiredBytes + reserve) {
    throw new Error(`${label}: spazio insufficiente. Servono almeno ${requiredBytes + reserve} byte, disponibili ${free}.`);
  }
}

export async function executeBackupGuard(scanId: string, confirmDeletions: boolean): Promise<BackupGuardExecutionResult> {
  if (progress.active) throw new Error("Una sincronizzazione e' gia' in corso.");
  let state = await readState();
  const plan = state.pendingPlan;
  if (!state.configuration || !plan || plan.result.id !== scanId) throw new Error("Il piano non e' piu' valido. Esegui un nuovo controllo.");
  if (plan.result.lightroomLocks.length) throw new Error("Chiudi Lightroom prima di sincronizzare i cataloghi aperti.");
  if (plan.result.deletionFiles > 0 && !confirmDeletions) throw new Error("Conferma esplicitamente le cancellazioni dal clone.");

  const { masterPath, clonePath } = await verifyConfiguredVolumes(state.configuration);
  progress = { ...idleProgress(), active: true, sessionId: randomUUID(), phase: "preflight" };
  const [freshMaster, freshClone] = await Promise.all([snapshotTree(masterPath), snapshotTree(clonePath)]);
  const freshPlan = buildDifferencePlan(freshMaster, freshClone, state.baseline ? new Map(Object.entries(state.baseline)) : null);
  if (operationSignature(freshPlan) !== operationSignature(plan.result.differences)) {
    progress = { ...progress, active: false, phase: "failed", error: "I file sono cambiati dopo il controllo." };
    throw new Error("I file sono cambiati dopo il controllo. Il piano e' stato annullato: esegui un nuovo controllo.");
  }

  const conflicts = freshPlan.filter((item) => item.kind === "conflict");
  const operations = freshPlan.filter((item) => item.kind !== "conflict");
  const cloneRequired = operations.filter((item) => item.entryType === "file" && (item.kind === "copy-to-clone" || item.kind === "restore-to-clone")).reduce((sum, item) => sum + (item.masterBytes ?? 0), 0);
  const masterRequired = operations.filter((item) => item.entryType === "file" && item.kind === "import-from-clone").reduce((sum, item) => sum + (item.cloneBytes ?? 0), 0);
  await Promise.all([requireFreeSpace(clonePath, cloneRequired, "Clone esterno"), requireFreeSpace(masterPath, masterRequired, "Archivio principale")]);
  progress.totalOperations = operations.length;
  progress.totalBytes = operations.reduce((sum, item) => sum + (item.kind === "rename-on-clone" ? (item.masterBytes ?? 0) * 2 : (item.masterBytes ?? item.cloneBytes ?? 0)), 0);
  operationStartedAt = Date.now();
  const sessionId = progress.sessionId!;
  const journal: Journal = { sessionId, scanId, startedAt: new Date().toISOString(), status: "running", operations: operations.map((item) => ({ relativePath: item.relativePath, kind: item.kind, status: "pending" })) };
  state = { ...state, journal };
  await writeState(state);

  let copiedToClone = 0, importedToMaster = 0, deletedFromClone = 0, restoredToClone = 0, renamedOnClone = 0, verifiedFiles = 0, bytesTransferred = 0;
  const trashRoot = join(clonePath, INTERNAL_DIR, "trash", sessionId);
  try {
    const renameOperations = operations.filter((item) => item.kind === "rename-on-clone");
    for (const item of renameOperations) {
      const oldRoot = item.previousRelativePath;
      if (!oldRoot) throw new Error(`Piano di rinomina incompleto: ${item.relativePath}`);
      const masterFiles = subtreeEntries(freshMaster, item.relativePath).filter(([, entry]) => entry.type === "file");
      progress.phase = "verifying";
      for (const [innerPath, entry] of masterFiles) {
        await waitForOperationControl();
        const masterRelativePath = `${item.relativePath}/${innerPath}`;
        const cloneRelativePath = `${oldRoot}/${innerPath}`;
        progress.currentPath = masterRelativePath;
        progress.currentFileBytes = 0; progress.currentFileTotalBytes = entry.bytes * 2;
        const masterSha256 = await hashFile(safePath(masterPath, masterRelativePath), updateTransferProgress);
        const cloneSha256 = await hashFile(safePath(clonePath, cloneRelativePath), updateTransferProgress);
        if (masterSha256 !== cloneSha256) throw new Error(`Rinomina annullata: il contenuto non corrisponde per ${masterRelativePath}.`);
        verifiedFiles++;
      }
    }
    for (const item of renameOperations) {
      await waitForOperationControl();
      const oldRoot = item.previousRelativePath!;
      progress.phase = "renaming"; progress.currentPath = `${oldRoot} -> ${item.relativePath}`;
      progress.currentFileBytes = 0; progress.currentFileTotalBytes = 0;
      const source = safePath(clonePath, oldRoot); const destination = safePath(clonePath, item.relativePath);
      try { await fs.lstat(destination); throw new Error(`La destinazione della rinomina esiste gia': ${item.relativePath}`); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      await fs.mkdir(dirname(destination), { recursive: true });
      await fs.rename(source, destination);
      journal.operations.find((op) => op.relativePath === item.relativePath && op.kind === item.kind)!.status = "completed";
      renamedOnClone++; progress.completedOperations++;
      await writeState({ ...state, journal });
    }

    const directoryCreates = operations.filter((item) => item.entryType === "directory" && ["copy-to-clone", "restore-to-clone", "import-from-clone"].includes(item.kind));
    for (const item of directoryCreates) {
      await waitForOperationControl();
      progress.currentPath = item.relativePath;
      progress.currentFileBytes = 0; progress.currentFileTotalBytes = 0;
      const root = item.kind === "import-from-clone" ? masterPath : clonePath;
      await fs.mkdir(safePath(root, item.relativePath), { recursive: true });
      journal.operations.find((op) => op.relativePath === item.relativePath && op.kind === item.kind)!.status = "completed";
      progress.completedOperations++;
    }
    for (const item of operations.filter((entry) => entry.entryType === "file" && ["copy-to-clone", "restore-to-clone", "import-from-clone"].includes(entry.kind))) {
      await waitForOperationControl();
      progress.phase = item.kind === "import-from-clone" ? "importing" : "copying"; progress.currentPath = item.relativePath;
      progress.currentFileBytes = 0; progress.currentFileTotalBytes = item.masterBytes ?? item.cloneBytes ?? 0;
      const sourceRoot = item.kind === "import-from-clone" ? clonePath : masterPath;
      const destinationRoot = item.kind === "import-from-clone" ? masterPath : clonePath;
      const source = safePath(sourceRoot, item.relativePath); const destination = safePath(destinationRoot, item.relativePath);
      if (item.kind === "import-from-clone") {
        try { await fs.lstat(destination); throw new Error("La destinazione nel master esiste gia'."); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      const sha256 = await copyVerified(source, destination);
      const op = journal.operations.find((entry) => entry.relativePath === item.relativePath && entry.kind === item.kind)!; op.status = "completed"; op.sha256 = sha256;
      verifiedFiles++; bytesTransferred += item.masterBytes ?? item.cloneBytes ?? 0; progress.completedOperations++;
      if (item.kind === "import-from-clone") importedToMaster++; else if (item.kind === "restore-to-clone") restoredToClone++; else copiedToClone++;
      await writeState({ ...state, journal });
    }
    progress.phase = "deleting";
    for (const item of collapseDirectoryOperations(operations, "delete-from-clone").sort((a, b) => b.relativePath.length - a.relativePath.length)) {
      await waitForOperationControl();
      progress.currentPath = item.relativePath;
      progress.currentFileBytes = 0; progress.currentFileTotalBytes = 0;
      const source = safePath(clonePath, item.relativePath); const destination = safePath(trashRoot, item.relativePath);
      await fs.mkdir(dirname(destination), { recursive: true });
      await fs.rename(source, destination);
      const affected = operations.filter((entry) => entry.kind === "delete-from-clone" && (entry.relativePath === item.relativePath || entry.relativePath.startsWith(`${item.relativePath}/`)));
      for (const entry of affected) { const op = journal.operations.find((candidate) => candidate.relativePath === entry.relativePath && candidate.kind === entry.kind); if (op) op.status = "completed"; }
      deletedFromClone += affected.filter((entry) => entry.entryType === "file").length; progress.completedOperations += affected.length;
      await writeState({ ...state, journal });
    }

    progress.phase = "verifying";
    const [afterMaster, afterClone] = await Promise.all([snapshotTree(masterPath), snapshotTree(clonePath)]);
    const remaining = buildDifferencePlan(afterMaster, afterClone, state.baseline ? new Map(Object.entries(state.baseline)) : null);
    const newBaseline: Record<string, EntrySnapshot> = {};
    for (const [path, entry] of afterMaster) { const cloneEntry = afterClone.get(path); if (cloneEntry && same(entry, cloneEntry)) newBaseline[path] = entry; }
    journal.status = "completed";
    const completedAt = new Date().toISOString();
    const result: BackupGuardExecutionResult = { sessionId, completedAt, copiedToClone, importedToMaster, deletedFromClone, restoredToClone, renamedOnClone, conflictsSkipped: conflicts.length, verifiedFiles, bytesTransferred, trashPath: deletedFromClone ? trashRoot : null, remainingDifferences: remaining.length };
    const history: BackupGuardHistoryEntry = { id: sessionId, createdAt: completedAt, status: "executed", summary: `Sincronizzazione completata: ${verifiedFiles} file verificati, ${renamedOnClone} cartelle rinominate, ${deletedFromClone} eliminati dal clone`, execution: result };
    await writeState({ ...state, baseline: newBaseline, pendingPlan: null, journal, history: [history, ...state.history].slice(0, 200) });
    await clearProtectedProjectEvents(masterPath);
    progress = { ...progress, active: false, phase: "completed", currentPath: null, currentFileBytes: 0, currentFileTotalBytes: 0, paused: false, cancelRequested: false, etaSeconds: 0 };
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    journal.status = "failed";
    const current = journal.operations.find((op) => op.relativePath === progress.currentPath && op.status === "pending"); if (current) { current.status = "failed"; current.error = message; }
    const failure: BackupGuardHistoryEntry = { id: sessionId, createdAt: new Date().toISOString(), status: "failed", summary: "Sincronizzazione interrotta in stato sicuro", error: message };
    await writeState({ ...state, journal, pendingPlan: null, history: [failure, ...state.history].slice(0, 200) });
    progress = { ...progress, active: false, phase: "failed", error: message };
    throw error;
  }
}

export async function deepVerifyBackupGuard(): Promise<BackupGuardDeepVerificationResult> {
  if (progress.active) throw new Error("Un'altra operazione e' gia' in corso.");
  const state = await readState();
  if (!state.configuration) throw new Error("Configura prima archivio principale e clone.");
  const { masterPath, clonePath } = await verifyConfiguredVolumes(state.configuration);
  const [master, clone] = await Promise.all([snapshotTree(masterPath), snapshotTree(clonePath)]);
  const files = [...master.entries()].filter(([path, entry]) => entry.type === "file" && clone.get(path)?.type === "file");
  const sessionId = randomUUID();
  progress = { ...idleProgress(), active: true, sessionId, phase: "verifying", totalOperations: files.length, totalBytes: files.reduce((sum, [, item]) => sum + item.bytes * 2, 0) };
  operationStartedAt = Date.now();
  const mismatches: BackupGuardDeepVerificationResult["mismatches"] = [];
  let verifiedBytes = 0;
  try {
    for (const [path, entry] of files) {
      await waitForOperationControl();
      progress.currentPath = path; progress.currentFileBytes = 0; progress.currentFileTotalBytes = entry.bytes * 2;
      const masterSha256 = await hashFile(safePath(masterPath, path), updateTransferProgress);
      const cloneSha256 = await hashFile(safePath(clonePath, path), updateTransferProgress);
      if (masterSha256 !== cloneSha256) mismatches.push({ relativePath: path, masterSha256, cloneSha256 });
      verifiedBytes += entry.bytes; progress.completedOperations++;
    }
    const result: BackupGuardDeepVerificationResult = { sessionId, completedAt: new Date().toISOString(), verifiedFiles: files.length, verifiedBytes, mismatches };
    const history: BackupGuardHistoryEntry = { id: sessionId, createdAt: result.completedAt, status: "verified", summary: `Verifica profonda: ${files.length} file letti integralmente, ${mismatches.length} anomalie` };
    await writeState({ ...state, history: [history, ...state.history].slice(0, 200) });
    progress = { ...progress, active: false, phase: "completed", currentPath: null, currentFileBytes: 0, currentFileTotalBytes: 0, paused: false, cancelRequested: false, etaSeconds: 0 };
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure: BackupGuardHistoryEntry = { id: sessionId, createdAt: new Date().toISOString(), status: "failed", summary: "Verifica profonda interrotta in stato sicuro", error: message };
    await writeState({ ...state, history: [failure, ...state.history].slice(0, 200) });
    progress = { ...progress, active: false, phase: "failed", paused: false, error: message };
    throw error;
  }
}

function checkedSessionId(sessionId: string): string {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(sessionId)) throw new Error("Identificativo sessione non valido.");
  return sessionId;
}

export async function listBackupGuardTrash(): Promise<BackupGuardTrashSession[]> {
  const state = await readState();
  if (!state.configuration) return [];
  const { clonePath } = await verifyConfiguredVolumes(state.configuration);
  const trashRoot = join(clonePath, INTERNAL_DIR, "trash");
  try {
    const sessions: BackupGuardTrashSession[] = [];
    for (const child of await fs.readdir(trashRoot, { withFileTypes: true })) {
      if (!child.isDirectory() || !/^[a-zA-Z0-9-]{8,80}$/.test(child.name)) continue;
      const root = join(trashRoot, child.name); const snapshot = await snapshotTree(root); const rootStat = await fs.stat(root);
      const fileEntries = [...snapshot.entries()].filter(([, item]) => item.type === "file");
      sessions.push({ sessionId: child.name, createdAt: rootStat.birthtime.toISOString(), fileCount: fileEntries.length, totalBytes: fileEntries.reduce((sum, [, item]) => sum + item.bytes, 0), relativePaths: fileEntries.map(([path]) => path) });
    }
    return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function recoverBackupGuardTrash(sessionIdInput: string): Promise<BackupGuardRecoveryResult> {
  if (progress.active) throw new Error("Un'altra operazione e' gia' in corso.");
  const sessionId = checkedSessionId(sessionIdInput); const state = await readState();
  if (!state.configuration) throw new Error("Backup Guard non e' configurato.");
  const { masterPath, clonePath } = await verifyConfiguredVolumes(state.configuration);
  const sourceRoot = safePath(join(clonePath, INTERNAL_DIR, "trash"), sessionId);
  const destinationRoot = safePath(join(masterPath, "FileX Recuperati", "Cestino Backup Guard"), sessionId);
  try { await fs.lstat(destinationRoot); throw new Error("Questa sessione e' gia' stata recuperata nel master."); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const snapshot = await snapshotTree(sourceRoot); const files = [...snapshot.entries()].filter(([, item]) => item.type === "file");
  await requireFreeSpace(masterPath, files.reduce((sum, [, item]) => sum + item.bytes, 0), "Archivio principale");
  progress = { ...idleProgress(), active: true, sessionId, phase: "importing", totalOperations: files.length, totalBytes: files.reduce((sum, [, item]) => sum + item.bytes, 0) };
  operationStartedAt = Date.now();
  let verifiedFiles = 0;
  try {
    for (const [path, entry] of files) {
      progress.currentPath = path; progress.currentFileBytes = 0; progress.currentFileTotalBytes = entry.bytes;
      await copyVerified(safePath(sourceRoot, path), safePath(destinationRoot, path));
      verifiedFiles++; progress.completedOperations++;
    }
    progress = { ...progress, active: false, phase: "completed", currentPath: null, currentFileBytes: 0, currentFileTotalBytes: 0, etaSeconds: 0 };
    return { sessionId, recoveryPath: destinationRoot, restoredFiles: files.length, verifiedFiles };
  } catch (error) {
    progress = { ...progress, active: false, phase: "failed", error: error instanceof Error ? error.message : String(error) };
    throw error;
  }
}

export async function deleteBackupGuardTrash(sessionIdInput: string): Promise<{ ok: boolean }> {
  if (progress.active) throw new Error("Un'altra operazione e' gia' in corso.");
  const sessionId = checkedSessionId(sessionIdInput); const state = await readState();
  if (!state.configuration) throw new Error("Backup Guard non e' configurato.");
  const { clonePath } = await verifyConfiguredVolumes(state.configuration);
  const root = safePath(join(clonePath, INTERNAL_DIR, "trash"), sessionId);
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Sessione cestino non valida.");
  await fs.rm(root, { recursive: true, force: false });
  return { ok: true };
}

function conflictCopyName(path: string): string {
  const extension = extname(path); const stem = basename(path, extension); const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(dirname(path), `${stem} - copia clone ${timestamp}${extension}`).split(sep).join("/");
}

function lightroomStem(path: string): string | null {
  const name = basename(path); const lower = name.toLowerCase();
  for (const suffix of [".lrcat-data", ".lrcat", " smart previews.lrdata", " previews.lrdata", ".lrdata"]) if (lower.endsWith(suffix)) return name.slice(0, -suffix.length);
  return null;
}

async function snapshotLightroomConflict(masterPath: string, clonePath: string, relativePath: string): Promise<void> {
  const stem = lightroomStem(relativePath); if (!stem) return;
  const folder = dirname(relativePath) === "." ? "" : dirname(relativePath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const recoveryRoot = join(masterPath, "FileX Recuperati", "Cataloghi Lightroom", `${stem} ${timestamp}`);
  for (const [label, root] of [["Master", masterPath], ["Clone", clonePath]] as const) {
    const sourceFolder = safePath(root, folder.split(sep).join("/"));
    for (const child of await fs.readdir(sourceFolder, { withFileTypes: true })) {
      if ((!child.isFile() && !child.isDirectory()) || !child.name.toLowerCase().startsWith(stem.toLowerCase())) continue;
      const childLower = child.name.toLowerCase();
      if (!(childLower.includes(".lrcat") || childLower.endsWith(".lrdata"))) continue;
      const source = join(sourceFolder, child.name); const destination = join(recoveryRoot, label, child.name);
      if (child.isFile()) await copyVerified(source, destination);
      else {
        const snapshot = await snapshotTree(source);
        for (const [path, entry] of snapshot) if (entry.type === "file") await copyVerified(safePath(source, path), safePath(destination, path));
      }
    }
  }
}

export async function resolveBackupGuardConflict(scanId: string, relativePath: string, action: BackupGuardConflictAction): Promise<{ ok: boolean; outputPath?: string }> {
  if (progress.active) throw new Error("Un'altra operazione e' gia' in corso.");
  const state = await readState(); const plan = state.pendingPlan;
  if (!state.configuration || !plan || plan.result.id !== scanId) throw new Error("Il piano non e' piu' valido. Esegui un nuovo controllo.");
  const item = plan.result.differences.find((candidate) => candidate.kind === "conflict" && candidate.relativePath === relativePath);
  if (!item || item.entryType !== "file") throw new Error("Conflitto non valido o non piu' disponibile.");
  const { masterPath, clonePath } = await verifyConfiguredVolumes(state.configuration);
  const [masterStat, cloneStat] = await Promise.all([fs.stat(safePath(masterPath, relativePath)), fs.stat(safePath(clonePath, relativePath))]);
  const expectedMaster = plan.master[relativePath]; const expectedClone = plan.clone[relativePath];
  if (!expectedMaster || !expectedClone || !same(expectedMaster, { type: "file", bytes: masterStat.size, mtimeMs: masterStat.mtimeMs }) || !same(expectedClone, { type: "file", bytes: cloneStat.size, mtimeMs: cloneStat.mtimeMs })) throw new Error("Il file e' cambiato dopo il controllo. Ripeti il controllo.");
  const sessionId = randomUUID(); const needed = action === "use-master" ? masterStat.size : cloneStat.size;
  await requireFreeSpace(action === "use-master" ? clonePath : masterPath, needed, action === "use-master" ? "Clone esterno" : "Archivio principale");
  progress = { ...idleProgress(), active: true, sessionId, phase: action === "use-master" ? "copying" : "importing", totalOperations: 1, totalBytes: needed, currentPath: relativePath, currentFileTotalBytes: needed };
  operationStartedAt = Date.now();
  try {
    await snapshotLightroomConflict(masterPath, clonePath, relativePath);
    let outputPath: string;
    if (action === "use-master") {
      outputPath = safePath(clonePath, relativePath); await copyVerified(safePath(masterPath, relativePath), outputPath);
    } else if (action === "use-clone") {
      const preserved = safePath(join(masterPath, "FileX Recuperati", "Conflitti", sessionId, "Master"), relativePath);
      await copyVerified(safePath(masterPath, relativePath), preserved);
      outputPath = safePath(masterPath, relativePath); await copyVerified(safePath(clonePath, relativePath), outputPath);
    } else {
      outputPath = safePath(masterPath, conflictCopyName(relativePath)); await copyVerified(safePath(clonePath, relativePath), outputPath);
    }
    progress.completedOperations = 1;
    const history: BackupGuardHistoryEntry = { id: sessionId, createdAt: new Date().toISOString(), status: "executed", summary: `Conflitto risolto (${action}): ${relativePath}` };
    await writeState({ ...state, pendingPlan: null, history: [history, ...state.history].slice(0, 200) });
    progress = { ...progress, active: false, phase: "completed", currentPath: null, currentFileBytes: 0, currentFileTotalBytes: 0, etaSeconds: 0 };
    return { ok: true, outputPath };
  } catch (error) {
    progress = { ...progress, active: false, phase: "failed", error: error instanceof Error ? error.message : String(error) };
    throw error;
  }
}

export function testSnapshot(type: "file" | "directory", bytes: number, mtimeMs: number): EntrySnapshot { return { type, bytes, mtimeMs }; }
