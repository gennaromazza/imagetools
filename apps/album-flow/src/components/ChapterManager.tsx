import { useState } from "react";
import type { AlbumProjectV2 } from "@photo-tools/shared-types";
import { BUILTIN_CHAPTER_PRESETS, CHAPTER_COLORS, deleteChapterPreset, loadChapterPresets, saveChapterPreset, type ChapterPreset } from "../model/chapters";
import { Icon } from "./icons";
import { ColorDots, IconButton, Modal } from "./ui";

export interface ChapterManagerProps {
  project: AlbumProjectV2;
  onClose: () => void;
  onCreate: (title: string, color?: string) => void;
  onRename: (chapterId: string, title: string) => void;
  onRecolor: (chapterId: string, color: string) => void;
  onMove: (chapterId: string, direction: -1 | 1) => void;
  onRemove: (chapterId: string) => void;
  onApplyPreset: (preset: ChapterPreset) => void;
  onError: (message: string) => void;
}

/** Capitoli dell'album: nome, colore, ordine (è l'ordine dell'album), gruppi predefiniti e gruppi salvati. */
export function ChapterManager({ project, onClose, onCreate, onRename, onRecolor, onMove, onRemove, onApplyPreset, onError }: ChapterManagerProps) {
  const [title, setTitle] = useState("");
  const [presets, setPresets] = useState<ChapterPreset[]>(() => loadChapterPresets());
  const [saveName, setSaveName] = useState("");

  const add = () => { if (title.trim()) { onCreate(title.trim()); setTitle(""); } };
  const savePreset = () => {
    try { setPresets(saveChapterPreset(saveName, project.chapters.map((chapter) => chapter.title))); setSaveName(""); }
    catch (error) { onError(error instanceof Error ? error.message : "Impossibile salvare il gruppo."); }
  };

  return (
    <Modal title="Capitoli" subtitle="Dividono l'album in sezioni: Auto Build parte da uno spread nuovo a ogni capitolo, nell'ordine qui sotto." onClose={onClose} wide>
      <div className="chapters-grid">
        <section>
          <h3>Capitoli dell'album</h3>
          <ol className="chapter-rows">
            {project.chapters.map((chapter, index) => (
              <li key={chapter.id} className="chapter-row" style={{ "--chapter": chapter.color } as React.CSSProperties}>
                <span className="chapter-row__num">{index + 1}</span>
                <input className="input input--bare" defaultValue={chapter.title} aria-label={`Nome del capitolo ${index + 1}`}
                  onBlur={(event) => { const value = event.target.value.trim(); if (value && value !== chapter.title) onRename(chapter.id, value); else event.target.value = chapter.title; }}
                  onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }} />
                <span className="pill">{chapter.assetIds.length}</span>
                <ColorDots value={chapter.color} swatches={CHAPTER_COLORS.slice(0, 5)} onChange={(color) => onRecolor(chapter.id, color)} label={`Colore di ${chapter.title}`} />
                <IconButton icon="chevronUp" label="Sposta su" onClick={() => onMove(chapter.id, -1)} disabled={index === 0} size={15} />
                <IconButton icon="chevronDown" label="Sposta giù" onClick={() => onMove(chapter.id, 1)} disabled={index === project.chapters.length - 1} size={15} />
                <IconButton icon="trash" label={`Elimina il capitolo ${chapter.title}`} onClick={() => onRemove(chapter.id)} danger size={15} />
              </li>
            ))}
            {project.chapters.length === 0 ? <li className="empty muted">Nessun capitolo. Parti da un gruppo predefinito o creane uno.</li> : null}
          </ol>
          <form className="row" onSubmit={(event) => { event.preventDefault(); add(); }}>
            <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Nuovo capitolo (es. Cerimonia)" aria-label="Nome del nuovo capitolo" />
            <button type="submit" className="btn btn--primary" disabled={!title.trim()}><Icon name="plus" size={15} /> Aggiungi</button>
          </form>
          <p className="muted small">Eliminare un capitolo non cancella le foto: tornano «senza capitolo».</p>
        </section>

        <section>
          <h3>Gruppi di capitoli</h3>
          <p className="muted small">Aggiungono in un clic i capitoli tipici di un servizio (quelli già presenti non si duplicano).</p>
          <ul className="preset-list">
            {[...BUILTIN_CHAPTER_PRESETS, ...presets].map((preset) => (
              <li key={preset.id}>
                <button type="button" className="preset" onClick={() => onApplyPreset(preset)}>
                  <strong>{preset.name}</strong>
                  <span>{preset.titles.join(" · ")}</span>
                </button>
                {!preset.builtin ? <IconButton icon="trash" label={`Elimina il gruppo ${preset.name}`} onClick={() => setPresets(deleteChapterPreset(preset.id))} size={14} danger /> : null}
              </li>
            ))}
          </ul>
          <form className="row" onSubmit={(event) => { event.preventDefault(); savePreset(); }}>
            <input className="input" value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="Salva questi capitoli come gruppo…" aria-label="Nome del gruppo da salvare" disabled={project.chapters.length === 0} />
            <button type="submit" className="btn" disabled={!saveName.trim() || project.chapters.length === 0}>Salva</button>
          </form>
        </section>
      </div>
    </Modal>
  );
}
