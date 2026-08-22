import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const [componentId, packagePath, label, version, ...noteParts] = process.argv.slice(2);
if (!componentId || !packagePath || !label || !version) {
  throw new Error("Uso: node scripts/prepare-component-release.mjs <component-id> <package.json> <nome> <versione> [nota]");
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) throw new Error(`Versione non valida: ${version}`);

const packageFile = join(root, packagePath);
const changelogPath = join(root, "CHANGELOG.md");
const releaseNotesPath = join(root, "apps", "filex-desktop", "release-notes.json");
const [packageRaw, changelogRaw, releaseNotesRaw] = await Promise.all([
  readFile(packageFile, "utf8"), readFile(changelogPath, "utf8"), readFile(releaseNotesPath, "utf8"),
]);
const packageJson = JSON.parse(packageRaw);
const releaseNotes = JSON.parse(releaseNotesRaw);
const currentVersion = String(packageJson.version ?? "");
const note = noteParts.join(" ").trim() || "Aggiornamenti e correzioni del componente.";
const headerPattern = new RegExp(`^## \\d{4}-\\d{2}-\\d{2} - ${escapeRegExp(label)} ${escapeRegExp(version)}$`, "mu");
const hasChangelog = headerPattern.test(changelogRaw);
const existingNotes = releaseNotes?.[componentId]?.[version];
const hasReleaseNotes = Array.isArray(existingNotes) && existingNotes.length > 0 && existingNotes.every((item) => typeof item === "string" && item.trim());

if (currentVersion !== version) {
  const nextVersion = nextPatchVersion(currentVersion);
  if (version !== nextVersion) throw new Error(`La prossima versione prevista per ${label} è ${nextVersion}, non ${version}.`);
  packageJson.version = version;
}

let changelog = changelogRaw;
if (!hasChangelog) {
  const header = `## ${new Date().toISOString().slice(0, 10)} - ${label} ${version}`;
  const insertion = changelog.indexOf("\n## ");
  if (insertion < 0) throw new Error("CHANGELOG.md non contiene una voce di versione valida.");
  changelog = `${changelog.slice(0, insertion + 1)}${header}\n\n- ${note}\n\n${changelog.slice(insertion + 1)}`;
}
if (!releaseNotes[componentId] || typeof releaseNotes[componentId] !== "object") releaseNotes[componentId] = {};
if (!hasReleaseNotes) releaseNotes[componentId][version] = [note];

const writes = [
  [packageFile, `${JSON.stringify(packageJson, null, 2)}\n`, packageRaw],
  [changelogPath, changelog, changelogRaw],
  [releaseNotesPath, `${JSON.stringify(releaseNotes, null, 2)}\n`, releaseNotesRaw],
];
try {
  for (const [path, content] of writes) await writeFile(path, content, "utf8");
} catch (error) {
  await Promise.allSettled(writes.map(([path, _content, original]) => writeFile(path, original, "utf8")));
  throw error;
}
console.log(`Preparato ${label} ${version}: ${relative(root, packageFile)}, CHANGELOG.md, ${relative(root, releaseNotesPath)}`);

function nextPatchVersion(value) {
  const match = String(value).match(/^(\d+)\.(\d+)\.(\d+)$/u);
  if (!match) throw new Error(`Versione corrente non supportata: ${value}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
