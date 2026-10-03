import { useMemo, useState } from "react";
import type { Job } from "../types";
import { formatItalianDate, pickJobs } from "../wizardModel";

/** Scelta del lavoro esistente: ricerca + schede cliccabili, al posto di menu a tendina con centinaia di voci. */
export function JobPicker({ jobs, selectedId, query, onQueryChange, onPick, invalid }: {
  jobs: Job[]; selectedId: string; query: string; invalid?: boolean;
  onQueryChange: (value: string) => void; onPick: (job: Job) => void;
}) {
  const [limit, setLimit] = useState(6);
  const result = useMemo(() => pickJobs(jobs, query, selectedId, limit), [jobs, query, selectedId, limit]);
  return <div className="job-picker">
    <label className="field">
      <span>Cerca per nome del cliente, data o cartella</span>
      <input type="search" value={query} onChange={event => { setLimit(6); onQueryChange(event.target.value); }} placeholder="es. Rossi, 2026-06, matrimonio" autoFocus />
    </label>
    {result.items.length === 0
      ? <p className="job-picker__empty">{jobs.length === 0 ? "Non c'è ancora nessun lavoro nell'archivio. Scegli “Nuovo lavoro”." : "Nessun lavoro trovato: prova con meno parole."}</p>
      : <ul className={`job-picker__list${invalid ? " job-picker__list--invalid" : ""}`} aria-label="Lavori trovati">
        {result.items.map(job => <li key={job.id}>
          <button type="button" className={`job-picker__item${job.id === selectedId ? " is-selected" : ""}`} aria-pressed={job.id === selectedId} onClick={() => onPick(job)}>
            <strong>{job.nomeLavoro}</strong>
            <span>{formatItalianDate(job.dataLavoro)} · {job.autore}</span>
            {job.id === selectedId && <em>✓ Scelto</em>}
          </button>
        </li>)}
      </ul>}
    {result.hidden > 0 && <button type="button" className="ghost-button" onClick={() => setLimit(value => value + 12)}>Mostra altri ({result.hidden})</button>}
  </div>;
}
