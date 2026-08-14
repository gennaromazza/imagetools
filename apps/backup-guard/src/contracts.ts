export interface BackupGuardConfiguration {
  masterPath: string;
  clonePath: string;
  createdAt: string;
  updatedAt: string;
  pairId: string;
  masterVolumeId: string;
  cloneVolumeId: string;
  trashRetentionDays: number;
  deletionFileThreshold: number;
  deletionByteThreshold: number;
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
  deletionFiles: number;
  deletionBytes: number;
  requiresDeletionConfirmation: boolean;
  lightroomLocks: string[];
}

export interface BackupGuardExecutionProgress {
  active: boolean;
  sessionId: string | null;
  phase: "idle" | "preflight" | "copying" | "importing" | "deleting" | "verifying" | "completed" | "failed";
  completedOperations: number;
  totalOperations: number;
  bytesCompleted: number;
  totalBytes: number;
  currentPath: string | null;
  currentFileBytes: number;
  currentFileTotalBytes: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
  paused: boolean;
  cancelRequested: boolean;
  error: string | null;
}

export interface BackupGuardExecutionResult {
  sessionId: string;
  completedAt: string;
  copiedToClone: number;
  importedToMaster: number;
  deletedFromClone: number;
  restoredToClone: number;
  conflictsSkipped: number;
  verifiedFiles: number;
  bytesTransferred: number;
  trashPath: string | null;
  remainingDifferences: number;
}

export interface BackupGuardPendingProject {
  eventId: string;
  projectId: string;
  projectName: string;
  absolutePath: string;
  importedAt: string;
  fileCount: number;
}

export interface BackupGuardDeepVerificationResult {
  sessionId: string;
  completedAt: string;
  verifiedFiles: number;
  verifiedBytes: number;
  mismatches: Array<{ relativePath: string; masterSha256: string; cloneSha256: string }>;
}

export interface BackupGuardTrashSession {
  sessionId: string;
  createdAt: string;
  fileCount: number;
  totalBytes: number;
  relativePaths: string[];
}

export interface BackupGuardRecoveryResult {
  sessionId: string;
  recoveryPath: string;
  restoredFiles: number;
  verifiedFiles: number;
}

export type BackupGuardConflictAction = "keep-both" | "use-master" | "use-clone";

export interface BackupGuardHistoryEntry {
  id: string;
  createdAt: string;
  status: "completed" | "failed" | "executed" | "verified";
  summary: string;
  result?: BackupGuardScanResult;
  execution?: BackupGuardExecutionResult;
  error?: string;
}

export interface BackupGuardDesktopApi {
  isTestMode: () => Promise<boolean>;
  browseFolder: (role: "master" | "clone") => Promise<string | null>;
  getConfiguration: () => Promise<BackupGuardConfiguration | null>;
  saveConfiguration: (masterPath: string, clonePath: string) => Promise<BackupGuardConfiguration>;
  scan: () => Promise<BackupGuardScanResult>;
  execute: (scanId: string, confirmDeletions: boolean) => Promise<BackupGuardExecutionResult>;
  getProgress: () => Promise<BackupGuardExecutionProgress>;
  pause: () => Promise<BackupGuardExecutionProgress>;
  resume: () => Promise<BackupGuardExecutionProgress>;
  cancel: () => Promise<BackupGuardExecutionProgress>;
  deepVerify: () => Promise<BackupGuardDeepVerificationResult>;
  listTrash: () => Promise<BackupGuardTrashSession[]>;
  recoverTrash: (sessionId: string) => Promise<BackupGuardRecoveryResult>;
  deleteTrash: (sessionId: string) => Promise<{ ok: boolean }>;
  openPath: (path: string) => Promise<{ ok: boolean }>;
  exportHistoryReport: () => Promise<{ ok: boolean; path?: string }>;
  resolveConflict: (scanId: string, relativePath: string, action: BackupGuardConflictAction) => Promise<{ ok: boolean; outputPath?: string }>;
  listPendingProjects: () => Promise<BackupGuardPendingProject[]>;
  listHistory: () => Promise<BackupGuardHistoryEntry[]>;
}

declare global {
  interface Window { backupGuard?: BackupGuardDesktopApi; }
}
