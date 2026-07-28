import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { NetworkDriveConfig, NetworkDriveStatusReport } from "@photo-tools/desktop-contracts";

const CONFIG_FILE_NAME = "network-drive-doctor.json";

export const DEFAULT_NETWORK_DRIVE_CONFIG: NetworkDriveConfig = {
  driveLetter: "Z:",
  uncPath: "",
  autoCheckOnStartup: true,
};

interface StoredNetworkDriveState {
  config?: Partial<NetworkDriveConfig>;
  lastReport?: NetworkDriveStatusReport;
}

function normalizeDriveLetter(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  const match = raw.match(/^([A-Z])(?::)?$/);
  return match ? `${match[1]}:` : DEFAULT_NETWORK_DRIVE_CONFIG.driveLetter;
}

function normalizeUncPath(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.startsWith("\\\\") ? raw.replace(/[\\/]+$/, "") : raw;
}

export function normalizeNetworkDriveConfig(input: Partial<NetworkDriveConfig> | undefined): NetworkDriveConfig {
  return {
    driveLetter: normalizeDriveLetter(input?.driveLetter),
    uncPath: normalizeUncPath(input?.uncPath),
    autoCheckOnStartup: typeof input?.autoCheckOnStartup === "boolean"
      ? input.autoCheckOnStartup
      : DEFAULT_NETWORK_DRIVE_CONFIG.autoCheckOnStartup,
  };
}

function getConfigPath(dataDir: string): string {
  return join(dataDir, CONFIG_FILE_NAME);
}

function loadState(dataDir: string): StoredNetworkDriveState {
  const filePath = getConfigPath(dataDir);
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as StoredNetworkDriveState;
  } catch {
    return {};
  }
}

function saveState(dataDir: string, state: StoredNetworkDriveState): void {
  const filePath = getConfigPath(dataDir);
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

export function getNetworkDriveConfig(dataDir: string): NetworkDriveConfig {
  return normalizeNetworkDriveConfig(loadState(dataDir).config);
}

export function saveNetworkDriveConfig(
  dataDir: string,
  config: Partial<NetworkDriveConfig>,
): NetworkDriveConfig {
  const current = getNetworkDriveConfig(dataDir);
  const next = normalizeNetworkDriveConfig({ ...current, ...config });
  const state = loadState(dataDir);
  saveState(dataDir, { ...state, config: next });
  return next;
}

export function saveNetworkDriveReport(dataDir: string, report: NetworkDriveStatusReport): void {
  const state = loadState(dataDir);
  saveState(dataDir, {
    ...state,
    config: report.config,
    lastReport: report,
  });
}
