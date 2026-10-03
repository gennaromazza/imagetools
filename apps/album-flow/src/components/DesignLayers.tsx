import { useMemo, useRef, useState } from "react";
import type { AlbumSpread, SpreadOverlay } from "@photo-tools/shared-types";
import { spreadSizeMm } from "../engine/geometry";
import { fontIdsOfSpread, groupMembers, overlaysOf, type OverlayPatch } from "../model/design";
import type { Project } from "../model/project";
import { canvasMeasure } from "../render/fonts";
import { overlayBox, renderBackgroundsSvg, renderOverlaysSvg, type DesignContext } from "../render/design-svg";
import { useFontsReady } from "../hooks/useFonts";

type Sheet = Project["settings"]["sheet"];

/** Un progetto minimo con il solo foglio: basta alle funzioni che misurano e disegnano testi e sfondi. */
const sheetProject = (sheet: Sheet) => ({ settings: { sheet } }) as unknown as Project;

export interface DesignHandlers {
  selectedId: string | null;
  /** Altri elementi selezionati insieme al principale (per agganciarli). */
  extraIds: readonly string[];
  onSelect: (overlayId: string | null, additive?: boolean) => void;
  onCommit: (overlayId: string, patch: OverlayPatch) => void;
  /** Sposta l'elemento e, se è in un gruppo, tutto il gruppo (scarto in frazioni dello spread). */
  onMoveBy: (overlayId: string, dx: number, dy: number) => void;
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
}

/** Testi e grafiche sopra le foto, con i comandi per spostarli, ridimensionarli e ruotarli. */
export function OverlayLayer({ sheet, spread, media, interactive, handlers }: { sheet: Sheet; spread: AlbumSpread; media: ReadonlyMap<string, string>; interactive: boolean; handlers?: DesignHandlers }) {
  const size = spreadSizeMm(sheet);
  const overlays = overlaysOf(spread);
  const ready = useFontsReady(fontIdsOfSpread(spread));
  const rootRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ id: string; patch: OverlayPatch; move: boolean } | null>(null);
  const gesture = useRef<Gesture | null>(null);

  const shown = useMemo(() => {
    if (!draft) return overlays;
    const dragged = overlays.find((overlay) => overlay.id === draft.id);
    const dx = draft.patch.x !== undefined && dragged ? draft.patch.x - dragged.x : 0;
    const dy = draft.patch.y !== undefined && dragged ? draft.patch.y - dragged.y : 0;
    const moving = draft.move && dragged ? new Set(groupMembers(spread, dragged.id).map((overlay) => overlay.id)) : null;
    return overlays.map((overlay) => {
      if (moving?.has(overlay.id)) return { ...overlay, x: overlay.x + dx, y: overlay.y + dy } as SpreadOverlay;
      return draft.id === overlay.id ? ({ ...overlay, ...draft.patch } as SpreadOverlay) : overlay;
    });
  }, [overlays, draft, spread]);
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
    handlers?.onSelect(overlay.id, additive);
    if (additive) return;
    const cx = metrics.rect.left + ((box.x + box.w / 2) / size.width) * metrics.rect.width;
    const cy = metrics.rect.top + ((box.y + box.h / 2) / size.height) * metrics.rect.height;
    gesture.current = { mode, id: overlay.id, startX: event.clientX, startY: event.clientY, base: overlay, box: { cx, cy }, moved: false };
  };

  const patchFor = (event: React.PointerEvent): OverlayPatch | null => {
    const current = gesture.current;
    const metrics = unit();
    if (!current || !metrics) return null;
    const dxPx = event.clientX - current.startX;
    const dyPx = event.clientY - current.startY;
    if (Math.abs(dxPx) + Math.abs(dyPx) > 2) current.moved = true;
    if (current.mode === "move") {
      return { x: current.base.x + dxPx / metrics.rect.width, y: current.base.y + dyPx / metrics.rect.height };
    }
    if (current.mode === "resize") {
      // Si misura lo spostamento lungo l'asse orizzontale dell'elemento, che può essere ruotato.
      const rad = (current.base.rotation * Math.PI) / 180;
      const along = dxPx * Math.cos(rad) + dyPx * Math.sin(rad);
      return { w: Math.max(0.02, current.base.w + along / metrics.rect.width) };
    }
    let degrees = (Math.atan2(event.clientY - current.box.cy, event.clientX - current.box.cx) * 180) / Math.PI + 90;
    if (degrees > 180) degrees -= 360;
    if (event.shiftKey) degrees = Math.round(degrees / 15) * 15;
    else if (Math.abs(degrees) < 2.5) degrees = 0;
    return { rotation: degrees };
  };

  const move = (event: React.PointerEvent) => {
    const patch = patchFor(event);
    if (patch && gesture.current) setDraft({ id: gesture.current.id, patch, move: gesture.current.mode === "move" });
  };
  const end = (event: React.PointerEvent) => {
    const current = gesture.current;
    const patch = patchFor(event);
    gesture.current = null;
    setDraft(null);
    if (!current?.moved || !patch) return;
    if (current.mode === "move" && patch.x !== undefined && patch.y !== undefined) handlers?.onMoveBy(current.id, patch.x - current.base.x, patch.y - current.base.y);
    else handlers?.onCommit(current.id, patch);
  };

  return (
    <div ref={rootRef} className="spread__design-root" aria-hidden={interactive ? undefined : true}>
      <svg className="spread__design spread__design--above" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
      {boxes.map(({ overlay, box }) => {
        const selected = handlers?.selectedId === overlay.id;
        const sibling = !selected && Boolean(overlay.groupId) && overlays.find((other) => other.id === handlers?.selectedId)?.groupId === overlay.groupId;
        return (
          <div
            key={overlay.id}
            className={`design-box${selected ? " is-selected" : ""}${sibling ? " is-sibling" : ""}${handlers?.extraIds.includes(overlay.id) ? " is-multi" : ""}`}
            style={{ left: `${(box.x / size.width) * 100}%`, top: `${(box.y / size.height) * 100}%`, width: `${(box.w / size.width) * 100}%`, height: `${(box.h / size.height) * 100}%`, transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined }}
            data-overlay-id={overlay.id}
            onClick={(event) => { event.stopPropagation(); if (!(event.shiftKey || event.ctrlKey || event.metaKey)) handlers?.onSelect(overlay.id); }}
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
