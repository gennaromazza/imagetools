import { useEffect, useMemo, useRef, useState } from "react";
import type { AlbumAssetV2, AlbumProjectV2 } from "@photo-tools/shared-types";
import { spreadSizeMm } from "../engine/geometry";
import { requestImage } from "../desktop/api";
import { Icon } from "./icons";
import { SpreadView, presentPixels } from "./SpreadView";

/** Presentazione a tutto schermo per mostrare l'album al cliente: solo frecce, nessuno strumento di modifica. */
export function ClientPreview({ project, assets, startIndex, onClose }: { project: AlbumProjectV2; assets: ReadonlyMap<string, AlbumAssetV2>; startIndex: number; onClose: () => void }) {
  const count = project.spreads.length;
  const [index, setIndex] = useState(Math.min(Math.max(startIndex, 0), Math.max(count - 1, 0)));
  const previous = useRef(index);
  const direction = index >= previous.current ? "next" : "prev";
  useEffect(() => { previous.current = index; }, [index]);

  // Carica in anticipo le foto degli spread vicini (prima la leggera, poi la nitida): lo sfoglio non aspetta.
  useEffect(() => {
    const cancels: Array<() => void> = [];
    const pixels = presentPixels();
    for (const offset of [1, -1, 2, -2, 3]) {
      const target = project.spreads[index + offset];
      if (!target) continue;
      for (const area of target.areas) for (const item of area.items) {
        const path = assets.get(item.assetId)?.absolutePath;
        if (!path) continue;
        cancels.push(requestImage(path, 720, () => undefined), requestImage(path, pixels, () => undefined));
      }
    }
    return () => { for (const cancel of cancels) cancel(); };
  }, [index, project.spreads, assets]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const stop = () => { event.preventDefault(); event.stopPropagation(); };
      if (event.key === "Escape" || event.key === "F5") { stop(); onClose(); }
      else if (event.key === "ArrowRight" || event.key === " " || event.key === "PageDown" || event.key === "ArrowDown") { stop(); setIndex((value) => Math.min(value + 1, count - 1)); }
      else if (event.key === "ArrowLeft" || event.key === "PageUp" || event.key === "ArrowUp") { stop(); setIndex((value) => Math.max(value - 1, 0)); }
      else if (event.key === "Home") { stop(); setIndex(0); }
      else if (event.key === "End") { stop(); setIndex(count - 1); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, count]);

  const spread = project.spreads[index];
  const ratio = useMemo(() => { const size = spreadSizeMm(project.settings.sheet); return size.width / size.height; }, [project.settings.sheet]);
  if (!spread) return null;
  const chapter = project.chapters.find((candidate) => spread.areas.some((area) => area.items.some((item) => candidate.assetIds.includes(item.assetId))));

  return (
    <div className="present" role="dialog" aria-modal="true" aria-label="Anteprima per il cliente">
      <header className="present__top">
        <span>{project.projectName}{chapter ? ` · ${chapter.title}` : ""}</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Chiudi l'anteprima"><Icon name="close" /></button>
      </header>
      <button type="button" className="present__nav present__nav--prev" onClick={() => setIndex((value) => Math.max(value - 1, 0))} disabled={index === 0} aria-label="Spread precedente"><Icon name="chevronLeft" size={44} /></button>
      <div className="present__stage" style={{ ["--spread-ratio" as string]: ratio }}>
        <div className={`present__book present__book--${direction}`} key={spread.id}>
          <SpreadView sheet={project.settings.sheet} spread={spread} assets={assets} variant="present" />
          <span className="present__fold" aria-hidden="true" />
          <button type="button" className="present__turn present__turn--prev" tabIndex={-1} disabled={index === 0} onClick={() => setIndex((value) => Math.max(value - 1, 0))} aria-label="Pagina precedente" />
          <button type="button" className="present__turn present__turn--next" tabIndex={-1} disabled={index >= count - 1} onClick={() => setIndex((value) => Math.min(value + 1, count - 1))} aria-label="Pagina successiva" />
        </div>
      </div>
      <button type="button" className="present__nav present__nav--next" onClick={() => setIndex((value) => Math.min(value + 1, count - 1))} disabled={index >= count - 1} aria-label="Spread successivo"><Icon name="chevronRight" size={44} /></button>
      <footer className="present__bottom">
        <span className="present__progress" aria-hidden="true"><span style={{ width: `${count > 1 ? (index / (count - 1)) * 100 : 100}%` }} /></span>
        {index + 1} / {count}
      </footer>
    </div>
  );
}
