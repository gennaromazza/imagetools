import { useEffect, useState } from "react";
import type { DesktopCloudProjectVersion } from "@photo-tools/desktop-contracts";

interface DriveVersionPickerModalProps {
  versions: DesktopCloudProjectVersion[];
  onSelect: (version: DesktopCloudProjectVersion) => void;
  onCancel: () => void;
}

export function DriveVersionPickerModal({
  versions,
  onSelect,
  onCancel,
}: DriveVersionPickerModalProps) {
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
        aria-labelledby="drive-version-picker-title"
      >
        <div className="modal-panel__header">
          <div>
            <h2 id="drive-version-picker-title">Continua da Google Drive</h2>
            <p>Scegli la versione della selezione da importare.</p>
          </div>
        </div>

        <div className="modal-panel__body modal-panel__body--scroll drive-version-picker__list">
          {versions.map((version, index) => (
            <button
              type="button"
              className="drive-version-picker__option"
              key={version.id}
              onClick={() => onSelect(version)}
            >
              <span className="drive-version-picker__number">{index + 1}</span>
              <span className="drive-version-picker__details">
                <strong>{new Date(version.createdAt).toLocaleString("it-IT")}</strong>
                <span>{version.name}</span>
              </span>
              <span className="drive-version-picker__arrow" aria-hidden="true">›</span>
            </button>
          ))}
        </div>

        <div className="modal-panel__footer">
          <button type="button" className="ghost-button" onClick={onCancel}>
            Annulla
          </button>
        </div>
      </div>
    </div>
  );
}

interface DriveManualRootPickerModalProps {
  initialPath: string;
  unmatchedCount: number;
  onConfirm: (path: string) => void;
  onCancel: () => void;
}

export function DriveManualRootPickerModal({
  initialPath,
  unmatchedCount,
  onConfirm,
  onCancel,
}: DriveManualRootPickerModalProps) {
  const [path, setPath] = useState(initialPath);

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
          if (path.trim()) {
            onConfirm(path.trim());
          }
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drive-manual-root-title"
      >
        <div className="modal-panel__header">
          <div>
            <h2 id="drive-manual-root-title">Completa mappatura foto</h2>
            <p>Non ho trovato {unmatchedCount} foto. Indica la cartella radice del backup locale.</p>
          </div>
        </div>

        <div className="modal-panel__body">
          <label className="drive-manual-root-picker__label" htmlFor="drive-manual-root-path">
            Percorso cartella
          </label>
          <input
            id="drive-manual-root-path"
            className="drive-manual-root-picker__input"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="Es. E:\\Matrimonio\\FOTO"
            autoFocus
          />
        </div>

        <div className="modal-panel__footer">
          <button type="button" className="ghost-button" onClick={onCancel}>
            Annulla
          </button>
          <button type="submit" className="primary-button" disabled={!path.trim()}>
            Apri cartella e riprova
          </button>
        </div>
      </form>
    </div>
  );
}
