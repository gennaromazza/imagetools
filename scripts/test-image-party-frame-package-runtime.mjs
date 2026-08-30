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
const temporaryRoot = await mkdtemp(join(tmpdir(), "filex-partyframe-package-test-"));
const verifier = join(root, "apps", "filex-desktop", "scripts", "verify-packaged-component.mjs");

try {
  const mainSource = await readFile(
    join(root, "apps", "filex-desktop", "src", "main.ts"),
    "utf8",
  );
  const serverTsConfig = await readFile(
    join(root, "apps", "image-party-frame", "tsconfig.server.json"),
    "utf8",
  );
  const copyScript = await readFile(
    join(root, "apps", "filex-desktop", "scripts", "copy-image-party-frame-server.mjs"),
    "utf8",
  );

  assert.match(
    mainSource,
    /image-party-frame-server", "server", "index\.js"/u,
    "Il main process non punta all'entrypoint compilato del server PartyFrame.",
  );
  assert.match(
    serverTsConfig,
    /"rootDir": "\."/u,
    "La struttura dell'output del server PartyFrame non e' deterministica.",
  );
  assert.match(
    copyScript,
    /image-party-frame-server", "server"/u,
    "La build desktop non copia il server PartyFrame nella destinazione attesa.",
  );

  const validArchive = await createFixtureArchive("valid", true);
  execFileSync(
    process.execPath,
    [verifier, "--component=image-party-frame", "--version=9.8.7", `--archive=${validArchive}`],
    { cwd: root, stdio: "pipe" },
  );

  const incompleteArchive = await createFixtureArchive("incomplete", false);
  const incompleteResult = runVerifier(incompleteArchive);
  assert.notEqual(incompleteResult.status, 0, "Un import locale assente deve bloccare il pacchetto PartyFrame.");
  assert.match(
    `${incompleteResult.stdout}${incompleteResult.stderr}`,
    /assente dall'ASAR/u,
    "Il verificatore non segnala l'import locale mancante.",
  );

  console.log("Image Party Frame package runtime: PASS");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function createFixtureArchive(name, includeTemplateCatalog) {
  const sourceDirectory = join(temporaryRoot, name);
  const archivePath = join(temporaryRoot, `${name}.asar`);
  const electronDirectory = join(sourceDirectory, ".output", "electron");
  const serverDirectory = join(electronDirectory, "image-party-frame-server", "server");
  await mkdir(serverDirectory, { recursive: true });
  await writeFile(
    join(sourceDirectory, "package.json"),
    JSON.stringify({
      name: "Image-Party-Frame",
      version: "9.8.7",
      main: ".output/electron/main.js",
    }),
    "utf8",
  );
  await writeFile(join(electronDirectory, "main.js"), "export {};\n", "utf8");
  await writeFile(join(serverDirectory, "index.js"), 'import "./app.js";\n', "utf8");
  await writeFile(join(serverDirectory, "app.js"), 'import "./jobs.js";\nimport "./pipeline.js";\n', "utf8");
  await writeFile(join(serverDirectory, "jobs.js"), 'import "./pipeline.js";\n', "utf8");
  await writeFile(join(serverDirectory, "pipeline.js"), 'import "./templateCatalog.js";\n', "utf8");
  if (includeTemplateCatalog) {
    await writeFile(join(serverDirectory, "templateCatalog.js"), "export {};\n", "utf8");
  }
  await createPackage(sourceDirectory, archivePath);
  return archivePath;
}

function runVerifier(archivePath) {
  return spawnSync(
    process.execPath,
    [verifier, "--component=image-party-frame", "--version=9.8.7", `--archive=${archivePath}`],
    { cwd: root, encoding: "utf8", stdio: "pipe" },
  );
}
