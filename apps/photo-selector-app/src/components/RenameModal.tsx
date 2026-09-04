import { useEffect, useMemo, useState } from "react";
import {
  buildBatchRenamePreview,
  type RenamePatternOptions,
  type RenameSourceFile,
} from "../services/rename-pattern";

export interface RenameApplyItem {
  id: string;
  to: string;
}

interface RenameModalProps {
  files: RenameSourceFile[];
  initialOptions?: Partial<RenamePatternOptions>;
  onClose: () => void;
  onApply: (items: RenameApplyItem[]) => void;
}

const PREVIEW_LIMIT = 40;

export function RenameModal({ files, initialOptions, onClose, onApply }: RenameModalProps) {
  const [mode, setMode] = useState<RenamePatternOptions["mode"]>(initialOptions?.mode ?? "datetime");
  const [customText, setCustomText] = useState(initialOptions?.customText ?? "");
  const [keepOriginalName, setKeepOriginalName] = useState(initialOptions?.keepOriginalName !== false);
  const [startNumber, setStartNumber] = useState(initialOptions?.startNumber ?? 1);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const preview = useMemo(
    () => buildBatchRenamePreview(files, {
      mode,
      customText,
      keepOriginalName,
      startNumber,
      padWidth: 4,
    }),
    [files, mode, customText, keepOriginalName, startNumber],
  );
  const adjustedCount = preview.filter((item) => item.adjusted).length;
  const visiblePreview = preview.slice(0, PREVIEW_LIMIT);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel modal-panel--drive-picker"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-title"
      >
        <div className="modal-panel__header">
          <div>
            <h2 id="rename-title">Rinomina {files.length === 1 ? "1 foto" : `${files.length} foto`}</h2>
            <p>I sidecar XMP seguono i file. L'anteprima mostra il risultato prima di applicare.</p>
          </div>
        </div>
        <div className="modal-panel__body" style={{ display: "grid", gap: "0.7rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              type="button"
              className={mode === "datetime" ? "primary-button" : "secondary-button"}
              style={{ padding: "0.45rem 0.85rem", fontSize: "0.84rem" }}
              onClick={() => setMode("datetime")}
            >
              Data e ora di scatto
            </button>
            <button
              type="button"
              className={mode === "custom" ? "primary-button" : "secondary-button"}
              style={{ padding: "0.45rem 0.85rem", fontSize: "0.84rem" }}
              onClick={() => setMode("custom")}
            >
              Nome personalizzato
            </button>
          </div>
          {mode === "custom" ? (
            <label style={{ display: "grid", gap: "0.3rem", fontSize: "0.85rem" }}>
              Prefisso nome
              <input
                type="text"
                value={customText}
                onChange={(event) => setCustomText(event.target.value)}
                placeholder="es. Matrimonio_Rossi"
                style={{ padding: "0.45rem 0.6rem", borderRadius: 10 }}
              />
            </label>
          ) : null}
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
            <input
              type="checkbox"
              checked={keepOriginalName}
              onChange={(event) => setKeepOriginalName(event.target.checked)}
            />
            Mantieni nome originale (es. 20260904_132418_DSCF4821.jpg)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
            Numero iniziale
            <input
              type="number"
              min={0}
              max={9999}
              value={startNumber}
              onChange={(event) => setStartNumber(Number(event.target.value) || 0)}
              style={{ width: 90, padding: "0.4rem 0.55rem", borderRadius: 10 }}
            />
          </label>
          <div>
            <div style={{ fontSize: "0.82rem", opacity: 0.8, marginBottom: "0.35rem" }}>
              Anteprima{adjustedCount > 0 ? ` (${adjustedCount} con suffisso anti-collisione)` : ""}:
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.25rem", maxHeight: 220, overflowY: "auto", fontSize: "0.8rem" }}>
              {visiblePreview.map((item) => (
                <li key={item.id} style={{ display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
                  <span style={{ opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{item.from}</span>
                  <span aria-hidden="true">→</span>
                  <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{item.to}</strong>
                </li>
              ))}
            </ul>
            {preview.length > visiblePreview.length ? (
              <div style={{ fontSize: "0.78rem", opacity: 0.7, marginTop: "0.3rem" }}>
                …e altri {preview.length - visiblePreview.length} file con la stessa regola.
              </div>
            ) : null}
          </div>
        </div>
        <div className="modal-panel__footer">
          <button type="button" className="ghost-button" onClick={onClose}>Annulla</button>
          <button
            type="button"
            className="primary-button"
            disabled={preview.length === 0}
            onClick={() => onApply(preview.map((item) => ({ id: item.id, to: item.to })))}
          >
            Rinomina {preview.length === 1 ? "1 foto" : `${preview.length} foto`}
          </button>
        </div>
      </div>
    </div>
  );
}
