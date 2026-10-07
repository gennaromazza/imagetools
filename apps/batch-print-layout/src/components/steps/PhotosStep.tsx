import { useState } from "react";
import type { DragEvent } from "react";
import { FolderOpen, ImagePlus, Minus, Plus, X } from "lucide-react";
import type { Workbench } from "../../hooks/useWorkbench";
import { dragCarriesFiles } from "../../lib/assets";
import { MAX_COPIES } from "../../lib/copies";
import { NumberField } from "../ui";

const THUMBNAIL_LIMIT = 120;

export function PhotosStep({ wb }: { wb: Workbench }) {
  const { assets, copies, printCount } = wb;
  const visible = assets.slice(0, THUMBNAIL_LIMIT);
  // Due tipi di trascinamento: una miniatura (riordino) o file dal sistema (importazione).
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [filesOver, setFilesOver] = useState(false);

  const handlePageDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!dragCarriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setFilesOver(true);
  };

  const handlePageDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!dragCarriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    setFilesOver(false);
    void wb.addDroppedFiles(event.dataTransfer);
  };

  const customCount = assets.filter((asset) => wb.copiesOf(asset.id) !== copies).length;

  return (
    <div
      className={filesOver ? "slide slide--wide slide--drop" : "slide slide--wide"}
      onDragOver={handlePageDragOver}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setFilesOver(false);
      }}
      onDrop={handlePageDrop}
    >
      <header className="slide__intro">
        <h2>Quali foto vuoi stampare?</h2>
        <p>Scegli la cartella o trascina qui le foto (anche intere cartelle). Per ogni foto puoi decidere quante copie stampare e, trascinandole, l'ordine.</p>
      </header>

      {assets.length === 0 ? (
        <button type="button" className={filesOver ? "dropzone dropzone--over" : "dropzone"} onClick={wb.handleBrowseFolder} disabled={wb.isBusy}>
          <ImagePlus size={34} />
          <strong>Trascina qui le foto oppure scegli la cartella</strong>
          <span>JPG, PNG e WebP{window.filexDesktop?.openFolder ? " (e HEIC/TIFF se Windows ha i codec)" : ""}</span>
        </button>
      ) : (
        <>
          <div className="photo-summary">
            <div>
              <strong>{assets.length} foto · {printCount} {printCount === 1 ? "stampa" : "stampe"}</strong>
              <span>
                {customCount > 0
                  ? `${customCount} ${customCount === 1 ? "foto ha" : "foto hanno"} un numero di copie diverso`
                  : copies > 1 ? `${copies} copie di ogni foto` : "una copia ciascuna"}
              </span>
            </div>
            <NumberField label="Copie per tutte" value={copies} min={1} max={MAX_COPIES} step={1} onChange={(value) => wb.setAllCopies(value)} />
            <button type="button" className="secondary-button" onClick={wb.handleBrowseFolder} disabled={wb.isBusy}>
              <FolderOpen size={16} />
              Cambia cartella
            </button>
          </div>
          <p className="slide__hint">Imposta «Copie per tutte», poi correggi le singole foto con − e +. Trascina una miniatura sopra un'altra per cambiare l'ordine di stampa.</p>

          <ul className="thumb-grid" aria-label="Foto scelte">
            {visible.map((asset) => {
              const own = wb.copiesOf(asset.id);
              const classes = ["thumb", draggedId === asset.id ? "thumb--dragging" : "", overId === asset.id && draggedId !== asset.id ? "thumb--over" : ""].filter(Boolean).join(" ");
              return (
                <li
                  key={asset.id}
                  className={classes}
                  draggable
                  onDragStart={(event) => {
                    setDraggedId(asset.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", asset.id);
                  }}
                  onDragEnd={() => {
                    setDraggedId(null);
                    setOverId(null);
                  }}
                  onDragOver={(event) => {
                    if (!draggedId) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setOverId(asset.id);
                  }}
                  onDrop={(event) => {
                    if (!draggedId) return;
                    event.preventDefault();
                    event.stopPropagation();
                    wb.moveAsset(draggedId, asset.id);
                    setDraggedId(null);
                    setOverId(null);
                  }}
                >
                  <img src={asset.previewUrl} alt={asset.fileName} loading="lazy" decoding="async" draggable={false} />
                  <span className="thumb__name" title={asset.relativePath || asset.fileName}>{asset.fileName}</span>
                  <div className={own !== copies ? "thumb__copies thumb__copies--custom" : "thumb__copies"} role="group" aria-label={`Copie di ${asset.fileName}`}>
                    <button type="button" aria-label="Una copia in meno" disabled={own <= 1} onClick={() => wb.setAssetCopies(asset.id, own - 1)}>
                      <Minus size={13} />
                    </button>
                    <output aria-live="polite">{own} {own === 1 ? "copia" : "copie"}</output>
                    <button type="button" aria-label="Una copia in più" disabled={own >= MAX_COPIES} onClick={() => wb.setAssetCopies(asset.id, own + 1)}>
                      <Plus size={13} />
                    </button>
                  </div>
                  <button type="button" className="thumb__remove" aria-label={`Rimuovi ${asset.fileName}`} title="Togli dalla stampa" onClick={() => wb.removeAsset(asset.id)}>
                    <X size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
          {assets.length > THUMBNAIL_LIMIT ? (
            <p className="slide__hint">Mostrate le prime {THUMBNAIL_LIMIT} anteprime: le altre {assets.length - THUMBNAIL_LIMIT} sono comunque incluse nella stampa.</p>
          ) : null}
        </>
      )}
      {filesOver ? <div className="drop-overlay" aria-hidden="true">Rilascia per aggiungere le foto</div> : null}
    </div>
  );
}
