import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  copyFileVerified,
  isRetryableFsError,
  isTemporaryArtifactName,
  recoverOrphanTemporaryFiles,
  replaceFileAtomically,
  resolveOpenableFolder,
} from "./file-safety.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "archivio-file-safety-"));
}

function fsError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

function residue(dir: string): string[] {
  return fs.readdirSync(dir).filter((name) => isTemporaryArtifactName(name));
}

test("bug hunt: riconosce solo i residui temporanei del flusso di copia", () => {
  assert.equal(isTemporaryArtifactName("IMG_1.CR3.part.4120.1759400000000.a1b2c3"), true);
  assert.equal(isTemporaryArtifactName("IMG_1.CR3.backup.4120.1759400000000.a1b2c3"), true);
  assert.equal(isTemporaryArtifactName(".archivio-flow-rename-1759400000000-a1b2c3"), true);
  assert.equal(isTemporaryArtifactName("IMG_1.CR3"), false);
  assert.equal(isTemporaryArtifactName("Shooting.part.jpg"), false);
  assert.equal(isTemporaryArtifactName("2026-03-21 - Backup.partenza"), false);
});

test("bug hunt: ritenta solo gli errori transitori", () => {
  for (const code of ["EBUSY", "EAGAIN", "EIO", "EPERM", "EMFILE"]) assert.equal(isRetryableFsError(fsError(code)), true, code);
  for (const code of ["ENOSPC", "EACCES", "ENOENT", "EROFS"]) assert.equal(isRetryableFsError(fsError(code)), false, code);
  assert.equal(isRetryableFsError(new Error("generico")), false);
});

test("bug hunt: la copia verificata è identica, idempotente e non lascia residui", async () => {
  const dir = tempDir();
  const src = path.join(dir, "src.bin");
  const dest = path.join(dir, "dest.bin");
  fs.writeFileSync(src, Buffer.alloc(300_000, 7));

  assert.equal(await copyFileVerified(src, dest, 300_000), "copied");
  assert.deepEqual(fs.readFileSync(dest), fs.readFileSync(src));
  assert.equal(await copyFileVerified(src, dest, 300_000), "skipped");
  assert.deepEqual(residue(dir), []);
});

test("bug hunt: una corruzione a parità di dimensione viene scartata e la destinazione non nasce", async () => {
  const dir = tempDir();
  const src = path.join(dir, "src.bin");
  const dest = path.join(dir, "dest.bin");
  fs.writeFileSync(src, Buffer.alloc(4096, 1));
  let calls = 0;
  const corruptingCopy = async (_from: string, to: string) => {
    calls += 1;
    const data = Buffer.alloc(4096, 1);
    data[2048] = 99; // stessa dimensione, un byte diverso
    fs.writeFileSync(to, data);
  };

  await assert.rejects(
    copyFileVerified(src, dest, 4096, { copyFile: corruptingCopy, baseDelayMs: 1 }),
    /Verifica contenuto fallita/,
  );
  assert.equal(calls, 3, "1 tentativo + 2 ritenti");
  assert.equal(fs.existsSync(dest), false);
  assert.deepEqual(residue(dir), []);
});

test("bug hunt: un errore transitorio viene ritentato fino al successo", async () => {
  const dir = tempDir();
  const src = path.join(dir, "src.bin");
  const dest = path.join(dir, "dest.bin");
  fs.writeFileSync(src, "contenuto");
  let calls = 0;
  const flakyCopy = async (from: string, to: string) => {
    calls += 1;
    if (calls === 1) throw fsError("EBUSY");
    fs.copyFileSync(from, to);
  };

  assert.equal(await copyFileVerified(src, dest, 9, { copyFile: flakyCopy, baseDelayMs: 1 }), "copied");
  assert.equal(calls, 2);
  assert.equal(fs.readFileSync(dest, "utf8"), "contenuto");
});

test("bug hunt: disco pieno fallisce subito, con messaggio chiaro e senza file .part", async () => {
  const dir = tempDir();
  const src = path.join(dir, "src.bin");
  const dest = path.join(dir, "dest.bin");
  fs.writeFileSync(src, "contenuto");
  let calls = 0;
  const fullDiskCopy = async (_from: string, to: string) => {
    calls += 1;
    fs.writeFileSync(to, "con"); // scrittura parziale prima dell'errore
    throw fsError("ENOSPC");
  };

  await assert.rejects(
    copyFileVerified(src, dest, 9, { copyFile: fullDiskCopy, baseDelayMs: 1 }),
    (error: NodeJS.ErrnoException) => error.code === "ENOSPC" && /Spazio insufficiente/.test(error.message),
  );
  assert.equal(calls, 1, "ENOSPC non va ritentato");
  assert.equal(fs.existsSync(dest), false);
  assert.deepEqual(residue(dir), []);
});

test("bug hunt: se la sostituzione fallisce l'originale viene ripristinato", async () => {
  const dir = tempDir();
  const dest = path.join(dir, "dest.bin");
  fs.writeFileSync(dest, "originale");

  await assert.rejects(replaceFileAtomically(path.join(dir, "non-esiste.part.1.2.x"), dest));
  assert.equal(fs.readFileSync(dest, "utf8"), "originale");
  assert.deepEqual(residue(dir), []);
});

test("bug hunt: un ripristino fallito viene segnalato e l'originale resta nel backup", async () => {
  const dir = tempDir();
  const dest = path.join(dir, "dest.bin");
  fs.writeFileSync(dest, "originale");
  const warnings: string[] = [];
  const realRename = fs.promises.rename;
  let renameCalls = 0;
  fs.promises.rename = (async (from: fs.PathLike, to: fs.PathLike) => {
    renameCalls += 1;
    if (renameCalls === 3) throw fsError("EPERM"); // il ripristino backup -> destinazione
    return realRename(from, to);
  }) as typeof fs.promises.rename;

  try {
    await assert.rejects(
      replaceFileAtomically(path.join(dir, "non-esiste.part.1.2.x"), dest, (event) => warnings.push(event)),
      (error: Error) => /conservato in/.test(error.message) && /non è stato ripristinato/.test(error.message),
    );
  } finally {
    fs.promises.rename = realRename;
  }

  assert.deepEqual(warnings, ["replace_rollback_failed"]);
  const [backup] = residue(dir);
  assert.ok(backup, "il backup deve restare");
  assert.equal(fs.readFileSync(path.join(dir, backup), "utf8"), "originale");
});

test("bug hunt: il recupero dopo un crash ripulisce i .part vecchi e ripristina i backup orfani", async () => {
  const root = tempDir();
  const sub = path.join(root, "2026", "Matrimonio");
  fs.mkdirSync(sub, { recursive: true });
  const old = Date.now() - 3 * 60 * 60_000;
  const touchOld = (file: string) => fs.utimesSync(file, old / 1000, old / 1000);

  const stalePart = path.join(sub, "A.CR3.part.100.1759400000000.aaaaaa");
  const youngPart = path.join(sub, "B.CR3.part.100.1759400000000.bbbbbb");
  const orphanBackup = path.join(sub, "C.CR3.backup.100.1759400000000.cccccc");
  const leftoverBackup = path.join(sub, "D.CR3.backup.100.1759400000000.dddddd");
  const regular = path.join(sub, "Shooting.part.jpg");
  fs.writeFileSync(stalePart, "x");
  fs.writeFileSync(youngPart, "x");
  fs.writeFileSync(orphanBackup, "dati originali di C");
  fs.writeFileSync(leftoverBackup, "vecchio D");
  fs.writeFileSync(path.join(sub, "D.CR3"), "nuovo D");
  fs.writeFileSync(regular, "x");
  for (const file of [stalePart, orphanBackup, leftoverBackup, regular]) touchOld(file);
  const renameDir = path.join(root, ".archivio-flow-rename-1759400000000-abc123");
  fs.mkdirSync(renameDir);
  fs.writeFileSync(path.join(renameDir, "foto.jpg"), "foto");

  const warnings: string[] = [];
  const result = await recoverOrphanTemporaryFiles(root, { onWarn: (event) => warnings.push(event) });

  assert.equal(fs.existsSync(stalePart), false, "part vecchio eliminato");
  assert.equal(fs.existsSync(youngPart), true, "part recente intatto (copia forse in corso)");
  assert.equal(fs.readFileSync(path.join(sub, "C.CR3"), "utf8"), "dati originali di C", "backup orfano ripristinato");
  assert.equal(fs.existsSync(orphanBackup), false);
  assert.equal(fs.existsSync(leftoverBackup), false, "backup avanzato eliminato");
  assert.equal(fs.readFileSync(path.join(sub, "D.CR3"), "utf8"), "nuovo D", "la destinazione valida non viene toccata");
  assert.equal(fs.existsSync(regular), true, "un file normale con 'part' nel nome non viene toccato");
  assert.equal(fs.readFileSync(path.join(renameDir, "foto.jpg"), "utf8"), "foto", "la cartella di rinomina contiene dati: solo segnalata");
  assert.deepEqual(result.renameDirectories, [renameDir]);
  assert.equal(result.removed.length, 2);
  assert.equal(result.restored.length, 1);
  assert.deepEqual(warnings, ["orphan_rename_directory"]);
});

test("bug hunt: Esplora risorse apre soltanto cartelle reali", () => {
  const dir = tempDir();
  const file = path.join(dir, "programma.exe");
  fs.writeFileSync(file, "MZ");

  assert.equal(resolveOpenableFolder(dir), path.resolve(dir));
  assert.throws(() => resolveOpenableFolder(file), /non è una cartella/);
  assert.throws(() => resolveOpenableFolder(path.join(dir, "manca")), (e: NodeJS.ErrnoException) => e.code === "ENOENT");
  assert.throws(() => resolveOpenableFolder("\\\\server\\share"), /UNC/);
  assert.throws(() => resolveOpenableFolder(""), /vuoto/);
  assert.throws(() => resolveOpenableFolder(`${dir}\0.txt`), /vuoto/);
  assert.throws(() => resolveOpenableFolder(undefined), /vuoto/);
});
