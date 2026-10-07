import { FolderOpen, ImagePlus, X } from "lucide-react";
import type { Workbench } from "../../hooks/useWorkbench";
import { NumberField } from "../ui";

const THUMBNAIL_LIMIT = 120;

export function PhotosStep({ wb }: { wb: Workbench }) {
  const { assets, copies, printCount } = wb;
  const visible = assets.slice(0, THUMBNAIL_LIMIT);

  return (
    <div className="slide slide--wide">
      <header className="slide__intro">
        <h2>Quali foto vuoi stampare?</h2>
        <p>Scegli la cartella con le foto: leggo anche le sottocartelle. Poi decidi quante copie ne vuoi.</p>
      </header>

      {assets.length === 0 ? (
        <button type="button" className="dropzone" onClick={wb.handleBrowseFolder} disabled={wb.isBusy}>
          <ImagePlus size={34} />
          <strong>Scegli la cartella con le foto</strong>
          <span>JPG, PNG e WebP{window.filexDesktop?.openFolder ? " (e HEIC/TIFF se Windows ha i codec)" : ""}</span>
        </button>
      ) : (
        <>
          <div className="photo-summary">
            <div>
              <strong>{assets.length} foto</strong>
              <span>{copies > 1 ? `${printCount} stampe in totale (${copies} copie ciascuna)` : "una copia ciascuna"}</span>
            </div>
            <NumberField label="Copie di ogni foto" value={copies} min={1} max={99} step={1} onChange={(value) => wb.setCopies(Math.round(value))} />
            <button type="button" className="secondary-button" onClick={wb.handleBrowseFolder} disabled={wb.isBusy}>
              <FolderOpen size={16} />
              Cambia cartella
            </button>
          </div>

          <ul className="thumb-grid" aria-label="Foto scelte">
            {visible.map((asset) => (
              <li key={asset.id} className="thumb">
                <img src={asset.previewUrl} alt={asset.fileName} loading="lazy" decoding="async" />
                <span title={asset.relativePath || asset.fileName}>{asset.fileName}</span>
                <button type="button" aria-label={`Rimuovi ${asset.fileName}`} title="Togli dalla stampa" onClick={() => wb.removeAsset(asset.id)}>
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
          {assets.length > THUMBNAIL_LIMIT ? (
            <p className="slide__hint">Mostrate le prime {THUMBNAIL_LIMIT} anteprime: le altre {assets.length - THUMBNAIL_LIMIT} sono comunque incluse nella stampa.</p>
          ) : null}
        </>
      )}
    </div>
  );
}
