/**
 * collect-installers.mjs
 * Copia gli installer reali (>50 MB) dalla cartella .output/releases/ in .output/installers/
 * Viene eseguito automaticamente dopo dist:all-tools:win
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, rmSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputRoot = join(__dirname, "..", ".output");
const releaseDir = join(outputRoot, "releases");
const distDir = join(outputRoot, "installers");

const MIN_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

// Svuota e ricrea la cartella installers
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}
mkdirSync(distDir, { recursive: true });

const files = readdirSync(releaseDir).filter(
  (f) => f.endsWith("-setup.exe") && statSync(join(releaseDir, f)).size > MIN_SIZE_BYTES
);

if (files.length === 0) {
  console.error("ATTENZIONE: nessun installer trovato in .output/releases/");
  process.exit(1);
}

for (const file of files) {
  copyFileSync(join(releaseDir, file), join(distDir, file));
  const mb = (statSync(join(releaseDir, file)).size / 1024 / 1024).toFixed(1);
  console.log(`  ✓ ${file} (${mb} MB)`);
}

console.log(`\n${files.length} installer copiati in:\n  ${distDir}\n`);
