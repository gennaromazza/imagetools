export interface FileSendReceivedFile {
  id: string;
  name: string;
  size: number;
  receivedAt: number;
}

export interface FileSendSession {
  id: string;
  label: string;
  uploadUrl: string;
  folderPath: string;
  createdAt: number;
  receivedBytes: number;
  receivedFiles: FileSendReceivedFile[];
  activeUploads: number;
  activeUploadBytes: number;
  clientCompleted: boolean;
  expiresAt?: number;
  retentionExpiresAt?: number;
}

export interface FileSendWifiConfig {
  ssid: string;
  password: string;
  security: "WPA" | "nopass";
}

export type FileSendWifiSource = "detected" | "remembered" | "manual" | "missing";

export interface FileSendSnapshot {
  mode: "local" | "remote" | null;
  remoteAvailable: boolean;
  remoteError: string | null;
  serverRunning: boolean;
  port: number | null;
  networkAddresses: string[];
  outputRoot: string;
  wifi: FileSendWifiConfig;
  wifiSource: FileSendWifiSource;
  wifiError: string | null;
  session: FileSendSession | null;
  warning: string | null;
}

export interface FileSendDesktopApi {
  getSnapshot: () => Promise<FileSendSnapshot>;
  startSession: (label?: string) => Promise<FileSendSnapshot>;
  startRemoteSession: (label?: string, expiresAt?: number) => Promise<FileSendSnapshot>;
  closeSession: () => Promise<FileSendSnapshot>;
  chooseOutputRoot: () => Promise<FileSendSnapshot>;
  saveWifi: (wifi: FileSendWifiConfig) => Promise<FileSendSnapshot>;
  detectWifi: () => Promise<FileSendSnapshot>;
  openSessionFolder: () => Promise<{ ok: boolean; message?: string }>;
}

declare global {
  interface Window {
    fileXSend: FileSendDesktopApi;
  }
}
