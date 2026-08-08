import electronUpdater from "electron-updater";
import type { DesktopSuiteUpdateState } from "@photo-tools/desktop-contracts";
import https from "node:https";

const { autoUpdater } = electronUpdater;

let configured = false;
let enabled = false;
let prereleaseEnabled = false;
let emitState: (state: DesktopSuiteUpdateState) => void = () => undefined;
let state: DesktopSuiteUpdateState = {
  status: "idle",
  currentVersion: "0.0.0",
  availableVersion: null,
  percent: null,
  transferredBytes: 0,
  totalBytes: null,
  bytesPerSecond: null,
  error: null,
};

function snapshot(): DesktopSuiteUpdateState {
  return { ...state };
}

function patchState(partial: Partial<DesktopSuiteUpdateState>): DesktopSuiteUpdateState {
  state = { ...state, ...partial };
  const next = snapshot();
  emitState(next);
  return next;
}

function normalizeVersion(value: string): number[] {
  return value
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part.replace(/[^\d].*$/g, ""), 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersions(left: string, right: string): number {
  const leftParts = normalizeVersion(left);
  const rightParts = normalizeVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function requestLatestStableVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      "https://api.github.com/repos/gennaromazza/imagetools/releases/latest",
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "FileX-Suite-Updater/1.0",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
      (response) => {
        if (!response.statusCode || response.statusCode >= 400) {
          response.resume();
          reject(new Error(`Controllo release non riuscito (${response.statusCode ?? "unknown"})`));
          return;
        }
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { tag_name?: string };
            if (!payload.tag_name) throw new Error("Versione release mancante");
            resolve(payload.tag_name.replace(/^v/i, ""));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.setTimeout(15_000, () => request.destroy(new Error("Timeout controllo aggiornamenti")));
    request.on("error", reject);
  });
}

export function configureSuiteUpdater(options: {
  currentVersion: string;
  enabled: boolean;
  allowPrerelease: boolean;
  onState: (state: DesktopSuiteUpdateState) => void;
}): DesktopSuiteUpdateState {
  emitState = options.onState;
  enabled = options.enabled;
  prereleaseEnabled = options.allowPrerelease;
  state = {
    ...state,
    currentVersion: options.currentVersion,
    status: enabled ? "idle" : "disabled",
    error: null,
  };

  if (!enabled || configured) return snapshot();
  configured = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = options.allowPrerelease;

  autoUpdater.on("checking-for-update", () => {
    patchState({ status: "checking", error: null, percent: null });
  });
  autoUpdater.on("update-available", (info) => {
    patchState({
      status: "available",
      availableVersion: info.version,
      error: null,
      percent: 0,
      transferredBytes: 0,
      totalBytes: null,
      bytesPerSecond: null,
    });
  });
  autoUpdater.on("download-progress", (progress) => {
    patchState({
      status: "downloading",
      percent: Math.min(100, Math.max(0, progress.percent)),
      transferredBytes: progress.transferred,
      totalBytes: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
      error: null,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    patchState({
      status: "ready",
      availableVersion: info.version,
      percent: 100,
      error: null,
    });
  });
  autoUpdater.on("update-not-available", (info) => {
    patchState({
      status: "up-to-date",
      availableVersion: info.version,
      percent: null,
      error: null,
    });
  });
  autoUpdater.on("error", (error) => {
    patchState({
      status: "error",
      error: error.message || String(error),
      percent: null,
    });
  });

  return snapshot();
}

export function getSuiteUpdateState(): DesktopSuiteUpdateState {
  return snapshot();
}

export async function checkSuiteUpdate(): Promise<DesktopSuiteUpdateState> {
  if (!enabled) return snapshot();
  if (state.status === "checking" || state.status === "downloading" || state.status === "ready") {
    return snapshot();
  }
  patchState({ status: "checking", error: null, percent: null });
  try {
    if (!prereleaseEnabled) {
      const latestVersion = await requestLatestStableVersion();
      if (compareVersions(latestVersion, state.currentVersion) <= 0) {
        return patchState({
          status: "up-to-date",
          availableVersion: latestVersion,
          error: null,
          percent: null,
        });
      }
      patchState({ status: "available", availableVersion: latestVersion, percent: 0 });
    }
    await autoUpdater.checkForUpdates();
  } catch (error) {
    patchState({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return snapshot();
}

export function installSuiteUpdate(): DesktopSuiteUpdateState {
  if (!enabled || state.status !== "ready") return snapshot();
  const next = patchState({ status: "installing", error: null });
  setTimeout(() => {
    try {
      autoUpdater.quitAndInstall(true, true);
    } catch (error) {
      patchState({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, 250);
  return next;
}
