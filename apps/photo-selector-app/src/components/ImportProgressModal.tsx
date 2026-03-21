interface ImportProgressModalProps {
  isOpen: boolean;
  phase: "reading" | "preparing";
  supported: number;
  ignored: number;
  total: number;
  processed: number;
  currentFile: string | null;
  folderLabel: string;
}

export function ImportProgressModal({
  isOpen,
  phase,
  supported,
  ignored,
  total,
  processed,
  currentFile,
  folderLabel
}: ImportProgressModalProps) {
  if (!isOpen) {
    return null;
  }

  const safeTotal = Math.max(total, 1);
  const progressPercent = phase === "reading" ? 8 : Math.round((processed / safeTotal) * 100);
  const phaseTitle = phase === "reading" ? "Lettura cartella" : "Preparazione anteprime";
  const phaseDescription =
    phase === "reading"
      ? "Sto controllando la cartella selezionata e contando le immagini supportate."
      : "Sto preparando anteprime e metadati delle foto per la schermata selezione.";

  return (
    <div className="modal-backdrop">
      <div
        className="modal-panel modal-panel--import"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-progress-title"
      >
        <div className="modal-panel__header">
          <div>
            <h2 id="import-progress-title">Caricamento foto in corso</h2>
            <p>{folderLabel || "Preparazione cartella selezionata"}</p>
          </div>
        </div>

        <div className="modal-panel__body import-progress">
          <div className="import-progress__phase">
            <span className={phase === "reading" ? "import-progress__phase-pill import-progress__phase-pill--active" : "import-progress__phase-pill"}>
              1. Lettura cartella
            </span>
            <span className={phase === "preparing" ? "import-progress__phase-pill import-progress__phase-pill--active" : "import-progress__phase-pill"}>
              2. Preparazione anteprime
            </span>
          </div>

          <div className="import-progress__summary">
            <strong>
              {phase === "reading" ? "Analisi cartella in corso" : `${processed} di ${total} immagini pronte`}
            </strong>
            <span>{progressPercent}%</span>
          </div>

          <div className="import-progress__counts">
            <span>{supported} immagini supportate</span>
            <span>{ignored} ignorate</span>
          </div>

          <div className="progress-bar" aria-hidden="true">
            <div className="progress-bar__fill" style={{ width: `${progressPercent}%` }} />
          </div>

          <div className="import-progress__status">
            <span>{phaseTitle}</span>
            <strong>{currentFile ?? phaseDescription}</strong>
          </div>

          <p className="import-progress__hint">{phaseDescription}</p>
        </div>

        <div className="modal-panel__footer">
          <button type="button" className="ghost-button" disabled>
            Importazione in corso...
          </button>
        </div>
      </div>
    </div>
  );
}
