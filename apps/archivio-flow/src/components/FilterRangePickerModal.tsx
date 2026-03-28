import { useEffect, useMemo, useRef, useState } from "react";
import { DesktopPreviewImage } from "./DesktopPreviewImage";

export interface PreviewSampleFile {
  filePath: string;
  fileName: string;
  mtimeMs: number;
  size: number;
  ext: string;
  isJpg: boolean;
}

export interface ImportedRangeMarker {
  startMs: number;
  endMs: number;
  label: string;
}

interface Props {
  open: boolean;
  sdPath: string;
  samples: PreviewSampleFile[];
  importedRanges: ImportedRangeMarker[];
  onClose: () => void;
  onApplyRange: (startMs: number, endMs: number) => void;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "-";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${(bytes / 1e6).toFixed(0)} MB`;
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FilterRangePickerModal({
  open,
  sdPath,
  samples,
  importedRanges,
  onClose,
  onApplyRange,
}: Props) {
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const dragClientYRef = useRef<number | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const pointerDownIndexRef = useRef<number | null>(null);
  const pointerDragActivatedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setAnchorIndex(null);
      setFocusIndex(null);
      setIsDragging(false);
      dragClientYRef.current = null;
      pointerDownIndexRef.current = null;
      pointerDragActivatedRef.current = false;
      return;
    }

    function finishPointerInteraction() {
      setIsDragging(false);
      dragClientYRef.current = null;
      pointerDownIndexRef.current = null;
      pointerDragActivatedRef.current = false;
    }

    window.addEventListener("pointerup", finishPointerInteraction);
    window.addEventListener("pointercancel", finishPointerInteraction);
    return () => {
      window.removeEventListener("pointerup", finishPointerInteraction);
      window.removeEventListener("pointercancel", finishPointerInteraction);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !isDragging) {
      if (autoScrollFrameRef.current !== null) {
        cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
      return;
    }

    function tick() {
      const container = scrollContainerRef.current;
      const clientY = dragClientYRef.current;
      if (container && clientY !== null) {
        const rect = container.getBoundingClientRect();
        const threshold = 56;
        let delta = 0;

        if (clientY < rect.top + threshold) {
          delta = -Math.ceil(((rect.top + threshold - clientY) / threshold) * 18);
        } else if (clientY > rect.bottom - threshold) {
          delta = Math.ceil(((clientY - (rect.bottom - threshold)) / threshold) * 18);
        }

        if (delta !== 0) {
          container.scrollTop += delta;
        }
      }

      autoScrollFrameRef.current = requestAnimationFrame(tick);
    }

    autoScrollFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (autoScrollFrameRef.current !== null) {
        cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
    };
  }, [open, isDragging]);

  const range = useMemo(() => {
    if (anchorIndex === null || focusIndex === null) return null;
    const start = Math.min(anchorIndex, focusIndex);
    const end = Math.max(anchorIndex, focusIndex);
    return { start, end };
  }, [anchorIndex, focusIndex]);

  const selectedCount = range ? (range.end - range.start + 1) : 0;

  function clickSelect(index: number) {
    if (anchorIndex === null || (range !== null && selectedCount > 1)) {
      setAnchorIndex(index);
      setFocusIndex(index);
      return;
    }

    const start = Math.min(anchorIndex, index);
    const end = Math.max(anchorIndex, index);
    setAnchorIndex(start);
    setFocusIndex(end);
  }

  function beginPointerSelection(index: number, clientY: number) {
    pointerDownIndexRef.current = index;
    pointerDragActivatedRef.current = false;
    dragClientYRef.current = clientY;
  }

  function extendPointerSelection(index: number, clientY: number) {
    dragClientYRef.current = clientY;
    const pointerStartIndex = pointerDownIndexRef.current;
    if (pointerStartIndex === null) return;

    if (!pointerDragActivatedRef.current && index !== pointerStartIndex) {
      pointerDragActivatedRef.current = true;
      setAnchorIndex(pointerStartIndex);
      setFocusIndex(index);
      setIsDragging(true);
      return;
    }

    if (pointerDragActivatedRef.current) {
      setFocusIndex(index);
    }
  }

  function finalizePointerSelection(index: number) {
    const pointerStartIndex = pointerDownIndexRef.current;
    const didDrag = pointerDragActivatedRef.current;
    pointerDownIndexRef.current = null;
    pointerDragActivatedRef.current = false;
    dragClientYRef.current = null;
    setIsDragging(false);

    if (pointerStartIndex === null) return;
    if (!didDrag) {
      clickSelect(index);
    }
  }

  function resetSelection() {
    setAnchorIndex(null);
    setFocusIndex(null);
    setIsDragging(false);
    dragClientYRef.current = null;
    pointerDownIndexRef.current = null;
    pointerDragActivatedRef.current = false;
  }

  function isSelectedIndex(index: number): boolean {
    if (!range) return false;
    return index >= range.start && index <= range.end;
  }

  function isInImportedRange(ms: number): boolean {
    return importedRanges.some((r) => ms >= r.startMs && ms <= r.endMs);
  }

  function applySelection() {
    if (!range) return;
    const startMs = samples[range.start]?.mtimeMs;
    const endMs = samples[range.end]?.mtimeMs;
    if (typeof startMs !== "number" || typeof endMs !== "number") return;
    onApplyRange(startMs, endMs);
  }

  function cardLabel(index: number): string | null {
    if (!range) return null;
    if (index === range.start && index === range.end) return "INIZIO/FINE";
    if (index === range.start) return "INIZIO";
    if (index === range.end) return "FINE";
    return null;
  }

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(0,0,0,0.6)",
        display: "grid",
        placeItems: "center",
        padding: "1rem",
      }}
    >
      <div
        className="panel-section"
        style={{
          width: "min(1100px, 100%)",
          maxHeight: "90vh",
          overflow: "hidden",
          borderColor: "var(--line-strong)",
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
        }}
      >
        <div style={{ padding: "0.8rem 0.9rem", borderBottom: "1px solid var(--line)" }}>
          <strong>Selettore visuale range foto</strong>
          <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.86rem" }}>
            Clicca una foto per impostare l'inizio, clicca una seconda foto per impostare la fine, oppure trascina direttamente sulle anteprime. Il range verra usato per compilare automaticamente i filtri data/ora.
          </p>
        </div>

        <div
          ref={scrollContainerRef}
          style={{ overflowY: "auto", padding: "0.75rem" }}
          onPointerMove={(event) => {
            if (isDragging || pointerDownIndexRef.current !== null) {
              dragClientYRef.current = event.clientY;
            }
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: "0.55rem" }}>
            {samples.map((f, idx) => {
              const selected = isSelectedIndex(idx);
              const imported = isInImportedRange(f.mtimeMs);
              const marker = cardLabel(idx);
              return (
                <div
                  key={`${f.filePath}-${idx}`}
                  onPointerDown={(event) => beginPointerSelection(idx, event.clientY)}
                  onPointerEnter={(event) => extendPointerSelection(idx, event.clientY)}
                  onPointerUp={() => finalizePointerSelection(idx)}
                  style={{
                    border: selected
                      ? "1px solid var(--line-strong)"
                      : imported
                        ? "1px dashed rgba(212,163,156,0.75)"
                        : "1px solid var(--line)",
                    borderRadius: 10,
                    padding: "0.35rem",
                    background: selected ? "rgba(184,154,99,0.14)" : "rgba(0,0,0,0.18)",
                    cursor: "crosshair",
                    userSelect: "none",
                    position: "relative",
                  }}
                  title="Clicca o trascina per selezionare range"
                >
                  {marker && (
                    <div
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        zIndex: 1,
                        padding: "0.15rem 0.38rem",
                        borderRadius: 999,
                        background: "rgba(184,154,99,0.95)",
                        color: "#1f2421",
                        fontSize: "0.66rem",
                        fontWeight: 700,
                        letterSpacing: "0.02em",
                      }}
                    >
                      {marker}
                    </div>
                  )}
                  {f.isJpg ? (
                    <DesktopPreviewImage
                      sdPath={sdPath}
                      filePath={f.filePath}
                      alt={f.fileName}
                      style={{ width: "100%", height: 90, objectFit: "cover", borderRadius: 7, marginBottom: "0.35rem" }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        height: 90,
                        borderRadius: 7,
                        marginBottom: "0.35rem",
                        background: "rgba(255,255,255,0.05)",
                        display: "grid",
                        placeItems: "center",
                        color: "var(--text-muted)",
                        fontSize: "0.8rem",
                      }}
                    >
                      RAW {f.ext.toUpperCase()}
                    </div>
                  )}
                  <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", wordBreak: "break-all" }}>{f.fileName}</div>
                  <div style={{ fontSize: "0.74rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                    {formatBytes(f.size)} | {formatDateTime(f.mtimeMs)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div
          style={{
            padding: "0.7rem 0.9rem",
            borderTop: "1px solid var(--line)",
            display: "flex",
            justifyContent: "space-between",
            gap: "0.6rem",
            flexWrap: "wrap",
          }}
        >
          <div style={{ color: "var(--text-muted)", fontSize: "0.84rem" }}>
            {range
              ? `Range selezionato: ${formatDateTime(samples[range.start]!.mtimeMs)} -> ${formatDateTime(samples[range.end]!.mtimeMs)} · ${selectedCount} foto`
              : "Nessun range selezionato"}
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="ghost-button" onClick={resetSelection} style={{ padding: "0.45rem 0.8rem", fontSize: "0.84rem" }}>
              Azzera
            </button>
            <button className="ghost-button" onClick={onClose} style={{ padding: "0.45rem 0.8rem", fontSize: "0.84rem" }}>
              Chiudi
            </button>
            <button
              className="secondary-button"
              onClick={applySelection}
              disabled={!range}
              style={{ padding: "0.45rem 0.8rem", fontSize: "0.84rem" }}
            >
              Usa questo range
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
