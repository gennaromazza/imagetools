import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const [componentId, expectedVersion] = process.argv.slice(2);
const components = {
  "photo-selector-app": ["Image Select Pro", "apps/photo-selector-app/package.json"],
  "image-party-frame": ["Image Party Frame", "apps/image-party-frame/package.json"],
  "batch-print-layout": ["Batch Print Layout", "apps/batch-print-layout/package.json"],
  "archivio-flow": ["Archivio Flow", "apps/archivio-flow/package.json"],
  "image-converter": ["Image Converter", "apps/image-converter/package.json"],
  "image-file-finder": ["Trova Foto da Lista", "apps/image-file-finder/package.json"],
  "cache-sweep": ["FileX Adobe Cleaner", "apps/cache-sweep/package.json"],
  "filex-send": ["FileX Send", "apps/filex-send/package.json"],
  "backup-guard": ["FileX Backup Guard", "apps/backup-guard/package.json"],
};
const config = components[componentId];
if (!config) throw new Error(`Componente non supportato: ${componentId}`);
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(expectedVersion ?? "")) throw new Error(`Versione non valida: ${expectedVersion}`);
const [label, packagePath] = config;
const [packageJson, changelog, releaseNotes] = await Promise.all([
  readFile(join(root, packagePath), "utf8").then(JSON.parse),
  readFile(join(root, "CHANGELOG.md"), "utf8"),
  readFile(join(root, "apps", "filex-desktop", "release-notes.json"), "utf8").then(JSON.parse),
]);
const issues = [];
if (packageJson.version !== expectedVersion) issues.push(`${packagePath} contiene ${packageJson.version}, atteso ${expectedVersion}`);
const header = new RegExp(`^## \\d{4}-\\d{2}-\\d{2} - ${escapeRegExp(label)} ${escapeRegExp(expectedVersion)}$`, "mu");
if (!header.test(changelog)) issues.push(`CHANGELOG.md non contiene ${label} ${expectedVersion}`);
const notes = releaseNotes?.[componentId]?.[expectedVersion];
if (!Array.isArray(notes) || notes.length === 0 || notes.some((item) => typeof item !== "string" || !item.trim())) issues.push(`release-notes.json non contiene note valide per ${componentId} ${expectedVersion}`);
if (issues.length) throw new Error(`Preflight release non superato:\n- ${issues.join("\n- ")}`);
console.log(`Preflight release OK: ${componentId} ${expectedVersion}`);

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
