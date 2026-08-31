import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();

async function read(relativePath) {
  return readFile(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const desktopPackage = JSON.parse(await read("apps/filex-desktop/package.json"));
const photoSelectorPackage = JSON.parse(await read("apps/photo-selector-app/package.json"));
const imagePartyFramePackage = JSON.parse(await read("apps/image-party-frame/package.json"));
const idPhotoPackage = JSON.parse(await read("apps/id-photo/package.json"));
const archivioFlowPackage = JSON.parse(await read("apps/archivio-flow/package.json"));
const cacheSweepPackage = JSON.parse(await read("apps/cache-sweep/package.json"));
const filexSendPackage = JSON.parse(await read("apps/filex-send/package.json"));
const backupGuardPackage = JSON.parse(await read("apps/backup-guard/package.json"));
const builder = await read("apps/filex-desktop/electron-builder.config.mjs");
const toolManifest = await read("apps/filex-desktop/src/tool-manifest.ts");
const suiteMain = await read("apps/filex-desktop/src/suite-main.ts");
const suitePreload = await read("apps/filex-desktop/src/suite-preload.ts");
const suiteUpdater = await read("apps/filex-desktop/src/suite-updater.ts");
const toolUpdater = await read("apps/filex-desktop/src/updater.ts");
const toolProcessCoordinator = await read("apps/filex-desktop/src/filex-process-coordinator.ts");
const windowsInstallerRunner = await read("apps/filex-desktop/src/windows-installer-runner.ts");
const launcher = await read("apps/filex-desktop/suite-launcher-src/app.js");
const launcherBuilder = await read("apps/filex-desktop/scripts/build-suite-launcher.mjs");
const releaseWorkflow = await read(".github/workflows/windows-release.yml");
const devConsoleServer = await read("apps/filex-dev-console/server/index.ts");
const devConsolePage = await read("apps/filex-dev-console/public/index.html");
const ciWorkflow = await read(".github/workflows/ci.yml");
const manifestGenerator = await read("apps/filex-desktop/scripts/generate-release-manifest.mjs");
const packagedComponentVerifier = await read("apps/filex-desktop/scripts/verify-packaged-component.mjs");
const componentReleaseValidator = await read("scripts/validate-component-release.mjs");
const fullCleanTest = await read("scripts/prepare-filex-full-clean-test.ps1");
const downloadPage = await read("website/index.html");
const installerLicense = await read("apps/filex-desktop/build/license_it.txt");

const workflowReleaseComponents = Array.from(
  releaseWorkflow.matchAll(/^\s+- "([a-z0-9-]+)-v\*"\s*$/gmu),
  (match) => match[1],
).sort();
const verifierPackagesBlock = packagedComponentVerifier.match(
  /const expectedPackages = \{([\s\S]*?)\r?\n\};\r?\n\r?\nconst expected/u,
)?.[1] ?? "";
const verifiedReleaseComponents = Array.from(
  verifierPackagesBlock.matchAll(/^\s{2}(?:"([a-z0-9-]+)"|([a-z0-9-]+)):\s*\{/gmu),
  (match) => match[1] ?? match[2],
).sort();

for (const [name, packageJson] of [
  ["suite", desktopPackage],
  ["photo-selector-app", photoSelectorPackage],
  ["image-party-frame", imagePartyFramePackage],
  ["id-photo", idPhotoPackage],
  ["archivio-flow", archivioFlowPackage],
  ["cache-sweep", cacheSweepPackage],
  ["filex-send", filexSendPackage],
  ["backup-guard", backupGuardPackage],
]) {
  assert(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version), `Versione non semantica per ${name}`);
}
// Component versions are sourced independently and may legitimately coincide
// after separate patch releases. The packaging assertions below verify the
// independence contract without coupling it to a transient version mismatch.

assert(
  !desktopPackage.scripts["build:suite"].includes("photo-selector-app"),
  "La build Suite non deve compilare Image Select Pro.",
);
for (const [scriptName, command] of Object.entries(desktopPackage.scripts)) {
  if (scriptName.startsWith("dist:") && command.includes("electron-builder")) {
    assert(
      command.includes("--publish never"),
      `${scriptName} puo pubblicare implicitamente una release legacy tramite electron-builder.`,
    );
  }
}
assert(
  builder.includes("requestedTool.versionPackageRelativeToShell")
    && builder.includes("version: targetVersion"),
  "Electron Builder non risolve la versione dal package del target.",
);
assert(
  toolManifest.includes('versionPackageRelativeToShell: "../photo-selector-app"')
    && toolManifest.includes('versionPackageRelativeToShell: "../id-photo"')
    && toolManifest.includes('versionPackageRelativeToShell: "../cache-sweep"')
    && toolManifest.includes('electronPreloadOutputFile: "cache-sweep/electron/preload.cjs"')
    && toolManifest.includes('versionPackageRelativeToShell: "../filex-send"')
    && toolManifest.includes('electronPreloadOutputFile: "filex-send/electron/preload.cjs"')
    && toolManifest.includes('versionPackageRelativeToShell: "../backup-guard"')
    && toolManifest.includes('electronPreloadOutputFile: "backup-guard/electron/preload.cjs"')
    && toolManifest.includes('versionPackageRelativeToShell: "."'),
  "Il manifest desktop non distingue le sorgenti versione di Suite e tool.",
);
assert(
  toolManifest.includes('electronMainOutputFile: "suite-main.js"')
    && toolManifest.includes('electronPreloadOutputFile: "suite-preload.js"'),
  "La Suite non dispone di entrypoint Electron dedicati.",
);
assert(
  builder.includes("requestedTool.electronMainOutputFile")
    && builder.includes('".output/electron/suite-main.js"')
    && !/requestedTool\.id === "suite-launcher"\s*\?\s*\[\s*"\.output\/electron\/\*\*\/\*"/.test(builder),
  "Il pacchetto Suite puo ancora includere indiscriminatamente l'intero runtime Electron.",
);
assert(
  builder.includes('forceCodeSigning: process.env.FILEX_CODE_SIGNING === "1"'),
  "Electron Builder non rispetta la scelta esplicita della pipeline sulla firma Windows.",
);
assert(
  releaseWorkflow.includes("secrets.FILEX_WINDOWS_CSC_LINK != ''")
    && releaseWorkflow.includes("secrets.FILEX_WINDOWS_CSC_KEY_PASSWORD != ''")
    && releaseWorkflow.includes("pubblico un installer non firmato"),
  "La pipeline non gestisce in modo esplicito le release senza certificato Windows.",
);
assert(
  toolProcessCoordinator.includes('runWindowsInstaller(installerPath)')
    && windowsInstallerRunner.includes('spawnProcess(installerPath, ["/S"])')
    && windowsInstallerRunner.includes('child.once("close"')
    && windowsInstallerRunner.includes("if (code === 0)")
    && windowsInstallerRunner.includes("InstallerExitError")
    && !toolProcessCoordinator.includes("shell.openPath(installerPath)"),
  "La Suite non avvia e attende in modo controllato l'installer NSIS silenzioso.",
);
for (const excludedDependency of ["@img", "exiftool-vendored", "exiftool-vendored.exe", "sharp"]) {
  assert(
    builder.includes(`!node_modules/${excludedDependency}{,/**/*}`),
    `La Suite puo ancora incorporare la dipendenza tool-specifica ${excludedDependency}.`,
  );
}
for (const forbiddenModule of [
  "desktop-store",
  "google-drive-service",
  "native-folder-service",
  "native-image-service",
  "thumbnail-disk-cache",
  "raw-jpeg-extractor",
  "xmp-compatibility",
]) {
  assert(
    !suiteMain.includes(`./${forbiddenModule}.js`) && !suitePreload.includes(forbiddenModule),
    `Il runtime Suite importa ancora il modulo tool-specifico ${forbiddenModule}.`,
  );
}
assert(
  suiteUpdater.includes("suite-channel-stable")
    && !suiteUpdater.includes("repos/gennaromazza/imagetools/releases/latest"),
  "L'updater Suite dipende ancora dalla release GitHub globale piu recente.",
);
assert(
  suiteUpdater.includes("autoUpdater.autoInstallOnAppQuit = false")
    && suiteUpdater.includes("autoUpdater.quitAndInstall(false, true)"),
  "L'aggiornamento Suite non lascia visibile la conferma Windows per gli installer non firmati.",
);
assert(
  devConsoleServer.includes("readLatestSuiteChangelogVersion()")
    && devConsoleServer.includes("compareSuiteVersions(changelogVersion, latestPublishedVersion) > 0")
    && !devConsoleServer.includes("currentVersionAlreadyPublished ? `${major}.${minor}.${patch + 1}`")
    && devConsolePage.includes("Nessuna release da pubblicare")
    && devConsolePage.includes("nessuna nuova versione nel changelog"),
  "La Dev Console puo ancora proporre una patch Suite assente dal changelog.",
);
assert(
  toolUpdater.includes("update-catalog-${channel}")
    && !toolUpdater.includes("releases/latest/download/${channel}.json"),
  "L'updater tool dipende ancora da releases/latest.",
);
assert(
  launcher.includes("void refresh();")
    && launcher.includes("check-suite-update-btn")
    && !launcher.includes("Promise.all([refresh(), api.checkSuiteUpdate()])"),
  "I controlli espliciti di Suite e tool sono ancora accoppiati nella UI.",
);
assert(
  launcher.includes("'backup-guard':")
    && launcher.includes("Controlla che fotografie, cataloghi e progetti importanti")
    && launcherBuilder.includes('"backup-guard"'),
  "Backup Guard non dispone di descrizione o icona nel launcher Suite.",
);
assert(
  launcher.includes("'id-photo':")
    && launcher.includes("Prepara fototessere per documenti")
    && launcherBuilder.includes('"id-photo"'),
  "FileX ID Photo non dispone di descrizione o icona nel launcher Suite.",
);
assert(
  launcher.includes("button.textContent = 'Verifica...'")
    && launcher.includes("showToast(`Licenza verificata alle ${checkedAt}.`)")
    && launcher.includes("button.textContent = 'Verifica ora'"),
  "Il comando Verifica ora non fornisce feedback e ripristino affidabili.",
);
assert(
  releaseWorkflow.includes('"suite-v*"')
    && releaseWorkflow.includes('"id-photo-v*"')
    && releaseWorkflow.includes('"cache-sweep-v*"')
    && releaseWorkflow.includes('"filex-send-v*"')
    && releaseWorkflow.includes('"backup-guard-v*"')
    && releaseWorkflow.includes("Build selected installer")
    && releaseWorkflow.includes("verify-packaged-component.mjs")
    && releaseWorkflow.includes("Get-Content $feedPath -Raw")
    && releaseWorkflow.includes('"${feedUrl}?t=$nonce"')
    && releaseWorkflow.includes('"${catalogUrl}?t=$nonce"')
    && releaseWorkflow.includes("foreach ($attempt in 1..6)")
    && releaseWorkflow.includes("function Invoke-FileXDownload")
    && releaseWorkflow.includes("foreach ($downloadAttempt in 1..$MaxAttempts)")
    && releaseWorkflow.includes("Remove-Item -LiteralPath $OutFile")
    && releaseWorkflow.includes("Download remoto fallito")
    && releaseWorkflow.includes('Invoke-FileXDownload -Uri "${catalogUrl}?t=$nonce"')
    && releaseWorkflow.includes('Invoke-FileXDownload -Uri "$($entry[0].installerUrl)')
    && releaseWorkflow.includes("Bootstrap dedicated tool catalog")
    && releaseWorkflow.includes("releases/latest/download/$env:FILEX_RELEASE_CHANNEL.json")
    && releaseWorkflow.includes('$component -eq "backup-guard"')
    && releaseWorkflow.includes("batch-print-layout|id-photo|image-converter|image-file-finder")
    && releaseWorkflow.includes('"batch-print-layout" { npm.cmd --workspace @photo-tools/filex-desktop run dist:batch-print-layout:win64 }')
    && releaseWorkflow.includes('"id-photo" { npm.cmd --workspace @photo-tools/filex-desktop run dist:id-photo:win64 }')
    && releaseWorkflow.includes('"image-converter" { npm.cmd --workspace @photo-tools/filex-desktop run dist:image-converter:win64 }')
    && releaseWorkflow.includes('"image-file-finder" { npm.cmd --workspace @photo-tools/filex-desktop run dist:image-file-finder:win64 }')
    && releaseWorkflow.includes('$component -eq "id-photo"')
    && releaseWorkflow.includes('{ "0.1.61" } elseif ($component -eq "backup-guard")')
    && releaseWorkflow.includes("--filex-id-photo-packaged-smoke-test")
    && releaseWorkflow.includes("test:id-photo-working-files")
    && releaseWorkflow.includes("test:id-photo-file-fingerprint")
    && releaseWorkflow.includes("test:id-photo-unload-guard")
    && releaseWorkflow.includes("test:batch-print-layout-bug-hunt")
    && releaseWorkflow.includes("steps.release.outputs.component == 'id-photo' || steps.release.outputs.component == 'batch-print-layout'")
    && /run:\s+npm\.cmd run test:id-photo(?:\r?\n|$)/u.test(releaseWorkflow)
    && releaseWorkflow.includes("git branch -r --contains $env:GITHUB_SHA")
    && releaseWorkflow.includes('"refs/heads/main"')
    && !releaseWorkflow.includes("Build FileX Suite installer"),
  "Il workflow non e' selettivo per componente.",
);
assert(
  ciWorkflow.includes("pull_request:")
    && ciWorkflow.includes("test:filex-independent-releases")
    && ciWorkflow.includes("test:id-photo-package-runtime")
    && ciWorkflow.includes("test:id-photo-working-files")
    && ciWorkflow.includes("test:id-photo-file-fingerprint")
    && ciWorkflow.includes("test:id-photo-unload-guard")
    && ciWorkflow.includes("test:batch-print-layout-bug-hunt")
    && ciWorkflow.includes("@photo-tools/id-photo run test")
    && ciWorkflow.includes("@photo-tools/id-photo run build")
    && ciWorkflow.includes("build:suite"),
  "La PR non dispone dei controlli automatici per il nuovo contratto di release.",
);
assert(
  manifestGenerator.includes("--tool=")
    && manifestGenerator.includes('{ toolId: "id-photo", executableName: "FileX-ID-Photo" }')
    && manifestGenerator.includes("--previous-manifest-url=")
    && manifestGenerator.includes("--bootstrap-manifest-url=")
    && manifestGenerator.includes("bootstrapResponse.status === 404")
    && manifestGenerator.includes("previousManifest = await readBundledManifest()"),
  "Il generatore non aggiorna atomicamente un singolo tool dal catalogo remoto.",
);
assert(
  componentReleaseValidator.includes('"id-photo": ["FileX ID Photo", "apps/id-photo/package.json"]'),
  "Il preflight release non riconosce FileX ID Photo.",
);
assert(
  fullCleanTest.includes('"FileX ID Photo"')
    && fullCleanTest.includes('"FileX-ID-Photo"'),
  "Il test di rimozione completa non include FileX ID Photo.",
);
assert(
  packagedComponentVerifier.includes("(?:-[0-9A-Za-z.-]+)?")
    && packagedComponentVerifier.includes("Componente non supportato dal verificatore"),
  "Il verificatore degli installer non accetta versioni prerelease o non segnala i componenti sconosciuti.",
);
assert(
  workflowReleaseComponents.length > 0
    && JSON.stringify(verifiedReleaseComponents) === JSON.stringify(workflowReleaseComponents),
  `Il verificatore non e' allineato ai componenti pubblicabili. Workflow: ${workflowReleaseComponents.join(", ")}; verificatore: ${verifiedReleaseComponents.join(", ")}.`,
);
assert(
  downloadPage.includes("releases/download/suite-channel-stable/FileX-Suite-stable-x64-setup.exe"),
  "Il sito download dipende ancora dalla release globale piu recente.",
);
assert(
  installerLicense.includes("CONTRATTO DI LICENZA FILEX")
    && installerLicense.includes("IT08039821213")
    && installerLicense.includes("https://filex-suite.web.app/licenza/"),
  "La licenza italiana richiesta dall'installer Suite e' assente o incompleta.",
);

const temporaryRoot = await mkdtemp(join(tmpdir(), "filex-independent-release-test-"));
try {
  const releaseDir = join(temporaryRoot, "releases");
  const manifestDir = join(temporaryRoot, "manifests");
  const notesPath = join(temporaryRoot, "release-notes.json");
  await mkdir(releaseDir, { recursive: true });
  await mkdir(manifestDir, { recursive: true });
  await writeFile(
    join(releaseDir, "Image-Select-Pro-9.8.7-stable-x64-setup.exe"),
    "independent-tool-installer",
  );
  await writeFile(
    join(releaseDir, "FileX-ID-Photo-1.2.3-stable-x64-setup.exe"),
    "id-photo-installer",
  );
  await writeFile(
    notesPath,
    JSON.stringify({
      "photo-selector-app": { "9.8.7": ["Test release indipendente."] },
      "id-photo": { "1.2.3": ["Test release ID Photo."] },
    }),
  );
  const preservedRelease = {
    toolId: "archivio-flow",
    version: "4.5.6",
    channel: "stable",
    installerUrl: "https://github.com/example/releases/download/archivio-flow-v4.5.6/Archivio-Flow.exe",
    installerSha256: "a".repeat(64),
    minLauncherVersion: "0.1.0",
    publishedAt: "2026-01-01T00:00:00.000Z",
    highlights: ["Voce da preservare."],
  };
  await writeFile(
    join(manifestDir, "stable.json"),
    JSON.stringify({ schemaVersion: 1, channels: ["stable", "beta"], releases: [preservedRelease] }),
  );

  execFileSync(
    process.execPath,
    [
      join(root, "apps/filex-desktop/scripts/generate-release-manifest.mjs"),
      "--channel=stable",
      "--tool=photo-selector-app",
      "--base-url=https://github.com/example/releases/download/photo-selector-app-v9.8.7",
      "--min-launcher-version=0.1.25",
      `--release-dir=${releaseDir}`,
      `--manifest-dir=${manifestDir}`,
      `--release-notes=${notesPath}`,
    ],
    { cwd: root, stdio: "pipe" },
  );

  const generatedManifest = JSON.parse(await readFile(join(manifestDir, "stable.json"), "utf8"));
  const preserved = generatedManifest.releases.find((release) => release.toolId === "archivio-flow");
  const generated = generatedManifest.releases.find((release) => release.toolId === "photo-selector-app");
  assert(preserved?.version === "4.5.6", "La release di un tool ha modificato una voce estranea.");
  assert(generated?.version === "9.8.7", "La voce del tool selezionato non e' stata generata.");
  assert(generatedManifest.releases.length === 2, "Il catalogo non contiene esattamente le voci attese.");

  execFileSync(
    process.execPath,
    [
      join(root, "apps/filex-desktop/scripts/generate-release-manifest.mjs"),
      "--channel=stable",
      "--tool=id-photo",
      "--base-url=https://github.com/example/releases/download/id-photo-v1.2.3",
      "--min-launcher-version=0.1.61",
      `--release-dir=${releaseDir}`,
      `--manifest-dir=${manifestDir}`,
      `--release-notes=${notesPath}`,
    ],
    { cwd: root, stdio: "pipe" },
  );
  const idPhotoManifest = JSON.parse(await readFile(join(manifestDir, "stable.json"), "utf8"));
  const generatedIdPhoto = idPhotoManifest.releases.find((release) => release.toolId === "id-photo");
  assert(generatedIdPhoto?.version === "1.2.3", "La voce ID Photo non e' stata generata.");
  assert(generatedIdPhoto?.minLauncherVersion === "0.1.61", "ID Photo non richiede la prima Suite compatibile.");
  assert(
    idPhotoManifest.releases.some((release) => release.toolId === "photo-selector-app" && release.version === "9.8.7"),
    "La release ID Photo ha rimosso una voce tool gia' presente.",
  );
  assert(idPhotoManifest.releases.length === 3, "Il catalogo aggiornato non contiene le tre voci attese.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("FileX independent component releases: PASS");
