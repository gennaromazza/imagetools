import { useMemo, useState } from "react";
import type { AreaStyle, SheetSpec } from "@photo-tools/shared-types";
import { BACKGROUND_SWATCHES, DEFAULT_AREA_STYLE, DEFAULT_SHEET, STYLE_LIMITS } from "../model/defaults";
import { COMMON_FORMATS, UNIT_LABELS, formatKey, formatLabel, formatShape, fromCm, isFavoriteFormat, isValidFormat, loadFavoriteFormats, loadRecentFormats, sheetFromFormat, toCm, toggleFavoriteFormat, type LengthUnit, type SheetFormat } from "../model/formats";
import { Icon } from "./icons";
import { ColorDots, Field, Modal } from "./ui";

type Tab = "recent" | "favorite" | "common";

function FormatCard({ format, selected, favorite, onPick, onFavorite }: { format: SheetFormat; selected: boolean; favorite: boolean; onPick: () => void; onFavorite: () => void }) {
  const ratio = format.widthCm / format.heightCm;
  const w = ratio >= 1 ? 54 : 54 * ratio;
  const h = ratio >= 1 ? 54 / ratio : 54;
  return (
    <div className={`format${selected ? " is-active" : ""}`}>
      <button type="button" className="format__pick" onClick={onPick} aria-pressed={selected} aria-label={`Formato ${formatLabel(format)}`}>
        <span className="format__shape" aria-hidden="true"><i style={{ width: w, height: h }} /><i style={{ width: w, height: h }} /></span>
        <strong>{formatLabel(format)}</strong>
        <span className="muted small">{formatShape(format) === "square" ? "Quadrato" : formatShape(format) === "landscape" ? "Orizzontale" : "Verticale"}</span>
      </button>
      <button type="button" className={`format__heart${favorite ? " is-on" : ""}`} onClick={onFavorite} aria-label={favorite ? "Togli dai preferiti" : "Aggiungi ai preferiti"} aria-pressed={favorite}><Icon name="heart" size={14} style={{ fill: favorite ? "currentColor" : "none" }} /></button>
    </div>
  );
}

export interface NewAlbumResult {
  name: string;
  sheet: SheetSpec;
  style: AreaStyle;
}

/** Nuovo album: formato scelto tra recenti, preferiti e formati comuni (o misure libere), con abbondanza, zona sicura e stile predefinito. */
export function NewAlbumDialog({ onCreate, onClose }: { onCreate: (result: NewAlbumResult) => void; onClose: () => void }) {
  const [recents] = useState(() => loadRecentFormats());
  const [favorites, setFavorites] = useState(() => loadFavoriteFormats());
  const [tab, setTab] = useState<Tab>(recents.length ? "recent" : "common");
  const [name, setName] = useState("");
  const [format, setFormat] = useState<SheetFormat>({ widthCm: DEFAULT_SHEET.widthCm, heightCm: DEFAULT_SHEET.heightCm });
  const [unit, setUnit] = useState<LengthUnit>("cm");
  const [dpi, setDpi] = useState(String(DEFAULT_SHEET.dpi));
  const [bleed, setBleed] = useState(String(DEFAULT_SHEET.bleedCm));
  const [safe, setSafe] = useState(String(DEFAULT_SHEET.marginCm));
  const [style, setStyle] = useState<AreaStyle>({ ...DEFAULT_AREA_STYLE });

  const list = tab === "recent" ? recents : tab === "favorite" ? favorites : COMMON_FORMATS;
  const valid = isValidFormat(format) && Number.isFinite(Number(dpi)) && Number(dpi) >= 72 && Number(dpi) <= 1200 && Number(bleed) >= 0 && Number(safe) >= 0 && Number(safe) * 2 < Math.min(format.widthCm, format.heightCm);
  const favorite = useMemo(() => isFavoriteFormat(format), [format, favorites]); // eslint-disable-line react-hooks/exhaustive-deps

  const setDimension = (key: "widthCm" | "heightCm", text: string) => {
    const value = Number.parseFloat(text.replace(",", "."));
    if (Number.isFinite(value)) setFormat((current) => ({ ...current, [key]: Number(toCm(value, unit).toFixed(2)) }));
  };
  const create = () => {
    if (!valid) return;
    const sheet = { ...sheetFromFormat(format), dpi: Number(dpi), bleedCm: Number(bleed), marginCm: Number(safe) };
    onCreate({ name, sheet, style });
  };

  return (
    <Modal
      title="Nuovo album"
      subtitle="Il formato è quello di una singola pagina: lo spread è formato da due pagine affiancate."
      onClose={onClose}
      wide
      footer={<>
        <button type="button" className={`btn btn--ghost${favorite ? " is-on" : ""}`} onClick={() => setFavorites(toggleFavoriteFormat(format))} aria-pressed={favorite} disabled={!isValidFormat(format)}><Icon name="heart" size={15} style={{ fill: favorite ? "currentColor" : "none" }} /> {favorite ? "Formato nei preferiti" : "Aggiungi il formato ai preferiti"}</button>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>Annulla</button>
        <button type="button" className="btn btn--primary" disabled={!valid} onClick={create}>Crea album</button>
      </>}
    >
      <div className="newalbum">
        <section>
          <div className="tabs-inline" role="tablist">
            {([["recent", `Recenti${recents.length ? ` (${recents.length})` : ""}`], ["favorite", `Preferiti${favorites.length ? ` (${favorites.length})` : ""}`], ["common", "Formati comuni"]] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          <div className="formats">
            {list.map((item) => (
              <FormatCard key={formatKey(item)} format={item} selected={formatKey(item) === formatKey(format)} favorite={favorites.some((fav) => formatKey(fav) === formatKey(item))} onPick={() => setFormat({ widthCm: item.widthCm, heightCm: item.heightCm })} onFavorite={() => setFavorites(toggleFavoriteFormat(item))} />
            ))}
            {list.length === 0 ? <p className="muted formats__empty">{tab === "recent" ? "Qui compariranno i formati che usi." : "Tocca il cuore su un formato per ritrovarlo qui."}</p> : null}
          </div>
        </section>

        <section className="newalbum__form">
          <Field label="Nome dell'album"><input className="input" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Es. Matrimonio Rossi" onKeyDown={(event) => { if (event.key === "Enter") create(); }} /></Field>
          <div className="grid-3">
            <Field label="Larghezza pagina"><input className="input" inputMode="decimal" value={fromCm(format.widthCm, unit)} onChange={(event) => setDimension("widthCm", event.target.value)} aria-label="Larghezza della pagina" /></Field>
            <Field label="Altezza pagina"><input className="input" inputMode="decimal" value={fromCm(format.heightCm, unit)} onChange={(event) => setDimension("heightCm", event.target.value)} aria-label="Altezza della pagina" /></Field>
            <Field label="Unità"><select className="select" value={unit} onChange={(event) => setUnit(event.target.value as LengthUnit)}>{(Object.keys(UNIT_LABELS) as LengthUnit[]).map((key) => <option key={key} value={key}>{UNIT_LABELS[key]}</option>)}</select></Field>
          </div>
          <Field label="Risoluzione di stampa (dpi)"><input className="input" inputMode="numeric" value={dpi} onChange={(event) => setDpi(event.target.value)} /></Field>
          <p className="notice">Album chiuso (una pagina): <strong>{format.widthCm.toLocaleString("it-IT")} × {format.heightCm.toLocaleString("it-IT")} cm</strong> → spread aperto: <strong>{(format.widthCm * 2).toLocaleString("it-IT")} × {format.heightCm.toLocaleString("it-IT")} cm</strong> (larghezza × altezza)</p>
          {!isValidFormat(format) ? <p className="notice notice--warn">Il formato di una pagina deve stare tra 5 e 100 cm.</p> : null}

          <details className="fold">
            <summary>Abbondanza e zona sicura</summary>
            <div className="grid-2">
              <Field label="Abbondanza (cm)" hint="Margine oltre il taglio, che il laboratorio rifila."><input className="input" inputMode="decimal" value={bleed} onChange={(event) => setBleed(event.target.value)} /></Field>
              <Field label="Zona sicura (cm)" hint="Distanza dal bordo entro cui non mettere dettagli importanti."><input className="input" inputMode="decimal" value={safe} onChange={(event) => setSafe(event.target.value)} /></Field>
            </div>
          </details>
          <details className="fold">
            <summary>Stile predefinito delle pagine</summary>
            <div className="grid-3">
              <Field label="Spazio tra foto (cm)"><input className="input" type="number" step={STYLE_LIMITS.gapCm.step} min={0} max={STYLE_LIMITS.gapCm.max} value={style.gapCm} onChange={(event) => setStyle({ ...style, gapCm: Number(event.target.value) })} /></Field>
              <Field label="Margine (cm)"><input className="input" type="number" step={STYLE_LIMITS.paddingCm.step} min={0} max={STYLE_LIMITS.paddingCm.max} value={style.paddingCm} onChange={(event) => setStyle({ ...style, paddingCm: Number(event.target.value) })} /></Field>
              <Field label="Bordo (cm)"><input className="input" type="number" step={STYLE_LIMITS.borderCm.step} min={0} max={STYLE_LIMITS.borderCm.max} value={style.borderCm} onChange={(event) => setStyle({ ...style, borderCm: Number(event.target.value) })} /></Field>
            </div>
            <Field label="Sfondo"><ColorDots value={style.background} swatches={BACKGROUND_SWATCHES} onChange={(background) => setStyle({ ...style, background })} label="Sfondo predefinito" /></Field>
          </details>
        </section>
      </div>
    </Modal>
  );
}
