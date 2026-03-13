import type { FitMode, ImageAsset, LayoutAssignment, LayoutSlot } from "@photo-tools/shared-types";

interface AssignmentInspectorProps {
  pageLabel: string | null;
  slot?: LayoutSlot;
  assignment?: LayoutAssignment;
  asset?: ImageAsset;
  onChange: (changes: Partial<Pick<LayoutAssignment, "fitMode" | "zoom" | "offsetX" | "offsetY" | "rotation" | "locked">>) => void;
  onClear: () => void;
}

export function AssignmentInspector({
  pageLabel,
  slot,
  assignment,
  asset,
  onChange,
  onClear
}: AssignmentInspectorProps) {
  if (!slot) {
    return <p className="helper-copy">Seleziona uno slot per regolare foto, crop e comportamento del singolo riquadro.</p>;
  }

  if (!assignment || !asset) {
    return (
      <div className="stack">
        <p className="helper-copy">
          {pageLabel ? `${pageLabel}, slot ${slot.id}` : `Slot ${slot.id}`} e' vuoto. Trascina una foto dal banco laterale per riempirlo.
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
          <p>{pageLabel ? `${pageLabel} · slot ${slot.id}` : `Slot ${slot.id}`}</p>
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
      </div>

      <label className="field">
        <span>Zoom</span>
        <input
          type="range"
          min="0.7"
          max="2.2"
          step="0.05"
          value={assignment.zoom}
          onChange={(event) => onChange({ zoom: Number(event.target.value) })}
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
            value={assignment.offsetX}
            onChange={(event) => onChange({ offsetX: Number(event.target.value) })}
          />
        </label>

        <label className="field">
          <span>Spostamento Y</span>
          <input
            type="range"
            min="-100"
            max="100"
            step="1"
            value={assignment.offsetY}
            onChange={(event) => onChange({ offsetY: Number(event.target.value) })}
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
          value={assignment.rotation}
          onChange={(event) => onChange({ rotation: Number(event.target.value) })}
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
