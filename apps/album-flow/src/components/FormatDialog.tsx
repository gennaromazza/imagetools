import { useState } from "react";
import type { SheetSpec } from "@photo-tools/shared-types";
import { COMMON_FORMATS, UNIT_LABELS, formatKey, formatLabel, fromCm, isValidFormat, sheetFromFormat, toCm, type LengthUnit } from "../model/formats";
import { Field, Modal } from "./ui";

/** Cambia il formato di un album già creato: i layout si ricalcolano sul nuovo foglio e le foto non si deformano. */
export function FormatDialog({ sheet, onApply, onClose }: { sheet: SheetSpec; onApply: (sheet: SheetSpec) => void; onClose: () => void }) {
  const [format, setFormat] = useState({ widthCm: sheet.widthCm, heightCm: sheet.heightCm });
  const [unit, setUnit] = useState<LengthUnit>("cm");
  const [dpi, setDpi] = useState(String(sheet.dpi));
  const [bleed, setBleed] = useState(String(sheet.bleedCm));
  const [safe, setSafe] = useState(String(sheet.marginCm));
  const valid = isValidFormat(format) && Number(dpi) >= 72 && Number(dpi) <= 1200 && Number(bleed) >= 0 && Number(safe) >= 0 && Number(safe) * 2 < Math.min(format.widthCm, format.heightCm);
  const setDimension = (key: "widthCm" | "heightCm", text: string) => {
    const value = Number.parseFloat(text.replace(",", "."));
    if (Number.isFinite(value)) setFormat((current) => ({ ...current, [key]: Number(toCm(value, unit).toFixed(2)) }));
  };
  const apply = () => { if (valid) onApply({ ...sheetFromFormat(format, sheet), dpi: Number(dpi), bleedCm: Number(bleed), marginCm: Number(safe) }); };
  return (
    <Modal title="Formato dell'album" subtitle="Misure di una singola pagina. Le foto restano dove sono: i layout si adattano al nuovo foglio." onClose={onClose} footer={<>
      <button type="button" className="btn" onClick={onClose}>Annulla</button>
      <button type="button" className="btn btn--primary" disabled={!valid} onClick={apply}>Applica il formato</button>
    </>}>
      <div className="formats">
        {COMMON_FORMATS.map((item) => (
          <button key={formatKey(item)} type="button" className={`format__pick${formatKey(item) === formatKey(format) ? " is-active" : ""}`} onClick={() => setFormat({ widthCm: item.widthCm, heightCm: item.heightCm })}><strong>{formatLabel(item)}</strong></button>
        ))}
      </div>
      <div className="grid-3">
        <Field label="Larghezza pagina"><input className="input" inputMode="decimal" value={fromCm(format.widthCm, unit)} onChange={(event) => setDimension("widthCm", event.target.value)} /></Field>
        <Field label="Altezza pagina"><input className="input" inputMode="decimal" value={fromCm(format.heightCm, unit)} onChange={(event) => setDimension("heightCm", event.target.value)} /></Field>
        <Field label="Unità"><select className="select" value={unit} onChange={(event) => setUnit(event.target.value as LengthUnit)}>{(Object.keys(UNIT_LABELS) as LengthUnit[]).map((key) => <option key={key} value={key}>{UNIT_LABELS[key]}</option>)}</select></Field>
      </div>
      <div className="grid-3">
        <Field label="Risoluzione (dpi)"><input className="input" inputMode="numeric" value={dpi} onChange={(event) => setDpi(event.target.value)} /></Field>
        <Field label="Abbondanza (cm)"><input className="input" inputMode="decimal" value={bleed} onChange={(event) => setBleed(event.target.value)} /></Field>
        <Field label="Zona sicura (cm)"><input className="input" inputMode="decimal" value={safe} onChange={(event) => setSafe(event.target.value)} /></Field>
      </div>
      <p className="notice">Album chiuso (una pagina): <strong>{format.widthCm.toLocaleString("it-IT")} × {format.heightCm.toLocaleString("it-IT")} cm</strong> → spread aperto: <strong>{(format.widthCm * 2).toLocaleString("it-IT")} × {format.heightCm.toLocaleString("it-IT")} cm</strong> (larghezza × altezza)</p>
      {!isValidFormat(format) ? <p className="notice notice--warn">Il formato di una pagina deve stare tra 5 e 100 cm.</p> : null}
    </Modal>
  );
}
