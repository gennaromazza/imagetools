import { extractFile, listPackage } from "@electron/asar";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { spawn } from "node:child_process";

const asarPath = resolve("apps/filex-desktop/.output/releases/win-unpacked/resources/app.asar");
const executablePath = resolve("apps/filex-desktop/.output/releases/win-unpacked/FileX-Suite.exe");
const entries = new Set((await listPackage(asarPath)).map((entry) => entry.replace(/^\\/, "").replaceAll("\\", "/")));
const queue = [".output/electron/suite-main.js"];
const visited = new Set();

while (queue.length) {
  const current = queue.shift();
  if (visited.has(current)) continue;
  visited.add(current);
  if (!entries.has(current)) throw new Error(`Modulo runtime mancante nell'ASAR: ${current}`);

  const source = extractFile(asarPath, current.replaceAll("/", "\\")).toString("utf8");
  const imports = source.matchAll(/(?:from\s+|import\s*\()?["'](\.\.?\/[^"']+\.js)["']/g);
  for (const match of imports) {
    const target = posix.normalize(posix.join(dirname(current).replaceAll("\\", "/"), match[1]));
    if (!entries.has(target)) throw new Error(`Import runtime mancante: ${current} -> ${target}`);
    queue.push(target);
  }
}

const profilePath = await mkdtemp(join(tmpdir(), "filex-suite-packaged-smoke-"));
try {
  const exitCode = await runPackagedSmoke(executablePath, profilePath);
  if (exitCode !== 0) throw new Error(`Smoke test Suite impacchettata fallito con codice ${exitCode}.`);
} finally {
  await rm(profilePath, { recursive: true, force: true });
}

console.log(`FileX Suite packaged runtime: PASS (${visited.size} moduli e main process avviato)`);

function runPackagedSmoke(executable, profilePath) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, [
      "--filex-suite-packaged-smoke-test",
      `--user-data-dir=${profilePath}`,
    ], {
      cwd: dirname(executable),
      windowsHide: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Smoke test Suite non concluso entro 30 secondi."));
    }, 30_000);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolveResult(code);
    });
  });
}
