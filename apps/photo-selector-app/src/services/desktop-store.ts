import type {
  DesktopFolderCatalogAssetState,
  DesktopFolderCatalogState,
  DesktopLogEvent,
  DesktopPerformanceSnapshot,
  DesktopPersistedState,
  DesktopPhotoSelectorPreferences,
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
