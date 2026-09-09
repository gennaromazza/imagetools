import { useCallback, useEffect, useRef, useState } from "react";
import type { Job, ImportResult, SdCard } from "./types";
import { getArchivioJobs, getArchivioSdCards, openBackupGuard, showArchivioFlowWindow } from "./archivioDesktopApi";
import { NuovoLavoroPanel } from "./components/NuovoLavoroPanel";
import { SdCardPreviewPanel } from "./components/SdCardPreviewPanel";
import { ArchivioPanel } from "./components/ArchivioPanel";
import { GoogleDrivePanel } from "./components/GoogleDrivePanel";
import archivioLogo from "./assets/photo_Archivie.png";
import archivioPackage from "../package.json";

import type { ImportSelection } from "./importSelection";

type Screen = "sd" | "nuovo" | "archivio" | "drive" | "impostazioni";
const SIDEBAR_COLLAPSED_KEY = "filex.archivio-flow.sidebar-collapsed";

export default function App() {
  const [screen, setScreen] = useState<Screen>("sd");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [archiveAnalyzing, setArchiveAnalyzing] = useState(false);
  const [existingJobImportId, setExistingJobImportId] = useState<string | null>(null);
  const [detectedSdPath, setDetectedSdPath] = useState<string | null>(null);
  const [newJobRevision, setNewJobRevision] = useState(0);
  const [sourceRevision, setSourceRevision] = useState(0);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [pendingImportSelection, setPendingImportSelection] = useState<ImportSelection | null>(null);
  const [pendingImportDateFilter, setPendingImportDateFilter] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
  const [backupGuardFeedback, setBackupGuardFeedback] = useState<string | null>(null);
  const [openingBackupGuard, setOpeningBackupGuard] = useState(false);
  const importBusyRef = useRef(false);
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

    let detecting = false;
    async function detectInsertedSd() {
      if (detecting) return;
      detecting = true;
      try {
        const cards = await getArchivioSdCards();
        if (!active || importBusyRef.current) return;
        const previousIdentities = knownSdIdentitiesRef.current;
        const detectedCard = cards.find((card) => sdIdentity(card) === detectedSdIdentityRef.current);
        const newCard = previousIdentities === null
          ? cards[0]
          : cards.find((card) => previousIdentities.get(card.path) !== sdIdentity(card));
        knownSdIdentitiesRef.current = new Map(cards.map((card) => [card.path, sdIdentity(card)]));
        if (!detectedCard && detectedSdIdentityRef.current) {
          detectedSdIdentityRef.current = null;
          setDetectedSdPath(null);
          setSourceRevision((value) => value + 1);
          setPendingImportDateFilter(null);
          setPendingImportSelection(null);
          void showArchivioFlowWindow().catch(() => undefined);
        }
        if (newCard) {
          detectedSdIdentityRef.current = sdIdentity(newCard);
          setDetectedSdPath(newCard.path);
          setSourceRevision((value) => value + 1);
          setPendingImportDateFilter(null);
          setPendingImportSelection(null);
          setScreen("sd");
        }
      } catch {
        // Il controllo periodico riproverà: non interrompere la navigazione dell'archivio.
      } finally { detecting = false; }
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
    setExistingJobImportId(result.job.id);
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
            className={screen === "sd" || screen === "nuovo" ? "workflow-step workflow-step--active" : "workflow-step"}
            onClick={() => setScreen("sd")}
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
        <div style={{ display: screen === "sd" ? "block" : "none" }} aria-hidden={screen !== "sd"}>
          <SdCardPreviewPanel
            key={sourceRevision}
            sdPath={detectedSdPath}
            sourceIdentity={detectedSdIdentityRef.current ?? undefined}
            jobs={jobs}
            onStartImport={(selection, jobId) => {
              setPendingImportSelection({ ...selection, existingJobId: jobId });
              if (jobId !== undefined) setExistingJobImportId(jobId);
              if (jobId === null) setNewJobRevision((value) => value + 1);
              setPendingImportDateFilter(selection.suggestedJobDate ?? null);
              setSelectionRevision((value) => value + 1);
              setScreen("nuovo");
            }}
          />
        </div>
        <div style={{ display: screen === "nuovo" || screen === "impostazioni" ? "block" : "none" }}>
          <NuovoLavoroPanel
            onImportDone={handleImportDone}
            onImportingChange={(busy) => { importBusyRef.current = busy; }}
            activeView={screen === "impostazioni" ? "impostazioni" : "nuovo"}
            isVisible={screen === "nuovo" || screen === "impostazioni"}
            existingJobImportId={existingJobImportId}
            initialSdPath={detectedSdPath}
            sourceRevision={sourceRevision}
            selectionRevision={selectionRevision}
            newJobRevision={newJobRevision}
            initialDateFilter={pendingImportDateFilter}
            initialSelection={pendingImportSelection}
            onEditSelection={() => setScreen("sd")}
          />
        </div>
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
              setNewJobRevision((value) => value + 1);
              setPendingImportDateFilter(null);
              setPendingImportSelection(null);
              setSelectionRevision((value) => value + 1);
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
