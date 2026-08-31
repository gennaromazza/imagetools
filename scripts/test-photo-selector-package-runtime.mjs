import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createPackage } from "@electron/asar";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const temporaryRoot = await mkdtemp(join(tmpdir(), "filex-photo-selector-package-test-"));
const verifier = join(root, "apps", "filex-desktop", "scripts", "verify-packaged-component.mjs");

try {
  const nativeFolderSource = await readFile(
    join(root, "apps", "filex-desktop", "src", "native-folder-service.ts"),
    "utf8",
  );
  const mainSource = await readFile(
    join(root, "apps", "filex-desktop", "src", "main.ts"),
    "utf8",
  );
  const nativeImageSource = await readFile(
    join(root, "apps", "filex-desktop", "src", "native-image-service.ts"),
    "utf8",
  );
  const builderConfig = await readFile(
    join(root, "apps", "filex-desktop", "electron-builder.config.mjs"),
    "utf8",
  );
  assert.match(
    nativeFolderSource,
    /from "\.\/source-identity\.js"/u,
    "La scansione cartelle non usa il modulo di identità sorgente compilato.",
  );
  assert.match(
    mainSource,
    /from "\.\/psd-jpeg-conversion-service\.js"/u,
    "Il main process non carica il servizio di conversione PSD compilato.",
  );
  assert.match(
    mainSource,
    /--filex-photo-selector-packaged-smoke-test/u,
    "Il main process non espone lo smoke test dell'artefatto impacchettato.",
  );
  assert.match(
    nativeImageSource,
    /from "\.\/psd-image-service\.js"/u,
    "Le anteprime desktop non caricano il servizio PSD compilato.",
  );
  assert.match(
    builderConfig,
    /"\.output\/electron\/\*\*\/\*"/u,
    "La whitelist Electron non include la chiusura dei moduli runtime del main process.",
  );

  const validArchive = await createFixtureArchive("valid", { includeSourceIdentity: true, includePsdImageService: true });
  execFileSync(
    process.execPath,
    [verifier, "--component=photo-selector-app", "--version=9.8.7", `--archive=${validArchive}`],
    { cwd: root, stdio: "pipe" },
  );

  const incompleteArchive = await createFixtureArchive("missing-source-identity", { includeSourceIdentity: false, includePsdImageService: true });
  const incompleteResult = spawnSync(
    process.execPath,
    [verifier, "--component=photo-selector-app", "--version=9.8.7", `--archive=${incompleteArchive}`],
    { cwd: root, encoding: "utf8", stdio: "pipe" },
  );
  assert.notEqual(incompleteResult.status, 0, "L'assenza di source-identity.js deve bloccare il pacchetto.");
  assert.match(
    `${incompleteResult.stdout}${incompleteResult.stderr}`,
    /source-identity\.js, assente dall'ASAR/u,
    "Il verificatore non segnala la dipendenza runtime mancante.",
  );

  const missingPsdArchive = await createFixtureArchive("missing-psd-service", { includeSourceIdentity: true, includePsdImageService: false });
  const missingPsdResult = spawnSync(
    process.execPath,
    [verifier, "--component=photo-selector-app", "--version=9.8.7", `--archive=${missingPsdArchive}`],
    { cwd: root, encoding: "utf8", stdio: "pipe" },
  );
  assert.notEqual(missingPsdResult.status, 0, "L'assenza del servizio PSD deve bloccare il pacchetto.");
  assert.match(
    `${missingPsdResult.stdout}${missingPsdResult.stderr}`,
    /psd-image-service\.js, assente dall'ASAR/u,
    "Il verificatore non segnala il servizio PSD mancante.",
  );

  console.log("Image Select Pro package runtime: PASS");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function createFixtureArchive(name, { includeSourceIdentity, includePsdImageService }) {
  const sourceDirectory = join(temporaryRoot, name);
  const archivePath = join(temporaryRoot, `${name}.asar`);
  const electronDirectory = join(sourceDirectory, ".output", "electron");
  await mkdir(electronDirectory, { recursive: true });
  await writeFile(
    join(sourceDirectory, "package.json"),
    JSON.stringify({
      name: "Image-Select-Pro",
      version: "9.8.7",
      main: ".output/electron/main.js",
    }),
    "utf8",
  );
  const psdPackageDirectory = join(sourceDirectory, "node_modules", "ag-psd");
  await mkdir(join(psdPackageDirectory, "dist"), { recursive: true });
  await writeFile(join(psdPackageDirectory, "package.json"), JSON.stringify({ name: "ag-psd" }), "utf8");
  await writeFile(join(psdPackageDirectory, "dist", "index.js"), "export {};\n", "utf8");
  await writeFile(
    join(electronDirectory, "main.js"),
    'import "./native-folder-service.js";\nimport "./native-image-service.js";\nimport "./psd-jpeg-conversion-service.js";\n',
    "utf8",
  );
  await writeFile(join(electronDirectory, "native-folder-service.js"), 'import "./source-identity.js";\n', "utf8");
  await writeFile(join(electronDirectory, "native-image-service.js"), 'import "./psd-image-service.js";\n', "utf8");
  await writeFile(join(electronDirectory, "psd-jpeg-conversion-service.js"), 'import "./psd-image-service.js";\n', "utf8");
  if (includeSourceIdentity) {
    await writeFile(join(electronDirectory, "source-identity.js"), "export {};\n", "utf8");
  }
  if (includePsdImageService) {
    await writeFile(join(electronDirectory, "psd-image-service.js"), "export {};\n", "utf8");
  }
  await createPackage(sourceDirectory, archivePath);
  return archivePath;
}
