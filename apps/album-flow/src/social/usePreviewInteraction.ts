import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { BuildEnv } from "./build";
import { focusRange, rotateDelta } from "./framing";
import { coverFit } from "./kit";
import type { Layer, PhotoFraming, PhotoLayer } from "./types";

/**
 * Interazione diretta con l'anteprima grande: trascinare una foto per spostarla nel suo spazio, rotella per lo zoom, clic su un testo
 * per modificarlo. Tutto si ricava dai livelli già calcolati: nessuna logica di layout qui.
 */

export interface PreviewInteraction {
  wrapRef: RefObject<HTMLDivElement | null>;
  layers: readonly Layer[];
  env: BuildEnv;
  /** Larghezza della tela in pixel (1080): serve a passare dai pixel dello schermo a quelli della slide. */
  canvasWidth: number;
  slideId: string | undefined;
  onFraming: (slot: number, patch: Partial<PhotoFraming>, coalesceKey: string) => void;
  onSlot: (slot: number) => void;
  onField: (field: string) => void;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

function photoLayer(layers: readonly Layer[], slot: number): PhotoLayer | undefined {
  return layers.find((layer): layer is PhotoLayer => layer.kind === "photo" && layer.slot === slot && !layer.blur && Boolean(layer.assetId));
}

export function usePreviewInteraction(options: PreviewInteraction) {
  const latest = useRef(options);
  latest.current = options;
  const drag = useRef<null | { slot: number; startX: number; startY: number; cx: number; cy: number; fitW: number; fitH: number; rangeX: [number, number]; rangeY: [number, number]; scale: number; pointer: number; rotation: number }>(null);
  const frame = useRef(0);
  const pending = useRef<null | { slot: number; cx: number; cy: number }>(null);

  const flush = () => {
    frame.current = 0;
    const next = pending.current;
    pending.current = null;
    const current = latest.current;
    if (next && current.slideId) current.onFraming(next.slot, { cx: next.cx, cy: next.cy }, `move:${current.slideId}:${next.slot}`);
  };

  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);

  // La rotella deve poter annullare lo scorrimento della pagina: serve un ascoltatore non passivo.
  useEffect(() => {
    const element = options.wrapRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const current = latest.current;
      const target = event.target as Element | null;
      const holder = target?.closest?.("[data-photo-slot]");
      if (!holder || !current.slideId) return;
      const slot = Number(holder.getAttribute("data-photo-slot"));
      const layer = photoLayer(current.layers, slot);
      if (!layer) return;
      event.preventDefault();
      current.onSlot(slot);
      const zoom = clamp(layer.zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08), 1, 4);
      current.onFraming(slot, { zoom }, `zoom:${current.slideId}:${slot}`);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [options.wrapRef]);

  return {
    onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
      const current = latest.current;
      const target = event.target as Element | null;
      const textHolder = target?.closest?.("[data-field]");
      if (textHolder) { current.onField(textHolder.getAttribute("data-field")!); return; }
      const holder = target?.closest?.("[data-photo-slot]");
      if (!holder || !current.slideId || event.button !== 0) return;
      const slot = Number(holder.getAttribute("data-photo-slot"));
      const layer = photoLayer(current.layers, slot);
      const ref = layer?.assetId ? current.env.photos.get(layer.assetId) : undefined;
      const svg = current.wrapRef.current?.querySelector("svg");
      if (!layer || !ref || !svg) return;
      const fit = coverFit(layer, ref.aspect, layer.zoom, layer.cx, layer.cy);
      drag.current = {
        slot, startX: event.clientX, startY: event.clientY, cx: layer.cx, cy: layer.cy, fitW: fit.w, fitH: fit.h,
        rangeX: focusRange(layer.w, fit.w), rangeY: focusRange(layer.h, fit.h), scale: current.canvasWidth / Math.max(1, svg.getBoundingClientRect().width), pointer: event.pointerId, rotation: layer.rotation ?? 0,
      };
      current.onSlot(slot);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
      const state = drag.current;
      if (!state || event.pointerId !== state.pointer) return;
      // Trascinando la foto verso destra si vede più il suo lato sinistro: il centro dell'inquadratura va all'indietro.
      const { dx, dy } = rotateDelta((event.clientX - state.startX) * state.scale, (event.clientY - state.startY) * state.scale, state.rotation);
      pending.current = { slot: state.slot, cx: clamp(state.cx - dx / state.fitW, state.rangeX[0], state.rangeX[1]), cy: clamp(state.cy - dy / state.fitH, state.rangeY[0], state.rangeY[1]) };
      if (!frame.current) frame.current = requestAnimationFrame(flush);
    },
    onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
      if (!drag.current) return;
      if (frame.current) { cancelAnimationFrame(frame.current); flush(); }
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    },
  };
}
