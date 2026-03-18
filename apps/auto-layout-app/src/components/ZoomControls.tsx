import { memo, useCallback } from "react";

interface ZoomControlsProps {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  minZoom?: number;
  maxZoom?: number;
  step?: number;
}

const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

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
    <div className="zoom-controls">
      <button
        type="button"
        className="zoom-button"
        onClick={handleZoomOut}
        disabled={!canZoomOut}
        aria-label="Zoom indietro"
        title="Zoom indietro (Ctrl+-)"
      >
        🔍-
      </button>

      <select
        className="zoom-select"
        value={zoom}
        onChange={(e) => handleZoomSelect(Number(e.target.value))}
        aria-label="Livello zoom"
      >
        {ZOOM_LEVELS.map(level => (
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
        aria-label="Zoom avanti"
        title="Zoom avanti (Ctrl++)"
      >
        🔍+
      </button>

      <button
        type="button"
        className="zoom-button zoom-button--fit"
        onClick={handleZoomToFit}
        aria-label="Adatta alla finestra"
        title="Adatta alla finestra (Ctrl+0)"
      >
        📐
      </button>
    </div>
  );
}

export const ZoomControls = memo(ZoomControlsContent);
ZoomControls.displayName = "ZoomControls";