import { useEffect, useMemo, useRef, useState } from "react";

type Boundary = "start" | "end";

interface Props {
  label: string;
  value: string;
  boundary: Boundary;
  invalid?: boolean;
  onChange: (value: string) => void;
}

const MONTH_FORMATTER = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" });
const DATE_FORMATTER = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short", year: "numeric" });
const WEEK_DAYS = ["L", "M", "M", "G", "V", "S", "D"];

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseValue(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function hasCustomTime(value: string, boundary: Boundary): boolean {
  const time = value.match(/T(\d{2}:\d{2})/)?.[1];
  return time !== undefined && time !== (boundary === "start" ? "00:00" : "23:59");
}

function valueForDate(date: Date, boundary: Boundary, time?: string): string {
  const safeTime = time ?? (boundary === "start" ? "00:00" : "23:59");
  return `${dateKey(date)}T${safeTime}`;
}

export function DateFilterPicker({ label, value, boundary, invalid = false, onChange }: Props) {
  const selectedDate = parseValue(value);
  const [open, setOpen] = useState(false);
  const [showTime, setShowTime] = useState(() => hasCustomTime(value, boundary));
  const [month, setMonth] = useState(() => selectedDate ? new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1) : new Date());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const time = value.match(/T(\d{2}:\d{2})/)?.[1] ?? (boundary === "start" ? "00:00" : "23:59");

  useEffect(() => {
    if (selectedDate) setMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  }, [value]);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return Array.from({ length: offset + count }, (_, index) => index < offset ? null : new Date(month.getFullYear(), month.getMonth(), index - offset + 1));
  }, [month]);

  function selectDate(date: Date) {
    onChange(valueForDate(date, boundary, showTime ? time : undefined));
    setOpen(false);
  }

  return <div className="field date-filter-picker" ref={rootRef}>
    <span>{label}</span>
    <div className={`date-filter-picker__control${invalid ? " date-filter-picker__control--invalid" : ""}`}>
      <button type="button" className="date-filter-picker__trigger" onClick={() => setOpen((current) => !current)} aria-haspopup="dialog" aria-expanded={open}>
        <span aria-hidden="true">▣</span>
        {selectedDate ? DATE_FORMATTER.format(selectedDate) : "Seleziona una data"}
      </button>
      {value && <button type="button" className="date-filter-picker__clear" onClick={() => onChange("")} aria-label={`Cancella ${label}`}>×</button>}
    </div>
    {open && <div className="date-filter-picker__popover" role="dialog" aria-label={label}>
      <div className="date-filter-picker__month">
        <button type="button" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} aria-label="Mese precedente">‹</button>
        <strong>{MONTH_FORMATTER.format(month)}</strong>
        <button type="button" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} aria-label="Mese successivo">›</button>
      </div>
      <div className="date-filter-picker__weekdays">{WEEK_DAYS.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
      <div className="date-filter-picker__days">
        {days.map((day, index) => day ? <button key={dateKey(day)} type="button" onClick={() => selectDate(day)} className={dateKey(day) === (selectedDate ? dateKey(selectedDate) : "") ? "is-selected" : dateKey(day) === dateKey(new Date()) ? "is-today" : ""}>{day.getDate()}</button> : <span key={`blank-${index}`} />)}
      </div>
      <div className="date-filter-picker__footer">
        <button type="button" className="date-filter-picker__today" onClick={() => selectDate(new Date())}>Oggi</button>
        <label><input type="checkbox" checked={showTime} onChange={(event) => { const next = event.target.checked; setShowTime(next); if (selectedDate) onChange(valueForDate(selectedDate, boundary, next ? time : undefined)); }} /> Orario preciso</label>
      </div>
      {showTime && <label className="date-filter-picker__time"><span>Orario</span><input type="time" value={time} onChange={(event) => selectedDate && onChange(valueForDate(selectedDate, boundary, event.target.value))} /></label>}
    </div>}
  </div>;
}
