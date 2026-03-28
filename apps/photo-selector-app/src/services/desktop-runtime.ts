import type { DesktopRuntimeInfo } from "@photo-tools/desktop-contracts";

export async function getDesktopRuntimeInfo(): Promise<DesktopRuntimeInfo | null> {
  if (typeof window === "undefined" || typeof window.filexDesktop === "undefined") {
    return null;
  }

  try {
    return await window.filexDesktop.getRuntimeInfo();
  } catch {
    return null;
  }
}

export async function consumePendingDesktopOpenFolderPath(): Promise<string | null> {
  if (typeof window === "undefined" || typeof window.filexDesktop === "undefined") {
    return null;
  }

  try {
    return await window.filexDesktop.consumePendingOpenFolderPath();
  } catch {
    return null;
  }
}

export async function markDesktopOpenFolderRequestReady(): Promise<void> {
  if (typeof window === "undefined" || typeof window.filexDesktop === "undefined") {
    return;
  }

  try {
    await window.filexDesktop.markOpenFolderRequestReady();
  } catch {
    // Ignore desktop bridge errors
  }
}

export function subscribeDesktopOpenFolderRequest(
  listener: (folderPath: string) => void,
): (() => void) | null {
  if (typeof window === "undefined" || typeof window.filexDesktop === "undefined") {
    return null;
  }

  try {
    return window.filexDesktop.onOpenFolderRequest(listener);
  } catch {
    return null;
  }
}
