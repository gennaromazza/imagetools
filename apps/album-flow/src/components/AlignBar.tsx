import type { AlignMode } from "../engine/arrange";

/** Barra che compare con due o più foto scelte (Maiusc+clic o rettangolo di selezione) in una pagina libera: allinea e distribuisci. */
interface Props {
  count: number;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: "x" | "y") => void;
}

const ALIGN: Array<{ mode: AlignMode; label: string; path: string }> = [
  { mode: "left", label: "Allinea a sinistra", path: "M3 2v16M6 5h10v3H6zM6 12h6v3H6z" },
  { mode: "hcenter", label: "Allinea al centro (in orizzontale)", path: "M10 2v16M4 5h12v3H4zM6 12h8v3H6z" },
  { mode: "right", label: "Allinea a destra", path: "M17 2v16M4 5h10v3H4zM8 12h6v3H8z" },
  { mode: "top", label: "Allinea in alto", path: "M2 3h16M5 6v10h3V6zM12 6v6h3V6z" },
  { mode: "vcenter", label: "Allinea al centro (in verticale)", path: "M2 10h16M5 4v12h3V4zM12 6v8h3V6z" },
  { mode: "bottom", label: "Allinea in basso", path: "M2 17h16M5 4v10h3V4zM12 8v6h3V8z" },
];

const Glyph = ({ path }: { path: string }) => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
);

export function AlignBar({ count, onAlign, onDistribute }: Props) {
  const stop = { onClick: (event: React.MouseEvent) => event.stopPropagation(), onPointerDown: (event: React.PointerEvent) => event.stopPropagation(), onDoubleClick: (event: React.MouseEvent) => event.stopPropagation() };
  return (
    <div className="group-bar" role="toolbar" aria-label={`${count} foto scelte: allinea e distribuisci`} {...stop}>
      <span className="group-bar__count">{count} foto</span>
      {ALIGN.map((entry) => (
        <button key={entry.mode} type="button" className="icon-btn" title={entry.label} aria-label={entry.label} onClick={() => onAlign(entry.mode)}><Glyph path={entry.path} /></button>
      ))}
      <span className="group-bar__sep" aria-hidden="true" />
      <button type="button" className="icon-btn" title="Distribuisci in orizzontale: stesso spazio tra le foto (servono almeno tre foto)" aria-label="Distribuisci in orizzontale" disabled={count < 3} onClick={() => onDistribute("x")}><Glyph path="M3 2v16M17 2v16M8 5h4v10H8z" /></button>
      <button type="button" className="icon-btn" title="Distribuisci in verticale: stesso spazio tra le foto (servono almeno tre foto)" aria-label="Distribuisci in verticale" disabled={count < 3} onClick={() => onDistribute("y")}><Glyph path="M2 3h16M2 17h16M5 8h10v4H5z" /></button>
    </div>
  );
}
