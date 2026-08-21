import { readdir, readFile } from "node:fs/promises";
import { resolve, relative, extname, join } from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([".git", "node_modules", ".output", "build", "dist", "coverage", "lib", ".runtime", "playwright-report", "test-results"]);
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".mts", ".cts", ".yml", ".yaml"]);

async function walk(directory, files, manifests) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) await walk(fullPath, files, manifests);
    } else if (entry.name === "package.json") manifests.push(fullPath);
    else if (sourceExtensions.has(extname(entry.name).toLowerCase())) files.push(fullPath);
  }
}

function dependencyFromSpecifier(specifier) {
  if (!specifier || specifier.startsWith(".") || specifier.startsWith("node:")) return null;
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

function lineNumber(content, offset) {
  return content.slice(0, offset).split("\n").length;
}

const files = [];
const manifestFiles = [resolve(root, "package.json")];
for (const folder of ["apps", "packages", "scripts", ".github"]) await walk(resolve(root, folder), files, manifestFiles).catch(() => undefined);
files.push(resolve(root, "release-filex-suite.bat"));

const usedDependencies = new Map();
const todos = [];
const placeholders = [];
for (const file of files) {
  let content;
  try { content = await readFile(file, "utf8"); } catch { continue; }
  const displayPath = relative(root, file).replaceAll("\\", "/");
  for (const match of content.matchAll(/(?:from\s*|import\s*\(|require\s*\(|require\.resolve\s*\()(["'])([^"']+)\1/g)) {
    const dependency = dependencyFromSpecifier(match[2]);
    if (dependency) usedDependencies.set(dependency, (usedDependencies.get(dependency) ?? 0) + 1);
  }
  if (displayPath !== "scripts/audit-project-health.mjs") {
    for (const match of content.matchAll(/\b(TODO|FIXME|HACK)\b[^\r\n]*/g)) todos.push({ file: displayPath, line: lineNumber(content, match.index), text: match[0].trim() });
  }
  for (const match of content.matchAll(/throw new Error\((['"`])(?:not implemented|non implementato|todo|da implementare)[^\1]*\1\)/gi)) placeholders.push({ file: displayPath, line: lineNumber(content, match.index), text: match[0] });
}

const declaredDependencies = new Map();
for (const manifestPath of [...new Set(manifestFiles)]) {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const displayPath = relative(root, manifestPath).replaceAll("\\", "/");
    for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      for (const dependency of Object.keys(manifest[field] ?? {})) {
        const entries = declaredDependencies.get(dependency) ?? [];
        entries.push({ manifest: displayPath, field });
        declaredDependencies.set(dependency, entries);
      }
    }
  } catch { /* l'audit resta leggibile anche con un manifest non valido */ }
}

const commandAliases = { "typescript": ["tsc"], "firebase-tools": ["firebase"] };
for (const [dependency, aliases] of Object.entries(commandAliases)) {
  let usedByScript = false;
  for (const entry of (declaredDependencies.get(dependency) ?? [])) {
    try {
      const manifest = JSON.parse(await readFile(resolve(root, entry.manifest), "utf8"));
      if (Object.values(manifest.scripts ?? {}).some((command) => aliases.some((alias) => new RegExp(`\\b${alias}\\b`, "u").test(String(command))))) {
        usedByScript = true;
        break;
      }
    } catch { /* il manifest è già stato gestito sopra */ }
  }
  if (usedByScript) usedDependencies.set(dependency, 1);
}

const unusedDependencies = [...declaredDependencies.entries()]
  .filter(([name]) => !usedDependencies.has(name))
  .map(([name, declarations]) => ({ name, declarations }))
  .sort((left, right) => left.name.localeCompare(right.name));
const report = {
  generatedAt: new Date().toISOString(),
  scope: "Lettura sola: nessun file o dipendenza è stato modificato.",
  summary: { scannedFiles: files.length, declaredDependencies: declaredDependencies.size, referencedDependencies: usedDependencies.size, unusedDependencyCandidates: unusedDependencies.length, todos: todos.length, placeholderImplementations: placeholders.length },
  unusedDependencies, todos, placeholderImplementations: placeholders,
};

if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
else {
  console.log("AUDIT QUALITÀ PROGETTO — sola lettura");
  console.log(`File analizzati: ${report.summary.scannedFiles}`);
  console.log(`Dipendenze candidate da verificare: ${report.summary.unusedDependencyCandidates}`);
  console.log(`TODO/FIXME/HACK: ${report.summary.todos}`);
  console.log(`Placeholder espliciti: ${report.summary.placeholderImplementations}`);
  console.log("\nLe dipendenze segnalate sono candidate: Electron, configurazioni e import dinamici possono generare falsi positivi.");
  for (const item of unusedDependencies) console.log(`- ${item.name} (${item.declarations.map((entry) => `${entry.manifest} · ${entry.field}`).join("; ")})`);
  if (todos.length) { console.log("\nTODO/FIXME/HACK:"); for (const item of todos) console.log(`- ${item.file}:${item.line} — ${item.text}`); }
  if (placeholders.length) { console.log("\nPlaceholder espliciti:"); for (const item of placeholders) console.log(`- ${item.file}:${item.line} — ${item.text}`); }
}
