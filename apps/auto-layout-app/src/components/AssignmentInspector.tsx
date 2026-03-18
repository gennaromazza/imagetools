import { useEffect, useState } from "react";
import type { FitMode, ImageAsset, LayoutAssignment, LayoutSlot } from "@photo-tools/shared-types";

interface AssignmentInspectorProps {
  pageLabel: string | null;
  slot?: LayoutSlot;
  assignment?: LayoutAssignment;
  asset?: ImageAsset;
  onChange: (
    changes: Partial<
      Pick<
        LayoutAssignment,
        "fitMode" | "zoom" | "offsetX" | "offsetY" | "rotation" | "locked" | "cropLeft" | "cropTop" | "cropWidth" | "cropHeight"
      >
    >
  ) => void;
  onClear: () => void;
  onOpenCropEditor: () => void;
}

export function AssignmentInspector({
  pageLabel,
  slot,
  assignment,
  asset,
  onChange,
  onClear,
  onOpenCropEditor
}: AssignmentInspectorProps) {
  const [draftZoom, setDraftZoom] = useState(assignment?.zoom ?? 1);
  const [draftOffsetX, setDraftOffsetX] = useState(assignment?.offsetX ?? 0);
  const [draftOffsetY, setDraftOffsetY] = useState(assignment?.offsetY ?? 0);
  const [draftRotation, setDraftRotation] = useState(assignment?.rotation ?? 0);

  useEffect(() => {
    setDraftZoom(assignment?.zoom ?? 1);
    setDraftOffsetX(assignment?.offsetX ?? 0);
    setDraftOffsetY(assignment?.offsetY ?? 0);
    setDraftRotation(assignment?.rotation ?? 0);
  }, [assignment?.zoom, assignment?.offsetX, assignment?.offsetY, assignment?.rotation]);

  useEffect(() => {
    if (!assignment || draftZoom === assignment.zoom) {
      return;
    }

    const timeoutId = window.setTimeout(() => onChange({ zoom: draftZoom }), 80);
    return () => window.clearTimeout(timeoutId);
  }, [assignment, draftZoom, onChange]);

  useEffect(() => {
    if (!assignment || draftOffsetX === assignment.offsetX) {
      return;
    }

    const timeoutId = window.setTimeout(() => onChange({ offsetX: draftOffsetX }), 80);
    return () => window.clearTimeout(timeoutId);
  }, [assignment, draftOffsetX, onChange]);

  useEffect(() => {
    if (!assignment || draftOffsetY === assignment.offsetY) {
      return;
    }

    const timeoutId = window.setTimeout(() => onChange({ offsetY: draftOffsetY }), 80);
    return () => window.clearTimeout(timeoutId);
  }, [assignment, draftOffsetY, onChange]);

  useEffect(() => {
    if (!assignment || draftRotation === assignment.rotation) {
      return;
    }

    const timeoutId = window.setTimeout(() => onChange({ rotation: draftRotation }), 80);
    return () => window.clearTimeout(timeoutId);
  }, [assignment, draftRotation, onChange]);

  if (!slot) {
    return <p className="helper-copy">Seleziona uno slot per regolare foto, crop e comportamento del singolo riquadro.</p>;
  }

  if (!assignment || !asset) {
    return (
      <div className="stack">
        <p className="helper-copy">
          {pageLabel ? `${pageLabel}, slot ${slot.id}` : `Slot ${slot.id}`} e' vuoto. Trascina una foto
          nella spread per riempirlo.
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="inspector-card">
        {asset.previewUrl ? <img src={asset.previewUrl} alt={asset.fileName} className="inspector-card__image" /> : null}
        <div>
          <strong>{asset.fileName}</strong>
          <p>{pageLabel ? `${pageLabel} | slot ${slot.id}` : `Slot ${slot.id}`}</p>
        </div>
      </div>

      <div className="field">
        <span>Adattamento slot</span>
        <div className="segmented-control">
          {(["fit", "fill", "crop"] as FitMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={assignment.fitMode === mode ? "segment segment--active" : "segment"}
              onClick={() => onChange({ fitMode: mode })}
            >
              {mode === "fit" ? "Adatta" : mode === "fill" ? "Riempi" : "Crop"}
            </button>
          ))}
        </div>
        <small className="helper-inline">
          Puoi trascinare direttamente la foto per centrarla o riposizionarla anche dopo zoom, fill o crop. Sul canvas puoi usare Alt piu rotellina per lo zoom, doppio click e la toolbar rapida nello slot. Per spostarla in un altro foglio usa il bottone Sposta sullo slot.
        </small>
        <button type="button" className="ghost-button" onClick={onOpenCropEditor}>
          Apri editor crop
        </button>
      </div>

      <label className="field">
        <span>Zoom</span>
        <input
          type="range"
          min="0.7"
          max="2.2"
          step="0.05"
          value={draftZoom}
          onChange={(event) => setDraftZoom(Number(event.target.value))}
        />
      </label>

      <div className="inline-grid inline-grid--2">
        <label className="field">
          <span>Spostamento X</span>
          <input
            type="range"
            min="-100"
            max="100"
            step="1"
            value={draftOffsetX}
            onChange={(event) => setDraftOffsetX(Number(event.target.value))}
          />
        </label>

        <label className="field">
          <span>Spostamento Y</span>
          <input
            type="range"
            min="-100"
            max="100"
            step="1"
            value={draftOffsetY}
            onChange={(event) => setDraftOffsetY(Number(event.target.value))}
          />
        </label>
      </div>

      <label className="field">
        <span>Rotazione</span>
        <input
          type="range"
          min="-25"
          max="25"
          step="1"
          value={draftRotation}
          onChange={(event) => setDraftRotation(Number(event.target.value))}
        />
      </label>

      <label className="check-row">
        <input
          type="checkbox"
          checked={assignment.locked}
          onChange={(event) => onChange({ locked: event.target.checked })}
        />
        <span>Blocca questo slot</span>
      </label>

      <button type="button" className="ghost-button" onClick={onClear}>
        Rimuovi foto dallo slot
      </button>
    </div>
  );
}

