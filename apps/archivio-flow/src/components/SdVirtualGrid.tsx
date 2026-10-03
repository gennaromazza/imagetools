import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildSdRowOffsets, buildSdRowsFromOrdered, SD_PHOTO_ROW_HEIGHT, sameSdWindow, virtualSdWindowFromOffsets, type SdFile, type SdWindow } from "../sdBrowserModel";
import { moveGridFocus } from "../wizardModel";
import { buildPreviewSourceKey, isPreviewableMedia } from "../previewPolicy";
import { DesktopPreviewImage } from "./DesktopPreviewImage";

const PREVIEW_IMAGE_STYLE = { width: "100%", height: 98, objectFit: "cover", margin: 0 } as const;

export interface CellProps {
  file: SdFile; isSelected: boolean; session: string; sdPath: string;
  /** "Già in «Evento 1»": la foto risulta gia' salvata in archivio. */
  archivedLabel?: string;
  onSelect: (file: string, shift: boolean) => void; onOpen: (file: SdFile) => void;
}

/** Memoizzata: selezionare una foto ridisegna solo la sua cella, non tutte quelle visibili. */
export const SdPhotoCell = memo(function SdPhotoCell({ file, isSelected, session, sdPath, archivedLabel, onSelect, onOpen }: CellProps) {
  return <div className={`sd-browser-photo${isSelected ? " is-selected" : ""}${archivedLabel ? " is-archived" : ""}`}>
    <button type="button" className="sd-browser-select" aria-pressed={isSelected} aria-label={`Seleziona ${file.fileName}`} data-path={file.filePath} onKeyDown={event => { if (event.key === "Enter" && file.mediaType === "photo") { event.preventDefault(); onOpen(file); } }} onClick={event => onSelect(file.filePath, event.shiftKey)} onDoubleClick={file.mediaType === "photo" ? () => onOpen(file) : undefined}>
      {isPreviewableMedia(file) ? <DesktopPreviewImage sdPath={sdPath} filePath={file.filePath} sourceFileKey={buildPreviewSourceKey(file, session)} alt={file.fileName} style={PREVIEW_IMAGE_STYLE} /> : <span className="sd-browser-no-preview">{file.ext.toUpperCase()}</span>}
      <span className={`sd-browser-type${file.mediaType === "video" ? " is-video" : ""}`} aria-hidden="true">{file.mediaType === "video" ? "▶ VIDEO" : file.ext.replace(".", "").toUpperCase()}</span>
      <span className="sd-browser-filename">{isSelected ? "✓ " : ""}{file.fileName}</span>
    </button>
    {archivedLabel && <span className="sd-browser-archived" title="Questa foto è già stata importata">{archivedLabel}</span>}
    {file.mediaType === "photo" && <button type="button" className="sd-browser-zoom" onClick={() => onOpen(file)} aria-label={`Ingrandisci ${file.fileName}`} title="Ingrandisci (o doppio clic sulla foto)">⤢</button>}
    <div className="sd-browser-photo-meta"><span>{new Date(file.mtimeMs).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</span></div>
  </div>;
});

export function SdVirtualGrid({ files, archivedLabels, selected, session, sdPath, filterKey, onSelect, onOpen }: {
  /** Gia' ordinati (vedi orderSdFiles): la griglia non li riordina. */
  files: SdFile[]; archivedLabels?: ReadonlyMap<string, string>; selected: ReadonlySet<string>; session: string; sdPath: string; filterKey: string;
  onSelect: (file: string, shift: boolean, ordered: string[]) => void; onOpen: (file: SdFile) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);
  const [height, setHeight] = useState(560);
  const scrollTop = useRef(0);
  const frame = useRef(0);
  const rows = useMemo(() => buildSdRowsFromOrdered(files, columns), [files, columns]);
  const offsets = useMemo(() => buildSdRowOffsets(rows), [rows]);
  const ordered = useMemo(() => rows.flatMap(row => row.files.map(file => file.filePath)), [rows]);
  const [win, setWin] = useState<SdWindow>(() => virtualSdWindowFromOffsets(offsets, 0, height));

  const orderedRef = useRef(ordered); orderedRef.current = ordered;
  const positions = useMemo(() => {
    const map = new Map<string, { row: number; col: number }>();
    rows.forEach((row, rowIndex) => row.files.forEach((file, col) => map.set(file.filePath, { row: rowIndex, col })));
    return map;
  }, [rows]);
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  const onOpenRef = useRef(onOpen); onOpenRef.current = onOpen;
  const select = useCallback((path: string, shift: boolean) => onSelectRef.current(path, shift, orderedRef.current), []);
  const open = useCallback((file: SdFile) => onOpenRef.current(file), []);

  const recompute = useCallback(() => {
    const next = virtualSdWindowFromOffsets(offsets, scrollTop.current, height);
    setWin(previous => sameSdWindow(previous, next) ? previous : next);
  }, [offsets, height]);
  useEffect(recompute, [recompute]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setColumns(Math.max(1, Math.floor(element.clientWidth / 170)));
      setHeight(element.clientHeight);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (viewport.current) viewport.current.scrollTop = 0;
    scrollTop.current = 0;
    recompute();
  }, [filterKey]);
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);

  // Frecce, Home/Fine e Pagina su/giu: il cursore si sposta tra le tessere e la griglia scorre per tenerlo in vista.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) return;
    const current = (event.target as HTMLElement).closest<HTMLElement>("[data-path]")?.dataset.path;
    const from = current ? positions.get(current) : undefined;
    if (!from) return;
    const to = moveGridFocus(rows, from, event.key);
    const target = rows[to.row]?.files[to.col];
    if (!target || (to.row === from.row && to.col === from.col)) return;
    event.preventDefault();
    const element = viewport.current;
    if (element) {
      const top = offsets[to.row]!;
      if (top < element.scrollTop + 8) element.scrollTop = Math.max(0, top - 50);
      else if (top + SD_PHOTO_ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = top + SD_PHOTO_ROW_HEIGHT - element.clientHeight + 10;
    }
    // La tessera di destinazione puo' non essere ancora nel DOM (griglia virtuale): si riprova fino a circa due secondi (salti lunghi, es. Home/Fine).
    let attempts = 0;
    const focusTarget = () => {
      const node = Array.from(viewport.current?.querySelectorAll<HTMLElement>("[data-path]") ?? []).find(item => item.dataset.path === target.filePath);
      if (node) node.focus();
      else if (attempts++ < 40) window.setTimeout(focusTarget, 40);
    };
    focusTarget();
  };

  // Lo scroll aggiorna React al massimo una volta per frame e solo se la finestra di righe cambia davvero.
  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    scrollTop.current = event.currentTarget.scrollTop;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => { frame.current = 0; recompute(); });
  };

  return <div className="sd-browser-viewport" ref={viewport} onScroll={onScroll} onKeyDown={onKeyDown} aria-label="Foto sulla scheda">
    <div style={{ height: win.before }} />
    {rows.slice(win.start, win.end).map((row, index) => row.header
      ? <div className="sd-browser-date-heading" key={`date:${row.date}`}>{new Date(`${row.date}T12:00`).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
      : <div className="sd-browser-photo-row" key={`${row.date}:${win.start + index}`} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {row.files.map(file => <SdPhotoCell key={file.filePath} file={file} isSelected={selected.has(file.filePath)} archivedLabel={archivedLabels?.get(file.filePath)} session={session} sdPath={sdPath} onSelect={select} onOpen={open} />)}
      </div>)}
    <div style={{ height: win.after }} />
    {!files.length && <p>Nessun file in questa vista.</p>}
  </div>;
}
