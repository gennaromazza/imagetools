import electronUpdater from "electron-updater";
import type { DesktopSuiteUpdateState } from "@photo-tools/desktop-contracts";

const { autoUpdater } = electronUpdater;

let configured = false;
let enabled = false;
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

function getSuiteFeedUrl(allowPrerelease: boolean): string {
  const explicitUrl = allowPrerelease
    ? process.env.FILEX_SUITE_UPDATE_BETA_URL
    : process.env.FILEX_SUITE_UPDATE_STABLE_URL;
  if (explicitUrl?.trim()) return explicitUrl.trim().replace(/\/+$/, "");

  const channelTag = allowPrerelease
    ? "suite-channel-beta"
    : "suite-channel-stable";
  return `https://github.com/gennaromazza/imagetools/releases/download/${channelTag}`;
}

export function configureSuiteUpdater(options: {
  currentVersion: string;
  enabled: boolean;
  allowPrerelease: boolean;
  onState: (state: DesktopSuiteUpdateState) => void;
}): DesktopSuiteUpdateState {
  emitState = options.onState;
  enabled = options.enabled;
  state = {
    ...state,
    currentVersion: options.currentVersion,
    status: enabled ? "idle" : "disabled",
    error: null,
  };

  if (!enabled || configured) return snapshot();
  configured = true;
  autoUpdater.autoDownload = true;
  // Senza certificato l'utente deve poter vedere e confermare SmartScreen.
  // L'installazione parte quindi solo dal comando esplicito nella Suite.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = options.allowPrerelease;
  autoUpdater.setFeedURL({
    provider: "generic",
    url: getSuiteFeedUrl(options.allowPrerelease),
  });

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
      autoUpdater.quitAndInstall(false, true);
    } catch (error) {
      patchState({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, 250);
  return next;
}
