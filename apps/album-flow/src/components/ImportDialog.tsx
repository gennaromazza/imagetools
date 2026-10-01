import { useMemo, useState } from "react";
import type { AlbumProjectV2 } from "@photo-tools/shared-types";
import { enrichCandidates, type EnrichPhase } from "../desktop/importer";
import { folderGroups, planImport, withoutFolders, type ImportCandidate } from "../model/import";
import { Icon } from "./icons";
import { Modal } from "./ui";

export interface ImportSource {
  candidates: ImportCandidate[];
  /** Cosa mostrare come origine: nome della cartella o «N foto scelte». */
  label: string;
  ignoredRaw: number;
  folders: number;
  /** File originali scelti nel browser, per leggere l'ora di scatto dall'EXIF. */
  originals: Map<string, File> | null;
}

export interface ImportDecision {
  candidates: ImportCandidate[];
  /** Capitolo esistente, o null per «senza capitolo». */
  chapterId: string | null;
  /** Titolo di un capitolo da creare, in alternativa a chapterId. */
  newChapterTitle?: string;
  duplicates: "skip" | "add";
}

const PHASE_LABEL: Record<EnrichPhase, string> = { misure: "Lettura delle misure", "ora di scatto": "Lettura dell'ora di scatto", valutazioni: "Lettura delle stelle" };
const NEW = "__new__";

/** Rivede cosa verrà importato, chiede il capitolo di destinazione e cosa fare dei duplicati, poi legge i dati delle foto. */
export function ImportDialog({ project, source, defaultChapterId, onClose, onConfirm }: {
  project: AlbumProjectV2;
  source: ImportSource;
  defaultChapterId: string | null;
  onClose: () => void;
  onConfirm: (decision: ImportDecision) => void;
}) {
  const groups = useMemo(() => folderGroups(source.candidates), [source.candidates]);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const candidates = useMemo(() => withoutFolders(source.candidates, excluded), [source.candidates, excluded]);
  const plan = useMemo(() => planImport(project, candidates), [project, candidates]);
  const toggleFolder = (folder: string) => setExcluded((current) => { const next = new Set(current); if (next.has(folder)) next.delete(folder); else next.add(folder); return next; });
  const [chapter, setChapter] = useState<string>(defaultChapterId ?? "");
  const [newTitle, setNewTitle] = useState("");
  const [duplicates, setDuplicates] = useState<"skip" | "add">("skip");
  const [progress, setProgress] = useState<{ phase: EnrichPhase; done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toImport = duplicates === "add" ? plan.fresh.length + plan.duplicates.length : plan.fresh.length;
  const busy = progress !== null;
  const titleTaken = chapter === NEW && project.chapters.some((existing) => existing.title.toLocaleLowerCase() === newTitle.trim().toLocaleLowerCase());
  const canConfirm = toImport > 0 && !busy && (chapter !== NEW || (newTitle.trim().length > 0 && !titleTaken));

  async function confirm() {
    setError(null);
    const chosen = duplicates === "add" ? [...plan.fresh, ...plan.duplicates.map((entry) => entry.candidate)] : plan.fresh;
    setProgress({ phase: "misure", done: 0, total: chosen.length });
    try {
      const enriched = await enrichCandidates(chosen, source.originals, (phase, done, total) => setProgress({ phase, done, total }));
      onConfirm({
        candidates: enriched,
        chapterId: chapter === NEW || chapter === "" ? null : chapter,
        newChapterTitle: chapter === NEW ? newTitle.trim() : undefined,
        duplicates,
      });
    } catch (failure) {
      setProgress(null);
      setError(failure instanceof Error ? failure.message : "Importazione non riuscita.");
    }
  }

  return (
    <Modal
      title="Importa foto"
      subtitle={source.label}
      onClose={busy ? () => undefined : onClose}
      footer={<>
        <button type="button" className="btn" onClick={onClose} disabled={busy}>Annulla</button>
        <button type="button" className="btn btn--primary" onClick={() => void confirm()} disabled={!canConfirm}>{busy ? "Importazione…" : toImport === 0 ? "Niente da importare" : `Importa ${toImport} foto`}</button>
      </>}
    >
      <ul className="import-summary" aria-label="Riepilogo">
        <li><Icon name="image" size={16} /><strong>{plan.fresh.length}</strong> {plan.fresh.length === 1 ? "foto nuova" : "foto nuove"}</li>
        {plan.duplicates.length > 0 ? <li className="is-warn"><Icon name="warning" size={16} /><strong>{plan.duplicates.length}</strong> già {plan.duplicates.length === 1 ? "presente" : "presenti"} nell'album</li> : null}
        {source.ignoredRaw > 0 ? <li><Icon name="copy" size={16} /><strong>{source.ignoredRaw}</strong> RAW non importati: esiste già il JPG con lo stesso nome</li> : null}
        {plan.repeatedInBatch > 0 ? <li><Icon name="copy" size={16} /><strong>{plan.repeatedInBatch}</strong> ripetizioni nello stesso gruppo ignorate</li> : null}
        {source.folders > 1 ? <li><Icon name="folder" size={16} /><strong>{source.folders}</strong> cartelle</li> : null}
      </ul>

      {groups.length > 1 ? (
        <fieldset className="field" disabled={busy}>
          <legend className="field__label">Cartelle da importare <button type="button" className="link-btn" onClick={() => setExcluded(new Set())}>tutte</button> · <button type="button" className="link-btn" onClick={() => setExcluded(new Set(groups.map((group) => group.folder)))}>nessuna</button></legend>
          <ul className="folder-list">
            {groups.map((group) => (
              <li key={group.folder}>
                <label className="radio"><input type="checkbox" checked={!excluded.has(group.folder)} onChange={() => toggleFolder(group.folder)} /> <span className="ellipsis" title={group.folder}>{group.folder || "Foto scelte"}</span> <span className="pill">{group.count}</span></label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}

      <label className="field">
        <span className="field__label">Metti le foto nel capitolo</span>
        <select className="select" value={chapter} onChange={(event) => setChapter(event.target.value)} disabled={busy}>
          <option value="">Senza capitolo (le assegni dopo)</option>
          {project.chapters.map((existing) => <option key={existing.id} value={existing.id}>{existing.title}</option>)}
          <option value={NEW}>Nuovo capitolo…</option>
        </select>
        {chapter === NEW ? (
          <input className="input" autoFocus placeholder="Es. Casa sposa" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} aria-label="Nome del nuovo capitolo" disabled={busy} />
        ) : null}
        {titleTaken ? <span className="field__hint warn">Esiste già un capitolo con questo nome: sceglilo dall'elenco.</span> : <span className="field__hint">Le foto si ordinano per ora di scatto; puoi cambiarlo in qualsiasi momento dalla libreria.</span>}
      </label>

      {plan.duplicates.length > 0 ? (
        <fieldset className="field" disabled={busy}>
          <legend className="field__label">Foto già nell'album</legend>
          <div className="dup-list" aria-label="Foto già presenti">
            {plan.duplicates.slice(0, 6).map((entry) => <span key={entry.existingAssetId + entry.candidate.fileName}>{entry.candidate.fileName}</span>)}
            {plan.duplicates.length > 6 ? <span className="muted">…e altre {plan.duplicates.length - 6}</span> : null}
          </div>
          <label className="radio"><input type="radio" name="dup" checked={duplicates === "skip"} onChange={() => setDuplicates("skip")} /> Salta le foto già presenti</label>
          <label className="radio"><input type="radio" name="dup" checked={duplicates === "add"} onChange={() => setDuplicates("add")} /> Aggiungile comunque come nuove foto</label>
        </fieldset>
      ) : null}

      {progress ? (
        <div className="progress" role="status" aria-live="polite">
          <div className="progress__bar"><span style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} /></div>
          <span className="muted small">{PHASE_LABEL[progress.phase]} · {progress.done} di {progress.total}</span>
        </div>
      ) : null}
      {error ? <p className="notice notice--warn">{error}</p> : null}
    </Modal>
  );
}
