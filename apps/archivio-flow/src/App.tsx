import { useCallback, useEffect, useState } from "react";
import type { Job, ImportResult } from "./types";
import { getArchivioJobs } from "./archivioDesktopApi";
import { NuovoLavoroPanel } from "./components/NuovoLavoroPanel";
import { ArchivioPanel } from "./components/ArchivioPanel";
import { GoogleDrivePanel } from "./components/GoogleDrivePanel";
import archivioLogo from "./assets/photo_Archivie.png";
import archivioPackage from "../package.json";

type Screen = "nuovo" | "archivio" | "drive" | "impostazioni";

export default function App() {
  const [screen, setScreen] = useState<Screen>("nuovo");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [archiveAnalyzing, setArchiveAnalyzing] = useState(false);

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
    if (!result.incomplete) {
      setScreen("archivio");
    }
  }

  return (
    <div className="app-shell app-shell--with-sidebar">
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar__brand">
          <img
            src={archivioLogo}
            alt="Archivio Flow"
            className="sidebar__brand-logo"
          />
          <div className="sidebar__brand-copy">
            <h1>Archivio Flow</h1>
            <p>Importa e organizza i tuoi scatti</p>
          </div>
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
            <small>{archiveAnalyzing ? "Controllo nomi in corso…" : (jobs.length > 0 ? `${jobs.length} lavori salvati` : "Nessun lavoro ancora")}</small>
          </button>

          <button
            className={screen === "drive" ? "workflow-step workflow-step--active" : "workflow-step"}
            onClick={() => setScreen("drive")}
          >
            <span aria-hidden="true">☁</span>
            <strong>Google Drive</strong>
            <small>Registro remoto StudioFlow</small>
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

        <div className="tool-pill" style={{ marginTop: "auto" }}>
          <span>Archivio Flow</span>
          <strong>v{archivioPackage.version}</strong>
        </div>
      </aside>

      {/* ── Main workspace ──────────────────────────────────────────── */}
      <main className="workspace">
        {(screen === "nuovo" || screen === "impostazioni") && (
          <NuovoLavoroPanel
            onImportDone={handleImportDone}
            activeView={screen === "impostazioni" ? "impostazioni" : "nuovo"}
          />
        )}
        <div style={{ display: screen === "archivio" ? "block" : "none" }} aria-hidden={screen !== "archivio"}>
          <ArchivioPanel
            jobs={jobs}
            loading={loadingJobs}
            onRefresh={refreshJobs}
            onAnalysisStateChange={setArchiveAnalyzing}
          />
        </div>
        {screen === "drive" && <GoogleDrivePanel />}
      </main>
    </div>
  );
}
