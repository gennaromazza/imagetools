import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const prepareScript = join(repoRoot, "scripts", "prepare-component-release.mjs");
const validateScript = join(repoRoot, "scripts", "validate-component-release.mjs");
const fixtureRoot = await mkdtemp(join(tmpdir(), "filex-release-flow-"));

try {
  const packagePath = join(fixtureRoot, "apps", "filex-send", "package.json");
  const notesPath = join(fixtureRoot, "apps", "filex-desktop", "release-notes.json");
  const changelogPath = join(fixtureRoot, "CHANGELOG.md");
  await Promise.all([mkdir(dirname(packagePath), { recursive: true }), mkdir(dirname(notesPath), { recursive: true })]);
  await Promise.all([
    writeFile(packagePath, '{\n  "name": "@photo-tools/filex-send",\n  "version": "0.1.0"\n}\n'),
    writeFile(changelogPath, "# Changelog\n\n## 2026-01-01 - FileX Send 0.1.0\n\n- Versione iniziale.\n"),
    writeFile(notesPath, '{\n  "filex-send": {\n    "0.1.0": ["Versione iniziale."]\n  }\n}\n'),
  ]);

  run(prepareScript, ["filex-send", "apps/filex-send/package.json", "FileX Send", "0.1.1", "Correzione completa del flusso release."]);
  run(validateScript, ["filex-send", "0.1.1"]);
  const firstSnapshot = await snapshot(packagePath, changelogPath, notesPath);
  assert.equal(JSON.parse(firstSnapshot[0]).version, "0.1.1");
  assert.equal((firstSnapshot[1].match(/FileX Send 0\.1\.1/gu) ?? []).length, 1);
  assert.deepEqual(JSON.parse(firstSnapshot[2])["filex-send"]["0.1.1"], ["Correzione completa del flusso release."]);

  run(prepareScript, ["filex-send", "apps/filex-send/package.json", "FileX Send", "0.1.1", "Nota ignorata perché già pronta."]);
  assert.deepEqual(await snapshot(packagePath, changelogPath, notesPath), firstSnapshot, "La preparazione ripetuta deve essere idempotente.");

  const invalid = run(prepareScript, ["filex-send", "apps/filex-send/package.json", "FileX Send", "0.1.3", "Salto versione non valido."], false);
  assert.notEqual(invalid.status, 0, "Il salto di versione deve essere respinto.");
  assert.deepEqual(await snapshot(packagePath, changelogPath, notesPath), firstSnapshot, "Un errore non deve lasciare modifiche parziali.");

  console.log("Flusso release componente verificato: preparazione completa, idempotenza, preflight e rollback preventivo.");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

function run(script, args, requireSuccess = true) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: fixtureRoot, encoding: "utf8" });
  if (requireSuccess && result.status !== 0) throw new Error(`${result.stdout}${result.stderr}`);
  return result;
}

async function snapshot(...paths) {
  return Promise.all(paths.map((path) => readFile(path, "utf8")));
}
