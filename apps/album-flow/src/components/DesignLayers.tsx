import { useMemo, useRef, useState } from "react";
import type { AlbumSpread, SpreadOverlay } from "@photo-tools/shared-types";
import { spreadSizeMm, type Rect } from "../engine/geometry";
import { snapMove, type SnapGuide } from "../engine/snap";
import { fontIdsOfSpread, groupMembers, overlaysOf, scaleOverlays, type OverlayPatch } from "../model/design";
import { groupFrame, overlaySnapTargets, resizeKeepingCorner } from "../model/designAlign";
import { getSnapEnabled } from "../model/snapSettings";
import { TEXT_LIMITS } from "../model/typography";
import type { Project } from "../model/project";
import { canvasMeasure } from "../render/fonts";
import { overlayBox, renderBackgroundsSvg, renderOverlaysSvg, type DesignContext } from "../render/design-svg";
import { useFontsReady } from "../hooks/useFonts";

type Sheet = Project["settings"]["sheet"];

/** A quanti pixel dal bordo o dal centro di un altro elemento scatta la calamita. */
const SNAP_PX = 6;

/** Un progetto minimo con il solo foglio: basta alle funzioni che misurano e disegnano testi e sfondi. */
const sheetProject = (sheet: Sheet) => ({ settings: { sheet } }) as unknown as Project;

export interface DesignHandlers {
  selectedId: string | null;
  /** Altri elementi selezionati insieme al principale (per agganciarli). */
  extraIds: readonly string[];
  /** `openPanel` false = seleziona soltanto: l'afferrare un elemento non deve aprire il pannello, che cambierebbe la misura dello spread a metà trascinamento. */
  onSelect: (overlayId: string | null, additive?: boolean, openPanel?: boolean) => void;
  onCommit: (overlayId: string, patch: OverlayPatch) => void;
  /** Sposta l'elemento e, se è in un gruppo, tutto il gruppo (scarto in frazioni dello spread). */
  onMoveBy: (overlayId: string, dx: number, dy: number) => void;
  /** Ingrandisce o riduce insieme più elementi attorno a un angolo fermo (frazioni dello spread). */
  onScale: (overlayIds: readonly string[], factor: number, pivot: { x: number; y: number }) => void;
  onEdit: (overlayId: string) => void;
}

/** Sfondi a immagine dello spread: stanno sotto le foto. */
export function BackgroundLayer({ sheet, spread, media }: { sheet: Sheet; spread: AlbumSpread; media: ReadonlyMap<string, string> }) {
  const size = spreadSizeMm(sheet);
  const html = useMemo(() => {
    if (!spread.backgrounds?.length) return "";
    const context: DesignContext = { media, measure: canvasMeasure };
    return renderBackgroundsSvg(sheetProject(sheet), spread, context);
  }, [sheet, spread, media]);
  if (!html) return null;
  return <svg className="spread__design spread__design--below" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
}

interface Gesture {
  mode: "move" | "resize" | "rotate";
  id: string;
  startX: number;
  startY: number;
  base: SpreadOverlay;
  box: { cx: number; cy: number };
  moved: boolean;
  /** Spostamento: ingombro (mm) dell'elemento e del suo gruppo alla partenza, e ciò a cui può agganciarsi. */
  frame?: Rect;
  targets?: Rect[];
  guides?: SnapGuide[];
}

/** Testi e grafiche sopra le foto, con i comandi per spostarli, ridimensionarli e ruotarli. */
export function OverlayLayer({ sheet, spread, media, interactive, handlers }: { sheet: Sheet; spread: AlbumSpread; media: ReadonlyMap<string, string>; interactive: boolean; handlers?: DesignHandlers }) {
  const size = spreadSizeMm(sheet);
  const overlays = overlaysOf(spread);
  const ready = useFontsReady(fontIdsOfSpread(spread));
  const rootRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ id: string; patch: OverlayPatch; move: boolean; guides: SnapGuide[] } | null>(null);
  /** Maniglia del riquadro del gruppo: anteprima in tempo reale mentre si trascina. */
  const [scaling, setScaling] = useState<{ ids: string[]; factor: number; pivot: { x: number; y: number } } | null>(null);
  const scaleGesture = useRef<{ startX: number; startY: number; ids: string[]; frame: Rect; pivot: { x: number; y: number }; factor: number } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  /** Il clic che segue un trascinamento non deve aprire il pannello. */
  const dragged = useRef(false);

  const shown = useMemo(() => {
    if (scaling) return overlaysOf(scaleOverlays({ settings: { sheet }, spreads: [spread] } as unknown as Project, spread.id, scaling.ids, scaling.factor, scaling.pivot).spreads[0]);
    if (!draft) return overlays;
    const dragged = overlays.find((overlay) => overlay.id === draft.id);
    const dx = draft.patch.x !== undefined && dragged ? draft.patch.x - dragged.x : 0;
    const dy = draft.patch.y !== undefined && dragged ? draft.patch.y - dragged.y : 0;
    const moving = draft.move && dragged ? new Set(groupMembers(spread, dragged.id).map((overlay) => overlay.id)) : null;
    return overlays.map((overlay) => {
      if (moving?.has(overlay.id)) return { ...overlay, x: overlay.x + dx, y: overlay.y + dy } as SpreadOverlay;
      return draft.id === overlay.id ? ({ ...overlay, ...draft.patch } as SpreadOverlay) : overlay;
    });
  }, [overlays, draft, spread, scaling, sheet]);
  const project = useMemo(() => sheetProject(sheet), [sheet]);
  const html = useMemo(() => {
    if (!shown.length) return "";
    const context: DesignContext = { media, measure: canvasMeasure };
    return renderOverlaysSvg(project, { ...spread, overlays: shown }, context);
    // `ready` cambia quando i font sono arrivati: il testo va misurato di nuovo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, spread, shown, media, ready]);
  const boxes = useMemo(() => (interactive ? shown.map((overlay) => ({ overlay, box: overlayBox(project, overlay, canvasMeasure) })) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [interactive, project, shown, ready]);

  if (!overlays.length) return null;

  const unit = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? { rect, perPx: size.width / rect.width } : null;
  };

  const begin = (event: React.PointerEvent, overlay: SpreadOverlay, mode: Gesture["mode"], box: { x: number; y: number; w: number; h: number }) => {
    const metrics = unit();
    if (!metrics) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const additive = mode === "move" && (event.shiftKey || event.ctrlKey || event.metaKey);
    dragged.current = false;
    handlers?.onSelect(overlay.id, additive, false);
    if (additive) return;
    const cx = metrics.rect.left + ((box.x + box.w / 2) / size.width) * metrics.rect.width;
    const cy = metrics.rect.top + ((box.y + box.h / 2) / size.height) * metrics.rect.height;
    gesture.current = { mode, id: overlay.id, startX: event.clientX, startY: event.clientY, base: overlay, box: { cx, cy }, moved: false };
    if (mode === "move") {
      // Calamite: bordi, centro e piega dello spread, margini, foto e altri testi (non il gruppo che si sposta). Alt le esclude.
      const members = new Set(groupMembers(spread, overlay.id).map((member) => member.id));
      gesture.current.frame = groupFrame(sheet, spread, overlay.id, canvasMeasure) ?? undefined;
      gesture.current.targets = overlaySnapTargets(sheet, spread, members, canvasMeasure);
    }
  };

  const patchFor = (event: React.PointerEvent): OverlayPatch | null => {
    const current = gesture.current;
    const metrics = unit();
    if (!current || !metrics) return null;
    const dxPx = event.clientX - current.startX;
    const dyPx = event.clientY - current.startY;
    if (Math.abs(dxPx) + Math.abs(dyPx) > 2) current.moved = true;
    if (current.mode === "move") {
      let dx = dxPx / metrics.rect.width;
      let dy = dyPx / metrics.rect.height;
      current.guides = [];
      if (!event.altKey && getSnapEnabled() && current.frame && current.targets) {
        const rect: Rect = { ...current.frame, x: current.frame.x + dx * size.width, y: current.frame.y + dy * size.height };
        const snapped = snapMove(rect, current.targets, SNAP_PX * metrics.perPx);
        dx += (snapped.rect.x - rect.x) / size.width;
        dy += (snapped.rect.y - rect.y) / size.height;
        current.guides = snapped.guides;
      }
      return { x: current.base.x + dx, y: current.base.y + dy };
    }
    if (current.mode === "resize") {
      // Si misura lo spostamento lungo l'asse orizzontale dell'elemento, che può essere ruotato.
      const rad = (current.base.rotation * Math.PI) / 180;
      const along = dxPx * Math.cos(rad) + dyPx * Math.sin(rad);
      const text = current.base.kind === "text";
      const w = Math.min(text ? TEXT_LIMITS.width.max : 2, Math.max(text ? TEXT_LIMITS.width.min : 0.02, current.base.w + along / metrics.rect.width));
      // Un elemento ruotato gira attorno al proprio centro: con la nuova larghezza il centro si sposterebbe e l'elemento «scapperebbe».
      if (current.base.rotation) return resizeKeepingCorner(sheet, current.base, w, canvasMeasure);
      return { w };
    }
    let degrees = (Math.atan2(event.clientY - current.box.cy, event.clientX - current.box.cx) * 180) / Math.PI + 90;
    if (degrees > 180) degrees -= 360;
    if (event.shiftKey) degrees = Math.round(degrees / 15) * 15;
    else if (Math.abs(degrees) < 2.5) degrees = 0;
    return { rotation: degrees };
  };

  const move = (event: React.PointerEvent) => {
    const patch = patchFor(event);
    if (patch && gesture.current) setDraft({ id: gesture.current.id, patch, move: gesture.current.mode === "move", guides: gesture.current.guides ?? [] });
  };
  const end = (event: React.PointerEvent) => {
    const current = gesture.current;
    const patch = patchFor(event);
    gesture.current = null;
    setDraft(null);
    if (!current?.moved || !patch) return;
    dragged.current = true;
    if (current.mode === "move" && patch.x !== undefined && patch.y !== undefined) handlers?.onMoveBy(current.id, patch.x - current.base.x, patch.y - current.base.y);
    else handlers?.onCommit(current.id, patch);
  };

  // Riquadro del gruppo (o della selezione multipla): una maniglia in basso a destra ingrandisce e riduce tutti insieme, con l'angolo in alto a sinistra fermo.
  const selectedOverlay = overlays.find((overlay) => overlay.id === handlers?.selectedId);
  const groupIds = selectedOverlay ? Array.from(new Set([...groupMembers(spread, selectedOverlay.id).map((overlay) => overlay.id), selectedOverlay.id, ...(handlers?.extraIds ?? [])])) : [];
  const groupBoxes = boxes.filter(({ overlay }) => groupIds.includes(overlay.id));
  const groupRect: Rect | null = groupIds.length >= 2 && groupBoxes.length >= 2 ? (() => {
    const left = Math.min(...groupBoxes.map(({ box }) => box.x));
    const top = Math.min(...groupBoxes.map(({ box }) => box.y));
    return { x: left, y: top, w: Math.max(...groupBoxes.map(({ box }) => box.x + box.w)) - left, h: Math.max(...groupBoxes.map(({ box }) => box.y + box.h)) - top };
  })() : null;
  const scaleFactor = (event: React.PointerEvent): number | null => {
    const current = scaleGesture.current;
    const metrics = unit();
    if (!current || !metrics) return null;
    const dx = (event.clientX - current.startX) * metrics.perPx;
    const dy = (event.clientY - current.startY) * metrics.perPx;
    const { w, h } = current.frame;
    return Math.min(8, Math.max(0.1, 1 + (dx * w + dy * h) / (w * w + h * h)));
  };
  const beginScale = (event: React.PointerEvent) => {
    if (!groupRect) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    scaleGesture.current = { startX: event.clientX, startY: event.clientY, ids: groupIds, frame: groupRect, pivot: { x: groupRect.x / size.width, y: groupRect.y / size.height }, factor: 1 };
  };
  const moveScale = (event: React.PointerEvent) => {
    const current = scaleGesture.current;
    const factor = scaleFactor(event);
    if (current && factor !== null) { current.factor = factor; setScaling({ ids: current.ids, factor, pivot: current.pivot }); }
  };
  const endScale = (event: React.PointerEvent) => {
    const current = scaleGesture.current;
    const factor = scaleFactor(event);
    scaleGesture.current = null;
    setScaling(null);
    if (current && factor !== null && Math.abs(factor - 1) > 0.005) handlers?.onScale(current.ids, factor, current.pivot);
  };

  return (
    <div ref={rootRef} className="spread__design-root" aria-hidden={interactive ? undefined : true}>
      <svg className="spread__design spread__design--above" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
      {draft?.guides.map((guide, index) => (
        <span
          key={`${guide.axis}-${index}`}
          className={`spread__snap spread__snap--${guide.axis}`}
          aria-hidden="true"
          style={guide.axis === "x"
            ? { left: `${(guide.at / size.width) * 100}%`, top: `${(guide.from / size.height) * 100}%`, height: `${((guide.to - guide.from) / size.height) * 100}%` }
            : { top: `${(guide.at / size.height) * 100}%`, left: `${(guide.from / size.width) * 100}%`, width: `${((guide.to - guide.from) / size.width) * 100}%` }}
        />
      ))}
      {groupRect ? (
        <div className="design-group" style={{ left: `${(groupRect.x / size.width) * 100}%`, top: `${(groupRect.y / size.height) * 100}%`, width: `${(groupRect.w / size.width) * 100}%`, height: `${(groupRect.h / size.height) * 100}%` }} aria-hidden="true">
          <span className="design-group__handle" onPointerDown={beginScale} onPointerMove={moveScale} onPointerUp={endScale} title="Trascina per ingrandire o ridurre tutto il gruppo in proporzione" />
        </div>
      ) : null}
      {boxes.map(({ overlay, box }) => {
        const selected = handlers?.selectedId === overlay.id;
        const sibling = !selected && Boolean(overlay.groupId) && overlays.find((other) => other.id === handlers?.selectedId)?.groupId === overlay.groupId;
        return (
          <div
            key={overlay.id}
            className={`design-box${selected ? " is-selected" : ""}${sibling ? " is-sibling" : ""}${handlers?.extraIds.includes(overlay.id) ? " is-multi" : ""}`}
            style={{ left: `${(box.x / size.width) * 100}%`, top: `${(box.y / size.height) * 100}%`, width: `${(box.w / size.width) * 100}%`, height: `${(box.h / size.height) * 100}%`, transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined }}
            data-overlay-id={overlay.id}
            onClick={(event) => {
              event.stopPropagation();
              if (dragged.current) { dragged.current = false; return; }
              if (!(event.shiftKey || event.ctrlKey || event.metaKey)) handlers?.onSelect(overlay.id);
            }}
            onDoubleClick={(event) => { event.stopPropagation(); handlers?.onEdit(overlay.id); }}
            onPointerDown={(event) => begin(event, overlay, "move", box)}
            onPointerMove={move}
            onPointerUp={end}
            title={overlay.kind === "text" ? "Trascina per spostare, doppio clic per modificare il testo" : "Trascina per spostare"}
          >
            {selected ? (
              <>
                <span className="design-box__rotate" onPointerDown={(event) => begin(event, overlay, "rotate", box)} onPointerMove={move} onPointerUp={end} title="Ruota (Maiusc: a scatti di 15°)" />
                <span className="design-box__resize" onPointerDown={(event) => begin(event, overlay, "resize", box)} onPointerMove={move} onPointerUp={end} title="Trascina per allargare o restringere" />
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
