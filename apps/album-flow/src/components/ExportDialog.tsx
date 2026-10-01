import { useMemo, useRef, useState } from "react";
import type { AlbumProjectV2 } from "@photo-tools/shared-types";
import { hasDesktop, revealInFolder } from "../desktop/api";
import { preflightReport } from "../model/preflight";
import { browserWriter, chooseDesktopWriter, exportProjectFile, exportSpreads, spreadPixelSize } from "../render/export";
import { Icon } from "./icons";
import { Field, Modal, Segmented } from "./ui";

/** «3-8, 12» → spread 3..8 e 12 (numeri da 1). Ignora i doppioni e segnala i valori fuori dall'album. */
export function parseSpreadRange(text: string, count: number): { indexes: number[]; error: string | null } {
  const chosen = new Set<number>();
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const match = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part);
    if (!match) return { indexes: [], error: `«${part}» non è un numero o un intervallo (es. 3-8).` };
    const from = Number(match[1]);
    const to = match[2] ? Number(match[2]) : from;
    if (from < 1 || to < from || to > count) return { indexes: [], error: `Gli spread vanno da 1 a ${count}.` };
    for (let n = from; n <= to; n += 1) chosen.add(n - 1);
  }
  return { indexes: [...chosen].sort((a, b) => a - b), error: null };
}

/** Esportazione: controlli prima della stampa, poi JPG o SVG per spread e file progetto. */
export function ExportDialog({ project, currentIndex, onClose, onStatus, onGoTo }: {
  project: AlbumProjectV2;
  currentIndex: number;
  onClose: () => void;
  onStatus: (message: string) => void;
  onGoTo: (spreadIndex: number) => void;
}) {
  const report = useMemo(() => preflightReport(project), [project]);
  const [scope, setScope] = useState<"all" | "current" | "range">("all");
  const [rangeText, setRangeText] = useState("");
  const [dpi, setDpi] = useState(Math.min(300, project.settings.sheet.dpi || 300));
  const [quality, setQuality] = useState(92);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const signal = useRef({ cancelled: false });
  const busy = progress !== null;
  const blocked = report.errors > 0;
  const range = useMemo(() => parseSpreadRange(rangeText, project.spreads.length), [rangeText, project.spreads.length]);
  const indexes = scope === "all" ? project.spreads.map((_, index) => index) : scope === "current" ? [currentIndex] : range.indexes;
  const size = spreadPixelSize(project, dpi);
  const desktop = hasDesktop();

  async function run(kind: "jpg" | "svg") {
    setError(null);
    signal.current = { cancelled: false };
    try {
      const writer = desktop ? await chooseDesktopWriter() : browserWriter();
      if (!writer) return;
      setProgress({ done: 0, total: indexes.length });
      const result = await exportSpreads(project, writer, { kind, dpi, quality: quality / 100, spreads: indexes, signal: signal.current, onProgress: (done, total) => setProgress({ done, total }) });
      onStatus(signal.current.cancelled ? `Esportazione interrotta dopo ${result.count} spread.` : `${result.count} ${result.count === 1 ? "spread esportato" : "spread esportati"} in ${kind.toUpperCase()} (${writer.where()}).`);
      if (result.written[0] && desktop) void revealInFolder(result.written[0]);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Esportazione non riuscita.");
      setProgress(null);
    }
  }

  async function saveProject() {
    try {
      const writer = desktop ? await chooseDesktopWriter() : browserWriter();
      if (!writer) return;
      const path = await exportProjectFile(project, writer);
      onStatus("Progetto salvato in un file FileX Album.");
      if (path) void revealInFolder(path);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Impossibile salvare il progetto.");
    }
  }

  const issues = report.issues.filter((issue) => issue.level !== "info" || report.issues.length < 8);

  return (
    <Modal
      title="Esporta l'album"
      subtitle={`${project.projectName} · ${report.stats.spreads} spread · ${report.stats.photos} foto`}
      onClose={busy ? () => { signal.current.cancelled = true; } : onClose}
      wide
    >
      <section className="preflight" aria-label="Controlli prima dell'export">
        <h3>Controlli</h3>
        {issues.length === 0 ? <p className="ok-line"><Icon name="check" size={15} /> Tutto in ordine: formato valido, nessuna pagina vuota, risoluzione adeguata alla stampa.</p> : (
          <ul>
            {issues.slice(0, 40).map((issue, index) => (
              <li key={index} className={issue.level}>
                <Icon name={issue.level === "error" ? "close" : issue.level === "warning" ? "warning" : "info"} size={14} />
                <span>{issue.message}</span>
                {issue.spreadIndex !== undefined ? <button type="button" className="link-btn" onClick={() => { onGoTo(issue.spreadIndex!); onClose(); }}>Vai</button> : null}
              </li>
            ))}
            {issues.length > 40 ? <li className="info"><span>…e altri {issues.length - 40} avvisi.</span></li> : null}
          </ul>
        )}
      </section>

      <div className="export-options">
        <Field label="Cosa esportare">
          <Segmented label="Cosa esportare" value={scope} onChange={setScope} options={[{ value: "all", label: `Tutti gli spread (${project.spreads.length})` }, { value: "current", label: `Solo lo spread ${currentIndex + 1}` }, { value: "range", label: "Intervallo o numeri" }]} />
          {scope === "range" ? (
            <>
              <input className="input" autoFocus value={rangeText} onChange={(event) => setRangeText(event.target.value)} placeholder="Es. 3-8, 12, 20-22" aria-label="Spread da esportare" />
              <span className={`field__hint${range.error ? " warn" : ""}`}>{range.error ?? `${range.indexes.length} ${range.indexes.length === 1 ? "spread" : "spread"} su ${project.spreads.length}: ${range.indexes.length ? range.indexes.map((i) => i + 1).join(", ").slice(0, 80) : "scrivi i numeri"}`}</span>
            </>
          ) : null}
        </Field>
        <Field label="Risoluzione" hint={`Ogni spread: ${size.width} × ${size.height} px, abbondanza inclusa.`}>
          <Segmented label="Risoluzione" value={String(dpi)} onChange={(value) => setDpi(Number(value))} options={[{ value: "150", label: "150 dpi" }, { value: "200", label: "200 dpi" }, { value: "300", label: "300 dpi" }]} />
        </Field>
        <Field label={`Qualità JPG ${quality}%`}>
          <input type="range" min={70} max={100} step={1} value={quality} onChange={(event) => setQuality(Number(event.target.value))} aria-label="Qualità JPG" />
        </Field>
      </div>

      <div className="export-grid">
        <button type="button" className="export-card" disabled={blocked || busy || indexes.length === 0} onClick={() => void run("jpg")}>
          <Icon name="image" size={22} /><strong>JPG per spread</strong>
          <span>Un file per spread, abbondanza inclusa: il formato richiesto dalla maggior parte dei laboratori.</span>
        </button>
        <button type="button" className="export-card" disabled={blocked || busy || indexes.length === 0} onClick={() => void run("svg")}>
          <Icon name="layouts" size={22} /><strong>SVG per spread</strong>
          <span>Vettoriale con le foto incorporate, per verifiche o ritocchi in un programma grafico.</span>
        </button>
        <button type="button" className="export-card" disabled={busy} onClick={() => void saveProject()}>
          <Icon name="book" size={22} /><strong>Progetto FileX</strong>
          <span>File .filex-album.json con capitoli, layout e ritagli, da riaprire o condividere.</span>
        </button>
      </div>

      {progress ? (
        <div className="progress" role="status" aria-live="polite">
          <div className="progress__bar"><span style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} /></div>
          <span className="muted small">Spread {progress.done} di {progress.total}… <button type="button" className="link-btn" onClick={() => { signal.current.cancelled = true; }}>Interrompi</button></span>
        </div>
      ) : null}
      {error ? <p className="notice notice--warn">{error}</p> : null}
      {blocked ? <p className="notice notice--warn">Ci sono errori da correggere prima di esportare.</p> : null}
    </Modal>
  );
}
