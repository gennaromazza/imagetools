import type {
  DesktopPsdJpegConversionProgress,
  DesktopPsdJpegConversionRequest,
} from "@photo-tools/desktop-contracts";

function hasPsdJpegConversionBridge(): boolean {
  return typeof window !== "undefined"
    && typeof window.filexDesktop?.startPsdJpegConversion === "function"
    && typeof window.filexDesktop?.getPsdJpegConversionProgress === "function";
}

export async function startPsdJpegConversion(
  request: DesktopPsdJpegConversionRequest,
): Promise<DesktopPsdJpegConversionProgress | null> {
  if (!hasPsdJpegConversionBridge()) {
    return null;
  }
  return window.filexDesktop!.startPsdJpegConversion(request);
}

export async function getPsdJpegConversionProgress(): Promise<DesktopPsdJpegConversionProgress | null> {
  if (!hasPsdJpegConversionBridge()) {
    return null;
  }
  return window.filexDesktop!.getPsdJpegConversionProgress();
}

export async function cancelPsdJpegConversion(): Promise<void> {
  if (typeof window === "undefined" || typeof window.filexDesktop?.cancelPsdJpegConversion !== "function") {
    return;
  }
  await window.filexDesktop.cancelPsdJpegConversion();
}
