export type IdPhotoUnloadDecision = "stay" | "close-anyway";

export type IdPhotoUnloadRequest = {
  requestDecision: () => Promise<IdPhotoUnloadDecision>;
  closeAnyway: () => void;
  onError?: (error: unknown) => void;
};

export type IdPhotoUnloadGuard = {
  handlePreventedUnload: (request: IdPhotoUnloadRequest) => void;
  isConfirmationPending: () => boolean;
};

export type IdPhotoBeforeQuitAction = "close-window-first" | "start-native-shutdown";

export type IdPhotoQuitCoordinator = {
  handleBeforeQuit: (hasOpenWindow: boolean) => IdPhotoBeforeQuitAction;
  hasPendingQuit: () => boolean;
  cancelPendingQuit: () => void;
  consumePendingQuitAfterWindowClosed: () => boolean;
};

export function createIdPhotoUnloadGuard(): IdPhotoUnloadGuard {
  let confirmationPending = false;

  return {
    handlePreventedUnload(request) {
      if (confirmationPending) return;
      confirmationPending = true;

      void (async () => {
        try {
          const decision = await request.requestDecision();
          if (decision === "close-anyway") {
            request.closeAnyway();
          }
        } catch (error) {
          request.onError?.(error);
        } finally {
          confirmationPending = false;
        }
      })();
    },
    isConfirmationPending() {
      return confirmationPending;
    },
  };
}

export function createIdPhotoQuitCoordinator(): IdPhotoQuitCoordinator {
  let pendingQuit = false;

  return {
    handleBeforeQuit(hasOpenWindow) {
      if (hasOpenWindow) {
        pendingQuit = true;
        return "close-window-first";
      }
      return "start-native-shutdown";
    },
    hasPendingQuit() {
      return pendingQuit;
    },
    cancelPendingQuit() {
      pendingQuit = false;
    },
    consumePendingQuitAfterWindowClosed() {
      if (!pendingQuit) return false;
      pendingQuit = false;
      return true;
    },
  };
}
