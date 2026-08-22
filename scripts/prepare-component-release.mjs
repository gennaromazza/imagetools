import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const [packagePath, label, version, ...noteParts] = process.argv.slice(2);
if (!packagePath || !label || !version) throw new Error("Uso: node scripts/prepare-component-release.mjs <package.json> <nome> <versione> [nota]");
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) throw new Error(`Versione non valida: ${version}`);

const packageFile = join(root, packagePath);
const packageJson = JSON.parse(await readFile(packageFile, "utf8"));
if (packageJson.version === version) throw new Error(`${label} è già alla versione ${version}.`);
packageJson.version = version;
await writeFile(packageFile, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

const changelogPath = join(root, "CHANGELOG.md");
let changelog = await readFile(changelogPath, "utf8");
const header = `## ${new Date().toISOString().slice(0, 10)} - ${label} ${version}`;
if (new RegExp(`^## \\d{4}-\\d{2}-\\d{2} - ${escapeRegExp(label)} ${escapeRegExp(version)}$`, "mu").test(changelog)) {
  throw new Error(`Il changelog contiene già ${label} ${version}.`);
}
const note = noteParts.join(" ").trim() || "Aggiornamenti e correzioni del componente.";
const entry = `${header}\n\n- ${note}\n\n`;
const insertion = changelog.indexOf("\n## ");
if (insertion < 0) throw new Error("CHANGELOG.md non contiene una voce di versione valida.");
changelog = `${changelog.slice(0, insertion + 1)}${entry}${changelog.slice(insertion + 1)}`;
await writeFile(changelogPath, changelog, "utf8");
console.log(`Preparato ${label} ${version}: ${relative(root, packageFile)}, CHANGELOG.md`);

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
