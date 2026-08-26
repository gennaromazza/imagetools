import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createPackage } from "@electron/asar";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const temporaryRoot = await mkdtemp(join(tmpdir(), "filex-archivio-flow-package-test-"));
const verifier = join(root, "apps", "filex-desktop", "scripts", "verify-packaged-component.mjs");

try {
  const mainSource = await readFile(
    join(root, "apps", "filex-desktop", "src", "main.ts"),
    "utf8",
  );
  const serverTsConfig = await readFile(
    join(root, "apps", "archivio-flow", "server", "tsconfig.json"),
    "utf8",
  );
  assert.match(
    mainSource,
    /archivio-flow-server", "server", "index\.js"/u,
    "Il main process non punta all'entrypoint compilato del server Archivio Flow.",
  );
  assert.match(
    serverTsConfig,
    /"rootDir": "\.\."/u,
    "La struttura dell'output del server Archivio Flow non e' deterministica.",
  );

  const validArchive = await createFixtureArchive("valid", true);
  execFileSync(
    process.execPath,
    [verifier, "--component=archivio-flow", "--version=9.8.7", `--archive=${validArchive}`],
    { cwd: root, stdio: "pipe" },
  );

  const incompleteArchive = await createFixtureArchive("incomplete", false);
  const incompleteResult = runVerifier(incompleteArchive, false);
  assert.notEqual(incompleteResult.status, 0, "Un import locale assente deve bloccare il pacchetto Archivio Flow.");
  assert.match(
    `${incompleteResult.stdout}${incompleteResult.stderr}`,
    /assente dall'ASAR/u,
    "Il verificatore non segnala l'import locale mancante.",
  );

  console.log("Archivio Flow package runtime: PASS");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function createFixtureArchive(name, includeDependency) {
  const sourceDirectory = join(temporaryRoot, name);
  const archivePath = join(temporaryRoot, `${name}.asar`);
  const serverDirectory = join(
    sourceDirectory,
    ".output",
    "electron",
    "archivio-flow-server",
    "server",
  );
  await mkdir(serverDirectory, { recursive: true });
  await writeFile(
    join(sourceDirectory, "package.json"),
    JSON.stringify({
      name: "Archivio-Flow",
      version: "9.8.7",
      main: ".output/electron/main.js",
    }),
    "utf8",
  );
  await writeFile(
    join(sourceDirectory, ".output", "electron", "main.js"),
    "export {};\n",
    "utf8",
  );
  await writeFile(
    join(serverDirectory, "index.js"),
    'import "./runtime-dependency.js";\n',
    "utf8",
  );
  if (includeDependency) {
    await writeFile(join(serverDirectory, "runtime-dependency.js"), "export {};\n", "utf8");
  }
  await createPackage(sourceDirectory, archivePath);
  return archivePath;
}

function runVerifier(archivePath, requireSuccess = true) {
  const result = spawnSync(
    process.execPath,
    [verifier, "--component=archivio-flow", "--version=9.8.7", `--archive=${archivePath}`],
    { cwd: root, encoding: "utf8", stdio: "pipe" },
  );
  if (requireSuccess && result.status !== 0) {
    throw new Error(`${result.stdout}${result.stderr}`);
  }
  return result;
}
