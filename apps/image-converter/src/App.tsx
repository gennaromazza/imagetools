import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  FileXDesktopApi,
  ImageConverterPreset,
  ImageConverterPresetId,
  ImageConverterProgressSnapshot,
  ImageConverterScanResult,
} from "@photo-tools/desktop-contracts";

const fallbackPresets: ImageConverterPreset[] = [
  {
    id: "web-quality",
    name: "Web qualita",
    description: "JPG leggero per siti e gallery online.",
    maxLongEdge: 2048,
    format: "jpg",
    quality: 85,
  },
  {
    id: "web-light",
    name: "Web leggero",
    description: "WebP compatto per consegne rapide.",
    maxLongEdge: 1600,
    format: "webp",
    quality: 78,
  },
  {
    id: "social",
    name: "Social",
    description: "JPG pronto per feed e condivisioni.",
    maxLongEdge: 1350,
    format: "jpg",
    quality: 85,
  },
  {
    id: "quick-preview",
    name: "Anteprima rapida",
    description: "WebP piccolo per revisione veloce.",
    maxLongEdge: 900,
    format: "webp",
    quality: 70,
  },
  {
    id: "print-jpg",
    name: "Stampa JPG",
    description: "JPG ad alta qualita per stampa leggera.",
    maxLongEdge: 4000,
    format: "jpg",
    quality: 92,
  },
  {
    id: "raw-archive-lossless",
    name: "Archivio RAW senza perdita",
    description: "DNG compresso, XMP copiati e originali sempre conservati.",
    maxLongEdge: 0,
    format: "dng",
    quality: 100,
  },
];

function getDesktopApi(): FileXDesktopApi | null {
  return window.filexDesktop ?? null;
}

function getDroppedPaths(files: FileList): string[] {
  const desktopApi = getDesktopApi();
  return Array.from(files)
    .map((file) => desktopApi?.getPathForFile(file) ?? (file as File & { path?: string }).path ?? "")
    .filter((path) => path.trim().length > 0);
}

function emptyProgress(): ImageConverterProgressSnapshot {
  return {
    jobId: null,
    status: "idle",
    presetId: null,
    total: 0,
    completed: 0,
    generated: 0,
    skipped: 0,
    errors: 0,
    currentFile: null,
    outputRoots: [],
    startedAt: null,
    finishedAt: null,
    error: null,
    logs: [],
  };
}

function formatCount(value: number, singular: string, plural: string): string {
  return value === 1 ? `1 ${singular}` : `${value} ${plural}`;
}

function shortPath(path: string): string {
  if (path.length <= 78) {
    return path;
  }
  return `...${path.slice(-75)}`;
}

export default function App() {
  const [apiAvailable, setApiAvailable] = useState(false);
  const [presets, setPresets] = useState<ImageConverterPreset[]>(fallbackPresets);
  const [selectedPresetId, setSelectedPresetId] = useState<ImageConverterPresetId>("web-quality");
  const [inputPaths, setInputPaths] = useState<string[]>([]);
  const [scan, setScan] = useState<ImageConverterScanResult | null>(null);
  const [progress, setProgress] = useState<ImageConverterProgressSnapshot>(emptyProgress);
  const [isDropActive, setIsDropActive] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [customMaxLongEdge, setCustomMaxLongEdge] = useState("");
  const [targetMaxBytesMb, setTargetMaxBytesMb] = useState("");
  const [openOutputWhenDone, setOpenOutputWhenDone] = useState(true);

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPresetId) ?? presets[0],
    [presets, selectedPresetId],
  );
  const isBusy = progress.status === "running" || progress.status === "scanning";
  const isRawArchive = selectedPreset?.format === "dng";
  const progressPct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  const eligibleImageCount = useMemo(
    () => scan?.entries.filter((entry) => isRawArchive ? entry.sourceKind === "raw" : entry.sourceKind === "bitmap").length ?? 0,
    [isRawArchive, scan],
  );

  useEffect(() => {
    const desktopApi = getDesktopApi();
    setApiAvailable(Boolean(desktopApi));
    if (!desktopApi) {
      return;
    }

    void desktopApi.getImageConverterPresets().then((loadedPresets) => {
      if (loadedPresets.length > 0) {
        setPresets(loadedPresets);
        setSelectedPresetId(loadedPresets[0].id);
      }
    });
    void desktopApi.getImageConverterProgress().then(setProgress);
  }, []);

  useEffect(() => {
    if (!isBusy) {
      return;
    }

    const interval = window.setInterval(() => {
      void getDesktopApi()?.getImageConverterProgress().then(setProgress);
    }, 500);

    return () => window.clearInterval(interval);
  }, [isBusy]);

  const rescan = useCallback(async (paths: string[]) => {
    const desktopApi = getDesktopApi();
    if (!desktopApi || paths.length === 0) {
      setScan(null);
      return;
    }

    setIsScanning(true);
    setNotice(null);
    try {
      const result = await desktopApi.scanImageConverterInputs(paths);
      setScan(result);
      if (result.totalImages === 0) {
        setNotice("Nessuna immagine supportata trovata nei percorsi selezionati.");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Scansione non riuscita.");
    } finally {
      setIsScanning(false);
    }
  }, []);

  const addPaths = useCallback(
    async (paths: string[]) => {
      const cleaned = paths.map((path) => path.trim()).filter(Boolean);
      if (cleaned.length === 0) {
        setNotice("Nessun percorso valido rilevato.");
        return;
      }

      const merged = Array.from(new Set([...inputPaths, ...cleaned]));
      setInputPaths(merged);
      await rescan(merged);
    },
    [inputPaths, rescan],
  );

  const browseFolders = useCallback(async () => {
    const desktopApi = getDesktopApi();
    if (!desktopApi) {
      setNotice("Apri Image Converter dalla suite desktop per usare le cartelle.");
      return;
    }

    const folders = await desktopApi.chooseImageConverterFolders();
    if (folders.length > 0) {
      await addPaths(folders);
    }
  }, [addPaths]);

  const clearInputs = useCallback(() => {
    if (isBusy) {
      return;
    }
    setInputPaths([]);
    setScan(null);
    setNotice(null);
  }, [isBusy]);

  const startJob = useCallback(async () => {
    const desktopApi = getDesktopApi();
    if (!desktopApi || inputPaths.length === 0 || !selectedPreset) {
      return;
    }

    const result = await desktopApi.startImageConverterJob({
      inputPaths,
      presetId: selectedPreset.id,
      overrides: {
        maxLongEdge: customMaxLongEdge.trim() ? Number(customMaxLongEdge) : null,
        targetMaxBytesMb: targetMaxBytesMb.trim() ? Number(targetMaxBytesMb) : null,
        openOutputWhenDone,
      },
    });
    setProgress(result.progress);
    if (!result.ok) {
      setNotice(result.error ?? "Impossibile avviare la conversione.");
    }
  }, [customMaxLongEdge, inputPaths, openOutputWhenDone, selectedPreset, targetMaxBytesMb]);

  const cancelJob = useCallback(async () => {
    await getDesktopApi()?.cancelImageConverterJob();
    const nextProgress = await getDesktopApi()?.getImageConverterProgress();
    if (nextProgress) {
      setProgress(nextProgress);
    }
  }, []);

  const openOutput = useCallback(async (folderPath: string) => {
    try {
      await getDesktopApi()?.openImageConverterFolder(folderPath);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Impossibile aprire la cartella output.");
    }
  }, []);

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDropActive(false);
      await addPaths(getDroppedPaths(event.dataTransfer.files));
    },
    [addPaths],
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">FileX Suite</p>
          <h1>Image Converter</h1>
        </div>
        <div className="runtime-pill">{apiAvailable ? "Desktop ready" : "Modalita browser"}</div>
      </header>

      <section className="workspace">
        <aside className="left-panel">
          <div
            className={`drop-zone${isDropActive ? " drop-zone--active" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setIsDropActive(true);
            }}
            onDragLeave={() => setIsDropActive(false)}
            onDrop={handleDrop}
          >
            <div className="drop-icon" aria-hidden="true">+</div>
            <strong>Trascina cartelle o immagini</strong>
            <span>La scansione include tutte le sottocartelle e ignora gli output gia generati.</span>
            <button className="primary-button" type="button" onClick={browseFolders} disabled={isBusy}>
              Sfoglia cartelle
            </button>
          </div>

          <div className="section-block">
            <div className="section-heading">
              <h2>Preset</h2>
              <span>{presets.length} disponibili</span>
            </div>
            <div className="preset-list" role="radiogroup" aria-label="Preset conversione">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  className={`preset-card${preset.id === selectedPresetId ? " preset-card--selected" : ""}`}
                  type="button"
                  role="radio"
                  aria-checked={preset.id === selectedPresetId}
                  onClick={() => setSelectedPresetId(preset.id)}
                  disabled={isBusy}
                >
                  <span className="preset-name">{preset.name}</span>
                  <span className="preset-meta">
                    {preset.format === "dng" ? "DNG | lossless | originali conservati" : `${preset.format.toUpperCase()} | ${preset.maxLongEdge}px | q${preset.quality}`}
                  </span>
                  <span className="preset-description">{preset.description}</span>
                </button>
              ))}
            </div>
          </div>

          {!isRawArchive ? <div className="section-block">
            <div className="section-heading">
              <h2>Export</h2>
              <span>opzionale</span>
            </div>
            <div className="field-grid">
              <label className="field">
                <span>Lato lungo max</span>
                <input
                  type="number"
                  min="200"
                  max="12000"
                  step="50"
                  placeholder={`${selectedPreset?.maxLongEdge ?? 2048}`}
                  value={customMaxLongEdge}
                  onChange={(event) => setCustomMaxLongEdge(event.target.value)}
                  disabled={isBusy}
                />
              </label>
              <label className="field">
                <span>Limite MB/file</span>
                <input
                  type="number"
                  min="0.1"
                  max="200"
                  step="0.1"
                  placeholder="nessun limite"
                  value={targetMaxBytesMb}
                  onChange={(event) => setTargetMaxBytesMb(event.target.value)}
                  disabled={isBusy}
                />
              </label>
            </div>
          </div> : (
            <div className="section-block">
              <div className="notice">Richiede Adobe DNG Converter. I RAW originali non vengono mai cancellati e gli XMP affiancati vengono copiati.</div>
            </div>
          )}

          <div className="section-block">
            <label className="check-field">
              <input
                type="checkbox"
                checked={openOutputWhenDone}
                onChange={(event) => setOpenOutputWhenDone(event.target.checked)}
                disabled={isBusy}
              />
              <span>
                <strong>Apri cartella al termine</strong>
                <small>Mostra automaticamente in Esplora file la cartella con i risultati.</small>
              </span>
            </label>
          </div>
        </aside>

        <section className="main-panel">
          <div className="summary-row">
            <div className="metric">
              <span>Input</span>
              <strong>{formatCount(inputPaths.length, "percorso", "percorsi")}</strong>
            </div>
            <div className="metric">
              <span>Immagini</span>
              <strong>{isScanning ? "Scansione..." : eligibleImageCount}</strong>
            </div>
            <div className="metric">
              <span>Output</span>
              <strong>
                {selectedPreset?.format.toUpperCase() ?? "JPG"}
                {targetMaxBytesMb.trim() ? ` <= ${targetMaxBytesMb} MB` : ""}
              </strong>
            </div>
            <div className="metric">
              <span>Lato lungo</span>
              <strong>{isRawArchive ? "Originale" : `${customMaxLongEdge.trim() || selectedPreset?.maxLongEdge || 2048}px`}</strong>
            </div>
          </div>

          {notice ? <div className="notice">{notice}</div> : null}

          <div className="section-block">
            <div className="section-heading">
              <h2>Cartelle e file</h2>
              <button className="ghost-button" type="button" onClick={clearInputs} disabled={isBusy || inputPaths.length === 0}>
                Pulisci
              </button>
            </div>
            {inputPaths.length === 0 ? (
              <div className="empty-state">Nessun percorso selezionato.</div>
            ) : (
              <div className="path-list">
                {inputPaths.map((path) => (
                  <div className="path-row" key={path} title={path}>
                    {shortPath(path)}
                  </div>
                ))}
              </div>
            )}
            {scan && (scan.issues.length > 0 || scan.duplicateCount > 0) ? (
              <div className="scan-warnings">
                {scan.duplicateCount > 0 ? <span>{scan.duplicateCount} duplicati ignorati</span> : null}
                {scan.issues.slice(0, 4).map((issue) => (
                  <span key={`${issue.path}-${issue.message}`}>{issue.message}: {shortPath(issue.path)}</span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="section-block">
            <div className="section-heading">
              <h2>Conversione</h2>
              <div className="action-row">
                {isBusy ? (
                  <button className="secondary-button" type="button" onClick={cancelJob}>
                    Annulla
                  </button>
                ) : (
                  <button
                    className="primary-button"
                    type="button"
                    onClick={startJob}
                    disabled={!apiAvailable || inputPaths.length === 0 || eligibleImageCount === 0}
                  >
                    Avvia conversione
                  </button>
                )}
              </div>
            </div>

            <div className="progress-card">
              <div className="progress-header">
                <span>{progress.status}</span>
                <strong>{progressPct}%</strong>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="progress-stats">
                <span>{progress.completed}/{progress.total} completate</span>
                <span>{progress.generated} generate</span>
                <span>{progress.skipped} saltate</span>
                <span>{progress.errors} errori</span>
              </div>
              {progress.currentFile ? (
                <div className="current-file" title={progress.currentFile}>{shortPath(progress.currentFile)}</div>
              ) : null}
            </div>

            {progress.outputRoots.length > 0 ? (
              <div className="output-list">
                {progress.outputRoots.map((folderPath) => (
                  <button className="output-button" key={folderPath} type="button" onClick={() => openOutput(folderPath)}>
                    Apri cartella output - {shortPath(folderPath)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="section-block logs-block">
            <div className="section-heading">
              <h2>Log</h2>
              <span>{progress.logs.length} eventi</span>
            </div>
            {progress.logs.length === 0 ? (
              <div className="empty-state">Il log comparira durante la conversione.</div>
            ) : (
              <div className="log-list">
                {progress.logs.slice().reverse().map((entry) => (
                  <div className={`log-row log-row--${entry.level}`} key={`${entry.timestamp}-${entry.message}-${entry.path ?? ""}`}>
                    <strong>{entry.level}</strong>
                    <span>{entry.message}</span>
                    {entry.path ? <em title={entry.path}>{shortPath(entry.path)}</em> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
