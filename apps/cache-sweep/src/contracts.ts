export type CacheRisk = "recommended" | "attention" | "advanced";

export interface AdobeInstallation {
  productId: string;
  displayName: string;
  version: string | null;
  executablePath: string | null;
  installLocation: string | null;
  source: "hkcu" | "hklm-64" | "hklm-32" | "running-process";
  confidence: "verified" | "probable";
  supportedRuleIds: string[];
}

export interface OlderAdobeVersion {
  candidateId: string;
  productId: string;
  displayName: string;
  version: string;
  currentVersion: string;
  sapCode: string;
  baseVersion: string;
  installLocation: string | null;
  processNames: string[];
}

export interface AdobeProcess {
  pid: number;
  executableName: string;
  displayName: string;
  involvedRuleIds: string[];
}

export interface CacheTargetSummary {
  path: string;
  source: "documented-default" | "discovered-catalog";
  fileCount: number;
  totalBytes: number;
  skippedLinks: number;
  scanErrors: string[];
}

export interface CacheCategory {
  ruleId: string;
  title: string;
  applications: string[];
  risk: CacheRisk;
  selectedByDefault: boolean;
  whatIsDeleted: string;
  consequence: string;
  warning: string | null;
  processNames: string[];
  targets: CacheTargetSummary[];
  totalBytes: number;
  fileCount: number;
}

export interface CacheSweepScanResult {
  platformSupported: boolean;
  scannedAt: string;
  installations: AdobeInstallation[];
  runningProcesses: AdobeProcess[];
  categories: CacheCategory[];
  olderVersions: OlderAdobeVersion[];
  warnings: string[];
}

export interface UninstallOldVersionResult {
  status: "completed" | "blocked" | "cancelled" | "failed";
  message: string;
  remainingProcesses: AdobeProcess[];
}

export interface ProcessCloseResult {
  requested: AdobeProcess[];
  closed: AdobeProcess[];
  remaining: AdobeProcess[];
  errors: string[];
}

export interface CleanupCategoryResult {
  ruleId: string;
  title: string;
  deletedFiles: number;
  deletedBytes: number;
  skippedItems: number;
  errors: string[];
  status: "completed" | "partial" | "blocked" | "empty";
}

export interface CleanupResult {
  startedAt: string;
  completedAt: string;
  categories: CleanupCategoryResult[];
  deletedFiles: number;
  deletedBytes: number;
  skippedItems: number;
  errors: string[];
}

export interface CacheSweepDesktopApi {
  scan(): Promise<CacheSweepScanResult>;
  closeProcesses(ruleIds: string[], force: boolean): Promise<ProcessCloseResult>;
  cleanup(ruleIds: string[]): Promise<CleanupResult>;
  uninstallOldVersion(candidateId: string): Promise<UninstallOldVersionResult>;
}

declare global {
  interface Window {
    cacheSweep: CacheSweepDesktopApi;
  }
}
