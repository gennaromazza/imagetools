import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { downloadArtifact } from "@electron/get";

if (process.platform !== "win32") throw new Error("Il ripristino Electron di release è previsto soltanto per Windows.");

const root = realpathSync(process.cwd());
const appsRoot = realpathSync(join(root, "apps"));
const rootPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const electronPackages = [];

for (const workspacePattern of rootPackage.workspaces ?? []) {
  if (workspacePattern !== "apps/*") continue;
  const { readdirSync } = await import("node:fs");
  for (const entry of readdirSync(appsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packagePath = join(appsRoot, entry.name, "package.json");
    if (!existsSync(packagePath)) continue;
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    const requestedVersion = packageJson.devDependencies?.electron ?? packageJson.dependencies?.electron;
    if (requestedVersion) electronPackages.push({ workspace: entry.name, version: requestedVersion });
  }
}

const versions = new Set(electronPackages.map((item) => item.version));
if (versions.size !== 1) throw new Error(`Versioni Electron non uniformi: ${[...versions].join(", ")}`);
const version = [...versions][0];
if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error(`Versione Electron non esatta: ${version}`);

const archivePath = await downloadArtifact({ version, artifactName: "electron", platform: "win32", arch: "x64" });
if (!isAbsolute(archivePath) || !existsSync(archivePath)) throw new Error("Archivio Electron verificato non disponibile.");

for (const item of electronPackages) {
  const packageDir = realpathSync(join(appsRoot, item.workspace, "node_modules", "electron"));
  const relativeToApps = relative(appsRoot, packageDir);
  if (!relativeToApps || relativeToApps.startsWith("..") || isAbsolute(relativeToApps)) {
    throw new Error(`Target Electron fuori apps: ${packageDir}`);
  }
  if (lstatSync(packageDir).isSymbolicLink()) throw new Error(`Package Electron simbolico non consentito: ${packageDir}`);
  const distDir = resolve(packageDir, "dist");
  if (dirname(distDir) !== packageDir) throw new Error(`Target dist inatteso: ${distDir}`);
  if (existsSync(distDir) && lstatSync(distDir).isSymbolicLink()) throw new Error(`dist Electron simbolica non consentita: ${distDir}`);
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });
  execFileSync("tar.exe", ["-xf", archivePath, "-C", distDir], { stdio: "inherit", windowsHide: true });
  const executable = join(distDir, "electron.exe");
  if (!existsSync(executable) || !lstatSync(executable).isFile()) throw new Error(`electron.exe non estratto per ${item.workspace}`);
  writeFileSync(join(packageDir, "path.txt"), "electron.exe", "ascii");
  console.log(`Electron ${version} verificato: ${item.workspace}`);
}
