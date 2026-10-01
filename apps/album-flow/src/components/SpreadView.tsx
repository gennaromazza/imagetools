import { type ReactNode, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AlbumAssetV2, AlbumItem, AlbumArea, AlbumSpread, SheetSpec } from "@photo-tools/shared-types";
import { dropHighlight, resolveDropTarget, type DropTarget } from "../engine/drop";
import { spreadSizeMm, type Divider, type LeafCell, type Rect } from "../engine/geometry";
import { useAssetSrc } from "../hooks/useAssetSrc";
import { previewDropRect } from "../model/items";
import { describeSize, placeItem, type ItemView } from "../model/placement";
import { areaGeometryFor, hasFreeLayout, type AreaGeometry } from "../model/project";
import { cropCenter } from "../slot-geometry";
import { PhotoBox } from "./PhotoBox";
import { currentDrag, endDrag, beginDrag } from "./dnd";
import { Icon } from "./icons";

export type SpreadVariant = "stage" | "thumb" | "present";

/** Modifiche provvisorie durante un gesto (separatore o inquadratura), prima del salvataggio nella cronologia. */
export type Draft =
  | { kind: "ratio"; areaIndex: number; path: string; ratio: number }
  | { kind: "view"; itemId: string; view: Partial<ItemView> }
  | { kind: "frame"; itemId: string; rect: Rect };

export interface SpreadViewProps {
  sheet: SheetSpec;
  spread: AlbumSpread;
  assets: ReadonlyMap<string, AlbumAssetV2>;
  variant: SpreadVariant;
  showGuides?: boolean;
  activeArea?: number;
  selectedItemId?: string | null;
  highlightItemId?: string | null;
  cropMode?: boolean;
  draft?: Draft | null;
  lowDpi?: number;
  /** Mostra su ogni foto la misura stampata (cm) e la risoluzione effettiva. */
  showSizes?: boolean;
  onActivateArea?: (areaIndex: number) => void;
  onSelectItem?: (itemId: string | null, areaIndex: number) => void;
  /** Tasto destro su una foto dello spread (la foto è già stata selezionata). */
  onContextItem?: (itemId: string, areaIndex: number, x: number, y: number) => void;
  onToggleCrop?: (itemId: string) => void;
  onDropAssets?: (target: DropTarget, assetIds: string[]) => void;
  onDropItem?: (target: DropTarget, itemId: string) => void;
  onDraft?: (draft: Draft | null) => void;
  onCommitRatio?: (areaIndex: number, path: string, ratio: number) => void;
  onResetRatio?: (areaIndex: number, path: string) => void;
  onCommitView?: (itemId: string, view: Partial<ItemView>) => void;
  /** Una foto di una disposizione libera è stata spostata o ridimensionata (frazioni dell'area utile). */
  onCommitFrame?: (itemId: string, frame: { x: number; y: number; w: number; h: number }) => void;
  /** Contenuto della barra che compare sulla foto selezionata. */
  renderToolbar?: (itemId: string) => ReactNode;
}

const pct = (value: number) => `${Number(value.toFixed(4))}%`;
const SNAPS = [0.5, 1 / 3, 2 / 3];

interface CellProps {
  cell: LeafCell;
  item: AlbumItem;
  asset: AlbumAssetV2 | undefined;
  area: AlbumArea;
  areaIndex: number;
  origin: Rect;
  variant: SpreadVariant;
  selected: boolean;
  highlighted: boolean;
  cropActive: boolean;
  view: Partial<ItemView> | null;
  lowDpi: number;
  showSizes: boolean;
  /** La disposizione dell'area è libera: la foto si sposta e si ridimensiona trascinandola. */
  free: boolean;
  handlers: Pick<SpreadViewProps, "onSelectItem" | "onContextItem" | "onToggleCrop" | "onDraft" | "onCommitView" | "renderToolbar"> & { onCommitFrameRect?: (itemId: string, rect: Rect) => void };
}

const Cell = memo(function Cell({ cell, item, asset, area, areaIndex, origin, variant, selected, highlighted, cropActive, view, lowDpi, showSizes, free, handlers }: CellProps) {
  // Lavorazione veloce: anteprime leggere; la qualità piena solo per la foto selezionata o in ritaglio e nell'anteprima cliente.
  const pixels = variant === "thumb" ? 200 : variant === "present" ? 2400 : selected || cropActive ? 1400 : 720;
  const src = useAssetSrc(asset, pixels);
  const placement = useMemo(() => placeItem(cell.rect, item, asset, area.style, view, cell.anchor), [cell.anchor, cell.rect, item, asset, area.style, view]);
  const interactive = variant === "stage";
  const ref = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const canCrop = selected && cropActive && !item.locked && area.style.mode === "fill";

  const contentRect = () => ref.current?.querySelector<HTMLElement>(".cell__content")?.getBoundingClientRect();

  // Zoom con la rotella durante il ritaglio: ascoltatore non passivo per bloccare lo scorrimento.
  const live = useRef({ zoom: item.zoom, view, canCrop, handlers, itemId: item.id });
  live.current = { zoom: view?.zoom ?? item.zoom, view, canCrop, handlers, itemId: item.id };
  useEffect(() => {
    const element = ref.current;
    if (!element || !interactive) return;
    const onWheel = (event: WheelEvent) => {
      const state = live.current;
      if (!state.canCrop) return;
      event.preventDefault();
      state.handlers.onCommitView?.(state.itemId, { zoom: Math.min(6, Math.max(1, state.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1))) });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [interactive]);

  const freeFrame = free && interactive && !item.locked;
  const frameDrag = useRef<{ mode: "move" | "resize"; x: number; y: number; rect: Rect; mmPerPx: number; moved: boolean } | null>(null);
  const startFrame = (event: React.PointerEvent, mode: "move" | "resize") => {
    const parent = ref.current?.parentElement?.getBoundingClientRect();
    if (!parent || parent.width === 0) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    frameDrag.current = { mode, x: event.clientX, y: event.clientY, rect: cell.rect, mmPerPx: origin.w / parent.width, moved: false };
    if (mode === "move") handlers.onSelectItem?.(item.id, areaIndex);
  };
  const frameRect = (event: React.PointerEvent): Rect | null => {
    const drag = frameDrag.current;
    if (!drag) return null;
    const dx = (event.clientX - drag.x) * drag.mmPerPx;
    const dy = (event.clientY - drag.y) * drag.mmPerPx;
    if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 2) drag.moved = true;
    if (drag.mode === "move") return { ...drag.rect, x: drag.rect.x + dx, y: drag.rect.y + dy };
    const w = Math.max(8, drag.rect.w + Math.max(dx, (dy * drag.rect.w) / drag.rect.h));
    return { ...drag.rect, w, h: (w * drag.rect.h) / drag.rect.w };
  };
  const moveFrame = (event: React.PointerEvent) => {
    const rect = frameRect(event);
    if (rect) handlers.onDraft?.({ kind: "frame", itemId: item.id, rect });
  };
  const endFrame = (event: React.PointerEvent) => {
    const drag = frameDrag.current;
    const rect = frameRect(event);
    frameDrag.current = null;
    handlers.onDraft?.(null);
    if (drag?.moved && rect) handlers.onCommitFrameRect?.(item.id, rect);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (freeFrame && !canCrop) { startFrame(event, "move"); return; }
    if (!canCrop) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const center = cropCenter(placement.crop);
    pan.current = { x: event.clientX, y: event.clientY, cx: center.x, cy: center.y };
  };
  const moved = (event: React.PointerEvent) => {
    const state = pan.current;
    const box = contentRect();
    if (!state || !box) return null;
    return {
      cx: state.cx - ((event.clientX - state.x) / box.width) * placement.crop.cropWidth,
      cy: state.cy - ((event.clientY - state.y) / box.height) * placement.crop.cropHeight,
    };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (frameDrag.current) { moveFrame(event); return; }
    const next = moved(event);
    if (next) handlers.onDraft?.({ kind: "view", itemId: item.id, view: next });
  };
  const onPointerUp = (event: React.PointerEvent) => {
    if (frameDrag.current) { endFrame(event); return; }
    const next = moved(event);
    pan.current = null;
    if (next) handlers.onCommitView?.(item.id, next);
  };

  const classes = [
    selected ? "cell--selected" : "",
    canCrop ? "cell--cropping" : "",
    item.locked ? "cell--locked" : "",
    freeFrame ? "cell--free" : "",
    highlighted ? "cell--flash" : "",
    interactive && placement.dpi < lowDpi ? "cell--lowres" : "",
  ].filter(Boolean).join(" ");

  return (
    <PhotoBox
      ref={ref}
      origin={origin}
      placement={placement}
      src={src}
      rotation={asset?.rotationDegrees}
      mono={area.style.mono}
      borderColor={area.style.borderColor}
      className={classes}
      style={cell.z !== undefined ? { zIndex: selected ? 30 : Math.min(25, Math.max(2, 10 + cell.z)), transform: cell.rotation ? `rotate(${cell.rotation}deg)` : undefined } : undefined}
      alt={asset?.fileName}
      data-item-id={item.id}
      data-asset-id={item.assetId}
      data-area-index={areaIndex}
      draggable={interactive && !canCrop && !item.locked && !freeFrame}
      onDragStart={(event) => beginDrag(event, { kind: "item", itemId: item.id })}
      onDragEnd={endDrag}
      onClick={(event) => { if (interactive) { event.stopPropagation(); handlers.onSelectItem?.(item.id, areaIndex); } }}
      onDoubleClick={(event) => { if (interactive) { event.stopPropagation(); handlers.onToggleCrop?.(item.id); } }}
      onContextMenu={(event) => { if (!interactive || !handlers.onContextItem) return; event.preventDefault(); event.stopPropagation(); handlers.onSelectItem?.(item.id, areaIndex); handlers.onContextItem(item.id, areaIndex, event.clientX, event.clientY); }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {freeFrame && selected && !canCrop ? <span className="cell__resize" title="Trascina per ridimensionare (le proporzioni restano)" onPointerDown={(event) => startFrame(event, "resize")} onPointerMove={moveFrame} onPointerUp={endFrame} /> : null}
      {interactive && selected ? <span className="cell__name">{asset?.fileName.replace(/\.[^.]+$/, "")}</span> : null}
      {interactive && item.locked ? <span className="cell__badge cell__badge--lock"><Icon name="lock" size={12} /></span> : null}
      {interactive && showSizes ? (() => { const size = describeSize(placement); return <span className={`cell__size cell__size--${size.level}`} title="Misura stampata della foto e risoluzione effettiva">{size.widthCm.toLocaleString("it-IT")} × {size.heightCm.toLocaleString("it-IT")} cm · {size.dpi} dpi</span>; })() : null}
      {interactive && !showSizes && placement.dpi < lowDpi ? <span className="cell__badge cell__badge--warn" title={`Risoluzione effettiva ${Math.round(placement.dpi)} dpi`}>{Math.round(placement.dpi)} dpi</span> : null}
    </PhotoBox>
  );
});

/** Barra della foto selezionata: vive sopra lo spread (non dentro la cella, che ritaglia) e resta sempre dentro i suoi bordi. */
function FloatingToolbar({ rect, size, container, children }: { rect: Rect; size: { width: number; height: number }; container: React.RefObject<HTMLDivElement | null>; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const element = container.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setTick((value) => value + 1));
    observer.observe(element);
    return () => observer.disconnect();
  }, [container]);
  useLayoutEffect(() => {
    const box = container.current?.getBoundingClientRect();
    const element = ref.current;
    if (!box || !element || box.width === 0) return;
    const k = box.width / size.width;
    const w = element.offsetWidth;
    const h = element.offsetHeight;
    const left = Math.min(Math.max(0, (rect.x + rect.w / 2) * k - w / 2), Math.max(0, box.width - w));
    const top = Math.min(Math.max(4, (rect.y + rect.h) * k - h - 26), Math.max(4, box.height - h - 4));
    setPos((previous) => (previous && Math.abs(previous.left - left) < 0.5 && Math.abs(previous.top - top) < 0.5 ? previous : { left, top }));
  }, [rect.x, rect.y, rect.w, rect.h, size.width, size.height, container, tick, children]);
  return (
    <div ref={ref} className="cell__toolbar spread__toolbar" style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} draggable onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}>
      {children}
    </div>
  );
}

function DividerHandle({ divider, areaIndex, size, toMm, onDraft, onCommit, onReset }: {
  divider: Divider;
  areaIndex: number;
  size: { width: number; height: number };
  toMm: (clientX: number, clientY: number) => { x: number; y: number };
  onDraft?: (draft: Draft | null) => void;
  onCommit?: (areaIndex: number, path: string, ratio: number) => void;
  onReset?: (areaIndex: number, path: string) => void;
}) {
  const [active, setActive] = useState(false);
  const ratioAt = (event: React.PointerEvent): number | null => {
    if (divider.span <= 0) return null;
    const point = toMm(event.clientX, event.clientY);
    const gap = divider.dir === "row" ? divider.line.w : divider.line.h;
    const position = divider.dir === "row" ? point.x : point.y;
    let ratio = (position - divider.start - gap / 2) / divider.span;
    if (!event.altKey) for (const snap of SNAPS) if (Math.abs(ratio - snap) < 0.014) ratio = snap;
    return Math.min(0.92, Math.max(0.08, ratio));
  };
  const rect = divider.nodeRect;
  const style = divider.dir === "row"
    ? { left: pct(((divider.line.x + divider.line.w / 2) / size.width) * 100), top: pct((rect.y / size.height) * 100), height: pct((rect.h / size.height) * 100), width: 0 }
    : { left: pct((rect.x / size.width) * 100), top: pct(((divider.line.y + divider.line.h / 2) / size.height) * 100), width: pct((rect.w / size.width) * 100), height: 0 };
  return (
    <div
      className={`divider divider--${divider.dir}${active ? " is-active" : ""}`}
      style={style}
      role="separator"
      aria-orientation={divider.dir === "row" ? "vertical" : "horizontal"}
      aria-label="Trascina per ridimensionare le foto"
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => { event.stopPropagation(); onReset?.(areaIndex, divider.path); }}
      onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); setActive(true); }}
      onPointerMove={(event) => { if (!active) return; const ratio = ratioAt(event); if (ratio !== null) onDraft?.({ kind: "ratio", areaIndex, path: divider.path, ratio }); }}
      onPointerUp={(event) => { if (!active) return; setActive(false); const ratio = ratioAt(event); onDraft?.(null); if (ratio !== null) onCommit?.(areaIndex, divider.path, ratio); }}
    >
      <span className="divider__bar" />
    </div>
  );
}

function SpreadViewInner(props: SpreadViewProps) {
  const { sheet, spread, assets, variant, showGuides = false, activeArea = 0, selectedItemId = null, highlightItemId = null, cropMode = false, draft = null, lowDpi = 150, showSizes = false } = props;
  const interactive = variant === "stage";
  const size = spreadSizeMm(sheet);
  const origin: Rect = useMemo(() => ({ x: 0, y: 0, w: size.width, h: size.height }), [size.width, size.height]);
  const ref = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState<{ target: DropTarget; rect: Rect } | null>(null);

  const overrides = useMemo(() => (draft?.kind === "ratio" ? { [draft.areaIndex]: { [draft.path]: draft.ratio } } : undefined), [draft]);
  const geometry: AreaGeometry[] = useMemo(() => spread.areas.map((_, index) => {
    const base = areaGeometryFor(sheet, spread, index, overrides?.[index]);
    return draft?.kind === "frame" && base.cells.some((cell) => cell.itemId === draft.itemId)
      ? { ...base, cells: base.cells.map((cell) => (cell.itemId === draft.itemId ? { ...cell, rect: draft.rect } : cell)) }
      : base;
  }), [sheet, spread, overrides, draft]);
  const latest = useRef({ geometry, onCommitFrame: props.onCommitFrame });
  latest.current = { geometry, onCommitFrame: props.onCommitFrame };
  const commitFrameRect = useCallback((itemId: string, rect: Rect) => {
    const entry = latest.current.geometry.find((g) => g.cells.some((cell) => cell.itemId === itemId));
    if (!entry) return;
    const { inner } = entry;
    latest.current.onCommitFrame?.(itemId, { x: (rect.x - inner.x) / inner.w, y: (rect.y - inner.y) / inner.h, w: rect.w / inner.w, h: rect.h / inner.h });
  }, []);


  const toMm = useCallback((clientX: number, clientY: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || box.width === 0) return { x: 0, y: 0 };
    return { x: ((clientX - box.left) / box.width) * size.width, y: ((clientY - box.top) / box.height) * size.height };
  }, [size.width, size.height]);

  const targetAt = useCallback((clientX: number, clientY: number): { target: DropTarget; rect: Rect } | null => {
    const point = toMm(clientX, clientY);
    const target = resolveDropTarget(geometry.map((g, index) => ({ rect: g.outer, cells: g.cells, dividers: g.dividers, free: hasFreeLayout(spread.areas[index]) })), point.x, point.y);
    if (!target) return null;
    const cell = target.itemId ? geometry[target.areaIndex].cells.find((candidate) => candidate.itemId === target.itemId)?.rect ?? null : null;
    const payload = currentDrag();
    const dragged = payload?.kind === "assets" ? { assetId: payload.assetIds[0] } : payload?.kind === "item"
      ? { assetId: spread.areas.flatMap((area) => area.items).find((item) => item.id === payload.itemId)?.assetId ?? "", itemId: payload.itemId }
      : null;
    // L'anteprima mostra dove finirà davvero la foto (con le sue proporzioni); ripiega sulla mezza cella.
    const preview = dragged?.assetId ? previewDropRect(sheet, spread, assets, target, dragged) : null;
    return { target, rect: preview ?? dropHighlight({ ...target, highlight: undefined }, cell, geometry[target.areaIndex].outer) };
  }, [geometry, toMm, sheet, spread, assets]);

  const handlers = useMemo(() => ({ onSelectItem: props.onSelectItem, onContextItem: props.onContextItem, onToggleCrop: props.onToggleCrop, onDraft: props.onDraft, onCommitView: props.onCommitView, renderToolbar: props.renderToolbar, onCommitFrameRect: commitFrameRect }),
    [props.onSelectItem, props.onContextItem, props.onToggleCrop, props.onDraft, props.onCommitView, props.renderToolbar, commitFrameRect]);

  const onDragOver = (event: React.DragEvent) => {
    const payload = currentDrag();
    if (!interactive || !payload || payload.kind === "spread") return;
    const found = targetAt(event.clientX, event.clientY);
    if (!found || (payload.kind === "item" && found.target.itemId === payload.itemId)) { setHint(null); return; }
    event.preventDefault();
    event.dataTransfer.dropEffect = payload.kind === "assets" ? "copy" : "move";
    setHint((previous) => (previous && previous.target.areaIndex === found.target.areaIndex && previous.target.itemId === found.target.itemId && previous.target.zone === found.target.zone && previous.target.node === found.target.node ? previous : found));
  };
  const onDrop = (event: React.DragEvent) => {
    const payload = currentDrag();
    if (!interactive || !payload || payload.kind === "spread") return;
    event.preventDefault();
    const found = targetAt(event.clientX, event.clientY);
    endDrag();
    setHint(null);
    if (!found) return;
    if (payload.kind === "assets") props.onDropAssets?.(found.target, payload.assetIds);
    else props.onDropItem?.(found.target, payload.itemId);
  };

  const page = size.width / 2;
  const margin = Math.max(0, sheet.marginCm * 10);

  return (
    <div
      ref={ref}
      className={`spread spread--${variant}${draft?.kind === "ratio" ? " is-resizing" : ""}`}
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
      onClick={() => { if (interactive) props.onSelectItem?.(null, activeArea); }}
      onDragOver={onDragOver}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setHint(null); }}
      onDrop={onDrop}
      data-spread-id={spread.id}
    >
      {spread.areas.map((area, areaIndex) => {
        const outer = geometry[areaIndex].outer;
        return <div key={`bg-${area.id}`} className="spread__area" style={{ left: pct(((outer.x - origin.x) / origin.w) * 100), top: pct(((outer.y - origin.y) / origin.h) * 100), width: pct((outer.w / origin.w) * 100), height: pct((outer.h / origin.h) * 100), background: area.style.background }} />;
      })}

      {spread.areas.map((area, areaIndex) => {
        const empty = area.items.length === 0;
        const inner = geometry[areaIndex].inner;
        return empty && variant !== "present" ? (
          <div
            key={`empty-${area.id}`}
            className={`spread__empty${activeArea === areaIndex && interactive ? " is-active" : ""}`}
            style={{ left: pct(((inner.x - origin.x) / origin.w) * 100), top: pct(((inner.y - origin.y) / origin.h) * 100), width: pct((inner.w / origin.w) * 100), height: pct((inner.h / origin.h) * 100) }}
            onClick={(event) => { if (interactive) { event.stopPropagation(); props.onActivateArea?.(areaIndex); props.onSelectItem?.(null, areaIndex); } }}
          >
            {interactive ? <span><Icon name="image" size={22} />Trascina qui le foto</span> : null}
          </div>
        ) : null;
      })}

      {spread.areas.map((area, areaIndex) =>
        geometry[areaIndex].cells.map((cell) => {
          const item = area.items.find((candidate) => candidate.id === cell.itemId);
          if (!item) return null;
          return (
            <Cell
              key={item.id}
              cell={cell}
              item={item}
              asset={assets.get(item.assetId)}
              area={area}
              areaIndex={areaIndex}
              origin={origin}
              variant={variant}
              selected={selectedItemId === item.id}
              highlighted={highlightItemId === item.id}
              cropActive={cropMode}
              view={draft?.kind === "view" && draft.itemId === item.id ? draft.view : null}
              lowDpi={lowDpi}
              showSizes={showSizes}
              free={hasFreeLayout(area)}
              handlers={handlers}
            />
          );
        }))}

      {interactive && selectedItemId && props.renderToolbar ? (() => {
        const rect = geometry.flatMap((g) => g.cells).find((cell) => cell.itemId === selectedItemId)?.rect;
        return rect ? <FloatingToolbar rect={rect} size={size} container={ref}>{props.renderToolbar(selectedItemId)}</FloatingToolbar> : null;
      })() : null}

      <div className="spread__fold" aria-hidden="true" />

      {interactive ? spread.areas.map((area, areaIndex) => geometry[areaIndex].dividers.map((divider) => (
        <DividerHandle key={`${area.id}-${divider.path}`} divider={divider} areaIndex={areaIndex} size={size} toMm={toMm} onDraft={props.onDraft} onCommit={props.onCommitRatio} onReset={props.onResetRatio} />
      ))) : null}

      {showGuides && interactive ? [0, 1].map((side) => (
        <div key={side} className="spread__safe" style={{ left: pct(((side * page + margin) / size.width) * 100), top: pct((margin / size.height) * 100), width: pct(((page - margin * 2) / size.width) * 100), height: pct(((size.height - margin * 2) / size.height) * 100) }} />
      )) : null}

      {interactive && spread.areas.length > 1 ? (() => {
        const outer = geometry[Math.min(activeArea, spread.areas.length - 1)].outer;
        return <div className="spread__active" style={{ left: pct((outer.x / size.width) * 100), top: pct((outer.y / size.height) * 100), width: pct((outer.w / size.width) * 100), height: pct((outer.h / size.height) * 100) }} />;
      })() : null}

      {hint ? <div className={`spread__hint spread__hint--${hint.target.zone}`} style={{ left: pct((hint.rect.x / size.width) * 100), top: pct((hint.rect.y / size.height) * 100), width: pct((hint.rect.w / size.width) * 100), height: pct((hint.rect.h / size.height) * 100) }} /> : null}
    </div>
  );
}

export const SpreadView = memo(SpreadViewInner);
