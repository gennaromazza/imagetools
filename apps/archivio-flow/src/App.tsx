import { useCallback, useEffect, useRef, useState } from "react";
import type { Job, ImportResult, SdCard } from "./types";
import { browseArchivioFolder, getArchivioFolders, getArchivioJobs, getArchivioSdCards, getArchivioSettings, saveArchivioSettings, openBackupGuard, showArchivioFlowWindow } from "./archivioDesktopApi";
import { NuovoLavoroPanel } from "./components/NuovoLavoroPanel";
import { SdCardPreviewPanel } from "./components/SdCardPreviewPanel";
import { ArchivioPanel } from "./components/ArchivioPanel";
import { GoogleDrivePanel } from "./components/GoogleDrivePanel";
import archivioLogo from "./assets/photo_Archivie.png";
import archivioPackage from "../package.json";

import type { ImportSelection } from "./importSelection";
import { initialSidebarCollapsed, isGuidedFlow, shouldSwitchToNewCard } from "./wizardModel";
import { SidebarNav } from "./components/SidebarNav";

type Screen = "sd" | "nuovo" | "archivio" | "drive" | "impostazioni";
const SIDEBAR_COLLAPSED_KEY = "filex.archivio-flow.sidebar-collapsed-v2";
const ONBOARDING_SEEN_KEY = "filex.archivio-flow.onboarding-seen";

export default function App() {
  const [screen, setScreen] = useState<Screen>("sd");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [archiveAnalyzing, setArchiveAnalyzing] = useState(false);
  const [existingJobImportId, setExistingJobImportId] = useState<string | null>(null);
  const [detectedSdPath, setDetectedSdPath] = useState<string | null>(null);
  const [availableCards, setAvailableCards] = useState<SdCard[]>([]);
  const [newJobRevision, setNewJobRevision] = useState(0);
  const [sourceRevision, setSourceRevision] = useState(0);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [pendingImportSelection, setPendingImportSelection] = useState<ImportSelection | null>(null);
  const [pendingImportDateFilter, setPendingImportDateFilter] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => initialSidebarCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)));
  const [backupGuardFeedback, setBackupGuardFeedback] = useState<string | null>(null);
  const [openingBackupGuard, setOpeningBackupGuard] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [onboardingMode, setOnboardingMode] = useState<"existing" | "new" | null>(null);
  const [wizardRoot, setWizardRoot] = useState("");
  const [wizardFolders, setWizardFolders] = useState<string[]>([]);
  const [wizardCategories, setWizardCategories] = useState<Record<string, string>>({});
  const [wizardBusy, setWizardBusy] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
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
    if (window.localStorage.getItem(ONBOARDING_SEEN_KEY) === "1") return;
    void getArchivioSettings().then((settings) => {
      if (!settings?.archiveRoot?.trim()) setShowOnboarding(true);
    }).catch(() => setShowOnboarding(true));
  }, []);

  function closeOnboarding() {
    window.localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
    setShowOnboarding(false);
    setScreen("impostazioni");
  }

  function openOnboarding() { setOnboardingStep(1); setOnboardingMode(null); setWizardError(null); setShowOnboarding(true); void getArchivioSettings().then((settings) => { setWizardRoot(settings.archiveRoot ?? ""); }).catch(() => undefined); }

  async function chooseWizardRoot() {
    const selected = await browseArchivioFolder();
    if (!selected) return;
    setWizardRoot(selected);
    setWizardBusy(true); setWizardError(null);
    try { setWizardFolders(await getArchivioFolders(selected)); } catch { setWizardFolders([]); setWizardError("Non riesco a leggere le cartelle della radice selezionata."); } finally { setWizardBusy(false); }
  }

  async function saveWizardConfiguration() {
    setWizardBusy(true); setWizardError(null);
    try {
      const current = await getArchivioSettings();
      const mappings = Object.entries(wizardCategories).filter(([, folder]) => folder).map(([name, folder]) => {
        const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        return { id:key, categoryKey:key, displayName:name, relativePathPattern:`{year}\\${folder.split(/[\\/]/).pop() ?? folder}`, jobFolderPattern:"{date} - {client} - {date-dmy}", enabled:true };
      });
      await saveArchivioSettings({ ...current, archiveRoot:wizardRoot.trim(), defaultDestinazione:wizardRoot.trim(), categoryMappings:mappings });
      setOnboardingStep(3);
    } catch (error) { setWizardError(error instanceof Error ? error.message : "Salvataggio non riuscito."); } finally { setWizardBusy(false); }
  }

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
        setAvailableCards((previous) => previous.length === cards.length && previous.every((card, index) => sdIdentity(card) === sdIdentity(cards[index]!)) ? previous : cards);
        if (!detectedCard && detectedSdIdentityRef.current) {
          detectedSdIdentityRef.current = null;
          setDetectedSdPath(null);
          setSourceRevision((value) => value + 1);
          setPendingImportDateFilter(null);
          setPendingImportSelection(null);
          void showArchivioFlowWindow().catch(() => undefined);
        }
        // Una seconda scheda inserita mentre se ne usa gia' una non toglie la scelta: compare nell'elenco delle schede.
        if (newCard && shouldSwitchToNewCard({ hasActive: detectedSdIdentityRef.current !== null, activePresent: detectedCard !== undefined, hasNewCard: true })) {
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

  function chooseCard(path: string) {
    const card = availableCards.find((item) => item.path.toLowerCase() === path.toLowerCase());
    if (!card || importBusyRef.current) return;
    detectedSdIdentityRef.current = sdIdentity(card);
    setDetectedSdPath(card.path);
    setSourceRevision((value) => value + 1);
    setPendingImportDateFilter(null);
    setPendingImportSelection(null);
    setScreen("sd");
  }

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
    // Resta sulla schermata finale ("Fatto!"): da li' si sceglie se aprire la cartella, l'archivio o un'altra scheda.
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
        <div className="sidebar__brand-row">
        <button className="sidebar__brand" onClick={() => setSidebarCollapsed((value) => !value)} aria-label={sidebarCollapsed ? "Espandi barra laterale" : "Riduci barra laterale"} title={`Archivio Flow v${archivioPackage.version} · ${sidebarCollapsed ? "Espandi" : "Riduci"} la barra`}>
          <img
            src={archivioLogo}
            alt="Archivio Flow"
            className="sidebar__brand-logo"
          />
          <span className="sidebar__toggle" aria-hidden="true">{sidebarCollapsed ? "›" : "‹"}</span>
        </button>
        <button className="sidebar__help" onClick={openOnboarding} title="Guida e configurazione" aria-label="Apri guida e configurazione">?</button>
        </div>

        <SidebarNav
          screen={screen}
          inGuidedFlow={isGuidedFlow(screen)}
          archiveSummary={archiveAnalyzing ? "Controllo nomi in corso…" : (jobs.length > 0 ? `${jobs.length} lavori salvati` : "Nessun lavoro ancora")}
          backupBusy={openingBackupGuard}
          onSelect={(id) => {
            if (id === "import") setScreen("sd");
            else if (id === "exit") setScreen("sd");
            else if (id === "archive") setScreen("archivio");
            else if (id === "drive") setScreen("drive");
            else if (id === "settings") setScreen("impostazioni");
            else void handleOpenBackupGuard();
          }}
        />

      </aside>

      {/* ── Main workspace ──────────────────────────────────────────── */}
      <main className="workspace">
        {showOnboarding && (
          <div className="onboarding-backdrop" role="presentation">
            <section className="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
              <p className="workspace__eyebrow">Passo {onboardingStep} di 3 · Guida Archivio Flow</p>
              {onboardingStep === 1 && <><h1 id="onboarding-title">1. Scegli il tuo archivio</h1><p>La radice archivio è la cartella principale che contiene anni, categorie e lavori.</p><div className="onboarding-choice"><button className={onboardingMode === "existing" ? "primary-button" : "secondary-button"} onClick={() => setOnboardingMode("existing")}>Ho già un archivio</button><button className={onboardingMode === "new" ? "primary-button" : "secondary-button"} onClick={() => setOnboardingMode("new")}>Creo un archivio nuovo</button></div>{onboardingMode && <><p className="onboarding-note">{onboardingMode === "existing" ? "Archivio Flow si adatterà alle cartelle che hai già creato." : "Archivio Flow creerà le cartelle necessarie seguendo le categorie che sceglierai."}</p><div className="wizard-path"><input value={wizardRoot} onChange={(event) => setWizardRoot(event.target.value)} placeholder="Seleziona la cartella principale dell’archivio" /><button className="secondary-button" onClick={() => void chooseWizardRoot()} disabled={wizardBusy}>Sfoglia</button></div>{wizardRoot && <p className="onboarding-note">Radice selezionata: <strong>{wizardRoot}</strong></p>}</>}</>}
              {onboardingStep === 2 && <><h1 id="onboarding-title">2. Collega le categorie</h1><p>Scegli le categorie che usi e associa ciascuna alla cartella reale trovata nella radice. Non devi scrivere percorsi tecnici.</p>{wizardFolders.length === 0 && <p className="onboarding-note">Nessuna cartella categoria trovata. Puoi creare l’archivio nuovo e completare le categorie dalle Impostazioni.</p>}{["Matrimoni", "Battesimi", "Comunioni", "Shooting"].map((category) => <label className="wizard-category" key={category}><strong>{category}</strong><select value={wizardCategories[category] ?? ""} onChange={(event) => setWizardCategories((previous) => ({ ...previous, [category]:event.target.value }))}><option value="">Non configurare</option>{wizardFolders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}</select></label>)}{wizardError && <p className="onboarding-error">{wizardError}</p>}<button className="primary-button" onClick={() => void saveWizardConfiguration()} disabled={wizardBusy || !wizardRoot.trim()}>{wizardBusy ? "Salvataggio…" : "Salva configurazione"}</button></>}
              {onboardingStep === 3 && <><h1 id="onboarding-title">Importa e ritrova i lavori</h1><p>Inserisci una SD, scegli Nuovo lavoro o Lavoro esistente, controlla l’anteprima del percorso e avvia l’importazione. Archivio lavori indicizza anche cartelle create manualmente; Backup Guard mantiene una seconda copia.</p></>}
              <div className="button-row">{onboardingStep === 1 && <button className="primary-button" disabled={!onboardingMode || !wizardRoot.trim()} onClick={() => { setOnboardingStep(2); if (wizardFolders.length === 0 && wizardRoot.trim()) void getArchivioFolders(wizardRoot.trim()).then(setWizardFolders).catch(() => undefined); }}>Continua</button>}{onboardingStep === 3 && <button className="primary-button" onClick={closeOnboarding}>Apri impostazioni</button>}{onboardingStep > 1 && onboardingStep < 3 && <button className="ghost-button" onClick={() => setOnboardingStep((value) => value - 1)}>Indietro</button>}<button className="ghost-button" onClick={() => { window.localStorage.setItem(ONBOARDING_SEEN_KEY, "1"); setShowOnboarding(false); }}>Chiudi</button></div>
            </section>
          </div>
        )}
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
            onResumed={handleImportDone}
            cards={availableCards}
            onChooseCard={chooseCard}
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
            onOpenArchive={() => setScreen("archivio")}
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
