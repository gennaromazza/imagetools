import { type CSSProperties, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";

// ---------------------------------------------------------------------------
// Finestre
// ---------------------------------------------------------------------------

export function Modal({ title, onClose, children, footer, wide = false, subtitle }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; subtitle?: string }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`modal__card${wide ? " modal__card--wide" : ""}`}>
        <header className="modal__head">
          <div><h2>{title}</h2>{subtitle ? <p className="muted small">{subtitle}</p> : null}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Chiudi"><Icon name="close" /></button>
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" className={option.value === value ? "is-active" : ""} aria-pressed={option.value === value} onClick={() => onChange(option.value)}>{option.label}</button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch__track" aria-hidden="true"><span className="switch__thumb" /></span>
      <span>{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Stelle
// ---------------------------------------------------------------------------

export function Stars({ value, onChange, size = 12, label = "Valutazione" }: { value?: number; onChange?: (value: number) => void; size?: number; label?: string }) {
  const current = Math.max(0, Math.min(5, Math.round(value ?? 0)));
  const [hover, setHover] = useState(0);
  const shown = hover || current;
  return (
    <span className={`stars${onChange ? " stars--edit" : ""}`} role={onChange ? "radiogroup" : "img"} aria-label={`${label}: ${current} su 5`} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= shown;
        const icon = <Icon name="star" size={size} strokeWidth={1.5} style={{ fill: filled ? "currentColor" : "none" }} />;
        return onChange ? (
          <button key={star} type="button" role="radio" aria-checked={current === star} aria-label={`${star} ${star === 1 ? "stella" : "stelle"}`} className={filled ? "is-on" : ""}
            onMouseEnter={() => setHover(star)} onClick={(event) => { event.stopPropagation(); onChange(star === current ? 0 : star); }}>{icon}</button>
        ) : (
          <span key={star} className={filled ? "is-on" : ""}>{icon}</span>
        );
      })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Popover e menu contestuale
// ---------------------------------------------------------------------------

/**
 * Pannello ancorato al contenitore `.anchor` che lo racchiude. Viene disegnato in un portale a posizione fissa,
 * così non viene mai tagliato dalle strisce o dai pannelli con scorrimento; si chiude con clic fuori o Esc.
 */
export function Popover({ open, onClose, children, side = "right", className = "" }: { open: boolean; onClose: () => void; children: ReactNode; side?: "left" | "right" | "top" | "bottom"; className?: string }) {
  const marker = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  const place = useCallback(() => {
    const anchor = marker.current?.parentElement;
    const box = panel.current;
    if (!anchor || !box) return;
    const a = anchor.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    let left: number;
    let top: number;
    if (side === "right") { left = a.right + 10; top = a.top; }
    else if (side === "left") { left = a.left - 10 - b.width; top = a.top; }
    else if (side === "top") { left = a.right - b.width; top = a.top - 8 - b.height; }
    else { left = a.right - b.width; top = a.bottom + 8; }
    left = Math.max(8, Math.min(left, window.innerWidth - b.width - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - b.height - 8));
    setPosition((current) => (current && Math.abs(current.left - left) < 0.5 && Math.abs(current.top - top) < 0.5 ? current : { left, top }));
  }, [side]);

  useLayoutEffect(() => {
    if (!open) { setPosition(null); return; }
    place();
  }, [open, place, children]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const anchor = marker.current?.parentElement;
      if (anchor?.contains(target) || panel.current?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", place);
    return () => { document.removeEventListener("mousedown", onDown, true); window.removeEventListener("keydown", onKey, true); window.removeEventListener("resize", place); };
  }, [open, onClose, place]);

  return (
    <>
      <span ref={marker} hidden />
      {open ? createPortal(
        <div ref={panel} className={`popover ${className}`} role="dialog" style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" }}>{children}</div>,
        document.body,
      ) : null}
    </>
  );
}

export interface MenuItem {
  label: string;
  icon?: IconName;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  /** Voci annidate: si aprono a lato. */
  children?: MenuItem[];
  hint?: string;
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  const [openSub, setOpenSub] = useState<number | null>(null);

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPosition({ x: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)) });
  }, [x, y, items.length]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => { document.removeEventListener("mousedown", onDown, true); window.removeEventListener("keydown", onKey, true); window.removeEventListener("blur", onClose); window.removeEventListener("resize", onClose); };
  }, [onClose]);

  const render = (list: MenuItem[], nested: boolean) => (
    <ul className={`menu${nested ? " menu--nested" : ""}`} role="menu" ref={nested ? (element) => {
      // Il sottomenu resta dentro lo schermo: se esce dal basso si sposta in su, se esce a destra si apre a sinistra.
      if (!element) return;
      const box = element.getBoundingClientRect();
      const below = box.bottom - (window.innerHeight - 8);
      if (below > 0) element.style.top = `${-6 - below}px`;
      if (box.right > window.innerWidth - 8) { element.style.left = "auto"; element.style.right = "calc(100% - 4px)"; }
    } : undefined}>
      {list.map((item, index) => item.separator ? <li key={`s${index}`} className="menu__sep" role="separator" /> : (
        <li key={item.label} role="none" onMouseEnter={() => { if (!nested) setOpenSub(item.children ? index : null); }}>
          <button type="button" role="menuitem" className={`menu__item${item.danger ? " menu__item--danger" : ""}`} disabled={item.disabled}
            onClick={() => { if (item.children) { setOpenSub(index); return; } item.onClick?.(); onClose(); }}>
            {item.icon ? <Icon name={item.icon} size={15} /> : <span className="menu__icon" />}
            <span className="menu__label">{item.label}</span>
            {item.hint ? <kbd>{item.hint}</kbd> : null}
            {item.children ? <Icon name="chevronRight" size={13} /> : null}
          </button>
          {item.children && openSub === index ? render(item.children, true) : null}
        </li>
      ))}
    </ul>
  );

  return createPortal(<div ref={ref} className="menu-root" style={{ left: position.x, top: position.y }}>{render(items, false)}</div>, document.body);
}

// ---------------------------------------------------------------------------
// Campo numerico con trascinamento (stile strumenti di impaginazione)
// ---------------------------------------------------------------------------

const formatNumber = (value: number) => value.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parseNumber = (text: string) => Number.parseFloat(text.replace(",", "."));

export function NumberField({ label, value, min, max, step, onChange, title }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; title?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const scrub = useRef<{ startY: number; start: number } | null>(null);
  const clamp = useCallback((next: number) => Math.min(max, Math.max(min, Math.round(next / step) * step)), [max, min, step]);
  // Rotellina del mouse sopra il campo (senza doverlo selezionare): su aumenta, giù diminuisce; Maiusc = passi da 10.
  const wrapper = useRef<HTMLDivElement>(null);
  const live = useRef({ value, step, onChange, clamp });
  live.current = { value, step, onChange, clamp };
  useEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const { value: current, step: unit, onChange: change, clamp: fit } = live.current;
      const next = Number(fit(current + (event.deltaY < 0 ? 1 : -1) * unit * (event.shiftKey ? 10 : 1)).toFixed(3));
      if (next !== current) { change(next); setDraft(null); }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);
  const commit = (text: string) => {
    const parsed = parseNumber(text);
    if (Number.isFinite(parsed)) onChange(Number(clamp(parsed).toFixed(3)));
    setDraft(null);
  };
  return (
    <div ref={wrapper} className="numfield" title={title ? `${title} Rotellina del mouse: cambia il valore (Maiusc = più veloce).` : "Rotellina del mouse: cambia il valore (Maiusc = più veloce)."}>
      <span
        className="numfield__label"
        onPointerDown={(event) => { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); scrub.current = { startY: event.clientY, start: value }; }}
        onPointerMove={(event) => { if (scrub.current) onChange(Number(clamp(scrub.current.start + ((scrub.current.startY - event.clientY) / 6) * step).toFixed(3))); }}
        onPointerUp={() => { scrub.current = null; }}
      >{label}</span>
      <input
        className="numfield__input"
        inputMode="decimal"
        aria-label={`${label} in centimetri`}
        value={draft ?? formatNumber(value)}
        onFocus={(event) => { setDraft(formatNumber(value)); event.target.select(); }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => { if (draft !== null) commit(draft); }}
        onKeyDown={(event) => {
          if (event.key === "Enter") { commit(draft ?? formatNumber(value)); (event.target as HTMLInputElement).blur(); }
          else if (event.key === "Escape") { setDraft(null); (event.target as HTMLInputElement).blur(); }
          else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            const delta = (event.key === "ArrowUp" ? 1 : -1) * step * (event.shiftKey ? 10 : 1);
            onChange(Number(clamp(value + delta).toFixed(3)));
            setDraft(null);
          }
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Colori
// ---------------------------------------------------------------------------

export function ColorDots({ value, swatches, onChange, label }: { value: string; swatches: readonly string[]; onChange: (color: string) => void; label: string }) {
  const custom = !swatches.includes(value.toLowerCase());
  return (
    <div className="dots" role="group" aria-label={label}>
      {swatches.map((color) => (
        <button key={color} type="button" className={`dot${value.toLowerCase() === color ? " is-active" : ""}`} style={{ background: color } as CSSProperties} onClick={() => onChange(color)} aria-label={`${label} ${color}`} aria-pressed={value.toLowerCase() === color} />
      ))}
      <label className={`dot dot--custom${custom ? " is-active" : ""}`} title="Colore personalizzato" style={custom ? ({ background: value } as CSSProperties) : undefined}>
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"} onChange={(event) => onChange(event.target.value)} aria-label={`${label} personalizzato`} />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pulsante con icona e suggerimento
// ---------------------------------------------------------------------------

export function IconButton({ icon, label, onClick, active, disabled, size = 18, danger, className = "" }: { icon: IconName; label: string; onClick?: () => void; active?: boolean; disabled?: boolean; size?: number; danger?: boolean; className?: string }) {
  return (
    <button type="button" className={`icon-btn${active ? " is-active" : ""}${danger ? " icon-btn--danger" : ""} ${className}`} title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={size} />
    </button>
  );
}
