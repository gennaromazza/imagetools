import { useEffect, useRef, type CSSProperties } from "react";
import type { AlbumAssetV2 } from "@photo-tools/shared-types";
import type { CellAlternatives } from "../model/similar";
import { Choice } from "./AlternativesPicker";

/**
 * Striscia delle varianti simili, ancorata alla foto dello spread: si apre dal segnalino «N simili» sulla foto, mostra tutte le foto
 * del gruppo e, passando il mouse su una miniatura, la foto sullo spread cambia solo per prova (`onPreview`); il clic la sceglie.
 */
export function AlternativesStrip({ alternatives, assets, locked, style, onPreview, onPick, onClose }: {
  alternatives: CellAlternatives;
  assets: ReadonlyMap<string, AlbumAssetV2>;
  locked: boolean;
  style: CSSProperties;
  onPreview: (assetId: string | null) => void;
  onPick: (assetId: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Esc chiude solo la striscia (senza togliere anche la selezione); un clic fuori la chiude, tranne sul segnalino che la apre e la chiude da sé.
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopImmediatePropagation(); onPreview(null); onClose(); } };
    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (ref.current?.contains(target) || target?.closest(".cell__alts")) return;
      onPreview(null);
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("pointerdown", onDown, true); };
  }, [onClose, onPreview]);
  const stop = { onClick: (event: React.MouseEvent) => event.stopPropagation(), onDoubleClick: (event: React.MouseEvent) => event.stopPropagation(), onPointerDown: (event: React.PointerEvent) => event.stopPropagation() };
  return (
    <div ref={ref} className="alts-strip" role="listbox" aria-label="Foto simili: passa il mouse per vederla sullo spread, clicca per sceglierla" style={style} onMouseLeave={() => onPreview(null)} {...stop}>
      <p className="alts-strip__hint">{locked ? "Foto bloccata: sbloccala (L) per cambiarla." : `${alternatives.index + 1} di ${alternatives.ids.length} · passa il mouse per provarla, clicca per scegliere`}</p>
      <div className="alts-strip__row">
        {alternatives.ids.map((id, index) => (
          <Choice
            key={id}
            asset={assets.get(id)}
            active={index === alternatives.index}
            disabled={locked}
            onHover={(on) => onPreview(on && index !== alternatives.index ? id : null)}
            onPick={() => { onPreview(null); onPick(id); onClose(); }}
          />
        ))}
      </div>
    </div>
  );
}
