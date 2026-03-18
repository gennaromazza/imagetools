interface ExportProgressModalProps {
  isOpen: boolean;
  status: "running" | "completed" | "error";
  total: number;
  completed: number;
  currentFile: string | null;
  currentPageNumber: number | null;
  destinationLabel: string;
  exportedFiles: string[];
  errorMessage: string | null;
  canOpenFolder: boolean;
  onClose: () => void;
  onOpenFolder: () => void;
}

function getStatusCopy(status: "running" | "completed" | "error"): string {
  if (status === "completed") {
    return "Esportazione completata";
  }

  if (status === "error") {
    return "Esportazione interrotta";
  }

  return "Esportazione in corso";
}

export function ExportProgressModal({
  isOpen,
  status,
  total,
  completed,
  currentFile,
  currentPageNumber,
  destinationLabel,
  exportedFiles,
  errorMessage,
  canOpenFolder,
  onClose,
  onOpenFolder
}: ExportProgressModalProps) {
  if (!isOpen) {
    return null;
  }

  const safeTotal = Math.max(total, 1);
  const progressPercent = Math.round((completed / safeTotal) * 100);

  return (
    <div className="modal-backdrop" onClick={status === "running" ? undefined : onClose}>
      <div
        className="modal-panel modal-panel--export"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-progress-title"
      >
        <div className="modal-panel__header">
          <div>
            <h2 id="export-progress-title">{getStatusCopy(status)}</h2>
            <p>{destinationLabel}</p>
          </div>
        </div>

        <div className="export-progress">
          <div className="export-progress__summary">
            <strong>
              {completed} di {total} fogli
            </strong>
            <span>{progressPercent}%</span>
          </div>

          <div className="progress-bar" aria-hidden="true">
            <div className="progress-bar__fill" style={{ width: `${progressPercent}%` }} />
          </div>

          <div className="export-progress__status">
            <span>
              {currentPageNumber ? `Foglio ${currentPageNumber}` : "Preparazione export"}
            </span>
            <strong>{currentFile ?? "In attesa..."}</strong>
          </div>

          {status === "error" && errorMessage ? (
            <div className="message-box">{errorMessage}</div>
          ) : null}

          {exportedFiles.length > 0 ? (
            <div className="export-progress__files">
              <strong>File generati</strong>
              <div className="export-progress__list">
                {exportedFiles.map((fileName) => (
                  <span key={fileName} className="export-progress__file">
                    {fileName}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="modal-panel__footer">
          {status === "running" ? (
            <button type="button" className="ghost-button" disabled>
              Esportazione...
            </button>
          ) : (
            <>
              <button type="button" className="ghost-button" onClick={onClose}>
                Chiudi
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={onOpenFolder}
                disabled={!canOpenFolder}
                title={
                  canOpenFolder
                    ? "Apri la cartella di esportazione"
                    : "Apri cartella disponibile quando l'app viene pacchettizzata come exe desktop."
                }
              >
                Apri cartella
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
