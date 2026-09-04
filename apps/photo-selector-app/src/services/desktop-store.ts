import type {
  DesktopCaptureTimeReading,
  DesktopFolderCatalogAssetState,
  DesktopFolderCatalogState,
  DesktopFreeSelectionSnapshot,
  DesktopLogEvent,
  DesktopPerformanceSnapshot,
  DesktopPersistedState,
  ImageConverterJobConfig,
  ImageConverterPreset,
  ImageConverterProgressSnapshot,
  DesktopPhotoFileRenameItem,
  DesktopPhotoFileRenameResult,
  DesktopPhotoSelectorPreferences,
  DesktopPhotoSelectorProjectFile,
  DesktopPhotoSelectorProjectLocation,
  DesktopPhotoSelectorProjectRelocationResult,
  DesktopRecentFolder,
  DesktopSortCacheEntry,
} from "@photo-tools/desktop-contracts";

function getDesktopApi() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.filexDesktop ?? null;
}

export function hasDesktopStateApi(): boolean {
  const api = getDesktopApi();
  return Boolean(
    typeof api?.getDesktopPreferences === "function"
    && typeof api?.saveDesktopPreferences === "function"
    && typeof api?.getRecentFolders === "function"
    && typeof api?.getSortCache === "function",
  );
}

export function hasDesktopFreeSelectionApi(): boolean {
  const api = getDesktopApi();
  return Boolean(
    typeof api?.getFreeSelectionSnapshot === "function"
    && typeof api?.saveFreeSelectionSnapshot === "function",
  );
}

export async function getFreeSelectionSnapshot(
  sourceId: string,
): Promise<DesktopFreeSelectionSnapshot | null> {
  const api = getDesktopApi();
  if (!api?.getFreeSelectionSnapshot) {
    return null;
  }

  try {
    return await api.getFreeSelectionSnapshot(sourceId);
  } catch {
    return null;
  }
}

export async function saveFreeSelectionSnapshot(
  snapshot: DesktopFreeSelectionSnapshot,
): Promise<boolean> {
  const api = getDesktopApi();
  if (!api?.saveFreeSelectionSnapshot) {
    return false;
  }

  try {
    await api.saveFreeSelectionSnapshot(snapshot);
    return true;
  } catch {
    return false;
  }
}

export async function getDesktopPreferences(): Promise<DesktopPhotoSelectorPreferences | null> {
  const api = getDesktopApi();
  if (!api?.getDesktopPreferences) {
    return null;
  }

  try {
    return await api.getDesktopPreferences();
  } catch {
    return null;
  }
}

export async function saveDesktopPreferences(
  preferences: DesktopPhotoSelectorPreferences,
): Promise<DesktopPhotoSelectorPreferences | null> {
  const api = getDesktopApi();
  if (!api?.saveDesktopPreferences) {
    return null;
  }

  try {
    return await api.saveDesktopPreferences(preferences);
  } catch {
    return null;
  }
}

export async function readPhotoSelectorProjectFile(
  rootPath: string,
): Promise<DesktopPhotoSelectorProjectFile | null> {
  const api = getDesktopApi();
  if (!api?.readPhotoSelectorProjectFile) {
    return null;
  }

  try {
    return await api.readPhotoSelectorProjectFile(rootPath);
  } catch {
    return null;
  }
}

export async function updatePhotoSelectorProjectFile(
  rootPath: string,
  update: (project: DesktopPhotoSelectorProjectFile | null) => DesktopPhotoSelectorProjectFile,
): Promise<boolean> {
  const api = getDesktopApi();
  if (!api?.readPhotoSelectorProjectFile || !api.writePhotoSelectorProjectFile) {
    return false;
  }

  try {
    const current = await api.readPhotoSelectorProjectFile(rootPath);
    return await api.writePhotoSelectorProjectFile(rootPath, update(current));
  } catch {
    return false;
  }
}

export async function relocatePhotoSelectorProjectFile(
  sourceRootPath: string,
  targetRootPath: string,
  project: DesktopPhotoSelectorProjectFile,
): Promise<DesktopPhotoSelectorProjectRelocationResult> {
  const api = getDesktopApi();
  if (!api?.relocatePhotoSelectorProjectFile) {
    return { ok: false, message: "La correzione del master richiede l'app desktop aggiornata." };
  }
  try {
    return await api.relocatePhotoSelectorProjectFile(sourceRootPath, targetRootPath, project);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export async function resolvePhotoSelectorProject(
  folderPath: string,
): Promise<DesktopPhotoSelectorProjectLocation | null> {
  const api = getDesktopApi();
  if (!api?.resolvePhotoSelectorProject) {
    return null;
  }
  try {
    return await api.resolvePhotoSelectorProject(folderPath);
  } catch {
    return null;
  }
}

export async function listPhotoSelectorLegacyProjects(
  rootPath: string,
): Promise<DesktopPhotoSelectorProjectLocation[]> {
  const api = getDesktopApi();
  if (!api?.listPhotoSelectorLegacyProjects) {
    return [];
  }
  try {
    return await api.listPhotoSelectorLegacyProjects(rootPath);
  } catch {
    return [];
  }
}

export async function readCaptureTimes(
  absolutePaths: string[],
): Promise<DesktopCaptureTimeReading[]> {
  const api = getDesktopApi();
  if (!api?.readCaptureTimes || absolutePaths.length === 0) {
    return [];
  }
  try {
    const readings = await api.readCaptureTimes(absolutePaths);
    return Array.isArray(readings) ? readings : [];
  } catch {
    return [];
  }
}

export async function renamePhotoFiles(
  rootPath: string,
  items: DesktopPhotoFileRenameItem[],
): Promise<DesktopPhotoFileRenameResult[]> {
  const api = getDesktopApi();
  if (!api?.renamePhotoFiles || !rootPath || items.length === 0) {
    return [];
  }
  try {
    const results = await api.renamePhotoFiles(rootPath, items);
    return Array.isArray(results) ? results : [];
  } catch {
    return [];
  }
}

export async function getImageConverterPresets(): Promise<ImageConverterPreset[]> {
  const api = getDesktopApi();
  if (!api?.getImageConverterPresets) {
    return [];
  }
  try {
    const presets = await api.getImageConverterPresets();
    return Array.isArray(presets) ? presets : [];
  } catch {
    return [];
  }
}

export async function startImageConverterJob(
  config: ImageConverterJobConfig,
): Promise<{ ok: boolean; error?: string }> {
  const api = getDesktopApi();
  if (!api?.startImageConverterJob) {
    return { ok: false, error: "Motore di conversione non disponibile: aggiorna FileX Suite." };
  }
  try {
    const result = await api.startImageConverterJob(config);
    if (result?.ok) {
      return { ok: true };
    }
    return { ok: false, error: result?.error ?? "Avvio esportazione non riuscito." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Avvio esportazione non riuscito." };
  }
}

export async function getImageConverterProgress(): Promise<ImageConverterProgressSnapshot | null> {
  const api = getDesktopApi();
  if (!api?.getImageConverterProgress) {
    return null;
  }
  try {
    return await api.getImageConverterProgress();
  } catch {
    return null;
  }
}

export async function cancelImageConverterJob(): Promise<void> {
  const api = getDesktopApi();
  try {
    await api?.cancelImageConverterJob?.();
  } catch {
    // best-effort
  }
}

export async function chooseImageConverterFolders(): Promise<string[]> {
  const api = getDesktopApi();
  if (!api?.chooseImageConverterFolders) {
    return [];
  }
  try {
    const folders = await api.chooseImageConverterFolders();
    return Array.isArray(folders) ? folders : [];
  } catch {
    return [];
  }
}

export async function openImageConverterFolder(folderPath: string): Promise<void> {
  const api = getDesktopApi();
  try {
    await api?.openImageConverterFolder?.(folderPath);
  } catch {
    // best-effort
  }
}

export async function findNestedPhotoSelectorProjects(
  rootPath: string,
): Promise<DesktopPhotoSelectorProjectLocation[]> {
  const api = getDesktopApi();
  if (!api?.findNestedPhotoSelectorProjects) {
    return [];
  }
  try {
    return await api.findNestedPhotoSelectorProjects(rootPath);
  } catch {
    return [];
  }
}

export async function getDesktopSessionState(): Promise<DesktopPersistedState | null> {
  const api = getDesktopApi();
  if (!api?.getDesktopSessionState) {
    return null;
  }

  try {
    return await api.getDesktopSessionState();
  } catch {
    return null;
  }
}

export async function saveDesktopSessionState(state: DesktopPersistedState): Promise<boolean> {
  const api = getDesktopApi();
  if (!api?.saveDesktopSessionState) {
    return false;
  }

  try {
    await api.saveDesktopSessionState(state);
    return true;
  } catch {
    return false;
  }
}

export async function getDesktopRecentFolders(): Promise<DesktopRecentFolder[] | null> {
  const api = getDesktopApi();
  if (!api?.getRecentFolders) {
    return null;
  }

  try {
    return await api.getRecentFolders();
  } catch {
    return null;
  }
}

export async function saveDesktopRecentFolder(folder: DesktopRecentFolder): Promise<DesktopRecentFolder[] | null> {
  const api = getDesktopApi();
  if (!api?.saveRecentFolder) {
    return null;
  }

  try {
    return await api.saveRecentFolder(folder);
  } catch {
    return null;
  }
}

export async function removeDesktopRecentFolder(folderPathOrName: string): Promise<DesktopRecentFolder[] | null> {
  const api = getDesktopApi();
  if (!api?.removeRecentFolder) {
    return null;
  }

  try {
    return await api.removeRecentFolder(folderPathOrName);
  } catch {
    return null;
  }
}

export async function getDesktopSortCache(folderPath?: string): Promise<DesktopSortCacheEntry[] | null> {
  const api = getDesktopApi();
  if (!api?.getSortCache) {
    return null;
  }

  try {
    return await api.getSortCache(folderPath);
  } catch {
    return null;
  }
}

export async function saveDesktopSortCache(entry: DesktopSortCacheEntry): Promise<boolean> {
  const api = getDesktopApi();
  if (!api?.saveSortCache) {
    return false;
  }

  try {
    await api.saveSortCache(entry);
    return true;
  } catch {
    return false;
  }
}

export async function getDesktopFolderCatalogState(folderPath: string): Promise<DesktopFolderCatalogState | null> {
  const api = getDesktopApi();
  if (!api?.getFolderCatalogState) {
    return null;
  }

  try {
    return await api.getFolderCatalogState(folderPath);
  } catch {
    return null;
  }
}

export async function saveDesktopFolderCatalogState(state: DesktopFolderCatalogState): Promise<boolean> {
  const api = getDesktopApi();
  if (!api?.saveFolderCatalogState) {
    return false;
  }

  try {
    await api.saveFolderCatalogState(state);
    return true;
  } catch {
    return false;
  }
}

export async function saveDesktopFolderAssetStates(
  folderPath: string,
  assetStates: DesktopFolderCatalogAssetState[],
): Promise<boolean> {
  const api = getDesktopApi();
  if (!api?.saveFolderAssetStates) {
    return false;
  }

  try {
    await api.saveFolderAssetStates(folderPath, assetStates);
    return true;
  } catch {
    return false;
  }
}

export async function saveDesktopFolderAssetStatesDelta(
  folderPath: string,
  assetStates: DesktopFolderCatalogAssetState[],
): Promise<boolean> {
  const api = getDesktopApi();
  if (!api?.saveFolderAssetStatesDelta) {
    return false;
  }

  try {
    await api.saveFolderAssetStatesDelta(folderPath, assetStates);
    return true;
  } catch {
    return false;
  }
}

export async function getDesktopPerformanceSnapshot(): Promise<DesktopPerformanceSnapshot | null> {
  const api = getDesktopApi();
  if (!api?.getDesktopPerformanceSnapshot) {
    return null;
  }

  try {
    return await api.getDesktopPerformanceSnapshot();
  } catch {
    return null;
  }
}

export async function recordDesktopPerformanceSnapshot(snapshot: DesktopPerformanceSnapshot): Promise<boolean> {
  const api = getDesktopApi();
  if (!api?.recordDesktopPerformanceSnapshot) {
    return false;
  }

  try {
    await api.recordDesktopPerformanceSnapshot(snapshot);
    return true;
  } catch {
    return false;
  }
}

export async function logDesktopEvent(event: DesktopLogEvent): Promise<boolean> {
  const api = getDesktopApi();
  if (!api?.logDesktopEvent) {
    return false;
  }

  try {
    await api.logDesktopEvent(event);
    return true;
  } catch {
    return false;
  }
}
