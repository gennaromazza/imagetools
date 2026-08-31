import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { fingerprintFilesDesktop } from "./id-photo-file-fingerprint.js";

async function createSandbox(context: TestContext): Promise<string> {
  const sandboxPath = await mkdtemp(join(tmpdir(), "filex-id-photo-fingerprint-"));
  context.after(async () => {
    const resolvedSandboxPath = resolve(sandboxPath);
    const relativeToTemp = relative(resolve(tmpdir()), resolvedSandboxPath);
    assert.ok(relativeToTemp && !relativeToTemp.startsWith("..") && !isAbsolute(relativeToTemp));
    await rm(resolvedSandboxPath, { recursive: true, force: true });
  });
  return sandboxPath;
}

test("calcola SHA-256 e metadati reali del file esportato", async (context) => {
  const sandboxPath = await createSandbox(context);
  const filePath = join(sandboxPath, "Fototessera.pdf");
  const bytes = Buffer.from("FileX ID Photo\nPDF sintetico\u0000", "utf8");
  await writeFile(filePath, bytes);

  const [fingerprint] = await fingerprintFilesDesktop([filePath]);
  const fileStat = await stat(filePath);

  assert.equal(fingerprint.name, "Fototessera.pdf");
  assert.equal(fingerprint.absolutePath, resolve(filePath));
  assert.equal(fingerprint.size, bytes.length);
  assert.equal(fingerprint.lastModified, fileStat.mtimeMs);
  assert.equal(fingerprint.sha256, createHash("sha256").update(bytes).digest("hex"));
});

test("deduplica i percorsi equivalenti e ignora file scomparsi o cartelle", async (context) => {
  const sandboxPath = await createSandbox(context);
  const filePath = join(sandboxPath, "foglio.jpg");
  const directoryPath = join(sandboxPath, "cartella");
  await writeFile(filePath, "foglio");
  await mkdir(directoryPath);

  const equivalentPath = join(sandboxPath, ".", "foglio.jpg");
  const missingPath = join(sandboxPath, "mancante.pdf");
  const fingerprints = await fingerprintFilesDesktop([filePath, equivalentPath, missingPath, directoryPath]);

  assert.equal(fingerprints.length, 1);
  assert.equal(fingerprints[0]?.absolutePath, resolve(filePath));
});

test("rifiuta batch vuoti, troppo grandi e percorsi non assoluti", async () => {
  await assert.rejects(fingerprintFilesDesktop([]), /da 1 a 500 file/);
  await assert.rejects(
    fingerprintFilesDesktop(Array.from({ length: 501 }, (_, index) => resolve(`file-${index}.pdf`))),
    /da 1 a 500 file/,
  );
  await assert.rejects(fingerprintFilesDesktop(["Fototessera.pdf"]), /Percorso di verifica non valido/);
});

test("interrompe l'intero batch se un accesso al disco resta bloccato", async (context) => {
  const sandboxPath = await createSandbox(context);
  const filePath = join(sandboxPath, "output-lento.pdf");
  await writeFile(filePath, "output");
  const never = new Promise<never>(() => undefined);

  await assert.rejects(
    fingerprintFilesDesktop([filePath], {
      timeoutMs: 25,
      statFile: async () => never,
    }),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "ETIMEDOUT"
      && /Tempo massimo/.test(error.message),
  );
});

test("rifiuta una sostituzione del path anche con dimensione e mtime invariati", async (context) => {
  const sandboxPath = await createSandbox(context);
  const filePath = join(sandboxPath, "output-sostituito.pdf");
  await writeFile(filePath, "output-A");
  const originalStat = await stat(filePath);
  // Su Windows l'inode può superare Number.MAX_SAFE_INTEGER: +1 può quindi
  // arrotondare allo stesso valore. Usa una distanza rappresentabile.
  const replacementInode = originalStat.ino + Math.max(
    1,
    Math.abs(originalStat.ino) * Number.EPSILON * 4,
  );
  let callCount = 0;

  await assert.rejects(
    fingerprintFilesDesktop([filePath], {
      statFile: async () => {
        callCount += 1;
        if (callCount === 1) return originalStat;
        return new Proxy(originalStat, {
          get(target, property, receiver) {
            if (property === "ino") return replacementInode;
            return Reflect.get(target, property, receiver);
          },
        });
      },
    }),
    /cambiato durante la verifica/,
  );
});

test("rifiuta una riscrittura in-place rilevata dal ctime", async (context) => {
  const sandboxPath = await createSandbox(context);
  const filePath = join(sandboxPath, "output-riscritto.pdf");
  await writeFile(filePath, "output-B");
  const originalStat = await stat(filePath);
  let callCount = 0;

  await assert.rejects(
    fingerprintFilesDesktop([filePath], {
      statFile: async () => {
        callCount += 1;
        if (callCount === 1) return originalStat;
        return new Proxy(originalStat, {
          get(target, property, receiver) {
            if (property === "ctimeMs") return target.ctimeMs + 1;
            return Reflect.get(target, property, receiver);
          },
        });
      },
    }),
    /cambiato durante la verifica/,
  );
});
