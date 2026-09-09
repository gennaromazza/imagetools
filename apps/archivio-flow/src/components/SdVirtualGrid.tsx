import { useEffect, useMemo, useRef, useState } from "react";
import { buildSdRows, virtualSdWindow, type SdFile } from "../sdBrowserModel";
import { buildPreviewSourceKey, isPreviewableMedia } from "../previewPolicy";
import { DesktopPreviewImage } from "./DesktopPreviewImage";

export function SdVirtualGrid({ files, selected, session, sdPath, filterKey, onSelect, onOpen }: {
  files: SdFile[]; selected: ReadonlySet<string>; session: string; sdPath: string; filterKey: string;
  onSelect: (file: string, shift: boolean, ordered: string[]) => void; onOpen: (file: SdFile) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);
  const [position, setPosition] = useState({ top: 0, height: 560 });
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setColumns(Math.max(1, Math.floor(element.clientWidth / 170)));
      setPosition(p => ({ ...p, height: element.clientHeight }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (viewport.current) viewport.current.scrollTop = 0;
    setPosition(p => ({ ...p, top: 0 }));
  }, [filterKey]);
  const rows = useMemo(() => buildSdRows(files, columns), [files, columns]);
  const ordered = useMemo(() => rows.flatMap(row => row.files.map(file => file.filePath)), [rows]);
  const window = useMemo(() => virtualSdWindow(rows, position.top, position.height), [rows, position]);
  return <div className="sd-browser-viewport" ref={viewport} onScroll={event => { const top = event.currentTarget.scrollTop; setPosition(p => ({ ...p, top })); }} aria-label="Foto sulla scheda">
    <div style={{ height: window.before }} />
    {rows.slice(window.start, window.end).map((row, index) => row.header
      ? <div className="sd-browser-date-heading" key={`date:${row.date}`}>{new Date(`${row.date}T12:00`).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
      : <div className="sd-browser-photo-row" key={`${row.date}:${window.start + index}`} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {row.files.map(file => <div className={`sd-browser-photo${selected.has(file.filePath) ? " is-selected" : ""}`} key={file.filePath}>
          <button type="button" className="sd-browser-select" aria-pressed={selected.has(file.filePath)} aria-label={`Seleziona ${file.fileName}`} onClick={event => onSelect(file.filePath, event.shiftKey, ordered)}>
            {isPreviewableMedia(file) ? <DesktopPreviewImage sdPath={sdPath} filePath={file.filePath} sourceFileKey={buildPreviewSourceKey(file, session)} alt={file.fileName} style={{ width: "100%", height: 98, objectFit: "cover", margin: 0 }} /> : <span className="sd-browser-no-preview">{file.ext.toUpperCase()}</span>}
            <span className="sd-browser-filename">{selected.has(file.filePath) ? "✓ " : ""}{file.fileName}</span>
          </button>
          <div className="sd-browser-photo-meta"><span>{new Date(file.mtimeMs).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</span><button className="ghost-button" type="button" onClick={() => onOpen(file)} disabled={file.mediaType !== "photo"}>Ingrandisci</button></div>
        </div>)}
      </div>)}
    <div style={{ height: window.after }} />
    {!files.length && <p>Nessun file in questa vista.</p>}
  </div>;
}
