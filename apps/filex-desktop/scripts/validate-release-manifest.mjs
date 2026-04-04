import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, "..");
const channelArg = process.argv.find((arg) => arg.startsWith("--channel="));
const channel = (channelArg ? channelArg.split("=")[1] : "stable").trim();
const manifestPath = join(desktopRoot, "release-manifests", `${channel}.json`);
const raw = JSON.parse(await readFile(manifestPath, "utf8"));

if (raw.schemaVersion !== 1) {
  throw new Error("Manifest schemaVersion non valido");
}
if (!Array.isArray(raw.channels) || !raw.channels.includes(channel)) {
  throw new Error("Manifest channels non valido");
}
if (!Array.isArray(raw.releases)) {
  throw new Error("Manifest releases non valido");
}

for (const release of raw.releases) {
  if (!release.toolId || !release.version || !release.installerUrl || !release.installerSha256) {
    throw new Error(`Release incompleta: ${JSON.stringify(release)}`);
  }
  if (!/^https:\/\//i.test(release.installerUrl)) {
    throw new Error(`installerUrl non sicuro: ${release.installerUrl}`);
  }
  if (!/^[0-9a-f]{64}$/i.test(release.installerSha256)) {
    throw new Error(`checksum non valido: ${release.toolId}`);
  }
}

const payload = JSON.stringify({
  schemaVersion: raw.schemaVersion,
  generatedAt: raw.generatedAt,
  generatedBy: raw.generatedBy,
  channels: raw.channels,
  releases: raw.releases,
});
const payloadSha256 = createHash("sha256").update(payload).digest("hex");
if (raw.payloadSha256 && raw.payloadSha256 !== payloadSha256) {
  throw new Error("payloadSha256 non coerente");
}

if (raw.payloadSignature && raw.signatureAlgorithm === "hmac-sha256") {
  const signatureKey = process.env.FILEX_MANIFEST_HMAC_KEY?.trim();
  if (!signatureKey) {
    throw new Error("Manifest firmato ma FILEX_MANIFEST_HMAC_KEY non presente");
  }
  const expectedSignature = createHmac("sha256", signatureKey)
    .update(payload)
    .digest("hex");
  if (raw.payloadSignature !== expectedSignature) {
    throw new Error("payloadSignature non valida");
  }
}

console.log(`Manifest ${channel} valido: ${manifestPath}`);
