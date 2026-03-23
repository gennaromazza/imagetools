import { useCallback, useEffect, useRef, useState } from "react";
import type { SdCard, SdPreview, ImportResult, Job, ImportProgressSnapshot } from "../types";
import { FilterRangePickerModal } from "./FilterRangePickerModal";

interface Props {
  onImportDone: (result: ImportResult) => void;
  activeView?: "nuovo" | "impostazioni";
}

interface FilterPreviewData {
  scannedFiles: number;
  matchedFiles: number;
  matchedRawFiles: number;
  matchedJpgFiles: number;
  minMtimeMs: number | null;
  maxMtimeMs: number | null;
  sampleFiles: Array<{ filePath: string; fileName: string; mtimeMs: number; size: number; ext: string; isJpg: boolean }>;
}

interface ImportedRangeRecord {
  startMs: number;
  endMs: number;
  label: string;
  importedAtIso: string;
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

function formatDurationSeconds(seconds: number): string {
  const sec = Math.max(0, Math.floor(seconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function NuovoLavoroPanel({ onImportDone, activeView = "nuovo" }: Props) {
  // ── SD detection ────────────────────────────────────────────────────────────
  const [sdCards, setSdCards] = useState<SdCard[]>([]);
  const [sdPath, setSdPath] = useState("");
  const [sdPreview, setSdPreview] = useState<SdPreview | null>(null);
  const [loadingSd, setLoadingSd] = useState(false);
  const [refreshingSd, setRefreshingSd] = useState(false);
  const [hasMultipleJobsOnSd, setHasMultipleJobsOnSd] = useState<boolean | null>(null);
  const [showMultiJobConfirm, setShowMultiJobConfirm] = useState(false);
  const [fileNameIncludesFilter, setFileNameIncludesFilter] = useState("");
  const [mtimeFromFilter, setMtimeFromFilter] = useState("");
  const [mtimeToFilter, setMtimeToFilter] = useState("");
  const [filterPreview, setFilterPreview] = useState<FilterPreviewData | null>(null);
  const [loadingFilterPreview, setLoadingFilterPreview] = useState(false);
  const [filterPreviewError, setFilterPreviewError] = useState<string | null>(null);
  const [previewRangeStartMs, setPreviewRangeStartMs] = useState<number | null>(null);
  const [previewRangeEndMs, setPreviewRangeEndMs] = useState<number | null>(null);
  const [showVisualRangePicker, setShowVisualRangePicker] = useState(false);
  const [visualPickerSamples, setVisualPickerSamples] = useState<FilterPreviewData["sampleFiles"]>([]);
  const [loadingVisualPicker, setLoadingVisualPicker] = useState(false);
  const [visualPickerError, setVisualPickerError] = useState<string | null>(null);
  const [importedRangesBySd, setImportedRangesBySd] = useState<Record<string, ImportedRangeRecord[]>>({});
  const [allowRangeOverlap, setAllowRangeOverlap] = useState(false);

  // ── Form fields ─────────────────────────────────────────────────────────────
  const [nomeLavoro, setNomeLavoro] = useState("");
  const [dataLavoro, setDataLavoro] = useState(todayIso());
  const [autore, setAutore] = useState("");
  const [contrattoLink, setContrattoLink] = useState("");
  const [destinazione, setDestinazione] = useState("");
  const [sottoCartella, setSottoCartella] = useState("");
  const [rinominaFile, setRinominaFile] = useState(true);
  const [generaJpg, setGeneraJpg] = useState(false);
  const [usaLavoroEsistente, setUsaLavoroEsistente] = useState(false);
  const [jobsEsistenti, setJobsEsistenti] = useState<Job[]>([]);
  const [existingJobId, setExistingJobId] = useState("");

  // ── Import state ─────────────────────────────────────────────────────────────
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<ImportResult | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgressSnapshot | null>(null);

  // ── Settings ─────────────────────────────────────────────────────────────────
  const [savedDestinazione, setSavedDestinazione] = useState("");
  const [archiveRoot, setArchiveRoot] = useState("");
  const [savedArchiveRoot, setSavedArchiveRoot] = useState("");
  const [savedAutore, setSavedAutore] = useState("");
  const [cartellePredefinite, setCartellePredefinite] = useState<string[]>([]);
  const [savedCartellePredefinite, setSavedCartellePredefinite] = useState<string[]>([]);
  const [nuovaCartellaPredefinita, setNuovaCartellaPredefinita] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsFeedback, setSettingsFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const [browsingField, setBrowsingField] = useState<"sd" | "dest" | "archive" | null>(null);

  // ── Load settings on mount ───────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { archiveRoot?: string; defaultDestinazione?: string; defaultAutore?: string; cartellePredefinite?: string[] } | null) => {
        const normalizedArchiveRoot = data?.archiveRoot?.trim() ?? "";
        const normalizedDefaultDestinazione = data?.defaultDestinazione?.trim() || normalizedArchiveRoot;
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
      })
      .catch(() => {/* server not ready */})
      .finally(() => {
        setSettingsLoaded(true);
      });
  }, []);

  useEffect(() => {
    fetch("/api/jobs")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Job[]) => {
        setJobsEsistenti(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        setJobsEsistenti([]);
      });
  }, []);

  useEffect(() => {
    if (!usaLavoroEsistente || !existingJobId) return;
    const selected = jobsEsistenti.find((j) => j.id === existingJobId);
    if (!selected) return;
    setContrattoLink(selected.contrattoLink ?? "");
  }, [usaLavoroEsistente, existingJobId, jobsEsistenti]);

  const fetchSdCards = useCallback(async () => {
    setRefreshingSd(true);
    try {
      const res = await fetch("/api/sd-cards");
      if (res.ok) {
        const data = await res.json();
        const cards: SdCard[] = data.sdCards ?? [];
        setSdCards(cards);
        if (cards.length > 0 && !sdPath) {
          setSdPath(cards[0]!.path);
        }
      }
    } catch {
      /* server not ready yet */
    } finally {
      setRefreshingSd(false);
    }
  }, [sdPath]);

  // Load SD cards on mount
  useEffect(() => {
    fetchSdCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Browse helper ────────────────────────────────────────────────────────────
  async function handleBrowse(field: "sd" | "dest" | "archive") {
    setBrowsingField(field);
    try {
      const res = await fetch("/api/browse-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.path) {
          if (field === "sd") setSdPath(data.path as string);
          else if (field === "dest") setDestinazione(data.path as string);
          else setArchiveRoot(data.path as string);
        }
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
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          archiveRoot: normalizedArchiveRoot,
          defaultDestinazione: normalizedDefaultDestinazione,
          defaultAutore: autore.trim(),
          cartellePredefinite,
        }),
      });
      if (res.ok) {
        setSavedArchiveRoot(normalizedArchiveRoot);
        setSavedDestinazione(normalizedDefaultDestinazione);
        if (!destinazione.trim() && normalizedDefaultDestinazione) {
          setDestinazione(normalizedDefaultDestinazione);
        }
        setSavedAutore(autore.trim());
        setSavedCartellePredefinite(cartellePredefinite);
        setSettingsFeedback({
          type: "success",
          message: showSpinner ? "Impostazioni salvate." : "Impostazioni salvate automaticamente.",
        });
      } else {
        const errorData = await res.json().catch(() => ({}));
        setSettingsFeedback({
          type: "error",
          message: errorData?.error ? `Salvataggio fallito: ${errorData.error}` : "Salvataggio fallito.",
        });
      }
    } catch {
      setSettingsFeedback({
        type: "error",
        message: "Impossibile salvare: server non raggiungibile.",
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
    if (!sdPath.trim()) {
      setSdPreview(null);
      setHasMultipleJobsOnSd(null);
      setShowMultiJobConfirm(false);
      setFilterPreview(null);
      setFilterPreviewError(null);
      return;
    }
    let alive = true;
    setLoadingSd(true);
    fetch(`/api/sd-preview?path=${encodeURIComponent(sdPath)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SdPreview | null) => {
        if (alive) setSdPreview(data);
      })
      .catch(() => { if (alive) setSdPreview(null); })
      .finally(() => { if (alive) setLoadingSd(false); });
    return () => { alive = false; };
  }, [sdPath]);

  async function handleImport(forceProceed = false) {
    setImportError(null);
    setImportSuccess(null);
    setImportProgress(null);

    if (!sdPath.trim()) return setImportError("Seleziona o inserisci il percorso della SD card.");
    if (hasMultipleJobsOnSd === null) return setImportError("Rispondi prima: ci sono più lavori in questa SD?");
    if (
      hasMultipleJobsOnSd === true &&
      !fileNameIncludesFilter.trim() &&
      !mtimeFromFilter.trim() &&
      !mtimeToFilter.trim()
    ) {
      return setImportError("Per SD con più lavori imposta almeno un filtro (nome file o intervallo data/ora).");
    }
    if (hasMultipleJobsOnSd === true && !forceProceed) {
      setShowMultiJobConfirm(true);
      return;
    }

    const fromMs = mtimeFromFilter.trim() ? Date.parse(mtimeFromFilter.trim()) : NaN;
    const toMs = mtimeToFilter.trim() ? Date.parse(mtimeToFilter.trim()) : NaN;
    const hasFrom = Number.isFinite(fromMs);
    const hasTo = Number.isFinite(toMs);
    if (hasMultipleJobsOnSd === true && hasFrom && hasTo) {
      const sdKey = sdPath.trim();
      const currentRanges = importedRangesBySd[sdKey] ?? [];
      const selStart = Math.min(fromMs, toMs);
      const selEnd = Math.max(fromMs, toMs);
      const hasOverlap = currentRanges.some((r) => !(selEnd < r.startMs || selStart > r.endMs));
      if (hasOverlap && !allowRangeOverlap) {
        return setImportError("Il range selezionato si sovrappone a un range già importato su questa SD. Modifica il range o abilita la sovrapposizione.");
      }
    }

    if (!usaLavoroEsistente && !nomeLavoro.trim()) return setImportError("Inserisci il nome del lavoro.");
    if (usaLavoroEsistente && !existingJobId) return setImportError("Seleziona un lavoro esistente.");
    if (!autore.trim()) return setImportError("Inserisci il nome dell'autore.");
    if (!usaLavoroEsistente && !effectiveDestinazione) return setImportError("Inserisci la cartella di destinazione.");

    setImporting(true);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
          fileNameIncludes: fileNameIncludesFilter.trim() || undefined,
          mtimeFrom: mtimeFromFilter.trim() || undefined,
          mtimeTo: mtimeToFilter.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setImportError(data.error ?? "Errore durante l'importazione.");
      } else {
        const fromMsDone = mtimeFromFilter.trim() ? Date.parse(mtimeFromFilter.trim()) : NaN;
        const toMsDone = mtimeToFilter.trim() ? Date.parse(mtimeToFilter.trim()) : NaN;
        if (hasMultipleJobsOnSd === true && Number.isFinite(fromMsDone) && Number.isFinite(toMsDone)) {
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
        setImportSuccess(data as ImportResult);
        onImportDone(data as ImportResult);
      }
    } catch {
      setImportError("Impossibile contattare il server. Assicurati che sia in esecuzione.");
    } finally {
      setImporting(false);
    }
  }

  const selectedExistingJob = jobsEsistenti.find((j) => j.id === existingJobId) ?? null;
  const currentSdKey = sdPath.trim();
  const importedRangesForCurrentSd = currentSdKey ? (importedRangesBySd[currentSdKey] ?? []) : [];
  const effectiveDestinazione = destinazione.trim() || archiveRoot.trim() || savedDestinazione || savedArchiveRoot;
  const folderPreview = usaLavoroEsistente
    ? (selectedExistingJob?.nomeCartella ?? "—")
    : buildFolderPreview(nomeLavoro, dataLavoro);
  const fotoDestPreview = sottoCartella.trim()
    ? `FOTO_SD\\${sottoCartella.trim()}`
    : "FOTO_SD";
  const canImport =
    !importing &&
    sdPath.trim() &&
    hasMultipleJobsOnSd !== null &&
    (hasMultipleJobsOnSd === false || Boolean(
      fileNameIncludesFilter.trim() || mtimeFromFilter.trim() || mtimeToFilter.trim()
    )) &&
    autore.trim() &&
    (usaLavoroEsistente ? Boolean(existingJobId) : Boolean(nomeLavoro.trim() && effectiveDestinazione));
  const settingsChanged =
    archiveRoot.trim() !== savedArchiveRoot ||
    destinazione.trim() !== savedDestinazione ||
    autore.trim() !== savedAutore ||
    JSON.stringify(cartellePredefinite) !== JSON.stringify(savedCartellePredefinite);

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
  }, [settingsLoaded, settingsChanged, savingSettings, archiveRoot, destinazione, autore, cartellePredefinite]);

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

  async function handleFilterPreview() {
    setFilterPreview(null);
    setFilterPreviewError(null);
    if (!sdPath.trim()) {
      setFilterPreviewError("Seleziona prima il percorso SD.");
      return;
    }
    setLoadingFilterPreview(true);
    try {
      const res = await fetch("/api/filter-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sdPath: sdPath.trim(),
          fileNameIncludes: fileNameIncludesFilter.trim() || undefined,
          mtimeFrom: mtimeFromFilter.trim() || undefined,
          mtimeTo: mtimeToFilter.trim() || undefined,
          maxSamples: 36,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFilterPreviewError(data?.error ?? "Anteprima filtro non riuscita");
        return;
      }
      setFilterPreview(data as FilterPreviewData);
      setPreviewRangeStartMs(null);
      setPreviewRangeEndMs(null);
    } catch {
      setFilterPreviewError("Server non raggiungibile");
    } finally {
      setLoadingFilterPreview(false);
    }
  }

  async function openVisualRangePicker() {
    setVisualPickerError(null);
    if (!sdPath.trim()) {
      setVisualPickerError("Seleziona prima il percorso SD.");
      return;
    }

    setLoadingVisualPicker(true);
    try {
      const res = await fetch("/api/filter-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sdPath: sdPath.trim(),
          fileNameIncludes: fileNameIncludesFilter.trim() || undefined,
          mtimeFrom: mtimeFromFilter.trim() || undefined,
          mtimeTo: mtimeToFilter.trim() || undefined,
          maxSamples: 5000,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setVisualPickerError(data?.error ?? "Impossibile aprire il selettore visuale");
        return;
      }
      const previewData = data as FilterPreviewData;
      setVisualPickerSamples(previewData.sampleFiles ?? []);
      setShowVisualRangePicker(true);
    } catch {
      setVisualPickerError("Server non raggiungibile");
    } finally {
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
    });
  }

  function toDateTimeLocalValue(ms: number): string {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day}T${hh}:${mm}`;
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
    setMtimeFromFilter(toDateTimeLocalValue(previewRangeStartMs));
    setMtimeToFilter(toDateTimeLocalValue(previewRangeEndMs));
  }

  function handleApplyVisualRange(startMs: number, endMs: number) {
    const start = Math.min(startMs, endMs);
    const end = Math.max(startMs, endMs);
    setPreviewRangeStartMs(start);
    setPreviewRangeEndMs(end);
    setMtimeFromFilter(toDateTimeLocalValue(start));
    setMtimeToFilter(toDateTimeLocalValue(end));
    setShowVisualRangePicker(false);
  }

  function isWithinSelectedRange(ms: number): boolean {
    if (previewRangeStartMs === null) return false;
    if (previewRangeEndMs === null) return ms === previewRangeStartMs;
    return ms >= previewRangeStartMs && ms <= previewRangeEndMs;
  }

  function isWithinImportedRanges(ms: number): boolean {
    return importedRangesForCurrentSd.some((r) => ms >= r.startMs && ms <= r.endMs);
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

    async function pollProgress() {
      try {
        const res = await fetch("/api/import-progress");
        if (!res.ok) return;
        const data = await res.json() as ImportProgressSnapshot;
        if (!alive) return;
        setImportProgress(data);
      } catch {
        /* ignore transient polling errors */
      }
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
              : "Importa foto da SD card, organizza automaticamente le cartelle e registra il lavoro."}
          </p>
        </div>
      </div>

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

      {activeView === "nuovo" && (
        <>
      {/* SD Card section */}
      <div className="panel-section" style={{ padding: "var(--space-4)" }}>
        <div className="stack">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <strong>SD Card</strong>
            <button
              className="ghost-button"
              onClick={fetchSdCards}
              disabled={refreshingSd}
              style={{ padding: "0.5rem 0.9rem", fontSize: "0.88rem" }}
            >
              {refreshingSd ? "Aggiorno..." : "⟳ Aggiorna"}
            </button>
          </div>

          {sdCards.length > 0 && (
            <div className="stats-grid">
              {sdCards.map((card) => (
                <button
                  key={card.deviceId}
                  className={sdPath === card.path ? "stat-card stat-card--highlight" : "stat-card"}
                  style={{ cursor: "pointer", textAlign: "left" }}
                  onClick={() => setSdPath(card.path)}
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
                onChange={(e) => setSdPath(e.target.value)}
                placeholder="E:\\ oppure seleziona con Sfoglia"
                style={{ flex: 1 }}
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

          {sdPath.trim() && (
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
            </div>
          )}

          {sdPath.trim() && (
            <div className="message-box" style={{ background: "rgba(255,255,255,0.04)", borderColor: "var(--line)" }}>
              <p style={{ marginBottom: "0.55rem" }}>
                <strong>Domanda rapida:</strong> ci sono piu lavori in questa SD?
              </p>
              <div className="button-row">
                <button
                  className={hasMultipleJobsOnSd === false ? "secondary-button" : "ghost-button"}
                  onClick={() => setHasMultipleJobsOnSd(false)}
                  style={{ padding: "0.45rem 0.75rem", fontSize: "0.84rem" }}
                >
                  No, un solo lavoro
                </button>
                <button
                  className={hasMultipleJobsOnSd === true ? "secondary-button" : "ghost-button"}
                  onClick={() => setHasMultipleJobsOnSd(true)}
                  style={{ padding: "0.45rem 0.75rem", fontSize: "0.84rem" }}
                >
                  Sì, piu lavori
                </button>
              </div>

              {hasMultipleJobsOnSd === true && (
                <div className="stack" style={{ marginTop: "0.55rem", gap: "0.45rem" }}>
                  <p style={{ margin: 0, fontSize: "0.84rem", color: "var(--text-muted)" }}>
                    Imposta un filtro per importare solo un lavoro alla volta (senza toccare la SD).
                  </p>

                  <label className="field">
                    <span>Filtro nome file contiene (opzionale)</span>
                    <input
                      type="text"
                      value={fileNameIncludesFilter}
                      onChange={(e) => setFileNameIncludesFilter(e.target.value)}
                      placeholder="es. DSCF oppure IMG_"
                    />
                  </label>

                  <div className="inline-grid inline-grid--2">
                    <label className="field">
                      <span>Data/ora inizio (opzionale)</span>
                      <input
                        type="datetime-local"
                        value={mtimeFromFilter}
                        onChange={(e) => setMtimeFromFilter(e.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>Data/ora fine (opzionale)</span>
                      <input
                        type="datetime-local"
                        value={mtimeToFilter}
                        onChange={(e) => setMtimeToFilter(e.target.value)}
                      />
                    </label>
                  </div>

                  <label className="check-row" style={{ cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={allowRangeOverlap}
                      onChange={(e) => setAllowRangeOverlap(e.target.checked)}
                      style={{ width: 16, height: 16, cursor: "pointer" }}
                    />
                    <span>Consenti sovrapposizione con range già importati</span>
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
                      {loadingVisualPicker ? "Carico tutte le foto..." : "Selettore visuale"}
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
                        (RAW {filterPreview.matchedRawFiles}, JPG {filterPreview.matchedJpgFiles})
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
                            Range già importati su questa SD:
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
                                  : isWithinImportedRanges(f.mtimeMs)
                                    ? "1px dashed rgba(212,163,156,0.75)"
                                    : "1px solid var(--line)",
                                borderRadius: 10,
                                padding: "0.35rem",
                                background: "rgba(0,0,0,0.15)",
                                cursor: "pointer",
                              }}
                              onClick={() => selectPreviewPoint(f.mtimeMs)}
                              title="Clicca per impostare inizio/fine range"
                            >
                              {f.isJpg ? (
                                <img
                                  src={`/api/preview-image?sdPath=${encodeURIComponent(sdPath.trim())}&filePath=${encodeURIComponent(f.filePath)}`}
                                  alt={f.fileName}
                                  style={{ width: "100%", height: 90, objectFit: "cover", borderRadius: 7, marginBottom: "0.35rem" }}
                                  loading="lazy"
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
                                  RAW {f.ext.toUpperCase()}
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
      </div>

      {/* Job data */}
      <div className="panel-section" style={{ padding: "var(--space-4)" }}>
        <div className="stack">
          <strong>Dati lavoro</strong>

          <label className="check-row" style={{ cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={usaLavoroEsistente}
              onChange={(e) => {
                setUsaLavoroEsistente(e.target.checked);
                if (!e.target.checked) {
                  setExistingJobId("");
                }
              }}
              style={{ width: 16, height: 16, cursor: "pointer" }}
            />
            <span>Importa in lavoro esistente (stessa cartella principale)</span>
          </label>

          {usaLavoroEsistente && (
            <label className="field">
              <span>Seleziona lavoro esistente</span>
              <select value={existingJobId} onChange={(e) => setExistingJobId(e.target.value)}>
                <option value="">-- seleziona --</option>
                {jobsEsistenti.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.nomeLavoro} · {job.dataLavoro}
                  </option>
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
                onChange={(e) => setNomeLavoro(e.target.value)}
                placeholder="es. Maria Rossi Shooting"
                disabled={usaLavoroEsistente}
              />
            </label>

            <label className="field">
              <span>Data lavoro</span>
              <input
                type="date"
                value={dataLavoro}
                onChange={(e) => setDataLavoro(e.target.value)}
              />
            </label>
          </div>

          <label className="field">
            <span>Autore / fotografo</span>
            <input
              type="text"
              value={autore}
              onChange={(e) => setAutore(e.target.value)}
              placeholder="es. Gennaro"
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

          <div className="field">
            <span>Cartella di destinazione</span>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                type="text"
                value={destinazione}
                onChange={(e) => setDestinazione(e.target.value)}
                placeholder="C:\\Foto\\Lavori"
                style={{ flex: 1 }}
                disabled={usaLavoroEsistente}
              />
              <button
                className="secondary-button"
                onClick={() => handleBrowse("dest")}
                disabled={browsingField === "dest" || usaLavoroEsistente}
                style={{ flexShrink: 0, padding: "0.7rem 1rem", whiteSpace: "nowrap" }}
              >
                {browsingField === "dest" ? "…" : "Sfoglia"}
              </button>
            </div>
          </div>

          {usaLavoroEsistente && selectedExistingJob && (
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-muted)" }}>
              Cartella principale riutilizzata: <strong>{selectedExistingJob.percorsoCartella}</strong>
            </p>
          )}

          <label className="field">
            <span>Sottocartella in FOTO_SD (opzionale)</span>
            <input
              type="text"
              value={sottoCartella}
              onChange={(e) => setSottoCartella(e.target.value)}
              placeholder="es. Promessa"
            />
          </label>

          {cartellePredefinite.length > 0 && (
            <div className="stack" style={{ gap: "0.45rem" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Cartelle predefinite:</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {cartellePredefinite.map((cartella) => (
                  <button
                    key={cartella}
                    className={sottoCartella === cartella ? "secondary-button" : "ghost-button"}
                    onClick={() => setSottoCartella(cartella)}
                    style={{ padding: "0.45rem 0.75rem", fontSize: "0.84rem" }}
                  >
                    {cartella}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p style={{ margin: 0, fontSize: "0.86rem", color: "var(--text-muted)" }}>
            I file verranno copiati in: <strong>{fotoDestPreview}</strong>
          </p>

          <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)" }}>
            Predefiniti correnti: <strong>{savedDestinazione || savedArchiveRoot || "(destinazione non impostata)"}</strong>
            {savedAutore && <> · autore: <strong>{savedAutore}</strong></>}
          </p>

          {/* Folder name preview */}
          {folderPreview !== "—" && (
            <div className="message-box">
              <p>
                <span style={{ color: "var(--text-muted)", fontSize: "0.88rem" }}>Cartella che verrà creata:  </span>
                <strong style={{ fontFamily: "monospace", fontSize: "0.9rem" }}>{folderPreview}</strong>
              </p>
            </div>
          )}

          {/* Options */}
          <div className="stack" style={{ gap: "0.6rem" }}>
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
        </div>
      </div>

      {/* Error / result feedback */}
      {importing && importProgress && (
        <div
          className="message-box"
          style={{ borderColor: "rgba(184, 154, 99, 0.35)", background: "rgba(184, 154, 99, 0.08)" }}
        >
          <p style={{ marginBottom: "0.55rem" }}>
            Stato import: <strong>{importProgress.phase === "compressing" ? "Compressione JPG" : "Copia file"}</strong>
          </p>

          <div
            style={{
              width: "100%",
              height: 10,
              borderRadius: 999,
              background: "rgba(255,255,255,0.08)",
              overflow: "hidden",
              marginBottom: "0.6rem",
            }}
          >
            <div
              style={{
                width: `${Math.max(3, importProgress.progressPct)}%`,
                height: "100%",
                background: "linear-gradient(90deg, #b89a63, #d4c1aa)",
                transition: "width 220ms ease",
              }}
            />
          </div>

          <p style={{ margin: 0, fontSize: "0.9rem" }}>
            {importProgress.completedScheduled}/{Math.max(importProgress.knownTotal, 1)} file elaborati · copiati {importProgress.copiedFiles} · saltati {importProgress.skippedFiles}
          </p>
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.84rem", color: "var(--text-muted)" }}>
            Scansionati {importProgress.scannedFiles} · concorrenza {importProgress.copyConcurrency} · in coda {importProgress.inFlight}
          </p>
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.84rem", color: "var(--text-muted)" }}>
            Trascorso {formatDurationSeconds(importProgress.elapsedMs / 1000)}
            {importProgress.estimatedRemainingSec !== null && ` · Stimato restante ${formatDurationSeconds(importProgress.estimatedRemainingSec)}`}
          </p>
          {importProgress.jpgEnabled && importProgress.phase === "compressing" && (
            <p style={{ margin: "0.35rem 0 0", fontSize: "0.84rem", color: "var(--text-muted)" }}>
              JPG generati: {importProgress.jpgDone}
            </p>
          )}
        </div>
      )}

      {importError && (
        <div
          className="message-box"
          style={{ borderColor: "rgba(212, 163, 156, 0.4)", background: "rgba(212, 163, 156, 0.08)" }}
        >
          <p style={{ color: "var(--danger)" }}>⚠ {importError}</p>
        </div>
      )}

      {importSuccess && (
        <div
          className="message-box"
          style={{ borderColor: "rgba(142, 178, 142, 0.4)", background: "rgba(142, 178, 142, 0.08)" }}
        >
          <p style={{ color: "var(--success)" }}>
            ✓ Importazione completata — {importSuccess.copiedFiles} file copiati
            {importSuccess.jpgGenerati > 0 && `, ${importSuccess.jpgGenerati} JPG compressi`}
            {importSuccess.errors.length > 0 && ` (${importSuccess.errors.length} errori)`}
          </p>
          <p style={{ margin: "0.4rem 0 0", fontSize: "0.88rem", color: "var(--text-muted)" }}>
            {importSuccess.job.percorsoCartella}
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
        </div>
      )}

      {/* Import CTA */}
      <div className="setup-footer">
        <div>
          <strong>Pronto per importare?</strong>
          <p>
            Tutti i file verranno copiati nella cartella{" "}
            <code style={{ fontSize: "0.88rem" }}>FOTO_SD</code> del lavoro.
          </p>
        </div>
        <div className="setup-footer__action">
          <button
            className="primary-button"
            style={{ width: "100%" }}
            onClick={() => { void handleImport(false); }}
            disabled={!canImport}
          >
            {importing ? "Importazione in corso…" : "▶ IMPORTA"}
          </button>
        </div>
      </div>
        </>
      )}

      {showMultiJobConfirm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "grid",
            placeItems: "center",
            zIndex: 50,
            padding: "1rem",
          }}
        >
          <div
            className="panel-section"
            style={{
              width: "min(640px, 100%)",
              padding: "1rem",
              borderColor: "var(--line-strong)",
            }}
          >
            <div className="stack" style={{ gap: "0.7rem" }}>
              <strong>Conferma import multiplo</strong>
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.9rem" }}>
                Hai indicato che questa SD contiene più lavori. Confermi che stai importando solo il primo lavoro
                (cartella/sottocartella corretta) e che importerai il successivo dopo?
              </p>
              <div className="button-row" style={{ justifyContent: "flex-end" }}>
                <button
                  className="ghost-button"
                  onClick={() => setShowMultiJobConfirm(false)}
                  style={{ padding: "0.55rem 0.9rem", fontSize: "0.88rem" }}
                >
                  Annulla
                </button>
                <button
                  className="primary-button"
                  onClick={() => {
                    setShowMultiJobConfirm(false);
                    void handleImport(true);
                  }}
                  style={{ padding: "0.55rem 0.95rem", fontSize: "0.88rem" }}
                >
                  Conferma e importa
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <FilterRangePickerModal
        open={showVisualRangePicker}
        sdPath={sdPath.trim()}
        samples={visualPickerSamples}
        importedRanges={importedRangesForCurrentSd}
        onClose={() => setShowVisualRangePicker(false)}
        onApplyRange={handleApplyVisualRange}
      />
    </div>
  );
}
