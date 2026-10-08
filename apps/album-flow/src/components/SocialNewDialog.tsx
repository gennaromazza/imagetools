import { useMemo, useState } from "react";
import type { AlbumAssetV2 } from "@photo-tools/shared-types";
import { useAssetSrc } from "../hooks/useAssetSrc";
import type { Project } from "../model/project";
import { defaultBrand } from "../social/brand";
import { freshSeed, planCarousel, planCoverage, rankPhotos, setBrand, suggestSlideCount } from "../social/plan";
import { loadBrand } from "../social/store";
import { MAX_SLIDES, MIN_SLIDES, type Carousel, type SetId } from "../social/types";
import { Icon } from "./icons";
import { SocialPhotoPicker } from "./SocialPhotoPicker";
import { Modal } from "./ui";

/** Quante miniature mostrare prima di «+N»: bastano a riconoscere la scelta. */
const SHOWN = 14;
/** Se nessuna foto è segnata «Per i social» si parte dalle migliori dell'album. */
const FALLBACK = 12;

function Mini({ asset }: { asset: AlbumAssetV2 | undefined }) {
  const src = useAssetSrc(asset, 120);
  return <span className="social-new__mini">{src ? <img src={src} alt="" draggable={false} /> : null}</span>;
}

/** Foto di partenza: quelle segnate «Per i social», nell'ordine della classifica; altrimenti le migliori. */
export function initialSelection(project: Project): { ids: string[]; marked: boolean } {
  const ranked = rankPhotos(project);
  const marked = ranked.filter((photo) => project.assets.find((asset) => asset.id === photo.assetId)?.albumTags?.includes("social"));
  if (marked.length > 0) return { ids: marked.map((photo) => photo.assetId), marked: true };
  return { ids: ranked.slice(0, FALLBACK).map((photo) => photo.assetId), marked: false };
}

/**
 * Creazione guidata di un carosello: si vedono le foto scelte per i social, si propone il numero di slide che serve per usarle tutte
 * e lo si può cambiare prima di creare. Il carosello nasce già con quelle foto (e solo quelle).
 */
export function SocialNewDialog({ project, name, setId, onCreate, onCancel }: {
  project: Project;
  name: string;
  setId: SetId;
  onCreate: (carousel: Carousel) => void;
  onCancel: () => void;
}) {
  const start = useMemo(() => initialSelection(project), [project]);
  const [chosen, setChosen] = useState<string[]>(start.ids);
  const [source, setSource] = useState<"marked" | "best" | "manual">(start.marked ? "marked" : "best");
  const [title, setTitle] = useState(name);
  const [picking, setPicking] = useState(false);
  const [manual, setManual] = useState<number | null>(null);
  const [seed] = useState(freshSeed);

  const suggested = useMemo(() => suggestSlideCount(project, chosen, setId, seed), [project, chosen, setId, seed]);
  const count = Math.max(MIN_SLIDES, Math.min(MAX_SLIDES, manual ?? suggested));
  const brand = useMemo(() => loadBrand() ?? setBrand(defaultBrand(""), setId), [setId]);
  const planned = useMemo(() => (chosen.length ? planCarousel(project, { setId, format: "feed", count, brand, name: title, assetIds: chosen, seed }) : null), [project, chosen, setId, count, brand, title, seed]);

  const stats = useMemo(() => planCoverage(project, chosen, count, setId, seed), [project, chosen, count, setId, seed]);

  const assetOf = (id: string) => project.assets.find((asset) => asset.id === id);
  const toggle = (id: string) => { setChosen((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id])); setSource("manual"); setManual(null); };
  const missing = chosen.length - stats.used;

  return (
    <>
      <Modal title="Nuovo carosello" subtitle="Scegli le foto e quante slide vuoi: il resto lo propone Album Flow." onClose={picking ? () => setPicking(false) : onCancel}
        footer={(
          <>
            <button type="button" className="btn btn--ghost" onClick={onCancel}>Annulla</button>
            <button type="button" className="btn btn--primary" disabled={!planned} onClick={() => planned && onCreate(planned)}>Crea il carosello</button>
          </>
        )}>
        <div className="social-new">
          <label className="field"><span className="field__label">Nome</span>
            <input className="input" value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} /></label>

          <div className="social-new__block">
            <div className="social-new__head">
              <h4>Foto del carosello <span className="muted">· {chosen.length}</span></h4>
              <div className="btn-row">
                {source === "manual" ? <button type="button" className="btn btn--sm btn--ghost" onClick={() => { const next = initialSelection(project); setChosen(next.ids); setSource(next.marked ? "marked" : "best"); setManual(null); }}>{start.marked ? "Solo quelle «Per i social»" : "Le migliori"}</button> : null}
                <button type="button" className="btn btn--sm" onClick={() => setPicking(true)}><Icon name="plus" size={14} /> Scegli le foto…</button>
              </div>
            </div>
            <div className="social-new__minis">
              {chosen.slice(0, SHOWN).map((id) => <Mini key={id} asset={assetOf(id)} />)}
              {chosen.length > SHOWN ? <span className="social-new__more">+{chosen.length - SHOWN}</span> : null}
              {chosen.length === 0 ? <span className="muted small">Nessuna foto: scegline qualcuna.</span> : null}
            </div>
            <p className="muted small">{source === "marked" ? "Sono le foto che hai segnato «Per i social» in libreria." : source === "best" ? "Nessuna foto è segnata «Per i social»: parto dalle migliori. Puoi cambiarle." : "Scelta fatta a mano."}</p>
          </div>

          <div className="social-new__block">
            <div className="social-new__head"><h4>Numero di slide</h4><strong className="social-new__count">{count}</strong></div>
            <input type="range" min={MIN_SLIDES} max={MAX_SLIDES} step={1} value={count} aria-label="Numero di slide" onChange={(event) => setManual(Number(event.target.value))} />
            <p className="muted small">
              {chosen.length > 0 ? `Per ${chosen.length} ${chosen.length === 1 ? "foto" : "foto"} ne propongo ${suggested}. ` : ""}Instagram ne accetta fino a {MAX_SLIDES}. Potrai cambiarle anche dopo.
            </p>
            {chosen.length > 0 && missing > 0 ? <p className="notice social-new__warn"><Icon name="info" size={15} /> Con {count} slide entrano {stats.used} foto su {chosen.length}: alza il numero per usarle tutte.</p> : null}
            {chosen.length > 0 && missing <= 0 && stats.repeated > 0 ? <p className="notice social-new__warn"><Icon name="info" size={15} /> Con {count} slide {stats.repeated === 1 ? "una foto compare" : `${stats.repeated} foto compaiono`} due volte per riempire tutti gli spazi: con meno slide alcune foto resterebbero fuori.</p> : null}
          </div>
        </div>
      </Modal>
      {picking ? (
        <SocialPhotoPicker project={project} title="Scegli le foto del carosello" used={new Set(chosen)} onPick={toggle} onClose={() => setPicking(false)}
          footer={<div className="social-pick__pano"><span className="muted small">{chosen.length} {chosen.length === 1 ? "foto scelta" : "foto scelte"}. Clic su una foto per sceglierla o toglierla.</span><button type="button" className="btn btn--primary btn--sm" onClick={() => setPicking(false)}>Fatto</button></div>} />
      ) : null}
    </>
  );
}
