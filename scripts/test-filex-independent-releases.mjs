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
const suiteUpdater = await read("apps/filex-desktop/src/suite-updater.ts");
const toolUpdater = await read("apps/filex-desktop/src/updater.ts");
const launcher = await read("apps/filex-desktop/suite-launcher-src/app.js");
const releaseWorkflow = await read(".github/workflows/windows-release.yml");
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
assert(
  desktopPackage.version !== photoSelectorPackage.version,
  "La versione Suite deve poter avanzare senza modificare la versione dei tool.",
);

assert(
  !desktopPackage.scripts["build:suite"].includes("photo-selector-app"),
  "La build Suite non deve compilare Image Select Pro.",
);
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
    && !releaseWorkflow.includes("Build FileX Suite installer"),
  "Il workflow non e' selettivo per componente.",
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
