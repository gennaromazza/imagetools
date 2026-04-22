import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(__dirname, "..", "..", "archivio-flow", ".output", "server");
const targetDir = join(__dirname, "..", ".output", "electron", "archivio-flow-server");

rmSync(targetDir, { recursive: true, force: true });

if (!existsSync(sourceDir)) {
  throw new Error(`Archivio Flow server build non trovato: ${sourceDir}`);
}

mkdirSync(dirname(targetDir), { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });
