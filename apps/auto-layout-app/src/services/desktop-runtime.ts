export async function consumePendingDesktopOpenProjectPath(): Promise<string | null> {
  if (typeof window === "undefined" || typeof window.filexDesktop === "undefined") {
    return null;
  }

  try {
    return await window.filexDesktop.consumePendingOpenProjectPath();
  } catch {
    return null;
  }
}

export async function markDesktopOpenProjectRequestReady(): Promise<void> {
  if (typeof window === "undefined" || typeof window.filexDesktop === "undefined") {
    return;
  }

  try {
    await window.filexDesktop.markOpenProjectRequestReady();
  } catch {
    // noop
  }
}

export function subscribeDesktopOpenProjectRequest(
  listener: (projectPath: string) => void,
): () => void {
  if (typeof window === "undefined" || typeof window.filexDesktop === "undefined") {
    return () => {};
  }

  try {
    return window.filexDesktop.onOpenProjectRequest(listener);
  } catch {
    return () => {};
  }
}