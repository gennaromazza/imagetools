import type { GeneratedPageLayout, ImageAsset, LayoutAssignment, LayoutSlot } from "@photo-tools/shared-types";
import { getEffectiveSlotAspectRatio } from "../utils/slot-geometry";

interface AssignmentInspectorProps {
  pageLabel: string | null;
  slot?: LayoutSlot;
  assignment?: LayoutAssignment;
  asset?: ImageAsset;
  sheetSpec?: GeneratedPageLayout["sheetSpec"];
  slotCount?: number;
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getAutoFillCrop(
  asset: ImageAsset,
  slot: LayoutSlot,
  sheetSpec?: GeneratedPageLayout["sheetSpec"],
  slotCount = 1
) {
  const imageAspect = asset.aspectRatio > 0 ? asset.aspectRatio : 1;
  const slotAspect = getEffectiveSlotAspectRatio(slot, sheetSpec, slotCount);

  if (imageAspect > slotAspect) {
    const width = clamp(slotAspect / imageAspect, 0.08, 1);
    return { cropLeft: (1 - width) / 2, cropTop: 0, cropWidth: width, cropHeight: 1 };
  }

  const height = clamp(imageAspect / slotAspect, 0.08, 1);
  return { cropLeft: 0, cropTop: (1 - height) / 2, cropWidth: 1, cropHeight: height };
}

export function AssignmentInspector({
  pageLabel,
  slot,
  assignment,
  asset,
  sheetSpec,
  slotCount = 1,
  onChange,
  onClear,
  onOpenCropEditor
}: AssignmentInspectorProps) {
  if (!slot) {
    return <p className="helper-copy">Seleziona uno slot per regolare foto, foglio e inquadratura finale del riquadro.</p>;
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

  const isManualCrop = assignment.fitMode === "crop";
  const activeMode = assignment.fitMode === "fit" ? "fit" : "fill";

  const applyMode = (mode: "fit" | "fill") => {
    if (mode === "fit") {
      onChange({
        fitMode: "fit",
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
        cropLeft: 0,
        cropTop: 0,
        cropWidth: 1,
        cropHeight: 1
      });
      return;
    }

    const autoFillCrop = getAutoFillCrop(asset, slot, sheetSpec, slotCount);
    onChange({
      fitMode: "fill",
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      ...autoFillCrop
    });
  };

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
          {(["fit", "fill"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={activeMode === mode ? "segment segment--active" : "segment"}
              onClick={() => applyMode(mode)}
            >
              {mode === "fit" ? "Adatta" : "Riempi"}
            </button>
          ))}
        </div>
        <small className="helper-inline">
          Il template definisce lo slot. Qui scegli se vedere tutta la foto o riempire il riquadro.
          L'inquadratura manuale si fa sempre dall'editor dedicato.
        </small>
      </div>

      <div className="field">
        <span>Inquadratura</span>
        {isManualCrop ? (
          <small className="helper-inline">
            Inquadratura manuale attiva. Se cambi template o slot, il sistema prova a preservarla e riadattarla.
          </small>
        ) : (
          <small className="helper-inline">
            Nessun crop manuale attivo. Apri l'editor per decidere esattamente cosa deve restare visibile nello slot.
          </small>
        )}
        <div className="inline-grid inline-grid--2">
          <button type="button" className="ghost-button" onClick={onOpenCropEditor}>
            Modifica inquadratura
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => applyMode("fill")}
            disabled={!isManualCrop}
            title={isManualCrop ? "Ripristina il riempimento automatico dello slot" : "Nessun crop manuale da ripristinare"}
          >
            Reset inquadratura
          </button>
        </div>
      </div>

      <label className="check-row">
        <input
          type="checkbox"
          checked={assignment.locked}
          onChange={(event) => onChange({ locked: event.target.checked })}
        />
        <span>Blocca questo slot</span>
      </label>

      <button
        type="button"
        className="ghost-button"
        onClick={onClear}
        disabled={assignment.locked}
        title={assignment.locked ? "Sblocca lo slot per rimuovere la foto" : "Rimuovi foto dallo slot"}
      >
        Rimuovi foto dallo slot
      </button>
    </div>
  );
}
