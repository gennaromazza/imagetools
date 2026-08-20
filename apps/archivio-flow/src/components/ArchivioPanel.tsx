import { useEffect, useRef, useState } from "react";
import { List as VirtualList, type RowComponentProps } from "react-window";
import type { ArchiveAnalysisResult, ArchiveRenameProgress, Job, LowQualityProgressSnapshot, SelectionCandidate } from "../types";
import {
  analyzeArchivioArchive,
  deleteArchivioJob,
  getArchivioJobSelectionCandidates,
  generateArchivioLowQuality,
  getArchivioJobSubfolders,
  getArchivioLowQualityProgress,
  getArchivioArchiveRenameProgress,
  openJobInPhotoSelector,
  openArchivioFolder,
  renameArchivioArchiveJobs,
  updateArchivioJobContractLink,
} from "../archivioDesktopApi";

interface Props {
  jobs: Job[];
  loading: boolean;
  onRefresh: () => void;
  onAnalysisStateChange?: (analyzing: boolean) => void;
}

function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

function formatDateTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString("it-IT") + " " + d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
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

async function openFolder(path: string) {
  await openArchivioFolder(path);
}

function openContractLink(link: string) {
  if (!link) return;
  window.open(link, "_blank", "noopener,noreferrer");
}

function normalizeCategoryFilterValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/^\s*\d+\s*[-_.)]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function displayCategoryFilterLabel(value: string): string {
  return value
    .replace(/^\s*\d+\s*[-_.)]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type BadgeTone = "ok" | "missing" | "todo";
type RowFeedbackTone = "success" | "error" | "info";
type RenameDraft = { nomeLavoro: string; dataLavoro: string };

function buildRepairedFolderName(draft: RenameDraft): string {
  const safeName = draft.nomeLavoro.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim();
  const match = draft.dataLavoro.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!safeName || !match) return "";
  return `${draft.dataLavoro} - ${safeName} - ${match[3]}-${match[2]}-${match[1]}`;
}

function renderStatusBadge(label: string, tone: BadgeTone) {
  const palette: Record<BadgeTone, { border: string; background: string; color: string; text: string }> = {
    ok: {
      border: "rgba(142, 178, 142, 0.45)",
      background: "rgba(142, 178, 142, 0.14)",
      color: "var(--success)",
      text: "OK",
    },
    missing: {
      border: "rgba(212, 163, 156, 0.45)",
      background: "rgba(212, 163, 156, 0.14)",
      color: "var(--danger)",
      text: "Mancante",
    },
    todo: {
      border: "rgba(184, 154, 99, 0.45)",
      background: "rgba(184, 154, 99, 0.14)",
      color: "var(--accent-strong)",
      text: "Da completare",
    },
  };

  const current = palette[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
        border: `1px solid ${current.border}`,
        background: current.background,
        color: current.color,
        borderRadius: 999,
        padding: "0.18rem 0.45rem",
        fontSize: "0.73rem",
        lineHeight: 1.1,
      }}
    >
      <strong>{label}</strong>
      <span>{current.text}</span>
    </span>
  );
}

function getContractPreview(link: string): { shortLabel: string; fullLabel: string } {
  const trimmed = link.trim();
  if (!trimmed) return { shortLabel: "", fullLabel: "" };
  try {
    const url = new URL(trimmed);
    const previewPath = url.pathname && url.pathname !== "/" ? `${url.pathname.slice(0, 18)}...` : "";
    return {
      shortLabel: `${url.host}${previewPath}`,
      fullLabel: trimmed,
    };
  } catch {
    const compact = trimmed.length > 36 ? `${trimmed.slice(0, 36)}...` : trimmed;
    return { shortLabel: compact, fullLabel: trimmed };
  }
}

export function ArchivioPanel({ jobs, loading, onRefresh, onAnalysisStateChange }: Props) {
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"dettagliata" | "compatta">("dettagliata");
  const [yearFilter, setYearFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showMissingFolders, setShowMissingFolders] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [editingContractLink, setEditingContractLink] = useState("");
  const [savingContract, setSavingContract] = useState<string | null>(null);
  const [generatingLowQualityFor, setGeneratingLowQualityFor] = useState<string | null>(null);
  const [regeneratingLowQualityFor, setRegeneratingLowQualityFor] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [activeLowQualityJobId, setActiveLowQualityJobId] = useState<string | null>(null);
  const [lowQualityProgress, setLowQualityProgress] = useState<LowQualityProgressSnapshot | null>(null);

  // Subfolder selection modal state
  const [bqModalJob, setBqModalJob] = useState<{ job: Job; overwrite: boolean } | null>(null);
  const [bqModalSubfolders, setBqModalSubfolders] = useState<string[]>([]);
  const [bqModalLoading, setBqModalLoading] = useState(false);
  const [bqModalSelected, setBqModalSelected] = useState<string>("__all__");
  const [selectionModalJob, setSelectionModalJob] = useState<Job | null>(null);
  const [selectionModalCandidates, setSelectionModalCandidates] = useState<SelectionCandidate[]>([]);
  const [selectionModalSelectedPath, setSelectionModalSelectedPath] = useState("");
  const [selectionModalOpening, setSelectionModalOpening] = useState(false);
  const [openingSelectionJobId, setOpeningSelectionJobId] = useState<string | null>(null);
  const [rowFeedbackByJob, setRowFeedbackByJob] = useState<Record<string, { text: string; tone: RowFeedbackTone }>>({});
  const [contractFeedback, setContractFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [lowQualityFeedback, setLowQualityFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [archiveFeedback, setArchiveFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [archiveAnalysis, setArchiveAnalysis] = useState<ArchiveAnalysisResult | null>(null);
  const [selectedRenameIds, setSelectedRenameIds] = useState<Set<string>>(new Set());
  const [renameDrafts, setRenameDrafts] = useState<Record<string, RenameDraft>>({});
  const [analyzingArchive, setAnalyzingArchive] = useState(false);
  const [analysisElapsedSeconds, setAnalysisElapsedSeconds] = useState(0);
  const [renamingArchive, setRenamingArchive] = useState(false);
  const [archiveRenameProgress, setArchiveRenameProgress] = useState<ArchiveRenameProgress | null>(null);
  const feedbackTimersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!analyzingArchive) return;
    const startedAt = Date.now();
    setAnalysisElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setAnalysisElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [analyzingArchive]);

  useEffect(() => {
    let alive = true;

    async function pollRenameProgress() {
      try {
        const progress = await getArchivioArchiveRenameProgress();
        if (alive) setArchiveRenameProgress(progress);
      } catch {
        // Il polling riprova: un riavvio momentaneo del runtime non deve interrompere la UI.
      }
    }

    void pollRenameProgress();
    const timer = window.setInterval(() => void pollRenameProgress(), 600);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const renameBusy = renamingArchive || archiveRenameProgress?.active === true;

  const availableYears = Array.from(
    new Set(jobs.map((job) => (job.annoArchivio ?? "").trim()).filter((value) => value.length > 0))
  ).sort((a, b) => b.localeCompare(a));

  const categoryOptions = Array.from(
    jobs.reduce((acc, job) => {
      const raw = (job.categoriaArchivio ?? "").trim();
      if (!raw) return acc;
      const key = normalizeCategoryFilterValue(raw);
      if (!key) return acc;
      if (!acc.has(key)) {
        acc.set(key, displayCategoryFilterLabel(raw));
      }
      return acc;
    }, new Map<string, string>())
  )
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "it"));

  const hasGlobalSearch = Boolean(search.trim());
  const selectedCategoryLabel = categoryFilter
    ? (categoryOptions.find((option) => option.value === categoryFilter)?.label ?? categoryFilter)
    : "";

  const filtered = jobs.filter((job) => {
    if (!showMissingFolders && job.folderExists === false) return false;
    if (!hasGlobalSearch && yearFilter && (job.annoArchivio ?? "") !== yearFilter) return false;
    if (!hasGlobalSearch && categoryFilter && normalizeCategoryFilterValue(job.categoriaArchivio ?? "") !== categoryFilter) return false;
    if (!hasGlobalSearch) return true;
    const q = search.toLowerCase();
    return (
      job.nomeLavoro.toLowerCase().includes(q) ||
      job.autore.toLowerCase().includes(q) ||
      (job.annoArchivio ?? "").toLowerCase().includes(q) ||
      (job.categoriaArchivio ?? "").toLowerCase().includes(q) ||
      job.dataLavoro.includes(q) ||
      formatDate(job.dataLavoro).includes(q)
    );
  });

  function setRowFeedback(jobId: string, text: string, tone: RowFeedbackTone) {
    if (feedbackTimersRef.current[jobId]) {
      window.clearTimeout(feedbackTimersRef.current[jobId]);
    }

    setRowFeedbackByJob((prev) => ({
      ...prev,
      [jobId]: { text, tone },
    }));

    feedbackTimersRef.current[jobId] = window.setTimeout(() => {
      setRowFeedbackByJob((prev) => {
        const next = { ...prev };
        delete next[jobId];
        return next;
      });
    }, 1600);
  }

  useEffect(() => {
    return () => {
      Object.values(feedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });
    };
  }, []);

  async function handleCopyPath(job: Job) {
    try {
      await navigator.clipboard.writeText(job.percorsoCartella);
      setCopiedPath(job.percorsoCartella);
      setRowFeedback(job.id, "Percorso copiato", "success");
      setTimeout(() => setCopiedPath(null), 1500);
    } catch {
      setRowFeedback(job.id, "Clipboard non disponibile", "error");
    }
  }

  async function handleOpenFolder(job: Job) {
    if (job.folderExists === false) {
      setRowFeedback(job.id, "Cartella non disponibile", "error");
      return;
    }
    try {
      await openFolder(job.percorsoCartella);
      setRowFeedback(job.id, "Cartella aperta", "success");
    } catch {
      setRowFeedback(job.id, "Impossibile aprire cartella", "error");
    }
  }

  async function handleOpenInPhotoSelector(job: Job) {
    if (job.folderExists === false) {
      setRowFeedback(job.id, "Cartella non disponibile", "error");
      return;
    }
    const fallbackPath = (job.percorsoSelezione ?? "").trim() || job.percorsoCartella;
    setOpeningSelectionJobId(job.id);
    try {
      const selectionData = await getArchivioJobSelectionCandidates(job.id);
      const candidates = selectionData.candidates.filter((candidate) => candidate.path.trim().length > 0);
      if (candidates.length > 1) {
        const preferredPath = (selectionData.preferredPath ?? "").trim();
        const selectedPath = candidates.some((candidate) => candidate.path === preferredPath)
          ? preferredPath
          : candidates[0]!.path;
        setSelectionModalJob(job);
        setSelectionModalCandidates(candidates);
        setSelectionModalSelectedPath(selectedPath);
        return;
      }

      const targetSelectionPath = candidates[0]?.path?.trim()
        || (selectionData.preferredPath ?? "").trim()
        || fallbackPath;
      await openJobInPhotoSelector(targetSelectionPath);
      setRowFeedback(job.id, "Apro in Image Select Pro", "success");
    } catch (error) {
      try {
        await openJobInPhotoSelector(fallbackPath);
        setRowFeedback(job.id, "Apro in Image Select Pro", "success");
      } catch {
        const message = error instanceof Error ? error.message : "Impossibile aprire Image Select Pro";
        setRowFeedback(job.id, message, "error");
      }
    } finally {
      setOpeningSelectionJobId((current) => (current === job.id ? null : current));
    }
  }

  function closeSelectionModal() {
    if (selectionModalOpening) return;
    setSelectionModalJob(null);
    setSelectionModalCandidates([]);
    setSelectionModalSelectedPath("");
  }

  async function confirmSelectionModal() {
    if (!selectionModalJob) return;
    const targetPath = selectionModalSelectedPath.trim();
    if (!targetPath) {
      setRowFeedback(selectionModalJob.id, "Seleziona una cartella", "info");
      return;
    }

    setSelectionModalOpening(true);
    setOpeningSelectionJobId(selectionModalJob.id);
    try {
      await openJobInPhotoSelector(targetPath);
      setRowFeedback(selectionModalJob.id, "Apro in Image Select Pro", "success");
      setSelectionModalJob(null);
      setSelectionModalCandidates([]);
      setSelectionModalSelectedPath("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossibile aprire Image Select Pro";
      setRowFeedback(selectionModalJob.id, message, "error");
    } finally {
      setSelectionModalOpening(false);
      setOpeningSelectionJobId((current) => (current === selectionModalJob.id ? null : current));
    }
  }

  function handleOpenContract(job: Job) {
    if (!job.contrattoLink) {
      setRowFeedback(job.id, "Nessun contratto da aprire", "info");
      return;
    }
    openContractLink(job.contrattoLink);
    setRowFeedback(job.id, "Apro il contratto", "info");
  }

  function startEditContract(job: Job) {
    setEditingJobId(job.id);
    setEditingContractLink(job.contrattoLink ?? "");
    setContractFeedback(null);
  }

  async function saveContractLink(jobId: string) {
    setSavingContract(jobId);
    setContractFeedback(null);
    try {
      await updateArchivioJobContractLink(jobId, editingContractLink);
      setContractFeedback({ type: "success", text: "Link contratto aggiornato" });
      setRowFeedback(jobId, "Link contratto aggiornato", "success");
      setEditingJobId(null);
      setEditingContractLink("");
      onRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Salvataggio link non riuscito";
      setContractFeedback({ type: "error", text: message });
      setRowFeedback(jobId, message, "error");
    } finally {
      setSavingContract(null);
    }
  }

  async function openBqModal(job: Job, overwrite: boolean) {
    setBqModalJob({ job, overwrite });
    setBqModalSelected("__all__");
    setBqModalSubfolders([]);
    setBqModalLoading(true);
    try {
      const { subfolders } = await getArchivioJobSubfolders(job.id);
      setBqModalSubfolders(subfolders);
    } catch {
      setBqModalSubfolders([]);
    } finally {
      setBqModalLoading(false);
    }
  }

  async function confirmBqModal() {
    if (!bqModalJob) return;
    const { job, overwrite } = bqModalJob;
    const sourceSubfolder = bqModalSelected === "__all__" ? undefined : bqModalSelected;
    setBqModalJob(null);

    if (overwrite) {
      setRegeneratingLowQualityFor(job.id);
    } else {
      setGeneratingLowQualityFor(job.id);
    }
    setActiveLowQualityJobId(job.id);
    setLowQualityProgress(null);
    setLowQualityFeedback(null);
    try {
      const data = await generateArchivioLowQuality(job.id, overwrite, sourceSubfolder);
      const folderLabel = sourceSubfolder ? ` da "${sourceSubfolder}"` : "";
      setLowQualityFeedback({
        type: "success",
        text: `${overwrite ? "Rigenerazione" : "Generazione"} BASSA_QUALITA${folderLabel} completata: generati ${data.generated ?? 0}, già presenti ${data.skippedExisting ?? 0}, errori ${data.errors ?? 0}`,
      });
      setRowFeedback(job.id, overwrite ? "Rigenerazione BQ completata" : "Generazione BQ completata", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Generazione BASSA_QUALITA non riuscita";
      setLowQualityFeedback({ type: "error", text: message });
      setRowFeedback(job.id, message, "error");
    } finally {
      setGeneratingLowQualityFor(null);
      setRegeneratingLowQualityFor(null);
      setActiveLowQualityJobId(null);
    }
  }

  useEffect(() => {
    if (!activeLowQualityJobId) return;
    let alive = true;

    async function pollProgress() {
      try {
        const data = await getArchivioLowQualityProgress() as LowQualityProgressSnapshot;
        if (!alive) return;
        setLowQualityProgress(data);
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
  }, [activeLowQualityJobId]);

  async function removeArchivedJob(job: Job) {
    setDeletingJobId(job.id);
    setArchiveFeedback(null);
    try {
      await deleteArchivioJob(job.id);
      setArchiveFeedback({ type: "success", text: "Voce rimossa dall'archivio" });
      onRefresh();
    } catch (error) {
      setArchiveFeedback({ type: "error", text: error instanceof Error ? error.message : "Rimozione archivio non riuscita" });
    } finally {
      setDeletingJobId(null);
    }
  }

  async function handleAnalyzeArchive() {
    setAnalyzingArchive(true);
    onAnalysisStateChange?.(true);
    setArchiveFeedback(null);
    try {
      const result = await analyzeArchivioArchive();
      setArchiveAnalysis(result);
      setRenameDrafts(Object.fromEntries(result.items.map((item) => [item.jobId, {
        nomeLavoro: item.nomeLavoro,
        dataLavoro: item.dataLavoro ?? "",
      }])));
      setSelectedRenameIds(new Set(
        result.items.filter((item) => item.status === "rename-ready").map((item) => item.jobId),
      ));
      onRefresh();
    } catch (error) {
      setArchiveFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "Analisi archivio non riuscita",
      });
    } finally {
      setAnalyzingArchive(false);
      onAnalysisStateChange?.(false);
    }
  }

  function toggleRenameSelection(jobId: string) {
    setSelectedRenameIds((current) => {
      const next = new Set(current);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }

  function updateRenameDraft(jobId: string, patch: Partial<RenameDraft>) {
    setRenameDrafts((current) => ({
      ...current,
      [jobId]: { ...(current[jobId] ?? { nomeLavoro: "", dataLavoro: "" }), ...patch },
    }));
  }

  async function confirmArchiveRename() {
    const requests = [...selectedRenameIds].map((jobId) => ({
      jobId,
      nomeLavoro: renameDrafts[jobId]?.nomeLavoro ?? "",
      dataLavoro: renameDrafts[jobId]?.dataLavoro ?? "",
    }));
    if (requests.length === 0) return;
    setRenamingArchive(true);
    setArchiveFeedback(null);
    try {
      const result = await renameArchivioArchiveJobs(requests);
      setArchiveRenameProgress(await getArchivioArchiveRenameProgress());
      setArchiveAnalysis(null);
      setRenameDrafts({});
      setSelectedRenameIds(new Set());
      setArchiveFeedback({
        type: "success",
        text: `${result.renamed.length} ${result.renamed.length === 1 ? "cartella rinominata" : "cartelle rinominate"} e registro aggiornato.`,
      });
      onRefresh();
    } catch (error) {
      setArchiveFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "Rinomina archivio non riuscita",
      });
    } finally {
      setRenamingArchive(false);
    }
  }

  function renderJobItem(job: Job, compact: boolean) {
    const hasContract = Boolean(job.contrattoLink);
    const hasLowQuality = job.hasLowQualityFiles === true;
    const lowQualityKnownMissing = job.hasLowQualityFiles === false;
    const contractPreview = hasContract && job.contrattoLink ? getContractPreview(job.contrattoLink) : null;
    const feedback = rowFeedbackByJob[job.id];

    const contractTone: BadgeTone = hasContract ? "ok" : "todo";
    const folderTone: BadgeTone = job.folderExists === false ? "missing" : "ok";
    const bqTone: BadgeTone = hasLowQuality ? "ok" : lowQualityKnownMissing ? "missing" : "todo";

    return (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
        <div className="stack" style={{ gap: compact ? "0.22rem" : "0.35rem", flex: 1, minWidth: 0 }}>
          <strong style={{ fontSize: compact ? "0.95rem" : "1rem", lineHeight: 1.2 }}>{job.nomeLavoro}</strong>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.45rem",
              color: "var(--text-muted)",
              fontSize: compact ? "0.8rem" : "0.86rem",
            }}
          >
            <span>{formatDate(job.dataLavoro)}</span>
            <span>{job.autore}</span>
            {job.annoArchivio && <span>{job.annoArchivio}</span>}
            {job.categoriaArchivio && <span>{job.categoriaArchivio}</span>}
            <span>{job.numeroFile} file</span>
            {!compact && <span>{formatDateTime(job.dataCreazione)}</span>}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
            {renderStatusBadge("Contratto", contractTone)}
            {renderStatusBadge("Cartella", folderTone)}
            {renderStatusBadge("BQ", bqTone)}
          </div>

          {!compact && (
            <span
              style={{
                fontFamily: "monospace",
                fontSize: "0.77rem",
                color: "var(--text-muted)",
                wordBreak: "break-all",
              }}
            >
              {job.percorsoCartella}
            </span>
          )}

          {!compact && contractPreview && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }} title={contractPreview.fullLabel}>
                {contractPreview.shortLabel}
              </span>
              <button
                className="ghost-button"
                style={{ padding: "0.34rem 0.62rem", fontSize: "0.78rem" }}
                onClick={() => handleOpenContract(job)}
                title={contractPreview.fullLabel}
              >
                Apri link
              </button>
            </div>
          )}

          {editingJobId === job.id && (
            <div style={{ marginTop: "0.3rem", display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
              <input
                type="url"
                value={editingContractLink}
                onChange={(e) => setEditingContractLink(e.target.value)}
                placeholder="https://..."
                style={{
                  minWidth: 260,
                  flex: 1,
                  border: "1px solid var(--line)",
                  background: "var(--bg-panel)",
                  color: "var(--text)",
                  borderRadius: 10,
                  padding: "0.45rem 0.6rem",
                }}
              />
              <button
                className="secondary-button"
                onClick={() => saveContractLink(job.id)}
                disabled={savingContract === job.id}
                style={{ padding: "0.45rem 0.75rem", fontSize: "0.84rem" }}
              >
                {savingContract === job.id ? "Salvo..." : "Salva link"}
              </button>
              <button
                className="ghost-button"
                onClick={() => {
                  setEditingJobId(null);
                  setEditingContractLink("");
                }}
                style={{ padding: "0.45rem 0.75rem", fontSize: "0.84rem" }}
              >
                Annulla
              </button>
            </div>
          )}
        </div>

        <div className="button-row" style={{ flexShrink: 0 }}>
          <button
            className="secondary-button"
            style={{ padding: compact ? "0.5rem 0.75rem" : "0.55rem 0.9rem", fontSize: "0.84rem" }}
            onClick={() => void handleOpenFolder(job)}
            title="Apri cartella in Explorer"
            disabled={job.folderExists === false}
          >
            Apri
          </button>
          <button
            className="secondary-button"
            style={{ padding: compact ? "0.5rem 0.75rem" : "0.55rem 0.9rem", fontSize: "0.84rem" }}
            onClick={() => void handleOpenInPhotoSelector(job)}
            title="Apri questa cartella in Image Select Pro"
            disabled={job.folderExists === false || openingSelectionJobId === job.id}
          >
            {openingSelectionJobId === job.id ? "Apro..." : "Seleziona"}
          </button>
          <button
            className="ghost-button"
            style={{ padding: compact ? "0.5rem 0.75rem" : "0.55rem 0.9rem", fontSize: "0.84rem" }}
            onClick={() => void handleCopyPath(job)}
            title="Copia percorso"
          >
            {copiedPath === job.percorsoCartella ? "Copiato" : "Percorso"}
          </button>
          {hasContract && (
            <button
              className="secondary-button"
              style={{
                padding: compact ? "0.5rem 0.75rem" : "0.55rem 0.9rem",
                fontSize: "0.84rem",
                borderColor: "rgba(142, 178, 142, 0.55)",
                background: "rgba(142, 178, 142, 0.16)",
                color: "var(--success)",
              }}
              onClick={() => handleOpenContract(job)}
              title="Apri contratto"
            >
              Contratto
            </button>
          )}

          <details style={{ position: "relative" }}>
            <summary
              className="ghost-button"
              style={{ padding: compact ? "0.5rem 0.75rem" : "0.55rem 0.9rem", fontSize: "0.84rem", cursor: "pointer", listStyle: "none" }}
            >
              Altro
            </summary>
            <div
              style={{
                position: "absolute",
                right: 0,
                top: "calc(100% + 0.35rem)",
                minWidth: 210,
                display: "grid",
                gap: "0.35rem",
                padding: "0.45rem",
                borderRadius: 12,
                border: "1px solid var(--line)",
                background: "var(--bg-panel)",
                zIndex: 20,
                boxShadow: "var(--shadow)",
              }}
            >
              <button
                className="ghost-button"
                style={{ padding: "0.5rem 0.7rem", fontSize: "0.84rem", textAlign: "left", justifyContent: "flex-start" }}
                onClick={() => startEditContract(job)}
                title={hasContract ? "Modifica link contratto" : "Aggiungi link contratto"}
              >
                {hasContract ? "Modifica link" : "Aggiungi link contratto"}
              </button>
              <button
                className="ghost-button"
                style={{ padding: "0.5rem 0.7rem", fontSize: "0.84rem", textAlign: "left", justifyContent: "flex-start" }}
                onClick={() => openBqModal(job, false)}
                disabled={generatingLowQualityFor === job.id}
                title={hasLowQuality ? "Aggiorna BQ (genera mancanti)" : "Genera JPG in BASSA_QUALITA"}
              >
                {generatingLowQualityFor === job.id ? "Generazione BQ..." : hasLowQuality ? "Aggiorna BassaQ" : "Genera BassaQ"}
              </button>
              {hasLowQuality && (
                <button
                  className="secondary-button"
                  style={{ padding: "0.5rem 0.7rem", fontSize: "0.84rem", textAlign: "left", justifyContent: "flex-start" }}
                  onClick={() => openBqModal(job, true)}
                  disabled={regeneratingLowQualityFor === job.id}
                  title="Rigenera JPG in BASSA_QUALITA sovrascrivendo i file esistenti"
                >
                  {regeneratingLowQualityFor === job.id ? "Rigenerazione..." : "Rigenera BQ"}
                </button>
              )}
              {job.folderExists === false && (
                <button
                  className="ghost-button"
                  style={{ padding: "0.5rem 0.7rem", fontSize: "0.84rem", textAlign: "left", justifyContent: "flex-start" }}
                  onClick={() => removeArchivedJob(job)}
                  disabled={deletingJobId === job.id}
                  title="Rimuovi voce dall'archivio"
                >
                  {deletingJobId === job.id ? "Rimuovo..." : "Rimuovi dall'archivio"}
                </button>
              )}
            </div>
          </details>
        </div>

        {feedback && (
          <div style={{ width: "100%", marginTop: "0.2rem", textAlign: "right" }}>
            <span
              style={{
                fontSize: "0.76rem",
                color: feedback.tone === "success" ? "var(--success)" : feedback.tone === "error" ? "var(--danger)" : "var(--text-muted)",
              }}
            >
              {feedback.text}
            </span>
          </div>
        )}
      </div>
    );
  }

  const CompactRow = ({ index, style, rowJobs, ariaAttributes }: RowComponentProps<{ rowJobs: Job[] }>) => {
    const job = rowJobs[index];
    if (!job) return null;
    return (
      <div style={{ ...style, padding: "0.2rem 0.2rem" }} {...ariaAttributes}>
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-md)",
            background: "rgba(255, 255, 255, 0.02)",
            padding: "0.45rem 0.55rem",
            height: "100%",
          }}
        >
          {renderJobItem(job, true)}
        </div>
      </div>
    );
  };

  return (
    <div className="stack">
      {/* Header */}
      <div className="workspace__header">
        <div>
          <h2>Archivio lavori</h2>
          <p style={{ margin: 0, color: "var(--text-muted)" }}>
            {jobs.length > 0
              ? `${jobs.length} lavori trovati`
              : "Nessun lavoro ancora importato."}
          </p>
        </div>
        <div className="workspace__header-actions">
          <button
            className="secondary-button"
            onClick={() => void handleAnalyzeArchive()}
            disabled={loading || analyzingArchive || renameBusy}
            title="Controlla i nomi delle cartelle e prepara le eventuali correzioni. Nessuna cartella viene rinominata senza la tua conferma."
            aria-busy={analyzingArchive}
          >
            {analyzingArchive ? "Controllo in corso…" : "Controlla nomi cartelle"}
          </button>
          <button className="ghost-button" onClick={() => setShowMissingFolders((prev) => !prev)}>
            {showMissingFolders ? "Nascondi mancanti" : "Mostra mancanti"}
          </button>
          <button className="ghost-button" onClick={onRefresh} disabled={loading}>
            {loading ? "Aggiorno…" : "⟳ Aggiorna"}
          </button>
        </div>
      </div>

      {analyzingArchive && (
        <div className="archive-analysis-progress" role="status" aria-live="polite">
          <div className="archive-analysis-progress__copy">
            <strong>Controllo dell’archivio in corso</strong>
            <span>
              Leggo l’indice e confronto i nomi delle cartelle. Non modifico nulla senza conferma
              {analysisElapsedSeconds > 0 ? ` · ${formatDurationSeconds(analysisElapsedSeconds)}` : ""}.
            </span>
          </div>
          <div className="archive-analysis-progress__track" aria-hidden="true">
            <span />
          </div>
          <small>Puoi cambiare sezione: il controllo continuerà in background.</small>
        </div>
      )}

      {archiveRenameProgress && archiveRenameProgress.phase !== "idle" && (
        <div
          className="archive-analysis-progress"
          role="status"
          aria-live="polite"
          style={archiveRenameProgress.phase === "error" ? { borderColor: "rgba(212, 163, 156, 0.45)" } : undefined}
        >
          <div className="archive-analysis-progress__copy">
            <strong>
              {archiveRenameProgress.active
                ? "Rinomina cartelle in corso"
                : archiveRenameProgress.phase === "completed"
                  ? "Rinomina completata"
                  : "Rinomina non completata"}
            </strong>
            <span>{archiveRenameProgress.message}</span>
          </div>
          {archiveRenameProgress.total > 0 && (
            <>
              <div
                className="archive-analysis-progress__track archive-analysis-progress__track--determinate"
                role="progressbar"
                aria-label="Avanzamento rinomina cartelle"
                aria-valuemin={0}
                aria-valuemax={archiveRenameProgress.total}
                aria-valuenow={archiveRenameProgress.completed}
              >
                <span style={{ width: `${Math.round((archiveRenameProgress.completed / archiveRenameProgress.total) * 100)}%` }} />
              </div>
              <small>
                {archiveRenameProgress.completed} di {archiveRenameProgress.total} cartelle
                {archiveRenameProgress.active ? " · puoi cambiare sezione, il lavoro continuerà." : ""}
              </small>
            </>
          )}
        </div>
      )}

      {/* Search */}
      <label className="field">
        <span>Cerca per nome, autore o data</span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="es. Maria Rossi oppure 2026-03"
        />
      </label>

      {hasGlobalSearch && (
        <div
          className="message-box"
          style={{
            borderColor: "rgba(184, 154, 99, 0.45)",
            background: "rgba(184, 154, 99, 0.1)",
            padding: "0.6rem 0.8rem",
          }}
        >
          <p style={{ margin: 0, fontSize: "0.84rem", color: "var(--text-muted)" }}>
            Ricerca globale attiva: i filtri Anno e Categoria sono temporaneamente ignorati.
          </p>
        </div>
      )}

      <div style={{ display: "grid", gap: "0.7rem", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <label className="field" style={{ gap: "0.35rem" }}>
          <span>Filtro Anno</span>
          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            disabled={hasGlobalSearch}
            title={hasGlobalSearch ? "Disattivato durante ricerca globale" : undefined}
          >
            <option value="">Tutti gli anni</option>
            {availableYears.map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </label>

        <label className="field" style={{ gap: "0.35rem" }}>
          <span>Filtro Categoria</span>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            disabled={hasGlobalSearch}
            title={hasGlobalSearch ? "Disattivato durante ricerca globale" : undefined}
          >
            <option value="">Tutte le categorie</option>
            {categoryOptions.map((category) => (
              <option key={category.value} value={category.value}>{category.label}</option>
            ))}
          </select>
        </label>

        <div style={{ display: "flex", alignItems: "end" }}>
          <button
            className="ghost-button"
            onClick={() => {
              setYearFilter("");
              setCategoryFilter("");
              setSearch("");
            }}
            disabled={!yearFilter && !categoryFilter && !search.trim()}
            style={{ padding: "0.65rem 0.95rem", fontSize: "0.87rem", width: "100%" }}
          >
            Reset filtri
          </button>
        </div>
      </div>

      {(hasGlobalSearch || yearFilter || categoryFilter || showMissingFolders) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
          {hasGlobalSearch && (
            <button
              className="ghost-button"
              onClick={() => setSearch("")}
              style={{ padding: "0.35rem 0.62rem", fontSize: "0.8rem" }}
              title="Rimuovi filtro ricerca"
            >
              Ricerca: {search.trim()} ×
            </button>
          )}
          {yearFilter && (
            <button
              className="ghost-button"
              onClick={() => setYearFilter("")}
              style={{ padding: "0.35rem 0.62rem", fontSize: "0.8rem" }}
              title="Rimuovi filtro anno"
            >
              Anno: {yearFilter} ×
            </button>
          )}
          {categoryFilter && (
            <button
              className="ghost-button"
              onClick={() => setCategoryFilter("")}
              style={{ padding: "0.35rem 0.62rem", fontSize: "0.8rem" }}
              title="Rimuovi filtro categoria"
            >
              Categoria: {selectedCategoryLabel} ×
            </button>
          )}
          {showMissingFolders && (
            <button
              className="ghost-button"
              onClick={() => setShowMissingFolders(false)}
              style={{ padding: "0.35rem 0.62rem", fontSize: "0.8rem" }}
              title="Nascondi voci con cartella mancante"
            >
              Mancanti visibili ×
            </button>
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.8rem",
          color: "var(--text-muted)",
          fontSize: "0.86rem",
        }}
      >
        <span>
          Mostrati <strong style={{ color: "var(--text)" }}>{filtered.length}</strong> di <strong style={{ color: "var(--text)" }}>{jobs.length}</strong>
        </span>
        <div className="button-row" style={{ gap: "0.35rem" }}>
          <button
            className={viewMode === "compatta" ? "secondary-button" : "ghost-button"}
            onClick={() => setViewMode("compatta")}
            style={{ padding: "0.38rem 0.62rem", fontSize: "0.78rem" }}
          >
            Compatta
          </button>
          <button
            className={viewMode === "dettagliata" ? "secondary-button" : "ghost-button"}
            onClick={() => setViewMode("dettagliata")}
            style={{ padding: "0.38rem 0.62rem", fontSize: "0.78rem" }}
          >
            Dettagliata
          </button>
        </div>
      </div>

      {/* Jobs list */}
      {loading && (
        <p style={{ color: "var(--text-muted)", textAlign: "center" }}>Caricamento…</p>
      )}

      {!loading && filtered.length === 0 && (
        <div className="message-box">
          <p style={{ color: "var(--text-muted)" }}>
            {search.trim()
              ? "Nessun lavoro corrisponde alla ricerca."
              : jobs.some((job) => job.folderExists === false) && !showMissingFolders
                ? "Nessun lavoro visibile. Ci sono voci con cartella mancante nascoste: usa «Mostra mancanti» se vuoi rimuoverle dall'archivio."
              : "Nessun lavoro ancora. Vai su «Nuovo lavoro» per iniziare."}
          </p>
        </div>
      )}

      {!loading && filtered.length > 0 && viewMode === "dettagliata" && (
        <ul className="sheet-plan">
          {filtered.map((job) => {
            return (
              <li key={job.id}>{renderJobItem(job, false)}</li>
            );
          })}
        </ul>
      )}

      {!loading && filtered.length > 0 && viewMode === "compatta" && (
        <div className="panel-section" style={{ padding: "0.4rem", overflow: "hidden" }}>
          <VirtualList
            rowCount={filtered.length}
            rowHeight={92}
            rowComponent={CompactRow}
            rowProps={{ rowJobs: filtered }}
            style={{
              height: Math.min(620, Math.max(96, filtered.length * 92)),
              width: "100%",
            }}
          />
        </div>
      )}

      {contractFeedback && (
        <div
          className="message-box"
          style={{
            borderColor: contractFeedback.type === "success" ? "rgba(142, 178, 142, 0.4)" : "rgba(212, 163, 156, 0.4)",
            background: contractFeedback.type === "success" ? "rgba(142, 178, 142, 0.08)" : "rgba(212, 163, 156, 0.08)",
          }}
        >
          <p style={{ color: contractFeedback.type === "success" ? "var(--success)" : "var(--danger)" }}>
            {contractFeedback.text}
          </p>
        </div>
      )}

      {lowQualityFeedback && (
        <div
          className="message-box"
          style={{
            borderColor: lowQualityFeedback.type === "success" ? "rgba(142, 178, 142, 0.4)" : "rgba(212, 163, 156, 0.4)",
            background: lowQualityFeedback.type === "success" ? "rgba(142, 178, 142, 0.08)" : "rgba(212, 163, 156, 0.08)",
          }}
        >
          <p style={{ color: lowQualityFeedback.type === "success" ? "var(--success)" : "var(--danger)" }}>
            {lowQualityFeedback.text}
          </p>
        </div>
      )}

      {archiveAnalysis && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(7, 10, 9, 0.76)",
            display: "grid",
            placeItems: "center",
            zIndex: 90,
            padding: "1rem",
          }}
        >
          <div
            className="panel-section"
            style={{
              width: "min(920px, 100%)",
              height: "88vh",
              maxHeight: 900,
              overflow: "hidden",
              padding: "1.1rem",
              borderColor: "var(--line-strong)",
              background: "rgba(27, 33, 30, 0.99)",
            }}
          >
            <div className="archive-repair-modal__layout" style={{ gap: "0.85rem" }}>
              <div>
                <strong style={{ fontSize: "1.05rem" }}>Sistema e allinea i nomi delle cartelle</strong>
                <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.84rem", wordBreak: "break-all" }}>
                  {archiveAnalysis.archiveRoot}
                </p>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
                {renderStatusBadge(`${archiveAnalysis.scannedJobs} mappate`, "ok")}
                {renderStatusBadge(`${archiveAnalysis.alignedJobs} allineate`, "ok")}
                {renderStatusBadge(`${archiveAnalysis.renameReadyJobs} rinominabili`, archiveAnalysis.renameReadyJobs > 0 ? "todo" : "ok")}
                {renderStatusBadge(`${archiveAnalysis.needsReviewJobs} da verificare`, archiveAnalysis.needsReviewJobs > 0 ? "todo" : "ok")}
                {renderStatusBadge(`${archiveAnalysis.conflictJobs} conflitti`, archiveAnalysis.conflictJobs > 0 ? "missing" : "ok")}
              </div>

              {archiveAnalysis.registeredJobs > 0 && (
                <div className="message-box" style={{ padding: "0.55rem 0.7rem" }}>
                  <p style={{ margin: 0, fontSize: "0.84rem" }}>
                    {archiveAnalysis.registeredJobs} nuove cartelle registrate stabilmente nell'archivio.
                  </p>
                </div>
              )}

              {archiveAnalysis.warnings.length > 0 && (
                <div
                  className="message-box"
                  style={{ borderColor: "rgba(212, 163, 156, 0.4)", background: "rgba(212, 163, 156, 0.08)" }}
                >
                  <p style={{ margin: "0 0 0.35rem", color: "var(--danger)", fontSize: "0.84rem" }}>
                    Analisi incompleta: {archiveAnalysis.warnings.length} cartelle non leggibili.
                  </p>
                  <ul style={{ margin: 0, paddingLeft: "1.1rem", color: "var(--text-muted)", fontSize: "0.78rem" }}>
                    {archiveAnalysis.warnings.slice(0, 10).map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                </div>
              )}

              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.84rem" }}>
                Correggi nome e data dove necessario, controlla l'anteprima e seleziona le cartelle da rinominare. Nessuna modifica avviene senza conferma.
              </p>

              <div className="stack archive-repair-modal__list" style={{ gap: "0.45rem", paddingRight: "0.55rem" }}>
                {archiveAnalysis.items.filter((item) => item.status !== "aligned").map((item) => {
                  const draft = renameDrafts[item.jobId] ?? { nomeLavoro: item.nomeLavoro, dataLavoro: item.dataLavoro ?? "" };
                  const repairedFolderName = buildRepairedFolderName(draft);
                  const canRename = Boolean(repairedFolderName) && repairedFolderName !== item.currentFolderName;
                  return (
                    <div
                      key={item.jobId}
                      style={{
                        display: "grid",
                        gap: "0.35rem",
                        padding: "0.65rem 0.72rem",
                        border: `1px solid ${canRename && selectedRenameIds.has(item.jobId) ? "var(--line-strong)" : "var(--line)"}`,
                        borderRadius: 10,
                        background: canRename && selectedRenameIds.has(item.jobId) ? "rgba(255,255,255,0.05)" : "transparent",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
                        <input
                          type="checkbox"
                          checked={selectedRenameIds.has(item.jobId)}
                          disabled={!canRename || renameBusy}
                          onChange={() => toggleRenameSelection(item.jobId)}
                          style={{ accentColor: "var(--accent)" }}
                        />
                        <strong style={{ fontSize: "0.88rem" }}>{item.currentFolderName}</strong>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) 170px", gap: "0.55rem" }}>
                        <label className="field" style={{ gap: "0.25rem" }}>
                          <span>Nome lavoro</span>
                          <input
                            type="text"
                            value={draft.nomeLavoro}
                            disabled={renameBusy}
                            onChange={(event) => updateRenameDraft(item.jobId, { nomeLavoro: event.target.value })}
                          />
                        </label>
                        <label className="field" style={{ gap: "0.25rem" }}>
                          <span>Data lavoro</span>
                          <input
                            type="date"
                            value={draft.dataLavoro}
                            disabled={renameBusy}
                            onChange={(event) => updateRenameDraft(item.jobId, { dataLavoro: event.target.value })}
                          />
                        </label>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.35rem", fontSize: "0.82rem" }}>
                        <span style={{ color: "var(--text-muted)" }}>→</span>
                        <strong style={{ color: canRename ? "var(--success)" : "var(--text-muted)", wordBreak: "break-word" }}>
                          {repairedFolderName || "Inserisci nome e data per vedere il nome corretto"}
                        </strong>
                      </div>
                      <span style={{ color: item.status === "conflict" ? "var(--danger)" : "var(--text-muted)", fontSize: "0.78rem" }}>
                        {item.reason}
                      </span>
                    </div>
                  );
                })}
                {archiveAnalysis.items.every((item) => item.status === "aligned") && (
                  <div className="message-box">
                    <p style={{ margin: 0, color: "var(--success)" }}>Tutte le cartelle riconosciute sono gia allineate.</p>
                  </div>
                )}
              </div>

              <div className="button-row archive-repair-modal__footer" style={{ justifyContent: "flex-end" }}>
                <button
                  className="ghost-button"
                  onClick={() => setArchiveAnalysis(null)}
                  disabled={renameBusy}
                >
                  Chiudi
                </button>
                <button
                  className="secondary-button"
                  onClick={() => void confirmArchiveRename()}
                  disabled={renameBusy || selectedRenameIds.size === 0}
                >
                  {renameBusy
                    ? archiveRenameProgress?.total
                      ? `Rinomino ${archiveRenameProgress.completed}/${archiveRenameProgress.total}...`
                      : "Avvio rinomina..."
                    : `Rinomina selezionate (${selectedRenameIds.size})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectionModalJob && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(7, 10, 9, 0.72)",
            display: "grid",
            placeItems: "center",
            zIndex: 85,
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
            <div className="stack" style={{ gap: "0.85rem" }}>
              <div>
                <strong style={{ fontSize: "1rem" }}>Scegli cartella per Image Select Pro</strong>
                <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.86rem" }}>
                  {selectionModalJob.nomeLavoro}
                </p>
              </div>

              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.86rem" }}>
                Ho trovato piu cartelle valide. Seleziona quella da aprire.
              </p>

              <div className="stack" style={{ gap: "0.35rem", maxHeight: "42vh", overflowY: "auto", paddingRight: "0.2rem" }}>
                {selectionModalCandidates.map((candidate) => (
                  <label
                    key={candidate.path}
                    style={{
                      display: "grid",
                      gap: "0.28rem",
                      padding: "0.55rem 0.62rem",
                      borderRadius: 8,
                      border: `1px solid ${selectionModalSelectedPath === candidate.path ? "var(--line-strong)" : "var(--line)"}`,
                      background: selectionModalSelectedPath === candidate.path ? "rgba(255,255,255,0.06)" : "transparent",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <input
                        type="radio"
                        name="selection-folder"
                        value={candidate.path}
                        checked={selectionModalSelectedPath === candidate.path}
                        onChange={() => setSelectionModalSelectedPath(candidate.path)}
                        style={{ accentColor: "var(--accent)" }}
                      />
                      <strong style={{ fontSize: "0.87rem" }}>{candidate.label}</strong>
                    </div>
                    <span style={{ color: "var(--text-muted)", fontSize: "0.79rem" }}>
                      {candidate.fileCount} file supportati
                    </span>
                    <span style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: "0.75rem", wordBreak: "break-all" }}>
                      {candidate.path}
                    </span>
                  </label>
                ))}
              </div>

              <div className="button-row" style={{ justifyContent: "flex-end" }}>
                <button
                  className="ghost-button"
                  style={{ padding: "0.5rem 0.9rem", fontSize: "0.86rem" }}
                  onClick={closeSelectionModal}
                  disabled={selectionModalOpening}
                >
                  Annulla
                </button>
                <button
                  className="secondary-button"
                  style={{ padding: "0.5rem 0.9rem", fontSize: "0.86rem" }}
                  disabled={selectionModalOpening || !selectionModalSelectedPath.trim()}
                  onClick={() => { void confirmSelectionModal(); }}
                >
                  {selectionModalOpening ? "Apro..." : "Apri selezione"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Subfolder selection modal */}
      {bqModalJob && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(7, 10, 9, 0.72)",
            display: "grid",
            placeItems: "center",
            zIndex: 80,
            padding: "1rem",
          }}
        >
          <div
            className="panel-section"
            style={{
              width: "min(520px, 100%)",
              padding: "1.1rem",
              borderColor: "var(--line-strong)",
              background: "rgba(27, 33, 30, 0.98)",
            }}
          >
            <div className="stack" style={{ gap: "0.85rem" }}>
              <div>
                <strong style={{ fontSize: "1rem" }}>
                  {bqModalJob.overwrite ? "Rigenera" : "Genera"} BASSA_QUALITA
                </strong>
                <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.86rem" }}>
                  {bqModalJob.job.nomeLavoro}
                </p>
              </div>

              <div>
                <p style={{ margin: "0 0 0.5rem", fontSize: "0.87rem" }}>Cartella sorgente:</p>
                {bqModalLoading ? (
                  <p style={{ color: "var(--text-muted)", fontSize: "0.86rem" }}>Caricamento cartelle…</p>
                ) : (
                  <div className="stack" style={{ gap: "0.35rem" }}>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        padding: "0.45rem 0.6rem",
                        borderRadius: 8,
                        border: `1px solid ${bqModalSelected === "__all__" ? "var(--line-strong)" : "var(--line)"}`,
                        background: bqModalSelected === "__all__" ? "rgba(255,255,255,0.06)" : "transparent",
                        cursor: "pointer",
                        fontSize: "0.87rem",
                      }}
                    >
                      <input
                        type="radio"
                        name="bq-subfolder"
                        value="__all__"
                        checked={bqModalSelected === "__all__"}
                        onChange={() => setBqModalSelected("__all__")}
                        style={{ accentColor: "var(--accent)" }}
                      />
                      Tutte le cartelle
                    </label>
                    {bqModalSubfolders.map((folder) => (
                      <label
                        key={folder}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          padding: "0.45rem 0.6rem",
                          borderRadius: 8,
                          border: `1px solid ${bqModalSelected === folder ? "var(--line-strong)" : "var(--line)"}`,
                          background: bqModalSelected === folder ? "rgba(255,255,255,0.06)" : "transparent",
                          cursor: "pointer",
                          fontSize: "0.87rem",
                          fontFamily: "monospace",
                        }}
                      >
                        <input
                          type="radio"
                          name="bq-subfolder"
                          value={folder}
                          checked={bqModalSelected === folder}
                          onChange={() => setBqModalSelected(folder)}
                          style={{ accentColor: "var(--accent)" }}
                        />
                        {folder}
                      </label>
                    ))}
                    {bqModalSubfolders.length === 0 && (
                      <p style={{ color: "var(--text-muted)", fontSize: "0.84rem", margin: 0 }}>
                        Nessuna sottocartella trovata — verrà elaborata la cartella del lavoro.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="button-row" style={{ justifyContent: "flex-end" }}>
                <button
                  className="ghost-button"
                  style={{ padding: "0.5rem 0.9rem", fontSize: "0.86rem" }}
                  onClick={() => setBqModalJob(null)}
                >
                  Annulla
                </button>
                <button
                  className="secondary-button"
                  style={{ padding: "0.5rem 0.9rem", fontSize: "0.86rem" }}
                  disabled={bqModalLoading}
                  onClick={() => void confirmBqModal()}
                >
                  {bqModalJob.overwrite ? "Rigenera" : "Genera"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeLowQualityJobId && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(7, 10, 9, 0.72)",
            display: "grid",
            placeItems: "center",
            zIndex: 70,
            padding: "1rem",
          }}
        >
          <div
            className="panel-section"
            style={{
              width: "min(740px, 100%)",
              padding: "1rem",
              borderColor: "var(--line-strong)",
              background: "rgba(27, 33, 30, 0.98)",
            }}
          >
            <div className="stack" style={{ gap: "0.75rem" }}>
              <strong style={{ fontSize: "1.02rem" }}>Stato generazione BASSA_QUALITA</strong>
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.9rem" }}>
                {lowQualityProgress?.phase === "scanning"
                  ? "Scansione JPG sorgente"
                  : lowQualityProgress?.phase === "compressing"
                    ? "Compressione JPG in corso"
                    : "Preparazione..."}
              </p>

              <div style={{ width: "100%", height: 10, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                <div
                  style={{
                    width: `${Math.max(3, lowQualityProgress?.progressPct ?? 3)}%`,
                    height: "100%",
                    background: "linear-gradient(90deg, #7ea37e, #9ac69a)",
                    transition: "width 220ms ease",
                  }}
                />
              </div>

              <div className="stats-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                <div className="stat-card">
                  <span>Elaborati</span>
                  <strong style={{ fontSize: "1.03rem" }}>
                    {(lowQualityProgress?.processedJpg ?? 0)}/{Math.max(lowQualityProgress?.totalJpg ?? 0, 0)}
                  </strong>
                </div>
                <div className="stat-card">
                  <span>Generati</span>
                  <strong style={{ fontSize: "1.03rem" }}>{lowQualityProgress?.generated ?? 0}</strong>
                </div>
                <div className="stat-card">
                  <span>Tempo restante</span>
                  <strong style={{ fontSize: "1.03rem" }}>
                    {lowQualityProgress?.estimatedRemainingSec !== null
                      ? formatDurationSeconds(lowQualityProgress?.estimatedRemainingSec ?? 0)
                      : "calcolo..."}
                  </strong>
                </div>
              </div>

              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.84rem" }}>
                Trascorso {formatDurationSeconds((lowQualityProgress?.elapsedMs ?? 0) / 1000)} · saltati {lowQualityProgress?.skippedExisting ?? 0} · errori {lowQualityProgress?.errors ?? 0}
              </p>
              {lowQualityProgress?.jobName && (
                <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.82rem" }}>
                  Lavoro: {lowQualityProgress.jobName}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {archiveFeedback && (
        <div
          className="message-box"
          style={{
            borderColor: archiveFeedback.type === "success" ? "rgba(142, 178, 142, 0.4)" : "rgba(212, 163, 156, 0.4)",
            background: archiveFeedback.type === "success" ? "rgba(142, 178, 142, 0.08)" : "rgba(212, 163, 156, 0.08)",
          }}
        >
          <p style={{ color: archiveFeedback.type === "success" ? "var(--success)" : "var(--danger)" }}>
            {archiveFeedback.text}
          </p>
        </div>
      )}
    </div>
  );
}
