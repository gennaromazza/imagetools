import { useRef } from "react";
import { Check, Crop, FolderPlus, ImagePlus, Images, Minus, Plus, Trash2, Wand2 } from "lucide-react";
import { assessQuality } from "../order/quality";
import type { FormatTarget, LogoSettings, OrderGroup, OrderPhoto } from "../order/model";
import { CropView } from "./CropView";
import { FormatSelect } from "./FormatSelect";

export interface PhotoEntry {
  group: OrderGroup;
  photo: OrderPhoto;
}

interface PhotoGridProps {
  entries: PhotoEntry[];
  /** Formato in cui entrano le foto aggiunte da qui. */
  intoLabel: string;
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
  onAssign: (photoIds: string[], target: FormatTarget, mode: "move" | "add") => void;
  onSetCopies: (groupId: string, photoId: string, copies: number) => void;
  onEdit: (photo: OrderPhoto) => void;
}

export function PhotoGrid({ entries, intoLabel, allGroups, thumbnails, logo, logoUrl, selectedIds, busy, onToggleSelect, onSelectAll, onClearSelection, onOpenCrop, onAddFiles, onAddFolder, onRemoveSelected, onAssign, onSetCopies, onEdit }: PhotoGridProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const canUseFolders = Boolean(window.filexDesktop);
  const empty = entries.length === 0;

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
          <h2>Porta qui le foto da stampare in {intoLabel}</h2>
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
                <FormatSelect groups={allGroups} label="Formato delle foto selezionate" placeholder="Cambia formato…" onAssign={(target, mode) => onAssign([...selectedIds], target, mode)} />
                <button type="button" className="btn btn--danger" onClick={onRemoveSelected}><Trash2 size={15} /> Rimuovi</button>
                <button type="button" className="btn btn--ghost" onClick={onClearSelection}>Annulla selezione</button>
              </>
            ) : (
              <button type="button" className="btn btn--ghost" onClick={onSelectAll}><Check size={15} /> Seleziona tutte</button>
            )}
          </div>

          <ul className="grid">
            {entries.map(({ group, photo }) => {
              const missing = thumbnails.missing.has(photo.sourceKey);
              const selected = selectedIds.has(photo.id);
              const quality = assessQuality(group, photo);
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
                  {!missing && quality.level === "scarsa" ? <span className="badge" title={`${quality.dpi} DPI in questo formato`}>Non viene bene</span> : null}
                  <div className="card__title">
                    <span className={`dot dot--${quality.level}`} title={`Qualità ${quality.score}/100: ${quality.verdict}`} aria-label={`Qualità ${quality.score} su 100`} role="img" />
                    <span className="card__name" title={photo.fileName}>{photo.fileName}</span>
                    {window.filexDesktop && photo.absolutePath ? (
                      <button type="button" className="card__edit" onClick={() => onEdit(photo)} title="Modifica in Photoshop" aria-label={`Modifica ${photo.fileName} in Photoshop`}><Wand2 size={14} /></button>
                    ) : null}
                  </div>
                  <div className="card__foot">
                    <FormatSelect groups={allGroups} current={group.id} label={`Formato di ${photo.fileName}`} onAssign={(target, mode) => onAssign([photo.id], target, mode)} />
                    <div className="stepper" role="group" aria-label="Copie">
                      <button type="button" onClick={() => onSetCopies(group.id, photo.id, photo.copies - 1)} disabled={photo.copies <= 1} aria-label="Una copia in meno"><Minus size={13} /></button>
                      <input
                        type="number"
                        min="1"
                        max="999"
                        value={photo.copies}
                        aria-label="Numero di copie"
                        onChange={(event) => {
                          const value = parseInt(event.target.value, 10);
                          if (value > 0) onSetCopies(group.id, photo.id, value);
                        }}
                      />
                      <button type="button" onClick={() => onSetCopies(group.id, photo.id, photo.copies + 1)} disabled={photo.copies >= 999} aria-label="Una copia in più"><Plus size={13} /></button>
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
