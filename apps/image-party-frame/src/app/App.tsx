import { useEffect } from "react";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { ProjectProvider } from "./contexts/ProjectContext";
import { Toaster, toast } from "sonner";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { publishPhotoSelectionHandoff } from "./lib/photoSelectionHandoff";

function PhotoSelectionHandoffCoordinator() {
  useEffect(() => {
    const api = window.filexDesktop;
    if (!api?.consumePendingOpenProjectPath
      || !api.consumePhotoSelectionHandoff
      || !api.acknowledgeOpenProjectRequest
      || !api.markOpenProjectRequestReady
      || !api.onOpenProjectRequest) return;
    let active = true;
    let draining = false;
    let drainAgain = false;
    const drainHandoffs = async () => {
      if (draining) {
        drainAgain = true;
        return;
      }
      draining = true;
      try {
        do {
          drainAgain = false;
          while (active) {
            const projectPath = await api.consumePendingOpenProjectPath();
            if (!active || !projectPath) break;
            try {
              const handoff = await api.consumePhotoSelectionHandoff(projectPath);
              if (active && handoff) {
                await router.navigate("/new-project");
                await publishPhotoSelectionHandoff(handoff);
              }
            } catch (error) {
              if (active) {
                toast.error("Selezione Archivio Flow non disponibile", {
                  description: error instanceof Error ? error.message : "Il collegamento non è valido o è scaduto.",
                });
              }
            } finally {
              await api.acknowledgeOpenProjectRequest(projectPath).catch(() => undefined);
            }
          }
        } while (active && drainAgain);
      } finally {
        draining = false;
      }
    };
    const removeListener = api.onOpenProjectRequest(() => {
      void drainHandoffs();
    });
    const startTimer = window.setTimeout(() => {
      void api.markOpenProjectRequestReady()
        .then(() => drainHandoffs())
        .catch((error: unknown) => {
          if (active) {
            toast.error("Collegamento Archivio Flow non disponibile", {
              description: error instanceof Error ? error.message : "La Suite non ha inizializzato il canale foto.",
            });
          }
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(startTimer);
      removeListener();
    };
  }, []);
  return null;
}

export default function App() {
  return (
    <AppErrorBoundary>
      <ProjectProvider>
        <PhotoSelectionHandoffCoordinator />
        <RouterProvider router={router} />
        <Toaster
          position="top-right"
          richColors
          closeButton
          toastOptions={{
            style: {
              background: "var(--app-surface)",
              color: "var(--app-text)",
              border: "1px solid var(--app-border)",
              boxShadow: "0 18px 42px rgba(0,0,0,0.18)",
            },
          }}
        />
      </ProjectProvider>
    </AppErrorBoundary>
  );
}
