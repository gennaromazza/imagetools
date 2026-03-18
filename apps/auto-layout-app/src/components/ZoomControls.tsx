import { memo, useCallback } from "react";

interface ZoomControlsProps {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  minZoom?: number;
  maxZoom?: number;
  step?: number;
}

const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

function ZoomOutIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M7 2.5a4.5 4.5 0 1 0 2.87 7.97l2.33 2.33.8-.8-2.33-2.33A4.5 4.5 0 0 0 7 2.5Zm0 1a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm-2 3h4v1H5v-1Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ZoomInIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M7 2.5a4.5 4.5 0 1 0 2.87 7.97l2.33 2.33.8-.8-2.33-2.33A4.5 4.5 0 0 0 7 2.5Zm0 1a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm-.5 1.5h1v2h2v1h-2v2h-1v-2h-2v-1h2v-2Z"
        fill="currentColor"
      />
    </svg>
  );
}

function FitIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M3 3h3v1H4v2H3V3Zm7 0h3v3h-1V4h-2V3ZM3 10h1v2h2v1H3v-3Zm9 0h1v3h-3v-1h2v-2ZM6 6h4v4H6V6Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ZoomControlsContent({
  zoom,
  onZoomChange,
  minZoom = 0.25,
  maxZoom = 4,
  step = 0.25
}: ZoomControlsProps) {
  const handleZoomIn = useCallback(() => {
    const newZoom = Math.min(zoom + step, maxZoom);
    onZoomChange(newZoom);
  }, [zoom, step, maxZoom, onZoomChange]);

  const handleZoomOut = useCallback(() => {
    const newZoom = Math.max(zoom - step, minZoom);
    onZoomChange(newZoom);
  }, [zoom, step, minZoom, onZoomChange]);

  const handleZoomToFit = useCallback(() => {
    onZoomChange(1);
  }, [onZoomChange]);

  const handleZoomSelect = useCallback((newZoom: number) => {
    onZoomChange(newZoom);
  }, [onZoomChange]);

  const canZoomIn = zoom < maxZoom;
  const canZoomOut = zoom > minZoom;

  return (
    <div className="zoom-controls" aria-label="Controlli zoom">
      <button
        type="button"
        className="zoom-button"
        onClick={handleZoomOut}
        disabled={!canZoomOut}
        aria-label="Riduci zoom"
        title="Riduci zoom (Ctrl+-)"
      >
        <ZoomOutIcon />
      </button>

      <select
        className="zoom-select"
        value={zoom}
        onChange={(event) => handleZoomSelect(Number(event.target.value))}
        aria-label="Livello zoom"
      >
        {ZOOM_LEVELS.map((level) => (
          <option key={level} value={level}>
            {Math.round(level * 100)}%
          </option>
        ))}
      </select>

      <button
        type="button"
        className="zoom-button"
        onClick={handleZoomIn}
        disabled={!canZoomIn}
        aria-label="Aumenta zoom"
        title="Aumenta zoom (Ctrl++)"
      >
        <ZoomInIcon />
      </button>

      <button
        type="button"
        className="zoom-button zoom-button--fit"
        onClick={handleZoomToFit}
        aria-label="Adatta alla finestra"
        title="Adatta alla finestra (Ctrl+0)"
      >
        <FitIcon />
      </button>
    </div>
  );
}

export const ZoomControls = memo(ZoomControlsContent);
ZoomControls.displayName = "ZoomControls";
