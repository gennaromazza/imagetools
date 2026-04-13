// clean-release.mjs
// Cancella tutto in release/ tranne _distribuzione/
import { readdirSync, statSync, rmSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const releaseDir = join(__dirname, "..", "release");
const keepDir = "_distribuzione";

const entries = readdirSync(releaseDir);
for (const entry of entries) {
  if (entry === keepDir) continue;
  const full = join(releaseDir, entry);
  rmSync(full, { recursive: true, force: true });
  console.log(`Cancellato: ${entry}`);
}
console.log("Pulizia completata. Rimane solo _distribuzione/.");
