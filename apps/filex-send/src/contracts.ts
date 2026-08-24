export interface FileSendReceivedFile {
  id: string;
  name: string;
  size: number;
  receivedAt: number;
}

export interface FileSendSession {
  direction: "receive" | "send";
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

export interface FileSendSessionHistoryEntry {
  mode: "local" | "remote";
  session: FileSendSession;
  closedAt: number;
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
  sessions: Array<{ mode: "local" | "remote"; session: FileSendSession }>;
  history: FileSendSessionHistoryEntry[];
  warning: string | null;
}

export interface FileSendDesktopApi {
  getSnapshot: () => Promise<FileSendSnapshot>;
  startSession: (label?: string) => Promise<FileSendSnapshot>;
  startRemoteSession: (label?: string, expiresAt?: number) => Promise<FileSendSnapshot>;
  startSendSession: (mode: "local" | "remote", label?: string, expiresAt?: number) => Promise<FileSendSnapshot>;
  addSendFiles: (mode: "local" | "remote", sessionId: string) => Promise<FileSendSnapshot>;
  addDroppedSendFiles: (mode: "local" | "remote", sessionId: string, files: File[]) => Promise<FileSendSnapshot>;
  updateRemoteExpiry: (sessionId: string, expiresAt: number) => Promise<FileSendSnapshot>;
  selectSession: (mode: "local" | "remote", sessionId: string) => Promise<FileSendSnapshot>;
  closeSession: (mode: "local" | "remote", sessionId: string) => Promise<FileSendSnapshot>;
  deleteHistoryEntry: (sessionId: string) => Promise<FileSendSnapshot>;
  chooseOutputRoot: () => Promise<FileSendSnapshot>;
  saveWifi: (wifi: FileSendWifiConfig) => Promise<FileSendSnapshot>;
  detectWifi: () => Promise<FileSendSnapshot>;
  openSessionFolder: (mode: "local" | "remote", sessionId: string) => Promise<{ ok: boolean; message?: string }>;
  openHistoryFolder: (sessionId: string) => Promise<{ ok: boolean; message?: string }>;
}

declare global {
  interface Window {
    fileXSend: FileSendDesktopApi;
  }
}
