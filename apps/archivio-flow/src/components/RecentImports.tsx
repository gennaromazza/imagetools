import { useEffect, useState } from "react";
import type { Job } from "../types";
import { getArchivioStudioFlowStatus, openArchivioFolder } from "../archivioDesktopApi";
import { recentImports, type RecentImport, type SessionLike } from "../wizardModel";

/** Elenco "Ultime importazioni": parte visibile, separata dai dati per poterla provare senza server. */
export function RecentImportsView({ items, onOpen }: { items: readonly RecentImport[]; onOpen: (folder: string) => void }) {
  if (items.length === 0) return <p className="recent-imports__empty">Qui compariranno le tue ultime importazioni, con un pulsante per riaprire la cartella.</p>;
  return <ul className="recent-imports" aria-label="Ultime importazioni">
    {items.map((item) => <li key={item.id}>
      <div>
        <strong>{item.jobName ?? "Lavoro senza nome"}</strong>
        <span>{item.files === 1 ? "1 file" : `${item.files.toLocaleString("it-IT")} file`} · {item.when}</span>
      </div>
      <button type="button" className="ghost-button" onClick={() => onOpen(item.folder)}>📂 Apri cartella</button>
    </li>)}
  </ul>;
}

/** Ultime importazioni concluse, lette dall'archivio. `collapsed` le mette in un riquadro chiuso (scheda gia' inserita). */
export function RecentImports({ jobs, collapsed, refreshKey = 0 }: { jobs: Job[]; collapsed?: boolean; refreshKey?: number }) {
  const [items, setItems] = useState<RecentImport[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getArchivioStudioFlowStatus()
      .then((status) => { if (active) setItems(recentImports(status.sessions as readonly SessionLike[], jobs)); })
      .catch(() => { if (active) setItems([]); });
    return () => { active = false; };
  }, [jobs, refreshKey]);

  async function open(folder: string) {
    setMessage(null);
    try { await openArchivioFolder(folder); } catch { setMessage("Non riesco ad aprire la cartella: potrebbe essere stata spostata."); }
  }

  const list = <>
    <RecentImportsView items={items} onOpen={(folder) => { void open(folder); }} />
    {message && <p role="alert" className="recent-imports__empty" style={{ color: "var(--danger)" }}>{message}</p>}
  </>;
  if (items.length === 0 && collapsed) return null;
  return collapsed
    ? <details className="import-advanced-panel"><summary>Ultime importazioni</summary>{list}</details>
    : <section className="panel-section" style={{ padding: "var(--space-4)" }}><h3 className="wizard-title">Ultime importazioni</h3>{list}</section>;
}
