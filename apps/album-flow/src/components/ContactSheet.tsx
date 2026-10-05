import { useEffect, useMemo, useRef, useState } from "react";
import type { AlbumAssetV2, AlbumProjectV2 } from "@photo-tools/shared-types";
import { Icon } from "./icons";
import { SpreadView } from "./SpreadView";

export interface ContactSheetProps {
  project: AlbumProjectV2;
  assets: ReadonlyMap<string, AlbumAssetV2>;
  /** Spread aperto nell'area di lavoro: parte selezionato. */
  current: number;
  onClose: () => void;
  /** Apre lo spread nell'area di lavoro. */
  onOpen: (index: number) => void;
  /** Sposta gli spread indicati davanti alla posizione `before` (0…numero di spread). */
  onMove: (indices: number[], before: number) => void;
  onDuplicate: (index: number) => void;
  onRemove: (index: number) => void;
}

const SIZES = { min: 120, max: 420, start: 220 };

/**
 * Provino: tutti gli spread dell'album in un'unica vista, come i provini di stampa. Si trascinano (anche più d'uno insieme) per
 * cambiare l'ordine; doppio clic o Invio aprono lo spread.
 */
export function ContactSheet({ project, assets, current, onClose, onOpen, onMove, onDuplicate, onRemove }: ContactSheetProps) {
  const total = project.spreads.length;
  const [selected, setSelected] = useState<number[]>(total ? [Math.min(current, total - 1)] : []);
  const anchor = useRef(Math.min(current, Math.max(total - 1, 0)));
  const [size, setSize] = useState(SIZES.start);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const dragging = useRef<number[] | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const chapterByAsset = useMemo(() => {
    const map = new Map<string, { title: string; color: string }>();
    for (const chapter of project.chapters) for (const id of chapter.assetIds) map.set(id, { title: chapter.title, color: chapter.color });
    return map;
  }, [project.chapters]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  useEffect(() => {
    gridRef.current?.querySelector<HTMLElement>(`[data-sheet-index="${selected[0] ?? 0}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  const move = (indices: number[], before: number) => {
    if (indices.length === 0) return;
    const sorted = [...indices].sort((a, b) => a - b);
    onMove(sorted, before);
    // dopo lo spostamento gli spread mossi sono contigui, a partire da quanti spread non mossi stanno davanti alla posizione
    const start = Array.from({ length: before }, (_, index) => index).filter((index) => !sorted.includes(index)).length;
    const next = sorted.map((_, offset) => start + offset);
    setSelected(next);
    anchor.current = next[0] ?? 0;
  };

  const select = (index: number, event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    if (event.shiftKey) {
      const from = Math.min(anchor.current, index);
      const to = Math.max(anchor.current, index);
      setSelected(Array.from({ length: to - from + 1 }, (_, offset) => from + offset));
      return;
    }
    anchor.current = index;
    if (event.ctrlKey || event.metaKey) setSelected((list) => (list.includes(index) ? list.filter((value) => value !== index) : [...list, index].sort((a, b) => a - b)));
    else setSelected([index]);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      const first = selected[0] ?? 0;
      const last = selected[selected.length - 1] ?? first;
      if (event.key === "Escape") { event.stopPropagation(); onClose(); return; }
      if (event.key === "Enter" && selected.length) { event.preventDefault(); onOpen(first); return; }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        const step = event.key === "ArrowLeft" ? -1 : 1;
        if (event.altKey && selected.length) {
          // Alt + freccia: porta gli spread selezionati un posto più in là
          if (step < 0 && first > 0) move(selected, first - 1);
          else if (step > 0 && last < total - 1) move(selected, last + 2);
          return;
        }
        const next = Math.min(Math.max((step < 0 ? first : last) + step, 0), total - 1);
        anchor.current = next;
        setSelected([next]);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const positionFor = (event: React.DragEvent, index: number): number => {
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientX < box.left + box.width / 2 ? index : index + 1;
  };

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Provino dell'album">
      <header className="sheet__head">
        <div>
          <h2>Provino</h2>
          <p className="muted small">{total} spread · trascina per cambiare l'ordine (Maiusc o Ctrl/⌘ per sceglierne più d'uno, Alt + ← → per spostare di un posto), doppio clic per aprire</p>
        </div>
        <label className="sheet__zoom" title="Dimensione delle miniature">
          <Icon name="grid" size={14} />
          <input type="range" min={SIZES.min} max={SIZES.max} step={10} value={size} onChange={(event) => setSize(Number(event.target.value))} aria-label="Dimensione delle miniature" />
        </label>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Chiudi il provino"><Icon name="close" /></button>
      </header>
      <div
        ref={gridRef}
        className="sheet__grid"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}
        onDragOver={(event) => { if (dragging.current && event.target === event.currentTarget) { event.preventDefault(); setDropAt(total); } }}
        onDrop={(event) => {
          if (!dragging.current || event.target !== event.currentTarget) return;
          event.preventDefault();
          const moving = dragging.current;
          dragging.current = null;
          setDropAt(null);
          move(moving, total);
        }}
      >
        {project.spreads.map((spread, index) => {
          const photos = spread.areas.reduce((sum, area) => sum + area.items.length, 0);
          const chapter = spread.areas.flatMap((area) => area.items).map((item) => chapterByAsset.get(item.assetId)).find(Boolean);
          const isSelected = selectedSet.has(index);
          return (
            <div
              key={spread.id}
              data-sheet-index={index}
              className={`sheet__item${isSelected ? " is-selected" : ""}${index === current ? " is-current" : ""}${dropAt === index ? " is-drop-before" : ""}${dropAt === total && index === total - 1 ? " is-drop-after" : ""}`}
              draggable
              role="button"
              tabIndex={0}
              aria-label={`Spread ${index + 1}${chapter ? `, ${chapter.title}` : ""}, ${photos} foto`}
              aria-pressed={isSelected}
              onClick={(event) => select(index, event)}
              onDoubleClick={() => onOpen(index)}
              onDragStart={(event) => {
                const moving = selectedSet.has(index) ? selected : [index];
                if (!selectedSet.has(index)) { setSelected([index]); anchor.current = index; }
                dragging.current = [...moving].sort((a, b) => a - b);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", "provino");
              }}
              onDragEnd={() => { dragging.current = null; setDropAt(null); }}
              onDragOver={(event) => {
                if (!dragging.current) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const position = positionFor(event, index);
                setDropAt((previous) => (previous === position ? previous : position));
              }}
              onDrop={(event) => {
                if (!dragging.current) return;
                event.preventDefault();
                event.stopPropagation();
                const moving = dragging.current;
                const position = positionFor(event, index);
                dragging.current = null;
                setDropAt(null);
                move(moving, position);
              }}
            >
              <span className="sheet__num">{index + 1}</span>
              <div className="sheet__thumb"><SpreadView sheet={project.settings.sheet} spread={spread} assets={assets} variant="thumb" /></div>
              <span className="sheet__bar" style={{ background: chapter?.color ?? "transparent" }} />
              <span className="sheet__meta">{photos} foto{chapter ? ` · ${chapter.title}` : ""}</span>
              {dropAt === index + 1 && index < total - 1 ? <span className="sheet__after" aria-hidden="true" /> : null}
              <div className="sheet__actions">
                <button type="button" className="icon-btn icon-btn--sm" title="Duplica lo spread" aria-label="Duplica lo spread" onClick={(event) => { event.stopPropagation(); onDuplicate(index); }}><Icon name="copy" size={12} /></button>
                <button type="button" className="icon-btn icon-btn--sm" title="Elimina lo spread" aria-label="Elimina lo spread" onClick={(event) => { event.stopPropagation(); onRemove(index); }}><Icon name="trash" size={12} /></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
