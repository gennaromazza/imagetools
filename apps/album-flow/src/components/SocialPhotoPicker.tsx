import { useMemo, useState, type ReactNode } from "react";
import type { AlbumAssetV2 } from "@photo-tools/shared-types";
import { useAssetSrc } from "../hooks/useAssetSrc";
import { itemAspect, type Project } from "../model/project";
import { rankPhotos } from "../social/plan";
import { Icon } from "./icons";

const PAGE = 120;
const HINT_KEY = "filex.albumFlow.social.pickerOpened";
/** Quante volte si è aperto il selettore (compreso questo): il suggerimento resta visibile le prime volte. */
function countOpening(): number {
  try {
    const next = Number(localStorage.getItem(HINT_KEY) ?? "0") + 1;
    localStorage.setItem(HINT_KEY, String(next));
    return next;
  } catch { return 1; }
}

function Thumb({ asset, used, onPick }: { asset: AlbumAssetV2; used: boolean; onPick: () => void }) {
  const src = useAssetSrc(asset, 240);
  const rating = asset.rating ?? asset.selectorRating ?? 0;
  return (
    <button type="button" className={`social-pick__thumb${used ? " is-used" : ""}`} onClick={onPick} title={`${asset.fileName}${used ? " · già nel carosello" : ""}`}>
      {src ? <img src={src} alt="" draggable={false} /> : null}
      {rating > 0 ? <span className="social-pick__stars"><Icon name="star" size={10} /> {rating}</span> : null}
      {used ? <span className="social-pick__used" title="Già nel carosello"><Icon name="check" size={11} /></span> : null}
    </button>
  );
}

type Filter = "all" | "stars" | "social" | "wide" | "xwide";
type Order = "chapters" | "time" | "best";

interface Section { key: string; title: string | null; color?: string; assets: AlbumAssetV2[] }

/** Le foto in ordine di scatto; a parità (o senza ora) resta l'ordine dell'album. */
function byTime(project: Project, assets: readonly AlbumAssetV2[]): AlbumAssetV2[] {
  const position = new Map(project.assets.map((asset, index) => [asset.id, index]));
  return [...assets].sort((a, b) => (a.captureTimeMs ?? 0) - (b.captureTimeMs ?? 0) || (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
}

/**
 * Scelta di una foto dell'album. Le foto si vedono in ordine leggibile: per capitolo (se l'album ne ha), in ordine di scatto,
 * oppure con le migliori per prime. I filtri tolgono le foto che non servono.
 */
export function SocialPhotoPicker({ project, title, used, wideOnly = false, onPick, onClose, footer }: {
  project: Project;
  title: string;
  used: ReadonlySet<string>;
  wideOnly?: boolean;
  onPick: (assetId: string) => void;
  onClose: () => void;
  footer?: ReactNode;
}) {
  const hasChapters = project.chapters.some((chapter) => chapter.assetIds.length > 0);
  const hasMarked = project.assets.some((asset) => asset.albumTags?.includes("social"));
  // Si parte dalle foto segnate «Per i social»: sono quelle che il fotografo ha già scelto per il carosello.
  const [filter, setFilter] = useState<Filter>(wideOnly ? "wide" : hasMarked ? "social" : "all");
  const [opening] = useState(countOpening);
  const [order, setOrder] = useState<Order>(hasChapters ? "chapters" : "time");
  const [shown, setShown] = useState(PAGE);

  const sections = useMemo<Section[]>(() => {
    const pass = (asset: AlbumAssetV2) => {
      if (asset.pickStatus === "rejected") return false;
      const aspect = itemAspect(asset);
      if (filter === "stars") return (asset.rating ?? asset.selectorRating ?? 0) >= 4;
      if (filter === "social") return Boolean(asset.albumTags?.includes("social"));
      if (filter === "wide") return aspect >= 1.25;
      if (filter === "xwide") return aspect >= 1.9;
      return true;
    };
    const eligible = project.assets.filter(pass);
    if (order === "best") {
      const byId = new Map(eligible.map((asset) => [asset.id, asset]));
      const assets = rankPhotos(project).map((ranked) => byId.get(ranked.assetId)).filter((asset): asset is AlbumAssetV2 => Boolean(asset));
      return [{ key: "best", title: null, assets }];
    }
    if (order === "time") return [{ key: "time", title: null, assets: byTime(project, eligible) }];
    const placed = new Set<string>();
    const result: Section[] = [];
    for (const chapter of project.chapters) {
      const ids = new Set(chapter.assetIds);
      const assets = byTime(project, eligible.filter((asset) => ids.has(asset.id)));
      assets.forEach((asset) => placed.add(asset.id));
      if (assets.length) result.push({ key: chapter.id, title: chapter.title, color: chapter.color, assets });
    }
    const rest = byTime(project, eligible.filter((asset) => !placed.has(asset.id)));
    if (rest.length) result.push({ key: "none", title: result.length ? "Senza capitolo" : null, assets: rest });
    return result;
  }, [project, filter, order]);

  const total = sections.reduce((sum, section) => sum + section.assets.length, 0);
  let budget = shown;

  return (
    <div className="social-pick" role="dialog" aria-label={title} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="social-pick__card">
        <header className="social-pick__head">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Chiudi"><Icon name="close" /></button>
        </header>
        <div className="social-pick__bar">
          <div className="chips" role="group" aria-label="Filtro">
            {(wideOnly ? [["wide", "Orizzontali"], ["xwide", "Molto larghe"]] as const : [...(hasMarked ? [["social", "Per i social"]] as const : []), ["all", "Tutte"], ["stars", "4 stelle o più"], ["wide", "Orizzontali"]] as const).map(([value, label]) => (
              <button key={value} type="button" className={`chip${filter === value ? " is-active" : ""}`} onClick={() => { setFilter(value); setShown(PAGE); }}>{label}</button>
            ))}
          </div>
          <div className="chips" role="group" aria-label="Ordine">
            <span className="muted small">Ordine</span>
            {([hasChapters ? ["chapters", "Per capitolo"] : null, ["time", "Di scatto"], ["best", "Migliori prima"]].filter(Boolean) as Array<[Order, string]>).map(([value, label]) => (
              <button key={value} type="button" className={`chip${order === value ? " is-active" : ""}`} onClick={() => { setOrder(value); setShown(PAGE); }}>{label}</button>
            ))}
          </div>
          <span className="muted small social-pick__count">{total} {total === 1 ? "foto" : "foto"}</span>
        </div>
        {!wideOnly && (!hasMarked || opening <= 3) ? (
          <p className="notice social-pick__hint">
            <Icon name="info" size={15} /> {hasMarked
              ? "Qui compaiono le foto che hai segnato «Per i social». Per aggiungerne altre: in libreria, tasto destro sulla foto → «Segna come» → «Per i social». Le trovi qui da sole."
              : "Nessuna foto segnata «Per i social». In libreria, tasto destro sulla foto → «Segna come» → «Per i social»: le foto segnate compariranno qui da sole e il carosello le userà per prime. Intanto vedi tutte le foto."}
          </p>
        ) : null}
        <div className="social-pick__scroll">
          {sections.map((section) => {
            const take = Math.max(0, Math.min(section.assets.length, budget));
            budget -= take;
            if (take === 0) return null;
            return (
              <section key={section.key} className="social-pick__section">
                {section.title ? <h4><span className="social-pick__dot" style={{ background: section.color ?? "var(--accent)" }} />{section.title} <span className="muted">· {section.assets.length}</span></h4> : null}
                <div className="social-pick__grid">
                  {section.assets.slice(0, take).map((asset) => <Thumb key={asset.id} asset={asset} used={used.has(asset.id)} onPick={() => onPick(asset.id)} />)}
                </div>
              </section>
            );
          })}
          {total === 0 ? <p className="muted social-pick__empty">Nessuna foto con questo filtro.</p> : null}
          {total > shown ? <button type="button" className="btn btn--sm social-pick__more" onClick={() => setShown((value) => value + PAGE)}>Mostra altre ({total - shown})</button> : null}
        </div>
        {footer ? <footer className="social-pick__foot">{footer}</footer> : null}
      </div>
    </div>
  );
}
