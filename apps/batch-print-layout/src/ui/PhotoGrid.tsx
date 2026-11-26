import { useRef } from "react";
import { Check, Crop, FolderPlus, ImagePlus, Images, Minus, Plus, Trash2 } from "lucide-react";
import { effectiveDpi, LOW_DPI } from "../order/geometry";
import type { LogoSettings, OrderGroup, OrderPhoto } from "../order/model";
import { folderNames } from "../order/naming";
import { CropView } from "./CropView";

interface PhotoGridProps {
  group: OrderGroup;
  allGroups: OrderGroup[];
  thumbnails: { urls: Map<string, string>; missing: Set<string> };
  logo: LogoSettings;
  logoUrl: string | null;
  selectedIds: Set<string>;
  busy: boolean;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onOpenCrop: (photo: OrderPhoto) => void;
  onAddFiles: (files: File[]) => void;
  onAddFolder: () => void;
  onRemoveSelected: () => void;
  onTransferSelected: (toId: string, mode: "copy" | "move") => void;
  onSetCopies: (photoId: string, copies: number) => void;
}

export function PhotoGrid({ group, allGroups, thumbnails, logo, logoUrl, selectedIds, busy, onToggleSelect, onSelectAll, onClearSelection, onOpenCrop, onAddFiles, onAddFolder, onRemoveSelected, onTransferSelected, onSetCopies }: PhotoGridProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const others = allGroups.filter((item) => item.id !== group.id);
  // Gli stessi nomi delle cartelle: due formati uguali restano distinguibili.
  const names = folderNames(allGroups);
  const canUseFolders = Boolean(window.filexDesktop);
  const empty = group.photos.length === 0;

  const addButtons = (
    <>
      <button type="button" className="btn" onClick={() => fileInput.current?.click()} disabled={busy}>
        <ImagePlus size={16} /> Aggiungi foto
      </button>
      <button type="button" className="btn" onClick={onAddFolder} disabled={busy || !canUseFolders}>
        <FolderPlus size={16} /> Aggiungi cartella
      </button>
    </>
  );

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept="image/jpeg,image/png,image/webp,.heic,.heif,.tif,.tiff"
        onChange={(event) => {
          if (event.target.files) onAddFiles(Array.from(event.target.files));
          event.target.value = "";
        }}
      />

      {empty ? (
        <div className="empty">
          <Images size={44} strokeWidth={1.4} />
          <h2>Porta qui le foto da stampare in {group.format.label}</h2>
          <p>Trascina file o cartelle, oppure usa i pulsanti. Il ritaglio parte in automatico.</p>
          <div className="empty__actions">{addButtons}</div>
        </div>
      ) : (
        <>
          <div className={`toolbar ${selectedIds.size ? "toolbar--selecting" : ""}`}>
            {addButtons}
            <span className="spacer" />
            {selectedIds.size > 0 ? (
              <>
                <strong className="toolbar__count">{selectedIds.size} selezionate</strong>
                {others.length > 0 ? (
                  <select
                    aria-label="Sposta o copia in un altro formato"
                    value=""
                    onChange={(event) => {
                      const [mode, id] = event.target.value.split(":");
                      if (id) onTransferSelected(id, mode as "copy" | "move");
                    }}
                  >
                    <option value="">Sposta o copia in…</option>
                    <optgroup label="Copia in">
                      {others.map((item) => <option key={item.id} value={`copy:${item.id}`}>{names.get(item.id)}</option>)}
                    </optgroup>
                    <optgroup label="Sposta in">
                      {others.map((item) => <option key={item.id} value={`move:${item.id}`}>{names.get(item.id)}</option>)}
                    </optgroup>
                  </select>
                ) : null}
                <button type="button" className="btn btn--danger" onClick={onRemoveSelected}><Trash2 size={15} /> Rimuovi</button>
                <button type="button" className="btn btn--ghost" onClick={onClearSelection}>Annulla selezione</button>
              </>
            ) : (
              <button type="button" className="btn btn--ghost" onClick={onSelectAll}><Check size={15} /> Seleziona tutte</button>
            )}
          </div>

          <ul className="grid">
            {group.photos.map((photo) => {
              const missing = thumbnails.missing.has(photo.sourceKey);
              const selected = selectedIds.has(photo.id);
              const dpi = effectiveDpi(group, photo);
              return (
                <li key={photo.id} className={`card ${selected ? "card--selected" : ""}`}>
                  <button type="button" className="card__preview" onClick={() => onOpenCrop(photo)} aria-label={`Ritaglia ${photo.fileName}`}>
                    <CropView group={group} photo={photo} url={thumbnails.urls.get(photo.sourceKey) ?? null} logo={logo} logoUrl={logoUrl} />
                    <span className="card__hover" aria-hidden="true"><Crop size={15} /> Ritaglia</span>
                  </button>
                  <label className="card__check">
                    <input type="checkbox" checked={selected} onChange={() => onToggleSelect(photo.id)} aria-label={`Seleziona ${photo.fileName}`} />
                  </label>
                  {missing ? <span className="badge badge--danger">File mancante</span> : null}
                  {!missing && dpi > 0 && dpi < LOW_DPI ? <span className="badge" title={`${dpi} DPI in questo formato`}>Bassa risoluzione</span> : null}
                  <div className="card__foot">
                    <span className="card__name" title={photo.fileName}>{photo.fileName}</span>
                    <div className="stepper" role="group" aria-label="Copie">
                      <button type="button" onClick={() => onSetCopies(photo.id, photo.copies - 1)} disabled={photo.copies <= 1} aria-label="Una copia in meno"><Minus size={13} /></button>
                      <input
                        type="number"
                        min="1"
                        max="999"
                        value={photo.copies}
                        aria-label="Numero di copie"
                        onChange={(event) => {
                          const value = parseInt(event.target.value, 10);
                          if (value > 0) onSetCopies(photo.id, value);
                        }}
                      />
                      <button type="button" onClick={() => onSetCopies(photo.id, photo.copies + 1)} disabled={photo.copies >= 999} aria-label="Una copia in più"><Plus size={13} /></button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
