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
const archivioFlowPackage = JSON.parse(await read("apps/archivio-flow/package.json"));
const builder = await read("apps/filex-desktop/electron-builder.config.mjs");
const toolManifest = await read("apps/filex-desktop/src/tool-manifest.ts");
const suiteMain = await read("apps/filex-desktop/src/suite-main.ts");
const suitePreload = await read("apps/filex-desktop/src/suite-preload.ts");
const suiteUpdater = await read("apps/filex-desktop/src/suite-updater.ts");
const toolUpdater = await read("apps/filex-desktop/src/updater.ts");
const launcher = await read("apps/filex-desktop/suite-launcher-src/app.js");
const releaseWorkflow = await read(".github/workflows/windows-release.yml");
const ciWorkflow = await read(".github/workflows/ci.yml");
const manifestGenerator = await read("apps/filex-desktop/scripts/generate-release-manifest.mjs");
const downloadPage = await read("docs/index.html");

for (const [name, packageJson] of [
  ["suite", desktopPackage],
  ["photo-selector-app", photoSelectorPackage],
  ["image-party-frame", imagePartyFramePackage],
  ["archivio-flow", archivioFlowPackage],
]) {
  assert(/^\d+\.\d+\.\d+$/.test(packageJson.version), `Versione non semantica per ${name}`);
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
  releaseWorkflow.includes('"suite-v*"')
    && releaseWorkflow.includes("Build selected installer")
    && releaseWorkflow.includes("verify-packaged-component.mjs")
    && releaseWorkflow.includes("Get-Content $feedPath -Raw")
    && releaseWorkflow.includes('"${feedUrl}?t=$nonce"')
    && releaseWorkflow.includes('"${catalogUrl}?t=$nonce"')
    && releaseWorkflow.includes("foreach ($attempt in 1..6)")
    && releaseWorkflow.includes("Bootstrap dedicated tool catalog")
    && releaseWorkflow.includes("releases/latest/download/$env:FILEX_RELEASE_CHANNEL.json")
    && releaseWorkflow.includes('$minSuiteVersion = "0.1.26"')
    && releaseWorkflow.includes("git branch -r --contains $env:GITHUB_SHA")
    && releaseWorkflow.includes('"refs/heads/main"')
    && !releaseWorkflow.includes("Build FileX Suite installer"),
  "Il workflow non e' selettivo per componente.",
);
assert(
  ciWorkflow.includes("pull_request:")
    && ciWorkflow.includes("test:filex-independent-releases")
    && ciWorkflow.includes("build:suite"),
  "La PR non dispone dei controlli automatici per il nuovo contratto di release.",
);
assert(
  manifestGenerator.includes("--tool=")
    && manifestGenerator.includes("--previous-manifest-url=")
    && manifestGenerator.includes("--bootstrap-manifest-url="),
  "Il generatore non aggiorna atomicamente un singolo tool dal catalogo remoto.",
);
assert(
  downloadPage.includes("releases/download/suite-channel-stable/FileX-Suite-stable-x64-setup.exe"),
  "Il sito download dipende ancora dalla release globale piu recente.",
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
    notesPath,
    JSON.stringify({ "photo-selector-app": { "9.8.7": ["Test release indipendente."] } }),
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
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("FileX independent component releases: PASS");
