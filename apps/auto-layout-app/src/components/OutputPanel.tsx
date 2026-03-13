import type { AutoLayoutRequest, OutputFormat } from "@photo-tools/shared-types";

interface OutputPanelProps {
  request: AutoLayoutRequest;
  isExporting: boolean;
  exportMessage: string | null;
  supportsDirectoryPicker: boolean;
  onOutputChange: (
    field: "folderPath" | "fileNamePattern" | "quality" | "format",
    value: string | number
  ) => void;
  onPickOutputFolder: () => void;
  onGenerate: () => void;
}

export function OutputPanel({
  request,
  isExporting,
  exportMessage,
  supportsDirectoryPicker,
  onOutputChange,
  onPickOutputFolder,
  onGenerate
}: OutputPanelProps) {
  return (
    <div className="stack">
      <div className="inline-grid inline-grid--2">
        <label className="field">
          <span>Cartella di output</span>
          <input
            type="text"
            value={request.output.folderPath}
            onChange={(event) => onOutputChange("folderPath", event.target.value)}
          />
        </label>

        <label className="field">
          <span>Nome file</span>
          <input
            type="text"
            value={request.output.fileNamePattern}
            onChange={(event) => onOutputChange("fileNamePattern", event.target.value)}
          />
        </label>
      </div>

      <div className="inline-grid inline-grid--2">
        <label className="field">
          <span>Formato</span>
          <select
            value={request.output.format}
            onChange={(event) => onOutputChange("format", event.target.value as OutputFormat)}
          >
            <option value="jpg">JPG</option>
            <option value="png">PNG</option>
            <option value="tif">TIF (salvato come JPG nel browser)</option>
          </select>
        </label>

        <label className="field">
          <span>Qualita</span>
          <input
            type="number"
            min="1"
            max="100"
            value={request.output.quality}
            onChange={(event) => onOutputChange("quality", Number(event.target.value))}
          />
        </label>
      </div>

      <div className="button-row">
        {supportsDirectoryPicker ? (
          <button type="button" className="secondary-button" onClick={onPickOutputFolder}>
            Scegli cartella reale
          </button>
        ) : null}
        <button type="button" className="primary-button" onClick={onGenerate} disabled={isExporting}>
          {isExporting ? "Esportazione in corso..." : "Esporta fogli"}
        </button>
      </div>

      <p className="helper-copy">
        {supportsDirectoryPicker
          ? "Se scegli una cartella reale, i file vengono scritti direttamente li'. Altrimenti il browser scarica i fogli uno per uno."
          : "Il browser non supporta la scelta diretta della cartella: i fogli verranno scaricati come file."}
      </p>

      {exportMessage ? <div className="message-box message-box--warning">{exportMessage}</div> : null}
    </div>
  );
}
