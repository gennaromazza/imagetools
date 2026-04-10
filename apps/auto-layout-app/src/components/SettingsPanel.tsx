import { SHEET_PRESETS } from "@photo-tools/presets";
import type { AutoLayoutRequest, CropStrategy, FitMode, PlanningMode } from "@photo-tools/shared-types";

interface SettingsPanelProps {
  request: AutoLayoutRequest;
  onSheetPresetChange: (presetId: string) => void;
  onSheetFieldChange: (
    field: "widthCm" | "heightCm" | "marginCm" | "gapCm" | "dpi",
    value: number
  ) => void;
  onFitModeChange: (value: FitMode) => void;
  onCropStrategyChange: (value: CropStrategy) => void;
  onPlanningModeChange: (value: PlanningMode) => void;
  onDesiredSheetCountChange: (value: number) => void;
  onMaxPhotosPerSheetChange: (value: number) => void;
  onAllowTemplateVariationChange: (value: boolean) => void;
}

export function SettingsPanel({
  request,
  onSheetPresetChange,
  onSheetFieldChange,
  onFitModeChange,
  onCropStrategyChange,
  onPlanningModeChange,
  onDesiredSheetCountChange,
  onMaxPhotosPerSheetChange,
  onAllowTemplateVariationChange
}: SettingsPanelProps) {
  const isManualWorkflow = request.workflowMode === "manual";

  return (
    <div className="stack">
      <div className="inline-grid inline-grid--3">
        <label className="field">
          <span>Preset</span>
          <select
            value={request.sheet.presetId}
            onChange={(event) => onSheetPresetChange(event.target.value)}
          >
            {SHEET_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Larghezza (cm)</span>
          <input
            type="number"
            value={request.sheet.widthCm}
            onChange={(event) => onSheetFieldChange("widthCm", Number(event.target.value))}
          />
        </label>

        <label className="field">
          <span>Altezza (cm)</span>
          <input
            type="number"
            value={request.sheet.heightCm}
            onChange={(event) => onSheetFieldChange("heightCm", Number(event.target.value))}
          />
        </label>
      </div>

      <div className="inline-grid inline-grid--3">
        <label className="field">
          <span>Margini (cm)</span>
          <input
            type="number"
            step="0.1"
            value={request.sheet.marginCm}
            onChange={(event) => onSheetFieldChange("marginCm", Number(event.target.value))}
          />
        </label>

        <label className="field">
          <span>Spazio (cm)</span>
          <input
            type="number"
            step="0.1"
            value={request.sheet.gapCm}
            onChange={(event) => onSheetFieldChange("gapCm", Number(event.target.value))}
          />
        </label>

        <label className="field">
          <span>DPI</span>
          <input
            type="number"
            step="50"
            value={request.sheet.dpi}
            onChange={(event) => onSheetFieldChange("dpi", Number(event.target.value))}
          />
        </label>
      </div>

      <div className="field">
        <span>Modalita adattamento</span>
        <div className="segmented-control">
          {(["fit", "fill", "crop"] as FitMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={request.fitMode === mode ? "segment segment--active" : "segment"}
              onClick={() => onFitModeChange(mode)}
            >
              {mode === "fit" ? "Adatta" : mode === "fill" ? "Riempi" : "Ritaglia"}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Strategia ritaglio automatico</span>
        <div className="segmented-control">
          {([
            ["balanced", "Bilanciato"],
            ["portraitSafe", "Ritratto Safe"],
            ["landscapeSafe", "Paesaggio Safe"]
          ] as [CropStrategy, string][]).map(([strategy, label]) => (
            <button
              key={strategy}
              type="button"
              className={request.cropStrategy === strategy ? "segment segment--active" : "segment"}
              onClick={() => onCropStrategyChange(strategy)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!isManualWorkflow ? (
        <>
          <div className="field">
            <span>Modalita pianificazione</span>
            <div className="segmented-control">
              {(["desiredSheetCount", "maxPhotosPerSheet"] as PlanningMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={request.planningMode === mode ? "segment segment--active" : "segment"}
                  onClick={() => onPlanningModeChange(mode)}
                >
                  {mode === "desiredSheetCount" ? "Fogli desiderati" : "Foto per foglio"}
                </button>
              ))}
            </div>
          </div>

          {request.planningMode === "desiredSheetCount" ? (
            <label className="field">
              <span>Fogli desiderati</span>
              <input
                type="number"
                min="1"
                value={request.desiredSheetCount ?? 1}
                onChange={(event) => onDesiredSheetCountChange(Number(event.target.value))}
              />
            </label>
          ) : (
            <label className="field">
              <span>Numero massimo di foto per foglio</span>
              <input
                type="number"
                min="1"
                max="20"
                value={request.maxPhotosPerSheet ?? 2}
                onChange={(event) => onMaxPhotosPerSheetChange(Number(event.target.value))}
              />
            </label>
          )}

          <label className="check-row">
            <input
              type="checkbox"
              checked={request.allowTemplateVariation}
              onChange={(event) => onAllowTemplateVariationChange(event.target.checked)}
            />
            <span>Permetti varianti template automatiche tra i fogli</span>
          </label>
        </>
      ) : (
        <p className="helper-copy">
          Modalita manuale attiva: i fogli restano sotto controllo utente. Nessun ribilanciamento automatico del numero fogli.
        </p>
      )}
    </div>
  );
}
