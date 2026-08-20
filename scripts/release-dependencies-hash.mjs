import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
}

const [lockfile, rootPackage, desktopPackage] = await Promise.all([
  readJson("package-lock.json"),
  readJson("package.json"),
  readJson("apps/filex-desktop/package.json"),
]);

// Il bump della release non modifica le dipendenze. Escludiamo quindi solo
// le versioni del root e della Suite, mantenendo nel fingerprint ogni vera
// modifica a dipendenze, lockfile o altri workspace.
for (const packagePath of ["", "apps/filex-desktop"]) {
  delete lockfile.packages?.[packagePath]?.version;
}
delete rootPackage.version;
delete desktopPackage.version;

const hash = createHash("sha256")
  .update(JSON.stringify(lockfile))
  .update(JSON.stringify(rootPackage))
  .update(JSON.stringify(desktopPackage))
  .update(process.version)
  .digest("hex");

process.stdout.write(`${hash}\n`);
