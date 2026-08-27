import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = process.cwd();
const releaseRoot = resolve(root, "apps/filex-desktop/.output/releases/win-unpacked");
const archivePath = join(releaseRoot, "resources", "app.asar");
const executablePath = join(releaseRoot, "FileX-Send.exe");
const packageJson = JSON.parse(await readFile(resolve(root, "apps/filex-send/package.json"), "utf8"));

for (const requiredPath of [archivePath, executablePath]) {
  if (!existsSync(requiredPath)) throw new Error(`Pacchetto FileX Send non trovato: ${requiredPath}`);
}

const verification = spawnSync(process.execPath, [
  resolve(root, "apps/filex-desktop/scripts/verify-packaged-component.mjs"),
  "--component=filex-send",
  `--version=${packageJson.version}`,
  `--archive=${archivePath}`,
], { cwd: root, stdio: "inherit" });
if (verification.status !== 0) throw new Error(`Verifica ASAR FileX Send fallita con codice ${verification.status ?? "sconosciuto"}.`);

const profilePath = await mkdtemp(join(tmpdir(), "filex-send-packaged-smoke-"));
try {
  const result = await runPackagedSmoke(executablePath, profilePath);
  if (result.code !== 0) {
    throw new Error(`Smoke test main process fallito con codice ${result.code ?? "sconosciuto"}.\n${result.output}`);
  }
  console.log(`FileX Send ${packageJson.version}: packaged main smoke PASS.`);
} finally {
  await rm(profilePath, { recursive: true, force: true });
}

function runPackagedSmoke(executable, profilePath) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, [
      "--filex-packaged-smoke-test",
      `--user-data-dir=${profilePath}`,
    ], {
      cwd: releaseRoot,
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", reject);
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Smoke test main process non concluso entro 30 secondi.\n${output}`));
    }, 30_000);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolveResult({ code, output });
    });
  });
}
