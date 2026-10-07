import { useEffect } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, FolderOpen, ImagePlus, Info, Keyboard, RefreshCw, RotateCcw } from "lucide-react";
import type { LogoOverlaySpec } from "../../print-engine";
import type { Workbench } from "../../hooks/useWorkbench";
import { Fold, NumberField, RangeField, SegmentedField, SelectField } from "../ui";

/** Impostazioni che valgono per tutte le foto: adattamento, bianco e nero, logo, bordo, segni di taglio. */
export function LayoutControls({ wb }: { wb: Workbench }) {
  const { adjustments, logo, finishing } = wb;
  const logoReady = logo.enabled && Boolean(logo.imageUrl);

  return (
    <div className="slide slide--side">
      <header className="slide__intro">
        <h2>Impagina e rifinisci</h2>
        <p>Trascina le foto sul foglio per inquadrarle meglio. Le impostazioni qui sotto valgono per tutte.</p>
      </header>

      <section className="slide__section">
        <SegmentedField
          label="Come riempire ogni foto"
          value={adjustments.fitMode}
          onChange={(value) => wb.handleFitModeChange(value as "cover" | "contain")}
          options={[
            { value: "cover", label: "Riempi e ritaglia" },
            { value: "contain", label: "Tutta la foto, senza ritaglio" },
          ]}
        />
        <label className="check-row">
          <span>Bianco e nero</span>
          <input type="checkbox" checked={adjustments.blackAndWhiteEnabled} onChange={(event) => wb.setAdjustments((current) => ({ ...current, blackAndWhiteEnabled: event.target.checked }))} />
        </label>
        <label className="check-row">
          <span>Segni di taglio agli angoli</span>
          <input type="checkbox" checked={finishing.cutGuidesEnabled} onChange={(event) => wb.setFinishing((current) => ({ ...current, cutGuidesEnabled: event.target.checked }))} />
        </label>
      </section>

      <Fold title="Logo su ogni foto">
        <label className="check-row">
          <span>Mostra il logo</span>
          <input type="checkbox" checked={logo.enabled} onChange={(event) => wb.setLogo((current) => ({ ...current, enabled: event.target.checked }))} />
        </label>
        <button type="button" className="wide-button" onClick={() => wb.logoInputRef.current?.click()}>
          <ImagePlus size={16} />
          {logo.imageUrl ? "Cambia logo" : "Carica logo"}
        </button>
        <SelectField
          label="Posizione"
          value={logo.position}
          disabled={!logoReady}
          onChange={(position) => wb.setLogo((current) => ({ ...current, position: position as LogoOverlaySpec["position"] }))}
          options={[
            { value: "bottom-right", label: "In basso a destra" },
            { value: "bottom-left", label: "In basso a sinistra" },
            { value: "top-right", label: "In alto a destra" },
            { value: "top-left", label: "In alto a sinistra" },
            { value: "center", label: "Al centro" },
          ]}
        />
        <RangeField label="Grandezza" value={logo.scalePct} min={5} max={80} step={1} suffix="%" disabled={!logoReady} onChange={(scalePct) => wb.setLogo((current) => ({ ...current, scalePct }))} />
        <RangeField label="Opacità" value={Math.round(logo.opacity * 100)} min={5} max={100} step={1} suffix="%" disabled={!logoReady} onChange={(opacity) => wb.setLogo((current) => ({ ...current, opacity: opacity / 100 }))} />
      </Fold>

      <Fold title="Bordo sottile attorno alle foto">
        <label className="check-row">
          <span>Mostra il bordo</span>
          <input type="checkbox" checked={adjustments.borderEnabled} onChange={(event) => wb.setAdjustments((current) => ({ ...current, borderEnabled: event.target.checked }))} />
        </label>
        <div className="grid-two">
          <NumberField label="Spessore" suffix="px" value={adjustments.borderWidthPx} min={1} max={50} step={1} disabled={!adjustments.borderEnabled} onChange={(borderWidthPx) => wb.setAdjustments((current) => ({ ...current, borderWidthPx }))} />
          <label className="field">
            <span>Colore</span>
            <input type="color" value={adjustments.borderColor} disabled={!adjustments.borderEnabled} onChange={(event) => wb.setAdjustments((current) => ({ ...current, borderColor: event.target.value }))} />
          </label>
        </div>
        <p className="slide__hint">Il bordo è dentro la misura della foto: non la ingrandisce.</p>
      </Fold>

      <Fold title="Opzioni avanzate">
        <label className="check-row">
          <span>Ruota le foto per seguire il formato</span>
          <input type="checkbox" checked={adjustments.autoRotateBySourceOrientation} onChange={(event) => wb.handleAutoRotateChange(event.target.checked)} />
        </label>
        <p className="slide__hint">Di solito lascialo spento: l'orientamento EXIF è già applicato quando importo le foto.</p>
      </Fold>
    </div>
  );
}

/** Controlli della foto selezionata: inquadratura fine, editor esterno, conferma. */
export function PhotoEditor({ wb }: { wb: Workbench }) {
  const { activeAsset, activeCrop, assets, activeIndex } = wb;

  // Le scorciatoie da tastiera valgono solo mentre questo passo è visibile.
  const { setKeyboardEnabled } = wb;
  useEffect(() => {
    setKeyboardEnabled(true);
    return () => setKeyboardEnabled(false);
  }, [setKeyboardEnabled]);

  if (!activeAsset || !activeCrop) {
    return <p className="slide__hint">Clicca una foto sul foglio per inquadrarla meglio.</p>;
  }

  return (
    <div className="photo-editor">
      <div className="photo-editor__head">
        <div>
          <strong>Foto {activeIndex + 1} di {assets.length}</strong>
          <span title={activeAsset.relativePath || activeAsset.fileName}>{activeAsset.fileName}</span>
        </div>
        <div className="sheet-nav">
          <button type="button" aria-label="Foto precedente" title="Foto precedente" onClick={() => wb.markReviewedAndMove(-1)} disabled={activeIndex === 0}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" aria-label="Foto successiva" title="Foto successiva" onClick={() => wb.markReviewedAndMove(1)} disabled={activeIndex >= assets.length - 1}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className={wb.isDraggingCrop ? "interaction-feedback interaction-feedback--active" : "interaction-feedback"}>
        <Info size={16} />
        <span>{wb.interactionHint}</span>
      </div>

      <div className="photo-editor__sliders">
        <RangeField
          label="Sposta in orizzontale"
          value={Math.round((activeCrop.cropLeft + activeCrop.cropWidth / 2) * 100)}
          min={Math.round((activeCrop.cropWidth / 2) * 100)}
          max={Math.round((1 - activeCrop.cropWidth / 2) * 100)}
          step={1}
          suffix="%"
          onChange={(value) => wb.updateActiveCrop({ cropLeft: value / 100 - activeCrop.cropWidth / 2 })}
        />
        <RangeField
          label="Sposta in verticale"
          value={Math.round((activeCrop.cropTop + activeCrop.cropHeight / 2) * 100)}
          min={Math.round((activeCrop.cropHeight / 2) * 100)}
          max={Math.round((1 - activeCrop.cropHeight / 2) * 100)}
          step={1}
          suffix="%"
          onChange={(value) => wb.updateActiveCrop({ cropTop: value / 100 - activeCrop.cropHeight / 2 })}
        />
        <RangeField label="Zoom" value={Number(wb.zoom.toFixed(2))} min={1} max={4} step={0.05} suffix="x" onChange={wb.setActiveZoom} />
        <RangeField label="Inclinazione" value={activeCrop.rotation} min={-180} max={180} step={1} suffix="°" onChange={(rotation) => wb.updateActiveCrop({ rotation })} />
      </div>

      <div className="photo-editor__buttons">
        <button type="button" className="secondary-button" onClick={wb.rotateActiveCrop}>
          <RotateCcw size={16} />
          Ruota di 90°
        </button>
        <button type="button" className="secondary-button" onClick={wb.resetActiveCrop}>
          <RotateCcw size={16} />
          Taglio automatico
        </button>
        {window.filexDesktop?.openWithEditor ? (
          <>
            <button type="button" className="secondary-button" onClick={wb.openActiveInEditor} disabled={!activeAsset.absolutePath}>
              <ExternalLink size={16} />
              Apri in editor
            </button>
            <button type="button" className="secondary-button" onClick={() => wb.refreshAssetFromDisk(activeAsset.id)} disabled={!activeAsset.absolutePath}>
              <RefreshCw size={16} />
              Aggiorna da file
            </button>
            <button type="button" className="secondary-button" onClick={wb.relinkActiveAssetFromSavedFile} disabled={!window.filexDesktop?.chooseImageFile}>
              <FolderOpen size={16} />
              Usa file salvato
            </button>
          </>
        ) : null}
        <button type="button" className="primary-button" onClick={() => wb.markReviewedAndMove(1)}>
          Conferma e avanti
        </button>
      </div>

      <details className="shortcuts">
        <summary><Keyboard size={14} /> Scorciatoie da tastiera</summary>
        <ul>
          <li><kbd>Frecce</kbd> sposta (con <kbd>Maiusc</kbd> più veloce)</li>
          <li><kbd>+</kbd> / <kbd>−</kbd> zoom</li>
          <li><kbd>X</kbd> ruota di 90°</li>
          <li><kbd>R</kbd> taglio automatico</li>
          <li><kbd>B</kbd> bianco e nero</li>
          <li><kbd>Invio</kbd> conferma e avanti</li>
        </ul>
      </details>
    </div>
  );
}
