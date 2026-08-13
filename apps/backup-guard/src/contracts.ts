export interface BackupGuardConfiguration {
  masterPath: string;
  clonePath: string;
  createdAt: string;
  updatedAt: string;
}

export type BackupGuardDifferenceKind = "copy-to-clone" | "import-from-clone" | "delete-from-clone" | "restore-to-clone" | "conflict";

export interface BackupGuardDifference {
  relativePath: string;
  kind: BackupGuardDifferenceKind;
  entryType: "file" | "directory";
  masterBytes: number | null;
  cloneBytes: number | null;
  reason: string;
}

export interface BackupGuardScanResult {
  id: string;
  startedAt: string;
  completedAt: string;
  masterPath: string;
  clonePath: string;
  masterFiles: number;
  cloneFiles: number;
  masterBytes: number;
  cloneBytes: number;
  differences: BackupGuardDifference[];
  totals: Record<BackupGuardDifferenceKind, number>;
  readOnly: true;
}

export interface BackupGuardHistoryEntry {
  id: string;
  createdAt: string;
  status: "completed" | "failed";
  summary: string;
  result?: BackupGuardScanResult;
  error?: string;
}

export interface BackupGuardDesktopApi {
  browseFolder: (role: "master" | "clone") => Promise<string | null>;
  getConfiguration: () => Promise<BackupGuardConfiguration | null>;
  saveConfiguration: (masterPath: string, clonePath: string) => Promise<BackupGuardConfiguration>;
  scan: () => Promise<BackupGuardScanResult>;
  listHistory: () => Promise<BackupGuardHistoryEntry[]>;
}

declare global {
  interface Window { backupGuard?: BackupGuardDesktopApi; }
}
