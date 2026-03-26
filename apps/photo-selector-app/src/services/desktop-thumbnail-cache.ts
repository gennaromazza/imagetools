import type { DesktopThumbnailCacheInfo } from "@photo-tools/desktop-contracts";

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
