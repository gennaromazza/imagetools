import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import {
  AtomicOutputRollbackError,
  AtomicOutputTransactionManager,
  AtomicOutputUnsupportedFileSystemError,
  DEFAULT_STALE_TRANSACTION_AGE_MS,
  createNodeAtomicOutputTransactionDependencies,
} from "./atomic-output-transaction.js";

const OWNER_ID = 42;

async function createSandbox(context: TestContext): Promise<string> {
  const sandboxPath = await mkdtemp(join(tmpdir(), "filex-output-transaction-"));
  context.after(async () => {
    const resolvedSandboxPath = resolve(sandboxPath);
    const resolvedTempPath = resolve(tmpdir());
    const relativeToTemp = relative(resolvedTempPath, resolvedSandboxPath);
    assert.ok(relativeToTemp && !relativeToTemp.startsWith("..") && !isAbsolute(relativeToTemp));
    await rm(resolvedSandboxPath, { recursive: true, force: true });
  });
  return sandboxPath;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function transactionId(index: number): string {
  return index.toString(16).padStart(32, "0");
}

function stagingDirectoryPath(outputPath: string, id: string): string {
  return join(outputPath, `.filex-stage-${id}`);
}

test("staggia progressivamente oltre 500 file senza limite cumulativo del vecchio batch", async (context) => {
  const outputPath = await createSandbox(context);
  let id = 1;
  const manager = new AtomicOutputTransactionManager({ createTransactionId: () => transactionId(id++) });
  const currentTransactionId = await manager.begin(outputPath, OWNER_ID);

  for (let index = 0; index < 501; index += 1) {
    await manager.stage(
      OWNER_ID,
      currentTransactionId,
      `pagina-${String(index + 1).padStart(3, "0")}.jpg`,
      new Uint8Array([index % 251, 0xff]),
    );
  }

  const savedNames = await manager.commit(OWNER_ID, currentTransactionId);
  await manager.finalize(OWNER_ID, currentTransactionId);
  assert.equal(savedNames.length, 501);
  assert.deepEqual(await readFile(join(outputPath, savedNames[500])), Buffer.from([500 % 251, 0xff]));
  assert.equal((await readdir(outputPath)).some((name) => name.startsWith(".filex-stage-")), false);
});

test("pubblica file completi, conserva l'ordine e non sovrascrive gli omonimi", async (context) => {
  const outputPath = await createSandbox(context);
  const dependencies = createNodeAtomicOutputTransactionDependencies();
  let id = 10;
  const manager = new AtomicOutputTransactionManager({
    ...dependencies,
    createTransactionId: () => transactionId(id++),
  });
  await dependencies.writeFileExclusive(join(outputPath, "stampa.jpg"), new Uint8Array([0x01]));
  const currentTransactionId = await manager.begin(outputPath, OWNER_ID);
  await manager.stage(OWNER_ID, currentTransactionId, "stampa.jpg", new Uint8Array([0x02, 0x03]));
  await manager.stage(OWNER_ID, currentTransactionId, "stampa.jpg", new Uint8Array([0x04, 0x05]));

  const savedNames = await manager.commit(OWNER_ID, currentTransactionId);
  await manager.finalize(OWNER_ID, currentTransactionId);

  assert.deepEqual(savedNames, ["stampa-2.jpg", "stampa-3.jpg"]);
  assert.deepEqual(await readFile(join(outputPath, "stampa.jpg")), Buffer.from([0x01]));
  assert.deepEqual(await readFile(join(outputPath, "stampa-2.jpg")), Buffer.from([0x02, 0x03]));
  assert.deepEqual(await readFile(join(outputPath, "stampa-3.jpg")), Buffer.from([0x04, 0x05]));
});

test("una collisione creata tra precheck e publish non viene mai sovrascritta", async (context) => {
  const outputPath = await createSandbox(context);
  const dependencies = createNodeAtomicOutputTransactionDependencies();
  const racedBytes = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
  let injectedRace = false;
  const manager = new AtomicOutputTransactionManager({
    ...dependencies,
    createTransactionId: () => transactionId(11),
    publishFile: async (stagedPath, destinationPath) => {
      if (!injectedRace && destinationPath.endsWith("stampa.jpg")) {
        injectedRace = true;
        await writeFile(destinationPath, racedBytes, { flag: "wx" });
      }
      await dependencies.publishFile(stagedPath, destinationPath);
    },
  });
  const currentTransactionId = await manager.begin(outputPath, OWNER_ID);
  await manager.stage(OWNER_ID, currentTransactionId, "stampa.jpg", new Uint8Array([0x01, 0x02, 0x03]));

  const savedNames = await manager.commit(OWNER_ID, currentTransactionId);
  await manager.finalize(OWNER_ID, currentTransactionId);

  assert.deepEqual(savedNames, ["stampa-2.jpg"]);
  assert.deepEqual(await readFile(join(outputPath, "stampa.jpg")), racedBytes);
  assert.deepEqual(await readFile(join(outputPath, "stampa-2.jpg")), Buffer.from([0x01, 0x02, 0x03]));
});

test("un filesystem senza hard link fallisce in sicurezza e non pubblica nomi finali", async (context) => {
  const outputPath = await createSandbox(context);
  const dependencies = createNodeAtomicOutputTransactionDependencies();
  const manager = new AtomicOutputTransactionManager({
    ...dependencies,
    createTransactionId: () => transactionId(12),
    publishFile: async (_stagedPath, destinationPath) => {
      const cause = new Error("hard link non supportato") as NodeJS.ErrnoException;
      cause.code = "EPERM";
      throw new AtomicOutputUnsupportedFileSystemError(destinationPath, cause);
    },
  });
  const currentTransactionId = await manager.begin(outputPath, OWNER_ID);
  await manager.stage(OWNER_ID, currentTransactionId, "stampa.jpg", new Uint8Array([0x01]));

  await assert.rejects(
    manager.commit(OWNER_ID, currentTransactionId),
    (error: unknown) => error instanceof AtomicOutputUnsupportedFileSystemError,
  );
  assert.deepEqual(await readdir(outputPath), []);
});

test("un errore dopo una pubblicazione rimuove ogni nome finale e lo staging", async (context) => {
  const outputPath = await createSandbox(context);
  const dependencies = createNodeAtomicOutputTransactionDependencies();
  let publishCount = 0;
  const manager = new AtomicOutputTransactionManager({
    ...dependencies,
    createTransactionId: () => transactionId(20),
    publishFile: async (stagedPath, destinationPath) => {
      publishCount += 1;
      if (publishCount === 2) {
        const error = new Error("errore disco simulato") as NodeJS.ErrnoException;
        error.code = "EIO";
        throw error;
      }
      return dependencies.publishFile(stagedPath, destinationPath);
    },
  });
  const currentTransactionId = await manager.begin(outputPath, OWNER_ID);
  await manager.stage(OWNER_ID, currentTransactionId, "pagina-001.jpg", new Uint8Array([0x01]));
  await manager.stage(OWNER_ID, currentTransactionId, "pagina-002.jpg", new Uint8Array([0x02]));

  await assert.rejects(
    manager.commit(OWNER_ID, currentTransactionId),
    /errore disco simulato/,
  );

  assert.equal(await exists(join(outputPath, "pagina-001.jpg")), false);
  assert.equal(await exists(join(outputPath, "pagina-002.jpg")), false);
  assert.equal((await readdir(outputPath)).some((name) => name.startsWith(".filex-stage-")), false);
  assert.equal(await manager.rollback(OWNER_ID, currentTransactionId), true);
});

test("il rollback preserva una destinazione sostituita dopo la pubblicazione", async (context) => {
  const outputPath = await createSandbox(context);
  const dependencies = createNodeAtomicOutputTransactionDependencies();
  const replacementBytes = Buffer.from([0xfa, 0xce, 0xb0, 0x0c]);
  let publishCount = 0;
  let firstStagedPath: string | undefined;
  let firstDestinationPath: string | undefined;
  const manager = new AtomicOutputTransactionManager({
    ...dependencies,
    createTransactionId: () => transactionId(21),
    publishFile: async (stagedPath, destinationPath) => {
      publishCount += 1;
      if (publishCount === 1) {
        firstStagedPath = stagedPath;
        firstDestinationPath = destinationPath;
        await dependencies.publishFile(stagedPath, destinationPath);
        return;
      }

      assert.ok(firstStagedPath);
      assert.ok(firstDestinationPath);
      assert.equal(await exists(firstStagedPath), true);
      await rm(firstDestinationPath, { force: true });
      await writeFile(firstDestinationPath, replacementBytes, { flag: "wx" });
      const error = new Error("errore successivo alla sostituzione") as NodeJS.ErrnoException;
      error.code = "EIO";
      throw error;
    },
  });
  const currentTransactionId = await manager.begin(outputPath, OWNER_ID);
  await manager.stage(OWNER_ID, currentTransactionId, "pagina-001.jpg", new Uint8Array([0x01]));
  await manager.stage(OWNER_ID, currentTransactionId, "pagina-002.jpg", new Uint8Array([0x02]));

  await assert.rejects(manager.commit(OWNER_ID, currentTransactionId), /errore successivo alla sostituzione/);

  assert.ok(firstDestinationPath);
  assert.deepEqual(await readFile(firstDestinationPath), replacementBytes);
  assert.equal(await exists(join(outputPath, "pagina-002.jpg")), false);
  assert.equal((await readdir(outputPath)).some((name) => name.startsWith(".filex-stage-")), false);
});

test("il rollback esplicito elimina lo staging senza pubblicare file", async (context) => {
  const outputPath = await createSandbox(context);
  const manager = new AtomicOutputTransactionManager({ createTransactionId: () => transactionId(30) });
  const currentTransactionId = await manager.begin(outputPath, OWNER_ID);
  await manager.stage(OWNER_ID, currentTransactionId, "pagina.jpg", new Uint8Array([0x01, 0x02]));

  assert.equal(await manager.rollback(OWNER_ID, currentTransactionId), true);
  assert.equal(await manager.rollback(OWNER_ID, currentTransactionId), true);
  assert.deepEqual(await readdir(outputPath), []);
});

test("dopo il commit conserva journal e hard-link staged finché il renderer non finalizza", async (context) => {
  const outputPath = await createSandbox(context);
  const currentTransactionId = transactionId(31);
  const manager = new AtomicOutputTransactionManager({
    createTransactionId: () => currentTransactionId,
  });
  await manager.begin(outputPath, OWNER_ID);
  await manager.stage(OWNER_ID, currentTransactionId, "pagina.jpg", new Uint8Array([0x01, 0x02]));

  const savedNames = await manager.commit(OWNER_ID, currentTransactionId);
  const stagingPath = stagingDirectoryPath(outputPath, currentTransactionId);
  const stagingNames = await readdir(stagingPath);

  assert.deepEqual(savedNames, ["pagina.jpg"]);
  assert.ok(stagingNames.includes(".filex-transaction.json"));
  assert.ok(stagingNames.some((name) => /^\.filex-publish-\d{12}\.json$/.test(name)));
  assert.ok(stagingNames.some((name) => /^\d{8}-[a-f0-9]{32}\.tmp$/.test(name)));

  // Finché manca l'acknowledgement, il chiamante può ancora annullare in modo
  // verificabile anche se commit() ha già restituito i nomi definitivi.
  assert.equal(await manager.rollback(OWNER_ID, currentTransactionId), true);
  assert.equal(await exists(join(outputPath, "pagina.jpg")), false);
  assert.equal(await exists(stagingPath), false);
});

test("finalize autentica l'acknowledgement e non fallisce se la pulizia staging è bloccata", async (context) => {
  const outputPath = await createSandbox(context);
  const dependencies = createNodeAtomicOutputTransactionDependencies();
  const oldTime = 2_000_000_000_000 - DEFAULT_STALE_TRANSACTION_AGE_MS - 60_000;
  const recoveryTime = 2_000_000_000_000;
  const currentTransactionId = transactionId(32);
  let blockStagingCleanup = false;
  const manager = new AtomicOutputTransactionManager({
    ...dependencies,
    createTransactionId: () => currentTransactionId,
    processId: 91_032,
    now: () => oldTime,
    removeEmptyDirectory: async (path) => {
      if (blockStagingCleanup && path === stagingDirectoryPath(outputPath, currentTransactionId)) {
        const error = new Error("staging occupato") as NodeJS.ErrnoException;
        error.code = "EBUSY";
        throw error;
      }
      await dependencies.removeEmptyDirectory(path);
    },
  });
  await manager.begin(outputPath, OWNER_ID);
  await manager.stage(OWNER_ID, currentTransactionId, "pagina.jpg", new Uint8Array([0xaa, 0xbb]));
  await manager.commit(OWNER_ID, currentTransactionId);
  blockStagingCleanup = true;

  await assert.doesNotReject(manager.finalize(OWNER_ID, currentTransactionId));

  const stagingPath = stagingDirectoryPath(outputPath, currentTransactionId);
  assert.deepEqual(await readdir(stagingPath), []);
  assert.deepEqual(await readFile(join(outputPath, "pagina.jpg")), Buffer.from([0xaa, 0xbb]));

  // Un nuovo processo riconosce l'ack valido: elimina solo lo staging rimasto
  // e non considera mai il nome finale come candidato al rollback.
  const recoveryManager = new AtomicOutputTransactionManager({
    ...dependencies,
    now: () => recoveryTime,
    isProcessActive: async () => false,
  });
  const recovery = await recoveryManager.recoverStaleTransactions(outputPath);
  assert.deepEqual(recovery.removed, [stagingPath]);
  assert.equal(await exists(stagingPath), false);
  assert.deepEqual(await readFile(join(outputPath, "pagina.jpg")), Buffer.from([0xaa, 0xbb]));
});

test("riprende dopo il riavvio il finalize legato al pending senza duplicare l'output", async (context) => {
  const outputPath = await createSandbox(context);
  const dependencies = createNodeAtomicOutputTransactionDependencies();
  const currentTransactionId = transactionId(320);
  const crashedManager = new AtomicOutputTransactionManager({
    ...dependencies,
    createTransactionId: () => currentTransactionId,
    processId: 91_320,
  });
  await crashedManager.begin(outputPath, OWNER_ID);
  await crashedManager.stage(OWNER_ID, currentTransactionId, "pagina.jpg", new Uint8Array([0x32, 0x00]));
  const savedNames = await crashedManager.commit(OWNER_ID, currentTransactionId);

  const restartedManager = new AtomicOutputTransactionManager({
    ...dependencies,
    isProcessActive: async () => false,
  });
  await restartedManager.finalize(OWNER_ID + 1, currentTransactionId, {
    directoryPath: outputPath,
    expectedFileNames: savedNames,
  });

  assert.deepEqual(await readFile(join(outputPath, "pagina.jpg")), Buffer.from([0x32, 0x00]));
  assert.equal(await exists(stagingDirectoryPath(outputPath, currentTransactionId)), false);
});

test("il finalize recuperato ignora gli intent falliti per collisione e conferma il nome pubblicato", async (context) => {
  const outputPath = await createSandbox(context);
  const dependencies = createNodeAtomicOutputTransactionDependencies();
  const currentTransactionId = transactionId(321);
  let raced = false;
  const crashedManager = new AtomicOutputTransactionManager({
    ...dependencies,
    createTransactionId: () => currentTransactionId,
    processId: 91_321,
    publishFile: async (stagedPath, destinationPath) => {
      if (!raced && destinationPath.endsWith("pagina.jpg")) {
        raced = true;
        await writeFile(destinationPath, Buffer.from([0xee]), { flag: "wx" });
      }
      await dependencies.publishFile(stagedPath, destinationPath);
    },
  });
  await crashedManager.begin(outputPath, OWNER_ID);
  await crashedManager.stage(OWNER_ID, currentTransactionId, "pagina.jpg", new Uint8Array([0x32, 0x01]));
  const savedNames = await crashedManager.commit(OWNER_ID, currentTransactionId);
  assert.deepEqual(savedNames, ["pagina-2.jpg"]);

  const restartedManager = new AtomicOutputTransactionManager({
    ...dependencies,
    isProcessActive: async () => false,
  });
  await restartedManager.finalize(OWNER_ID + 1, currentTransactionId, {
    directoryPath: outputPath,
    expectedFileNames: savedNames,
  });

  assert.deepEqual(await readFile(join(outputPath, "pagina.jpg")), Buffer.from([0xee]));
  assert.deepEqual(await readFile(join(outputPath, "pagina-2.jpg")), Buffer.from([0x32, 0x01]));
});

test("un errore restituito dopo la scrittura dell'ack non può innescare il rollback", async (context) => {
  const outputPath = await createSandbox(context);
  const dependencies = createNodeAtomicOutputTransactionDependencies();
  const currentTransactionId = transactionId(322);
  const manager = new AtomicOutputTransactionManager({
    ...dependencies,
    createTransactionId: () => currentTransactionId,
    writeTextFileExclusive: async (filePath, contents) => {
      await dependencies.writeTextFileExclusive(filePath, contents);
      if (filePath.endsWith(".filex-acknowledged")) throw new Error("close ambiguo simulato");
    },
  });
  await manager.begin(outputPath, OWNER_ID);
  await manager.stage(OWNER_ID, currentTransactionId, "pagina.jpg", new Uint8Array([0x32, 0x02]));
  await manager.commit(OWNER_ID, currentTransactionId);

  await assert.doesNotReject(manager.finalize(OWNER_ID, currentTransactionId));
  await assert.doesNotReject(manager.rollback(OWNER_ID, currentTransactionId));
  assert.deepEqual(await readFile(join(outputPath, "pagina.jpg")), Buffer.from([0x32, 0x02]));
});

test("recovery rifiuta un marker acknowledgement non autenticato", async (context) => {
  const outputPath = await createSandbox(context);
  const dependencies = createNodeAtomicOutputTransactionDependencies();
  const oldTime = 2_000_000_000_000 - DEFAULT_STALE_TRANSACTION_AGE_MS - 60_000;
  const currentTransactionId = transactionId(33);
  let blockStagingCleanup = false;
  const manager = new AtomicOutputTransactionManager({
    ...dependencies,
    createTransactionId: () => currentTransactionId,
    processId: 91_033,
    now: () => oldTime,
    removePath: async (path, recursive) => {
      if (blockStagingCleanup && path.endsWith(".filex-transaction.json")) {
        throw new Error("cleanup rimandato");
      }
      await dependencies.removePath(path, recursive);
    },
  });
  await manager.begin(outputPath, OWNER_ID);
  await manager.stage(OWNER_ID, currentTransactionId, "pagina.jpg", new Uint8Array([0x33]));
  await manager.commit(OWNER_ID, currentTransactionId);
  blockStagingCleanup = true;
  await manager.finalize(OWNER_ID, currentTransactionId);

  const stagingPath = stagingDirectoryPath(outputPath, currentTransactionId);
  await writeFile(join(stagingPath, ".filex-acknowledged"), "{}", "utf8");
  const recoveryManager = new AtomicOutputTransactionManager({
    ...dependencies,
    now: () => 2_000_000_000_000,
    isProcessActive: async () => false,
  });
  const recovery = await recoveryManager.recoverStaleTransactions(outputPath);

  assert.deepEqual(recovery.rejected, [stagingPath]);
  assert.equal(await exists(stagingPath), true);
  assert.deepEqual(await readFile(join(outputPath, "pagina.jpg")), Buffer.from([0x33]));
});

test("rileva e segnala un rollback incompleto invece di dichiararlo riuscito", async (context) => {
  const outputPath = await createSandbox(context);
  const dependencies = createNodeAtomicOutputTransactionDependencies();
  let publishCount = 0;
  const manager = new AtomicOutputTransactionManager({
    ...dependencies,
    createTransactionId: () => transactionId(40),
    publishFile: async (stagedPath, destinationPath) => {
      publishCount += 1;
      if (publishCount === 2) throw new Error("stop commit");
      return dependencies.publishFile(stagedPath, destinationPath);
    },
    movePath: async (sourcePath, destinationPath) => {
      if (sourcePath.endsWith("pagina.jpg")) {
        throw new Error("nome finale temporaneamente bloccato");
      }
      await dependencies.movePath(sourcePath, destinationPath);
    },
  });
  const currentTransactionId = await manager.begin(outputPath, OWNER_ID);
  await manager.stage(OWNER_ID, currentTransactionId, "pagina.jpg", new Uint8Array([0x01]));
  await manager.stage(OWNER_ID, currentTransactionId, "seconda.jpg", new Uint8Array([0x02]));

  await assert.rejects(
    manager.commit(OWNER_ID, currentTransactionId),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /rollback incompleto/i);
      assert.ok(error.errors.some((entry) => entry instanceof AtomicOutputRollbackError));
      return true;
    },
  );
  assert.equal(await exists(join(outputPath, "pagina.jpg")), true);
});

test("recovery annulla un crash dopo una pubblicazione parziale usando il journal durabile", async (context) => {
  const outputPath = await createSandbox(context);
  const dependencies = createNodeAtomicOutputTransactionDependencies();
  const currentTime = 2_000_000_000_000;
  const currentTransactionId = transactionId(41);
  let publishCount = 0;
  let notifySecondPublish!: () => void;
  let releaseSecondPublish!: () => void;
  const secondPublishStarted = new Promise<void>((resolveStarted) => { notifySecondPublish = resolveStarted; });
  const secondPublishGate = new Promise<void>((resolveGate) => { releaseSecondPublish = resolveGate; });
  const crashedManager = new AtomicOutputTransactionManager({
    ...dependencies,
    createTransactionId: () => currentTransactionId,
    processId: 91_041,
    now: () => currentTime - 1_000,
    publishFile: async (stagedPath, destinationPath) => {
      publishCount += 1;
      if (publishCount === 2) {
        notifySecondPublish();
        await secondPublishGate;
      }
      await dependencies.publishFile(stagedPath, destinationPath);
    },
  });
  await crashedManager.begin(outputPath, OWNER_ID);
  await crashedManager.stage(OWNER_ID, currentTransactionId, "pagina-001.jpg", new Uint8Array([0x01]));
  await crashedManager.stage(OWNER_ID, currentTransactionId, "pagina-002.jpg", new Uint8Array([0x02]));

  const interruptedCommit = crashedManager.commit(OWNER_ID, currentTransactionId);
  await secondPublishStarted;
  const stagingPath = stagingDirectoryPath(outputPath, currentTransactionId);
  const intentNames = (await readdir(stagingPath))
    .filter((name) => /^\.filex-publish-\d{12}\.json$/.test(name))
    .sort();
  assert.equal(intentNames.length, 2);
  const intents = await Promise.all(intentNames.map(async (name) => JSON.parse(
    await readFile(join(stagingPath, name), "utf8"),
  ) as { transactionId?: unknown; stagedFileName?: unknown; destinationFileName?: unknown; fileIdentity?: unknown }));
  assert.deepEqual(intents.map((intent) => intent.destinationFileName), ["pagina-001.jpg", "pagina-002.jpg"]);
  assert.ok(intents.every((intent) => intent.transactionId === currentTransactionId));
  assert.ok(intents.every((intent) => typeof intent.stagedFileName === "string" && typeof intent.fileIdentity === "string"));
  assert.equal(await exists(join(outputPath, "pagina-001.jpg")), true);
  assert.equal(await exists(join(outputPath, "pagina-002.jpg")), false);

  const recoveryManager = new AtomicOutputTransactionManager({
    ...dependencies,
    now: () => currentTime,
    isProcessActive: async () => false,
  });
  const recovery = await recoveryManager.recoverStaleTransactions(outputPath);
  assert.deepEqual(recovery.removed, [stagingPath]);
  assert.equal(await exists(join(outputPath, "pagina-001.jpg")), false);
  assert.equal(await exists(join(outputPath, "pagina-002.jpg")), false);
  assert.equal(await exists(stagingPath), false);

  releaseSecondPublish();
  await assert.rejects(interruptedCommit);
});

test("recovery preserva una destinazione esterna che ha sostituito l'hard-link pubblicato", async (context) => {
  const outputPath = await createSandbox(context);
  const dependencies = createNodeAtomicOutputTransactionDependencies();
  const currentTime = 2_000_000_000_000;
  const currentTransactionId = transactionId(42);
  const replacementBytes = Buffer.from([0xca, 0xfe, 0xba, 0xbe]);
  let publishCount = 0;
  let notifySecondPublish!: () => void;
  let releaseSecondPublish!: () => void;
  const secondPublishStarted = new Promise<void>((resolveStarted) => { notifySecondPublish = resolveStarted; });
  const secondPublishGate = new Promise<void>((resolveGate) => { releaseSecondPublish = resolveGate; });
  const crashedManager = new AtomicOutputTransactionManager({
    ...dependencies,
    createTransactionId: () => currentTransactionId,
    processId: 91_042,
    now: () => currentTime - 1_000,
    publishFile: async (stagedPath, destinationPath) => {
      publishCount += 1;
      if (publishCount === 2) {
        notifySecondPublish();
        await secondPublishGate;
      }
      await dependencies.publishFile(stagedPath, destinationPath);
    },
  });
  await crashedManager.begin(outputPath, OWNER_ID);
  await crashedManager.stage(OWNER_ID, currentTransactionId, "pagina-001.jpg", new Uint8Array([0x01]));
  await crashedManager.stage(OWNER_ID, currentTransactionId, "pagina-002.jpg", new Uint8Array([0x02]));

  const interruptedCommit = crashedManager.commit(OWNER_ID, currentTransactionId);
  await secondPublishStarted;
  const firstDestinationPath = join(outputPath, "pagina-001.jpg");
  await rm(firstDestinationPath, { force: true });
  await writeFile(firstDestinationPath, replacementBytes, { flag: "wx" });

  const recoveryManager = new AtomicOutputTransactionManager({
    ...dependencies,
    now: () => currentTime,
    isProcessActive: async () => false,
  });
  const recovery = await recoveryManager.recoverStaleTransactions(outputPath);
  const stagingPath = stagingDirectoryPath(outputPath, currentTransactionId);

  assert.deepEqual(recovery.removed, [stagingPath]);
  assert.deepEqual(await readFile(firstDestinationPath), replacementBytes);
  assert.equal(await exists(join(outputPath, "pagina-002.jpg")), false);
  assert.equal(await exists(stagingPath), false);

  releaseSecondPublish();
  await assert.rejects(interruptedCommit, /rollback incompleto/i);
  assert.deepEqual(await readFile(firstDestinationPath), replacementBytes);
});

test("recovery ripristina un file esterno se il processo cade dopo averlo spostato in quarantena", async (context) => {
  const outputPath = await createSandbox(context);
  const dependencies = createNodeAtomicOutputTransactionDependencies();
  const currentTransactionId = transactionId(43);
  const replacementBytes = Buffer.from([0x43, 0xca, 0xfe]);
  let publishCount = 0;
  let crashInjected = false;
  const manager = new AtomicOutputTransactionManager({
    ...dependencies,
    createTransactionId: () => currentTransactionId,
    processId: 91_043,
    publishFile: async (stagedPath, destinationPath) => {
      publishCount += 1;
      if (publishCount === 2) throw new Error("stop commit");
      await dependencies.publishFile(stagedPath, destinationPath);
    },
    movePath: async (sourcePath, destinationPath) => {
      if (!crashInjected && sourcePath.endsWith("pagina-001.jpg")) {
        crashInjected = true;
        await rm(sourcePath, { force: true });
        await writeFile(sourcePath, replacementBytes, { flag: "wx" });
        await dependencies.movePath(sourcePath, destinationPath);
        throw new Error("crash simulato dopo rename");
      }
      await dependencies.movePath(sourcePath, destinationPath);
    },
  });
  await manager.begin(outputPath, OWNER_ID);
  await manager.stage(OWNER_ID, currentTransactionId, "pagina-001.jpg", new Uint8Array([0x01]));
  await manager.stage(OWNER_ID, currentTransactionId, "pagina-002.jpg", new Uint8Array([0x02]));

  await assert.rejects(manager.commit(OWNER_ID, currentTransactionId), /rollback incompleto/i);

  const destinationPath = join(outputPath, "pagina-001.jpg");
  const stagingPath = stagingDirectoryPath(outputPath, currentTransactionId);
  const stagingNames = await readdir(stagingPath);
  assert.equal(await exists(destinationPath), false);
  assert.ok(stagingNames.includes(".filex-rollback-000000000001.json"));
  assert.ok(stagingNames.includes(".filex-rollback-000000000001.tmp"));

  const recoveryManager = new AtomicOutputTransactionManager({
    ...dependencies,
    isProcessActive: async () => false,
  });
  await assert.rejects(
    recoveryManager.finalize(OWNER_ID + 1, currentTransactionId, {
      directoryPath: outputPath,
      expectedFileNames: ["pagina-001.jpg"],
    }),
    /rollback interrotto/i,
  );
  assert.deepEqual(
    await readFile(join(stagingPath, ".filex-rollback-000000000001.tmp")),
    replacementBytes,
  );
  const recovery = await recoveryManager.recoverStaleTransactions(outputPath);

  assert.deepEqual(recovery.removed, [stagingPath]);
  assert.equal(await exists(stagingPath), false);
  assert.deepEqual(await readFile(destinationPath), replacementBytes);
  assert.equal(await exists(join(outputPath, "pagina-002.jpg")), false);
});

test("isola le transazioni tra renderer diversi", async (context) => {
  const outputPath = await createSandbox(context);
  const manager = new AtomicOutputTransactionManager({ createTransactionId: () => transactionId(50) });
  const currentTransactionId = await manager.begin(outputPath, OWNER_ID);

  await assert.rejects(
    manager.stage(OWNER_ID + 1, currentTransactionId, "pagina.jpg", new Uint8Array([0x01])),
    /non trovata o non autorizzata/i,
  );
  await manager.rollbackOwner(OWNER_ID);
  assert.deepEqual(await readdir(outputPath), []);
});

test("recovery elimina solo uno staging vecchio con processo certamente terminato", async (context) => {
  const outputPath = await createSandbox(context);
  const dependencies = createNodeAtomicOutputTransactionDependencies();
  const currentTime = 2_000_000_000_000;
  const staleId = transactionId(60);
  const crashedManager = new AtomicOutputTransactionManager({
    ...dependencies,
    createTransactionId: () => staleId,
    now: () => currentTime - DEFAULT_STALE_TRANSACTION_AGE_MS - 60_000,
    processId: 91_001,
  });
  await crashedManager.begin(outputPath, OWNER_ID);
  await crashedManager.stage(OWNER_ID, staleId, "pagina.jpg", new Uint8Array([0x01]));

  const recoveryManager = new AtomicOutputTransactionManager({
    ...dependencies,
    now: () => currentTime,
    isProcessActive: async () => false,
  });
  const recovery = await recoveryManager.recoverStaleTransactions(outputPath);

  assert.deepEqual(recovery.removed, [stagingDirectoryPath(outputPath, staleId)]);
  assert.deepEqual(recovery.preserved, []);
  assert.deepEqual(recovery.rejected, []);
  assert.equal(await exists(stagingDirectoryPath(outputPath, staleId)), false);
});

test("recovery rifiuta un journal valido ma cambiato tra le due ispezioni", async (context) => {
  const outputPath = await createSandbox(context);
  const dependencies = createNodeAtomicOutputTransactionDependencies();
  const currentTime = 2_000_000_000_000;
  const staleId = transactionId(66);
  const crashedManager = new AtomicOutputTransactionManager({
    ...dependencies,
    createTransactionId: () => staleId,
    now: () => currentTime - DEFAULT_STALE_TRANSACTION_AGE_MS - 60_000,
    processId: 91_066,
  });
  await crashedManager.begin(outputPath, OWNER_ID);
  await crashedManager.stage(OWNER_ID, staleId, "pagina.jpg", new Uint8Array([0x66]));
  await crashedManager.commit(OWNER_ID, staleId);

  const stagingPath = stagingDirectoryPath(outputPath, staleId);
  const intentName = (await readdir(stagingPath)).find((name) => /^\.filex-publish-\d{12}\.json$/.test(name));
  assert.ok(intentName);
  const intentPath = join(stagingPath, intentName);
  const recoveryManager = new AtomicOutputTransactionManager({
    ...dependencies,
    now: () => currentTime,
    isProcessActive: async () => {
      const intent = JSON.parse(await readFile(intentPath, "utf8")) as Record<string, unknown>;
      await writeFile(intentPath, `${JSON.stringify({ ...intent, destinationFileName: "pagina-alterata.jpg" }, null, 2)}\n`, "utf8");
      return false;
    },
  });
  const recovery = await recoveryManager.recoverStaleTransactions(outputPath);

  assert.deepEqual(recovery.rejected, [stagingPath]);
  assert.equal(await exists(stagingPath), true);
  assert.deepEqual(await readFile(join(outputPath, "pagina.jpg")), Buffer.from([0x66]));
});

test("begin esegue automaticamente il recovery prima di creare il nuovo staging", async (context) => {
  const outputPath = await createSandbox(context);
  const dependencies = createNodeAtomicOutputTransactionDependencies();
  const currentTime = 2_000_000_000_000;
  const staleId = transactionId(64);
  const nextId = transactionId(65);
  const crashedManager = new AtomicOutputTransactionManager({
    ...dependencies,
    createTransactionId: () => staleId,
    now: () => currentTime - DEFAULT_STALE_TRANSACTION_AGE_MS - 60_000,
    processId: 91_004,
  });
  await crashedManager.begin(outputPath, OWNER_ID);

  const nextManager = new AtomicOutputTransactionManager({
    ...dependencies,
    createTransactionId: () => nextId,
    now: () => currentTime,
    isProcessActive: async () => false,
  });
  const openedId = await nextManager.begin(outputPath, OWNER_ID + 1);

  assert.equal(openedId, nextId);
  assert.equal(await exists(stagingDirectoryPath(outputPath, staleId)), false);
  assert.equal(await exists(stagingDirectoryPath(outputPath, nextId)), true);
  await nextManager.rollback(OWNER_ID + 1, nextId);
});

test("recovery preserva staging recente anche se il processo non risponde", async (context) => {
  const outputPath = await createSandbox(context);
  const dependencies = createNodeAtomicOutputTransactionDependencies();
  const currentTime = 2_000_000_000_000;
  const recentId = transactionId(61);
  const firstManager = new AtomicOutputTransactionManager({
    ...dependencies,
    createTransactionId: () => recentId,
    now: () => currentTime - 60_000,
    processId: 91_002,
  });
  await firstManager.begin(outputPath, OWNER_ID);

  const recoveryManager = new AtomicOutputTransactionManager({
    ...dependencies,
    now: () => currentTime,
    isProcessActive: async () => false,
  });
  const recovery = await recoveryManager.recoverStaleTransactions(outputPath);

  assert.deepEqual(recovery.removed, []);
  assert.deepEqual(recovery.preserved, [stagingDirectoryPath(outputPath, recentId)]);
  assert.equal(await exists(stagingDirectoryPath(outputPath, recentId)), true);
});

test("recovery preserva staging vecchio appartenente a un processo ancora attivo", async (context) => {
  const outputPath = await createSandbox(context);
  const dependencies = createNodeAtomicOutputTransactionDependencies();
  const currentTime = 2_000_000_000_000;
  const activeId = transactionId(62);
  const activeProcessId = 91_003;
  const firstManager = new AtomicOutputTransactionManager({
    ...dependencies,
    createTransactionId: () => activeId,
    now: () => currentTime - DEFAULT_STALE_TRANSACTION_AGE_MS - 60_000,
    processId: activeProcessId,
  });
  await firstManager.begin(outputPath, OWNER_ID);

  const recoveryManager = new AtomicOutputTransactionManager({
    ...dependencies,
    now: () => currentTime,
    isProcessActive: async (processId) => processId === activeProcessId,
  });
  const recovery = await recoveryManager.recoverStaleTransactions(outputPath);

  assert.deepEqual(recovery.removed, []);
  assert.deepEqual(recovery.preserved, [stagingDirectoryPath(outputPath, activeId)]);
  assert.equal(await exists(stagingDirectoryPath(outputPath, activeId)), true);
});

test("recovery rifiuta uno staging symlink e non tocca la destinazione esterna", async (context) => {
  const outputPath = await createSandbox(context);
  const externalPath = join(outputPath, "external-target");
  const sentinelPath = join(externalPath, "non-toccare.txt");
  const linkedId = transactionId(63);
  const linkedPath = stagingDirectoryPath(outputPath, linkedId);
  await mkdir(externalPath);
  await writeFile(sentinelPath, "persistente", "utf8");
  try {
    await symlink(externalPath, linkedPath, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && ["EPERM", "EACCES"].includes(String(error.code))) {
      context.skip("La creazione di collegamenti non è consentita su questa macchina.");
      return;
    }
    throw error;
  }

  const recoveryManager = new AtomicOutputTransactionManager();
  const recovery = await recoveryManager.recoverStaleTransactions(outputPath);

  assert.deepEqual(recovery.removed, []);
  assert.deepEqual(recovery.rejected, [linkedPath]);
  assert.equal(await readFile(sentinelPath, "utf8"), "persistente");
  assert.equal(await exists(linkedPath), true);
});
