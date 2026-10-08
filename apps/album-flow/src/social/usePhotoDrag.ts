import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoSpot } from "./edit";

/**
 * Trascinamento di una foto da uno spazio a un altro (anche di un'altra slide). Funziona a puntatore, quindi vale per l'anteprima
 * (SVG), le miniature degli spazi e la striscia delle slide. Chi lo usa dice cosa c'è sotto il puntatore (`resolve`) e cosa fare al rilascio.
 */

export type DropTarget = { kind: "slot"; slideId: string; slot: number } | { kind: "slide"; slideId: string };

export interface PhotoDragState {
  from: PhotoSpot;
  assetId: string;
  x: number;
  y: number;
  over: DropTarget | null;
}

const THRESHOLD = 5;

export function usePhotoDrag(options: {
  resolve: (clientX: number, clientY: number) => DropTarget | null;
  onDrop: (from: PhotoSpot, assetId: string, target: DropTarget) => void;
}) {
  const [state, setState] = useState<PhotoDragState | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  /** `immediate` = il trascinamento è già iniziato (l'anteprima ha già superato la soglia). */
  const begin = useCallback((from: PhotoSpot, assetId: string, start: { clientX: number; clientY: number; pointerId?: number }, immediate = false) => {
    cleanup.current?.();
    let active = immediate;
    let last: PhotoDragState | null = null;
    const update = (clientX: number, clientY: number) => {
      last = { from, assetId, x: clientX, y: clientY, over: latest.current.resolve(clientX, clientY) };
      setState(last);
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
      window.removeEventListener("keydown", onKey, true);
      cleanup.current = null;
      setState(null);
    };
    const onMove = (event: PointerEvent) => {
      if (!active) {
        if (Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) < THRESHOLD) return;
        active = true;
      }
      update(event.clientX, event.clientY);
    };
    const onUp = (event: PointerEvent) => {
      const wasActive = active;
      const target = wasActive ? latest.current.resolve(event.clientX, event.clientY) : null;
      stop();
      if (!wasActive) return;
      // Dopo un trascinamento vero il clic che segue il rilascio non deve aprire nulla (per esempio la scelta della foto).
      const swallow = (click: MouseEvent) => { click.stopPropagation(); click.preventDefault(); };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      if (target) latest.current.onDrop(from, assetId, target);
    };
    const onCancel = () => stop();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); stop(); } };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("keydown", onKey, true);
    cleanup.current = stop;
    if (immediate) update(start.clientX, start.clientY);
    void last;
  }, []);

  return { drag: state, begin };
}
