import { useEffect, useState } from "react";

export type UnassignedFolderChoice = "create-here" | "choose-master" | "cancel";

export interface ProjectCreationPreview {
  folderPath: string;
  folderName: string;
  totalPhotos: number;
  topLevelPhotos: number;
  nestedPhotos: number;
  nestedFolders: number;
  legacyProjectCount: number;
  recoverableSelections: number;
}

export interface MasterCorrectionPreview {
  currentFolderPath: string;
  targetFolderPath: string;
  totalPhotos: number;
  recoveredSelections: number;
  excludedSelections: number;
}

interface UnassignedFolderModalProps {
  folderPath: string;
  onChoose: (choice: UnassignedFolderChoice) => void;
}

export function UnassignedFolderModal({ folderPath, onChoose }: UnassignedFolderModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onChoose("cancel");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onChoose]);

  return (
    <div className="modal-backdrop" onClick={() => onChoose("cancel")}>
      <div
        className="modal-panel modal-panel--drive-picker"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unassigned-folder-title"
      >
        <div className="modal-panel__header">
          <div>
            <h2 id="unassigned-folder-title">Cartella senza progetto</h2>
            <p>Questa cartella non appartiene ancora a un progetto master PhotoSelector.</p>
          </div>
        </div>
        <div className="modal-panel__body">
          <div className="drive-manual-root-picker__label">Cartella richiesta</div>
          <div className="drive-manual-root-picker__input" title={folderPath}>{folderPath}</div>
          <p>
            Se fa parte di un matrimonio con altre sottocartelle, scegli la cartella master che le contiene tutte.
          </p>
        </div>
        <div className="modal-panel__footer">
          <button type="button" className="ghost-button" onClick={() => onChoose("cancel")}>Annulla</button>
          <button type="button" className="secondary-button" onClick={() => onChoose("create-here")}>
            Crea da questa cartella
          </button>
          <button type="button" className="primary-button" onClick={() => onChoose("choose-master")}>
            Scegli cartella master
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConfirmProjectCreationModalProps {
  preview: ProjectCreationPreview;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmProjectCreationModal({
  preview,
  onConfirm,
  onCancel,
}: ConfirmProjectCreationModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal-panel modal-panel--drive-picker"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-project-title"
      >
        <div className="modal-panel__header">
          <div>
            <h2 id="confirm-project-title">Conferma cartella master</h2>
            <p>Il progetto comprenderà questa cartella e tutte le sue sottocartelle.</p>
          </div>
        </div>
        <div className="modal-panel__body project-creation-preview">
          <div className="project-creation-preview__path">
            <span>Cartella master scelta</span>
            <strong title={preview.folderPath}>{preview.folderPath}</strong>
          </div>
          <dl className="project-creation-preview__stats">
            <div><dt>Nome iniziale</dt><dd>{preview.folderName}</dd></div>
            <div><dt>Foto complessive</dt><dd>{preview.totalPhotos}</dd></div>
            <div><dt>Foto nella cartella principale</dt><dd>{preview.topLevelPhotos}</dd></div>
            <div><dt>Foto nelle sottocartelle</dt><dd>{preview.nestedPhotos}</dd></div>
            <div><dt>Sottocartelle dirette</dt><dd>{preview.nestedFolders}</dd></div>
            <div><dt>Selezioni precedenti recuperabili</dt><dd>{preview.recoverableSelections}</dd></div>
          </dl>
          {preview.legacyProjectCount > 0 ? (
            <p className="project-creation-preview__notice">
              Ho trovato {preview.legacyProjectCount} archiv{preview.legacyProjectCount === 1 ? "io" : "i"} di
              selezioni precedenti. Verranno uniti senza cancellare i file originali.
            </p>
          ) : null}
          <p className="project-creation-preview__warning">
            Controlla bene il percorso: non scegliere una cartella che contiene più matrimoni o più lavori distinti.
          </p>
        </div>
        <div className="modal-panel__footer">
          <button type="button" className="ghost-button" onClick={onCancel}>Torna indietro</button>
          <button type="button" className="primary-button" onClick={onConfirm}>Crea questo progetto</button>
        </div>
      </div>
    </div>
  );
}

interface RenameProjectModalProps {
  currentName: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function RenameProjectModal({ currentName, onConfirm, onCancel }: RenameProjectModalProps) {
  const [name, setName] = useState(currentName);
  const normalizedName = name.trim();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal-panel modal-panel--drive-picker"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (normalizedName && normalizedName !== currentName.trim()) {
            onConfirm(normalizedName);
          }
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-project-title"
      >
        <div className="modal-panel__header">
          <div>
            <h2 id="rename-project-title">Rinomina progetto</h2>
            <p>La rinomina è intenzionale e non cambia la cartella fisica né l’identità usata da Drive.</p>
          </div>
        </div>
        <div className="modal-panel__body">
          <label className="drive-manual-root-picker__label" htmlFor="rename-project-name">
            Nuovo nome progetto
          </label>
          <input
            id="rename-project-name"
            className="drive-manual-root-picker__input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            maxLength={160}
          />
        </div>
        <div className="modal-panel__footer">
          <button type="button" className="ghost-button" onClick={onCancel}>Annulla</button>
          <button
            type="submit"
            className="primary-button"
            disabled={!normalizedName || normalizedName === currentName.trim()}
          >
            Conferma rinomina
          </button>
        </div>
      </form>
    </div>
  );
}

interface ConfirmMasterCorrectionModalProps {
  preview: MasterCorrectionPreview;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmMasterCorrectionModal({
  preview,
  onConfirm,
  onCancel,
}: ConfirmMasterCorrectionModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal-panel modal-panel--drive-picker"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="correct-master-title"
      >
        <div className="modal-panel__header">
          <div>
            <h2 id="correct-master-title">Correggi cartella master</h2>
            <p>Il progetto verrà ristretto alla cartella corretta. Il master precedente resterà disponibile come backup.</p>
          </div>
        </div>
        <div className="modal-panel__body project-creation-preview">
          <div className="project-creation-preview__path">
            <span>Master attuale</span>
            <strong title={preview.currentFolderPath}>{preview.currentFolderPath}</strong>
          </div>
          <div className="project-creation-preview__path">
            <span>Nuovo master</span>
            <strong title={preview.targetFolderPath}>{preview.targetFolderPath}</strong>
          </div>
          <dl className="project-creation-preview__stats">
            <div><dt>Foto nel nuovo master</dt><dd>{preview.totalPhotos}</dd></div>
            <div><dt>Selezioni recuperate</dt><dd>{preview.recoveredSelections}</dd></div>
          </dl>
          {preview.excludedSelections > 0 ? (
            <p className="project-creation-preview__warning">
              {preview.excludedSelections} selezioni sono esterne alla nuova cartella. Non saranno attive nel nuovo master,
              ma resteranno nel backup del progetto precedente.
            </p>
          ) : (
            <p className="project-creation-preview__notice">
              Tutte le selezioni attuali appartengono alla nuova cartella master.
            </p>
          )}
        </div>
        <div className="modal-panel__footer">
          <button type="button" className="ghost-button" onClick={onCancel}>Annulla</button>
          <button type="button" className="primary-button" onClick={onConfirm}>Conferma correzione</button>
        </div>
      </div>
    </div>
  );
}
