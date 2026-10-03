import { useEffect, useMemo, useRef, useState } from "react";
import type { AlbumAssetTag, AlbumAssetV2, AlbumProjectV2 } from "@photo-tools/shared-types";
import { hasDesktop } from "../desktop/api";
import { useAssetSrc } from "../hooks/useAssetSrc";
import type { AssetUsageRef } from "../model/library";
import { Icon } from "./icons";
import { IconButton, Stars } from "./ui";

const TAGS: Array<{ tag: AlbumAssetTag; label: string; key: string }> = [
  { tag: "cover", label: "Copertina", key: "K" },
  { tag: "panorama", label: "Panorama", key: "P" },
  { tag: "main", label: "Principale", key: "M" },
];

function formatTime(ms: number | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleString("it-IT", { weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export interface PhotoViewerProps {
  project: AlbumProjectV2;
  ids: string[];
  startIndex: number;
  usage: ReadonlyMap<string, AssetUsageRef[]>;
  onClose: () => void;
  onRate: (assetId: string, rating: number) => void;
  onPlace: (assetId: string) => void;
  onReveal: (assetId: string) => void;
  onEdit: (assetId: string) => void;
  onAssign: (assetId: string, chapterId: string | null) => void;
  onTag: (assetId: string, tag: AlbumAssetTag) => void;
  onIndex?: (assetId: string) => void;
}

const MAX_VIEW_ZOOM = 8;
const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Zoom e spostamento solo dell'anteprima: non toccano mai l'inquadratura nel foglio. */
interface PreviewView { zoom: number; x: number; y: number }

/** Vista grande di una foto (Spazio): frecce per scorrere, 0-5 per le stelle, Invio per metterla nel foglio. */
export function PhotoViewer(props: PhotoViewerProps) {
  const { project, ids, usage } = props;
  const [index, setIndex] = useState(Math.min(Math.max(props.startIndex, 0), Math.max(ids.length - 1, 0)));
  const byId = useMemo(() => new Map(project.assets.map((asset) => [asset.id, asset])), [project.assets]);
  const asset: AlbumAssetV2 | undefined = byId.get(ids[index]);
  const small = useAssetSrc(asset, 720);
  const large = useAssetSrc(asset, 2400);
  const desktop = hasDesktop();
  const [view, setView] = useState<PreviewView>({ zoom: 1, x: 0, y: 0 });
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
  }, [asset?.id === undefined]);
  // Ogni foto si apre intera.
  useEffect(() => { setView({ zoom: 1, x: 0, y: 0 }); }, [asset?.id]);

  const quarter = asset?.rotationDegrees === 90 || asset?.rotationDegrees === 270;
  const sourceAspect = asset && asset.aspectRatio > 0 ? asset.aspectRatio : asset && asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 1.5;
  const shownAspect = quarter ? 1 / sourceAspect : sourceAspect;
  // Dimensioni (px) della foto intera dentro l'area disponibile, come com'è ruotata sullo schermo.
  const fit = stage.width > 0 && stage.height > 0
    ? (shownAspect > stage.width / stage.height ? { w: stage.width, h: stage.width / shownAspect } : { w: stage.height * shownAspect, h: stage.height })
    : { w: 0, h: 0 };
  const limit = (zoom: number, x: number, y: number): PreviewView => {
    const maxX = Math.max(0, (fit.w * zoom - stage.width) / 2);
    const maxY = Math.max(0, (fit.h * zoom - stage.height) / 2);
    return { zoom, x: clampNumber(x, -maxX, maxX), y: clampNumber(y, -maxY, maxY) };
  };
  /** Cambia lo zoom tenendo fermo il punto indicato (relativo al centro dell'area). */
  const zoomTo = (next: number, anchor = { x: 0, y: 0 }) => setView((current) => {
    const zoom = clampNumber(next, 1, MAX_VIEW_ZOOM);
    if (zoom === 1) return { zoom: 1, x: 0, y: 0 };
    const ratio = zoom / current.zoom;
    return limit(zoom, anchor.x - (anchor.x - current.x) * ratio, anchor.y - (anchor.y - current.y) * ratio);
  });
  const actualSize = asset && fit.w > 0 ? Math.max(1, (quarter ? asset.height : asset.width) / (window.devicePixelRatio || 1) / fit.w) : 1;

  const move = (delta: number) => setIndex((value) => Math.min(ids.length - 1, Math.max(0, value + delta)));
  useEffect(() => { if (asset) props.onIndex?.(asset.id); }, [asset?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const stop = () => { event.preventDefault(); event.stopPropagation(); };
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape" || event.key === " ") { stop(); props.onClose(); }
      else if (event.key === "ArrowRight" || event.key === "ArrowDown") { stop(); move(1); }
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") { stop(); move(-1); }
      else if (event.key === "Home") { stop(); setIndex(0); }
      else if (event.key === "End") { stop(); setIndex(ids.length - 1); }
      else if (event.key === "+" || event.key === "=") { stop(); zoomTo(view.zoom * 1.25); }
      else if (event.key === "-" || event.key === "_") { stop(); zoomTo(view.zoom / 1.25); }
      else if (event.key === "Enter" && asset) { stop(); props.onPlace(asset.id); }
      else if (/^[0-5]$/.test(event.key) && asset) { stop(); props.onRate(asset.id, Number(event.key)); }
      else if (asset && "kpm".includes(event.key.toLowerCase()) && event.key.length === 1) { stop(); props.onTag(asset.id, event.key.toLowerCase() === "k" ? "cover" : event.key.toLowerCase() === "p" ? "panorama" : "main"); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (!asset) return null;
  const uses = usage.get(asset.id) ?? [];
  const chapter = project.chapters.find((candidate) => candidate.assetIds.includes(asset.id));
  const captured = formatTime(asset.captureTimeMs);
  const src = large || small;

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={`Anteprima di ${asset.fileName}`}>
      <header className="viewer__top">
        <div className="viewer__title">
          <strong>{asset.fileName}</strong>
          <span className="muted small">{index + 1} di {ids.length}{chapter ? ` · ${chapter.title}` : ""}{uses.length ? ` · nello spread ${uses.map((use) => use.spreadIndex + 1).join(", ")}` : " · non ancora usata"}</span>
        </div>
        <div className="viewer__zoom" role="group" aria-label="Zoom dell'anteprima (non cambia il foglio)">
          <IconButton icon="minus" label="Riduci (−)" onClick={() => zoomTo(view.zoom / 1.25)} disabled={view.zoom <= 1} size={16} />
          <button type="button" className="btn btn--sm" onClick={() => zoomTo(1)} title="Foto intera">{view.zoom === 1 ? "Intera" : `${Math.round(view.zoom * 100)}%`}</button>
          <IconButton icon="plus" label="Ingrandisci (+, o rotella)" onClick={() => zoomTo(view.zoom * 1.25)} disabled={view.zoom >= MAX_VIEW_ZOOM} size={16} />
          <button type="button" className="btn btn--sm" onClick={() => zoomTo(actualSize)} title="Pixel reali (1:1) per controllare la nitidezza">1:1</button>
        </div>
        <IconButton icon="close" label="Chiudi (Spazio)" onClick={props.onClose} />
      </header>

      <button type="button" className="viewer__nav viewer__nav--prev" onClick={() => move(-1)} disabled={index === 0} aria-label="Foto precedente"><Icon name="chevronLeft" size={34} /></button>
      <div
        ref={stageRef}
        className={`viewer__stage${view.zoom > 1 ? " is-zoomed" : ""}`}
        onClick={() => { if (justDragged.current) { justDragged.current = false; return; } props.onClose(); }}
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
            onDoubleClick={(event) => { event.stopPropagation(); const box = stageRef.current?.getBoundingClientRect(); zoomTo(view.zoom > 1 ? 1 : Math.max(2, actualSize), box ? { x: event.clientX - box.left - box.width / 2, y: event.clientY - box.top - box.height / 2 } : undefined); }}
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
      <button type="button" className="viewer__nav viewer__nav--next" onClick={() => move(1)} disabled={index >= ids.length - 1} aria-label="Foto successiva"><Icon name="chevronRight" size={34} /></button>

      <footer className="viewer__bottom">
        <div className="viewer__info">
          <Stars value={asset.rating} size={22} onChange={(rating) => props.onRate(asset.id, rating)} label="Valutazione" />
          <span className="muted small">{asset.width} × {asset.height} px{captured ? ` · ${captured}` : ""}</span>
        </div>
        <div className="viewer__actions">
          <select className="select select--sm" value={chapter?.id ?? ""} onChange={(event) => props.onAssign(asset.id, event.target.value || null)} aria-label="Capitolo">
            <option value="">Senza capitolo</option>
            {project.chapters.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
          </select>
          <div className="viewer__tags" role="group" aria-label="Segna la foto">
            {TAGS.map(({ tag, label, key }) => <button key={tag} type="button" className={`chip${asset.albumTags?.includes(tag) ? " is-active" : ""}`} onClick={() => props.onTag(asset.id, tag)} title={`${label} (${key})`}>{label}</button>)}
          </div>
          {desktop && asset.absolutePath ? <IconButton icon="folder" label="Mostra nella cartella" onClick={() => props.onReveal(asset.id)} /> : null}
          {desktop && asset.absolutePath ? <IconButton icon="pencil" label="Modifica nell'editor" onClick={() => props.onEdit(asset.id)} /> : null}
          <button type="button" className="btn btn--primary" onClick={() => props.onPlace(asset.id)}><Icon name="plus" size={15} /> Aggiungi allo spread <kbd>Invio</kbd></button>
        </div>
      </footer>
    </div>
  );
}
