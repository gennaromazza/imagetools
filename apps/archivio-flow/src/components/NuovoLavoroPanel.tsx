import { suggestImportJobs, type ImportSelection } from "../importSelection";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SdCard, SdPreview, SafeToFormatResult, StudioFlowStatus, ArchivioFlowSettings, ImportRequest, ImportResult, Job, ImportProgressSnapshot, FilterPreviewData } from "../types";
import {
  browseArchivioFolder,
  cancelArchivioImport,
  checkArchivioSafeToFormat,
  getArchivioFilterPreview,
  getArchivioImportProgress,
  getArchivioJobs,
  getArchivioFolders,
  getArchivioJobSubfolders,
  getArchivioSdCards,
  ejectArchivioSdCard,
  getArchivioSdPreview,
  getArchivioSettings,
  getArchivioStudioFlowStatus,
  openArchivioFolder,
  saveArchivioSettings,
  reconcileArchivioIndex,
  resumeArchivioImport,
  syncArchivioDriveRegistry,
  startArchivioImport,
  notifyBackupGuardProject,
  getArchivioStartAtLogin,
  setArchivioStartAtLogin,
} from "../archivioDesktopApi";
import { DesktopPreviewImage } from "./DesktopPreviewImage";
import { FilterRangePickerModal } from "./FilterRangePickerModal";
import { DateFilterPicker } from "./DateFilterPicker";
import { buildPreviewSourceKey, isPreviewableMedia } from "../previewPolicy";
import { findSimilarFolderNames } from "../folderSuggestions";

interface Props {
  onImportDone: (result: ImportResult) => void;
  activeView?: "nuovo" | "impostazioni";
  isVisible?: boolean;
  existingJobImportId?: string | null;
  initialSdPath?: string | null;
  initialDateFilter?: string | null;
  initialSelection?: ImportSelection | null;
  onEditSelection?: () => void;
  onImportingChange?: (busy: boolean) => void;
  sourceRevision?: number;
  selectionRevision?: number;
  newJobRevision?: number;
}

type CategoryLayout = "year-category" | "category-year" | "category-only" | "custom";

interface ArchiveHierarchySettings {
  yearLevel: number | null;
  categoryLevel: number | null;
  jobLevel: number;
}

const DEFAULT_ARCHIVE_HIERARCHY: ArchiveHierarchySettings = {
  yearLevel: 1,
  categoryLevel: 2,
  jobLevel: 3,
};

function normalizeHierarchyLevel(rawValue: unknown, fallback: number | null): number | null {
  if (rawValue === undefined) return fallback;
  if (rawValue === null || rawValue === "") return null;
  const parsed = Number.parseInt(String(rawValue), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed <= 0) return null;
  return Math.min(8, Math.max(1, parsed));
}

function normalizeHierarchyConfig(raw?: Partial<ArchiveHierarchySettings>): ArchiveHierarchySettings {
  const normalized: ArchiveHierarchySettings = {
    yearLevel: normalizeHierarchyLevel(raw?.yearLevel, DEFAULT_ARCHIVE_HIERARCHY.yearLevel),
    categoryLevel: normalizeHierarchyLevel(raw?.categoryLevel, DEFAULT_ARCHIVE_HIERARCHY.categoryLevel),
    jobLevel: normalizeHierarchyLevel(raw?.jobLevel, DEFAULT_ARCHIVE_HIERARCHY.jobLevel) ?? DEFAULT_ARCHIVE_HIERARCHY.jobLevel,
  };

  if (normalized.yearLevel !== null && normalized.yearLevel >= normalized.jobLevel) {
    normalized.yearLevel = null;
  }
  if (normalized.categoryLevel !== null && normalized.categoryLevel >= normalized.jobLevel) {
    normalized.categoryLevel = null;
  }

  return normalized;
}

interface ImportedRangeRecord {
  startMs: number;
  endMs: number;
  label: string;
  importedAtIso: string;
}
type ImportValidationField =
  | "sdPath"
  | "showSelectionFilters"
  | "filters"
  | "rangeOverlap"
  | "nomeLavoro"
  | "existingJobId"
  | "dataLavoro"
  | "autore"
  | "destinazione";

interface ImportValidationIssue {
  field: ImportValidationField;
  message: string;
}

interface ImportUiPreferences {
  autore: string;
  sottoCartella: string;
  rinominaFile: boolean;
  generaJpg: boolean;
  openFolderOnFinish: boolean;
  desktopNotifyOnFinish: boolean;
  soundNotifyOnFinish: boolean;
}

const IMPORT_UI_PREFERENCES_KEY = "filex.archivio-flow.import-ui-preferences";
const SETTINGS_OPEN_SECTION_KEY = "filex.archivio-flow.settings-open-section";

function readImportUiPreferences(): ImportUiPreferences {
  const fallback: ImportUiPreferences = {
    autore: "", sottoCartella: "", rinominaFile: true, generaJpg: false,
    openFolderOnFinish: true, desktopNotifyOnFinish: true, soundNotifyOnFinish: true,
  };
  try {
    const stored = JSON.parse(window.localStorage.getItem(IMPORT_UI_PREFERENCES_KEY) ?? "{}") as Partial<ImportUiPreferences>;
    return { ...fallback, ...stored };
  } catch {
    return fallback;
  }
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "—";
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB";
  return (bytes / 1e6).toFixed(0) + " MB";
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildFolderPreview(nomeLavoro: string, dataLavoro: string): string {
  if (!nomeLavoro.trim() || !dataLavoro) return "—";
  const [y, m, d] = dataLavoro.split("-");
  const dmy = `${d}-${m}-${y}`;
  const safeName = nomeLavoro.trim().replace(/[<>:"/\\|?*]/g, "");
  return `${dataLavoro} - ${safeName} - ${dmy}`;
}

function buildSafeFolderSegment(value: string): string {
  return value.split(/[\\/]+/).map((segment) => segment.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/\.+/g, ".").replace(/^\.+|\.+$/g, "")).filter(Boolean).join("\\");
}

function formatDurationSeconds(seconds: number): string {
  const sec = Math.max(0, Math.floor(seconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatItemsPerSecond(value: number | null | undefined): string {
  if (value === null || value === undefined || value <= 0) return "calcolo...";
  if (value >= 10) return `${value.toFixed(0)} file/s`;
  if (value >= 1) return `${value.toFixed(1)} file/s`;
  return `${value.toFixed(2)} file/s`;
}

function formatTransferRate(bytesPerSec: number | null | undefined): string {
  if (bytesPerSec === null || bytesPerSec === undefined || bytesPerSec <= 0) return "calcolo...";
  if (bytesPerSec >= 1024 * 1024 * 1024) return `${(bytesPerSec / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${bytesPerSec.toFixed(0)} B/s`;
}

async function openFolderInExplorer(folderPath: string) {
  if (!folderPath) return;
  try {
    await openArchivioFolder(folderPath);
  } catch {
    /* ignore */
  }
}

async function openImportDestinationFolders(result: ImportResult) {
  const folders = [
    result.cartellaFotoFinale || result.job.percorsoCartella,
    result.videoFiles > 0 ? result.cartellaVideoFinale : "",
  ].filter((folder, index, all): folder is string => Boolean(folder) && all.indexOf(folder) === index);
  for (const folder of folders) {
    await openFolderInExplorer(folder);
  }
}

function playCompletionTone() {
  try {
    const audioCtx = new window.AudioContext();
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
    oscillator.frequency.linearRampToValueAtTime(1320, audioCtx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, audioCtx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.4);
    oscillator.connect(gain);
    gain.connect(audioCtx.destination);
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.42);
    window.setTimeout(() => {
      void audioCtx.close();
    }, 520);
  } catch {
    /* ignore audio errors */
  }
}

async function showCompletionDesktopNotification(title: string, body: string) {
  if (!("Notification" in window)) return;
  try {
    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    if (permission !== "granted") return;
    new Notification(title, {
      body,
      icon: "/favicon.ico",
    });
  } catch {
    /* ignore notification errors */
  }
}

export function NuovoLavoroPanel({ onImportDone, activeView = "nuovo", isVisible = true, existingJobImportId = null, initialSdPath = null, initialDateFilter = null, initialSelection = null, onEditSelection, sourceRevision = 0, selectionRevision = 0, newJobRevision = 0, onImportingChange }: Props) {
  const initialImportPreferencesRef = useRef(readImportUiPreferences());
  // ── SD detection ────────────────────────────────────────────────────────────
  const [sdCards, setSdCards] = useState<SdCard[]>([]);
  const [sdPath, setSdPath] = useState(() => initialSdPath ?? "");
  const [sdPreview, setSdPreview] = useState<SdPreview | null>(null);
  const [loadingSd, setLoadingSd] = useState(false);
  const [refreshingSd, setRefreshingSd] = useState(false);
  const [ejectingSd, setEjectingSd] = useState(false);
  const [sdFeedback, setSdFeedback] = useState<string | null>(null);
  const [safeCheck, setSafeCheck] = useState<SafeToFormatResult | null>(null);
  const [checkingSafe, setCheckingSafe] = useState(false);
  const [safeCheckError, setSafeCheckError] = useState<string | null>(null);
  const [studioFlowStatus, setStudioFlowStatus] = useState<StudioFlowStatus | null>(null);
  const [studioFlowBusy, setStudioFlowBusy] = useState(false);
  const [studioFlowError, setStudioFlowError] = useState<string | null>(null);
  const [startupAtLogin, setStartupAtLogin] = useState<boolean | null>(null);
  const [savingStartupAtLogin, setSavingStartupAtLogin] = useState(false);
  const [openSettingsSection, setOpenSettingsSection] = useState<"studioflow" | "categorie" | null>(() => {
    const stored = window.localStorage.getItem(SETTINGS_OPEN_SECTION_KEY);
    return stored === "studioflow" || stored === "categorie" ? stored : null;
  });
  const [explicitFiles, setExplicitFiles] = useState<string[] | null>(null);
  const [showSelectionFilters, setShowSelectionFilters] = useState(Boolean(initialDateFilter));
  const [fileNameIncludesFilter, setFileNameIncludesFilter] = useState("");
  const [mtimeFromFilter, setMtimeFromFilter] = useState(() => initialDateFilter ? `${initialDateFilter}T00:00` : "");
  const [mtimeToFilter, setMtimeToFilter] = useState(() => initialDateFilter ? `${initialDateFilter}T23:59:59.999` : "");
  const [filterPreview, setFilterPreview] = useState<FilterPreviewData | null>(null);
  const [loadingFilterPreview, setLoadingFilterPreview] = useState(false);
  const [filterPreviewError, setFilterPreviewError] = useState<string | null>(null);
  const [previewRangeStartMs, setPreviewRangeStartMs] = useState<number | null>(null);
  const [previewRangeEndMs, setPreviewRangeEndMs] = useState<number | null>(null);
  const [showVisualRangePicker, setShowVisualRangePicker] = useState(false);
  const [visualPickerTruncated, setVisualPickerTruncated] = useState(false);
  const [visualPickerSamples, setVisualPickerSamples] = useState<FilterPreviewData["sampleFiles"]>([]);
  const [loadingVisualPicker, setLoadingVisualPicker] = useState(false);
  const [visualPickerError, setVisualPickerError] = useState<string | null>(null);
  const [importedRangesBySd, setImportedRangesBySd] = useState<Record<string, ImportedRangeRecord[]>>({});
  const [allowRangeOverlap, setAllowRangeOverlap] = useState(true);

  // ── Form fields ─────────────────────────────────────────────────────────────
  const [nomeLavoro, setNomeLavoro] = useState("");
  const jobDateInitializedRef = useRef(false);
  const [dataLavoro, setDataLavoro] = useState(() => initialDateFilter ?? todayIso());
  const [autore, setAutore] = useState(() => initialImportPreferencesRef.current.autore);
  const [contrattoLink, setContrattoLink] = useState("");
  const [destinazione, setDestinazione] = useState("");
  const [sottoCartella, setSottoCartella] = useState(() => initialImportPreferencesRef.current.sottoCartella);
  const [rinominaFile, setRinominaFile] = useState(() => initialImportPreferencesRef.current.rinominaFile);
  const [generaJpg, setGeneraJpg] = useState(() => initialImportPreferencesRef.current.generaJpg);
  const [usaLavoroEsistente, setUsaLavoroEsistente] = useState(false);
  const [jobsEsistenti, setJobsEsistenti] = useState<Job[]>([]);
  const [existingJobId, setExistingJobId] = useState("");
  const [existingJobSearch, setExistingJobSearch] = useState("");
  const [existingJobFolders, setExistingJobFolders] = useState<string[]>([]);
  const [loadingExistingJobFolders, setLoadingExistingJobFolders] = useState(false);
  const [existingJobFoldersError, setExistingJobFoldersError] = useState<string | null>(null);
  const [categoryKey, setCategoryKey] = useState("");
  const [destinationOverride, setDestinationOverride] = useState(false);

  // ── Import state ─────────────────────────────────────────────────────────────
  const importOperationRef = useRef<string | null>(null);
  const sourceRequestRef = useRef(0);
  const sourceIdentityRef = useRef(0);
  const [sourceDetailsOpen, setSourceDetailsOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<ImportResult | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgressSnapshot | null>(null);
  const [importStartedAt, setImportStartedAt] = useState<number | null>(null);
  const [importValidationIssues, setImportValidationIssues] = useState<ImportValidationIssue[]>([]);
  const [invalidImportFields, setInvalidImportFields] = useState<Partial<Record<ImportValidationField, true>>>({});
  const [openFolderOnFinish, setOpenFolderOnFinish] = useState(() => initialImportPreferencesRef.current.openFolderOnFinish);
  const [desktopNotifyOnFinish, setDesktopNotifyOnFinish] = useState(() => initialImportPreferencesRef.current.desktopNotifyOnFinish);
  const [soundNotifyOnFinish, setSoundNotifyOnFinish] = useState(() => initialImportPreferencesRef.current.soundNotifyOnFinish);
  const [showAdvancedImportOptions, setShowAdvancedImportOptions] = useState(false);
  const [showQuickAddSetup, setShowQuickAddSetup] = useState(false);
  const [pendingSubfolderParent, setPendingSubfolderParent] = useState<string | null>(null);
  const [newNestedSubfolder, setNewNestedSubfolder] = useState("");
  const autoOpenedJobRef = useRef<string | null>(null);
  const notifiedJobRef = useRef<string | null>(null);
  const sourceStepRef = useRef<HTMLDivElement | null>(null);
  const destinationStepRef = useRef<HTMLDivElement | null>(null);
  const confirmStepRef = useRef<HTMLDivElement | null>(null);

  // ── Settings ─────────────────────────────────────────────────────────────────
  const [savedDestinazione, setSavedDestinazione] = useState("");
  const [archiveRoot, setArchiveRoot] = useState("");
  const [savedArchiveRoot, setSavedArchiveRoot] = useState("");
  const [savedAutore, setSavedAutore] = useState("");
  const [cartellePredefinite, setCartellePredefinite] = useState<string[]>([]);
  const [savedCartellePredefinite, setSavedCartellePredefinite] = useState<string[]>([]);
  const [archiveHierarchy, setArchiveHierarchy] = useState<ArchiveHierarchySettings>(DEFAULT_ARCHIVE_HIERARCHY);
  const [savedArchiveHierarchy, setSavedArchiveHierarchy] = useState<ArchiveHierarchySettings>(DEFAULT_ARCHIVE_HIERARCHY);
  const [categoryMappings, setCategoryMappings] = useState<ArchivioFlowSettings["categoryMappings"]>([]);
  const [savedCategoryMappings, setSavedCategoryMappings] = useState<ArchivioFlowSettings["categoryMappings"]>([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryPath, setNewCategoryPath] = useState("");
  const [newCategoryLayout, setNewCategoryLayout] = useState<CategoryLayout>("year-category");
  const [archiveFolders, setArchiveFolders] = useState<string[]>([]);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [nuovaCartellaPredefinita, setNuovaCartellaPredefinita] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsFeedback, setSettingsFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const [browsingField, setBrowsingField] = useState<"sd" | "dest" | "archive" | null>(null);

  function setImportValidationState(issues: ImportValidationIssue[]) {
    setImportValidationIssues(issues);
    const nextInvalid: Partial<Record<ImportValidationField, true>> = {};
    for (const issue of issues) {
      nextInvalid[issue.field] = true;
    }
    setInvalidImportFields(nextInvalid);
  }

  function clearImportValidationField(field: ImportValidationField) {
    setInvalidImportFields((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
    setImportValidationIssues((prev) => prev.filter((issue) => issue.field !== field));
  }

  function getInvalidInputStyle(field: ImportValidationField) {
    if (!invalidImportFields[field]) return undefined;
    return {
      borderColor: "var(--danger)",
      boxShadow: "0 0 0 1px rgba(212, 163, 156, 0.35)",
    } as const;
  }

  function collectImportValidationIssues(effectiveDestinazione: string): ImportValidationIssue[] {
    const issues: ImportValidationIssue[] = [];
    if (!sdPath.trim()) {
      issues.push({ field: "sdPath", message: "Seleziona o inserisci il percorso della SD card." });
    }
    const rawFrom = mtimeFromFilter.trim();
    const rawTo = mtimeToFilter.trim();
    const fromMs = rawFrom ? Date.parse(rawFrom) : NaN;
    const toMs = rawTo ? Date.parse(rawTo) : NaN;

    if (rawFrom && !Number.isFinite(fromMs)) {
      issues.push({ field: "filters", message: "Data/ora inizio non valida." });
    }
    if (rawTo && !Number.isFinite(toMs)) {
      issues.push({ field: "filters", message: "Data/ora fine non valida." });
    }
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && fromMs > toMs) {
      issues.push({ field: "filters", message: "Intervallo data/ora non valido: inizio dopo fine." });
    }

    if (showSelectionFilters === true && Number.isFinite(fromMs) && Number.isFinite(toMs)) {
      const sdKey = sdPath.trim();
      const currentRanges = importedRangesBySd[sdKey] ?? [];
      const selStart = Math.min(fromMs, toMs);
      const selEnd = Math.max(fromMs, toMs);
      const hasOverlap = currentRanges.some((r) => !(selEnd < r.startMs || selStart > r.endMs));
      if (hasOverlap && !allowRangeOverlap) {
        issues.push({
          field: "rangeOverlap",
          message: "Il range selezionato si sovrappone a un intervallo usato in questa sessione; non è una verifica dei file archiviati.",
        });
      }
    }

    if (!usaLavoroEsistente && !nomeLavoro.trim()) {
      issues.push({ field: "nomeLavoro", message: "Inserisci il nome del lavoro." });
    }
    if (usaLavoroEsistente && !existingJobId) {
      issues.push({ field: "existingJobId", message: "Seleziona un lavoro esistente." });
    }
    if (!dataLavoro) {
      issues.push({ field: "dataLavoro", message: "Inserisci la data del lavoro." });
    }
    if (!autore.trim()) {
      issues.push({ field: "autore", message: "Inserisci il nome dell'autore." });
    }
    if (!usaLavoroEsistente && !effectiveDestinazione) {
      issues.push({ field: "destinazione", message: "Inserisci la cartella di destinazione." });
    }

    return issues;
  }

  const refreshExistingJobs = useCallback(async () => {
    try {
      const data = await getArchivioJobs();
      setJobsEsistenti(Array.isArray(data) ? data : []);
    } catch {
      setJobsEsistenti([]);
    }
  }, []);

  // ── Load settings on mount ───────────────────────────────────────────────────
  useEffect(() => {
    getArchivioSettings()
      .then((data) => {
        const normalizedArchiveRoot = data?.archiveRoot?.trim() ?? "";
        const normalizedDefaultDestinazione = data?.defaultDestinazione?.trim() || normalizedArchiveRoot;
        const normalizedHierarchy = normalizeHierarchyConfig(data?.archiveHierarchy);
        if (normalizedArchiveRoot) {
          setArchiveRoot(normalizedArchiveRoot);
          setSavedArchiveRoot(normalizedArchiveRoot);
        }
        if (normalizedDefaultDestinazione) {
          setDestinazione(normalizedDefaultDestinazione);
          setSavedDestinazione(normalizedDefaultDestinazione);
        }
        if (data?.defaultAutore) {
          setAutore(data.defaultAutore);
          setSavedAutore(data.defaultAutore);
        }
        if (Array.isArray(data?.cartellePredefinite)) {
          const filtered = data.cartellePredefinite.filter((v) => v.trim().length > 0);
          setCartellePredefinite(filtered);
          setSavedCartellePredefinite(filtered);
        }
        setArchiveHierarchy(normalizedHierarchy);
        setSavedArchiveHierarchy(normalizedHierarchy);
        const mappings = Array.isArray(data?.categoryMappings) ? data.categoryMappings : [];
        setCategoryMappings(mappings);
        setSavedCategoryMappings(mappings);
      })
      .catch(() => {/* runtime desktop non pronto */})
      .finally(() => {
        setSettingsLoaded(true);
      });
  }, []);

  useEffect(() => {
    void refreshExistingJobs();
  }, [refreshExistingJobs]);

  useEffect(() => {
    if (!archiveRoot.trim()) { setArchiveFolders([]); return; }
    void getArchivioFolders(archiveRoot.trim()).then(setArchiveFolders).catch(() => setArchiveFolders([]));
  }, [archiveRoot]);

  useEffect(() => {
    void getArchivioStartAtLogin().then(setStartupAtLogin).catch(() => setStartupAtLogin(null));
  }, []);

  useEffect(() => {
    if (openSettingsSection) window.localStorage.setItem(SETTINGS_OPEN_SECTION_KEY, openSettingsSection);
    else window.localStorage.removeItem(SETTINGS_OPEN_SECTION_KEY);
  }, [openSettingsSection]);

  useEffect(() => {
    setSdPath(initialSdPath ?? "");
  }, [initialSdPath, sourceRevision]);

  useEffect(() => {
    sourceRequestRef.current += 1;
    sourceIdentityRef.current += 1;
    setSdPreview(null);
    setSafeCheck(null);
    setSafeCheckError(null);
    setCheckingSafe(false);
    setFilterPreview(null);
    setFilterPreviewError(null);
    setVisualPickerSamples([]);
    setShowVisualRangePicker(false);
    setVisualPickerError(null);
    setLoadingVisualPicker(false);
    setPreviewRangeStartMs(null);
    setPreviewRangeEndMs(null);
    setImportedRangesBySd({});
    setImportSuccess(null);
    setImportValidationState([]);
    setExplicitFiles(null);
    setFileNameIncludesFilter("");
    setMtimeFromFilter("");
    setMtimeToFilter("");
    setShowSelectionFilters(false);
  }, [sdPath, sourceRevision]);

  useEffect(() => {
    if (initialDateFilter && !jobDateInitializedRef.current && !usaLavoroEsistente && !nomeLavoro.trim()) {
      setDataLavoro(initialDateFilter);
      jobDateInitializedRef.current = true;
    }
    if (initialSelection?.existingJobId) {
      setUsaLavoroEsistente(true);
      setExistingJobId(initialSelection.existingJobId);
    }
    setExplicitFiles(initialSelection?.selectedFilePaths ?? null);
    setMtimeFromFilter(initialSelection?.mtimeFrom ?? (initialSelection?.selectedFilePaths ? "" : initialDateFilter ? `${initialDateFilter}T00:00` : ""));
    setMtimeToFilter(initialSelection?.mtimeTo ?? (initialSelection?.selectedFilePaths ? "" : initialDateFilter ? `${initialDateFilter}T23:59:59.999` : ""));
    setFileNameIncludesFilter("");
    setShowSelectionFilters(Boolean(initialDateFilter));
  }, [initialDateFilter, initialSelection, selectionRevision]);

  useEffect(() => {
    if (!newJobRevision) return;
    setUsaLavoroEsistente(false);
    setExistingJobId("");
    setNomeLavoro("");
    setDataLavoro(initialDateFilter ?? todayIso());
    setContrattoLink("");
    setImportValidationState([]);
  }, [newJobRevision]);

  useEffect(() => {
    if (!usaLavoroEsistente || !existingJobId) return;
    const selected = jobsEsistenti.find((j) => j.id === existingJobId);
    if (!selected) return;
    setNomeLavoro(selected.nomeLavoro);
    setDataLavoro(selected.dataLavoro);
    setAutore(selected.autore);
    setContrattoLink(selected.contrattoLink ?? "");
  }, [usaLavoroEsistente, existingJobId, jobsEsistenti]);

  useEffect(() => {
    if (!existingJobImportId) { setUsaLavoroEsistente(false); return; }
    setUsaLavoroEsistente(true);
    setExistingJobId(existingJobImportId);
    setExistingJobSearch("");
    setSottoCartella("");
    setImportValidationState([]);
    setShowQuickAddSetup(false);
  }, [existingJobImportId]);

  useEffect(() => {
    if (!usaLavoroEsistente || !existingJobId || !autore.trim()) {
      setExistingJobFolders([]);
      setExistingJobFoldersError(null);
      setLoadingExistingJobFolders(false);
      return;
    }
    let active = true;
    setLoadingExistingJobFolders(true);
    setExistingJobFoldersError(null);
    void getArchivioJobSubfolders(existingJobId, autore.trim())
      .then((result) => {
        if (active) setExistingJobFolders(result.subfolders);
      })
      .catch((error) => {
        if (!active) return;
        setExistingJobFolders([]);
        setExistingJobFoldersError(error instanceof Error ? error.message : "Impossibile leggere le cartelle esistenti");
      })
      .finally(() => {
        if (active) setLoadingExistingJobFolders(false);
      });
    return () => { active = false; };
  }, [usaLavoroEsistente, existingJobId, autore]);

  useEffect(() => {
    const preferences: ImportUiPreferences = {
      autore, sottoCartella, rinominaFile, generaJpg,
      openFolderOnFinish, desktopNotifyOnFinish, soundNotifyOnFinish,
    };
    try {
      window.localStorage.setItem(IMPORT_UI_PREFERENCES_KEY, JSON.stringify(preferences));
    } catch {
      /* local storage non disponibile: l'importazione continua normalmente */
    }
  }, [autore, sottoCartella, rinominaFile, generaJpg, openFolderOnFinish, desktopNotifyOnFinish, soundNotifyOnFinish]);

  const fetchSdCards = useCallback(async () => {
    setRefreshingSd(true);
    try {
      const cards = await getArchivioSdCards();
      setSdCards(cards);
    } catch {
      /* ignore transient desktop runtime errors */
    } finally {
      setRefreshingSd(false);
    }
  }, [sdPath]);

  useEffect(() => {
    if (!isVisible || activeView !== "nuovo") return;
    const timer = window.setInterval(() => void fetchSdCards(), 2500);
    return () => window.clearInterval(timer);
  }, [isVisible, activeView, fetchSdCards]);

  async function handleEjectSd() {
    if (!sdPath.trim()) return;
    setEjectingSd(true);
    setSdFeedback(null);
    try {
      const result = await ejectArchivioSdCard(sdPath.trim());
      setSdFeedback(result.message);
      await fetchSdCards();
    } catch (error) {
      setSdFeedback(error instanceof Error ? error.message : "Non è stato possibile espellere la SD.");
    } finally {
      setEjectingSd(false);
    }
  }

  async function handleSafeCheck() {
    const revision = sourceIdentityRef.current;
    if (!sdPath.trim()) return;
    setCheckingSafe(true);
    setSafeCheck(null);
    setSafeCheckError(null);
    try {
      const result = await checkArchivioSafeToFormat(sdPath.trim());
      if (revision !== sourceIdentityRef.current) return;
      setSafeCheck(result);
    } catch (error) {
      if (revision !== sourceIdentityRef.current) return;
      setSafeCheckError(error instanceof Error ? error.message : "Verifica non disponibile");
    } finally {
      if (revision !== sourceIdentityRef.current) return;
      setCheckingSafe(false);
    }
  }

  const refreshStudioFlowStatus = useCallback(async () => {
    try {
      setStudioFlowStatus(await getArchivioStudioFlowStatus());
      setStudioFlowError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stato locale non disponibile";
      setStudioFlowError(
        !window.filexDesktop || /failed to fetch|richiesta api fallita/i.test(message)
          ? "Backend locale non raggiungibile. Avvia Archivio Flow dalla dashboard FileX per usare database, indice e Drive."
          : message,
      );
    }
  }, []);

  useEffect(() => {
    if (isVisible) void refreshStudioFlowStatus();
  }, [isVisible, activeView, selectionRevision, refreshStudioFlowStatus]);

  useEffect(() => {
    if (activeView !== "impostazioni") return;
    const timer = window.setInterval(() => void refreshStudioFlowStatus(), 3000);
    return () => window.clearInterval(timer);
  }, [activeView, refreshStudioFlowStatus]);

  async function handleReconcileIndex() {
    setStudioFlowBusy(true);
    try {
      await reconcileArchivioIndex();
      await refreshStudioFlowStatus();
    } catch (error) {
      setStudioFlowError(error instanceof Error ? error.message : "Riconciliazione fallita");
    } finally {
      setStudioFlowBusy(false);
    }
  }

  async function handleResumeSession(sessionId: string) {
    setStudioFlowBusy(true);
    try {
      const result = await resumeArchivioImport(sessionId);
      setImportSuccess(result);
      onImportDone(result);
      await refreshStudioFlowStatus();
    } catch (error) {
      setStudioFlowError(error instanceof Error ? error.message : "Ripresa fallita");
    } finally {
      setStudioFlowBusy(false);
    }
  }

  async function handleDriveSync() {
    setStudioFlowBusy(true);
    try {
      const result = await syncArchivioDriveRegistry();
      setStudioFlowError(null);
      setSettingsFeedback({ type: "success", message: result.message });
      await refreshStudioFlowStatus();
    } catch (error) {
      setStudioFlowError(error instanceof Error ? error.message : "Sincronizzazione Drive fallita");
    } finally {
      setStudioFlowBusy(false);
    }
  }

  // Load SD cards on mount
  useEffect(() => {
    fetchSdCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Browse helper ────────────────────────────────────────────────────────────
  async function handleBrowse(field: "sd" | "dest" | "archive") {
    setBrowsingField(field);
    try {
      const selectedPath = await browseArchivioFolder();
      if (selectedPath) {
        if (field === "sd") {
          setSdPath(selectedPath);
          clearImportValidationField("sdPath");
        } else if (field === "dest") {
          setDestinazione(selectedPath);
          setDestinationOverride(true);
          clearImportValidationField("destinazione");
        }
        else setArchiveRoot(selectedPath);
      }
    } catch {
      /* ignore */
    } finally {
      setBrowsingField(null);
    }
  }

  // ── Save settings ────────────────────────────────────────────────────────────
  async function persistSettings(showSpinner: boolean) {
    if (showSpinner) setSavingSettings(true);
    const normalizedArchiveRoot = archiveRoot.trim();
    const normalizedDefaultDestinazione = destinazione.trim() || normalizedArchiveRoot;
    try {
      await saveArchivioSettings({
        archiveRoot: normalizedArchiveRoot,
        defaultDestinazione: normalizedDefaultDestinazione,
        defaultAutore: autore.trim(),
        cartellePredefinite,
        archiveHierarchy,
        categoryMappings,
      });
        setSavedArchiveRoot(normalizedArchiveRoot);
        setSavedDestinazione(normalizedDefaultDestinazione);
        if (!destinazione.trim() && normalizedDefaultDestinazione) {
          setDestinazione(normalizedDefaultDestinazione);
        }
        setSavedAutore(autore.trim());
        setSavedCartellePredefinite(cartellePredefinite);
        setSavedArchiveHierarchy(archiveHierarchy);
        setSavedCategoryMappings(categoryMappings);
        setSettingsFeedback({
          type: "success",
          message: showSpinner ? "Impostazioni salvate." : "Impostazioni salvate automaticamente.",
        });
    } catch (error) {
      setSettingsFeedback({
        type: "error",
        message: error instanceof Error ? `Salvataggio fallito: ${error.message}` : "Salvataggio fallito.",
      });
    } finally {
      if (showSpinner) setSavingSettings(false);
    }
  }

  async function handleSaveSettings() {
    await persistSettings(true);
  }

  // Fetch file preview whenever sdPath changes
  useEffect(() => {
    if (!isVisible) return;
    if (initialSelection?.sourceSummary && initialSdPath === sdPath) {
      setSdPreview(initialSelection.sourceSummary);
      setLoadingSd(false);
      return;
    }
    if (!sdPath.trim()) {
      setSdPreview(null);
      setShowSelectionFilters(false);
      setFilterPreview(null);
      setFilterPreviewError(null);
      return;
    }
    let alive = true;
    setLoadingSd(true);
    getArchivioSdPreview(sdPath)
      .then((data: SdPreview | null) => {
        if (alive) setSdPreview(data);
      })
      .catch(() => { if (alive) setSdPreview(null); })
      .finally(() => { if (alive) setLoadingSd(false); });
    return () => { alive = false; };
  }, [sdPath, sourceRevision, isVisible, initialSelection?.sourceSummary, initialSdPath]);

  // Calcola subito il numero reale dei file quando il flusso arriva dalla
  // selezione per data. Evita di mostrare temporaneamente il totale della SD.
  useEffect(() => {
    const source = sdPath.trim();
    const fileNameIncludes = fileNameIncludesFilter.trim();
    const mtimeFrom = mtimeFromFilter.trim();
    const mtimeTo = mtimeToFilter.trim();
    const hasActiveFilter = Boolean(fileNameIncludes || mtimeFrom || mtimeTo);

    if (!isVisible || explicitFiles || !source || !hasActiveFilter) {
      setFilterPreview(null);
      setFilterPreviewError(null);
      setLoadingFilterPreview(false);
      return;
    }

    let alive = true;
    setFilterPreview(null);
    setFilterPreviewError(null);
    setLoadingFilterPreview(true);
    const timer = window.setTimeout(() => {
      void getArchivioFilterPreview({
        sdPath: source,
        fileNameIncludes: fileNameIncludes || undefined,
        mtimeFrom: mtimeFrom || undefined,
        mtimeTo: mtimeTo || undefined,
        maxSamples: 36,
      })
        .then((data) => {
          if (!alive) return;
          setFilterPreview(data as FilterPreviewData);
          setPreviewRangeStartMs(null);
          setPreviewRangeEndMs(null);
        })
        .catch((error) => {
          if (alive) setFilterPreviewError(error instanceof Error ? error.message : "Anteprima filtro non riuscita");
        })
        .finally(() => {
          if (alive) setLoadingFilterPreview(false);
        });
    }, 180);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [sdPath, sourceRevision, fileNameIncludesFilter, mtimeFromFilter, mtimeToFilter, isVisible, explicitFiles]);

  async function handleImport() {
    if (importing) return;
    setImportError(null);
    setImportSuccess(null);
    setImportProgress(null);
    setImportStartedAt(null);

    const validationIssues = collectImportValidationIssues(effectiveDestinazione);
    if (validationIssues.length > 0) {
      setImportValidationState(validationIssues);
      setImportError(
        validationIssues.length === 1
          ? validationIssues[0]!.message
          : `Compila i campi obbligatori: ${validationIssues.length} punti da sistemare.`,
      );
      return;
    }
    setImportValidationState([]);


    importOperationRef.current = crypto.randomUUID();
    setImportStartedAt(Date.now());
    setImporting(true);
    onImportingChange?.(true);
    try {
      const importResult = await startArchivioImport({
        operationId: importOperationRef.current,
        selectedFilePaths: explicitFiles ?? undefined,
        sdPath: sdPath.trim(),
        nomeLavoro: nomeLavoro.trim(),
        dataLavoro,
        autore: autore.trim(),
        contrattoLink: contrattoLink.trim(),
        destinazione: effectiveDestinazione,
        sottoCartella: sottoCartella.trim(),
        existingJobId: usaLavoroEsistente ? existingJobId : undefined,
        rinominaFile,
        generaJpg,
        fileNameIncludes: explicitFiles ? undefined : fileNameIncludesFilter.trim() || undefined,
        mtimeFrom: explicitFiles ? undefined : mtimeFromFilter.trim() || undefined,
        mtimeTo: explicitFiles ? undefined : mtimeToFilter.trim() || undefined,
        categoryKey: categoryKey || undefined,
        destinationOverride,
      } satisfies ImportRequest);
        const fromMsDone = mtimeFromFilter.trim() ? Date.parse(mtimeFromFilter.trim()) : NaN;
        const toMsDone = mtimeToFilter.trim() ? Date.parse(mtimeToFilter.trim()) : NaN;
        if (!importResult.incomplete && showSelectionFilters === true && Number.isFinite(fromMsDone) && Number.isFinite(toMsDone)) {
          const startMs = Math.min(fromMsDone, toMsDone);
          const endMs = Math.max(fromMsDone, toMsDone);
          const rangeLabel = usaLavoroEsistente
            ? (selectedExistingJob?.nomeLavoro ?? "Lavoro esistente")
            : (nomeLavoro.trim() || "Nuovo lavoro");
          const sdKey = sdPath.trim();
          setImportedRangesBySd((prev) => ({
            ...prev,
            [sdKey]: [
              ...(prev[sdKey] ?? []),
              {
                startMs,
                endMs,
                label: rangeLabel,
                importedAtIso: new Date().toISOString(),
              },
            ],
          }));
        }
        setUsaLavoroEsistente(true);
        setExistingJobId(importResult.job.id);
        setImportSuccess(importResult);
        try {
          await notifyBackupGuardProject(importResult);
        } catch {
          // L'importazione e' conclusa: la coda Backup Guard non deve invalidarla.
        }
        if (openFolderOnFinish) {
          autoOpenedJobRef.current = importResult.job.id;
          try {
            await openImportDestinationFolders(importResult);
          } catch {
            // Import is already complete; Explorer failures must not turn it into a failed import.
          }
        }
        await refreshExistingJobs();
        onImportDone(importResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Errore durante l'importazione.";
      if (/lavoro esistente non trovato/i.test(message)) {
        setImportValidationState([{
          field: "existingJobId",
          message: "Il lavoro selezionato non e disponibile: aggiorna la lista e selezionalo di nuovo.",
        }]);
        await refreshExistingJobs();
      }
      setImportError(message);
    } finally {
      setImporting(false);
      onImportingChange?.(false);
      setImportStartedAt(null);
    }
  }

  async function handleCancelRunningImport() {
    try {
      await cancelArchivioImport();
      setImportError("Importazione annullata");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Impossibile annullare l'importazione.");
    }
  }

  const jobSuggestions = useMemo(() => suggestImportJobs(jobsEsistenti, studioFlowStatus?.sessions ?? [], initialSelection?.suggestedFiles ?? []), [jobsEsistenti, studioFlowStatus?.sessions, initialSelection?.suggestedFiles]);
  const selectedExistingJob = jobsEsistenti.find((j) => j.id === existingJobId) ?? null;
  const similarExistingFolders = usaLavoroEsistente
    ? findSimilarFolderNames(sottoCartella, existingJobFolders)
    : [];
  const normalizedExistingJobSearch = existingJobSearch.trim().toLowerCase();
  const filteredExistingJobs = normalizedExistingJobSearch
    ? jobsEsistenti.filter((job) => {
        const haystack = [
          job.nomeLavoro,
          job.dataLavoro,
          job.autore,
          job.annoArchivio ?? "",
          job.categoriaArchivio ?? "",
          job.percorsoCartella,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedExistingJobSearch);
      })
    : jobsEsistenti;
  const existingJobsForSelect =
    selectedExistingJob && !filteredExistingJobs.some((job) => job.id === selectedExistingJob.id)
      ? [selectedExistingJob, ...filteredExistingJobs]
      : filteredExistingJobs;
  const currentSdKey = sdPath.trim();
  const importedRangesForCurrentSd = currentSdKey ? (importedRangesBySd[currentSdKey] ?? []) : [];
  const effectiveDestinazione = destinazione.trim() || archiveRoot.trim() || savedDestinazione || savedArchiveRoot;
  const baseFolderPreview = usaLavoroEsistente
    ? (selectedExistingJob?.nomeCartella ?? "—")
    : buildFolderPreview(nomeLavoro, dataLavoro);
  const selectedCategoryMapping = categoryMappings.find((item) => item.enabled && item.categoryKey === categoryKey);
  const [previewYear = "", previewMonth = "", previewDay = ""] = dataLavoro.split("-");
  const previewTokens: Record<string, string> = { year:previewYear, month:previewMonth, day:previewDay, date:dataLavoro, "date-dmy":[previewDay, previewMonth, previewYear].join("-"), client:nomeLavoro.trim(), job:nomeLavoro.trim() };
  const renderPreviewPattern = (pattern: string) => pattern.replace(/\{([a-z-]+)\}/gi, (_match, key: string) => previewTokens[key.toLowerCase()] ?? "");
  const mappedParentPreview = selectedCategoryMapping && !destinationOverride
    ? [archiveRoot.trim(), renderPreviewPattern(selectedCategoryMapping.relativePathPattern)].filter(Boolean).join("\\")
    : effectiveDestinazione;
  const mappedFolderPreview = selectedCategoryMapping && !usaLavoroEsistente
    ? renderPreviewPattern(selectedCategoryMapping.jobFolderPattern || "{date} - {client} - {date-dmy}")
    : baseFolderPreview;
  const folderPreview = usaLavoroEsistente
    ? (selectedExistingJob?.percorsoCartella ?? "—")
    : (mappedFolderPreview === "—" ? "—" : [mappedParentPreview, mappedFolderPreview].filter(Boolean).join("\\"));
  const safeAutoreFolder = buildSafeFolderSegment(autore);
  const safeSottoCartella = buildSafeFolderSegment(sottoCartella);
  const fotoDestPreview = safeAutoreFolder
    ? (safeSottoCartella
      ? `FOTO_SD\\${safeAutoreFolder}\\${safeSottoCartella}`
      : `FOTO_SD\\${safeAutoreFolder}`)
    : "FOTO_SD\\(autore)";
  const videoDestPreview = safeAutoreFolder
    ? (safeSottoCartella
      ? `VIDEO_SD\\${safeAutoreFolder}\\${safeSottoCartella}`
      : `VIDEO_SD\\${safeAutoreFolder}`)
    : "VIDEO_SD\\(autore)";
  const fotoDestFullPreview = folderPreview === "—"
    ? fotoDestPreview
    : [folderPreview, fotoDestPreview].filter(Boolean).join("\\");
  const videoDestFullPreview = folderPreview === "—"
    ? videoDestPreview
    : [folderPreview, videoDestPreview].filter(Boolean).join("\\");
  const categoryFolderPreview = normalizeFolderName(newCategoryName) || "Categoria";
  const proposedCategoryPattern = newCategoryLayout === "custom"
    ? newCategoryPath.trim()
    : newCategoryLayout === "category-year"
      ? `${categoryFolderPreview}\\{year}`
      : newCategoryLayout === "category-only"
        ? categoryFolderPreview
        : `{year}\\${categoryFolderPreview}`;
  const categoryPreviewYear = String(new Date().getFullYear());
  const categoryDestinationPreview = [
    archiveRoot.trim() || "Radice archivio",
    proposedCategoryPattern.replace(/\{year\}/gi, categoryPreviewYear).replace(/\//g, "\\"),
    `${categoryPreviewYear}-08-20 - Mario e Anna - 20-08-${categoryPreviewYear}`,
  ].filter(Boolean).join("\\");
  const canSaveCategory = Boolean(newCategoryName.trim() && (newCategoryLayout !== "custom" || newCategoryPath.trim()));
  const archiveIsScanning = studioFlowStatus?.archiveIndex.state === "scanning";
  const archiveIndexLabel = archiveIsScanning
    ? `Scansione in corso · ${studioFlowStatus?.archiveIndex.fileCount.toLocaleString("it-IT") ?? 0} file letti`
    : studioFlowStatus?.archiveIndex.state === "ready"
      ? `Indice pronto · ${studioFlowStatus.archiveIndex.fileCount.toLocaleString("it-IT")} file`
      : studioFlowStatus?.archiveIndex.state === "error"
        ? "Indice in errore"
        : "Indice non ancora costruito";
  const blockingImportIssues = collectImportValidationIssues(effectiveDestinazione);
  const canImport = !importing && blockingImportIssues.length === 0;
  const settingsChanged =
    archiveRoot.trim() !== savedArchiveRoot ||
    destinazione.trim() !== savedDestinazione ||
    autore.trim() !== savedAutore ||
    JSON.stringify(cartellePredefinite) !== JSON.stringify(savedCartellePredefinite) ||
    JSON.stringify(archiveHierarchy) !== JSON.stringify(savedArchiveHierarchy) ||
    JSON.stringify(categoryMappings) !== JSON.stringify(savedCategoryMappings);

  useEffect(() => {
    if (!settingsLoaded || !settingsChanged || savingSettings) return;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      void persistSettings(false);
    }, 700);
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [settingsLoaded, settingsChanged, savingSettings, archiveRoot, destinazione, autore, cartellePredefinite, archiveHierarchy, categoryMappings]);

  function applyEventoRapido(nomeEvento: string) {
    setSottoCartella(nomeEvento);
    if (!cartellePredefinite.some((v) => v.toLowerCase() === nomeEvento.toLowerCase())) {
      setCartellePredefinite((prev) => [...prev, nomeEvento]);
    }
  }

  function normalizeFolderName(value: string): string {
    return value
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
      .replace(/\.+/g, ".")
      .replace(/^\.+|\.+$/g, "")
      .trim();
  }

  function addCartellaPredefinita() {
    const cleaned = normalizeFolderName(nuovaCartellaPredefinita);
    if (!cleaned) return;
    if (cartellePredefinite.some((v) => v.toLowerCase() === cleaned.toLowerCase())) {
      setNuovaCartellaPredefinita("");
      return;
    }
    setCartellePredefinite((prev) => [...prev, cleaned]);
    setNuovaCartellaPredefinita("");
  }

  function removeCartellaPredefinita(name: string) {
    setCartellePredefinite((prev) => prev.filter((v) => v !== name));
  }

  function addCategoryMapping() {
    const displayName = newCategoryName.trim();
    const categoryFolder = normalizeFolderName(displayName);
    const relativePathPattern = newCategoryLayout === "custom"
      ? newCategoryPath.trim()
      : newCategoryLayout === "category-year"
        ? `${categoryFolder}\\{year}`
        : newCategoryLayout === "category-only"
          ? categoryFolder
          : `{year}\\${categoryFolder}`;
    if (!displayName || !relativePathPattern) return;
    const generatedKey = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const key = editingCategoryId || generatedKey || `categoria-${Date.now()}`;
    setCategoryMappings((previous) => [
      ...previous.filter((item) => item.categoryKey !== key),
      { id:key, categoryKey:key, displayName, relativePathPattern, jobFolderPattern:"{date} - {client} - {date-dmy}", enabled:true },
    ]);
    cancelCategoryEditing();
  }

  function editCategoryMapping(mapping: NonNullable<ArchivioFlowSettings["categoryMappings"]>[number]) {
    setEditingCategoryId(mapping.categoryKey);
    setNewCategoryName(mapping.displayName);
    setNewCategoryPath(mapping.relativePathPattern);
    setNewCategoryLayout("custom");
  }

  function cancelCategoryEditing() {
    setEditingCategoryId(null);
    setNewCategoryName("");
    setNewCategoryPath("");
    setNewCategoryLayout("year-category");
  }

  useEffect(() => {
    sourceRequestRef.current += 1;
    setLoadingVisualPicker(false);
    setShowVisualRangePicker(false);
    return () => { sourceRequestRef.current += 1; };
  }, [sdPath, sourceRevision, fileNameIncludesFilter, mtimeFromFilter, mtimeToFilter]);

  async function handleFilterPreview() {
    const revision = sourceRequestRef.current;
    setFilterPreview(null);
    setFilterPreviewError(null);
    if (!sdPath.trim()) {
      setFilterPreviewError("Seleziona prima il percorso SD.");
      return;
    }
    setLoadingFilterPreview(true);
    try {
      const data = await getArchivioFilterPreview({
        sdPath: sdPath.trim(),
        fileNameIncludes: fileNameIncludesFilter.trim() || undefined,
        mtimeFrom: mtimeFromFilter.trim() || undefined,
        mtimeTo: mtimeToFilter.trim() || undefined,
        maxSamples: 36,
      });
      if (revision !== sourceRequestRef.current) return;
      setFilterPreview(data as FilterPreviewData);
      setPreviewRangeStartMs(null);
      setPreviewRangeEndMs(null);
    } catch (error) {
      if (revision !== sourceRequestRef.current) return;
      setFilterPreviewError(error instanceof Error ? error.message : "Anteprima filtro non riuscita");
    } finally {
      if (revision !== sourceRequestRef.current) return;
      setLoadingFilterPreview(false);
    }
  }

  async function openVisualRangePicker() {
    const revision = sourceRequestRef.current;
    setVisualPickerError(null);
    if (!sdPath.trim()) {
      setVisualPickerError("Seleziona prima il percorso SD.");
      return;
    }

    setLoadingVisualPicker(true);
    try {
      const previewData = await getArchivioFilterPreview({
        sdPath: sdPath.trim(),
        fileNameIncludes: fileNameIncludesFilter.trim() || undefined,
        maxSamples: 5000,
      });
      if (revision !== sourceRequestRef.current) return;
      setVisualPickerTruncated(previewData.matchedFiles > previewData.sampleFiles.length);
      if (previewData.matchedFiles > previewData.sampleFiles.length) {
        setVisualPickerError("Anteprima limitata ai primi 5000 file: per gli altri usa i filtri data/ora.");
      }
      setVisualPickerSamples(previewData.sampleFiles ?? []);
      setShowVisualRangePicker(true);
    } catch (error) {
      if (revision !== sourceRequestRef.current) return;
      setVisualPickerError(error instanceof Error ? error.message : "Impossibile aprire il selettore visuale");
    } finally {
      if (revision !== sourceRequestRef.current) return;
      setLoadingVisualPicker(false);
    }
  }

  function formatPreviewDateTime(ms: number): string {
    return new Date(ms).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function toDateTimeLocalValue(ms: number): string {
    const date = new Date(ms);
    const offsetMs = date.getTimezoneOffset() * 60_000;
    return new Date(ms - offsetMs).toISOString().slice(0, -1);
  }

  function selectPreviewPoint(ms: number) {
    if (previewRangeStartMs === null || (previewRangeStartMs !== null && previewRangeEndMs !== null)) {
      setPreviewRangeStartMs(ms);
      setPreviewRangeEndMs(null);
      return;
    }

    const start = Math.min(previewRangeStartMs, ms);
    const end = Math.max(previewRangeStartMs, ms);
    setPreviewRangeStartMs(start);
    setPreviewRangeEndMs(end);
  }

  function applyPreviewRangeToFilters() {
    if (previewRangeStartMs === null || previewRangeEndMs === null) return;
    setMtimeFromFilter(toDateTimeLocalValue(Math.floor(previewRangeStartMs)));
    setMtimeToFilter(toDateTimeLocalValue(Math.ceil(previewRangeEndMs)));
  }

  function handleApplyVisualRange(startMs: number, endMs: number) {
    const start = Math.min(startMs, endMs);
    const end = Math.max(startMs, endMs);
    setPreviewRangeStartMs(start);
    setPreviewRangeEndMs(end);
    setMtimeFromFilter(toDateTimeLocalValue(Math.floor(start)));
    setMtimeToFilter(toDateTimeLocalValue(Math.ceil(end)));
    setShowVisualRangePicker(false);
  }

  function isWithinSelectedRange(ms: number): boolean {
    if (previewRangeStartMs === null) return false;
    if (previewRangeEndMs === null) return ms === previewRangeStartMs;
    return ms >= previewRangeStartMs && ms <= previewRangeEndMs;
  }

  function applyImportedRange(range: ImportedRangeRecord) {
    setMtimeFromFilter(toDateTimeLocalValue(range.startMs));
    setMtimeToFilter(toDateTimeLocalValue(range.endMs));
    setPreviewRangeStartMs(range.startMs);
    setPreviewRangeEndMs(range.endMs);
  }

  function removeImportedRange(index: number) {
    if (!currentSdKey) return;
    setImportedRangesBySd((prev) => {
      const current = prev[currentSdKey] ?? [];
      const next = current.filter((_, i) => i !== index);
      return { ...prev, [currentSdKey]: next };
    });
  }

  useEffect(() => {
    if (!importing) return;
    let alive = true;
    let polling = false;
    const operationId = importOperationRef.current;

    async function pollProgress() {
      if (polling) return;
      polling = true;
      try {
        const data = await getArchivioImportProgress() as ImportProgressSnapshot;
        if (!alive || !operationId || data.operationId !== operationId) return;
        setImportProgress(data);
      } catch {
        /* ignore transient polling errors */
      } finally { polling = false; }
    }

    void pollProgress();
    const timer = window.setInterval(() => {
      void pollProgress();
    }, 1000);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [importing]);

  useEffect(() => {
    if (!importSuccess || !openFolderOnFinish) return;
    if (autoOpenedJobRef.current === importSuccess.job.id) return;
    autoOpenedJobRef.current = importSuccess.job.id;
    void openImportDestinationFolders(importSuccess);
  }, [importSuccess, openFolderOnFinish]);

  useEffect(() => {
    if (!importSuccess) return;
    if (notifiedJobRef.current === importSuccess.job.id) return;
    notifiedJobRef.current = importSuccess.job.id;

    if (soundNotifyOnFinish) {
      playCompletionTone();
    }

    if (desktopNotifyOnFinish) {
      void showCompletionDesktopNotification(
        "Archivio Flow: import completato",
        `${importSuccess.job.nomeLavoro} · ${importSuccess.copiedFiles} file copiati${importSuccess.jpgGenerati > 0 ? ` · ${importSuccess.jpgGenerati} JPG BQ` : ""}`
      );
    }
  }, [importSuccess, desktopNotifyOnFinish, soundNotifyOnFinish]);

  const progressPhase = importProgress?.phase ?? "copying";
  const copyStepDone = progressPhase === "compressing" || progressPhase === "done";
  const bqStepVisible = Boolean(importProgress?.jpgEnabled ?? generaJpg);
  const bqStepDone = !bqStepVisible || progressPhase === "done";
  const copyProgressPct = (importProgress?.plannedFiles ?? 0) > 0
    ? Math.min(100, Math.round(((importProgress?.completedScheduled ?? 0) / Math.max(importProgress?.plannedFiles ?? 1, 1)) * 100))
    : (copyStepDone ? 100 : 0);
  const bqProgressPct = bqStepVisible
    ? (importProgress?.jpgPlanned ?? 0) > 0
      ? Math.min(100, Math.round(((importProgress?.jpgDone ?? 0) / Math.max(importProgress?.jpgPlanned ?? 1, 1)) * 100))
      : (progressPhase === "done" ? 100 : 0)
    : 100;
  const hasActiveImportFilter = Boolean(
    fileNameIncludesFilter.trim() || mtimeFromFilter.trim() || mtimeToFilter.trim(),
  );
  const initialPlannedFiles = explicitFiles ? explicitFiles.length : hasActiveImportFilter
    ? (filterPreview?.matchedFiles ?? 0)
    : (sdPreview?.totalFiles ?? 0);
  const displayedPlannedFiles = importProgress?.plannedFiles || initialPlannedFiles;
  const displayedCompletedFiles = importProgress?.completedScheduled ?? 0;
  const displayedElapsedMs = Math.max(importProgress?.elapsedMs ?? 0, importStartedAt ? Date.now() - importStartedAt : 0);
  const initialImportTargetFolder = usaLavoroEsistente && selectedExistingJob
    ? [selectedExistingJob.percorsoCartella, fotoDestPreview].join("\\")
    : fotoDestFullPreview;
  const overallProgressPct = importProgress?.overallProgressPct ?? 0;
  const progressPhaseLabel = importProgress?.currentPhaseLabel
    ?? (progressPhase === "compressing" ? "Compressione JPG" : "Preparazione importazione");

  function scrollToImportStep(target: React.RefObject<HTMLDivElement | null>) {
    if (target === sourceStepRef) setSourceDetailsOpen(true);
    target.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="stack">
      {/* Header */}
      <div className="workspace__header">
        <div>
          <h2>{activeView === "impostazioni" ? "Impostazioni" : "Nuovo lavoro"}</h2>
          <p style={{ margin: 0, color: "var(--text-muted)" }}>
            {activeView === "impostazioni"
              ? "Configura la radice archivio e i preset rapidi usati durante l'importazione."
              : existingJobImportId
                ? "Aggiungi nuovi file al lavoro selezionato: scegli una cartella rapida o inseriscine una nuova, poi avvia l'importazione."
                : "Importa foto da SD card, organizza automaticamente le cartelle e registra il lavoro."}
          </p>
        </div>
      </div>

      {activeView === "nuovo" && (
        <div className="message-box" role="status">
          <strong>Selezione da importare: </strong>
          {explicitFiles ? `${explicitFiles.length} file selezionati singolarmente: verranno importati soltanto questi file.` : hasActiveImportFilter ? `${mtimeFromFilter ? formatPreviewDateTime(Date.parse(mtimeFromFilter)) : "inizio scheda"} → ${mtimeToFilter ? formatPreviewDateTime(Date.parse(mtimeToFilter)) : "fine scheda"}${fileNameIncludesFilter ? ` · Nome: ${fileNameIncludesFilter}` : ""}` : "Tutti i file della scheda"}
          <p>Le date dei file non cambiano la data del lavoro. Puoi includere più giorni nello stesso evento.</p>
          <button className="secondary-button" onClick={onEditSelection ?? (() => { setSourceDetailsOpen(true); setShowSelectionFilters(true); })}>Modifica selezione sulla scheda</button>
          <button className="ghost-button" onClick={openVisualRangePicker} disabled={Boolean(explicitFiles) || loadingVisualPicker || !sdPath || importing}>Scegli primo e ultimo scatto</button>
          {visualPickerError && <p>{visualPickerError}</p>}
        </div>
      )}

      {activeView === "nuovo" && (
        <nav className="import-flow-nav" aria-label="Percorso di importazione">
          <button type="button" onClick={() => scrollToImportStep(destinationStepRef)}>
            <span>1</span><strong>Lavoro</strong><small>Nome e dati essenziali</small>
          </button>
          <button type="button" onClick={() => scrollToImportStep(sourceStepRef)}>
            <span>2</span><strong>Origine</strong><small>SD e filtro</small>
          </button>
          <button type="button" onClick={() => scrollToImportStep(confirmStepRef)}>
            <span>3</span><strong>Conferma</strong><small>Riepilogo e import</small>
          </button>
        </nav>
      )}

      {activeView === "impostazioni" && (
        <div className="panel-section" style={{ padding: "var(--space-4)" }}>
          <div className="stack">
            <strong>Impostazioni</strong>

            <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--text-muted)" }}>
              Imposta valori predefiniti e crea le cartelle rapide da usare nel campo sottocartella.
            </p>

            <div className="field">
              <span>Radice archivio</span>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  type="text"
                  value={archiveRoot}
                  onChange={(e) => setArchiveRoot(e.target.value)}
                  placeholder="es. E:\\"
                  style={{ flex: 1 }}
                />
                <button
                  className="secondary-button"
                  onClick={() => handleBrowse("archive")}
                  disabled={browsingField === "archive"}
                  style={{ flexShrink: 0, padding: "0.7rem 1rem", whiteSpace: "nowrap" }}
                >
                  {browsingField === "archive" ? "…" : "Sfoglia"}
                </button>
              </div>
            </div>

            <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)" }}>
              Archivio lavori usera questa cartella per leggere anche lavori non creati da Archivio Flow.
            </p>

            <div className="stack" style={{ gap: "0.55rem" }}>
              <span style={{ fontSize: "0.88rem", color: "var(--text-muted)" }}>
                Livelli gerarchia archivio (relativi alla radice)
              </span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.6rem" }}>
                <label className="field" style={{ gap: "0.35rem" }}>
                  <span>Livello Anno</span>
                  <select
                    value={archiveHierarchy.yearLevel ?? 0}
                    onChange={(e) => {
                      const parsed = Number.parseInt(e.target.value, 10);
                      setArchiveHierarchy((prev) => normalizeHierarchyConfig({
                        ...prev,
                        yearLevel: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
                      }));
                    }}
                  >
                    <option value={0}>Nessuno</option>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                    <option value={4}>4</option>
                    <option value={5}>5</option>
                    <option value={6}>6</option>
                  </select>
                </label>

                <label className="field" style={{ gap: "0.35rem" }}>
                  <span>Livello Categoria</span>
                  <select
                    value={archiveHierarchy.categoryLevel ?? 0}
                    onChange={(e) => {
                      const parsed = Number.parseInt(e.target.value, 10);
                      setArchiveHierarchy((prev) => normalizeHierarchyConfig({
                        ...prev,
                        categoryLevel: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
                      }));
                    }}
                  >
                    <option value={0}>Nessuno</option>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                    <option value={4}>4</option>
                    <option value={5}>5</option>
                    <option value={6}>6</option>
                  </select>
                </label>

                <label className="field" style={{ gap: "0.35rem" }}>
                  <span>Livello Lavoro</span>
                  <select
                    value={archiveHierarchy.jobLevel}
                    onChange={(e) => {
                      const parsed = Number.parseInt(e.target.value, 10);
                      setArchiveHierarchy((prev) => normalizeHierarchyConfig({
                        ...prev,
                        jobLevel: Number.isFinite(parsed) && parsed > 0 ? parsed : prev.jobLevel,
                      }));
                    }}
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                    <option value={4}>4</option>
                    <option value={5}>5</option>
                    <option value={6}>6</option>
                  </select>
                </label>
              </div>
              <span style={{ marginTop: "0.1rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                Esempio: anno=1, categoria=2, lavoro=3 per strutture tipo Anno/Categoria/NomeLavoro.
              </span>
            </div>

            <div className="field">
              <span>Nuova cartella predefinita</span>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  type="text"
                  value={nuovaCartellaPredefinita}
                  onChange={(e) => setNuovaCartellaPredefinita(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCartellaPredefinita();
                    }
                  }}
                  placeholder="es. Promessa"
                  style={{ flex: 1 }}
                />
                <button
                  className="secondary-button"
                  onClick={addCartellaPredefinita}
                  style={{ flexShrink: 0, padding: "0.7rem 1rem", whiteSpace: "nowrap" }}
                >
                  + Aggiungi
                </button>
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              {cartellePredefinite.length === 0 && (
                <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                  Nessuna cartella predefinita salvata.
                </span>
              )}
              {cartellePredefinite.map((cartella) => (
                <span
                  key={cartella}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    padding: "0.35rem 0.55rem",
                    borderRadius: "999px",
                    border: "1px solid var(--line-strong)",
                    background: "var(--accent-soft)",
                    fontSize: "0.82rem",
                  }}
                >
                  {cartella}
                  <button
                    onClick={() => removeCartellaPredefinita(cartella)}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      padding: 0,
                    }}
                    title="Rimuovi"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <div className="stack" style={{ gap: "0.45rem" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Template evento rapido:</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                <button
                  className="ghost-button"
                  onClick={() => applyEventoRapido("Promessa")}
                  style={{ padding: "0.45rem 0.75rem", fontSize: "0.84rem" }}
                >
                  Promessa
                </button>
                <button
                  className="ghost-button"
                  onClick={() => applyEventoRapido("Matrimonio")}
                  style={{ padding: "0.45rem 0.75rem", fontSize: "0.84rem" }}
                >
                  Matrimonio
                </button>
                <button
                  className="ghost-button"
                  onClick={() => applyEventoRapido("Prewedding")}
                  style={{ padding: "0.45rem 0.75rem", fontSize: "0.84rem" }}
                >
                  Prewedding
                </button>
              </div>
            </div>

            <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
              Salvataggio automatico impostazioni attivo.
            </span>

            {startupAtLogin !== null && (
              <label className="message-box" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", cursor: savingStartupAtLogin ? "wait" : "pointer" }}>
                <span>
                  <strong>Avvia Archivio Flow all'accensione di Windows</strong>
                  <small style={{ display: "block", marginTop: "0.25rem", color: "var(--text-muted)" }}>Resta in background e rileva le SD inserite.</small>
                </span>
                <input
                  type="checkbox"
                  checked={startupAtLogin}
                  disabled={savingStartupAtLogin}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    setSavingStartupAtLogin(true);
                    void setArchivioStartAtLogin(enabled)
                      .then((result) => { if (result !== null) setStartupAtLogin(result); })
                      .finally(() => setSavingStartupAtLogin(false));
                  }}
                />
              </label>
            )}

            {settingsFeedback && (
              <div
                className="message-box"
                style={{
                  borderColor:
                    settingsFeedback.type === "success"
                      ? "rgba(142, 178, 142, 0.4)"
                      : "rgba(212, 163, 156, 0.4)",
                  background:
                    settingsFeedback.type === "success"
                      ? "rgba(142, 178, 142, 0.08)"
                      : "rgba(212, 163, 156, 0.08)",
                }}
              >
                <p
                  style={{
                    color: settingsFeedback.type === "success" ? "var(--success)" : "var(--danger)",
                  }}
                >
                  {settingsFeedback.message}
                </p>
              </div>
            )}

            <button
              className="primary-button"
              onClick={handleSaveSettings}
              disabled={savingSettings || !settingsChanged}
              style={{ width: "fit-content", minWidth: "220px" }}
            >
              {savingSettings ? "Salvataggio…" : "Salva impostazioni"}
            </button>
          </div>
        </div>
      )}

      {activeView === "impostazioni" && (
        <details
          className="panel-section settings-disclosure"
          style={{ padding: "var(--space-4)" }}
          open={openSettingsSection !== null}
          onToggle={(event) => {
            if (event.target !== event.currentTarget) return;
            if ((event.currentTarget as HTMLDetailsElement).open) setOpenSettingsSection("studioflow");
            else setOpenSettingsSection(null);
          }}
        >
          <summary><strong>Motore locale StudioFlow</strong><span>›</span></summary>
          <div className="stack">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <div>
                <p style={{ margin: "0.35rem 0 0", color: "var(--text-muted)" }}>
                  Database {studioFlowStatus?.health.integrity ?? "…"} · schema {studioFlowStatus?.health.schemaVersion ?? "…"} · {archiveIndexLabel}
                </p>
              </div>
              <div className="button-row">
                <button className="ghost-button" title="Aggiorna soltanto le informazioni mostrate, senza avviare una scansione." onClick={() => void refreshStudioFlowStatus()} disabled={studioFlowBusy}>Aggiorna stato</button>
                <button className="secondary-button" title="Scansiona l’archivio in sola lettura e aggiorna l’indice locale. Le fotografie non vengono modificate." onClick={handleReconcileIndex} disabled={studioFlowBusy || archiveIsScanning || !archiveRoot.trim()}>
                  {archiveIsScanning ? "Scansione in corso…" : studioFlowBusy ? "Operazione in corso…" : "Riconcilia archivio"}
                </button>
                <button className="ghost-button" onClick={handleDriveSync} disabled={studioFlowBusy || (studioFlowStatus?.health.pendingOutbox ?? 0) === 0}>
                  Sincronizza Drive ({studioFlowStatus?.health.pendingOutbox ?? 0})
                </button>
              </div>
            </div>
            {archiveIsScanning && (
              <div className="message-box" style={{ borderColor: "var(--line-strong)", background: "rgba(184, 154, 99, 0.06)" }}>
                <p><strong>Indicizzazione in corso:</strong> il conteggio aumenta mentre StudioFlow legge le cartelle. È un’operazione in sola lettura: nessuna fotografia viene spostata, rinominata o eliminata. Attendi il completamento; il pulsante è disattivato automaticamente.</p>
              </div>
            )}
            {studioFlowError && <div className="message-box"><p style={{ color: "var(--danger)" }}>{studioFlowError}</p></div>}
            {studioFlowStatus?.archiveIndex.lastError && <div className="message-box"><p style={{ color: "var(--danger)" }}>{studioFlowStatus.archiveIndex.lastError}</p></div>}

            <details className="settings-disclosure settings-disclosure--nested" open={openSettingsSection === "categorie"} onToggle={(event) => {
              if (event.target !== event.currentTarget) return;
              if ((event.currentTarget as HTMLDetailsElement).open) setOpenSettingsSection("categorie");
              else setOpenSettingsSection("studioflow");
            }}>
              <summary><strong>Regole categorie</strong><span>›</span></summary>
              <div className="stack" style={{ gap: "0.85rem", marginTop: "0.85rem" }}>
                <div>
                  <strong>Dove salvare ogni tipo di lavoro</strong>
                  <p style={{ margin: "0.35rem 0 0", fontSize: "0.86rem", color: "var(--text-muted)" }}>
                  Crea una regola per Matrimoni, Battesimi, Shooting o qualsiasi altra categoria. Durante un nuovo lavoro ti basterà scegliere la categoria: Archivio Flow preparerà la destinazione.
                </p>
              </div>
              <div className="inline-grid inline-grid--2">
                <label className="field">
                  <span>1. Nome della categoria</span>
                  <input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="es. Matrimoni" />
                  <small>È il nome che vedrai quando crei un lavoro.</small>
                </label>
                <label className="field">
                  <span>2. Come organizzare le cartelle</span>
                  <select value={newCategoryLayout} onChange={(event) => setNewCategoryLayout(event.target.value as CategoryLayout)}>
                    <option value="year-category">Anno → Categoria (consigliato)</option>
                    <option value="category-year">Categoria → Anno</option>
                    <option value="category-only">Solo categoria</option>
                    <option value="custom">Percorso personalizzato</option>
                  </select>
                  <small>Non devi scrivere codici o percorsi tecnici.</small>
                </label>
              </div>

              {newCategoryLayout === "custom" && (
                <>
                {archiveFolders.length > 0 && <label className="field">
                  <span>Cartella già presente nell’archivio</span>
                  <select value="" onChange={(event) => { const folder = event.target.value; if (folder) { const category = folder.split(/[/\\\\]+/).pop() ?? folder; setNewCategoryPath(`{year}\\${category}`); } }}>
                    <option value="">Scegli una cartella esistente…</option>
                    {archiveFolders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
                  </select>
                  <small>Archivio Flow userà il nome reale della cartella, anche se la categoria ha un nome diverso.</small>
                  <small>Le cartelle mostrate appartengono alla radice archivio configurata sopra. Se non trovi quella giusta, controlla prima la radice.</small>
                </label>}
                <label className="field">
                  <span>Percorso personalizzato (avanzato)</span>
                  <input value={newCategoryPath} onChange={(event) => setNewCategoryPath(event.target.value)} placeholder="es. CLIENTI/{year}/MATRIMONI" />
                  <small>Puoi usare {'{year}'}, {'{month}'}, {'{client}'} e {'{date}'}.</small>
                </label>
                </>
              )}

              <div className="message-box" style={{ background: "rgba(255,255,255,0.04)" }}>
                <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.82rem" }}>Anteprima destinazione</p>
                <strong style={{ display: "block", marginTop: "0.35rem", overflowWrap: "anywhere" }}>{categoryDestinationPreview}</strong>
              </div>

              <div className="button-row">
                <button className="secondary-button" onClick={addCategoryMapping} disabled={!canSaveCategory}>
                  {editingCategoryId ? "Salva modifica" : "+ Crea regola categoria"}
                </button>
                {editingCategoryId && <button className="ghost-button" onClick={cancelCategoryEditing}>Annulla</button>}
              </div>

              {categoryMappings.length > 0 && <strong style={{ marginTop: "0.35rem" }}>Regole attive</strong>}
                {categoryMappings.map((mapping) => (
                <div key={mapping.id} className="message-box" style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <strong>{mapping.displayName}</strong>
                    <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.82rem" }}>
                      Salva in: {mapping.relativePathPattern.replace(/\{year\}/gi, categoryPreviewYear).replace(/\{month\}/gi, "08").replace(/\{client\}/gi, "Mario e Anna").replace(/\{date\}/gi, `${categoryPreviewYear}-08-20`)}
                    </p>
                  </div>
                  <div className="button-row">
                    <button className="ghost-button" onClick={() => editCategoryMapping(mapping)}>Modifica</button>
                    <button className="ghost-button" onClick={() => setCategoryMappings((items) => items.filter((item) => item.id !== mapping.id))}>Rimuovi</button>
                  </div>
                </div>
                ))}
              </div>
            </details>
            {(studioFlowStatus?.resumable.length ?? 0) > 0 && (
              <div className="stack" style={{ gap: "0.55rem" }}>
                <strong>Importazioni recuperabili</strong>
                {studioFlowStatus!.resumable.map((session) => (
                  <div key={session.id} className="message-box" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                    <div>
                      <strong>{session.status}</strong>
                      <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)" }}>
                        {session.sourceRoot} · {session.verifiedFiles}/{session.plannedFiles} verificati
                      </p>
                    </div>
                    <button className="secondary-button" onClick={() => void handleResumeSession(session.id)} disabled={studioFlowBusy}>Riprendi</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      )}

      {activeView === "nuovo" && (
        <>
      {/* SD Card section */}
      {/* Job data */}
      <div ref={destinationStepRef} className="panel-section import-step" style={{ padding: "var(--space-4)" }}>
        <div className="stack">
          <div>
            <span className="import-step__eyebrow">Lavoro</span>
            <strong>Dove salvare i file</strong>
            <p className="import-step__description">Crea un lavoro o aggiungi gli scatti a un lavoro già presente.</p>
          </div>

          <div className="button-row" role="group" aria-label="Lavoro di destinazione">
            <button className={!usaLavoroEsistente ? "primary-button" : "secondary-button"} aria-pressed={!usaLavoroEsistente} onClick={() => {
              if (!usaLavoroEsistente) return;
              setUsaLavoroEsistente(false);
              setExistingJobId("");
              setNomeLavoro("");
              setDataLavoro(initialSelection?.suggestedJobDate ?? initialDateFilter ?? todayIso());
              jobDateInitializedRef.current = false;
              setContrattoLink("");
              setSottoCartella("");
              setImportValidationState([]);
            }}>Nuovo lavoro</button>
            <button className={usaLavoroEsistente ? "primary-button" : "secondary-button"} aria-pressed={usaLavoroEsistente} onClick={() => {
              setUsaLavoroEsistente(true);
              setSottoCartella("");
              setImportValidationState([]);
            }}>Lavoro esistente</button>
          </div>

          {explicitFiles && jobSuggestions.length > 0 && <details className="import-advanced-panel">
            <summary>Lavori suggeriti · {jobSuggestions[0]!.job.nomeLavoro}</summary>
            <p>Conferma il lavoro: gli orari e le importazioni precedenti sono indizi.</p>
            {jobSuggestions.map(({ job, reason }) => <div key={job.id} style={{ marginBottom: ".6rem" }}><button className="secondary-button" onClick={() => { setUsaLavoroEsistente(true); setExistingJobId(job.id); setSottoCartella(""); setImportValidationState([]); }}>Usa {job.nomeLavoro} · {job.dataLavoro}</button><small style={{ display: "block" }}>{reason}</small></div>)}
          </details>}
          {usaLavoroEsistente && (
            <div className="stack" style={{ gap: "0.55rem" }}>
              <label className="field">
                <span>Cerca lavoro esistente</span>
                <input
                  type="text"
                  value={existingJobSearch}
                  onChange={(e) => setExistingJobSearch(e.target.value)}
                  placeholder="es. Ferdinando, 2026-06, matrimoni"
                />
              </label>

              <label className="field">
                <span>Seleziona lavoro esistente</span>
                <select
                  value={existingJobId}
                  onChange={(e) => {
                    setExistingJobId(e.target.value);
                    clearImportValidationField("existingJobId");
                  }}
                  style={getInvalidInputStyle("existingJobId")}
                >
                  <option value="">-- seleziona --</option>
                  {existingJobsForSelect.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.nomeLavoro} · {job.dataLavoro} · {job.autore}
                    </option>
                  ))}
                </select>
              </label>

              <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                {filteredExistingJobs.length} risultati su {jobsEsistenti.length} lavori esistenti.
              </span>
            </div>
          )}

          {!usaLavoroEsistente && categoryMappings.length > 0 && (
            <label className="field">
              <span>Categoria</span>
              <select value={categoryKey} onChange={(event) => { setCategoryKey(event.target.value); setDestinationOverride(false); setDestinazione(""); clearImportValidationField("destinazione"); }}>
                <option value="">Nessuna categoria automatica</option>
                {categoryMappings.filter((item) => item.enabled).map((mapping) => (
                  <option key={mapping.id} value={mapping.categoryKey}>{mapping.displayName} → {mapping.relativePathPattern}</option>
                ))}
              </select>
            </label>
          )}

          <div className="inline-grid inline-grid--2">
            <label className="field">
              <span>Nome lavoro / cliente</span>
              <input
                type="text"
                value={nomeLavoro}
                onChange={(e) => {
                  setNomeLavoro(e.target.value);
                  clearImportValidationField("nomeLavoro");
                }}
                placeholder="es. Maria Rossi Shooting"
                disabled={usaLavoroEsistente}
                style={getInvalidInputStyle("nomeLavoro")}
              />
            </label>

            <label className="field">
              <span>Data del lavoro (indipendente dai file selezionati)</span>
              <input
                type="date"
                value={dataLavoro}
                disabled={usaLavoroEsistente}
                onChange={(e) => {
                  jobDateInitializedRef.current = true;
                  setDataLavoro(e.target.value);
                  clearImportValidationField("dataLavoro");
                }}
                style={getInvalidInputStyle("dataLavoro")}
              />
            </label>
          </div>

          <label className="field">
            <span>Autore / fotografo</span>
            <input
              type="text"
              value={autore}
              onChange={(e) => {
                setAutore(e.target.value);
                clearImportValidationField("autore");
              }}
              placeholder="es. Gennaro"
              style={getInvalidInputStyle("autore")}
            />
          </label>

          <label className="field">
            <span>Link contratto (opzionale)</span>
            <input
              type="url"
              value={contrattoLink}
              onChange={(e) => setContrattoLink(e.target.value)}
              placeholder="https://..."
            />
          </label>

          <details><summary>Percorsi e opzioni di importazione</summary>
          {!usaLavoroEsistente && (
            <div className="field">
              <span>{categoryKey && !destinationOverride ? "Destinazione automatica (override opzionale)" : "Cartella di destinazione"}</span>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  type="text"
                  value={categoryKey && !destinationOverride ? mappedParentPreview : destinazione}
                  onChange={(e) => {
                    setDestinazione(e.target.value);
                    setDestinationOverride(true);
                    clearImportValidationField("destinazione");
                  }}
                  placeholder="C:\\Foto\\Lavori"
                  style={{ flex: 1, ...getInvalidInputStyle("destinazione") }}
                  disabled={Boolean(categoryKey) && !destinationOverride}
                />
                <button
                  className="secondary-button"
                  onClick={() => handleBrowse("dest")}
                  disabled={browsingField === "dest"}
                  style={{ flexShrink: 0, padding: "0.7rem 1rem", whiteSpace: "nowrap" }}
                >
                  {browsingField === "dest" ? "…" : categoryKey && !destinationOverride ? "Modifica destinazione" : "Sfoglia"}
                </button>
              </div>
            </div>
          )}

          {usaLavoroEsistente && selectedExistingJob && (
            <div className="message-box" style={{ background: "rgba(184, 154, 99, 0.08)", borderColor: "var(--line-strong)" }}>
              <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-muted)" }}>
                Stai aggiungendo file a <strong>{selectedExistingJob.nomeLavoro}</strong>. Cartella principale riutilizzata: <strong>{selectedExistingJob.percorsoCartella}</strong>
              </p>
            </div>
          )}

          <div className="stack" style={{ gap: "0.45rem" }}>
            <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Scegli dove mettere questi file:</span>
            <div className="import-folder-choices">
              <button
                type="button"
                className={sottoCartella ? "ghost-button" : "secondary-button"}
                onClick={() => setSottoCartella("")}
              >
                <strong>Cartella principale</strong>
                <small>{usaLavoroEsistente ? "Aggiungi senza creare una sottocartella" : "Usa direttamente la cartella dell'autore"}</small>
              </button>
              <label className="import-folder-choices__new">
                <span>Nuova cartella</span>
                <input
                  type="text"
                  value={sottoCartella}
                  onChange={(e) => setSottoCartella(e.target.value)}
                  placeholder="es. Promessa"
                />
              </label>
            </div>
            {usaLavoroEsistente && similarExistingFolders.length > 0 && !existingJobFolders.includes(sottoCartella) && (
              <div className="message-box" style={{ background: "rgba(184,154,99,0.1)", borderColor: "var(--line-strong)" }}>
                <p style={{ margin: 0, fontSize: "0.84rem" }}>Esiste già una cartella con nome simile. Puoi riutilizzarla:</p>
                <div className="button-row" style={{ marginTop: "0.45rem" }}>
                  {similarExistingFolders.map((folder) => (
                    <button type="button" key={folder} className="secondary-button" onClick={() => setSottoCartella(folder)}>Usa “{folder}”</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {usaLavoroEsistente && selectedExistingJob && (
            <div className="stack" style={{ gap: "0.45rem" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Cartelle già presenti nel lavoro:</span>
              {loadingExistingJobFolders ? (
                <span style={{ fontSize: "0.84rem", color: "var(--text-muted)" }}>Lettura cartelle…</span>
              ) : existingJobFoldersError ? (
                <span style={{ fontSize: "0.84rem", color: "var(--danger)" }}>{existingJobFoldersError}</span>
              ) : existingJobFolders.length > 0 ? (
                <div className="button-row" style={{ flexWrap: "wrap" }}>
                  {existingJobFolders.map((folder) => (
                    <button type="button" key={folder} className={sottoCartella === folder ? "secondary-button" : "ghost-button"} onClick={() => setSottoCartella(folder)} style={{ padding: "0.45rem 0.75rem", fontSize: "0.84rem" }}>
                      📁 {folder}
                    </button>
                  ))}
                </div>
              ) : (
                <span style={{ fontSize: "0.84rem", color: "var(--text-muted)" }}>Nessuna sottocartella presente per {autore || "questo autore"}.</span>
              )}
            </div>
          )}

          {cartellePredefinite.length > 0 && (
            <div className="stack" style={{ gap: "0.45rem" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{usaLavoroEsistente ? "Oppure scegli una cartella predefinita:" : "Cartelle predefinite:"}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {cartellePredefinite.map((cartella) => (
                  <button
                    key={cartella}
                    className={sottoCartella === cartella ? "secondary-button" : "ghost-button"}
                    onClick={() => {
                      if (usaLavoroEsistente) {
                        setNewNestedSubfolder("");
                        setPendingSubfolderParent(cartella);
                      } else {
                        setSottoCartella(cartella);
                      }
                    }}
                    style={{ padding: "0.45rem 0.75rem", fontSize: "0.84rem" }}
                  >
                    {cartella}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p style={{ margin: 0, fontSize: "0.86rem", color: "var(--text-muted)" }}>
            Foto in: <strong>{fotoDestFullPreview}</strong> · Video in: <strong>{videoDestFullPreview}</strong>
          </p>

          {!usaLavoroEsistente && (
            <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)" }}>
              Destinazione effettiva: <strong>{folderPreview}</strong>
              {savedAutore && <> · autore: <strong>{savedAutore}</strong></>}
            </p>
          )}

          {/* Folder name preview */}
          {folderPreview !== "—" && (
            <div className="message-box">
              <p>
                <span style={{ color: "var(--text-muted)", fontSize: "0.88rem" }}>
                  {usaLavoroEsistente ? "Cartella del lavoro esistente:  " : "Cartella che verrà creata:  "}
                </span>
                <strong style={{ fontFamily: "monospace", fontSize: "0.9rem" }}>{folderPreview}</strong>
              </p>
            </div>
          )}

          <details className="import-advanced-panel" open={showAdvancedImportOptions} onToggle={(event) => setShowAdvancedImportOptions((event.currentTarget as HTMLDetailsElement).open)}>
            <summary>Opzioni avanzate di importazione</summary>
            <div className="stack" style={{ gap: "0.6rem", marginTop: "0.75rem" }}>
            <label className="check-row" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={rinominaFile}
                onChange={(e) => setRinominaFile(e.target.checked)}
                style={{ width: 16, height: 16, cursor: "pointer" }}
              />
              <span>
                Rinomina file —{" "}
                <small style={{ color: "var(--text-muted)" }}>
                  es. MariaRossi_20260321_Gennaro_DSCF1234.RAF
                </small>
              </span>
            </label>

            <label className="check-row" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={generaJpg}
                onChange={(e) => setGeneraJpg(e.target.checked)}
                style={{ width: 16, height: 16, cursor: "pointer" }}
              />
              <span>
                Genera JPG compressi in BASSA_QUALITA —{" "}
                <small style={{ color: "var(--text-muted)" }}>max 1920px, qualità 70%</small>
              </span>
            </label>
            </div>
          </details>
          </details>
        </div>
      </div>

      {/* Error / result feedback */}
      <div ref={sourceStepRef} className="panel-section import-step" style={{ padding: "var(--space-4)" }}>
        <details open={sourceDetailsOpen} onToggle={(event) => setSourceDetailsOpen(event.currentTarget.open)}>
          <summary>Origine, conteggi e filtri avanzati</summary>
        <div className="stack">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <span className="import-step__eyebrow">Origine</span>
              <strong>Da dove importare</strong>
              <p className="import-step__description">Scegli la SD e, solo se necessario, limita i file da copiare.</p>
            </div>
            <button
              className="ghost-button"
              onClick={fetchSdCards}
              disabled={refreshingSd}
              style={{ padding: "0.5rem 0.9rem", fontSize: "0.88rem" }}
            >
              {refreshingSd ? "Aggiorno..." : "⟳ Aggiorna"}
            </button>
            <button
              className="ghost-button"
              onClick={() => void handleEjectSd()}
              disabled={ejectingSd || !sdCards.some((card) => card.path === sdPath)}
              style={{ padding: "0.5rem 0.9rem", fontSize: "0.88rem" }}
            >
              {ejectingSd ? "Espulsione…" : "⏏ Espelli"}
            </button>
          </div>

          {sdFeedback && <p role="status" style={{ color: "var(--text-muted)", margin: 0, fontSize: "0.9rem" }}>{sdFeedback}</p>}

          {sdCards.length > 0 && (
            <div className="stats-grid">
              {sdCards.map((card) => (
                <button
                  key={card.deviceId}
                  className={sdPath === card.path ? "stat-card stat-card--highlight" : "stat-card"}
                  style={{ cursor: "pointer", textAlign: "left" }}
                  onClick={() => {
                    setSdPath(card.path);
                    clearImportValidationField("sdPath");
                  }}
                >
                  <span>{card.volumeName || "SD Card"}</span>
                  <strong>{card.deviceId}</strong>
                  <small style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>
                    {formatBytes(card.freeSpace)} liberi di {formatBytes(card.totalSize)}
                  </small>
                </button>
              ))}
            </div>
          )}

          {sdCards.length === 0 && (
            <p style={{ color: "var(--text-muted)", margin: 0, fontSize: "0.9rem" }}>
              Nessuna SD rilevata automaticamente — usa Sfoglia o digita il percorso.
            </p>
          )}

          <div className="field">
            <span>Percorso SD card</span>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                type="text"
                value={sdPath}
                onChange={(e) => {
                  setSdPath(e.target.value);
                  clearImportValidationField("sdPath");
                }}
                placeholder="E:\\ oppure seleziona con Sfoglia"
                style={{ flex: 1, ...getInvalidInputStyle("sdPath") }}
              />
              <button
                className="secondary-button"
                onClick={() => handleBrowse("sd")}
                disabled={browsingField === "sd"}
                style={{ flexShrink: 0, padding: "0.7rem 1rem", whiteSpace: "nowrap" }}
              >
                {browsingField === "sd" ? "…" : "Sfoglia"}
              </button>
            </div>
          </div>

          {sdPath.trim() && !explicitFiles && (
            <div className="stats-grid">
              <div className="stat-card">
                <span>File totali</span>
                <strong>{loadingSd ? "…" : (sdPreview?.totalFiles ?? "—")}</strong>
              </div>
              <div className="stat-card stat-card--highlight">
                <span>File RAW</span>
                <strong>{loadingSd ? "…" : (sdPreview?.rawFiles ?? "—")}</strong>
              </div>
              <div className="stat-card">
                <span>File JPG</span>
                <strong>{loadingSd ? "…" : (sdPreview?.jpgFiles ?? "—")}</strong>
              </div>
              <div className="stat-card">
                <span>File video</span>
                <strong>{loadingSd ? "…" : (sdPreview?.videoFiles ?? "—")}</strong>
              </div>
              <div className="stat-card">
                <span>Altri file</span>
                <strong>{loadingSd ? "…" : (sdPreview?.otherFiles ?? "—")}</strong>
              </div>
            </div>
          )}

          {sdPath.trim() && (
            <details
              className="import-advanced-panel"
              onToggle={(event) => {
                if ((event.currentTarget as HTMLDetailsElement).open && !checkingSafe && !safeCheck) {
                  void handleSafeCheck();
                }
              }}
            >
              <summary>Verifica sicurezza della SD</summary>
              <div className="message-box" style={{
                borderColor: safeCheck?.status === "SAFE" ? "var(--success)" : safeCheck ? "#d4a35c" : "var(--line)",
              }}>
              <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                <div>
                  <strong>Sicurezza formattazione</strong>
                  <p style={{ margin: "0.35rem 0 0", color: "var(--text-muted)" }}>
                    {checkingSafe
                      ? "Scansione e confronto con l’archivio in corso: attendi l’esito prima di formattare la SD."
                      : safeCheck?.status === "SAFE"
                        ? `Tutto a posto: ${safeCheck.verifiedFiles}/${safeCheck.totalFiles} file hanno una copia identica e verificata nell’archivio.`
                        : safeCheck?.status === "PARTIAL"
                          ? `Attenzione: ${safeCheck.verifiedFiles}/${safeCheck.totalFiles} file verificati. ${safeCheck.reason ?? "Non formattare ancora la SD."}`
                          : safeCheck?.status === "UNSAFE"
                            ? `Non formattare la SD: ${safeCheck.reason ?? "non risulta alcuna copia verificata nell’archivio."}`
                            : safeCheck?.status === "UNKNOWN"
                              ? `Esito non disponibile: ${safeCheck.reason ?? "non è possibile stabilire se la SD sia al sicuro."}`
                              : safeCheckError ?? "Aprendo questa sezione parte automaticamente il controllo. Nessuna formattazione viene eseguita da qui."}
                  </p>
                </div>
                <button className="secondary-button" onClick={handleSafeCheck} disabled={checkingSafe || importing}>
                  {checkingSafe ? "Verifica in corso…" : safeCheck ? "Ripeti verifica" : "Verifica SD"}
                </button>
              </div>
              </div>
            </details>
          )}

          {sdPath.trim() && (
            <div
              className="message-box"
              style={{
                background: "rgba(255,255,255,0.04)",
                borderColor:
                  (invalidImportFields.showSelectionFilters || invalidImportFields.filters || invalidImportFields.rangeOverlap)
                    ? "rgba(212, 163, 156, 0.45)"
                    : "var(--line)",
              }}
            >
              <p style={{ marginBottom: "0.55rem" }}>
                <strong>Selezione dei file</strong>: importa tutta la scheda oppure delimita un intervallo.
              </p>
              <div className="button-row">
                <button
                  className={showSelectionFilters === false ? "secondary-button" : "ghost-button"}
                  onClick={() => {
                    setShowSelectionFilters(false);
                    setMtimeFromFilter("");
                    setMtimeToFilter("");
                    setFileNameIncludesFilter("");
                    clearImportValidationField("showSelectionFilters");
                    clearImportValidationField("filters");
                    clearImportValidationField("rangeOverlap");
                  }}
                  style={{ padding: "0.45rem 0.75rem", fontSize: "0.84rem" }}
                >
                  Tutta la scheda
                </button>
                <button
                  className={showSelectionFilters === true ? "secondary-button" : "ghost-button"}
                  onClick={() => {
                    setShowSelectionFilters(true);
                    clearImportValidationField("showSelectionFilters");
                  }}
                  style={{ padding: "0.45rem 0.75rem", fontSize: "0.84rem" }}
                >
                  Date / intervallo / nome
                </button>
              </div>

              {showSelectionFilters === true && (
                <div className="stack" style={{ marginTop: "0.55rem", gap: "0.45rem" }}>
                  <p style={{ margin: 0, fontSize: "0.84rem", color: "var(--text-muted)" }}>
                    Orari basati sulla modifica dei file (mtime), non sui dati EXIF. Inizio e fine inclusi, anche oltre mezzanotte; i file con lo stesso orario sono inclusi insieme.
                  </p>

                  <label className="field">
                    <span>Filtro nome file contiene (opzionale)</span>
                    <input
                      type="text"
                      value={fileNameIncludesFilter}
                      onChange={(e) => {
                        setFileNameIncludesFilter(e.target.value);
                        clearImportValidationField("filters");
                        clearImportValidationField("rangeOverlap");
                      }}
                      placeholder="es. DSCF oppure IMG_"
                      style={getInvalidInputStyle("filters")}
                    />
                  </label>

                  <div className="inline-grid inline-grid--2">
                    <DateFilterPicker
                      label="Data iniziale (opzionale)"
                      value={mtimeFromFilter}
                      boundary="start"
                      invalid={Boolean(invalidImportFields.filters)}
                      onChange={(value) => {
                        setMtimeFromFilter(value);
                        clearImportValidationField("filters");
                        clearImportValidationField("rangeOverlap");
                      }}
                    />
                    <DateFilterPicker
                      label="Data finale (opzionale)"
                      value={mtimeToFilter}
                      boundary="end"
                      invalid={Boolean(invalidImportFields.filters)}
                      onChange={(value) => {
                        setMtimeToFilter(value);
                        clearImportValidationField("filters");
                        clearImportValidationField("rangeOverlap");
                      }}
                    />
                  </div>

                  <label className="check-row" style={{ cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={allowRangeOverlap}
                      onChange={(e) => {
                        setAllowRangeOverlap(e.target.checked);
                        if (e.target.checked) clearImportValidationField("rangeOverlap");
                      }}
                      style={{ width: 16, height: 16, cursor: "pointer" }}
                    />
                    <span>Consenti sovrapposizione con intervalli usati in questa sessione</span>
                  </label>

                  <div className="button-row">
                    <button
                      className="secondary-button"
                      onClick={handleFilterPreview}
                      disabled={loadingFilterPreview}
                      style={{ padding: "0.45rem 0.8rem", fontSize: "0.84rem" }}
                    >
                      {loadingFilterPreview ? "Anteprima in corso..." : "Anteprima filtro"}
                    </button>
                    <button
                      className="ghost-button"
                      onClick={openVisualRangePicker}
                      disabled={loadingVisualPicker || (!filterPreview && !sdPath.trim())}
                      style={{ padding: "0.45rem 0.8rem", fontSize: "0.84rem" }}
                    >
                      {loadingVisualPicker ? "Carico i file multimediali..." : "Selettore visuale"}
                    </button>
                  </div>

                  {visualPickerError && (
                    <p style={{ margin: 0, fontSize: "0.84rem", color: "var(--danger)" }}>
                      {visualPickerError}
                    </p>
                  )}

                  {filterPreviewError && (
                    <p style={{ margin: 0, fontSize: "0.84rem", color: "var(--danger)" }}>
                      {filterPreviewError}
                    </p>
                  )}

                  {filterPreview && (
                    <div className="message-box" style={{ background: "rgba(255,255,255,0.03)", borderColor: "var(--line)" }}>
                      <p style={{ margin: 0 }}>
                        Match filtro: <strong>{filterPreview.matchedFiles}</strong> file
                        (foto {filterPreview.matchedRawFiles + filterPreview.matchedJpgFiles}, video {filterPreview.matchedVideoFiles}, altri {filterPreview.matchedOtherFiles})
                      </p>
                      <p style={{ margin: "0.35rem 0 0", fontSize: "0.82rem", color: "var(--text-muted)" }}>
                        Scansionati: {filterPreview.scannedFiles}
                        {filterPreview.minMtimeMs !== null && filterPreview.maxMtimeMs !== null && (
                          <> · Intervallo: {formatPreviewDateTime(filterPreview.minMtimeMs)} → {formatPreviewDateTime(filterPreview.maxMtimeMs)}</>
                        )}
                      </p>

                      <p style={{ margin: "0.45rem 0 0", fontSize: "0.82rem", color: "var(--text-muted)" }}>
                        Selezione range: clicca una card per INIZIO, clicca una seconda card per FINE.
                      </p>

                      <div className="button-row" style={{ marginTop: "0.45rem" }}>
                        <button
                          className="ghost-button"
                          onClick={() => {
                            setPreviewRangeStartMs(null);
                            setPreviewRangeEndMs(null);
                          }}
                          style={{ padding: "0.4rem 0.7rem", fontSize: "0.82rem" }}
                        >
                          Azzera selezione
                        </button>
                        <button
                          className="secondary-button"
                          onClick={applyPreviewRangeToFilters}
                          disabled={previewRangeStartMs === null || previewRangeEndMs === null}
                          style={{ padding: "0.4rem 0.7rem", fontSize: "0.82rem" }}
                        >
                          Usa range come filtro lavoro
                        </button>
                      </div>

                      {previewRangeStartMs !== null && (
                        <p style={{ margin: "0.45rem 0 0", fontSize: "0.82rem", color: "var(--text-muted)" }}>
                          Inizio: {formatPreviewDateTime(previewRangeStartMs)}
                          {previewRangeEndMs !== null && ` · Fine: ${formatPreviewDateTime(previewRangeEndMs)}`}
                        </p>
                      )}

                      {importedRangesForCurrentSd.length > 0 && (
                        <div style={{ marginTop: "0.6rem" }}>
                          <p style={{ margin: "0 0 0.35rem", fontSize: "0.82rem", color: "var(--text-muted)" }}>
                            Intervalli usati in questa sessione (non attestano una copia verificata):
                          </p>
                          <div className="stack" style={{ gap: "0.35rem" }}>
                            {importedRangesForCurrentSd.map((r, i) => (
                              <div
                                key={`${r.startMs}-${r.endMs}-${i}`}
                                style={{
                                  display: "flex",
                                  gap: "0.45rem",
                                  flexWrap: "wrap",
                                  alignItems: "center",
                                  border: "1px solid var(--line)",
                                  borderRadius: 8,
                                  padding: "0.35rem 0.45rem",
                                  background: "rgba(255,255,255,0.02)",
                                }}
                              >
                                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                                  {r.label}: {formatPreviewDateTime(r.startMs)} → {formatPreviewDateTime(r.endMs)}
                                </span>
                                <button
                                  className="ghost-button"
                                  onClick={() => applyImportedRange(r)}
                                  style={{ padding: "0.28rem 0.55rem", fontSize: "0.78rem" }}
                                >
                                  Usa
                                </button>
                                <button
                                  className="ghost-button"
                                  onClick={() => removeImportedRange(i)}
                                  style={{ padding: "0.28rem 0.55rem", fontSize: "0.78rem" }}
                                >
                                  Rimuovi
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {filterPreview.sampleFiles.length > 0 && (
                        <div style={{ marginTop: "0.6rem", display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: "0.5rem" }}>
                          {filterPreview.sampleFiles.map((f, idx) => (
                            <div
                              key={`${f.filePath}-${idx}`}
                              style={{
                                border: isWithinSelectedRange(f.mtimeMs)
                                  ? "1px solid var(--line-strong)"
                                  : "1px solid var(--line)",
                                borderRadius: 10,
                                padding: "0.35rem",
                                background: "rgba(0,0,0,0.15)",
                                cursor: "pointer",
                              }}
                              onClick={() => selectPreviewPoint(f.mtimeMs)}
                              title="Clicca per impostare inizio/fine range"
                            >
                              {isPreviewableMedia(f) ? (
                                <DesktopPreviewImage
                                  sdPath={sdPath.trim()}
                                  filePath={f.filePath}
                                  sourceFileKey={buildPreviewSourceKey(f)}
                                  alt={f.fileName}
                                  style={{ width: "100%", height: 90, objectFit: "cover", borderRadius: 7, marginBottom: "0.35rem" }}
                                />
                              ) : (
                                <div
                                  style={{
                                    width: "100%",
                                    height: 90,
                                    borderRadius: 7,
                                    marginBottom: "0.35rem",
                                    background: "rgba(255,255,255,0.05)",
                                    display: "grid",
                                    placeItems: "center",
                                    color: "var(--text-muted)",
                                    fontSize: "0.8rem",
                                  }}
                                >
                                  {f.mediaType === "photo" ? "RAW" : "ALTRO"} {f.ext.toUpperCase()}
                                </div>
                              )}
                              <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", wordBreak: "break-all" }}>{f.fileName}</div>
                              <div style={{ fontSize: "0.74rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                                {formatBytes(f.size)} · {formatPreviewDateTime(f.mtimeMs)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        </details>
      </div>

      {importing && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(7, 10, 9, 0.72)",
            display: "grid",
            placeItems: "center",
            zIndex: 60,
            padding: "1rem",
          }}
        >
          <div
            className="panel-section"
            style={{
              width: "min(760px, 100%)",
              padding: "1.1rem",
              borderColor: "var(--line-strong)",
              background: "rgba(27, 33, 30, 0.98)",
            }}
          >
            <div className="stack" style={{ gap: "0.8rem" }}>
              <strong style={{ fontSize: "1.02rem" }}>Stato import in corso</strong>
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.9rem" }}>
                {progressPhaseLabel}
              </p>

              <div style={{ display: "grid", gap: "0.35rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem" }}>
                  <span>Avanzamento totale</span>
                  <strong>{overallProgressPct}%</strong>
                </div>
                <div style={{ width: "100%", height: 12, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${overallProgressPct}%`,
                      height: "100%",
                      background: "linear-gradient(90deg, #b89a63, #9ac69a)",
                      transition: "width 220ms ease",
                    }}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.8rem", color: "var(--text-muted)", fontSize: "0.82rem" }}>
                  <span>
                    {displayedCompletedFiles}/{displayedPlannedFiles} file completati
                  </span>
                  <span>Restano {Math.max(0, displayedPlannedFiles - displayedCompletedFiles)}</span>
                </div>
              </div>

              <div style={{ display: "grid", gap: "0.55rem" }}>
                <div style={{ display: "grid", gap: "0.35rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.86rem" }}>
                    <span style={{ color: copyStepDone ? "var(--success)" : "var(--text)" }}>
                      {copyStepDone ? "✓" : "⏳"} Copia file
                    </span>
                    <span style={{ color: "var(--text-muted)" }}>{copyProgressPct}%</span>
                  </div>
                  <div style={{ width: "100%", height: 10, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${copyProgressPct}%`,
                        height: "100%",
                        background: "linear-gradient(90deg, #b89a63, #d4c1aa)",
                        transition: "width 220ms ease",
                      }}
                    />
                  </div>
                </div>

                {bqStepVisible && (
                  <div style={{ display: "grid", gap: "0.35rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.86rem" }}>
                      <span style={{ color: bqStepDone ? "var(--success)" : "var(--text)" }}>
                        {bqStepDone ? "✓" : "⏳"} Export Bassa Qualita
                      </span>
                      <span style={{ color: "var(--text-muted)" }}>{bqProgressPct}%</span>
                    </div>
                    <div style={{ width: "100%", height: 10, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${Math.max(0, bqProgressPct)}%`,
                          height: "100%",
                          background: "linear-gradient(90deg, #7ea37e, #9ac69a)",
                          transition: "width 220ms ease",
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="stats-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                <div className="stat-card">
                  <span>File totali</span>
                  <strong style={{ fontSize: "1.05rem" }}>
                    {displayedCompletedFiles}/{displayedPlannedFiles}
                  </strong>
                </div>
                <div className="stat-card">
                  <span>Velocita</span>
                  <strong style={{ fontSize: "1.05rem" }}>
                    {formatItemsPerSecond(importProgress?.currentSpeedFilesPerSec)}
                  </strong>
                </div>
                <div className="stat-card">
                  <span>Tempo stimato</span>
                  <strong style={{ fontSize: "1.05rem" }}>
                    {importProgress?.estimatedRemainingSec !== null
                      ? formatDurationSeconds(importProgress?.estimatedRemainingSec ?? 0)
                      : "in attesa dati reali"}
                  </strong>
                </div>
              </div>

              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.84rem" }}>
                Trascorso {formatDurationSeconds(displayedElapsedMs / 1000)} · Copiati {importProgress?.copiedFiles ?? 0} · Saltati {importProgress?.skippedFiles ?? 0}
              </p>
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.84rem" }}>
                Velocita trasferimento {formatTransferRate(importProgress?.currentSpeedBytesPerSec)} | File corrente {(importProgress?.currentFileName ?? "").trim() || "calcolo file corrente..."} | JPG BQ {importProgress?.jpgDone ?? 0}/{Math.max(importProgress?.jpgPlanned ?? 0, 0)}
              </p>
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.82rem", wordBreak: "break-all" }}>
                Destinazione: {importProgress?.targetFolder || initialImportTargetFolder}
              </p>
              <div className="button-row" style={{ marginTop: "0.5rem" }}>
                <button
                  className="ghost-button"
                  onClick={() => { void handleCancelRunningImport(); }}
                  style={{ padding: "0.5rem 0.8rem", fontSize: "0.84rem" }}
                >
                  Interrompi importazione
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {importError && (
        <div
          className="message-box"
          style={{ borderColor: "rgba(212, 163, 156, 0.4)", background: "rgba(212, 163, 156, 0.08)" }}
        >
          <p style={{ color: "var(--danger)" }}>⚠ {importError}</p>
          {importValidationIssues.length > 0 && (
            <ul className="import-validation-list">
              {importValidationIssues.map((issue, idx) => (
                <li key={`${issue.field}-${idx}`}>{issue.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {importSuccess && (
        <div
          className="message-box"
          style={{
            borderColor: importSuccess.incomplete ? "rgba(184, 154, 99, 0.45)" : "rgba(142, 178, 142, 0.4)",
            background: importSuccess.incomplete ? "rgba(184, 154, 99, 0.1)" : "rgba(142, 178, 142, 0.08)",
          }}
        >
          <p style={{ color: importSuccess.incomplete ? "var(--accent-strong)" : "var(--success)" }}>
            {importSuccess.incomplete ? "Importazione incompleta" : "✓ Importazione completata"} — {importSuccess.copiedFiles} file copiati
            {importSuccess.jpgGenerati > 0 && `, ${importSuccess.jpgGenerati} JPG compressi`}
            {importSuccess.errors.length > 0 && ` (${importSuccess.errors.length} errori)`}
          </p>
          {importSuccess.errors.length > 0 && (
            <ul style={{ margin: "0.45rem 0 0", paddingLeft: "1.1rem", color: "var(--danger)", fontSize: "0.8rem" }}>
              {importSuccess.errors.slice(0, 20).map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}
            </ul>
          )}
          <p style={{ margin: "0.4rem 0 0", fontSize: "0.88rem", color: "var(--text-muted)" }}>
            Foto: {importSuccess.cartellaFotoFinale || importSuccess.job.percorsoCartella}
            {importSuccess.videoFiles > 0 && <> · Video: {importSuccess.cartellaVideoFinale}</>}
          </p>
          {importSuccess.job.contrattoLink && (
            <p style={{ margin: "0.35rem 0 0", fontSize: "0.88rem" }}>
              <a
                href={importSuccess.job.contrattoLink}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--accent-strong)", wordBreak: "break-all" }}
              >
                Apri contratto: {importSuccess.job.contrattoLink}
              </a>
            </p>
          )}
          <div className="button-row" style={{ marginTop: "0.6rem" }}>
            <button
              className="secondary-button"
              style={{ padding: "0.5rem 0.8rem", fontSize: "0.86rem" }}
              onClick={() => { void openImportDestinationFolders(importSuccess); }}
            >
              📂 Apri cartelle importate
            </button>
          </div>
        </div>
      )}

      {/* Import CTA */}
      <div ref={confirmStepRef} className="setup-footer import-step import-step--confirm">
        <div>
          <span className="import-step__eyebrow">Passo 3</span>
          <strong>Controlla e importa</strong>
          <p>
            Foto in <code style={{ fontSize: "0.88rem" }}>{fotoDestFullPreview}</code> e video in <code style={{ fontSize: "0.88rem" }}>{videoDestFullPreview}</code>.
          </p>
          <div className="import-summary" aria-label="Riepilogo importazione">
            <div><span>Origine</span><strong>{sdPath.trim() || "SD da selezionare"}</strong></div>
            <div><span>File</span><strong>{explicitFiles ? `${explicitFiles.length} selezionati esattamente` : hasActiveImportFilter && loadingFilterPreview ? "Calcolo selezione…" : filterPreview ? `${filterPreview.matchedFiles} filtrati` : hasActiveImportFilter ? "Selezione da calcolare" : sdPreview ? `${sdPreview.totalFiles} totali · ${sdPreview.rawFiles} RAW · ${sdPreview.jpgFiles} JPG` : "Da rilevare"}</strong></div>
            <div><span>Destinazione</span><strong>{folderPreview}</strong></div>
            <div><span>Opzioni</span><strong>{rinominaFile ? "Rinomina attiva" : "Nessuna rinomina"}{generaJpg ? " · JPG BQ" : ""}</strong></div>
          </div>
          {!canImport && !importing && (
            <p style={{ marginTop: "0.45rem", color: "var(--danger)", fontSize: "0.85rem" }}>
              Mancano campi obbligatori. Premi IMPORTA per vedere esattamente cosa completare.
            </p>
          )}
          <label className="check-row" style={{ marginTop: "0.45rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={openFolderOnFinish}
              onChange={(e) => setOpenFolderOnFinish(e.target.checked)}
              style={{ width: 16, height: 16, cursor: "pointer" }}
            />
            <span>Apri automaticamente la cartella al termine</span>
          </label>
          <label className="check-row" style={{ marginTop: "0.35rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={desktopNotifyOnFinish}
              onChange={(e) => setDesktopNotifyOnFinish(e.target.checked)}
              style={{ width: 16, height: 16, cursor: "pointer" }}
            />
            <span>Mostra notifica desktop a fine import</span>
          </label>
          <label className="check-row" style={{ marginTop: "0.35rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={soundNotifyOnFinish}
              onChange={(e) => setSoundNotifyOnFinish(e.target.checked)}
              style={{ width: 16, height: 16, cursor: "pointer" }}
            />
            <span>Riproduci suono a fine import</span>
          </label>
          <p className="import-preferences-note">Le opzioni di importazione vengono ricordate su questo computer.</p>
        </div>
        <div className="setup-footer__action">
          <button
            className="primary-button"
            style={{ width: "100%" }}
            onClick={() => { void handleImport(); }}
            disabled={importing}
          >
            {importing ? "Importazione in corso…" : "▶ IMPORTA"}
          </button>
        </div>
      </div>
        </>
      )}

      {showQuickAddSetup && selectedExistingJob && (
        <div className="quick-add-modal__backdrop" role="presentation">
          <div className="panel-section quick-add-modal" role="dialog" aria-modal="true" aria-labelledby="quick-add-title">
            <div className="stack" style={{ gap: "0.85rem" }}>
              <div>
                <span className="import-step__eyebrow">Aggiungi file</span>
                <h3 id="quick-add-title">{selectedExistingJob.nomeLavoro}</h3>
                <p>Gli scatti verranno aggiunti a questo lavoro. Scegli ora la cartella, poi seleziona la SD.</p>
              </div>
              <button
                type="button"
                className={sottoCartella ? "ghost-button" : "secondary-button"}
                onClick={() => setSottoCartella("")}
              >
                Cartella principale
              </button>
              {cartellePredefinite.length > 0 && (
                <div className="stack" style={{ gap: "0.4rem" }}>
                  <span className="quick-add-modal__label">Cartelle predefinite</span>
                  <div className="button-row">
                    {cartellePredefinite.map((cartella) => (
                      <button type="button" key={cartella} className={sottoCartella === cartella ? "secondary-button" : "ghost-button"} onClick={() => setSottoCartella(cartella)}>
                        {cartella}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {existingJobFolders.length > 0 && (
                <div className="stack" style={{ gap: "0.4rem" }}>
                  <span className="quick-add-modal__label">Cartelle già presenti nel lavoro</span>
                  <div className="button-row" style={{ flexWrap: "wrap" }}>
                    {existingJobFolders.map((folder) => (
                      <button type="button" key={folder} className={sottoCartella === folder ? "secondary-button" : "ghost-button"} onClick={() => setSottoCartella(folder)}>
                        📁 {folder}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <label className="field">
                <span>Oppure crea una nuova cartella</span>
                <input value={sottoCartella} onChange={(event) => setSottoCartella(event.target.value)} placeholder="es. Cerimonia" />
              </label>
              {similarExistingFolders.length > 0 && !existingJobFolders.includes(sottoCartella) && (
                <p style={{ margin: 0, color: "var(--accent-strong)", fontSize: "0.84rem" }}>
                  Nome simile già presente: {similarExistingFolders.map((folder) => `“${folder}”`).join(", ")}.
                </p>
              )}
              <p className="quick-add-modal__destination">Foto: <strong>{fotoDestPreview}</strong> · Video: <strong>{videoDestPreview}</strong></p>
              <div className="button-row" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="ghost-button" onClick={() => setShowQuickAddSetup(false)}>Apri flusso completo</button>
                <button type="button" className="primary-button" onClick={() => {
                  setShowQuickAddSetup(false);
                  window.setTimeout(() => scrollToImportStep(sourceStepRef), 0);
                }}>Continua: scegli SD</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <FilterRangePickerModal
        sourceIdentity={initialSdPath === sdPath ? initialSelection?.sourceIdentity : undefined}
        open={showVisualRangePicker}
        sdPath={sdPath.trim()}
        samples={visualPickerSamples}
        truncated={visualPickerTruncated}
        importedRanges={[]}
        onClose={() => setShowVisualRangePicker(false)}
        onApplyRange={handleApplyVisualRange}
      />
    </div>
  );
}
