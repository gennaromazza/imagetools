import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { BuildEnv } from "./build";
import { focusRange, rotateDelta } from "./framing";
import { photoAt } from "./hit";
import { coverFit } from "./kit";
import type { Layer, PhotoFraming } from "./types";

/**
 * Interazione diretta con l'anteprima grande: trascinare una foto per spostarla nel suo spazio, rotella per lo zoom, clic su un testo
 * per modificarlo. Tutto si ricava dai livelli già calcolati: nessuna logica di layout qui.
 * La foto sotto il puntatore si trova per geometria, quindi funziona anche sotto sfumature e testi; un testo sopra una foto
 * si modifica con un clic e, trascinando, muove la foto.
 */

export type PreviewMode = "frame" | "move";

export interface PreviewInteraction {
  wrapRef: RefObject<HTMLDivElement | null>;
  layers: readonly Layer[];
  env: BuildEnv;
  /** Larghezza della tela in pixel (1080): serve a passare dai pixel dello schermo a quelli della slide. */
  canvasWidth: number;
  slideId: string | undefined;
  /** «frame» = il trascinamento inquadra la foto nel suo spazio; «move» = la sposta su un'altra foto o slide. */
  mode: PreviewMode;
  onFraming: (slot: number, patch: Partial<PhotoFraming>, coalesceKey: string) => void;
  onSlot: (slot: number) => void;
  onField: (field: string) => void;
  /** Clic su uno spazio foto vuoto. */
  onEmptySlot: (slot: number) => void;
  /** Inizia lo spostamento di una foto (modo «move»): da qui in poi se ne occupa chi ascolta la finestra. */
  onMoveStart: (slot: number, assetId: string, event: { clientX: number; clientY: number; pointerId: number }) => void;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const THRESHOLD = 4;

interface Drag {
  slot: number;
  assetId: string;
  startX: number;
  startY: number;
  cx: number;
  cy: number;
  fitW: number;
  fitH: number;
  rangeX: [number, number];
  rangeY: [number, number];
  scale: number;
  pointer: number;
  rotation: number;
  /** Il clic è partito su un testo: se il puntatore non si muove, si modifica il testo. */
  field: string | null;
  started: boolean;
  captured: boolean;
}

export function usePreviewInteraction(options: PreviewInteraction) {
  const latest = useRef(options);
  latest.current = options;
  const drag = useRef<Drag | null>(null);
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

  /** Pixel dello schermo → pixel della slide (sempre 1080 di larghezza). */
  const toSlide = (clientX: number, clientY: number) => {
    const current = latest.current;
    const svg = current.wrapRef.current?.querySelector("svg");
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const scale = current.canvasWidth / rect.width;
    return { x: (clientX - rect.left) * scale, y: (clientY - rect.top) * scale, scale };
  };

  // La rotella deve poter annullare lo scorrimento della pagina: serve un ascoltatore non passivo.
  // L'anteprima può comparire dopo il primo disegno (per esempio dopo la creazione guidata): si ricollega a ogni cambio di elemento.
  const wheelOn = useRef<HTMLDivElement | null>(null);
  const onWheel = useRef((event: WheelEvent) => {
    const current = latest.current;
    if (!current.slideId) return;
    const point = toSlide(event.clientX, event.clientY);
    const layer = point ? photoAt(current.layers, point.x, point.y) : null;
    if (!layer || !layer.assetId) return;
    event.preventDefault();
    current.onSlot(layer.slot);
    const zoom = clamp(layer.zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08), 1, 4);
    current.onFraming(layer.slot, { zoom }, `zoom:${current.slideId}:${layer.slot}`);
  });
  useEffect(() => {
    const element = options.wrapRef.current;
    if (element === wheelOn.current) return;
    wheelOn.current?.removeEventListener("wheel", onWheel.current);
    wheelOn.current = element;
    element?.addEventListener("wheel", onWheel.current, { passive: false });
  });
  useEffect(() => () => { wheelOn.current?.removeEventListener("wheel", onWheel.current); wheelOn.current = null; }, []);

  return {
    onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
      const current = latest.current;
      if (!current.slideId || event.button !== 0) return;
      const target = event.target as Element | null;
      const field = target?.closest?.("[data-field]")?.getAttribute("data-field") ?? null;
      const point = toSlide(event.clientX, event.clientY);
      const layer = point ? photoAt(current.layers, point.x, point.y) : null;
      if (!layer || !point) { if (field) current.onField(field); return; }
      if (!layer.assetId) {
        if (field) current.onField(field); else current.onEmptySlot(layer.slot);
        return;
      }
      const ref = current.env.photos.get(layer.assetId);
      if (!ref) { if (field) current.onField(field); return; }
      const fit = coverFit(layer, ref.aspect, layer.zoom, layer.cx, layer.cy);
      drag.current = {
        slot: layer.slot, assetId: layer.assetId, startX: event.clientX, startY: event.clientY, cx: layer.cx, cy: layer.cy, fitW: fit.w, fitH: fit.h,
        rangeX: focusRange(layer.w, fit.w), rangeY: focusRange(layer.h, fit.h), scale: point.scale, pointer: event.pointerId, rotation: layer.rotation ?? 0,
        field, started: false, captured: false,
      };
      current.onSlot(layer.slot);
      if (current.mode === "frame") { event.currentTarget.setPointerCapture(event.pointerId); drag.current.captured = true; }
      event.preventDefault();
    },
    onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
      const state = drag.current;
      if (!state || event.pointerId !== state.pointer) return;
      if (!state.started) {
        if (Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < THRESHOLD) return;
        state.started = true;
        if (latest.current.mode === "move") {
          drag.current = null;
          latest.current.onMoveStart(state.slot, state.assetId, { clientX: state.startX, clientY: state.startY, pointerId: state.pointer });
          return;
        }
      }
      // Trascinando la foto verso destra si vede più il suo lato sinistro: il centro dell'inquadratura va all'indietro.
      const { dx, dy } = rotateDelta((event.clientX - state.startX) * state.scale, (event.clientY - state.startY) * state.scale, state.rotation);
      pending.current = { slot: state.slot, cx: clamp(state.cx - dx / state.fitW, state.rangeX[0], state.rangeX[1]), cy: clamp(state.cy - dy / state.fitH, state.rangeY[0], state.rangeY[1]) };
      if (!frame.current) frame.current = requestAnimationFrame(flush);
    },
    onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
      const state = drag.current;
      if (!state) return;
      if (frame.current) { cancelAnimationFrame(frame.current); flush(); }
      drag.current = null;
      if (state.captured && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      // Nessun trascinamento: era un clic su un testo.
      if (!state.started && state.field && event.type === "pointerup") latest.current.onField(state.field);
    },
  };
}
