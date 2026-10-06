import { type ReactNode, useState } from "react";
import type { AlbumArea, AlbumSplitMode, AreaAlign, AreaStyle } from "@photo-tools/shared-types";
import { SPLIT_MODES } from "../engine/geometry";
import { BACKGROUND_SWATCHES, STYLE_LIMITS } from "../model/defaults";
import { Icon, type IconName } from "./icons";
import { ColorDots, NumberField, Popover } from "./ui";

export const SPLIT_LABELS: Record<AlbumSplitMode, string> = {
  full: "Foglio intero",
  half: "Metà e metà",
  third: "Un terzo + due terzi",
  "two-thirds": "Due terzi + un terzo",
};
const SPLIT_ICONS: Record<AlbumSplitMode, IconName> = { full: "splitFull", half: "splitHalf", third: "splitThird", "two-thirds": "splitTwoThirds" };
const ALIGN_LABELS: Record<AreaAlign, string> = { start: "In alto a sinistra", center: "Al centro", end: "In basso a destra" };
const ALIGN_ICONS: Record<AreaAlign, IconName> = { start: "alignStart", center: "alignCenter", end: "alignEnd" };

function Group({ caption, children }: { caption: string; children: ReactNode }) {
  return <div className="strip__group"><span className="strip__caption">{caption}</span>{children}</div>;
}

function StripButton({ icon, label, onClick, active, disabled, tone }: { icon: IconName; label: string; onClick?: (event: React.MouseEvent) => void; active?: boolean; disabled?: boolean; tone?: "gold" | "danger" }) {
  return (
    <button type="button" className={`strip__btn${active ? " is-active" : ""}${tone ? ` strip__btn--${tone}` : ""}`} title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={20} />
    </button>
  );
}

export interface AreaStripProps {
  side: "left" | "right";
  area: AlbumArea;
  split: AlbumSplitMode;
  linked: boolean;
  active: boolean;
  twoAreas: boolean;
  onActivate: () => void;
  onShuffle: () => void;
  onStyle: (changes: Partial<AreaStyle>, coalesceKey?: string, relayout?: boolean) => void;
  onAlign: (align: AreaAlign) => void;
  onSplit: (mode: AlbumSplitMode) => void;
  onLink: () => void;
  onSwapAreas: () => void;
  /** Layout protetto da Mescola, layout proposti e Auto Build. */
  locked: boolean;
  /** Disposizione libera: le foto si spostano e ridimensionano a piacere. */
  free: boolean;
  onLock: (locked: boolean) => void;
  onFree: () => void;
  onRestore: () => void;
}

/** Striscia verticale di controlli di un'area di lavoro: mescola, spazio, margine, bordo, modo, allineamento, divisione. */
export function AreaStrip(props: AreaStripProps) {
  const { side, area, split, linked, active, twoAreas } = props;
  const [popover, setPopover] = useState<null | "align" | "split" | "layout">(null);
  const [confirmBack, setConfirmBack] = useState(false);
  const popoverSide = side === "left" ? "right" : "left";
  const style = area.style;
  const empty = area.items.length === 0;

  return (
    <aside className={`strip strip--${side}${active ? " is-active" : ""}`} aria-label={`Controlli ${side === "left" ? "della pagina sinistra" : "della pagina destra"}`} onPointerDownCapture={props.onActivate}>
      <Group caption="MESCOLA">
        <StripButton icon="shuffle" label="Cambia disposizione delle foto (↑ ↓)" onClick={props.onShuffle} disabled={empty} />
      </Group>
      <Group caption="LAYOUT">
        <div className="anchor">
          <StripButton
            icon={props.locked ? "lock" : "unlock"}
            label={props.locked ? "Layout bloccato: Mescola e Auto Build non lo toccano. Clic per le opzioni" : props.free ? "Layout libero: sposta le foto a piacere. Clic per le opzioni" : "Layout della pagina: sblocca per spostare le foto a piacere o proteggilo"}
            active={props.locked}
            tone={props.locked ? "gold" : undefined}
            onClick={() => { setConfirmBack(false); setPopover(popover === "layout" ? null : "layout"); }}
          />
          <Popover open={popover === "layout"} onClose={() => { setPopover(null); setConfirmBack(false); }} side={popoverSide} className="popover--wide">
            <p className="popover__title">Layout di questa pagina</p>
            {props.free ? (
              confirmBack ? (
                <>
                  <p className="popover__hint">Le foto che hai spostato a mano tornano dove le aveva messe il programma?</p>
                  <button type="button" className="popover__row" onClick={() => { props.onRestore(); setPopover(null); setConfirmBack(false); }}>Torna al layout di prima</button>
                  <button type="button" className="popover__row" onClick={() => { setPopover(null); setConfirmBack(false); }}>Tieni la disposizione nuova</button>
                </>
              ) : (
                <button type="button" className="popover__row" disabled={props.locked} onClick={() => setConfirmBack(true)}>Torna al layout automatico…</button>
              )
            ) : (
              <button type="button" className="popover__row" disabled={props.locked || empty} onClick={() => { props.onFree(); setPopover(null); }}><Icon name="unlock" size={15} /> Sposta le foto liberamente</button>
            )}
            <button type="button" className="popover__row" onClick={() => { props.onLock(!props.locked); setPopover(null); }}>
              <Icon name={props.locked ? "unlock" : "lock"} size={15} /> {props.locked ? "Sblocca il layout" : "Proteggi il layout"}
            </button>
            <p className="popover__hint">{props.locked ? "Bloccato: Mescola, i layout proposti e Auto Build lasciano questa pagina com'è." : "Proteggi il layout per non perdere le posizioni quando usi Mescola o Auto Build. Sbloccata, la pagina si può ridisegnare."}</p>
          </Popover>
        </div>
      </Group>
      <Group caption="SPAZIO">
        <NumberField label="cm" value={style.gapCm} {...STYLE_LIMITS.gapCm} onChange={(value) => props.onStyle({ gapCm: value }, "gap")} title="Spazio tra le foto (cm). Trascina verso l'alto o il basso per cambiarlo." />
      </Group>
      <Group caption="MARGINE">
        <NumberField label="cm" value={style.paddingCm} {...STYLE_LIMITS.paddingCm} onChange={(value) => props.onStyle({ paddingCm: value }, "padding")} title="Margine attorno alle foto (cm)" />
      </Group>
      <Group caption="BORDO">
        <NumberField label="cm" value={style.borderCm} {...STYLE_LIMITS.borderCm} onChange={(value) => props.onStyle({ borderCm: value }, "border")} title="Spessore del bordo di ogni foto (cm)" />
        <ColorDots value={style.borderColor} swatches={["#000000", "#ffffff"]} onChange={(color) => props.onStyle({ borderColor: color })} label="Colore del bordo" />
      </Group>
      <Group caption="MODO">
        <StripButton icon={style.mode === "fill" ? "fill" : "fit"} label={style.mode === "fill" ? "Riempi lo spazio ritagliando: clic per mostrare la foto intera (Alt + clic: ridisegna anche la disposizione)" : "Foto intera: clic per riempire gli spazi bianchi tenendo la disposizione (Alt + clic: ridisegna la disposizione per riempire al meglio)"} onClick={(event) => props.onStyle({ mode: style.mode === "fill" ? "fit" : "fill" }, undefined, event.altKey)} active={style.mode === "fill"} />
      </Group>
      <Group caption="ALLINEA">
        <div className="anchor">
          <StripButton icon={ALIGN_ICONS[style.align]} label="Allinea le foto: in «Riempi» ancora il ritaglio, in «Foto intera» sposta la foto nella cella" onClick={() => setPopover(popover === "align" ? null : "align")} />
          <Popover open={popover === "align"} onClose={() => setPopover(null)} side={popoverSide}>
            <div className="choice-row">
              {(["start", "center", "end"] as AreaAlign[]).map((align) => (
                <button key={align} type="button" className={`choice${style.align === align ? " is-active" : ""}`} title={ALIGN_LABELS[align]} aria-label={ALIGN_LABELS[align]} onClick={() => { props.onAlign(align); setPopover(null); }}><Icon name={ALIGN_ICONS[align]} size={22} /></button>
              ))}
            </div>
          </Popover>
        </div>
      </Group>
      <Group caption="DIVIDI">
        <div className="anchor">
          <StripButton icon={SPLIT_ICONS[split]} label={`Divisione dello spread: ${SPLIT_LABELS[split]}`} onClick={() => setPopover(popover === "split" ? null : "split")} />
          <Popover open={popover === "split"} onClose={() => setPopover(null)} side={popoverSide}>
            <div className="choice-row">
              {SPLIT_MODES.map((mode) => (
                <button key={mode} type="button" className={`choice${split === mode ? " is-active" : ""}`} title={SPLIT_LABELS[mode]} aria-label={SPLIT_LABELS[mode]} onClick={() => { props.onSplit(mode); setPopover(null); }}><Icon name={SPLIT_ICONS[mode]} size={24} /></button>
              ))}
            </div>
            <p className="popover__hint">{SPLIT_LABELS[split]}</p>
          </Popover>
        </div>
      </Group>
      {twoAreas ? (
        <div className="strip__pair">
          <StripButton icon={linked ? "link" : "unlink"} label="Stesso stile a sinistra e a destra (Ctrl/⌘+L)" onClick={props.onLink} active={linked} />
          <StripButton icon="swap" label="Scambia le due pagine" onClick={props.onSwapAreas} />
        </div>
      ) : null}
    </aside>
  );
}

export { BACKGROUND_SWATCHES };
