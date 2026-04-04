import { createHash, createHmac } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, "..");
const releaseDir = join(desktopRoot, "release");
const manifestDir = join(desktopRoot, "release-manifests");

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

const launcherVersionArg = process.argv.find((arg) => arg.startsWith("--min-launcher-version="));
const minLauncherVersion = (launcherVersionArg ? launcherVersionArg.split("=")[1] : "0.1.0").trim();

let artifacts = [];
try {
  artifacts = await readdir(releaseDir, { withFileTypes: true });
} catch {
  artifacts = [];
}
const toolConfig = [
  { toolId: "suite-launcher", executableName: "FileX-Suite" },
  { toolId: "auto-layout-app", executableName: "Auto-Layout" },
  { toolId: "image-party-frame", executableName: "Image-Party-Frame" },
  { toolId: "image-id-print", executableName: "Image-ID-Print" },
  { toolId: "archivio-flow", executableName: "Archivio-Flow" },
  { toolId: "photo-selector-app", executableName: "Selezione-Foto" },
];

function parseVersion(fileName, executableName, releaseChannel) {
  const escapedName = executableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedChannel = releaseChannel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedName}-(.+?)-${escapedChannel}-[^-]+-setup\\.exe$`, "i");
  const match = fileName.match(pattern);
  return match ? match[1] : null;
}

const releases = [];
for (const tool of toolConfig) {
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

  releases.push({
    toolId: tool.toolId,
    version,
    channel,
    installerUrl: `${baseUrl}/${candidate}`,
    installerSha256: sha256,
    minLauncherVersion,
    publishedAt: new Date().toISOString(),
  });
}

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
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`Manifest generato: ${outputPath}`);
