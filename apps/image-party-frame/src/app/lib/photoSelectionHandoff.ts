import type { DesktopPhotoToolHandoff } from "@photo-tools/desktop-contracts";

type PhotoSelectionHandoffHandler = (handoff: DesktopPhotoToolHandoff) => Promise<void>;

interface QueuedPhotoSelectionHandoff {
  handoff: DesktopPhotoToolHandoff;
  resolve: () => void;
  reject: (error: unknown) => void;
}

const pendingHandoffs: QueuedPhotoSelectionHandoff[] = [];
let activeHandler: PhotoSelectionHandoffHandler | null = null;
let draining = false;

function currentHandler(): PhotoSelectionHandoffHandler | null {
  return activeHandler;
}

async function drainPhotoSelectionHandoffs(): Promise<void> {
  if (draining || !currentHandler()) return;
  draining = true;
  try {
    while (pendingHandoffs.length > 0) {
      const handler = currentHandler();
      if (!handler) break;
      const pending = pendingHandoffs[0];
      try {
        await handler(pending.handoff);
        pending.resolve();
      } catch (error) {
        pending.reject(error);
      } finally {
        pendingHandoffs.shift();
      }
    }
  } finally {
    draining = false;
    if (currentHandler() && pendingHandoffs.length > 0) {
      void drainPhotoSelectionHandoffs();
    }
  }
}

export function publishPhotoSelectionHandoff(handoff: DesktopPhotoToolHandoff): Promise<void> {
  const completed = new Promise<void>((resolve, reject) => {
    pendingHandoffs.push({ handoff, resolve, reject });
  });
  void drainPhotoSelectionHandoffs();
  return completed;
}

export function onPhotoSelectionHandoff(
  listener: PhotoSelectionHandoffHandler,
): () => void {
  activeHandler = listener;
  void drainPhotoSelectionHandoffs();
  return () => {
    if (activeHandler === listener) activeHandler = null;
  };
}
