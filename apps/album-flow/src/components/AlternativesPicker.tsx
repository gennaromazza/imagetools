import { useState } from "react";
import type { AlbumAssetV2 } from "@photo-tools/shared-types";
import { useAssetSrc } from "../hooks/useAssetSrc";
import { useNewFeature } from "../hooks/useNewFeature";
import type { CellAlternatives } from "../model/similar";
import { IconButton, Popover } from "./ui";

function Choice({ asset, active, onPick }: { asset: AlbumAssetV2 | undefined; active: boolean; onPick: () => void }) {
  const src = useAssetSrc(asset, 200);
  return (
    <button type="button" className={`alts__choice${active ? " is-active" : ""}`} onClick={onPick} title={asset?.fileName ?? ""} aria-pressed={active}>
      {src ? <img src={src} alt="" draggable={false} style={asset?.rotationDegrees ? { transform: `rotate(${asset.rotationDegrees}deg)` } : undefined} /> : <span className="thumb__ph" />}
      <span>{asset ? asset.fileName.replace(/\.[^.]+$/, "") : ""}</span>
    </button>
  );
}

/** Barra della foto selezionata: le varianti simili della foto, da scorrere (A, Maiusc+A) o da scegliere guardandole. */
export function AlternativesPicker({ alternatives, assets, locked, onStep, onPick }: {
  alternatives: CellAlternatives;
  assets: ReadonlyMap<string, AlbumAssetV2>;
  locked: boolean;
  onStep: (step: 1 | -1) => void;
  onPick: (assetId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const feature = useNewFeature("alternative-simili");
  const label = `${alternatives.index + 1}/${alternatives.ids.length}`;
  return (
    <div className="alts anchor">
      <IconButton icon="chevronLeft" label="Variante simile precedente (Maiusc+A)" disabled={locked} onClick={() => { feature.markSeen(); onStep(-1); }} size={16} />
      <button type="button" className={`alts__count${open ? " is-active" : ""}`} disabled={locked} onClick={() => { feature.markSeen(); setOpen(!open); }} title={locked ? "Foto bloccata" : "Varianti simili di questa foto: scegline una"} aria-expanded={open}>
        {label}
        {feature.isNew ? <span className="new-dot" aria-hidden="true" /> : null}
      </button>
      <IconButton icon="chevronRight" label="Variante simile successiva (A)" disabled={locked} onClick={() => { feature.markSeen(); onStep(1); }} size={16} />
      <Popover open={open} onClose={() => setOpen(false)} side="top" className="popover--wide">
        <p className="popover__hint">Varianti simili: la foto scelta prende il posto di questa, con la stessa cornice.</p>
        <div className="alts__grid">
          {alternatives.ids.map((id, index) => (
            <Choice key={id} asset={assets.get(id)} active={index === alternatives.index} onPick={() => { onPick(id); setOpen(false); }} />
          ))}
        </div>
      </Popover>
    </div>
  );
}
