import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  configureBackupGuardStorage,
  configureBackupGuardTestMode,
  executeBackupGuard,
  listBackupGuardHistory,
  saveBackupGuardConfiguration,
  scanBackupGuard,
} from "../apps/backup-guard/electron/backup-guard-service.js";

const master = resolve(process.argv[2] ?? "");
const clone = resolve(process.argv[3] ?? "");
if (basename(master) !== "Cartella A" || basename(clone) !== "Cartella B") throw new Error("I target devono chiamarsi esattamente Cartella A e Cartella B.");
if (master === clone) throw new Error("I target di test devono essere distinti.");

async function mustNotExist(path: string): Promise<void> {
  try { await stat(path); throw new Error(`${path} esiste gia': test interrotto senza modificarlo.`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

await Promise.all([mustNotExist(master), mustNotExist(clone)]);
await Promise.all([mkdir(master, { recursive: false }), mkdir(clone, { recursive: false })]);
const stateRoot = await mkdtemp(join(tmpdir(), "filex-bg-desktop-e2e-"));
configureBackupGuardTestMode(true);
configureBackupGuardStorage(stateRoot);

const report: Array<{ flow: string; ok: boolean; details: string }> = [];
function passed(flow: string, details: string): void { report.push({ flow, ok: true, details }); }

try {
  await saveBackupGuardConfiguration(master, clone);
  passed("Associazione", "Master e clone associati con marcatore FileX.");

  await mkdir(join(master, "Matrimonio Rossi", "RAW"), { recursive: true });
  await mkdir(join(master, "Matrimonio Rossi", "Catalogo Smart Previews.lrdata"), { recursive: true });
  await Promise.all([
    writeFile(join(master, "Matrimonio Rossi", "RAW", "GMR_0001.CR3"), Buffer.alloc(1024 * 1024, 11)),
    writeFile(join(master, "Matrimonio Rossi", "RAW", "GMR_0001.XMP"), "<xmpmeta rating='5'/>", "utf8"),
    writeFile(join(master, "Matrimonio Rossi", "anteprima è.jpg"), Buffer.alloc(64 * 1024, 22)),
    writeFile(join(master, "Matrimonio Rossi", "Catalogo.lrcat"), "LIGHTROOM-CATALOG-V1", "utf8"),
    writeFile(join(master, "Matrimonio Rossi", "Catalogo.lrcat-data"), "AI-MASK-DATA", "utf8"),
    writeFile(join(master, "Matrimonio Rossi", "Catalogo Smart Previews.lrdata", "preview.dat"), "PREVIEW", "utf8"),
    writeFile(join(master, "zero-byte.txt"), Buffer.alloc(0)),
  ]);
  let plan = await scanBackupGuard();
  assert.equal(plan.totals["copy-to-clone"] > 0, true);
  let execution = await executeBackupGuard(plan.id, false);
  assert.equal(execution.verifiedFiles, 7);
  assert.equal((await stat(join(clone, "Matrimonio Rossi", "RAW", "GMR_0001.CR3"))).size, 1024 * 1024);
  passed("Prima copia", `${execution.verifiedFiles} file copiati e verificati con SHA-256.`);

  await mkdir(join(clone, "Servizio al mare"), { recursive: true });
  await writeFile(join(clone, "Servizio al mare", "MARE_0001.RAF"), Buffer.alloc(128 * 1024, 33));
  plan = await scanBackupGuard();
  assert.equal(plan.totals["import-from-clone"] > 0, true);
  execution = await executeBackupGuard(plan.id, false);
  assert.equal(await readFile(join(master, "Servizio al mare", "MARE_0001.RAF")).then((value) => value.length), 128 * 1024);
  passed("Lavoro fuori studio", "File nuovo sul clone importato nel master e verificato.");

  await writeFile(join(master, "Matrimonio Rossi", "Catalogo.lrcat"), "LIGHTROOM-CATALOG-V2-UPDATED", "utf8");
  plan = await scanBackupGuard();
  assert.equal(plan.totals["copy-to-clone"], 1);
  await executeBackupGuard(plan.id, false);
  assert.equal(await readFile(join(clone, "Matrimonio Rossi", "Catalogo.lrcat"), "utf8"), "LIGHTROOM-CATALOG-V2-UPDATED");
  passed("Aggiornamento", "Catalogo aggiornato dal master al clone con sostituzione protetta.");

  await rm(join(clone, "Matrimonio Rossi", "anteprima è.jpg"));
  plan = await scanBackupGuard();
  assert.equal(plan.totals["restore-to-clone"], 1);
  execution = await executeBackupGuard(plan.id, false);
  assert.equal(execution.restoredToClone, 1);
  passed("Cancellazione accidentale clone", "File ripristinato automaticamente dal master.");

  await rm(join(master, "Matrimonio Rossi", "RAW", "GMR_0001.XMP"));
  plan = await scanBackupGuard();
  assert.equal(plan.totals["delete-from-clone"], 1);
  await assert.rejects(() => executeBackupGuard(plan.id, false), /Conferma/);
  plan = await scanBackupGuard();
  execution = await executeBackupGuard(plan.id, true);
  assert.equal(execution.deletedFromClone, 1);
  assert.ok(execution.trashPath);
  assert.equal(await readFile(join(execution.trashPath!, "Matrimonio Rossi", "RAW", "GMR_0001.XMP"), "utf8"), "<xmpmeta rating='5'/>");
  passed("Cancellazione master", "Cancellazione rifiutata senza conferma e poi spostata nel cestino FileX.");

  await Promise.all([
    writeFile(join(master, "Matrimonio Rossi", "Catalogo.lrcat-data"), "MASTER-AI-CHANGE-LONG", "utf8"),
    writeFile(join(clone, "Matrimonio Rossi", "Catalogo.lrcat-data"), "CLONE-AI-CHANGE-DIFFERENT", "utf8"),
  ]);
  plan = await scanBackupGuard();
  assert.equal(plan.totals.conflict, 1);
  execution = await executeBackupGuard(plan.id, false);
  assert.equal(execution.conflictsSkipped, 1);
  assert.equal(await readFile(join(master, "Matrimonio Rossi", "Catalogo.lrcat-data"), "utf8"), "MASTER-AI-CHANGE-LONG");
  assert.equal(await readFile(join(clone, "Matrimonio Rossi", "Catalogo.lrcat-data"), "utf8"), "CLONE-AI-CHANGE-DIFFERENT");
  passed("Conflitto", "Entrambe le versioni sono state preservate senza sovrascrittura.");

  await writeFile(join(master, "Matrimonio Rossi", "Catalogo.lrcat.lock"), "LOCK", "utf8");
  plan = await scanBackupGuard();
  assert.equal(plan.lightroomLocks.length, 1);
  await assert.rejects(() => executeBackupGuard(plan.id, false), /Chiudi Lightroom/);
  await rm(join(master, "Matrimonio Rossi", "Catalogo.lrcat.lock"));
  passed("Lightroom aperto", "Sincronizzazione bloccata correttamente dal file .lrcat.lock.");

  const history = await listBackupGuardHistory();
  assert.equal(history.some((item) => item.status === "executed"), true);
  assert.equal(history.some((item) => item.execution?.trashPath), true);
  passed("Cronologia", `${history.length} eventi persistenti, incluso il percorso del cestino.`);

  console.log(JSON.stringify({ master, clone, passed: report.length, report }, null, 2));
} finally {
  await rm(stateRoot, { recursive: true, force: true });
}
