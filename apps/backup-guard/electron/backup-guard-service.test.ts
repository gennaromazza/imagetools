import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDifferencePlan, cancelBackupGuard, configureBackupGuardInbox, configureBackupGuardStorage, configureBackupGuardTestMode, deepVerifyBackupGuard, executeBackupGuard, getBackupGuardProgress, listBackupGuardTrash, listPendingBackupGuardProjects, pauseBackupGuard, recoverBackupGuardTrash, resolveBackupGuardConflict, resumeBackupGuard, saveBackupGuardConfiguration, scanBackupGuard, testSnapshot } from "./backup-guard-service.js";

const file = (bytes: number, mtimeMs = 1) => testSnapshot("file", bytes, mtimeMs);
configureBackupGuardTestMode(true);

test("classifica un nuovo file master come copia verso clone", () => {
  const result = buildDifferencePlan(new Map([["A.raw", file(10)]]), new Map(), null);
  assert.equal(result[0]?.kind, "copy-to-clone");
});

test("classifica un nuovo file clone come importazione", () => {
  const result = buildDifferencePlan(new Map(), new Map([["Viaggio/A.raw", file(10)]]), null);
  assert.equal(result[0]?.kind, "import-from-clone");
});

test("propaga una cancellazione master soltanto con baseline", () => {
  const baseline = new Map([["Cliente/A.raw", file(10)]]);
  const result = buildDifferencePlan(new Map(), new Map([["Cliente/A.raw", file(10)]]), baseline);
  assert.equal(result[0]?.kind, "delete-from-clone");
});

test("ripristina un file eliminato soltanto dal clone", () => {
  const baseline = new Map([["Cliente/A.raw", file(10)]]);
  const result = buildDifferencePlan(new Map([["Cliente/A.raw", file(10)]]), new Map(), baseline);
  assert.equal(result[0]?.kind, "restore-to-clone");
});

test("blocca come conflitto le modifiche simultanee", () => {
  const baseline = new Map([["Catalogo.lrcat", file(10, 1)]]);
  const result = buildDifferencePlan(new Map([["Catalogo.lrcat", file(12, 2)]]), new Map([["Catalogo.lrcat", file(14, 3)]]), baseline);
  assert.equal(result[0]?.kind, "conflict");
});

test("ignora le differenze di timestamp delle cartelle", () => {
  const baseline = new Map([["Cliente", testSnapshot("directory", 0, 1)]]);
  const result = buildDifferencePlan(new Map([["Cliente", testSnapshot("directory", 0, 2)]]), new Map([["Cliente", testSnapshot("directory", 0, 3)]]), baseline);
  assert.equal(result.length, 0);
});

test("sincronizza, verifica e sposta nel cestino una cancellazione del master", async () => {
  const root = await mkdtemp(join(tmpdir(), "filex-backup-guard-test-"));
  const master = join(root, "master"); const clone = join(root, "clone"); const storage = join(root, "state");
  await Promise.all([mkdir(join(master, "Cliente"), { recursive: true }), mkdir(clone, { recursive: true })]);
  configureBackupGuardStorage(storage);
  await saveBackupGuardConfiguration(master, clone);
  await writeFile(join(master, "Cliente", "foto.raw"), "RAW-DATA");
  const firstPlan = await scanBackupGuard();
  const firstExecution = await executeBackupGuard(firstPlan.id, false);
  assert.equal(firstExecution.copiedToClone, 1);
  assert.equal(await readFile(join(clone, "Cliente", "foto.raw"), "utf8"), "RAW-DATA");
  await rm(join(master, "Cliente", "foto.raw"));
  const deletionPlan = await scanBackupGuard();
  assert.equal(deletionPlan.totals["delete-from-clone"], 1);
  await assert.rejects(() => executeBackupGuard(deletionPlan.id, false), /Conferma/);
  const refreshedPlan = await scanBackupGuard();
  const deletion = await executeBackupGuard(refreshedPlan.id, true);
  assert.equal(deletion.deletedFromClone, 1);
  await assert.rejects(() => stat(join(clone, "Cliente", "foto.raw")), { code: "ENOENT" });
  assert.equal(await readFile(join(deletion.trashPath!, "Cliente", "foto.raw"), "utf8"), "RAW-DATA");
  await rm(root, { recursive: true, force: true });
});

test("importa nel master un file nuovo trovato sul clone", async () => {
  const root = await mkdtemp(join(tmpdir(), "filex-backup-guard-import-"));
  const master = join(root, "master"); const clone = join(root, "clone");
  await Promise.all([mkdir(master), mkdir(clone)]);
  configureBackupGuardStorage(join(root, "state"));
  await saveBackupGuardConfiguration(master, clone);
  await writeFile(join(clone, "viaggio.jpg"), "NEW");
  const plan = await scanBackupGuard();
  const result = await executeBackupGuard(plan.id, false);
  assert.equal(result.importedToMaster, 1);
  assert.equal(await readFile(join(master, "viaggio.jpg"), "utf8"), "NEW");
  await rm(root, { recursive: true, force: true });
});

test("aggiorna una copia clone esistente e ne verifica il contenuto", async () => {
  const root = await mkdtemp(join(tmpdir(), "filex-backup-guard-update-"));
  const master = join(root, "master"); const clone = join(root, "clone");
  await Promise.all([mkdir(master), mkdir(clone)]);
  configureBackupGuardStorage(join(root, "state"));
  await writeFile(join(master, "foto.jpg"), "OLD");
  await saveBackupGuardConfiguration(master, clone);
  const initialPlan = await scanBackupGuard();
  await executeBackupGuard(initialPlan.id, false);
  await writeFile(join(master, "foto.jpg"), "NEW-VERSION");
  const plan = await scanBackupGuard();
  assert.equal(plan.totals["copy-to-clone"], 1);
  await executeBackupGuard(plan.id, false);
  assert.equal(await readFile(join(clone, "foto.jpg"), "utf8"), "NEW-VERSION");
  await rm(root, { recursive: true, force: true });
});

test("blocca la sincronizzazione quando trova un catalogo Lightroom aperto", async () => {
  const root = await mkdtemp(join(tmpdir(), "filex-backup-guard-lightroom-"));
  const master = join(root, "master"); const clone = join(root, "clone");
  await Promise.all([mkdir(master), mkdir(clone)]);
  configureBackupGuardStorage(join(root, "state"));
  await saveBackupGuardConfiguration(master, clone);
  await Promise.all([writeFile(join(master, "Wedding.lrcat"), "CATALOG"), writeFile(join(master, "Wedding.lrcat.lock"), "LOCK")]);
  const plan = await scanBackupGuard();
  assert.deepEqual(plan.lightroomLocks, ["Wedding.lrcat.lock"]);
  await assert.rejects(() => executeBackupGuard(plan.id, false), /Chiudi Lightroom/);
  await rm(root, { recursive: true, force: true });
});

test("legge e deduplica le notifiche persistenti di Archivio Flow", async () => {
  const root = await mkdtemp(join(tmpdir(), "filex-backup-guard-inbox-"));
  const inboxDir = join(root, "FileX", "shared"); await mkdir(inboxDir, { recursive: true });
  configureBackupGuardInbox(root);
  const event = { schemaVersion: 1, eventId: "event-1", projectId: "job-1", projectName: "Matrimonio Rossi", absolutePath: "D:/Archivio/Rossi", importedAt: "2026-08-14T10:00:00.000Z", fileCount: 1200 };
  await writeFile(join(inboxDir, "backup-guard-inbox.jsonl"), `${JSON.stringify(event)}\n${JSON.stringify(event)}\n`);
  const projects = await listPendingBackupGuardProjects();
  assert.equal(projects.length, 1);
  assert.equal(projects[0]?.projectName, "Matrimonio Rossi");
  await rm(root, { recursive: true, force: true });
});

test("la verifica profonda rileva contenuti diversi anche con stessa dimensione e timestamp", async () => {
  const root = await mkdtemp(join(tmpdir(), "filex-backup-guard-deep-"));
  const master = join(root, "master"); const clone = join(root, "clone");
  await Promise.all([mkdir(master), mkdir(clone)]); configureBackupGuardStorage(join(root, "state"));
  await Promise.all([writeFile(join(master, "foto.raw"), "AAAA"), writeFile(join(clone, "foto.raw"), "BBBB")]);
  const fixed = new Date("2026-01-01T00:00:00.000Z");
  const { utimes } = await import("node:fs/promises"); await Promise.all([utimes(join(master, "foto.raw"), fixed, fixed), utimes(join(clone, "foto.raw"), fixed, fixed)]);
  await saveBackupGuardConfiguration(master, clone);
  const result = await deepVerifyBackupGuard();
  assert.equal(result.verifiedFiles, 1); assert.equal(result.mismatches[0]?.relativePath, "foto.raw");
  await rm(root, { recursive: true, force: true });
});

test("elenca e recupera il cestino senza sovrascrivere il master", async () => {
  const root = await mkdtemp(join(tmpdir(), "filex-backup-guard-recover-"));
  const master = join(root, "master"); const clone = join(root, "clone");
  await Promise.all([mkdir(master), mkdir(clone)]); configureBackupGuardStorage(join(root, "state"));
  await writeFile(join(master, "scatto.raw"), "RAW"); await saveBackupGuardConfiguration(master, clone);
  await executeBackupGuard((await scanBackupGuard()).id, false); await rm(join(master, "scatto.raw"));
  const deletion = await executeBackupGuard((await scanBackupGuard()).id, true);
  const sessions = await listBackupGuardTrash(); assert.equal(sessions.some((item) => item.sessionId === deletion.sessionId), true);
  const recovered = await recoverBackupGuardTrash(deletion.sessionId);
  assert.equal(await readFile(join(recovered.recoveryPath, "scatto.raw"), "utf8"), "RAW");
  await assert.rejects(() => recoverBackupGuardTrash(deletion.sessionId), /gia' stata recuperata/);
  await rm(root, { recursive: true, force: true });
});

test("risolve un conflitto mantenendo entrambe le copie", async () => {
  const root = await mkdtemp(join(tmpdir(), "filex-backup-guard-conflict-"));
  const master = join(root, "master"); const clone = join(root, "clone");
  await Promise.all([mkdir(master), mkdir(clone)]); configureBackupGuardStorage(join(root, "state"));
  await writeFile(join(master, "catalogo.lrcat-data"), "BASE"); await saveBackupGuardConfiguration(master, clone);
  await executeBackupGuard((await scanBackupGuard()).id, false);
  await Promise.all([writeFile(join(master, "catalogo.lrcat-data"), "MASTER-X"), writeFile(join(clone, "catalogo.lrcat-data"), "CLONE!")]);
  const plan = await scanBackupGuard(); assert.equal(plan.totals.conflict, 1);
  const resolved = await resolveBackupGuardConflict(plan.id, "catalogo.lrcat-data", "keep-both");
  assert.equal(await readFile(resolved.outputPath!, "utf8"), "CLONE!");
  assert.equal(await readFile(join(master, "catalogo.lrcat-data"), "utf8"), "MASTER-X");
  await rm(root, { recursive: true, force: true });
});

test("pausa e annulla una copia lasciando la destinazione in stato sicuro", async () => {
  const root = await mkdtemp(join(tmpdir(), "filex-backup-guard-cancel-"));
  const master = join(root, "master"); const clone = join(root, "clone");
  await Promise.all([mkdir(master), mkdir(clone)]); configureBackupGuardStorage(join(root, "state"));
  await writeFile(join(master, "grande.raw"), Buffer.alloc(32 * 1024 * 1024, 7)); await saveBackupGuardConfiguration(master, clone);
  const plan = await scanBackupGuard(); const running = executeBackupGuard(plan.id, false);
  while (!getBackupGuardProgress().active) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1));
  pauseBackupGuard(); assert.equal(getBackupGuardProgress().paused, true); resumeBackupGuard(); cancelBackupGuard();
  await assert.rejects(() => running, /annullata/);
  await assert.rejects(() => stat(join(clone, "grande.raw")), { code: "ENOENT" });
  assert.equal((await readdir(clone)).some((name) => name.endsWith(".filex-part")), false);
  await rm(root, { recursive: true, force: true });
});
