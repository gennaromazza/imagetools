import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import {
  cleanupIdPhotoWorkingFiles,
  createIdPhotoWorkingCopy,
  resolveIdPhotoDataRoot,
  resolveIdPhotoWorkingDirectory,
} from "./id-photo-working-files.js";

async function createSandbox(context: TestContext): Promise<string> {
  const sandboxPath = await mkdtemp(join(tmpdir(), "filex-id-photo-working-"));
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

test("usa una cartella locale del profilo su Windows e userData sugli altri sistemi", () => {
  const homePath = resolve("C:\\Users\\Studio");
  const userDataPath = resolve("C:\\Users\\Studio\\AppData\\Roaming\\FileX");
  assert.equal(
    resolveIdPhotoDataRoot("win32", homePath, userDataPath),
    resolve(homePath, "FileX-ID-Photo-Data"),
  );
  assert.equal(
    resolveIdPhotoDataRoot("darwin", homePath, userDataPath),
    resolve(userDataPath, "id-photo-data"),
  );
});

test("crea una copia byte per byte in una cartella FileX separata dall'originale", async (context) => {
  const sandboxPath = await createSandbox(context);
  const userDataPath = join(sandboxPath, "user-data");
  const sourceDirectoryPath = join(sandboxPath, "sorgenti");
  const sourcePath = join(sourceDirectoryPath, "Ritratto cliente.JPG");
  const sourceBytes = Buffer.from([0xff, 0xd8, 0x01, 0x02, 0x03, 0xff, 0xd9]);
  await mkdir(sourceDirectoryPath, { recursive: true });
  await writeFile(sourcePath, sourceBytes);

  const result = await createIdPhotoWorkingCopy(
    userDataPath,
    { jobId: "commessa-2026-001", sourcePath },
    { createUniqueId: () => "copy-one" },
  );

  const expectedWorkingDirectory = resolveIdPhotoWorkingDirectory(userDataPath, "commessa-2026-001");
  assert.equal(result.jobId, "commessa-2026-001");
  assert.equal(result.sourcePath, resolve(sourcePath));
  assert.equal(dirname(result.workingPath), expectedWorkingDirectory);
  assert.equal(basename(result.workingPath), "Ritratto-cliente-filex-work-copy-one.JPG");
  assert.notEqual(result.workingPath, result.sourcePath);
  assert.deepEqual(await readFile(result.workingPath), sourceBytes);
  assert.deepEqual(await readFile(sourcePath), sourceBytes);
});

test("non sovrascrive una copia esistente e risolve atomicamente le collisioni", async (context) => {
  const sandboxPath = await createSandbox(context);
  const userDataPath = join(sandboxPath, "user-data");
  const sourcePath = join(sandboxPath, "foto.png");
  await writeFile(sourcePath, "originale");

  const first = await createIdPhotoWorkingCopy(
    userDataPath,
    { jobId: "job-collision", sourcePath },
    { createUniqueId: () => "same-id" },
  );
  const identifiers = ["same-id", "different-id"];
  const second = await createIdPhotoWorkingCopy(
    userDataPath,
    { jobId: "job-collision", sourcePath },
    { createUniqueId: () => identifiers.shift() ?? "unexpected" },
  );

  assert.notEqual(first.workingPath, second.workingPath);
  assert.equal(await readFile(first.workingPath, "utf8"), "originale");
  assert.equal(await readFile(second.workingPath, "utf8"), "originale");
});

test("la pulizia elimina solo la cartella gestita della commessa richiesta", async (context) => {
  const sandboxPath = await createSandbox(context);
  const userDataPath = join(sandboxPath, "user-data");
  const sourcePath = join(sandboxPath, "originale.tif");
  const unrelatedPath = join(userDataPath, "id-photo", "non-toccare.txt");
  await mkdir(dirname(unrelatedPath), { recursive: true });
  await writeFile(sourcePath, "sorgente");
  await writeFile(unrelatedPath, "persistente");

  const jobA = await createIdPhotoWorkingCopy(
    userDataPath,
    { jobId: "job-a", sourcePath },
    { createUniqueId: () => "copy-a" },
  );
  const jobB = await createIdPhotoWorkingCopy(
    userDataPath,
    { jobId: "job-b", sourcePath },
    { createUniqueId: () => "copy-b" },
  );

  assert.deepEqual(await cleanupIdPhotoWorkingFiles(userDataPath, "job-a"), {
    jobId: "job-a",
    removed: true,
  });
  assert.equal(await exists(dirname(jobA.workingPath)), false);
  assert.equal(await exists(jobB.workingPath), true);
  assert.equal(await readFile(sourcePath, "utf8"), "sorgente");
  assert.equal(await readFile(unrelatedPath, "utf8"), "persistente");
  assert.deepEqual(await cleanupIdPhotoWorkingFiles(userDataPath, "job-a"), {
    jobId: "job-a",
    removed: false,
  });
});

test("rifiuta job id e percorsi sorgente che potrebbero uscire dai confini gestiti", async (context) => {
  const sandboxPath = await createSandbox(context);
  const userDataPath = join(sandboxPath, "user-data");
  const sourcePath = join(sandboxPath, "originale.jpg");
  await writeFile(sourcePath, "sorgente");

  for (const invalidJobId of ["../escape", "..", "JOB-UPPERCASE", "job/con-slash", "", "a".repeat(65)]) {
    await assert.rejects(
      createIdPhotoWorkingCopy(userDataPath, { jobId: invalidJobId, sourcePath }),
      /ID commessa non valido/,
    );
    await assert.rejects(
      cleanupIdPhotoWorkingFiles(userDataPath, invalidJobId),
      /ID commessa non valido/,
    );
  }

  await assert.rejects(
    createIdPhotoWorkingCopy(userDataPath, { jobId: "job-ok", sourcePath: "foto-relativa.jpg" }),
    /percorso assoluto/,
  );
  assert.equal(await readFile(sourcePath, "utf8"), "sorgente");
});

test("la pulizia non elimina un file inatteso al posto della cartella commessa", async (context) => {
  const sandboxPath = await createSandbox(context);
  const userDataPath = join(sandboxPath, "user-data");
  const jobDirectoryPath = resolveIdPhotoWorkingDirectory(userDataPath, "job-file-guard");
  await mkdir(dirname(jobDirectoryPath), { recursive: true });
  await writeFile(jobDirectoryPath, "non-e-una-cartella");

  await assert.rejects(
    cleanupIdPhotoWorkingFiles(userDataPath, "job-file-guard"),
    /non è una cartella/,
  );
  assert.equal(await readFile(jobDirectoryPath, "utf8"), "non-e-una-cartella");
});

test("non segue una radice ID Photo collegata a una cartella esterna", async (context) => {
  const sandboxPath = await createSandbox(context);
  const userDataPath = join(sandboxPath, "user-data");
  const externalPath = join(sandboxPath, "esterna");
  const sourcePath = join(sandboxPath, "originale.jpg");
  const linkedIdPhotoPath = join(userDataPath, "id-photo");
  await mkdir(userDataPath, { recursive: true });
  await mkdir(externalPath, { recursive: true });
  await writeFile(sourcePath, "sorgente");
  await writeFile(join(externalPath, "non-toccare.txt"), "persistente");

  try {
    await symlink(externalPath, linkedIdPhotoPath, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && ["EPERM", "EACCES"].includes(String(error.code))) {
      context.skip("La creazione di collegamenti non è consentita su questa macchina.");
      return;
    }
    throw error;
  }

  await assert.rejects(
    createIdPhotoWorkingCopy(userDataPath, { jobId: "job-link", sourcePath }),
    /Cartella ID Photo non sicura/,
  );
  await assert.rejects(
    cleanupIdPhotoWorkingFiles(userDataPath, "job-link"),
    /Cartella ID Photo non sicura/,
  );
  assert.equal(await exists(join(externalPath, "working")), false);
  assert.equal(await readFile(join(externalPath, "non-toccare.txt"), "utf8"), "persistente");
});
