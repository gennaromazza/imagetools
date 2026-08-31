import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FolderOpen,
  FolderOutput,
  ImagePlus,
  LayoutGrid,
  Palette,
  Printer,
  RefreshCw,
  Save,
  ScanFace,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import type { DesktopPhotoToolHandoff } from "@photo-tools/desktop-contracts";
import {
  calculateGridLayout,
  createDefaultCrop,
  getPreviewRenderDpi,
  normalizeCrop,
  paginateAssets,
  SHEET_PRESETS,
  type BatchCropState,
  type ExportFormat,
  type PhotoAsset,
  type PhotoPrintSpec,
  type PrintSheetSpec,
} from "@photo-tools/batch-print-layout/print-engine";
import { exportBatchWithMetadata, renderPageCanvas, renderPhotoCanvas } from "@photo-tools/batch-print-layout/render-export";
import { DOCUMENT_PROFILES, evaluateTechnicalChecks, safeJobName, type TechnicalCheck } from "./domain";
import { displayedCropPosition, moveCropInDisplayedAxes } from "./crop-position";
import { buildRehydrationCandidates } from "./asset-rehydration";
import {
  createPersistedExportVerifier,
  type PendingOutputVerificationResult,
  type OutputVerificationStatus,
} from "./output-verification";
import { analyzeImage, bytesToObjectUrl } from "./image-analysis";
import {
  createBrowserAssetPreviewResources,
  ID_PHOTO_DETAIL_PREVIEW_MAX_DIMENSION,
  ID_PHOTO_RAIL_THUMBNAIL_MAX_DIMENSION,
  renderBrowserPreview,
  revokeBlobUrls,
  withDetailPreview,
} from "./image-preview";
import {
  createIdPhotoJobId,
  deleteIdPhotoJob,
  deriveIdPhotoJobStatus,
  ID_PHOTO_MAX_ASSETS_PER_JOB,
  ID_PHOTO_MAX_STORED_JOBS,
  IdPhotoStorageError,
  jobDisplayName,
  loadActiveIdPhotoJob,
  loadIdPhotoJobs,
  pendingIdPhotoExportMatchesContext,
  recordPendingIdPhotoExport,
  saveIdPhotoJob,
  selectLastExportForSnapshot,
  type IdPhotoJobStatus,
  type PersistedIdPhotoAsset,
  type PersistedIdPhotoExport,
  type PersistedIdPhotoJob,
  type PersistedIdPhotoPendingExport,
  type PersistedIdPhotoRevision,
} from "./job-store";

const STEPS = [
  { id: 1, label: "Commessa", icon: FolderOpen },
  { id: 2, label: "Prepara", icon: SlidersHorizontal },
  { id: 3, label: "Verifica", icon: ShieldCheck },
  { id: 4, label: "Impagina", icon: LayoutGrid },
  { id: 5, label: "Esporta", icon: Printer },
] as const;

const TUTORIAL_STEPS = [
  {
    id: 1,
    title: "Crea la commessa",
    summary: "Imposta il lavoro, scegli il documento e porta in FileX la fotografia del cliente.",
    actions: [
      "Inserisci cliente e nome della commessa.",
      "Scegli CIE, passaporto italiano o preset generico.",
      "Importa una cartella oppure invia una foto da Archivio Flow.",
      "Seleziona la fotografia da lavorare nella colonna sinistra.",
    ],
    attention: "Controlla sempre fonte e data di verifica del profilo prima di iniziare.",
  },
  {
    id: 2,
    title: "Prepara la fotografia",
    summary: "Regola inquadratura e orientamento senza alterare il file originale.",
    actions: [
      "Usa zoom e posizione per allineare volto e linea degli occhi.",
      "Ruota la foto se l'orientamento non è corretto.",
      "Usa Photoshop solo quando serve un intervento professionale.",
      "Dopo Photoshop ricarica la revisione e ricontrolla il crop.",
    ],
    attention: "Le guide sono visive: il giudizio finale rimane del fotografo.",
  },
  {
    id: 3,
    title: "Verifica il documento",
    summary: "Esamina i controlli tecnici e completa le conferme professionali obbligatorie.",
    actions: [
      "Controlla risoluzione, luminosità, contrasto e nitidezza.",
      "Verifica uniformità dello sfondo, ombre e riflessi.",
      "Conferma volto, espressione, occhi e accessori.",
      "Leggi e accetta consapevolmente gli eventuali avvisi.",
    ],
    attention: "FileX assiste il controllo, ma non garantisce l'accettazione da parte dell'ente.",
  },
  {
    id: 4,
    title: "Impagina le copie",
    summary: "Prepara il foglio fisico con quantità, formato e indicatori di taglio desiderati.",
    actions: [
      "Scegli il foglio 10×15 oppure 15×20.",
      "Imposta da 1 a 48 copie.",
      "Attiva o disattiva gli indicatori di taglio.",
      "Controlla tutte le pagine dell'anteprima.",
    ],
    attention: "L'anteprima è ridotta; l'export usa millimetri e DPI reali del profilo.",
  },
  {
    id: 5,
    title: "Esporta e stampa",
    summary: "Crea PDF o JPG verificati, pronti per il driver della stampante o il laboratorio.",
    actions: [
      "Scegli PDF multipagina o JPG con DPI incorporati.",
      "Seleziona la cartella di destinazione.",
      "Attendi la verifica finale dei file esportati.",
      "Nel driver usa scala 100% e disattiva Adatta alla pagina.",
    ],
    attention: "Se la verifica è in attesa usa Riprova verifica: non riesportare gli stessi fogli.",
  },
] as const;

type TutorialStepId = typeof TUTORIAL_STEPS[number]["id"];

function TutorialDrawer({
  currentStep,
  selectedStep,
  onSelectStep,
  onClose,
}: {
  currentStep: number;
  selectedStep: TutorialStepId;
  onSelectStep: (stepId: TutorialStepId) => void;
  onClose: () => void;
}) {
  const tutorial = TUTORIAL_STEPS.find((item) => item.id === selectedStep) ?? TUTORIAL_STEPS[0];
  return (
    <aside id="id-photo-tutorial" className="tutorial-drawer" role="dialog" aria-modal="false" aria-labelledby="tutorial-title">
      <header>
        <div><span>TUTORIAL OPERATORE</span><h2 id="tutorial-title">{tutorial.title}</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="Chiudi tutorial"><X size={17} /></button>
      </header>
      <nav aria-label="Capitoli del tutorial">
        {TUTORIAL_STEPS.map((item) => (
          <button
            key={item.id}
            className={item.id === selectedStep ? "active" : item.id === currentStep ? "current" : ""}
            onClick={() => onSelectStep(item.id)}
          >
            <span>{item.id}</span>{STEPS[item.id - 1].label}
          </button>
        ))}
      </nav>
      <div className="tutorial-content">
        <p>{tutorial.summary}</p>
        <ol>{tutorial.actions.map((action) => <li key={action}>{action}</li>)}</ol>
        <div className="tutorial-attention"><AlertTriangle size={17} /><span>{tutorial.attention}</span></div>
      </div>
      <footer>
        <span>Stai lavorando nello step {currentStep}: {STEPS[currentStep - 1]?.label ?? "Commessa"}</span>
        {selectedStep !== currentStep ? <button className="secondary" onClick={() => onSelectStep(currentStep as TutorialStepId)}>Torna allo step attuale</button> : null}
      </footer>
    </aside>
  );
}

const AVAILABLE_SHEETS = SHEET_PRESETS.filter((sheet) => sheet.presetId === "10x15" || sheet.presetId === "15x20");
const DEFAULT_SHEET = AVAILABLE_SHEETS[0];
const STORAGE_KEY = "filex-id-photo.preferences.v1";
// L'export desktop rilegge la sorgente alla risoluzione richiesta. Nel renderer
// conserviamo solo miniature del rail e una singola anteprima dettaglio 1600 px.
const PREVIEW_MAX_DIMENSION = ID_PHOTO_DETAIL_PREVIEW_MAX_DIMENSION;
const OLD_PASSPORT_PROFILE_ID = "it-passport-studio-35x45-v1";

interface IdPhotoAsset extends PhotoAsset {
  originalAbsolutePath?: string;
  workingCopyPath?: string;
  revisions: PersistedIdPhotoRevision[];
}

interface SelectedDetailPreview {
  assetKey: string;
  url: string;
  width: number;
  height: number;
  sourceSha256: string | null;
}

interface SavedPreferences {
  customer: string;
  jobName: string;
  profileId: string;
  sheetId: string;
  copies: number;
  format: ExportFormat;
  cutGuides: boolean;
  editorPath: string | null;
  outputDirectoryPath: string | null;
}

function persistenceErrorMessage(error: unknown, fallback: string): string {
  return error instanceof IdPhotoStorageError ? error.message : fallback;
}

const DEFAULT_PREFERENCES: SavedPreferences = {
  customer: "",
  jobName: "Fototessera",
  profileId: DOCUMENT_PROFILES[0].id,
  sheetId: DEFAULT_SHEET.presetId,
  copies: 8,
  format: "pdf",
  cutGuides: true,
  editorPath: null,
  outputDirectoryPath: null,
};

function readPreferences(): SavedPreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Partial<SavedPreferences> | null;
    const merged = { ...DEFAULT_PREFERENCES, ...(parsed ?? {}) };
    const profileId = merged.profileId === OLD_PASSPORT_PROFILE_ID
      ? "it-passport-icao-35x45-v2"
      : DOCUMENT_PROFILES.some((profile) => profile.id === merged.profileId)
        ? merged.profileId
        : DEFAULT_PREFERENCES.profileId;
    return {
      ...merged,
      profileId,
      sheetId: AVAILABLE_SHEETS.some((sheet) => sheet.presetId === merged.sheetId) ? merged.sheetId : DEFAULT_PREFERENCES.sheetId,
      copies: Number.isFinite(merged.copies) ? Math.max(1, Math.min(48, Math.floor(merged.copies))) : DEFAULT_PREFERENCES.copies,
      format: merged.format === "jpg" || merged.format === "pdf" ? merged.format : DEFAULT_PREFERENCES.format,
      customer: typeof merged.customer === "string" ? merged.customer : "",
      jobName: typeof merged.jobName === "string" ? merged.jobName : DEFAULT_PREFERENCES.jobName,
      editorPath: typeof merged.editorPath === "string" ? merged.editorPath : null,
      outputDirectoryPath: typeof merged.outputDirectoryPath === "string" ? merged.outputDirectoryPath : null,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function revokeAsset(asset: IdPhotoAsset): void {
  revokeBlobUrls([asset.previewUrl, asset.sourceUrl]);
}

function revokeAssets(assets: readonly IdPhotoAsset[]): void {
  for (const asset of assets) revokeAsset(asset);
}

function deferAssetRevocation(assets: readonly IdPhotoAsset[]): void {
  if (assets.length === 0) return;
  const snapshot = [...assets];
  window.setTimeout(() => revokeAssets(snapshot), 0);
}

async function browserFileToAsset(file: File): Promise<IdPhotoAsset> {
  const resources = await createBrowserAssetPreviewResources(
    file,
    ID_PHOTO_RAIL_THUMBNAIL_MAX_DIMENSION,
  );
  return {
    id: `photo-${hashString(`${file.name}:${file.size}:${file.lastModified}`)}`,
    fileName: file.name,
    // La sorgente Blob resta intatta per l'export browser ad alta risoluzione;
    // il rail usa invece un JPEG piccolo e separato.
    sourceUrl: resources.sourceUrl,
    previewUrl: resources.thumbnailUrl,
    width: resources.sourceWidth,
    height: resources.sourceHeight,
    size: file.size,
    lastModified: file.lastModified,
    revisions: [],
  };
}

function profileIdFromStored(value: string): string {
  if (value === OLD_PASSPORT_PROFILE_ID) return "it-passport-icao-35x45-v2";
  return DOCUMENT_PROFILES.some((profile) => profile.id === value) ? value : DOCUMENT_PROFILES[0].id;
}

function statusLabel(status: IdPhotoJobStatus): string {
  return {
    draft: "Bozza",
    preparing: "In preparazione",
    "to-review": "Da verificare",
    approved: "Approvata",
    "laid-out": "Impaginata",
    ready: "Output pronto",
  }[status];
}

async function rehydratePersistedAssets(records: PersistedIdPhotoAsset[]): Promise<{
  assets: IdPhotoAsset[];
  unavailable: PersistedIdPhotoAsset[];
  changedAssetIds: Set<string>;
}> {
  if (!window.filexDesktop || records.length === 0) {
    return { assets: [], unavailable: records, changedAssetIds: new Set(records.map((record) => record.id)) };
  }
  const candidatePaths = Array.from(new Map(records
    .flatMap(buildRehydrationCandidates)
    .map((path) => [path.toLocaleLowerCase(), path])).values());
  const stats = await window.filexDesktop.statFiles(candidatePaths);
  const statsByPath = new Map(stats.map((stat) => [stat.absolutePath.toLocaleLowerCase(), stat]));
  const loaded: IdPhotoAsset[] = [];
  const unavailable: PersistedIdPhotoAsset[] = [];
  const changedAssetIds = new Set<string>();
  for (const record of records) {
    let activePath: string | null = null;
    let stat: (typeof stats)[number] | undefined;
    let preview: Awaited<ReturnType<typeof window.filexDesktop.getPreview>> | null = null;
    for (const candidate of buildRehydrationCandidates(record)) {
      const candidateStat = statsByPath.get(candidate.toLocaleLowerCase());
      if (!candidateStat) continue;
      const candidatePreview = await window.filexDesktop.getPreview(candidate, {
        maxDimension: ID_PHOTO_RAIL_THUMBNAIL_MAX_DIMENSION,
        sourceFileKey: `${candidateStat.size}:${candidateStat.lastModified}`,
      }).catch(() => null);
      if (!candidatePreview) continue;
      activePath = candidate;
      stat = candidateStat;
      preview = candidatePreview;
      break;
    }
    if (!activePath || !preview) {
      unavailable.push(record);
      continue;
    }
    const persistedActivePath = record.workingCopyPath || record.absolutePath || record.originalAbsolutePath;
    const samePersistedPath = Boolean(persistedActivePath)
      && activePath.toLocaleLowerCase() === persistedActivePath!.toLocaleLowerCase();
    const samePersistedVersion = Boolean(
      samePersistedPath
      && stat
      && record.size !== undefined
      && record.lastModified !== undefined
      && stat.size === record.size
      && stat.lastModified === record.lastModified,
    );
    if (!samePersistedVersion) changedAssetIds.add(record.id);
    const url = bytesToObjectUrl(preview.bytes, preview.mimeType);
    loaded.push({
      ...record,
      absolutePath: activePath,
      workingCopyPath: record.workingCopyPath
        && activePath.toLocaleLowerCase() === record.workingCopyPath.toLocaleLowerCase()
        ? record.workingCopyPath
        : undefined,
      sourceUrl: url,
      previewUrl: url,
      width: preview.width,
      height: preview.height,
      size: stat?.size ?? record.size,
      lastModified: stat?.lastModified ?? record.lastModified,
      revisions: record.revisions ?? [],
    });
  }
  return { assets: loaded, unavailable, changedAssetIds };
}

function StatusIcon({ status }: { status: TechnicalCheck["status"] }) {
  if (status === "pass") return <CheckCircle2 aria-label="Superato" />;
  if (status === "warning") return <AlertTriangle aria-label="Da verificare" />;
  return <XCircle aria-label="Non superato" />;
}

export function App() {
  const initial = useMemo(readPreferences, []);
  const initialJob = useMemo(() => loadActiveIdPhotoJob(localStorage), []);
  const initialProfileId = profileIdFromStored(initialJob?.profileId ?? initial.profileId);
  const [step, setStep] = useState(1);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState<TutorialStepId>(1);
  const [jobId, setJobId] = useState(initialJob?.id ?? createIdPhotoJobId());
  const [jobCreatedAt, setJobCreatedAt] = useState(initialJob?.createdAt ?? new Date().toISOString());
  const [customer, setCustomer] = useState(initialJob?.customer ?? initial.customer);
  const [jobName, setJobName] = useState(initialJob?.jobName ?? initial.jobName);
  const [profileId, setProfileId] = useState(initialProfileId);
  const [sheetId, setSheetId] = useState(initialJob?.sheetId ?? initial.sheetId);
  const [copies, setCopies] = useState(initialJob?.copies ?? initial.copies);
  const [format, setFormat] = useState<ExportFormat>(initialJob?.format ?? initial.format);
  const [cutGuides, setCutGuides] = useState(initialJob?.cutGuides ?? initial.cutGuides);
  const [editorPath, setEditorPath] = useState<string | null>(initial.editorPath);
  const [outputDirectoryPath, setOutputDirectoryPath] = useState<string | null>(initialJob?.outputDirectoryPath ?? initial.outputDirectoryPath);
  const [folderPath, setFolderPath] = useState<string | null>(initialJob?.folderPath ?? null);
  const [assets, setAssets] = useState<IdPhotoAsset[]>([]);
  const [unavailableAssets, setUnavailableAssets] = useState<PersistedIdPhotoAsset[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [crops, setCrops] = useState<Record<string, BatchCropState>>(initialJob?.crops ?? {});
  const [checks, setChecks] = useState<TechnicalCheck[]>([]);
  const [manualChecks, setManualChecks] = useState(initialJob?.manualChecks ?? { face: false, expression: false, accessories: false });
  const [technicalWarningsAccepted, setTechnicalWarningsAccepted] = useState(initialJob?.technicalWarningsAccepted ?? false);
  const [lastExport, setLastExport] = useState<PersistedIdPhotoExport | null>(initialJob?.lastExport ?? null);
  const [pendingExport, setPendingExport] = useState<PersistedIdPhotoPendingExport | null>(initialJob?.pendingExport ?? null);
  const [lastExportVerification, setLastExportVerification] = useState<OutputVerificationStatus>(
    initialJob?.lastExport ? "unavailable" : "invalid",
  );
  const [recentJobs, setRecentJobs] = useState<PersistedIdPhotoJob[]>(() => loadIdPhotoJobs(localStorage));
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(initialJob?.updatedAt ?? null);
  const [restoringJob, setRestoringJob] = useState(Boolean(initialJob));
  const [pendingPhotoshopChange, setPendingPhotoshopChange] = useState(false);
  const [previewPageIndex, setPreviewPageIndex] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cropPreviewUrl, setCropPreviewUrl] = useState<string | null>(null);
  const [selectedDetailPreview, setSelectedDetailPreview] = useState<SelectedDetailPreview | null>(null);
  const [status, setStatus] = useState(initialJob ? "Ripristino dell'ultima commessa…" : "Crea una commessa e importa la foto del cliente.");
  const [busy, setBusy] = useState(false);
  const [hasUnsavedJobChanges, setHasUnsavedJobChanges] = useState(!initialJob);
  const [jobPersistenceError, setJobPersistenceError] = useState<string | null>(null);
  const [preferencesPersistenceError, setPreferencesPersistenceError] = useState<string | null>(null);
  const pendingExportRef = useRef<PersistedIdPhotoPendingExport | null>(initialJob?.pendingExport ?? null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const assetsRef = useRef<IdPhotoAsset[]>([]);
  const analysisGenerationRef = useRef(0);
  const pendingPhotoshopChangeRef = useRef(false);
  const exportFingerprintRef = useRef("");
  const latestJobSnapshotRef = useRef<PersistedIdPhotoJob | null>(null);
  const latestPreferencesRef = useRef<SavedPreferences>(initial);
  const exportInFlightRef = useRef(false);
  const restoringJobRef = useRef(restoringJob);
  const photoHandoffHandlerRef = useRef<((handoff: DesktopPhotoToolHandoff) => Promise<void>) | null>(null);
  restoringJobRef.current = restoringJob;
  const verifyOutputRecord = useMemo(
    () => createPersistedExportVerifier(window.filexDesktop?.fingerprintFiles, { timeoutMs: 12_000 }),
    [],
  );

  const profile = DOCUMENT_PROFILES.find((item) => item.id === profileId) ?? DOCUMENT_PROFILES[0];
  const sheet = AVAILABLE_SHEETS.find((item) => item.presetId === sheetId) ?? DEFAULT_SHEET;
  const selectedAsset = assets[selectedIndex] ?? null;
  const selectedAssetPreviewKey = selectedAsset
    ? [selectedAsset.id, selectedAsset.absolutePath ?? selectedAsset.sourceUrl, selectedAsset.size ?? 0, selectedAsset.lastModified ?? 0].join(":")
    : null;
  const selectedPreviewAsset = useMemo<IdPhotoAsset | null>(() => {
    if (!selectedAsset) return null;
    if (!selectedDetailPreview || selectedDetailPreview.assetKey !== selectedAssetPreviewKey) return selectedAsset;
    return withDetailPreview(selectedAsset, selectedDetailPreview);
  }, [selectedAsset, selectedAssetPreviewKey, selectedDetailPreview]);
  const selectedCrop = selectedAsset ? crops[selectedAsset.id] : null;
  const currentPreferences = useMemo<SavedPreferences>(() => ({
    customer,
    jobName,
    profileId,
    sheetId,
    copies,
    format,
    cutGuides,
    editorPath,
    outputDirectoryPath,
  }), [customer, jobName, profileId, sheetId, copies, format, cutGuides, editorPath, outputDirectoryPath]);
  latestPreferencesRef.current = currentPreferences;
  const printSpec = useMemo<PhotoPrintSpec>(() => ({
    widthCm: profile.widthMm / 10,
    heightCm: profile.heightMm / 10,
    dpi: profile.digitalMinDpi ?? 300,
  }), [profile]);
  const layout = useMemo(() => calculateGridLayout(printSpec, sheet), [printSpec, sheet]);

  const repeatedAssets = useMemo<PhotoAsset[]>(() => {
    if (!selectedAsset) return [];
    return Array.from({ length: Math.max(1, copies) }, (_, index) => ({
      ...selectedAsset,
      id: `${selectedAsset.id}-copy-${index + 1}`,
    }));
  }, [copies, selectedAsset]);

  const previewRepeatedAssets = useMemo<PhotoAsset[]>(() => {
    if (!selectedPreviewAsset) return [];
    return repeatedAssets.map((asset) => ({
      ...asset,
      sourceUrl: selectedPreviewAsset.sourceUrl,
      previewUrl: selectedPreviewAsset.previewUrl,
      width: selectedPreviewAsset.width,
      height: selectedPreviewAsset.height,
    }));
  }, [repeatedAssets, selectedPreviewAsset]);

  const repeatedCrops = useMemo(() => new Map(repeatedAssets.map((asset) => [
    asset.id,
    { ...(selectedCrop ?? createDefaultCrop(asset, printSpec)), assetId: asset.id },
  ])), [printSpec, repeatedAssets, selectedCrop]);
  const pages = useMemo(() => paginateAssets(repeatedAssets, layout), [layout, repeatedAssets]);
  const manualReady = Object.values(manualChecks).every(Boolean);
  const technicalFailures = checks.filter((check) => check.status === "fail").length;
  const technicalWarnings = checks.filter((check) => check.status === "warning").length;
  const warningsReady = technicalWarnings === 0 || technicalWarningsAccepted;
  const readyForExport = Boolean(
    selectedAsset
    && manualReady
    && technicalFailures === 0
    && warningsReady
    && checks.length > 0
    && !pendingPhotoshopChange,
  );
  const exportFingerprint = JSON.stringify({
    jobId,
    customer,
    jobName,
    profileId,
    profileRecipe: profile,
    printSpec,
    layoutRecipe: layout,
    selectedAssetId: selectedAsset?.id ?? null,
    selectedAssetPath: selectedAsset?.absolutePath ?? null,
    selectedAssetSize: selectedAsset?.size ?? null,
    selectedAssetLastModified: selectedAsset?.lastModified ?? null,
    selectedSourceSha256: selectedDetailPreview?.assetKey === selectedAssetPreviewKey
      ? selectedDetailPreview.sourceSha256
      : null,
    selectedCrop,
    manualChecks,
    technicalWarningsAccepted,
    technicalChecks: checks.map((check) => [check.id, check.status]),
    pendingPhotoshopChange,
    sheetId,
    copies,
    format,
    cutGuides,
    outputDirectoryPath,
  });
  exportFingerprintRef.current = exportFingerprint;
  const contextualLastExport = lastExport?.contextFingerprint === exportFingerprint ? lastExport : null;
  const contextualPendingExport = pendingExport && pendingIdPhotoExportMatchesContext(pendingExport, {
    contextFingerprint: exportFingerprint,
    format,
    outputDirectoryPath,
    sheetId,
    copies,
  }) ? pendingExport : null;
  const lastExportForSnapshot = selectLastExportForSnapshot({
    lastExport,
    contextualLastExport,
    assetCount: assets.length,
    technicalCheckCount: checks.length,
  });
  pendingExportRef.current = pendingExport;
  const currentLastExport = lastExportVerification === "valid" ? contextualLastExport : null;
  const jobStatus = deriveIdPhotoJobStatus({
    assetCount: assets.length,
    hasCrop: Boolean(selectedCrop),
    manualReady,
    technicalFailures,
    warningsAccepted: technicalWarningsAccepted,
    technicalWarnings,
    pageCount: pages.length,
    hasExport: Boolean(currentLastExport),
  });

  const buildJobSnapshot = (updatedAt = new Date().toISOString()): PersistedIdPhotoJob => ({
    schemaVersion: 1,
    id: jobId,
    createdAt: jobCreatedAt,
    updatedAt,
    customer,
    jobName,
    profileId,
    folderPath,
    selectedAssetId: selectedAsset?.id ?? null,
    assets: [...assets.map((asset) => ({
      id: asset.id,
      fileName: asset.fileName,
      relativePath: asset.relativePath,
      absolutePath: asset.absolutePath,
      originalAbsolutePath: asset.originalAbsolutePath,
      workingCopyPath: asset.workingCopyPath,
      width: asset.width,
      height: asset.height,
      size: asset.size,
      lastModified: asset.lastModified,
      revisions: asset.revisions,
    })), ...unavailableAssets.filter((missing) => !assets.some((asset) => asset.id === missing.id))],
    crops,
    manualChecks,
    technicalWarningsAccepted,
    sheetId,
    copies,
    format,
    cutGuides,
    outputDirectoryPath,
    lastExport: lastExportForSnapshot,
    pendingExport: contextualPendingExport
      ?? (pendingExport && assets.length > 0 && checks.length === 0 ? pendingExport : null),
    status: jobStatus,
  });
  latestJobSnapshotRef.current = restoringJob ? null : buildJobSnapshot();

  const clearExportRecords = useCallback(() => {
    const hadPendingExport = Boolean(pendingExportRef.current);
    pendingExportRef.current = null;
    setLastExport(null);
    setPendingExport(null);
    setLastExportVerification("invalid");
    if (hadPendingExport) {
      setStatus("Le impostazioni sono cambiate: la verifica in attesa è stata annullata. I file già creati non sono marcati come pronti.");
    }
  }, []);

  const resetVerification = useCallback(() => {
    analysisGenerationRef.current += 1;
    setChecks([]);
    setManualChecks({ face: false, expression: false, accessories: false });
    setTechnicalWarningsAccepted(false);
    clearExportRecords();
  }, [clearExportRecords]);

  const clearPendingPhotoshopChange = useCallback(() => {
    pendingPhotoshopChangeRef.current = false;
    setPendingPhotoshopChange(false);
  }, []);

  const markExternalSourceChange = useCallback((message: string) => {
    if (!pendingPhotoshopChangeRef.current) resetVerification();
    pendingPhotoshopChangeRef.current = true;
    setPendingPhotoshopChange(true);
    setStatus(message);
  }, [resetVerification]);

  const persistJobSnapshot = useCallback((snapshot: PersistedIdPhotoJob): PersistedIdPhotoJob[] => {
    try {
      const jobs = saveIdPhotoJob(localStorage, snapshot);
      setJobPersistenceError(null);
      setHasUnsavedJobChanges(false);
      return jobs;
    } catch (error) {
      setJobPersistenceError(persistenceErrorMessage(
        error,
        "FileX non può salvare la commessa nello spazio locale. Libera spazio e riprova prima di chiudere.",
      ));
      setHasUnsavedJobChanges(true);
      throw error;
    }
  }, []);

  const persistPreferencesSnapshot = useCallback((snapshot: SavedPreferences): void => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      setPreferencesPersistenceError(null);
    } catch (error) {
      setPreferencesPersistenceError(persistenceErrorMessage(
        error,
        "Le preferenze generali non possono essere salvate. Libera spazio locale e riprova prima di chiudere.",
      ));
      throw error;
    }
  }, []);

  const restoreJob = useCallback(async (job: PersistedIdPhotoJob) => {
    setBusy(true);
    setRestoringJob(true);
    analysisGenerationRef.current += 1;
    setChecks([]);
    setStatus(`Apertura commessa: ${jobDisplayName(job)}…`);
    try {
      const previousAssets = [...assetsRef.current];
      const restored = await rehydratePersistedAssets(job.assets);
      setJobId(job.id);
      setJobCreatedAt(job.createdAt);
      setCustomer(job.customer);
      setJobName(job.jobName);
      const restoredProfileId = profileIdFromStored(job.profileId);
      const restoredSheetId = AVAILABLE_SHEETS.some((item) => item.presetId === job.sheetId) ? job.sheetId : DEFAULT_SHEET.presetId;
      const restoredCopies = Math.max(1, Math.min(48, job.copies));
      const restoredFormat = job.format === "jpg" || job.format === "pdf" ? job.format : "pdf";
      setProfileId(restoredProfileId);
      setSheetId(restoredSheetId);
      setCopies(restoredCopies);
      setFormat(restoredFormat);
      setCutGuides(job.cutGuides);
      setOutputDirectoryPath(job.outputDirectoryPath);
      setFolderPath(job.folderPath);
      setAssets(restored.assets);
      deferAssetRevocation(previousAssets);
      setUnavailableAssets(restored.unavailable);
      setCrops(Object.fromEntries(restored.assets.map((asset) => [
        asset.id,
        job.crops[asset.id] ?? createDefaultCrop(asset, {
          widthCm: (DOCUMENT_PROFILES.find((item) => item.id === restoredProfileId) ?? DOCUMENT_PROFILES[0]).widthMm / 10,
          heightCm: (DOCUMENT_PROFILES.find((item) => item.id === restoredProfileId) ?? DOCUMENT_PROFILES[0]).heightMm / 10,
          dpi: (DOCUMENT_PROFILES.find((item) => item.id === restoredProfileId) ?? DOCUMENT_PROFILES[0]).digitalMinDpi ?? 300,
        }),
      ])));
      const selectedIndexFromJob = restored.assets.findIndex((asset) => asset.id === job.selectedAssetId);
      setSelectedIndex(selectedIndexFromJob >= 0 ? selectedIndexFromJob : 0);
      const approvalContextValid = selectedIndexFromJob >= 0
        && !restored.changedAssetIds.has(job.selectedAssetId ?? "")
        && restoredProfileId === job.profileId
        && Boolean(job.selectedAssetId && job.crops[job.selectedAssetId]);
      const exportSettingsValid = restoredSheetId === job.sheetId
        && restoredCopies === job.copies
        && restoredFormat === job.format;
      const lastExportContextValid = Boolean(approvalContextValid
        && exportSettingsValid
        && (!job.lastExport || (
          job.lastExport.sheetId === restoredSheetId
          && job.lastExport.copies === restoredCopies
          && job.lastExport.format === restoredFormat
          && job.lastExport.outputDirectoryPath === job.outputDirectoryPath
        )));
      const pendingExportContextValid = Boolean(approvalContextValid
        && exportSettingsValid
        && job.pendingExport
        && job.pendingExport.sheetId === restoredSheetId
        && job.pendingExport.copies === restoredCopies
        && job.pendingExport.format === restoredFormat
        && job.pendingExport.outputDirectoryPath === job.outputDirectoryPath);
      const exportedFilesStatus = job.lastExport && lastExportContextValid
        ? await verifyOutputRecord(job.lastExport)
        : "invalid";
      const keepExportRecord = Boolean(job.lastExport && lastExportContextValid && exportedFilesStatus !== "invalid");
      const keepPendingExport = Boolean(job.pendingExport && pendingExportContextValid && !keepExportRecord);
      setManualChecks(approvalContextValid
        ? job.manualChecks
        : { face: false, expression: false, accessories: false });
      setTechnicalWarningsAccepted(approvalContextValid ? job.technicalWarningsAccepted : false);
      setLastExport(keepExportRecord ? job.lastExport : null);
      setPendingExport(keepPendingExport ? job.pendingExport : null);
      setLastExportVerification(keepExportRecord ? exportedFilesStatus : keepPendingExport ? "unavailable" : "invalid");
      setLastSavedAt(job.updatedAt);
      clearPendingPhotoshopChange();
      setPreviewPageIndex(0);
      setStep(restored.assets.length ? 2 : 1);
      const missingMessage = restored.unavailable.length > 0 ? ` ${restored.unavailable.length} file non è più disponibile.` : "";
      const outputMessage = keepPendingExport
        ? " I file risultano già creati, ma la verifica SHA-256 è in attesa: FileX controllerà gli stessi file senza riesportarli."
        : job.lastExport && exportedFilesStatus === "invalid"
        ? " L’output precedente non esiste più o non coincide con i file verificati: lo stato pronto è stato rimosso."
        : job.lastExport && exportedFilesStatus === "unavailable"
          ? " La verifica dell’output precedente è temporaneamente indisponibile: il record è conservato e FileX riproverà automaticamente."
          : "";
      setStatus(restored.assets.length
        ? approvalContextValid
          ? `Commessa riaperta con ${restored.assets.length} foto.${missingMessage}${outputMessage}`
          : `Commessa riaperta, ma foto, profilo o crop non coincidono più con il contesto approvato. Verifica e approvazioni sono state azzerate.${missingMessage}${outputMessage}`
        : `Commessa riaperta senza foto disponibili.${missingMessage}${outputMessage}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Impossibile riaprire la commessa.");
    } finally {
      setRestoringJob(false);
      setBusy(false);
    }
  }, [clearPendingPhotoshopChange, verifyOutputRecord]);

  useEffect(() => {
    if (initialJob) {
      void restoreJob(initialJob);
    } else {
      setRestoringJob(false);
    }
  }, [initialJob, restoreJob]);

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    const flushBeforeClose = (event: BeforeUnloadEvent) => {
      let flushFailed = false;
      const now = new Date().toISOString();
      const snapshot = latestJobSnapshotRef.current;
      if (snapshot) {
        try {
          setRecentJobs(persistJobSnapshot({ ...snapshot, updatedAt: now }));
          setLastSavedAt(now);
        } catch {
          flushFailed = true;
        }
      }
      try {
        persistPreferencesSnapshot(latestPreferencesRef.current);
      } catch {
        flushFailed = true;
      }
      if (exportInFlightRef.current || flushFailed) {
        setStatus(exportInFlightRef.current
          ? "Chiusura bloccata: attendi il completamento dell’export e della verifica dei file."
          : "Chiusura bloccata: salva la commessa e le preferenze prima di uscire.");
        event.preventDefault();
        event.returnValue = exportInFlightRef.current
          ? "FileX sta completando e verificando l’export."
          : "FileX non ha ancora salvato tutte le modifiche.";
      }
    };
    window.addEventListener("beforeunload", flushBeforeClose);
    return () => window.removeEventListener("beforeunload", flushBeforeClose);
  }, [persistJobSnapshot, persistPreferencesSnapshot]);

  useEffect(() => () => {
    revokeAssets(assetsRef.current);
  }, []);

  useEffect(() => {
    try {
      persistPreferencesSnapshot(currentPreferences);
    } catch {
      setStatus("Le preferenze generali non sono state salvate. Libera spazio locale e usa “Riprova salvataggio”.");
    }
  }, [currentPreferences, persistPreferencesSnapshot]);

  useEffect(() => {
    if (restoringJob) return;
    setHasUnsavedJobChanges(true);
    const timeout = window.setTimeout(() => {
      const now = new Date().toISOString();
      try {
        setRecentJobs(persistJobSnapshot(buildJobSnapshot(now)));
        setLastSavedAt(now);
      } catch (error) {
        setStatus(persistenceErrorMessage(
          error,
          "La commessa è aperta, ma non è stata salvata. Libera spazio locale e usa “Riprova salvataggio”.",
        ));
      }
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [
    assets,
    checks,
    copies,
    crops,
    customer,
    cutGuides,
    folderPath,
    format,
    jobCreatedAt,
    jobId,
    jobName,
    jobStatus,
    lastExport,
    pendingExport,
    manualChecks,
    outputDirectoryPath,
    profileId,
    restoringJob,
    selectedAsset?.id,
    sheetId,
    technicalWarningsAccepted,
    unavailableAssets,
    persistJobSnapshot,
  ]);

  const retryLocalPersistence = useCallback(() => {
    let failed = false;
    const now = new Date().toISOString();
    const snapshot = latestJobSnapshotRef.current;
    if (snapshot) {
      try {
        setRecentJobs(persistJobSnapshot({ ...snapshot, updatedAt: now }));
        setLastSavedAt(now);
      } catch {
        failed = true;
      }
    }
    try {
      persistPreferencesSnapshot(latestPreferencesRef.current);
    } catch {
      failed = true;
    }
    setStatus(failed
      ? "Salvataggio locale ancora non disponibile. Libera spazio o elimina una commessa conclusa, quindi riprova."
      : "Salvataggio locale ripristinato: commessa e preferenze sono al sicuro.");
  }, [persistJobSnapshot, persistPreferencesSnapshot]);

  useEffect(() => {
    if (!window.filexDesktop?.getInstalledEditorCandidates || editorPath) return;
    void window.filexDesktop.getInstalledEditorCandidates().then((candidates) => {
      const photoshop = candidates.find((candidate) => /photoshop/i.test(`${candidate.label} ${candidate.path}`));
      if (photoshop) setEditorPath(photoshop.path);
    }).catch(() => undefined);
  }, [editorPath]);

  const applyPendingVerificationResult = useCallback((
    record: PersistedIdPhotoPendingExport,
    result: PendingOutputVerificationResult,
  ): OutputVerificationStatus => {
    // La verifica automatica e quella esplicita possono condividere la stessa
    // promise single-flight. Il secondo consumer deve ignorare un risultato già
    // applicato, senza annullare la promozione eseguita dal primo.
    if (pendingExportRef.current !== record) return "invalid";
    if (exportFingerprintRef.current !== record.contextFingerprint) {
      pendingExportRef.current = null;
      setPendingExport(null);
      setLastExport(null);
      setLastExportVerification("invalid");
      setStatus("Le impostazioni della commessa sono cambiate: i file già creati non sono più associati all’output corrente.");
      return "invalid";
    }
    if (result.status === "invalid") {
      pendingExportRef.current = null;
      setPendingExport(null);
      setLastExport(null);
      setLastExportVerification("invalid");
      setStatus("I file in attesa risultano mancanti, sostituiti o modificati. Il riferimento non verificato è stato rimosso senza alterare i file presenti.");
      return "invalid";
    }
    if (result.status === "unavailable") {
      setLastExportVerification("unavailable");
      setStatus("File creati, verifica in attesa. FileX conserva i percorsi e riproverà la sola fingerprint SHA-256.");
      return "unavailable";
    }
    pendingExportRef.current = null;
    setPendingExport(null);
    setLastExport(result.exportRecord);
    setLastExportVerification("valid");
    setStatus(`Pronto: ${result.exportRecord.files.join(", ")}. Stampare al 100%, senza adattamento pagina.`);
    return "valid";
  }, []);

  const finalizeRecoveredPendingTransaction = useCallback(async (
    record: PersistedIdPhotoPendingExport,
  ): Promise<void> => {
    if (!record.atomicTransactionId) return;
    const finalize = window.filexDesktop?.finalizeAtomicWriteTransaction;
    if (!finalize) {
      throw new Error("La Suite non può ancora riprendere la transazione di questo export.");
    }
    await finalize(record.atomicTransactionId, {
      directoryPath: record.outputDirectoryPath,
      expectedFileNames: record.files,
    });
  }, []);

  const retryPendingExportVerification = useCallback(async () => {
    const record = pendingExportRef.current;
    if (!record || exportInFlightRef.current) return;
    setBusy(true);
    setStatus("Verifica SHA-256 dei file già creati…");
    try {
      await finalizeRecoveredPendingTransaction(record);
      const result = await verifyOutputRecord.verifyPendingOutput(record);
      applyPendingVerificationResult(record, result);
    } catch {
      setLastExportVerification("unavailable");
      setStatus("Export recuperato ma non ancora confermabile. FileX riproverà senza creare altri file.");
    } finally {
      setBusy(false);
    }
  }, [applyPendingVerificationResult, finalizeRecoveredPendingTransaction, verifyOutputRecord]);

  useEffect(() => {
    if (!contextualPendingExport) return;
    let active = true;
    let retryTimeout: number | undefined;
    const verifyPending = async () => {
      if (exportInFlightRef.current) {
        if (active) retryTimeout = window.setTimeout(() => void verifyPending(), 10_000);
        return;
      }
      try {
        await finalizeRecoveredPendingTransaction(contextualPendingExport);
      } catch {
        if (active) {
          setLastExportVerification("unavailable");
          setStatus("Transazione di export in recupero: nessun nuovo file verrà creato, FileX riproverà automaticamente.");
          retryTimeout = window.setTimeout(() => void verifyPending(), 10_000);
        }
        return;
      }
      const result = await verifyOutputRecord.verifyPendingOutput(contextualPendingExport);
      if (!active) return;
      const status = applyPendingVerificationResult(contextualPendingExport, result);
      if (active && status === "unavailable") {
        retryTimeout = window.setTimeout(() => void verifyPending(), 10_000);
      }
    };
    void verifyPending();
    return () => {
      active = false;
      if (retryTimeout !== undefined) window.clearTimeout(retryTimeout);
    };
  }, [applyPendingVerificationResult, contextualPendingExport, finalizeRecoveredPendingTransaction, verifyOutputRecord]);

  useEffect(() => {
    if (restoringJob
      || !pendingExport
      || contextualPendingExport
      || (assets.length > 0 && checks.length === 0)
    ) return;
    pendingExportRef.current = null;
    setPendingExport(null);
    setLastExportVerification("invalid");
    setStatus("La commessa non coincide più con i file creati in precedenza: la verifica in attesa è stata annullata.");
  }, [assets.length, checks.length, contextualPendingExport, pendingExport, restoringJob]);

  useEffect(() => {
    if (!contextualLastExport) return;
    let active = true;
    let retryTimeout: number | undefined;
    const verifyOutput = async () => {
      if (exportInFlightRef.current) {
        if (active) retryTimeout = window.setTimeout(() => void verifyOutput(), 10_000);
        return;
      }
      const result = await verifyOutputRecord(contextualLastExport);
      if (!active) return;
      if (result === "invalid") {
        setLastExport((value) => value === contextualLastExport ? null : value);
        setLastExportVerification("invalid");
        setStatus("L’output precedente è mancante, sostituito o modificato: la commessa non è più marcata come pronta.");
        return;
      }
      if (result === "unavailable") {
        setLastExportVerification("unavailable");
        setStatus("Verifica output temporaneamente indisponibile: il record è conservato e FileX riproverà.");
      } else {
        setLastExportVerification("valid");
      }
      if (active) retryTimeout = window.setTimeout(() => void verifyOutput(), 10_000);
    };
    void verifyOutput();
    return () => {
      active = false;
      if (retryTimeout !== undefined) window.clearTimeout(retryTimeout);
    };
  }, [contextualLastExport, verifyOutputRecord]);

  useEffect(() => {
    let active = true;
    let ownedDetailUrl: string | null = null;
    setSelectedDetailPreview(null);
    if (!selectedAsset || !selectedAssetPreviewKey) return () => undefined;

    const loadSelectedDetail = async () => {
      try {
        let detail: Omit<SelectedDetailPreview, "assetKey">;
        if (selectedAsset.absolutePath && window.filexDesktop?.getPreview) {
          const [sourceFingerprint] = await window.filexDesktop.fingerprintFiles([selectedAsset.absolutePath]);
          if (!sourceFingerprint) {
            throw new Error("Impronta sorgente non disponibile.");
          }
          const rendered = await window.filexDesktop.getPreview(selectedAsset.absolutePath, {
            maxDimension: ID_PHOTO_DETAIL_PREVIEW_MAX_DIMENSION,
            sourceFileKey: sourceFingerprint
              ? `${sourceFingerprint.size}:${sourceFingerprint.lastModified}:${sourceFingerprint.sha256}`
              : `${selectedAsset.size ?? 0}:${selectedAsset.lastModified ?? 0}`,
          });
          if (!rendered) throw new Error("Anteprima dettaglio non disponibile.");
          detail = {
            url: bytesToObjectUrl(rendered.bytes, rendered.mimeType),
            width: rendered.width,
            height: rendered.height,
            sourceSha256: sourceFingerprint?.sha256 ?? null,
          };
        } else {
          const rendered = await renderBrowserPreview(
            selectedAsset.sourceUrl,
            ID_PHOTO_DETAIL_PREVIEW_MAX_DIMENSION,
          );
          detail = {
            url: URL.createObjectURL(rendered.blob),
            width: rendered.width,
            height: rendered.height,
            sourceSha256: null,
          };
        }

        if (!active) {
          revokeBlobUrls([detail.url]);
          return;
        }
        ownedDetailUrl = detail.url;
        setSelectedDetailPreview({ ...detail, assetKey: selectedAssetPreviewKey });
      } catch {
        if (active) {
          setSelectedDetailPreview(null);
          setStatus("Anteprima dettaglio non disponibile: seleziona di nuovo la foto o reimporta la sorgente.");
        }
      }
    };

    void loadSelectedDetail();
    return () => {
      active = false;
      revokeBlobUrls([ownedDetailUrl]);
    };
  }, [selectedAssetPreviewKey]);

  useEffect(() => {
    if (!selectedAsset) {
      analysisGenerationRef.current += 1;
      setChecks([]);
      return;
    }
    if (!selectedDetailPreview || selectedDetailPreview.assetKey !== selectedAssetPreviewKey) {
      analysisGenerationRef.current += 1;
      setChecks([]);
      return;
    }
    const generation = analysisGenerationRef.current + 1;
    analysisGenerationRef.current = generation;
    setChecks([]);
    let active = true;
    const timeout = window.setTimeout(() => {
      void analyzeImage(selectedPreviewAsset!.previewUrl, selectedPreviewAsset!.width, selectedPreviewAsset!.height, selectedCrop)
        .then((metrics) => {
          if (active && analysisGenerationRef.current === generation) {
            setChecks(evaluateTechnicalChecks(metrics, profile, selectedCrop));
          }
        })
        .catch(() => {
          if (active && analysisGenerationRef.current === generation) setChecks([]);
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [profile, selectedAsset, selectedAssetPreviewKey, selectedCrop, selectedDetailPreview, selectedPreviewAsset]);

  useEffect(() => {
    if (!selectedPreviewAsset || !selectedCrop) {
      setCropPreviewUrl(null);
      return;
    }
    let active = true;
    const timeout = window.setTimeout(() => {
      void renderPhotoCanvas(
        selectedPreviewAsset,
        selectedCrop,
        { ...printSpec, dpi: 140 },
        null,
        { enabled: false, imageUrl: null, position: "bottom-right", scalePct: 20, opacity: 1, marginPct: 4 },
        { blackAndWhiteEnabled: false, fitMode: "cover", autoRotateBySourceOrientation: false, borderEnabled: false, borderWidthPx: 0, borderColor: "#000000" },
      ).then((canvas) => {
        if (active) setCropPreviewUrl(canvas.toDataURL("image/jpeg", 0.9));
      }).catch(() => {
        if (active) setCropPreviewUrl(null);
      });
    }, 80);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [printSpec, selectedCrop, selectedPreviewAsset]);

  useEffect(() => {
    setPreviewPageIndex((current) => Math.max(0, Math.min(current, Math.max(0, pages.length - 1))));
  }, [pages.length]);

  useEffect(() => {
    const previewPage = pages[previewPageIndex];
    if (!previewPage) {
      setPreviewUrl(null);
      return;
    }
    let active = true;
    const timeout = window.setTimeout(() => {
      void renderPageCanvas(previewPage, {
        assetsById: new Map(previewRepeatedAssets.map((asset) => [asset.id, asset])),
        cropsById: repeatedCrops,
        printSpec,
        layout,
        logo: { enabled: false, imageUrl: null, position: "bottom-right", scalePct: 20, opacity: 1, marginPct: 4 },
        adjustments: { blackAndWhiteEnabled: false, fitMode: "cover", autoRotateBySourceOrientation: false, borderEnabled: false, borderWidthPx: 0, borderColor: "#000000" },
        finishing: { cutGuidesEnabled: cutGuides, cutGuideColor: "#777777", cutGuideWidthMm: 0.1 },
        renderDpi: getPreviewRenderDpi(layout, printSpec.dpi, 1000),
      }).then((canvas) => {
        if (active) setPreviewUrl(canvas.toDataURL("image/jpeg", 0.88));
      }).catch(() => {
        if (active) setPreviewUrl(null);
      });
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [cutGuides, layout, pages, previewPageIndex, previewRepeatedAssets, printSpec, repeatedCrops]);

  useEffect(() => {
    const path = selectedAsset?.workingCopyPath;
    if (!path || !window.filexDesktop?.statFiles) return;
    let active = true;
    const poll = async () => {
      const [stat] = await window.filexDesktop!.statFiles([path]).catch(() => []);
      if (!active || !stat) return;
      if (stat.size !== selectedAsset?.size || stat.lastModified !== selectedAsset?.lastModified) {
        markExternalSourceChange("Photoshop ha salvato una nuova versione. Ricaricala per ripetere i controlli.");
      }
    };
    const interval = window.setInterval(() => void poll(), 1600);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [markExternalSourceChange, selectedAsset?.id, selectedAsset?.lastModified, selectedAsset?.size, selectedAsset?.workingCopyPath]);

  const resetCrops = (nextAssets: IdPhotoAsset[], nextSpec = printSpec) => {
    setCrops(Object.fromEntries(nextAssets.map((asset) => [asset.id, createDefaultCrop(asset, nextSpec)])));
  };

  const selectAsset = (index: number) => {
    if (index === selectedIndex) return;
    setSelectedIndex(index);
    setPreviewPageIndex(0);
    clearPendingPhotoshopChange();
    resetVerification();
    setStatus("Foto attiva cambiata: ripeti la verifica prima dell'export.");
  };

  const importDesktopFolder = async () => {
    if (!window.filexDesktop?.openFolder) {
      fileInputRef.current?.click();
      return;
    }
    setBusy(true);
    setStatus("Lettura cartella e generazione anteprime locali…");
    const loaded: IdPhotoAsset[] = [];
    try {
      const folder = await window.filexDesktop.openFolder({ recursive: false, includeExtendedImages: true });
      if (!folder) {
        setStatus("Importazione annullata.");
        return;
      }
      const entries = folder.entries.slice(0, ID_PHOTO_MAX_ASSETS_PER_JOB);
      const overLimitCount = Math.max(0, folder.entries.length - entries.length);
      let unreadableCount = 0;
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        setStatus(`Preparazione foto ${index + 1}/${entries.length}…`);
        try {
          const preview = await window.filexDesktop.getPreview(entry.absolutePath, {
            maxDimension: ID_PHOTO_RAIL_THUMBNAIL_MAX_DIMENSION,
            sourceFileKey: `${entry.size}:${entry.lastModified}`,
          });
          if (!preview) {
            unreadableCount += 1;
            continue;
          }
          const url = bytesToObjectUrl(preview.bytes, preview.mimeType);
          loaded.push({
            id: `photo-${hashString(`${entry.absolutePath}:${entry.size}:${entry.lastModified}`)}`,
            fileName: entry.name,
            absolutePath: entry.absolutePath,
            originalAbsolutePath: entry.absolutePath,
            relativePath: entry.relativePath,
            sourceUrl: url,
            previewUrl: url,
            width: preview.width,
            height: preview.height,
            size: entry.size,
            lastModified: entry.lastModified,
            revisions: [{
              kind: "original",
              absolutePath: entry.absolutePath,
              createdAt: new Date().toISOString(),
              size: entry.size,
              lastModified: entry.lastModified,
            }],
          });
        } catch {
          unreadableCount += 1;
        }
      }
      const previousAssets = [...assetsRef.current];
      setAssets(loaded);
      deferAssetRevocation(previousAssets);
      setUnavailableAssets([]);
      setFolderPath(folder.rootPath);
      resetCrops(loaded);
      setSelectedIndex(0);
      setPreviewPageIndex(0);
      resetVerification();
      const nestedCount = folder.diagnostics?.nestedSupportedDiscardedCount ?? 0;
      const diagnostics = [
        unreadableCount ? `${unreadableCount} non leggibili` : "",
        overLimitCount ? `${overLimitCount} oltre il limite di ${ID_PHOTO_MAX_ASSETS_PER_JOB} ignorate` : "",
        nestedCount ? `${nestedCount} in sottocartelle ignorate` : "",
      ].filter(Boolean).join(" · ");
      setStatus(loaded.length
        ? `${loaded.length} foto disponibili.${diagnostics ? ` ${diagnostics}.` : ""} Seleziona quella da preparare.`
        : `Nessuna immagine compatibile trovata.${diagnostics ? ` ${diagnostics}.` : ""}`);
      if (loaded.length) setStep(2);
    } catch (error) {
      revokeAssets(loaded);
      setStatus(error instanceof Error ? error.message : "Importazione non riuscita.");
    } finally {
      setBusy(false);
    }
  };

  const importBrowserFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const loaded: IdPhotoAsset[] = [];
    try {
      const allCandidates = Array.from(files).filter((file) => file.type.startsWith("image/"));
      const candidates = allCandidates.slice(0, ID_PHOTO_MAX_ASSETS_PER_JOB);
      const overLimitCount = Math.max(0, allCandidates.length - candidates.length);
      let unreadableCount = 0;
      // Il fallback browser decodifica in sequenza: centinaia di FileReader e
      // immagini aperti insieme possono saturare la memoria del renderer.
      for (let index = 0; index < candidates.length; index += 1) {
        setStatus(`Preparazione foto ${index + 1}/${candidates.length}…`);
        try {
          loaded.push(await browserFileToAsset(candidates[index]));
        } catch {
          unreadableCount += 1;
        }
      }
      const previousAssets = [...assetsRef.current];
      setAssets(loaded);
      deferAssetRevocation(previousAssets);
      setUnavailableAssets([]);
      setFolderPath(null);
      resetCrops(loaded);
      setSelectedIndex(0);
      setPreviewPageIndex(0);
      resetVerification();
      const diagnostics = [
        unreadableCount ? `${unreadableCount} file non leggibili` : "",
        overLimitCount ? `${overLimitCount} oltre il limite di ${ID_PHOTO_MAX_ASSETS_PER_JOB} ignorate` : "",
      ].filter(Boolean).join("; ");
      setStatus(`${loaded.length} foto importate${diagnostics ? `; ${diagnostics}` : ""}. Le commesse browser non possono riaprire i file dopo il riavvio.`);
      if (loaded.length) setStep(2);
    } catch (error) {
      revokeAssets(loaded);
      setStatus(error instanceof Error ? error.message : "Importazione non riuscita.");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const updateCrop = (patch: Partial<BatchCropState>) => {
    if (!selectedAsset || !selectedCrop) return;
    setCrops((current) => ({
      ...current,
      [selectedAsset.id]: { ...selectedCrop, ...patch, reviewed: false },
    }));
    resetVerification();
  };

  const setZoom = (zoom: number) => {
    if (!selectedAsset || !selectedCrop) return;
    const base = createDefaultCrop(selectedAsset, printSpec, "cover", false, selectedCrop.rotation);
    const cropWidth = Math.max(0.08, Math.min(1, base.cropWidth / zoom));
    const cropHeight = Math.max(0.08, Math.min(1, base.cropHeight / zoom));
    const centerX = selectedCrop.cropLeft + selectedCrop.cropWidth / 2;
    const centerY = selectedCrop.cropTop + selectedCrop.cropHeight / 2;
    updateCrop({
      cropWidth,
      cropHeight,
      cropLeft: Math.max(0, Math.min(1 - cropWidth, centerX - cropWidth / 2)),
      cropTop: Math.max(0, Math.min(1 - cropHeight, centerY - cropHeight / 2)),
    });
  };

  const rotateCrop = () => {
    if (!selectedAsset || !selectedCrop) return;
    const currentBase = createDefaultCrop(selectedAsset, printSpec, "cover", false, selectedCrop.rotation);
    const currentArea = Math.max(0.0001, selectedCrop.cropWidth * selectedCrop.cropHeight);
    const currentDefaultArea = Math.max(0.0001, currentBase.cropWidth * currentBase.cropHeight);
    const zoom = Math.max(1, Math.sqrt(currentDefaultArea / currentArea));
    const nextRotation = (selectedCrop.rotation + 90) % 360;
    const nextBase = createDefaultCrop(selectedAsset, printSpec, "cover", false, nextRotation);
    const centerX = selectedCrop.cropLeft + selectedCrop.cropWidth / 2;
    const centerY = selectedCrop.cropTop + selectedCrop.cropHeight / 2;
    const nextWidth = nextBase.cropWidth / zoom;
    const nextHeight = nextBase.cropHeight / zoom;
    updateCrop(normalizeCrop({
      ...selectedCrop,
      cropLeft: centerX - nextWidth / 2,
      cropTop: centerY - nextHeight / 2,
      cropWidth: nextWidth,
      cropHeight: nextHeight,
      rotation: nextRotation,
      reviewed: false,
    }));
  };

  const chooseEditor = async () => {
    const path = await window.filexDesktop?.chooseEditorExecutable?.(editorPath ?? undefined);
    if (path) setEditorPath(path);
  };

  const reloadWorkingCopy = async (
    path = selectedAsset?.workingCopyPath,
    archiveRevision = true,
    successMessage = "Nuova revisione Photoshop ricaricata. Crop e controlli sono stati azzerati; l'originale è rimasto invariato.",
  ) => {
    if (!path || !selectedAsset || !window.filexDesktop) return;
    setBusy(true);
    try {
      const [stat] = await window.filexDesktop.statFiles([path]);
      if (!stat) throw new Error("La copia Photoshop non è più disponibile.");
      const preview = await window.filexDesktop.getPreview(path, {
        maxDimension: ID_PHOTO_RAIL_THUMBNAIL_MAX_DIMENSION,
        sourceFileKey: `${stat.size}:${stat.lastModified}`,
      });
      if (!preview) throw new Error("Photoshop non ha prodotto un'immagine leggibile.");
      let revision: PersistedIdPhotoRevision | null = null;
      if (archiveRevision) {
        const snapshot = await window.filexDesktop.createIdPhotoWorkingCopy({ jobId, sourcePath: path });
        const [snapshotStat] = await window.filexDesktop.statFiles([snapshot.workingPath]);
        if (!snapshotStat) throw new Error("FileX non è riuscito a conservare lo snapshot Photoshop.");
        revision = {
          kind: "photoshop",
          absolutePath: snapshot.workingPath,
          createdAt: new Date(snapshot.createdAt).toISOString(),
          size: snapshotStat.size,
          lastModified: snapshotStat.lastModified,
        };
      }
      const url = bytesToObjectUrl(preview.bytes, preview.mimeType);
      const previousAsset = selectedAsset;
      const originalRevisions = selectedAsset.revisions.filter((item) => item.kind === "original").slice(0, 1);
      const photoshopRevisions = [
        ...selectedAsset.revisions.filter((item) => item.kind === "photoshop"),
        ...(revision ? [revision] : []),
      ];
      const nextAsset: IdPhotoAsset = {
        ...selectedAsset,
        absolutePath: path,
        workingCopyPath: path,
        sourceUrl: url,
        previewUrl: url,
        width: preview.width,
        height: preview.height,
        size: stat.size,
        lastModified: stat.lastModified,
        revisions: [...originalRevisions, ...photoshopRevisions],
      };
      setAssets((current) => current.map((asset, index) => index === selectedIndex ? nextAsset : asset));
      setCrops((current) => ({
        ...current,
        [nextAsset.id]: createDefaultCrop(nextAsset, printSpec),
      }));
      resetVerification();
      clearPendingPhotoshopChange();
      deferAssetRevocation([previousAsset]);
      setStatus(successMessage);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Impossibile ricaricare la copia di lavoro.");
    } finally {
      setBusy(false);
    }
  };

  const importPhotoshopSaveAs = async () => {
    if (!selectedAsset || !window.filexDesktop?.chooseImageFile) return;
    const path = await window.filexDesktop.chooseImageFile(selectedAsset.workingCopyPath || selectedAsset.absolutePath);
    if (!path) return;
    if (!/\.(?:jpe?g|png|tiff?)$/i.test(path)) {
      setStatus("Il rientro Photoshop richiede un JPG, PNG o TIFF flattenato. Esporta prima il file da Photoshop.");
      return;
    }
    const originalPath = selectedAsset.originalAbsolutePath?.toLocaleLowerCase();
    if (originalPath && path.toLocaleLowerCase() === originalPath) {
      setStatus("Il file scelto è l'originale. Salva una copia separata da Photoshop e importala qui.");
      return;
    }
    setBusy(true);
    try {
      const managedCopy = await window.filexDesktop.createIdPhotoWorkingCopy({ jobId, sourcePath: path });
      await reloadWorkingCopy(
        managedCopy.workingPath,
        true,
        "Il file “Salva con nome” è stato importato in un'area FileX, versionato e rimandato ai controlli.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Impossibile importare il file salvato da Photoshop.");
    } finally {
      setBusy(false);
    }
  };

  const restorePhotoshopRevision = async (revisionPath: string) => {
    if (!revisionPath || !selectedAsset || !window.filexDesktop) return;
    const revision = selectedAsset.revisions.find((item) => item.kind === "photoshop" && item.absolutePath === revisionPath);
    if (!revision) {
      setStatus("La revisione selezionata non appartiene alla commessa corrente.");
      return;
    }
    setBusy(true);
    try {
      const editableCopy = await window.filexDesktop.createIdPhotoWorkingCopy({ jobId, sourcePath: revision.absolutePath });
      await reloadWorkingCopy(
        editableCopy.workingPath,
        false,
        `Revisione del ${new Date(revision.createdAt).toLocaleString("it-IT")} ripristinata in una nuova copia modificabile. Ripeti i controlli.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Impossibile ripristinare la revisione Photoshop.");
    } finally {
      setBusy(false);
    }
  };

  const openInPhotoshop = async () => {
    if (!selectedAsset?.absolutePath || !window.filexDesktop) {
      setStatus("Il passaggio Photoshop richiede l'app desktop e una foto importata da disco.");
      return;
    }
    setBusy(true);
    try {
      let effectiveEditor = editorPath;
      if (!effectiveEditor) {
        effectiveEditor = await window.filexDesktop.chooseEditorExecutable();
        if (!effectiveEditor) return;
        setEditorPath(effectiveEditor);
      }
      let workingPath = selectedAsset.workingCopyPath;
      if (!workingPath) {
        const sourcePath = selectedAsset.absolutePath;
        const copy = await window.filexDesktop.createIdPhotoWorkingCopy({ jobId, sourcePath });
        workingPath = copy.workingPath;
        const [workingStat] = await window.filexDesktop.statFiles([workingPath]);
        setAssets((current) => current.map((asset, index) => index === selectedIndex ? {
          ...asset,
          absolutePath: workingPath,
          workingCopyPath: workingPath,
          originalAbsolutePath: asset.originalAbsolutePath ?? asset.absolutePath,
          size: workingStat?.size ?? asset.size,
          lastModified: workingStat?.lastModified ?? copy.createdAt,
        } : asset));
        resetVerification();
      }
      const result = await window.filexDesktop.openWithEditor(effectiveEditor, [workingPath]);
      if (!result.ok) throw new Error(result.error || "Photoshop non è stato avviato.");
      clearPendingPhotoshopChange();
      setStatus("Copia gestita da FileX aperta in Photoshop. Salvala: FileX rileverà la modifica senza esporre l'originale.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Passaggio a Photoshop non riuscito.");
    } finally {
      setBusy(false);
    }
  };

  const chooseOutput = async () => {
    const path = await window.filexDesktop?.chooseOutputFolder?.();
    if (path && path !== outputDirectoryPath) {
      setOutputDirectoryPath(path);
      clearExportRecords();
    }
  };

  const startNewJob = (preserveCurrent = true): boolean => {
    try {
      if (preserveCurrent && !restoringJob) {
        const now = new Date().toISOString();
        const savedJobs = persistJobSnapshot(buildJobSnapshot(now));
        setRecentJobs(savedJobs);
        setLastSavedAt(now);
        if (savedJobs.length >= ID_PHOTO_MAX_STORED_JOBS) {
          setStatus(`Hai raggiunto il limite di ${ID_PHOTO_MAX_STORED_JOBS} commesse. Eliminane una conclusa prima di crearne un'altra.`);
          return false;
        }
      }
    } catch (error) {
      setStatus(persistenceErrorMessage(
        error,
        "Nuova commessa bloccata: quella corrente non è stata salvata. Libera spazio locale e riprova.",
      ));
      return false;
    }
    const previousAssets = [...assetsRef.current];
    const now = new Date().toISOString();
    setJobId(createIdPhotoJobId(new Date(now)));
    setJobCreatedAt(now);
    setCustomer("");
    setJobName("Fototessera");
    setProfileId(DOCUMENT_PROFILES[0].id);
    setFolderPath(null);
    setAssets([]);
    deferAssetRevocation(previousAssets);
    setUnavailableAssets([]);
    setCrops({});
    setSelectedIndex(0);
    setChecks([]);
    setManualChecks({ face: false, expression: false, accessories: false });
    setTechnicalWarningsAccepted(false);
    clearExportRecords();
    clearPendingPhotoshopChange();
    setPreviewPageIndex(0);
    setPreviewUrl(null);
    setLastSavedAt(null);
    setHasUnsavedJobChanges(true);
    setStep(1);
    setStatus("Nuova commessa pronta. Inserisci il cliente e importa la cartella.");
    return true;
  };

  photoHandoffHandlerRef.current = async (handoff) => {
    if (handoff.files.length !== 1) {
      setStatus("Foto ID richiede esattamente una sola foto da Archivio Flow.");
      return;
    }
    let restoreWaitAttempts = 0;
    while (restoringJobRef.current && restoreWaitAttempts < 150) {
      await new Promise((resolveWait) => window.setTimeout(resolveWait, 100));
      restoreWaitAttempts += 1;
    }
    if (restoringJobRef.current) {
      setStatus("Foto ricevuta, ma la commessa precedente non ha terminato il ripristino. Riprova da Archivio Flow.");
      return;
    }
    const entry = handoff.files[0];
    setBusy(true);
    setStatus("Preparazione della foto ricevuta da Archivio Flow…");
    let importedAsset: IdPhotoAsset | null = null;
    try {
      const preview = await window.filexDesktop!.getPreview(entry.absolutePath, {
        maxDimension: ID_PHOTO_RAIL_THUMBNAIL_MAX_DIMENSION,
        sourceFileKey: `${entry.size}:${entry.lastModified}`,
      });
      if (!preview) throw new Error("La foto selezionata non è più leggibile sulla scheda.");
      const url = bytesToObjectUrl(preview.bytes, preview.mimeType);
      importedAsset = {
        id: `photo-${hashString(`${entry.absolutePath}:${entry.size}:${entry.lastModified}`)}`,
        fileName: entry.fileName,
        absolutePath: entry.absolutePath,
        originalAbsolutePath: entry.absolutePath,
        relativePath: entry.relativePath,
        sourceUrl: url,
        previewUrl: url,
        width: preview.width,
        height: preview.height,
        size: entry.size,
        lastModified: entry.lastModified,
        revisions: [{
          kind: "original",
          absolutePath: entry.absolutePath,
          createdAt: new Date().toISOString(),
          size: entry.size,
          lastModified: entry.lastModified,
        }],
      };
      if (!startNewJob(true)) {
        revokeAsset(importedAsset);
        return;
      }
      setFolderPath(handoff.sourceRoot);
      setAssets([importedAsset]);
      setUnavailableAssets([]);
      const defaultProfile = DOCUMENT_PROFILES[0];
      setCrops({
        [importedAsset.id]: createDefaultCrop(importedAsset, {
          widthCm: defaultProfile.widthMm / 10,
          heightCm: defaultProfile.heightMm / 10,
          dpi: defaultProfile.digitalMinDpi ?? 300,
        }),
      });
      setSelectedIndex(0);
      setPreviewPageIndex(0);
      resetVerification();
      setStep(2);
      setStatus("Foto ricevuta da Archivio Flow. Non rimuovere la scheda finché non hai concluso o creato una copia Photoshop.");
    } catch (error) {
      if (importedAsset) revokeAsset(importedAsset);
      setStatus(error instanceof Error ? error.message : "Importazione da Archivio Flow non riuscita.");
    } finally {
      setBusy(false);
    }
  };

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
              if (active && handoff) await photoHandoffHandlerRef.current?.(handoff);
            } catch (error) {
              if (active) setStatus(error instanceof Error ? error.message : "Handoff Archivio Flow non valido.");
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
          if (active) setStatus(error instanceof Error ? error.message : "Collegamento Archivio Flow non disponibile.");
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(startTimer);
      removeListener();
    };
  }, []);

  const openRecentJob = async (nextJobId: string) => {
    if (!nextJobId || nextJobId === jobId) return;
    try {
      if (!restoringJob) {
        const now = new Date().toISOString();
        setRecentJobs(persistJobSnapshot(buildJobSnapshot(now)));
        setLastSavedAt(now);
      }
    } catch (error) {
      setStatus(persistenceErrorMessage(
        error,
        "Cambio commessa bloccato: le modifiche correnti non sono state salvate. Libera spazio locale e riprova.",
      ));
      return;
    }
    const job = loadIdPhotoJobs(localStorage).find((item) => item.id === nextJobId);
    if (job) await restoreJob(job);
  };

  const deleteCurrentJob = async () => {
    const confirmed = window.confirm(
      "Rimuovere questa commessa e le copie di lavoro gestite da FileX? Gli originali e gli output esportati non verranno eliminati.",
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      if (window.filexDesktop?.cleanupIdPhotoWorkingFiles) {
        await window.filexDesktop.cleanupIdPhotoWorkingFiles(jobId);
      }
      let remaining: PersistedIdPhotoJob[];
      try {
        remaining = deleteIdPhotoJob(localStorage, jobId);
        setJobPersistenceError(null);
      } catch (error) {
        const message = persistenceErrorMessage(
          error,
          "FileX non può aggiornare l’archivio locale dopo la cancellazione. Libera spazio e riprova.",
        );
        setJobPersistenceError(message);
        throw new IdPhotoStorageError("write-failed", message, { cause: error });
      }
      setRecentJobs(remaining);
      if (remaining[0]) {
        await restoreJob(remaining[0]);
      } else {
        startNewJob(false);
        setStatus("Commessa rimossa. Originali e output esportati sono rimasti intatti.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Impossibile rimuovere in sicurezza la commessa.");
    } finally {
      setBusy(false);
    }
  };

  const cleanupCurrentWorkingCopies = async () => {
    if (!window.filexDesktop?.cleanupIdPhotoWorkingFiles) return;
    const confirmed = window.confirm(
      "Eliminare tutte le copie e revisioni Photoshop gestite di questa commessa? La commessa, gli originali e gli output resteranno disponibili, ma il rollback Photoshop non sarà più possibile.",
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      const records = buildJobSnapshot().assets.map((asset) => {
        const originalRevision = asset.revisions.find((revision) => revision.kind === "original");
        const originalPath = asset.originalAbsolutePath
          ?? originalRevision?.absolutePath
          ?? (asset.workingCopyPath ? undefined : asset.absolutePath);
        return {
          ...asset,
          absolutePath: originalPath,
          workingCopyPath: undefined,
          revisions: originalRevision ? [originalRevision] : [],
        } satisfies PersistedIdPhotoAsset;
      });
      await window.filexDesktop.cleanupIdPhotoWorkingFiles(jobId);
      const previousAssets = [...assetsRef.current];
      const restored = await rehydratePersistedAssets(records);
      setAssets(restored.assets);
      deferAssetRevocation(previousAssets);
      setUnavailableAssets(restored.unavailable);
      const nextSelectedIndex = restored.assets.findIndex((asset) => asset.id === selectedAsset?.id);
      setSelectedIndex(nextSelectedIndex >= 0 ? nextSelectedIndex : 0);
      setCrops(Object.fromEntries(restored.assets.map((asset) => [
        asset.id,
        createDefaultCrop(asset, printSpec),
      ])));
      resetVerification();
      clearPendingPhotoshopChange();
      setPreviewPageIndex(0);
      setStep(restored.assets.length > 0 ? 2 : 1);
      setStatus(restored.assets.length > 0
        ? "Copie e revisioni Photoshop eliminate. La commessa è tornata agli originali e deve essere verificata di nuovo."
        : "Copie Photoshop eliminate. Gli originali non sono più disponibili nei percorsi registrati: ricollega le foto per continuare.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Impossibile pulire le copie Photoshop in sicurezza.");
    } finally {
      setBusy(false);
    }
  };

  const runExport = async () => {
    if (!selectedAsset || pages.length === 0) return;
    if (contextualPendingExport) {
      setStatus("I file sono già stati creati. Usa “Riprova verifica” per completare la sola fingerprint senza riesportare.");
      return;
    }
    if (exportInFlightRef.current) {
      setStatus("Un export è già in corso.");
      return;
    }
    if (!readyForExport) {
      setStatus(technicalFailures > 0
        ? "Export bloccato: correggi i controlli tecnici non superati."
        : "Export bloccato: completa e conferma la verifica dello step 3.");
      setStep(3);
      return;
    }
    exportInFlightRef.current = true;
    setBusy(true);
    try {
      if (window.filexDesktop && !outputDirectoryPath) {
        const selectedOutputPath = await window.filexDesktop.chooseOutputFolder();
        if (!selectedOutputPath) {
          setStatus("Export annullato: scegli una cartella di destinazione per ottenere una conferma di scrittura affidabile.");
          return;
        }
        setOutputDirectoryPath(selectedOutputPath);
        clearExportRecords();
        setStatus("Cartella di destinazione impostata. Premi di nuovo Esporta per creare e verificare i file.");
        return;
      }

      const sourcePath = selectedAsset.absolutePath;
      let liveSourceVersion: { size: number; lastModified: number; sha256: string | null } | null = null;
      if (sourcePath && window.filexDesktop) {
        const [sourceStat] = await window.filexDesktop.fingerprintFiles([sourcePath]).catch(() => []);
        const approvedSourceSha = selectedDetailPreview?.assetKey === selectedAssetPreviewKey
          ? selectedDetailPreview.sourceSha256
          : null;
        if (!sourceStat
          || sourceStat.size !== selectedAsset.size
          || sourceStat.lastModified !== selectedAsset.lastModified
          || (approvedSourceSha && sourceStat.sha256 !== approvedSourceSha)) {
          markExternalSourceChange(selectedAsset.workingCopyPath
            ? "Export bloccato: Photoshop ha modificato la copia. Ricaricala e ripeti i controlli."
            : "Export bloccato: la foto sorgente è cambiata. Reimporta la cartella e ripeti i controlli.");
          setStep(selectedAsset.workingCopyPath ? 2 : 1);
          return;
        }
        liveSourceVersion = {
          size: sourceStat.size,
          lastModified: sourceStat.lastModified,
          sha256: sourceStat.sha256,
        };
      }

      const startedFingerprint = exportFingerprint;
      const validateBeforeSave = async () => {
        if (sourcePath && window.filexDesktop && liveSourceVersion) {
          const [finalStat] = await window.filexDesktop.fingerprintFiles([sourcePath]).catch(() => []);
          if (!finalStat
            || finalStat.size !== liveSourceVersion.size
            || finalStat.lastModified !== liveSourceVersion.lastModified
            || (liveSourceVersion.sha256 && finalStat.sha256 !== liveSourceVersion.sha256)) {
            markExternalSourceChange(selectedAsset.workingCopyPath
              ? "Export annullato prima del salvataggio: Photoshop ha modificato la copia. Ricaricala e ripeti i controlli."
              : "Export annullato prima del salvataggio: la sorgente è cambiata. Reimportala e ripeti i controlli.");
            setStep(selectedAsset.workingCopyPath ? 2 : 1);
            throw new Error("Nessun file è stato pubblicato perché la sorgente è cambiata durante il rendering.");
          }
        }
        if (pendingPhotoshopChangeRef.current || exportFingerprintRef.current !== startedFingerprint) {
          throw new Error("Nessun file è stato pubblicato perché foto o impostazioni sono cambiate durante il rendering.");
        }
      };

      setStatus("Creazione file di stampa…");
      let persistedPendingRecord: PersistedIdPhotoPendingExport | null = null;
      const { files, committedFiles } = await exportBatchWithMetadata({
        pages,
        format,
        outputDirectoryPath,
        fileNamePrefix: safeJobName(customer, jobName),
        quality: 0.96,
        assetsById: new Map(repeatedAssets.map((asset) => [asset.id, asset])),
        cropsById: repeatedCrops,
        printSpec,
        layout,
        logo: { enabled: false, imageUrl: null, position: "bottom-right", scalePct: 20, opacity: 1, marginPct: 4 },
        adjustments: { blackAndWhiteEnabled: false, fitMode: "cover", autoRotateBySourceOrientation: false, borderEnabled: false, borderWidthPx: 0, borderColor: "#000000" },
        finishing: { cutGuidesEnabled: cutGuides, cutGuideColor: "#777777", cutGuideWidthMm: 0.1 },
        validateBeforeSave,
        requireDesktopAtomicTransaction: Boolean(outputDirectoryPath),
        resolveAssetForExport: window.filexDesktop?.getPreview
          ? async (asset, requiredMaxDimension) => {
            if (!asset.absolutePath) return { asset };
            const crop = repeatedCrops.get(asset.id);
            const cropScale = Math.max(0.08, Math.min(crop?.cropWidth ?? 1, crop?.cropHeight ?? 1));
            const sourceMaxDimension = Math.min(12000, Math.max(
              PREVIEW_MAX_DIMENSION,
              Math.ceil((requiredMaxDimension / cropScale) * 1.15),
            ));
            const rendered = await window.filexDesktop!.getPreview(asset.absolutePath, {
              maxDimension: sourceMaxDimension,
              sourceFileKey: liveSourceVersion
                ? `${liveSourceVersion.size}:${liveSourceVersion.lastModified}:${liveSourceVersion.sha256 ?? "no-sha"}`
                : `${asset.size ?? 0}:${asset.lastModified ?? 0}`,
            });
            if (!rendered) throw new Error(`Impossibile leggere la sorgente ad alta risoluzione: ${asset.fileName}`);
            const url = bytesToObjectUrl(rendered.bytes, rendered.mimeType);
            return {
              asset: { ...asset, sourceUrl: url, previewUrl: url, width: rendered.width, height: rendered.height },
              release: () => URL.revokeObjectURL(url),
            };
          }
          : undefined,
        onCommittedFiles: async (nextFiles, commitContext) => {
          if (!outputDirectoryPath) return;
          if (pendingPhotoshopChangeRef.current || exportFingerprintRef.current !== startedFingerprint) {
            throw new Error("La pubblicazione è stata annullata perché foto o impostazioni sono cambiate prima del salvataggio del record.");
          }
          const nextPendingRecord: PersistedIdPhotoPendingExport = {
            completedAt: new Date().toISOString(),
            contextFingerprint: startedFingerprint,
            atomicTransactionId: commitContext.atomicTransactionId,
            format,
            files: nextFiles.map((file) => file.fileName),
            expectedFiles: nextFiles.map((file) => ({
              fileName: file.fileName,
              size: file.size,
              sha256: file.sha256,
            })),
            outputDirectoryPath,
            sheetId,
            copies,
          };
          const pendingSavedAt = new Date().toISOString();
          const pendingSnapshot = recordPendingIdPhotoExport(
            buildJobSnapshot(pendingSavedAt),
            nextPendingRecord,
            pendingSavedAt,
          );

          // Questa scrittura deve riuscire prima del finalize desktop. Se il
          // job store rifiuta il record, la callback rigetta e la shell può
          // ancora ritirare i nomi pubblicati usando staging e journal.
          const savedJobs = persistJobSnapshot(pendingSnapshot);
          pendingExportRef.current = nextPendingRecord;
          persistedPendingRecord = nextPendingRecord;
          setPendingExport(nextPendingRecord);
          setLastExport(null);
          setLastExportVerification("unavailable");
          setRecentJobs(savedJobs);
          setLastSavedAt(pendingSavedAt);
        },
        onProgress: (done, total, label) => setStatus(`Export ${done}/${total}: ${label}`),
      });
      if (!outputDirectoryPath) {
        clearExportRecords();
        setStatus(`Download richiesto al browser (${files.join(", ")}), ma non verificabile. Usa l'app desktop e una cartella di destinazione per registrare un output pronto.`);
        return;
      }
      if (pendingPhotoshopChangeRef.current || exportFingerprintRef.current !== startedFingerprint) {
        clearExportRecords();
        setStatus(`Output completato dalla versione verificata (${files.join(", ")}), ma una nuova modifica è arrivata dopo il commit. Ricarica prima di produrre un altro foglio.`);
        return;
      }
      if (committedFiles.length !== files.length
        || committedFiles.some((file, index) => file.fileName !== files[index])) {
        throw new Error("I file sono stati creati, ma FileX non ha ricevuto le impronte dei byte preparati. Non ripetere l’export e riavvia la Suite.");
      }
      const pendingRecord = persistedPendingRecord;
      if (!pendingRecord) {
        throw new Error("I file sono stati pubblicati senza un record pending persistito; il finalize è stato rifiutato e l'output ritirato.");
      }
      if (!window.filexDesktop?.fingerprintFiles) {
        setStatus(`File creati (${files.join(", ")}), verifica in attesa. Riavvia FileX per verificare gli stessi file senza riesportarli.`);
        return;
      }
      const verificationResult = await verifyOutputRecord.verifyPendingOutput(pendingRecord);
      const verificationStatus = applyPendingVerificationResult(pendingRecord, verificationResult);
      if (verificationStatus === "valid" && verificationResult.status === "valid") {
        const verifiedAt = new Date().toISOString();
        try {
          setRecentJobs(persistJobSnapshot({
            ...buildJobSnapshot(verifiedAt),
            updatedAt: verifiedAt,
            lastExport: verificationResult.exportRecord,
            pendingExport: null,
            status: "ready",
          }));
          setLastSavedAt(verifiedAt);
        } catch {
          // La verifica resta valida in memoria; il banner di persistenza impedisce
          // di chiudere finché il record non viene salvato.
        }
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Export non riuscito.");
    } finally {
      exportInFlightRef.current = false;
      setBusy(false);
    }
  };

  const cropZoom = selectedAsset && selectedCrop
    ? Math.max(1, Math.sqrt(
      Math.max(0.0001, createDefaultCrop(selectedAsset, printSpec, "cover", false, selectedCrop.rotation).cropWidth
        * createDefaultCrop(selectedAsset, printSpec, "cover", false, selectedCrop.rotation).cropHeight)
      / Math.max(0.0001, selectedCrop.cropWidth * selectedCrop.cropHeight),
    ))
    : 1;
  const photoshopRevisions = selectedAsset?.revisions.filter((revision) => revision.kind === "photoshop") ?? [];
  const displayedPosition = selectedCrop ? displayedCropPosition(selectedCrop) : { horizontal: 0.5, vertical: 0.5 };
  const completedSteps = new Set<number>([
    ...(assets.length > 0 ? [1] : []),
    ...(selectedAsset && selectedCrop ? [2] : []),
    ...(readyForExport ? [3] : []),
    ...(readyForExport && pages.length > 0 ? [4] : []),
    ...(currentLastExport ? [5] : []),
  ]);
  const faceGuideHeight = (profile.faceHeightMinPct + profile.faceHeightMaxPct) / 2;
  const eyeLineMm = profile.eyeLineFromBottomMinMm !== undefined && profile.eyeLineFromBottomMaxMm !== undefined
    ? (profile.eyeLineFromBottomMinMm + profile.eyeLineFromBottomMaxMm) / 2
    : profile.heightMm * 0.57;
  const eyeLineTopPct = Math.max(8, Math.min(92, 100 - (eyeLineMm / profile.heightMm) * 100));
  const hasPersistenceError = Boolean(jobPersistenceError || preferencesPersistenceError);
  const saveStateLabel = jobPersistenceError
    ? "Commessa non salvata"
    : preferencesPersistenceError
      ? "Preferenze non salvate"
      : restoringJob
        ? "Ripristino…"
        : hasUnsavedJobChanges
          ? "Modifiche da salvare…"
          : lastSavedAt
            ? "Salvataggio automatico attivo"
            : "Locale";
  const autosaveLabel = jobPersistenceError
    ? `Commessa non salvata${lastSavedAt ? ` · ultima copia sicura alle ${new Date(lastSavedAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}` : ""}`
    : hasUnsavedJobChanges
      ? "Salvataggio della commessa in corso…"
      : lastSavedAt
        ? `Commessa locale salvata alle ${new Date(lastSavedAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`
        : "Commessa locale in preparazione";

  const continueFlow = () => {
    if (step === 1 && !selectedAsset) {
      setStatus("Importa e seleziona una foto prima di continuare.");
      return;
    }
    setStep(Math.min(5, step + 1));
  };

  const openTutorial = () => {
    setTutorialStep(step as TutorialStepId);
    setTutorialOpen(true);
  };

  return (
    <div className={busy ? "app-shell busy" : "app-shell"} aria-busy={busy}>
      <header className="topbar">
        <div className="brand-mark">FX</div>
        <div>
          <strong>FileX ID Photo</strong>
          <span>Studio workflow · elaborazione locale</span>
        </div>
        <div className="job-switcher">
          <button className="topbar-button" onClick={() => startNewJob()} disabled={busy}><BriefcaseBusiness size={15} /> Nuova</button>
          <select aria-label="Apri commessa salvata" value={jobId} onChange={(event) => void openRecentJob(event.target.value)} disabled={busy}>
            {!recentJobs.some((job) => job.id === jobId) ? <option value={jobId}>{customer || jobName || "Commessa attuale"}</option> : null}
            {recentJobs.map((job) => <option key={job.id} value={job.id}>{jobDisplayName(job)}</option>)}
          </select>
          <button className="icon-button danger" title="Rimuovi commessa" aria-label="Rimuovi commessa" onClick={() => void deleteCurrentJob()} disabled={busy}><Trash2 size={15} /></button>
          <span className={`job-status ${jobStatus}`}>{statusLabel(jobStatus)}</span>
        </div>
        <div className="topbar-status"><span className="privacy-dot" /> Locale · nessun upload</div>
        <button className="topbar-button tutorial-button" onClick={openTutorial} aria-expanded={tutorialOpen} aria-controls="id-photo-tutorial"><BookOpen size={16} /> Tutorial</button>
      </header>

      <nav className="stepper" aria-label="Fasi di lavorazione">
        {STEPS.map((item) => {
          const Icon = item.icon;
          const complete = completedSteps.has(item.id);
          return (
            <button key={item.id} className={item.id === step ? "active" : complete ? "complete" : ""} onClick={() => setStep(item.id)} disabled={busy || (item.id > 1 && !selectedAsset)}>
              <span className="step-number">{complete ? <Check size={15} /> : item.id}</span>
              <Icon size={17} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <main className="workspace">
        <aside className="photo-rail">
          <button className="import-card" onClick={importDesktopFolder} disabled={busy}>
            <ImagePlus size={24} />
            <strong>Seleziona cartella</strong>
            <span>JPG, PNG, WebP, TIFF, HEIC</span>
          </button>
          <input ref={fileInputRef} hidden type="file" accept="image/*" multiple onChange={(event) => void importBrowserFiles(event.target.files)} />
          <div className="rail-title"><span>Foto commessa</span><b>{assets.length}</b></div>
          <div className="photo-list">
            {assets.map((asset, index) => (
              <button key={asset.id} className={index === selectedIndex ? "photo-item selected" : "photo-item"} onClick={() => selectAsset(index)} disabled={busy}>
                <img src={asset.previewUrl} alt="" loading="lazy" decoding="async" />
                <span><strong>{asset.fileName}</strong><small>Miniatura locale</small></span>
                {asset.workingCopyPath ? <Palette size={15} aria-label="Copia Photoshop" /> : null}
              </button>
            ))}
            {unavailableAssets.map((asset) => <div key={`missing-${asset.id}`} className="photo-item missing"><XCircle size={16} /><span><strong>{asset.fileName}</strong><small>File non disponibile · riferimento conservato</small></span></div>)}
          </div>
        </aside>

        <section className="stage">
          {hasPersistenceError ? (
            <div className="persistence-alert" role="alert" aria-live="assertive" aria-atomic="true">
              <AlertTriangle size={22} aria-hidden="true" />
              <div>
                <strong>Archivio locale da ripristinare</strong>
                {jobPersistenceError ? <p><b>Commessa:</b> {jobPersistenceError}</p> : null}
                {preferencesPersistenceError ? <p><b>Preferenze:</b> {preferencesPersistenceError}</p> : null}
                <small id="persistence-help">La chiusura resta bloccata finché FileX non riesce a mettere al sicuro tutte le modifiche.</small>
              </div>
              <button type="button" className="secondary" onClick={retryLocalPersistence} disabled={busy || restoringJob} aria-describedby="persistence-help">
                <RefreshCw size={15} aria-hidden="true" /> Riprova salvataggio
              </button>
            </div>
          ) : null}
          {step === 1 ? (
            <div className="panel welcome-panel">
              <div className="eyebrow">STEP 1 · COMMESSA</div>
              <h1>Una commessa chiara, dall’originale alla stampa.</h1>
              <p>Inserisci i riferimenti del lavoro, scegli il documento e importa la cartella. La commessa viene salvata automaticamente e FileX non apre mai l’originale in Photoshop.</p>
              <div className="form-grid">
                <label>Cliente<input value={customer} onChange={(event) => { setCustomer(event.target.value); clearExportRecords(); }} placeholder="Mario Rossi" disabled={busy} /></label>
                <label>Nome commessa<input value={jobName} onChange={(event) => { setJobName(event.target.value); clearExportRecords(); }} placeholder="CIE agosto 2026" disabled={busy} /></label>
                <label className="full">Profilo documento
                  <select value={profileId} disabled={busy} onChange={(event) => {
                    const nextId = event.target.value;
                    setProfileId(nextId);
                    const nextProfile = DOCUMENT_PROFILES.find((item) => item.id === nextId) ?? DOCUMENT_PROFILES[0];
                    resetCrops(assets, { widthCm: nextProfile.widthMm / 10, heightCm: nextProfile.heightMm / 10, dpi: nextProfile.digitalMinDpi ?? 300 });
                    resetVerification();
                    setPreviewPageIndex(0);
                  }}>
                    {DOCUMENT_PROFILES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="profile-note">
                <ShieldCheck size={20} />
                <div><strong>{profile.widthMm}×{profile.heightMm} mm · profilo {profile.version}</strong><p>{profile.note}</p><small>Fonte verificata il {new Date(`${profile.sourceCheckedAt}T00:00:00`).toLocaleDateString("it-IT")} · riesame previsto entro il {new Date(`${profile.nextReviewAt}T00:00:00`).toLocaleDateString("it-IT")}</small>
                  {profile.sourceUrl ? <a href={profile.sourceUrl} target="_blank" rel="noreferrer">Apri fonte <ExternalLink size={13} /></a> : null}
                </div>
              </div>
              <div className={`autosave-note${jobPersistenceError ? " error" : hasUnsavedJobChanges ? " pending" : ""}`}>
                {jobPersistenceError ? <AlertTriangle size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
                <span>{autosaveLabel}</span>
                {folderPath ? <small>{folderPath}</small> : null}
              </div>
              <button className="primary large" onClick={importDesktopFolder} disabled={busy}><FolderOpen size={19} /> Seleziona la cartella foto</button>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="editor-layout">
              <div className="panel canvas-panel">
                <div className="panel-heading"><div><span>STEP 2 · PREPARA</span><h2>Inquadratura e copia di lavoro</h2></div><span className="profile-chip">{profile.widthMm}×{profile.heightMm} mm</span></div>
                {selectedAsset && selectedCrop ? (
                  <div className="crop-stage" style={{ aspectRatio: `${profile.widthMm}/${profile.heightMm}` }}>
                    <img
                      src={cropPreviewUrl ?? selectedPreviewAsset?.previewUrl ?? selectedAsset.previewUrl}
                      alt="Anteprima da ritagliare"
                    />
                    <div className="face-oval" style={{ height: `${faceGuideHeight}%`, top: `${(100 - faceGuideHeight) / 2}%` }} />
                    <div className="eye-line" style={{ top: `${eyeLineTopPct}%` }}><span>{profile.eyeLineFromBottomMinMm !== undefined ? `${profile.eyeLineFromBottomMinMm}–${profile.eyeLineFromBottomMaxMm} mm` : "linea occhi"}</span></div>
                    <div className="crop-thirds"><i /><i /><b /><b /></div>
                  </div>
                ) : <div className="empty-stage"><ScanFace size={50} /><strong>Nessuna foto selezionata</strong><span>Importa una cartella dalla colonna a sinistra.</span></div>}
                <p className="canvas-caption">Le guide sono un supporto visivo: non rappresentano un rilevamento automatico del volto.</p>
              </div>
              <div className="panel controls-panel">
                <div className="control-group"><label>Zoom <b>{cropZoom.toFixed(2)}×</b></label><input type="range" min="1" max="2.4" step="0.01" value={cropZoom} onChange={(event) => setZoom(Number(event.target.value))} disabled={!selectedCrop || busy} /></div>
                <div className="control-group"><label>Posizione orizzontale</label><input type="range" min="0" max="1" step="0.005" value={displayedPosition.horizontal} onChange={(event) => selectedCrop && updateCrop(moveCropInDisplayedAxes(selectedCrop, "horizontal", Number(event.target.value)))} disabled={!selectedCrop || busy} /></div>
                <div className="control-group"><label>Posizione verticale</label><input type="range" min="0" max="1" step="0.005" value={displayedPosition.vertical} onChange={(event) => selectedCrop && updateCrop(moveCropInDisplayedAxes(selectedCrop, "vertical", Number(event.target.value)))} disabled={!selectedCrop || busy} /></div>
                <div className="button-row"><button className="secondary" onClick={() => selectedAsset && updateCrop(createDefaultCrop(selectedAsset, printSpec))} disabled={!selectedAsset || busy}><RefreshCw size={16} /> Reimposta</button><button className="secondary" onClick={rotateCrop} disabled={!selectedCrop || busy}>Ruota 90°</button></div>
                <div className="photoshop-card">
                  <div><Palette size={20} /><strong>Passaggio Photoshop</strong></div>
                  <p>FileX crea una copia in un’area gestita e apre soltanto quella. Per questo profilo sono ammessi interventi <b>{profile.editingPolicy === "studio-controlled" ? "controllati dallo studio" : "solo tecnici, senza alterare il soggetto"}</b>.</p>
                  <button className="gold" onClick={openInPhotoshop} disabled={!selectedAsset?.absolutePath || busy}><ExternalLink size={16} /> Apri copia in Photoshop</button>
                  {selectedAsset?.workingCopyPath || photoshopRevisions.length > 0 ? <>
                    {selectedAsset?.workingCopyPath ? <>
                      <button className={pendingPhotoshopChange ? "secondary attention" : "secondary"} onClick={() => reloadWorkingCopy()} disabled={busy}><RefreshCw size={16} /> {pendingPhotoshopChange ? "Modifica rilevata · Ricarica" : "Ricarica da Photoshop"}</button>
                      <button className="secondary" onClick={() => void importPhotoshopSaveAs()} disabled={busy}><Upload size={16} /> Importa “Salva con nome”</button>
                    </> : <small>La copia corrente non è utilizzabile: FileX ha recuperato una revisione valida. Aprila in Photoshop per creare una nuova copia modificabile.</small>}
                    <small>{photoshopRevisions.length} revisioni Photoshop conservate</small>
                    {photoshopRevisions.length > 0 ? <select aria-label="Ripristina revisione Photoshop" defaultValue="" onChange={(event) => { const path = event.target.value; event.target.value = ""; if (path) void restorePhotoshopRevision(path); }} disabled={busy}>
                      <option value="">Ripristina una revisione…</option>
                      {[...photoshopRevisions].reverse().map((revision) => <option key={`${revision.absolutePath}-${revision.createdAt}`} value={revision.absolutePath}>{new Date(revision.createdAt).toLocaleString("it-IT")}</option>)}
                    </select> : null}
                  </> : null}
                  {assets.some((asset) => asset.workingCopyPath || asset.revisions.some((revision) => revision.kind === "photoshop"))
                    ? <button className="secondary" onClick={() => void cleanupCurrentWorkingCopies()} disabled={busy}><Trash2 size={16} /> Pulisci copie Photoshop</button>
                    : null}
                  <button className="link-button" onClick={chooseEditor} disabled={busy}>Configura editor{editorPath ? " · collegato" : ""}</button>
                </div>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="panel verify-panel">
              <div className="eyebrow">STEP 3 · VERIFICA</div>
              <h1>Controlli tecnici e conferma dell’operatore</h1>
              <p>I valori sono calcolati localmente e sono indicatori, non una promessa di accettazione del documento.</p>
              {selectedAsset ? <div className="verification-photo"><img src={cropPreviewUrl ?? selectedPreviewAsset?.previewUrl ?? selectedAsset.previewUrl} alt="Foto attiva sottoposta a verifica" decoding="async" /><div><strong>{selectedAsset.fileName}</strong><span>{profile.widthMm}×{profile.heightMm} mm · ritaglio e rotazione correnti</span></div></div> : null}
              <div className="checks-grid">
                {checks.map((check) => <div key={check.id} className={`check-card ${check.status}`}><StatusIcon status={check.status} /><div><strong>{check.label}</strong><b>{check.value}</b><p>{check.message}</p></div></div>)}
                {!checks.length ? <div className="empty-checks">{selectedAsset ? "Analisi del ritaglio in corso…" : "Importa una foto per eseguire i controlli."}</div> : null}
              </div>
              <h3>Conferma visiva obbligatoria</h3>
              <div className="manual-list">
                <label><input type="checkbox" checked={manualChecks.face} disabled={busy || checks.length === 0 || pendingPhotoshopChange} onChange={(event) => { setManualChecks((value) => ({ ...value, face: event.target.checked })); clearExportRecords(); }} /><span>Volto centrato, dimensione e linea occhi coerenti con il profilo</span></label>
                <label><input type="checkbox" checked={manualChecks.expression} disabled={busy || checks.length === 0 || pendingPhotoshopChange} onChange={(event) => { setManualChecks((value) => ({ ...value, expression: event.target.checked })); clearExportRecords(); }} /><span>Espressione neutra, bocca chiusa, occhi visibili</span></label>
                <label><input type="checkbox" checked={manualChecks.accessories} disabled={busy || checks.length === 0 || pendingPhotoshopChange} onChange={(event) => { setManualChecks((value) => ({ ...value, accessories: event.target.checked })); clearExportRecords(); }} /><span>Sfondo, ombre, riflessi e accessori verificati dall’operatore</span></label>
                {technicalWarnings > 0 ? <label className="warning-ack"><input type="checkbox" checked={technicalWarningsAccepted} disabled={busy || pendingPhotoshopChange} onChange={(event) => { setTechnicalWarningsAccepted(event.target.checked); clearExportRecords(); }} /><span>Ho esaminato i {technicalWarnings} avvisi tecnici e confermo il giudizio professionale sull’immagine</span></label> : null}
              </div>
              <div className={readyForExport ? "readiness ready" : "readiness warning"}><ShieldCheck size={22} /><div><strong>{readyForExport ? "Foto approvata per l’impaginazione" : "Revisione ancora necessaria"}</strong><span>{!selectedAsset ? "Importa una foto per iniziare la verifica." : pendingPhotoshopChange ? "Ricarica la modifica Photoshop prima di approvare." : checks.length === 0 ? "Analisi tecnica del ritaglio in corso." : technicalFailures ? `${technicalFailures} controllo/i tecnico/i non superato/i bloccano l’export.` : technicalWarnings > 0 && !technicalWarningsAccepted ? "Esamina e conferma gli avvisi tecnici." : "Completa le conferme visive dell’operatore."}</span></div></div>
              <div className="verification-source"><span>Profilo {profile.version} · fonte verificata {new Date(`${profile.sourceCheckedAt}T00:00:00`).toLocaleDateString("it-IT")}</span>{profile.sourceUrl ? <a href={profile.sourceUrl} target="_blank" rel="noreferrer">Consulta la fonte <ExternalLink size={12} /></a> : null}</div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="editor-layout print-layout">
              <div className="panel canvas-panel">
                <div className="panel-heading"><div><span>STEP 4 · IMPAGINA</span><h2>Anteprima foglio fisico</h2></div><span className="profile-chip">{layout.photosPerSheet} copie/foglio</span></div>
                <div className="sheet-preview">{previewUrl ? <img src={previewUrl} alt={`Anteprima del foglio ${previewPageIndex + 1}`} /> : <div className="empty-stage">Nessuna anteprima</div>}</div>
                {pages.length > 1 ? <div className="page-navigation"><button className="secondary" onClick={() => setPreviewPageIndex((value) => Math.max(0, value - 1))} disabled={previewPageIndex === 0}><ChevronLeft size={15} /> Precedente</button><span>Foglio {previewPageIndex + 1} di {pages.length}</span><button className="secondary" onClick={() => setPreviewPageIndex((value) => Math.min(pages.length - 1, value + 1))} disabled={previewPageIndex >= pages.length - 1}>Successivo <ChevronRight size={15} /></button></div> : null}
                <p className="canvas-caption">Anteprima ridotta. L’export usa le dimensioni fisiche e i DPI del profilo.</p>
              </div>
              <div className="panel controls-panel">
                <label>Formato carta<select value={sheetId} disabled={busy} onChange={(event) => { setSheetId(event.target.value); setPreviewPageIndex(0); clearExportRecords(); }}>{AVAILABLE_SHEETS.map((item) => <option key={item.presetId} value={item.presetId}>{item.label}</option>)}</select></label>
                <label>Numero copie<input type="number" min="1" max="48" value={copies} disabled={busy} onChange={(event) => { setCopies(Math.max(1, Math.min(48, Number(event.target.value) || 1))); setPreviewPageIndex(0); clearExportRecords(); }} /></label>
                <label className="toggle"><input type="checkbox" checked={cutGuides} disabled={busy} onChange={(event) => { setCutGuides(event.target.checked); clearExportRecords(); }} /><span>Indicatori di taglio</span></label>
                <div className="layout-stats"><div><span>Foglio</span><b>{layout.sheetWidthCm}×{layout.sheetHeightCm} cm</b></div><div><span>Foto</span><b>{profile.widthMm}×{profile.heightMm} mm</b></div><div><span>Pagine</span><b>{pages.length}</b></div><div><span>Risoluzione</span><b>{printSpec.dpi} dpi</b></div></div>
              </div>
            </div>
          ) : null}

          {step === 5 ? (
            <div className="editor-layout export-layout">
              <div className="panel export-summary">
                <div className="eyebrow">STEP 5 · ESPORTA E STAMPA</div>
                <h1>{contextualPendingExport ? "File creati, verifica in attesa" : "File pronto per il driver o il laboratorio"}</h1>
                <div className="summary-sheet">{previewUrl ? <img src={previewUrl} alt="Foglio pronto" /> : null}</div>
                <div className="print-warning"><AlertTriangle size={20} /><span>Nel driver di stampa usa scala <b>100%</b> e disattiva “Adatta alla pagina”. La stampa diretta verrà abilitata solo dopo la calibrazione fisica delle stampanti supportate.</span></div>
              </div>
              <div className="panel controls-panel export-controls">
                <label>Formato export<select value={format} disabled={busy} onChange={(event) => { setFormat(event.target.value as ExportFormat); clearExportRecords(); }}><option value="pdf">PDF multipagina (consigliato)</option><option value="jpg">JPG con DPI incorporati</option></select></label>
                <div className="output-box"><FolderOutput size={20} /><div><strong>Cartella di destinazione</strong><span>{outputDirectoryPath || "Download del browser"}</span></div><button className="secondary" onClick={chooseOutput} disabled={!window.filexDesktop || busy}>Scegli</button></div>
                <div className="export-recap"><p><span>Commessa</span><b>{safeJobName(customer, jobName)}</b></p><p><span>Profilo</span><b>{profile.label}</b></p><p><span>Output</span><b>{copies} copie · {pages.length} fogli {sheet.label}</b></p></div>
                {!readyForExport ? <div className="inline-warning"><AlertTriangle size={17} /> {technicalFailures > 0 ? `${technicalFailures} controllo/i tecnico/i bloccano l'export.` : "Completa e conferma i controlli dello step 3 prima di esportare."}</div> : null}
                {currentLastExport ? <div className="last-export"><CheckCircle2 size={18} /><div><strong>Ultimo output verificato</strong><span>{new Date(currentLastExport.completedAt).toLocaleString("it-IT")} · {currentLastExport.files.join(", ")}</span></div></div> : null}
                {contextualLastExport && lastExportVerification === "unavailable" ? <div className="inline-warning"><AlertTriangle size={17} /> Output registrato, ma verifica temporaneamente indisponibile. FileX conserva il record e riprova automaticamente.</div> : null}
                {contextualPendingExport ? <div className="inline-warning"><AlertTriangle size={17} /> <span>File già pubblicati: {contextualPendingExport.files.join(", ")}. Non sono ancora marcati come pronti e FileX non li riesporterà.</span></div> : null}
                {contextualPendingExport
                  ? <button className="primary large" onClick={retryPendingExportVerification} disabled={busy}><RefreshCw size={19} /> {busy ? "Verifica…" : "Riprova verifica"}</button>
                  : <button className="primary large" onClick={runExport} disabled={!readyForExport || busy}><Save size={19} /> {busy ? "Elaborazione…" : `Esporta ${format.toUpperCase()}`}</button>}
              </div>
            </div>
          ) : null}
        </section>
      </main>

      <footer className="statusbar" role="status" aria-live="polite"><span className={`status-pulse${hasPersistenceError ? " error" : busy ? " busy" : ""}`} /><span className="status-message">{status}</span><span className={`save-state${hasPersistenceError ? " error" : hasUnsavedJobChanges ? " pending" : ""}`}>{saveStateLabel}</span><button onClick={continueFlow} disabled={step === 5 || busy}>{step === 4 ? "Vai all’export" : "Continua"} <ChevronRight size={16} /></button></footer>
      <button className="tutorial-launcher" onClick={openTutorial} aria-label={`Apri tutorial dello step ${step}`} aria-expanded={tutorialOpen} aria-controls="id-photo-tutorial"><BookOpen size={19} /><span><b>Tutorial</b><small>Step {step}</small></span></button>
      {tutorialOpen ? <TutorialDrawer currentStep={step} selectedStep={tutorialStep} onSelectStep={setTutorialStep} onClose={() => setTutorialOpen(false)} /> : null}
    </div>
  );
}
