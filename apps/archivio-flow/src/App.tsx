import { useCallback, useEffect, useRef, useState } from "react";
import type { Job, ImportResult, SdCard } from "./types";
import { getArchivioJobs, getArchivioSdCards, openBackupGuard } from "./archivioDesktopApi";
import { NuovoLavoroPanel } from "./components/NuovoLavoroPanel";
import { SdCardPreviewPanel } from "./components/SdCardPreviewPanel";
import { ArchivioPanel } from "./components/ArchivioPanel";
import { GoogleDrivePanel } from "./components/GoogleDrivePanel";
import archivioLogo from "./assets/photo_Archivie.png";
import archivioPackage from "../package.json";

type Screen = "sd" | "nuovo" | "archivio" | "drive" | "impostazioni";
const SIDEBAR_COLLAPSED_KEY = "filex.archivio-flow.sidebar-collapsed";

export default function App() {
  const [screen, setScreen] = useState<Screen>("archivio");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [archiveAnalyzing, setArchiveAnalyzing] = useState(false);
  const [existingJobImportId, setExistingJobImportId] = useState<string | null>(null);
  const [detectedSdPath, setDetectedSdPath] = useState<string | null>(null);
  const [pendingImportDateFilter, setPendingImportDateFilter] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
  const [backupGuardFeedback, setBackupGuardFeedback] = useState<string | null>(null);
  const [openingBackupGuard, setOpeningBackupGuard] = useState(false);
  const knownSdIdentitiesRef = useRef<Map<string, string> | null>(null);
  const detectedSdIdentityRef = useRef<string | null>(null);

  const sdIdentity = (card: SdCard) => `${card.path.toLowerCase()}|${card.volumeSerial ?? ""}|${card.deviceId}|${card.volumeName}`;

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

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    let active = true;

    async function detectInsertedSd() {
      try {
        const cards = await getArchivioSdCards();
        if (!active) return;
        const previousIdentities = knownSdIdentitiesRef.current;
        const detectedCard = cards.find((card) => sdIdentity(card) === detectedSdIdentityRef.current);
        const newCard = previousIdentities === null
          ? cards[0]
          : cards.find((card) => previousIdentities.get(card.path) !== sdIdentity(card));
        knownSdIdentitiesRef.current = new Map(cards.map((card) => [card.path, sdIdentity(card)]));
        if (!detectedCard && detectedSdIdentityRef.current) {
          detectedSdIdentityRef.current = null;
          setDetectedSdPath(null);
          setScreen((current) => current === "sd" || current === "nuovo" ? "archivio" : current);
        }
        if (newCard) {
          detectedSdIdentityRef.current = sdIdentity(newCard);
          setDetectedSdPath(newCard.path);
          setExistingJobImportId(null);
          setScreen("sd");
        }
      } catch {
        // Il controllo periodico riproverà: non interrompere la navigazione dell'archivio.
      }
    }

    void detectInsertedSd();
    const timer = window.setInterval(() => { void detectInsertedSd(); }, 2500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

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

  async function handleOpenBackupGuard() {
    setOpeningBackupGuard(true);
    setBackupGuardFeedback(null);
    try {
      const result = await openBackupGuard();
      setBackupGuardFeedback(result.ok ? "Backup Guard è stato avviato." : "Backup Guard non è installato. Installalo dalla FileX Suite per creare la seconda copia dei file.");
    } catch {
      setBackupGuardFeedback("Non è stato possibile avviare Backup Guard. Verifica che sia installato.");
    } finally {
      setOpeningBackupGuard(false);
    }
  }

  return (
    <div className={`app-shell app-shell--with-sidebar${sidebarCollapsed ? " app-shell--sidebar-collapsed" : ""}`}>
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <button className="sidebar__brand" onClick={() => setSidebarCollapsed((value) => !value)} aria-label={sidebarCollapsed ? "Espandi barra laterale" : "Riduci barra laterale"}>
          <img
            src={archivioLogo}
            alt="Archivio Flow"
            className="sidebar__brand-logo"
          />
          <span className="sidebar__toggle" aria-hidden="true">{sidebarCollapsed ? "›" : "‹"}</span>
        </button>

        <nav className="stack">
          <button
            className={screen === "nuovo" ? "workflow-step workflow-step--active" : "workflow-step"}
            onClick={() => setScreen("nuovo")}
            title="Nuovo lavoro"
          >
            <span aria-hidden="true">＋</span>
            <strong>Nuovo lavoro</strong>
            <small>Importa da SD card</small>
          </button>

          <button
            className={screen === "archivio" ? "workflow-step workflow-step--active" : "workflow-step"}
            onClick={() => setScreen("archivio")}
            title="Archivio lavori"
          >
            <span aria-hidden="true">▦</span>
            <strong>Archivio lavori</strong>
            <small>{archiveAnalyzing ? "Controllo nomi in corso…" : (jobs.length > 0 ? `${jobs.length} lavori salvati` : "Nessun lavoro ancora")}</small>
          </button>

          <button
            className={screen === "drive" ? "workflow-step workflow-step--active" : "workflow-step"}
            onClick={() => setScreen("drive")}
            title="Google Drive"
          >
            <span aria-hidden="true">☁</span>
            <strong>Google Drive</strong>
            <small>Registro remoto StudioFlow</small>
          </button>

          <button
            className="workflow-step"
            onClick={() => { void handleOpenBackupGuard(); }}
            title="Apri Backup Guard"
            disabled={openingBackupGuard}
          >
            <span aria-hidden="true">⧉</span>
            <strong>{openingBackupGuard ? "Apro Backup Guard…" : "Backup Guard"}</strong>
            <small>Seconda copia di sicurezza</small>
          </button>

          <button
            className={screen === "impostazioni" ? "workflow-step workflow-step--active" : "workflow-step"}
            onClick={() => setScreen("impostazioni")}
            title="Impostazioni"
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
        {backupGuardFeedback && (
          <div className="message-box" role="status" style={{ marginBottom: "0.9rem" }}>
            <p style={{ margin: 0 }}>{backupGuardFeedback}</p>
          </div>
        )}
        {screen === "sd" && detectedSdPath && (
          <SdCardPreviewPanel
            sdPath={detectedSdPath}
            onStartImport={(dateFilter) => {
              setPendingImportDateFilter(dateFilter);
              setScreen("nuovo");
            }}
          />
        )}
        {(screen === "nuovo" || screen === "impostazioni") && (
          <NuovoLavoroPanel
            onImportDone={handleImportDone}
            activeView={screen === "impostazioni" ? "impostazioni" : "nuovo"}
            existingJobImportId={existingJobImportId}
            initialSdPath={screen === "nuovo" ? detectedSdPath : null}
            initialDateFilter={screen === "nuovo" ? pendingImportDateFilter : null}
          />
        )}
        <div style={{ display: screen === "archivio" ? "block" : "none" }} aria-hidden={screen !== "archivio"}>
          <ArchivioPanel
            jobs={jobs}
            loading={loadingJobs}
            onRefresh={refreshJobs}
            onAnalysisStateChange={setArchiveAnalyzing}
            onAddFiles={(job) => {
              setExistingJobImportId(job.id);
              setScreen("nuovo");
            }}
            onNewJob={() => {
              setExistingJobImportId(null);
              setScreen("nuovo");
            }}
          />
        </div>
        {screen === "drive" && <GoogleDrivePanel />}
      </main>
    </div>
  );
}
