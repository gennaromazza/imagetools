import { useEffect, useMemo, useState } from "react";
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

/** Vista grande di una foto (Spazio): frecce per scorrere, 0-5 per le stelle, Invio per metterla nel foglio. */
export function PhotoViewer(props: PhotoViewerProps) {
  const { project, ids, usage } = props;
  const [index, setIndex] = useState(Math.min(Math.max(props.startIndex, 0), Math.max(ids.length - 1, 0)));
  const byId = useMemo(() => new Map(project.assets.map((asset) => [asset.id, asset])), [project.assets]);
  const asset: AlbumAssetV2 | undefined = byId.get(ids[index]);
  const small = useAssetSrc(asset, 720);
  const large = useAssetSrc(asset, 2400);
  const desktop = hasDesktop();

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
        <IconButton icon="close" label="Chiudi (Spazio)" onClick={props.onClose} />
      </header>

      <button type="button" className="viewer__nav viewer__nav--prev" onClick={() => move(-1)} disabled={index === 0} aria-label="Foto precedente"><Icon name="chevronLeft" size={34} /></button>
      <div className="viewer__stage" onClick={props.onClose}>
        {src ? <img src={src} alt={asset.fileName} draggable={false} style={asset.rotationDegrees ? { transform: `rotate(${asset.rotationDegrees}deg)` } : undefined} onClick={(event) => event.stopPropagation()} /> : <span className="viewer__loading">Caricamento…</span>}
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
