import type { ImportResult, SafeToFormatResult } from "../../types";
import { formatBytes, formatElapsed, shortPath } from "../../wizardModel";

export interface FormatCheckState { checking: boolean; result: SafeToFormatResult | null; error: string | null }

/** Testo semplice per l'esito del controllo "tutto salvato?": e' un aiuto, mai un obbligo. */
export function describeFormatCheck(result: SafeToFormatResult): string {
  if (result.status === "SAFE") return `Tutte le ${result.totalFiles.toLocaleString("it-IT")} foto della scheda risultano salvate in archivio.`;
  return `${result.verifiedFiles.toLocaleString("it-IT")} file su ${result.totalFiles.toLocaleString("it-IT")} risultano salvati: ${result.reason ?? "gli altri non sono ancora in archivio"}.`;
}

export interface DoneExtras {
  /** Durata e peso dell'importazione appena conclusa. */
  stats?: { elapsedMs: number; bytes: number };
  /** Espulsione della scheda dal computer (facoltativa). */
  eject?: { ejecting: boolean; message: string | null; onEject: () => void };
  /** Presente solo se Adobe Bridge e' installato. */
  bridge?: { message: string | null; onOpen: () => void };
}

export function DoneStep({ result, onOpenFolders, onAnother, onArchive, sdAvailable, format, onCheckFormat, stats, eject, bridge }: {
  result: ImportResult;
  onOpenFolders: () => void; onAnother: () => void; onArchive: () => void;
  sdAvailable: boolean; format: FormatCheckState; onCheckFormat: () => void;
} & DoneExtras) {
  const incomplete = Boolean(result.incomplete);
  const copied = result.copiedFiles;
  const photoFolder = result.cartellaFotoFinale || result.job.percorsoCartella;
  return <div className="panel-section wizard-slide wizard-done" style={{ padding: "var(--space-4)" }} role="status">
    <div className="stack">
      <div className={`wizard-done__badge${incomplete ? " is-warning" : ""}`} aria-hidden="true">{incomplete ? "!" : "✓"}</div>
      <div>
        <h3 className="wizard-title">{incomplete ? "Importazione incompleta" : "Fatto!"}</h3>
        <p className="import-step__description">
          {copied === 1 ? "Ho copiato 1 file" : `Ho copiato ${copied.toLocaleString("it-IT")} file`} nel lavoro «{result.job.nomeLavoro}»
          {result.jpgGenerati > 0 ? `, più ${result.jpgGenerati.toLocaleString("it-IT")} copie leggere` : ""}
          {stats && stats.elapsedMs > 0 ? ` in ${formatElapsed(stats.elapsedMs)}${stats.bytes > 0 ? ` (${formatBytes(stats.bytes)})` : ""}` : ""}.
          {result.skippedFiles > 0 ? ` ${result.skippedFiles === 1 ? "Un altro file c'era già" : `Altri ${result.skippedFiles.toLocaleString("it-IT")} file c'erano già`} e non ${result.skippedFiles === 1 ? "l'ho" : "li ho"} ricopiat${result.skippedFiles === 1 ? "o" : "i"}.` : ""}
          {incomplete ? " Alcuni file non sono stati copiati: controlla l'elenco qui sotto." : ""}
        </p>
      </div>
      {result.errors.length > 0 && <ul className="wizard-issues" style={{ margin: 0, paddingLeft: "1.1rem", color: "var(--danger)", fontSize: "0.85rem" }}>
        {result.errors.slice(0, 20).map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}
      </ul>}
      <div className="wizard-where">
        <span>Le foto sono in</span>
        <strong title={photoFolder}>{shortPath(photoFolder)}</strong>
        {result.videoFiles > 0 && <small title={result.cartellaVideoFinale}>Video in {shortPath(result.cartellaVideoFinale)}</small>}
      </div>
      <div className="wizard-done__actions">
        <button type="button" className="primary-button" onClick={onOpenFolders}>📂 Apri la cartella</button>
        {bridge && <button type="button" className="secondary-button" onClick={bridge.onOpen}>Apri in Adobe Bridge</button>}
        <button type="button" className="secondary-button" onClick={onAnother}>Importa un’altra scheda</button>
        <button type="button" className="ghost-button" onClick={onArchive}>Vai all’archivio</button>
      </div>
      {bridge?.message && <p role="status" className="wizard-note" style={{ margin: 0 }}>{bridge.message}</p>}
      {sdAvailable && eject && <div className="wizard-done__eject">
        <button type="button" className="ghost-button" onClick={eject.onEject} disabled={eject.ejecting}>{eject.ejecting ? "Espello…" : "⏏ Espelli la scheda"}</button>
        {eject.message && <span role="status" className="wizard-note">{eject.message}</span>}
      </div>}
      {sdAvailable && <details className="import-advanced-panel">
        <summary>Vuoi formattare la scheda dal computer?</summary>
        <div className="stack" style={{ gap: "0.5rem", margin: "0.4rem 0 0.75rem" }}>
          <p className="import-step__description" style={{ margin: 0 }}>Non è obbligatorio: se formatti dalla fotocamera puoi ignorare questo riquadro. Qui puoi solo controllare che ogni foto della scheda sia già salvata in archivio.</p>
          <div className="button-row">
            <button type="button" className="secondary-button" onClick={onCheckFormat} disabled={format.checking}>{format.checking ? "Controllo…" : "Controlla che sia tutto salvato"}</button>
          </div>
          {format.result && <p role="status" style={{ margin: 0 }}>{describeFormatCheck(format.result)}</p>}
          {format.error && <p role="alert" style={{ margin: 0, color: "var(--danger)" }}>{format.error}</p>}
        </div>
      </details>}
    </div>
  </div>;
}
