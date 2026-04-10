import { useEffect } from "react";
import type { FolderOpenDiagnostics } from "../services/folder-access";

interface ImportProgressModalProps {
  isOpen: boolean;
  phase: "reading" | "preparing";
  supported: number;
  ignored: number;
  total: number;
  processed: number;
  currentFile: string | null;
  folderLabel: string;
  diagnostics: FolderOpenDiagnostics | null;
  onDismiss: () => void;
  onCancel: () => void;
}

function formatDiagnosticsSource(source: FolderOpenDiagnostics["source"]): string {
  return source === "desktop-native" ? "Desktop Windows" : source;
}

export function ImportProgressModal({
  isOpen,
  phase,
  supported,
  ignored,
  total,
  processed,
  currentFile,
  folderLabel,
  diagnostics,
  onDismiss,
  onCancel,
}: ImportProgressModalProps) {
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      onDismiss();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onDismiss]);

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
    <aside className="import-progress-panel" aria-live="polite">
      <div
        className="modal-panel modal-panel--import import-progress-panel__content"
        role="dialog"
        aria-modal="false"
        aria-labelledby="import-progress-title"
      >
        <div className="modal-panel__header">
          <div>
            <h2 id="import-progress-title">Caricamento foto in corso</h2>
            <p>{folderLabel || "Preparazione cartella selezionata"}</p>
          </div>
          <button
            type="button"
            className="import-progress-panel__close"
            onClick={onDismiss}
            aria-label="Nascondi pannello caricamento"
            title="Nascondi"
          >
            x
          </button>
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

          {diagnostics ? (
            <div className="import-progress__diagnostics">
              <div className="import-progress__diagnostics-header">
                <strong>Diagnostica import</strong>
                <span>{formatDiagnosticsSource(diagnostics.source)}</span>
              </div>
              <div className="import-progress__diagnostics-grid">
                <span>Path selezionato</span>
                <strong title={diagnostics.selectedPath}>{diagnostics.selectedPath}</strong>
                <span>Top-level caricati</span>
                <strong>{diagnostics.topLevelSupportedCount}</strong>
                <span>Annidati scartati</span>
                <strong>{diagnostics.nestedSupportedDiscardedCount}</strong>
                <span>Totale supportate viste</span>
                <strong>{diagnostics.totalSupportedSeen}</strong>
              </div>
            </div>
          ) : null}

          <p className="import-progress__hint">{phaseDescription}</p>
        </div>

        <div className="modal-panel__footer">
          <button type="button" className="ghost-button" onClick={onDismiss}>
            Nascondi
          </button>
          <button type="button" className="secondary-button" onClick={onCancel}>
            Annulla caricamento
          </button>
        </div>
      </div>
    </aside>
  );
}
