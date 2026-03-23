import { useState } from "react";
import type { Job } from "../types";

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

async function openFolder(path: string) {
  try {
    await fetch("/api/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderPath: path }),
    });
  } catch {
    /* ignore */
  }
}

function openContractLink(link: string) {
  if (!link) return;
  window.open(link, "_blank", "noopener,noreferrer");
}

export function ArchivioPanel({ jobs, loading, onRefresh }: Props) {
  const [search, setSearch] = useState("");
  const [showMissingFolders, setShowMissingFolders] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [editingContractLink, setEditingContractLink] = useState("");
  const [savingContract, setSavingContract] = useState<string | null>(null);
  const [generatingLowQualityFor, setGeneratingLowQualityFor] = useState<string | null>(null);
  const [regeneratingLowQualityFor, setRegeneratingLowQualityFor] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [contractFeedback, setContractFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [lowQualityFeedback, setLowQualityFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [archiveFeedback, setArchiveFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const filtered = jobs.filter((job) => {
    if (!showMissingFolders && job.folderExists === false) return false;
    if (!search.trim()) return true;
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

  async function handleCopyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 1500);
    } catch {
      /* clipboard not available */
    }
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
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/contract-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contrattoLink: editingContractLink }),
      });
      const raw = await res.text();
      let data: { error?: string } = {};
      try {
        data = raw ? JSON.parse(raw) as { error?: string } : {};
      } catch {
        data = {};
      }
      if (!res.ok) {
        if (res.status === 404) {
          setContractFeedback({
            type: "error",
            text: "Endpoint non trovato (404). Riavvia il server Archivio Flow e riprova.",
          });
          return;
        }
        setContractFeedback({ type: "error", text: data?.error ?? `Salvataggio link non riuscito (HTTP ${res.status})` });
        return;
      }
      setContractFeedback({ type: "success", text: "Link contratto aggiornato" });
      setEditingJobId(null);
      setEditingContractLink("");
      onRefresh();
    } catch {
      setContractFeedback({ type: "error", text: "Server non raggiungibile" });
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
    setLowQualityFeedback(null);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/generate-low-quality`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overwrite }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLowQualityFeedback({
          type: "error",
          text: data?.error ?? "Generazione BASSA_QUALITA non riuscita",
        });
        return;
      }
      setLowQualityFeedback({
        type: "success",
        text: `${overwrite ? "Rigenerazione" : "Generazione"} BASSA_QUALITA completata: generati ${data.generated ?? 0}, già presenti ${data.skippedExisting ?? 0}, errori ${data.errors ?? 0}`,
      });
    } catch {
      setLowQualityFeedback({ type: "error", text: "Server non raggiungibile" });
    } finally {
      setGeneratingLowQualityFor(null);
      setRegeneratingLowQualityFor(null);
    }
  }

  async function removeArchivedJob(job: Job) {
    setDeletingJobId(job.id);
    setArchiveFeedback(null);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(job.id)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setArchiveFeedback({ type: "error", text: data?.error ?? "Rimozione archivio non riuscita" });
        return;
      }
      setArchiveFeedback({ type: "success", text: "Voce rimossa dall'archivio" });
      onRefresh();
    } catch {
      setArchiveFeedback({ type: "error", text: "Server non raggiungibile" });
    } finally {
      setDeletingJobId(null);
    }
  }

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

      {!loading && filtered.length > 0 && (
        <ul className="sheet-plan">
          {filtered.map((job) => (
            <li key={job.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
                <div className="stack" style={{ gap: "0.3rem", flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: "1rem" }}>{job.nomeLavoro}</strong>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "0.5rem",
                      color: "var(--text-muted)",
                      fontSize: "0.88rem",
                    }}
                  >
                    <span>📅 {formatDate(job.dataLavoro)}</span>
                    <span>👤 {job.autore}</span>
                    {job.annoArchivio && <span>🗂 {job.annoArchivio}</span>}
                    {job.categoriaArchivio && <span>📁 {job.categoriaArchivio}</span>}
                    <span>📁 {job.numeroFile} file</span>
                    <span>🕐 {formatDateTime(job.dataCreazione)}</span>
                    <span>{job.contrattoLink ? "🔗 contratto presente" : "⚪ contratto mancante"}</span>
                    <span>{job.folderExists === false ? "⚠ cartella mancante" : "📂 cartella presente"}</span>
                  </div>
                  <span
                    style={{
                      fontFamily: "monospace",
                      fontSize: "0.8rem",
                      color: "var(--text-muted)",
                      wordBreak: "break-all",
                    }}
                  >
                    {job.percorsoCartella}
                  </span>
                  {job.contrattoLink && (
                    <a
                      href={job.contrattoLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: "0.82rem", color: "var(--accent-strong)", wordBreak: "break-all" }}
                    >
                      Contratto: {job.contrattoLink}
                    </a>
                  )}
                  {editingJobId === job.id && (
                    <div style={{ marginTop: "0.4rem", display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
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

                {/* Actions */}
                <div className="button-row" style={{ flexShrink: 0 }}>
                  <button
                    className="secondary-button"
                    style={{ padding: "0.55rem 0.9rem", fontSize: "0.88rem" }}
                    onClick={() => openFolder(job.percorsoCartella)}
                    title="Apri cartella in Explorer"
                    disabled={job.folderExists === false}
                  >
                    📂 Apri
                  </button>
                  <button
                    className="ghost-button"
                    style={{ padding: "0.55rem 0.9rem", fontSize: "0.88rem" }}
                    onClick={() => handleCopyPath(job.percorsoCartella)}
                    title="Copia percorso"
                  >
                    {copiedPath === job.percorsoCartella ? "✓ Copiato" : "⧉ Percorso"}
                  </button>
                  {job.contrattoLink && (
                    <button
                      className="ghost-button"
                      style={{ padding: "0.55rem 0.9rem", fontSize: "0.88rem" }}
                      onClick={() => openContractLink(job.contrattoLink!)}
                      title="Apri contratto"
                    >
                      🔗 Contratto
                    </button>
                  )}
                  <button
                    className="ghost-button"
                    style={{ padding: "0.55rem 0.9rem", fontSize: "0.88rem" }}
                    onClick={() => startEditContract(job)}
                    title="Aggiungi o modifica link contratto"
                  >
                    ✎ Link
                  </button>
                  <button
                    className="ghost-button"
                    style={{ padding: "0.55rem 0.9rem", fontSize: "0.88rem" }}
                    onClick={() => generateLowQuality(job, false)}
                    disabled={generatingLowQualityFor === job.id}
                    title="Genera JPG in BASSA_QUALITA anche dopo la copia"
                  >
                    {generatingLowQualityFor === job.id ? "⏳ BQ..." : "🖼 BassaQ"}
                  </button>
                  <button
                    className="ghost-button"
                    style={{ padding: "0.55rem 0.9rem", fontSize: "0.88rem" }}
                    onClick={() => generateLowQuality(job, true)}
                    disabled={regeneratingLowQualityFor === job.id}
                    title="Rigenera JPG in BASSA_QUALITA sovrascrivendo i file esistenti"
                  >
                    {regeneratingLowQualityFor === job.id ? "⏳ Rigenera..." : "♻ Rigenera BQ"}
                  </button>
                  {job.folderExists === false && (
                    <button
                      className="ghost-button"
                      style={{ padding: "0.55rem 0.9rem", fontSize: "0.88rem" }}
                      onClick={() => removeArchivedJob(job)}
                      disabled={deletingJobId === job.id}
                      title="Rimuovi voce dall'archivio"
                    >
                      {deletingJobId === job.id ? "Rimuovo..." : "🗑 Rimuovi"}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
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
