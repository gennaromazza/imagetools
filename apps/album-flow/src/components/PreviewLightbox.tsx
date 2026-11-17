import { useEffect, useRef, useState } from "react";
import type { AlbumAssetV2 } from "@photo-tools/shared-types";
import { useAssetSrc } from "../hooks/useAssetSrc";
import { Icon } from "./icons";
import { IconButton } from "./ui";

const MAX_ZOOM = 8;
const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

interface View { zoom: number; x: number; y: number }

/**
 * Una foto dell'anteprima per il cliente a tutto schermo, con zoom. Solo guardare: niente stelle, capitoli né modifiche.
 * Tutto si fa anche con le icone (zoom +/−, «Intera», frecce, chiudi); la tastiera e la rotella sono scorciatoie in più.
 */
export function PreviewLightbox({ assets, startIndex, onClose }: { assets: readonly AlbumAssetV2[]; startIndex: number; onClose: () => void }) {
  const [index, setIndex] = useState(Math.min(Math.max(startIndex, 0), Math.max(assets.length - 1, 0)));
  const asset = assets[index];
  const small = useAssetSrc(asset, 720);
  const large = useAssetSrc(asset, 2400);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);

  useEffect(() => {
    const element = stageRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setStage({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setView({ zoom: 1, x: 0, y: 0 }); }, [asset?.id]);

  const quarter = asset?.rotationDegrees === 90 || asset?.rotationDegrees === 270;
  const sourceAspect = asset && asset.aspectRatio > 0 ? asset.aspectRatio : asset && asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 1.5;
  const shownAspect = quarter ? 1 / sourceAspect : sourceAspect;
  const fit = stage.width > 0 && stage.height > 0
    ? (shownAspect > stage.width / stage.height ? { w: stage.width, h: stage.width / shownAspect } : { w: stage.height * shownAspect, h: stage.height })
    : { w: 0, h: 0 };
  const limit = (zoom: number, x: number, y: number): View => {
    const maxX = Math.max(0, (fit.w * zoom - stage.width) / 2);
    const maxY = Math.max(0, (fit.h * zoom - stage.height) / 2);
    return { zoom, x: clampNumber(x, -maxX, maxX), y: clampNumber(y, -maxY, maxY) };
  };
  /** Cambia lo zoom tenendo fermo il punto indicato (relativo al centro dell'area). */
  const zoomTo = (next: number, anchor = { x: 0, y: 0 }) => setView((current) => {
    const zoom = clampNumber(next, 1, MAX_ZOOM);
    if (zoom === 1) return { zoom: 1, x: 0, y: 0 };
    const ratio = zoom / current.zoom;
    return limit(zoom, anchor.x - (anchor.x - current.x) * ratio, anchor.y - (anchor.y - current.y) * ratio);
  });
  const move = (delta: number) => setIndex((value) => Math.min(assets.length - 1, Math.max(0, value + delta)));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const stop = () => { event.preventDefault(); event.stopPropagation(); };
      if (event.key === "Escape") { stop(); onClose(); }
      else if (event.key === "ArrowRight" || event.key === "ArrowDown") { stop(); move(1); }
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") { stop(); move(-1); }
      else if (event.key === "+" || event.key === "=") { stop(); zoomTo(view.zoom * 1.25); }
      else if (event.key === "-" || event.key === "_") { stop(); zoomTo(view.zoom / 1.25); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (!asset) return null;
  const src = large || small;

  return (
    <div className="viewer viewer--over" role="dialog" aria-modal="true" aria-label={`Foto ingrandita: ${asset.fileName}`}>
      <header className="viewer__top">
        <div className="viewer__title">
          <strong>{asset.fileName}</strong>
          <span className="muted small">{index + 1} di {assets.length} in questo spread</span>
        </div>
        <div className="viewer__zoom" role="group" aria-label="Zoom della foto">
          <IconButton icon="minus" label="Riduci" onClick={() => zoomTo(view.zoom / 1.25)} disabled={view.zoom <= 1} size={16} />
          <button type="button" className="btn btn--sm" onClick={() => zoomTo(1)} title="Mostra la foto intera">{view.zoom === 1 ? "Intera" : `${Math.round(view.zoom * 100)}%`}</button>
          <IconButton icon="plus" label="Ingrandisci" onClick={() => zoomTo(view.zoom * 1.25)} disabled={view.zoom >= MAX_ZOOM} size={16} />
        </div>
        <IconButton icon="close" label="Chiudi e torna all'anteprima" onClick={onClose} />
      </header>

      <button type="button" className="viewer__nav viewer__nav--prev" onClick={() => move(-1)} disabled={index === 0} aria-label="Foto precedente"><Icon name="chevronLeft" size={34} /></button>
      <div
        ref={stageRef}
        className={`viewer__stage${view.zoom > 1 ? " is-zoomed" : ""}`}
        onClick={() => { if (justDragged.current) { justDragged.current = false; return; } onClose(); }}
        onWheel={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          zoomTo(view.zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15), { x: event.clientX - box.left - box.width / 2, y: event.clientY - box.top - box.height / 2 });
        }}
      >
        {src && fit.w > 0 ? (
          <img
            src={src}
            alt={asset.fileName}
            draggable={false}
            style={{
              width: (quarter ? fit.h : fit.w) * view.zoom,
              height: (quarter ? fit.w : fit.h) * view.zoom,
              left: stage.width / 2 + view.x - ((quarter ? fit.h : fit.w) * view.zoom) / 2,
              top: stage.height / 2 + view.y - ((quarter ? fit.w : fit.h) * view.zoom) / 2,
              transform: asset.rotationDegrees ? `rotate(${asset.rotationDegrees}deg)` : undefined,
            }}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => { event.stopPropagation(); const box = stageRef.current?.getBoundingClientRect(); zoomTo(view.zoom > 1 ? 1 : 2.5, box ? { x: event.clientX - box.left - box.width / 2, y: event.clientY - box.top - box.height / 2 } : undefined); }}
            onPointerDown={(event) => {
              if (view.zoom <= 1) return;
              event.preventDefault();
              (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
              drag.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y, moved: false };
            }}
            onPointerMove={(event) => {
              const state = drag.current;
              if (!state) return;
              if (Math.abs(event.clientX - state.x) + Math.abs(event.clientY - state.y) > 3) state.moved = true;
              setView((current) => limit(current.zoom, state.vx + event.clientX - state.x, state.vy + event.clientY - state.y));
            }}
            onPointerUp={() => { if (drag.current?.moved) justDragged.current = true; drag.current = null; }}
          />
        ) : <span className="viewer__loading">Carico la foto…</span>}
      </div>
      <button type="button" className="viewer__nav viewer__nav--next" onClick={() => move(1)} disabled={index >= assets.length - 1} aria-label="Foto successiva"><Icon name="chevronRight" size={34} /></button>
    </div>
  );
}
