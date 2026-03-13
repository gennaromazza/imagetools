import { useEffect, useRef } from "react";

interface InputPanelProps {
  sourceFolderPath: string;
  totalImages: number;
  verticalCount: number;
  horizontalCount: number;
  squareCount: number;
  isImporting: boolean;
  usesMockData: boolean;
  onSourceFolderChange: (value: string) => void;
  onFolderSelected: (files: FileList | null) => void;
  onLoadMockData: () => void;
}

export function InputPanel({
  sourceFolderPath,
  totalImages,
  verticalCount,
  horizontalCount,
  squareCount,
  isImporting,
  usesMockData,
  onSourceFolderChange,
  onFolderSelected,
  onLoadMockData
}: InputPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!fileInputRef.current) {
      return;
    }

    fileInputRef.current.setAttribute("webkitdirectory", "");
    fileInputRef.current.setAttribute("directory", "");
  }, []);

  return (
    <div className="stack">
      <div className="button-row">
        <button
          type="button"
          className="secondary-button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isImporting}
        >
          {isImporting ? "Importazione cartella..." : "Carica cartella immagini"}
        </button>

        {!usesMockData ? (
          <button type="button" className="ghost-button" onClick={onLoadMockData}>
            Ripristina demo
          </button>
        ) : null}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png"
        multiple
        className="hidden-file-input"
        onChange={(event) => onFolderSelected(event.target.files)}
      />

      <label className="field">
        <span>Cartella sorgente</span>
        <input
          type="text"
          value={sourceFolderPath}
          onChange={(event) => onSourceFolderChange(event.target.value)}
          placeholder="C:/jobs/wedding-2026/selected"
        />
      </label>

      <div className="stats-grid">
        <div className="stat-card">
          <span>Immagini totali</span>
          <strong>{totalImages}</strong>
        </div>
        <div className="stat-card">
          <span>Verticali</span>
          <strong>{verticalCount}</strong>
        </div>
        <div className="stat-card">
          <span>Orizzontali</span>
          <strong>{horizontalCount}</strong>
        </div>
        <div className="stat-card">
          <span>Quadrate</span>
          <strong>{squareCount}</strong>
        </div>
      </div>

      <p className="helper-copy">
        {usesMockData
          ? "L'app parte con un piccolo set fotografico reale cosi' puoi vedere subito preview, fogli ed export. Usa 'Carica cartella immagini' per passare al servizio vero."
          : "Il layout corrente si basa sulle immagini che hai selezionato nel browser. Sono supportati JPG e PNG con preview reali nei fogli."}
      </p>
    </div>
  );
}
