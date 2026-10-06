import { useEffect, useMemo, useState } from "react";
import type { AlbumProjectV2, AlbumSpread, SpreadOverlay } from "@photo-tools/shared-types";
import { overlaysOf } from "../model/design";
import { STORY_SPACE_LABEL, filterStories, isStoryUsed, storyContextFor, usedTextKeys, type StoryFilters } from "../model/story";
import {
  STORY_CATEGORIES, STORY_CATEGORY_LABEL, STORY_INTENSITY_LABEL, STORY_LENGTHS, STORY_LENGTH_LABEL, STORY_LIBRARY, STORY_TONES, STORY_TONE_LABEL,
  STORY_TYPES, STORY_TYPE_LABEL, type StoryIntensity, type StoryUnit,
} from "../model/storyLibrary";
import type { DesignActions } from "./DesignPanel";

/** Quante voci si mostrano alla volta nell'elenco: la libreria ne ha centinaia. */
const PAGE = 24;

interface LastProposal {
  spreadId: string;
  ids: string[];
  attempt: number;
  summary: string;
}

function Select<T extends string | number>({ label, value, options, onChange }: { label: string; value: T | ""; options: ReadonlyArray<{ value: T; label: string }>; onChange: (value: T | "") => void }) {
  return (
    <label className="design__field story__select">
      <span>{label}</span>
      <select className="input" value={String(value)} onChange={(event) => { const raw = event.target.value; onChange(raw === "" ? "" : (typeof options[0]?.value === "number" ? Number(raw) : raw) as T); }} aria-label={label}>
        <option value="">Tutte</option>
        {options.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
      </select>
    </label>
  );
}

function StoryCard({ unit, used, canReplace, onInsert, onReplace }: { unit: StoryUnit; used: boolean; canReplace: boolean; onInsert: () => void; onReplace: () => void }) {
  return (
    <article className="story__card">
      <div className="story__meta">
        <span>{STORY_CATEGORY_LABEL[unit.category]}</span>
        <span>{STORY_TYPE_LABEL[unit.type]}</span>
        <span>{STORY_TONE_LABEL[unit.tone]}</span>
        {used ? <span className="story__used">Già nell'album</span> : null}
      </div>
      {unit.title ? <strong className="story__title">{unit.title}</strong> : null}
      {unit.text ? <p className="story__text">{unit.text}</p> : null}
      {unit.author ? <small className="muted">— {unit.author} · citazione: controlla la fonte prima di stampare</small> : null}
      <div className="btn-row">
        <button type="button" className="btn btn--sm" onClick={onInsert}>Aggiungi alla pagina</button>
        {canReplace ? <button type="button" className="btn btn--sm" onClick={onReplace} title="Cambia il testo dell'elemento selezionato, lasciandone lo stile">Usa nel testo selezionato</button> : null}
      </div>
    </article>
  );
}

/**
 * «Racconto»: testi narrativi per accompagnare le foto. In alto la proposta automatica per la pagina attiva (con «Rigenera testo»),
 * poi i testi per tutto l'album, infine la libreria da sfogliare con i filtri e da usare a mano.
 */
export function StoryTab({ project, spread, areaIndex, selected, actions }: { project: AlbumProjectV2; spread: AlbumSpread; areaIndex: number; selected: SpreadOverlay | undefined; actions: DesignActions }) {
  const [last, setLast] = useState<LastProposal | null>(null);
  const [quotes, setQuotes] = useState(false);
  const [filters, setFilters] = useState<StoryFilters>({});
  const [shown, setShown] = useState(PAGE);

  useEffect(() => { setLast(null); }, [spread.id]);
  useEffect(() => { setShown(PAGE); }, [filters]);

  // La proposta resta valida finché i suoi testi sono ancora sullo spread (se li togli o annulli, sparisce la scheda).
  const present = new Set(overlaysOf(spread).map((overlay) => overlay.id));
  const current = last && last.spreadId === spread.id && last.ids.length > 0 && last.ids.every((id) => present.has(id)) ? last : null;

  const context = useMemo(() => storyContextFor(project, spread.id, areaIndex, { includeQuotes: quotes }), [project, spread.id, areaIndex, quotes]);
  const usedKeys = useMemo(() => usedTextKeys(project), [project]);
  const list = useMemo(() => filterStories(filters), [filters]);
  const phaseLabel = context?.phase ? STORY_CATEGORY_LABEL[context.phase] : "non riconosciuta";
  const pageLabel = spread.areas.length < 2 ? "foglio intero" : areaIndex === 0 ? "pagina sinistra" : "pagina destra";
  const canReplace = selected?.kind === "text";

  const propose = (attempt: number, replace: readonly string[]) => {
    const result = actions.suggestStory(areaIndex, { attempt, replace, includeQuotes: quotes });
    if (!result) {
      actions.notify("Non trovo un testo adatto che non sia già nell'album. Prova a sfogliare la libreria o a includere le citazioni.");
      return;
    }
    const { title, text, author } = result.proposal;
    setLast({ spreadId: spread.id, ids: result.overlayIds, attempt, summary: [title, text, author ? `— ${author}` : ""].filter(Boolean).join("\n") });
  };

  const setFilter = (patch: Partial<StoryFilters>) => setFilters((previous) => ({ ...previous, ...patch }));
  const filtered = Object.values(filters).some((value) => (Array.isArray(value) ? value.length > 0 : Boolean(value) && value !== "all"));

  return (
    <>
      <div className="design__section">
        <p className="small muted">Testi che accompagnano le foto come un racconto, scritti per essere letti e non per spiegare ciò che si vede. Il programma sceglie in base a dove sei nell'album e a quanto spazio c'è.</p>
        <h4>Proposta per questa pagina</h4>
        <p className="small muted">{pageLabel} · {context ? STORY_SPACE_LABEL[context.space] : "—"} · fase: {phaseLabel}{context?.position === "opening" ? " · apertura" : context?.position === "closing" ? " · chiusura" : ""}</p>
        {current ? (
          <div className="design__card">
            <p className="story__summary">{current.summary}</p>
            <div className="btn-row">
              <button type="button" className="btn btn--sm btn--primary" onClick={() => propose(current.attempt + 1, current.ids)}>Rigenera testo</button>
              <button type="button" className="btn btn--sm" onClick={() => { actions.removeOverlays(current.ids); setLast(null); }}>Togli</button>
            </div>
            <p className="small muted">Trascina il testo dove vuoi e cambialo dalla scheda «Testo».</p>
          </div>
        ) : (
          <button type="button" className="btn btn--sm btn--primary" onClick={() => propose(0, [])}>Proponi un testo</button>
        )}
        <label className="design__check">
          <input type="checkbox" checked={quotes} onChange={(event) => setQuotes(event.target.checked)} />
          <span>Includi le citazioni d'autore nelle proposte</span>
        </label>
      </div>

      <div className="design__section">
        <h4>Per tutto l'album</h4>
        <p className="small muted">Mette un testo sulle pagine libere: in apertura, all'inizio dei capitoli e in chiusura, non a ogni pagina. Non ripete mai un testo. Si annulla con Ctrl/⌘ + Z.</p>
        <button type="button" className="btn btn--sm" onClick={() => {
          const count = actions.planStories();
          actions.notify(count === 1 ? "Aggiunto 1 testo narrativo (Ctrl/⌘ + Z per annullare)." : count > 1 ? `Aggiunti ${count} testi narrativi (Ctrl/⌘ + Z per annullare).` : "Nessuna pagina libera adatta: i testi vanno sulle pagine senza foto.");
        }}>Proponi i testi per l'album</button>
      </div>

      <div className="design__section">
        <h4>Sfoglia la libreria</h4>
        <input className="input" value={filters.query ?? ""} onChange={(event) => setFilter({ query: event.target.value })} placeholder="Cerca una parola…" aria-label="Cerca nella libreria" />
        <div className="story__filters">
          <Select label="Categoria" value={filters.categories?.[0] ?? ""} options={STORY_CATEGORIES.map((value) => ({ value, label: STORY_CATEGORY_LABEL[value] }))} onChange={(value) => setFilter({ categories: value ? [value] : undefined })} />
          <Select label="Tipo" value={filters.types?.[0] ?? ""} options={STORY_TYPES.map((value) => ({ value, label: STORY_TYPE_LABEL[value] }))} onChange={(value) => setFilter({ types: value ? [value] : undefined })} />
          <Select label="Lunghezza" value={filters.lengths?.[0] ?? ""} options={STORY_LENGTHS.map((value) => ({ value, label: STORY_LENGTH_LABEL[value] }))} onChange={(value) => setFilter({ lengths: value ? [value] : undefined })} />
          <Select label="Tono" value={filters.tones?.[0] ?? ""} options={STORY_TONES.map((value) => ({ value, label: STORY_TONE_LABEL[value] }))} onChange={(value) => setFilter({ tones: value ? [value] : undefined })} />
          <Select<StoryIntensity> label="Intensità" value={filters.intensities?.[0] ?? ""} options={([1, 2, 3, 4, 5] as const).map((value) => ({ value, label: `${value} · ${STORY_INTENSITY_LABEL[value]}` }))} onChange={(value) => setFilter({ intensities: value ? [value] : undefined })} />
          <label className="design__field story__select">
            <span>Origine</span>
            <select className="input" value={filters.origin ?? "all"} onChange={(event) => setFilter({ origin: event.target.value as StoryFilters["origin"] })} aria-label="Origine">
              <option value="all">Tutte</option>
              <option value="original">Frasi originali</option>
              <option value="quote">Citazioni d'autore</option>
            </select>
          </label>
        </div>
        <p className="small muted">{list.length} di {STORY_LIBRARY.length} testi{filtered ? " con questi filtri" : ""}.{filtered ? <> <button type="button" className="design__link" onClick={() => setFilters({})}>Azzera i filtri</button></> : null}</p>
        <div className="story__list">
          {list.slice(0, shown).map((unit) => (
            <StoryCard
              key={unit.id}
              unit={unit}
              used={isStoryUsed(unit, usedKeys)}
              canReplace={canReplace}
              onInsert={() => { if (actions.insertStoryUnit(unit.id, areaIndex)) actions.notify("Testo aggiunto alla pagina."); }}
              onReplace={() => { if (selected) actions.replaceWithStoryUnit(selected.id, unit.id); }}
            />
          ))}
        </div>
        {list.length > shown ? <button type="button" className="btn btn--sm" onClick={() => setShown((value) => value + PAGE)}>Mostra altri {Math.min(PAGE, list.length - shown)}</button> : null}
      </div>
    </>
  );
}
