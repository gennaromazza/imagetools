import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createPackage } from "@electron/asar";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const temporaryRoot = await mkdtemp(join(tmpdir(), "filex-id-photo-package-test-"));
const verifier = join(root, "apps", "filex-desktop", "scripts", "verify-packaged-component.mjs");

try {
  const [mainSource, builderConfig, releaseWorkflow] = await Promise.all([
    readFile(join(root, "apps", "filex-desktop", "src", "main.ts"), "utf8"),
    readFile(join(root, "apps", "filex-desktop", "electron-builder.config.mjs"), "utf8"),
    readFile(join(root, ".github", "workflows", "windows-release.yml"), "utf8"),
  ]);

  assert.match(
    mainSource,
    /--filex-id-photo-packaged-smoke-test/u,
    "Il main process non espone lo smoke test dell'artefatto FileX ID Photo.",
  );
  const ipcRegistrationIndex = mainSource.indexOf("registerIpcHandlers();");
  const packagedSmokeRunIndex = mainSource.indexOf("await runIdPhotoPackagedSmokeTest();");
  assert.ok(
    ipcRegistrationIndex >= 0 && packagedSmokeRunIndex > ipcRegistrationIndex,
    "Lo smoke packaged ID Photo deve partire soltanto dopo la registrazione degli handler IPC.",
  );
  assert.match(
    mainSource,
    /show:\s*false[\s\S]*preload:\s*preloadPath[\s\S]*window\.filexDesktop[\s\S]*fingerprintFiles[\s\S]*beginAtomicWriteTransaction[\s\S]*commitAtomicWriteTransaction[\s\S]*finalizeAtomicWriteTransaction[\s\S]*rollbackAtomicWriteTransaction[\s\S]*loadRenderer\(smokeWindow/u,
    "Lo smoke packaged non carica il preload reale o non esercita fingerprint e transazioni IPC.",
  );
  assert.match(
    mainSource,
    /filex:print-id-photo-pages[\s\S]*printIdPhotoPagesDesktop/u,
    "Il pacchetto ID Photo non registra il pannello di stampa nativo.",
  );
  assert.match(
    mainSource,
    /filex:list-id-photo-printers[\s\S]*getPrintersAsync/u,
    "Il pacchetto ID Photo non registra l'elenco stampanti per il pannello FileX.",
  );
  assert.match(
    mainSource,
    /filex:process-id-photo-background[\s\S]*processIdPhotoBackground/u,
    "Il pacchetto ID Photo non registra il servizio locale di scontorno.",
  );
  assert.match(
    builderConfig,
    /node_modules\/onnxruntime-node/u,
    "La configurazione Electron non gestisce i binari nativi di ONNX Runtime.",
  );
  assert.match(
    mainSource,
    /requestedTool\.id !== "suite-launcher" && !isIdPhotoPackagedSmokeTest/u,
    "Il bypass licenza ID Photo non è confinato allo smoke test esplicito.",
  );
  assert.match(
    mainSource,
    /if \(!hasSingleInstanceLock\)[\s\S]*if \(isIdPhotoPackagedSmokeTest\)[\s\S]*app\.exit\(3\)/u,
    "Uno smoke ID Photo senza single-instance lock deve fallire con exit code non-zero.",
  );
  assert.match(
    mainSource,
    /createIdPhotoUnloadGuard[\s\S]*Resta e salva[\s\S]*Chiudi comunque/u,
    "Il main process non protegge la chiusura con modifiche ID Photo non salvate.",
  );
  assert.match(
    builderConfig,
    /"\.output\/electron\/\*\*\/\*"/u,
    "La whitelist Electron non include la chiusura dei moduli runtime del main process.",
  );
  for (const excludedPattern of [
    "!.output/electron/**/*.test.js",
    "!.output/electron/**/*.d.ts",
    "!.output/electron/**/*.map",
  ]) {
    assert.ok(
      builderConfig.includes(`"${excludedPattern}"`),
      `La configurazione Electron non esclude ${excludedPattern} dall'ASAR.`,
    );
  }
  assert.match(
    releaseWorkflow,
    /FileX-ID-Photo\.exe[\s\S]*--filex-id-photo-packaged-smoke-test/u,
    "La pipeline non avvia il main process ID Photo impacchettato.",
  );

  const validArchive = await createFixtureArchive("valid");
  execFileSync(
    process.execPath,
    [verifier, "--component=id-photo", "--version=9.8.7", `--archive=${validArchive}`],
    { cwd: root, stdio: "pipe" },
  );

  const incompleteArchive = await createFixtureArchive("missing-runtime-module", {
    includeMainRuntime: false,
  });
  const incompleteResult = spawnSync(
    process.execPath,
    [verifier, "--component=id-photo", "--version=9.8.7", `--archive=${incompleteArchive}`],
    { cwd: root, encoding: "utf8", stdio: "pipe" },
  );
  assert.notEqual(incompleteResult.status, 0, "Un import locale assente deve bloccare il pacchetto ID Photo.");
  assert.match(
    `${incompleteResult.stdout}${incompleteResult.stderr}`,
    /id-photo-runtime\.js, assente dall'ASAR/u,
    "Il verificatore non segnala la dipendenza runtime ID Photo mancante.",
  );

  const missingPreloadArchive = await createFixtureArchive("missing-preload", {
    includePreload: false,
  });
  const missingPreloadResult = runVerifier(missingPreloadArchive);
  assert.notEqual(missingPreloadResult.status, 0, "Il preload assente deve bloccare il pacchetto ID Photo.");
  assert.match(
    `${missingPreloadResult.stdout}${missingPreloadResult.stderr}`,
    /preload\.js, necessario per il bridge IPC/u,
    "Il verificatore non segnala il preload ID Photo assente.",
  );

  const missingPreloadRuntimeArchive = await createFixtureArchive("missing-preload-runtime", {
    includePreloadRuntime: false,
  });
  const missingPreloadRuntimeResult = runVerifier(missingPreloadRuntimeArchive);
  assert.notEqual(
    missingPreloadRuntimeResult.status,
    0,
    "Un import transitivo del preload assente deve bloccare il pacchetto ID Photo.",
  );
  assert.match(
    `${missingPreloadRuntimeResult.stdout}${missingPreloadRuntimeResult.stderr}`,
    /id-photo-preload-runtime\.js, assente dall'ASAR/u,
    "Il verificatore non controlla la chiusura transitiva del preload ID Photo.",
  );

  for (const forbiddenArtifact of ["leak.test.js", "types.d.ts", "main.js.map"]) {
    const forbiddenArchive = await createFixtureArchive(`forbidden-${forbiddenArtifact.replaceAll(".", "-")}`, {
      forbiddenArtifact,
    });
    const forbiddenResult = runVerifier(forbiddenArchive);
    assert.notEqual(forbiddenResult.status, 0, `${forbiddenArtifact} deve bloccare il pacchetto ID Photo.`);
    assert.match(
      `${forbiddenResult.stdout}${forbiddenResult.stderr}`,
      new RegExp(forbiddenArtifact.replaceAll(".", "\\."), "u"),
      `Il verificatore non segnala l'artefatto di sviluppo ${forbiddenArtifact}.`,
    );
  }

  console.log("FileX ID Photo package runtime: PASS");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function runVerifier(archivePath) {
  return spawnSync(
    process.execPath,
    [verifier, "--component=id-photo", "--version=9.8.7", `--archive=${archivePath}`],
    { cwd: root, encoding: "utf8", stdio: "pipe" },
  );
}

async function createFixtureArchive(name, options = {}) {
  const {
    includeMainRuntime = true,
    includePreload = true,
    includePreloadRuntime = true,
    forbiddenArtifact,
  } = options;
  const sourceDirectory = join(temporaryRoot, name);
  const archivePath = join(temporaryRoot, `${name}.asar`);
  const electronDirectory = join(sourceDirectory, ".output", "electron");
  await mkdir(electronDirectory, { recursive: true });
  await writeFile(
    join(sourceDirectory, "package.json"),
    JSON.stringify({
      name: "FileX-ID-Photo",
      version: "9.8.7",
      main: ".output/electron/main.js",
    }),
    "utf8",
  );
  await writeFile(
    join(electronDirectory, "main.js"),
    'import "./id-photo-runtime.js";\n',
    "utf8",
  );
  if (includeMainRuntime) {
    await writeFile(join(electronDirectory, "id-photo-runtime.js"), "export {};\n", "utf8");
  }
  if (includePreload) {
    await writeFile(
      join(electronDirectory, "preload.js"),
      'import "./id-photo-preload-runtime.js";\n',
      "utf8",
    );
  }
  if (includePreload && includePreloadRuntime) {
    await writeFile(join(electronDirectory, "id-photo-preload-runtime.js"), "export {};\n", "utf8");
  }
  if (forbiddenArtifact) {
    await writeFile(join(electronDirectory, forbiddenArtifact), "export {};\n", "utf8");
  }
  await createPackage(sourceDirectory, archivePath);
  return archivePath;
}
