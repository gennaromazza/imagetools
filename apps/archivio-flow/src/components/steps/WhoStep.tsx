import { useState } from "react";
import type { ReactNode } from "react";
import type { Job } from "../../types";
import { formatItalianDate } from "../../wizardModel";
import { PhotosRecap } from "./StepFrame";

/** Prima domanda: queste foto sono per un lavoro nuovo o per uno già esistente? Se l'app lo intuisce, lo propone in cima. */
export function WhoStep({ photosText, onChangePhotos, suggestions, onAcceptSuggestion, onNew, onExisting, extra }: {
  photosText: string; onChangePhotos: () => void;
  suggestions: ReadonlyArray<{ job: Job; reason: string }>;
  onAcceptSuggestion: (job: Job) => void;
  onNew: () => void; onExisting: () => void;
  /** Azioni extra legate alla scelta delle foto (es. primo e ultimo scatto). */
  extra?: ReactNode;
}) {
  const [dismissed, setDismissed] = useState(false);
  const best = dismissed ? null : suggestions[0] ?? null;
  return <div className="panel-section wizard-slide" style={{ padding: "var(--space-4)" }}>
    <div className="stack">
      <PhotosRecap text={photosText} onChange={onChangePhotos} hint="Le date delle foto non cambiano la data del lavoro." />
      {extra}
      {best && <div className="wizard-suggestion wizard-suggestion--big" role="group" aria-label="Lavoro suggerito">
        <div>
          <span className="wizard-eyebrow">Ti consiglio</span>
          <strong>Sembrano del lavoro «{best.job.nomeLavoro}»</strong>
          <small>{formatItalianDate(best.job.dataLavoro)} · {best.reason}</small>
        </div>
        <div className="button-row">
          <button type="button" className="primary-button" onClick={() => onAcceptSuggestion(best.job)}>Sì, aggiungi a questo lavoro</button>
          <button type="button" className="ghost-button" onClick={() => setDismissed(true)}>No, è un altro</button>
        </div>
      </div>}
      <div>
        <h3 className="wizard-title">{best ? "Oppure scegli tu" : "Queste foto sono per…"}</h3>
      </div>
      <div className="wizard-choice" role="group" aria-label="Tipo di lavoro">
        <button type="button" className="wizard-choice__card" onClick={onNew}>
          <strong>Un lavoro nuovo</strong>
          <small>Un cliente o un evento che non ho ancora in archivio</small>
        </button>
        <button type="button" className="wizard-choice__card" onClick={onExisting}>
          <strong>Un lavoro già esistente</strong>
          <small>Aggiungo le foto a un lavoro che ho già salvato</small>
        </button>
      </div>
    </div>
  </div>;
}
