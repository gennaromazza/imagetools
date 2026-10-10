import { useState } from "react";
import { SHAPE_PRESETS, presetForShape } from "../model/shapes";
import { Popover } from "./ui";

/** Piccolo rettangolo in scala con il rapporto dato (stesso ingombro massimo per tutti, così si confrontano a colpo d'occhio). */
function ShapeGlyph({ ratio, dashed = false, size = 18 }: { ratio: number; dashed?: boolean; size?: number }) {
  const w = ratio >= 1 ? size : size * ratio;
  const h = ratio >= 1 ? size / ratio : size;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shape-glyph">
      <rect x={(size - w) / 2 + 0.75} y={(size - h) / 2 + 0.75} width={Math.max(2, w - 1.5)} height={Math.max(2, h - 1.5)} rx="1.5" fill={dashed ? "none" : "currentColor"} fillOpacity={dashed ? 0 : 0.28} stroke="currentColor" strokeWidth="1.5" strokeDasharray={dashed ? "2.5 2" : undefined} />
    </svg>
  );
}

export interface ShapePickerProps {
  /** Forma attuale della foto (rapporto larghezza/altezza), assente se segue la cella. */
  shape: number | undefined;
  /** Rapporto dell'originale, per «Originale della foto». */
  originalAspect: number;
  onPick: (shape: number | null) => void;
  /** Etichetta «Nuovo» finché la funzione non è stata vista. */
  isNew?: boolean;
  onSeen?: () => void;
}

/**
 * Formato della foto scelto con piccole icone in scala (1:1, 3:2, 2:3…) invece di un menu con le scritte: un solo pulsante nella barra, che mostra
 * la forma attuale, e una griglia compatta che si apre solo quando serve. Il nome completo sta nella descrizione di ogni icona.
 */
export function ShapePicker({ shape, originalAspect, onPick, isNew = false, onSeen }: ShapePickerProps) {
  const [open, setOpen] = useState(false);
  const preset = presetForShape(shape);
  const isOriginal = Boolean(shape) && !preset && Math.abs((shape ?? 1) / originalAspect - 1) < 0.01;
  const isCustom = Boolean(shape) && !preset && !isOriginal;
  const currentLabel = !shape ? "Come la cella" : preset ? preset.label : isOriginal ? "Originale della foto" : "Personalizzata";
  const pick = (value: number | null) => { onPick(value); setOpen(false); };
  return (
    <div className="anchor">
      <button type="button" className={`icon-btn shape-btn${open || shape ? " is-active" : ""}`} aria-label={`Formato della foto: ${currentLabel}`} aria-expanded={open} title={`Formato della foto: ${currentLabel}`} onClick={() => { onSeen?.(); setOpen((on) => !on); }}>
        <ShapeGlyph ratio={shape ?? 1} dashed={!shape} size={18} />
      </button>
      {isNew ? <span className="new-dot" aria-hidden="true" /> : null}
      <Popover open={open} onClose={() => setOpen(false)} side="top" className="popover--info">
        <div className="shape-grid" role="group" aria-label="Formato della foto">
          <button type="button" className={`shape-opt${!shape ? " is-current" : ""}`} title="Come la cella: la foto riempie lo spazio che il layout le dà" aria-label="Come la cella" onClick={() => pick(null)}><ShapeGlyph ratio={1} dashed size={22} /></button>
          <button type="button" className={`shape-opt${isOriginal ? " is-current" : ""}`} title="Originale della foto: le sue proporzioni" aria-label="Originale della foto" onClick={() => pick(Number(originalAspect.toFixed(4)))}><ShapeGlyph ratio={originalAspect} size={22} /></button>
          {SHAPE_PRESETS.map((entry) => (
            <button key={entry.id} type="button" className={`shape-opt${preset?.id === entry.id ? " is-current" : ""}`} title={entry.label} aria-label={entry.label} onClick={() => pick(entry.ratio)}>
              <ShapeGlyph ratio={entry.ratio} size={22} /><small>{entry.id}</small>
            </button>
          ))}
          {isCustom ? <span className="shape-custom small muted">Personalizzata</span> : null}
        </div>
        <p className="small muted shape-current">{currentLabel}</p>
      </Popover>
    </div>
  );
}
