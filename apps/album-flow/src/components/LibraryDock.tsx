import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AlbumAssetTag, AlbumAssetV2, AlbumProjectV2, AlbumSortKey } from "@photo-tools/shared-types";
import { hasDesktop } from "../desktop/api";
import { useAssetSrc } from "../hooks/useAssetSrc";
import { useStableCallbacks } from "../hooks/useStableCallbacks";
import { assetsInTab, filterAssets, hoverPreviewSize, type AssetUsageRef, type LibraryTab } from "../model/library";
import { beginDrag, currentDrag, endDrag } from "./dnd";
import { Icon } from "./icons";
import { ContextMenu, Popover, Stars, type MenuItem } from "./ui";

const TAG_LABEL: Record<AlbumAssetTag, string> = { cover: "K", panorama: "P", main: "M" };
const TAG_NAME: Record<AlbumAssetTag, string> = { cover: "Copertina", panorama: "Panorama", main: "Principale" };
const SORT_LABELS: Record<AlbumSortKey, string> = { "capture-time": "Ora di scatto", "file-name": "Nome file", "selector-order": "Ordine di Image Select Pro", manual: "Ordine manuale" };
export const THUMB_MIN = 90;
export const THUMB_MAX = 260;

interface ThumbProps {
  asset: AlbumAssetV2;
  size: number;
  selected: boolean;
  uses: number;
  chapterColor: string | null;
  dropBefore: boolean;
  onPointer: (event: React.MouseEvent, asset: AlbumAssetV2) => void;
  onOpen: (asset: AlbumAssetV2) => void;
  onPlace: (asset: AlbumAssetV2) => void;
  onContext: (event: React.MouseEvent, asset: AlbumAssetV2) => void;
  onDragStart: (event: React.DragEvent, asset: AlbumAssetV2) => void;
  onDragOver: (event: React.DragEvent, asset: AlbumAssetV2) => void;
  onDrop: (event: React.DragEvent, asset: AlbumAssetV2) => void;
  onRate: (asset: AlbumAssetV2, rating: number) => void;
}

/** La foto intera, più grande, accanto alla miniatura (che la mostra in un riquadro fisso): compare dopo una breve sosta del mouse. */
function HoverPreview({ asset, anchor }: { asset: AlbumAssetV2; anchor: DOMRect }) {
  const src = useAssetSrc(asset, 720);
  const size = hoverPreviewSize(asset);
  const turned = asset.rotationDegrees === 90 || asset.rotationDegrees === 270;
  const margin = 10;
  const caption = 34;
  const boxW = size.width + 2;
  const boxH = size.height + caption;
  const left = Math.min(Math.max(margin, anchor.left + anchor.width / 2 - boxW / 2), Math.max(margin, window.innerWidth - boxW - margin));
  const above = anchor.top - boxH - margin;
  const top = above >= margin ? above : Math.min(anchor.bottom + margin, Math.max(margin, window.innerHeight - boxH - margin));
  return createPortal(
    <div className="thumb-preview" style={{ left, top, width: boxW }} role="img" aria-label={`Anteprima intera di ${asset.fileName}`}>
      <div className="thumb-preview__image" style={{ width: size.width, height: size.height }}>
        {src ? (
          <img src={src} alt="" draggable={false} style={{ width: turned ? size.height : size.width, height: turned ? size.width : size.height, transform: asset.rotationDegrees ? `rotate(${asset.rotationDegrees}deg)` : undefined }} />
        ) : <span className="thumb__ph" />}
      </div>
      <div className="thumb-preview__caption"><strong>{asset.fileName.replace(/\.[^.]+$/, "")}</strong>{asset.width > 0 ? <span>{asset.width} × {asset.height} px</span> : null}</div>
    </div>,
    document.body,
  );
}

const Thumb = memo(function Thumb({ asset, size, selected, uses, chapterColor, dropBefore, onPointer, onOpen, onPlace, onContext, onDragStart, onDragOver, onDrop, onRate }: ThumbProps) {
  const src = useAssetSrc(asset, Math.round(size * 1.5));
  const [hover, setHover] = useState<DOMRect | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const hide = useCallback(() => { window.clearTimeout(timer.current); setHover(null); }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!hover) return;
    // Scorrere la libreria o premere un tasto chiude l'anteprima: non deve restare a mezz'aria.
    window.addEventListener("wheel", hide, { passive: true, capture: true });
    window.addEventListener("keydown", hide, true);
    return () => { window.removeEventListener("wheel", hide, true); window.removeEventListener("keydown", hide, true); };
  }, [hover, hide]);
  return (
    <div
      onMouseEnter={(event) => { const element = event.currentTarget; window.clearTimeout(timer.current); timer.current = window.setTimeout(() => { if (!currentDrag()) setHover(element.getBoundingClientRect()); }, 450); }}
      onMouseLeave={hide}
      className={`thumb${selected ? " thumb--selected" : ""}${uses > 0 ? " thumb--used" : ""}${dropBefore ? " thumb--drop" : ""}`}
      style={{ width: size }}
      role="option"
      aria-selected={selected}
      data-asset-id={asset.id}
      draggable
      onDragStart={(event) => { hide(); onDragStart(event, asset); }}
      onDragEnd={endDrag}
      onDragOver={(event) => onDragOver(event, asset)}
      onDrop={(event) => onDrop(event, asset)}
      onClick={(event) => { hide(); onPointer(event, asset); }}
      onDoubleClick={() => onPlace(asset)}
      onContextMenu={(event) => onContext(event, asset)}
      title={`${asset.fileName}${asset.width > 0 ? ` · ${asset.width} × ${asset.height} px (${(asset.width * asset.height / 1e6).toFixed(1)} MP)` : ""}${uses ? ` · usata ${uses === 1 ? "una volta" : `${uses} volte`}` : " · non ancora usata"}`}
    >
      <div className="thumb__frame" style={{ height: Math.round(size * 0.75) }}>
        {src ? <img src={src} alt="" draggable={false} loading="lazy" /> : <span className="thumb__ph" />}
        {chapterColor ? <span className="thumb__chapter" style={{ background: chapterColor }} /> : null}
        {uses > 0 ? <span className="thumb__check" aria-label="Già usata nell'album">{uses > 1 ? uses : <Icon name="check" size={11} strokeWidth={2.6} />}</span> : null}
        {asset.albumTags?.length ? <span className="thumb__tags">{asset.albumTags.map((tag) => TAG_LABEL[tag]).join("")}</span> : null}
        <button type="button" className="thumb__view" aria-label="Guarda in grande (Spazio)" title="Guarda in grande (Spazio)" onClick={(event) => { event.stopPropagation(); onOpen(asset); }}><Icon name="eye" size={14} /></button>
      </div>
      {hover ? <HoverPreview asset={asset} anchor={hover} /> : null}
      <div className="thumb__meta">
        <span className="thumb__name">{asset.fileName.replace(/\.[^.]+$/, "")}</span>
        <Stars value={asset.rating} size={11} onChange={(rating) => onRate(asset, rating)} label={`Valutazione di ${asset.fileName}`} />
      </div>
    </div>
  );
});

export interface LibraryDockProps {
  project: AlbumProjectV2;
  usage: ReadonlyMap<string, AssetUsageRef[]>;
  selection: string[];
  onSelection: (ids: string[]) => void;
  tab: LibraryTab;
  onTab: (tab: LibraryTab) => void;
  thumbSize: number;
  onThumbSize: (size: number) => void;
  onFocusZone: () => void;
  onPlace: (assetIds: string[]) => void;
  onOpenViewer: (assetId: string, visibleIds: string[]) => void;
  onRate: (assetId: string, rating: number) => void;
  onAssign: (assetIds: string[], chapterId: string | null) => void;
  onImportFolder: () => void;
  onImportFiles: () => void;
  onReveal: (assetId: string) => void;
  onEdit: (assetId: string) => void;
  onCopyName: (assetIds: string[]) => void;
  onRemove: (assetIds: string[]) => void;
  onLocalize: (assetId: string) => void;
  onSetSort: (key: AlbumSortKey) => void;
  onReorder: (visibleIds: string[], movingIds: string[], beforeId: string | null) => void;
  onTag: (assetIds: string[], tag: AlbumAssetTag) => void;
  onManageChapters: () => void;
  onRemoveItem: (itemId: string) => void;
  onRateMany: (assetIds: string[], rating: number) => void;
  /** Quando è vero resta visibile solo la barra delle schede: più spazio allo spread. */
  collapsed: boolean;
  /** Fa scorrere la libreria fino a una foto (cambia `n` per ripetere la richiesta). */
  revealAsset?: { id: string; n: number } | null;
  onToggleCollapse: () => void;
  onSetRatingPolicy: (policy: "selector" | "project") => void;
  onClearRatings: () => void;
}

/** Libreria in basso: schede per capitolo, miniature con stelle e stato d'uso, ricerca, filtri, ordinamento, importazione. */
export const LibraryDock = memo(function LibraryDock(props: LibraryDockProps) {
  const { project, usage, selection, tab, thumbSize } = props;
  const [query, setQuery] = useState("");
  const [stars, setStars] = useState<"any" | "0" | "1" | "2" | "3" | "4" | "5">("any");
  const [atLeast, setAtLeast] = useState(false);
  const [labelId, setLabelId] = useState("");
  const [origin, setOrigin] = useState<"all" | "selector" | "manual">("all");
  const [usageFilter, setUsageFilter] = useState<"all" | "unused" | "used">("all");
  const filtersOn = (stars !== "any" ? 1 : 0) + (labelId ? 1 : 0) + (origin !== "all" ? 1 : 0) + (usageFilter === "used" ? 1 : 0);
  const resetFilters = () => { setStars("any"); setAtLeast(false); setLabelId(""); setOrigin("all"); setUsageFilter("all"); setQuery(""); };
  const [popover, setPopover] = useState<null | "filter" | "import" | "sort">(null);
  const [menu, setMenu] = useState<{ x: number; y: number; asset: AlbumAssetV2 } | null>(null);
  const [dropTab, setDropTab] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const revealN = props.revealAsset?.n;
  useEffect(() => {
    const id = props.revealAsset?.id;
    if (!id) return undefined;
    const timer = window.setTimeout(() => gridRef.current?.querySelector(`[data-asset-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealN]);
  const lastClicked = useRef<string | null>(null);
  const desktop = hasDesktop();

  const tabAssets = useMemo(() => assetsInTab(project, tab), [project, tab]);
  const visible = useMemo(() => filterAssets(project, tabAssets, { query, ...(stars === "any" ? {} : atLeast && stars !== "0" ? { minRating: Number(stars) } : { exactRating: Number(stars) }), labelId: labelId || undefined, origin, usage: usageFilter }), [project, tabAssets, query, stars, atLeast, labelId, origin, usageFilter]);
  const visibleIds = useMemo(() => visible.map((asset) => asset.id), [visible]);
  const chapterOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const chapter of project.chapters) for (const id of chapter.assetIds) map.set(id, chapter.color);
    return map;
  }, [project.chapters]);
  const unusedCount = useMemo(() => project.assets.filter((asset) => !usage.has(asset.id)).length, [project.assets, usage]);
  const unassignedCount = useMemo(() => project.assets.length - chapterOf.size, [project.assets.length, chapterOf]);
  const selected = useMemo(() => new Set(selection), [selection]);

  // Se la scheda scelta non esiste più (capitolo eliminato), si torna a «Tutte».
  useEffect(() => {
    if (tab !== "all" && tab !== "none" && !project.chapters.some((chapter) => chapter.id === tab)) props.onTab("all");
  }, [tab, project.chapters, props]);

  const select = useCallback((event: React.MouseEvent, asset: AlbumAssetV2) => {
    props.onFocusZone();
    if (event.shiftKey && lastClicked.current) {
      const from = visibleIds.indexOf(lastClicked.current);
      const to = visibleIds.indexOf(asset.id);
      if (from >= 0 && to >= 0) {
        const [a, b] = from < to ? [from, to] : [to, from];
        props.onSelection(Array.from(new Set([...selection, ...visibleIds.slice(a, b + 1)])));
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) props.onSelection(selected.has(asset.id) ? selection.filter((id) => id !== asset.id) : [...selection, asset.id]);
    else props.onSelection([asset.id]);
    lastClicked.current = asset.id;
  }, [props, selected, selection, visibleIds]);

  const dragStart = useCallback((event: React.DragEvent, asset: AlbumAssetV2) => {
    const ids = selected.has(asset.id) ? selection : [asset.id];
    if (!selected.has(asset.id)) props.onSelection([asset.id]);
    beginDrag(event, { kind: "assets", assetIds: ids });
  }, [props, selected, selection]);

  const columns = () => {
    const box = gridRef.current;
    if (!box) return 1;
    const first = box.querySelector<HTMLElement>(".thumb");
    if (!first) return 1;
    return Math.max(1, Math.floor((box.clientWidth + 10) / (first.offsetWidth + 10)));
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA") return;
    const index = selection.length ? visibleIds.indexOf(selection[selection.length - 1]) : -1;
    const move = (delta: number) => {
      event.preventDefault();
      event.stopPropagation();
      if (visibleIds.length === 0) return;
      const next = Math.min(visibleIds.length - 1, Math.max(0, (index < 0 ? 0 : index) + (index < 0 ? 0 : delta)));
      const id = visibleIds[next];
      props.onSelection(event.shiftKey ? Array.from(new Set([...selection, id])) : [id]);
      lastClicked.current = id;
      gridRef.current?.querySelector(`[data-asset-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
    };
    switch (event.key) {
      case "ArrowRight": move(1); return;
      case "ArrowLeft": move(-1); return;
      case "ArrowDown": move(columns()); return;
      case "ArrowUp": move(-columns()); return;
      case " ": if (selection.length) { event.preventDefault(); event.stopPropagation(); props.onOpenViewer(selection[selection.length - 1], visibleIds); } return;
      case "Enter": if (selection.length) { event.preventDefault(); event.stopPropagation(); props.onPlace(selection); } return;
      case "Escape": if (selection.length) { event.stopPropagation(); props.onSelection([]); } return;
      case "a": case "A": if (event.ctrlKey || event.metaKey) { event.preventDefault(); event.stopPropagation(); props.onSelection(visibleIds); } return;
      case "0": case "1": case "2": case "3": case "4": case "5":
        if (!event.ctrlKey && !event.metaKey && selection.length) { event.stopPropagation(); props.onRateMany(selection, Number(event.key)); }
        return;
      default:
    }
  };

  // Gestori con identità stabile: ogni miniatura si ridisegna solo se cambiano i suoi dati, non a ogni azione sulla libreria.
  const thumbHandlers = useStableCallbacks({
    onPointer: select,
    onOpen: (a: AlbumAssetV2) => props.onOpenViewer(a.id, visibleIds),
    onPlace: (a: AlbumAssetV2) => props.onPlace(selected.has(a.id) ? selection : [a.id]),
    onContext: (event: React.MouseEvent, a: AlbumAssetV2) => { event.preventDefault(); if (!selected.has(a.id)) props.onSelection([a.id]); props.onFocusZone(); setMenu({ x: event.clientX, y: event.clientY, asset: a }); },
    onDragStart: dragStart,
    onDragOver: (event: React.DragEvent, a: AlbumAssetV2) => { if (currentDrag()?.kind === "assets") { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropBefore(a.id); } },
    onDrop: (event: React.DragEvent, a: AlbumAssetV2) => {
      const payload = currentDrag();
      setDropBefore(null);
      if (payload?.kind !== "assets") return;
      event.preventDefault();
      endDrag();
      if (!payload.assetIds.includes(a.id)) props.onReorder(visibleIds, payload.assetIds, a.id);
    },
    onRate: (a: AlbumAssetV2, rating: number) => props.onRate(a.id, rating),
  });

  const menuItems = (asset: AlbumAssetV2): MenuItem[] => {
    const ids = selected.has(asset.id) ? selection : [asset.id];
    const many = ids.length > 1;
    const uses = usage.get(asset.id)?.length ?? 0;
    return [
      { label: "Guarda in grande", icon: "eye", hint: "Spazio", onClick: () => props.onOpenViewer(asset.id, visibleIds) },
      { label: many ? `Aggiungi ${ids.length} foto allo spread` : "Aggiungi allo spread", icon: "plus", hint: "Invio", onClick: () => props.onPlace(ids) },
      { label: "Mostra nello spread", icon: "image", disabled: uses === 0 || many, onClick: () => props.onLocalize(asset.id) },
      { separator: true, label: "-" },
      { label: "Modifica nell'editor", icon: "pencil", disabled: !desktop || !asset.absolutePath || many, onClick: () => props.onEdit(asset.id) },
      { label: "Apri la cartella", icon: "folder", disabled: !desktop || !asset.absolutePath || many, onClick: () => props.onReveal(asset.id) },
      { label: many ? `Copia i nomi dei ${ids.length} file` : "Copia il nome del file", icon: "copy", onClick: () => props.onCopyName(ids) },
      { separator: true, label: "-" },
      {
        label: "Sposta nel capitolo", icon: "tag",
        children: [
          { label: "Senza capitolo", onClick: () => props.onAssign(ids, null) },
          ...project.chapters.map((chapter) => ({ label: chapter.title, onClick: () => props.onAssign(ids, chapter.id) })),
          { separator: true, label: "-" },
          { label: "Gestisci i capitoli…", onClick: props.onManageChapters },
        ],
      },
      { label: "Valuta", icon: "star", children: [0, 1, 2, 3, 4, 5].map((rating) => ({ label: rating === 0 ? "Nessuna stella" : "★".repeat(rating), onClick: () => props.onRateMany(ids, rating) })) },
      { label: "Segna come", icon: "tag", children: (["cover", "panorama", "main"] as AlbumAssetTag[]).map((tag) => ({ label: `${TAG_NAME[tag]} (${TAG_LABEL[tag]})`, onClick: () => props.onTag(ids, tag) })) },
      { separator: true, label: "-" },
      { label: many ? `Rimuovi ${ids.length} foto dall'album` : "Rimuovi dall'album", icon: "trash", danger: true, onClick: () => props.onRemove(ids) },
    ];
  };

  const dropOnTab = (event: React.DragEvent, chapterId: string | null) => {
    const payload = currentDrag();
    setDropTab(null);
    if (payload?.kind !== "assets") return;
    event.preventDefault();
    event.stopPropagation();
    endDrag();
    props.onAssign(payload.assetIds, chapterId);
  };
  const tabDrag = (event: React.DragEvent, id: string) => {
    if (currentDrag()?.kind === "assets") { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTab(id); }
  };

  const tabButton = (id: LibraryTab, label: string, count: number, color: string | null, chapterId: string | null | undefined) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={tab === id}
      className={`dock__tab${tab === id ? " is-active" : ""}${dropTab === id ? " is-drop" : ""}`}
      style={color ? ({ "--tab-color": color } as React.CSSProperties) : undefined}
      onClick={() => { props.onTab(id); props.onFocusZone(); }}
      onDragOver={chapterId !== undefined ? (event) => tabDrag(event, id) : undefined}
      onDragLeave={() => setDropTab(null)}
      onDrop={chapterId !== undefined ? (event) => dropOnTab(event, chapterId) : undefined}
    >
      {color ? <i className="dock__dot" /> : null}
      <span>{label}</span>
      <em>{count}</em>
    </button>
  );

  return (
    <section
      className="dock"
      aria-label="Libreria foto"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDownCapture={props.onFocusZone}
      onDragOver={(event) => { if (currentDrag()?.kind === "item") { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
      onDrop={(event) => { const payload = currentDrag(); if (payload?.kind === "item") { event.preventDefault(); endDrag(); props.onRemoveItem(payload.itemId); } }}
    >
      <header className="dock__head">
        <div className="dock__tabs" role="tablist" aria-label="Capitoli">
          {tabButton("all", "Tutte", project.assets.length, null, undefined)}
          {project.chapters.map((chapter) => tabButton(chapter.id, chapter.title, chapter.assetIds.length, chapter.color, chapter.id))}
          {project.chapters.length > 0 && unassignedCount > 0 ? tabButton("none", "Senza capitolo", unassignedCount, null, null) : null}
          <button type="button" className="dock__add" onClick={props.onManageChapters} title="Gestisci i capitoli" aria-label="Gestisci i capitoli"><Icon name="plus" size={14} /> Capitolo</button>
        </div>
        <div className="dock__tools">
          <button type="button" className={`dock__unused${usageFilter === "unused" ? " is-active" : ""}`} onClick={() => setUsageFilter(usageFilter === "unused" ? "all" : "unused")} title="Mostra solo le foto non ancora usate" aria-pressed={usageFilter === "unused"}>
            {unusedCount > 0 ? <Icon name="warning" size={14} /> : <Icon name="check" size={14} />}
            {unusedCount} da usare
          </button>
          <div className="dock__zoom" title="Dimensione delle miniature">
            <button type="button" className="icon-btn icon-btn--sm" onClick={() => props.onThumbSize(Math.max(THUMB_MIN, thumbSize - 25))} aria-label="Miniature più piccole"><Icon name="minus" size={13} /></button>
            <input type="range" min={THUMB_MIN} max={THUMB_MAX} step={5} value={thumbSize} onChange={(event) => props.onThumbSize(Number(event.target.value))} aria-label="Dimensione delle miniature" />
            <button type="button" className="icon-btn icon-btn--sm" onClick={() => props.onThumbSize(Math.min(THUMB_MAX, thumbSize + 25))} aria-label="Miniature più grandi"><Icon name="plus" size={13} /></button>
          </div>
          <label className="dock__search"><Icon name="search" size={14} /><input type="search" placeholder="Cerca" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Cerca per nome file" /></label>
          <div className="anchor">
            <button type="button" className={`dock__unused${filtersOn ? " is-active" : ""}`} onClick={() => setPopover(popover === "filter" ? null : "filter")} title="Filtra per stelle, etichette, origine o uso" aria-label="Filtra"><Icon name="filter" size={14} /> Filtri{filtersOn ? ` (${filtersOn})` : ""}</button>
            <Popover open={popover === "filter"} onClose={() => setPopover(null)} side="top" className="popover--wide">
              <div className="popover__section">
                <span className="field__label">Stelle</span>
                <div className="segmented">
                  {([["any", "Tutte"], ["0", "Senza"], ["1", "★1"], ["2", "★2"], ["3", "★3"], ["4", "★4"], ["5", "★5"]] as const).map(([value, label]) => <button key={value} type="button" className={stars === value ? "is-active" : ""} aria-pressed={stars === value} onClick={() => setStars(value)}>{label}</button>)}
                </div>
                {stars !== "any" && stars !== "0" ? <label className="radio"><input type="checkbox" checked={atLeast} onChange={(event) => setAtLeast(event.target.checked)} /> Anche con più stelle (almeno ★{stars})</label> : null}
              </div>
              {project.assets.some((asset) => asset.selectionOrder !== undefined) ? (
                <div className="popover__section">
                  <span className="field__label">Origine</span>
                  <div className="segmented">
                    {([["all", "Tutte"], ["selector", "Scelte nel Selector"], ["manual", "Aggiunte qui"]] as const).map(([value, label]) => <button key={value} type="button" className={origin === value ? "is-active" : ""} onClick={() => setOrigin(value)}>{label}</button>)}
                  </div>
                </div>
              ) : null}
              {project.labels.length > 0 ? (
                <div className="popover__section">
                  <span className="field__label">Etichetta del Selector</span>
                  <select className="select select--sm" value={labelId} onChange={(event) => setLabelId(event.target.value)} aria-label="Etichetta">
                    <option value="">Tutte</option>
                    {project.labels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}
                  </select>
                </div>
              ) : null}
              <div className="popover__section">
                <span className="field__label">Uso</span>
                <div className="segmented">
                  {([["all", "Tutte"], ["unused", "Non usate"], ["used", "Usate"]] as const).map(([value, label]) => <button key={value} type="button" className={usageFilter === value ? "is-active" : ""} onClick={() => setUsageFilter(value)}>{label}</button>)}
                </div>
              </div>
              <div className="popover__section">
                <span className="field__label">Da dove vengono le stelle</span>
                <label className="radio"><input type="radio" name="rating-policy" checked={(project.settings.ratingPolicy ?? "selector") === "selector"} onChange={() => props.onSetRatingPolicy("selector")} /> Quelle di Image Select Pro (anche nei file XMP)</label>
                <label className="radio"><input type="radio" name="rating-policy" checked={project.settings.ratingPolicy === "project"} onChange={() => props.onSetRatingPolicy("project")} /> Solo di questo album (i file XMP non cambiano)</label>
                <button type="button" className="btn btn--sm" onClick={props.onClearRatings}>Azzera le stelle di questo album</button>
              </div>
              <button type="button" className="btn btn--sm" onClick={resetFilters}>Azzera i filtri</button>
            </Popover>
          </div>
          <div className="anchor">
            <button type="button" className="icon-btn" onClick={() => setPopover(popover === "sort" ? null : "sort")} title={`Ordina: ${SORT_LABELS[project.settings.sortKey]}`} aria-label="Ordina"><Icon name="sort" size={16} /></button>
            <Popover open={popover === "sort"} onClose={() => setPopover(null)} side="top" className="popover--wide">
              {(Object.keys(SORT_LABELS) as AlbumSortKey[]).map((key) => (
                <button key={key} type="button" className={`popover__row${project.settings.sortKey === key ? " is-active" : ""}`} onClick={() => { props.onSetSort(key); setPopover(null); }}>
                  {project.settings.sortKey === key ? <Icon name="check" size={14} /> : <span style={{ width: 14 }} />}{SORT_LABELS[key]}
                </button>
              ))}
              <p className="popover__hint">Trascina una foto tra le altre per ordinarla a mano.</p>
            </Popover>
          </div>
          <div className="anchor">
            <button type="button" className="dock__import" onClick={() => (desktop ? setPopover(popover === "import" ? null : "import") : props.onImportFiles())}><Icon name="import" size={15} /> Importa</button>
            <Popover open={popover === "import"} onClose={() => setPopover(null)} side="top">
              <button type="button" className="popover__row" onClick={() => { setPopover(null); props.onImportFolder(); }}><Icon name="folder" size={15} /> Una cartella…</button>
              <button type="button" className="popover__row" onClick={() => { setPopover(null); props.onImportFiles(); }}><Icon name="image" size={15} /> Singole foto…</button>
              <p className="popover__hint">Puoi anche trascinare foto o cartelle sulla finestra.</p>
            </Popover>
          </div>
          <button type="button" className="icon-btn" onClick={props.onToggleCollapse} title={props.collapsed ? "Mostra la libreria (Ctrl/⌘+J)" : "Nascondi la libreria (Ctrl/⌘+J)"} aria-label={props.collapsed ? "Mostra la libreria" : "Nascondi la libreria"} aria-expanded={!props.collapsed}><Icon name={props.collapsed ? "chevronUp" : "chevronDown"} size={16} /></button>
        </div>
      </header>

      {props.collapsed ? null : <div
        ref={gridRef}
        className="dock__grid"
        role="listbox"
        aria-multiselectable="true"
        aria-label="Foto"
        onClick={(event) => { if (event.target === event.currentTarget) props.onSelection([]); }}
        onDragLeave={() => setDropBefore(null)}
        style={{ "--thumb": `${thumbSize}px` } as React.CSSProperties}
      >
        {visible.map((asset) => (
          <Thumb
            key={asset.id}
            asset={asset}
            size={thumbSize}
            selected={selected.has(asset.id)}
            uses={usage.get(asset.id)?.length ?? 0}
            chapterColor={tab === "all" ? chapterOf.get(asset.id) ?? null : null}
            dropBefore={dropBefore === asset.id}
            {...thumbHandlers}
          />
        ))}
        {visible.length === 0 ? (
          <div className="dock__empty">
            {project.assets.length === 0 ? (
              <><Icon name="image" size={30} /><strong>Nessuna foto nella libreria</strong><span>Importa una cartella o trascina qui le foto. Puoi caricarne più di quante ne servono: poi scegli.</span><button type="button" className="btn btn--primary" onClick={() => (desktop ? props.onImportFolder() : props.onImportFiles())}>Importa foto</button></>
            ) : (
              <><Icon name="search" size={26} /><strong>Nessuna foto con questi filtri</strong><button type="button" className="btn btn--sm" onClick={resetFilters}>Azzera i filtri</button></>
            )}
          </div>
        ) : null}
      </div>}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.asset)} onClose={() => setMenu(null)} /> : null}
    </section>
  );
});
