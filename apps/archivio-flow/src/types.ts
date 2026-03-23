// Shared types used by both frontend and server (via API contracts)

export interface SdCard {
  deviceId: string;
  volumeName: string;
  totalSize: number;
  freeSpace: number;
  path: string;
}

export interface SdPreview {
  totalFiles: number;
  rawFiles: number;
  jpgFiles: number;
}

export interface Job {
  id: string;
  nomeLavoro: string;
  dataLavoro: string;
  autore: string;
  annoArchivio?: string;
  categoriaArchivio?: string;
  contrattoLink?: string;
  percorsoCartella: string;
  nomeCartella: string;
  dataCreazione: string;
  numeroFile: number;
  folderExists?: boolean;
}

export interface ImportResult {
  ok: boolean;
  job: Job;
  copiedFiles: number;
  jpgGenerati: number;
  errors: string[];
}

export interface ImportProgressSnapshot {
  active: boolean;
  phase: "idle" | "copying" | "compressing" | "done" | "error";
  scannedFiles: number;
  plannedFiles: number;
  copiedFiles: number;
  skippedFiles: number;
  manifestSkippedFiles: number;
  inFlight: number;
  copyConcurrency: number;
  initialCopyConcurrency: number;
  elapsedMs: number;
  estimatedRemainingSec: number | null;
  targetFolder: string;
  jpgEnabled: boolean;
  jpgDone: number;
  error: string | null;
  completedScheduled: number;
  knownTotal: number;
  progressPct: number;
}
