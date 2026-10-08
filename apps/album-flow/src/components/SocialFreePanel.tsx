import { useState } from "react";
import type { AlbumAssetV2 } from "@photo-tools/shared-types";
import { useAssetSrc } from "../hooks/useAssetSrc";
import { MAX_FREE_FRAMES, type FreeFrame, type PhotoMask, type Slide } from "../social/types";
import { Icon } from "./icons";
import { Segmented } from "./ui";

const PAGE = 24;

function Thumb({ asset, title, active, onClick, children }: { asset: AlbumAssetV2 | undefined; title: string; active?: boolean; onClick: () => void; children?: React.ReactNode }) {
  const src = useAssetSrc(asset, 200);
  return (
    <button type="button" className={`social-avail__thumb${active ? " is-active" : ""}`} title={title} aria-label={title} onClick={onClick}>
      {src ? <img src={src} alt="" draggable={false} /> : <span className="social-slot__empty"><Icon name="plus" size={16} /></span>}
      {children}
    </button>
  );
}

const MASKS: Array<{ value: PhotoMask; label: string }> = [{ value: "rect", label: "Rettangolo" }, { value: "ellipse", label: "Tonda" }, { value: "arch", label: "Arco" }];

/**
 * Foto della slide in «modo libero» (spostare, ridimensionare, ruotare, sovrapporre) e foto ancora disponibili:
 * quelle segnate «Per i social» che il carosello non usa ancora.
 */
export function SocialFreePanel({ slide, selected, onSelect, assetOf, available, hasMarked, onEnter, onLeave, onPatch, onRemove, onReorder, onAdd, onUseHere, onPick }: {
  slide: Slide;
  selected: number;
  onSelect: (index: number) => void;
  assetOf: (id: string | null | undefined) => AlbumAssetV2 | undefined;
  available: AlbumAssetV2[];
  hasMarked: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onPatch: (frameId: string, patch: Partial<Omit<FreeFrame, "id">>, key?: string) => void;
  onRemove: (frameId: string) => void;
  onReorder: (frameId: string, to: "front" | "back" | "up" | "down") => void;
  onAdd: (assetId: string) => void;
  onUseHere: (assetId: string) => void;
  onPick: (index: number) => void;
}) {
  const [shown, setShown] = useState(PAGE);
  const frames = slide.free;
  const frame = frames?.[Math.min(selected, (frames?.length ?? 1) - 1)];
  return (
    <div className="social-free">
      <h4>Disposizione</h4>
      <Segmented<"model" | "free"> label="Disposizione delle foto" value={frames ? "free" : "model"} onChange={(value) => (value === "free" ? onEnter() : onLeave())}
        options={[{ value: "model", label: "Del modello" }, { value: "free", label: "Libera" }]} />
      <p className="muted small social-hint">{frames
        ? "Trascina la foto nell'anteprima con «Sposta», ridimensionala con le maniglie, girala con il cerchio in alto. Le foto si sovrappongono: l'ultima sta sopra."
        : "Clicca una foto nell'anteprima: le maniglie ai bordi la ridimensionano e passano da sole alla disposizione libera."}</p>

      {frames ? (
        <>
          <div className="social-free__list" role="listbox" aria-label="Foto della slide">
            {frames.map((item, index) => (
              <Thumb key={item.id} asset={assetOf(item.assetId)} title={`Foto ${index + 1}${item.assetId ? "" : " (vuota)"}`} active={index === selected} onClick={() => onSelect(index)}>
                <span className="social-free__n">{index + 1}</span>
              </Thumb>
            ))}
          </div>
          {frame ? (
            <div className="social-free__tools">
              <label className="social-style__row"><span>Rotazione <strong>{Math.round(frame.rotation ?? 0)}°</strong></span>
                <input type="range" min={-45} max={45} step={1} value={Math.round(frame.rotation ?? 0)} aria-label="Rotazione della foto" onChange={(event) => onPatch(frame.id, { rotation: Number(event.target.value) }, `rot:${frame.id}`)} /></label>
              <div className="social-style__row"><span>Forma</span>
                <div className="chips">{MASKS.map((mask) => <button key={mask.value} type="button" className={`chip${frame.mask === mask.value ? " is-active" : ""}`} onClick={() => onPatch(frame.id, { mask: mask.value })}>{mask.label}</button>)}</div></div>
              <div className="chips">
                <button type="button" className={`chip${frame.border ? " is-active" : ""}`} aria-pressed={Boolean(frame.border)} onClick={() => onPatch(frame.id, { border: !frame.border })}>Bordo bianco</button>
                <button type="button" className={`chip${frame.shadow ? " is-active" : ""}`} aria-pressed={Boolean(frame.shadow)} onClick={() => onPatch(frame.id, { shadow: !frame.shadow })}>Ombra</button>
              </div>
              <div className="btn-row">
                <button type="button" className="btn btn--sm" onClick={() => onReorder(frame.id, "front")} title="Porta davanti a tutte">Davanti</button>
                <button type="button" className="btn btn--sm" onClick={() => onReorder(frame.id, "back")} title="Porta dietro a tutte">Dietro</button>
                <button type="button" className="btn btn--sm" onClick={() => onPick(Math.min(selected, frames.length - 1))}>Cambia foto…</button>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => onPatch(frame.id, { rotation: 0, zoom: 1, cx: 0.5, cy: 0.5 })} title="Toglie rotazione e zoom">Raddrizza</button>
                <button type="button" className="btn btn--sm btn--danger" onClick={() => onRemove(frame.id)}><Icon name="trash" size={13} /> Togli</button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <h4>Altre foto disponibili <span className="muted">· {available.length}</span></h4>
      {available.length === 0 ? (
        <p className="muted small social-hint">{hasMarked
          ? "Tutte le foto segnate «Per i social» sono già nel carosello."
          : "Nessuna foto segnata «Per i social». In libreria: tasto destro sulla foto → «Segna come» → «Per i social» (o il tasto I). Quelle non ancora usate compaiono qui."}</p>
      ) : (
        <>
          <p className="muted small social-hint">{frames
            ? (frames.length >= MAX_FREE_FRAMES ? "Hai raggiunto il massimo di foto in questa slide." : "Clic su una foto per aggiungerla alla slide.")
            : "Clic su una foto per metterla nello spazio selezionato."}</p>
          <div className="social-avail">
            {available.slice(0, shown).map((asset) => (
              <Thumb key={asset.id} asset={asset} title={`${asset.fileName} — ${frames ? "aggiungi alla slide" : "usa nello spazio selezionato"}`} onClick={() => (frames ? onAdd(asset.id) : onUseHere(asset.id))}>
                {!frames ? null : <span className="social-avail__plus"><Icon name="plus" size={12} /></span>}
              </Thumb>
            ))}
          </div>
          {available.length > shown ? <button type="button" className="btn btn--sm social__full" onClick={() => setShown((value) => value + PAGE)}>Mostra altre ({available.length - shown})</button> : null}
        </>
      )}
    </div>
  );
}
