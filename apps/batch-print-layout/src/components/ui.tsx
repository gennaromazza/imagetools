import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export function NumberField({ label, value, min, max, step, disabled, suffix, onChange, onClamp }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  suffix?: string;
  onChange: (value: number) => void;
  /** Chiamata quando il valore digitato viene riportato nei limiti. */
  onClamp?: (requested: number, applied: number) => void;
}) {
  // Bozza testuale: il valore digitato non viene forzato a min/max a ogni tasto
  // (scrivere "15" con minimo 2 diventava "2" e poi "25"). Si applica solo se
  // valido; al termine (blur/Invio) viene riportato nell'intervallo consentito.
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Valore cambiato dall'esterno mentre il campo non è in uso: mostra quello reale.
    if (draft !== null && Number(draft) !== value && document.activeElement !== inputRef.current) {
      setDraft(null);
    }
  }, [value, draft]);

  const shown = draft ?? (Number.isFinite(value) ? String(value) : "");

  const commit = (text: string) => {
    const next = Number(text.replace(",", "."));
    if (text.trim() !== "" && Number.isFinite(next)) {
      const clamped = Math.min(max, Math.max(min, next));
      if (clamped !== next) onClamp?.(next, clamped);
      if (clamped !== value) onChange(clamped);
    }
    setDraft(null);
  };

  return (
    <label className="field">
      <span>{label}</span>
      <span className="field__control">
        <input
          ref={inputRef}
          type="number"
          inputMode="decimal"
          value={shown}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => {
            const text = event.currentTarget.value;
            setDraft(text);
            const next = Number(text);
            if (text.trim() !== "" && Number.isFinite(next) && next >= min && next <= max && next !== value) {
              onChange(next);
            }
          }}
          onBlur={(event) => commit(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit(event.currentTarget.value);
          }}
        />
        {suffix ? <em>{suffix}</em> : null}
      </span>
    </label>
  );
}

export function RangeField({ label, value, min, max, step, suffix, disabled, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field range-field">
      <span>{label}<strong>{value}{suffix}</strong></span>
      <input type="range" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

export function SelectField({ label, value, options, disabled, onChange }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function TextField({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="text" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function SegmentedField({ label, value, options, onChange }: {
  label?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      {label ? <span>{label}</span> : null}
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={value === option.value ? "segmented__item segmented__item--active" : "segmented__item"}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Fold({ title, children, defaultOpen }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="fold" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="fold__body">{children}</div>
    </details>
  );
}

export function Callout({ tone, children }: { tone: "advice" | "warning" | "info"; children: ReactNode }) {
  return <div className={`callout callout--${tone}`} role={tone === "warning" ? "alert" : undefined}>{children}</div>;
}
