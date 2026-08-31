import type { DesktopPsdJpegConversionProgress } from "@photo-tools/desktop-contracts";

interface PsdJpegConversionModalProps {
  totalPsd: number;
  progress: DesktopPsdJpegConversionProgress | null;
  isStarting: boolean;
  onStart: () => void;
  onCancel: () => void;
  onClose: () => void;
}

function describeProgress(progress: DesktopPsdJpegConversionProgress | null): string {
  if (!progress) return "Pronto per la conversione.";
  if (progress.status === "running") return "Conversione in corso…";
  if (progress.status === "completed") return "Conversione completata.";
  if (progress.status === "cancelled") return "Conversione annullata.";
  if (progress.status === "error") return progress.error ?? "Conversione non avviata.";
  return "Pronto per la conversione.";
}

export function PsdJpegConversionModal(props: PsdJpegConversionModalProps) {
  const progress = props.progress;
  const isRunning = progress?.status === "running";
  const isFinished = Boolean(progress && progress.status !== "running" && progress.status !== "idle");
  const completed = progress?.completed ?? 0;
  const percent = progress?.total ? Math.round((completed / progress.total) * 100) : 0;

  return (
    <div className="psd-conversion-modal" role="presentation">
      <div className="psd-conversion-modal__backdrop" onClick={isRunning ? undefined : props.onClose} />
      <section className="modal-panel psd-conversion-modal__content" role="dialog" aria-modal="true" aria-labelledby="psd-conversion-title">
        <header className="modal-panel__header">
          <div>
            <p className="modal-panel__eyebrow">Esporta composito visibile</p>
            <h2 id="psd-conversion-title">Converti PSD in JPEG</h2>
          </div>
          <button type="button" className="icon-button" onClick={props.onClose} disabled={isRunning} title="Chiudi">×</button>
        </header>
        <div className="modal-panel__body psd-conversion-modal__body">
          <p>
            {props.totalPsd === 1 ? "1 PSD selezionato" : `${props.totalPsd} PSD selezionati`}. I file originali non verranno modificati.
          </p>
          <p className="psd-conversion-modal__destination">
            I JPEG verranno creati nella cartella <strong>JPEG da PSD</strong> accanto a ciascun PSD. Se esiste già un nome, FileX ne crea uno nuovo.
          </p>
          <p className="psd-conversion-modal__print-quality">
            Per la stampa, la conversione usa sempre JPEG <strong>qualità 100</strong> senza sottocampionamento colore (4:4:4).
          </p>

          {progress ? (
            <div className={`psd-conversion-modal__progress psd-conversion-modal__progress--${progress.status}`} aria-live="polite">
              <div className="psd-conversion-modal__progress-line">
                <strong>{describeProgress(progress)}</strong>
                <span>{completed}/{progress.total}</span>
              </div>
              <div className="psd-conversion-modal__progress-track" aria-hidden="true">
                <span style={{ width: `${percent}%` }} />
              </div>
              {progress.currentFile ? <span className="psd-conversion-modal__current">{progress.currentFile}</span> : null}
              {isFinished ? (
                <span className="psd-conversion-modal__result">
                  {progress.generated} creati · {progress.skipped} saltati · {progress.errors} errori
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <footer className="modal-panel__footer">
          {isRunning ? (
            <button type="button" className="ghost-button" onClick={props.onCancel}>Annulla dopo il file corrente</button>
          ) : isFinished ? (
            <button type="button" className="secondary-button" onClick={props.onClose}>Chiudi</button>
          ) : (
            <>
              <button type="button" className="ghost-button" onClick={props.onClose}>Annulla</button>
              <button type="button" className="secondary-button" onClick={props.onStart} disabled={props.isStarting}>
                {props.isStarting ? "Avvio…" : `Converti ${props.totalPsd === 1 ? "PSD" : `${props.totalPsd} PSD`}`}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
