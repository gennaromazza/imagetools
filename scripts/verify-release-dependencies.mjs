import { access, lstat, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const root = process.cwd();
const rootPackage = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const manifests = [{ directory: root, package: rootPackage }];

for (const workspacePattern of rootPackage.workspaces ?? []) {
  const parent = workspacePattern.replace(/[\\/]\*$/u, "");
  if (parent === workspacePattern) continue;
  const parentPath = resolve(root, parent);
  for (const entry of await readdir(parentPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packagePath = join(parentPath, entry.name, "package.json");
    try {
      manifests.push({
        directory: dirname(packagePath),
        package: JSON.parse(await readFile(packagePath, "utf8")),
      });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

const workspaceNames = new Set(manifests.map((item) => item.package.name).filter(Boolean));
const missing = new Set();

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

for (const { directory, package: packageJson } of manifests) {
  const dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
    ...(packageJson.optionalDependencies ?? {}),
  };
  for (const dependencyName of Object.keys(dependencies)) {
    const packageParts = dependencyName.split("/");
    const relativePackagePath = join(...packageParts, "package.json");
    const localCandidate = join(directory, "node_modules", relativePackagePath);
    const rootCandidate = join(root, "node_modules", relativePackagePath);
    if (await exists(localCandidate) || await exists(rootCandidate)) continue;
    const label = workspaceNames.has(dependencyName) ? `${dependencyName} (collegamento workspace)` : dependencyName;
    missing.add(`${packageJson.name ?? "root"}: ${label}`);
  }
}

for (const executable of ["tsc.cmd", "tsx.cmd", "electron.cmd", "electron-builder.cmd"]) {
  const candidates = [
    join(root, "node_modules", ".bin", executable),
    join(root, "apps", "filex-desktop", "node_modules", ".bin", executable),
  ];
  if (!(await Promise.all(candidates.map(exists))).some(Boolean)) missing.add(`comando: ${executable}`);
}

const electronCandidates = [
  join(root, "node_modules", "electron"),
  join(root, "apps", "filex-desktop", "node_modules", "electron"),
];
let electronReady = false;
for (const electronDir of electronCandidates) {
  try {
    const pointer = (await readFile(join(electronDir, "path.txt"), "utf8")).trim();
    const executable = join(electronDir, "dist", pointer);
    const info = await lstat(executable);
    if (info.isFile()) { electronReady = true; break; }
  } catch { /* prova il candidato successivo */ }
}
if (!electronReady) missing.add("runtime Electron completo (path.txt + eseguibile)");

if (missing.size > 0) {
  console.error("Dipendenze locali incomplete:");
  for (const item of [...missing].sort()) console.error(`- ${item}`);
  process.exit(1);
}

console.log(`Dipendenze locali risolvibili per ${manifests.length} workspace.`);
