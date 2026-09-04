import { useEffect, useRef, useState } from "react";
import type {
  ImageConverterOutputFormat,
  ImageConverterPreset,
  ImageConverterPresetId,
  ImageConverterProgressSnapshot,
} from "@photo-tools/desktop-contracts";
import {
  cancelImageConverterJob,
  chooseImageConverterFolders,
  getImageConverterPresets,
  getImageConverterProgress,
  openImageConverterFolder,
  startImageConverterJob,
} from "../services/desktop-store";

interface ExportModalProps {
  fileCount: number;
  rawCount: number;
  inputPaths: string[];
  onClose: () => void;
}

type ExportPhase = "setup" | "running" | "done";

export function ExportModal({ fileCount, rawCount, inputPaths, onClose }: ExportModalProps) {
  const [presets, setPresets] = useState<ImageConverterPreset[]>([]);
  const [presetId, setPresetId] = useState<ImageConverterPresetId>("web-quality");
  const [format, setFormat] = useState<ImageConverterOutputFormat>("jpg");
  const [quality, setQuality] = useState(85);
  const [maxLongEdge, setMaxLongEdge] = useState(2048);
  const [outputDirectory, setOutputDirectory] = useState("");
  const [keepMetadata, setKeepMetadata] = useState(true);
  const [openWhenDone, setOpenWhenDone] = useState(true);
  const [phase, setPhase] = useState<ExportPhase>("setup");
  const [progress, setProgress] = useState<ImageConverterProgressSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    void getImageConverterPresets().then((loaded) => {
      if (!active) {
        return;
      }
      const bitmapPresets = loaded.filter((preset) => preset.format !== "dng");
      setPresets(bitmapPresets);
      const fallback = bitmapPresets[0];
      if (fallback) {
        setPresetId(fallback.id);
        setFormat(fallback.format === "dng" ? "jpg" : fallback.format);
        setQuality(fallback.quality);
        setMaxLongEdge(fallback.maxLongEdge > 0 ? fallback.maxLongEdge : 2048);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const selected = presets.find((preset) => preset.id === presetId);
    if (selected && phase === "setup") {
      setFormat(selected.format === "dng" ? "jpg" : selected.format);
      setQuality(selected.quality);
      if (selected.maxLongEdge > 0) {
        setMaxLongEdge(selected.maxLongEdge);
      }
    }
  }, [presetId, presets, phase]);

  useEffect(() => {
    if (phase !== "running") {
      return;
    }
    const timer = window.setInterval(() => {
      void getImageConverterProgress().then((snapshot) => {
        if (!snapshot) {
          return;
        }
        setProgress(snapshot);
        if (snapshot.status === "completed" || snapshot.status === "cancelled" || snapshot.status === "error") {
          setPhase("done");
        }
      });
    }, 800);
    pollTimerRef.current = timer;
    return () => {
      window.clearInterval(timer);
      pollTimerRef.current = null;
    };
  }, [phase]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && phase !== "running") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, phase]);

  async function handleChooseDirectory() {
    const folders = await chooseImageConverterFolders();
    if (folders[0]) {
      setOutputDirectory(folders[0]);
    }
  }

  async function handleStart() {
    setError(null);
    const result = await startImageConverterJob({
      inputPaths,
      presetId,
      overrides: {
        format,
        quality,
        maxLongEdge,
        keepMetadata,
        openOutputWhenDone: openWhenDone,
        outputDirectory: outputDirectory.trim() ? outputDirectory.trim() : null,
      },
    });
    if (!result.ok) {
      setError(result.error ?? "Avvio esportazione non riuscito.");
      return;
    }
    setPhase("running");
  }

  async function handleCancel() {
    await cancelImageConverterJob();
  }

  const percent = progress && progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;

  return (
    <div className="modal-backdrop" onClick={phase === "running" ? undefined : onClose}>
      <div
        className="modal-panel modal-panel--drive-picker"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
      >
        <div className="modal-panel__header">
          <div>
            <h2 id="export-title">Esporta {fileCount === 1 ? "1 foto" : `${fileCount} foto`}</h2>
            <p>Motore Image Converter integrato: nessuna app da aprire, nessuna reimportazione.</p>
          </div>
        </div>
        <div className="modal-panel__body" style={{ display: "grid", gap: "0.7rem" }}>
          {phase === "setup" ? (
            <>
              <label style={{ display: "grid", gap: "0.3rem", fontSize: "0.85rem" }}>
                Preset di partenza
                <select
                  value={presetId}
                  onChange={(event) => setPresetId(event.target.value as ImageConverterPresetId)}
                  style={{ padding: "0.45rem 0.6rem", borderRadius: 10 }}
                >
                  {presets.map((preset) => (
                    <option key={preset.id} value={preset.id} title={preset.description}>
                      {preset.name} — {preset.description}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: "flex", gap: "0.7rem", flexWrap: "wrap" }}>
                <label style={{ display: "grid", gap: "0.3rem", fontSize: "0.85rem" }}>
                  Formato
                  <select
                    value={format}
                    onChange={(event) => setFormat(event.target.value as ImageConverterOutputFormat)}
                    style={{ padding: "0.45rem 0.6rem", borderRadius: 10 }}
                  >
                    <option value="jpg">JPEG</option>
                    <option value="webp">WebP</option>
                  </select>
                </label>
                <label style={{ display: "grid", gap: "0.3rem", fontSize: "0.85rem" }}>
                  Qualità (1–100)
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={quality}
                    onChange={(event) => setQuality(Number(event.target.value) || 0)}
                    style={{ width: 90, padding: "0.4rem 0.55rem", borderRadius: 10 }}
                  />
                </label>
                <label style={{ display: "grid", gap: "0.3rem", fontSize: "0.85rem" }}>
                  Lato lungo max (px)
                  <input
                    type="number"
                    min={200}
                    max={12000}
                    step={50}
                    value={maxLongEdge}
                    onChange={(event) => setMaxLongEdge(Number(event.target.value) || 0)}
                    style={{ width: 110, padding: "0.4rem 0.55rem", borderRadius: 10 }}
                  />
                </label>
              </div>
              <div style={{ display: "grid", gap: "0.3rem", fontSize: "0.85rem" }}>
                <span>Cartella di destinazione (vuota = accanto agli originali)</span>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    type="text"
                    value={outputDirectory}
                    onChange={(event) => setOutputDirectory(event.target.value)}
                    placeholder="Predefinita di Image Converter"
                    style={{ flex: 1, padding: "0.45rem 0.6rem", borderRadius: 10 }}
                  />
                  <button type="button" className="secondary-button" style={{ padding: "0.45rem 0.85rem", fontSize: "0.84rem" }} onClick={() => { void handleChooseDirectory(); }}>
                    Scegli…
                  </button>
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                <input type="checkbox" checked={keepMetadata} onChange={(event) => setKeepMetadata(event.target.checked)} />
                Mantieni metadati EXIF (data di scatto, fotocamera)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                <input type="checkbox" checked={openWhenDone} onChange={(event) => setOpenWhenDone(event.target.checked)} />
                Apri la cartella al termine
              </label>
              {rawCount > 0 ? (
                <p style={{ fontSize: "0.8rem", opacity: 0.75, margin: 0 }}>
                  {rawCount === 1 ? "1 RAW verrà saltato" : `${rawCount} RAW verranno saltati`}: per i RAW usa il preset DNG da Image Converter.
                </p>
              ) : null}
              {inputPaths.length === 0 ? (
                <p role="alert" style={{ fontSize: "0.84rem", color: "#e0a75c", margin: 0 }}>
                  Percorsi non risolti per questa selezione: riapri la cartella e riprova.
                </p>
              ) : null}
              {error ? <p role="alert" style={{ fontSize: "0.84rem", color: "#e0a75c", margin: 0 }}>{error}</p> : null}
            </>
          ) : (
            <>
              <div style={{ fontSize: "0.85rem" }}>
                {progress ? `${progress.completed} di ${progress.total} · ${progress.generated} generate · ${progress.errors} errori` : "Avvio…"}
              </div>
              <div style={{ height: 10, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                <div style={{ width: `${percent}%`, height: "100%", background: "linear-gradient(135deg, #d4c1aa, #b89a63)" }} />
              </div>
              {progress?.currentFile ? (
                <div style={{ fontSize: "0.78rem", opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {progress.currentFile}
                </div>
              ) : null}
              {progress?.outputRoots.map((root) => (
                <button
                  key={root}
                  type="button"
                  className="ghost-button"
                  style={{ padding: "0.4rem 0.7rem", fontSize: "0.8rem", textAlign: "left", justifyContent: "flex-start" }}
                  onClick={() => { void openImageConverterFolder(root); }}
                  title={root}
                >
                  Apri cartella: {root}
                </button>
              ))}
              {progress?.status === "error" && progress.error ? (
                <p role="alert" style={{ fontSize: "0.84rem", color: "#e0a75c", margin: 0 }}>{progress.error}</p>
              ) : null}
            </>
          )}
        </div>
        <div className="modal-panel__footer">
          {phase === "setup" ? (
            <>
              <button type="button" className="ghost-button" onClick={onClose}>Annulla</button>
              <button type="button" className="primary-button" disabled={inputPaths.length === 0} onClick={() => { void handleStart(); }}>
                Esporta {fileCount === 1 ? "1 foto" : `${fileCount} foto`}
              </button>
            </>
          ) : phase === "running" ? (
            <>
              <button type="button" className="ghost-button" onClick={() => { void handleCancel(); }}>
                Annulla esportazione
              </button>
            </>
          ) : (
            <>
              <button type="button" className="ghost-button" onClick={onClose}>Chiudi</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
