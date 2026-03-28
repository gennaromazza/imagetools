import type {
  ArchivioFlowSettings,
  FilterPreviewData,
  ImportRequest,
  ImportResult,
  ImportProgressSnapshot,
  Job,
  LowQualityProgressSnapshot,
  SdCard,
  SdPreview,
} from "./types";

function requireDesktopApi() {
  if (!window.filexDesktop) {
    throw new Error("Runtime desktop FileX non disponibile");
  }
  return window.filexDesktop;
}

export async function browseArchivioFolder(): Promise<string | null> {
  return await requireDesktopApi().browseArchivioFolder();
}

export async function getArchivioSettings(): Promise<ArchivioFlowSettings> {
  return await requireDesktopApi().getArchivioSettings();
}

export async function saveArchivioSettings(settings: Partial<ArchivioFlowSettings>): Promise<ArchivioFlowSettings> {
  return await requireDesktopApi().saveArchivioSettings(settings);
}

export async function getArchivioJobs(): Promise<Job[]> {
  return await requireDesktopApi().listArchivioJobs();
}

export async function getArchivioSdCards(): Promise<SdCard[]> {
  return await requireDesktopApi().getArchivioSdCards();
}

export async function getArchivioSdPreview(sdPath: string): Promise<SdPreview> {
  return await requireDesktopApi().getArchivioSdPreview(sdPath);
}

export async function getArchivioFilterPreview(input: {
  sdPath: string;
  fileNameIncludes?: string;
  mtimeFrom?: string;
  mtimeTo?: string;
  maxSamples?: number;
}): Promise<FilterPreviewData> {
  return await requireDesktopApi().getArchivioFilterPreview(input);
}

export async function startArchivioImport(input: ImportRequest): Promise<ImportResult> {
  return await requireDesktopApi().startArchivioImport(input);
}

export async function cancelArchivioImport(): Promise<{ ok: boolean; active: boolean }> {
  return await requireDesktopApi().cancelArchivioImport();
}

export async function getArchivioImportProgress(): Promise<ImportProgressSnapshot> {
  return await requireDesktopApi().getArchivioImportProgress();
}

export async function getArchivioLowQualityProgress(): Promise<LowQualityProgressSnapshot> {
  return await requireDesktopApi().getArchivioLowQualityProgress();
}

export async function openArchivioFolder(folderPath: string): Promise<void> {
  await requireDesktopApi().openArchivioFolder(folderPath);
}

export async function updateArchivioJobContractLink(jobId: string, contrattoLink: string): Promise<Job> {
  return await requireDesktopApi().updateArchivioJobContractLink(jobId, contrattoLink);
}

export async function generateArchivioLowQuality(jobId: string, overwrite: boolean) {
  return await requireDesktopApi().generateArchivioLowQuality(jobId, overwrite);
}

export async function deleteArchivioJob(jobId: string) {
  return await requireDesktopApi().deleteArchivioJob(jobId);
}

export async function getArchivioPreviewImageUrl(sdPath: string, filePath: string): Promise<string | null> {
  const payload = await requireDesktopApi().getArchivioPreviewImage(sdPath, filePath);
  if (!payload) return null;
  const bytes = payload.bytes;
  const ownedBytes = new Uint8Array(bytes.byteLength);
  ownedBytes.set(bytes);
  const blob = new Blob([ownedBytes], { type: payload.mimeType || "image/jpeg" });
  return URL.createObjectURL(blob);
}
