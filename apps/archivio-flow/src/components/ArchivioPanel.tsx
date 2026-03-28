import { useEffect, useRef, useState } from "react";
import { List as VirtualList, type RowComponentProps } from "react-window";
import type { Job, LowQualityProgressSnapshot } from "../types";
import {
  deleteArchivioJob,
  generateArchivioLowQuality,
  getArchivioLowQualityProgress,
  openArchivioFolder,
  updateArchivioJobContractLink,
} from "../archivioDesktopApi";

interface Props {
  jobs: Job[];
  loading: boolean;
  onRefresh: () => void;
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

export function ArchivioPanel({ jobs, loading, onRefresh }: Props) {
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
  const [rowFeedbackByJob, setRowFeedbackByJob] = useState<Record<string, { text: string; tone: RowFeedbackTone }>>({});
  const [contractFeedback, setContractFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [lowQualityFeedback, setLowQualityFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [archiveFeedback, setArchiveFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const feedbackTimersRef = useRef<Record<string, number>>({});

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

  async function generateLowQuality(job: Job, overwrite: boolean) {
    if (overwrite) {
      setRegeneratingLowQualityFor(job.id);
    } else {
      setGeneratingLowQualityFor(job.id);
    }
    setActiveLowQualityJobId(job.id);
    setLowQualityProgress(null);
    setLowQualityFeedback(null);
    try {
      const data = await generateArchivioLowQuality(job.id, overwrite);
      setLowQualityFeedback({
        type: "success",
        text: `${overwrite ? "Rigenerazione" : "Generazione"} BASSA_QUALITA completata: generati ${data.generated ?? 0}, già presenti ${data.skippedExisting ?? 0}, errori ${data.errors ?? 0}`,
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
                onClick={() => generateLowQuality(job, false)}
                disabled={generatingLowQualityFor === job.id}
                title={hasLowQuality ? "Aggiorna BQ (genera mancanti)" : "Genera JPG in BASSA_QUALITA"}
              >
                {generatingLowQualityFor === job.id ? "Generazione BQ..." : hasLowQuality ? "Aggiorna BassaQ" : "Genera BassaQ"}
              </button>
              {hasLowQuality && (
                <button
                  className="secondary-button"
                  style={{ padding: "0.5rem 0.7rem", fontSize: "0.84rem", textAlign: "left", justifyContent: "flex-start" }}
                  onClick={() => generateLowQuality(job, true)}
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
          <button className="ghost-button" onClick={() => setShowMissingFolders((prev) => !prev)}>
            {showMissingFolders ? "Nascondi mancanti" : "Mostra mancanti"}
          </button>
          <button className="ghost-button" onClick={onRefresh} disabled={loading}>
            {loading ? "Aggiorno…" : "⟳ Aggiorna"}
          </button>
        </div>
      </div>

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
