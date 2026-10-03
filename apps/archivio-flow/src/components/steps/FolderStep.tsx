import type { ReactNode } from "react";
import { PhotosRecap, StepFrame } from "./StepFrame";

/** Domanda facoltativa: dentro il lavoro, in quale cartella mettere queste foto? */
export function FolderStep({ photosText, onChangePhotos, existingJobName, folders, presets, value, onChange, similar, loading, error, where, onBack, onNext }: {
  photosText: string; onChangePhotos: () => void;
  /** Se presente, si sta aggiungendo a un lavoro che esiste già. */
  existingJobName?: string;
  folders: readonly string[]; presets: readonly string[];
  value: string; onChange: (value: string) => void;
  similar: readonly string[];
  loading?: boolean; error?: string | null;
  where?: ReactNode;
  onBack: () => void; onNext: () => void;
}) {
  const existing = Boolean(existingJobName);
  const presetChips = presets.filter((preset) => !(existing && folders.includes(preset)));
  return <StepFrame
    title={existing ? "In quale cartella del lavoro?" : "Vuoi una cartella dedicata?"}
    description={existing
      ? `Stai aggiungendo foto a «${existingJobName}». Scegli una cartella già presente oppure creane una nuova.`
      : "Facoltativo: serve a tenere separati momenti diversi, come Cerimonia e Festa. Puoi anche saltare."}
    recap={<PhotosRecap text={photosText} onChange={onChangePhotos} />}
    onBack={onBack}
    onNext={onNext}
    nextLabel={value.trim() ? "Avanti →" : existing ? "Avanti, nella cartella principale →" : "Salta, nessuna cartella →"}
  >
    <div className="wizard-chips" role="group" aria-label="Cartella di destinazione">
      <button type="button" className={`wizard-chip${value === "" ? " is-active" : ""}`} aria-pressed={value === ""} onClick={() => onChange("")}>
        {existing ? "Cartella principale" : "Nessuna"}
      </button>
      {existing && folders.map((folder) => (
        <button type="button" key={`existing:${folder}`} className={`wizard-chip${value === folder ? " is-active" : ""}`} aria-pressed={value === folder} onClick={() => onChange(folder)}>📁 {folder}</button>
      ))}
      {presetChips.map((preset) => (
        <button
          type="button" key={`preset:${preset}`}
          className={`wizard-chip${value === preset ? " is-active" : ""}`} aria-pressed={value === preset}
          onClick={() => onChange(preset)}
        >{preset}</button>
      ))}
    </div>
    {existing && loading && <span className="wizard-note">Leggo le cartelle del lavoro…</span>}
    {existing && error && <span className="wizard-note" style={{ color: "var(--danger)" }}>{error}</span>}
    <label className="field">
      <span>Oppure scrivi il nome di una nuova cartella <small style={{ color: "var(--text-muted)" }}>(per una cartella dentro un'altra scrivi ad esempio Chiesa/Rito)</small></span>
      <input
        type="text" value={value} placeholder="es. Promessa"
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
    {existing && similar.length > 0 && !folders.includes(value) && <div className="message-box">
      <p style={{ margin: 0, fontSize: "0.84rem" }}>Esiste già una cartella con un nome simile. Vuoi usare quella?</p>
      <div className="button-row" style={{ marginTop: "0.45rem" }}>
        {similar.map((folder) => <button type="button" key={folder} className="secondary-button" onClick={() => onChange(folder)}>Usa “{folder}”</button>)}
      </div>
    </div>}
    {where}
  </StepFrame>;
}
