import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "..", "..");
const homeDir = process.env.USERPROFILE ?? process.env.HOME ?? "";

if (!homeDir) {
  throw new Error("Home directory non disponibile per salvare il modello u2net.");
}

const targetDir = resolve(homeDir, ".u2net");
const targetPath = resolve(targetDir, "u2net.onnx");
const tempPath = resolve(targetDir, "u2net.onnx.download");
const modelUrl = process.env.IMAGE_ID_PRINT_MODEL_URL
  ?? "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx";

function hasValidModel(pathname) {
  if (!existsSync(pathname)) {
    return false;
  }

  try {
    return statSync(pathname).size > 0;
  } catch {
    return false;
  }
}

if (hasValidModel(targetPath)) {
  console.log(`[image-id-print-model] reusing existing model at ${targetPath}`);
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });
if (existsSync(tempPath)) {
  rmSync(tempPath, { force: true });
}

console.log(`[image-id-print-model] downloading model from ${modelUrl}`);
const response = await fetch(modelUrl);
if (!response.ok || !response.body) {
  throw new Error(`Download modello fallito (${response.status} ${response.statusText})`);
}

await pipeline(
  Readable.fromWeb(response.body),
  createWriteStream(tempPath),
);

renameSync(tempPath, targetPath);
console.log(`[image-id-print-model] ready at ${targetPath}`);
