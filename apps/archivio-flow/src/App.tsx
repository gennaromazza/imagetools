import { useCallback, useEffect, useState } from "react";
import type { Job, ImportResult } from "./types";
import { getArchivioJobs } from "./archivioDesktopApi";
import { NuovoLavoroPanel } from "./components/NuovoLavoroPanel";
import { ArchivioPanel } from "./components/ArchivioPanel";
import archivioLogo from "./assets/photo_Archivie.png";

type Screen = "nuovo" | "archivio" | "impostazioni";

export default function App() {
  const [screen, setScreen] = useState<Screen>("nuovo");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);

  const refreshJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      setJobs(await getArchivioJobs());
    } catch {
      setJobs([]);
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    refreshJobs();
  }, [refreshJobs]);

  function handleImportDone(result: ImportResult) {
    setJobs((prev) => {
      const idx = prev.findIndex((j) => j.id === result.job.id);
      if (idx < 0) {
        return [result.job, ...prev];
      }
      const next = [...prev];
      next[idx] = result.job;
      return next;
    });
    setScreen("archivio");
  }

  return (
    <div className="app-shell app-shell--with-sidebar">
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar__brand">
          <img
            src={archivioLogo}
            alt="Archivio Flow"
            style={{
              width: "100%",
              maxWidth: "172px",
              borderRadius: "18px",
              boxShadow: "0 16px 28px rgba(0, 0, 0, 0.18)",
            }}
          />
          <h1>Archivio Flow</h1>
          <p>Importa e organizza i tuoi scatti</p>
        </div>

        <nav className="stack">
          <button
            className={screen === "nuovo" ? "workflow-step workflow-step--active" : "workflow-step"}
            onClick={() => setScreen("nuovo")}
          >
            <span>1</span>
            <strong>Nuovo lavoro</strong>
            <small>Importa da SD card</small>
          </button>

          <button
            className={screen === "archivio" ? "workflow-step workflow-step--active" : "workflow-step"}
            onClick={() => setScreen("archivio")}
          >
            <span>2</span>
            <strong>Archivio lavori</strong>
            <small>{jobs.length > 0 ? `${jobs.length} lavori salvati` : "Nessun lavoro ancora"}</small>
          </button>

          <button
            className={screen === "impostazioni" ? "workflow-step workflow-step--active" : "workflow-step"}
            onClick={() => setScreen("impostazioni")}
          >
            <span aria-hidden="true">⚙</span>
            <strong>Impostazioni</strong>
            <small>Radice archivio e preset rapidi</small>
          </button>
        </nav>

        <div className="tool-pill" style={{ marginTop: "auto", paddingTop: "2rem" }}>
          <span>Photo Tools</span>
          <strong>v1.0</strong>
        </div>
      </aside>

      {/* ── Main workspace ──────────────────────────────────────────── */}
      <main className="workspace">
        {screen !== "archivio" && (
          <NuovoLavoroPanel
            onImportDone={handleImportDone}
            activeView={screen === "impostazioni" ? "impostazioni" : "nuovo"}
          />
        )}
        {screen === "archivio" && (
          <ArchivioPanel jobs={jobs} loading={loadingJobs} onRefresh={refreshJobs} />
        )}
      </main>
    </div>
  );
}
