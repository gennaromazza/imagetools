import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { AlbumAssetV2, AlbumProjectV2 } from "@photo-tools/shared-types";
import { beginDrag, currentDrag, endDrag } from "./dnd";
import { Icon } from "./icons";
import { SpreadView } from "./SpreadView";
import { ContextMenu } from "./ui";

export interface FilmstripProps {
  project: AlbumProjectV2;
  assets: ReadonlyMap<string, AlbumAssetV2>;
  current: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onDuplicate: (index: number) => void;
  onRemove: (index: number) => void;
  onMove: (from: number, to: number) => void;
  /** Una foto (dalla libreria o da uno spread) è stata rilasciata tra due spread: ne nasce uno nuovo in quella posizione. */
  /** Una foto è stata rilasciata sulla miniatura di uno spread: viene aggiunta a quello spread. */
  onDropOn: (index: number, payload: { kind: "assets"; assetIds: string[] } | { kind: "item"; itemId: string }) => void;
  onDropNew: (atIndex: number, payload: { kind: "assets"; assetIds: string[] } | { kind: "item"; itemId: string }) => void;
}

/** Striscia sottile con tutti gli spread: numero, miniatura, colore del capitolo; trascina per riordinare. */
/** Zona stretta tra due spread (e in fondo): rilasciandovi una foto si crea un nuovo spread in quel punto. */
function Gap({ index, onDropNew }: { index: number; onDropNew: FilmstripProps["onDropNew"] }) {
  const accepts = () => { const kind = currentDrag()?.kind; return kind === "assets" || kind === "item"; };
  return (
    <div
      className="film__gap"
      aria-hidden="true"
      onDragOver={(event) => { if (accepts()) { event.preventDefault(); event.dataTransfer.dropEffect = currentDrag()?.kind === "item" ? "move" : "copy"; event.currentTarget.classList.add("is-drop"); } }}
      onDragLeave={(event) => event.currentTarget.classList.remove("is-drop")}
      onDrop={(event) => {
        event.currentTarget.classList.remove("is-drop");
        const payload = currentDrag();
        if (payload?.kind !== "assets" && payload?.kind !== "item") return;
        event.preventDefault();
        endDrag();
        onDropNew(index, payload);
      }}
    />
  );
}

export function Filmstrip({ project, assets, current, onSelect, onAdd, onDuplicate, onRemove, onMove, onDropNew, onDropOn }: FilmstripProps) {
  const currentRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null);
  useEffect(() => { currentRef.current?.scrollIntoView?.({ block: "nearest", inline: "center", behavior: "smooth" }); }, [current]);

  const chapterByAsset = useMemo(() => {
    const map = new Map<string, { title: string; color: string }>();
    for (const chapter of project.chapters) for (const id of chapter.assetIds) map.set(id, { title: chapter.title, color: chapter.color });
    return map;
  }, [project.chapters]);

  return (
    <nav className="film" aria-label="Spread dell'album">
      <div className="film__track">
        {project.spreads.map((spread, index) => {
          const chapter = spread.areas.flatMap((area) => area.items).map((item) => chapterByAsset.get(item.assetId)).find(Boolean);
          const photos = spread.areas.reduce((sum, area) => sum + area.items.length, 0);
          const empty = spread.areas.some((area) => area.items.length === 0);
          return (
            <Fragment key={spread.id}>
            <Gap index={index} onDropNew={onDropNew} />
            <div
              ref={index === current ? currentRef : undefined}
              className={`film__item${index === current ? " is-current" : ""}`}
              draggable
              onDragStart={(event) => beginDrag(event, { kind: "spread", index })}
              onDragEnd={endDrag}
              onDragOver={(event) => { const kind = currentDrag()?.kind; if (kind === "spread" || kind === "item" || kind === "assets") { event.preventDefault(); event.dataTransfer.dropEffect = kind === "assets" ? "copy" : "move"; event.currentTarget.classList.add("is-drop"); } }}
              onDragLeave={(event) => event.currentTarget.classList.remove("is-drop")}
              onDrop={(event) => {
                event.preventDefault();
                event.currentTarget.classList.remove("is-drop");
                const payload = currentDrag();
                endDrag();
                if (payload?.kind === "spread") onMove(payload.index, index);
                else if (payload?.kind === "item" || payload?.kind === "assets") onDropOn(index, payload);
              }}
              onClick={() => onSelect(index)}
              onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, index }); }}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => { if (event.key === "Enter") onSelect(index); }}
              aria-label={`Spread ${index + 1}${chapter ? `, ${chapter.title}` : ""}, ${photos} foto`}
              aria-current={index === current ? "true" : undefined}
              data-spread-index={index}
              title={`Spread ${index + 1} · ${photos} foto${chapter ? ` · ${chapter.title}` : ""}${empty ? " · pagina vuota" : ""}`}
            >
              <span className="film__num">{index + 1}</span>
              <div className="film__thumb"><SpreadView sheet={project.settings.sheet} spread={spread} assets={assets} variant="thumb" /></div>
              <span className="film__bar" style={{ background: chapter?.color ?? "transparent" }} />
              {empty && photos > 0 ? <span className="film__warn" aria-label="Pagina vuota" /> : null}
              {spread.done ? <span className="film__done" aria-label="Spread finito" title="Finito"><Icon name="check" size={9} strokeWidth={3} /></span> : null}
            </div>
            </Fragment>
          );
        })}
        <Gap index={project.spreads.length} onDropNew={onDropNew} />
        <button type="button" className="film__add" onClick={onAdd} title="Aggiungi uno spread vuoto" aria-label="Aggiungi uno spread"><Icon name="plus" size={18} /></button>
      </div>
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: `Spread ${menu.index + 1}`, disabled: true },
            { label: "Duplica lo spread", icon: "copy", onClick: () => onDuplicate(menu.index) },
            { label: "Sposta all'inizio", icon: "chevronUp", disabled: menu.index === 0, onClick: () => onMove(menu.index, 0) },
            { label: "Sposta in fondo", icon: "chevronDown", disabled: menu.index === project.spreads.length - 1, onClick: () => onMove(menu.index, project.spreads.length - 1) },
            { separator: true, label: "-" },
            { label: "Elimina lo spread", icon: "trash", danger: true, onClick: () => onRemove(menu.index) },
          ]}
        />
      ) : null}
    </nav>
  );
}
