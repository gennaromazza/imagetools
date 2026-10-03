import type { ReactNode } from "react";
import { PhotosRecap } from "./StepFrame";

export interface SummaryRow { label: string; value: ReactNode }

/**
 * Ultimo sguardo: riepilogo, due scelte semplici e il pulsante per avviare.
 * Fotografo, contratto e cartella base stanno in `moreSettings` (chiuso, si apre da solo se manca qualcosa);
 * barra di avanzamento, errori e sorgente stanno in `children`.
 */
export function ConfirmStep({ photosText, onChangePhotos, rows, rename, onRename, lightCopies, onLightCopies, skipArchived, finish, moreSettings, moreSettingsOpen, children, importing, startBlockedReason, onBack, onStart }: {
  photosText: string; onChangePhotos: () => void;
  rows: readonly SummaryRow[];
  rename: boolean; onRename: (value: boolean) => void;
  lightCopies: boolean; onLightCopies: (value: boolean) => void;
  /** Presente solo se alcune foto risultano già in archivio. */
  skipArchived?: { count: number; where: string; value: boolean; onChange: (value: boolean) => void };
  finish: ReactNode;
  moreSettings: ReactNode; moreSettingsOpen: boolean;
  children?: ReactNode;
  importing: boolean;
  /** Se presente, il pulsante Avvia resta spento e il motivo viene mostrato accanto. */
  startBlockedReason?: string;
  onBack: () => void; onStart: () => void;
}) {
  return <>
    <div className="panel-section wizard-slide import-step--confirm" style={{ padding: "var(--space-4)" }}>
      <div className="stack">
        <PhotosRecap text={photosText} onChange={onChangePhotos} />
        <div>
          <h3 className="wizard-title">Tutto pronto?</h3>
          <p className="import-step__description">I file sulla scheda non vengono toccati: li copio e controllo uno per uno.</p>
        </div>
        <dl className="wizard-summary" aria-label="Riepilogo importazione">
          {rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
        </dl>
        <div className="stack" style={{ gap: "0.5rem" }}>
          {skipArchived && <label className="check-row" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={skipArchived.value} onChange={(event) => skipArchived.onChange(event.target.checked)} style={{ width: 16, height: 16, cursor: "pointer" }} />
            <span>{skipArchived.count === 1 ? "Salta la foto già in archivio" : `Salta le ${skipArchived.count.toLocaleString("it-IT")} foto già in archivio`} {skipArchived.where && <small style={{ color: "var(--text-muted)" }}>({skipArchived.where})</small>}</span>
          </label>}
          <label className="check-row" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={rename} onChange={(event) => onRename(event.target.checked)} style={{ width: 16, height: 16, cursor: "pointer" }} />
            <span>Dai ai file un nome ordinato <small style={{ color: "var(--text-muted)" }}>(es. MariaRossi_20260321_Gennaro_DSCF1234.RAF)</small></span>
          </label>
          <label className="check-row" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={lightCopies} onChange={(event) => onLightCopies(event.target.checked)} style={{ width: 16, height: 16, cursor: "pointer" }} />
            <span>Crea anche copie leggere delle foto <small style={{ color: "var(--text-muted)" }}>(JPG piccoli, comodi da inviare)</small></span>
          </label>
        </div>
        <details className="import-advanced-panel" open={moreSettingsOpen}>
          <summary>Altre impostazioni (fotografo, contratto, cartella base)</summary>
          <div className="stack" style={{ gap: "0.6rem", margin: "0.5rem 0 0.75rem" }}>{moreSettings}</div>
        </details>
        <details className="import-advanced-panel">
          <summary>Cosa fare alla fine</summary>
          <div className="stack" style={{ gap: "0.45rem", margin: "0.4rem 0 0.75rem" }}>{finish}</div>
        </details>
      </div>
    </div>
    {children}
    <div className="wizard-nav wizard-nav--sticky">
      <button type="button" className="ghost-button" onClick={onBack} disabled={importing}>← Indietro</button>
      <div className="wizard-nav__next">
        {startBlockedReason && !importing && <small role="alert">{startBlockedReason}</small>}
        <button type="button" className="primary-button" onClick={onStart} disabled={importing || Boolean(startBlockedReason)}>{importing ? "Importazione in corso…" : "▶ Avvia importazione"}</button>
      </div>
    </div>
  </>;
}
