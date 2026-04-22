import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(__dirname, "..", "..", "image-party-frame", ".output", "server", "server");
const targetDir = join(__dirname, "..", ".output", "electron", "image-party-frame-server", "server");

rmSync(targetDir, { recursive: true, force: true });

if (!existsSync(sourceDir)) {
  throw new Error(`Image Party Frame server build non trovato: ${sourceDir}`);
}

mkdirSync(dirname(targetDir), { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });
