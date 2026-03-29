import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { app } from "electron";
import { getDesktopToolOrDefault } from "./tool-manifest.js";

export type ImageIdPrintAiStatus =
  | "disabled"
  | "starting"
  | "ready"
  | "error"
  | "stopped";

export interface ImageIdPrintAiServiceState {
  enabled: boolean;
  managedByDesktopShell: boolean;
  status: ImageIdPrintAiStatus;
  url: string;
  detail: string;
  lastError: string | null;
  pid: number | null;
}

const requestedTool = getDesktopToolOrDefault(process.env.FILEX_TOOL);
const DEFAULT_PORT = Number(process.env.IMAGE_ID_PRINT_AI_PORT ?? "7010");
const HEALTH_TIMEOUT_MS = 1500;
const STARTUP_TIMEOUT_MS = 90000;

let childProcess: ChildProcessWithoutNullStreams | null = null;
let startPromise: Promise<void> | null = null;
let currentState: ImageIdPrintAiServiceState = buildState("disabled", {
  enabled: requestedTool.id === "image-id-print",
  detail: requestedTool.id === "image-id-print"
    ? "Motore AI non inizializzato."
    : "Motore AI non richiesto per questo tool.",
});

function buildState(
  status: ImageIdPrintAiStatus,
  overrides: Partial<ImageIdPrintAiServiceState> = {},
): ImageIdPrintAiServiceState {
  return {
    enabled: requestedTool.id === "image-id-print",
    managedByDesktopShell: requestedTool.id === "image-id-print",
    status,
    url: `http://127.0.0.1:${DEFAULT_PORT}`,
    detail: "Motore AI non inizializzato.",
    lastError: null,
    pid: childProcess?.pid ?? null,
    ...overrides,
  };
}

function setState(
  status: ImageIdPrintAiStatus,
  overrides: Partial<ImageIdPrintAiServiceState> = {},
): void {
  currentState = buildState(status, {
    ...overrides,
    pid: childProcess?.pid ?? overrides.pid ?? null,
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

async function isHealthReady(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const response = await fetch(`${currentState.url}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

function resolveRuntimeRoot(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "image-id-print-runtime");
  }

  return resolve(app.getAppPath(), "..", "IMAGE ID PRINT", "ai-sidecar");
}

function resolveModelDir(runtimeRoot: string): string | null {
  const bundledModelDir = join(runtimeRoot, "models", "u2net");
  if (existsSync(bundledModelDir)) {
    return bundledModelDir;
  }

  const userModelDir = join(app.getPath("home"), ".u2net");
  return existsSync(userModelDir) ? userModelDir : null;
}

function resolveStandaloneExecutable(runtimeRoot: string): string | null {
  const platformTag = `${process.platform}-${process.arch}`;
  const candidates = process.platform === "win32"
    ? [
        join(runtimeRoot, "sidecar", "image-id-print-ai.exe"),
        join(runtimeRoot, "standalone-build", platformTag, "dist", "image-id-print-ai", "image-id-print-ai.exe"),
        join(runtimeRoot, "pyinstaller-dist", "image-id-print-ai", "image-id-print-ai.exe"),
      ]
    : [
        join(runtimeRoot, "sidecar", "image-id-print-ai"),
        join(runtimeRoot, "standalone-build", platformTag, "dist", "image-id-print-ai", "image-id-print-ai"),
        join(runtimeRoot, "pyinstaller-dist", "image-id-print-ai", "image-id-print-ai"),
      ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolvePythonExecutable(runtimeRoot: string): string | null {
  const candidates = process.platform === "win32"
    ? [
        join(runtimeRoot, ".venv", "Scripts", "python.exe"),
        join(runtimeRoot, "python", "python.exe"),
      ]
    : [
        join(runtimeRoot, ".venv", "bin", "python3"),
        join(runtimeRoot, ".venv", "bin", "python"),
        join(runtimeRoot, "python", "bin", "python3"),
      ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return app.isPackaged ? null : "python";
}

function resolveServerScript(runtimeRoot: string): string | null {
  const candidates = [
    join(runtimeRoot, "rembg_server.py"),
    join(runtimeRoot, "server", "rembg_server.py"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveLaunchTarget(runtimeRoot: string): {
  command: string;
  args: string[];
  cwd: string;
  detail: string;
} | null {
  const standaloneExecutable = resolveStandaloneExecutable(runtimeRoot);
  if (standaloneExecutable) {
    return {
      command: standaloneExecutable,
      args: [],
      cwd: dirname(standaloneExecutable),
      detail: "sidecar standalone",
    };
  }

  const pythonExecutable = resolvePythonExecutable(runtimeRoot);
  const serverScript = resolveServerScript(runtimeRoot);
  if (pythonExecutable && serverScript) {
    return {
      command: pythonExecutable,
      args: [serverScript],
      cwd: runtimeRoot,
      detail: "sidecar python",
    };
  }

  return null;
}

function destroyChildProcess(): void {
  if (!childProcess) {
    return;
  }

  const processToStop = childProcess;
  childProcess = null;

  try {
    processToStop.kill();
  } catch {
    /* ignore */
  }
}

async function waitForHealthOrThrow(): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    if (await isHealthReady()) {
      setState("ready", {
        detail: "Motore AI pronto.",
      });
      return;
    }

    if (!childProcess) {
      break;
    }

    await delay(400);
  }

  throw new Error("Timeout avvio motore AI locale.");
}

export function getImageIdPrintAiServiceState(): ImageIdPrintAiServiceState {
  return currentState;
}

export async function ensureImageIdPrintAiService(): Promise<void> {
  if (requestedTool.id !== "image-id-print") {
    setState("disabled", {
      enabled: false,
      managedByDesktopShell: false,
      detail: "Motore AI non richiesto per questo tool.",
    });
    return;
  }

  if (await isHealthReady()) {
    setState("ready", {
      detail: "Motore AI locale gia disponibile.",
    });
    return;
  }

  if (startPromise) {
    return startPromise;
  }

  startPromise = (async () => {
    const runtimeRoot = resolveRuntimeRoot();
    const launchTarget = resolveLaunchTarget(runtimeRoot);
    const modelDir = resolveModelDir(runtimeRoot);

    if (!launchTarget) {
      throw new Error("Runtime AI locale non trovato nel pacchetto.");
    }

    setState("starting", {
      detail: app.isPackaged
        ? `Avvio motore AI integrato (${launchTarget.detail})...`
        : `Avvio motore AI in ambiente di sviluppo (${launchTarget.detail})...`,
    });

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      IMAGE_ID_PRINT_AI_PORT: String(DEFAULT_PORT),
      PYTHONUNBUFFERED: "1",
    };

    if (modelDir) {
      childEnv.U2NET_HOME = modelDir;
    }

    const child = spawn(launchTarget.command, launchTarget.args, {
      cwd: launchTarget.cwd,
      env: childEnv,
      stdio: "pipe",
      windowsHide: true,
    });
    childProcess = child;

    child.stdout.on("data", (chunk) => {
      const message = String(chunk).trim();
      if (!message) {
        return;
      }
      if (currentState.status === "starting") {
        setState("starting", {
          detail: message,
        });
      }
    });

    child.stderr.on("data", (chunk) => {
      const message = String(chunk).trim();
      if (!message) {
        return;
      }
      setState("starting", {
        detail: message,
      });
    });

    child.once("exit", (code, signal) => {
      const detail = code === 0
        ? "Motore AI terminato."
        : `Motore AI terminato in modo inatteso${code !== null ? ` (code ${code})` : ""}${signal ? ` (${signal})` : ""}.`;
      if (currentState.status !== "ready") {
        setState("error", {
          detail,
          lastError: detail,
          pid: null,
        });
      } else {
        setState("stopped", {
          detail,
          lastError: currentState.lastError,
          pid: null,
        });
      }
      childProcess = null;
    });

    child.once("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      setState("error", {
        detail: message,
        lastError: message,
        pid: null,
      });
      childProcess = null;
    });

    await waitForHealthOrThrow();
  })().catch((error) => {
    destroyChildProcess();
    const message = error instanceof Error ? error.message : String(error);
    setState("error", {
      detail: message,
      lastError: message,
      pid: null,
    });
    throw error;
  }).finally(() => {
    startPromise = null;
  });

  return startPromise;
}

export function shutdownImageIdPrintAiService(): void {
  destroyChildProcess();
  if (requestedTool.id === "image-id-print") {
    setState("stopped", {
      detail: "Motore AI arrestato.",
      pid: null,
    });
  }
}
