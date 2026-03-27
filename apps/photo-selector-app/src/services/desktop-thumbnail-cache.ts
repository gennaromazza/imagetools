import type {
  DesktopCacheLocationRecommendation,
  DesktopCacheMigrationResult,
  DesktopThumbnailCacheInfo,
} from "@photo-tools/desktop-contracts";

function getDesktopApi() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.filexDesktop ?? null;
}

export async function getDesktopThumbnailCacheInfo(): Promise<DesktopThumbnailCacheInfo | null> {
  const api = getDesktopApi();
  if (!api?.getThumbnailCacheInfo) {
    return null;
  }

  try {
    return await api.getThumbnailCacheInfo();
  } catch {
    return null;
  }
}

export async function chooseDesktopThumbnailCacheDirectory(): Promise<DesktopThumbnailCacheInfo | null> {
  const api = getDesktopApi();
  if (!api?.chooseThumbnailCacheDirectory) {
    return null;
  }

  try {
    return await api.chooseThumbnailCacheDirectory();
  } catch {
    return null;
  }
}

export async function setDesktopThumbnailCacheDirectory(
  directoryPath: string,
): Promise<DesktopThumbnailCacheInfo | null> {
  const api = getDesktopApi();
  if (!api?.setThumbnailCacheDirectory) {
    return null;
  }

  try {
    return await api.setThumbnailCacheDirectory(directoryPath);
  } catch {
    return null;
  }
}

export async function resetDesktopThumbnailCacheDirectory(): Promise<DesktopThumbnailCacheInfo | null> {
  const api = getDesktopApi();
  if (!api?.resetThumbnailCacheDirectory) {
    return null;
  }

  try {
    return await api.resetThumbnailCacheDirectory();
  } catch {
    return null;
  }
}

export async function clearDesktopThumbnailCache(): Promise<boolean> {
  const api = getDesktopApi();
  if (!api?.clearThumbnailCache) {
    return false;
  }

  try {
    return await api.clearThumbnailCache();
  } catch {
    return false;
  }
}

export async function getDesktopCacheLocationRecommendation(): Promise<DesktopCacheLocationRecommendation | null> {
  const api = getDesktopApi();
  if (!api?.getCacheLocationRecommendation) {
    return null;
  }

  try {
    return await api.getCacheLocationRecommendation();
  } catch {
    return null;
  }
}

export async function migrateDesktopThumbnailCacheDirectory(
  directoryPath: string,
): Promise<DesktopCacheMigrationResult | null> {
  const api = getDesktopApi();
  if (!api?.migrateThumbnailCacheDirectory) {
    return null;
  }

  try {
    return await api.migrateThumbnailCacheDirectory(directoryPath);
  } catch {
    return null;
  }
}

export async function dismissDesktopCacheLocationRecommendation(): Promise<boolean> {
  const api = getDesktopApi();
  if (!api?.dismissCacheLocationRecommendation) {
    return false;
  }

  try {
    await api.dismissCacheLocationRecommendation();
    return true;
  } catch {
    return false;
  }
}
