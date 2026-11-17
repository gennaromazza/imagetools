import { useEffect, useMemo, useRef, useState } from "react";
import type { AlbumAssetV2, AlbumProjectV2 } from "@photo-tools/shared-types";
import { paintOrder, spreadSizeMm } from "../engine/geometry";
import { areaGeometryFor } from "../model/project";
import { requestImage } from "../desktop/api";
import { Icon } from "./icons";
import { PreviewLightbox } from "./PreviewLightbox";
import { SpreadView, presentPixels } from "./SpreadView";
import { IconButton } from "./ui";

/** Presentazione a tutto schermo per mostrare l'album al cliente: solo frecce, nessuno strumento di modifica. */
export function ClientPreview({ project, assets, startIndex, onClose }: { project: AlbumProjectV2; assets: ReadonlyMap<string, AlbumAssetV2>; startIndex: number; onClose: () => void }) {
  const count = project.spreads.length;
  const [index, setIndex] = useState(Math.min(Math.max(startIndex, 0), Math.max(count - 1, 0)));
  const previous = useRef(index);
  const direction = index >= previous.current ? "next" : "prev";
  useEffect(() => { previous.current = index; }, [index]);
  // «Ingrandisci le foto»: con la lente accesa un clic su una foto la apre a tutto schermo con lo zoom (senza, un clic gira la pagina).
  const [lens, setLens] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  useEffect(() => { setViewing(null); }, [index]);

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
    // Con una foto ingrandita aperta i tasti sono suoi (Esc chiude solo la foto, le frecce scorrono le foto).
    if (viewing !== null) return;
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
  }, [onClose, count, viewing]);

  const spread = project.spreads[index];
  const ratio = useMemo(() => { const size = spreadSizeMm(project.settings.sheet); return size.width / size.height; }, [project.settings.sheet]);
  if (!spread) return null;
  // Le foto dello spread in ordine di lettura (da sinistra a destra, poi dall'alto) e i loro rettangoli, per i clic della lente.
  const photos = (() => {
    const hits = spread.areas.flatMap((area, areaIndex) => areaGeometryFor(project.settings.sheet, spread, areaIndex).cells.map((cell, cellIndex) => ({ cell, areaIndex, index: cellIndex, assetId: area.items.find((item) => item.id === cell.itemId)?.assetId })));
    const known = hits.filter((hit): hit is typeof hit & { assetId: string } => Boolean(hit.assetId && assets.get(hit.assetId)));
    const reading = [...known].sort((a, b) => a.cell.rect.x - b.cell.rect.x || a.cell.rect.y - b.cell.rect.y);
    return { reading, painted: paintOrder(known) };
  })();
  const sheetMm = spreadSizeMm(project.settings.sheet);
  const chapter = project.chapters.find((candidate) => spread.areas.some((area) => area.items.some((item) => candidate.assetIds.includes(item.assetId))));

  return (
    <div className="present" role="dialog" aria-modal="true" aria-label="Anteprima per il cliente">
      <header className="present__top">
        <span>{project.projectName}{chapter ? ` · ${chapter.title}` : ""}</span>
        <span className="present__tools">
          <IconButton icon="search" label={lens ? "Lente accesa: clic su una foto per ingrandirla. Clic qui per tornare a sfogliare" : "Ingrandisci le foto: poi clic su una foto per vederla grande e fare zoom"} active={lens} onClick={() => setLens((on) => !on)} />
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Chiudi l'anteprima"><Icon name="close" /></button>
        </span>
      </header>
      <button type="button" className="present__nav present__nav--prev" onClick={() => setIndex((value) => Math.max(value - 1, 0))} disabled={index === 0} aria-label="Spread precedente"><Icon name="chevronLeft" size={44} /></button>
      <div className="present__stage" style={{ ["--spread-ratio" as string]: ratio }}>
        <div className={`present__book present__book--${direction}${lens ? " is-lens" : ""}`} key={spread.id}>
          <SpreadView sheet={project.settings.sheet} spread={spread} assets={assets} variant="present" />
          <span className="present__fold" aria-hidden="true" />
          <button type="button" className="present__turn present__turn--prev" tabIndex={-1} disabled={index === 0} onClick={() => setIndex((value) => Math.max(value - 1, 0))} aria-label="Pagina precedente" />
          <button type="button" className="present__turn present__turn--next" tabIndex={-1} disabled={index >= count - 1} onClick={() => setIndex((value) => Math.min(value + 1, count - 1))} aria-label="Pagina successiva" />
          {lens ? photos.painted.map((hit) => {
            const readingIndex = photos.reading.findIndex((candidate) => candidate.cell.itemId === hit.cell.itemId);
            const name = assets.get(hit.assetId)?.fileName ?? "foto";
            return (
              <button
                key={hit.cell.itemId}
                type="button"
                className="present__hit"
                aria-label={`Ingrandisci ${name}`}
                title="Clic per ingrandire questa foto"
                style={{ left: `${(hit.cell.rect.x / sheetMm.width) * 100}%`, top: `${(hit.cell.rect.y / sheetMm.height) * 100}%`, width: `${(hit.cell.rect.w / sheetMm.width) * 100}%`, height: `${(hit.cell.rect.h / sheetMm.height) * 100}%` }}
                onClick={() => setViewing(readingIndex)}
              ><Icon name="search" size={22} /></button>
            );
          }) : null}
        </div>
      </div>
      <button type="button" className="present__nav present__nav--next" onClick={() => setIndex((value) => Math.min(value + 1, count - 1))} disabled={index >= count - 1} aria-label="Spread successivo"><Icon name="chevronRight" size={44} /></button>
      <footer className="present__bottom">
        <span className="present__progress" aria-hidden="true"><span style={{ width: `${count > 1 ? (index / (count - 1)) * 100 : 100}%` }} /></span>
        {index + 1} / {count}{lens ? " · clic su una foto per ingrandirla" : ""}
      </footer>
      {viewing !== null ? <PreviewLightbox assets={photos.reading.map((hit) => assets.get(hit.assetId)!)} startIndex={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}
