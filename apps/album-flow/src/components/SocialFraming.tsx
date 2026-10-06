import type { PhotoFraming, Slide } from "../social/types";
import { MAX_ZOOM, SHAPE_CHOICES } from "../social/types";

/** Inquadratura della foto scelta: zoom, forma della finestra e ritorno alla posizione di partenza (come nei fotolibri). */
export function SocialFraming({ slide, slot, onSlot, onChange, shapeLocked }: {
  slide: Slide;
  slot: number;
  onSlot: (slot: number) => void;
  /** `null` = torna all'inquadratura predefinita; la chiave serve a unire in un solo annullamento i movimenti continui. */
  onChange: (patch: Partial<PhotoFraming> | null, coalesceKey?: string) => void;
  /** Nei panorami le parti devono combaciare: la forma non si cambia. */
  shapeLocked: boolean;
}) {
  const framing = slide.framing?.[slot] ?? null;
  const zoom = framing?.zoom ?? 1;
  const shape = framing?.shape;
  const slots = slide.photos.length;
  return (
    <div className="social-framing">
      <h4>Inquadratura</h4>
      {slots > 1 ? (
        <div className="chips" role="group" aria-label="Foto da inquadrare">
          {slide.photos.map((_, index) => <button key={index} type="button" className={`chip${index === slot ? " is-active" : ""}`} onClick={() => onSlot(index)}>Foto {index + 1}</button>)}
        </div>
      ) : null}
      <label className="field social-framing__zoom">
        <span className="field__label">Zoom <strong>×{zoom.toFixed(2).replace(/0$/, "")}</strong></span>
        <input type="range" min={1} max={MAX_ZOOM} step={0.05} value={zoom} aria-label="Zoom della foto" onChange={(event) => onChange({ zoom: Number(event.target.value) }, `zoom:${slide.id}:${slot}`)} />
      </label>
      {shapeLocked ? null : (
        <div className="field">
          <span className="field__label">Forma della foto</span>
          <div className="chips" role="group" aria-label="Forma della foto">
            {SHAPE_CHOICES.map((choice) => (
              <button key={choice.label} type="button" className={`chip${(shape === undefined && choice.value === undefined) || (shape !== undefined && choice.value !== undefined && Math.abs(shape - choice.value) < 0.01) ? " is-active" : ""}`}
                onClick={() => onChange({ shape: choice.value })}>{choice.label}</button>
            ))}
          </div>
        </div>
      )}
      <div className="social-framing__row">
        <p className="muted small">Trascina la foto nell'anteprima per spostarla; con la rotella ingrandisci.</p>
        <button type="button" className="btn btn--sm btn--ghost" disabled={!framing} onClick={() => onChange(null)}>Ripristina</button>
      </div>
    </div>
  );
}
