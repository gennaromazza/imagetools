import { useEffect, useRef } from "react";

interface InputPanelProps {
  sourceFolderPath: string;
  loadedImages: number;
  activeImages: number;
  totalImages: number;
  verticalCount: number;
  horizontalCount: number;
  squareCount: number;
  isImporting: boolean;
  usesMockData: boolean;
  onSourceFolderChange: (value: string) => void;
  onFolderSelected: (files: FileList | null) => void;
  onLoadMockData: () => void;
  onOpenSelector: () => void;
}

export function InputPanel({
  sourceFolderPath,
  loadedImages,
  activeImages,
  totalImages,
  verticalCount,
  horizontalCount,
  squareCount,
  isImporting,
  usesMockData,
  onSourceFolderChange,
  onFolderSelected,
  onLoadMockData,
  onOpenSelector
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
          aria-label="Carica una cartella con immagini dal computer"
        >
          {isImporting ? "Importazione cartella..." : "Carica cartella immagini"}
        </button>

        {!usesMockData ? (
          <button type="button" className="ghost-button" onClick={onLoadMockData} aria-label="Carica il set fotografico di esempio">
            Ripristina demo
          </button>
        ) : null}

        <button type="button" className="ghost-button" onClick={onOpenSelector} aria-label="Apri il selettore di foto progetto">
          Seleziona foto progetto
        </button>
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
          <span>Foto caricate</span>
          <strong>{loadedImages}</strong>
        </div>
        <div className="stat-card stat-card--highlight">
          <span>Foto attive</span>
          <strong>{activeImages}</strong>
        </div>
        <div className="stat-card">
          <span>Nel piano</span>
          <strong>{totalImages}</strong>
        </div>
        <div className="stat-card">
          <span>Verticali</span>
          <strong>{verticalCount}</strong>
        </div>
      </div>

      <div className="stats-grid stats-grid--compact">
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
          ? "L'app parte con un piccolo set fotografico reale cosi' puoi vedere subito preview, fogli ed export. Puoi comunque aprire la selezione progetto e decidere quali foto usare."
          : "Puoi caricare molte piu foto di quelle che finiranno nei fogli. Con 'Seleziona foto progetto' scegli il sottoinsieme realmente usato per l'impaginazione."}
      </p>
    </div>
  );
}
