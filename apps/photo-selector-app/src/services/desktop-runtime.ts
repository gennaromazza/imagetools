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
