import { createHash, createHmac } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, "..");

function readArgument(name) {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length).trim() : null;
}

const releaseDir = resolve(readArgument("release-dir") || join(desktopRoot, ".output", "releases"));
const manifestDir = resolve(readArgument("manifest-dir") || join(desktopRoot, "release-manifests"));
const releaseNotesPath = resolve(readArgument("release-notes") || join(desktopRoot, "release-notes.json"));

const channelArg = process.argv.find((arg) => arg.startsWith("--channel="));
const channel = (channelArg ? channelArg.split("=")[1] : "stable").trim();
if (!["stable", "beta"].includes(channel)) {
  throw new Error("Channel non supportato. Usa stable o beta.");
}

const baseUrlArg = process.argv.find((arg) => arg.startsWith("--base-url="));
if (!baseUrlArg) {
  throw new Error("Parametro richiesto: --base-url=<url-release-assets>");
}
const baseUrl = baseUrlArg.split("=")[1].replace(/\/+$/, "");
if (/\/releases\/latest\/download(?:\/|$)/i.test(baseUrl)) {
  throw new Error(
    "--base-url deve indicare un tag di release preciso (es. /releases/download/v0.2.0), non /releases/latest/download.",
  );
}

const launcherVersionArg = process.argv.find((arg) => arg.startsWith("--min-launcher-version="));
const minLauncherVersion = (launcherVersionArg ? launcherVersionArg.split("=")[1] : "0.1.0").trim();
const toolArg = process.argv.find((arg) => arg.startsWith("--tool="));
const selectedToolId = toolArg ? toolArg.split("=")[1].trim() : null;
const previousManifestUrlArg = process.argv.find((arg) => arg.startsWith("--previous-manifest-url="));
const previousManifestUrl = previousManifestUrlArg
  ? previousManifestUrlArg.slice(previousManifestUrlArg.indexOf("=") + 1).trim()
  : null;
const bootstrapManifestUrlArg = process.argv.find((arg) => arg.startsWith("--bootstrap-manifest-url="));
const bootstrapManifestUrl = bootstrapManifestUrlArg
  ? bootstrapManifestUrlArg.slice(bootstrapManifestUrlArg.indexOf("=") + 1).trim()
  : null;

let artifacts = [];
try {
  artifacts = await readdir(releaseDir, { withFileTypes: true });
} catch {
  artifacts = [];
}
const toolConfig = [
  { toolId: "image-party-frame", executableName: "Image-Party-Frame" },
  { toolId: "batch-print-layout", executableName: "Batch-Print-Layout" },
  { toolId: "archivio-flow", executableName: "Archivio-Flow" },
  { toolId: "image-converter", executableName: "Image-Converter" },
  { toolId: "image-file-finder", executableName: "Trova-Foto-da-Lista" },
  { toolId: "cache-sweep", executableName: "FileX-Adobe-Cleaner" },
  { toolId: "photo-selector-app", executableName: "Image-Select-Pro" },
];
if (selectedToolId && !toolConfig.some((tool) => tool.toolId === selectedToolId)) {
  throw new Error(`Tool non supportato: ${selectedToolId}`);
}
const selectedToolConfig = selectedToolId
  ? toolConfig.filter((tool) => tool.toolId === selectedToolId)
  : toolConfig;

let releaseNotes = {};
try {
  releaseNotes = JSON.parse(await readFile(releaseNotesPath, "utf8"));
} catch (error) {
  throw new Error(`Impossibile leggere ${releaseNotesPath}: ${error instanceof Error ? error.message : error}`);
}

function getReleaseHighlights(toolId, version) {
  const highlights = releaseNotes?.[toolId]?.[version];
  if (!Array.isArray(highlights) || highlights.length === 0 || highlights.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(
      `Note di rilascio mancanti per ${toolId} ${version}. Aggiungile a release-notes.json prima di generare il manifest.`,
    );
  }
  return highlights.map((item) => item.trim());
}

function parseVersion(fileName, executableName, releaseChannel) {
  const escapedName = executableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedChannel = releaseChannel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedName}-(.+?)-${escapedChannel}-[^-]+-setup\\.exe$`, "i");
  const match = fileName.match(pattern);
  return match ? match[1] : null;
}

const generatedReleases = [];
for (const tool of selectedToolConfig) {
  const candidate = artifacts
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => fileName.toLowerCase().startsWith(`${tool.executableName.toLowerCase()}-`))
    .filter((fileName) => fileName.toLowerCase().endsWith("-setup.exe"))
    .sort()
    .reverse()[0];

  if (!candidate) continue;
  const version = parseVersion(candidate, tool.executableName, channel);
  if (!version) continue;

  const absolutePath = join(releaseDir, candidate);
  const content = await readFile(absolutePath);
  const sha256 = createHash("sha256").update(content).digest("hex");

  generatedReleases.push({
    toolId: tool.toolId,
    version,
    channel,
    installerUrl: `${baseUrl}/${candidate}`,
    installerSha256: sha256,
    minLauncherVersion,
    publishedAt: new Date().toISOString(),
    highlights: getReleaseHighlights(tool.toolId, version),
  });
}

if (selectedToolId && generatedReleases.length !== 1) {
  throw new Error(
    `Atteso un installer per ${selectedToolId} nel canale ${channel}, trovati ${generatedReleases.length}.`,
  );
}

async function readBundledManifest() {
  try {
    return JSON.parse(
      await readFile(join(manifestDir, `${channel}.json`), "utf8"),
    );
  } catch {
    return { releases: [] };
  }
}

let previousManifest;
if (previousManifestUrl) {
  const separator = previousManifestUrl.includes("?") ? "&" : "?";
  const response = await fetch(`${previousManifestUrl}${separator}t=${Date.now()}`);
  if (response.status === 404) {
    if (bootstrapManifestUrl) {
      const bootstrapSeparator = bootstrapManifestUrl.includes("?") ? "&" : "?";
      const bootstrapResponse = await fetch(
        `${bootstrapManifestUrl}${bootstrapSeparator}t=${Date.now()}`,
      );
      if (!bootstrapResponse.ok) {
        throw new Error(`Impossibile inizializzare il catalogo remoto: HTTP ${bootstrapResponse.status}`);
      }
      previousManifest = await bootstrapResponse.json();
    } else {
      previousManifest = await readBundledManifest();
    }
  } else if (!response.ok) {
    throw new Error(`Impossibile rileggere il catalogo remoto: HTTP ${response.status}`);
  } else {
    previousManifest = await response.json();
  }
} else {
  previousManifest = await readBundledManifest();
}
const previousReleases = Array.isArray(previousManifest.releases)
  ? previousManifest.releases
  : [];

const generatedToolIds = new Set(generatedReleases.map((release) => release.toolId));
const releases = [
  ...previousReleases.filter(
    (release) => !generatedToolIds.has(release.toolId) || release.channel !== channel,
  ),
  ...generatedReleases,
];

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  generatedBy: "generate-release-manifest.mjs",
  channels: ["stable", "beta"],
  releases,
};

const payload = JSON.stringify({
  schemaVersion: manifest.schemaVersion,
  generatedAt: manifest.generatedAt,
  generatedBy: manifest.generatedBy,
  channels: manifest.channels,
  releases: manifest.releases,
});
manifest.payloadSha256 = createHash("sha256").update(payload).digest("hex");
const signatureKey = process.env.FILEX_MANIFEST_HMAC_KEY?.trim();
if (signatureKey) {
  const signature = createHmac("sha256", signatureKey)
    .update(payload)
    .digest("hex");
  manifest.payloadSignature = signature;
  manifest.signatureAlgorithm = "hmac-sha256";
}

const outputPath = join(manifestDir, `${channel}.json`);
await mkdir(manifestDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`Manifest generato: ${outputPath}`);
