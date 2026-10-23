import { useMemo, useRef, useState } from "react";
import type { AlbumProjectV2 } from "@photo-tools/shared-types";
import { hasDesktop, revealInFolder } from "../desktop/api";
import { preflightReport } from "../model/preflight";
import type { LibraryAnalysis } from "../model/similar";
import { browserWriter, chooseDesktopWriter, existingNamesIn, exportProjectFile, exportSpreads, spreadFileName, spreadPixelSize, type DesktopWriter } from "../render/export";
import { safeFileName, type ExportWriter } from "../render/export-core";
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
export function ExportDialog({ project, analysis, currentIndex, onClose, onStatus, onGoTo }: {
  project: AlbumProjectV2;
  /** Momenti e foto simili: aggiungono gli avvisi su foto quasi uguali, momenti sparsi e bianco e nero accanto al colore. */
  analysis?: LibraryAnalysis;
  currentIndex: number;
  onClose: () => void;
  onStatus: (message: string) => void;
  onGoTo: (spreadIndex: number) => void;
}) {
  const report = useMemo(() => preflightReport(project, analysis), [project, analysis]);
  const [scope, setScope] = useState<"all" | "current" | "range">("all");
  const [rangeText, setRangeText] = useState("");
  const [dpi, setDpi] = useState(Math.min(300, project.settings.sheet.dpi || 300));
  const [quality, setQuality] = useState(92);
  const [textsChecked, setTextsChecked] = useState(false);
  const [format, setFormat] = useState<"jpg" | "svg">("jpg");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** File con lo stesso nome già nella cartella scelta: si attende la conferma prima di sostituirli. */
  const [pending, setPending] = useState<{ writer: DesktopWriter; names: string[]; go: () => Promise<void> } | null>(null);
  const signal = useRef({ cancelled: false });
  const busy = progress !== null;
  const blocked = report.errors > 0;
  const textsPending = report.stats.textWarnings > 0 && !textsChecked;
  const range = useMemo(() => parseSpreadRange(rangeText, project.spreads.length), [rangeText, project.spreads.length]);
  const indexes = scope === "all" ? project.spreads.map((_, index) => index) : scope === "current" ? [currentIndex] : range.indexes;
  const size = spreadPixelSize(project, dpi);
  const desktop = hasDesktop();

  /** Sceglie la cartella e, se contiene già file con questi nomi, chiede conferma prima di sostituirli. */
  async function withWriter(fileNames: string[], action: (writer: ExportWriter) => Promise<void>) {
    setError(null);
    try {
      if (!desktop) { await action(browserWriter()); return; }
      const writer = await chooseDesktopWriter();
      if (!writer) return;
      const names = await existingNamesIn(writer.directory, fileNames);
      if (names.length === 0) { await action(writer); return; }
      setPending({ writer, names, go: async () => { writer.setReplace(true); await action(writer); } });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Esportazione non riuscita.");
      setProgress(null);
    }
  }

  async function run(kind: "jpg" | "svg") {
    await withWriter(indexes.map((index) => spreadFileName(project, index, kind)), async (writer) => {
      signal.current = { cancelled: false };
      try {
        setProgress({ done: 0, total: indexes.length });
        const result = await exportSpreads(project, writer, { kind, dpi, quality: quality / 100, spreads: indexes, signal: signal.current, onProgress: (done, total) => setProgress({ done, total }) });
        onStatus(signal.current.cancelled ? `Esportazione interrotta dopo ${result.count} spread.` : `${result.count} ${result.count === 1 ? "spread esportato" : "spread esportati"} in ${kind.toUpperCase()} (${writer.where()}).`);
        if (result.written[0] && desktop) void revealInFolder(result.written[0]);
        onClose();
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Esportazione non riuscita.");
        setProgress(null);
      }
    });
  }

  async function saveProject() {
    await withWriter([`${safeFileName(project.projectName)}.filex-album.json`], async (writer) => {
      try {
        const path = await exportProjectFile(project, writer);
        onStatus("Progetto salvato in un file FileX Album.");
        if (path) void revealInFolder(path);
        onClose();
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Impossibile salvare il progetto.");
      }
    });
  }

  async function confirmReplace() {
    const current = pending;
    setPending(null);
    if (current) await current.go();
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
        <button type="button" className="export-card" aria-pressed={format === "jpg"} style={format === "jpg" ? { outline: "2px solid var(--accent)" } : undefined} disabled={busy} onClick={() => setFormat("jpg")}>
          <Icon name="image" size={22} /><strong>JPG per spread</strong>
          <span>Un file per spread, abbondanza inclusa: il formato richiesto dalla maggior parte dei laboratori.</span>
        </button>
        <button type="button" className="export-card" aria-pressed={format === "svg"} style={format === "svg" ? { outline: "2px solid var(--accent)" } : undefined} disabled={busy} onClick={() => setFormat("svg")}>
          <Icon name="layouts" size={22} /><strong>SVG per spread</strong>
          <span>Vettoriale con le foto incorporate, per verifiche o ritocchi in un programma grafico.</span>
        </button>
        <button type="button" className="export-card" disabled={busy} onClick={() => void saveProject()}>
          <Icon name="book" size={22} /><strong>Progetto FileX</strong>
          <span>File .filex-album.json con capitoli, layout e ritagli, da riaprire o condividere.</span>
        </button>
      </div>

      {report.stats.textWarnings > 0 ? (
        <label className="notice notice--warn" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={textsChecked} onChange={(event) => setTextsChecked(event.target.checked)} />
          <span>Ho controllato i {report.stats.textWarnings} testi segnalati qui sopra: sono leggibili e voluti.</span>
        </label>
      ) : null}
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "12px 0" }}>
        <button type="button" className="btn btn--primary" disabled={blocked || textsPending || busy || indexes.length === 0} onClick={() => void run(format)}>
          Esporta {indexes.length} {indexes.length === 1 ? "spread" : "spread"} in {format.toUpperCase()}
        </button>
      </div>

      {pending ? (
        <div className="notice notice--warn" role="alertdialog" aria-label="File già presenti">
          <p><strong>{pending.names.length === 1 ? "Un file con lo stesso nome è già" : `${pending.names.length} file con lo stesso nome sono già`} in questa cartella e verr{pending.names.length === 1 ? "à sostituito" : "anno sostituiti"}.</strong></p>
          <p className="muted small">{pending.names.slice(0, 6).join(", ")}{pending.names.length > 6 ? `, …e altri ${pending.names.length - 6}` : ""}</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={() => setPending(null)}>Annulla</button>
            <button type="button" className="btn btn--primary" onClick={() => void confirmReplace()}>Sostituisci {pending.names.length === 1 ? "il file" : `i ${pending.names.length} file`}</button>
          </div>
        </div>
      ) : null}

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
