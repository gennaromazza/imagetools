import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import type {
  DesktopRenderedImage,
  FileXDesktopApi,
  ImageFileFinderFileMatch,
  ImageFileFinderMatchMode,
  ImageFileFinderOperation,
  ImageFileFinderProgressSnapshot,
  ImageFileFinderScanResult,
} from "@photo-tools/desktop-contracts";
import { parseFileNameInput } from "./input-parser";

function getDesktopApi(): FileXDesktopApi | null {
  return window.filexDesktop ?? null;
}

function emptyProgress(): ImageFileFinderProgressSnapshot {
  return {
    jobId: null,
    status: "idle",
    operation: null,
    matchMode: null,
    sourceFolder: null,
    destinationFolder: null,
    total: 0,
    completed: 0,
    copied: 0,
    moved: 0,
    skipped: 0,
    errors: 0,
    currentFile: null,
    startedAt: null,
    finishedAt: null,
    error: null,
    logs: [],
  };
}

function shortPath(path: string): string {
  if (path.length <= 86) {
    return path;
  }
  return `...${path.slice(-83)}`;
}

function formatCount(value: number, singular: string, plural: string): string {
  return value === 1 ? `1 ${singular}` : `${value} ${plural}`;
}

const matchModeLabels: Record<ImageFileFinderMatchMode, string> = {
  exact: "Nome esatto",
  stem: "Senza estensione",
  contains: "Contiene testo",
};

export default function App() {
  const [apiAvailable, setApiAvailable] = useState(false);
  const [sourceFolder, setSourceFolder] = useState("");
  const [destinationFolder, setDestinationFolder] = useState("");
  const [rawInput, setRawInput] = useState("");
  const [matchMode, setMatchMode] = useState<ImageFileFinderMatchMode>("exact");
  const [operation, setOperation] = useState<ImageFileFinderOperation>("copy");
  const [scan, setScan] = useState<ImageFileFinderScanResult | null>(null);
  const [progress, setProgress] = useState<ImageFileFinderProgressSnapshot>(emptyProgress);
  const [isScanning, setIsScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<"source" | "destination" | null>(null);
  const [selectedFilePaths, setSelectedFilePaths] = useState<Set<string>>(() => new Set());

  const parsedInput = useMemo(() => parseFileNameInput(rawInput), [rawInput]);
  const isBusy = progress.status === "scanning" || progress.status === "running";
  const progressPct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  const canPreview = apiAvailable && sourceFolder.trim().length > 0 && parsedInput.names.length > 0 && !isBusy;
  const canStart =
    apiAvailable &&
    sourceFolder.trim().length > 0 &&
    destinationFolder.trim().length > 0 &&
    parsedInput.names.length > 0 &&
    selectedFilePaths.size > 0 &&
    !isBusy;

  useEffect(() => {
    const desktopApi = getDesktopApi();
    setApiAvailable(Boolean(desktopApi));
    if (!desktopApi) {
      return;
    }
    void desktopApi.getImageFileFinderProgress().then(setProgress);
  }, []);

  useEffect(() => {
    if (!isBusy) {
      return;
    }

    const interval = window.setInterval(() => {
      void getDesktopApi()?.getImageFileFinderProgress().then(setProgress);
    }, 400);
    return () => window.clearInterval(interval);
  }, [isBusy]);

  useEffect(() => {
    setScan(null);
    setSelectedFilePaths(new Set());
  }, [rawInput, sourceFolder, matchMode]);

  const chooseSource = useCallback(async () => {
    const folder = await getDesktopApi()?.chooseImageFileFinderSourceFolder();
    if (folder) {
      setSourceFolder(folder);
      setNotice(null);
    }
  }, []);

  const chooseDestination = useCallback(async () => {
    const folder = await getDesktopApi()?.chooseImageFileFinderDestinationFolder();
    if (folder) {
      setDestinationFolder(folder);
      setNotice(null);
    }
  }, []);

  const acceptDroppedFolder = useCallback(async (target: "source" | "destination", event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDropTarget(null);
    if (isBusy) return;
    const desktopApi = getDesktopApi();
    const file = Array.from(event.dataTransfer.files)[0];
    const droppedPath = file && desktopApi?.getPathForFile(file);
    if (!desktopApi || !droppedPath) {
      setNotice("Il trascinamento di cartelle è disponibile nell'app desktop.");
      return;
    }
    const result = await desktopApi.validateImageFileFinderFolder(droppedPath);
    if (!result.ok || !result.path) {
      setNotice(result.error ?? "Puoi trascinare soltanto una cartella.");
      return;
    }
    if (target === "source") setSourceFolder(result.path);
    else setDestinationFolder(result.path);
    setNotice(null);
  }, [isBusy]);

  const previewMatches = useCallback(async () => {
    const desktopApi = getDesktopApi();
    if (!desktopApi) {
      setNotice("Apri Trova Foto da Lista dalla suite desktop per usare le cartelle.");
      return;
    }
    if (!sourceFolder.trim() || parsedInput.names.length === 0) {
      setNotice("Seleziona una cartella sorgente e incolla almeno un nome file.");
      return;
    }

    setIsScanning(true);
    setNotice(null);
    try {
      const result = await desktopApi.scanImageFileFinderMatches({
        sourceFolder,
        rawInput,
        matchMode,
      });
      setScan(result);
      setSelectedFilePaths(new Set(result.matched.map((item) => item.absolutePath)));
      if (result.matched.length === 0) {
        setNotice("Nessun file univoco trovato con le impostazioni correnti.");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Anteprima non riuscita.");
    } finally {
      setIsScanning(false);
    }
  }, [matchMode, parsedInput.names.length, rawInput, sourceFolder]);

  const startJob = useCallback(async () => {
    const desktopApi = getDesktopApi();
    if (!desktopApi) {
      return;
    }

    const result = await desktopApi.startImageFileFinderJob({
      sourceFolder,
      destinationFolder,
      rawInput,
      matchMode,
      operation,
      selectedFilePaths: [...selectedFilePaths],
    });
    setProgress(result.progress);
    if (!result.ok) {
      setNotice(result.error ?? "Impossibile avviare l'operazione.");
    }
  }, [destinationFolder, matchMode, operation, rawInput, selectedFilePaths, sourceFolder]);

  const setMatchSelected = useCallback((absolutePath: string, selected: boolean) => {
    setSelectedFilePaths((current) => {
      const next = new Set(current);
      if (selected) next.add(absolutePath);
      else next.delete(absolutePath);
      return next;
    });
  }, []);

  const allCandidates = useMemo(
    () => scan ? [...scan.matched, ...scan.ambiguous.flatMap((item) => item.matches)] : [],
    [scan],
  );

  const cancelJob = useCallback(async () => {
    await getDesktopApi()?.cancelImageFileFinderJob();
    const nextProgress = await getDesktopApi()?.getImageFileFinderProgress();
    if (nextProgress) {
      setProgress(nextProgress);
    }
  }, []);

  const openDestination = useCallback(async () => {
    if (destinationFolder) {
      await getDesktopApi()?.openImageFileFinderFolder(destinationFolder);
    }
  }, [destinationFolder]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">FileX Suite</p>
          <h1>Trova Foto da Lista</h1>
        </div>
        <div className="runtime-pill">{apiAvailable ? "Desktop ready" : "Modalita browser"}</div>
      </header>

      <section className="workspace">
        <aside className="left-panel">
          <section className="section-block">
            <div className="section-heading">
              <h2>Cartelle</h2>
              <span>sorgente e destinazione</span>
            </div>
            <div className="field-stack">
              <label className="field">
                <span>Sorgente</span>
                <div
                  className={dropTarget === "source" ? "path-picker path-picker--drop-active" : "path-picker"}
                  onDragEnter={(event) => { event.preventDefault(); if (!isBusy) setDropTarget("source"); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={(event) => { if (event.currentTarget === event.target) setDropTarget(null); }}
                  onDrop={(event) => void acceptDroppedFolder("source", event)}
                >
                  <input value={sourceFolder} onChange={(event) => setSourceFolder(event.target.value)} disabled={isBusy} />
                  <button className="ghost-button" type="button" onClick={chooseSource} disabled={isBusy || !apiAvailable}>
                    Sfoglia
                  </button>
                </div>
                <small className="drop-hint">Trascina qui una cartella</small>
              </label>
              <label className="field">
                <span>Destinazione</span>
                <div
                  className={dropTarget === "destination" ? "path-picker path-picker--drop-active" : "path-picker"}
                  onDragEnter={(event) => { event.preventDefault(); if (!isBusy) setDropTarget("destination"); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={(event) => { if (event.currentTarget === event.target) setDropTarget(null); }}
                  onDrop={(event) => void acceptDroppedFolder("destination", event)}
                >
                  <input value={destinationFolder} onChange={(event) => setDestinationFolder(event.target.value)} disabled={isBusy} />
                  <button className="ghost-button" type="button" onClick={chooseDestination} disabled={isBusy || !apiAvailable}>
                    Sfoglia
                  </button>
                </div>
                <small className="drop-hint">Trascina qui una cartella</small>
              </label>
            </div>
          </section>

          <section className="section-block">
            <div className="section-heading">
              <h2>Nomi file</h2>
              <span>{formatCount(parsedInput.names.length, "nome", "nomi")}</span>
            </div>
            <textarea
              className="names-input"
              value={rawInput}
              onChange={(event) => setRawInput(event.target.value)}
              disabled={isBusy}
              placeholder={'IMG_0012.JPG\nDSC_8841.CR3, DSC_8842.CR3\n"C:\\\\Foto\\\\Matrimonio\\\\A001.webp"'}
            />
            {parsedInput.ignoredDuplicates.length > 0 ? (
              <div className="inline-warning">{parsedInput.ignoredDuplicates.length} duplicati nell'incolla verranno ignorati.</div>
            ) : null}
          </section>

          <section className="section-block">
            <div className="section-heading">
              <h2>Regole</h2>
              <span>{matchModeLabels[matchMode]}</span>
            </div>
            <div className="segmented" role="radiogroup" aria-label="Operazione">
              <button type="button" className={operation === "copy" ? "selected" : ""} onClick={() => setOperation("copy")} disabled={isBusy}>
                Copia
              </button>
              <button type="button" className={operation === "move" ? "selected" : ""} onClick={() => setOperation("move")} disabled={isBusy}>
                Sposta
              </button>
            </div>
            <div className="mode-list" role="radiogroup" aria-label="Modalita match">
              {(["exact", "stem", "contains"] as ImageFileFinderMatchMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={matchMode === mode ? "mode-card mode-card--selected" : "mode-card"}
                  onClick={() => setMatchMode(mode)}
                  disabled={isBusy}
                >
                  <strong>{matchModeLabels[mode]}</strong>
                  <span>
                    {mode === "exact"
                      ? "Stesso nome; se manca l'estensione usa il nome base."
                      : mode === "stem"
                        ? "Accetta JPG, RAW e varianti con stesso nome base."
                        : "Trova file che contengono il testo incollato."}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="main-panel">
          <div className="summary-row">
            <div className="metric">
              <span>Richiesti</span>
              <strong>{parsedInput.names.length}</strong>
            </div>
            <div className="metric">
              <span>Trovati</span>
              <strong>{isScanning ? "..." : scan?.matched.length ?? 0}</strong>
            </div>
            <div className="metric">
              <span>Mancanti</span>
              <strong>{scan?.missing.length ?? 0}</strong>
            </div>
            <div className="metric">
              <span>Ambigui</span>
              <strong>{scan?.ambiguous.length ?? 0}</strong>
            </div>
          </div>

          {notice ? <div className="notice">{notice}</div> : null}

          <section className="section-block action-panel">
            <div className="section-heading">
              <h2>Anteprima e avvio</h2>
              <div className="action-row">
                <button className="ghost-button" type="button" onClick={previewMatches} disabled={!canPreview || isScanning}>
                  {isScanning ? "Scansione..." : "Anteprima"}
                </button>
                {isBusy ? (
                  <button className="secondary-button" type="button" onClick={cancelJob}>
                    Annulla
                  </button>
                ) : (
                  <button className="primary-button" type="button" onClick={startJob} disabled={!canStart}>
                    {operation === "move" ? `Sposta ${selectedFilePaths.size} selezionate` : `Copia ${selectedFilePaths.size} selezionate`}
                  </button>
                )}
                <button className="ghost-button" type="button" onClick={openDestination} disabled={!apiAvailable || !destinationFolder}>
                  Apri destinazione
                </button>
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
                <span>{progress.completed}/{progress.total} completati</span>
                <span>{progress.copied} copiati</span>
                <span>{progress.moved} spostati</span>
                <span>{progress.errors} errori</span>
              </div>
              {progress.currentFile ? <div className="current-file" title={progress.currentFile}>{shortPath(progress.currentFile)}</div> : null}
            </div>
          </section>

          <section className="results-grid">
            <ResultList
              title="Trovati"
              count={scan?.matched.length ?? 0}
              empty="Nessun match univoco."
              rows={(scan?.matched ?? []).map((item) => ({
                key: `${item.requestedName}-${item.absolutePath}`,
                primary: item.requestedName,
                secondary: item.relativePath,
              }))}
            />
            <ResultList
              title="Mancanti"
              count={scan?.missing.length ?? 0}
              empty="Nessun mancante."
              tone="warn"
              rows={(scan?.missing ?? []).map((item) => ({
                key: item.requestedName,
                primary: item.requestedName,
                secondary: "Non trovato",
              }))}
            />
            <ResultList
              title="Ambigui"
              count={scan?.ambiguous.length ?? 0}
              empty="Nessun ambiguo."
              tone="error"
              rows={(scan?.ambiguous ?? []).map((item) => ({
                key: item.requestedName,
                primary: item.requestedName,
                secondary: `${item.matches.length} corrispondenze`,
              }))}
            />
          </section>

          {scan ? (
            <section className="section-block selection-panel">
              <div className="section-heading">
                <div>
                  <h2>Scegli le foto da copiare</h2>
                  <span>Le foto ambigue non vengono copiate finché non le selezioni qui.</span>
                </div>
                <div className="selection-actions">
                  <strong>{formatCount(selectedFilePaths.size, "foto selezionata", "foto selezionate")}</strong>
                  <button className="ghost-button" type="button" onClick={() => setSelectedFilePaths(new Set(allCandidates.map((item) => item.absolutePath)))} disabled={allCandidates.length === 0 || isBusy}>
                    Seleziona tutte
                  </button>
                  <button className="ghost-button" type="button" onClick={() => setSelectedFilePaths(new Set())} disabled={selectedFilePaths.size === 0 || isBusy}>
                    Deseleziona
                  </button>
                </div>
              </div>
              {scan.matched.length > 0 ? (
                <MatchGroup
                  title="Corrispondenze univoche"
                  description="Sono già selezionate, ma puoi escluderle."
                  matches={scan.matched}
                  selectedFilePaths={selectedFilePaths}
                  disabled={isBusy}
                  onSelect={setMatchSelected}
                />
              ) : null}
              {scan.ambiguous.map((item) => (
                <MatchGroup
                  key={item.requestedName}
                  title={item.requestedName}
                  description={`${item.matches.length} file con questo nome: seleziona quello o quelli corretti.`}
                  matches={item.matches}
                  selectedFilePaths={selectedFilePaths}
                  disabled={isBusy}
                  onSelect={setMatchSelected}
                />
              ))}
            </section>
          ) : null}

          <section className="section-block logs-block">
            <div className="section-heading">
              <h2>Log</h2>
              <span>{progress.logs.length} eventi</span>
            </div>
            {progress.logs.length === 0 ? (
              <div className="empty-state">Il log comparira durante copia o spostamento.</div>
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
          </section>
        </section>
      </section>
    </main>
  );
}

function MatchGroup({
  title,
  description,
  matches,
  selectedFilePaths,
  disabled,
  onSelect,
}: {
  title: string;
  description: string;
  matches: ImageFileFinderFileMatch[];
  selectedFilePaths: Set<string>;
  disabled: boolean;
  onSelect: (absolutePath: string, selected: boolean) => void;
}) {
  return (
    <section className="match-group">
      <header>
        <div><strong>{title}</strong><span>{description}</span></div>
        <button className="text-button" type="button" disabled={disabled} onClick={() => matches.forEach((item) => onSelect(item.absolutePath, true))}>Tutte</button>
      </header>
      <div className="match-picker-grid">
        {matches.map((match) => (
          <label className={selectedFilePaths.has(match.absolutePath) ? "match-card match-card--selected" : "match-card"} key={match.absolutePath}>
            <input
              type="checkbox"
              checked={selectedFilePaths.has(match.absolutePath)}
              disabled={disabled}
              onChange={(event) => onSelect(match.absolutePath, event.target.checked)}
            />
            <MatchThumbnail match={match} />
            <span className="match-card__name">{match.fileName}</span>
            <span className="match-card__path" title={match.relativePath}>{match.relativePath}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

function MatchThumbnail({ match }: { match: ImageFileFinderFileMatch }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setSrc(null);
    setFailed(false);
    void getDesktopApi()?.getThumbnail(match.absolutePath, 240, 72, `${match.absolutePath}:${match.size}`, { profile: "fast" })
      .then((image: DesktopRenderedImage | null) => {
        if (!image) throw new Error("anteprima assente");
        const bytes = new Uint8Array(image.bytes);
        objectUrl = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: image.mimeType }));
        if (alive) setSrc(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [match.absolutePath, match.size]);

  if (!src) return <div className="match-thumbnail match-thumbnail--placeholder">{failed ? "Anteprima non disponibile" : "Carico anteprima…"}</div>;
  return <img className="match-thumbnail" src={src} alt={`Anteprima ${match.fileName}`} decoding="async" />;
}

interface ResultListRow {
  key: string;
  primary: string;
  secondary: string;
}

function ResultList({
  title,
  count,
  rows,
  empty,
  tone = "ok",
}: {
  title: string;
  count: number;
  rows: ResultListRow[];
  empty: string;
  tone?: "ok" | "warn" | "error";
}) {
  return (
    <section className={`section-block result-list result-list--${tone}`}>
      <div className="section-heading">
        <h2>{title}</h2>
        <span>{count}</span>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">{empty}</div>
      ) : (
        <div className="result-rows">
          {rows.slice(0, 160).map((row) => (
            <div className="result-row" key={row.key}>
              <strong>{row.primary}</strong>
              <span title={row.secondary}>{shortPath(row.secondary)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
