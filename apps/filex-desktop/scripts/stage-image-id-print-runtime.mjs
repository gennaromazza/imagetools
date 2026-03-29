import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "..", "..");
const sourceRuntimeRoot = resolve(repoRoot, "apps", "IMAGE ID PRINT", "ai-sidecar");
const stagedRuntimeRoot = resolve(desktopRoot, "build", "generated", "image-id-print-runtime");
const platformTag = `${process.platform}-${process.arch}`;
const standaloneBundleRoot = resolve(
  sourceRuntimeRoot,
  "standalone-build",
  platformTag,
  "dist",
  "image-id-print-ai",
);
const stagedSidecarRoot = join(stagedRuntimeRoot, "sidecar");
const homeDir = process.env.USERPROFILE ?? process.env.HOME ?? "";
const sourceModelPath = homeDir ? resolve(homeDir, ".u2net", "u2net.onnx") : "";
const stagedModelDir = join(stagedRuntimeRoot, "models", "u2net");
const stagedModelRoot = join(stagedRuntimeRoot, "models");

function removeIfExists(targetPath) {
  if (!existsSync(targetPath)) {
    return;
  }

  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }

  if (lastError) {
    throw lastError;
  }
}

function copyIfExists(from, to, options) {
  if (!existsSync(from)) {
    return false;
  }

  cpSync(from, to, {
    recursive: true,
    force: true,
    ...options,
  });
  return true;
}

mkdirSync(stagedRuntimeRoot, { recursive: true });
removeIfExists(stagedSidecarRoot);
removeIfExists(stagedModelRoot);

if (!copyIfExists(standaloneBundleRoot, stagedSidecarRoot, { filter: () => true })) {
  throw new Error(`Standalone AI bundle non trovato: ${standaloneBundleRoot}`);
}

if (!sourceModelPath || !existsSync(sourceModelPath)) {
  throw new Error(
    "Modello u2net.onnx non trovato. Esegui prima lo script di download del modello.",
  );
}

mkdirSync(stagedModelDir, { recursive: true });
cpSync(sourceModelPath, join(stagedModelDir, "u2net.onnx"), { force: true });

const runtimeEntries = existsSync(stagedRuntimeRoot) ? readdirSync(stagedRuntimeRoot) : [];
console.log(
  `[image-id-print-runtime] staged ${runtimeEntries.length} root entries to ${stagedRuntimeRoot}`,
);
