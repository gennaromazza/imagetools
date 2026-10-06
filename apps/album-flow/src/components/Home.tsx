import { coverAssetOf } from "../model/library";
import { memo, useMemo, useState } from "react";
import type { AlbumAssetV2, AlbumProjectV2, AlbumStage } from "@photo-tools/shared-types";
import { useAssetSrc } from "../hooks/useAssetSrc";
import { STAGES } from "../model/store";
import { NewAlbumDialog, type NewAlbumResult } from "./NewAlbumDialog";
import { Icon } from "./icons";
import { ContextMenu, Modal, type MenuItem } from "./ui";

type View = "columns" | "list" | "grid";
type Sort = "updated" | "name" | "created";

const coverAsset = coverAssetOf;

const Cover = memo(function Cover({ project }: { project: AlbumProjectV2 }) {
  const asset = coverAsset(project);
  const src = useAssetSrc(asset, 360);
  return <div className="cover">{src ? <img src={src} alt="" draggable={false} loading="lazy" /> : <Icon name="book" size={30} />}</div>;
});

function dateLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

export interface HomeProps {
  projects: AlbumProjectV2[];
  banner: string;
  legacy: number;
  skipped: number;
  onOpen: (projectId: string) => void;
  onCreate: (result: NewAlbumResult) => void;
  /** Parte direttamente da un carosello per i social, senza impaginare un album. */
  onCreateCarousel: () => void;
  onDelete: (projectId: string) => void;
  onDuplicate: (projectId: string) => void;
  onStage: (projectId: string, stage: AlbumStage) => void;
  onExportProject: (projectId: string) => void;
  onImportProject: () => void;
  onDemo: () => void;
  reopenLast: boolean;
  onReopenLast: (on: boolean) => void;
  /** Solo nell'app desktop con Google Drive: backup automatico alla chiusura. */
  autoBackup?: boolean;
  onAutoBackup?: (on: boolean) => void;
  /** Riapre l'elenco delle novità della versione. */
  onWhatsNew?: () => void;
}

/** Elenco degli album come bacheca a colonne (da iniziare, in lavorazione, in revisione, completati), con ricerca, ordinamento e viste. */
export function Home(props: HomeProps) {
  const { projects } = props;
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  const [view, setView] = useState<View>(() => { try { return (localStorage.getItem("filex.albumFlow.homeView") as View) || "columns"; } catch { return "columns"; } });
  const [menu, setMenu] = useState<{ x: number; y: number; project: AlbumProjectV2 } | null>(null);
  const [dragOver, setDragOver] = useState<AlbumStage | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const changeView = (next: View) => { setView(next); try { localStorage.setItem("filex.albumFlow.homeView", next); } catch { /* preferenza non critica */ } };

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const list = projects.filter((project) => !needle || project.projectName.toLocaleLowerCase().includes(needle));
    return list.sort((a, b) => sort === "name" ? a.projectName.localeCompare(b.projectName, "it", { numeric: true, sensitivity: "base" }) : sort === "created" ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt));
  }, [projects, query, sort]);

  const toDelete = projects.find((project) => project.projectId === confirmDelete);
  const photos = (project: AlbumProjectV2) => project.assets.length;

  const menuItems = (project: AlbumProjectV2): MenuItem[] => [
    { label: "Apri", icon: "book", onClick: () => props.onOpen(project.projectId) },
    { label: "Duplica", icon: "copy", onClick: () => props.onDuplicate(project.projectId) },
    { label: "Sposta in", icon: "columns", children: STAGES.map((stage) => ({ label: stage.label, disabled: stage.id === project.stage, onClick: () => props.onStage(project.projectId, stage.id) })) },
    { label: "Salva come file progetto", icon: "export", onClick: () => props.onExportProject(project.projectId) },
    { separator: true, label: "-" },
    { label: "Elimina", icon: "trash", danger: true, onClick: () => setConfirmDelete(project.projectId) },
  ];

  const Card = (project: AlbumProjectV2) => (
    <article
      key={project.projectId}
      className={`album${dragging === project.projectId ? " is-dragging" : ""}`}
      draggable
      onDragStart={(event) => { setDragging(project.projectId); event.dataTransfer.setData("text/plain", project.projectId); event.dataTransfer.effectAllowed = "move"; }}
      onDragEnd={() => { setDragging(null); setDragOver(null); }}
      data-project-id={project.projectId}
      onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, project }); }}
    >
      <button type="button" className="album__open" onClick={() => props.onOpen(project.projectId)} aria-label={`Apri ${project.projectName}`}>
        <Cover project={project} />
        <div className="album__info">
          <strong className="ellipsis">{project.projectName}</strong>
          <span className="muted small">{project.settings.sheet.widthCm.toLocaleString("it-IT")}×{project.settings.sheet.heightCm.toLocaleString("it-IT")} cm · {project.spreads.length} spread · {photos(project)} foto</span>
          <span className="muted small">{dateLabel(project.updatedAt)}</span>
        </div>
      </button>
      <button type="button" className="icon-btn album__menu" aria-label={`Azioni su ${project.projectName}`} onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); setMenu({ x: box.left, y: box.bottom + 4, project }); }}><Icon name="dots" /></button>
    </article>
  );

  return (
    <div className="home" data-testid="home">
      <header className="home__head">
        <div className="home__brand">
          <span className="home__logo" aria-hidden="true"><img src={`${import.meta.env.BASE_URL}album-flow.png`} alt="" width={56} height={56} /></span>
          <div>
            <p className="eyebrow">FileX Suite</p>
            <h1>Album Flow</h1>
          </div>
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn--primary btn--lg" onClick={() => setCreating(true)}><Icon name="plus" size={17} /> Nuovo album</button>
          <button type="button" className="btn btn--lg" onClick={props.onCreateCarousel} title="Crea un carosello o una storia per Instagram partendo dalle foto, senza impaginare un album"><Icon name="image" size={17} /> Nuovo carosello</button>
          <button type="button" className="btn btn--lg" onClick={props.onImportProject}><Icon name="folder" size={17} /> Apri progetto…</button>
        </div>
      </header>

      <section className="flow" aria-label="Flusso di lavoro">
        <div className="flow__step"><b>1</b><span><strong>Archivio Flow</strong>Importa e ordina gli scatti</span></div>
        <Icon name="chevronRight" size={16} className="flow__arrow" />
        <div className="flow__step"><b>2</b><span><strong>Image Select Pro</strong>Seleziona, valuta, etichetta</span></div>
        <Icon name="chevronRight" size={16} className="flow__arrow" />
        <div className="flow__step flow__step--active"><b>3</b><span><strong>Album Flow</strong>Impagina e consegna</span></div>
      </section>
      {props.banner ? <p className="notice" role="status">{props.banner}</p> : null}
      {props.legacy > 0 ? <p className="notice notice--warn">{props.legacy} {props.legacy === 1 ? "album creato con la versione precedente non è compatibile" : "album creati con la versione precedente non sono compatibili"} con il nuovo motore di impaginazione. Non sono stati modificati né cancellati.</p> : null}
      {props.skipped > 0 ? <p className="notice notice--warn">{props.skipped} {props.skipped === 1 ? "album non ha superato i controlli" : "album non hanno superato i controlli"} e {props.skipped === 1 ? "è stato messo" : "sono stati messi"} da parte senza cancellarlo.</p> : null}

      <div className="home__tools">
        <label className="home__search"><Icon name="search" size={16} /><input type="search" placeholder="Cerca un album" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Cerca un album" /></label>
        <label className="home__sort home__reopen" title="All'avvio apre direttamente l'ultimo album su cui stavi lavorando"><input type="checkbox" checked={props.reopenLast} onChange={(event) => props.onReopenLast(event.target.checked)} /> Riapri l'ultimo album all'avvio</label>
        {props.onAutoBackup ? <label className="home__sort home__reopen" title="Quando chiudi il programma, salva su Google Drive il progetto degli album modificati (mai le foto). Serve aver collegato Drive dal pulsante «Drive» di un album."><input type="checkbox" checked={Boolean(props.autoBackup)} onChange={(event) => props.onAutoBackup?.(event.target.checked)} /> Backup su Drive alla chiusura</label> : null}
        {props.onWhatsNew ? <button type="button" className="btn btn--ghost btn--sm" onClick={props.onWhatsNew} title="Cosa c'è di nuovo in questa versione e dove trovarlo">Novità</button> : null}
        <label className="home__sort"><Icon name="sort" size={16} />
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} aria-label="Ordina gli album">
            <option value="updated">Ultima modifica</option>
            <option value="name">Nome</option>
            <option value="created">Data di creazione</option>
          </select>
        </label>
        <div className="segmented" role="group" aria-label="Vista">
          {([["columns", "columns", "Colonne"], ["list", "list", "Elenco"], ["grid", "grid", "Griglia"]] as const).map(([id, icon, label]) => (
            <button key={id} type="button" className={view === id ? "is-active" : ""} aria-pressed={view === id} onClick={() => changeView(id)} title={label} aria-label={label}><Icon name={icon} size={16} /></button>
          ))}
        </div>
        <span className="spacer" />
        <button type="button" className="btn btn--ghost btn--sm" onClick={props.onDemo}>Crea album di prova</button>
      </div>

      {projects.length === 0 ? (
        <div className="empty-card">
          <Icon name="book" size={34} />
          <h2>Nessun album</h2>
          <p className="muted">Invia una selezione da Image Select Pro, crea un album vuoto, oppure prova l'editor con foto di esempio.</p>
          <div className="btn-row btn-row--center">
            <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>Nuovo album</button>
            <button type="button" className="btn" onClick={props.onCreateCarousel}>Nuovo carosello</button>
            <button type="button" className="btn" onClick={props.onDemo}>Album di prova</button>
          </div>
        </div>
      ) : view === "columns" ? (
        <div className="board" aria-label="Album per fase">
          {STAGES.map((stage) => {
            const items = filtered.filter((project) => project.stage === stage.id);
            return (
              <section
                key={stage.id}
                className={`board__col${dragOver === stage.id ? " is-over" : ""}`}
                aria-label={stage.label}
                onDragOver={(event) => { if (dragging) { event.preventDefault(); setDragOver(stage.id); } }}
                onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(null); }}
                onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("text/plain"); setDragOver(null); setDragging(null); if (id) props.onStage(id, stage.id); }}
              >
                <header><span className={`stage-dot stage-dot--${stage.id}`} /><h2>{stage.label}</h2><span className="pill">{items.length}</span></header>
                <p className="muted small board__hint">{stage.hint}</p>
                <div className="board__cards">
                  {items.map(Card)}
                  {items.length === 0 ? <div className="board__empty">Trascina qui un album</div> : null}
                </div>
              </section>
            );
          })}
        </div>
      ) : view === "grid" ? (
        <div className="album-grid">{filtered.map(Card)}</div>
      ) : (
        <table className="album-table">
          <thead><tr><th>Album</th><th>Fase</th><th>Formato</th><th>Spread</th><th>Foto</th><th>Modificato</th><th /></tr></thead>
          <tbody>
            {filtered.map((project) => (
              <tr key={project.projectId} onDoubleClick={() => props.onOpen(project.projectId)} onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, project }); }}>
                <td><button type="button" className="link-btn" onClick={() => props.onOpen(project.projectId)}>{project.projectName}</button></td>
                <td><select value={project.stage} onChange={(event) => props.onStage(project.projectId, event.target.value as AlbumStage)} aria-label={`Fase di ${project.projectName}`}>{STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></td>
                <td>{project.settings.sheet.widthCm}×{project.settings.sheet.heightCm} cm</td>
                <td>{project.spreads.length}</td>
                <td>{photos(project)}</td>
                <td>{dateLabel(project.updatedAt)}</td>
                <td><button type="button" className="icon-btn" aria-label={`Azioni su ${project.projectName}`} onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); setMenu({ x: box.left - 120, y: box.bottom + 4, project }); }}><Icon name="dots" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {projects.length > 0 && filtered.length === 0 ? <p className="muted">Nessun album corrisponde a «{query}».</p> : null}

      {creating ? <NewAlbumDialog onClose={() => setCreating(false)} onCreate={(result) => { setCreating(false); props.onCreate(result); }} /> : null}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.project)} onClose={() => setMenu(null)} /> : null}
      {toDelete ? (
        <Modal title="Eliminare l'album?" onClose={() => setConfirmDelete(null)} footer={<><button type="button" className="btn" onClick={() => setConfirmDelete(null)}>Annulla</button><button type="button" className="btn btn--danger" onClick={() => { props.onDelete(toDelete.projectId); setConfirmDelete(null); }}>Elimina</button></>}>
          <p>«{toDelete.projectName}» verrà rimosso da Album Flow. Le fotografie originali non vengono toccate. Puoi salvare prima un file progetto dal menu dell'album.</p>
        </Modal>
      ) : null}
    </div>
  );
}
