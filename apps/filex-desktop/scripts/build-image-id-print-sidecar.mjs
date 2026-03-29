import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "..", "..");
const sidecarRoot = resolve(repoRoot, "apps", "IMAGE ID PRINT", "ai-sidecar");
const platformTag = `${process.platform}-${process.arch}`;
const standaloneRoot = resolve(sidecarRoot, "standalone-build", platformTag);
const distDir = join(standaloneRoot, "dist");
const buildDir = join(standaloneRoot, "work");
const specDir = join(standaloneRoot, "spec");
const bundleName = "image-id-print-ai";
const bundleRoot = join(distDir, bundleName);
const manifestPath = join(standaloneRoot, "manifest.json");
const venvManifestPath = join(standaloneRoot, "venv-manifest.json");
const requirementsBuildPath = join(sidecarRoot, "requirements-build.txt");
const sourceEntryPath = join(sidecarRoot, "rembg_server.py");
const requirementsPath = join(sidecarRoot, "requirements.txt");
const scriptPath = fileURLToPath(import.meta.url);

function removeIfExists(targetPath) {
  if (existsSync(targetPath)) {
    rmSync(targetPath, { recursive: true, force: true });
  }
}

function resolveVenvPythonOptional() {
  const candidates = process.platform === "win32"
    ? [join(sidecarRoot, ".venv", "Scripts", "python.exe")]
    : [
        join(sidecarRoot, ".venv", "bin", "python3"),
        join(sidecarRoot, ".venv", "bin", "python"),
      ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveVenvPython() {
  const pythonExecutable = resolveVenvPythonOptional();
  if (pythonExecutable) {
    return pythonExecutable;
  }

  throw new Error("Python virtualenv del sidecar non trovato.");
}

function commandExists(command, args = []) {
  try {
    execFileSync(command, [...args, "--version"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function resolveBootstrapPython() {
  const envOverride = process.env.PYTHON?.trim();
  const candidates = [
    ...(envOverride ? [{ command: envOverride, args: [] }] : []),
    ...(process.platform === "win32"
      ? [
          { command: "py", args: ["-3"] },
          { command: "python", args: [] },
        ]
      : [
          { command: "python3", args: [] },
          { command: "python", args: [] },
        ]),
  ];

  for (const candidate of candidates) {
    if (commandExists(candidate.command, candidate.args)) {
      return candidate;
    }
  }

  throw new Error("Python non trovato per creare il virtualenv del sidecar.");
}

function resolvePyInstallerExecutable() {
  const candidates = process.platform === "win32"
    ? [join(sidecarRoot, ".venv", "Scripts", "pyinstaller.exe")]
    : [join(sidecarRoot, ".venv", "bin", "pyinstaller")];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getFileSignature(pathname) {
  const stats = statSync(pathname);
  return {
    path: pathname,
    size: stats.size,
    mtimeMs: Math.round(stats.mtimeMs),
  };
}

function readManifest() {
  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

function readVenvManifest() {
  if (!existsSync(venvManifestPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(venvManifestPath, "utf8"));
  } catch {
    return null;
  }
}

function bundleExecutablePath() {
  return process.platform === "win32"
    ? join(bundleRoot, `${bundleName}.exe`)
    : join(bundleRoot, bundleName);
}

function currentInputs() {
  return [
    getFileSignature(sourceEntryPath),
    getFileSignature(requirementsPath),
    getFileSignature(requirementsBuildPath),
    getFileSignature(scriptPath),
  ];
}

function currentDependencyInputs() {
  return [
    getFileSignature(requirementsPath),
    getFileSignature(requirementsBuildPath),
  ];
}

function needsRebuild() {
  const outputExecutable = bundleExecutablePath();
  if (!existsSync(outputExecutable)) {
    return true;
  }

  const manifest = readManifest();
  if (!manifest) {
    return true;
  }

  const inputs = currentInputs();
  const previousInputs = Array.isArray(manifest.inputs) ? manifest.inputs : [];
  if (previousInputs.length !== inputs.length) {
    return true;
  }

  return inputs.some((input, index) => {
    const previous = previousInputs[index];
    return !previous
      || previous.path !== input.path
      || previous.size !== input.size
      || previous.mtimeMs !== input.mtimeMs;
  });
}

function ensurePyInstallerInstalled(pythonExecutable) {
  if (resolvePyInstallerExecutable()) {
    return;
  }

  console.log("[image-id-print-sidecar] installing build dependencies...");
  execFileSync(
    pythonExecutable,
    ["-m", "pip", "install", "-r", requirementsBuildPath],
    {
      cwd: sidecarRoot,
      stdio: "inherit",
    },
  );
}

function ensureVenvExists() {
  const existingPython = resolveVenvPythonOptional();
  if (existingPython) {
    return existingPython;
  }

  const bootstrapPython = resolveBootstrapPython();
  console.log("[image-id-print-sidecar] creating virtualenv...");
  execFileSync(
    bootstrapPython.command,
    [...bootstrapPython.args, "-m", "venv", ".venv"],
    {
      cwd: sidecarRoot,
      stdio: "inherit",
    },
  );

  return resolveVenvPython();
}

function needsDependencyInstall() {
  if (!resolveVenvPythonOptional()) {
    return true;
  }

  if (!resolvePyInstallerExecutable()) {
    return true;
  }

  const manifest = readVenvManifest();
  if (!manifest) {
    return true;
  }

  const inputs = currentDependencyInputs();
  const previousInputs = Array.isArray(manifest.inputs) ? manifest.inputs : [];
  if (previousInputs.length !== inputs.length) {
    return true;
  }

  return inputs.some((input, index) => {
    const previous = previousInputs[index];
    return !previous
      || previous.path !== input.path
      || previous.size !== input.size
      || previous.mtimeMs !== input.mtimeMs;
  });
}

function installSidecarDependencies(pythonExecutable) {
  console.log("[image-id-print-sidecar] installing sidecar dependencies...");
  execFileSync(
    pythonExecutable,
    ["-m", "pip", "install", "--upgrade", "pip"],
    {
      cwd: sidecarRoot,
      stdio: "inherit",
    },
  );
  execFileSync(
    pythonExecutable,
    ["-m", "pip", "install", "-r", requirementsPath, "-r", requirementsBuildPath],
    {
      cwd: sidecarRoot,
      stdio: "inherit",
    },
  );
}

function writeManifest() {
  mkdirSync(standaloneRoot, { recursive: true });
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        bundleName,
        platformTag,
        builtAt: new Date().toISOString(),
        inputs: currentInputs(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

function writeVenvManifest() {
  mkdirSync(standaloneRoot, { recursive: true });
  writeFileSync(
    venvManifestPath,
    JSON.stringify(
      {
        platformTag,
        installedAt: new Date().toISOString(),
        inputs: currentDependencyInputs(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

const pythonExecutable = ensureVenvExists();
if (needsDependencyInstall()) {
  installSidecarDependencies(pythonExecutable);
  writeVenvManifest();
} else {
  ensurePyInstallerInstalled(pythonExecutable);
}

const pyInstallerExecutable = resolvePyInstallerExecutable();

if (!pyInstallerExecutable) {
  throw new Error("PyInstaller non disponibile nel venv del sidecar.");
}

if (!needsRebuild()) {
  console.log(`[image-id-print-sidecar] reusing cached bundle at ${bundleRoot}`);
  process.exit(0);
}

console.log("[image-id-print-sidecar] rebuilding standalone AI sidecar...");
removeIfExists(distDir);
removeIfExists(buildDir);
removeIfExists(specDir);
mkdirSync(standaloneRoot, { recursive: true });

const pyInstallerArgs = [
  "--noconfirm",
  "--clean",
  "--onedir",
  "--name", bundleName,
  "--distpath", distDir,
  "--workpath", buildDir,
  "--specpath", specDir,
  "--collect-all", "cv2",
  "--collect-all", "rembg",
  "--collect-all", "pymatting",
  "--collect-all", "PIL",
  "--collect-all", "scipy",
  "--collect-all", "skimage",
  "--collect-all", "imageio",
  "--hidden-import", "flask",
  "--hidden-import", "flask_cors",
  "--hidden-import", "onnxruntime",
  sourceEntryPath,
];

execFileSync(pyInstallerExecutable, pyInstallerArgs, {
  cwd: sidecarRoot,
  stdio: "inherit",
});

writeManifest();

const bundleEntries = existsSync(bundleRoot) ? readdirSync(bundleRoot) : [];
console.log(
  `[image-id-print-sidecar] built ${bundleName} with ${bundleEntries.length} top-level entries at ${bundleRoot}`,
);
