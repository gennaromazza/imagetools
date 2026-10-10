import { createPortal } from "react-dom";
import { snapMove, snapResize, type SnapGuide } from "../engine/snap";
import { getSnapEnabled } from "../model/snapSettings";
import { type ReactNode, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AlbumAssetV2, AlbumItem, AlbumArea, AlbumSpread, SheetSpec } from "@photo-tools/shared-types";
import { dropHighlight, resolveDropTarget, type DropTarget } from "../engine/drop";
import { spreadSizeMm, type Divider, type LeafCell, type Rect } from "../engine/geometry";
import { useAssetSrc } from "../hooks/useAssetSrc";
import { previewDropRect } from "../model/items";
import { angleFromLine, clampAngle, describeSize, itemBorderColor, nextWheelZoom, placeItem, toolbarModeFor, wheelNotches, type ItemView } from "../model/placement";
import { mediaIdsOfSpread } from "../model/design";
import { useMediaUrls } from "../hooks/useMedia";
import { BackgroundLayer, OverlayLayer, type DesignHandlers } from "./DesignLayers";
import { areaGeometryFor, hasFreeLayout, needsShapeAlignment, placementStyle, type AreaGeometry } from "../model/project";
import { cropCenter } from "../slot-geometry";
import { PhotoBox } from "./PhotoBox";
import { currentDrag, endDrag, beginDrag } from "./dnd";
import { Icon } from "./icons";

export type SpreadVariant = "stage" | "thumb" | "present";

/** Modifiche provvisorie durante un gesto (separatore o inquadratura), prima del salvataggio nella cronologia. */
export type Draft =
  | { kind: "ratio"; areaIndex: number; path: string; ratio: number }
  | { kind: "view"; itemId: string; view: Partial<ItemView> }
  | { kind: "frame"; itemId: string; rect: Rect; guides?: SnapGuide[] };

export interface SpreadViewProps {
  sheet: SheetSpec;
  spread: AlbumSpread;
  assets: ReadonlyMap<string, AlbumAssetV2>;
  variant: SpreadVariant;
  showGuides?: boolean;
  activeArea?: number;
  /** Dove finirà il prossimo testo: segnaposto sul foglio finché il pannello «Personalizza» è aperto e nessun testo è selezionato (fraz. dello spread). */
  insertMarker?: { x: number; y: number; label: string };
  selectedItemId?: string | null;
  highlightItemId?: string | null;
  /** Foto aggiunte alla selezione con Maiusc+clic (per azioni su più foto, come aprirle nell'editor). */
  pickedItemIds?: readonly string[];
  /** Maiusc+clic su una foto: la aggiunge o la toglie dalla selezione multipla. */
  onTogglePick?: (itemId: string, areaIndex: number) => void;
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
  /** Lo strumento «linea» del raddrizzamento è acceso: la foto selezionata si raddrizza tracciandovi sopra una linea. */
  straightenTool?: boolean;
  /** Il gesto dello strumento «linea» è finito (con o senza linea valida): lo strumento si spegne. */
  onStraightenDone?: () => void;
  /** Selezione e modifica di testi e grafiche (solo nell'area di lavoro). */
  design?: DesignHandlers;
  /** Con il pannello «Personalizza» aperto le foto non si selezionano né si spostano: si lavora solo su testi e grafiche. */
  photosLocked?: boolean;
  /** Una foto di una disposizione libera è stata spostata o ridimensionata (frazioni dell'area utile). */
  onCommitFrame?: (itemId: string, frame: { x: number; y: number; w: number; h: number }) => void;
  /** Contenuto della barra che compare sulla foto selezionata. */
  renderToolbar?: (itemId: string) => ToolbarParts | null;
}

const pct = (value: number) => `${Number(value.toFixed(4))}%`;
const SNAPS = [0.5, 1 / 3, 2 / 3];
/** Distanza (pixel sullo schermo) entro cui una foto si aggancia alle altre durante lo spostamento. */
const SNAP_PX = 6;
/** Le foto delle disposizioni libere si agganciano da più vicino e ai soli bordi: lo spostamento resta fluido. */
const FRAME_SNAP_PX = 4;

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
  /** Fa parte della selezione multipla (Maiusc+clic). */
  picked: boolean;
  cropActive: boolean;
  view: Partial<ItemView> | null;
  lowDpi: number;
  showSizes: boolean;
  /** La disposizione dell'area è libera: la foto si sposta e si ridimensiona trascinandola. */
  free: boolean;
  /** Rettangoli a cui la foto si aggancia spostandola (altre foto, bordi e centro dell'area, piega); solo nelle disposizioni libere. */
  snapTargets?: Array<{ id: string; rect: Rect }>;
  /** Lo strumento «linea» del raddrizzamento è acceso per questa foto. */
  lineTool: boolean;
  handlers: Pick<SpreadViewProps, "onSelectItem" | "onTogglePick" | "onContextItem" | "onToggleCrop" | "onDraft" | "onCommitView" | "renderToolbar" | "onStraightenDone"> & { onCommitFrameRect?: (itemId: string, rect: Rect) => void };
}

const Cell = memo(function Cell({ cell, item, asset, area, areaIndex, origin, variant, selected, highlighted, picked, cropActive, view, lowDpi, showSizes, free, snapTargets, lineTool, handlers }: CellProps) {
  // Lavorazione veloce: anteprime leggere; la qualità piena solo per la foto selezionata o in ritaglio e nell'anteprima cliente.
  const pixels = variant === "thumb" ? 200 : variant === "present" ? 2400 : selected || cropActive ? 1400 : 720;
  const src = useAssetSrc(asset, pixels);
  const style = useMemo(() => placementStyle(area, cell), [area, cell]);
  const placement = useMemo(() => placeItem(cell.rect, item, asset, style, view, cell.anchor), [cell.anchor, cell.rect, item, asset, style, view]);
  const interactive = variant === "stage";
  const ref = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const canCrop = selected && cropActive && !item.locked;

  const contentRect = () => ref.current?.querySelector<HTMLElement>(".cell__content")?.getBoundingClientRect();

  // Rotella: ascoltatore non passivo per bloccare lo scorrimento.
  // In ritaglio la rotella zooma e con Alt raddrizza (0,5° a scatto, 0,1° con Maiusc).
  // Fuori dal ritaglio, sulla cella: Alt + rotella zooma, Ctrl/⌘ + Alt + rotella raddrizza (stessi scatti).
  const canAdjust = !item.locked;
  const stored = view?.zoom ?? item.zoom;
  const live = useRef({ zoom: placement.zoom, stored, angle: placement.angle, view, canCrop, canAdjust, handlers, itemId: item.id, lineTool });
  live.current = { zoom: placement.zoom, stored, angle: placement.angle, view, canCrop, canAdjust, handlers, itemId: item.id, lineTool };
  useEffect(() => {
    const element = ref.current;
    if (!element || !interactive) return;
    const onWheel = (event: WheelEvent) => {
      const state = live.current;
      const quick = !state.canCrop && state.canAdjust && event.altKey;
      if (!state.canCrop && !quick) return;
      event.preventDefault();
      // In ritaglio: Ctrl/⌘ o Alt + rotella (e la sola rotella con lo strumento «linea» acceso) raddrizzano; la rotella semplice zooma.
      const rotate = state.canCrop ? event.altKey || event.ctrlKey || event.metaKey || state.lineTool : event.ctrlKey || event.metaKey;
      if (rotate) {
        const delta = event.deltaY || event.deltaX;
        const direction = delta < 0 ? -1 : 1;
        const angle = clampAngle(state.angle + direction * (event.shiftKey ? 0.1 : 0.5) * wheelNotches(delta));
        state.angle = angle; // gli scatti veloci della rotella si sommano anche prima del ridisegno
        state.handlers.onCommitView?.(state.itemId, { angle });
        return;
      }
      const zoom = nextWheelZoom(state.stored, state.zoom, event.deltaY < 0, wheelNotches(event.deltaY));
      state.stored = zoom; // come per il raddrizzamento: gli scatti veloci si sommano anche prima del ridisegno
      state.zoom = zoom;
      state.handlers.onCommitView?.(state.itemId, { zoom });
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
  const snapGuides = useRef<SnapGuide[]>([]);
  const frameRect = (event: React.PointerEvent): Rect | null => {
    const drag = frameDrag.current;
    snapGuides.current = [];
    if (!drag) return null;
    const dx = (event.clientX - drag.x) * drag.mmPerPx;
    const dy = (event.clientY - drag.y) * drag.mmPerPx;
    if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 2) drag.moved = true;
    const raw: Rect = drag.mode === "move"
      ? { ...drag.rect, x: drag.rect.x + dx, y: drag.rect.y + dy }
      : (() => { const w = Math.max(8, drag.rect.w + Math.max(dx, (dy * drag.rect.w) / drag.rect.h)); return { ...drag.rect, w, h: (w * drag.rect.h) / drag.rect.w }; })();
    // Aggancio come negli editor grafici: bordi e centri si attaccano a quelli delle altre foto e dell'area, con una linea guida. Alt = senza aggancio.
    if (event.altKey || !snapTargets || !getSnapEnabled()) return raw;
    const targets = snapTargets.filter((target) => target.id !== item.id).map((target) => target.rect);
    const snapped = drag.mode === "move" ? snapMove(raw, targets, FRAME_SNAP_PX * drag.mmPerPx, { targetCenters: false }) : snapResize(raw, targets, FRAME_SNAP_PX * drag.mmPerPx);
    snapGuides.current = snapped.guides;
    return snapped.rect;
  };
  const moveFrame = (event: React.PointerEvent) => {
    const rect = frameRect(event);
    if (rect) handlers.onDraft?.({ kind: "frame", itemId: item.id, rect, guides: snapGuides.current });
  };
  const endFrame = (event: React.PointerEvent) => {
    const drag = frameDrag.current;
    const rect = frameRect(event);
    frameDrag.current = null;
    handlers.onDraft?.(null);
    if (drag?.moved && rect) handlers.onCommitFrameRect?.(item.id, rect);
  };

  // Strumento «linea»: si traccia una linea sullo schermo lungo l'orizzonte (o un lato che deve essere verticale) e la foto si raddrizza di conseguenza.
  const lineActive = canCrop && lineTool;
  const [line, setLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const lineRef = useRef<typeof line>(null);
  const startLine = (event: React.PointerEvent) => {
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    lineRef.current = { x1: event.clientX, y1: event.clientY, x2: event.clientX, y2: event.clientY };
    setLine(lineRef.current);
  };
  const moveLine = (event: React.PointerEvent) => {
    if (!lineRef.current) return;
    lineRef.current = { ...lineRef.current, x2: event.clientX, y2: event.clientY };
    setLine(lineRef.current);
  };
  const endLine = (event: React.PointerEvent) => {
    const drawn = lineRef.current;
    lineRef.current = null;
    setLine(null);
    if (!drawn) return;
    const dx = event.clientX - drawn.x1;
    const dy = event.clientY - drawn.y1;
    if (lineActive && Math.hypot(dx, dy) >= 12) {
      // la linea in riferimento alla cornice: una cornice libera può essere ruotata
      const rad = ((cell.rotation ?? 0) * Math.PI) / 180;
      const local = { x: dx * Math.cos(rad) + dy * Math.sin(rad), y: -dx * Math.sin(rad) + dy * Math.cos(rad) };
      const angle = angleFromLine({ x: 0, y: 0 }, local, placement.angle);
      if (angle !== null) handlers.onCommitView?.(item.id, { angle });
    }
    handlers.onStraightenDone?.();
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (lineActive) { startLine(event); return; }
    // Alt + trascinamento (come in AlbumTeller): riposiziona la foto nella cella senza aprire il ritaglio, così come Alt + rotella la ingrandisce.
    const quickPan = event.altKey && !canCrop && interactive && !item.locked && !freeFrame && event.button === 0 && Boolean(asset);
    if (freeFrame && !canCrop) { startFrame(event, "move"); return; }
    if (!canCrop && !quickPan) return;
    if (quickPan) handlers.onSelectItem?.(item.id, areaIndex);
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const center = cropCenter(placement.crop);
    pan.current = { x: event.clientX, y: event.clientY, cx: center.x, cy: center.y };
  };
  const moved = (event: React.PointerEvent) => {
    const state = pan.current;
    const box = contentRect();
    if (!state || !box) return null;
    // Il movimento sullo schermo si riporta nel riferimento dell'immagine (ruotata dal raddrizzamento).
    const rad = (placement.angle * Math.PI) / 180;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    const imageDx = dx * Math.cos(rad) + dy * Math.sin(rad);
    const imageDy = -dx * Math.sin(rad) + dy * Math.cos(rad);
    const imageWidthPx = (box.width * placement.image.w) / placement.content.w;
    const imageHeightPx = (box.height * placement.image.h) / placement.content.h;
    return { cx: state.cx - imageDx / imageWidthPx, cy: state.cy - imageDy / imageHeightPx };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (lineRef.current) { moveLine(event); return; }
    if (frameDrag.current) { moveFrame(event); return; }
    const next = moved(event);
    if (next) handlers.onDraft?.({ kind: "view", itemId: item.id, view: next });
  };
  const onPointerUp = (event: React.PointerEvent) => {
    if (lineRef.current) { endLine(event); return; }
    if (frameDrag.current) { endFrame(event); return; }
    const next = moved(event);
    const start = pan.current;
    pan.current = null;
    if (next && start && Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y) > 1) handlers.onCommitView?.(item.id, next);
    else if (next) handlers.onDraft?.(null);
  };

  const classes = [
    selected || picked ? "cell--selected" : "",
    canCrop ? "cell--cropping" : "",
    canCrop && placement.angle ? "cell--straightening" : "",
    canCrop && (placement.angle || lineActive) ? "cell--fine" : "",
    lineActive ? "cell--line" : "",
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
      borderColor={itemBorderColor(item, area.style)}
      className={classes}
      style={cell.z !== undefined ? { zIndex: Math.min(25, Math.max(1, 10 + cell.z)), transform: cell.rotation ? `rotate(${cell.rotation}deg)` : undefined } : undefined}
      alt={asset?.fileName}
      data-item-id={item.id}
      data-asset-id={item.assetId}
      data-area-index={areaIndex}
      draggable={interactive && !canCrop && !item.locked && !freeFrame}
      onDragStart={(event) => { if (pan.current || event.altKey) { event.preventDefault(); return; } beginDrag(event, { kind: "item", itemId: item.id }); }}
      onMouseMove={(event) => { if (!interactive) return; const grab = event.altKey && !canCrop && !item.locked && !freeFrame; if (grab !== (event.currentTarget.style.cursor === "grab")) event.currentTarget.style.cursor = grab ? "grab" : ""; }}
      onDragEnd={endDrag}
      onClick={(event) => { if (interactive) { event.stopPropagation(); if (event.shiftKey && handlers.onTogglePick) handlers.onTogglePick(item.id, areaIndex); else handlers.onSelectItem?.(item.id, areaIndex); } }}
      onDoubleClick={(event) => { if (interactive) { event.stopPropagation(); handlers.onToggleCrop?.(item.id); } }}
      onContextMenu={(event) => { if (!interactive || !handlers.onContextItem) return; event.preventDefault(); event.stopPropagation(); if (!picked) handlers.onSelectItem?.(item.id, areaIndex); handlers.onContextItem(item.id, areaIndex, event.clientX, event.clientY); }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {canCrop ? <span className="cell__grid" /> : null}
      {lineActive ? <span className="cell__hint">Trascina lungo l'orizzonte, o lungo un lato che deve essere verticale</span> : null}
      {line ? createPortal(
        <svg className="straight-line" aria-hidden="true">
          <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
          <circle cx={line.x1} cy={line.y1} r={4} />
          <circle cx={line.x2} cy={line.y2} r={4} />
        </svg>,
        document.body,
      ) : null}
      {canCrop && placement.angle ? <span className="cell__angle">{placement.angle.toLocaleString("it-IT")}°</span> : null}
      {canCrop && placement.zoom > 1.005 ? <span className="cell__zoom" title="Ingrandimento rispetto alla foto che riempie lo spazio">×{placement.zoom.toLocaleString("it-IT", { maximumFractionDigits: 2 })}</span> : null}
      {freeFrame && selected && !canCrop ? <span className="cell__resize" style={{ right: pct(((placement.frame.x + placement.frame.w - placement.content.x - placement.content.w) / placement.frame.w) * 100), bottom: pct(((placement.frame.y + placement.frame.h - placement.content.y - placement.content.h) / placement.frame.h) * 100) }} title="Trascina per ridimensionare (le proporzioni restano)" onPointerDown={(event) => startFrame(event, "resize")} onPointerMove={moveFrame} onPointerUp={endFrame} /> : null}
      {interactive && selected ? <span className="cell__name">{asset?.fileName.replace(/\.[^.]+$/, "")}</span> : null}
      {interactive && item.locked ? <span className="cell__badge cell__badge--lock"><Icon name="lock" size={12} /></span> : null}
      {interactive && showSizes ? (() => { const size = describeSize(placement); return <span className={`cell__size cell__size--${size.level}`} title="Misura stampata della foto e risoluzione effettiva">{size.widthCm.toLocaleString("it-IT")} × {size.heightCm.toLocaleString("it-IT")} cm · {size.dpi} dpi</span>; })() : null}
      {interactive && !showSizes && placement.dpi < lowDpi ? <span className="cell__badge cell__badge--warn" title={`Risoluzione effettiva ${Math.round(placement.dpi)} dpi`}>{Math.round(placement.dpi)} dpi</span> : null}
    </PhotoBox>
  );
});

/** I comandi della foto selezionata, divisi per lato: ogni lato è una barra piccola (null = nessuna barra). */
export interface ToolbarParts { top: ReactNode; bottom: ReactNode; left: ReactNode; right: ReactNode; /** Cursore del raddrizzamento (solo in ritaglio): barra larga, sempre orizzontale. */ straighten: ReactNode }
type ToolbarSide = "top" | "bottom" | "left" | "right" | "more" | "menu";
/** Distanza dai bordi della foto: i separatori e le zone di rilascio sui bordi restano raggiungibili. */
const INSET = 16;
const TOOLBAR_SIDES: readonly ToolbarSide[] = ["top", "bottom", "left", "right", "more", "menu"];

/**
 * Barre della foto selezionata: vivono sopra lo spread (non dentro la cella, che ritaglia) e restano dentro i suoi bordi. Si adattano alla foto:
 * - grande: quattro barre, una per lato (2-3 comandi ciascuna), così nessuna è grande e il centro resta libero;
 * - piccola: due colonne ai lati, il raddrizzamento in una barra sotto;
 * - minuscola: un solo pulsante «⋯» all'angolo che apre i comandi in una barra fuori dalla foto, e si richiude da solo.
 * Spariscono mentre si trascina.
 */
function FloatingToolbar({ rect, size, container, parts, away }: { rect: Rect; size: { width: number; height: number }; container: React.RefObject<HTMLDivElement | null>; parts: ToolbarParts; away: boolean }) {
  const [boxWidth, setBoxWidth] = useState(0);
  const cellPx = boxWidth > 0 ? { w: (rect.w * boxWidth) / size.width, h: (rect.h * boxWidth) / size.width } : null;
  const minSide = cellPx ? Math.min(cellPx.w, cellPx.h) : Infinity;
  const mode = toolbarModeFor(minSide);
  const tiny = mode === "tiny";
  const compact = mode === "compact";
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { if (!tiny) setMenuOpen(false); }, [tiny]);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event: PointerEvent) => { if (!(event.target as Element | null)?.closest?.(".spread__toolbar, .popover")) setMenuOpen(false); };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [menuOpen]);
  const everything = <>{parts.top}{parts.left}{parts.right}{parts.straighten}{parts.bottom}</>;
  const bars: Partial<Record<ToolbarSide, ReactNode>> = tiny
    ? {
      more: <button type="button" className={`icon-btn${menuOpen ? " is-active" : ""}`} aria-label="Comandi della foto" aria-expanded={menuOpen} title="Comandi della foto" onClick={() => setMenuOpen((on) => !on)}><Icon name="dots" size={16} /></button>,
      menu: menuOpen ? everything : null,
    }
    : compact
      ? { left: parts.top || parts.left ? <>{parts.top}{parts.left}</> : null, right: <>{parts.right}{parts.bottom}</>, bottom: parts.straighten }
      : { top: parts.top, left: parts.left, right: parts.right, bottom: parts.straighten || parts.bottom ? <>{parts.straighten}{parts.bottom}</> : null };
  const refs = useRef<Partial<Record<ToolbarSide, HTMLDivElement | null>>>({});
  const [pos, setPos] = useState<Partial<Record<ToolbarSide, { x: number; y: number }>> | null>(null);
  const [tick, setTick] = useState(0);
  // Mentre una foto viene trascinata (o spostata, ridimensionata) le barre si fanno da parte e non intercettano né clic né rilasci.
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const start = () => setDragging(true);
    const end = () => setDragging(false);
    document.addEventListener("dragstart", start, true);
    document.addEventListener("dragend", end, true);
    document.addEventListener("drop", end, true);
    return () => { document.removeEventListener("dragstart", start, true); document.removeEventListener("dragend", end, true); document.removeEventListener("drop", end, true); };
  }, []);
  useEffect(() => {
    const element = container.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setTick((value) => value + 1));
    observer.observe(element);
    return () => observer.disconnect();
  }, [container]);
  useLayoutEffect(() => {
    const box = container.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    setBoxWidth((previous) => (Math.abs(previous - box.width) < 0.5 ? previous : box.width));
    const k = box.width / size.width;
    const cellLeft = rect.x * k;
    const cellRight = (rect.x + rect.w) * k;
    const cellTop = rect.y * k;
    const cellBottom = (rect.y + rect.h) * k;
    const clampX = (x: number, w: number) => Math.min(Math.max(0, x), Math.max(0, box.width - w));
    const clampY = (y: number, h: number) => Math.min(Math.max(4, y), Math.max(4, box.height - h - 4));
    const next: Partial<Record<ToolbarSide, { x: number; y: number }>> = {};
    for (const side of TOOLBAR_SIDES) {
      const element = refs.current[side];
      if (!element) continue;
      const w = element.offsetWidth;
      const h = element.offsetHeight;
      const centerX = clampX((cellLeft + cellRight) / 2 - w / 2, w);
      const centerY = clampY((cellTop + cellBottom) / 2 - h / 2, h);
      // La barra dei comandi di una foto minuscola sta fuori dalla foto: sotto, oppure sopra se sotto non c'è posto.
      const below = cellBottom + 6;
      const menuY = below + h <= box.height - 4 ? below : cellTop - h - 6 >= 4 ? cellTop - h - 6 : clampY(cellBottom - h - 30, h);
      next[side] =
        side === "top" ? { x: centerX, y: clampY(cellTop + INSET, h) }
        : side === "bottom" ? { x: centerX, y: clampY(cellBottom - h - 30, h) }
        : side === "left" ? { x: clampX(cellLeft + INSET, w), y: centerY }
        : side === "right" ? { x: clampX(cellRight - w - INSET, w), y: centerY }
        : side === "more" ? { x: clampX(cellRight - w - 4, w), y: clampY(cellTop + 4, h) }
        : { x: centerX, y: menuY };
    }
    setPos((previous) => (previous && TOOLBAR_SIDES.every((side) => Math.abs((previous[side]?.x ?? 0) - (next[side]?.x ?? 0)) < 0.5 && Math.abs((previous[side]?.y ?? 0) - (next[side]?.y ?? 0)) < 0.5) ? previous : next));
  }, [rect.x, rect.y, rect.w, rect.h, size.width, size.height, container, tick, parts, compact, tiny, menuOpen]);
  const stop = {
    onClick: (event: React.MouseEvent) => event.stopPropagation(),
    onDoubleClick: (event: React.MouseEvent) => event.stopPropagation(),
    onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
    draggable: true,
    onDragStart: (event: React.DragEvent) => { event.preventDefault(); event.stopPropagation(); },
  };
  // Le barre orizzontali non superano la larghezza della foto (le righe vanno a capo) e il raddrizzamento si stringe con lei.
  const widthLimit = (side: ToolbarSide): number | undefined => {
    if (side === "menu") return Math.min(Math.max(boxWidth - 8, 160), 460);
    if (side === "top" || side === "bottom") return cellPx ? Math.max(150, cellPx.w - 2 * INSET) : undefined;
    return undefined;
  };
  return (
    <>
      {TOOLBAR_SIDES.map((side) => bars[side] ? (
        <div key={side} ref={(element) => { refs.current[side] = element; }} className={`cell__toolbar spread__toolbar${side === "left" || side === "right" ? " spread__toolbar--col" : ""}${side === "more" ? " spread__toolbar--more" : ""}${side === "menu" ? " spread__toolbar--menu" : ""}${(away || dragging) && side !== "more" ? " is-away" : ""}`} style={{ left: pos?.[side]?.x ?? 0, top: pos?.[side]?.y ?? 0, maxWidth: widthLimit(side), visibility: pos?.[side] ? "visible" : "hidden" }} {...stop}>{bars[side]}</div>
      ) : null)}
    </>
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
  const media = useMediaUrls(mediaIdsOfSpread(spread));

  const overrides = useMemo(() => (draft?.kind === "ratio" ? { [draft.areaIndex]: { [draft.path]: draft.ratio } } : undefined), [draft]);
  const geometry: AreaGeometry[] = useMemo(() => spread.areas.map((_, index) => {
    const base = areaGeometryFor(sheet, spread, index, overrides?.[index]);
    return draft?.kind === "frame" && base.cells.some((cell) => cell.itemId === draft.itemId)
      ? { ...base, cells: base.cells.map((cell) => (cell.itemId === draft.itemId ? { ...cell, rect: draft.rect } : cell)) }
      : base;
  }), [sheet, spread, overrides, draft]);
  // Punti di aggancio per le foto delle disposizioni libere: le altre foto, il bordo e il centro dell'area utile e la piega al centro.
  const snapTargetsByArea = useMemo(() => spread.areas.map((area, index) => {
    if (!interactive || !hasFreeLayout(area)) return undefined;
    const base = areaGeometryFor(sheet, spread, index);
    return [
      ...base.cells.map((cell) => ({ id: cell.itemId, rect: cell.rect })),
      { id: "__area", rect: base.inner },
      { id: "__fold", rect: { x: size.width / 2, y: base.inner.y, w: 0, h: base.inner.h } },
    ];
  }), [interactive, sheet, spread, size.width]);
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

  const handlers = useMemo(() => ({ onSelectItem: props.onSelectItem, onTogglePick: props.onTogglePick, onContextItem: props.onContextItem, onToggleCrop: props.onToggleCrop, onDraft: props.onDraft, onCommitView: props.onCommitView, renderToolbar: props.renderToolbar, onStraightenDone: props.onStraightenDone, onCommitFrameRect: commitFrameRect }),
    [props.onSelectItem, props.onTogglePick, props.onContextItem, props.onToggleCrop, props.onDraft, props.onCommitView, props.renderToolbar, props.onStraightenDone, commitFrameRect]);

  const onDragOver = (event: React.DragEvent) => {
    const payload = currentDrag();
    if (!interactive || !payload || payload.kind === "spread") return;
    const found = targetAt(event.clientX, event.clientY);
    if (!found || (payload.kind === "item" && found.target.itemId === payload.itemId)) { setHint(null); return; }
    // Sul centro di una foto bloccata non si sostituisce né si scambia: il cursore lo dice e il rilascio non parte.
    if (found.target.zone === "center" && found.target.itemId && spread.areas[found.target.areaIndex]?.items.find((candidate) => candidate.id === found.target.itemId)?.locked) { setHint(null); return; }
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
      className={`spread spread--${variant}${draft?.kind === "ratio" || draft?.kind === "frame" || draft?.kind === "view" ? " is-resizing" : ""}${props.photosLocked ? " is-photos-locked" : ""}${hint ? " is-dropping" : ""}`}
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

      <BackgroundLayer sheet={sheet} spread={spread} media={media} />

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
            {interactive ? <span className="spread__empty-chip" onClick={(event) => { event.stopPropagation(); props.onActivateArea?.(areaIndex); props.onSelectItem?.(null, areaIndex); }}><Icon name="image" size={16} /><em>Trascina qui le foto</em></span> : null}
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
              picked={Boolean(props.pickedItemIds?.includes(item.id))}
              cropActive={cropMode}
              view={draft?.kind === "view" && draft.itemId === item.id ? draft.view : null}
              lowDpi={lowDpi}
              showSizes={showSizes}
              free={hasFreeLayout(area)}
              snapTargets={snapTargetsByArea[areaIndex]}
              lineTool={Boolean(props.straightenTool) && selectedItemId === item.id}
              handlers={handlers}
            />
          );
        }))}

      {draft?.kind === "frame" && draft.guides?.length ? draft.guides.map((guide, index) => (
        <span
          key={`${guide.axis}-${index}`}
          className={`spread__snap spread__snap--${guide.axis}`}
          aria-hidden="true"
          style={guide.axis === "x"
            ? { left: pct((guide.at / size.width) * 100), top: pct((guide.from / size.height) * 100), height: pct(((guide.to - guide.from) / size.height) * 100) }
            : { top: pct((guide.at / size.height) * 100), left: pct((guide.from / size.width) * 100), width: pct(((guide.to - guide.from) / size.width) * 100) }}
        />
      )) : null}

      <OverlayLayer sheet={sheet} spread={spread} media={media} interactive={interactive} handlers={props.design} />

      {interactive && selectedItemId && props.renderToolbar && draft?.kind !== "frame" ? (() => {
        const rect = geometry.flatMap((g) => g.cells).find((cell) => cell.itemId === selectedItemId)?.rect;
        const parts = rect ? props.renderToolbar(selectedItemId) : null;
        return rect && parts ? <FloatingToolbar key={selectedItemId} rect={rect} size={size} container={ref} parts={parts} away={draft !== null} /> : null;
      })() : null}

      <div className="spread__fold" aria-hidden="true" />

      {/* Con le foto allineate («foto intera» o forme scelte) i separatori non si trascinano: le divisioni seguono le proporzioni delle foto. */}
      {interactive ? spread.areas.map((area, areaIndex) => (needsShapeAlignment(area) ? [] : geometry[areaIndex].dividers).map((divider) => (
        <DividerHandle key={`${area.id}-${divider.path}`} divider={divider} areaIndex={areaIndex} size={size} toMm={toMm} onDraft={props.onDraft} onCommit={props.onCommitRatio} onReset={props.onResetRatio} />
      ))) : null}

      {showGuides && interactive ? [0, 1].map((side) => (
        <div key={side} className="spread__safe" style={{ left: pct(((side * page + margin) / size.width) * 100), top: pct((margin / size.height) * 100), width: pct(((page - margin * 2) / size.width) * 100), height: pct(((size.height - margin * 2) / size.height) * 100) }} />
      )) : null}

      {interactive ? spread.areas.map((area, areaIndex) => (area.locked ? (
        <span key={`lock-${area.id}`} className="spread__locked" title="Layout bloccato: Mescola e Auto Build non lo toccano" style={{ left: pct((geometry[areaIndex].outer.x / size.width) * 100), top: pct((geometry[areaIndex].outer.y / size.height) * 100) }}>
          <Icon name="lock" size={12} /> Layout bloccato
        </span>
      ) : null)) : null}

      {interactive && spread.areas.length > 1 ? (() => {
        const outer = geometry[Math.min(activeArea, spread.areas.length - 1)].outer;
        return <div className="spread__active" style={{ left: pct((outer.x / size.width) * 100), top: pct((outer.y / size.height) * 100), width: pct((outer.w / size.width) * 100), height: pct((outer.h / size.height) * 100) }} />;
      })() : null}

      {interactive && props.insertMarker ? (
        <div className="spread__insert" style={{ left: pct(props.insertMarker.x * 100), top: pct(props.insertMarker.y * 100) }} aria-hidden="true">
          <span>+ {props.insertMarker.label}</span>
        </div>
      ) : null}

      {hint ? <div className={`spread__hint spread__hint--${hint.target.zone}`} style={{ left: pct((hint.rect.x / size.width) * 100), top: pct((hint.rect.y / size.height) * 100), width: pct((hint.rect.w / size.width) * 100), height: pct((hint.rect.h / size.height) * 100) }} /> : null}
    </div>
  );
}

export const SpreadView = memo(SpreadViewInner);
