import type {
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

export async function getArchivioJobSubfolders(jobId: string): Promise<{ subfolders: string[] }> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return await desktopApi.listArchivioJobSubfolders(jobId);
  }
  return await apiGet<{ subfolders: string[] }>(`/api/jobs/${encodeURIComponent(jobId)}/subfolders`);
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

export async function getArchivioPreviewImageUrl(sdPath: string, filePath: string): Promise<string | null> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    const payload = await desktopApi.getArchivioPreviewImage(sdPath, filePath);
    if (!payload) return null;
    const bytes = payload.bytes;
    const ownedBytes = new Uint8Array(bytes.byteLength);
    ownedBytes.set(bytes);
    const blob = new Blob([ownedBytes], { type: payload.mimeType || "image/jpeg" });
    return URL.createObjectURL(blob);
  }

  const query = new URLSearchParams({
    sdPath,
    filePath,
  });
  const response = await fetch(`/api/preview-image?${query.toString()}`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const blob = new Blob([bytes], {
    type: response.headers.get("content-type") || "image/jpeg",
  });
  return URL.createObjectURL(blob);
}
