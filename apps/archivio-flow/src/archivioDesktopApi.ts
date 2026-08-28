import type { DesktopArchivioDriveRegistrySyncResult } from "@photo-tools/desktop-contracts";
import type {
  ArchiveAnalysisResult,
  ArchiveRenameResult,
  ArchiveRenameRequest,
  ArchiveRenameProgress,
  ArchivioFlowSettings,
  FilterPreviewData,
  ImportRequest,
  ImportResult,
  ImportProgressSnapshot,
  Job,
  LowQualityProgressSnapshot,
  SelectionCandidate,
  SdCard,
  SdPreview,
  SafeToFormatResult,
  StudioFlowStatus,
  GoogleDriveStatus,
} from "./types";

function getDesktopApi() {
  return window.filexDesktop ?? null;
}

function requireDesktopApi() {
  const api = getDesktopApi();
  if (!api) {
    throw new Error("Runtime desktop FileX non disponibile.");
  }
  return api;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json() as { error?: string };
    if (typeof data.error === "string" && data.error.trim()) {
      return data.error;
    }
  } catch {
    // ignore parsing errors
  }
  return `Richiesta API fallita (${response.status})`;
}

async function apiGet<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return await response.json() as T;
}

async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return await response.json() as T;
}

async function apiDelete<T>(url: string): Promise<T> {
  const response = await fetch(url, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return await response.json() as T;
}

export async function browseArchivioFolder(): Promise<string | null> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return await desktopApi.browseArchivioFolder();
  }
  const response = await apiPost<{ path: string | null }>("/api/browse-folder");
  return response.path ?? null;
}

export async function getArchivioSettings(): Promise<ArchivioFlowSettings> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return await desktopApi.getArchivioSettings();
  }
  return await apiGet<ArchivioFlowSettings>("/api/settings");
}

export async function saveArchivioSettings(settings: Partial<ArchivioFlowSettings>): Promise<ArchivioFlowSettings> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return await desktopApi.saveArchivioSettings(settings);
  }
  const response = await apiPost<{ ok: true; settings: ArchivioFlowSettings }>("/api/settings", settings);
  return response.settings;
}

export async function getArchivioJobs(): Promise<Job[]> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return await desktopApi.listArchivioJobs();
  }
  return await apiGet<Job[]>("/api/jobs");
}

export async function analyzeArchivioArchive(): Promise<ArchiveAnalysisResult> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return await desktopApi.analyzeArchivioArchive();
  }
  return await apiPost<ArchiveAnalysisResult>("/api/archive/analyze");
}

export async function renameArchivioArchiveJobs(requests: ArchiveRenameRequest[]): Promise<ArchiveRenameResult> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return await desktopApi.renameArchivioArchiveJobs(requests);
  }
  return await apiPost<ArchiveRenameResult>("/api/archive/rename", { requests });
}

export async function getArchivioSdCards(): Promise<SdCard[]> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return await desktopApi.getArchivioSdCards();
  }
  const response = await apiGet<{ sdCards: SdCard[] }>("/api/sd-cards");
  return response.sdCards;
}

export async function getArchivioSdPreview(sdPath: string): Promise<SdPreview> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return await desktopApi.getArchivioSdPreview(sdPath);
  }
  return await apiGet<SdPreview>(`/api/sd-preview?path=${encodeURIComponent(sdPath)}`);
}

export async function ejectArchivioSdCard(sdPath: string): Promise<{ ok: boolean; message: string }> {
  return await requireDesktopApi().ejectArchivioSdCard(sdPath);
}

export async function showArchivioFlowWindow(): Promise<void> {
  const desktopApi = getDesktopApi();
  if (desktopApi) await desktopApi.showArchivioFlowWindow();
}

export async function getArchivioArchiveRenameProgress(): Promise<ArchiveRenameProgress> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return await desktopApi.getArchivioArchiveRenameProgress();
  }
  return await apiGet<ArchiveRenameProgress>("/api/archive/rename/progress");
}

export async function checkArchivioSafeToFormat(sdPath: string): Promise<SafeToFormatResult> {
  const desktopApi = getDesktopApi();
  if (desktopApi) return await desktopApi.checkArchivioSafeToFormat(sdPath);
  return await apiPost<SafeToFormatResult>("/api/sd/safe-to-format", { sdPath });
}

export async function getArchivioStudioFlowStatus(): Promise<StudioFlowStatus> {
  const desktopApi = getDesktopApi();
  if (desktopApi) return await desktopApi.getArchivioStudioFlowStatus();
  return await apiGet<StudioFlowStatus>("/api/studioflow/status");
}

export async function reconcileArchivioIndex(): Promise<StudioFlowStatus["archiveIndex"]> {
  const desktopApi = getDesktopApi();
  if (desktopApi) return await desktopApi.reconcileArchivioIndex();
  return await apiPost<StudioFlowStatus["archiveIndex"]>("/api/archive/reconcile");
}

export async function resumeArchivioImport(sessionId: string): Promise<ImportResult> {
  const desktopApi = getDesktopApi();
  if (desktopApi) return await desktopApi.resumeArchivioImport(sessionId);
  return await apiPost<ImportResult>(`/api/import-sessions/${encodeURIComponent(sessionId)}/resume`);
}

export async function syncArchivioDriveRegistry(): Promise<DesktopArchivioDriveRegistrySyncResult> {
  return await requireDesktopApi().syncArchivioDriveRegistry();
}

export async function getArchivioGoogleDriveStatus(): Promise<GoogleDriveStatus> {
  return await requireDesktopApi().getGoogleDriveStatus();
}

export async function connectArchivioGoogleDrive(): Promise<GoogleDriveStatus> {
  return await requireDesktopApi().connectGoogleDrive();
}

export async function disconnectArchivioGoogleDrive(): Promise<GoogleDriveStatus> {
  return await requireDesktopApi().disconnectGoogleDrive();
}

export async function getArchivioFilterPreview(input: {
  sdPath: string;
  fileNameIncludes?: string;
  mtimeFrom?: string;
  mtimeTo?: string;
  maxSamples?: number;
}): Promise<FilterPreviewData> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return await desktopApi.getArchivioFilterPreview(input);
  }
  return await apiPost<FilterPreviewData>("/api/filter-preview", input);
}

export async function startArchivioImport(input: ImportRequest): Promise<ImportResult> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return await desktopApi.startArchivioImport(input);
  }
  return await apiPost<ImportResult>("/api/import", input);
}

export async function notifyBackupGuardProject(result: ImportResult): Promise<void> {
  const desktopApi = getDesktopApi();
  if (!desktopApi) return;
  await desktopApi.notifyBackupGuardProject({
    schemaVersion: 1,
    eventId: crypto.randomUUID(),
    projectId: result.job.id,
    projectName: result.job.nomeLavoro,
    absolutePath: result.job.percorsoCartella,
    importedAt: new Date().toISOString(),
    fileCount: result.job.numeroFile,
  });
}

export async function cancelArchivioImport(): Promise<{ ok: boolean; active: boolean }> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return await desktopApi.cancelArchivioImport();
  }
  return await apiPost<{ ok: boolean; active: boolean }>("/api/import-cancel");
}

export async function getArchivioImportProgress(): Promise<ImportProgressSnapshot> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return await desktopApi.getArchivioImportProgress();
  }
  return await apiGet<ImportProgressSnapshot>("/api/import-progress");
}

export async function getArchivioLowQualityProgress(): Promise<LowQualityProgressSnapshot> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return await desktopApi.getArchivioLowQualityProgress();
  }
  return await apiGet<LowQualityProgressSnapshot>("/api/low-quality-progress");
}

export async function openArchivioFolder(folderPath: string): Promise<void> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    await desktopApi.openArchivioFolder(folderPath);
    return;
  }
  await apiPost<{ ok: true }>("/api/open-folder", { folderPath });
}

export async function openJobInPhotoSelector(folderPath: string): Promise<void> {
  const desktopApi = requireDesktopApi();
  const result = await desktopApi.openInstalledTool("photo-selector-app", ["--open-folder", folderPath]);
  if (!result?.ok) {
    throw new Error(result?.message || "Impossibile aprire Image Select Pro");
  }
}

export async function updateArchivioJobContractLink(jobId: string, contrattoLink: string): Promise<Job> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return await desktopApi.updateArchivioJobContractLink(jobId, contrattoLink);
  }
  const response = await apiPost<{ ok: true; job: Job }>(`/api/jobs/${encodeURIComponent(jobId)}/contract-link`, { contrattoLink });
  return response.job;
}

export async function generateArchivioLowQuality(jobId: string, overwrite: boolean, sourceSubfolder?: string) {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return await desktopApi.generateArchivioLowQuality(jobId, overwrite, sourceSubfolder);
  }
  return await apiPost<{
    ok: true;
    jobId: string;
    totalJpg: number;
    generated: number;
    skippedExisting: number;
    errors: number;
    overwrite: boolean;
    sourceSubfolder: string | null;
    preserveStructure: boolean;
    outputDir: string;
    durationMs: number;
  }>(`/api/jobs/${encodeURIComponent(jobId)}/generate-low-quality`, { overwrite, sourceSubfolder });
}

export async function getArchivioJobSubfolders(jobId: string, author?: string): Promise<{ subfolders: string[] }> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return await desktopApi.listArchivioJobSubfolders(jobId, author);
  }
  const query = author?.trim() ? `?author=${encodeURIComponent(author.trim())}` : "";
  return await apiGet<{ subfolders: string[] }>(`/api/jobs/${encodeURIComponent(jobId)}/subfolders${query}`);
}

export async function getArchivioJobSelectionCandidates(jobId: string): Promise<{
  candidates: SelectionCandidate[];
  preferredPath: string | null;
}> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return await desktopApi.listArchivioJobSelectionCandidates(jobId);
  }
  return await apiGet<{
    candidates: SelectionCandidate[];
    preferredPath: string | null;
  }>(`/api/jobs/${encodeURIComponent(jobId)}/selection-candidates`);
}

export async function deleteArchivioJob(jobId: string) {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return await desktopApi.deleteArchivioJob(jobId);
  }
  return await apiDelete<{ ok: true }>(`/api/jobs/${encodeURIComponent(jobId)}`);
}

const PREVIEW_CACHE_LIMIT = 240;
const PREVIEW_CONCURRENCY = 6;
const previewBlobCache = new Map<string, Blob>();
const previewBlobRequests = new Map<string, Promise<Blob | null>>();
const previewTaskQueue: Array<() => void> = [];
let activePreviewTasks = 0;

function runPreviewTask<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      if (signal?.aborted) {
        reject(new Error("Richiesta anteprima annullata"));
        previewTaskQueue.shift()?.();
        return;
      }
      activePreviewTasks += 1;
      void task().then(resolve, reject).finally(() => {
        activePreviewTasks -= 1;
        previewTaskQueue.shift()?.();
      });
    };
    if (activePreviewTasks < PREVIEW_CONCURRENCY) start();
    else previewTaskQueue.push(start);
  });
}

function rememberPreviewBlob(cacheKey: string, blob: Blob): void {
  previewBlobCache.delete(cacheKey);
  previewBlobCache.set(cacheKey, blob);
  while (previewBlobCache.size > PREVIEW_CACHE_LIMIT) {
    const oldestKey = previewBlobCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    previewBlobCache.delete(oldestKey);
  }
}

async function loadArchivioPreviewBlob(sdPath: string, filePath: string, sourceFileKey?: string, signal?: AbortSignal): Promise<Blob | null> {
  const cacheKey = `${sdPath}\0${filePath}\0${sourceFileKey ?? ""}`;
  const cached = previewBlobCache.get(cacheKey);
  if (cached) {
    previewBlobCache.delete(cacheKey);
    previewBlobCache.set(cacheKey, cached);
    return cached;
  }
  const pending = previewBlobRequests.get(cacheKey);
  if (pending) return await pending;

  const request = runPreviewTask(async () => {
    const desktopApi = getDesktopApi();
    const isVideo = /\.(mp4|mov|m4v|avi|mkv|mts|m2ts|mpg|mpeg|3gp|webm)$/i.test(filePath);
    if (desktopApi && !isVideo) {
      const rendered = await desktopApi.getThumbnail(filePath, 220, 54, sourceFileKey, {
          profile: "fast",
          preferEmbeddedPreview: true,
          allowDirectEmbeddedJpeg: true,
        }).catch(() => null);
      if (rendered) {
        const ownedBytes = new Uint8Array(rendered.bytes.byteLength);
        ownedBytes.set(rendered.bytes);
        return new Blob([ownedBytes], { type: rendered.mimeType || "image/jpeg" });
      }
    }
    if (desktopApi) {
      const payload = await desktopApi.getArchivioPreviewImage(sdPath, filePath);
      if (!payload) return null;
      const ownedBytes = new Uint8Array(payload.bytes.byteLength);
      ownedBytes.set(payload.bytes);
      return new Blob([ownedBytes], { type: payload.mimeType || "image/jpeg" });
    }

    const query = new URLSearchParams({ sdPath, filePath });
    const response = await fetch(`/api/preview-image?${query.toString()}`);
    if (!response.ok) throw new Error(await readErrorMessage(response));
    return await response.blob();
  }, signal);
  previewBlobRequests.set(cacheKey, request);
  try {
    const blob = await request;
    if (blob) rememberPreviewBlob(cacheKey, blob);
    return blob;
  } finally {
    previewBlobRequests.delete(cacheKey);
  }
}

export async function getArchivioPreviewImageUrl(sdPath: string, filePath: string, sourceFileKey?: string, signal?: AbortSignal): Promise<string | null> {
  const blob = await loadArchivioPreviewBlob(sdPath, filePath, sourceFileKey, signal);
  return blob ? URL.createObjectURL(blob) : null;
}

export async function openBackupGuard(): Promise<{ ok: boolean; message: string }> {
  const desktopApi = getDesktopApi();
  if (!desktopApi) return { ok: false, message: "Backup Guard può essere aperto solo dall'app FileX installata." };
  return await desktopApi.openInstalledTool("backup-guard");
}

export async function getArchivioStartAtLogin(): Promise<boolean | null> {
  const desktopApi = getDesktopApi();
  return desktopApi ? await desktopApi.getArchivioStartAtLogin() : null;
}

export async function setArchivioStartAtLogin(enabled: boolean): Promise<boolean | null> {
  const desktopApi = getDesktopApi();
  return desktopApi ? await desktopApi.setArchivioStartAtLogin(enabled) : null;
}
